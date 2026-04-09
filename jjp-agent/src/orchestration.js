/**
 * Orchestration Layer — Message queue, router, retry, logging
 *
 * Architecture:
 * 1. Message Queue — sequential processing, no collisions
 * 2. Smart Router — classifies intent before full Claude call
 * 3. Retry — exponential backoff on all external APIs
 * 4. Logger — all actions logged to Supabase agent_logs
 * 5. Health — tracks timestamps of all subsystems
 */

import { fetch as undiciFetch } from "undici";

// ── MESSAGE QUEUE ──
// Sequential processing — never drops messages

const messageQueue = [];
let isProcessing = false;

export function enqueue(task) {
  return new Promise((resolve, reject) => {
    messageQueue.push({ task, resolve, reject });
    processQueue();
  });
}

async function processQueue() {
  if (isProcessing) return;
  isProcessing = true;

  while (messageQueue.length > 0) {
    const { task, resolve, reject } = messageQueue.shift();
    try {
      const result = await task();
      resolve(result);
    } catch (err) {
      reject(err);
    }
  }

  isProcessing = false;
}

// ── SMART ROUTER ──
// Lightweight classification before full processing

const ROUTE_PATTERNS = {
  revenue: /revenue|sales|money|salon.*(make|made|earn)|square|how much|financial|transaction/i,
  waxos: /waxos|pilot|supabase|specialist|appointment|client.*data|reactivation/i,
  staff: /staff|selena|dallas|anyssa|who.*(working|carried|carrying)|performance|team/i,
  search: /search|look up|find|google|what is|who is|news about/i,
  reminder: /remind|reminder|alert me|notify me at|set.*timer/i,
  email: /email|inbox|gmail|check.*mail|scan.*mail/i,
  calendar: /calendar|schedule|what.*on.*today|meeting|event/i,
  memory: /remember|forget|memory|what do you know/i,
  cost: /^cost$|token usage|api cost|spending/i,
  reactivation: /reactivat|lapsed|win.*back|draft.*message|inactive.*client/i
};

export function classifyMessage(text) {
  const lower = text.toLowerCase();

  for (const [route, pattern] of Object.entries(ROUTE_PATTERNS)) {
    if (pattern.test(lower)) return route;
  }

  return "general";
}

// ── RETRY WITH BACKOFF ──

export async function withRetry(fn, serviceName, maxRetries = 3) {
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      const start = Date.now();
      const result = await fn();
      const latency = Date.now() - start;
      await logAction("api_call", `${serviceName} succeeded`, true, latency);
      return result;
    } catch (err) {
      const isLast = attempt === maxRetries - 1;
      console.error(`[RETRY] ${serviceName} attempt ${attempt + 1}/${maxRetries} failed: ${err.message}`);

      if (isLast) {
        await logAction("error", `${serviceName} failed after ${maxRetries} retries: ${err.message}`, false);
        throw err;
      }

      // Exponential backoff: 2s, 4s, 8s
      await new Promise(r => setTimeout(r, Math.pow(2, attempt + 1) * 1000));
    }
  }
}

// ── GRACEFUL DEGRADATION ──

export async function safeCall(fn, serviceName, fallback = null) {
  try {
    return await withRetry(fn, serviceName);
  } catch {
    console.log(`[DEGRADE] ${serviceName} unavailable. Using fallback.`);
    return fallback;
  }
}

// ── OBSERVABILITY — Supabase agent_logs ──

async function logAction(actionType, details, success = true, latencyMs = 0) {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_KEY;
  if (!url || !key) return;

  try {
    await fetch(`${url}/rest/v1/agent_logs`, {
      method: "POST",
      headers: {
        apikey: key,
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
        Prefer: "return=minimal"
      },
      body: JSON.stringify({
        action_type: actionType,
        details: String(details).slice(0, 500),
        success,
        latency_ms: latencyMs,
        created_at: new Date().toISOString()
      })
    });
  } catch {
    // Silent fail — logging should never break the agent
  }
}

export { logAction };

// ── HEALTH TRACKING ──

const healthState = {
  startTime: Date.now(),
  lastBriefing: null,
  lastSquareCheck: null,
  lastMem0Write: null,
  lastMessageReceived: null,
  lastError: null,
  messagesProcessed: 0,
  errorsCount: 0
};

export function updateHealth(key, value = new Date().toISOString()) {
  healthState[key] = value;
}

export function incrementMessages() {
  healthState.messagesProcessed++;
  healthState.lastMessageReceived = new Date().toISOString();
}

export function recordError(error) {
  healthState.errorsCount++;
  healthState.lastError = { message: error, at: new Date().toISOString() };
}

export function getHealthStatus() {
  const uptimeMs = Date.now() - healthState.startTime;
  const hours = Math.floor(uptimeMs / 3600000);
  const mins = Math.floor((uptimeMs % 3600000) / 60000);

  return {
    status: "online",
    agent: "JJP Agent — Autonomous Chief of Staff",
    uptime: `${hours}h ${mins}m`,
    queue_depth: messageQueue.length,
    messages_processed: healthState.messagesProcessed,
    errors_total: healthState.errorsCount,
    last: {
      briefing: healthState.lastBriefing,
      square_check: healthState.lastSquareCheck,
      mem0_write: healthState.lastMem0Write,
      message_received: healthState.lastMessageReceived,
      error: healthState.lastError
    },
    services: {
      telegram: "active",
      claude_api: "active",
      square: process.env.SQUARE_ACCESS_TOKEN ? "configured" : "not configured",
      supabase: process.env.SUPABASE_URL ? "configured" : "not configured",
      mem0: process.env.MEM0_API_KEY ? "configured" : "not configured",
      gmail: process.env.GMAIL_APP_PASSWORD ? "configured" : "not configured",
      calendar: process.env.GOOGLE_CALENDAR_ICAL_URL ? "configured" : "not configured",
      twilio_a2p: process.env.TWILIO_ACCOUNT_SID ? "watching" : "not configured",
      whisper: process.env.OPENAI_API_KEY ? "enabled" : "disabled"
    },
    monitors: {
      square_patterns: "Sunday 6 PM",
      waxos_pilot: "Every 12h",
      email_intel: "5:25 AM daily",
      financial_trends: "Monday 6 AM",
      relocation: "Wednesday 7 AM",
      decisions: "Monday 6:15 AM",
      contracts: "1st + Mondays"
    }
  };
}

// ── CREATE agent_logs TABLE ──
// Run once on startup to ensure table exists

export async function ensureAgentLogsTable() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_KEY;
  if (!url || !key) return;

  try {
    // Try inserting a test row — if table doesn't exist, we'll get an error
    const res = await fetch(`${url}/rest/v1/agent_logs?limit=0`, {
      headers: { apikey: key, Authorization: `Bearer ${key}` }
    });

    if (res.status === 404 || res.status === 400) {
      console.log("[LOG] agent_logs table not found. Create it in Supabase with:");
      console.log("  CREATE TABLE agent_logs (");
      console.log("    id uuid DEFAULT gen_random_uuid() PRIMARY KEY,");
      console.log("    action_type text NOT NULL,");
      console.log("    details text,");
      console.log("    success boolean DEFAULT true,");
      console.log("    latency_ms integer DEFAULT 0,");
      console.log("    created_at timestamptz DEFAULT now()");
      console.log("  );");
    } else {
      console.log("[LOG] agent_logs table ready.");
    }
  } catch {
    console.log("[LOG] Could not check agent_logs table.");
  }
}
