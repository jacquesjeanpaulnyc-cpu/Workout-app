/**
 * Briefings — Scheduled via node-cron inside the agent process
 *
 * On cloud (Railway): cron jobs run inside the process
 * On Mac: can also use launchd plists as backup (setup-briefings.sh)
 */

import cron from "node-cron";
import { readFileSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";
import { getCalendarBriefing } from "./calendar-intel.js";
import { getEmailBriefing } from "./gmail-triage.js";
import { execute as staffExecute } from "./tools/staff-tracker.js";
import { getMorningSalonBrief, getMiddayPulse, getEODEnriched, getTomorrowPreview, getYesterdayRecap } from "./salon-intel.js";
import { getEmailIntelResults } from "./autonomous-monitors.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

async function sendBriefing(type, sendToOwner) {
  const envPath = join(__dirname, "..", ".env");
  const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY;
  const MEM0_KEY = process.env.MEM0_API_KEY;

  const now = new Date();
  const today = now.toLocaleDateString("en-US", {
    weekday: "long", year: "numeric", month: "long", day: "numeric",
    timeZone: "America/New_York"
  });
  const currentTime = now.toLocaleTimeString("en-US", {
    hour: "numeric", minute: "2-digit", timeZone: "America/New_York"
  });
  const august1 = new Date(2026, 7, 1);
  const daysToAugust = Math.ceil((august1 - now) / (1000 * 60 * 60 * 24));

  // Get memories
  let memories = "";
  if (MEM0_KEY) {
    try {
      const res = await fetch("https://api.mem0.ai/v1/memories/search/", {
        method: "POST",
        headers: {
          "Authorization": `Token ${MEM0_KEY}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          query: "priorities decisions blockers deadlines",
          user_id: "jay_jjp",
          limit: 8
        })
      });
      const data = await res.json();
      const items = (data.results || data || []);
      if (items.length) {
        memories = "\n\nMEMORIES:\n" + items.map(m => `- ${m.memory || m.content}`).join("\n");
      }
    } catch {}
  }

  const system = `You are JJP Agent — personal AI chief of staff for Jacques Jean Paul (Jay).
TODAY: ${today} | ${currentTime} ET | ${daysToAugust} days until August 1, 2026
CONTEXT: WaxOS (pilot live, A2P pending), Brazilian Blueprint (salon, staff: Selena/Dallas/Anyssa retiring Aug), Ecuador relocation by Aug 2026, Blueprint Collective launching Aug 15.${memories}

🚨 CRITICAL RULE: NEVER invent numbers, counts, names, or data. If the prompt doesn't explicitly give you a number, do NOT state one. Use general language like "some bookings" or ask Jay to check. NEVER make up "10 bookings" or "$500 revenue" or any specific figure. Only reference numbers that appear in the FACTS section below.`;

  // Pre-pull REAL data for data-driven sections BEFORE calling Claude
  let facts = "";

  if (type === "evening") {
    try {
      const tomorrow = await getTomorrowPreview();
      if (tomorrow) {
        const bookedCount = tomorrow.booked || 0;
        const staff = tomorrow.staffWorking?.length > 0 ? tomorrow.staffWorking.join(", ") : "none scheduled";
        facts = `\n\n═══ VERIFIED FACTS (use these EXACT numbers — do not change) ═══
Tomorrow: ${bookedCount} bookings confirmed
Staff working tomorrow: ${staff}`;
      }
    } catch (err) {
      console.error("[BRIEFING] Tomorrow preview failed:", err.message);
    }
  }

  if (type === "morning") {
    try {
      const [yesterday, tomorrow] = await Promise.all([getYesterdayRecap(), getTomorrowPreview()]);
      const parts = [];
      if (yesterday) parts.push(`Yesterday: ${yesterday.revenue} (${yesterday.orders} orders)`);
      if (tomorrow) parts.push(`Today: ${tomorrow.booked || 0} bookings confirmed`);
      if (parts.length > 0) {
        facts = `\n\n═══ VERIFIED FACTS (use these EXACT numbers — do not change) ═══\n${parts.join("\n")}`;
      }
    } catch {}
  }

  const prompts = {
    morning: {
      emoji: "☀️", label: "MORNING BRIEF",
      prompt: `Morning briefing for Jay. Date: ${today}. ${daysToAugust} days to August. Include top priorities from MEMORIES, critical deadlines, one proactive suggestion, motivational closer. Under 600 chars.${facts}\n\nRULE: Only state numbers that appear in VERIFIED FACTS above. Do not invent booking counts or revenue figures.`
    },
    evening: {
      emoji: "🌙", label: "EVENING WIND-DOWN",
      prompt: `Evening wind-down for Jay. Reflection prompt, tomorrow's priority from MEMORIES, ${daysToAugust} days countdown, remind to log in Powerhouse app. Under 400 chars.${facts}\n\nRULE: Only state numbers that appear in VERIFIED FACTS above. If a number isn't there, do NOT make one up. Say "bookings confirmed" generically if no count is provided.`
    },
    weekly: {
      emoji: "📊", label: "WEEKLY INTEL — SUNDAY",
      prompt: `Sunday weekly intel for Jay. Strategic week review, ${daysToAugust} days to August, top 3 focus areas from MEMORIES, status checks (A2P, staffing, Ecuador), one strategic question. Under 700 chars.${facts}\n\nRULE: Only state numbers that appear in VERIFIED FACTS above. Never invent figures.`
    }
  };

  const config = prompts[type];

  // For morning briefing, pull calendar and email data
  let calendarSection = "";
  let emailSection = "";
  let staffSection = "";

  let salonSection = "";

  if (type === "morning") {
    try {
      [calendarSection, salonSection] = await Promise.all([
        getCalendarBriefing(),
        getMorningSalonBrief()
      ]);

      // Use pre-scanned email results from Monitor 3 (ran at 5:25 AM)
      const emailIntel = getEmailIntelResults();
      if (emailIntel && emailIntel.length > 0) {
        const lines = [`📬 ${emailIntel.length} flagged email(s):`];
        emailIntel.forEach((e, i) => {
          const flag = e.reason === "urgent" ? "🔴" : e.reason === "lead" ? "🟢" : "🔵";
          lines.push(`  ${flag} ${e.from.split("<")[0].trim()} — ${e.subject}`);
        });
        emailSection = lines.join("\n");
      }
      // If no flagged emails, emailSection stays empty — no section shown
    } catch (err) {
      console.error("[BRIEFING] Morning data pull failed:", err.message);
    }
  }

  // For weekly briefing, pull staff performance
  if (type === "weekly") {
    try {
      const staffData = await staffExecute({ action: "overview", days: 7 });
      if (staffData && staffData.staff) {
        const lines = [`👥 Staff Performance (7 days):`];
        lines.push(`Total revenue: ${staffData.total_revenue} | ${staffData.total_orders} orders`);
        for (const s of staffData.staff) {
          lines.push(`  • ${s.name}: ${s.bookings} bookings (${s.share}) | ${s.est_revenue} rev | ${s.cancelled} cancelled | ${s.no_shows} no-shows`);
        }
        if (staffData.insight) lines.push(staffData.insight);
        staffSection = lines.join("\n");
      }
    } catch (err) {
      console.error("[BRIEFING] Staff pull failed:", err.message);
    }
  }

  try {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": ANTHROPIC_KEY,
        "anthropic-version": "2023-06-01"
      },
      body: JSON.stringify({
        model: "claude-opus-4-20250514",
        max_tokens: 1024,
        system,
        messages: [{ role: "user", content: config.prompt }]
      })
    });

    if (!res.ok) throw new Error(`API ${res.status}`);
    const data = await res.json();
    const text = data.content?.find(b => b.type === "text")?.text || "Briefing failed.";

    // Assemble full briefing with calendar + email sections
    let fullBriefing = `${config.emoji} ${config.label}\n\n${text}`;
    if (salonSection) fullBriefing += `\n\n${salonSection}`;
    if (calendarSection) fullBriefing += `\n\n${calendarSection}`;
    if (emailSection) fullBriefing += `\n\n${emailSection}`;
    if (staffSection) fullBriefing += `\n\n${staffSection}`;

    await sendToOwner(fullBriefing);
    console.log(`[BRIEFING] ${type} sent.`);
  } catch (err) {
    console.error(`[BRIEFING] ${type} failed:`, err.message);
    try {
      await sendToOwner(`⚠️ ${config.label} failed: ${err.message}`);
    } catch {}
  }
}

export function startBriefings(sendToOwner) {
  console.log("[BRIEFINGS] Scheduling briefings via cron...");

  // 5:30 AM ET daily
  cron.schedule("30 5 * * *", () => sendBriefing("morning", sendToOwner), { timezone: "America/New_York" });

  // 12:00 PM ET midday pulse (salon days only: Mon,Tue,Wed,Fri,Sat)
  cron.schedule("0 12 * * 1,2,3,5,6", async () => {
    console.log("[BRIEFING] Sending midday pulse...");
    try {
      const pulse = await getMiddayPulse();
      if (pulse) await sendToOwner(pulse);
      console.log("[BRIEFING] Midday pulse sent.");
    } catch (err) {
      console.error("[BRIEFING] Midday pulse failed:", err.message);
    }
  }, { timezone: "America/New_York" });

  // 8:00 PM ET daily
  cron.schedule("0 20 * * *", () => sendBriefing("evening", sendToOwner), { timezone: "America/New_York" });

  // 7:00 AM ET Sunday
  cron.schedule("0 7 * * 0", () => sendBriefing("weekly", sendToOwner), { timezone: "America/New_York" });

  console.log("[BRIEFINGS] All briefings scheduled:");
  console.log("  - 5:30 AM ET daily → Morning brief (calendar + email + salon)");
  console.log("  - 12:00 PM ET salon days → Midday pulse");
  console.log("  - 8:00 PM ET daily → Evening wind-down");
  console.log("  - 7:00 AM ET Sunday → Weekly intel (+ staff performance)");
}
