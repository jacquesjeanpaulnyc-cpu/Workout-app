/**
 * Salon Schedule — Exact hours from Square API
 *
 * Mon: 10:00-13:30, 17:00-20:00 (two windows)
 * Tue: 16:00-20:00
 * Wed: 09:00-12:20, 17:00-20:00 (two windows)
 * Thu: CLOSED
 * Fri: 09:00-14:00
 * Sat: 09:00-13:00
 * Sun: CLOSED
 */

// dayOfWeek: 0=Sun, 1=Mon, 2=Tue, 3=Wed, 4=Thu, 5=Fri, 6=Sat
export const SALON_SCHEDULE = {
  0: null,  // Sunday — CLOSED
  1: [      // Monday
    { open: 10, openMin: 0, close: 13, closeMin: 30 },
    { open: 17, openMin: 0, close: 20, closeMin: 0 }
  ],
  2: [      // Tuesday
    { open: 16, openMin: 0, close: 20, closeMin: 0 }
  ],
  3: [      // Wednesday
    { open: 9, openMin: 0, close: 12, closeMin: 20 },
    { open: 17, openMin: 0, close: 20, closeMin: 0 }
  ],
  4: null,  // Thursday — CLOSED
  5: [      // Friday
    { open: 9, openMin: 0, close: 14, closeMin: 0 }
  ],
  6: [      // Saturday
    { open: 9, openMin: 0, close: 13, closeMin: 0 }
  ]
};

export const DAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/**
 * Is the salon open on this day of week?
 */
export function isSalonDay(dayOfWeek) {
  return SALON_SCHEDULE[dayOfWeek] !== null;
}

/**
 * Is the salon currently in an open window?
 * @param {number} dayOfWeek - 0=Sun..6=Sat
 * @param {number} hour - 0-23
 * @param {number} minute - 0-59
 */
export function isInOpenWindow(dayOfWeek, hour, minute = 0) {
  const windows = SALON_SCHEDULE[dayOfWeek];
  if (!windows) return false;

  const timeMinutes = hour * 60 + minute;
  return windows.some(w => {
    const openMin = w.open * 60 + w.openMin;
    const closeMin = w.close * 60 + w.closeMin;
    return timeMinutes >= openMin && timeMinutes < closeMin;
  });
}

/**
 * Get today's windows as formatted strings
 */
export function getTodayWindows(dayOfWeek) {
  const windows = SALON_SCHEDULE[dayOfWeek];
  if (!windows) return ["CLOSED"];

  return windows.map(w => {
    const openStr = `${w.open}:${String(w.openMin).padStart(2, "0")}`;
    const closeStr = `${w.close}:${String(w.closeMin).padStart(2, "0")}`;
    return `${openStr}-${closeStr}`;
  });
}

/**
 * Get the last closing time for the day (used for EOD logic)
 */
export function getLastCloseTime(dayOfWeek) {
  const windows = SALON_SCHEDULE[dayOfWeek];
  if (!windows || windows.length === 0) return null;
  const last = windows[windows.length - 1];
  return { hour: last.close, minute: last.closeMin };
}

/**
 * Get check times for the day — 30 min after open, 30 min before close of each window
 */
export function getCheckTimes(dayOfWeek) {
  const windows = SALON_SCHEDULE[dayOfWeek];
  if (!windows) return [];

  const times = [];
  for (const w of windows) {
    // 30 min after opening
    const afterOpen = w.open * 60 + w.openMin + 30;
    times.push({ hour: Math.floor(afterOpen / 60), minute: afterOpen % 60, label: "post-open" });

    // 30 min before closing
    const beforeClose = w.close * 60 + w.closeMin - 30;
    times.push({ hour: Math.floor(beforeClose / 60), minute: beforeClose % 60, label: "pre-close" });
  }
  return times;
}
