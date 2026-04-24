/**
 * Telegram Bot — Handles message polling, voice transcription, and responses
 */

import TelegramBot from "node-telegram-bot-api";
import { processMessage } from "./brain.js";
import { writeFileSync, createReadStream, unlinkSync } from "fs";
import { enqueue, classifyMessage, incrementMessages, logAction } from "./orchestration.js";

let bot = null;
let ownerId = null;

// Deduplication — track processed message IDs to prevent doubles
const processedMessageIds = new Set();
const MAX_DEDUP_SIZE = 500;

function isDuplicate(msgId) {
  if (!msgId) return false;
  if (processedMessageIds.has(msgId)) return true;
  processedMessageIds.add(msgId);
  // Prevent unbounded growth
  if (processedMessageIds.size > MAX_DEDUP_SIZE) {
    const first = processedMessageIds.values().next().value;
    processedMessageIds.delete(first);
  }
  return false;
}

/**
 * Transcribe a voice message using OpenAI Whisper API
 */
async function transcribeVoice(fileId) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const openaiKey = process.env.OPENAI_API_KEY;

  if (!openaiKey) {
    return { error: "Voice not configured. Add OPENAI_API_KEY to .env for Whisper transcription." };
  }

  // 1. Get file path from Telegram
  const fileRes = await fetch(`https://api.telegram.org/bot${token}/getFile?file_id=${fileId}`);
  const fileData = await fileRes.json();
  if (!fileData.ok) {
    return { error: "Failed to get voice file from Telegram." };
  }

  // 2. Download the file
  const filePath = fileData.result.file_path;
  const downloadUrl = `https://api.telegram.org/file/bot${token}/${filePath}`;
  const audioRes = await fetch(downloadUrl);
  const audioBuffer = Buffer.from(await audioRes.arrayBuffer());

  const tmpPath = `/tmp/jjp_voice_${Date.now()}.ogg`;
  writeFileSync(tmpPath, audioBuffer);

  // 3. Transcribe with Whisper
  try {
    const formData = new FormData();
    const fileBlob = new Blob([createReadStream ? audioBuffer : audioBuffer], { type: "audio/ogg" });
    formData.append("file", fileBlob, "voice.ogg");
    formData.append("model", "whisper-1");
    formData.append("language", "en");

    const whisperRes = await fetch("https://api.openai.com/v1/audio/transcriptions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${openaiKey}`
      },
      body: formData
    });

    if (!whisperRes.ok) {
      const err = await whisperRes.text();
      return { error: `Whisper API error: ${err}` };
    }

    const result = await whisperRes.json();

    // Cleanup temp file
    try { unlinkSync(tmpPath); } catch {}

    return { text: result.text };
  } catch (err) {
    try { unlinkSync(tmpPath); } catch {}
    return { error: `Transcription failed: ${err.message}` };
  }
}

/**
 * Handle an incoming message (text or voice) and send response
 */
async function handleMessage(chatId, text, firstName) {
  const route = classifyMessage(text);
  console.log(`[BOT] Message from ${firstName} [${route}]: ${text}`);
  incrementMessages();

  // Show typing indicator
  bot.sendChatAction(chatId, "typing");

  // Queue the message for sequential processing
  try {
    const response = await enqueue(async () => {
      const start = Date.now();
      const result = await processMessage(text, (reminderText) => {
        sendMessage(chatId, reminderText);
      });
      await logAction("message_processed", `[${route}] ${text.slice(0, 100)}`, true, Date.now() - start);
      return result;
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
  } catch (err) {
    console.error("[BOT] Message processing failed:", err.message);
    await bot.sendMessage(chatId, "Something went wrong. Try again in a moment.");
    await logAction("error", `Message failed: ${err.message}`, false);
  }
}

/**
 * Initialize the Telegram bot with polling
 */
export function startBot() {
  // Idempotent — prevent double registration if called twice
  if (bot) {
    console.log("[BOT] Already started, skipping re-initialization");
    return bot;
  }

  const token = process.env.TELEGRAM_BOT_TOKEN;
  ownerId = process.env.TELEGRAM_OWNER_ID;

  if (!token) {
    console.error("[BOT] TELEGRAM_BOT_TOKEN not set in .env");
    process.exit(1);
  }

  bot = new TelegramBot(token, { polling: true });

  console.log("[BOT] JJP Agent is live on Telegram. Waiting for messages...");
  if (process.env.OPENAI_API_KEY) {
    console.log("[BOT] Voice memo support: ENABLED (Whisper)");
  } else {
    console.log("[BOT] Voice memo support: DISABLED (add OPENAI_API_KEY to .env)");
  }

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
      "Send me text or voice — I'll route it through Claude."
    ].join("\n"));
  });

  // Handle ALL messages (text + voice)
  bot.on("message", async (msg) => {
    // Skip commands
    if (msg.text && msg.text.startsWith("/")) return;

    // Deduplicate — reject if we've already processed this message
    if (isDuplicate(msg.message_id)) {
      console.log(`[BOT] Duplicate message ${msg.message_id} ignored`);
      return;
    }

    const chatId = msg.chat.id;

    // Security: only respond to owner if configured
    if (ownerId && String(chatId) !== String(ownerId)) {
      console.log(`[BOT] Rejected message from unauthorized user: ${chatId}`);
      bot.sendMessage(chatId, "Unauthorized. This agent is locked to Jay's account.");
      return;
    }

    // VOICE MESSAGE
    if (msg.voice || msg.audio) {
      const fileId = (msg.voice || msg.audio).file_id;
      const duration = (msg.voice || msg.audio).duration || 0;
      console.log(`[BOT] Voice message from ${msg.from.first_name} (${duration}s)`);

      bot.sendChatAction(chatId, "typing");

      const result = await transcribeVoice(fileId);

      if (result.error) {
        await bot.sendMessage(chatId, result.error);
        return;
      }

      // Show what was transcribed
      console.log(`[BOT] Transcribed: ${result.text}`);
      await bot.sendMessage(chatId, `🎙️ "${result.text}"`);

      // Process transcribed text through brain
      await handleMessage(chatId, result.text, msg.from.first_name);
      return;
    }

    // TEXT MESSAGE
    if (msg.text) {
      await handleMessage(chatId, msg.text, msg.from.first_name);
      return;
    }

    // Other message types (photos, stickers, etc) — ignore silently
  });

  // Handle polling errors
  bot.on("polling_error", (err) => {
    console.error("[BOT] Polling error:", err.message);
  });

  return bot;
}

/**
 * Send a message to a specific chat or the owner
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

/**
 * Send a file to the owner via Telegram
 */
export function sendFileToOwner(filePath) {
  if (!bot || !ownerId) return;
  const { createReadStream } = require ? undefined : undefined;
  return bot.sendDocument(ownerId, filePath);
}

// Expose sendFile globally for tools to use
global.__sendFile = (filePath) => {
  if (bot && ownerId) {
    bot.sendDocument(ownerId, filePath).catch(err => {
      console.error("[BOT] Failed to send file:", err.message);
    });
  }
};

function splitMessage(text, maxLen) {
  const chunks = [];
  let remaining = text;
  while (remaining.length > 0) {
    if (remaining.length <= maxLen) {
      chunks.push(remaining);
      break;
    }
    let splitAt = remaining.lastIndexOf("\n", maxLen);
    if (splitAt === -1 || splitAt < maxLen / 2) splitAt = maxLen;
    chunks.push(remaining.slice(0, splitAt));
    remaining = remaining.slice(splitAt).trimStart();
  }
  return chunks;
}
