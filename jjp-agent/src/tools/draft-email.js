/**
 * Email Tool — Send or draft emails via Gmail API
 * Supports two accounts:
 *   - personal: jacquesjeanpaul.nyc@gmail.com
 *   - salon: thebrazilianblueprint@gmail.com
 */

import { google } from "googleapis";

let gmailClients = {};

function getGmail(account) {
  if (gmailClients[account]) return gmailClients[account];

  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;

  // Use account-specific refresh token if available, otherwise default
  let refreshToken;
  if (account === "salon") {
    refreshToken = process.env.GOOGLE_REFRESH_TOKEN_SALON || process.env.GOOGLE_REFRESH_TOKEN;
  } else {
    refreshToken = process.env.GOOGLE_REFRESH_TOKEN;
  }

  if (!clientId || !clientSecret || !refreshToken) return null;

  const oauth2 = new google.auth.OAuth2(clientId, clientSecret);
  oauth2.setCredentials({ refresh_token: refreshToken });

  gmailClients[account] = google.gmail({ version: "v1", auth: oauth2 });
  return gmailClients[account];
}

const ACCOUNTS = {
  personal: "jacquesjeanpaul.nyc@gmail.com",
  salon: "thebrazilianblueprint@gmail.com"
};

export const definition = {
  name: "send_email",
  description: "Send or draft an email via Gmail. Two accounts available: 'personal' (jacquesjeanpaul.nyc@gmail.com) or 'salon' (thebrazilianblueprint@gmail.com). Can send immediately or save as draft.",
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
        description: "Which Gmail to send from. 'personal' = jacquesjeanpaul.nyc@gmail.com, 'salon' = thebrazilianblueprint@gmail.com. Defaults to personal."
      },
      action: {
        type: "string",
        enum: ["draft", "send"],
        description: "draft = save as draft, send = send immediately. Defaults to draft for safety."
      }
    },
    required: ["to", "subject", "body"]
  }
};

export async function execute({ to, subject, body, account, action }) {
  const acct = account || "personal";
  const fromEmail = ACCOUNTS[acct];
  const gmail = getGmail(acct);

  if (!gmail) {
    return {
      error: `Gmail not configured for ${acct}. Add GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, and GOOGLE_REFRESH_TOKEN to .env. Run 'node src/google-auth.js' to set up.`
    };
  }

  try {
    // Build RFC 2822 email
    const email = [
      `To: ${to}`,
      `From: ${fromEmail}`,
      `Subject: ${subject}`,
      "Content-Type: text/plain; charset=utf-8",
      "",
      body
    ].join("\r\n");

    const encodedEmail = Buffer.from(email)
      .toString("base64")
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=+$/, "");

    if (action === "send") {
      // Send immediately
      await gmail.users.messages.send({
        userId: "me",
        requestBody: { raw: encodedEmail }
      });

      return {
        confirmed: true,
        action: "sent",
        from: fromEmail,
        to,
        subject,
        summary: `Email sent from ${acct} account to ${to}`
      };
    } else {
      // Save as draft (default — safer)
      await gmail.users.drafts.create({
        userId: "me",
        requestBody: {
          message: { raw: encodedEmail }
        }
      });

      return {
        confirmed: true,
        action: "drafted",
        from: fromEmail,
        to,
        subject,
        summary: `Draft created in ${acct} Gmail — check ${fromEmail}`
      };
    }
  } catch (err) {
    return { error: `Gmail API failed: ${err.message}` };
  }
}
