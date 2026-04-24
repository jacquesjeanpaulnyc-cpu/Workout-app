/**
 * Supabase Query Tool — Pull WaxOS pilot data
 *
 * Tables available:
 *   Appointements — id, client_id, specialist_id, service_id, scheduled_at, status,
 *                   price, duration_minutes, source, needs_confirmation, no_show_risk_score
 *   clients       — id, first_name, last_name, email, phone, is_inactive, sms_opt_in, square_customer_id
 *   specialists   — id, full_name, email, availability, business_name
 *   messages      — messaging/SMS logs
 *   no_show_events — no-show tracking
 *   reactivation_campaigns / reactivation_events / reactivation_metrics — win-back campaigns
 *   flash_slots   — last-minute availability slots
 *   provider_services / service_templates — service catalog
 *   dashboard_today_schedule / dashboard_upcoming_count / dashboard_revenue_protected — dashboard views
 */

import { fetch as undiciFetch, ProxyAgent } from "undici";

const proxyUrl = process.env.HTTPS_PROXY || process.env.https_proxy || process.env.HTTP_PROXY || process.env.http_proxy;
const dispatcher = proxyUrl ? new ProxyAgent(proxyUrl) : undefined;

async function supabaseGet(path) {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_KEY;
  const res = await undiciFetch(`${url}/rest/v1/${path}`, {
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
      Prefer: "count=exact"
    },
    ...(dispatcher ? { dispatcher } : {})
  });
  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Supabase ${res.status}: ${errText}`);
  }
  const total = res.headers.get("content-range")?.split("/")[1] || null;
  const data = await res.json();
  return { data, total: total ? parseInt(total) : data.length };
}

export const definition = {
  name: "supabase_query",
  description: "Query WaxOS pilot data from Supabase. Use for any question about: pilot activity, appointments, clients, specialists (Anyssa, Selena, Dallas), no-shows, reactivation campaigns, services, or scheduling. Available queries: pilot_summary, appointments, clients, specialists, no_shows, reactivations.",
  input_schema: {
    type: "object",
    properties: {
      query_type: {
        type: "string",
        enum: ["pilot_summary", "appointments", "clients", "specialists", "no_shows", "reactivations"],
        description: "What data to pull. pilot_summary gives a full overview."
      },
      status_filter: {
        type: "string",
        description: "Filter appointments by status: scheduled, completed, cancelled, no_show"
      },
      specialist_name: {
        type: "string",
        description: "Filter by specialist name (Anyssa, Selena, Dallas)"
      },
      days_back: {
        type: "number",
        description: "How many days back to look. Defaults to 30."
      }
    },
    required: ["query_type"]
  }
};

// Map specialist names to IDs
const SPECIALISTS = {
  anyssa: "5d2b5acd-81bf-42fb-85fd-a26892253175",
  selena: "20a84cb4-7888-4cd2-ae1f-9b155d09ec27",
  dallas: "903ec9a5-02de-4033-957f-8a36e58ffe54"
};

export async function execute({ query_type, status_filter, specialist_name, days_back }) {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_KEY;

  if (!url || !key) {
    return { error: "Supabase not configured. Add SUPABASE_URL and SUPABASE_SERVICE_KEY to .env" };
  }

  const daysBack = days_back || 30;
  const since = new Date();
  since.setDate(since.getDate() - daysBack);
  const sinceISO = since.toISOString();

  try {
    switch (query_type) {
      case "pilot_summary":
        return await getPilotSummary(sinceISO);
      case "appointments":
        return await getAppointments(sinceISO, status_filter, specialist_name);
      case "clients":
        return await getClients();
      case "specialists":
        return await getSpecialists();
      case "no_shows":
        return await getNoShows(sinceISO);
      case "reactivations":
        return await getReactivations();
      default:
        return { error: `Unknown query type: ${query_type}` };
    }
  } catch (err) {
    return { error: `Supabase query failed: ${err.message}` };
  }
}

async function getPilotSummary(sinceISO) {
  const [appts, clients, specialists, noShows, reactivations] = await Promise.all([
    supabaseGet(`Appointements?select=id,status,price,specialist_id,scheduled_at&created_at=gte.${sinceISO}`),
    supabaseGet("clients?select=id,is_inactive"),
    supabaseGet("specialists?select=id,full_name"),
    supabaseGet(`no_show_events?select=id&created_at=gte.${sinceISO}`),
    supabaseGet("reactivation_campaigns?select=id,status")
  ]);

  const appointments = appts.data;
  const scheduled = appointments.filter(a => a.status === "scheduled").length;
  const completed = appointments.filter(a => a.status === "completed").length;
  const cancelled = appointments.filter(a => a.status === "cancelled").length;
  const totalRevenue = appointments
    .filter(a => a.status === "completed")
    .reduce((sum, a) => sum + (a.price || 0), 0);
  const upcomingRevenue = appointments
    .filter(a => a.status === "scheduled")
    .reduce((sum, a) => sum + (a.price || 0), 0);

  const totalClients = clients.total;
  const activeClients = clients.data.filter(c => !c.is_inactive).length;
  const inactiveClients = clients.data.filter(c => c.is_inactive).length;

  return {
    period: `Last ${Math.round((Date.now() - new Date(sinceISO)) / 86400000)} days`,
    appointments: {
      total: appointments.length,
      scheduled,
      completed,
      cancelled,
      no_shows: noShows.total
    },
    revenue: {
      completed: `$${totalRevenue.toFixed(2)}`,
      upcoming_booked: `$${upcomingRevenue.toFixed(2)}`
    },
    clients: {
      total: totalClients,
      active: activeClients,
      inactive: inactiveClients
    },
    specialists: specialists.data.map(s => s.full_name),
    reactivation_campaigns: reactivations.total
  };
}

async function getAppointments(sinceISO, statusFilter, specialistName) {
  let query = `Appointements?select=id,status,price,scheduled_at,specialist_id,duration_minutes,source&created_at=gte.${sinceISO}&order=scheduled_at.desc&limit=20`;
  if (statusFilter) query += `&status=eq.${statusFilter}`;
  if (specialistName) {
    const specId = SPECIALISTS[specialistName.toLowerCase()];
    if (specId) query += `&specialist_id=eq.${specId}`;
  }
  const result = await supabaseGet(query);
  return {
    count: result.total,
    recent: result.data.map(a => ({
      status: a.status,
      price: `$${a.price || 0}`,
      date: a.scheduled_at?.split("T")[0],
      duration: `${a.duration_minutes}min`,
      source: a.source
    }))
  };
}

async function getClients() {
  const [total, active, inactive, recent] = await Promise.all([
    supabaseGet("clients?select=id"),
    supabaseGet("clients?select=id&is_inactive=eq.false"),
    supabaseGet("clients?select=id&is_inactive=eq.true"),
    supabaseGet("clients?select=first_name,last_name,created_at,is_inactive&order=created_at.desc&limit=5")
  ]);

  return {
    total: total.total,
    active: active.total,
    inactive: inactive.total,
    newest_clients: recent.data.map(c => ({
      name: `${c.first_name} ${c.last_name}`,
      joined: c.created_at?.split("T")[0],
      active: !c.is_inactive
    }))
  };
}

async function getSpecialists() {
  const result = await supabaseGet("specialists?select=id,full_name,availability,business_name");
  return {
    count: result.data.length,
    specialists: result.data.map(s => ({
      name: s.full_name,
      business: s.business_name,
      days_available: Object.keys(s.availability || {})
    }))
  };
}

async function getNoShows(sinceISO) {
  const result = await supabaseGet(`no_show_events?select=*&created_at=gte.${sinceISO}&order=created_at.desc&limit=10`);
  return {
    total_no_shows: result.total,
    recent: result.data
  };
}

async function getReactivations() {
  const [campaigns, metrics] = await Promise.all([
    supabaseGet("reactivation_campaigns?select=*&order=created_at.desc&limit=5"),
    supabaseGet("reactivation_metrics?select=*&limit=5")
  ]);
  return {
    campaigns: campaigns.data,
    metrics: metrics.data
  };
}
