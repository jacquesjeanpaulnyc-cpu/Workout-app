/**
 * Mem0 Memory Module — Persistent AI memory via Mem0 Cloud
 *
 * Uses Mem0's managed memory service for semantic search,
 * auto-extraction, and persistent memory across restarts.
 *
 * Also keeps a local message buffer for multi-turn context.
 */

import { MemoryClient } from "mem0ai";
import { readFileSync, writeFileSync, existsSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const LOCAL_BUFFER_PATH = join(__dirname, "..", "message-buffer.json");

const USER_ID = "jay_jjp";

let client = null;
let recentMessages = [];

/**
 * Initialize Mem0 client
 */
export function initMemory() {
  const apiKey = process.env.MEM0_API_KEY;
  if (!apiKey) {
    console.warn("[MEM0] MEM0_API_KEY not set — memory disabled. Get a free key at https://app.mem0.ai");
    return false;
  }

  client = new MemoryClient({ apiKey });
  console.log("[MEM0] Memory client initialized for user:", USER_ID);

  // Load local message buffer
  loadMessageBuffer();
  return true;
}

/**
 * Load recent messages from disk (survives restarts)
 */
function loadMessageBuffer() {
  try {
    if (existsSync(LOCAL_BUFFER_PATH)) {
      recentMessages = JSON.parse(readFileSync(LOCAL_BUFFER_PATH, "utf-8"));
    }
  } catch {
    recentMessages = [];
  }
}

/**
 * Save recent messages to disk
 */
function saveMessageBuffer() {
  try {
    writeFileSync(LOCAL_BUFFER_PATH, JSON.stringify(recentMessages, null, 2), "utf-8");
  } catch (err) {
    console.error("[MEM0] Failed to save message buffer:", err.message);
  }
}

/**
 * Add a message to recent history (keeps last 10)
 */
export function addMessage(role, text) {
  recentMessages.push({
    role,
    text: text.slice(0, 500),
    timestamp: new Date().toISOString()
  });
  if (recentMessages.length > 10) {
    recentMessages = recentMessages.slice(-10);
  }
  saveMessageBuffer();
}

/**
 * Get recent messages for multi-turn context
 */
export function getRecentMessages() {
  return recentMessages;
}

/**
 * Add a memory to Mem0 (explicit "remember that...")
 */
export async function remember(text) {
  if (!client) return { saved: false, reason: "Mem0 not configured" };

  try {
    const result = await client.add([
      { role: "user", content: `Remember this: ${text}` }
    ], {
      user_id: USER_ID,
      metadata: { source: "explicit", timestamp: new Date().toISOString() }
    });
    console.log("[MEM0] Saved explicit memory:", text.slice(0, 80));
    return { saved: true, memories: result.results || result };
  } catch (err) {
    console.error("[MEM0] Failed to save:", err.message);
    return { saved: false, reason: err.message };
  }
}

/**
 * Auto-save conversation context to Mem0 (after every exchange)
 */
export async function autoSave(userMessage, agentResponse) {
  if (!client) return;

  try {
    await client.add([
      { role: "user", content: userMessage },
      { role: "assistant", content: agentResponse }
    ], {
      user_id: USER_ID,
      metadata: { source: "auto", timestamp: new Date().toISOString() }
    });
    console.log("[MEM0] Auto-saved conversation context");
  } catch (err) {
    console.error("[MEM0] Auto-save failed:", err.message);
  }
}

/**
 * Search Mem0 for relevant memories
 */
export async function search(query, limit = 5) {
  if (!client) return [];

  try {
    const results = await client.search(query, {
      user_id: USER_ID,
      limit
    });
    return results.results || results || [];
  } catch (err) {
    console.error("[MEM0] Search failed:", err.message);
    return [];
  }
}

/**
 * Get all memories
 */
export async function getAll() {
  if (!client) return [];

  try {
    const results = await client.getAll({
      user_id: USER_ID,
      limit: 50
    });
    return results.results || results || [];
  } catch (err) {
    console.error("[MEM0] GetAll failed:", err.message);
    return [];
  }
}

/**
 * Delete memories matching a query
 */
export async function forget(query) {
  if (!client) return { removed: 0 };

  try {
    // Search for matching memories first
    const matches = await search(query, 10);
    let removed = 0;

    for (const mem of matches) {
      const memId = mem.id || mem.memory_id;
      if (memId) {
        try {
          await client.delete(memId);
          removed++;
        } catch {
          // Skip if can't delete
        }
      }
    }

    console.log(`[MEM0] Removed ${removed} memories matching: ${query}`);
    return { removed, query };
  } catch (err) {
    console.error("[MEM0] Forget failed:", err.message);
    return { removed: 0, error: err.message };
  }
}

/**
 * Build memory context string for system prompt injection
 */
export async function getMemoryContext(query) {
  if (!client) return "";

  try {
    const memories = await search(query, 8);
    if (!memories.length) return "";

    const items = memories.map(m => {
      const text = m.memory || m.content || m.text || JSON.stringify(m);
      return `- ${text}`;
    }).join("\n");

    return `\n\n═══ RELEVANT MEMORIES ═══\n${items}`;
  } catch {
    return "";
  }
}

/**
 * Get a human-readable summary of all memories
 */
export async function getMemorySummary() {
  if (!client) return "Mem0 not configured. Add MEM0_API_KEY to .env (free at https://app.mem0.ai)";

  try {
    const all = await getAll();
    if (!all.length) return "Memory is empty. Tell me to remember something.";

    const lines = all.map(m => {
      const text = m.memory || m.content || m.text || JSON.stringify(m);
      return `• ${text}`;
    });

    return `MEMORY (${all.length} items):\n${lines.join("\n")}\n\n${recentMessages.length} recent messages in context.`;
  } catch (err) {
    return `Memory error: ${err.message}`;
  }
}

/**
 * Track a reminder in memory
 */
export async function trackReminder(message, time) {
  if (!client) return;
  try {
    await client.add([
      { role: "user", content: `I set a reminder for ${time}: ${message}` }
    ], {
      user_id: USER_ID,
      metadata: { source: "reminder", time, status: "pending" }
    });
  } catch {
    // Best effort
  }
}
