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
import { getEODEnriched } from "./salon-intel.js";
import { getETDayName, addDays, todayET } from "./date-utils.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ALERT_LOG_PATH = join(__dirname, "..", "salon-alerts.json");

// ── Alert deduplication (Supabase-backed, survives Railway deploys) ──
// Uses agent_logs table with action_type "salon_alert_fired"

async function loadAlertLog() {
  const today = new Date().toLocaleDateString("en-CA", { timeZone: "America/New_York" });

  // Try Supabase first (persistent)
  try {
    const url = process.env.SUPABASE_URL;
    const key = process.env.SUPABASE_SERVICE_KEY;
    if (url && key) {
      const res = await fetch(
        `${url}/rest/v1/agent_logs?action_type=eq.salon_alert_fired&details=like.${today}*&select=details`,
        { headers: { apikey: key, Authorization: `Bearer ${key}` } }
      );
      if (res.ok) {
        const rows = await res.json();
        const fired = rows.map(r => {
          // details format: "YYYY-MM-DD:alertId"
          const parts = (r.details || "").split(":");
          return parts[1] || "";
        }).filter(Boolean);
        return { date: today, fired };
      }
    }
  } catch {}

  // Fallback to in-memory only
  return { date: today, fired: [] };
}

async function markAlertFired(log, id) {
  if (log.fired.includes(id)) return;
  log.fired.push(id);

  // Persist to Supabase immediately
  try {
    const url = process.env.SUPABASE_URL;
    const key = process.env.SUPABASE_SERVICE_KEY;
    if (url && key) {
      await fetch(`${url}/rest/v1/agent_logs`, {
        method: "POST",
        headers: {
          apikey: key,
          Authorization: `Bearer ${key}`,
          "Content-Type": "application/json",
          Prefer: "return=minimal"
        },
        body: JSON.stringify({
          action_type: "salon_alert_fired",
          details: `${log.date}:${id}`,
          success: true,
          created_at: new Date().toISOString()
        })
      });
    }
  } catch {}
}

function hasAlertFired(log, id) { return log.fired.includes(id); }

// ── Dynamic salon day detection ──
// Jay runs 6 days a week, never 7. One closure day varies.
// Instead of hardcoding which day is closed, we check Square bookings
// for the actual day being monitored. If there are no bookings AND
// no historic revenue pattern, we skip alerts for that day.

// Broad open hours for MONITORING purposes only (widest window to catch any activity)
// Real hours detected per-day via Square bookings
const MONITOR_HOURS = { start: 9, end: 20 };

async function isOpenDay(dateStr) {
  // Check if the salon had any bookings on this specific date
  // If no bookings and no completed orders, assume closed
  try {
    const bookings = await squareFetch(
      `/bookings?location_id=${process.env.SQUARE_LOCATION_ID}&limit=10&start_at_min=${new Date(`${dateStr}T00:00:00-04:00`).toISOString()}&start_at_max=${new Date(`${dateStr}T23:59:59-04:00`).toISOString()}`
    );
    const activeBookings = (bookings?.bookings || []).filter(
      b => b.status === "ACCEPTED" || b.status === "COMPLETED"
    );
    return activeBookings.length > 0;
  } catch {
    return true; // Assume open if we can't check — err on the side of monitoring
  }
}

function isWithinMonitorWindow(hour) {
  return hour >= MONITOR_HOURS.start && hour < MONITOR_HOURS.end;
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

  // Skip if outside broad monitoring window (9 AM - 8 PM ET)
  // EOD (7 PM) and weekly (Sun 6 PM) always run regardless
  if (!isWithinMonitorWindow(hour)) {
    if (!(hour === 19 || (dayOfWeek === 0 && hour >= 18))) {
      console.log(`[MONITOR] Outside monitoring window (${hour}:00). Skipping.`);
      return;
    }
  }

  // Dynamically check if salon has any bookings today — if not, it's a rest day
  const hasBookings = await isOpenDay(dateStr);
  if (!hasBookings) {
    console.log(`[MONITOR] ${dateStr}: No bookings detected — rest day. Skipping alerts.`);
    return;
  }

  const log = await loadAlertLog();
  const orders = await getOrdersForDate(dateStr);
  const rev = calcRevenue(orders);

  console.log(`[MONITOR] ${dateStr} ${hour}:00 — $${rev.dollars} (${rev.count} orders)`);

  // Milestones (only on salon days)
  if (rev.cents >= 150000 && !hasAlertFired(log, "m1500")) {
    await sendToOwner(`💈 Blueprint at $${rev.dollars} today 👑 Top day.`);
    await markAlertFired(log, "m1500");
  } else if (rev.cents >= 100000 && !hasAlertFired(log, "m1000")) {
    await sendToOwner(`💈 Blueprint crossed $1K today 🔥 Strong day. ($${rev.dollars})`);
    await markAlertFired(log, "m1000");
  } else if (rev.cents >= 50000 && !hasAlertFired(log, "m500")) {
    await sendToOwner(`💈 Blueprint hit $500 today 💰 Keep going. ($${rev.dollars})`);
    await markAlertFired(log, "m500");
  }

  // Slow day — ONLY if salon is actually open AND has been open for a while
  if (isWithinMonitorWindow(hour) && hour >= 14 && rev.cents < 20000 && rev.cents >= 0 && !hasAlertFired(log, "slow")) {
    // Don't alert $0 — that usually means closed or system error
    if (rev.count > 0 || hour >= 16) {
      await sendToOwner(`💈 Slow day at Blueprint. $${rev.dollars} so far (${rev.count} services). Consider a same-day promo push.`);
    }
    await markAlertFired(log, "slow");
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
    await markAlertFired(log, "eod");
  }

  // Weekly wrap (Sunday 6 PM)
  if (dayOfWeek === 0 && hour >= 18 && !hasAlertFired(log, "weekly")) {
    let totalCents = 0, totalCount = 0, bestDay = { name: "", date: "", cents: 0 };
    console.log(`[MONITOR] Weekly wrap — computing from ${dateStr}`);
    for (let i = 0; i < 7; i++) {
      const ds = addDays(dateStr, -i);
      try {
        const r = calcRevenue(await getOrdersForDate(ds));
        const dayName = getETDayName(ds);
        console.log(`[MONITOR]   ${ds} ${dayName}: $${r.dollars} / ${r.count} orders`);
        totalCents += r.cents; totalCount += r.count;
        if (r.cents > bestDay.cents) bestDay = { name: dayName, date: ds, cents: r.cents };
      } catch {}
    }
    let prevCents = 0;
    for (let i = 7; i < 14; i++) {
      const ds = addDays(dateStr, -i);
      try { prevCents += calcRevenue(await getOrdersForDate(ds)).cents; } catch {}
    }
    const diff = totalCents - prevCents;
    const diffStr = diff >= 0 ? `+$${(diff/100).toFixed(2)}` : `-$${(Math.abs(diff)/100).toFixed(2)}`;
    await sendToOwner(`💈 Week wrap: Blueprint did $${(totalCents/100).toFixed(2)}. ${diffStr} vs last week. Best day: ${bestDay.name} ${bestDay.date} ($${(bestDay.cents/100).toFixed(2)}). ${totalCount} services.`);
    await markAlertFired(log, "weekly");
  }
}

export function startSalonMonitor(sendToOwner) {
  if (!process.env.SQUARE_ACCESS_TOKEN || !process.env.SQUARE_LOCATION_ID) {
    console.log("[MONITOR] Square not configured. Salon monitor disabled.");
    return;
  }

  console.log("[MONITOR] Salon revenue monitor active (hourly, 9 AM - 8 PM ET)");

  // Run every hour on the hour
  cron.schedule("0 * * * *", () => runCheck(sendToOwner), { timezone: "America/New_York" });

  // DO NOT auto-fire on startup — caused duplicate alerts on every Railway deploy
}
