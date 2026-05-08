#!/usr/bin/env node

/**
 * Standalone Briefing Script — Runs via launchd, independent of main agent
 *
 * Usage:
 *   node src/briefing-standalone.js morning
 *   node src/briefing-standalone.js evening
 *   node src/briefing-standalone.js weekly
 *
 * Loads .env, calls Claude API, sends result to Telegram.
 * Exits after sending — designed to be triggered by launchd.
 */

import { readFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const envPath = join(__dirname, "..", ".env");

// Manual .env parsing (no dependency needed)
function loadEnv() {
  try {
    const lines = readFileSync(envPath, "utf-8").split("\n");
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const eqIndex = trimmed.indexOf("=");
      if (eqIndex === -1) continue;
      const key = trimmed.slice(0, eqIndex);
      const value = trimmed.slice(eqIndex + 1);
      if (!process.env[key]) process.env[key] = value;
    }
  } catch (err) {
    console.error("Failed to load .env:", err.message);
    process.exit(1);
  }
}

loadEnv();

const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY;
const TELEGRAM_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const OWNER_ID = process.env.TELEGRAM_OWNER_ID;
const MEM0_KEY = process.env.MEM0_API_KEY;

if (!ANTHROPIC_KEY || !TELEGRAM_TOKEN || !OWNER_ID) {
  console.error("Missing ANTHROPIC_API_KEY, TELEGRAM_BOT_TOKEN, or TELEGRAM_OWNER_ID in .env");
  process.exit(1);
}

const briefingType = process.argv[2];
if (!["morning", "evening", "weekly"].includes(briefingType)) {
  console.error("Usage: node briefing-standalone.js <morning|evening|weekly>");
  process.exit(1);
}

// ── Build context ──

function getDateContext() {
  const now = new Date();
  const today = now.toLocaleDateString("en-US", {
    weekday: "long", year: "numeric", month: "long", day: "numeric",
    timeZone: "America/New_York"
  });
  const currentTime = now.toLocaleTimeString("en-US", {
    hour: "numeric", minute: "2-digit", timeZone: "America/New_York"
  });
  const august1 = new Date(2026, 7, 1);
  const daysToAugust = Math.ceil((august1 - now) / (1000 * 60 * 60 * 24));

  return { today, currentTime, daysToAugust };
}

async function getMemories() {
  if (!MEM0_KEY) return "";
  try {
    const res = await fetch("https://api.mem0.ai/v1/memories/search/", {
      method: "POST",
      headers: {
        "Authorization": `Token ${MEM0_KEY}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        query: "priorities decisions blockers deadlines important",
        user_id: "jay_jjp",
        limit: 10
      })
    });
    const data = await res.json();
    const memories = data.results || data || [];
    if (!memories.length) return "";
    return "\n\nMEMORIES:\n" + memories.map(m => `- ${m.memory || m.content}`).join("\n");
  } catch {
    return "";
  }
}

// ── Claude API call ──

async function callClaude(system, userMessage) {
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": ANTHROPIC_KEY,
      "anthropic-version": "2023-06-01"
    },
    body: JSON.stringify({
      model: "claude-opus-4-20250514",
      max_tokens: 1024,
      system,
      messages: [{ role: "user", content: userMessage }]
    })
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Claude API ${res.status}: ${err}`);
  }

  const data = await res.json();
  const textBlocks = data.content.filter(b => b.type === "text");
  return textBlocks.map(b => b.text).join("\n") || "Briefing generation failed.";
}

// ── Telegram send ──

async function sendTelegram(text) {
  const url = `https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendMessage`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      chat_id: OWNER_ID,
      text,
      parse_mode: "Markdown"
    })
  });

  if (!res.ok) {
    // Retry without markdown if it fails
    await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: OWNER_ID, text })
    });
  }
}

// ── Briefing prompts ──

async function run() {
  const { today, currentTime, daysToAugust } = getDateContext();
  const memories = await getMemories();

  const system = `You are JJP Agent — personal AI chief of staff for Jacques Jean Paul (Jay).

TODAY: ${today}
CURRENT TIME: ${currentTime} ET
DAYS UNTIL AUGUST 1, 2026: ${daysToAugust}

CONTEXT:
- WaxOS: AI SaaS for wax specialists. Pilot live. Twilio A2P pending — blocks automation.
- Brazilian Blueprint: salon at 206 Smith St Providence RI. Staff: Selena, Dallas. Anyssa retiring Aug 2026. Blueprint Collective launching Aug 15 2026.
- Relocation: Ecuador coast by August 2026. I-130/I-485 in process.
- Runs everything solo. AI is his force multiplier.${memories}`;

  const prompts = {
    morning: {
      emoji: "☀️",
      label: "MORNING BRIEF",
      prompt: `Generate Jay's morning briefing. Include:
- Today's date, day, time
- Days until August 1, 2026 (${daysToAugust} days)
- Top priorities (check MEMORIES)
- Critical deadlines: Blueprint Collective Aug 15, Anyssa retiring, Ecuador relocation
- One proactive suggestion for today
- Motivational closer — sharp, personal
Under 600 chars. Make every word count.`
    },
    evening: {
      emoji: "🌙",
      label: "EVENING WIND-DOWN",
      prompt: `Generate Jay's evening wind-down. Include:
- Day reflection prompt
- Tomorrow's top priority (check MEMORIES)
- ${daysToAugust} days until August 2026 countdown
- Remind to log workout/food/water in Powerhouse app
Under 400 chars. Calm but focused.`
    },
    weekly: {
      emoji: "📊",
      label: "WEEKLY INTEL — SUNDAY",
      prompt: `Generate Jay's Sunday weekly intel. Include:
- Week in review with strategic lens
- ${daysToAugust} days until August 2026
- Top 3 focus areas this week (check MEMORIES)
- Status checks: WaxOS A2P, Blueprint staffing, Ecuador planning
- One strategic question to think about
Under 700 chars. Think like a chief of staff.`
    }
  };

  const config = prompts[briefingType];

  console.log(`[BRIEFING] Generating ${briefingType} briefing...`);

  try {
    const briefing = await callClaude(system, config.prompt);
    const message = `${config.emoji} ${config.label}\n\n${briefing}`;

    await sendTelegram(message);
    console.log(`[BRIEFING] ${briefingType} sent to Telegram.`);
  } catch (err) {
    console.error(`[BRIEFING] Failed:`, err.message);
    // Try to send error notification
    try {
      await sendTelegram(`⚠️ ${config.label} failed: ${err.message}`);
    } catch {}
    process.exit(1);
  }
}

run().then(() => process.exit(0)).catch(err => {
  console.error(err);
  process.exit(1);
});
