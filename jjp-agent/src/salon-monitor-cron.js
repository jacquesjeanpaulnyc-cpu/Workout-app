/**
 * Salon Revenue Monitor — Window-aware with Supabase dedup
 *
 * Uses exact salon schedule from Square API.
 * Only fires alerts INSIDE open windows.
 * All dedup stored in Supabase agent_alerts_sent table.
 */

import cron from "node-cron";
import { getETDayName, addDays, todayET } from "./date-utils.js";
import { SALON_SCHEDULE, isSalonDay, isInOpenWindow, getTodayWindows, getCheckTimes } from "./salon-schedule.js";

// ── Supabase Dedup ──

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
    return (await res.json()).length > 0;
  } catch { return false; }
}

async function markAlertFired(alertType, amount = 0) {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_KEY;
  if (!url || !key) return;
  try {
    await fetch(`${url}/rest/v1/agent_alerts_sent`, {
      method: "POST",
      headers: { apikey: key, Authorization: `Bearer ${key}`, "Content-Type": "application/json", Prefer: "return=minimal" },
      body: JSON.stringify({ alert_type: alertType, alert_date: todayET(), amount })
    });
    console.log(`[DEDUP] Marked ${alertType} for ${todayET()}`);
  } catch {}
}

async function cleanupOldAlerts() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_KEY;
  if (!url || !key) return;
  try {
    await fetch(`${url}/rest/v1/agent_alerts_sent?alert_date=lt.${addDays(todayET(), -7)}`, {
      method: "DELETE",
      headers: { apikey: key, Authorization: `Bearer ${key}` }
    });
  } catch {}
}

// ── Square API ──

async function getOrdersForDate(dateStr) {
  const token = process.env.SQUARE_ACCESS_TOKEN;
  if (!token) return [];
  const res = await fetch("https://connect.squareup.com/v2/orders/search", {
    method: "POST",
    headers: { "Square-Version": "2024-01-18", "Authorization": `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      location_ids: [process.env.SQUARE_LOCATION_ID],
      query: {
        filter: {
          date_time_filter: { created_at: { start_at: `${dateStr}T00:00:00-04:00`, end_at: `${dateStr}T23:59:59-04:00` } },
          state_filter: { states: ["COMPLETED"] }
        }
      }
    })
  });
  if (!res.ok) return [];
  return (await res.json()).orders || [];
}

function calcRevenue(orders) {
  const cents = orders.reduce((s, o) => s + (o.total_money?.amount || 0), 0);
  return { dollars: (cents / 100).toFixed(2), cents, count: orders.length };
}

// ── Monitor Logic ──

async function runCheck(sendToOwner) {
  const now = new Date();
  const et = new Date(now.toLocaleString("en-US", { timeZone: "America/New_York" }));
  const hour = et.getHours();
  const minute = et.getMinutes();
  const dayOfWeek = et.getDay();
  const dateStr = todayET();

  // Closed day — no alerts at all
  if (!isSalonDay(dayOfWeek)) {
    console.log(`[MONITOR] ${dateStr} ${getETDayName(dateStr)}: CLOSED. Skipping.`);
    return;
  }

  // If EOD already sent, suppress everything
  if (await hasAlertFiredToday("eod_summary")) {
    return;
  }

  // Only fire alerts during open windows (except EOD at 7 PM)
  const inWindow = isInOpenWindow(dayOfWeek, hour, minute);
  const isEODTime = hour === 19;

  if (!inWindow && !isEODTime) {
    console.log(`[MONITOR] ${dateStr} ${hour}:${String(minute).padStart(2, "0")} — outside open windows. Skipping.`);
    return;
  }

  const orders = await getOrdersForDate(dateStr);
  const rev = calcRevenue(orders);
  console.log(`[MONITOR] ${dateStr} ${getETDayName(dateStr)} ${hour}:${String(minute).padStart(2, "0")} — $${rev.dollars} (${rev.count} orders) [window: ${inWindow ? "OPEN" : "CLOSED"}]`);

  // ── Milestones (in order, once each, only during open windows) ──
  if (inWindow) {
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

    // Slow day — only after 2 PM, only in window
    if (hour >= 14 && rev.cents < 20000 && rev.count > 0 && !(await hasAlertFiredToday("slow_day"))) {
      await sendToOwner(`💈 Slow day at Blueprint. $${rev.dollars} (${rev.count} services). Consider a promo.`);
      await markAlertFired("slow_day", rev.cents / 100);
    }
  }

  // ── EOD Summary (7 PM, once per day) ──
  if (isEODTime && !(await hasAlertFiredToday("eod_summary"))) {
    const lwDate = addDays(dateStr, -7);
    let lwRev = { dollars: "0.00", cents: 0 };
    try { lwRev = calcRevenue(await getOrdersForDate(lwDate)); } catch {}

    const diff = rev.cents - lwRev.cents;
    const diffStr = diff >= 0 ? `+$${(diff / 100).toFixed(2)}` : `-$${(Math.abs(diff) / 100).toFixed(2)}`;

    let insight = "";
    try {
      const r = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: { "content-type": "application/json", "x-api-key": process.env.ANTHROPIC_API_KEY, "anthropic-version": "2023-06-01" },
        body: JSON.stringify({
          model: "claude-sonnet-4-20250514", max_tokens: 100,
          messages: [{ role: "user", content: `Salon: $${rev.dollars} today, ${rev.count} services. Last ${getETDayName(lwDate)}: $${lwRev.dollars}. One sentence insight under 80 chars. No emojis.` }]
        })
      });
      if (r.ok) { const d = await r.json(); insight = d.content?.find(b => b.type === "text")?.text || ""; }
    } catch {}

    const windows = getTodayWindows(dayOfWeek).join(" & ");
    await sendToOwner(`💈 Blueprint EOD — ${getETDayName(dateStr)} (${windows})\n$${rev.dollars} | ${rev.count} services | ${diffStr} vs last week${insight ? `\n${insight}` : ""}`);
    await markAlertFired("eod_summary", rev.cents / 100);
  }

  // ── Weekly Wrap (Sunday 6 PM) ──
  if (dayOfWeek === 0 && hour >= 18 && !(await hasAlertFiredToday("weekly_wrap"))) {
    let totalCents = 0, totalCount = 0, bestDay = { name: "", date: "", cents: 0 };
    for (let i = 0; i < 7; i++) {
      const ds = addDays(dateStr, -i);
      try {
        const r = calcRevenue(await getOrdersForDate(ds));
        const dn = getETDayName(ds);
        console.log(`[MONITOR]   ${ds} ${dn}: $${r.dollars} / ${r.count}`);
        totalCents += r.cents; totalCount += r.count;
        if (r.cents > bestDay.cents) bestDay = { name: dn, date: ds, cents: r.cents };
      } catch {}
    }
    let prevCents = 0;
    for (let i = 7; i < 14; i++) {
      try { prevCents += calcRevenue(await getOrdersForDate(addDays(dateStr, -i))).cents; } catch {}
    }
    const diff = totalCents - prevCents;
    const diffStr = diff >= 0 ? `+$${(diff / 100).toFixed(2)}` : `-$${(Math.abs(diff) / 100).toFixed(2)}`;
    await sendToOwner(`💈 Week wrap: $${(totalCents / 100).toFixed(2)} | ${diffStr} vs last week | Best: ${bestDay.name} ${bestDay.date} ($${(bestDay.cents / 100).toFixed(2)}) | ${totalCount} services`);
    await markAlertFired("weekly_wrap", totalCents / 100);
  }
}

// ── Cron ──

export function startSalonMonitor(sendToOwner) {
  if (!process.env.SQUARE_ACCESS_TOKEN || !process.env.SQUARE_LOCATION_ID) {
    console.log("[MONITOR] Square not configured. Disabled.");
    return;
  }
  console.log("[MONITOR] Salon monitor active — window-aware, Supabase dedup");
  cron.schedule("0 * * * *", () => runCheck(sendToOwner), { timezone: "America/New_York" });
  cron.schedule("0 0 * * 0", () => cleanupOldAlerts(), { timezone: "America/New_York" });
}
