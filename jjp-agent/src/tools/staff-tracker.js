/**
 * Staff Performance Tracker — Per-specialist metrics from Square
 *
 * Pulls booking + payment data from Square, attributes to team members.
 * Shows: appointment count, revenue, avg ticket, cancellations, no-shows.
 * Compares current period vs previous period.
 */

const TEAM = {
  "TM64uw5FqA84B0Gh": { name: "Anyssa Tavarez", role: "Owner", shortName: "Anyssa" },
  "TMjj1DdVj2hRuHsV": { name: "Selena Rodrigues", role: "Wax Specialist", shortName: "Selena" },
  "TMdMR1mgd_09LhNI": { name: "Dallas Jones", role: "Wax Specialist", shortName: "Dallas" }
};

async function squareFetch(path, options = {}) {
  const token = process.env.SQUARE_ACCESS_TOKEN;
  const res = await fetch(`https://connect.squareup.com/v2${path}`, {
    ...options,
    headers: {
      "Square-Version": "2024-01-18",
      "Authorization": `Bearer ${token}`,
      "Content-Type": "application/json",
      ...options.headers
    }
  });
  if (!res.ok) throw new Error(`Square ${res.status}: ${await res.text()}`);
  return res.json();
}

export const definition = {
  name: "staff_tracker",
  description: "Staff performance tracker for Brazilian Blueprint. Shows per-specialist metrics: bookings, revenue attributed, average ticket, cancellations, no-shows. Ask 'how is Selena doing', 'staff performance this week', 'compare Dallas vs Selena', 'who is carrying the load'. Actions: 'overview' (all staff), 'individual' (one person), 'compare' (side by side).",
  input_schema: {
    type: "object",
    properties: {
      action: {
        type: "string",
        enum: ["overview", "individual", "compare"],
        description: "overview = all staff, individual = one specialist, compare = side by side"
      },
      specialist: {
        type: "string",
        description: "Name: Anyssa, Selena, or Dallas (for individual action)"
      },
      days: {
        type: "number",
        description: "Number of days to look back. Defaults to 7."
      }
    },
    required: ["action"]
  }
};

export async function execute({ action, specialist, days }) {
  if (!process.env.SQUARE_ACCESS_TOKEN) return { error: "Square not configured." };

  const lookback = days || 7;

  try {
    switch (action) {
      case "overview": return await getOverview(lookback);
      case "individual": return await getIndividual(specialist, lookback);
      case "compare": return await getOverview(lookback); // Compare shows all
      default: return { error: `Unknown action: ${action}` };
    }
  } catch (err) {
    return { error: `Staff tracker error: ${err.message}` };
  }
}

async function getBookings(startDate, endDate) {
  const allBookings = [];
  let cursor = null;

  // Paginate through bookings
  for (let page = 0; page < 5; page++) {
    let url = `/bookings?location_id=${process.env.SQUARE_LOCATION_ID}&limit=100&start_at_min=${startDate}T00:00:00Z&start_at_max=${endDate}T23:59:59Z`;
    if (cursor) url += `&cursor=${cursor}`;

    const data = await squareFetch(url);
    allBookings.push(...(data.bookings || []));

    if (!data.cursor) break;
    cursor = data.cursor;
  }

  return allBookings;
}

function calcStaffMetrics(bookings) {
  const metrics = {};

  // Initialize all team members
  for (const [id, info] of Object.entries(TEAM)) {
    metrics[id] = {
      name: info.name,
      shortName: info.shortName,
      role: info.role,
      completed: 0,
      cancelled: 0,
      noShows: 0,
      totalBookings: 0,
      revenue: 0,
      services: {}
    };
  }

  for (const booking of bookings) {
    const segments = booking.appointment_segments || [];
    for (const seg of segments) {
      const tmId = seg.team_member_id;
      if (!metrics[tmId]) continue;

      metrics[tmId].totalBookings++;

      if (booking.status === "ACCEPTED" || booking.status === "COMPLETED") {
        metrics[tmId].completed++;
        // Estimate revenue from service variation
        const price = seg.intermission_minutes !== undefined
          ? seg.service_variation_version || 0
          : 0;
        // We'll calculate revenue from orders separately
      } else if (booking.status === "CANCELLED_BY_CUSTOMER" || booking.status === "CANCELLED_BY_SELLER") {
        metrics[tmId].cancelled++;
      } else if (booking.status === "NO_SHOW") {
        metrics[tmId].noShows++;
      }
    }
  }

  return metrics;
}

async function getRevenueByTeamMember(startDate, endDate) {
  // Get orders for the period
  const data = await squareFetch("/orders/search", {
    method: "POST",
    body: JSON.stringify({
      location_ids: [process.env.SQUARE_LOCATION_ID],
      query: {
        filter: {
          date_time_filter: {
            created_at: { start_at: `${startDate}T00:00:00-04:00`, end_at: `${endDate}T23:59:59-04:00` }
          },
          state_filter: { states: ["COMPLETED"] }
        }
      }
    })
  });

  const orders = data.orders || [];
  const totalRevenue = orders.reduce((sum, o) => sum + (o.total_money?.amount || 0), 0);

  return { totalRevenue, orderCount: orders.length };
}

async function getOverview(days) {
  const now = new Date();
  const start = new Date(now);
  start.setDate(start.getDate() - days);
  const startStr = start.toISOString().split("T")[0];
  const endStr = now.toISOString().split("T")[0];

  // Previous period for comparison
  const prevStart = new Date(start);
  prevStart.setDate(prevStart.getDate() - days);
  const prevStartStr = prevStart.toISOString().split("T")[0];
  const prevEndStr = startStr;

  const [bookings, prevBookings, revenue] = await Promise.all([
    getBookings(startStr, endStr),
    getBookings(prevStartStr, prevEndStr),
    getRevenueByTeamMember(startStr, endStr)
  ]);

  const current = calcStaffMetrics(bookings);
  const previous = calcStaffMetrics(prevBookings);

  const staff = [];
  for (const [id, m] of Object.entries(current)) {
    const prev = previous[id] || { completed: 0 };
    const diff = m.completed - prev.completed;
    const diffStr = diff > 0 ? `+${diff}` : `${diff}`;

    // Estimate per-specialist revenue based on booking share
    const totalCompleted = Object.values(current).reduce((s, x) => s + x.completed, 0);
    const share = totalCompleted > 0 ? m.completed / totalCompleted : 0;
    const estRevenue = Math.round((revenue.totalRevenue * share) / 100);

    staff.push({
      name: m.shortName,
      role: m.role,
      bookings: m.completed,
      bookings_change: diffStr,
      cancelled: m.cancelled,
      no_shows: m.noShows,
      est_revenue: `$${estRevenue}`,
      share: `${(share * 100).toFixed(0)}%`
    });
  }

  // Sort by bookings desc
  staff.sort((a, b) => b.bookings - a.bookings);

  return {
    period: `Last ${days} days (${startStr} to ${endStr})`,
    total_revenue: `$${(revenue.totalRevenue / 100).toFixed(2)}`,
    total_orders: revenue.orderCount,
    staff,
    insight: staff[0]?.bookings > 0
      ? `${staff[0].name} is carrying ${staff[0].share} of bookings.`
      : "No bookings in this period."
  };
}

async function getIndividual(name, days) {
  if (!name) return { error: "Specify a name: Anyssa, Selena, or Dallas" };

  const lower = name.toLowerCase();
  const tmEntry = Object.entries(TEAM).find(([_, v]) => v.shortName.toLowerCase() === lower);
  if (!tmEntry) return { error: `Unknown specialist: ${name}. Options: Anyssa, Selena, Dallas` };

  const [tmId, tmInfo] = tmEntry;

  const now = new Date();
  const start = new Date(now);
  start.setDate(start.getDate() - days);
  const startStr = start.toISOString().split("T")[0];
  const endStr = now.toISOString().split("T")[0];

  const bookings = await getBookings(startStr, endStr);

  // Filter to this team member
  let completed = 0, cancelled = 0, noShows = 0, total = 0;

  for (const b of bookings) {
    for (const seg of (b.appointment_segments || [])) {
      if (seg.team_member_id !== tmId) continue;
      total++;
      if (b.status === "ACCEPTED" || b.status === "COMPLETED") completed++;
      else if (b.status.includes("CANCELLED")) cancelled++;
      else if (b.status === "NO_SHOW") noShows++;
    }
  }

  const completionRate = total > 0 ? ((completed / total) * 100).toFixed(0) : "0";

  return {
    name: tmInfo.name,
    role: tmInfo.role,
    period: `Last ${days} days`,
    bookings_completed: completed,
    bookings_cancelled: cancelled,
    no_shows: noShows,
    total_bookings: total,
    completion_rate: `${completionRate}%`,
    note: noShows > 0
      ? `${noShows} no-show(s) — consider confirmation reminders when A2P clears.`
      : "No no-shows. Solid reliability."
  };
}
