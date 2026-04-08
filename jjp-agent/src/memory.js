/**
 * Memory Module — Persistent context across conversations
 * Stores decisions, priorities, messages, and flagged items in memory.json
 */

import { readFileSync, writeFileSync, existsSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const MEMORY_PATH = join(__dirname, "..", "memory.json");

const DEFAULT_MEMORY = {
  decisions: [],
  priorities: [],
  flags: [],
  reminders: [],
  recent_messages: [],
  notes: []
};

let memory = null;

/**
 * Load memory from disk
 */
export function loadMemory() {
  try {
    if (existsSync(MEMORY_PATH)) {
      const raw = readFileSync(MEMORY_PATH, "utf-8");
      memory = JSON.parse(raw);
      // Ensure all fields exist
      for (const key of Object.keys(DEFAULT_MEMORY)) {
        if (!memory[key]) memory[key] = [];
      }
    } else {
      memory = structuredClone(DEFAULT_MEMORY);
      saveMemory();
    }
  } catch (err) {
    console.error("[MEMORY] Failed to load:", err.message);
    memory = structuredClone(DEFAULT_MEMORY);
  }
  return memory;
}

/**
 * Save memory to disk
 */
export function saveMemory() {
  try {
    writeFileSync(MEMORY_PATH, JSON.stringify(memory, null, 2), "utf-8");
  } catch (err) {
    console.error("[MEMORY] Failed to save:", err.message);
  }
}

/**
 * Add a message to recent history (keeps last 10)
 */
/**
 * Add a message to recent history (keeps last 10)
 */
export function addMessage(role, text) {
  if (!memory) loadMemory();
  memory.recent_messages.push({
    role,
    text: text.slice(0, 500),
    timestamp: new Date().toISOString()
  });
  // Keep last 10
  if (memory.recent_messages.length > 10) {
    memory.recent_messages = memory.recent_messages.slice(-10);
  }
  saveMemory();
}

/**
 * Get recent messages for multi-turn context
 */
export function getRecentMessages() {
  if (!memory) loadMemory();
  return memory.recent_messages;
}

/**
 * Remember something permanently
 */
export function remember(item, category = "notes") {
  if (!memory) loadMemory();
  const entry = {
    content: item,
    created: new Date().toISOString()
  };

  // Detect category from content
  const lower = item.toLowerCase();
  if (lower.includes("priority") || lower.includes("important") || lower.includes("focus")) {
    category = "priorities";
  } else if (lower.includes("decided") || lower.includes("decision") || lower.includes("going to")) {
    category = "decisions";
  } else if (lower.includes("flag") || lower.includes("watch") || lower.includes("track")) {
    category = "flags";
  }

  memory[category].push(entry);
  saveMemory();
  return { category, entry };
}

/**
 * Forget something from memory
 */
export function forget(query) {
  if (!memory) loadMemory();
  const lower = query.toLowerCase();
  let removed = 0;

  for (const category of ["notes", "priorities", "decisions", "flags"]) {
    const before = memory[category].length;
    memory[category] = memory[category].filter(
      item => !item.content.toLowerCase().includes(lower)
    );
    removed += before - memory[category].length;
  }

  saveMemory();
  return { removed, query };
}

/**
 * Track a reminder
 */
export function trackReminder(message, time, status = "pending") {
  if (!memory) loadMemory();
  memory.reminders.push({
    message,
    time,
    status,
    created: new Date().toISOString()
  });
  // Keep last 20 reminders
  if (memory.reminders.length > 20) {
    memory.reminders = memory.reminders.slice(-20);
  }
  saveMemory();
}

/**
 * Mark a reminder as sent
 */
export function markReminderSent(message) {
  if (!memory) loadMemory();
  const reminder = memory.reminders.find(
    r => r.message === message && r.status === "pending"
  );
  if (reminder) {
    reminder.status = "sent";
    saveMemory();
  }
}

/**
 * Get full memory summary for system prompt injection
 */
export function getMemoryContext() {
  if (!memory) loadMemory();

  const sections = [];

  if (memory.priorities.length > 0) {
    sections.push("CURRENT PRIORITIES:\n" +
      memory.priorities.map(p => `- ${p.content}`).join("\n"));
  }

  if (memory.decisions.length > 0) {
    sections.push("KEY DECISIONS:\n" +
      memory.decisions.map(d => `- ${d.content}`).join("\n"));
  }

  if (memory.flags.length > 0) {
    sections.push("FLAGGED ITEMS:\n" +
      memory.flags.map(f => `- ${f.content}`).join("\n"));
  }

  if (memory.notes.length > 0) {
    sections.push("NOTES:\n" +
      memory.notes.map(n => `- ${n.content}`).join("\n"));
  }

  const pendingReminders = memory.reminders.filter(r => r.status === "pending");
  if (pendingReminders.length > 0) {
    sections.push("PENDING REMINDERS:\n" +
      pendingReminders.map(r => `- ${r.time}: ${r.message}`).join("\n"));
  }

  if (memory.recent_messages.length > 0) {
    sections.push("RECENT CONVERSATION:\n" +
      memory.recent_messages.map(m =>
        `[${m.role}] ${m.text}`
      ).join("\n"));
  }

  return sections.length > 0
    ? "\n\n--- MEMORY ---\n" + sections.join("\n\n")
    : "";
}

/**
 * Get a human-readable summary of all memory
 */
export function getMemorySummary() {
  if (!memory) loadMemory();

  const lines = [];

  if (memory.priorities.length > 0) {
    lines.push("PRIORITIES:");
    memory.priorities.forEach(p => lines.push(`  • ${p.content}`));
  }

  if (memory.decisions.length > 0) {
    lines.push("\nDECISIONS:");
    memory.decisions.forEach(d => lines.push(`  • ${d.content}`));
  }

  if (memory.flags.length > 0) {
    lines.push("\nFLAGGED:");
    memory.flags.forEach(f => lines.push(`  • ${f.content}`));
  }

  if (memory.notes.length > 0) {
    lines.push("\nNOTES:");
    memory.notes.forEach(n => lines.push(`  • ${n.content}`));
  }

  const pending = memory.reminders.filter(r => r.status === "pending");
  if (pending.length > 0) {
    lines.push("\nPENDING REMINDERS:");
    pending.forEach(r => lines.push(`  • ${r.time}: ${r.message}`));
  }

  lines.push(`\n${memory.recent_messages.length} recent messages in context.`);

  return lines.length > 1 ? lines.join("\n") : "Memory is empty. Tell me to remember something.";
}
