/**
 * Square Revenue Tool — Pull sales data from Brazilian Blueprint
 */

export const definition = {
  name: "square_revenue",
  description: "Pull today's sales revenue from Brazilian Blueprint salon via Square. Shows total revenue, transaction count, and comparison to last week.",
  input_schema: {
    type: "object",
    properties: {
      date: {
        type: "string",
        description: "Date to pull revenue for in YYYY-MM-DD format. Defaults to today."
      }
    },
    required: []
  }
};

export async function execute({ date }) {
  const token = process.env.SQUARE_ACCESS_TOKEN;
  const locationId = process.env.SQUARE_LOCATION_ID;

  if (!token || !locationId) {
    return {
      error: "Square API not configured. Add SQUARE_ACCESS_TOKEN and SQUARE_LOCATION_ID to .env"
    };
  }

  try {
    const targetDate = date || new Date().toISOString().split("T")[0];
    const startOfDay = `${targetDate}T00:00:00Z`;
    const endOfDay = `${targetDate}T23:59:59Z`;

    // Get today's payments
    const res = await fetch("https://connect.squareup.com/v2/payments", {
      method: "GET",
      headers: {
        "Square-Version": "2024-01-18",
        "Authorization": `Bearer ${token}`,
        "Content-Type": "application/json"
      }
    });

    if (!res.ok) {
      const errBody = await res.text();
      return { error: `Square API error ${res.status}: ${errBody}` };
    }

    const data = await res.json();
    const payments = (data.payments || []).filter(p => {
      const created = p.created_at;
      return created >= startOfDay && created <= endOfDay &&
             p.location_id === locationId &&
             p.status === "COMPLETED";
    });

    const totalCents = payments.reduce(
      (sum, p) => sum + (p.amount_money?.amount || 0), 0
    );
    const totalDollars = (totalCents / 100).toFixed(2);

    // Last week comparison
    const lastWeekDate = new Date(targetDate);
    lastWeekDate.setDate(lastWeekDate.getDate() - 7);
    const lwStart = `${lastWeekDate.toISOString().split("T")[0]}T00:00:00Z`;
    const lwEnd = `${lastWeekDate.toISOString().split("T")[0]}T23:59:59Z`;

    const lwPayments = (data.payments || []).filter(p => {
      const created = p.created_at;
      return created >= lwStart && created <= lwEnd &&
             p.location_id === locationId &&
             p.status === "COMPLETED";
    });

    const lwTotalCents = lwPayments.reduce(
      (sum, p) => sum + (p.amount_money?.amount || 0), 0
    );
    const lwTotalDollars = (lwTotalCents / 100).toFixed(2);

    const diff = totalCents - lwTotalCents;
    const diffSign = diff >= 0 ? "+" : "";
    const diffDollars = (diff / 100).toFixed(2);

    return {
      date: targetDate,
      revenue: `$${totalDollars}`,
      transactions: payments.length,
      vs_last_week: `${diffSign}$${diffDollars}`,
      last_week_revenue: `$${lwTotalDollars}`
    };
  } catch (err) {
    return { error: `Square API failed: ${err.message}` };
  }
}
