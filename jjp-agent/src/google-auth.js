/**
 * Google OAuth Helper — Run this once to get refresh tokens
 *
 * Usage:
 *   node src/google-auth.js
 *
 * This will:
 * 1. Open a browser for you to sign in with Google
 * 2. Get a refresh token
 * 3. Print it for you to add to .env
 *
 * You'll need GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET in .env first.
 */

import "dotenv/config";
import { google } from "googleapis";
import { createServer } from "http";
import { URL } from "url";

const clientId = process.env.GOOGLE_CLIENT_ID;
const clientSecret = process.env.GOOGLE_CLIENT_SECRET;

if (!clientId || !clientSecret) {
  console.error("\n❌ Missing GOOGLE_CLIENT_ID or GOOGLE_CLIENT_SECRET in .env");
  console.error("\nTo get these:");
  console.error("1. Go to https://console.cloud.google.com/");
  console.error("2. Create a project (or select existing)");
  console.error("3. Enable: Gmail API + Google Calendar API");
  console.error("4. Go to Credentials → Create Credentials → OAuth 2.0 Client ID");
  console.error("5. Application type: Web application");
  console.error('6. Add redirect URI: http://localhost:3456/callback');
  console.error("7. Copy Client ID and Client Secret to .env\n");
  process.exit(1);
}

const oauth2 = new google.auth.OAuth2(
  clientId,
  clientSecret,
  "http://localhost:3456/callback"
);

const SCOPES = [
  "https://www.googleapis.com/auth/gmail.send",
  "https://www.googleapis.com/auth/gmail.compose",
  "https://www.googleapis.com/auth/calendar",
  "https://www.googleapis.com/auth/calendar.events"
];

const authUrl = oauth2.generateAuthUrl({
  access_type: "offline",
  prompt: "consent",
  scope: SCOPES
});

console.log("\n🔐 Google OAuth Setup for JJP Agent");
console.log("====================================\n");
console.log("Opening browser for Google sign-in...\n");
console.log("If it doesn't open automatically, go to:\n");
console.log(authUrl);
console.log("\n⏳ Waiting for authorization...\n");

// Open browser
import("child_process").then(cp => {
  cp.exec(`open "${authUrl}"`);
});

// Start local server to catch the callback
const server = createServer(async (req, res) => {
  const url = new URL(req.url, "http://localhost:3456");

  if (url.pathname === "/callback") {
    const code = url.searchParams.get("code");

    if (!code) {
      res.writeHead(400);
      res.end("No authorization code received.");
      return;
    }

    try {
      const { tokens } = await oauth2.getToken(code);

      res.writeHead(200, { "Content-Type": "text/html" });
      res.end(`
        <html><body style="font-family:monospace;padding:40px;background:#0d0d0d;color:#27ae60">
          <h1>✅ Authorization successful!</h1>
          <p>Go back to your Terminal to see the refresh token.</p>
          <p>You can close this tab.</p>
        </body></html>
      `);

      console.log("✅ Authorization successful!\n");
      console.log("Add this to your .env file:\n");
      console.log(`GOOGLE_REFRESH_TOKEN=${tokens.refresh_token}\n`);
      console.log("If you need a second account (salon), run this script again,");
      console.log("sign in with thebrazilianblueprint@gmail.com, and add:\n");
      console.log(`GOOGLE_REFRESH_TOKEN_SALON=<the new token>\n`);

      server.close();
      process.exit(0);
    } catch (err) {
      res.writeHead(500);
      res.end(`Error: ${err.message}`);
      console.error("❌ Token exchange failed:", err.message);
      server.close();
      process.exit(1);
    }
  }
});

server.listen(3456, () => {
  // Server ready
});
