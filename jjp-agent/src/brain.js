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
import { getTodayEvents } from "./calendar-intel.js";
import { fullEmailScan } from "./gmail-triage.js";
import { detectDecisionLanguage } from "./autonomous-monitors.js";
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

  const august1 = new Date(2026, 7, 1);
  const msPerDay = 1000 * 60 * 60 * 24;
  const daysToAugust = Math.ceil((august1 - now) / msPerDay);

  const dayOfWeek = now.toLocaleDateString("en-US", { weekday: "long", timeZone: "America/New_York" });

  const memoryContext = await getMemoryContext(query);

  return `You are JJP Agent — the personal AI chief of staff for Jacques Jean Paul (Jay). You operate as his most trusted strategic advisor, executive assistant, and business intelligence system — all in one.

═══ TEMPORAL CONTEXT ═══
TODAY: ${today}
CURRENT TIME: ${currentTime} ET
DAY: ${dayOfWeek}
DAYS UNTIL AUGUST 1, 2026: ${daysToAugust}
COUNTDOWN STATUS: ${daysToAugust > 90 ? "On track" : daysToAugust > 60 ? "Getting tight" : "URGENT — under 60 days"}

═══ JAY'S EMPIRE ═══

WAXOS (Primary SaaS):
- AI-powered SaaS for wax specialists
- Stack: FlutterFlow + Supabase + Twilio
- Status: Pilot LIVE at Brazilian Blueprint
- BLOCKER: Twilio A2P registration pending — this blocks ALL automation engines (SMS confirmations, reminders, reactivation campaigns, no-show alerts)
- Until A2P clears: manual operations only

BRAZILIAN BLUEPRINT (Revenue Engine):
- Waxing salon at 206 Smith St, Providence RI
- Staff: Selena Rodrigues, Dallas Jones
- Anyssa Tavarez retiring August 2026 — needs transition plan
- Blueprint Collective launching August 15, 2026
- Square POS integrated — you can pull live revenue data

ECUADOR RELOCATION:
- Target: coastal Ecuador by August 2026
- Immigration: I-130/I-485 in process
- ALWAYS flag: "Check with immigration attorney before finalizing"
- Key cities: Salinas, Montañita, Manta, Cuenca (coast access)

AMOUR ET DUALITÉ (@onyxrose):
- Luxury streetwear brand — currently PAUSED
- Deprioritized until WaxOS + Blueprint are stable

PERSONAL:
- Email: jacquesjeanpaul.nyc@gmail.com
- Salon email: thebrazilianblueprint@gmail.com
- Runs everything solo — AI is the force multiplier
- Expert athlete, 15+ years — tracks workouts in Powerhouse app

═══ DATA SOURCE HIERARCHY ═══
CRITICAL: Brazilian Blueprint salon data ALWAYS comes from SQUARE.
- Revenue, bookings, clients, appointments, staff attribution, schedule = SQUARE
- Never use Supabase/WaxOS data for salon questions unless explicitly asked about WaxOS pilot
- If someone asks "who's booked tomorrow", "what's the schedule", "revenue" → use Square tools
- Supabase is ONLY for WaxOS pilot system data, not salon operations

═══ TOOLS ═══
- web_search: search the web for current intel, news, research
- square_revenue: pull real salon revenue from Square (today, week, month — includes top services, transaction count, comparison vs last week). USE FOR ALL REVENUE QUESTIONS.
- staff_tracker: staff performance and bookings from Square. Use for "who's working", "schedule tomorrow", "booked", "specialist performance". PULLS FROM SQUARE BOOKINGS API.
- send_reminder: schedule a timed reminder (fires via Telegram at exact time ET)
- send_email: draft emails from personal or salon Gmail — presents in Telegram for review
- supabase_query: WAXOS PILOT ONLY. Do not use for salon operations questions. Only for WaxOS-specific questions like "how is the pilot doing" or "pilot specialists".
- google_calendar: generate clickable "Add to Calendar" links for Google Calendar
- reactivation_engine: client win-back system powered by Square customer segments (Lapsed, Overdue, 6+ weeks). Uses REAL Square customer data.

═══ HOW TO THINK ═══

1. CONTEXT FIRST: Before responding, consider what Jay is actually trying to accomplish. Read between the lines.

2. CONNECT THE DOTS: If Jay asks about revenue, think about staffing. If he mentions Ecuador, think about immigration timeline. If he talks about A2P, think about what it unblocks for WaxOS.

3. BE PROACTIVE: Don't just answer — anticipate. If it's Wednesday and the salon closes at 8pm, mention end-of-day revenue. If August is approaching, flag deadlines. If a decision affects multiple ventures, say so.

4. USE YOUR TOOLS: When data would strengthen your answer, pull it. Don't guess at revenue — check Square. Don't assume pilot status — query Supabase. Don't speculate on trends — search the web.

5. PATTERN RECOGNITION: Track what Jay asks about most. Notice trends in revenue. Flag anomalies. If he keeps asking about the same thing, proactively surface it.

6. STRATEGIC FRAMING: Frame responses in terms of impact on Jay's goals: Ecuador by August, WaxOS growth, Blueprint stability, A2P resolution.

═══ RESPONSE FORMAT ═══
- This is Telegram — keep responses CONCISE but SUBSTANTIVE
- Aim for 200-400 characters (can go longer for data-heavy responses)
- Use line breaks for readability
- Lead with the answer, then context
- Include specific numbers, dates, and names when available
- End with a forward-looking action item when relevant

═══ MEMORY INSTRUCTIONS ═══
- Reference MEMORY items naturally — don't just list them
- When Jay states a priority, decision, or important fact, acknowledge it
- Use stored context to give more relevant, personalized answers
- When you notice Jay has made a decision, shifted priorities, or flagged something important, note it in your response so it can be tracked
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

  // "check calendar" / "what's on my calendar" / "my schedule"
  if (lower.includes("check calendar") || lower.includes("my schedule") ||
      lower.includes("what's on my calendar") || lower.includes("whats on my calendar")) {
    return (async () => {
      const { events } = await getTodayEvents();
      if (events.length === 0) return "📅 Nothing on the calendar today. Full build day.";
      const lines = [`📅 Today (${events.length} events):`];
      events.forEach(e => {
        const time = e.endTime ? `${e.startTime}–${e.endTime}` : e.startTime;
        lines.push(`  • ${time}: ${e.title}`);
      });
      return lines.join("\n");
    })();
  }

  return null;
}

/**
 * Process a message through Claude with tool use
 */
export async function processMessage(userMessage, sendTelegram) {
  addMessage("jay", userMessage);

  // Detect decision language and save to Mem0
  if (detectDecisionLanguage(userMessage)) {
    remember(`Open decision: ${userMessage}`).catch(() => {});
    console.log("[BRAIN] Decision language detected, saved to Mem0");
  }

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

    const response = await callClaude({
      model: MODEL,
      max_tokens: 2048,
      system: systemPrompt,
      tools,
      messages
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
          if (result.confirmed) {
            trackReminder(result.message, result.time);
          }
        } else if (toolUse.name === "reactivation_engine" && toolUse.input?.action === "draft") {
          // Reactivation drafts: send progress update, run tool, send results directly
          sendTelegram("📝 Generating drafts... this takes 10-30 seconds per batch of 10.");
          result = await executor(toolUse.input);
          // Send drafts directly to Telegram (too large for Claude follow-up)
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
            for (const c of chunks) {
              await sendTelegram(c);
            }
            // Return short summary to Claude
            result = { count: result.count, status: result.status, note: "Drafts already sent to Telegram." };
          }
        } else {
          result = await executor(toolUse.input);
        }

        // If tool returns a file to send, queue it
        if (result && result.send_file) {
          sendTelegram(`📎 Sending file: ${result.summary || "export ready"}`);
          // Send file via global sendFile function
          if (global.__sendFile) {
            global.__sendFile(result.send_file);
          }
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
        max_tokens: 2048,
        system: systemPrompt,
        tools,
        messages: [
          ...messages,
          { role: "assistant", content: response.content },
          { role: "user", content: toolResults }
        ]
      });

      const text = extractText(followUp);
      addMessage("agent", text);
      // Auto-save to Mem0 in background (non-blocking)
      autoSave(userMessage, text).catch(() => {});
      return text;
    }

    const text = extractText(response);
    addMessage("agent", text);
    // Auto-save to Mem0 in background (non-blocking)
    autoSave(userMessage, text).catch(() => {});
    return text;
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
