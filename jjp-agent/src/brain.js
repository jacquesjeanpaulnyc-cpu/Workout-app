/**
 * Claude Brain v2 — Maximum Intelligence Edition
 *
 * Upgrades:
 * - Claude Opus (most powerful model)
 * - Multi-turn conversation context (last 10 messages as real messages)
 * - Auto-memory extraction (Claude flags important info to save)
 * - Strategic system prompt with proactive reasoning
 * - Extended thinking for complex questions
 */

import { fetch as undiciFetch, ProxyAgent } from "undici";
import { definition as webSearchDef, execute as webSearchExec } from "./tools/web-search.js";
import { definition as squareRevDef, execute as squareRevExec } from "./tools/square-revenue.js";
import { definition as reminderDef, execute as reminderExec } from "./tools/send-reminder.js";
import { definition as draftEmailDef, execute as draftEmailExec } from "./tools/draft-email.js";
import { definition as supabaseDef, execute as supabaseExec } from "./tools/supabase-query.js";
import { definition as calendarDef, execute as calendarExec } from "./tools/google-calendar.js";
import { definition as reactivationDef, execute as reactivationExec } from "./tools/reactivation-engine.js";
import { definition as staffDef, execute as staffExec } from "./tools/staff-tracker.js";
import { fullEmailScan } from "./email-scanner.js";
import {
  initMemory, addMessage, remember, forget, getMemoryContext,
  getMemorySummary, trackReminder, getRecentMessages, autoSave, search
} from "./memory.js";

const API_URL = "https://api.anthropic.com/v1/messages";
const MODEL = "claude-sonnet-4-20250514";

// Proxy setup
const proxyUrl = process.env.HTTPS_PROXY || process.env.https_proxy || process.env.HTTP_PROXY || process.env.http_proxy;
const dispatcher = proxyUrl ? new ProxyAgent(proxyUrl) : undefined;

// Initialize Mem0 on startup
initMemory();

// Tool registry
const tools = [webSearchDef, squareRevDef, reminderDef, draftEmailDef, supabaseDef, calendarDef, reactivationDef, staffDef];

const toolExecutors = {
  web_search: webSearchExec,
  square_revenue: squareRevExec,
  send_reminder: reminderExec,
  send_email: draftEmailExec,
  supabase_query: supabaseExec,
  google_calendar: calendarExec,
  reactivation_engine: reactivationExec,
  staff_tracker: staffExec
};

async function callClaude(body) {
  // Retry up to 3 times on transient errors
  for (let attempt = 0; attempt < 3; attempt++) {
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

    if (res.status === 529 || res.status === 503) {
      // Overloaded or service unavailable — retry
      console.log(`[BRAIN] API ${res.status}, retrying in ${(attempt + 1) * 3}s...`);
      await new Promise(r => setTimeout(r, (attempt + 1) * 3000));
      continue;
    }

    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`API ${res.status}: ${errText}`);
    }

    // Track cost estimate
    const data = await res.json();
    trackCost(data.usage);
    return data;
  }

  throw new Error("API overloaded after 3 retries");
}

// ── Cost Tracking ──

let dailyCost = { date: "", inputTokens: 0, outputTokens: 0 };

function trackCost(usage) {
  if (!usage) return;
  const today = new Date().toISOString().split("T")[0];
  if (dailyCost.date !== today) {
    dailyCost = { date: today, inputTokens: 0, outputTokens: 0 };
  }
  dailyCost.inputTokens += usage.input_tokens || 0;
  dailyCost.outputTokens += usage.output_tokens || 0;
}

export function getDailyCost() {
  // Sonnet pricing: $3/M input, $15/M output
  const inputCost = (dailyCost.inputTokens / 1_000_000) * 3;
  const outputCost = (dailyCost.outputTokens / 1_000_000) * 15;
  return {
    date: dailyCost.date,
    inputTokens: dailyCost.inputTokens,
    outputTokens: dailyCost.outputTokens,
    estimatedCost: `$${(inputCost + outputCost).toFixed(4)}`,
    breakdown: `Input: ${dailyCost.inputTokens} tokens ($${inputCost.toFixed(4)}) | Output: ${dailyCost.outputTokens} tokens ($${outputCost.toFixed(4)})`
  };
}

async function buildSystemPrompt(query = "") {
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

  const remoteOpsDeadline = new Date(2027, 6, 1); // July 1, 2027
  const msPerDay = 1000 * 60 * 60 * 24;
  const daysToDeadline = Math.ceil((remoteOpsDeadline - now) / msPerDay);

  const dayOfWeek = now.toLocaleDateString("en-US", { weekday: "long", timeZone: "America/New_York" });

  const memoryContext = await getMemoryContext(query);

  return `You are JJP Agent — Jay's personal AI chief of staff. Lean, accurate, never makes up data.

TODAY: ${today} | ${currentTime} ET | ${dayOfWeek}
${daysToDeadline} days to remote ops deadline (July 1, 2027)

WHAT YOU DO:
Salon revenue intelligence from Square, email monitoring across 3 accounts, and memory-backed priorities.

YOUR DAILY SCHEDULE:
- 5:30 AM: Morning brief (salon data on open days, AI news on closed days)
- During salon hours: Revenue milestone alerts ($500/$1K/$1.5K)
- 7 PM: EOD revenue summary vs last week
- 8 PM: Tomorrow's bookings + top priority

SALON HOURS (4 working days only):
  Mon: 3 PM - 8 PM
  Wed: 9 AM - 2 PM + 3 PM - 8 PM
  Fri: 9 AM - 2 PM
  Sat: 9 AM - 1 PM
  Tue/Thu/Sun: CLOSED

CONTEXT:
- Brazilian Blueprint: waxing salon, 206 Smith St, Providence RI
- Staff: Selena Rodrigues, Dallas Jones, Anyssa Tavarez (retiring)
- Blueprint Collective launching August 15, 2026
- Master deadline: July 1, 2027 — full remote ops from Ecuador
- WaxOS: AI SaaS (A2P pending). Do NOT mention unless Jay asks.
- Emails: personal, salon, Taino Collective

RULES:
- ALL salon data from SQUARE only. Never Supabase.
- NEVER invent numbers. Call the tool, use exact figures.
- If a tool fails, say so. Don't guess.
- Under 300 chars unless showing data.
- Direct. No fluff. Answer first, context second.

TOOLS:
- square_revenue: salon revenue (today/week/month)
- staff_tracker: bookings and schedule from Square
- web_search: search for news, articles, info
- send_reminder: schedule a Telegram reminder
- send_email: draft an email for review

You do NOT have: calendar management, immigration tracking, reactivation campaigns, WaxOS monitoring, financial account monitoring, or hiring features. If asked about something you can't do, say so.
${memoryContext}`;

}

/**
 * Build conversation messages with multi-turn context
 */
function buildMessages(userMessage) {
  const recent = getRecentMessages();
  const messages = [];

  // Add recent conversation as actual message turns (skip the current message)
  for (const msg of recent) {
    if (msg.text === userMessage && msg === recent[recent.length - 1]) continue;
    messages.push({
      role: msg.role === "jay" ? "user" : "assistant",
      content: msg.text
    });
  }

  // Ensure proper alternation (Claude requires user/assistant/user/assistant)
  const cleaned = [];
  for (let i = 0; i < messages.length; i++) {
    if (i === 0 && messages[i].role === "assistant") continue; // Skip if starts with assistant
    if (i > 0 && messages[i].role === messages[i - 1]?.role) continue; // Skip duplicates
    cleaned.push(messages[i]);
  }

  // Add current message
  cleaned.push({ role: "user", content: userMessage });

  return cleaned;
}

/**
 * Check if message is a memory command (returns promise or null)
 */
function handleMemoryCommand(text) {
  const lower = text.toLowerCase().trim();

  // "remember that ..."
  const rememberMatch = lower.match(/^remember\s+(?:that\s+)?(.+)/);
  if (rememberMatch) {
    const item = text.slice(text.toLowerCase().indexOf(rememberMatch[1]));
    return (async () => {
      const result = await remember(item);
      return result.saved
        ? `Locked in Mem0:\n"${item}"`
        : `Failed to save: ${result.reason}`;
    })();
  }

  // "forget ..."
  const forgetMatch = lower.match(/^forget\s+(?:about\s+)?(.+)/);
  if (forgetMatch) {
    const query = forgetMatch[1];
    return (async () => {
      const result = await forget(query);
      return result.removed > 0
        ? `Removed ${result.removed} memory(ies) matching "${query}".`
        : `Nothing in memory matching "${query}".`;
    })();
  }

  // "what do you remember" / "show memory" / "memory status"
  if (lower.includes("what do you remember") ||
      lower.includes("show memory") ||
      lower.includes("memory status") ||
      lower === "memory") {
    return getMemorySummary();
  }

  // "what do you remember about [topic]"
  const aboutMatch = lower.match(/what do you (?:remember|know) about (.+)/);
  if (aboutMatch) {
    return (async () => {
      const results = await search(aboutMatch[1], 5);
      if (!results.length) return `Nothing in memory about "${aboutMatch[1]}".`;
      const items = results.map(m => `• ${m.memory || m.content || m.text}`).join("\n");
      return `Memories about "${aboutMatch[1]}":\n${items}`;
    })();
  }

  // "check email" / "scan email" / "check inbox"
  if (lower.includes("check email") || lower.includes("scan email") ||
      lower.includes("check inbox") || lower.includes("scan inbox")) {
    return (async () => {
      const result = await fullEmailScan();
      if (result.error) return result.error;
      if (!result.top_emails || result.top_emails.length === 0) return "📬 Inbox clear. Nothing in the last 24 hours.";
      const lines = [`📬 ${result.summary}`];
      result.top_emails.forEach((e, i) => {
        const flag = e.priority ? "🔴" : "⚪";
        lines.push(`  ${flag} ${i+1}. ${e.from} — ${e.subject}`);
      });
      return lines.join("\n");
    })();
  }

  // "cost" / "how much am I spending" / "token usage"
  if (lower === "cost" || lower.includes("token usage") || lower.includes("api cost") ||
      lower.includes("how much am i spending") || lower.includes("agent cost")) {
    const cost = getDailyCost();
    return `📊 Agent cost today (${cost.date}):\n${cost.breakdown}\nEstimated: ${cost.estimatedCost}`;
  }

  return null;
}

/**
 * Process a message through Claude with tool use
 */
export async function processMessage(userMessage, sendTelegram) {
  addMessage("jay", userMessage);

  // Handle direct memory commands
  const memoryResponse = handleMemoryCommand(userMessage);
  if (memoryResponse) {
    const result = await memoryResponse;
    addMessage("agent", result);
    return result;
  }

  try {
    const messages = buildMessages(userMessage);
    const systemPrompt = await buildSystemPrompt(userMessage);

    // Agentic loop — Claude can chain tool calls up to MAX_ITERATIONS times
    const MAX_ITERATIONS = 6;
    let conversationMessages = [...messages];
    let iteration = 0;
    let finalText = "";

    while (iteration < MAX_ITERATIONS) {
      iteration++;

      const response = await callClaude({
        model: MODEL,
        max_tokens: 2048,
        system: systemPrompt,
        tools,
        messages: conversationMessages
      });

      // If Claude is done (returned text, no more tools needed)
      if (response.stop_reason !== "tool_use") {
        finalText = extractText(response);
        break;
      }

      // Claude wants to use tools — execute them
      const toolUseBlocks = response.content.filter(b => b.type === "tool_use");
      const toolResults = [];

      for (const toolUse of toolUseBlocks) {
        console.log(`[BRAIN] Iteration ${iteration}: calling ${toolUse.name}`);
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
          if (result.confirmed) trackReminder(result.message, result.time);
        } else if (toolUse.name === "reactivation_engine" && toolUse.input?.action === "draft") {
          sendTelegram("📝 Generating drafts... this takes 10-30 seconds per batch of 10.");
          result = await executor(toolUse.input);
          if (result.drafts && result.drafts.length > 0) {
            const chunks = [];
            let chunk = `✅ ${result.count} reactivation drafts ready (${result.tone} tone):\n\n`;
            for (const draft of result.drafts) {
              if ((chunk + draft + "\n\n").length > 3500) {
                chunks.push(chunk);
                chunk = "";
              }
              chunk += draft + "\n\n";
            }
            if (chunk) chunks.push(chunk);
            for (const c of chunks) await sendTelegram(c);
            result = { count: result.count, status: result.status, note: "Drafts already sent to Telegram." };
          }
        } else {
          result = await executor(toolUse.input);
        }

        if (result && result.send_file) {
          sendTelegram(`📎 Sending file: ${result.summary || "export ready"}`);
          if (global.__sendFile) global.__sendFile(result.send_file);
        }

        toolResults.push({
          type: "tool_result",
          tool_use_id: toolUse.id,
          content: JSON.stringify(result)
        });
      }

      // Append to conversation for next iteration
      conversationMessages.push({ role: "assistant", content: response.content });
      conversationMessages.push({ role: "user", content: toolResults });
    }

    if (!finalText) {
      finalText = "I gathered the data but ran out of iterations. Try asking a more specific question.";
    }

    addMessage("agent", finalText);
    autoSave(userMessage, finalText).catch(() => {});
    return finalText;
  } catch (err) {
    const msg = err.message || "Unknown error";
    console.error("[BRAIN ERROR]", msg);

    // Graceful error messages instead of raw dumps
    if (msg.includes("529") || msg.includes("overloaded")) {
      return "I'm hitting API limits right now. Try again in 30 seconds.";
    }
    if (msg.includes("401") || msg.includes("authentication")) {
      return "API key issue — check Anthropic credits at console.anthropic.com.";
    }
    if (msg.includes("429") || msg.includes("rate")) {
      return "Rate limited. Wait a minute and try again.";
    }
    if (msg.includes("timeout") || msg.includes("ETIMEDOUT")) {
      return "Request timed out. Try a simpler question or try again.";
    }
    if (msg.includes("insufficient") || msg.includes("credit")) {
      return "Out of API credits. Add funds at console.anthropic.com.";
    }
    return "Something went wrong. Try again in a moment.";
  }
}

/**
 * Generate a briefing using Claude
 */
export async function generateBriefing(type) {
  const prompts = {
    morning: `Generate Jay's morning briefing. Include:
- Today's date, day of week, current time
- Days until August 1, 2026
- Top priorities from MEMORY
- Critical deadlines: Blueprint Collective Aug 15, Anyssa retiring Aug 2026, Ecuador relocation
- One proactive suggestion based on the day of week
- Motivational closer — make it personal and sharp
Under 600 chars. Make every word count.`,

    evening: `Generate Jay's evening wind-down. Include:
- Day recap framing
- Tomorrow's top priority from MEMORY
- Days until August 1, 2026 countdown
- One thing to reflect on
- Remind to log in Powerhouse app (workout/food/water)
Under 400 chars. Calm but focused.`,

    weekly: `Generate Jay's Sunday weekly intel briefing. Include:
- Week in review framing with strategic lens
- Days until August 1, 2026
- Top 3 focus areas for the coming week (check MEMORY)
- Status check: WaxOS A2P, Blueprint staffing, Ecuador planning
- One strategic question Jay should be thinking about
- Check MEMORY for any priorities or decisions that affect this week
Under 700 chars. Think like a chief of staff.`
  };

  try {
    const systemPrompt = await buildSystemPrompt(prompts[type]);
    const response = await callClaude({
      model: MODEL,
      max_tokens: 1024,
      system: systemPrompt,
      messages: [{ role: "user", content: prompts[type] }]
    });

    return extractText(response);
  } catch (err) {
    console.error("[BRIEFING ERROR]", err.message);
    return `Briefing generation failed: ${err.message}`;
  }
}

function extractText(response) {
  if (!response || !response.content) return "Agent couldn't generate a response. Try again.";
  const textBlocks = response.content.filter(b => b.type === "text");
  if (textBlocks.length === 0) {
    const toolBlocks = response.content.filter(b => b.type === "tool_use");
    if (toolBlocks.length > 0) {
      return "Processing your request — try asking again if you don't see a result.";
    }
    return "Agent couldn't generate a response. Try rephrasing.";
  }
  return textBlocks.map(b => b.text).join("\n");
}
