/**
 * Draft Email Tool — Create Gmail drafts via Google API
 */

import { google } from "googleapis";

let gmailClient = null;

function getGmail() {
  if (gmailClient) return gmailClient;

  const clientId = process.env.GMAIL_CLIENT_ID;
  const clientSecret = process.env.GMAIL_CLIENT_SECRET;
  const refreshToken = process.env.GMAIL_REFRESH_TOKEN;

  if (!clientId || !clientSecret || !refreshToken) {
    return null;
  }

  const oauth2 = new google.auth.OAuth2(clientId, clientSecret);
  oauth2.setCredentials({ refresh_token: refreshToken });

  gmailClient = google.gmail({ version: "v1", auth: oauth2 });
  return gmailClient;
}

export const definition = {
  name: "draft_email",
  description: "Create a Gmail draft email. Use when Jay asks to draft, write, or compose an email. Draft will appear in jacquesjeanpaul.nyc@gmail.com drafts folder.",
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
      }
    },
    required: ["to", "subject", "body"]
  }
};

export async function execute({ to, subject, body }) {
  const gmail = getGmail();

  if (!gmail) {
    return {
      error: "Gmail not configured. Add GMAIL_CLIENT_ID, GMAIL_CLIENT_SECRET, and GMAIL_REFRESH_TOKEN to .env. See README for OAuth setup."
    };
  }

  try {
    // Build RFC 2822 email
    const email = [
      `To: ${to}`,
      `From: jacquesjeanpaul.nyc@gmail.com`,
      `Subject: ${subject}`,
      "",
      body
    ].join("\r\n");

    const encodedEmail = Buffer.from(email)
      .toString("base64")
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=+$/, "");

    await gmail.users.drafts.create({
      userId: "me",
      requestBody: {
        message: { raw: encodedEmail }
      }
    });

    return {
      confirmed: true,
      to,
      subject,
      summary: "Draft created — check Gmail"
    };
  } catch (err) {
    return { error: `Gmail API failed: ${err.message}` };
  }
}
