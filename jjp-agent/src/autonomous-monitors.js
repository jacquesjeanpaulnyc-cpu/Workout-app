/**
 * Autonomous Monitors — JJP Agent comes to you. You never go to it.
 *
 * 8 independent monitors run on cron schedules:
 *   1. Square Pattern Intelligence — Sunday 6 PM
 *   2. WaxOS Pilot Health — Every 12h
 *   3. Email Intelligence — 5:25 AM daily (feeds into morning brief)
 *   4. Financial Trend Watcher — Monday 6 AM
 *   5. Relocation Intelligence — Wednesday 7 AM
 *   6. Decision Tracker — Monday 6:15 AM
 *   7. Contractor & Lease Tracker — 1st of month + countdowns
 *   8. Weekly Learning Curator — Saturday 8 AM (AI/SaaS/build content)
 *
 * RULE: Push ONLY when threshold is crossed. Silence = everything is fine.
 */

import cron from "node-cron";
import { fetch as undiciFetch, ProxyAgent } from "undici";
import { MemoryClient } from "mem0ai";
import { ImapFlow } from "imapflow";
import { simpleParser } from "mailparser";
import { execute as webSearchExec } from "./tools/web-search.js";

// autonomous-monitors.js is at src/, web-search at src/tools/ — path is correct

const proxyUrl = process.env.HTTPS_PROXY || process.env.https_proxy;
const dispatcher = proxyUrl ? new (await import("undici")).ProxyAgent(proxyUrl) : undefined;

// ── Shared utilities ──

async function squareFetch(path, options = {}) {
  const token = process.env.SQUARE_ACCESS_TOKEN;
  if (!token) return null;
  const res = await fetch(`https://connect.squareup.com/v2${path}`, {
    ...options,
    headers: {
      "Square-Version": "2024-01-18",
      "Authorization": `Bearer ${token}`,
      "Content-Type": "application/json"
    }
  });
  if (!res.ok) return null;
  return res.json();
}

async function getOrdersForDate(dateStr) {
  const data = await squareFetch("/orders/search", {
    method: "POST",
    body: JSON.stringify({
      location_ids: [process.env.SQUARE_LOCATION_ID],
      query: {
        filter: {
          date_time_filter: { created_at: { start_at: `${dateStr}T00:00:00-04:00`, end_at: `${dateStr}T23:59:59-04:00` } },
          state_filter: { states: ["COMPLETED"] }
        }
      }
    })
  });
  return data?.orders || [];
}

async function getBookingsForRange(startDate, endDate) {
  const startUTC = new Date(`${startDate}T00:00:00-04:00`).toISOString();
  const endUTC = new Date(`${endDate}T23:59:59-04:00`).toISOString();
  const data = await squareFetch(
    `/bookings?location_id=${process.env.SQUARE_LOCATION_ID}&limit=100&start_at_min=${startUTC}&start_at_max=${endUTC}`
  );
  return data?.bookings || [];
}

function dateStr(offset = 0) {
  const d = new Date();
  d.setDate(d.getDate() + offset);
  return d.toLocaleDateString("en-CA", { timeZone: "America/New_York" });
}

function weekRange(weeksBack = 0) {
  const now = new Date();
  const end = new Date(now); end.setDate(end.getDate() - (weeksBack * 7));
  const start = new Date(end); start.setDate(start.getDate() - 6);
  return { start: start.toISOString().split("T")[0], end: end.toISOString().split("T")[0] };
}

async function weekRevenue(weeksBack = 0) {
  const range = weekRange(weeksBack);
  let total = 0, count = 0;
  for (let i = 0; i < 7; i++) {
    const d = new Date(range.start); d.setDate(d.getDate() + i);
    const orders = await getOrdersForDate(d.toISOString().split("T")[0]);
    total += orders.reduce((s, o) => s + (o.total_money?.amount || 0), 0);
    count += orders.length;
  }
  return { cents: total, dollars: (total / 100).toFixed(2), orders: count };
}

async function claudeInsight(prompt) {
  try {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "content-type": "application/json", "x-api-key": process.env.ANTHROPIC_API_KEY, "anthropic-version": "2023-06-01" },
      body: JSON.stringify({ model: "claude-sonnet-4-20250514", max_tokens: 300, messages: [{ role: "user", content: prompt }] })
    });
    if (!res.ok) return null;
    const data = await res.json();
    return data.content?.find(b => b.type === "text")?.text || null;
  } catch { return null; }
}

let mem0 = null;
function getMem0() {
  if (mem0) return mem0;
  if (!process.env.MEM0_API_KEY) return null;
  mem0 = new MemoryClient({ apiKey: process.env.MEM0_API_KEY });
  return mem0;
}

async function saveMem0(content) {
  const m = getMem0();
  if (!m) return;
  try { await m.add([{ role: "user", content }], { user_id: "jay_jjp" }); } catch {}
}

async function searchMem0(query, limit = 5) {
  const m = getMem0();
  if (!m) return [];
  try {
    const r = await m.search(query, { user_id: "jay_jjp", limit });
    return r.results || r || [];
  } catch { return []; }
}

// ══════════════════════════════════════
// MONITOR 1 — SQUARE PATTERN INTELLIGENCE
// Sunday 6 PM
// ══════════════════════════════════════

async function squarePatternIntel(sendToOwner) {
  console.log("[MONITOR-1] Running Square pattern intelligence...");
  try {
    const dayNames = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
    const weeklyByDay = {};

    // Analyze last 4 weeks
    for (let w = 0; w < 4; w++) {
      for (let d = 0; d < 7; d++) {
        const date = new Date();
        date.setDate(date.getDate() - (w * 7 + d));
        const ds = date.toISOString().split("T")[0];
        const dayName = dayNames[date.getDay()];
        if (!weeklyByDay[dayName]) weeklyByDay[dayName] = [];
        const orders = await getOrdersForDate(ds);
        const rev = orders.reduce((s, o) => s + (o.total_money?.amount || 0), 0);
        weeklyByDay[dayName].push({ date: ds, revenue: rev, orders: orders.length });
      }
    }

    // Find consistently weak days (low revenue 3+ weeks)
    const weakDays = [];
    for (const [day, weeks] of Object.entries(weeklyByDay)) {
      const lowWeeks = weeks.filter(w => w.revenue < 20000 && w.orders > 0).length;
      if (lowWeeks >= 3) weakDays.push(day);
    }

    // Service trends
    const thisWeek = weekRange(0);
    const lastWeek = weekRange(1);
    const services = { this: {}, last: {} };

    for (let i = 0; i < 7; i++) {
      for (const [label, range] of [["this", thisWeek], ["last", lastWeek]]) {
        const d = new Date(range.start); d.setDate(d.getDate() + i);
        const orders = await getOrdersForDate(d.toISOString().split("T")[0]);
        for (const o of orders) {
          for (const item of (o.line_items || [])) {
            const name = item.name || "Other";
            services[label][name] = (services[label][name] || 0) + 1;
          }
        }
      }
    }

    // No-show patterns
    const bookings = await getBookingsForRange(weekRange(0).start, weekRange(0).end);
    const noShows = bookings.filter(b => b.status === "NO_SHOW");

    // Generate insight
    const prompt = `Analyze this salon data and give ONE specific insight and ONE action item. Under 200 chars total.

Weak days (low revenue 3+ weeks): ${weakDays.length > 0 ? weakDays.join(", ") : "none"}
No-shows this week: ${noShows.length}
Service trends: ${JSON.stringify(services.this).slice(0, 200)}
Last week services: ${JSON.stringify(services.last).slice(0, 200)}

Be specific. If nothing actionable, say "No action needed."`;

    const insight = await claudeInsight(prompt);

    if (insight && !insight.toLowerCase().includes("no action needed")) {
      await sendToOwner(`💈 WEEKLY PATTERN INTEL\n\n${insight}`);
      await saveMem0(`Weekly salon pattern: ${insight}`);
      console.log("[MONITOR-1] Insight pushed.");
    } else {
      console.log("[MONITOR-1] Nothing actionable. Silent.");
    }
  } catch (err) {
    console.error("[MONITOR-1] Error:", err.message);
  }
}

// ══════════════════════════════════════
// MONITOR 2 — WAXOS PILOT HEALTH
// Every 12 hours
// ══════════════════════════════════════

async function waxosPilotHealth(sendToOwner) {
  console.log("[MONITOR-2] Checking WaxOS pilot health...");
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_KEY) return;

  try {
    const url = process.env.SUPABASE_URL;
    const key = process.env.SUPABASE_SERVICE_KEY;

    const headers = { apikey: key, Authorization: `Bearer ${key}`, "Content-Type": "application/json" };

    // Check specialists
    const specRes = await fetch(`${url}/rest/v1/specialists?select=id,full_name,updated_at`, { headers });
    const specialists = await specRes.json();

    const alerts = [];

    for (const spec of specialists) {
      const lastActive = new Date(spec.updated_at);
      const hoursAgo = (Date.now() - lastActive) / (1000 * 60 * 60);
      if (hoursAgo > 72) {
        alerts.push(`${spec.full_name} inactive for ${Math.round(hoursAgo)}h`);
      }
    }

    // Check recent appointments
    const apptRes = await fetch(`${url}/rest/v1/Appointements?select=id,created_at&order=created_at.desc&limit=1`, { headers });
    const recentAppts = await apptRes.json();

    if (recentAppts.length > 0) {
      const lastAppt = new Date(recentAppts[0].created_at);
      const hoursAgo = (Date.now() - lastAppt) / (1000 * 60 * 60);
      if (hoursAgo > 48) {
        alerts.push(`No new appointments in ${Math.round(hoursAgo)}h`);
      }
    }

    if (alerts.length > 0) {
      await sendToOwner(`⚙️ WAXOS PILOT ALERT\n\n${alerts.join("\n")}\n\nPilot may need attention.`);
      console.log("[MONITOR-2] Alerts pushed:", alerts.length);
    } else {
      console.log("[MONITOR-2] Pilot healthy. Silent.");
    }
  } catch (err) {
    console.error("[MONITOR-2] Error:", err.message);
  }
}

// ══════════════════════════════════════
// MONITOR 3 — EMAIL INTELLIGENCE
// 5:25 AM daily — results stored for morning brief
// ══════════════════════════════════════

let emailIntelResults = null;

async function emailIntelligence() {
  console.log("[MONITOR-3] Scanning email...");
  if (!process.env.GMAIL_APP_PASSWORD) { emailIntelResults = null; return; }

  try {
    const client = new ImapFlow({
      host: "imap.gmail.com", port: 993, secure: true,
      auth: { user: "jacquesjeanpaul.nyc@gmail.com", pass: process.env.GMAIL_APP_PASSWORD.replace(/\s/g, "") },
      logger: false
    });

    await client.connect();
    const lock = await client.getMailboxLock("INBOX");

    const since = new Date(); since.setHours(since.getHours() - 24);
    const flagged = [];
    const priorityNames = ["selena", "dallas", "anyssa", "marlaina", "twilio", "square", "supabase"];
    const urgentWords = ["urgent", "problem", "issue", "complaint", "cancel", "refund"];

    try {
      for await (const msg of client.fetch({ since }, { envelope: true, source: true }, { uid: true })) {
        if (flagged.length >= 10) break;
        try {
          const parsed = await simpleParser(msg.source);
          const from = (parsed.from?.text || "").toLowerCase();
          const subject = (parsed.subject || "").toLowerCase();
          const body = (parsed.text || "").slice(0, 500).toLowerCase();

          const isPriority = priorityNames.some(n => from.includes(n));
          const isUrgent = urgentWords.some(w => subject.includes(w) || body.includes(w));
          const isLead = body.includes("waxos") || body.includes("wax os") || subject.includes("inquiry") || subject.includes("interested");

          if (isPriority || isUrgent || isLead) {
            flagged.push({
              from: (parsed.from?.text || "Unknown").slice(0, 60),
              subject: (parsed.subject || "No subject").slice(0, 80),
              reason: isPriority ? "staff/partner" : isUrgent ? "urgent" : "lead",
              snippet: (parsed.text || "").slice(0, 100).replace(/\n/g, " ")
            });
          }
        } catch {}
      }
    } finally { lock.release(); }
    await client.logout();

    emailIntelResults = flagged.length > 0 ? flagged : null;
    console.log(`[MONITOR-3] ${flagged.length} flagged emails.`);
  } catch (err) {
    console.error("[MONITOR-3] Error:", err.message);
    emailIntelResults = null;
  }
}

export function getEmailIntelResults() { return emailIntelResults; }

// ══════════════════════════════════════
// MONITOR 4 — FINANCIAL TREND WATCHER
// Monday 6 AM
// ══════════════════════════════════════

async function financialTrendWatcher(sendToOwner) {
  console.log("[MONITOR-4] Analyzing financial trends...");
  try {
    const thisWeekRev = await weekRevenue(0);
    const lastWeekRev = await weekRevenue(1);

    if (lastWeekRev.cents === 0) { console.log("[MONITOR-4] No last week data. Skip."); return; }

    const pctChange = ((thisWeekRev.cents - lastWeekRev.cents) / lastWeekRev.cents * 100).toFixed(1);
    const diff = thisWeekRev.cents - lastWeekRev.cents;
    const diffStr = diff >= 0 ? `+$${(diff / 100).toFixed(2)}` : `-$${(Math.abs(diff) / 100).toFixed(2)}`;

    if (parseFloat(pctChange) < -15) {
      await sendToOwner(`💰 REVENUE DROP ALERT\n\nLast week: $${thisWeekRev.dollars} (${thisWeekRev.orders} orders)\nPrior week: $${lastWeekRev.dollars}\nChange: ${diffStr} (${pctChange}%)\n\n⚠️ Revenue dropped more than 15%. Investigate staffing, no-shows, or seasonal dip.`);
      await saveMem0(`Revenue alert: ${pctChange}% drop week over week. $${thisWeekRev.dollars} vs $${lastWeekRev.dollars}`);
    } else if (parseFloat(pctChange) > 20) {
      await sendToOwner(`💰 REVENUE SURGE\n\nLast week: $${thisWeekRev.dollars} (${thisWeekRev.orders} orders)\nPrior week: $${lastWeekRev.dollars}\nChange: ${diffStr} (${pctChange}%)\n\n🔥 Up more than 20%. What drove this? Double down.`);
      await saveMem0(`Revenue surge: ${pctChange}% up. $${thisWeekRev.dollars} vs $${lastWeekRev.dollars}`);
    } else {
      console.log(`[MONITOR-4] Revenue change ${pctChange}% — within normal range. Silent.`);
    }
  } catch (err) {
    console.error("[MONITOR-4] Error:", err.message);
  }
}

// ══════════════════════════════════════
// MONITOR 5 — RELOCATION INTELLIGENCE
// Wednesday 7 AM
// ══════════════════════════════════════

async function relocationIntel(sendToOwner) {
  console.log("[MONITOR-5] Checking relocation intel...");
  try {
    const queries = [
      "Ecuador residency visa 2026 updates",
      "I-130 I-485 processing times 2026"
    ];

    const results = [];
    for (const q of queries) {
      const encoded = encodeURIComponent(q);
      const res = await fetch(`https://api.duckduckgo.com/?q=${encoded}&format=json&no_html=1`);
      const data = await res.json();
      if (data.Abstract) results.push(data.Abstract.slice(0, 200));
    }

    if (results.length === 0) { console.log("[MONITOR-5] No new intel. Silent."); return; }

    // Check if anything is actually new
    const previousIntel = await searchMem0("relocation Ecuador visa immigration", 3);
    const previousTexts = previousIntel.map(m => (m.memory || "").toLowerCase()).join(" ");

    const insight = await claudeInsight(
      `Compare this new search data against previous known intel and tell me ONLY if something genuinely changed or is new. If nothing new, say "No updates."

New search results: ${results.join(" | ")}
Previous known: ${previousTexts.slice(0, 300)}

If there IS something new, summarize in under 150 chars.`
    );

    if (insight && !insight.toLowerCase().includes("no update")) {
      await sendToOwner(`✈️ RELOCATION INTEL\n\n${insight}\n\nReminder: consult immigration attorney before making any final decisions.`);
      await saveMem0(`Relocation update: ${insight}`);
    } else {
      console.log("[MONITOR-5] No new relocation updates. Silent.");
    }
  } catch (err) {
    console.error("[MONITOR-5] Error:", err.message);
  }
}

// ══════════════════════════════════════
// MONITOR 6 — DECISION TRACKER
// Monday 6:15 AM
// ══════════════════════════════════════

async function decisionTracker(sendToOwner) {
  console.log("[MONITOR-6] Checking open decisions...");
  try {
    const decisions = await searchMem0("open decision undecided thinking about", 10);
    const openDecisions = decisions.filter(m => {
      const text = (m.memory || m.content || "").toLowerCase();
      return text.includes("decide") || text.includes("decision") || text.includes("thinking about") || text.includes("on the fence");
    });

    if (openDecisions.length === 0) { console.log("[MONITOR-6] No open decisions. Silent."); return; }

    const lines = [`🧠 ${openDecisions.length} open decision(s):`];
    for (const d of openDecisions) {
      const text = d.memory || d.content || "";
      const created = d.created_at ? new Date(d.created_at) : null;
      const daysOld = created ? Math.round((Date.now() - created) / (1000 * 60 * 60 * 24)) : "?";
      lines.push(`  • ${text.slice(0, 80)} — ${daysOld} days`);
    }

    const oldest = openDecisions[openDecisions.length - 1];
    lines.push(`\nOldest decision is ${oldest ? "waiting" : "unknown"}. What's blocking you?`);

    await sendToOwner(lines.join("\n"));
  } catch (err) {
    console.error("[MONITOR-6] Error:", err.message);
  }
}

/**
 * Detect decision language in user messages (called from brain.js)
 */
export function detectDecisionLanguage(text) {
  const lower = text.toLowerCase();
  const triggers = ["i need to decide", "not sure whether", "thinking about", "haven't decided", "on the fence about", "can't decide"];
  return triggers.some(t => lower.includes(t));
}

// ══════════════════════════════════════
// MONITOR 7 — CONTRACTOR & LEASE TRACKER
// 1st of each month + countdown triggers
// ══════════════════════════════════════

async function contractorLeaseTracker(sendToOwner) {
  console.log("[MONITOR-7] Checking contracts and leases...");
  const now = new Date();
  const etNow = new Date(now.toLocaleString("en-US", { timeZone: "America/New_York" }));
  const dayOfMonth = etNow.getDate();
  const month = etNow.getMonth();
  const year = etNow.getFullYear();

  const alerts = [];

  // Marlaina room rent — 1st of each month
  if (dayOfMonth === 1) {
    alerts.push("📋 Marlaina room rent due today. Check Square for payment.");
  }

  // Dallas commission review — quarterly (Jan, Apr, Jul, Oct)
  if (dayOfMonth === 1 && [0, 3, 6, 9].includes(month)) {
    alerts.push("📋 Dallas quarterly commission review is due.");
  }

  // Salon lease end: mid-2027 (~July 2027)
  const leaseEnd = new Date(2027, 6, 1); // July 1, 2027
  const daysToLease = Math.ceil((leaseEnd - now) / (1000 * 60 * 60 * 24));
  if (daysToLease === 90 || daysToLease === 60 || daysToLease === 30) {
    alerts.push(`📋 SALON LEASE: ${daysToLease} days until lease ends (mid-2027). Start planning now.`);
  }

  // Blueprint Collective launch: August 15, 2026
  const launchDate = new Date(2026, 7, 15);
  const daysToLaunch = Math.ceil((launchDate - now) / (1000 * 60 * 60 * 24));

  // Weekly countdown after June 1, 2026
  const countdownStart = new Date(2026, 5, 1);
  if (now >= countdownStart && daysToLaunch > 0 && etNow.getDay() === 1) { // Monday
    alerts.push(`📋 Blueprint Collective launch in ${daysToLaunch} days (Aug 15). Stay on track.`);
  }

  if (alerts.length > 0) {
    await sendToOwner(`📋 CONTRACT ALERTS\n\n${alerts.join("\n\n")}`);
    console.log("[MONITOR-7] Alerts pushed:", alerts.length);
  } else {
    console.log("[MONITOR-7] No contract alerts. Silent.");
  }
}

// ══════════════════════════════════════
// MONITOR 8 — WEEKLY LEARNING CURATOR
// Saturday 8 AM — Real links to articles/videos for Jay's journey
// ══════════════════════════════════════

const LEARNING_QUERIES = [
  { category: "🤖 AI Agents", query: "AI agent tutorials 2026 Claude API build" },
  { category: "💰 Solo SaaS", query: "solo founder SaaS bootstrapping 2026 indie hackers" },
  { category: "📞 Twilio A2P", query: "Twilio A2P toll-free verification 2026 SMS automation" },
  { category: "💅 Beauty Tech", query: "beauty salon tech automation AI 2026" },
  { category: "🏗️ AI Automation", query: "AI workflow automation agents 2026 productivity" }
];

async function weeklyLearningCurator(sendToOwner) {
  console.log("[MONITOR-8] Running weekly learning curator...");

  try {
    const allResults = [];

    // Run all searches in parallel
    const searches = await Promise.all(
      LEARNING_QUERIES.map(async ({ category, query }) => {
        try {
          const result = await webSearchExec({ query, max_results: 5 });
          return { category, query, results: result.results || [] };
        } catch {
          return { category, query, results: [] };
        }
      })
    );

    // Collect top results across categories
    for (const search of searches) {
      if (!search.results.length) continue;
      // Take top 1-2 from each category
      allResults.push({
        category: search.category,
        items: search.results.slice(0, 2).filter(r => r.url && r.title)
      });
    }

    // Filter out categories with no results
    const filled = allResults.filter(c => c.items.length > 0);
    if (filled.length === 0) {
      console.log("[MONITOR-8] No results found. Silent.");
      return;
    }

    // Use Claude to pick the best and rank them
    const candidatesText = filled.map(c =>
      `${c.category}:\n${c.items.map(i => `- ${i.title} (${i.url})\n  ${i.snippet || ""}`).join("\n")}`
    ).join("\n\n");

    const pickerPrompt = `You are curating a weekly learning digest for Jay. He is building:
- WaxOS (AI SaaS for wax specialists on Claude API + Supabase + Twilio)
- Brazilian Blueprint (salon in Providence RI)
- Personal AI chief of staff (Telegram agent)
- Planning relocation to Ecuador by August 2026

From these search results, pick the TOP 5 most valuable items that match his journey.
Each pick must have a real URL. Output as JSON array:
[{"category":"...","title":"...","url":"...","why":"one sentence why this matters to Jay"}]

Candidates:
${candidatesText.slice(0, 4000)}

Output ONLY the JSON array.`;

    const insight = await claudeInsight(pickerPrompt);
    if (!insight) {
      console.log("[MONITOR-8] Claude curator failed. Silent.");
      return;
    }

    // Parse JSON from Claude's response
    let picks = [];
    try {
      const match = insight.match(/\[[\s\S]*\]/);
      if (match) picks = JSON.parse(match[0]);
    } catch {
      console.log("[MONITOR-8] Failed to parse picks. Silent.");
      return;
    }

    if (!picks.length) return;

    // Build message with real clickable links
    const lines = ["📚 WEEKLY LEARNING DIGEST", ""];
    picks.slice(0, 5).forEach((pick, i) => {
      lines.push(`${i + 1}. ${pick.category || "📖"} ${pick.title}`);
      lines.push(pick.url);
      if (pick.why) lines.push(`   └ ${pick.why}`);
      lines.push("");
    });
    lines.push("— JJP Agent curated for your week ahead.");

    await sendToOwner(lines.join("\n"));
    await saveMem0(`Weekly learning digest sent: ${picks.map(p => p.title).join(", ")}`);
    console.log(`[MONITOR-8] Pushed ${picks.length} links.`);
  } catch (err) {
    console.error("[MONITOR-8] Error:", err.message);
  }
}

// ══════════════════════════════════════
// MASTER SCHEDULER — Wire all monitors
// ══════════════════════════════════════

export function startAutonomousMonitors(sendToOwner) {
  console.log("[AUTONOMOUS] Starting 7 independent monitors...");

  // Monitor 1: Square Pattern Intelligence — Sunday 6 PM
  cron.schedule("0 18 * * 0", () => squarePatternIntel(sendToOwner), { timezone: "America/New_York" });

  // Monitor 2: WaxOS Pilot Health — Every 12 hours (6 AM, 6 PM)
  cron.schedule("0 6,18 * * *", () => waxosPilotHealth(sendToOwner), { timezone: "America/New_York" });

  // Monitor 3: Email Intelligence — 5:25 AM daily (feeds morning brief)
  cron.schedule("25 5 * * *", () => emailIntelligence(), { timezone: "America/New_York" });

  // Monitor 4: Financial Trend Watcher — Monday 6 AM
  cron.schedule("0 6 * * 1", () => financialTrendWatcher(sendToOwner), { timezone: "America/New_York" });

  // Monitor 5: Relocation Intelligence — Wednesday 7 AM
  cron.schedule("0 7 * * 3", () => relocationIntel(sendToOwner), { timezone: "America/New_York" });

  // Monitor 6: Decision Tracker — Monday 6:15 AM
  cron.schedule("15 6 * * 1", () => decisionTracker(sendToOwner), { timezone: "America/New_York" });

  // Monitor 7: Contractor & Lease Tracker — 1st of month + every Monday
  cron.schedule("0 7 1 * *", () => contractorLeaseTracker(sendToOwner), { timezone: "America/New_York" });
  cron.schedule("0 7 * * 1", () => contractorLeaseTracker(sendToOwner), { timezone: "America/New_York" });

  // Monitor 8: Weekly Learning Curator — Saturday 8 AM
  cron.schedule("0 8 * * 6", () => weeklyLearningCurator(sendToOwner), { timezone: "America/New_York" });

  console.log("[AUTONOMOUS] All monitors scheduled:");
  console.log("  1. 💈 Square Patterns — Sunday 6 PM");
  console.log("  2. ⚙️ WaxOS Pilot — 6 AM & 6 PM daily");
  console.log("  3. 📬 Email Intel — 5:25 AM daily");
  console.log("  4. 💰 Financial Trends — Monday 6 AM");
  console.log("  5. ✈️ Relocation Intel — Wednesday 7 AM");
  console.log("  6. 🧠 Decision Tracker — Monday 6:15 AM");
  console.log("  7. 📋 Contracts/Lease — 1st of month + Mondays");
  console.log("  8. 📚 Learning Curator — Saturday 8 AM");
}
