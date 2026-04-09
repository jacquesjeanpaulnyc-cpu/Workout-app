/**
 * Client Reactivation Engine — Find inactive clients, draft win-back messages
 *
 * Queries Supabase for inactive clients, uses Claude to craft personalized
 * win-back SMS messages, and queues them for when Twilio A2P clears.
 *
 * Commands via Telegram:
 *   "show reactivation targets" — list top inactive clients
 *   "draft reactivation messages" — Claude writes personalized SMS
 *   "reactivation stats" — campaign overview
 */

import { fetch as undiciFetch, ProxyAgent } from "undici";

const proxyUrl = process.env.HTTPS_PROXY || process.env.https_proxy || process.env.HTTP_PROXY || process.env.http_proxy;
const dispatcher = proxyUrl ? new ProxyAgent(proxyUrl) : undefined;

async function supabaseGet(path) {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_KEY;
  const res = await undiciFetch(`${url}/rest/v1/${path}`, {
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
      Prefer: "count=exact"
    },
    ...(dispatcher ? { dispatcher } : {})
  });
  if (!res.ok) throw new Error(`Supabase ${res.status}: ${await res.text()}`);
  const total = res.headers.get("content-range")?.split("/")[1] || null;
  const data = await res.json();
  return { data, total: total ? parseInt(total) : data.length };
}

async function supabasePost(path, body) {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_KEY;
  const res = await undiciFetch(`${url}/rest/v1/${path}`, {
    method: "POST",
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
      Prefer: "return=representation"
    },
    body: JSON.stringify(body),
    ...(dispatcher ? { dispatcher } : {})
  });
  if (!res.ok) throw new Error(`Supabase POST ${res.status}: ${await res.text()}`);
  return res.json();
}

export const definition = {
  name: "reactivation_engine",
  description: "Client reactivation system for Brazilian Blueprint. Find inactive clients who haven't booked in 30+ days, draft personalized win-back SMS messages using Claude, and queue campaigns for when Twilio A2P clears. Actions: 'targets' (list inactive clients), 'draft' (generate SMS messages for top targets), 'stats' (campaign overview), 'save_campaign' (save drafted messages to Supabase).",
  input_schema: {
    type: "object",
    properties: {
      action: {
        type: "string",
        enum: ["targets", "draft", "stats", "save_campaign"],
        description: "targets = show inactive clients, draft = generate win-back SMS, stats = overview, save_campaign = save to DB"
      },
      limit: {
        type: "number",
        description: "How many clients to target. Defaults to 10."
      },
      promo: {
        type: "string",
        description: "Optional promo to include in messages (e.g. '15% off', '$10 off Brazilian', 'Wax Wednesday special')"
      },
      tone: {
        type: "string",
        enum: ["warm", "urgent", "exclusive", "casual"],
        description: "Message tone. Defaults to warm."
      }
    },
    required: ["action"]
  }
};

export async function execute({ action, limit, promo, tone }) {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_KEY;

  if (!url || !key) {
    return { error: "Supabase not configured." };
  }

  try {
    switch (action) {
      case "targets": return await getTargets(limit || 10);
      case "draft": return await draftMessages(limit || 5, promo, tone || "warm");
      case "stats": return await getStats();
      case "save_campaign": return await saveCampaign(promo);
      default: return { error: `Unknown action: ${action}` };
    }
  } catch (err) {
    return { error: `Reactivation engine error: ${err.message}` };
  }
}

async function getTargets(limit) {
  // Get inactive clients with SMS opt-in, ordered by most recent
  const result = await supabaseGet(
    `clients?select=id,first_name,last_name,phone,inactivity_flagged_at,last_appointment_at,created_at&is_inactive=eq.true&sms_opt_in=eq.true&order=created_at.desc&limit=${limit}`
  );

  // Get total count
  const countResult = await supabaseGet(
    "clients?select=id&is_inactive=eq.true&sms_opt_in=eq.true"
  );

  const clients = result.data.map(c => ({
    name: `${c.first_name} ${c.last_name || ""}`.trim(),
    phone: c.phone,
    inactive_since: c.inactivity_flagged_at?.split("T")[0] || "unknown",
    client_since: c.created_at?.split("T")[0]
  }));

  return {
    total_inactive_sms_eligible: countResult.total,
    showing: clients.length,
    clients,
    note: "These clients have SMS opt-in and are flagged inactive. Ready for win-back when A2P clears."
  };
}

async function draftMessages(limit, promo, tone) {
  const result = await supabaseGet(
    `clients?select=id,first_name,last_name,phone,created_at&is_inactive=eq.true&sms_opt_in=eq.true&order=created_at.desc&limit=${limit}`
  );

  if (!result.data.length) return { error: "No inactive clients found." };

  const services = await supabaseGet(
    "service_templates?select=name,default_price,category&is_active=eq.true&limit=10"
  );
  const serviceNames = services.data.map(s => `${s.name} ($${s.default_price})`).join(", ");

  const toneGuide = {
    warm: "Warm, friendly, like texting a regular who you miss.",
    urgent: "Create urgency — limited time, spots filling up.",
    exclusive: "VIP treatment — make them feel special.",
    casual: "Super casual, like a friend checking in."
  };

  const clientList = result.data.map(c => c.first_name).join(", ");
  const promoLine = promo ? `Include this offer: ${promo}` : "No specific promo — just a warm win-back.";

  // One batch call to Claude for ALL messages
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return { error: "ANTHROPIC_API_KEY not set" };

  try {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01"
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-20250514",
        max_tokens: 4096,
        messages: [{
          role: "user",
          content: `Draft personalized win-back SMS messages for these ${result.data.length} inactive waxing salon clients.

SALON: Brazilian Blueprint
TONE: ${toneGuide[tone || "warm"]}
PROMO: ${promoLine}
SERVICES: ${serviceNames}

CLIENTS:
${result.data.map((c, i) => `${i+1}. ${c.first_name} ${c.last_name || ""} — ${c.phone}`).join("\n")}

RULES FOR EACH MESSAGE:
- Start with their first name
- Under 160 characters (SMS limit)
- Include "Brazilian Blueprint" or "Blueprint"
- End with a call to action
- Max one emoji
- Sound human, not corporate
- Each message should be slightly different

Format your response EXACTLY like this for each client:
---
NAME: [full name]
PHONE: [phone]
SMS: [the message]
---

Output ALL ${result.data.length} messages now.`
        }]
      })
    });

    if (!res.ok) throw new Error(`Claude API ${res.status}`);
    const data = await res.json();
    const text = data.content?.find(b => b.type === "text")?.text || "";

    // Parse the drafts from Claude's response
    const drafts = [];
    const blocks = text.split("---").filter(b => b.trim());

    for (const block of blocks) {
      const nameMatch = block.match(/NAME:\s*(.+)/i);
      const phoneMatch = block.match(/PHONE:\s*(.+)/i);
      const smsMatch = block.match(/SMS:\s*(.+)/i);

      if (smsMatch) {
        drafts.push({
          name: nameMatch ? nameMatch[1].trim() : "Unknown",
          phone: phoneMatch ? phoneMatch[1].trim() : "",
          sms: smsMatch[1].trim(),
          chars: smsMatch[1].trim().length
        });
      }
    }

    return {
      count: drafts.length,
      tone: tone || "warm",
      promo: promo || "none",
      drafts: drafts.map(d => `${d.name} (${d.phone}):\n"${d.sms}" [${d.chars} chars]`),
      status: "DRAFTED — A2P pending. Ready to send when Twilio clears.",
      raw_drafts: drafts
    };
  } catch (err) {
    return { error: `Draft generation failed: ${err.message}` };
  }
}

async function getStats() {
  const [totalInactive, smsEligible, campaigns] = await Promise.all([
    supabaseGet("clients?select=id&is_inactive=eq.true"),
    supabaseGet("clients?select=id&is_inactive=eq.true&sms_opt_in=eq.true"),
    supabaseGet("reactivation_campaigns?select=*&order=created_at.desc&limit=5")
  ]);

  // Count active clients
  const active = await supabaseGet("clients?select=id&is_inactive=eq.false");

  return {
    overview: {
      total_clients: totalInactive.total + active.total,
      active: active.total,
      inactive: totalInactive.total,
      sms_eligible: smsEligible.total,
      reactivation_rate: active.total > 0
        ? `${((active.total / (active.total + totalInactive.total)) * 100).toFixed(1)}%`
        : "0%"
    },
    campaigns: campaigns.data.length > 0
      ? campaigns.data
      : "No campaigns yet. Use 'draft reactivation messages' to create one.",
    a2p_status: "PENDING — Twilio A2P registration blocks automated SMS. Manual outreach only for now."
  };
}

async function saveCampaign(promo) {
  // Save campaign metadata to Supabase
  try {
    const result = await supabasePost("reactivation_campaigns", {
      status: "draft",
      created_at: new Date().toISOString()
    });
    return {
      saved: true,
      campaign: result,
      note: "Campaign saved as draft. Will be activated when A2P clears."
    };
  } catch (err) {
    return {
      saved: false,
      note: `Could not save campaign: ${err.message}. The drafted messages are still in your Telegram history.`
    };
  }
}
