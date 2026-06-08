/**
 * Calendar Intelligence — Pulls events from Google Calendar via iCal URL
 *
 * Features:
 * - Get today's events for morning briefing
 * - 15-minute pre-event alerts via Telegram
 * - Conflict detection
 * - Cognitive peak block awareness (7:21 AM - 10:43 AM)
 */

import ical from "node-ical";
import cron from "node-cron";

const ICAL_URL = process.env.GOOGLE_CALENDAR_ICAL_URL;

/**
 * Fetch and parse today's events from Google Calendar
 */
export async function getTodayEvents() {
  if (!ICAL_URL) return { events: [], error: "GOOGLE_CALENDAR_ICAL_URL not set" };

  try {
    const data = await ical.async.fromURL(ICAL_URL);
    const now = new Date();
    const todayStr = now.toLocaleDateString("en-CA", { timeZone: "America/New_York" });

    const events = [];

    for (const key in data) {
      const event = data[key];
      if (event.type !== "VEVENT") continue;

      const start = event.start ? new Date(event.start) : null;
      if (!start) continue;

      const eventDateStr = start.toLocaleDateString("en-CA", { timeZone: "America/New_York" });
      if (eventDateStr !== todayStr) continue;

      const end = event.end ? new Date(event.end) : null;
      const startTime = start.toLocaleTimeString("en-US", {
        hour: "numeric", minute: "2-digit", timeZone: "America/New_York"
      });
      const endTime = end ? end.toLocaleTimeString("en-US", {
        hour: "numeric", minute: "2-digit", timeZone: "America/New_York"
      }) : null;

      events.push({
        title: event.summary || "Untitled",
        startTime,
        endTime,
        startDate: start,
        endDate: end,
        location: event.location || null,
        description: event.description?.slice(0, 100) || null,
        allDay: !event.start.getHours && !event.start.getMinutes
      });
    }

    // Sort by start time
    events.sort((a, b) => a.startDate - b.startDate);

    return { events, error: null };
  } catch (err) {
    console.error("[CALENDAR] Failed to fetch events:", err.message);
    return { events: [], error: err.message };
  }
}

/**
 * Build calendar section for morning briefing
 */
export async function getCalendarBriefing() {
  const { events, error } = await getTodayEvents();

  if (error && events.length === 0) {
    return "📅 Calendar unavailable.";
  }

  if (events.length === 0) {
    return "📅 Full build day. Nothing on the calendar. Protect it.";
  }

  const lines = [`📅 Today's schedule (${events.length} event${events.length > 1 ? "s" : ""}):`];

  // Check for cognitive peak conflicts
  const peakStart = new Date(); peakStart.setHours(7, 21, 0);
  const peakEnd = new Date(); peakEnd.setHours(10, 43, 0);
  let peakConflict = false;

  for (const event of events) {
    const timeRange = event.endTime ? `${event.startTime}–${event.endTime}` : event.startTime;
    lines.push(`  • ${timeRange}: ${event.title}`);

    // Check if event overlaps cognitive peak
    if (event.startDate >= peakStart && event.startDate <= peakEnd) {
      peakConflict = true;
    }
  }

  // Check for back-to-back meetings
  for (let i = 1; i < events.length; i++) {
    const prevEnd = events[i - 1].endDate;
    const currStart = events[i].startDate;
    if (prevEnd && currStart && (currStart - prevEnd) < 15 * 60 * 1000) {
      lines.push(`  ⚠️ Back-to-back: ${events[i-1].title} → ${events[i].title}`);
    }
  }

  if (peakConflict) {
    lines.push("  ⚡ Heads up: event during cognitive peak (7:21–10:43 AM)");
  } else if (events.length > 0) {
    lines.push("  ⚡ Cognitive peak (7:21–10:43 AM) is clear — use it for deep work");
  }

  return lines.join("\n");
}

/**
 * Check for events starting in ~15 minutes and send alerts
 */
async function checkUpcomingEvents(sendToOwner) {
  const { events } = await getTodayEvents();
  const now = new Date();

  for (const event of events) {
    const minutesUntil = (event.startDate - now) / (1000 * 60);

    // Alert if event is 13-17 minutes away (window to catch it in the 5-min cron)
    if (minutesUntil >= 13 && minutesUntil <= 17) {
      const mins = Math.round(minutesUntil);
      await sendToOwner(`⏰ In ${mins} min: ${event.title}`);
      console.log(`[CALENDAR] Alert sent: ${event.title} in ${mins} min`);
    }
  }
}

/**
 * Start calendar event alert cron (checks every 5 minutes)
 */
export function startCalendarAlerts(sendToOwner) {
  if (!ICAL_URL) {
    console.log("[CALENDAR] iCal URL not set. Calendar alerts disabled.");
    return;
  }

  console.log("[CALENDAR] Event alerts active (checking every 5 min)");

  // Check every 5 minutes for upcoming events
  cron.schedule("*/5 * * * *", () => checkUpcomingEvents(sendToOwner), {
    timezone: "America/New_York"
  });
}
