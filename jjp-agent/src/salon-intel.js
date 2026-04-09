/**
 * Salon Intelligence — Pulls structured salon data for briefings
 * Centralizes all Square data pulls so briefings don't duplicate logic.
 */

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

function getDateStr(daysOffset = 0) {
  const d = new Date();
  d.setDate(d.getDate() + daysOffset);
  return d.toLocaleDateString("en-CA", { timeZone: "America/New_York" });
}

async function getOrdersForDate(dateStr) {
  const data = await squareFetch("/orders/search", {
    method: "POST",
    body: JSON.stringify({
      location_ids: [process.env.SQUARE_LOCATION_ID],
      query: {
        filter: {
          date_time_filter: {
            created_at: { start_at: `${dateStr}T00:00:00-04:00`, end_at: `${dateStr}T23:59:59-04:00` }
          },
          state_filter: { states: ["COMPLETED"] }
        }
      }
    })
  });
  return data?.orders || [];
}

async function getBookingsForDate(dateStr) {
  const data = await squareFetch(
    `/bookings?location_id=${process.env.SQUARE_LOCATION_ID}&limit=50&start_at_min=${dateStr}T00:00:00Z&start_at_max=${dateStr}T23:59:59Z`
  );
  return data?.bookings || [];
}

const TEAM = {
  "TM64uw5FqA84B0Gh": "Anyssa",
  "TMjj1DdVj2hRuHsV": "Selena",
  "TMdMR1mgd_09LhNI": "Dallas"
};

/**
 * Yesterday's revenue recap
 */
export async function getYesterdayRecap() {
  try {
    const yesterday = getDateStr(-1);
    const orders = await getOrdersForDate(yesterday);
    const totalCents = orders.reduce((s, o) => s + (o.total_money?.amount || 0), 0);
    const count = orders.length;

    // Top services
    const services = {};
    for (const o of orders) {
      for (const item of (o.line_items || [])) {
        const name = item.name || "Other";
        services[name] = (services[name] || 0) + 1;
      }
    }
    const topService = Object.entries(services).sort((a, b) => b[1] - a[1])[0];

    return {
      date: yesterday,
      revenue: `$${(totalCents / 100).toFixed(2)}`,
      orders: count,
      topService: topService ? `${topService[0]} (${topService[1]}x)` : "none"
    };
  } catch { return null; }
}

/**
 * Today's booked appointments + expected revenue
 */
export async function getTodayForecast() {
  try {
    const today = getDateStr(0);
    const bookings = await getBookingsForDate(today);

    const accepted = bookings.filter(b => b.status === "ACCEPTED");
    const cancelled = bookings.filter(b => b.status?.includes("CANCELLED"));
    const noShows = bookings.filter(b => b.status === "NO_SHOW");

    // Staff working today
    const staffToday = new Set();
    for (const b of accepted) {
      for (const seg of (b.appointment_segments || [])) {
        if (TEAM[seg.team_member_id]) staffToday.add(TEAM[seg.team_member_id]);
      }
    }

    return {
      booked: accepted.length,
      cancelled: cancelled.length,
      noShows: noShows.length,
      staffWorking: [...staffToday],
      note: accepted.length === 0 ? "No bookings yet today." : null
    };
  } catch { return null; }
}

/**
 * Tomorrow's appointment preview
 */
export async function getTomorrowPreview() {
  try {
    const tomorrow = getDateStr(1);
    const bookings = await getBookingsForDate(tomorrow);
    const accepted = bookings.filter(b => b.status === "ACCEPTED");

    const staffTomorrow = new Set();
    for (const b of accepted) {
      for (const seg of (b.appointment_segments || [])) {
        if (TEAM[seg.team_member_id]) staffTomorrow.add(TEAM[seg.team_member_id]);
      }
    }

    return {
      booked: accepted.length,
      staffWorking: [...staffTomorrow]
    };
  } catch { return null; }
}

/**
 * Today's revenue so far (for midday pulse)
 */
export async function getTodayRevenue() {
  try {
    const today = getDateStr(0);
    const orders = await getOrdersForDate(today);
    const totalCents = orders.reduce((s, o) => s + (o.total_money?.amount || 0), 0);
    return {
      revenue: `$${(totalCents / 100).toFixed(2)}`,
      orders: orders.length
    };
  } catch { return null; }
}

/**
 * Today's staff breakdown (for EOD)
 */
export async function getTodayStaffBreakdown() {
  try {
    const today = getDateStr(0);
    const bookings = await getBookingsForDate(today);

    const staff = {};
    for (const [id, name] of Object.entries(TEAM)) {
      staff[name] = { completed: 0, cancelled: 0, noShows: 0 };
    }

    for (const b of bookings) {
      for (const seg of (b.appointment_segments || [])) {
        const name = TEAM[seg.team_member_id];
        if (!name) continue;
        if (b.status === "ACCEPTED" || b.status === "COMPLETED") staff[name].completed++;
        else if (b.status?.includes("CANCELLED")) staff[name].cancelled++;
        else if (b.status === "NO_SHOW") staff[name].noShows++;
      }
    }

    return staff;
  } catch { return null; }
}

/**
 * Build salon section for morning briefing
 */
export async function getMorningSalonBrief() {
  const [yesterday, forecast] = await Promise.all([
    getYesterdayRecap(),
    getTodayForecast()
  ]);

  const lines = ["💈 Salon Intel:"];

  if (yesterday) {
    lines.push(`Yesterday: ${yesterday.revenue} (${yesterday.orders} services)${yesterday.topService !== "none" ? ` | Top: ${yesterday.topService}` : ""}`);
  }

  if (forecast) {
    lines.push(`Today: ${forecast.booked} appointments booked${forecast.cancelled > 0 ? ` | ${forecast.cancelled} cancelled` : ""}${forecast.noShows > 0 ? ` | ${forecast.noShows} no-shows` : ""}`);
    if (forecast.staffWorking.length > 0) {
      lines.push(`Staff today: ${forecast.staffWorking.join(", ")}`);
    }
    if (forecast.booked === 0) lines.push("⚠️ Empty calendar — consider a promo push.");
  }

  return lines.length > 1 ? lines.join("\n") : "";
}

/**
 * Build midday pulse message
 */
export async function getMiddayPulse() {
  const [revenue, forecast] = await Promise.all([
    getTodayRevenue(),
    getTodayForecast()
  ]);

  const lines = ["📊 MIDDAY PULSE"];

  if (revenue) {
    lines.push(`Revenue so far: ${revenue.revenue} (${revenue.orders} services)`);
  }

  if (forecast) {
    lines.push(`Appointments: ${forecast.booked} remaining today`);
    if (forecast.cancelled > 0) lines.push(`${forecast.cancelled} cancellation(s) since morning`);
  }

  return lines.join("\n");
}

/**
 * Build enriched EOD section
 */
export async function getEODEnriched() {
  const [staff, tomorrow] = await Promise.all([
    getTodayStaffBreakdown(),
    getTomorrowPreview()
  ]);

  const lines = [];

  if (staff) {
    const active = Object.entries(staff).filter(([_, v]) => v.completed > 0);
    if (active.length > 0) {
      lines.push("Staff today: " + active.map(([name, v]) => `${name} ${v.completed} services`).join(" | "));
    }
  }

  if (tomorrow) {
    lines.push(`Tomorrow: ${tomorrow.booked} booked${tomorrow.staffWorking.length > 0 ? ` (${tomorrow.staffWorking.join(", ")})` : ""}`);
  }

  return lines.join("\n");
}
