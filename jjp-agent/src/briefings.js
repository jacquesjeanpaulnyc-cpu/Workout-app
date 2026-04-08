/**
 * Daily Briefings — Scheduled pushes to Telegram
 *
 * Schedule (Eastern Time):
 * - 5:30 AM daily — Morning brief
 * - 8:00 PM daily — Evening wind-down
 * - 7:00 AM Sunday — Weekly intel
 */

import cron from "node-cron";
import { generateBriefing } from "./brain.js";
import { sendToOwner } from "./bot.js";

export function startBriefings() {
  console.log("[BRIEFINGS] Scheduling daily briefings (America/New_York)...");

  // 5:30 AM daily — Morning brief
  cron.schedule("30 5 * * *", async () => {
    console.log("[BRIEFING] Sending morning brief...");
    try {
      const briefing = await generateBriefing("morning");
      await sendToOwner(`☀️ MORNING BRIEF\n\n${briefing}`);
      console.log("[BRIEFING] Morning brief sent.");
    } catch (err) {
      console.error("[BRIEFING] Morning brief failed:", err.message);
    }
  }, { timezone: "America/New_York" });

  // 8:00 PM daily — Evening wind-down
  cron.schedule("0 20 * * *", async () => {
    console.log("[BRIEFING] Sending evening wind-down...");
    try {
      const briefing = await generateBriefing("evening");
      await sendToOwner(`🌙 EVENING WIND-DOWN\n\n${briefing}`);
      console.log("[BRIEFING] Evening wind-down sent.");
    } catch (err) {
      console.error("[BRIEFING] Evening wind-down failed:", err.message);
    }
  }, { timezone: "America/New_York" });

  // 7:00 AM Sunday — Weekly intel
  cron.schedule("0 7 * * 0", async () => {
    console.log("[BRIEFING] Sending weekly intel...");
    try {
      const briefing = await generateBriefing("weekly");
      await sendToOwner(`📊 WEEKLY INTEL — SUNDAY\n\n${briefing}`);
      console.log("[BRIEFING] Weekly intel sent.");
    } catch (err) {
      console.error("[BRIEFING] Weekly intel failed:", err.message);
    }
  }, { timezone: "America/New_York" });

  console.log("[BRIEFINGS] All briefings scheduled:");
  console.log("  - 5:30 AM ET daily → Morning brief");
  console.log("  - 8:00 PM ET daily → Evening wind-down");
  console.log("  - 7:00 AM ET Sunday → Weekly intel");
}
