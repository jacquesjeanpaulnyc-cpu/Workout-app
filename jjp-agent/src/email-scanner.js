/**
 * Multi-Account Email Scanner — Scans 3 Gmail accounts via IMAP
 *
 * Accounts:
 *   1. jacquesjeanpaul.nyc@gmail.com (personal)
 *   2. thebrazilianblueprint@gmail.com (salon)
 *   3. tainocollective@gmail.com (Taino Collective)
 *
 * Flags emails from: staff, banks, card companies, Square, Twilio,
 * and anything with urgent keywords.
 */

import { ImapFlow } from "imapflow";
import { simpleParser } from "mailparser";

const ACCOUNTS = [
  {
    label: "Personal",
    user: "jacquesjeanpaul.nyc@gmail.com",
    passEnv: "GMAIL_APP_PASSWORD"
  },
  {
    label: "Salon",
    user: "thebrazilianblueprint@gmail.com",
    passEnv: "GMAIL_APP_PASSWORD_SALON"
  },
  {
    label: "Taino",
    user: "tainocollective@gmail.com",
    passEnv: "GMAIL_APP_PASSWORD_TAINO"
  }
];

const PRIORITY_NAMES = [
  "selena", "dallas", "anyssa", "marlaina",
  "twilio", "square", "supabase", "stripe"
];

const FINANCIAL_SENDERS = [
  "chase", "bank of america", "capital one", "amex",
  "american express", "citi", "discover", "wells fargo",
  "venmo", "paypal", "zelle", "cash app"
];

const URGENT_WORDS = [
  "urgent", "problem", "issue", "complaint",
  "cancel", "refund", "declined", "overdue",
  "past due", "fraud", "suspicious", "action required"
];

async function scanAccount(account, hours = 24) {
  const password = process.env[account.passEnv];
  if (!password) {
    console.log(`[EMAIL] ${account.label}: No password configured (${account.passEnv}). Skipping.`);
    return [];
  }

  const client = new ImapFlow({
    host: "imap.gmail.com",
    port: 993,
    secure: true,
    auth: { user: account.user, pass: password.replace(/\s/g, "") },
    logger: false
  });

  const flagged = [];

  try {
    await client.connect();
    const lock = await client.getMailboxLock("INBOX");

    const since = new Date();
    since.setHours(since.getHours() - hours);

    try {
      for await (const msg of client.fetch({ since }, { envelope: true, source: true }, { uid: true })) {
        if (flagged.length >= 15) break;

        try {
          const parsed = await simpleParser(msg.source);
          const from = (parsed.from?.text || "").toLowerCase();
          const subject = (parsed.subject || "").toLowerCase();
          const body = (parsed.text || "").slice(0, 500).toLowerCase();
          const combined = `${from} ${subject} ${body}`;

          const isStaff = PRIORITY_NAMES.some(n => from.includes(n));
          const isFinancial = FINANCIAL_SENDERS.some(n => combined.includes(n));
          const isUrgent = URGENT_WORDS.some(w => combined.includes(w));

          if (isStaff || isFinancial || isUrgent) {
            flagged.push({
              account: account.label,
              from: (parsed.from?.text || "Unknown").slice(0, 60),
              subject: (parsed.subject || "No subject").slice(0, 80),
              reason: isStaff ? "staff" : isFinancial ? "financial" : "urgent",
              snippet: (parsed.text || "").slice(0, 120).replace(/\n/g, " ").trim()
            });
          }
        } catch {}
      }
    } finally {
      lock.release();
    }
    await client.logout();
  } catch (err) {
    console.error(`[EMAIL] ${account.label} scan failed:`, err.message);
  }

  return flagged;
}

/**
 * Scan all 3 accounts and return combined flagged emails
 */
export async function scanAllAccounts(hours = 24) {
  console.log("[EMAIL] Scanning 3 accounts...");
  const allFlagged = [];

  for (const account of ACCOUNTS) {
    const results = await scanAccount(account, hours);
    allFlagged.push(...results);
    if (results.length > 0) {
      console.log(`[EMAIL] ${account.label}: ${results.length} flagged`);
    }
  }

  console.log(`[EMAIL] Total flagged: ${allFlagged.length}`);
  return allFlagged;
}

/**
 * Build email section for morning briefing
 */
export async function getEmailBriefingSection() {
  const flagged = await scanAllAccounts(24);

  if (flagged.length === 0) return "";

  const lines = [`📬 ${flagged.length} flagged email(s):`];

  for (const e of flagged.slice(0, 5)) {
    const icon = e.reason === "staff" ? "🔵" : e.reason === "financial" ? "💳" : "🔴";
    const sender = e.from.split("<")[0].trim();
    lines.push(`  ${icon} [${e.account}] ${sender} — ${e.subject}`);
  }

  if (flagged.length > 5) {
    lines.push(`  + ${flagged.length - 5} more flagged`);
  }

  return lines.join("\n");
}

/**
 * Full scan for "check email" command
 */
export async function fullEmailScan() {
  const flagged = await scanAllAccounts(24);

  if (flagged.length === 0) {
    return "📬 All 3 inboxes clear. Nothing flagged in the last 24 hours.";
  }

  const lines = [`📬 ${flagged.length} flagged across 3 accounts:`];
  for (const e of flagged) {
    const icon = e.reason === "staff" ? "🔵" : e.reason === "financial" ? "💳" : "🔴";
    lines.push(`${icon} [${e.account}] ${e.from.split("<")[0].trim()}`);
    lines.push(`   ${e.subject}`);
    if (e.snippet) lines.push(`   "${e.snippet.slice(0, 80)}..."`);
  }
  return lines.join("\n");
}
