/**
 * Salon Revenue Monitor — Supabase-backed alert deduplication
 *
 * ALL alert dedup is stored in Supabase `agent_alerts_sent` table.
 * Survives Railway deploys, restarts, and crashes permanently.
 *
 * Table schema (run once in Supabase SQL editor):
 *   CREATE TABLE agent_alerts_sent (
 *     id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
 *     alert_type text NOT NULL,
 *     alert_date date NOT NULL,
 *     fired_at timestamptz DEFAULT now(),
 *     amount numeric DEFAULT 0,
 *     UNIQUE(alert_type, alert_date)
 *   );
 */

import cron from "node-cron";
import { getETDayName, addDays, todayET } from "./date-utils.js";

// ══════════════════════════════════════
// SUPABASE DEDUP — persistent across all restarts
// ══════════════════════════════════════

async function hasAlertFiredToday(alertType) {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_KEY;
  if (!url || !key) return false;

  const today = todayET();
  try {
    const res = await fetch(
      `${url}/rest/v1/agent_alerts_sent?alert_type=eq.${alertType}&alert_date=eq.${today}&select=id&limit=1`,
      { headers: { apikey: key, Authorization: `Bearer ${key}` } }
    );
    if (!res.ok) return false;
    const rows = await res.json();
    return rows.length > 0;
  } catch {
    return false; // If we can't check, allow the alert (better than silencing)
  }
}

async function markAlertFired(alertType, amount = 0) {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_KEY;
  if (!url || !key) return;

  const today = todayET();
  try {
    await fetch(`${url}/rest/v1/agent_alerts_sent`, {
      method: "POST",
      headers: {
        apikey: key,
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
        Prefer: "return=minimal"
      },
      body: JSON.stringify({
        alert_type: alertType,
        alert_date: today,
        amount
      })
    });
    console.log(`[DEDUP] Marked ${alertType} as fired for ${today}`);
  } catch (err) {
    console.error(`[DEDUP] Failed to mark ${alertType}:`, err.message);
  }
}

async function cleanupOldAlerts() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_KEY;
  if (!url || !key) return;

  const cutoff = addDays(todayET(), -7);
  try {
    await fetch(
      `${url}/rest/v1/agent_alerts_sent?alert_date=lt.${cutoff}`,
      {
        method: "DELETE",
        headers: { apikey: key, Authorization: `Bearer ${key}` }
      }
    );
    console.log(`[DEDUP] Cleaned up alerts older than ${cutoff}`);
  } catch {}
}

// ══════════════════════════════════════
// SQUARE API
// ══════════════════════════════════════

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
          date_time_filter: {
            created_at: {
              start_at: `${dateStr}T00:00:00-04:00`,
              end_at: `${dateStr}T23:59:59-04:00`
            }
          },
          state_filter: { states: ["COMPLETED"] }
        }
      }
    })
  });
  return data?.orders || [];
}

function calcRevenue(orders) {
  const cents = orders.reduce((sum, o) => sum + (o.total_money?.amount || 0), 0);
  return { dollars: (cents / 100).toFixed(2), cents, count: orders.length };
}

// ══════════════════════════════════════
// DYNAMIC OPEN/CLOSED DETECTION
// ══════════════════════════════════════

async function isOpenDay(dateStr) {
  try {
    const startUTC = new Date(`${dateStr}T00:00:00-04:00`).toISOString();
    const endUTC = new Date(`${dateStr}T23:59:59-04:00`).toISOString();
    const data = await squareFetch(
      `/bookings?location_id=${process.env.SQUARE_LOCATION_ID}&limit=5&start_at_min=${startUTC}&start_at_max=${endUTC}`
    );
    const active = (data?.bookings || []).filter(
      b => b.status === "ACCEPTED" || b.status === "COMPLETED"
    );
    return active.length > 0;
  } catch {
    return true;
  }
}

// ══════════════════════════════════════
// MONITOR LOGIC
// ══════════════════════════════════════

async function runCheck(sendToOwner) {
  const now = new Date();
  const et = new Date(now.toLocaleString("en-US", { timeZone: "America/New_York" }));
  const hour = et.getHours();
  const dayOfWeek = et.getDay();
  const dateStr = todayET();

  // Only run between 9 AM and 8 PM ET
  // Exception: EOD at 7 PM and weekly on Sunday 6 PM always check
  if (hour < 9 || hour >= 20) {
    if (!(hour === 19 || (dayOfWeek === 0 && hour >= 18))) {
      return;
    }
  }

  // If EOD already sent today, suppress ALL further salon alerts
  if (await hasAlertFiredToday("eod_summary")) {
    console.log(`[MONITOR] EOD already sent today. Suppressing all alerts.`);
    return;
  }

  // Check if salon is actually open
  const isOpen = await isOpenDay(dateStr);
  if (!isOpen && hour !== 19 && !(dayOfWeek === 0 && hour >= 18)) {
    console.log(`[MONITOR] ${dateStr}: No bookings — rest day. Skipping.`);
    return;
  }

  const orders = await getOrdersForDate(dateStr);
  const rev = calcRevenue(orders);

  console.log(`[MONITOR] ${dateStr} ${hour}:00 — $${rev.dollars} (${rev.count} orders)`);

  // ── MILESTONE ALERTS (in order, once per day each) ──

  if (rev.cents >= 50000 && !(await hasAlertFiredToday("milestone_500"))) {
    await sendToOwner(`💈 Blueprint hit $500 today 💰 ($${rev.dollars})`);
    await markAlertFired("milestone_500", rev.cents / 100);
  }

  if (rev.cents >= 100000 && !(await hasAlertFiredToday("milestone_1000"))) {
    await sendToOwner(`💈 Blueprint crossed $1K today 🔥 ($${rev.dollars})`);
    await markAlertFired("milestone_1000", rev.cents / 100);
  }

  if (rev.cents >= 150000 && !(await hasAlertFiredToday("milestone_1500"))) {
    await sendToOwner(`💈 Blueprint at $1,500+ today 👑 ($${rev.dollars})`);
    await markAlertFired("milestone_1500", rev.cents / 100);
  }

  // ── SLOW DAY (once per day, only after 2 PM, only if open) ──

  if (isOpen && hour >= 14 && rev.cents < 20000 && rev.count > 0) {
    if (!(await hasAlertFiredToday("slow_day"))) {
      await sendToOwner(`💈 Slow day at Blueprint. $${rev.dollars} so far (${rev.count} services). Consider a same-day promo.`);
      await markAlertFired("slow_day", rev.cents / 100);
    }
  }

  // ── EOD SUMMARY (7 PM, once per day) ──

  if (hour === 19 && !(await hasAlertFiredToday("eod_summary"))) {
    const lwDate = addDays(dateStr, -7);
    let lwRev = { dollars: "0.00", cents: 0 };
    try { lwRev = calcRevenue(await getOrdersForDate(lwDate)); } catch {}

    const diff = rev.cents - lwRev.cents;
    const diffStr = diff >= 0 ? `+$${(diff / 100).toFixed(2)}` : `-$${(Math.abs(diff) / 100).toFixed(2)}`;

    // Claude insight
    let insight = "";
    try {
      const r = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: { "content-type": "application/json", "x-api-key": process.env.ANTHROPIC_API_KEY, "anthropic-version": "2023-06-01" },
        body: JSON.stringify({
          model: "claude-sonnet-4-20250514", max_tokens: 100,
          messages: [{ role: "user", content: `Salon made $${rev.dollars} today, ${rev.count} services. Last week same day $${lwRev.dollars}. One sentence insight under 80 chars. No emojis.` }]
        })
      });
      if (r.ok) { const d = await r.json(); insight = d.content?.find(b => b.type === "text")?.text || ""; }
    } catch {}

    await sendToOwner(`💈 Blueprint closed at $${rev.dollars} today. ${rev.count} services. ${diffStr} vs last ${getETDayName(lwDate)}.${insight ? `\n${insight}` : ""}`);
    await markAlertFired("eod_summary", rev.cents / 100);
  }

  // ── WEEKLY WRAP (Sunday 6 PM, once per week) ──

  if (dayOfWeek === 0 && hour >= 18) {
    // Use this Sunday's date as the dedup key
    if (!(await hasAlertFiredToday("weekly_wrap"))) {
      let totalCents = 0, totalCount = 0, bestDay = { name: "", date: "", cents: 0 };
      for (let i = 0; i < 7; i++) {
        const ds = addDays(dateStr, -i);
        try {
          const r = calcRevenue(await getOrdersForDate(ds));
          const dayName = getETDayName(ds);
          console.log(`[MONITOR]   ${ds} ${dayName}: $${r.dollars} / ${r.count}`);
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
      const diffStr = diff >= 0 ? `+$${(diff / 100).toFixed(2)}` : `-$${(Math.abs(diff) / 100).toFixed(2)}`;

      await sendToOwner(`💈 Week wrap: Blueprint did $${(totalCents / 100).toFixed(2)}. ${diffStr} vs last week. Best day: ${bestDay.name} ${bestDay.date} ($${(bestDay.cents / 100).toFixed(2)}). ${totalCount} services.`);
      await markAlertFired("weekly_wrap", totalCents / 100);
    }
  }
}

// ══════════════════════════════════════
// CRON SCHEDULER
// ══════════════════════════════════════

export function startSalonMonitor(sendToOwner) {
  if (!process.env.SQUARE_ACCESS_TOKEN || !process.env.SQUARE_LOCATION_ID) {
    console.log("[MONITOR] Square not configured. Salon monitor disabled.");
    return;
  }

  console.log("[MONITOR] Salon revenue monitor active (hourly, Supabase dedup)");

  // Run every hour on the hour
  cron.schedule("0 * * * *", () => runCheck(sendToOwner), { timezone: "America/New_York" });

  // Weekly cleanup of old alerts — Sunday midnight
  cron.schedule("0 0 * * 0", () => cleanupOldAlerts(), { timezone: "America/New_York" });
}
