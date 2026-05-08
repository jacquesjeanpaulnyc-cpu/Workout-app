/**
 * Date Utilities — Eastern Time aware
 *
 * Node on Railway runs in UTC. `new Date("2026-04-11")` creates midnight UTC
 * which is 8 PM Friday ET — NOT Saturday. This breaks every day-of-week
 * calculation.
 *
 * This module parses YYYY-MM-DD strings as Eastern Time dates and provides
 * correct day-of-week, day name, and formatting.
 */

const DAY_NAMES_SHORT = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const DAY_NAMES_LONG = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const MONTH_NAMES = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/**
 * Parse a YYYY-MM-DD string as an ET date.
 * Returns a Date object representing noon ET of that day (avoids DST edge cases).
 */
export function parseET(dateStr) {
  // Parse as noon ET (-04:00 EDT) — this is unambiguously "that day" in ET
  // Using noon avoids DST transition bugs
  const [year, month, day] = dateStr.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day, 16, 0, 0)); // 16:00 UTC = 12:00 EDT
}

/**
 * Get day of week (0=Sun, 6=Sat) for a YYYY-MM-DD string in ET.
 */
export function getETDayOfWeek(dateStr) {
  const d = parseET(dateStr);
  // Get the day in UTC — since we set noon ET, the UTC day is the same calendar day
  return d.getUTCDay();
}

/**
 * Get short day name ("Mon", "Tue"...) for a YYYY-MM-DD string.
 */
export function getETDayName(dateStr) {
  return DAY_NAMES_SHORT[getETDayOfWeek(dateStr)];
}

/**
 * Get long day name ("Monday", "Tuesday"...).
 */
export function getETDayNameLong(dateStr) {
  return DAY_NAMES_LONG[getETDayOfWeek(dateStr)];
}

/**
 * Add days to a YYYY-MM-DD string, return new YYYY-MM-DD string (ET-correct).
 */
export function addDays(dateStr, days) {
  const d = parseET(dateStr);
  d.setUTCDate(d.getUTCDate() + days);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;
}

/**
 * Get today's date in ET as YYYY-MM-DD.
 */
export function todayET() {
  return new Date().toLocaleDateString("en-CA", { timeZone: "America/New_York" });
}

/**
 * Format a YYYY-MM-DD as "Apr 11".
 */
export function formatMonthDay(dateStr) {
  const [, month, day] = dateStr.split("-").map(Number);
  return `${MONTH_NAMES[month - 1]} ${day}`;
}
