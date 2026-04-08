/**
 * Telegram Bot — Handles message polling and responses
 */

import TelegramBot from "node-telegram-bot-api";
import { processMessage } from "./brain.js";

let bot = null;
let ownerId = null;

/**
 * Initialize the Telegram bot with polling
 */
export function startBot() {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  ownerId = process.env.TELEGRAM_OWNER_ID;

  if (!token) {
    console.error("[BOT] TELEGRAM_BOT_TOKEN not set in .env");
    process.exit(1);
  }

  bot = new TelegramBot(token, { polling: true });

  console.log("[BOT] JJP Agent is live on Telegram. Waiting for messages...");

  // Handle /start command
  bot.onText(/\/start/, (msg) => {
    const chatId = msg.chat.id;
    console.log(`[BOT] /start from chat ID: ${chatId} (user: ${msg.from.username || msg.from.first_name})`);

    bot.sendMessage(chatId, [
      "JJP Agent online.",
      "",
      `Your chat ID: ${chatId}`,
      "Add this as TELEGRAM_OWNER_ID in .env to lock the bot to your account.",
      "",
      "Send me anything — I'll route it through Claude."
    ].join("\n"));
  });

  // Handle all text messages
  bot.on("message", async (msg) => {
    // Skip commands
    if (msg.text && msg.text.startsWith("/")) return;
    if (!msg.text) return;

    const chatId = msg.chat.id;

    // Security: only respond to owner if configured
    if (ownerId && String(chatId) !== String(ownerId)) {
      console.log(`[BOT] Rejected message from unauthorized user: ${chatId}`);
      bot.sendMessage(chatId, "Unauthorized. This agent is locked to Jay's account.");
      return;
    }

    console.log(`[BOT] Message from ${msg.from.first_name}: ${msg.text}`);

    // Show typing indicator
    bot.sendChatAction(chatId, "typing");

    // Process through Claude brain
    const response = await processMessage(msg.text, (text) => {
      sendMessage(chatId, text);
    });

    // Send response (split if over Telegram's 4096 char limit)
    if (response.length > 4096) {
      const chunks = splitMessage(response, 4096);
      for (const chunk of chunks) {
        await bot.sendMessage(chatId, chunk);
      }
    } else {
      await bot.sendMessage(chatId, response);
    }
  });

  // Handle polling errors
  bot.on("polling_error", (err) => {
    console.error("[BOT] Polling error:", err.message);
  });

  return bot;
}

/**
 * Send a message to the owner (used by briefings and reminders)
 */
export function sendMessage(chatId, text) {
  if (!bot) {
    console.error("[BOT] Bot not initialized");
    return;
  }
  const targetChat = chatId || ownerId;
  if (!targetChat) {
    console.error("[BOT] No chat ID or owner ID available");
    return;
  }
  return bot.sendMessage(targetChat, text);
}

/**
 * Send a message to the owner specifically
 */
export function sendToOwner(text) {
  if (!ownerId) {
    console.error("[BOT] TELEGRAM_OWNER_ID not set — can't send briefing");
    return;
  }
  return sendMessage(ownerId, text);
}

function splitMessage(text, maxLen) {
  const chunks = [];
  let remaining = text;
  while (remaining.length > 0) {
    if (remaining.length <= maxLen) {
      chunks.push(remaining);
      break;
    }
    // Try to split at newline
    let splitAt = remaining.lastIndexOf("\n", maxLen);
    if (splitAt === -1 || splitAt < maxLen / 2) splitAt = maxLen;
    chunks.push(remaining.slice(0, splitAt));
    remaining = remaining.slice(splitAt).trimStart();
  }
  return chunks;
}
