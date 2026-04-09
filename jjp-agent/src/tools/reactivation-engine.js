/**
 * Client Reactivation Engine v2 — Powered by Square Customer Data
 *
 * Uses Square's REAL customer segments (Lapsed, Overdue, 6+ weeks)
 * instead of Supabase pilot data. Generates personalized win-back SMS
 * and exports to CSV file sent via Telegram.
 *
 * Square Segments:
 *   MLMKB82F6VFK4.CHURN_RISK    — "Lapsed" (Square's algorithm)
 *   gv2:R0DEV7JGP13XS8T7BEDY0D4AR8 — "+ 6 week Clients" (custom)
 *   gv2:XCAPQ3ETED6SQ3YTSA0V38BMPC — "Over due clients" (custom)
 */

import { writeFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));

const SQUARE_SEGMENTS = {
  lapsed: "MLMKB82F6VFK4.CHURN_RISK",
  overdue: "gv2:XCAPQ3ETED6SQ3YTSA0V38BMPC",
  six_weeks: "gv2:R0DEV7JGP13XS8T7BEDY0D4AR8"
};

async function squareFetch(path, options = {}) {
  const token = process.env.SQUARE_ACCESS_TOKEN;
  const res = await fetch(`https://connect.squareup.com/v2${path}`, {
    ...options,
    headers: {
      "Square-Version": "2024-01-18",
      "Authorization": `Bearer ${token}`,
      "Content-Type": "application/json",
      ...options.headers
    }
  });
  if (!res.ok) throw new Error(`Square ${res.status}: ${await res.text()}`);
  return res.json();
}

export const definition = {
  name: "reactivation_engine",
  description: "Client reactivation system using REAL Square customer data. Finds lapsed/overdue clients from Square's own segments, drafts personalized win-back SMS, exports to CSV file. Actions: 'targets' (list lapsed clients from Square), 'draft' (generate SMS for lapsed clients), 'export' (save drafts as CSV sent to Telegram), 'stats' (segment overview).",
  input_schema: {
    type: "object",
    properties: {
      action: {
        type: "string",
        enum: ["targets", "draft", "export", "stats"],
        description: "targets = list lapsed clients, draft = generate win-back SMS, export = save as CSV, stats = segment overview"
      },
      segment: {
        type: "string",
        enum: ["lapsed", "overdue", "six_weeks", "all"],
        description: "Which Square segment to target. Defaults to 'lapsed'."
      },
      limit: {
        type: "number",
        description: "How many clients. Defaults to 10."
      },
      promo: {
        type: "string",
        description: "Optional promo (e.g. '$10 off', 'Wax Wednesday special')"
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

export async function execute({ action, segment, limit, promo, tone }) {
  if (!process.env.SQUARE_ACCESS_TOKEN) {
    return { error: "Square not configured." };
  }

  try {
    switch (action) {
      case "targets": return await getTargets(segment || "lapsed", limit || 10);
      case "draft": return await draftMessages(segment || "lapsed", limit || 10, promo, tone || "warm");
      case "export": return await exportCSV(segment || "lapsed", limit || 50, promo, tone || "warm");
      case "stats": return await getStats();
      default: return { error: `Unknown action: ${action}` };
    }
  } catch (err) {
    return { error: `Reactivation error: ${err.message}` };
  }
}

async function getCustomersBySegment(segmentKey, limit = 10) {
  const segmentId = SQUARE_SEGMENTS[segmentKey];
  if (!segmentId) return [];

  const data = await squareFetch("/customers/search", {
    method: "POST",
    body: JSON.stringify({
      query: {
        filter: {
          segment_ids: { any: [segmentId] }
        },
        sort: { field: "CREATED_AT", order: "DESC" }
      },
      limit: Math.min(limit, 100)
    })
  });

  return (data.customers || []).map(c => ({
    id: c.id,
    name: `${c.given_name || ""} ${c.family_name || ""}`.trim() || "Unknown",
    first_name: c.given_name || "",
    last_name: c.family_name || "",
    phone: c.phone_number || "",
    email: c.email_address || "",
    created: c.created_at?.split("T")[0],
    source: c.creation_source
  }));
}

async function getTargets(segment, limit) {
  const clients = await getCustomersBySegment(segment, limit);

  return {
    segment,
    segment_label: segment === "lapsed" ? "Lapsed (Square)" : segment === "overdue" ? "Overdue" : "6+ Weeks",
    count: clients.length,
    clients: clients.map(c => ({
      name: c.name,
      phone: c.phone || "no phone",
      email: c.email || "no email",
      source: c.source
    })),
    note: "These are REAL Square customers verified by Square's own tracking."
  };
}

async function draftMessages(segment, limit, promo, tone) {
  const clients = await getCustomersBySegment(segment, limit);
  const withPhone = clients.filter(c => c.phone);

  if (!withPhone.length) return { error: "No clients with phone numbers in this segment." };

  const toneGuide = {
    warm: "Warm, friendly, like texting a regular who you miss.",
    urgent: "Create urgency — limited time, spots filling up.",
    exclusive: "VIP treatment — make them feel special.",
    casual: "Super casual, like a friend checking in."
  };

  const promoLine = promo ? `Include this offer: ${promo}` : "No specific promo — just a warm win-back.";
  const apiKey = process.env.ANTHROPIC_API_KEY;

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
        content: `Draft personalized win-back SMS for ${withPhone.length} REAL lapsed waxing salon clients.

SALON: Brazilian Blueprint (Providence RI)
TONE: ${toneGuide[tone]}
PROMO: ${promoLine}

CLIENTS:
${withPhone.map((c, i) => `${i+1}. ${c.first_name} ${c.last_name} — ${c.phone}`).join("\n")}

RULES:
- Start with first name
- Under 160 chars (SMS limit)
- Include "Brazilian Blueprint" or "Blueprint"
- Call to action at the end
- Max one emoji
- Human, not corporate
- Each message slightly different

Format EXACTLY:
---
NAME: [full name]
PHONE: [phone]
SMS: [message]
---

Output ALL ${withPhone.length} messages.`
      }]
    })
  });

  if (!res.ok) throw new Error(`Claude API ${res.status}`);
  const data = await res.json();
  const text = data.content?.find(b => b.type === "text")?.text || "";

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

  // Save drafts to file for export
  const exportPath = join(__dirname, "..", "reactivation-drafts.json");
  writeFileSync(exportPath, JSON.stringify(drafts, null, 2), "utf-8");

  return {
    source: "Square (verified)",
    segment,
    count: drafts.length,
    tone,
    promo: promo || "none",
    drafts: drafts.map(d => `${d.name} (${d.phone}):\n"${d.sms}" [${d.chars} chars]`),
    status: "DRAFTED — saved to reactivation-drafts.json. Use 'export' to get CSV.",
    note: "Say 'export reactivation drafts' to get a CSV file in Telegram."
  };
}

async function exportCSV(segment, limit, promo, tone) {
  // Try to load existing drafts first
  let drafts;
  try {
    const { readFileSync } = await import("fs");
    const exportPath = join(__dirname, "..", "reactivation-drafts.json");
    drafts = JSON.parse(readFileSync(exportPath, "utf-8"));
  } catch {
    // Generate fresh if no saved drafts
    const result = await draftMessages(segment, limit, promo, tone);
    if (result.error) return result;
    drafts = result.raw_drafts || [];
  }

  if (!drafts.length) return { error: "No drafts to export. Run 'draft' first." };

  // Build CSV
  const header = "Name,Phone,SMS Message,Character Count";
  const rows = drafts.map(d =>
    `"${d.name}","${d.phone}","${d.sms.replace(/"/g, '""')}",${d.chars}`
  );
  const csv = [header, ...rows].join("\n");

  const csvPath = join(__dirname, "..", "reactivation-drafts.csv");
  writeFileSync(csvPath, csv, "utf-8");

  return {
    exported: true,
    file: csvPath,
    count: drafts.length,
    summary: `CSV exported with ${drafts.length} drafted messages. File ready to send.`,
    send_file: csvPath
  };
}

async function getStats() {
  const results = {};

  for (const [key, segmentId] of Object.entries(SQUARE_SEGMENTS)) {
    try {
      const data = await squareFetch("/customers/search", {
        method: "POST",
        body: JSON.stringify({
          query: { filter: { segment_ids: { any: [segmentId] } } },
          limit: 1
        })
      });
      // Square doesn't return total count easily, so we estimate
      results[key] = {
        segment_id: segmentId,
        sample: data.customers?.[0]
          ? `${data.customers[0].given_name} ${data.customers[0].family_name}`
          : "empty",
        has_customers: (data.customers || []).length > 0
      };
    } catch {
      results[key] = { error: "Failed to query" };
    }
  }

  return {
    source: "Square (verified customer data)",
    segments: {
      lapsed: { label: "Lapsed (Square algorithm)", ...results.lapsed },
      overdue: { label: "Overdue clients", ...results.overdue },
      six_weeks: { label: "6+ weeks no visit", ...results.six_weeks }
    },
    a2p_status: "PENDING — drafts ready, sending blocked until Twilio A2P clears."
  };
}
