/**
 * Salon Revenue Monitor — Cron version (runs inside agent process)
 *
 * Checks Square every hour during salon hours (9 AM - 8 PM ET).
 * Sends milestone alerts, slow day warnings, EOD summary, weekly wrap.
 */

import cron from "node-cron";
import { readFileSync, writeFileSync, existsSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ALERT_LOG_PATH = join(__dirname, "..", "salon-alerts.json");

// ── Alert deduplication ──

function loadAlertLog() {
  try {
    if (existsSync(ALERT_LOG_PATH)) {
      const data = JSON.parse(readFileSync(ALERT_LOG_PATH, "utf-8"));
      const today = new Date().toLocaleDateString("en-US", { timeZone: "America/New_York" });
      if (data.date !== today) return { date: today, fired: [] };
      return data;
    }
  } catch {}
  return { date: new Date().toLocaleDateString("en-US", { timeZone: "America/New_York" }), fired: [] };
}

function saveAlertLog(log) {
  try { writeFileSync(ALERT_LOG_PATH, JSON.stringify(log, null, 2), "utf-8"); } catch {}
}

function hasAlertFired(log, id) { return log.fired.includes(id); }
function markAlertFired(log, id) {
  if (!log.fired.includes(id)) { log.fired.push(id); saveAlertLog(log); }
}

// ── Square API ──

async function getOrdersForDate(dateStr) {
  const token = process.env.SQUARE_ACCESS_TOKEN;
  const locationId = process.env.SQUARE_LOCATION_ID;
  if (!token || !locationId) return [];

  const res = await fetch("https://connect.squareup.com/v2/orders/search", {
    method: "POST",
    headers: {
      "Square-Version": "2024-01-18",
      "Authorization": `Bearer ${token}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      location_ids: [locationId],
      query: {
        filter: {
          date_time_filter: { created_at: { start_at: `${dateStr}T00:00:00-04:00`, end_at: `${dateStr}T23:59:59-04:00` } },
          state_filter: { states: ["COMPLETED"] }
        }
      }
    })
  });

  if (!res.ok) return [];
  const data = await res.json();
  return data.orders || [];
}

function calcRevenue(orders) {
  const cents = orders.reduce((sum, o) => sum + (o.total_money?.amount || 0), 0);
  return { dollars: (cents / 100).toFixed(2), cents, count: orders.length };
}

// ── Monitor logic ──

async function runCheck(sendToOwner) {
  const now = new Date();
  const et = new Date(now.toLocaleString("en-US", { timeZone: "America/New_York" }));
  const hour = et.getHours();
  const dayOfWeek = et.getDay();
  const dateStr = now.toLocaleDateString("en-CA", { timeZone: "America/New_York" });

  if (hour < 9 || hour >= 20) return; // Outside salon hours

  const log = loadAlertLog();
  const orders = await getOrdersForDate(dateStr);
  const rev = calcRevenue(orders);

  console.log(`[MONITOR] ${dateStr} ${hour}:00 — $${rev.dollars} (${rev.count} orders)`);

  // Milestones
  if (rev.cents >= 150000 && !hasAlertFired(log, "m1500")) {
    await sendToOwner(`💈 Blueprint at $${rev.dollars} today 👑 Top day.`);
    markAlertFired(log, "m1500");
  } else if (rev.cents >= 100000 && !hasAlertFired(log, "m1000")) {
    await sendToOwner(`💈 Blueprint crossed $1K today 🔥 Strong day. ($${rev.dollars})`);
    markAlertFired(log, "m1000");
  } else if (rev.cents >= 50000 && !hasAlertFired(log, "m500")) {
    await sendToOwner(`💈 Blueprint hit $500 today 💰 Keep going. ($${rev.dollars})`);
    markAlertFired(log, "m500");
  }

  // Slow day
  if (hour >= 14 && rev.cents < 20000 && !hasAlertFired(log, "slow")) {
    await sendToOwner(`💈 Slow day at Blueprint. Only $${rev.dollars} so far. Consider a same-day promo push.`);
    markAlertFired(log, "slow");
  }

  // EOD summary (7 PM)
  if (hour === 19 && !hasAlertFired(log, "eod")) {
    const lwDate = new Date(dateStr); lwDate.setDate(lwDate.getDate() - 7);
    const lwStr = lwDate.toISOString().split("T")[0];
    let lwRev = { dollars: "0.00", cents: 0 };
    try { lwRev = calcRevenue(await getOrdersForDate(lwStr)); } catch {}
    const diff = rev.cents - lwRev.cents;
    const diffStr = diff >= 0 ? `+$${(diff/100).toFixed(2)}` : `-$${(Math.abs(diff)/100).toFixed(2)}`;

    // Claude insight
    let insight = "";
    try {
      const r = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: { "content-type": "application/json", "x-api-key": process.env.ANTHROPIC_API_KEY, "anthropic-version": "2023-06-01" },
        body: JSON.stringify({ model: "claude-sonnet-4-20250514", max_tokens: 100,
          messages: [{ role: "user", content: `Salon made $${rev.dollars} today, ${rev.count} services. Last week same day $${lwRev.dollars}. One sentence insight under 80 chars. No emojis.` }]
        })
      });
      if (r.ok) { const d = await r.json(); insight = d.content?.find(b => b.type === "text")?.text || ""; }
    } catch {}

    await sendToOwner(`💈 Blueprint closed at $${rev.dollars} today. ${rev.count} services. ${diffStr} vs last week.${insight ? `\n${insight}` : ""}`);
    markAlertFired(log, "eod");
  }

  // Weekly wrap (Sunday 6 PM)
  if (dayOfWeek === 0 && hour >= 18 && !hasAlertFired(log, "weekly")) {
    let totalCents = 0, totalCount = 0, bestDay = { name: "", cents: 0 };
    const dayNames = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
    for (let i = 0; i < 7; i++) {
      const d = new Date(dateStr); d.setDate(d.getDate() - i);
      try {
        const r = calcRevenue(await getOrdersForDate(d.toISOString().split("T")[0]));
        totalCents += r.cents; totalCount += r.count;
        if (r.cents > bestDay.cents) bestDay = { name: dayNames[d.getDay()], cents: r.cents };
      } catch {}
    }
    let prevCents = 0;
    for (let i = 7; i < 14; i++) {
      const d = new Date(dateStr); d.setDate(d.getDate() - i);
      try { prevCents += calcRevenue(await getOrdersForDate(d.toISOString().split("T")[0])).cents; } catch {}
    }
    const diff = totalCents - prevCents;
    const diffStr = diff >= 0 ? `+$${(diff/100).toFixed(2)}` : `-$${(Math.abs(diff)/100).toFixed(2)}`;
    await sendToOwner(`💈 Week wrap: Blueprint did $${(totalCents/100).toFixed(2)}. ${diffStr} vs last week. Best day: ${bestDay.name} ($${(bestDay.cents/100).toFixed(2)}). ${totalCount} services.`);
    markAlertFired(log, "weekly");
  }
}

export function startSalonMonitor(sendToOwner) {
  if (!process.env.SQUARE_ACCESS_TOKEN || !process.env.SQUARE_LOCATION_ID) {
    console.log("[MONITOR] Square not configured. Salon monitor disabled.");
    return;
  }

  console.log("[MONITOR] Salon revenue monitor active (hourly, 9 AM - 8 PM ET)");

  // Run every hour
  cron.schedule("0 * * * *", () => runCheck(sendToOwner), { timezone: "America/New_York" });

  // Also run immediately on startup (if during salon hours)
  setTimeout(() => runCheck(sendToOwner), 5000);
}
