/**
 * Salon Schedule — EXACT hours from Jay
 *
 * Mon: 3:00 PM - 8:00 PM
 * Tue: CLOSED
 * Wed: 9:00 AM - 2:00 PM + 3:00 PM - 8:00 PM (two windows)
 * Thu: CLOSED
 * Fri: 9:00 AM - 2:00 PM
 * Sat: 9:00 AM - 1:00 PM
 * Sun: CLOSED
 *
 * 4 working days. 3 closed days (Tue/Thu/Sun).
 */

// dayOfWeek: 0=Sun, 1=Mon, 2=Tue, 3=Wed, 4=Thu, 5=Fri, 6=Sat
export const SALON_SCHEDULE = {
  0: null,  // Sunday — CLOSED
  1: [      // Monday
    { open: 15, openMin: 0, close: 20, closeMin: 0 }
  ],
  2: null,  // Tuesday — CLOSED
  3: [      // Wednesday
    { open: 9, openMin: 0, close: 14, closeMin: 0 },
    { open: 15, openMin: 0, close: 20, closeMin: 0 }
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

export const OPEN_DAYS = [1, 3, 5, 6]; // Mon, Wed, Fri, Sat
export const CLOSED_DAYS = [0, 2, 4];  // Sun, Tue, Thu

export function isSalonDay(dayOfWeek) {
  return SALON_SCHEDULE[dayOfWeek] !== null;
}

export function isClosedDay(dayOfWeek) {
  return SALON_SCHEDULE[dayOfWeek] === null;
}

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

export function getTodayWindows(dayOfWeek) {
  const windows = SALON_SCHEDULE[dayOfWeek];
  if (!windows) return ["CLOSED"];
  return windows.map(w => {
    const openStr = `${w.open > 12 ? w.open - 12 : w.open}:${String(w.openMin).padStart(2, "0")} ${w.open >= 12 ? "PM" : "AM"}`;
    const closeStr = `${w.close > 12 ? w.close - 12 : w.close}:${String(w.closeMin).padStart(2, "0")} ${w.close >= 12 ? "PM" : "AM"}`;
    return `${openStr}-${closeStr}`;
  });
}
