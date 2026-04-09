/**
 * Gmail Triage — Scans inbox via IMAP for urgent/important emails
 *
 * Features:
 * - Pull last 24 hours of emails
 * - Priority sorting (staff, Twilio, Square, WaxOS leads)
 * - Morning briefing integration
 * - "check email" command via Telegram
 */

import { ImapFlow } from "imapflow";
import { simpleParser } from "mailparser";

const GMAIL_USER = "jacquesjeanpaul.nyc@gmail.com";
const PRIORITY_SENDERS = [
  "selena", "dallas", "anyssa",
  "twilio", "square", "squareup",
  "supabase", "waxos", "stripe"
];

/**
 * Connect to Gmail via IMAP
 */
function createClient() {
  const appPassword = process.env.GMAIL_APP_PASSWORD;
  if (!appPassword) return null;

  return new ImapFlow({
    host: "imap.gmail.com",
    port: 993,
    secure: true,
    auth: {
      user: GMAIL_USER,
      pass: appPassword.replace(/\s/g, "") // Remove spaces from app password
    },
    logger: false
  });
}

/**
 * Fetch emails from the last N hours
 */
export async function getRecentEmails(hours = 24, limit = 20) {
  const client = createClient();
  if (!client) return { emails: [], error: "GMAIL_APP_PASSWORD not set" };

  try {
    await client.connect();

    const lock = await client.getMailboxLock("INBOX");
    try {
      const since = new Date();
      since.setHours(since.getHours() - hours);

      const messages = [];

      for await (const msg of client.fetch(
        { since },
        { envelope: true, source: true },
        { uid: true }
      )) {
        if (messages.length >= limit) break;

        try {
          const parsed = await simpleParser(msg.source);
          const from = parsed.from?.text || msg.envelope?.from?.[0]?.address || "Unknown";
          const subject = parsed.subject || msg.envelope?.subject || "No subject";
          const date = parsed.date || msg.envelope?.date || new Date();
          const snippet = (parsed.text || "").slice(0, 150).replace(/\n/g, " ").trim();

          messages.push({
            from: from.slice(0, 100),
            subject: subject.slice(0, 100),
            date,
            snippet,
            isPriority: isPrioritySender(from, subject)
          });
        } catch {
          // Skip unparseable messages
        }
      }

      // Sort: priority first, then newest
      messages.sort((a, b) => {
        if (a.isPriority && !b.isPriority) return -1;
        if (!a.isPriority && b.isPriority) return 1;
        return new Date(b.date) - new Date(a.date);
      });

      return { emails: messages, error: null };
    } finally {
      lock.release();
    }
  } catch (err) {
    console.error("[GMAIL] IMAP error:", err.message);
    return { emails: [], error: err.message };
  } finally {
    try { await client.logout(); } catch {}
  }
}

/**
 * Check if sender is a priority contact
 */
function isPrioritySender(from, subject) {
  const lower = (from + " " + subject).toLowerCase();
  return PRIORITY_SENDERS.some(s => lower.includes(s));
}

/**
 * Build email triage section for morning briefing
 */
export async function getEmailBriefing() {
  const { emails, error } = await getRecentEmails(24, 20);

  if (error) {
    return "📬 Email triage unavailable.";
  }

  if (emails.length === 0) {
    return "📬 Inbox clear. Nothing in the last 24 hours.";
  }

  const priority = emails.filter(e => e.isPriority);
  const top = (priority.length > 0 ? priority : emails).slice(0, 3);

  const lines = [`📬 ${top.length} email${top.length > 1 ? "s" : ""} need${top.length === 1 ? "s" : ""} you:`];

  top.forEach((email, i) => {
    const sender = email.from.split("<")[0].trim() || email.from;
    const subj = email.subject.slice(0, 60);
    lines.push(`  ${i + 1}. ${sender} — ${subj}`);
  });

  if (emails.length > 3) {
    lines.push(`  + ${emails.length - 3} more in inbox`);
  }

  return lines.join("\n");
}

/**
 * Full email scan (for "check email" command)
 */
export async function fullEmailScan() {
  const { emails, error } = await getRecentEmails(24, 30);

  if (error) return { error: `Email scan failed: ${error}` };
  if (emails.length === 0) return { summary: "Inbox clear. No emails in the last 24 hours." };

  const priority = emails.filter(e => e.isPriority);

  return {
    total: emails.length,
    priority_count: priority.length,
    top_emails: emails.slice(0, 5).map(e => ({
      from: e.from.split("<")[0].trim(),
      subject: e.subject,
      priority: e.isPriority,
      snippet: e.snippet.slice(0, 80)
    })),
    summary: priority.length > 0
      ? `${priority.length} priority email(s) from staff/partners. ${emails.length} total in last 24h.`
      : `${emails.length} emails in last 24h. Nothing flagged as priority.`
  };
}
