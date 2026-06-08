/**
 * Calendar Tool — Creates calendar events via clickable links
 * No OAuth needed. Generates Google Calendar links that open directly.
 */

export const definition = {
  name: "google_calendar",
  description: "Add events to Jay's Google Calendar by generating a direct 'Add to Calendar' link. Use when Jay asks to add something to calendar, schedule a meeting, or block time. Also tracks events locally.",
  input_schema: {
    type: "object",
    properties: {
      action: {
        type: "string",
        enum: ["create_event", "list_events"],
        description: "create_event to add a new event, list_events to see locally tracked upcoming events"
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
      }
    },
    required: ["action"]
  }
};

// Local event tracker (persists in memory while agent runs)
const trackedEvents = [];

export async function execute({ action, title, date, start_time, end_time, description }) {
  if (action === "create_event") {
    return createEvent({ title, date, start_time, end_time, description });
  } else if (action === "list_events") {
    return listEvents();
  }
  return { error: `Unknown action: ${action}` };
}

function createEvent({ title, date, start_time, end_time, description }) {
  if (!title) return { error: "Event title is required" };

  const eventDate = date || new Date().toISOString().split("T")[0];

  // Calculate times
  let startDT, endDT;
  if (start_time) {
    const [h, m] = start_time.split(":").map(Number);
    startDT = `${eventDate.replace(/-/g, "")}T${String(h).padStart(2, "0")}${String(m).padStart(2, "0")}00`;

    if (end_time) {
      const [eh, em] = end_time.split(":").map(Number);
      endDT = `${eventDate.replace(/-/g, "")}T${String(eh).padStart(2, "0")}${String(em).padStart(2, "0")}00`;
    } else {
      const endH = h + 1;
      endDT = `${eventDate.replace(/-/g, "")}T${String(endH).padStart(2, "0")}${String(m).padStart(2, "0")}00`;
    }
  } else {
    // All-day event
    startDT = eventDate.replace(/-/g, "");
    endDT = startDT;
  }

  // Build Google Calendar URL
  const params = new URLSearchParams({
    action: "TEMPLATE",
    text: title,
    dates: `${startDT}/${endDT}`,
    ctz: "America/New_York"
  });
  if (description) params.set("details", description);

  const calLink = `https://calendar.google.com/calendar/render?${params.toString()}`;

  // Track locally
  const event = {
    title,
    date: eventDate,
    time: start_time || "all day",
    description: description || "",
    created: new Date().toISOString()
  };
  trackedEvents.push(event);

  const timeStr = start_time ? ` at ${start_time}` : " (all day)";

  return {
    confirmed: true,
    title,
    date: eventDate,
    time: timeStr,
    calendar_link: calLink,
    summary: `"${title}" — ${eventDate}${timeStr}\n\nTap to add to Google Calendar:\n${calLink}`
  };
}

function listEvents() {
  if (trackedEvents.length === 0) {
    return { events: [], summary: "No events tracked this session. Ask me to create one." };
  }

  const upcoming = trackedEvents
    .filter(e => e.date >= new Date().toISOString().split("T")[0])
    .sort((a, b) => a.date.localeCompare(b.date));

  return {
    count: upcoming.length,
    events: upcoming.map(e => ({
      title: e.title,
      date: e.date,
      time: e.time
    }))
  };
}
