/**
 * Square Revenue Tool — Pull sales data from Brazilian Blueprint
 * Uses Square Orders API for rich data (services, revenue, transactions).
 */

import { fetch as undiciFetch, ProxyAgent } from "undici";

const proxyUrl = process.env.HTTPS_PROXY || process.env.https_proxy || process.env.HTTP_PROXY || process.env.http_proxy;
const dispatcher = proxyUrl ? new ProxyAgent(proxyUrl) : undefined;

async function squareFetch(path, options = {}) {
  const token = process.env.SQUARE_ACCESS_TOKEN;
  const res = await undiciFetch(`https://connect.squareup.com/v2${path}`, {
    ...options,
    headers: {
      "Square-Version": "2024-01-18",
      "Authorization": `Bearer ${token}`,
      "Content-Type": "application/json",
      ...options.headers
    },
    ...(dispatcher ? { dispatcher } : {})
  });
  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Square ${res.status}: ${errText}`);
  }
  return res.json();
}

export const definition = {
  name: "square_revenue",
  description: "Pull sales revenue from Brazilian Blueprint salon via Square. Shows total revenue, transaction count, top services, and comparison to last week same day. Use for any question about salon money, sales, revenue, or financial data.",
  input_schema: {
    type: "object",
    properties: {
      date: {
        type: "string",
        description: "Date to pull revenue for in YYYY-MM-DD format. Defaults to today."
      },
      range: {
        type: "string",
        enum: ["today", "week", "month"],
        description: "Time range: today (default), week (last 7 days), month (last 30 days)"
      }
    },
    required: []
  }
};

export async function execute({ date, range }) {
  const token = process.env.SQUARE_ACCESS_TOKEN;
  const locationId = process.env.SQUARE_LOCATION_ID;

  if (!token || !locationId) {
    return {
      error: "Square API not configured. Add SQUARE_ACCESS_TOKEN and SQUARE_LOCATION_ID to .env"
    };
  }

  try {
    const now = new Date();
    const targetDate = date || now.toISOString().split("T")[0];

    // Calculate date range
    let startDate, endDate;
    if (range === "week") {
      const start = new Date(targetDate);
      start.setDate(start.getDate() - 6);
      startDate = start.toISOString().split("T")[0];
      endDate = targetDate;
    } else if (range === "month") {
      const start = new Date(targetDate);
      start.setDate(start.getDate() - 29);
      startDate = start.toISOString().split("T")[0];
      endDate = targetDate;
    } else {
      startDate = targetDate;
      endDate = targetDate;
    }

    const startAt = `${startDate}T00:00:00-04:00`;
    const endAt = `${endDate}T23:59:59-04:00`;

    // Pull orders using Search Orders API
    const ordersData = await squareFetch("/orders/search", {
      method: "POST",
      body: JSON.stringify({
        location_ids: [locationId],
        query: {
          filter: {
            date_time_filter: {
              created_at: {
                start_at: startAt,
                end_at: endAt
              }
            },
            state_filter: { states: ["COMPLETED"] }
          },
          sort: { sort_field: "CREATED_AT", sort_order: "DESC" }
        }
      })
    });

    const orders = ordersData.orders || [];

    // Calculate totals
    const totalCents = orders.reduce(
      (sum, o) => sum + (o.total_money?.amount || 0), 0
    );
    const totalDollars = (totalCents / 100).toFixed(2);
    const tipCents = orders.reduce(
      (sum, o) => sum + (o.total_tip_money?.amount || 0), 0
    );
    const tipDollars = (tipCents / 100).toFixed(2);

    // Extract top services from line items
    const serviceCounts = {};
    for (const order of orders) {
      for (const item of (order.line_items || [])) {
        const name = item.name || "Unknown";
        if (!serviceCounts[name]) {
          serviceCounts[name] = { count: 0, revenue: 0 };
        }
        serviceCounts[name].count += Number(item.quantity || 1);
        serviceCounts[name].revenue += (item.total_money?.amount || 0);
      }
    }

    const topServices = Object.entries(serviceCounts)
      .sort((a, b) => b[1].revenue - a[1].revenue)
      .slice(0, 5)
      .map(([name, data]) => ({
        service: name,
        count: data.count,
        revenue: `$${(data.revenue / 100).toFixed(2)}`
      }));

    // Last week comparison (same day or same range)
    const lwStart = new Date(startDate);
    lwStart.setDate(lwStart.getDate() - 7);
    const lwEnd = new Date(endDate);
    lwEnd.setDate(lwEnd.getDate() - 7);

    const lwStartAt = `${lwStart.toISOString().split("T")[0]}T00:00:00-04:00`;
    const lwEndAt = `${lwEnd.toISOString().split("T")[0]}T23:59:59-04:00`;

    const lwData = await squareFetch("/orders/search", {
      method: "POST",
      body: JSON.stringify({
        location_ids: [locationId],
        query: {
          filter: {
            date_time_filter: {
              created_at: {
                start_at: lwStartAt,
                end_at: lwEndAt
              }
            },
            state_filter: { states: ["COMPLETED"] }
          }
        }
      })
    });

    const lwOrders = lwData.orders || [];
    const lwTotalCents = lwOrders.reduce(
      (sum, o) => sum + (o.total_money?.amount || 0), 0
    );
    const lwTotalDollars = (lwTotalCents / 100).toFixed(2);

    const diff = totalCents - lwTotalCents;
    const diffSign = diff >= 0 ? "+" : "";
    const diffDollars = (diff / 100).toFixed(2);
    const pctChange = lwTotalCents > 0
      ? `${diffSign}${((diff / lwTotalCents) * 100).toFixed(0)}%`
      : "N/A";

    return {
      date_range: startDate === endDate ? startDate : `${startDate} to ${endDate}`,
      revenue: `$${totalDollars}`,
      tips: `$${tipDollars}`,
      transactions: orders.length,
      top_services: topServices,
      vs_last_week: `${diffSign}$${diffDollars} (${pctChange})`,
      last_week_revenue: `$${lwTotalDollars}`
    };
  } catch (err) {
    return { error: `Square API failed: ${err.message}` };
  }
}
