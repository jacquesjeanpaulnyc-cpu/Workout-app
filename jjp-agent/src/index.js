/**
 * JJP Agent — Personal AI Chief of Staff
 *
 * Entry point. Starts Telegram bot + briefing schedules + salon monitor.
 * Designed to run on Railway (cloud) — everything in one process.
 */

import "dotenv/config";
import { startBot, sendToOwner } from "./bot.js";
import { startBriefings } from "./briefings.js";
import { startSalonMonitor } from "./salon-monitor-cron.js";

console.log("╔══════════════════════════════════════╗");
console.log("║       JJP AGENT — INTEL ONLINE       ║");
console.log("╚══════════════════════════════════════╝");
console.log();

// Validate required env vars
const required = ["ANTHROPIC_API_KEY", "TELEGRAM_BOT_TOKEN"];
const missing = required.filter(k => !process.env[k]);

if (missing.length > 0) {
  console.error(`[FATAL] Missing required environment variables: ${missing.join(", ")}`);
  console.error("[FATAL] Copy .env.example to .env and fill in your credentials.");
  process.exit(1);
}

if (!process.env.TELEGRAM_OWNER_ID) {
  console.warn("[WARN] TELEGRAM_OWNER_ID not set. Bot will respond to ALL users.");
  console.warn("[WARN] Send /start to the bot to get your chat ID, then add it to .env.");
}

// Start Telegram bot (polling)
startBot();

// Start scheduled briefings (cron-based, runs in-process)
startBriefings(sendToOwner);

// Start salon revenue monitor (cron-based, runs in-process)
startSalonMonitor(sendToOwner);

// Keep process alive
process.on("SIGINT", () => {
  console.log("\n[AGENT] Shutting down...");
  process.exit(0);
});

process.on("uncaughtException", (err) => {
  console.error("[AGENT] Uncaught exception:", err);
});

process.on("unhandledRejection", (err) => {
  console.error("[AGENT] Unhandled rejection:", err);
});
