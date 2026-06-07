/**
 * Briefings — Clean rebuild
 *
 * 5:30 AM Morning Brief:
 *   - Yesterday's revenue from Square
 *   - Today's booked appointments + staff
 *   - Flagged emails from 3 accounts
 *
 * 8:00 PM Evening Wind-down:
 *   - Tomorrow's bookings from Square
 *   - Top priority from memory
 *
 * 7:00 AM Sunday Weekly Intel:
 *   - Staff performance from Square
 */

import cron from "node-cron";
import { getEmailBriefingSection } from "./email-scanner.js";
import { getMorningSalonBrief } from "./salon-intel.js";
import { getTomorrowPreview } from "./salon-intel.js";
import { execute as staffExecute } from "./tools/staff-tracker.js";

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
  const time = now.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", timeZone: "America/New_York" });
  const deadline = new Date(2027, 6, 1);
  const daysToDeadline = Math.ceil((deadline - now) / (1000 * 60 * 60 * 24));
  return { today, time, daysToDeadline };
}

// ═══ MORNING BRIEF — 5:30 AM ═══

async function sendMorningBrief(sendToOwner) {
  console.log("[BRIEF] Sending morning brief...");
  const { today, daysToDeadline } = getDateContext();
  const memories = await getMemories();

  // Pull real data BEFORE calling Claude
  let salonSection = "";
  let emailSection = "";

  try {
    [salonSection, emailSection] = await Promise.all([
      getMorningSalonBrief(),
      getEmailBriefingSection()
    ]);
  } catch (err) {
    console.error("[BRIEF] Data pull failed:", err.message);
  }

  const system = `You are JJP Agent — Jay's AI chief of staff.
TODAY: ${today} | ${daysToDeadline} days to remote ops deadline (July 1, 2027)
RULE: NEVER invent numbers. Only reference the VERIFIED FACTS below.${memories}`;

  const factsSection = salonSection ? `\n\nVERIFIED SALON DATA:\n${salonSection}` : "";

  const text = await callClaude(system,
    `Write Jay's morning briefing. Short, sharp, under 400 chars. Include priorities from MEMORIES, ${daysToDeadline} days countdown, one proactive suggestion.${factsSection}\n\nDo NOT make up any numbers. Only use data from VERIFIED SALON DATA.`
  );

  let fullBrief = `☀️ MORNING BRIEF\n\n${text}`;
  if (salonSection) fullBrief += `\n\n${salonSection}`;
  if (emailSection) fullBrief += `\n\n${emailSection}`;

  await sendToOwner(fullBrief);
  console.log("[BRIEF] Morning brief sent.");
}

// ═══ EVENING WIND-DOWN — 8 PM ═══

async function sendEveningBrief(sendToOwner) {
  console.log("[BRIEF] Sending evening wind-down...");
  const { daysToDeadline } = getDateContext();
  const memories = await getMemories();

  // Pull tomorrow's REAL bookings
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
    `Evening wind-down for Jay. Under 300 chars. Include tomorrow's priority from MEMORIES, remind to log in Powerhouse app, ${daysToDeadline} days countdown.${tomorrowFacts}\n\nOnly state the booking count from VERIFIED data. Never guess.`
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

  // Pull staff performance
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

  const system = `You are JJP Agent — Jay's AI chief of staff.
${today} | ${daysToDeadline} days to remote ops deadline (July 1, 2027).${memories}`;

  const text = await callClaude(system,
    `Sunday weekly intel for Jay. Under 500 chars. Key focus for the week from MEMORIES, strategic observations, ${daysToDeadline} days countdown.`
  );

  let fullBrief = `📊 WEEKLY INTEL\n\n${text}`;
  if (staffSection) fullBrief += `\n\n${staffSection}`;

  await sendToOwner(fullBrief);
  console.log("[BRIEF] Weekly intel sent.");
}

// ═══ CRON SCHEDULE ═══

export function startBriefings(sendToOwner) {
  console.log("[BRIEF] Briefings scheduled:");

  // 5:30 AM ET daily
  cron.schedule("30 5 * * *", () => sendMorningBrief(sendToOwner).catch(e => console.error("[BRIEF] Morning failed:", e.message)), { timezone: "America/New_York" });
  console.log("  ☀️ 5:30 AM daily → Morning brief");

  // 8:00 PM ET daily
  cron.schedule("0 20 * * *", () => sendEveningBrief(sendToOwner).catch(e => console.error("[BRIEF] Evening failed:", e.message)), { timezone: "America/New_York" });
  console.log("  🌙 8:00 PM daily → Evening wind-down");

  // 7:00 AM ET Sunday
  cron.schedule("0 7 * * 0", () => sendWeeklyIntel(sendToOwner).catch(e => console.error("[BRIEF] Weekly failed:", e.message)), { timezone: "America/New_York" });
  console.log("  📊 7:00 AM Sunday → Weekly intel");
}
