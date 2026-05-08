#!/usr/bin/env node

/**
 * Salon Revenue Monitor — Runs via launchd every 60 min during salon hours
 *
 * Checks Square API and sends proactive alerts to Telegram:
 *   A) Daily milestone alerts ($500, $1K, $1.5K)
 *   B) Slow day alert (past 2PM, under $200)
 *   C) End of day summary (7 PM)
 *   D) Weekly revenue wrap (Sunday 6 PM)
 *
 * Usage:
 *   node src/salon-monitor.js           — normal hourly check
 *   node src/salon-monitor.js test      — send test alert
 *   node src/salon-monitor.js eod       — force end-of-day summary
 *   node src/salon-monitor.js weekly    — force weekly summary
 */

import { readFileSync, writeFileSync, existsSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const envPath = join(__dirname, "..", ".env");
const ALERT_LOG_PATH = join(__dirname, "..", "salon-alerts.json");

// ── Load .env ──

function loadEnv() {
  try {
    const lines = readFileSync(envPath, "utf-8").split("\n");
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const eqIndex = trimmed.indexOf("=");
      if (eqIndex === -1) continue;
      const key = trimmed.slice(0, eqIndex);
      const value = trimmed.slice(eqIndex + 1);
      if (!process.env[key]) process.env[key] = value;
    }
  } catch (err) {
    console.error("Failed to load .env:", err.message);
    process.exit(1);
  }
}

loadEnv();

const SQUARE_TOKEN = process.env.SQUARE_ACCESS_TOKEN;
const SQUARE_LOCATION = process.env.SQUARE_LOCATION_ID;
const TELEGRAM_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const OWNER_ID = process.env.TELEGRAM_OWNER_ID;
const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY;

if (!SQUARE_TOKEN || !SQUARE_LOCATION || !TELEGRAM_TOKEN || !OWNER_ID) {
  console.error("Missing required env vars (SQUARE_ACCESS_TOKEN, SQUARE_LOCATION_ID, TELEGRAM_BOT_TOKEN, TELEGRAM_OWNER_ID)");
  process.exit(1);
}

// ── Alert deduplication ──

function loadAlertLog() {
  try {
    if (existsSync(ALERT_LOG_PATH)) {
      const data = JSON.parse(readFileSync(ALERT_LOG_PATH, "utf-8"));
      // Reset if it's a new day
      const today = new Date().toLocaleDateString("en-US", { timeZone: "America/New_York" });
      if (data.date !== today) {
        return { date: today, fired: [] };
      }
      return data;
    }
  } catch {}
  const today = new Date().toLocaleDateString("en-US", { timeZone: "America/New_York" });
  return { date: today, fired: [] };
}

function saveAlertLog(log) {
  try {
    writeFileSync(ALERT_LOG_PATH, JSON.stringify(log, null, 2), "utf-8");
  } catch {}
}

function hasAlertFired(log, alertId) {
  return log.fired.includes(alertId);
}

function markAlertFired(log, alertId) {
  if (!log.fired.includes(alertId)) {
    log.fired.push(alertId);
    saveAlertLog(log);
  }
}

// ── Square API ──

async function getOrdersForDate(dateStr) {
  const startAt = `${dateStr}T00:00:00-04:00`;
  const endAt = `${dateStr}T23:59:59-04:00`;

  const res = await fetch("https://connect.squareup.com/v2/orders/search", {
    method: "POST",
    headers: {
      "Square-Version": "2024-01-18",
      "Authorization": `Bearer ${SQUARE_TOKEN}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      location_ids: [SQUARE_LOCATION],
      query: {
        filter: {
          date_time_filter: {
            created_at: { start_at: startAt, end_at: endAt }
          },
          state_filter: { states: ["COMPLETED"] }
        }
      }
    })
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Square API ${res.status}: ${err}`);
  }

  const data = await res.json();
  return data.orders || [];
}

function calcRevenue(orders) {
  const totalCents = orders.reduce((sum, o) => sum + (o.total_money?.amount || 0), 0);
  return {
    dollars: (totalCents / 100).toFixed(2),
    cents: totalCents,
    count: orders.length
  };
}

// ── Telegram ──

async function sendTelegram(text) {
  const url = `https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendMessage`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: OWNER_ID, text })
  });
  if (!res.ok) {
    console.error("Telegram send failed:", await res.text());
  }
}

// ── Claude (for insights) ──

async function getClaudeInsight(prompt) {
  if (!ANTHROPIC_KEY) return "";
  try {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": ANTHROPIC_KEY,
        "anthropic-version": "2023-06-01"
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-20250514",
        max_tokens: 150,
        messages: [{ role: "user", content: prompt }]
      })
    });
    if (!res.ok) return "";
    const data = await res.json();
    const text = data.content?.find(b => b.type === "text")?.text || "";
    return text.trim();
  } catch {
    return "";
  }
}

// ── Current time in ET ──

function getETTime() {
  const now = new Date();
  const etStr = now.toLocaleString("en-US", { timeZone: "America/New_York" });
  const et = new Date(etStr);
  return {
    hour: et.getHours(),
    minute: et.getMinutes(),
    dayOfWeek: et.getDay(), // 0=Sunday
    dateStr: now.toLocaleDateString("en-CA", { timeZone: "America/New_York" }), // YYYY-MM-DD
    display: now.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", timeZone: "America/New_York" })
  };
}

// ── Alert Logic ──

async function runMonitor() {
  const time = getETTime();
  const log = loadAlertLog();

  console.log(`[MONITOR] Running at ${time.display} ET (${time.dateStr})`);

  // Only run during salon hours (9 AM - 8 PM)
  if (time.hour < 9 || time.hour >= 20) {
    console.log("[MONITOR] Outside salon hours. Skipping.");
    return;
  }

  // Get today's orders
  const orders = await getOrdersForDate(time.dateStr);
  const revenue = calcRevenue(orders);

  console.log(`[MONITOR] Today: $${revenue.dollars} (${revenue.count} orders)`);

  // A) DAILY MILESTONE ALERTS
  if (revenue.cents >= 150000 && !hasAlertFired(log, "milestone_1500")) {
    await sendTelegram(`💈 Blueprint at $${revenue.dollars} today 👑 Top day.`);
    markAlertFired(log, "milestone_1500");
  } else if (revenue.cents >= 100000 && !hasAlertFired(log, "milestone_1000")) {
    await sendTelegram(`💈 Blueprint crossed $1K today 🔥 Strong day. ($${revenue.dollars})`);
    markAlertFired(log, "milestone_1000");
  } else if (revenue.cents >= 50000 && !hasAlertFired(log, "milestone_500")) {
    await sendTelegram(`💈 Blueprint hit $500 today 💰 Keep going. ($${revenue.dollars})`);
    markAlertFired(log, "milestone_500");
  }

  // B) SLOW DAY ALERT (past 2 PM, under $200)
  if (time.hour >= 14 && revenue.cents < 20000 && !hasAlertFired(log, "slow_day")) {
    await sendTelegram(`💈 Slow day at Blueprint. Only $${revenue.dollars} so far. Consider a same-day promo push.`);
    markAlertFired(log, "slow_day");
  }

  // C) END OF DAY SUMMARY (7 PM)
  if (time.hour === 19 && !hasAlertFired(log, "eod_summary")) {
    await sendEODSummary(time.dateStr, revenue);
    markAlertFired(log, "eod_summary");
  }

  // D) WEEKLY SUMMARY (Sunday 6 PM)
  if (time.dayOfWeek === 0 && time.hour >= 18 && !hasAlertFired(log, "weekly_summary")) {
    await sendWeeklySummary(time.dateStr);
    markAlertFired(log, "weekly_summary");
  }
}

async function sendEODSummary(todayStr, revenue) {
  // Get last week same day for comparison
  const lastWeekDate = new Date(todayStr);
  lastWeekDate.setDate(lastWeekDate.getDate() - 7);
  const lwStr = lastWeekDate.toISOString().split("T")[0];

  let lwRevenue = { dollars: "0.00", cents: 0, count: 0 };
  try {
    const lwOrders = await getOrdersForDate(lwStr);
    lwRevenue = calcRevenue(lwOrders);
  } catch {}

  const diff = revenue.cents - lwRevenue.cents;
  const diffStr = diff >= 0 ? `+$${(diff / 100).toFixed(2)}` : `-$${(Math.abs(diff) / 100).toFixed(2)}`;
  const vsLastWeek = `${diffStr} vs last week ($${lwRevenue.dollars})`;

  // Get Claude insight
  const insight = await getClaudeInsight(
    `Brazilian Blueprint salon made $${revenue.dollars} today with ${revenue.count} services. Last week same day was $${lwRevenue.dollars}. Give ONE sentence (under 80 chars) of sharp business insight. No emojis.`
  );

  const message = `💈 Blueprint closed at $${revenue.dollars} today. ${revenue.count} services. ${vsLastWeek}.${insight ? `\n${insight}` : ""}`;

  await sendTelegram(message);
  console.log("[MONITOR] EOD summary sent.");
}

async function sendWeeklySummary(todayStr) {
  // Get orders for the past 7 days
  let totalCents = 0;
  let totalCount = 0;
  let bestDay = { name: "", cents: 0 };
  const dayNames = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

  for (let i = 0; i < 7; i++) {
    const d = new Date(todayStr);
    d.setDate(d.getDate() - i);
    const dateStr = d.toISOString().split("T")[0];

    try {
      const orders = await getOrdersForDate(dateStr);
      const rev = calcRevenue(orders);
      totalCents += rev.cents;
      totalCount += rev.count;

      if (rev.cents > bestDay.cents) {
        bestDay = { name: dayNames[d.getDay()], cents: rev.cents };
      }
    } catch {}
  }

  // Previous week
  let prevWeekCents = 0;
  for (let i = 7; i < 14; i++) {
    const d = new Date(todayStr);
    d.setDate(d.getDate() - i);
    const dateStr = d.toISOString().split("T")[0];
    try {
      const orders = await getOrdersForDate(dateStr);
      const rev = calcRevenue(orders);
      prevWeekCents += rev.cents;
    } catch {}
  }

  const totalDollars = (totalCents / 100).toFixed(2);
  const prevDollars = (prevWeekCents / 100).toFixed(2);
  const diff = totalCents - prevWeekCents;
  const diffStr = diff >= 0 ? `+$${(diff / 100).toFixed(2)}` : `-$${(Math.abs(diff) / 100).toFixed(2)}`;
  const bestDayDollars = (bestDay.cents / 100).toFixed(2);

  const message = `💈 Week wrap: Blueprint did $${totalDollars}. ${diffStr} vs last week ($${prevDollars}). Best day: ${bestDay.name} ($${bestDayDollars}). ${totalCount} total services.`;

  await sendTelegram(message);
  console.log("[MONITOR] Weekly summary sent.");
}

// ── Main ──

const mode = process.argv[2];

if (mode === "test") {
  loadEnv();
  sendTelegram("💈 Salon Monitor: System is live and watching Brazilian Blueprint. Alerts are active.")
    .then(() => { console.log("Test alert sent."); process.exit(0); })
    .catch(err => { console.error(err); process.exit(1); });
} else if (mode === "eod") {
  (async () => {
    const time = getETTime();
    const orders = await getOrdersForDate(time.dateStr);
    const revenue = calcRevenue(orders);
    await sendEODSummary(time.dateStr, revenue);
    process.exit(0);
  })();
} else if (mode === "weekly") {
  (async () => {
    const time = getETTime();
    await sendWeeklySummary(time.dateStr);
    process.exit(0);
  })();
} else {
  runMonitor()
    .then(() => process.exit(0))
    .catch(err => { console.error("[MONITOR] Error:", err.message); process.exit(1); });
}
