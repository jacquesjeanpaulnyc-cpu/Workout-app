/**
 * Hiring Machine — Autonomous wax specialist recruiting pipeline
 *
 * Monitors:
 *   1. Daily Job Board Scan — 8 AM daily (Indeed, LinkedIn, Craigslist, FB, StyleSeat, Vagaro)
 *   2. Beauty School Pipeline — Monday 9 AM
 *   3. Candidate Tracker — Mem0-backed with status management
 *   4. Outreach Drafter — triggered by Telegram command
 *   5. Interview Scheduler — triggered by Telegram command
 *
 * Commands:
 *   "schedule interview with [name]" → calendar event + status update
 *   "reject [name]" → mark rejected in Mem0
 *   "hired [name]" → mark hired, stop monitoring
 *   "reach out to [name]" → draft outreach for approval
 *   "show candidates" → list current pipeline
 *
 * CONFIDENTIAL: Never mention we are replacing a current employee.
 */

import cron from "node-cron";
import { MemoryClient } from "mem0ai";
import { execute as webSearchExec } from "./tools/web-search.js";

const HIRING_USER_ID = "jay_jjp_hiring";

// Job boards to scan
const JOB_QUERIES = [
  { platform: "Indeed", query: "wax specialist Providence RI site:indeed.com" },
  { platform: "LinkedIn", query: "esthetician waxing Providence Rhode Island site:linkedin.com" },
  { platform: "Craigslist", query: "wax specialist Providence site:craigslist.org" },
  { platform: "Facebook Jobs", query: "wax specialist Providence RI site:facebook.com/jobs" },
  { platform: "StyleSeat", query: "wax specialist Providence RI site:styleseat.com" },
  { platform: "Vagaro", query: "esthetician waxing Providence RI site:vagaro.com" }
];

const BEAUTY_SCHOOL_QUERIES = [
  "Rhode Island beauty school esthetics program 2026",
  "Providence cosmetology school job placement esthetics",
  "community college esthetics program Rhode Island Providence"
];

// ── Mem0 helpers ──

let mem0 = null;
function getMem0() {
  if (mem0) return mem0;
  if (!process.env.MEM0_API_KEY) return null;
  mem0 = new MemoryClient({ apiKey: process.env.MEM0_API_KEY });
  return mem0;
}

async function saveCandidate(candidate) {
  const m = getMem0();
  if (!m) return;
  try {
    const content = `HIRING_CANDIDATE | ${candidate.name} | Platform: ${candidate.platform} | Score: ${candidate.score}/10 | Status: ${candidate.status || "new"} | Link: ${candidate.link || "n/a"} | Notes: ${candidate.notes || ""}`;
    await m.add([{ role: "user", content }], {
      user_id: HIRING_USER_ID,
      metadata: {
        type: "hiring_candidate",
        name: candidate.name,
        platform: candidate.platform,
        score: candidate.score,
        status: candidate.status || "new",
        link: candidate.link,
        found_date: new Date().toISOString()
      }
    });
  } catch (err) {
    console.error("[HIRING] Failed to save candidate:", err.message);
  }
}

async function searchCandidates(query) {
  const m = getMem0();
  if (!m) return [];
  try {
    const results = await m.search(query, { user_id: HIRING_USER_ID, limit: 20 });
    return (results.results || results || []).filter(r => (r.memory || r.content || "").includes("HIRING_CANDIDATE"));
  } catch { return []; }
}

async function getAllCandidates() {
  const m = getMem0();
  if (!m) return [];
  try {
    const results = await m.getAll({ user_id: HIRING_USER_ID, limit: 100 });
    return (results.results || results || []).filter(r => (r.memory || r.content || "").includes("HIRING_CANDIDATE"));
  } catch { return []; }
}

async function updateCandidateStatus(name, newStatus) {
  const m = getMem0();
  if (!m) return false;
  try {
    // Find existing candidate
    const matches = await searchCandidates(name);
    const match = matches.find(r => (r.memory || r.content || "").toLowerCase().includes(name.toLowerCase()));
    if (!match) return false;

    // Save updated status as new memory (Mem0 handles deduplication)
    const oldText = match.memory || match.content || "";
    const updated = oldText.replace(/Status: \w+/, `Status: ${newStatus}`);
    await m.add([{ role: "user", content: updated }], {
      user_id: HIRING_USER_ID,
      metadata: { type: "hiring_candidate", name, status: newStatus, updated_at: new Date().toISOString() }
    });
    return true;
  } catch { return false; }
}

// ── Claude scoring ──

async function scoreAndExtractCandidates(searchResults, platform) {
  if (!searchResults || searchResults.length === 0) return [];

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return [];

  const resultsText = searchResults.slice(0, 8).map((r, i) =>
    `${i + 1}. ${r.title}\nURL: ${r.url}\nSnippet: ${r.snippet}`
  ).join("\n\n");

  const prompt = `You are scoring job candidates for a Wax Specialist position at Brazilian Blueprint (Providence RI).

HIRING CRITERIA:
- Minimum 1 year professional waxing experience
- Must have Brazilian wax experience
- Preferred: hard and soft wax certified
- Location: Providence RI (in-person)
- Schedule: Mon/Wed/Fri minimum

SEARCH RESULTS FROM ${platform}:
${resultsText}

TASK:
1. Identify which results are actual individual candidates or job listings for specialists (skip generic content, news, marketing pages)
2. For each real candidate, score 1-10 based on fit
3. Only include candidates scoring 7+
4. Output STRICT JSON array format:
[{"name":"...","link":"...","score":8,"notes":"why they're a fit (under 100 chars)"}]

If no qualified candidates, return empty array [].
Output ONLY the JSON array, no other text.`;

  try {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "content-type": "application/json", "x-api-key": apiKey, "anthropic-version": "2023-06-01" },
      body: JSON.stringify({
        model: "claude-sonnet-4-20250514",
        max_tokens: 1024,
        messages: [{ role: "user", content: prompt }]
      })
    });

    if (!res.ok) return [];
    const data = await res.json();
    const text = data.content?.find(b => b.type === "text")?.text || "";
    const match = text.match(/\[[\s\S]*\]/);
    if (!match) return [];

    const candidates = JSON.parse(match[0]);
    return candidates.map(c => ({ ...c, platform }));
  } catch (err) {
    console.error(`[HIRING] Score extraction failed for ${platform}:`, err.message);
    return [];
  }
}

// ══════════════════════════════════════
// MONITOR 1 — DAILY JOB BOARD SCAN
// 8 AM daily — push results at 8:15 AM if found
// ══════════════════════════════════════

export async function runJobBoardScan(sendToOwner, isManual = false) {
  console.log("[HIRING-1] Starting job board scan...");

  const allNew = [];
  const existingCandidates = await getAllCandidates();
  const existingNames = new Set(
    existingCandidates.map(c => {
      const match = (c.memory || c.content || "").match(/HIRING_CANDIDATE \| ([^|]+)/);
      return match ? match[1].trim().toLowerCase() : "";
    }).filter(Boolean)
  );

  for (const { platform, query } of JOB_QUERIES) {
    console.log(`[HIRING-1] Searching ${platform}: ${query}`);
    try {
      const searchResult = await webSearchExec({ query, max_results: 10 });
      const candidates = await scoreAndExtractCandidates(searchResult.results || [], platform);

      for (const c of candidates) {
        if (existingNames.has(c.name.toLowerCase())) continue;
        allNew.push(c);
        await saveCandidate({ ...c, status: "new" });
      }
    } catch (err) {
      console.error(`[HIRING-1] ${platform} scan error:`, err.message);
    }
  }

  console.log(`[HIRING-1] Found ${allNew.length} new qualified candidates`);

  if (allNew.length === 0) {
    if (isManual) {
      await sendToOwner("👥 Hiring Intel: No new qualified candidates today. Will scan again tomorrow 8 AM.");
    } else {
      console.log("[HIRING-1] No new candidates. Staying silent.");
    }
    return { count: 0, candidates: [] };
  }

  // Sort by score
  allNew.sort((a, b) => b.score - a.score);
  const top = allNew[0];

  const lines = [`👥 Hiring Intel: ${allNew.length} new candidate${allNew.length > 1 ? "s" : ""} found today`];
  lines.push("");
  lines.push(`🏆 Top pick: ${top.name} (${top.platform}) — Score: ${top.score}/10`);
  lines.push(top.notes || "Strong match on criteria");
  if (top.link) lines.push(`Link: ${top.link}`);

  if (allNew.length > 1) {
    lines.push("");
    lines.push("Other candidates:");
    for (const c of allNew.slice(1, 5)) {
      lines.push(`• ${c.name} (${c.platform}) — ${c.score}/10`);
      if (c.link) lines.push(`  ${c.link}`);
    }
  }

  lines.push("");
  lines.push(`Reply: "reach out to ${top.name.split(" ")[0]}" to draft outreach.`);

  await sendToOwner(lines.join("\n"));
  return { count: allNew.length, candidates: allNew };
}

// ══════════════════════════════════════
// MONITOR 2 — BEAUTY SCHOOL PIPELINE
// Monday 9 AM
// ══════════════════════════════════════

async function beautySchoolPipeline(sendToOwner) {
  console.log("[HIRING-2] Scanning beauty school pipeline...");
  const m = getMem0();
  const allSchools = [];

  for (const query of BEAUTY_SCHOOL_QUERIES) {
    try {
      const searchResult = await webSearchExec({ query, max_results: 5 });
      for (const r of (searchResult.results || []).slice(0, 3)) {
        allSchools.push({ title: r.title, url: r.url, snippet: r.snippet });
      }
    } catch {}
  }

  if (allSchools.length === 0) {
    console.log("[HIRING-2] No new schools found. Silent.");
    return;
  }

  // Use Claude to filter and summarize
  const apiKey = process.env.ANTHROPIC_API_KEY;
  const prompt = `From these search results, identify Rhode Island / Providence area beauty schools or cosmetology programs with esthetics / waxing training. Output top 2 actionable leads.

Results:
${allSchools.map(s => `- ${s.title}\n  ${s.url}\n  ${s.snippet}`).join("\n")}

Output ONLY JSON array:
[{"name":"school name","program":"program details","contact":"how to reach","url":"..."}]

Return [] if nothing relevant.`;

  try {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "content-type": "application/json", "x-api-key": apiKey, "anthropic-version": "2023-06-01" },
      body: JSON.stringify({ model: "claude-sonnet-4-20250514", max_tokens: 600, messages: [{ role: "user", content: prompt }] })
    });
    const data = await res.json();
    const text = data.content?.find(b => b.type === "text")?.text || "";
    const match = text.match(/\[[\s\S]*\]/);
    if (!match) return;
    const schools = JSON.parse(match[0]);
    if (!schools.length) return;

    const lines = ["🎓 Beauty School Pipeline"];
    for (const s of schools) {
      lines.push("");
      lines.push(`${s.name}`);
      if (s.program) lines.push(`  Program: ${s.program}`);
      if (s.contact) lines.push(`  Contact: ${s.contact}`);
      if (s.url) lines.push(`  ${s.url}`);
    }
    await sendToOwner(lines.join("\n"));
    // Save to Mem0
    for (const s of schools) {
      if (m) {
        try {
          await m.add([{ role: "user", content: `HIRING_SCHOOL | ${s.name} | ${s.program || ""} | ${s.contact || ""} | ${s.url || ""}` }], {
            user_id: HIRING_USER_ID,
            metadata: { type: "beauty_school", name: s.name }
          });
        } catch {}
      }
    }
  } catch (err) {
    console.error("[HIRING-2] Error:", err.message);
  }
}

// ══════════════════════════════════════
// MONITOR 4 — OUTREACH DRAFTER
// Command-triggered
// ══════════════════════════════════════

export async function draftOutreach(candidateName) {
  const candidates = await searchCandidates(candidateName);
  const match = candidates.find(c => (c.memory || c.content || "").toLowerCase().includes(candidateName.toLowerCase()));

  if (!match) {
    return `No candidate matching "${candidateName}" found in the pipeline. Run job scan first or check "show candidates".`;
  }

  // Extract candidate info from stored memory
  const memText = match.memory || match.content || "";
  const nameMatch = memText.match(/HIRING_CANDIDATE \| ([^|]+)/);
  const platformMatch = memText.match(/Platform: ([^|]+)/);
  const notesMatch = memText.match(/Notes: (.*)/);

  const name = nameMatch ? nameMatch[1].trim() : candidateName;
  const platform = platformMatch ? platformMatch[1].trim() : "their profile";
  const notes = notesMatch ? notesMatch[1].trim() : "your experience";

  const apiKey = process.env.ANTHROPIC_API_KEY;
  const prompt = `Draft a professional outreach message from Jay (owner of Brazilian Blueprint, waxing salon at 206 Smith St Providence RI) to a potential wax specialist candidate.

Candidate: ${name}
Platform: ${platform}
What stood out: ${notes}

Guidelines:
- Warm, professional, not corporate
- Mention specific skill/experience that impressed us
- Say we're growing and looking for a skilled wax specialist
- Describe environment: professional, client-focused
- Ask for a quick conversation this week
- Under 600 chars
- Start with "Hi [first name]," and end with "— Jay"
- DO NOT mention replacing anyone (confidential)

Output ONLY the message text.`;

  try {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "content-type": "application/json", "x-api-key": apiKey, "anthropic-version": "2023-06-01" },
      body: JSON.stringify({ model: "claude-sonnet-4-20250514", max_tokens: 600, messages: [{ role: "user", content: prompt }] })
    });
    const data = await res.json();
    const draft = data.content?.find(b => b.type === "text")?.text || "Draft generation failed.";

    return `📝 OUTREACH DRAFT — ${name}\n\n${draft}\n\n━━━━━━━━━━\nReview and copy to send. Reply "sent to ${name.split(" ")[0]}" to mark as contacted.`;
  } catch (err) {
    return `Failed to draft outreach: ${err.message}`;
  }
}

// ══════════════════════════════════════
// COMMAND HANDLERS — called from brain.js
// ══════════════════════════════════════

export function detectHiringCommand(text) {
  const lower = text.toLowerCase().trim();

  // "schedule interview with [name]"
  const interviewMatch = lower.match(/^schedule interview with (.+)/);
  if (interviewMatch) return { action: "schedule_interview", name: interviewMatch[1] };

  // "reject [name]"
  const rejectMatch = lower.match(/^reject (.+)/);
  if (rejectMatch) return { action: "reject", name: rejectMatch[1] };

  // "hired [name]"
  const hiredMatch = lower.match(/^hired (.+)/);
  if (hiredMatch) return { action: "hired", name: hiredMatch[1] };

  // "reach out to [name]"
  const reachMatch = lower.match(/^reach out to (.+)/);
  if (reachMatch) return { action: "draft_outreach", name: reachMatch[1] };

  // "sent to [name]"
  const sentMatch = lower.match(/^sent to (.+)/);
  if (sentMatch) return { action: "mark_contacted", name: sentMatch[1] };

  // "show candidates" / "hiring pipeline"
  if (lower === "show candidates" || lower === "hiring pipeline" || lower === "candidates") {
    return { action: "list_candidates" };
  }

  // "run hiring scan" / "scan jobs"
  if (lower.includes("run hiring scan") || lower === "scan jobs" || lower === "find candidates") {
    return { action: "manual_scan" };
  }

  return null;
}

export async function executeHiringCommand(cmd, sendToOwner) {
  switch (cmd.action) {
    case "draft_outreach":
      return await draftOutreach(cmd.name);

    case "schedule_interview": {
      const ok = await updateCandidateStatus(cmd.name, "interviewing");
      if (!ok) return `Candidate "${cmd.name}" not found in pipeline.`;
      // Generate Google Calendar link
      const title = encodeURIComponent(`Interview: ${cmd.name} — Wax Specialist`);
      const desc = encodeURIComponent(`Interview with ${cmd.name} for Wax Specialist position at Brazilian Blueprint.`);
      const calLink = `https://calendar.google.com/calendar/render?action=TEMPLATE&text=${title}&details=${desc}&location=206+Smith+St,+Providence+RI&ctz=America/New_York`;
      return `📅 Interview scheduled — ${cmd.name}\nStatus: interviewing\n\nTap to add to calendar:\n${calLink}`;
    }

    case "reject": {
      const ok = await updateCandidateStatus(cmd.name, "rejected");
      return ok ? `❌ ${cmd.name} marked as rejected.` : `Candidate "${cmd.name}" not found.`;
    }

    case "hired": {
      const ok = await updateCandidateStatus(cmd.name, "hired");
      return ok ? `✅ ${cmd.name} marked as HIRED. Stopping hiring monitors.` : `Candidate "${cmd.name}" not found.`;
    }

    case "mark_contacted": {
      const ok = await updateCandidateStatus(cmd.name, "contacted");
      return ok ? `📨 ${cmd.name} marked as contacted.` : `Candidate "${cmd.name}" not found.`;
    }

    case "list_candidates": {
      const all = await getAllCandidates();
      if (all.length === 0) return "No candidates in pipeline yet. Run 'scan jobs' to start.";
      const lines = [`👥 Hiring Pipeline (${all.length} candidates):`];
      for (const c of all.slice(0, 20)) {
        const text = c.memory || c.content || "";
        const nameMatch = text.match(/HIRING_CANDIDATE \| ([^|]+)/);
        const scoreMatch = text.match(/Score: (\d+)/);
        const statusMatch = text.match(/Status: (\w+)/);
        const platformMatch = text.match(/Platform: ([^|]+)/);
        if (nameMatch) {
          lines.push(`• ${nameMatch[1].trim()} — ${scoreMatch?.[1] || "?"}/10 — ${statusMatch?.[1] || "?"} (${platformMatch?.[1]?.trim() || "?"})`);
        }
      }
      return lines.join("\n");
    }

    case "manual_scan": {
      return await runJobBoardScan(sendToOwner, true);
    }

    default:
      return "Unknown hiring command.";
  }
}

// ══════════════════════════════════════
// CRON SCHEDULER
// ══════════════════════════════════════

export function startHiringMonitors(sendToOwner) {
  console.log("[HIRING] Starting hiring machine monitors...");

  // Monitor 1: Job Board Scan — 8:15 AM daily
  cron.schedule("15 8 * * *", () => runJobBoardScan(sendToOwner), { timezone: "America/New_York" });

  // Monitor 2: Beauty School Pipeline — Monday 9 AM
  cron.schedule("0 9 * * 1", () => beautySchoolPipeline(sendToOwner), { timezone: "America/New_York" });

  console.log("[HIRING] Hiring monitors scheduled:");
  console.log("  1. 👥 Job Board Scan — 8:15 AM daily");
  console.log("  2. 🎓 Beauty School Pipeline — Monday 9 AM");
}
