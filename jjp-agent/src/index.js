/**
 * JJP Agent — Clean Rebuild
 *
 * Active services:
 *   - Telegram bot (text + voice)
 *   - Morning brief (5:30 AM) — Square + 3 email accounts
 *   - Evening wind-down (8 PM) — Square bookings + priorities
 *   - Weekly intel (Sunday 7 AM) — staff performance
 *   - Salon monitor — milestones, EOD, weekly wrap
 *   - A2P watcher (every 6h)
 *   - Health check endpoint
 */

import "dotenv/config";
import { createServer } from "http";
import { startBot, sendToOwner } from "./bot.js";
import { startBriefings } from "./briefings.js";
import { startSalonMonitor } from "./salon-monitor-cron.js";
import { startA2PWatcher } from "./a2p-watcher.js";
import { getDailyCost } from "./brain.js";
import { getHealthStatus, ensureAgentLogsTable, logAction } from "./orchestration.js";

console.log("╔══════════════════════════════════════╗");
console.log("║       JJP AGENT — INTEL ONLINE       ║");
console.log("╚══════════════════════════════════════╝");
console.log();

const required = ["ANTHROPIC_API_KEY", "TELEGRAM_BOT_TOKEN"];
const missing = required.filter(k => !process.env[k]);
if (missing.length > 0) {
  console.error(`[FATAL] Missing: ${missing.join(", ")}`);
  process.exit(1);
}

// Start services
startBot();
startBriefings(sendToOwner);
startSalonMonitor(sendToOwner);
startA2PWatcher(sendToOwner);

// Logging
ensureAgentLogsTable();
logAction("system_start", "JJP Agent started (clean rebuild)", true);

// Health check
const PORT = process.env.PORT || 3000;
createServer((req, res) => {
  if (req.url === "/health" || req.url === "/") {
    const health = getHealthStatus();
    const cost = getDailyCost();
    health.cost_today = cost.estimatedCost;
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify(health, null, 2));
  } else {
    res.writeHead(404);
    res.end("Not found");
  }
}).listen(PORT, () => console.log(`[HEALTH] http://localhost:${PORT}/health`));

process.on("SIGINT", () => { console.log("\n[AGENT] Shutting down..."); process.exit(0); });
process.on("uncaughtException", (err) => console.error("[AGENT] Uncaught:", err));
process.on("unhandledRejection", (err) => console.error("[AGENT] Unhandled:", err));
