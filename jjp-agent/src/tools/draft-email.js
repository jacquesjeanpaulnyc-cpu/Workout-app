/**
 * Email Tool — Drafts emails and sends them back via Telegram
 * No OAuth needed. Claude composes the email, sends it to Telegram
 * for Jay to review, then he can copy/paste or forward it.
 *
 * Two accounts:
 *   - personal: jacquesjeanpaul.nyc@gmail.com
 *   - salon: thebrazilianblueprint@gmail.com
 */

const ACCOUNTS = {
  personal: "jacquesjeanpaul.nyc@gmail.com",
  salon: "thebrazilianblueprint@gmail.com"
};

export const definition = {
  name: "send_email",
  description: "Draft an email for Jay to send. Composes the full email (to, from, subject, body) and presents it in Telegram for review. Two accounts: 'personal' (jacquesjeanpaul.nyc@gmail.com) or 'salon' (thebrazilianblueprint@gmail.com).",
  input_schema: {
    type: "object",
    properties: {
      to: {
        type: "string",
        description: "Recipient email address"
      },
      subject: {
        type: "string",
        description: "Email subject line"
      },
      body: {
        type: "string",
        description: "Email body text"
      },
      account: {
        type: "string",
        enum: ["personal", "salon"],
        description: "Which Gmail to send from. Defaults to personal."
      }
    },
    required: ["to", "subject", "body"]
  }
};

export async function execute({ to, subject, body, account }) {
  const acct = account || "personal";
  const fromEmail = ACCOUNTS[acct];

  const emailDraft = [
    `FROM: ${fromEmail}`,
    `TO: ${to}`,
    `SUBJECT: ${subject}`,
    ``,
    body
  ].join("\n");

  // Create a mailto link for quick sending
  const mailtoLink = `mailto:${to}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;

  return {
    confirmed: true,
    from: fromEmail,
    to,
    subject,
    draft: emailDraft,
    mailto_link: mailtoLink,
    summary: `Email drafted from ${acct} account (${fromEmail}):\n\n---\nTO: ${to}\nSUBJECT: ${subject}\n\n${body}\n---\n\nOpen Gmail to send, or tap: ${mailtoLink}`
  };
}
