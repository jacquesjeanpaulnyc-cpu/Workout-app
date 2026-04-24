/**
 * Twilio A2P Status Watcher — Checks toll-free verification status every 6 hours
 *
 * When status changes from pending to approved, sends an immediate
 * wake-up alert to Telegram. This unblocks the entire WaxOS automation pipeline.
 */

import cron from "node-cron";
import { readFileSync, writeFileSync, existsSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const STATUS_PATH = join(__dirname, "..", "twilio-status.json");

function loadStatus() {
  try {
    if (existsSync(STATUS_PATH)) {
      return JSON.parse(readFileSync(STATUS_PATH, "utf-8"));
    }
  } catch {}
  return { status: "unknown", lastChecked: null };
}

function saveStatus(data) {
  try {
    writeFileSync(STATUS_PATH, JSON.stringify(data, null, 2), "utf-8");
  } catch {}
}

async function checkA2PStatus(sendToOwner, silent = false) {
  const accountSid = process.env.TWILIO_ACCOUNT_SID;
  const authToken = process.env.TWILIO_AUTH_TOKEN;
  const messagingServiceSid = process.env.TWILIO_MESSAGING_SERVICE_SID;

  if (!accountSid || !authToken || !messagingServiceSid) {
    if (!silent) console.log("[A2P] Twilio credentials not configured. Watcher disabled.");
    return;
  }

  const auth = Buffer.from(`${accountSid}:${authToken}`).toString("base64");

  try {
    // Check toll-free verification status
    const res = await fetch(
      `https://messaging.twilio.com/v1/Services/${messagingServiceSid}`,
      {
        headers: {
          "Authorization": `Basic ${auth}`,
          "Content-Type": "application/json"
        }
      }
    );

    if (!res.ok) {
      const err = await res.text();
      console.error(`[A2P] Twilio API error ${res.status}: ${err}`);
      return;
    }

    const data = await res.json();

    // Also check toll-free verifications
    let tfStatus = null;
    try {
      const tfRes = await fetch(
        `https://messaging.twilio.com/v1/Tollfree/Verifications?MessagingServiceSid=${messagingServiceSid}`,
        {
          headers: {
            "Authorization": `Basic ${auth}`,
            "Content-Type": "application/json"
          }
        }
      );
      if (tfRes.ok) {
        const tfData = await tfRes.json();
        if (tfData.verifications && tfData.verifications.length > 0) {
          tfStatus = tfData.verifications[0].status;
        }
      }
    } catch {}

    // Also check A2P brand/campaign registrations
    let brandStatus = null;
    try {
      const brandRes = await fetch(
        `https://messaging.twilio.com/v1/a2p/BrandRegistrations`,
        {
          headers: {
            "Authorization": `Basic ${auth}`,
            "Content-Type": "application/json"
          }
        }
      );
      if (brandRes.ok) {
        const brandData = await brandRes.json();
        if (brandData.brand_registrations && brandData.brand_registrations.length > 0) {
          brandStatus = brandData.brand_registrations[0].status;
        }
      }
    } catch {}

    const currentStatus = {
      messaging_service: data.friendly_name || messagingServiceSid,
      use_case: data.use_case || "unknown",
      toll_free_status: tfStatus || "unknown",
      brand_status: brandStatus || "unknown",
      overall: tfStatus || brandStatus || "unknown",
      lastChecked: new Date().toISOString()
    };

    console.log(`[A2P] Status check — TF: ${currentStatus.toll_free_status} | Brand: ${currentStatus.brand_status}`);

    // Load previous status
    const previousStatus = loadStatus();

    // Check for approval
    const approvedStatuses = ["approved", "verified", "compliant"];
    const wasApproved = approvedStatuses.includes(previousStatus.status?.toLowerCase());
    const nowApproved =
      approvedStatuses.includes(currentStatus.toll_free_status?.toLowerCase()) ||
      approvedStatuses.includes(currentStatus.brand_status?.toLowerCase());

    if (nowApproved && !wasApproved) {
      // STATUS CHANGED TO APPROVED — SEND WAKE-UP ALERT
      console.log("[A2P] 🚨 STATUS CHANGED TO APPROVED!");
      await sendToOwner(
        "🚨 TWILIO A2P APPROVED!\n\n" +
        "Your entire automation pipeline is now unlocked.\n\n" +
        "What this means:\n" +
        "• SMS confirmations — READY\n" +
        "• Appointment reminders — READY\n" +
        "• No-show alerts — READY\n" +
        "• Reactivation campaigns (1,014 clients) — READY\n" +
        "• WaxOS full automation — READY\n\n" +
        "Go activate everything."
      );
    }

    // Save current status
    saveStatus({
      status: currentStatus.overall,
      toll_free: currentStatus.toll_free_status,
      brand: currentStatus.brand_status,
      service: currentStatus.messaging_service,
      lastChecked: currentStatus.lastChecked
    });

    return currentStatus;
  } catch (err) {
    console.error("[A2P] Check failed:", err.message);
    return null;
  }
}

export function startA2PWatcher(sendToOwner) {
  const hasCreds = process.env.TWILIO_ACCOUNT_SID &&
                   process.env.TWILIO_AUTH_TOKEN &&
                   process.env.TWILIO_MESSAGING_SERVICE_SID;

  if (!hasCreds) {
    console.log("[A2P] Twilio credentials not set. A2P watcher disabled.");
    console.log("[A2P] Add TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_MESSAGING_SERVICE_SID to .env");
    return;
  }

  console.log("[A2P] Twilio A2P status watcher active (every 6 hours)");

  // Check every 6 hours
  cron.schedule("0 */6 * * *", () => checkA2PStatus(sendToOwner), { timezone: "America/New_York" });

  // Check on startup (after 10 second delay)
  setTimeout(async () => {
    const status = await checkA2PStatus(sendToOwner);
    if (status) {
      console.log(`[A2P] Initial check complete — TF: ${status.toll_free_status} | Brand: ${status.brand_status}`);
    }
  }, 10000);
}
