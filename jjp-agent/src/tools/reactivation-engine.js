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
  // Get targets
  const result = await supabaseGet(
    `clients?select=id,first_name,last_name,phone,created_at&is_inactive=eq.true&sms_opt_in=eq.true&order=created_at.desc&limit=${limit}`
  );

  // Get service catalog for personalization
  const services = await supabaseGet(
    "service_templates?select=name,default_price,category&is_active=eq.true&limit=10"
  );

  const serviceNames = services.data.map(s => `${s.name} ($${s.default_price})`).join(", ");

  const toneGuide = {
    warm: "Warm, friendly, like texting a regular who you miss. Personal touch.",
    urgent: "Create urgency — limited time, spots filling up. Direct but not pushy.",
    exclusive: "VIP treatment — make them feel special, insider access, loyalty reward.",
    casual: "Super casual, like a friend checking in. Light, easy, no pressure."
  };

  // Use Claude to draft personalized messages
  const drafts = [];

  for (const client of result.data) {
    const firstName = client.first_name;
    const promoLine = promo ? `\nInclude this offer: ${promo}` : "";

    const prompt = `Draft a SHORT win-back SMS (under 160 chars) for a waxing salon client.

Client name: ${firstName}
Salon: Brazilian Blueprint
Tone: ${toneGuide[tone]}${promoLine}
Services: ${serviceNames}

Rules:
- Start with their first name
- Under 160 characters (SMS limit)
- Include salon name
- End with a call to action (book now, text back, etc)
- No emojis except maybe one
- Sound human, not corporate

Output ONLY the SMS text, nothing else.`;

    drafts.push({
      client_id: client.id,
      name: `${firstName} ${client.last_name || ""}`.trim(),
      phone: client.phone,
      prompt_tone: tone,
      prompt_promo: promo || null,
      // Claude will fill this in when processing the tool result
      draft_prompt: prompt
    });
  }

  return {
    count: drafts.length,
    tone,
    promo: promo || "none",
    drafts,
    status: "QUEUED — A2P pending. Messages ready to send when Twilio clears.",
    instruction: "Claude: For each draft, generate the SMS using the draft_prompt. Present all messages together."
  };
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
