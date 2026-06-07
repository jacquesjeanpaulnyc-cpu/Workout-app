/**
 * Briefings — Clean rebuild
 *
 * OPEN DAYS (Mon/Wed/Fri/Sat):
 *   5:30 AM — Yesterday's revenue + today's bookings + flagged emails
 *   8:00 PM — Tomorrow's bookings + top priority
 *
 * CLOSED DAYS (Tue/Thu/Sun):
 *   5:30 AM — AI news, tools, articles + flagged emails
 *
 * Sunday 7:00 AM — Weekly intel + staff performance
 */

import cron from "node-cron";
import { getEmailBriefingSection } from "./email-scanner.js";
import { getMorningSalonBrief, getTomorrowPreview } from "./salon-intel.js";
import { execute as staffExecute } from "./tools/staff-tracker.js";
import { execute as webSearchExec } from "./tools/web-search.js";
import { isSalonDay, isClosedDay } from "./salon-schedule.js";

async function getMemories() {
  const MEM0_KEY = process.env.MEM0_API_KEY;
  if (!MEM0_KEY) return "";
  try {
    const res = await fetch("https://api.mem0.ai/v1/memories/search/", {
      method: "POST",
      headers: { "Authorization": `Token ${MEM0_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({ query: "priorities goals deadlines important", user_id: "jay_jjp", limit: 8 })
    });
    const data = await res.json();
    const items = (data.results || data || []);
    if (!items.length) return "";
    return "\n\nMEMORIES:\n" + items.map(m => `- ${m.memory || m.content}`).join("\n");
  } catch { return ""; }
}

async function callClaude(system, prompt) {
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "content-type": "application/json", "x-api-key": process.env.ANTHROPIC_API_KEY, "anthropic-version": "2023-06-01" },
    body: JSON.stringify({ model: "claude-sonnet-4-20250514", max_tokens: 800, system, messages: [{ role: "user", content: prompt }] })
  });
  if (!res.ok) throw new Error(`API ${res.status}`);
  const data = await res.json();
  return data.content?.find(b => b.type === "text")?.text || "Briefing failed.";
}

function getDateContext() {
  const now = new Date();
  const today = now.toLocaleDateString("en-US", { weekday: "long", year: "numeric", month: "long", day: "numeric", timeZone: "America/New_York" });
  const dayOfWeek = new Date(now.toLocaleString("en-US", { timeZone: "America/New_York" })).getDay();
  const deadline = new Date(2027, 6, 1);
  const daysToDeadline = Math.ceil((deadline - now) / (1000 * 60 * 60 * 24));
  return { today, dayOfWeek, daysToDeadline };
}

// ═══ AI NEWS & TOOLS — for closed days ═══

async function getAINewsSection() {
  const queries = [
    "AI agent tools news this week 2026",
    "Claude API Anthropic updates 2026",
    "AI automation SaaS tools new"
  ];

  const allResults = [];
  for (const q of queries) {
    try {
      const r = await webSearchExec({ query: q, max_results: 5 });
      if (r.results) allResults.push(...r.results.slice(0, 3));
    } catch {}
  }

  if (allResults.length === 0) return "";

  // Have Claude pick the best 3
  const apiKey = process.env.ANTHROPIC_API_KEY;
  try {
    const candidates = allResults.map(r => `- ${r.title}\n  ${r.url}\n  ${r.snippet || ""}`).join("\n");
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "content-type": "application/json", "x-api-key": apiKey, "anthropic-version": "2023-06-01" },
      body: JSON.stringify({
        model: "claude-sonnet-4-20250514", max_tokens: 500,
        messages: [{ role: "user", content: `Pick the 3 most useful AI/tech items for a solo founder building an AI SaaS (WaxOS) and running a salon. Output JSON array: [{"title":"...","url":"...","why":"one sentence"}]\n\nCandidates:\n${candidates.slice(0, 3000)}\n\nJSON only:` }]
      })
    });
    if (!res.ok) return "";
    const data = await res.json();
    const text = data.content?.find(b => b.type === "text")?.text || "";
    const match = text.match(/\[[\s\S]*\]/);
    if (!match) return "";

    const picks = JSON.parse(match[0]);
    const lines = ["🤖 AI & Tools for today:"];
    picks.slice(0, 3).forEach((p, i) => {
      lines.push(`${i + 1}. ${p.title}`);
      lines.push(`   ${p.url}`);
      if (p.why) lines.push(`   └ ${p.why}`);
    });
    return lines.join("\n");
  } catch { return ""; }
}

// ═══ MORNING BRIEF — 5:30 AM ═══

async function sendMorningBrief(sendToOwner) {
  console.log("[BRIEF] Sending morning brief...");
  const { today, dayOfWeek, daysToDeadline } = getDateContext();
  const memories = await getMemories();
  const isOpen = isSalonDay(dayOfWeek);

  const system = `You are JJP Agent — Jay's AI chief of staff.
TODAY: ${today} | ${daysToDeadline} days to remote ops deadline (July 1, 2027)
SALON: ${isOpen ? "OPEN today" : "CLOSED today (Tue/Thu/Sun)"}
RULE: NEVER invent numbers. Only reference VERIFIED FACTS below.${memories}`;

  let salonSection = "";
  let emailSection = "";
  let aiSection = "";

  if (isOpen) {
    // Open day — pull salon data
    try {
      [salonSection, emailSection] = await Promise.all([
        getMorningSalonBrief(),
        getEmailBriefingSection()
      ]);
    } catch (err) {
      console.error("[BRIEF] Data pull failed:", err.message);
    }

    const factsSection = salonSection ? `\n\nVERIFIED SALON DATA:\n${salonSection}` : "";
    const text = await callClaude(system,
      `Morning briefing for an OPEN salon day. Short, under 300 chars. Priorities from MEMORIES, ${daysToDeadline} days countdown.${factsSection}`
    );

    let fullBrief = `☀️ MORNING BRIEF\n\n${text}`;
    if (salonSection) fullBrief += `\n\n${salonSection}`;
    if (emailSection) fullBrief += `\n\n${emailSection}`;
    await sendToOwner(fullBrief);

  } else {
    // Closed day — AI news + tools + emails
    try {
      [aiSection, emailSection] = await Promise.all([
        getAINewsSection(),
        getEmailBriefingSection()
      ]);
    } catch (err) {
      console.error("[BRIEF] AI news pull failed:", err.message);
    }

    const text = await callClaude(system,
      `Morning briefing for a CLOSED salon day. Jay has time to learn and build. Short, under 300 chars. Suggest what to focus on today from MEMORIES. ${daysToDeadline} days countdown.`
    );

    let fullBrief = `☀️ MORNING BRIEF (salon closed today)\n\n${text}`;
    if (aiSection) fullBrief += `\n\n${aiSection}`;
    if (emailSection) fullBrief += `\n\n${emailSection}`;
    await sendToOwner(fullBrief);
  }

  console.log("[BRIEF] Morning brief sent.");
}

// ═══ EVENING WIND-DOWN — 8 PM ═══

async function sendEveningBrief(sendToOwner) {
  console.log("[BRIEF] Sending evening wind-down...");
  const { daysToDeadline } = getDateContext();
  const memories = await getMemories();

  let tomorrowFacts = "";
  try {
    const tomorrow = await getTomorrowPreview();
    if (tomorrow) {
      const count = tomorrow.booked || 0;
      const staff = tomorrow.staffWorking?.length > 0 ? tomorrow.staffWorking.join(", ") : "none listed";
      tomorrowFacts = `\nVERIFIED: Tomorrow has ${count} bookings confirmed. Staff: ${staff}.`;
    }
  } catch {}

  const system = `You are JJP Agent — Jay's AI chief of staff.
${daysToDeadline} days to remote ops deadline (July 1, 2027).
RULE: NEVER invent numbers. Only use VERIFIED data below.${memories}`;

  const text = await callClaude(system,
    `Evening wind-down. Under 250 chars. Tomorrow's priority from MEMORIES, remind to log in Powerhouse, ${daysToDeadline} days countdown.${tomorrowFacts}`
  );

  let fullBrief = `🌙 EVENING WIND-DOWN\n\n${text}`;
  if (tomorrowFacts) fullBrief += `\n${tomorrowFacts.replace("\nVERIFIED: ", "\n📅 ")}`;
  await sendToOwner(fullBrief);
  console.log("[BRIEF] Evening wind-down sent.");
}

// ═══ WEEKLY INTEL — Sunday 7 AM ═══

async function sendWeeklyIntel(sendToOwner) {
  console.log("[BRIEF] Sending weekly intel...");
  const { today, daysToDeadline } = getDateContext();
  const memories = await getMemories();

  let staffSection = "";
  try {
    const staffData = await staffExecute({ action: "overview", days: 7 });
    if (staffData?.staff) {
      const lines = ["👥 Staff Performance (7 days):"];
      lines.push(`Revenue: ${staffData.total_revenue} | ${staffData.total_orders} orders`);
      for (const s of staffData.staff) {
        lines.push(`  • ${s.name}: ${s.bookings} bookings (${s.share}) | ${s.est_revenue}`);
      }
      if (staffData.insight) lines.push(staffData.insight);
      staffSection = lines.join("\n");
    }
  } catch {}

  const text = await callClaude(
    `You are JJP Agent. ${today} | ${daysToDeadline} days to July 2027.${memories}`,
    `Sunday weekly intel. Under 400 chars. Key focus from MEMORIES, strategic note, ${daysToDeadline} days countdown.`
  );

  let fullBrief = `📊 WEEKLY INTEL\n\n${text}`;
  if (staffSection) fullBrief += `\n\n${staffSection}`;
  await sendToOwner(fullBrief);
  console.log("[BRIEF] Weekly intel sent.");
}

// ═══ CRON SCHEDULE ═══

export function startBriefings(sendToOwner) {
  console.log("[BRIEF] Briefings scheduled:");

  cron.schedule("30 5 * * *", () => sendMorningBrief(sendToOwner).catch(e => console.error("[BRIEF] Morning failed:", e.message)), { timezone: "America/New_York" });
  console.log("  ☀️ 5:30 AM daily → Morning brief (salon data on open days, AI news on closed days)");

  cron.schedule("0 20 * * *", () => sendEveningBrief(sendToOwner).catch(e => console.error("[BRIEF] Evening failed:", e.message)), { timezone: "America/New_York" });
  console.log("  🌙 8:00 PM daily → Evening wind-down");

  cron.schedule("0 7 * * 0", () => sendWeeklyIntel(sendToOwner).catch(e => console.error("[BRIEF] Weekly failed:", e.message)), { timezone: "America/New_York" });
  console.log("  📊 7:00 AM Sunday → Weekly intel");
}
