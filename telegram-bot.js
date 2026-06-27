// telegram-bot.js
const { Telegraf, Markup } = require('telegraf');
require('dotenv').config();
const axios = require('axios');
const pool = require('./db');
const fs = require('fs');
const path = require('path');
const { uploadFile, deleteFile, getFileUrl } = require('./storage');

// Main bot — official API — handles ALL updates and file downloads
const bot = new Telegraf(process.env.BOT_TOKEN);
// No apiRoot here — uses api.telegram.org by default

// Separate client — local API — ONLY for sending large files out
const { Telegram } = require('telegraf');
const localTelegram = process.env.LOCAL_BOT_API_URL
  ? new Telegram(process.env.BOT_TOKEN, {
      apiRoot: process.env.LOCAL_BOT_API_URL
    })
  : null;

console.log(localTelegram
  ? `📡 Large file sender: ${process.env.LOCAL_BOT_API_URL}`
  : `📡 Large file sender: api.telegram.org (no local API configured)`
);

const { getUserSession, setUserSession, createSessionIfNotExists } = require('./sessions');
const { initCreditsTable, setCredits, getCredits, useCredits, calculateCreditCost, areCreditsExpired } = require('./credits');


function getTelegramFileUrl(filePath) {
  // Always official API for downloads — local server is send-only
  return `https://api.telegram.org/file/bot${process.env.BOT_TOKEN}/${filePath}`;
}
// ─────────────────────────────────────────────
// Voice definitions
// Friendly names → must match voiceMap keys
// in audio-robot.js exactly
// All 16 voices support style instruction prompting
// via Gemini TTS — no tiered separation needed
// ─────────────────────────────────────────────

const FEMALE_VOICES = ['Luna', 'Aria', 'Zoe', 'Calla', 'Erin', 'Kore', 'Lucy', 'Leda', 'Sally', 'Violet'];
const MALE_VOICES   = ['Rex', 'Dave', 'Marcus', 'Desmond', 'Puck', 'Finn'];

// All valid voice keys — must match voiceMap in audio-robot.js
const ALL_VOICES = [...FEMALE_VOICES, ...MALE_VOICES];

// ============================================
// 🎤 VOICE PAGES — paginated browser
// ============================================

const voicePages = [
  {
    title: '🎙️ Female Voices - Set 1',
    voices: ['Luna', 'Aria', 'Zoe', 'Calla', 'Erin'],
    page: 0,
  },
  {
    title: '🎙️ Female Voices - Set 2',
    voices: ['Kore', 'Lucy', 'Leda', 'Sally', 'Violet'],
    page: 1,
  },
  {
    title: '🎙️ Male Voices',
    voices: ['Rex', 'Dave', 'Marcus', 'Desmond', 'Puck', 'Finn'],
    page: 2,
  },
];

// Voice keyboard rows — 3 per row, auto-generated
const VOICE_KEYBOARD_ROWS = [];
for (let i = 0; i < ALL_VOICES.length; i += 3) {
  VOICE_KEYBOARD_ROWS.push(ALL_VOICES.slice(i, i + 3));
}

async function showVoicePage(ctx, pageNum = 0) {
  const page = voicePages[pageNum];

  const keyboard = [];

  // Voice sample buttons — 2 per row
  for (let i = 0; i < page.voices.length; i += 2) {
    const row = [];
    row.push({
      text: `🔊 ${page.voices[i]}`,
      callback_data: `voice_sample_${page.voices[i]}`
    });
    if (page.voices[i + 1]) {
      row.push({
        text: `🔊 ${page.voices[i + 1]}`,
        callback_data: `voice_sample_${page.voices[i + 1]}`
      });
    }
    keyboard.push(row);
  }

  // Navigation
  const navRow = [];
  if (pageNum > 0) {
    navRow.push({ text: '◀️ Previous', callback_data: `voice_page_${pageNum - 1}` });
  }
  navRow.push({ text: `${pageNum + 1}/${voicePages.length}`, callback_data: 'noop' });
  if (pageNum < voicePages.length - 1) {
    navRow.push({ text: 'Next ▶️', callback_data: `voice_page_${pageNum + 1}` });
  }
  keyboard.push(navRow);

  const messageText =
    `🎤 *${page.title}*\n\n` +
    `Tap any voice below to hear a sample.\n` +
    `All voices support custom style instructions ✨`;

  if (ctx.callbackQuery) {
    try {
      await ctx.editMessageText(messageText, {
        parse_mode: 'Markdown',
        reply_markup: { inline_keyboard: keyboard }
      });
    } catch (error) {
      await ctx.answerCbQuery();
    }
  } else {
    await ctx.reply(messageText, {
      parse_mode: 'Markdown',
      reply_markup: { inline_keyboard: keyboard }
    });
  }
}

// ============================================
// 🎬 CAPTION SELECTION - PAGINATED
// ============================================

const captionPages = [
  {
    title: 'Set 1',
    styles: ['Karaoke', 'Banger', 'Acid', 'Lovly', 'Marvel'],
    page: 0
  },
  {
    title: 'Set 2',
    styles: ['Marker', 'Neon Pulse', 'Beasty', 'Crazy', 'Safari'],
    page: 1
  },
  {
    title: 'Set 3',
    styles: ['Popline', 'Desert', 'Hook', 'Sky', 'Flamingo'],
    page: 2
  },
  {
    title: 'Set 4',
    styles: ['Deep Diver B&W', 'New', 'Catchy', 'From', 'Classic'],
    page: 3
  },
  {
    title: 'Set 5',
    styles: ['Classic Big', 'Old Money', 'Cinema', 'Midnight Serif', 'Aurora Ink'],
    page: 4
  }
];

async function showCaptionPage(ctx, pageNum = 0) {
  const page = captionPages[pageNum];

  const keyboard = [];

  for (let i = 0; i < page.styles.length; i += 2) {
    const row = [];
    row.push({
      text: `📹 ${page.styles[i]}`,
      callback_data: `caption_sample_${page.styles[i].replace(/\s+/g, '_')}`
    });
    if (page.styles[i + 1]) {
      row.push({
        text: `📹 ${page.styles[i + 1]}`,
        callback_data: `caption_sample_${page.styles[i + 1].replace(/\s+/g, '_')}`
      });
    }
    keyboard.push(row);
  }

  const navRow = [];
  if (pageNum > 0) {
    navRow.push({ text: '◀️ Previous', callback_data: `caption_page_${pageNum - 1}` });
  }
  navRow.push({ text: `${pageNum + 1}/${captionPages.length}`, callback_data: 'noop' });
  if (pageNum < captionPages.length - 1) {
    navRow.push({ text: 'Next ▶️', callback_data: `caption_page_${pageNum + 1}` });
  }
  keyboard.push(navRow);

  const messageText =
    `🎬 *Caption Styles - ${page.title}*\n\n` +
    `Tap any style below to see a sample:`;

  if (ctx.callbackQuery) {
    try {
      await ctx.editMessageText(messageText, {
        parse_mode: 'Markdown',
        reply_markup: { inline_keyboard: keyboard }
      });
    } catch (error) {
      await ctx.answerCbQuery();
    }
  } else {
    await ctx.reply(messageText, {
      parse_mode: 'Markdown',
      reply_markup: { inline_keyboard: keyboard }
    });
  }
}

// ============================================
// 📱 CALLBACK HANDLERS
// ============================================

bot.action(/^voice_page_(\d+)$/, async (ctx) => {
  const pageNum = parseInt(ctx.match[1]);
  await ctx.answerCbQuery();
  await showVoicePage(ctx, pageNum);
});

bot.action(/^voice_sample_(.+)$/, async (ctx) => {
  const voiceName = ctx.match[1];
  await ctx.answerCbQuery('🎵 Loading sample...');
  try {
    await ctx.replyWithAudio(
      { source: `./voice-samples/${voiceName}.mp3` },
      {
        caption:
          `🎤 *${voiceName}* voice sample\n\n` +
          `Like this voice? Select it from the keyboard below.`,
        parse_mode: 'Markdown'
      }
    );
  } catch (error) {
    console.error(`Error sending voice sample ${voiceName}:`, error);
    await ctx.reply(`⚠️ Could not load sample for ${voiceName}. Please try another.`);
  }
});

bot.action(/^caption_page_(\d+)$/, async (ctx) => {
  const pageNum = parseInt(ctx.match[1]);
  await ctx.answerCbQuery();
  await showCaptionPage(ctx, pageNum);
});

bot.action(/^caption_sample_(.+)$/, async (ctx) => {
  const styleName = ctx.match[1].replace(/_/g, ' ');
  await ctx.answerCbQuery('📹 Loading sample...');
  try {
    const fileName = styleName.toLowerCase().replace(/[^a-z0-9]/g, '') + '.mp4';
    await ctx.replyWithVideo(
      { source: `./caption-samples/${fileName}` },
      {
        caption:
          `📹 *${styleName}* caption style\n\n` +
          `Like this style? Select it from the keyboard below.`,
        parse_mode: 'Markdown',
        supports_streaming: true
      }
    );
  } catch (error) {
    console.error(`Error sending caption sample ${styleName}:`, error);
    await ctx.reply(`⚠️ Could not load sample for ${styleName}. Please try another.`);
  }
});

bot.action('noop', async (ctx) => {
  await ctx.answerCbQuery();
});

// ============================================
// 🛠️ HELPERS
// ============================================

function extractUserIdFromSupportMessage(message) {
  if (!message) return null;

  let userId = null;

  const entities = message.entities || message.caption_entities || [];
  for (const entity of entities) {
    if (entity.type === 'text_link' && entity.url) {
      const match = entity.url.match(/tg:\/\/user\?id=(\d+)/);
      if (match) { userId = match[1]; break; }
    }
    if (entity.type === 'text_mention' && entity.user) {
      userId = entity.user.id.toString(); break;
    }
  }

  if (!userId) {
    const textToCheck = message.text || message.caption || '';
    const textMatch = textToCheck.match(/User ID:\s*`?(\d+)`?/i);
    if (textMatch) userId = textMatch[1];
  }

  return userId;
}

function isSupportMessage(message) {
  const text = message?.text || message?.caption || '';
  return text.includes('🆘') && text.includes('Support Request');
}

const WORKER_BASE_URL  = process.env.WORKER_BASE_URL  || 'https://your-worker.railway.app';
const BACKEND_BASE_URL = process.env.BACKEND_BASE_URL || 'https://your-backend.railway.app';

const ADMIN_IDS = [541812135, 7948746526, 5426162126];

const APPROVAL_REQUIRED_USER = 6646033752;

const userStates     = new Map();
const scriptTimeouts = new Map();
const SCRIPT_BUFFER_TIMEOUT = 15000;

// ============================================
// 🔔 WORKER COMMUNICATION
// ============================================

async function wakeWorker(jobId, action) {
  try {
    await axios.post(`${WORKER_BASE_URL}/wake-up`, {
      jobId,
      action,
      timestamp: Date.now()
    }, { timeout: 5000 });
    console.log(`✅ Worker woken for job ${jobId} (${action})`);
  } catch (error) {
    console.warn(`⚠️ Could not wake worker: ${error.message}`);
  }
}

async function triggerSegmentRefetch(jobId, segmentIndex) {
  try {
    const response = await axios.post(`${WORKER_BASE_URL}/refetch-segment`, { jobId, segmentIndex });
    return response.data.success;
  } catch (error) {
    console.error(`Error triggering segment refetch:`, error.message);
    return false;
  }
}

async function triggerRegeneration(jobId, type) {
  try {
    const endpoint = type === 'script' ? '/regenerate-script' : '/regenerate-audio';
    const response = await axios.post(`${WORKER_BASE_URL}${endpoint}`, { jobId: parseInt(jobId) });
    return response.data.success;
  } catch (error) {
    console.error(`Error triggering ${type} regeneration:`, error.message);
    return false;
  }
}

async function getJobInfo(jobId) {
  try {
    const response = await axios.get(`${WORKER_BASE_URL}/job-info/${jobId}`);
    return response.data.job;
  } catch (error) {
    console.error(`Error getting job info:`, error.message);
    return null;
  }
}

function estimateDurationFromScript(scriptText) {
  const words = scriptText.trim().split(/\s+/).length;
  return Math.min(Math.ceil(words / 150), 30);
}

async function safeEditMessage(ctx, text, extra = {}) {
  try {
    const message = ctx.callbackQuery.message;
    if (message.photo || message.audio || message.voice || message.document) {
      await ctx.editMessageCaption(text, extra);
    } else {
      await ctx.editMessageText(text, extra);
    }
  } catch (error) {
    console.error('Message edit error:', error.message);
    await ctx.answerCbQuery(text.replace(/\*\*/g, '').replace(/\*/g, ''));
  }
}

async function confirmSubmission(ctx, message, extra = {}) {
  return ctx.reply(message, {
    ...extra,
    reply_markup: { remove_keyboard: true }
  });
}

// ============================================
// 💰 CREDIT HELPERS
// ============================================

async function showCreditBreakdown(ctx, userData) {
  const duration = userData.duration || 0;
  const baseCost = duration * 10; // 10 credits per minute flat for all voices

  await ctx.reply(
    `💰 *Credit Breakdown:*\n` +
    `⏱ Duration: ${duration} min × 10 = ${baseCost} credit(s)\n` +
    `---------------------\n` +
    `💳 *Total: ${baseCost} credit(s)*`,
    { parse_mode: 'Markdown' }
  );

  return baseCost;
}

async function tryDeductCredits(ctx, userData) {
  const duration = userData.duration || 0;

  if (duration === 0 || !duration) {
    console.error(`❌ Invalid duration for user ${ctx.chat.id}:`, userData);
    return {
      success: false,
      reason: '❌ Invalid duration. Please restart with /start',
      creditCost: 0,
      currentCredits: 0
    };
  }

  const creditCost = calculateCreditCost({ durationMinutes: duration, isPremiumVoice: false });

  if (creditCost === 0 || isNaN(creditCost)) {
    console.error(`❌ Invalid credit cost for user ${ctx.chat.id}:`, { duration, creditCost });
    return {
      success: false,
      reason: '❌ Credit calculation error. Please contact /support',
      creditCost: 0,
      currentCredits: 0
    };
  }

  const creditInfo     = await getCredits(ctx.chat.id);
  const currentCredits = typeof creditInfo === 'object' ? creditInfo.amount : creditInfo;

  console.log(`💰 Credit check for user ${ctx.chat.id}: has ${currentCredits}, needs ${creditCost}`);

  if (currentCredits < creditCost) {
    return {
      success: false,
      reason: 'insufficient_credits',
      creditCost,
      currentCredits,
    };
  }

  const result = await useCredits(ctx.chat.id, creditCost);
  if (!result.success) return { success: false, reason: result.reason };

  return { success: true, creditCost, remaining: result.remaining };
}

// ============================================
// 🎬 JOB SUBMISSION
// ============================================

async function submitVideoJob(ctx, userData) {
  try {
    const jobData = {
      user_id:           ctx.chat.id,
      prompt:            userData.mode === 'prompt' ? userData.inputText : null,
      script:            userData.mode === 'script' ? userData.inputText : null,
      videotype:         userData.videotype,
      duration:          userData.duration,
      voice:             userData.voice,
      content_flow:      userData.content_flow || 'news',
      media_type:        userData.mediaType || 'images',
      media_mode:        userData.mediaMode || 'auto',
      add_captions:      userData.addCaptions || false,
      caption_style:     userData.captionStyle || null,
      style_instruction: userData.styleInstruction || null, // ← renamed from qwen_style_instruction
    };

    const response = await axios.post(`${BACKEND_BASE_URL}/generate-video`, jobData);

    if (response.data.success) {
      const jobId = response.data.jobId;
      console.log(`Job ${jobId} submitted for user ${ctx.chat.id}`);

      function escapeMarkdown(text) {
        if (!text) return 'N/A';
        return text.replace(/([_*[\]()~`>#+\-=|{}.!\\])/g, '\\$1');
      }

      // Approval-required user
      if (ctx.chat.id === APPROVAL_REQUIRED_USER) {
        const { mode, inputText, videotype, voice, content_flow, mediaMode, duration } = userData;
        for (const adminId of ADMIN_IDS) {
          await bot.telegram.sendMessage(
            adminId,
            `🔔 *VIDEO APPROVAL REQUIRED*\n\n` +
            `👤 User: @${ctx.from.username || 'N/A'}\n` +
            `🆔 User ID: [${ctx.from.id}](tg://user?id=${ctx.from.id})\n` +
            `🎬 Job ID: ${jobId}\n\n` +
            `📋 Details:\n` +
            `• Flow: *${content_flow || 'news'}*\n` +
            `• Type: *${mode}*\n` +
            `• Duration: *${duration} min*\n` +
            `• Style: *${videotype}*\n` +
            `• Voice: *${voice}*\n` +
            `• Media: *${userData.mediaType || 'images'}*\n` +
            `• Media Mode: *${mediaMode === 'manual' ? '📤 User Upload' : '🔍 Auto-Fetch'}*\n\n` +
            `✍️ Content:\n${inputText.substring(0, 300)}${inputText.length > 300 ? '...' : ''}`,
            {
              parse_mode: 'Markdown',
              reply_markup: {
                inline_keyboard: [[
                  { text: '✅ Approve & Start Processing', callback_data: `approve_job_${jobId}` }
                ]]
              }
            }
          );
        }
        return true;
      }

      // Normal admin notification
      const { mode, inputText, videotype, voice, content_flow, mediaMode } = userData;
      for (const adminId of ADMIN_IDS) {
        await bot.telegram.sendMessage(
          adminId,
          `📨 *New Submission Received!*\n` +
          `👤 Username: @${escapeMarkdown(ctx.from.username)}\n` +
          `🆔 User ID: [${ctx.from.id}](tg://user?id=${ctx.from.id})\n\n` +
          `🎬 Flow: *${content_flow || 'news'}*\n` +
          `🧾 Type: *${mode}*\n` +
          `🕒 Duration: *${userData.duration} min*\n` +
          `🎬 Style: *${videotype}*\n` +
          `🎤 Voice: *${voice}*\n` +
          `📱 Media: *${userData.mediaType || 'images'}*\n` +
          `🤖 Media Mode: *${mediaMode === 'manual' ? '📤 Manual' : '🔍 Auto'}*\n\n` +
          `✍️ Input:\n${escapeMarkdown(inputText.substring(0, 500))}${inputText.length > 500 ? '...' : ''}`,
          { parse_mode: 'Markdown' }
        );
      }

      return true;
    } else {
      throw new Error(response.data.message || 'Failed to submit job');
    }
  } catch (error) {
    console.error('Error submitting job:', error);
    await ctx.reply('❌ Failed to submit job. Please try again.');
    return false;
  }
}

// ============================================
// 🔔 NOTIFICATION FUNCTIONS
// ============================================

async function notifyScriptForReview({ id, user_id, script }) {
  try {
    if (script.length <= 3800) {
      await bot.telegram.sendMessage(
        user_id,
        `📝 *Script Generated*\n\n${script}`,
        {
          parse_mode: 'Markdown',
          reply_markup: {
            inline_keyboard: [
              [
                { text: '✅ Approve Script',    callback_data: `approve_script_${id}` },
                { text: '✏️ Edit Script',       callback_data: `edit_script_${id}`    }
              ],
              [{ text: '🔄 Regenerate Script', callback_data: `regenerate_script_${id}` }]
            ]
          }
        }
      );
    } else {
      const scriptBuffer = Buffer.from(script, 'utf8');
      await bot.telegram.sendDocument(
        user_id,
        { source: scriptBuffer, filename: 'script.txt' },
        {
          caption: `📝 *Script Generated*\n\nScript sent as file — please review:`,
          parse_mode: 'Markdown',
          reply_markup: {
            inline_keyboard: [
              [
                { text: '✅ Approve Script',    callback_data: `approve_script_${id}` },
                { text: '✏️ Edit Script',       callback_data: `edit_script_${id}`    }
              ],
              [{ text: '🔄 Regenerate Script', callback_data: `regenerate_script_${id}` }]
            ]
          }
        }
      );
    }
  } catch (error) {
    console.error(`Failed to notify for script review:`, error);
  }
}

async function notifySegmentImageForReview({ id, user_id, segmentIndex, totalSegments, segmentText, imageUrl, query }) {
  try {
    console.log(`📤 Sending image for segment ${segmentIndex + 1} to user ${user_id}`);

    const response = await axios.get(imageUrl, {
      responseType: 'arraybuffer',
      timeout: 30000,
      maxContentLength: 20 * 1024 * 1024
    });

    const imageBuffer = Buffer.from(response.data);

    await bot.telegram.sendPhoto(
      user_id,
      { source: imageBuffer, filename: `segment_${segmentIndex + 1}.jpg` },
      {
        caption:
          `🖼️ *Image for Segment ${segmentIndex + 1}/${totalSegments}*\n\n` +
          `📝 *Text:* ${segmentText.substring(0, 150)}${segmentText.length > 150 ? '...' : ''}\n\n` +
          `❓ Is this image relevant to this part of your script?`,
        parse_mode: 'Markdown',
        reply_markup: {
          inline_keyboard: [
            [
              { text: '✅ Approve',      callback_data: `approve_segment_${id}_${segmentIndex}` },
              { text: '🔄 Refetch',      callback_data: `refetch_segment_${id}_${segmentIndex}` }
            ],
            [{ text: '📤 Upload My Own', callback_data: `upload_segment_${id}_${segmentIndex}` }]
          ]
        }
      }
    );
  } catch (error) {
    console.error(`❌ Failed to send image for segment ${segmentIndex + 1}:`, error.message);
    throw error;
  }
}

async function notifySegmentUploadRequest({ id, user_id, segmentIndex, totalSegments, segmentText, query }) {
  try {
    await bot.telegram.sendMessage(
      user_id,
      `📸 *Upload Image for Segment ${segmentIndex + 1}/${totalSegments}*\n\n` +
      `📝 *Script:*\n_${segmentText.substring(0, 250)}${segmentText.length > 250 ? '...' : ''}_\n\n` +
      `💡 *Suggested search:* "${query}"\n\n` +
      `👇 Click the button below, then send your image:`,
      {
        parse_mode: 'Markdown',
        reply_markup: {
          inline_keyboard: [[
            { text: '📤 Upload Image', callback_data: `upload_segment_${id}_${segmentIndex}` }
          ]]
        }
      }
    );
  } catch (error) {
    console.error(`❌ Failed to request upload for segment ${segmentIndex + 1}:`, error.message);
    throw error;
  }
}

async function notifyAllImagesComplete({ id, user_id }) {
  try {
    const jobInfo  = await getJobInfo(id);
    const segments = jobInfo?.segments || [];
    await bot.telegram.sendMessage(
      user_id,
      `🎉 *All Images Complete*\n\n` +
      `✅ Successfully processed ${segments.length} segment(s)\n\n` +
      `Moving to audio generation...`,
      { parse_mode: 'Markdown' }
    );
  } catch (error) {
    console.error(`Failed to notify all images complete:`, error);
  }
}

async function notifySegmentVideoForReview({ 
  id, user_id, segmentIndex, totalSegments, 
  segmentText, videoUrl, query 
}) {
  try {
    const response = await axios.get(videoUrl, {
      responseType: 'arraybuffer',
      timeout: 60000,
      maxContentLength: 50 * 1024 * 1024
    });

    const videoBuffer = Buffer.from(response.data);

    await bot.telegram.sendVideo(
      user_id,
      { source: videoBuffer, filename: `stock_segment_${segmentIndex + 1}.mp4` },
      {
        caption:
          `🎬 *Video clip for Segment ${segmentIndex + 1}/${totalSegments}*\n\n` +
          `📝 *Text:* ${segmentText.substring(0, 150)}` +
          `${segmentText.length > 150 ? '...' : ''}\n\n` +
          `❓ Is this video suitable?`,
        parse_mode: 'Markdown',
        supports_streaming: true,
        reply_markup: {
          inline_keyboard: [
            [
              { 
                text: '✅ Approve', 
                callback_data: `approve_video_${id}_${segmentIndex}` 
              },
              { 
                text: '🔄 Refetch', 
                callback_data: `refetch_video_${id}_${segmentIndex}` 
              }
            ],
            // ✅ NEW: Upload My Own button - mirrors image flow
            [
              { 
                text: '📤 Upload My Own', 
                callback_data: `upload_video_${id}_${segmentIndex}` 
              }
            ]
          ]
        }
      }
    );
  } catch (error) {
    console.error(`❌ Failed to send stock video:`, error.message);
    try {
      // Fallback: send as link with upload option
      await bot.telegram.sendMessage(
        user_id,
        `🎬 *Video clip for Segment ${segmentIndex + 1}/${totalSegments}*\n\n` +
        `⚠️ Could not preview video. Download:\n${videoUrl}`,
        {
          parse_mode: 'Markdown',
          reply_markup: {
            inline_keyboard: [
              [
                { 
                  text: '✅ Approve', 
                  callback_data: `approve_video_${id}_${segmentIndex}` 
                },
                { 
                  text: '🔄 Refetch', 
                  callback_data: `refetch_video_${id}_${segmentIndex}` 
                }
              ],
              [
                { 
                  text: '📤 Upload My Own', 
                  callback_data: `upload_video_${id}_${segmentIndex}` 
                }
              ]
            ]
          }
        }
      );
    } catch (fallbackError) {
      console.error(`❌ Fallback also failed:`, fallbackError.message);
      throw error;
    }
  }
}

async function notifyAllVideosComplete({ id, user_id }) {
  try {
    await bot.telegram.sendMessage(
      user_id,
      `🎉 *All Videos Complete*\n\n` +
      `✅ All video segments approved!\n\n` +
      `Moving to audio generation...`,
      { parse_mode: 'Markdown' }
    );
  } catch (error) {
    console.error(`Failed to notify videos complete:`, error);
  }
}

async function notifyAudioForReview({ id, user_id, result_audio }) {
  try {
    console.log(`📤 Sending audio for review to user ${user_id}`);

    const response = await axios.get(result_audio, {
      responseType: 'arraybuffer',
      timeout: 60000,
      maxContentLength: 50 * 1024 * 1024
    });

    const audioBuffer = Buffer.from(response.data);

    await bot.telegram.sendAudio(
      user_id,
      { source: audioBuffer, filename: `narration_${id}.mp3` },
      {
        caption: `🎵 *Audio Generated*\n\nAre you happy with this voiceover?`,
        parse_mode: 'Markdown',
        reply_markup: {
          inline_keyboard: [[
            { text: '✅ Approve Audio',    callback_data: `approve_audio_${id}`    },
            { text: '🔄 Regenerate Audio', callback_data: `regenerate_audio_${id}` }
          ]]
        }
      }
    );
  } catch (error) {
    console.error(`❌ Failed to send audio:`, error.message);
    try {
      await bot.telegram.sendMessage(
        user_id,
        `🎵 *Audio Generated*\n\n⚠️ Could not send directly. Download:\n${result_audio}`,
        {
          parse_mode: 'Markdown',
          reply_markup: {
            inline_keyboard: [[
              { text: '✅ Approve Audio',    callback_data: `approve_audio_${id}`    },
              { text: '🔄 Regenerate Audio', callback_data: `regenerate_audio_${id}` }
            ]]
          }
        }
      );
    } catch (fallbackError) {
      console.error(`❌ Fallback also failed:`, fallbackError.message);
    }
  }
}

async function notifyVideoComplete({ id, user_id, result_video }) {

  // Check size first without downloading
  let fileSizeBytes = 0;
  try {
    const headResponse = await axios.head(result_video, { timeout: 15000 });
    fileSizeBytes = parseInt(headResponse.headers['content-length'] || '0', 10);
    console.log(`📦 Video size: ${(fileSizeBytes / 1024 / 1024).toFixed(2)} MB`);
  } catch (headErr) {
    console.warn(`⚠️ Could not HEAD video URL: ${headErr.message}`);
  }

  const DOWNLOAD_SIZE_LIMIT = 2000 * 1024 * 1024; // 2GB

  if (fileSizeBytes > DOWNLOAD_SIZE_LIMIT) {
    await sendVideoAsLink(user_id, result_video, id, fileSizeBytes);
    return;
  }

  // Download the file
  let videoBuffer;
  try {
    const response = await axios.get(result_video, {
      responseType: 'arraybuffer',
      timeout: 300000,
      maxContentLength: DOWNLOAD_SIZE_LIMIT,
      maxBodyLength: DOWNLOAD_SIZE_LIMIT
    });
    videoBuffer = Buffer.from(response.data);
  } catch (downloadErr) {
    console.error(`❌ Download failed: ${downloadErr.message}`);
    await sendVideoAsLink(user_id, result_video, id, fileSizeBytes);
    return;
  }

  const actualSizeMB = (videoBuffer.length / 1024 / 1024).toFixed(2);
  console.log(`✅ Downloaded: ${actualSizeMB} MB`);

  // Use local sender for large files, official API for small ones
  const isLargeFile = videoBuffer.length > 45 * 1024 * 1024;
  const sender = (isLargeFile && localTelegram) ? localTelegram : bot.telegram;

  console.log(
    `📤 Sending via: ${isLargeFile && localTelegram ? 'local API' : 'official API'} ` +
    `(${actualSizeMB}MB)`
  );

  // Try sendVideo
  try {
    await sender.sendVideo(
      user_id,
      { source: videoBuffer, filename: `video_${id}.mp4` },
      {
        caption: `🎬 *Your video is ready!* 🎉`,
        parse_mode: 'Markdown',
        supports_streaming: true
      }
    );
    console.log(`✅ Video sent to user ${user_id}`);
    return;
  } catch (videoErr) {
    console.warn(`⚠️ sendVideo failed: ${videoErr.message} — trying document`);
  }

  // Try sendDocument
  try {
    await sender.sendDocument(
      user_id,
      { source: videoBuffer, filename: `video_${id}.mp4` },
      {
        caption: `🎬 *Your video is ready!* 🎉\n\n📁 Sent as document.`,
        parse_mode: 'Markdown'
      }
    );
    console.log(`✅ Video sent as document to user ${user_id}`);
    return;
  } catch (docErr) {
    console.warn(`⚠️ sendDocument failed: ${docErr.message} — sending link`);
    await sendVideoAsLink(user_id, result_video, id, videoBuffer.length);
  }
}
// ─── Helper: Send video as plain text link (no Markdown on the URL) ──────────
async function sendVideoAsLink(user_id, result_video, id, fileSizeBytes) {
  const sizeMB = fileSizeBytes ? ` (${(fileSizeBytes / 1024 / 1024).toFixed(0)}MB)` : '';
  
  try {
    // ⚠️  Use HTML parse_mode so the URL stays untouched
    // Markdown chokes on underscores and dots in R2/S3 URLs
    await bot.telegram.sendMessage(
      user_id,
      `🎬 <b>Your video is ready!</b> 🎉\n\n` +
      `⚠️ File${sizeMB} is too large to send directly.\n\n` +
      `📥 <b>Download your video:</b>\n` +
      `${result_video}\n\n` +
      `<i>Link valid for 7 days</i>`,
      { 
        parse_mode: 'HTML',   // ← HTML, not Markdown — URLs are safe
        disable_web_page_preview: true
      }
    );
    console.log(`✅ Download link sent to user ${user_id}`);
  } catch (linkErr) {
    // Last resort — no parse_mode at all, plain text
    console.error(`❌ Even link message failed: ${linkErr.message}`);
    try {
      await bot.telegram.sendMessage(
        user_id,
        `Your video is ready! Download here:\n${result_video}`,
        { disable_web_page_preview: true }
      );
    } catch (finalErr) {
      console.error(`❌ All delivery attempts failed for user ${user_id}:`, finalErr.message);
    }
  }
}

// ============================================
// 📝 SCRIPT BUFFERING
// ============================================

function clearScriptTimeout(chatId) {
  const timeoutId = scriptTimeouts.get(chatId);
  if (timeoutId) {
    clearTimeout(timeoutId);
    scriptTimeouts.delete(chatId);
  }
}

async function processBufferedScript(ctx, chatId) {
  const userData = userStates.get(chatId);
  if (!userData || !userData.scriptBuffer || userData.scriptBuffer.length === 0) return;

  clearScriptTimeout(chatId);

  const fullScript = userData.scriptBuffer.join('\n\n');
  userData.inputText = fullScript;
  delete userData.scriptBuffer;
  delete userData.bufferingScript;

  const estimatedDuration = estimateDurationFromScript(fullScript);
  userData.duration = Math.min(estimatedDuration, 30);

  await ctx.reply(
    `⏱ Estimated duration: *${userData.duration} min*`,
    { parse_mode: 'Markdown' }
  );

  userStates.set(chatId, userData);

  return ctx.reply(
    'Choose the video type:',
    Markup.keyboard([['Shorts', 'Reels'], ['Longform']]).oneTime().resize()
  );
}

function setScriptTimeout(ctx, chatId) {
  clearScriptTimeout(chatId);
  const timeoutId = setTimeout(async () => {
    await processBufferedScript(ctx, chatId);
  }, SCRIPT_BUFFER_TIMEOUT);
  scriptTimeouts.set(chatId, timeoutId);
}

// ============================================
// 🤖 BOT COMMANDS
// ============================================

bot.start(async (ctx) => {
  clearScriptTimeout(ctx.chat.id);
  userStates.set(ctx.chat.id, {});

  await createSessionIfNotExists(ctx.chat.id, {
    username:  ctx.from.username   || null,
    firstName: ctx.from.first_name || null,
  });

  return ctx.reply(
    '🎬 Choose your content flow.',
    Markup.keyboard([['📰 Essay Styled Videos'], ['📋 Listicle Videos']]).oneTime().resize()
  );
});

bot.hears(['📰 Essay Styled Videos', '📋 Listicle Videos'], async (ctx) => {
  const userData    = userStates.get(ctx.chat.id) || {};
  const contentFlow = ctx.message.text === '📰 Essay Styled Videos' ? 'news' : 'listicle';

  userData.content_flow = contentFlow;
  userStates.set(ctx.chat.id, userData);

  ctx.reply(
    `✅ ${contentFlow === 'listicle' ? 'Listicle' : 'Essay Styled'} Videos selected!\n\nHow would you like to begin?`,
    Markup.keyboard([['📝 Script'], ['💡 Prompt']]).oneTime().resize()
  );
});

bot.hears(['📝 Script', '💡 Prompt'], async (ctx) => {
  const isPrompt = ctx.message.text.includes('Prompt');
  const userData = userStates.get(ctx.chat.id) || {};
  userData.mode  = isPrompt ? 'prompt' : 'script';
  userStates.set(ctx.chat.id, userData);
  ctx.reply(`Please enter your ${isPrompt ? 'prompt' : 'script'}:`);
});

bot.telegram.setMyCommands([
  { command: 'start',       description: 'Start or reset your session'                },
  { command: 'demo',        description: 'Watch tutorial on how to use Tubecelerator' },
  { command: 'samples',     description: 'View sample videos'                         },
  { command: 'credits',     description: 'Check your remaining credits'               },
  { command: 'status',      description: 'View your plan status and expiry'           },
  { command: 'mydashboard', description: 'Open your personal dashboard'               },
  { command: 'support',     description: 'Contact support team'                       },
]);

function isAdmin(ctx) {
  return ADMIN_IDS.includes(ctx.from.id);
}

// ============================================
// 👑 ADMIN COMMANDS
// ============================================

bot.command('process', async (ctx) => {
  if (!isAdmin(ctx)) return ctx.reply('❌ Admin only command');

  const parts = ctx.message.text.split(' ');

  try {
    if (parts.length === 1) {
      await axios.post(`${WORKER_BASE_URL}/wake-up`, { action: 'admin_manual_all', timestamp: Date.now() }, { timeout: 5000 });
      ctx.reply('✅ Worker woken to process all pending jobs');
    } else {
      const jobId = parseInt(parts[1]);
      if (isNaN(jobId)) return ctx.reply('Usage: /process [jobId]');
      await axios.post(`${WORKER_BASE_URL}/wake-up`, { jobId, action: 'admin_specific_job', timestamp: Date.now() }, { timeout: 5000 });
      ctx.reply(`✅ Worker processing job ${jobId}`);
    }
  } catch (error) {
    ctx.reply(`❌ Failed: ${error.message}`);
  }
});

bot.command('jobstatus', async (ctx) => {
  if (!isAdmin(ctx)) return;

  const parts = ctx.message.text.split(' ');
  if (parts.length !== 2) return ctx.reply('Usage: /jobstatus <jobId>');

  const jobId = parseInt(parts[1]);

  try {
    const result   = await pool.query('SELECT * FROM jobs WHERE id = $1', [jobId]);
    if (result.rows.length === 0) return ctx.reply(`❌ Job ${jobId} not found`);

    const job      = result.rows[0];
    const segments = job.segments || [];
    const done     = segments.filter(s => s.imageUrl || s.videoUrl).length;

    ctx.reply(
      `📊 *Job ${jobId} Status*\n\n` +
      `Status: \`${job.status}\`\n` +
      `User: ${job.user_id}\n` +
      `Type: ${job.videotype}\n` +
      `Voice: ${job.voice}\n` +
      `Flow: ${job.content_flow || 'news'}\n` +
      `Media: ${job.media_type || 'images'} (${job.media_mode || 'auto'})\n` +
      `Segments: ${done}/${segments.length} complete\n` +
      `Captions: ${job.add_captions ? `Yes (${job.caption_style})` : 'No'}\n\n` +
      `Created: ${new Date(job.created_at).toLocaleString()}\n` +
      `Updated: ${new Date(job.updated_at).toLocaleString()}\n\n` +
      `${job.error_message ? `⚠️ Error: ${job.error_message}` : '✅ No errors'}`,
      { parse_mode: 'Markdown' }
    );
  } catch (error) {
    ctx.reply(`❌ Database error: ${error.message}`);
  }
});

bot.command('setstatus', async (ctx) => {
  if (!isAdmin(ctx)) return;

  const parts = ctx.message.text.split(' ');
  if (parts.length < 3) {
    return ctx.reply(
      '⚙️ *Set Job Status*\n\nUsage: `/setstatus <jobId> <status>`\n\n*Valid statuses:*\n' +
      '• `pending`\n• `text_approved`\n• `segments_ready`\n' +
      '• `image_segment_approved`\n• `images_approved`\n' +
      '• `audio_approved`\n• `captions_ready`',
      { parse_mode: 'Markdown' }
    );
  }

  const jobId     = parseInt(parts[1]);
  const newStatus = parts[2];

  const validStatuses = [
    'pending', 'text_approved', 'segments_ready',
    'image_segment_approved', 'video_segment_approved',
    'images_approved', 'videos_approved', 'audio_approved', 'captions_ready'
  ];

  if (isNaN(jobId))                       return ctx.reply('❌ Invalid job ID.');
  if (!validStatuses.includes(newStatus)) return ctx.reply(`❌ Invalid status.`);

  try {
    const check = await pool.query('SELECT id, status FROM jobs WHERE id = $1', [jobId]);
    if (check.rows.length === 0) return ctx.reply(`❌ Job ${jobId} not found`);

    const oldStatus = check.rows[0].status;

    await pool.query(
      `UPDATE jobs SET status = $1, error_message = NULL, retry_count = 0, updated_at = NOW() WHERE id = $2`,
      [newStatus, jobId]
    );

    await wakeWorker(jobId, 'admin_status_change');

    ctx.reply(
      `✅ *Job ${jobId} Updated*\n\nOld: \`${oldStatus}\`\nNew: \`${newStatus}\`\n\n🔔 Worker notified.`,
      { parse_mode: 'Markdown' }
    );
  } catch (error) {
    ctx.reply(`❌ Error: ${error.message}`);
  }
});

bot.command('listjobs', async (ctx) => {
  if (!isAdmin(ctx)) return;

  try {
    const result = await pool.query(
      `SELECT id, user_id, status, videotype,
              EXTRACT(EPOCH FROM (NOW() - updated_at))/60 as minutes_ago
       FROM jobs
       WHERE status NOT IN ('completed', 'error')
       ORDER BY updated_at DESC LIMIT 10`
    );

    if (result.rows.length === 0) return ctx.reply('✅ No pending jobs');

    let message = '📋 *Pending Jobs*\n\n';
    result.rows.forEach(job => {
      message +=
        `*Job ${job.id}*\nStatus: \`${job.status}\`\n` +
        `User: ${job.user_id}\nUpdated: ${Math.round(job.minutes_ago)}m ago\n\n`;
    });
    ctx.reply(message, { parse_mode: 'Markdown' });
  } catch (error) {
    ctx.reply(`❌ Error: ${error.message}`);
  }
});

bot.command('replacemedia', async (ctx) => {
  if (!isAdmin(ctx)) return;

  const parts = ctx.message.text.split(' ');
  if (parts.length !== 3) return ctx.reply('Usage: /replacemedia <jobId> <segmentIndex>');

  const jobId        = parseInt(parts[1]);
  const segmentIndex = parseInt(parts[2]);
  if (isNaN(jobId) || isNaN(segmentIndex)) return ctx.reply('❌ Invalid jobId or segmentIndex');

  try {
    const response = await axios.get(`${WORKER_BASE_URL}/job-info/${jobId}`);
    const job      = response.data.job;
    if (!job) return ctx.reply('❌ Job not found');

    const mediaType = job.media_type || 'images';

    const userData = userStates.get(ctx.chat.id) || {};
    userData.adminReplacingMedia = {
      jobId,
      segmentIndex,
      userId: job.user_id,
      mediaType: mediaType === 'videos' ? 'video' : 'image'
    };
    userStates.set(ctx.chat.id, userData);

    ctx.reply(
      `📤 *Replace Media for Job ${jobId}, Segment ${segmentIndex}*\n\nSend your ${mediaType === 'videos' ? 'video' : 'image'} now:`,
      { parse_mode: 'Markdown' }
    );
  } catch (error) {
    ctx.reply('❌ Error fetching job info');
  }
});

bot.command('checkuser', async (ctx) => {
  if (!isAdmin(ctx)) return;

  const parts = ctx.message.text.split(' ');
  if (parts.length !== 2) return ctx.reply('Usage: /checkuser <telegramId>');

  const telegramId = parts[1];
  const creditInfo = await getCredits(telegramId);

  if (creditInfo.amount === 0 && !creditInfo.expiresAt) {
    return ctx.reply(`📊 User ${telegramId} has no credits.`);
  }

  const expiryDate = creditInfo.expiresAt ? new Date(creditInfo.expiresAt) : null;
  const daysLeft   = expiryDate ? Math.ceil((expiryDate - new Date()) / (1000 * 60 * 60 * 24)) : null;

  ctx.reply(
    `📊 *User Credit Info*\n\n🆔 User: ${telegramId}\n💰 Credits: ${creditInfo.amount}\n` +
    `📅 Expires: ${expiryDate ? expiryDate.toDateString() : 'Never'}\n` +
    `⏰ Days Left: ${daysLeft !== null ? daysLeft : 'N/A'}\n❌ Expired: ${creditInfo.isExpired ? 'Yes' : 'No'}`,
    { parse_mode: 'Markdown' }
  );
});

bot.command('extend', async (ctx) => {
  if (!isAdmin(ctx)) return;

  const parts = ctx.message.text.split(' ');
  if (parts.length !== 2) return ctx.reply('Usage: /extend <telegramId>');

  const telegramId = parts[1];

  try {
    const creditInfo = await getCredits(telegramId);
    if (creditInfo.amount === 0) return ctx.reply('❌ User has no credits. Use /approve first.');

    const newExpiry = new Date();
    newExpiry.setDate(newExpiry.getDate() + 30);

    await pool.query('UPDATE credits SET expires_at = $1 WHERE telegram_id = $2', [newExpiry, telegramId]);

    ctx.reply(
      `✅ *Credits Extended*\n\n👤 User: ${telegramId}\n💰 Balance: ${creditInfo.amount}\n📅 New Expiry: ${newExpiry.toDateString()}`,
      { parse_mode: 'Markdown' }
    );

    try {
      await bot.telegram.sendMessage(
        telegramId,
        `🎉 *Credits Extended!*\n\nYour credits have been extended by 30 days.\n\n📅 New Expiry: ${newExpiry.toDateString()}`,
        { parse_mode: 'Markdown' }
      );
    } catch (error) {
      ctx.reply('⚠️ Could not notify user.');
    }
  } catch (error) {
    ctx.reply(`❌ Error: ${error.message}`);
  }
});

bot.command('resend', async (ctx) => {
  if (!isAdmin(ctx)) return;

  const parts = ctx.message.text.split(' ');
  const jobId = parts.length === 2 ? parseInt(parts[1]) : null;

  if (!jobId || isNaN(jobId)) return ctx.reply('Usage: /resend <jobId>');

  const result = await pool.query('SELECT * FROM jobs WHERE id = $1', [jobId]);
  const job    = result.rows[0];

  if (!job || !job.result_video) return ctx.reply('❌ Job not found or no video available');

  await notifyVideoComplete({ id: job.id, user_id: job.user_id, result_video: job.result_video });
  ctx.reply('✅ Re-sent video notification');
});

bot.command('resetjob', async (ctx) => {
  if (!isAdmin(ctx)) return;

  const parts = ctx.message.text.split(' ');
  if (parts.length !== 2) return ctx.reply('Usage: /resetjob <jobId>');

  const jobId = parseInt(parts[1]);

  try {
    await pool.query(
      `UPDATE jobs SET status = 'audio_approved', result_video = NULL, error_message = NULL, updated_at = NOW() WHERE id = $1`,
      [jobId]
    );
    ctx.reply(`✅ Job ${jobId} reset to audio_approved.`);
  } catch (error) {
    ctx.reply(`❌ Error: ${error.message}`);
  }
});

bot.command('resume', async (ctx) => {
  if (!isAdmin(ctx)) return;

  const parts = ctx.message.text.split(' ');
  if (parts.length !== 2) return ctx.reply('Usage: /resume <jobId>');

  const jobId = parseInt(parts[1]);

  try {
    const jobResult = await pool.query('SELECT id, status, segments FROM jobs WHERE id = $1', [jobId]);
    if (jobResult.rows.length === 0) return ctx.reply(`❌ Job ${jobId} not found`);

    const job      = jobResult.rows[0];
    const segments = job.segments || [];
    const done     = segments.filter(s => s.imageUrl).length;

    let resumeStatus = 'segments_ready';
    if (job.status.includes('audio'))  resumeStatus = 'images_approved';
    else if (job.status.includes('image')) resumeStatus = 'segments_ready';
    else if (job.status.includes('text'))  resumeStatus = 'text_approved';

    await pool.query('UPDATE jobs SET status = $1, updated_at = NOW() WHERE id = $2', [resumeStatus, jobId]);

    ctx.reply(
      `✅ Job ${jobId} resumed!\n\n📊 Progress: ${done}/${segments.length} segments\n🔄 Status: ${resumeStatus}`
    );
  } catch (error) {
    ctx.reply(`❌ Error: ${error.message}`);
  }
});

bot.command('admin', (ctx) => {
  if (!isAdmin(ctx)) return;
  ctx.reply('🔐 Admin Panel Access Granted.');
});

bot.command('approve', async (ctx) => {
  if (!isAdmin(ctx)) return;

  const parts = ctx.message.text.split(' ');
  if (parts.length !== 3) return ctx.reply('Usage: /approve <telegramId> <credits>');

  const telegramId = String(parts[1]);
  const credits    = parseInt(parts[2]);

  if (isNaN(credits) || credits <= 0) return ctx.reply('❌ Invalid credit amount.');

  try {
    const transactionId = `admin_${ctx.from.id}_${telegramId}_${Date.now()}`;
    const result        = await setCredits(telegramId, credits, transactionId, 'admin_approval');

    if (result.alreadyProcessed) return ctx.reply(`⚠️ Credits already added to user ${telegramId} recently.`);

    const expiryDate = new Date(result.expiresAt);

    ctx.reply(
      `✅ *Credits Approved*\n\n👤 User: ${telegramId}\n💰 Credits: ${credits}\n📅 Expires: ${expiryDate.toDateString()}`,
      { parse_mode: 'Markdown' }
    );

    try {
      await bot.telegram.sendMessage(
        telegramId,
        `🎉 *Credits Received!*\n\n💰 Amount: *${credits}* credits\n📅 Expires: *${expiryDate.toDateString()}*\n\nUse /start to begin!`,
        { parse_mode: 'Markdown' }
      );
    } catch (error) {
      ctx.reply(`⚠️ Could not notify user ${telegramId}.`);
    }
  } catch (error) {
    ctx.reply(`❌ Error: ${error.message}`);
  }
});

bot.command('sendvideo', async (ctx) => {
  if (!isAdmin(ctx)) return;

  const parts = ctx.message.text.split(' ');
  if (parts.length !== 2) return ctx.reply('Usage: /sendvideo <telegramId>');

  const targetId = parts[1];
  if (!/^\d+$/.test(targetId)) return ctx.reply('❌ Invalid Telegram ID.');

  const prevState = userStates.get(ctx.chat.id) || {};
  userStates.set(ctx.chat.id, { ...prevState, sendVideoTo: targetId });
  ctx.reply('📹 Send the video you want to forward to the user.');
});

bot.command('quickvideo', async (ctx) => {
  if (!isAdmin(ctx)) return ctx.reply('❌ Admin only.');

  ctx.reply(
    '🚀 *Quick Video Generator*\n\nSend your config as JSON:\n\n' +
    '```json\n{\n  "script": "Your script",\n  "videotype": "longform",\n  "duration": 2,\n' +
    '  "voice": "Aria",\n  "content_flow": "news",\n  "media_type": "images",\n' +
    '  "status": "segments_ready"\n}\n```',
    { parse_mode: 'Markdown' }
  );

  const userData = userStates.get(ctx.chat.id) || {};
  userData.awaitingQuickVideo = true;
  userStates.set(ctx.chat.id, userData);
});

bot.command('cancelquick', async (ctx) => {
  if (!isAdmin(ctx)) return;
  const userData = userStates.get(ctx.chat.id) || {};
  if (userData.awaitingQuickVideo) {
    delete userData.awaitingQuickVideo;
    userStates.set(ctx.chat.id, userData);
    ctx.reply('❌ Quick video cancelled.');
  }
});

// ============================================
// 💬 USER COMMANDS
// ============================================

bot.command(['credit', 'credits'], async (ctx) => {
  const creditInfo = await getCredits(ctx.chat.id);

  if (creditInfo.isExpired) {
    return ctx.reply(
      `⏳ *Your credits have expired*\n\n💰 Expired Balance: ${creditInfo.amount} credits\n\nPlease contact /support to renew.`,
      { parse_mode: 'Markdown' }
    );
  }

  if (!creditInfo.expiresAt) {
    return ctx.reply(`💰 You have ${creditInfo.amount} credit(s) left.`);
  }

  const expiryDate = new Date(creditInfo.expiresAt);
  const daysLeft   = Math.ceil((expiryDate - new Date()) / (1000 * 60 * 60 * 24));

  ctx.reply(
    `💰 *Your Credits*\n\nBalance: *${creditInfo.amount}* credit(s)\n` +
    `Expires: *${expiryDate.toDateString()}*\n⏰ Days left: *${daysLeft}*\n\nNeed more? Contact /support!`,
    { parse_mode: 'Markdown' }
  );
});

bot.command('status', async (ctx) => {
  const creditInfo = await getCredits(ctx.chat.id);
  let statusMsg    = `🧾 *Your Status*\n\n`;

  if (creditInfo.isExpired) {
    statusMsg += `💰 Credits: ${creditInfo.amount} (Expired)\n📅 Expired: ${new Date(creditInfo.expiresAt).toDateString()}\n\n⚠️ Contact /support to top up.`;
  } else if (creditInfo.expiresAt) {
    const expiryDate = new Date(creditInfo.expiresAt);
    const daysLeft   = Math.ceil((expiryDate - new Date()) / (1000 * 60 * 60 * 24));
    statusMsg += `💰 Credits: *${creditInfo.amount}*\n📅 Expires: ${expiryDate.toDateString()}\n⏰ Days left: *${daysLeft}*`;
  } else {
    statusMsg += `💰 Credits: ${creditInfo.amount}\n📅 No expiration set`;
  }

  ctx.reply(statusMsg, { parse_mode: 'Markdown' });
});

bot.command('mydashboard', async (ctx) => {
  await createSessionIfNotExists(ctx.chat.id);
  const creditInfo = await getCredits(ctx.chat.id);
  let msg          = `📊 *Your Dashboard*\n\n`;

  if (creditInfo.isExpired) {
    msg += `💰 Credits: ${creditInfo.amount} *(Expired)*\n📅 Expired: ${new Date(creditInfo.expiresAt).toDateString()}\n\n⚠️ Contact /support`;
  } else if (creditInfo.expiresAt) {
    const expiryDate = new Date(creditInfo.expiresAt);
    const daysLeft   = Math.ceil((expiryDate - new Date()) / (1000 * 60 * 60 * 24));
    msg += `💰 Credits: *${creditInfo.amount}*\n📅 Expires: ${expiryDate.toDateString()}\n⏰ Days Left: *${daysLeft} day(s)*`;
  } else {
    msg += `💰 Credits: ${creditInfo.amount}\n📅 No expiration`;
  }

  return ctx.replyWithMarkdown(msg, { disable_web_page_preview: true });
});

bot.command('samples', async (ctx) => {
  try {
    await ctx.reply('🎬 *Sample videos:*', { parse_mode: 'Markdown' });

    const samplesDir = path.join(__dirname, 'sample-videos');
    if (!fs.existsSync(samplesDir)) return ctx.reply('⚠️ No sample videos available.');

    const files = fs.readdirSync(samplesDir).filter(f =>
      f.endsWith('.mp4') || f.endsWith('.mov') || f.endsWith('.avi')
    );

    if (files.length === 0) return ctx.reply('⚠️ No sample videos found.');

    for (let i = 0; i < files.length; i++) {
      try {
        await ctx.replyWithVideo(
          { source: path.join(samplesDir, files[i]) },
          { caption: `🎥 *Sample ${i + 1}*`, parse_mode: 'Markdown', supports_streaming: true }
        );
      } catch (err) {
        console.warn(`⚠️ Could not send sample: ${files[i]}`);
      }
    }

    await ctx.reply('✨ Use /start to create your own!', { parse_mode: 'Markdown' });
  } catch (error) {
    ctx.reply('❌ Error loading samples.');
  }
});

bot.command('demo', async (ctx) => {
  await ctx.reply(
    '📚 *Step-by-step guide on how to use Tubecelerator*\n\n' +
    '▶️ Watch here:\nhttps://youtu.be/aaZzVXXHiPY?si=aOOkhuz2JtP65UHi\n\n' +
    '✨ Ready? Use /start\n💬 Need help? Use /support',
    { parse_mode: 'Markdown', disable_web_page_preview: false }
  );
});

bot.command('support', async (ctx) => {
  const userData       = userStates.get(ctx.chat.id) || {};
  userData.supportMode = true;
  userStates.set(ctx.chat.id, userData);
  await setUserSession(ctx.chat.id, { supportMode: true, expectingHash: false });

  ctx.reply(
    '💬 *Support Mode Activated*\n\nSend your message and our team will respond shortly.',
    { parse_mode: 'Markdown' }
  );
});

bot.command('endsupport', async (ctx) => {
  if (!isAdmin(ctx)) {
    const userData = userStates.get(ctx.chat.id) || {};
    delete userData.supportMode;
    userStates.set(ctx.chat.id, userData);
    await setUserSession(ctx.chat.id, { supportMode: false });
    return ctx.reply('✅ Support mode ended. Use /support to start a new session.');
  }

  const parts    = ctx.message.text.split(' ');
  if (parts.length !== 2) return ctx.reply('Usage: /endsupport <telegramId>');

  const targetId = Number(parts[1]);
  if (isNaN(targetId)) return ctx.reply('❌ Invalid Telegram ID.');

  const state = userStates.get(targetId);
  if (state?.supportMode) { delete state.supportMode; userStates.set(targetId, state); }
  await setUserSession(targetId, { supportMode: false });

  try {
    await bot.telegram.sendMessage(targetId, '✅ Your support session has been closed. Type /support to start a new one.');
    ctx.reply(`✅ Support ended for user ${targetId}.`);
  } catch (err) {
    ctx.reply(`⚠️ Support ended but could not notify user ${targetId}.`);
  }
});

bot.command('startsupport', async (ctx) => {
  if (!isAdmin(ctx)) return;

  const parts    = ctx.message.text.split(' ');
  if (parts.length !== 2) return ctx.reply('Usage: /startsupport <telegramId>');

  const targetId = parts[1];
  if (!/^\d+$/.test(targetId)) return ctx.reply('❌ Invalid Telegram ID.');

  try {
    const userState       = userStates.get(Number(targetId)) || {};
    userState.supportMode = true;
    userStates.set(Number(targetId), userState);
    await setUserSession(targetId, { supportMode: true, expectingHash: false });

    await bot.telegram.sendMessage(
      targetId,
      '💬 *Support Mode Activated*\n\nAn admin has opened a support session with you.',
      { parse_mode: 'Markdown' }
    );
    ctx.reply(`✅ Support mode enabled for user ${targetId}.`);
  } catch (err) {
    ctx.reply(`❌ Failed: ${err.message}`);
  }
});

// ============================================
// 📞 CALLBACK QUERY HANDLER
// ============================================

bot.on('callback_query', async (ctx) => {
  const callbackData = ctx.callbackQuery.data;

  console.log('Callback:', callbackData, '| User:', ctx.from.id);

  try {
    // ── Job approval (admin) ──────────────────────────────────────────
    if (callbackData.startsWith('approve_job_')) {
      if (!isAdmin(ctx)) return ctx.answerCbQuery('❌ Admin only', true);

      const jobId = callbackData.replace('approve_job_', '');
      try {
        const response = await axios.post(`${WORKER_BASE_URL}/approve-job`, { jobId: parseInt(jobId) });
        if (response.data.success) {
          const job = response.data.job;
          await wakeWorker(jobId, 'job_approved');
          await ctx.editMessageText(
            `✅ *VIDEO APPROVED*\n\n🎬 Job ID: ${jobId}\n*Approved by:* @${ctx.from.username || ctx.from.first_name}`,
            { parse_mode: 'Markdown' }
          );
          await ctx.answerCbQuery('✅ Approved! Processing started.');
          await bot.telegram.sendMessage(
            job.user_id,
            '✅ *Your video request has been approved!*\n\n🎬 Processing has started.',
            { parse_mode: 'Markdown' }
          );
        } else {
          await ctx.answerCbQuery('❌ Failed to approve', true);
        }
      } catch (error) {
        await ctx.answerCbQuery('❌ Error', true);
      }
      return;
    }

    // ── Image segment approval ────────────────────────────────────────
    if (callbackData.startsWith('approve_segment_')) {
      const parts        = callbackData.split('_');
      const jobId        = parts[2];
      const segmentIndex = parts[3];

      try {
        const response = await axios.post(`${WORKER_BASE_URL}/approve-segment`, {
          jobId: parseInt(jobId), segmentIndex: parseInt(segmentIndex)
        });
        if (response.data.success) {
          await wakeWorker(jobId, 'segment_approved');
          await ctx.editMessageCaption(`✅ *Segment ${parseInt(segmentIndex) + 1} Approved!*\n\nMoving to next...`, { parse_mode: 'Markdown' });
          await ctx.answerCbQuery('Approved!');
        } else {
          await ctx.answerCbQuery('Failed to approve', true);
        }
      } catch (error) {
        await ctx.answerCbQuery('Error processing request', true);
      }
      return;
    }

    // ── Image segment refetch ─────────────────────────────────────────
    if (callbackData.startsWith('refetch_segment_')) {
      const parts        = callbackData.split('_');
      const jobId        = parts[2];
      const segmentIndex = parts[3];
      const creditCost   = 1;

      const currentCredits = await getCredits(ctx.chat.id);
      if (currentCredits.amount < creditCost) {
        return ctx.answerCbQuery(`Insufficient credits. Need ${creditCost}`, true);
      }
      await useCredits(ctx.chat.id, creditCost);

      try {
        const success = await triggerSegmentRefetch(parseInt(jobId), parseInt(segmentIndex));
        if (success) {
          await wakeWorker(jobId, 'segment_refetch');
          await ctx.editMessageCaption(`🔄 *Refetching image for Segment ${parseInt(segmentIndex) + 1}...*\n\n*${creditCost} credit deducted*`, { parse_mode: 'Markdown' });
          await ctx.answerCbQuery(`Refetching... ${creditCost} credit deducted`);
        } else {
          await ctx.answerCbQuery('Failed to trigger refetch', true);
        }
      } catch (error) {
        await ctx.answerCbQuery('Error processing request', true);
      }
      return;
    }

    // ── Image segment upload ──────────────────────────────────────────
    if (callbackData.startsWith('upload_segment_')) {
      const parts        = callbackData.split('_');
      const jobId        = parts[2];
      const segmentIndex = parts[3];

      const userData = userStates.get(ctx.chat.id) || {};
      userData.uploadingSegmentImage = { jobId, segmentIndex: parseInt(segmentIndex) };
      userStates.set(ctx.chat.id, userData);

      await ctx.editMessageCaption(`📤 *Upload Image for Segment ${parseInt(segmentIndex) + 1}*\n\nPlease send your image now:`, { parse_mode: 'Markdown' });
      await ctx.answerCbQuery('Send your image');
      return;
    }

    // ── Video segment upload (user uploads their own video) ──────────
if (callbackData.startsWith('upload_video_')) {
  const parts        = callbackData.split('_');
  // callback_data format: upload_video_{jobId}_{segmentIndex}
  const jobId        = parts[2];
  const segmentIndex = parts[3];

  const userData = userStates.get(ctx.chat.id) || {};

  // Store upload intent — bot.on('video') will read this
  userData.uploadingSegmentVideo = { 
    jobId, 
    segmentIndex: parseInt(segmentIndex) 
  };
  userStates.set(ctx.chat.id, userData);

  // Try to edit caption if it's a video message, else edit text
  try {
    await ctx.editMessageCaption(
      `📤 *Upload Video for Segment ${parseInt(segmentIndex) + 1}*\n\n` +
      `Please send your video clip now:\n\n` +
      `📋 *Requirements:*\n` +
      `• Max size: 50MB\n` +
      `• Formats: MP4, MOV, AVI\n` +
      `• Recommended: landscape for longform, portrait for shorts/reels`,
      { parse_mode: 'Markdown' }
    );
  } catch (editError) {
    // If editing fails (e.g. message is text), send new message
    await ctx.reply(
      `📤 *Upload Video for Segment ${parseInt(segmentIndex) + 1}*\n\n` +
      `Please send your video clip now:\n\n` +
      `📋 *Requirements:*\n` +
      `• Max size: 50MB\n` +
      `• Formats: MP4, MOV, AVI\n` +
      `• Recommended: landscape for longform, portrait for shorts/reels`,
      { parse_mode: 'Markdown' }
    );
  }

  await ctx.answerCbQuery('Send your video clip now 📤');
  return;
}
    
    // ── Video segment approval ────────────────────────────────────────
    if (callbackData.startsWith('approve_video_')) {
      const parts        = callbackData.split('_');
      const jobId        = parseInt(parts[2]);
      const segmentIndex = parseInt(parts[3]);

      try {
        const response = await axios.post(`${WORKER_BASE_URL}/approve-video-segment`, { jobId, segmentIndex });
        if (response.data.success) {
          await wakeWorker(jobId, 'video_segment_approved');
          await ctx.editMessageCaption(`✅ *Video Segment ${segmentIndex + 1} Approved!*`, { parse_mode: 'Markdown' });
          await ctx.answerCbQuery('✅ Approved!');
        } else {
          await ctx.answerCbQuery('Failed to approve', true);
        }
      } catch (error) {
        await ctx.answerCbQuery('Error processing request', true);
      }
      return;
    }

    // ── Video segment refetch ─────────────────────────────────────────
    if (callbackData.startsWith('refetch_video_')) {
      const parts        = callbackData.split('_');
      const jobId        = parts[2];
      const segmentIndex = parts[3];
      const creditCost   = 5;

      const currentCredits = await getCredits(ctx.chat.id);
      if (currentCredits.amount < creditCost) {
        return ctx.answerCbQuery(`Insufficient credits. Need ${creditCost}`, true);
      }
      await useCredits(ctx.chat.id, creditCost);

      try {
        const response = await axios.post(`${WORKER_BASE_URL}/refetch-video-segment`, {
          jobId: parseInt(jobId), segmentIndex: parseInt(segmentIndex)
        });
        if (response.data.success) {
          await wakeWorker(jobId, 'video_refetch');
          await ctx.editMessageCaption(`🔄 *Refetching video for Segment ${parseInt(segmentIndex) + 1}...*\n\n*${creditCost} credits deducted*`, { parse_mode: 'Markdown' });
          await ctx.answerCbQuery(`Refetching... ${creditCost} credits deducted`);
        } else {
          await ctx.answerCbQuery('Failed to trigger refetch', true);
        }
      } catch (error) {
        await ctx.answerCbQuery('Error processing request', true);
      }
      return;
    }

    // ── Script & audio approvals / edits / regenerations ─────────────
    const [action, type, jobId] = callbackData.split('_');

    if (action === 'approve') {
      if (type === 'script') {
        try {
          const response = await axios.post(`${WORKER_BASE_URL}/approve-script`, { jobId });
          if (response.data.success) {
            await wakeWorker(jobId, 'script_approved');
            await safeEditMessage(ctx, '✅ Script approved! Moving to next stage...');
            await ctx.answerCbQuery('Script approved!');
          } else {
            await ctx.answerCbQuery('Failed to approve script', true);
          }
        } catch (error) {
          await ctx.answerCbQuery('Error processing request', true);
        }

      } else if (type === 'audio') {
        try {
          const response = await axios.post(`${WORKER_BASE_URL}/approve-audio`, { jobId });
          if (response.data.success) {
            await wakeWorker(jobId, 'audio_approved');
            await safeEditMessage(ctx, '✅ Audio approved! Assembling final video...');
            await ctx.answerCbQuery('Audio approved!');
          } else {
            await ctx.answerCbQuery('Failed to approve audio', true);
          }
        } catch (error) {
          await ctx.answerCbQuery('Error processing request', true);
        }
      }

    } else if (action === 'edit' && type === 'script') {
      const userData         = userStates.get(ctx.chat.id) || {};
      userData.editingScript = jobId;
      userStates.set(ctx.chat.id, userData);
      await safeEditMessage(ctx, '✏️ Please send your edited script:');
      await ctx.answerCbQuery('Send your edited script');

    } else if (action === 'regenerate') {
      const jobInfo = await getJobInfo(jobId);
      if (!jobInfo) return ctx.answerCbQuery('Job not found', true);

      let creditCost = 0;
      if (type === 'script') {
        creditCost = 2;
      } else if (type === 'audio') {
        creditCost = (jobInfo.duration || 1) * 5;
      }

      const creditInfo = await getCredits(ctx.chat.id);
      const current    = typeof creditInfo === 'object' ? creditInfo.amount : creditInfo;

      if (current < creditCost) {
        return ctx.answerCbQuery(`Insufficient credits. Need ${creditCost}, have ${current}`, true);
      }

      await useCredits(ctx.chat.id, creditCost);

      try {
        const success = await triggerRegeneration(jobId, type);
        if (success) {
          await wakeWorker(jobId, `${type}_regenerate`);
          await safeEditMessage(ctx, `🔄 Regenerating ${type}... (${creditCost} credits deducted)`);
          await ctx.answerCbQuery(`Regenerating... ${creditCost} credits deducted`);
        } else {
          await ctx.answerCbQuery('Failed to trigger regeneration', true);
        }
      } catch (error) {
        await ctx.answerCbQuery('Error processing request', true);
      }
    }

  } catch (error) {
    console.error('Callback query error:', error);
    try { await ctx.answerCbQuery('Error processing request', true); } catch (e) {}
  }
});

// ============================================
// 📨 MESSAGE HANDLERS
// ============================================

bot.on('video', async (ctx) => {
  const state = userStates.get(ctx.chat.id) || {};

  // ── Priority 1: Admin replying to support message ───────────────
  if (isAdmin(ctx) && ctx.message.reply_to_message) {
    const repliedMessage = ctx.message.reply_to_message;
    if (isSupportMessage(repliedMessage)) {
      const userId = extractUserIdFromSupportMessage(repliedMessage);
      if (userId) {
        try {
          await bot.telegram.sendVideo(userId, ctx.message.video.file_id, {
            caption: ctx.message.caption 
              ? `💬 *Support Reply:*\n${ctx.message.caption}` 
              : `💬 *Support Reply:* (Video)`,
            parse_mode: 'Markdown'
          });
          return ctx.reply('✅ Video sent to user.');
        } catch (err) {
          return ctx.reply(`❌ Could not send video: ${err.message}`);
        }
      }
    }
  }

  // ── Priority 2: Admin replacing media for a segment ────────────
  if (state?.adminReplacingMedia && isAdmin(ctx)) {
    const { jobId, segmentIndex, userId, mediaType } = state.adminReplacingMedia;
    if (mediaType !== 'video') {
      return ctx.reply('❌ This segment needs an image, not a video');
    }

    try {
      await ctx.reply('📥 Processing your video...');

      const video = ctx.message.video;
      if (video.file_size > 50 * 1024 * 1024) {
        return ctx.reply(`❌ Video too large. Max: 50MB`);
      }

      const fileInfo    = await ctx.telegram.getFile(video.file_id);
      const fileUrl = getTelegramFileUrl(fileInfo.file_path);
      const response    = await axios.get(fileUrl, { 
        responseType: 'arraybuffer', 
        timeout: 120000 
      });
      const fileBuffer  = Buffer.from(response.data);
      const fileName    = `jobs/${jobId}/stock-videos/admin-${segmentIndex}.mp4`;
      const uploadedUrl = await uploadFile(fileName, fileBuffer, 'video/mp4');

      await axios.post(`${WORKER_BASE_URL}/update-segment-media`, {
        jobId, 
        segmentIndex, 
        mediaUrl: uploadedUrl, 
        mediaType: 'video',
        videoDuration: video.duration || 5, 
        source: 'admin_override'
      });

      const jobInfo     = await getJobInfo(jobId);
      const segments    = jobInfo?.segments || [];
      const segmentText = segments[segmentIndex]?.text || '';

      await bot.telegram.sendVideo(
        userId,
        { source: fileBuffer, filename: `admin_segment_${segmentIndex + 1}.mp4` },
        {
          caption: 
            `🎬 *Video for Segment ${segmentIndex + 1}/${segments.length}*\n\n` +
            `📝 ${segmentText.substring(0, 150)}\n\n` +
            `❓ Is this suitable?`,
          parse_mode: 'Markdown',
          supports_streaming: true,
          reply_markup: {
            inline_keyboard: [
              [
                { 
                  text: '✅ Approve', 
                  callback_data: `approve_video_${jobId}_${segmentIndex}` 
                },
                { 
                  text: '🔄 Refetch', 
                  callback_data: `refetch_video_${jobId}_${segmentIndex}` 
                }
              ]
            ]
          }
        }
      );

      delete state.adminReplacingMedia;
      userStates.set(ctx.chat.id, state);
      return ctx.reply(`✅ Video sent to user for segment ${segmentIndex + 1}`);

    } catch (error) {
      console.error('Admin replace video error:', error);
      return ctx.reply('❌ Failed to process and send video');
    }
  }

  // ── Priority 3: Admin sendvideo command ─────────────────────────
  if (state?.sendVideoTo) {
    const targetId = state.sendVideoTo;
    try {
      await bot.telegram.sendVideo(targetId, ctx.message.video.file_id, {
        caption: '🎬 Here is your generated video!'
      });
      ctx.reply(`✅ Video sent to user ${targetId}.`);
      userStates.delete(ctx.chat.id);
    } catch (error) {
      ctx.reply(`❌ Failed to send video to ${targetId}.`);
    }
    return;
  }

  // ── Priority 4: USER uploading their own video for a segment ────
  // This is the NEW path - triggered by upload_video_ callback
  if (state?.uploadingSegmentVideo) {
    const { jobId, segmentIndex } = state.uploadingSegmentVideo;

    try {
      // Validate job still exists
      const jobInfo = await getJobInfo(jobId);
      if (!jobInfo) {
        return ctx.reply('❌ Job not found. Please restart with /start');
      }

      const video = ctx.message.video;

      // Size check — Telegram bot API limit for uploads
      if (video.file_size && video.file_size > 100 * 1024 * 1024) {
        return ctx.reply(
          '❌ Video too large. Maximum size is 100MB.\n\n' +
          'Please compress your video and try again.'
        );
      }

      await ctx.reply('📥 Uploading your video clip...');

      // Download from Telegram
      const fileInfo = await ctx.telegram.getFile(video.file_id);
      const fileUrl = getTelegramFileUrl(fileInfo.file_path);

      const response = await axios.get(fileUrl, { 
        responseType: 'arraybuffer', 
        timeout: 120000  // Videos can be large - give more time
      });

      const fileBuffer = Buffer.from(response.data);

      // Determine extension from file path
      const ext      = fileInfo.file_path.split('.').pop() || 'mp4';
      const fileName = `jobs/${jobId}/user-videos/segment-${segmentIndex}.${ext}`;

      // Upload to R2
      const uploadedUrl = await uploadFile(fileName, fileBuffer, `video/${ext}`);

      // Tell worker about it - uses new /upload-segment-video endpoint
      const updateResponse = await axios.post(
        `${WORKER_BASE_URL}/upload-segment-video`,
        {
          jobId,
          segmentIndex,
          videoUrl:     uploadedUrl,
          fileName,
          videoDuration: video.duration || 5,  // Telegram provides duration
          source:       'user_upload'
        }
      );

      if (updateResponse.data.success) {
        // Wake worker to continue pipeline
        await axios.post(`${WORKER_BASE_URL}/wake-up`, {
          jobId,
          action:       'user_video_uploaded',
          segmentIndex,
          timestamp:    Date.now()
        });

        // Clear the upload state
        delete state.uploadingSegmentVideo;
        userStates.set(ctx.chat.id, state);

        return ctx.reply(
          `✅ *Video uploaded for Segment ${segmentIndex + 1}!*\n\n` +
          `Moving to next segment...`,
          { parse_mode: 'Markdown' }
        );
      } else {
        throw new Error(updateResponse.data.error || 'Failed to update segment');
      }

    } catch (error) {
      console.error('Error uploading user segment video:', error);
      return ctx.reply(
        '❌ Failed to upload video. Please try again.\n\n' +
        'If the problem persists, use /support'
      );
    }
  }

  // ── Priority 5: Support mode ─────────────────────────────────────
  const session = await getUserSession(ctx.chat.id);
  if (state?.supportMode || session?.supportMode) {
    const userInfo =
      `🆘 *Support Request*\n\n` +
      `👤 From: [${ctx.from.first_name}](tg://user?id=${ctx.from.id})\n` +
      `🆔 User ID: \`${ctx.from.id}\`\n` +
      `📱 Username: @${ctx.from.username || 'N/A'}\n`;
    try {
      for (const adminId of ADMIN_IDS) {
        await bot.telegram.sendVideo(adminId, ctx.message.video.file_id, {
          caption: userInfo + `\n💬 *Message:*\n${ctx.message.caption || '(Video)'}`,
          parse_mode: 'Markdown'
        });
      }
      return ctx.reply('✅ Video sent to support.');
    } catch (err) {
      return ctx.reply('❌ Failed to send video.');
    }
  }

  // ── Fallback ─────────────────────────────────────────────────────
  ctx.reply(
    '🎥 Not expecting any video uploads right now.\n\n' +
    'Use /start to create a new video.'
  );
});

bot.on('photo', async (ctx) => {
  const userData = userStates.get(ctx.chat.id) || {};

  if (isAdmin(ctx) && ctx.message.reply_to_message) {
    const repliedMessage = ctx.message.reply_to_message;
    if (isSupportMessage(repliedMessage)) {
      const userId = extractUserIdFromSupportMessage(repliedMessage);
      if (userId) {
        try {
          const photo = ctx.message.photo[ctx.message.photo.length - 1];
          await bot.telegram.sendPhoto(userId, photo.file_id, {
            caption: ctx.message.caption ? `💬 *Support Reply:*\n${ctx.message.caption}` : `💬 *Support Reply:* (Image)`,
            parse_mode: 'Markdown'
          });
          return ctx.reply('✅ Image sent to user.');
        } catch (err) {
          return ctx.reply(`❌ Could not send image: ${err.message}`);
        }
      }
    }
  }

  if (userData.adminReplacingMedia && isAdmin(ctx)) {
    const { jobId, segmentIndex, userId, mediaType } = userData.adminReplacingMedia;
    if (mediaType !== 'image' && mediaType !== undefined) return ctx.reply('❌ This segment needs a video, not an image');

    try {
      await ctx.reply('📥 Processing your image...');

      const photo         = ctx.message.photo[ctx.message.photo.length - 1];
      const fileInfo      = await ctx.telegram.getFile(photo.file_id);
      const fileUrl = getTelegramFileUrl(fileInfo.file_path);
      const response      = await axios.get(fileUrl, { responseType: 'arraybuffer', timeout: 60000 });
      const fileBuffer    = Buffer.from(response.data);
      const fileExtension = fileInfo.file_path.split('.').pop() || 'jpg';
      const fileName      = `jobs/${jobId}/images/admin-${segmentIndex}.${fileExtension}`;
      const uploadedUrl   = await uploadFile(fileName, fileBuffer, `image/${fileExtension}`);

      await axios.post(`${WORKER_BASE_URL}/update-segment-media`, {
        jobId, segmentIndex, mediaUrl: uploadedUrl, mediaType: 'image', source: 'admin_override'
      });

      await axios.post(`${WORKER_BASE_URL}/wake-up`, { jobId, action: 'admin_media_replaced', timestamp: Date.now() });

      const jobInfo     = await getJobInfo(jobId);
      const segments    = jobInfo?.segments || [];
      const segmentText = segments[segmentIndex]?.text || '';

      await bot.telegram.sendPhoto(
        userId,
        { source: fileBuffer, filename: `segment_${segmentIndex + 1}.jpg` },
        {
          caption: `🖼️ *Image for Segment ${segmentIndex + 1}/${segments.length}*\n\n📝 ${segmentText.substring(0, 150)}\n\n❓ Is this relevant?`,
          parse_mode: 'Markdown',
          reply_markup: {
            inline_keyboard: [[
              { text: '✅ Approve', callback_data: `approve_segment_${jobId}_${segmentIndex}` },
              { text: '🔄 Refetch', callback_data: `refetch_segment_${jobId}_${segmentIndex}` }
            ]]
          }
        }
      );

      delete userData.adminReplacingMedia;
      userStates.set(ctx.chat.id, userData);
      return ctx.reply(`✅ Image sent to user for segment ${segmentIndex + 1}`);
    } catch (error) {
      console.error('Admin replace image error:', error);
      return ctx.reply('❌ Failed to process image');
    }
  }

  if (userData.uploadingSegmentImage) {
    const { jobId, segmentIndex } = userData.uploadingSegmentImage;

    try {
      const jobInfo = await getJobInfo(jobId);
      if (!jobInfo) return ctx.reply('❌ Invalid job. Please restart.');

      const photo    = ctx.message.photo[ctx.message.photo.length - 1];
      const fileInfo = await ctx.telegram.getFile(photo.file_id);
      console.log(`📋 File info:`, JSON.stringify(fileInfo));
      const fileUrl = getTelegramFileUrl(fileInfo.file_path);
console.log(`📥 Downloading file from: ${fileUrl}`); // ← add this

      await ctx.reply('📥 Uploading your image...');

      const response = await axios.get(fileUrl, { responseType: 'arraybuffer', timeout: 30000 });
      if (response.data.length > 50 * 1024 * 1024) return ctx.reply('❌ Image too large. Max 50MB.');

      const fileExtension = fileInfo.file_path.split('.').pop() || 'jpg';
      const fileName      = `jobs/${jobId}/images/query-${segmentIndex}.${fileExtension}`;
      const fileBuffer    = Buffer.from(response.data);
      const uploadResult  = await uploadFile(fileName, fileBuffer, `image/${fileExtension}`);

      const updateResponse = await axios.post(`${WORKER_BASE_URL}/upload-segment-image`, {
        jobId, segmentIndex, imageUrl: uploadResult, fileName, source: 'user_upload'
      });

      if (updateResponse.data.success) {
        await axios.post(`${WORKER_BASE_URL}/wake-up`, {
          jobId, action: 'user_image_uploaded', segmentIndex, timestamp: Date.now()
        });

        delete userData.uploadingSegmentImage;
        userStates.set(ctx.chat.id, userData);
        return ctx.reply(`✅ Image uploaded for segment ${segmentIndex + 1}! Moving to next...`);
      } else {
        throw new Error('Failed to update segment in database');
      }
    } catch (error) {
      console.error('Error uploading segment image:', error);
      return ctx.reply('❌ Failed to upload image. Please try again.');
    }
  }

  const session = await getUserSession(ctx.chat.id);
  if (userData?.supportMode || session?.supportMode) {
    const userInfo =
      `🆘 *Support Request*\n\n` +
      `👤 From: [${ctx.from.first_name}](tg://user?id=${ctx.from.id})\n` +
      `🆔 User ID: \`${ctx.from.id}\`\n` +
      `📱 Username: @${ctx.from.username || 'N/A'}\n`;
    try {
      const photo = ctx.message.photo[ctx.message.photo.length - 1];
      for (const adminId of ADMIN_IDS) {
        await bot.telegram.sendPhoto(adminId, photo.file_id, {
          caption: userInfo + `\n💬 *Message:*\n${ctx.message.caption || '(Photo)'}`,
          parse_mode: 'Markdown'
        });
      }
      return ctx.reply('✅ Image sent to support.');
    } catch (err) {
      return ctx.reply('❌ Failed to send image.');
    }
  }

  ctx.reply('📷 Not expecting any uploads right now.\n\nUse /start to create a video.');
});

bot.on('text', async (ctx) => {
  const userData = userStates.get(ctx.chat.id) || {};
  const message  = ctx.message.text;

  console.log('Text handler | User:', ctx.chat.id, '| Msg:', message.substring(0, 50));

  // ── Quick video JSON (admin) ──────────────────────────────────────
  if (userData.awaitingQuickVideo && isAdmin(ctx)) {
    await handleQuickVideoJSON(ctx, userData, message);
    return;
  }

  // ── Script editing ────────────────────────────────────────────────
  if (userData.editingScript) {
    const jobId = userData.editingScript;
    try {
      const response = await axios.post(`${WORKER_BASE_URL}/update-script`, { jobId, script: message });
      if (response.data.success) {
        delete userData.editingScript;
        userStates.set(ctx.chat.id, userData);
        await wakeWorker(jobId, 'script_updated');
        return ctx.reply('✅ Script updated! Processing...');
      }
      return ctx.reply('❌ Failed to update script. Please try again.');
    } catch (error) {
      return ctx.reply('❌ Failed to update script. Please try again.');
    }
  }

  // ── Admin replying to support message ─────────────────────────────
  if (isAdmin(ctx) && ctx.message.reply_to_message) {
    const repliedMessage = ctx.message.reply_to_message;
    if (isSupportMessage(repliedMessage)) {
      const userId = extractUserIdFromSupportMessage(repliedMessage);
      if (userId) {
        try {
          await bot.telegram.sendMessage(userId, `💬 *Support Reply:*\n${message}`, { parse_mode: 'Markdown' });
          return ctx.reply('✅ Reply sent to user.');
        } catch (err) {
          return ctx.reply(`❌ Could not send reply: ${err.message}`);
        }
      }
    }
  }

  // ── Support mode ──────────────────────────────────────────────────
  const session         = await getUserSession(ctx.chat.id);
  const isInSupportMode = userData?.supportMode === true || session?.supportMode === true;

  if (isInSupportMode && !message.startsWith('/')) {
    const userInfo =
      `🆘 *Support Request*\n\n` +
      `👤 From: [${ctx.from.first_name}](tg://user?id=${ctx.from.id})\n` +
      `🆔 User ID: \`${ctx.from.id}\`\n` +
      `📱 Username: @${ctx.from.username || 'N/A'}\n`;
    try {
      for (const adminId of ADMIN_IDS) {
        await bot.telegram.sendMessage(adminId, userInfo + `\n💬 *Message:*\n${message}`, { parse_mode: 'Markdown' });
      }
      return ctx.reply('✅ Message sent to support.');
    } catch (err) {
      return ctx.reply('❌ Failed to send message.');
    }
  }

  if (message.startsWith('/')) return;

  // ── Script buffering ──────────────────────────────────────────────
  if (userData.bufferingScript && userData.mode === 'script') {
    userData.scriptBuffer.push(message);
    userStates.set(ctx.chat.id, userData);
    setScriptTimeout(ctx, ctx.chat.id);
    return;
  }

  // ── First script/prompt message ───────────────────────────────────
  if (!userData.inputText && userData.mode) {
    if (userData.mode === 'script') {
      userData.scriptBuffer    = [message];
      userData.bufferingScript = true;
      userStates.set(ctx.chat.id, userData);
      setScriptTimeout(ctx, ctx.chat.id);
      await ctx.reply('📝 *Script received!*', { parse_mode: 'Markdown' });
      return;
    } else if (userData.mode === 'prompt') {
      userData.inputText = message;
      userStates.set(ctx.chat.id, userData);
      return ctx.reply(
        'How long should the video be?',
        Markup.keyboard([['1', '2', '3'], ['4', '5']]).oneTime().resize()
      );
    }
  }

  // ── Duration ──────────────────────────────────────────────────────
  if (!userData.duration && userData.inputText) {
    const durationInput = parseInt(message);

    if (isNaN(durationInput)) {
      return ctx.reply(
        '⚠️ Please enter a valid number (1-30 minutes):',
        Markup.keyboard([['1', '2', '3'], ['4', '5', '10'], ['15', '20', '30']]).oneTime().resize()
      );
    }
    if (durationInput < 1 || durationInput > 30) {
      return ctx.reply(
        `⚠️ Duration must be between 1 and 30 minutes.`,
        Markup.keyboard([['1', '2', '3'], ['4', '5', '10'], ['15', '20', '30']]).oneTime().resize()
      );
    }

    userData.duration = durationInput;
    userStates.set(ctx.chat.id, userData);
    return ctx.reply(
      `✅ Duration set to ${durationInput} min\n\nChoose the video type:`,
      Markup.keyboard([['Shorts', 'Reels'], ['Longform']]).oneTime().resize()
    );
  }

  // ── Video type ────────────────────────────────────────────────────
  if (!userData.videotype && ['Shorts', 'Reels', 'Longform'].includes(message)) {
    userData.videotype = message.toLowerCase();
    userStates.set(ctx.chat.id, userData);

    await showVoicePage(ctx, 0);

    return ctx.reply(
      '👆 Browse samples above, then choose your voice:',
      Markup.keyboard(VOICE_KEYBOARD_ROWS).oneTime().resize()
    );

  } else if (!userData.videotype && userData.inputText) {
    return ctx.reply(
      '⚠️ Please choose a video type:',
      Markup.keyboard([['Shorts', 'Reels'], ['Longform']]).oneTime().resize()
    );
  }

  // ── Voice selection ───────────────────────────────────────────────
  if (!userData.voice && ALL_VOICES.includes(message)) {
    userData.voice = message;
    userStates.set(ctx.chat.id, userData);

    // ALL Gemini voices support style instructions — always ask
    userData.awaitingStyleInstruction = true;
    userStates.set(ctx.chat.id, userData);

    return ctx.reply(
      `🎤 *${message}* selected!\n\n` +
      `✨ All voices support custom delivery styles.\n\n` +
      `Describe how you'd like the voice delivered:\n\n` +
      `*Examples:*\n` +
      `• _"Speak slowly and with gravitas"_\n` +
      `• _"Energetic and fast-paced"_\n` +
      `• _"Calm and soothing, like a documentary"_\n` +
      `• _"Excited and enthusiastic"_\n` +
      `• _"Authoritative news anchor tone"_\n\n` +
      `Or tap *Skip* to use the default narration style.`,
      {
        parse_mode: 'Markdown',
        ...Markup.keyboard([['⏭️ Skip Style']]).oneTime().resize()
      }
    );

  } else if (!userData.voice && userData.videotype) {
    return ctx.reply(
      '⚠️ Please choose a voice:',
      Markup.keyboard(VOICE_KEYBOARD_ROWS).oneTime().resize()
    );
  }

  // ── Style instruction (all voices) ───────────────────────────────
  if (userData.voice && userData.awaitingStyleInstruction) {

    if (message === '⏭️ Skip Style') {
      userData.styleInstruction = null;
    } else {
      if (message.startsWith('/')) {
        return ctx.reply(
          '⚠️ Please enter a style description or tap Skip:',
          Markup.keyboard([['⏭️ Skip Style']]).oneTime().resize()
        );
      }
      if (message.length > 200) {
        return ctx.reply(
          '⚠️ Style instruction too long (max 200 characters). Please shorten it:',
          Markup.keyboard([['⏭️ Skip Style']]).oneTime().resize()
        );
      }
      userData.styleInstruction = message.trim();
    }

    delete userData.awaitingStyleInstruction;
    userStates.set(ctx.chat.id, userData);

    return ctx.reply(
      'What type of media would you like to use?',
      Markup.keyboard([['Images Only'], ['Videos Only'], ['Images + Videos']]).oneTime().resize()
    );
  }

  // ── Media type ────────────────────────────────────────────────────
  if (userData.voice && !userData.mediaType && ['Images Only', 'Videos Only', 'Images + Videos'].includes(message)) {
    userData.mediaType =
      message === 'Images Only'    ? 'images' :
      message === 'Videos Only'    ? 'videos' :
                                     'mixed';
    userStates.set(ctx.chat.id, userData);

    return ctx.reply(
      'Do you want to provide the media yourself?',
      Markup.keyboard([['Yes'], ['No']]).oneTime().resize()
    );

  } else if (userData.voice && !userData.mediaType && !isInSupportMode) {
    return ctx.reply(
      '⚠️ Please choose a media type:',
      Markup.keyboard([['Images Only'], ['Videos Only'], ['Images + Videos']]).oneTime().resize()
    );
  }

  // ── Media mode ────────────────────────────────────────────────────
  if (userData.mediaType && !userData.mediaMode && ['Yes', 'No'].includes(message)) {
    userData.mediaMode = message === 'Yes' ? 'manual' : 'auto';
    userStates.set(ctx.chat.id, userData);

    return ctx.reply(
      'Do you want to add captions to your video?',
      Markup.keyboard([['Yes'], ['No']]).oneTime().resize()
    );

  } else if (userData.mediaType && !userData.mediaMode && !isInSupportMode) {
    return ctx.reply(
      '⚠️ Please answer: Do you want to provide the media yourself?',
      Markup.keyboard([['Yes'], ['No']]).oneTime().resize()
    );
  }

  // ── Captions Yes/No ───────────────────────────────────────────────
  if (userData.mediaMode && !userData.hasOwnProperty('addCaptions') && ['Yes', 'No'].includes(message)) {

    if (message === 'No') {
      userData.addCaptions = false;
      userStates.set(ctx.chat.id, userData);

      await showCreditBreakdown(ctx, userData);
      const deduction = await tryDeductCredits(ctx, userData);

      if (!deduction.success) {
        await ctx.reply(
          `❌ ${deduction.reason}\n\n💰 Required: ${deduction.creditCost} credits\n💳 You have: ${deduction.currentCredits} credits\n\nContact /support to get more credits.`,
          { reply_markup: { remove_keyboard: true } }
        );
        userStates.delete(ctx.chat.id);
        return;
      }

      await confirmSubmission(ctx, `✅ Deducted ${deduction.creditCost} credit(s).\n💰 Remaining: ${deduction.remaining}\n\n🎬 Processing your video...`);

      const submitted = await submitVideoJob(ctx, userData);
      if (!submitted) return;
      userStates.delete(ctx.chat.id);
      return;

    } else {
      userData.addCaptions = true;
      userStates.set(ctx.chat.id, userData);

      await showCaptionPage(ctx, 0);

      return ctx.reply(
        '👆 Browse samples above, then choose your style:',
        Markup.keyboard([
          ['Karaoke',     'Banger'],
          ['Acid',        'Lovly'],
          ['Marvel',      'Marker'],
          ['Neon Pulse',  'Beasty'],
          ['Crazy',       'Safari'],
          ['Popline',     'Desert'],
          ['Hook',        'Sky'],
          ['Flamingo',    'Deep Diver B&W'],
          ['New',         'Catchy'],
          ['From',        'Classic'],
          ['Classic Big', 'Old Money'],
          ['Cinema',      'Midnight Serif'],
          ['Aurora Ink']
        ]).oneTime().resize()
      );
    }

  } else if (userData.mediaMode && !userData.hasOwnProperty('addCaptions') && !isInSupportMode) {
    return ctx.reply(
      '⚠️ Please choose Yes or No:',
      Markup.keyboard([['Yes'], ['No']]).oneTime().resize()
    );
  }

  // ── Caption style ─────────────────────────────────────────────────
  const validCaptionStyles = [
    'Karaoke', 'Banger', 'Acid', 'Lovly', 'Marvel', 'Marker',
    'Neon Pulse', 'Beasty', 'Crazy', 'Safari', 'Popline', 'Desert',
    'Hook', 'Sky', 'Flamingo', 'Deep Diver B&W', 'New', 'Catchy',
    'From', 'Classic', 'Classic Big', 'Old Money', 'Cinema',
    'Midnight Serif', 'Aurora Ink'
  ];

  if (userData.addCaptions && !userData.captionStyle && validCaptionStyles.includes(message)) {
    userData.captionStyle = message;
    userStates.set(ctx.chat.id, userData);

    await showCreditBreakdown(ctx, userData);
    const deduction = await tryDeductCredits(ctx, userData);

    if (!deduction.success) {
      await ctx.reply(
        `🚫 You need ${deduction.creditCost} credit(s) but only have ${deduction.currentCredits}.\n\nContact /support to top up.`,
        { reply_markup: { remove_keyboard: true } }
      );
      userStates.delete(ctx.chat.id);
      return;
    }

    await confirmSubmission(
      ctx,
      `✅ Deducted ${deduction.creditCost} credit(s).\n💰 Remaining: ${deduction.remaining}\n\n🎬 Processing your video...`,
      { parse_mode: 'Markdown' }
    );

    const submitted = await submitVideoJob(ctx, userData);
    if (!submitted) return;
    userStates.delete(ctx.chat.id);
    return;

  } else if (userData.addCaptions && !userData.captionStyle && !isInSupportMode) {
    return ctx.reply(
      '⚠️ Please choose a caption style:',
      Markup.keyboard([
        ['Karaoke',     'Banger'],
        ['Acid',        'Lovly'],
        ['Marvel',      'Marker'],
        ['Neon Pulse',  'Beasty'],
        ['Crazy',       'Safari'],
        ['Popline',     'Desert'],
        ['Hook',        'Sky'],
        ['Flamingo',    'Deep Diver B&W'],
        ['New',         'Catchy'],
        ['From',        'Classic'],
        ['Classic Big', 'Old Money'],
        ['Cinema',      'Midnight Serif'],
        ['Aurora Ink']
      ]).oneTime().resize()
    );
  }

  // ── Fallbacks ─────────────────────────────────────────────────────
  if (!userData.content_flow && !message.startsWith('/') && !isInSupportMode && Object.keys(userData).length > 0) {
    return ctx.reply(
      '⚠️ Please choose a video type to get started:',
      Markup.keyboard([['📰 Essay Styled Videos'], ['📋 Listicle Videos']]).oneTime().resize()
    );
  }

  if (userData.content_flow && !userData.mode && !message.startsWith('/') && !isInSupportMode) {
    return ctx.reply(
      '⚠️ Please choose how to begin:',
      Markup.keyboard([['📝 Script'], ['💡 Prompt']]).oneTime().resize()
    );
  }
});

// ============================================
// ⚡ QUICK VIDEO (Admin)
// ============================================

async function handleQuickVideoJSON(ctx, userData, message) {
  try {
    let config;
    try {
      config = JSON.parse(message);
    } catch (parseError) {
      return ctx.reply('❌ Invalid JSON. Check your syntax and try again.\n\nType /quickvideo for the format.');
    }

    const required = ['videotype', 'duration', 'voice'];
    const missing  = required.filter(field => !config[field]);
    if (missing.length > 0) return ctx.reply(`❌ Missing fields: ${missing.join(', ')}`);

    if (!['shorts', 'reels', 'longform'].includes(config.videotype)) {
      return ctx.reply('❌ videotype must be: shorts, reels, or longform');
    }
    if (typeof config.duration !== 'number' || config.duration < 1 || config.duration > 30) {
      return ctx.reply('❌ duration must be a number between 1 and 30');
    }
    if (!ALL_VOICES.includes(config.voice)) {
      return ctx.reply(`❌ Invalid voice. Valid voices: ${ALL_VOICES.join(', ')}`);
    }

    const validStatuses = ['text_approved', 'segments_ready', 'images_approved', 'videos_approved'];
    const status        = config.status || 'text_approved';
    if (!validStatuses.includes(status)) return ctx.reply(`❌ Invalid status.`);

    if (status === 'segments_ready') {
      if (!config.segments || !Array.isArray(config.segments) || config.segments.length === 0) {
        return ctx.reply('❌ segments array required when status is "segments_ready"');
      }
      if (!config.media_queries || !Array.isArray(config.media_queries) || config.media_queries.length === 0) {
        return ctx.reply('❌ media_queries array required when status is "segments_ready"');
      }
      if (config.segments.length !== config.media_queries.length) {
        return ctx.reply('❌ segments and media_queries must have the same length');
      }
    }

    const jobData = {
      user_id:           ctx.chat.id,
      script:            config.script || '',
      videotype:         config.videotype,
      duration:          config.duration,
      voice:             config.voice,
      content_flow:      config.content_flow  || 'news',
      media_type:        config.media_type    || 'images',
      status,
      segments:          config.segments      || null,
      media_queries:     config.media_queries || null,
    };

    await ctx.reply(
      `📋 Configuration Summary:\n\n` +
      `🎬 Type: ${jobData.videotype}\n` +
      `⏱ Duration: ${jobData.duration} min\n` +
      `🎤 Voice: ${jobData.voice}\n` +
      `📰 Flow: ${jobData.content_flow}\n` +
      `🎨 Media: ${jobData.media_type}\n` +
      `🚦 Status: ${jobData.status}\n` +
      `📊 Segments: ${jobData.segments ? jobData.segments.length : 'Auto'}\n\n` +
      `⚡ Creating job...`
    );

    const result = await pool.query(
      `INSERT INTO jobs (user_id, script, videotype, duration, voice, content_flow, media_type, status, segments, media_queries, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, NOW(), NOW()) RETURNING id`,
      [
        jobData.user_id, jobData.script, jobData.videotype, jobData.duration,
        jobData.voice, jobData.content_flow, jobData.media_type, jobData.status,
        jobData.segments      ? JSON.stringify(jobData.segments)      : null,
        jobData.media_queries ? JSON.stringify(jobData.media_queries) : null,
      ]
    );

    const jobId = result.rows[0].id;

    await ctx.reply(
      `✅ Quick Video Job Created!\n\n🎬 Job ID: ${jobId}\n📊 Status: ${jobData.status}\n\n🔄 Worker will process automatically.`
    );

    console.log(`⚡ Quick video job ${jobId} created by admin ${ctx.chat.id}`);

    delete userData.awaitingQuickVideo;
    userStates.set(ctx.chat.id, userData);

  } catch (error) {
    console.error('Quick video error:', error);
    await ctx.reply(`❌ Error: ${error.message}`);
  }
}

// ============================================
// 🏥 STORAGE HEALTH CHECK
// ============================================

async function checkStorageHealth() {
  try {
    const testKey  = `health_check_${Date.now()}.txt`;
    const testData = Buffer.from('Health check test');
    await uploadFile(testKey, testData, 'text/plain');
    await getFileUrl(testKey);
    await deleteFile(testKey);
    console.log('✅ Storage health check passed');
    return true;
  } catch (error) {
    console.error('❌ Storage health check failed:', error);
    return false;
  }
}

checkStorageHealth().then(healthy => {
  if (!healthy) console.warn('⚠️ Storage system may have issues — check your R2 config');
});

// ============================================
// 📤 EXPORTS
// ============================================

module.exports = {
  bot,
  notifyScriptForReview,
  notifySegmentImageForReview,
  notifySegmentUploadRequest,
  notifyAllImagesComplete,
  notifySegmentVideoForReview,
  notifyAllVideosComplete,
  notifyAudioForReview,
  notifyVideoComplete
};
