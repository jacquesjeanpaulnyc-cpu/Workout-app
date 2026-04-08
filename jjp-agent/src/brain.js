/**
 * Claude Brain — Routes messages through Claude with tool use
 * Uses undici fetch with proxy support for compatibility.
 * Includes persistent memory layer.
 */

import { fetch as undiciFetch, ProxyAgent } from "undici";
import { definition as webSearchDef, execute as webSearchExec } from "./tools/web-search.js";
import { definition as squareRevDef, execute as squareRevExec } from "./tools/square-revenue.js";
import { definition as reminderDef, execute as reminderExec } from "./tools/send-reminder.js";
import { definition as draftEmailDef, execute as draftEmailExec } from "./tools/draft-email.js";
import { definition as supabaseDef, execute as supabaseExec } from "./tools/supabase-query.js";
import { definition as calendarDef, execute as calendarExec } from "./tools/google-calendar.js";
import {
  loadMemory, addMessage, remember, forget, getMemoryContext,
  getMemorySummary, trackReminder
} from "./memory.js";

const API_URL = "https://api.anthropic.com/v1/messages";
const MODEL = "claude-sonnet-4-20250514";

// Proxy setup — use HTTPS_PROXY if available
const proxyUrl = process.env.HTTPS_PROXY || process.env.https_proxy || process.env.HTTP_PROXY || process.env.http_proxy;
const dispatcher = proxyUrl ? new ProxyAgent(proxyUrl) : undefined;

// Load memory on startup
loadMemory();

// Tool registry
const tools = [webSearchDef, squareRevDef, reminderDef, draftEmailDef, supabaseDef, calendarDef];

const toolExecutors = {
  web_search: webSearchExec,
  square_revenue: squareRevExec,
  send_reminder: reminderExec,
  send_email: draftEmailExec,
  supabase_query: supabaseExec,
  google_calendar: calendarExec
};

async function callClaude(body) {
  const res = await undiciFetch(API_URL, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": process.env.ANTHROPIC_API_KEY,
      "anthropic-version": "2023-06-01"
    },
    body: JSON.stringify(body),
    ...(dispatcher ? { dispatcher } : {})
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`API ${res.status}: ${errText}`);
  }

  return res.json();
}

function buildSystemPrompt() {
  const now = new Date();
  const today = now.toLocaleDateString("en-US", {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
    timeZone: "America/New_York"
  });

  const currentTime = now.toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    timeZone: "America/New_York"
  });

  const august1 = new Date(2026, 7, 1); // August 1, 2026
  const msPerDay = 1000 * 60 * 60 * 24;
  const daysToAugust = Math.ceil((august1 - now) / msPerDay);

  const memoryContext = getMemoryContext();

  return `You are JJP Agent — personal AI chief of staff for Jacques Jean Paul (Jay).

TODAY: ${today}
CURRENT TIME: ${currentTime} ET
DAYS UNTIL AUGUST 1, 2026: ${daysToAugust}

CONTEXT:
- WaxOS: AI SaaS for wax specialists. FlutterFlow + Supabase + Twilio. Pilot live. Twilio A2P pending — blocks all automation engines.
- Brazilian Blueprint: waxing salon 206 Smith St Providence RI. Staff Selena and Dallas. Anyssa retiring August 2026. Blueprint Collective launching August 15 2026.
- Relocation: Ecuador coast by August 2026. I-130/I-485 in process. Always flag immigration attorney before finalizing.
- Amour et Dualite (@onyxrose): luxury streetwear, paused.
- Gmail: jacquesjeanpaul.nyc@gmail.com
- Runs everything solo. AI is his force multiplier.

TOOLS AVAILABLE:
- web_search: search for current intel
- square_revenue: pull salon revenue from Square API
- send_reminder: schedule a reminder to send at a specific time
- send_email: draft emails from two Gmail accounts — "personal" (jacquesjeanpaul.nyc@gmail.com) or "salon" (thebrazilianblueprint@gmail.com). Presents the draft in Telegram for review.
- supabase_query: pull WaxOS pilot data — appointments, clients, specialists (Anyssa/Selena/Dallas), no-shows, reactivation campaigns. Use query_type "pilot_summary" for a full overview.
- google_calendar: add events to Jay's Google Calendar. Generates a clickable "Add to Calendar" link. Use for any "add to calendar", "schedule", or "block time" request.

RULES:
- Decide which tool to call based on what Jay says.
- If no tool needed, respond directly.
- Keep responses under 300 characters — this is Telegram.
- Be direct. Sharp. Like a trusted advisor who knows this business cold.
- When discussing relocation or legal matters, always mention consulting immigration attorney.
- Reference days until August 2026 when relevant to deadlines.
- Reference items from MEMORY when relevant to Jay's question.
- When Jay mentions priorities, decisions, or important items, acknowledge them and use them in future responses.${memoryContext}`;
}

/**
 * Check if message is a memory command and handle directly
 * Returns response string if handled, null if not a memory command
 */
function handleMemoryCommand(text) {
  const lower = text.toLowerCase().trim();

  // "remember that ..."
  const rememberMatch = lower.match(/^remember\s+(?:that\s+)?(.+)/);
  if (rememberMatch) {
    const item = text.slice(text.toLowerCase().indexOf(rememberMatch[1]));
    const result = remember(item);
    return `Locked in memory (${result.category}):\n"${item}"`;
  }

  // "forget ..."
  const forgetMatch = lower.match(/^forget\s+(?:about\s+)?(.+)/);
  if (forgetMatch) {
    const query = forgetMatch[1];
    const result = forget(query);
    if (result.removed > 0) {
      return `Removed ${result.removed} item(s) matching "${query}" from memory.`;
    }
    return `Nothing in memory matching "${query}".`;
  }

  // "what do you remember" / "show memory" / "memory status"
  if (lower.includes("what do you remember") ||
      lower.includes("show memory") ||
      lower.includes("memory status") ||
      lower === "memory") {
    return getMemorySummary();
  }

  return null;
}

/**
 * Process a message through Claude with tool use
 * @param {string} userMessage - The user's message
 * @param {Function} sendTelegram - Function to send Telegram messages (for reminders)
 * @returns {string} The response text
 */
export async function processMessage(userMessage, sendTelegram) {
  // Log user message to memory
  addMessage("jay", userMessage);

  // Check for direct memory commands
  const memoryResponse = handleMemoryCommand(userMessage);
  if (memoryResponse) {
    addMessage("agent", memoryResponse);
    return memoryResponse;
  }

  try {
    const response = await callClaude({
      model: MODEL,
      max_tokens: 1024,
      system: buildSystemPrompt(),
      tools,
      messages: [{ role: "user", content: userMessage }]
    });

    // Handle tool use
    if (response.stop_reason === "tool_use") {
      const toolUseBlocks = response.content.filter(b => b.type === "tool_use");
      const toolResults = [];

      for (const toolUse of toolUseBlocks) {
        const executor = toolExecutors[toolUse.name];
        if (!executor) {
          toolResults.push({
            type: "tool_result",
            tool_use_id: toolUse.id,
            content: JSON.stringify({ error: `Unknown tool: ${toolUse.name}` })
          });
          continue;
        }

        let result;
        if (toolUse.name === "send_reminder") {
          result = executor(toolUse.input, sendTelegram);
          // Track reminder in memory
          if (result.confirmed) {
            trackReminder(result.message, result.time);
          }
        } else {
          result = await executor(toolUse.input);
        }

        toolResults.push({
          type: "tool_result",
          tool_use_id: toolUse.id,
          content: JSON.stringify(result)
        });
      }

      // Send tool results back to Claude for final response
      const followUp = await callClaude({
        model: MODEL,
        max_tokens: 1024,
        system: buildSystemPrompt(),
        tools,
        messages: [
          { role: "user", content: userMessage },
          { role: "assistant", content: response.content },
          { role: "user", content: toolResults }
        ]
      });

      const text = extractText(followUp);
      addMessage("agent", text);
      return text;
    }

    const text = extractText(response);
    addMessage("agent", text);
    return text;
  } catch (err) {
    console.error("[BRAIN ERROR]", err.message);
    return `Agent error: ${err.message}`;
  }
}

/**
 * Generate a briefing using Claude
 */
export async function generateBriefing(type) {
  const prompts = {
    morning: `Generate Jay's morning briefing. Include:
- Today's date and day of week
- Days until August 1, 2026
- Key priorities for today (check MEMORY for Jay's current priorities)
- Any upcoming deadlines (Blueprint Collective Aug 15, Anyssa retiring Aug 2026, Ecuador relocation)
- Motivational closer
Keep it punchy. Under 500 chars.`,

    evening: `Generate Jay's evening wind-down briefing. Include:
- Quick reflection prompt for the day
- Tomorrow's top priority (check MEMORY)
- Days until August 1, 2026 countdown
- Reminder to log workout/food/water in Powerhouse app
Keep it calm but focused. Under 400 chars.`,

    weekly: `Generate Jay's Sunday weekly intel briefing. Include:
- Week in review framing
- Days until August 1, 2026
- Key focus areas for the coming week (check MEMORY for priorities)
- Status check items: WaxOS A2P, Blueprint staffing, Ecuador planning
- One strategic question to think about
Under 600 chars.`
  };

  try {
    const response = await callClaude({
      model: MODEL,
      max_tokens: 512,
      system: buildSystemPrompt(),
      messages: [{ role: "user", content: prompts[type] }]
    });

    return extractText(response);
  } catch (err) {
    console.error("[BRIEFING ERROR]", err.message);
    return `Briefing generation failed: ${err.message}`;
  }
}

function extractText(response) {
  const textBlocks = response.content.filter(b => b.type === "text");
  return textBlocks.map(b => b.text).join("\n") || "No response generated.";
}
