/**
 * Send Reminder Tool — Schedule a message to fire at a specific time
 */

import cron from "node-cron";

// Active reminders store
const activeReminders = new Map();
let reminderCounter = 0;

export const definition = {
  name: "send_reminder",
  description: "Schedule a reminder to be sent at a specific time today or a future date. Parse the time from Jay's message. Examples: 'remind me at 3pm to call Selena', 'reminder at 9:30am check Square'.",
  input_schema: {
    type: "object",
    properties: {
      message: {
        type: "string",
        description: "The reminder message to send"
      },
      hour: {
        type: "number",
        description: "Hour in 24h format (0-23)"
      },
      minute: {
        type: "number",
        description: "Minute (0-59)"
      },
      day_of_month: {
        type: "number",
        description: "Day of month (1-31). Optional, defaults to today."
      },
      month: {
        type: "number",
        description: "Month (1-12). Optional, defaults to current month."
      }
    },
    required: ["message", "hour", "minute"]
  }
};

export function execute({ message, hour, minute, day_of_month, month }, sendTelegram) {
  const id = ++reminderCounter;

  const now = new Date();
  const targetMonth = month || (now.getMonth() + 1);
  const targetDay = day_of_month || now.getDate();

  // Build cron expression: minute hour day month *
  const cronExpr = `${minute} ${hour} ${targetDay} ${targetMonth} *`;

  // Validate
  if (!cron.validate(cronExpr)) {
    return { error: `Invalid time: ${hour}:${String(minute).padStart(2, "0")}` };
  }

  const task = cron.schedule(cronExpr, () => {
    const reminderText = `⏰ REMINDER: ${message}`;
    sendTelegram(reminderText);
    task.stop();
    activeReminders.delete(id);
  }, { timezone: "America/New_York" });

  activeReminders.set(id, { task, message, time: `${hour}:${String(minute).padStart(2, "0")}` });

  const ampm = hour >= 12 ? "PM" : "AM";
  const displayHour = hour > 12 ? hour - 12 : hour === 0 ? 12 : hour;
  const displayTime = `${displayHour}:${String(minute).padStart(2, "0")} ${ampm}`;

  return {
    confirmed: true,
    reminder_id: id,
    time: displayTime,
    message: message,
    summary: `Reminder set for ${displayTime} ET`
  };
}

export function getActiveReminders() {
  const list = [];
  for (const [id, r] of activeReminders) {
    list.push({ id, time: r.time, message: r.message });
  }
  return list;
}
