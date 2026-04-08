/**
 * Google Calendar Tool — Create and list calendar events
 * Uses Google Calendar API v3 with OAuth2.
 */

import { google } from "googleapis";

let calendarClient = null;

function getCalendar() {
  if (calendarClient) return calendarClient;

  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  const refreshToken = process.env.GOOGLE_REFRESH_TOKEN;

  if (!clientId || !clientSecret || !refreshToken) return null;

  const oauth2 = new google.auth.OAuth2(clientId, clientSecret);
  oauth2.setCredentials({ refresh_token: refreshToken });

  calendarClient = google.calendar({ version: "v3", auth: oauth2 });
  return calendarClient;
}

export const definition = {
  name: "google_calendar",
  description: "Manage Jay's Google Calendar. Create events, list upcoming events, or check schedule for a specific day. Use when Jay asks to add something to calendar, check his schedule, or block time.",
  input_schema: {
    type: "object",
    properties: {
      action: {
        type: "string",
        enum: ["create_event", "list_events"],
        description: "create_event to add a new event, list_events to see upcoming schedule"
      },
      title: {
        type: "string",
        description: "Event title (for create_event)"
      },
      date: {
        type: "string",
        description: "Date in YYYY-MM-DD format"
      },
      start_time: {
        type: "string",
        description: "Start time in HH:MM 24h format (for create_event). Omit for all-day event."
      },
      end_time: {
        type: "string",
        description: "End time in HH:MM 24h format (for create_event). Defaults to 1 hour after start."
      },
      description: {
        type: "string",
        description: "Event description/notes (for create_event)"
      },
      days_ahead: {
        type: "number",
        description: "How many days ahead to list events (for list_events). Defaults to 7."
      }
    },
    required: ["action"]
  }
};

export async function execute({ action, title, date, start_time, end_time, description, days_ahead }) {
  const calendar = getCalendar();

  if (!calendar) {
    return {
      error: "Google Calendar not configured. Add GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, and GOOGLE_REFRESH_TOKEN to .env. Run 'node src/google-auth.js' to set up."
    };
  }

  try {
    if (action === "create_event") {
      return await createEvent(calendar, { title, date, start_time, end_time, description });
    } else if (action === "list_events") {
      return await listEvents(calendar, { date, days_ahead });
    }
    return { error: `Unknown action: ${action}` };
  } catch (err) {
    return { error: `Calendar failed: ${err.message}` };
  }
}

async function createEvent(calendar, { title, date, start_time, end_time, description }) {
  if (!title) return { error: "Event title is required" };

  const eventDate = date || new Date().toISOString().split("T")[0];
  let event;

  if (start_time) {
    // Timed event
    const startDateTime = `${eventDate}T${start_time}:00`;
    let endDateTime;
    if (end_time) {
      endDateTime = `${eventDate}T${end_time}:00`;
    } else {
      // Default 1 hour duration
      const [h, m] = start_time.split(":").map(Number);
      const endH = String(h + 1).padStart(2, "0");
      endDateTime = `${eventDate}T${endH}:${String(m).padStart(2, "0")}:00`;
    }

    event = {
      summary: title,
      description: description || "",
      start: { dateTime: startDateTime, timeZone: "America/New_York" },
      end: { dateTime: endDateTime, timeZone: "America/New_York" }
    };
  } else {
    // All-day event
    event = {
      summary: title,
      description: description || "",
      start: { date: eventDate },
      end: { date: eventDate }
    };
  }

  const res = await calendar.events.insert({
    calendarId: "primary",
    resource: event
  });

  const created = res.data;
  const timeStr = start_time ? ` at ${start_time}` : " (all day)";

  return {
    confirmed: true,
    event_id: created.id,
    title: created.summary,
    date: eventDate,
    time: timeStr,
    link: created.htmlLink,
    summary: `Event "${title}" added to calendar — ${eventDate}${timeStr}`
  };
}

async function listEvents(calendar, { date, days_ahead }) {
  const now = new Date();
  let timeMin, timeMax;

  if (date) {
    // Specific day
    timeMin = `${date}T00:00:00-04:00`;
    timeMax = `${date}T23:59:59-04:00`;
  } else {
    // Next N days
    const daysToShow = days_ahead || 7;
    timeMin = now.toISOString();
    const end = new Date(now);
    end.setDate(end.getDate() + daysToShow);
    timeMax = end.toISOString();
  }

  const res = await calendar.events.list({
    calendarId: "primary",
    timeMin,
    timeMax,
    singleEvents: true,
    orderBy: "startTime",
    maxResults: 15
  });

  const events = (res.data.items || []).map(e => ({
    title: e.summary,
    date: e.start.date || e.start.dateTime?.split("T")[0],
    time: e.start.dateTime
      ? new Date(e.start.dateTime).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", timeZone: "America/New_York" })
      : "All day",
    end_time: e.end.dateTime
      ? new Date(e.end.dateTime).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", timeZone: "America/New_York" })
      : null
  }));

  return {
    period: date || `Next ${days_ahead || 7} days`,
    count: events.length,
    events
  };
}
