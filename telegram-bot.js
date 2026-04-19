const { Telegraf, Markup } = require('telegraf');
require('dotenv').config();
const axios = require('axios');
const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');
const { uploadFile, deleteFile, getFileUrl } = require('./storage');


const bot = new Telegraf(process.env.BOT_TOKEN);
const { getUserSession, setUserSession, createSessionIfNotExists } = require('./sessions');
const { initCreditsTable, setCredits, getCredits, useCredits, calculateCreditCost, areCreditsExpired } = require('./credits'); 

// ============================================
// 🎤 VOICE SELECTION - PAGINATED
// ============================================

const voicePages = [
  {
    title: '⚡ Basic Voices (Free)',
    voices: ['Max', 'Ashley', 'Ava', 'Roger', 'Lora'],
    page: 0,
    isPremium: false
  },
  {
    title: '⭐ Premium Voices - Set 1 (+5 credits/min)',
    voices: ['Cassie', 'Ryan', 'Rachel', 'Missy', 'Amy'],
    page: 1,
    isPremium: true
  },
  {
    title: '⭐ Premium Voices - Set 2 (+5 credits/min)',
    voices: ['Patrick', 'Andre', 'Stan', 'Lance', 'Alice'],
    page: 2,
    isPremium: true
  },
  {
    title: '⭐ Premium Voices - Set 3 (+5 credits/min)',
    voices: ['Liz', 'Dave', 'Candice', 'Autumn', 'Desmond'],
    page: 3,
    isPremium: true
  },
  {
    title: '⭐ Premium Voices - Set 4 (+5 credits/min)',
    voices: ['Charlotte', 'Ace', 'Liam', 'Keisha', 'Kent'],
    page: 4,
    isPremium: true
  },
  {
    title: '⭐ Premium Voices - Set 5 (+5 credits/min)',
    voices: ['Daisy', 'Lucy', 'Linda', 'Jamal', 'Sydney'],
    page: 5,
    isPremium: true
  },
  {
    title: '⭐ Premium Voices - Set 6 (+5 credits/min)',
    voices: ['Sally', 'Violet', 'Rhihanon', 'Mark'],
    page: 6,
    isPremium: true
  }
];

async function showVoicePage(ctx, pageNum = 0) {
  const page = voicePages[pageNum];
  
  const premiumNote = page.isPremium 
    ? '\n\n💡 *Premium voices cost +5 credits per minute*' 
    : '\n\n✨ *Free voices - no extra cost*';
  
  const keyboard = [];
  
  // Voice sample buttons (2 per row for better mobile UX)
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
  
  // Navigation buttons
  const navRow = [];
  if (pageNum > 0) {
    navRow.push({ text: '◀️ Previous', callback_data: `voice_page_${pageNum - 1}` });
  }
  navRow.push({ text: `${pageNum + 1}/${voicePages.length}`, callback_data: 'noop' });
  if (pageNum < voicePages.length - 1) {
    navRow.push({ text: 'Next ▶️', callback_data: `voice_page_${pageNum + 1}` });
  }
  keyboard.push(navRow);
  
  const messageText = `🎤 *${page.title}*${premiumNote}\n\n` +
    `Tap any voice below to hear a sample:`;
  
  // Check if this is an edit or new message
  if (ctx.callbackQuery) {
    try {
      await ctx.editMessageText(messageText, {
        parse_mode: 'Markdown',
        reply_markup: { inline_keyboard: keyboard }
      });
    } catch (error) {
      // Message hasn't changed, just answer callback
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
    title: '🎵 Popular Styles',
    styles: ['Karaoke', 'Banger', 'Acid', 'Lovly', 'Marvel'],
    page: 0
  },
  {
    title: '✨ Creative Styles',
    styles: ['Marker', 'Neon Pulse', 'Beasty', 'Crazy', 'Safari'],
    page: 1
  },
  {
    title: '🌈 Colorful Styles',
    styles: ['Popline', 'Desert', 'Hook', 'Sky', 'Flamingo'],
    page: 2
  },
  {
    title: '🎨 Artistic Styles',
    styles: ['Deep Diver B&W', 'New', 'Catchy', 'From', 'Classic'],
    page: 3
  },
  {
    title: '👔 Professional Styles',
    styles: ['Classic Big', 'Old Money', 'Cinema', 'Midnight Serif', 'Aurora Ink'],
    page: 4
  }
];

async function showCaptionPage(ctx, pageNum = 0) {
  const page = captionPages[pageNum];
  
  const keyboard = [];
  
  // Caption sample buttons (2 per row)
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
  
  // Navigation buttons
  const navRow = [];
  if (pageNum > 0) {
    navRow.push({ text: '◀️ Previous', callback_data: `caption_page_${pageNum - 1}` });
  }
  navRow.push({ text: `${pageNum + 1}/${captionPages.length}`, callback_data: 'noop' });
  if (pageNum < captionPages.length - 1) {
    navRow.push({ text: 'Next ▶️', callback_data: `caption_page_${pageNum + 1}` });
  }
  keyboard.push(navRow);
  
  const messageText = `🎬 *${page.title}*\n\n` +
    `Tap any style below to see a sample video:`;
  
  // Check if this is an edit or new message
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

// Voice page navigation
bot.action(/^voice_page_(\d+)$/, async (ctx) => {
  const pageNum = parseInt(ctx.match[1]);
  await ctx.answerCbQuery();
  await showVoicePage(ctx, pageNum);
});

// Voice sample playback
bot.action(/^voice_sample_(.+)$/, async (ctx) => {
  const voiceName = ctx.match[1];
  
  await ctx.answerCbQuery('🎵 Loading sample...');
  
  try {
    // Send the specific voice sample
    await ctx.replyWithAudio(
      { source: `./voice-samples/${voiceName}.mp3` },
      { 
        caption: `🎤 *${voiceName}* voice sample\n\n` +
          `Like this voice? Select it from the keyboard below.`,
        parse_mode: 'Markdown'
      }
    );
  } catch (error) {
    console.error(`Error sending voice sample ${voiceName}:`, error);
    await ctx.reply(`⚠️ Could not load sample for ${voiceName}. Please try another.`);
  }
});

// Caption page navigation
bot.action(/^caption_page_(\d+)$/, async (ctx) => {
  const pageNum = parseInt(ctx.match[1]);
  await ctx.answerCbQuery();
  await showCaptionPage(ctx, pageNum);
});

// Caption sample playback
bot.action(/^caption_sample_(.+)$/, async (ctx) => {
  const styleName = ctx.match[1].replace(/_/g, ' ');
  
  await ctx.answerCbQuery('📹 Loading sample...');
  
  try {
    const fileName = styleName.toLowerCase().replace(/[^a-z0-9]/g, '') + '.mp4';
    
    await ctx.replyWithVideo(
      { source: `./caption-samples/${fileName}` },
      { 
        caption: `📹 *${styleName}* caption style\n\n` +
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

// No-op handler for page counter
bot.action('noop', async (ctx) => {
  await ctx.answerCbQuery();
});

// ✅ Helper: Extract user ID from a support message
function extractUserIdFromSupportMessage(message) {
  if (!message) return null;
  
  let userId = null;
  
  // Check entities (text_link with tg://user?id=)
  const entities = message.entities || message.caption_entities || [];
  for (const entity of entities) {
    if (entity.type === 'text_link' && entity.url) {
      const match = entity.url.match(/tg:\/\/user\?id=(\d+)/);
      if (match) {
        userId = match[1];
        break;
      }
    }
    if (entity.type === 'text_mention' && entity.user) {
      userId = entity.user.id.toString();
      break;
    }
  }
  
  // Fallback: check text/caption for "User ID: XXX"
  if (!userId) {
    const textToCheck = message.text || message.caption || '';
    const textMatch = textToCheck.match(/User ID:\s*`?(\d+)`?/i);
    if (textMatch) {
      userId = textMatch[1];
    }
  }
  
  return userId;
}

// ✅ Helper: Check if message is a support request
function isSupportMessage(message) {
  const text = message?.text || message?.caption || '';
  return text.includes('🆘') && text.includes('Support Request');
}

// Database pool for job management
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

// Worker service URL for server communication
const WORKER_BASE_URL = process.env.WORKER_BASE_URL || 'https://your-worker.railway.app';
// Backend service URL for server communication
const BACKEND_BASE_URL = process.env.BACKEND_BASE_URL || 'https://your-backend.railway.app';

const ADMIN_IDS = [541812135, 7948746526, 5426162126];
const PREMIUM_VOICES = ['Cassie', 'Ryan', 'Rachel', 'Missy', 'Amy', 'Patrick', 'Andre', 'Stan', 'Lance', 'Alice', 'Liz', 'Dave', 'Candice', 'Autumn', 'Desmond', 'Charlotte', 'Ace', 'Liam', 'Keisha', 'Kent', 'Daisy', 'Lucy', 'Linda', 'Jamal', 'Sydney', 'Sally', 'Violet', 'Rhihanon', 'Mark'];

const APPROVAL_REQUIRED_USER = 6646033752;

const userStates = new Map();
const scriptTimeouts = new Map(); // Track timeout IDs for script buffering
const SCRIPT_BUFFER_TIMEOUT = 15000; // 15 seconds in milliseconds

// WORKER COMMUNICATION FUNCTIONS
async function triggerSegmentRefetch(jobId, segmentIndex) {
  try {
    const response = await axios.post(`${WORKER_BASE_URL}/refetch-segment`, {
      jobId,
      segmentIndex
    });
    return response.data.success;
  } catch (error) {
    console.error(`Error triggering segment refetch:`, error.message);
    return false;
  }
}

async function triggerRegeneration(jobId, type) {
  try {
    let endpoint = '';
    if (type === 'script') {
      endpoint = '/regenerate-script';
    } else if (type === 'audio') {
      endpoint = '/regenerate-audio';
    } else {
      console.error(`Unknown regeneration type: ${type}`);
      return false;
    }
    
    console.log(`Calling ${WORKER_BASE_URL}${endpoint} for job ${jobId}`);
    const response = await axios.post(`${WORKER_BASE_URL}${endpoint}`, { 
      jobId: parseInt(jobId) 
    });
    
    console.log(`Regeneration response:`, response.data);
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
  const wordsPerMinute = 150;
  const minutes = Math.ceil(words / wordsPerMinute);
  return Math.min(minutes, 30);
}


// Helper function to safely edit messages based on type
async function safeEditMessage(ctx, text, extra = {}) {
  try {
    const message = ctx.callbackQuery.message;
    
    if (message.photo) {
      // Photo messages need editMessageCaption
      await ctx.editMessageCaption(text, extra);
    } else if (message.audio || message.voice || message.document) {
      // Audio/voice/document messages need editMessageCaption
      await ctx.editMessageCaption(text, extra);
    } else {
      // Text messages use editMessageText
      await ctx.editMessageText(text, extra);
    }
  } catch (error) {
    console.error('Message edit error:', error.message);
    // Fallback: show popup notification instead
    await ctx.answerCbQuery(text.replace(/\*\*/g, '').replace(/\*/g, ''));
  }
}

// ✅ Helper: Remove keyboard and confirm submission
async function confirmSubmission(ctx, message, extra = {}) {
  return ctx.reply(message, {
    ...extra,
    reply_markup: { remove_keyboard: true }
  });
}

async function submitVideoJob(ctx, userData) {
  try {
    const jobData = {
      user_id: ctx.chat.id,
      prompt: userData.mode === 'prompt' ? userData.inputText : null,
      script: userData.mode === 'script' ? userData.inputText : null,
      videotype: userData.videotype,
      duration: userData.duration,
      voice: userData.voice,
      content_flow: userData.content_flow || 'news',
      media_type: userData.mediaType || 'images',     // ✅ UPDATED
      media_mode: userData.mediaMode || 'auto',       // ✅ NEW
      add_captions: userData.addCaptions || false,        
      caption_style: userData.captionStyle || null        
    };

    const response = await axios.post(`${BACKEND_BASE_URL}/generate-video`, jobData);
    
    if (response.data.success) {
      const jobId = response.data.jobId;
      
      console.log(`Job ${jobId} submitted to backend for user ${ctx.chat.id} (${userData.content_flow || 'news'} flow, ${userData.mediaType || 'images'} ${userData.mediaMode || 'auto'})`);
      
      // ✅ NEW: Check if this user needs approval
      if (ctx.chat.id === APPROVAL_REQUIRED_USER) {
        console.log(`🔒 Job ${jobId} requires admin approval (user: ${ctx.chat.id})`);
        
        
        // Send approval request to admins
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
    `• Media Type: *${userData.mediaType || 'images'}*\n` +
    `• Media Mode: *${mediaMode === 'manual' ? '📤 User Upload' : '🔍 Auto-Fetch'}*\n\n` +
            `✍️ Content:\n${inputText.substring(0, 300)}${inputText.length > 300 ? '...' : ''}`,
            { 
              parse_mode: 'Markdown',
              reply_markup: {
                inline_keyboard: [
                  [
                    { text: '✅ Approve & Start Processing', callback_data: `approve_job_${jobId}` }
                  ]
                ]
              }
            }
          );
        }
        
        return true;
      }
      
      // Normal flow for other users - send admin notification
const { mode, inputText, videotype, voice, content_flow, mediaMode } = userData;

// ✅ Helper function to escape Markdown
function escapeMarkdown(text) {
  if (!text) return 'N/A';
  return text.replace(/([_*[\]()~`>#+\-=|{}.!\\])/g, '\\$1');
}

for (const adminId of ADMIN_IDS) {
  await bot.telegram.sendMessage(adminId,
    `📨 *New Submission Received!*\n` +
    `👤 Username: @${escapeMarkdown(ctx.from.username) || 'N/A'}\n` +
    `🆔 User ID: [${ctx.from.id}](tg://user?id=${ctx.from.id})\n\n` +
    `🎬 Content Flow: *${content_flow || 'news'}*\n` +
    `🧾 Type: *${mode}*\n` +
    `🕒 Duration: *${userData.duration} min*\n` +
    `🎬 Style: *${videotype}*\n` +
    `🎤 Voice: *${voice}*\n` +
    `📱 Media Type: *${userData.mediaType || 'images'}*\n` +
    `🤖 Media Mode: *${userData.mediaMode === 'manual' ? '📤 Manual' : '🔍 Auto'}*\n\n` +
    `✍️ Input:\n${escapeMarkdown(inputText.substring(0, 500))}${inputText.length > 500 ? '...' : ''}`, // ✅ Escape and truncate
    { parse_mode: 'Markdown' }
  );
}
      
      return true;
    } else {
      throw new Error(response.data.message || 'Failed to submit job');
    }
  } catch (error) {
    console.error('Error submitting job to backend:', error);
    await ctx.reply('❌ Failed to submit job to processing system. Please try again.');
    return false;
  }
}

async function showCreditBreakdown(ctx, userData) {
  const duration = userData.duration || 0;
  const isPremium = PREMIUM_VOICES.includes();
  const baseCost = duration * 10; // 10 credits per min
  const premiumExtra = isPremium ? duration * 5 : 0; // +5 credits/min for premium
  const totalCost = baseCost + premiumExtra;

  await ctx.reply(
    `💰 *Credit Breakdown:*\n` +
    `⏱ Duration: ${duration} min × 10 = ${baseCost} credit(s)\n` +
    (isPremium ? `⭐ Premium voice: ${duration} min × 5 = +${premiumExtra} credit(s)\n` : ``) +
    `---------------------\n` +
    `💳 *Total: ${totalCost} credit(s)*`,
    { parse_mode: 'Markdown' }
  );

  return totalCost;
}

async function tryDeductCredits(ctx, userData) {
  const duration = userData.duration || 0;
  const isPremium = PREMIUM_VOICES.includes(userData.voice);
  
  // ✅ FIX: Ensure duration is valid before calculating
  if (duration === 0 || !duration) {
    console.error(`❌ Invalid duration for user ${ctx.chat.id}:`, userData);
    return {
      success: false,
      reason: '❌ Invalid duration. Please restart with /start',
      creditCost: 0,
      currentCredits: 0
    };
  }
  
  const creditCost = calculateCreditCost({ durationMinutes: duration, isPremiumVoice: isPremium });

  // ✅ Double-check credit cost is valid
  if (creditCost === 0 || isNaN(creditCost)) {
    console.error(`❌ Invalid credit cost calculated for user ${ctx.chat.id}:`, { duration, isPremium, creditCost });
    return {
      success: false,
      reason: '❌ Credit calculation error. Please contact /support',
      creditCost: 0,
      currentCredits: 0
    };
  }

  // ✅ FIX: Get credits properly
  const creditInfo = await getCredits(ctx.chat.id);
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

function isAdmin(ctx) {
  return ADMIN_IDS.includes(ctx.from.id);
}

// ✅ Admin command to replace segment media
bot.command('replacemedia', async (ctx) => {
  if (!isAdmin(ctx)) return;
  
  const parts = ctx.message.text.split(' ');
  if (parts.length !== 3) {
    return ctx.reply(
      'Usage: /replacemedia <jobId> <segmentIndex>\n\n' +
      'Example: /replacemedia 33 2'
    );
  }
  
  const jobId = parseInt(parts[1]);
  const segmentIndex = parseInt(parts[2]);
  
  if (isNaN(jobId) || isNaN(segmentIndex)) {
    return ctx.reply('❌ Invalid jobId or segmentIndex');
  }
  
  // Get job info to determine media type
  try {
    const response = await axios.get(`${WORKER_BASE_URL}/job-info/${jobId}`);
    const job = response.data.job;
    
    if (!job) {
      return ctx.reply('❌ Job not found');
    }
    
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
      `📤 *Replace Media for Job ${jobId}, Segment ${segmentIndex}*\n\n` +
      `Send your ${mediaType === 'videos' ? 'video' : 'image'} now:`,
      { parse_mode: 'Markdown' }
    );
    
  } catch (error) {
    console.error('Replace media error:', error);
    ctx.reply('❌ Error fetching job info');
  }
});

// ✅ Advanced quick video command (Admin only - full control)
bot.command('quickvideo', async (ctx) => {
  if (!isAdmin(ctx)) {
    return ctx.reply('❌ This command is only available to admins.');
  }
  
  ctx.reply(
    '🚀 *Advanced Quick Video Generator*\n\n' +
    '⚡ Create a video with full control - bypass all AI processing!\n\n' +
    'Send your configuration as JSON:\n\n' +
    '```json\n' +
    '{\n' +
    '  "script": "Your script text",\n' +
    '  "videotype": "longform",\n' +
    '  "duration": 2,\n' +
    '  "voice": "Desmond",\n' +
    '  "content_flow": "news",\n' +
    '  "media_type": "images",\n' +
    '  "status": "segments_ready",\n' +
    '  "segments": [\n' +
    '    {"text": "First segment text", "duration": 0},\n' +
    '    {"text": "Second segment", "duration": 0}\n' +
    '  ],\n' +
    '  "media_queries": [\n' +
    '    "peaceful meditation person",\n' +
    '    "comfortable sitting position"\n' +
    '  ]\n' +
    '}\n' +
    '```\n\n' +
    '💡 *Status options:*\n' +
    '• `text_approved` - Let AI segment it\n' +
    '• `segments_ready` - Use your segments/queries\n' +
    '• `images_approved` - Skip to audio (if images exist)\n\n' +
    'Or type /quickhelp for examples',
    { parse_mode: 'Markdown' }
  );
  
  const userData = userStates.get(ctx.chat.id) || {};
  userData.awaitingQuickVideo = true;
  userStates.set(ctx.chat.id, userData);
});

// ✅ Help command with examples
bot.command('quickhelp', async (ctx) => {
  if (!isAdmin(ctx)) return;
  
  ctx.reply(
    '📚 *Quick Video Examples*\n\n' +
    '*Example 1: Full Control (Bypass Everything)*\n' +
    '```json\n' +
    '{\n' +
    '  "script": "Welcome. This is segment one. Now segment two. Finally segment three.",\n' +
    '  "videotype": "shorts",\n' +
    '  "duration": 1,\n' +
    '  "voice": "Candice",\n' +
    '  "content_flow": "news",\n' +
    '  "media_type": "images",\n' +
    '  "status": "segments_ready",\n' +
    '  "segments": [\n' +
    '    {"text": "Welcome. This is segment one.", "duration": 0},\n' +
    '    {"text": "Now segment two.", "duration": 0},\n' +
    '    {"text": "Finally segment three.", "duration": 0}\n' +
    '  ],\n' +
    '  "image_queries": [\n' +
    '    "welcome sign greeting",\n' +
    '    "number two graphic",\n' +
    '    "finale celebration"\n' +
    '  ]\n' +
    '}\n' +
    '```\n\n' +
    '*Example 2: Let AI Segment (Use Some Credits)*\n' +
    '```json\n' +
    '{\n' +
    '  "script": "Your full script here...",\n' +
    '  "videotype": "longform",\n' +
    '  "duration": 3,\n' +
    '  "voice": "Desmond",\n' +
    '  "content_flow": "news",\n' +
    '  "media_type": "videos",\n' +
    '  "status": "text_approved"\n' +
    '}\n' +
    '```\n\n' +
    '*Example 3: Listicle with Custom Segments*\n' +
    '```json\n' +
    '{\n' +
    '  "script": "Top 3 AI Tools",\n' +
    '  "videotype": "reels",\n' +
    '  "duration": 2,\n' +
    '  "voice": "Liz",\n' +
    '  "content_flow": "listicle",\n' +
    '  "media_type": "images",\n' +
    '  "status": "segments_ready",\n' +
    '  "segments": [\n' +
    '    {"text": "Number 3: ChatGPT for writing", "duration": 0},\n' +
    '    {"text": "Number 2: Midjourney for art", "duration": 0},\n' +
    '    {"text": "Number 1: Your video bot!", "duration": 0}\n' +
    '  ],\n' +
    '  "image_queries": [\n' +
    '    "ChatGPT logo AI writing",\n' +
    '    "Midjourney AI generated art",\n' +
    '    "video creation AI bot"\n' +
    '  ]\n' +
    '}\n' +
    '```\n\n' +
    '💡 Copy, edit, and send!',
    { parse_mode: 'Markdown' }
  );
});

// ✅ Cancel quick video
bot.command('cancelquick', async (ctx) => {
  if (!isAdmin(ctx)) return;
  
  const userData = userStates.get(ctx.chat.id) || {};
  if (userData.awaitingQuickVideo) {
    delete userData.awaitingQuickVideo;
    userStates.set(ctx.chat.id, userData);
    ctx.reply('❌ Quick video cancelled.');
  }
});

// ✅ Admin: Check user's credit expiration
bot.command('checkuser', async (ctx) => {
  if (!isAdmin(ctx)) return;
  
  const parts = ctx.message.text.split(' ');
  if (parts.length !== 2) {
    return ctx.reply('Usage: /checkuser <telegramId>');
  }
  
  const telegramId = parts[1];
  const creditInfo = await getCredits(telegramId);
  
  if (creditInfo.amount === 0 && !creditInfo.expiresAt) {
    return ctx.reply(`📊 User ${telegramId} has no credits.`);
  }
  
  const expiryDate = creditInfo.expiresAt ? new Date(creditInfo.expiresAt) : null;
  const daysLeft = expiryDate ? Math.ceil((expiryDate - new Date()) / (1000 * 60 * 60 * 24)) : null;
  
  ctx.reply(
    `📊 *User Credit Info*\n\n` +
    `🆔 User: ${telegramId}\n` +
    `💰 Credits: ${creditInfo.amount}\n` +
    `📅 Expires: ${expiryDate ? expiryDate.toDateString() : 'Never'}\n` +
    `⏰ Days Left: ${daysLeft !== null ? daysLeft : 'N/A'}\n` +
    `❌ Expired: ${creditInfo.isExpired ? 'Yes' : 'No'}`,
    { parse_mode: 'Markdown' }
  );
});

// ✅ Admin: Extend user credits by 30 days
bot.command('extend', async (ctx) => {
  if (!isAdmin(ctx)) return;
  
  const parts = ctx.message.text.split(' ');
  if (parts.length !== 2) {
    return ctx.reply('Usage: /extend <telegramId>\n\nExtends credits by 30 days from now.');
  }
  
  const telegramId = parts[1];
  
  try {
    const creditInfo = await getCredits(telegramId);
    
    if (creditInfo.amount === 0) {
      return ctx.reply('❌ User has no credits to extend. Use /approve to grant credits first.');
    }
    
    // Extend by 30 days from now
    const newExpiry = new Date();
    newExpiry.setDate(newExpiry.getDate() + 30);
    
    await pool.query(
      'UPDATE credits SET expires_at = $1 WHERE telegram_id = $2',
      [newExpiry, telegramId]
    );
    
    ctx.reply(
      `✅ *Credits Extended*\n\n` +
      `👤 User: ${telegramId}\n` +
      `💰 Balance: ${creditInfo.amount}\n` +
      `📅 New Expiry: ${newExpiry.toDateString()}\n` +
      `⏰ Valid for: 30 more days`,
      { parse_mode: 'Markdown' }
    );
    
    // Notify user
    try {
      await bot.telegram.sendMessage(
        telegramId,
        `🎉 *Credits Extended!*\n\n` +
        `Your credits have been extended by 30 days.\n\n` +
        `📅 New Expiry: ${newExpiry.toDateString()}`,
        { parse_mode: 'Markdown' }
      );
    } catch (error) {
      ctx.reply('⚠️ Could not notify user (they may not have started the bot)');
    }
    
  } catch (error) {
    console.error('Extend error:', error);
    ctx.reply(`❌ Error: ${error.message}`);
  }
});

//admin tool to resend failed to-send video
bot.command('resend', async (ctx) => {
  if (!isAdmin(ctx)) return;
  
  const jobId = 25; // or parse from command
  
  // Get job from database
  const result = await pool.query('SELECT * FROM jobs WHERE id = $1', [jobId]);
  const job = result.rows[0];
  
  if (!job || !job.result_video) {
    return ctx.reply('❌ Job not found or no video available');
  }
  
  await notifyVideoComplete({
    id: job.id,
    user_id: job.user_id,
    result_video: job.result_video
  });
  
  ctx.reply('✅ Re-sent video notification');
});

//admin tool to reset video render job stage
bot.command('resetjob', async (ctx) => {
  if (!isAdmin(ctx)) return;

  const parts = ctx.message.text.split(' ');
  if (parts.length !== 2) {
    return ctx.reply('Usage: /resetjob <jobId>');
  }

  const jobId = parseInt(parts[1]);

  try {
    await pool.query(
      `UPDATE jobs 
       SET status = 'audio_approved', 
           result_video = NULL, 
           error_message = NULL,
           updated_at = NOW() 
       WHERE id = $1`,
      [jobId]
    );

    ctx.reply(`✅ Job ${jobId} reset to audio_approved. Worker will re-render it shortly.`);
  } catch (error) {
    ctx.reply(`❌ Error: ${error.message}`);
  }
});

//admin tool to resume image segments approval
bot.command('resume', async (ctx) => {
  if (!isAdmin(ctx)) return;

  const parts = ctx.message.text.split(' ');
  if (parts.length !== 2) {
    return ctx.reply('Usage: /resume <jobId>');
  }

  const jobId = parseInt(parts[1]);

  try {
    // Get current job status
    const jobResult = await pool.query(
      'SELECT id, status, segments FROM jobs WHERE id = $1',
      [jobId]
    );

    if (jobResult.rows.length === 0) {
      return ctx.reply(`❌ Job ${jobId} not found`);
    }

    const job = jobResult.rows[0];
    const segments = job.segments || [];
    const completedSegments = segments.filter(s => s.imageUrl).length;
    const totalSegments = segments.length;

    // Determine appropriate resume status
    let resumeStatus = 'segments_ready';
    
    if (job.status.includes('audio')) {
      resumeStatus = 'images_approved';
    } else if (job.status.includes('image')) {
      resumeStatus = 'segments_ready';
    } else if (job.status.includes('script') || job.status.includes('text')) {
      resumeStatus = 'text_approved';
    }

    // Reset to processable status
    await pool.query(
      `UPDATE jobs 
       SET status = $1, 
           updated_at = NOW() 
       WHERE id = $2`,
      [resumeStatus, jobId]
    );

    ctx.reply(
      `✅ Job ${jobId} resumed!\n\n` +
      `📊 Progress: ${completedSegments}/${totalSegments} segments complete\n` +
      `🔄 Status reset to: ${resumeStatus}\n\n` +
      `Worker will continue from where it left off.`
    );

  } catch (error) {
    console.error('Error resuming job:', error);
    ctx.reply(`❌ Error: ${error.message}`);
  }
});

// ✅ Handle quick video JSON configuration
async function handleQuickVideoJSON(ctx, userData, message) {
  try {
    // Parse JSON
    let config;
    try {
      config = JSON.parse(message);
    } catch (parseError) {
      return ctx.reply(
        '❌ Invalid JSON format!\n\n' +
        'Please check your syntax and try again.\n' +
        'Type /quickhelp for examples.'
      );
    }
    
    // Validate required fields
    const required = ['videotype', 'duration', 'voice'];
    const missing = required.filter(field => !config[field]);
    
    if (missing.length > 0) {
      return ctx.reply(
        `❌ Missing required fields: ${missing.join(', ')}\n\n` +
        'Type /quickhelp for examples.'
      );
    }
    
    // Validate videotype
    if (!['shorts', 'reels', 'longform'].includes(config.videotype)) {
      return ctx.reply('❌ videotype must be: shorts, reels, or longform');
    }
    
    // Validate duration - accept any number 1-30
if (typeof config.duration !== 'number' || config.duration < 1 || config.duration > 30) {
  return ctx.reply('❌ duration must be a number between 1 and 30');
}
    
    // Validate voice
    const validVoices = [
  'Max', 'Ashley', 'Ava', 'Roger', 'Lora',
  'Cassie', 'Ryan', 'Rachel', 'Missy', 'Amy',
  'Patrick', 'Andre', 'Stan', 'Lance', 'Alice',
  'Liz', 'Dave', 'Candice', 'Autumn', 'Desmond', 'Charlotte',
  'Ace', 'Liam', 'Keisha', 'Kent', 'Daisy', 'Lucy',
  'Linda', 'Jamal', 'Sydney', 'Sally', 'Violet', 'Rhihanon',
  'Mark'
];
    
    if (!validVoices.includes(config.voice)) {
      return ctx.reply(`❌ Invalid voice. Must be one of: ${validVoices.join(', ')}`);
    }
    
    // Validate status if provided
    const validStatuses = ['text_approved', 'segments_ready', 'images_approved', 'videos_approved'];
    const status = config.status || 'text_approved';
    
    if (!validStatuses.includes(status)) {
      return ctx.reply(`❌ Invalid status. Must be one of: ${validStatuses.join(', ')}`);
    }
    
    // If status is segments_ready, segments and media_queries are required
    if (status === 'segments_ready') {
      if (!config.segments || !Array.isArray(config.segments) || config.segments.length === 0) {
        return ctx.reply('❌ segments array is required when status is "segments_ready"');
      }
      
      if (!config.media_queries || !Array.isArray(config.media_queries) || config.media_queries.length === 0) {
        return ctx.reply('❌ media_queries array is required when status is "segments_ready"');
      }
      
      if (config.segments.length !== config.media_queries.length) {
        return ctx.reply('❌ segments and media_queries must have the same length');
      }
    }
    
    // Set defaults
    const jobData = {
      user_id: ctx.chat.id,
      script: config.script || '',
      videotype: config.videotype,
      duration: config.duration,
      voice: config.voice,
      content_flow: config.content_flow || 'news',
      media_type: config.media_type || 'images',
      status: status,
      segments: config.segments || null,
      media_queries: config.media_queries || null
    };
    
    // Show summary
const scriptPreview = jobData.script 
  ? jobData.script.substring(0, 60) + '...' 
  : 'None';

await ctx.reply(
  '📋 Configuration Summary:\n\n' +
  `🎬 Type: ${jobData.videotype}\n` +
  `⏱ Duration: ${jobData.duration} min\n` +
  `🎤 Voice: ${jobData.voice}\n` +
  `📰 Flow: ${jobData.content_flow}\n` +
  `🎨 Media: ${jobData.media_type}\n` +
  `🚦 Status: ${jobData.status}\n` +
  `📊 Segments: ${jobData.segments ? jobData.segments.length : 'Auto'}\n` +
  `🔍 Queries: ${jobData.media_queries ? jobData.media_queries.length : 'Auto'}\n\n` +
  `📝 Script: ${scriptPreview}\n\n` +
  `⚡ Creating job...`
  // ✅ NO parse_mode at all - just plain text
);
    
    // Create job in database
    try {
      const result = await pool.query(
        `INSERT INTO jobs (
          user_id, 
          script, 
          videotype, 
          duration, 
          voice, 
          content_flow, 
          media_type, 
          status,
          segments,
          media_queries,
          created_at,
          updated_at
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, NOW(), NOW())
        RETURNING id`,
        [
          jobData.user_id,
          jobData.script,
          jobData.videotype,
          jobData.duration,
          jobData.voice,
          jobData.content_flow,
          jobData.media_type,
          jobData.status,
          jobData.segments ? JSON.stringify(jobData.segments) : null,
          jobData.media_queries ? JSON.stringify(jobData.media_queries) : null
        ]
      );
      
      const jobId = result.rows[0].id;
      
      let statusExplanation = '';
      if (status === 'text_approved') {
        statusExplanation = '🤖 AI will segment your script (uses OpenAI credits)';
      } else if (status === 'segments_ready') {
        statusExplanation = '⚡ Using your segments - skipping AI processing (saves credits!)';
      } else if (status === 'images_approved') {
        statusExplanation = '🎵 Skipping to audio generation';
      } else if (status === 'videos_approved') {
        statusExplanation = '🎵 Skipping to audio generation (stock videos mode)';
      }
      
await ctx.reply(
  `✅ Quick Video Job Created!\n\n` +
  `🎬 Job ID: ${jobId}\n` +
  `📊 Status: ${jobData.status}\n\n` +
  `${statusExplanation}\n\n` +
  `🔄 Worker will process this automatically.\n` +
  `You will receive notifications at each stage.`
  // ✅ NO parse_mode - removed bold formatting and changed "You'll" to "You will"
);
      
      console.log(`⚡ Quick video job ${jobId} created by admin ${ctx.chat.id} (status: ${jobData.status})`);
      
      // Clean up state
      delete userData.awaitingQuickVideo;
      userStates.set(ctx.chat.id, userData);
      
    } catch (dbError) {
      console.error('Database error creating quick video:', dbError);
      await ctx.reply('❌ Database error. Please try again.');
    }
    
  } catch (error) {
    console.error('Quick video processing error:', error);
    await ctx.reply(`❌ Error: ${error.message}`);
  }
}

// NOTIFICATION FUNCTIONS
async function notifyScriptForReview({ id, user_id, script }) {
  try {
    // If script is short enough, send as regular message
    if (script.length <= 3800) { // Leave some buffer for formatting
      await bot.telegram.sendMessage(
        user_id,
        `📝 *Script Generated*\n\n${script}`,
        {
          parse_mode: 'Markdown',
          reply_markup: {
            inline_keyboard: [
              [
                { text: '✅ Approve Script', callback_data: `approve_script_${id}` },
                { text: '✏️ Edit Script', callback_data: `edit_script_${id}` }
              ],
              [
                { text: '🔄 Regenerate Script', callback_data: `regenerate_script_${id}` }
              ]
            ]
          }
        }
      );
    } else {
      // For long scripts, send as a text file
      const scriptBuffer = Buffer.from(script, 'utf8');
      
      await bot.telegram.sendDocument(
        user_id,
        {
          source: scriptBuffer,
          filename: 'script.txt'
        },
        {
          caption: `📝 *Script Generated*\n\nYour script was too long for a message, so here it is as a file. Please review the complete script:`,
          parse_mode: 'Markdown',
          reply_markup: {
            inline_keyboard: [
              [
                { text: '✅ Approve Script', callback_data: `approve_script_${id}` },
                { text: '✏️ Edit Script', callback_data: `edit_script_${id}` }
              ],
              [
                { text: '🔄 Regenerate Script', callback_data: `regenerate_script_${id}` }
              ]
            ]
          }
        }
      );
    }
  } catch (error) {
    console.error(`Failed to notify user ${user_id} for script review:`, error);
  }
}

// Individual segment image review notification
async function notifySegmentImageForReview({ id, user_id, segmentIndex, totalSegments, segmentText, imageUrl, query }) {
  try {
    console.log(`📤 Sending image for segment ${segmentIndex + 1} to user ${user_id}`);
    console.log(`🖼️ Image URL: ${imageUrl}`);
    
    // Download image from R2 (works for both real images and placeholders)
    const response = await axios.get(imageUrl, { 
      responseType: 'arraybuffer',
      timeout: 30000,
      maxContentLength: 20 * 1024 * 1024
    });
    
    const imageBuffer = Buffer.from(response.data);
    const fileSizeMB = (imageBuffer.length / (1024 * 1024)).toFixed(2);
    
    console.log(`✅ Downloaded image: ${fileSizeMB}MB`);
    
    // Send image as buffer
    await bot.telegram.sendPhoto(
      user_id,
      {
        source: imageBuffer,
        filename: `segment_${segmentIndex + 1}.jpg`
      },
      {
        caption: `🖼️ **Image for Segment ${segmentIndex + 1}/${totalSegments}**\n\n` +
                `📝 **Text:** ${segmentText.substring(0, 150)}${segmentText.length > 150 ? '...' : ''}\n\n` +
                `❓ **Is this image relevant to this part of your script?**`,
        parse_mode: 'Markdown',
        reply_markup: {
          inline_keyboard: [
            [
              { text: '✅ Approve This Image', callback_data: `approve_segment_${id}_${segmentIndex}` },
              { text: '🔄 Refetch This Image', callback_data: `refetch_segment_${id}_${segmentIndex}` }
            ],
            [
              { text: '📤 Upload My Own Image', callback_data: `upload_segment_${id}_${segmentIndex}` }
            ]
          ]
        }
      }
    );
    
    console.log(`✅ Image sent successfully for segment ${segmentIndex + 1}`);
    
  } catch (error) {
    // Just log and throw - let the worker handle the error
    console.error(`❌ Failed to send image for segment ${segmentIndex + 1}:`, error.message);
    throw error; // Worker will catch this and mark job as error
  }
}

// ✅ NEW: Request user to upload their own image
async function notifySegmentUploadRequest({ id, user_id, segmentIndex, totalSegments, segmentText, query }) {
  try {
    console.log(`📤 Requesting image upload for segment ${segmentIndex + 1} from user ${user_id}`);
    
    await bot.telegram.sendMessage(
      user_id,
      `📸 **Upload Image for Segment ${segmentIndex + 1}/${totalSegments}**\n\n` +
      `📝 **Script:**\n_${segmentText.substring(0, 250)}${segmentText.length > 250 ? '...' : ''}_\n\n` +
      `💡 **Suggested search:** "${query}"\n\n` +
      `👇 Click the button below, then send your image:`,
      {
        parse_mode: 'Markdown',
        reply_markup: {
          inline_keyboard: [
            [
              { text: '📤 Upload Image', callback_data: `upload_segment_${id}_${segmentIndex}` }
            ]
          ]
        }
      }
    );
    
    console.log(`✅ Upload request sent for segment ${segmentIndex + 1}`);
    
  } catch (error) {
    console.error(`❌ Failed to request upload for segment ${segmentIndex + 1}:`, error.message);
    throw error;
  }
}

// All images complete notification
async function notifyAllImagesComplete({ id, user_id }) {
  try {
    // Get job info from backend instead of direct DB query
    const jobInfo = await getJobInfo(id);
    const segments = jobInfo?.segments || [];
    
    await bot.telegram.sendMessage(
      user_id,
      `🎉 **All Images Complete**\n\n` +
      `✅ Successfully processed ${segments.length} segment${segments.length !== 1 ? 's' : ''}\n\n` +
      `Moving to audio generation...`,
      { parse_mode: 'Markdown' }
    );
  } catch (error) {
    console.error(`Failed to notify user ${user_id} for all images complete:`, error);
  }
}

// ✅ NEW: Stock video review notification
async function notifySegmentVideoForReview({ id, user_id, segmentIndex, totalSegments, segmentText, videoUrl, query }) {
  try {
    console.log(`📤 Sending stock video preview for segment ${segmentIndex + 1} to user ${user_id}`);
    console.log(`🎬 Video URL: ${videoUrl}`);
    
    // Download video from R2
    const response = await axios.get(videoUrl, { 
      responseType: 'arraybuffer',
      timeout: 60000,
      maxContentLength: 50 * 1024 * 1024 // 50MB max
    });
    
    const videoBuffer = Buffer.from(response.data);
    const fileSizeMB = (videoBuffer.length / (1024 * 1024)).toFixed(2);
    
    console.log(`✅ Downloaded stock video: ${fileSizeMB}MB`);
    
    // Send video as buffer
    await bot.telegram.sendVideo(
      user_id,
      {
        source: videoBuffer,
        filename: `stock_segment_${segmentIndex + 1}.mp4`
      },
      {
        caption: `🎬 **Video clip for Segment ${segmentIndex + 1}/${totalSegments}**\n\n` +
                `📝 **Text:** ${segmentText.substring(0, 150)}${segmentText.length > 150 ? '...' : ''}\n\n` +
                `❓ **Is this video suitable for this segment?**`,
        parse_mode: 'Markdown',
        supports_streaming: true,
        reply_markup: {
          inline_keyboard: [
            [
              { text: '✅ Approve This Video', callback_data: `approve_video_${id}_${segmentIndex}` },
              { text: '🔄 Refetch Different Video', callback_data: `refetch_video_${id}_${segmentIndex}` }
            ]
          ]
        }
      }
    );
    
    console.log(`✅ Stock video sent successfully for segment ${segmentIndex + 1}`);
    
  } catch (error) {
    console.error(`❌ Failed to send stock video for segment ${segmentIndex + 1}:`, error.message);
    
    // Fallback: send text message
    try {
      await bot.telegram.sendMessage(
        user_id,
        `🎬 **Video clip for Segment ${segmentIndex + 1}/${totalSegments}**\n\n` +
        `📝 **Text:** ${segmentText.substring(0, 200)}${segmentText.length > 200 ? '...' : ''}\n\n` +
        `⚠️ Could not preview video. Download link:\n${videoUrl}`,
        {
          parse_mode: 'Markdown',
          reply_markup: {
            inline_keyboard: [
              [
                { text: '✅ Approve This Video', callback_data: `approve_video_${id}_${segmentIndex}` },
                { text: '🔄 Refetch Different Video', callback_data: `refetch_video_${id}_${segmentIndex}` }
              ]
            ]
          }
        }
      );
      console.log(`📎 Sent fallback message for segment ${segmentIndex + 1}`);
    } catch (fallbackError) {
      console.error(`❌ Fallback message also failed:`, fallbackError.message);
      throw error;
    }
  }
}

// ✅ NEW: All videos complete notification
async function notifyAllVideosComplete({ id, user_id }) {
  try {
    await bot.telegram.sendMessage(
      user_id,
      `🎉 **All videos Complete**\n\n` +
      `✅ All video segments have been fetched and approved!\n\n` +
      `Moving to audio generation...`,
      { parse_mode: 'Markdown' }
    );
  } catch (error) {
    console.error(`Failed to notify user ${user_id} for videos complete:`, error);
  }
}

async function notifyAudioForReview({ id, user_id, result_audio }) {
  try {
    console.log(`📤 Sending audio for review to user ${user_id}`);
    
    // Download audio from R2
    const response = await axios.get(result_audio, { 
      responseType: 'arraybuffer',
      timeout: 60000, // 60 second timeout for larger audio files
      maxContentLength: 50 * 1024 * 1024 // 50MB max
    });
    
    const audioBuffer = Buffer.from(response.data);
    const fileSizeMB = (audioBuffer.length / (1024 * 1024)).toFixed(2);
    
    console.log(`✅ Downloaded audio: ${fileSizeMB}MB`);
    
    await bot.telegram.sendAudio(
      user_id,
      {
        source: audioBuffer,
        filename: `narration_${id}.mp3`
      },
      {
        caption: `🎵 *Audio Generated*\n\nAre you okay with this voiceover?`,
        parse_mode: 'Markdown',
        reply_markup: {
          inline_keyboard: [
            [
              { text: '✅ Approve Audio', callback_data: `approve_audio_${id}` },
              { text: '🔄 Regenerate Audio', callback_data: `regenerate_audio_${id}` }
            ]
          ]
        }
      }
    );
    
    console.log(`✅ Audio sent successfully to user ${user_id}`);
    
  } catch (error) {
    console.error(`❌ Failed to notify user ${user_id} for audio review:`, error.message);
    
    // Fallback: send URL as text
    try {
      await bot.telegram.sendMessage(
        user_id,
        `🎵 *Audio Generated*\n\n` +
        `⚠️ Could not send audio directly. Download it here:\n${result_audio}\n\n` +
        `Listen and decide:`,
        {
          parse_mode: 'Markdown',
          reply_markup: {
            inline_keyboard: [
              [
                { text: '✅ Approve Audio', callback_data: `approve_audio_${id}` },
                { text: '🔄 Regenerate Audio', callback_data: `regenerate_audio_${id}` }
              ]
            ]
          }
        }
      );
    } catch (fallbackError) {
      console.error(`❌ Fallback message also failed:`, fallbackError.message);
    }
  }
}

async function notifyVideoComplete({ id, user_id, result_video }) {
  try {
    console.log(`📤 Sending video to user ${user_id} for job ${id}`);
    console.log(`📺 Video URL: ${result_video}`);
    
    // Download video from R2
    const response = await axios.get(result_video, { 
      responseType: 'arraybuffer',
      timeout: 60000, // 60 second timeout for large files
      maxContentLength: 100 * 1024 * 1024 // 100MB max
    });
    
    const videoBuffer = Buffer.from(response.data);
    const fileSizeMB = (videoBuffer.length / (1024 * 1024)).toFixed(2);
    
    console.log(`✅ Downloaded video: ${fileSizeMB}MB`);
    
    // Check Telegram's 50MB limit
    if (videoBuffer.length > 50 * 1024 * 1024) {
      console.error(`❌ Video too large for Telegram: ${fileSizeMB}MB`);
      
      // Send as document instead (documents can be up to 2GB)
      await bot.telegram.sendDocument(
        user_id,
        {
          source: videoBuffer,
          filename: `video_${id}.mp4`
        },
        {
          caption: `🎬 *Your video is ready!*\n\n⚠️ File was too large for video player (${fileSizeMB}MB), sent as document.\n\nDownload link: ${result_video}`,
          parse_mode: 'Markdown'
        }
      );
      
      return;
    }
    
    // Send as video
    await bot.telegram.sendVideo(
      user_id,
      {
        source: videoBuffer,
        filename: `video_${id}.mp4`
      },
      {
        caption: `🎬 *Your video is ready!*\n\nEnjoy your creation!`,
        parse_mode: 'Markdown',
        supports_streaming: true
      }
    );
    
    console.log(`✅ Video sent successfully to user ${user_id}`);
    
  } catch (error) {
    console.error(`❌ Failed to send completed video to user ${user_id}:`, error.message);
    
    // Fallback: send URL as text if video sending fails
    try {
      await bot.telegram.sendMessage(
        user_id,
        `🎬 *Your video is ready!*\n\n` +
        `⚠️ There was an issue sending the video directly. ` +
        `Please download it from this link:\n\n${result_video}\n\n` +
        `_Link valid for 7 days_`,
        { parse_mode: 'Markdown' }
      );
      
      console.log(`📎 Sent download link as fallback to user ${user_id}`);
    } catch (fallbackError) {
      console.error(`❌ Fallback message also failed:`, fallbackError.message);
    }
  }
}

// Clear script timeout for a user
function clearScriptTimeout(chatId) {
  const timeoutId = scriptTimeouts.get(chatId);
  if (timeoutId) {
    clearTimeout(timeoutId);
    scriptTimeouts.delete(chatId);
  }
}

// Process buffered script and proceed
async function processBufferedScript(ctx, chatId) {
  const userData = userStates.get(chatId);
  if (!userData || !userData.scriptBuffer || userData.scriptBuffer.length === 0) return;

  clearScriptTimeout(chatId);

  // Concatenate all buffered messages
  const fullScript = userData.scriptBuffer.join('\n\n');
  const partCount = userData.scriptBuffer.length; // ✅ SAVE LENGTH BEFORE DELETING
  
  // Store as final input and clean up buffer
  userData.inputText = fullScript;
  delete userData.scriptBuffer; // Now it's safe to delete
  delete userData.bufferingScript; // Also clean up flag

  // Auto-estimate duration
const estimatedDuration = estimateDurationFromScript(fullScript);
  
  // Cap estimation at 30 minutes max
  userData.duration = Math.min(estimatedDuration, 30);

  await ctx.reply(
    `⏱ Estimated duration: *${userData.duration} min*`,
    { parse_mode: 'Markdown' }
  );

  userStates.set(chatId, userData);

  return ctx.reply(
    'Choose the video type:',
    Markup.keyboard([['Shorts', 'Reels'], ['Longform']])
      .oneTime()
      .resize()
  );
}

// Start or reset script buffering timeout
function setScriptTimeout(ctx, chatId) {
  // Clear existing timeout
  clearScriptTimeout(chatId);

  // Set new timeout
  const timeoutId = setTimeout(async () => {
    await processBufferedScript(ctx, chatId);
  }, SCRIPT_BUFFER_TIMEOUT);

  scriptTimeouts.set(chatId, timeoutId);
}
// BOT HANDLERS (rest of your existing bot code...)
bot.start(async (ctx) => {
  clearScriptTimeout(ctx.chat.id);
  userStates.set(ctx.chat.id, {});

  // ✅ Create session immediately on first interaction
  await createSessionIfNotExists(ctx.chat.id, {
    username: ctx.from.username || null,
    firstName: ctx.from.first_name || null,
  });

  return ctx.reply(
    '🎬Choose your content flow.',
    Markup.keyboard([['📰 Essay Styled Videos'], ['📋 Listicle Videos']])
      .oneTime()
      .resize()
  );
});

// ✅ NEW: Content flow handler using bot.hears()
bot.hears(['📰 Essay Styled Videos', '📋 Listicle Videos'], async (ctx) => {
  const userData = userStates.get(ctx.chat.id) || {};
  const message = ctx.message.text;
  
  console.log('🎯 Content flow button detected via bot.hears():', message);
  
  const contentFlow = message === '📰 Essay Styled Videos' ? 'news' : 'listicle';
  
  userData.content_flow = contentFlow;
  userStates.set(ctx.chat.id, userData);
  
  const flowName = contentFlow === 'listicle' ? 'Listicle Videos' : 'Essay Styled Videos';
  
  ctx.reply(
    `✅ ${flowName} selected!\n\nHow would you like to begin?`,
    Markup.keyboard([['📝 Script'], ['💡 Prompt']])
      .oneTime()
      .resize()
  );
});

// ✅ NEW: Input mode handler using bot.hears()
bot.hears(['📝 Script', '💡 Prompt'], async (ctx) => {
  const isPrompt = ctx.message.text.includes('Prompt');
  const userData = userStates.get(ctx.chat.id) || {};
  userData.mode = isPrompt ? 'prompt' : 'script';
  userStates.set(ctx.chat.id, userData);

  ctx.reply(`Please enter your ${isPrompt ? 'prompt' : 'script'}:`);
});

bot.telegram.setMyCommands([
  { command: 'start', description: 'Start or reset your session' },
  { command: 'demo', description: 'Watch tutorial on how to use Syinth' },
  { command: 'samples', description: 'View sample videos created with Syinth' },
  { command: 'credits', description: 'Check your remaining credits' },
  { command: 'status', description: 'View your plan status and expiry' },
  { command: 'mydashboard', description: 'Open your personal dashboard' },
  { command: 'support', description: 'Contact support team' }
]);

bot.command(['credit', 'credits'], async (ctx) => {
  const creditInfo = await getCredits(ctx.chat.id);
  
  if (creditInfo.isExpired) {
    return ctx.reply(
      '⏳ *Your credits have expired*\n\n' +
      '💰 Expired Balance: ~~' + creditInfo.amount + '~~ credits\n\n' +
      'Please contact /support to renew your credits.',
      { parse_mode: 'Markdown' }
    );
  }
  
  if (!creditInfo.expiresAt) {
    return ctx.reply(`💰 You have ${creditInfo.amount} credit(s) left.`);
  }
  
  const expiryDate = new Date(creditInfo.expiresAt);
  const daysLeft = Math.ceil((expiryDate - new Date()) / (1000 * 60 * 60 * 24));
  
  ctx.reply(
    `💰 *Your Credits*\n\n` +
    `Balance: *${creditInfo.amount}* credit(s)\n` +
    `Expires: *${expiryDate.toDateString()}*\n` +
    `⏰ Days left: *${daysLeft}* day(s)\n\n` +
    `Need more? Contact /support!`,
    { parse_mode: 'Markdown' }
  );
});

bot.on('callback_query', async (ctx) => {
  const callbackData = ctx.callbackQuery.data;
  
  // ✅ DEBUG: Log all callback queries
  console.log('=== CALLBACK QUERY DEBUG ===');
  console.log('Raw callback data:', callbackData);
  console.log('User ID:', ctx.from.id);
  console.log('============================');
  
  try {
    // ✅ NEW: Handle job approval
    if (callbackData.startsWith('approve_job_')) {
      if (!isAdmin(ctx)) {
        return ctx.answerCbQuery('❌ Only admins can approve jobs', true);
      }
      
      const jobId = callbackData.replace('approve_job_', '');
      
      try {
        // Update job status to 'pending' so worker can process it
        const response = await axios.post(`${WORKER_BASE_URL}/approve-job`, { jobId: parseInt(jobId) });
        
        if (response.data.success) {
          const job = response.data.job;
          
          await ctx.editMessageText(
            `✅ *VIDEO APPROVED*\n\n` +
            `👤 User: @${response.data.username || 'N/A'}\n` +
            `🎬 Job ID: ${jobId}\n\n` +
            `*Status:* Processing started ✓\n` +
            `*Approved by:* @${ctx.from.username || ctx.from.first_name}`,
            { parse_mode: 'Markdown' }
          );
          
          await ctx.answerCbQuery('✅ Video approved! Processing started.');
          
          // Notify user
          await bot.telegram.sendMessage(
            job.user_id,
            '✅ *Your video request has been approved!*\n\n' +
            '🎬 Processing has started. You will receive your video when it\'s ready.',
            { parse_mode: 'Markdown' }
          );
          
          console.log(`✅ Admin ${ctx.from.id} approved job ${jobId}`);
        } else {
          await ctx.answerCbQuery('❌ Failed to approve job', true);
        }
      } catch (error) {
        console.error('Error approving job:', error);
        await ctx.answerCbQuery('❌ Error processing approval', true);
      }
      
      return;
    }
    
    // Handle individual segment approvals (4-part callback data)
    if (callbackData.startsWith('approve_segment_')) {
      const [action, type, jobId, segmentIndex] = callbackData.split('_');
      
      console.log(`Approving segment ${segmentIndex} for job ${jobId}`);
      
      try {
        // ✅ FIXED: Send both jobId AND segmentIndex
        const response = await axios.post(`${WORKER_BASE_URL}/approve-segment`, { 
          jobId: parseInt(jobId), 
          segmentIndex: parseInt(segmentIndex) 
        });
        
        console.log('Segment approval response:', response.data);

        if (response.data.success) {
          await ctx.editMessageCaption(
            `✅ **Segment ${parseInt(segmentIndex) + 1} Approved!**\n\n` +
            ctx.callbackQuery.message.caption.split('\n\n').slice(1).join('\n\n') + 
            '\n\n*Moving to next segment...*',
            { parse_mode: 'Markdown' }
          );
          await ctx.answerCbQuery('Segment approved! Processing next...');
        } else {
          console.error('Segment approval failed:', response.data);
          await ctx.answerCbQuery('Failed to approve segment', true);
        }
      } catch (error) {
        console.error('Error calling approve-segment:', error.message);
        await ctx.answerCbQuery('Error processing request', true);
      }
      return;
    }

    // Handle individual segment refetch (4-part callback data)
    if (callbackData.startsWith('refetch_segment_')) {
      const [action, type, jobId, segmentIndex] = callbackData.split('_');
      
      console.log(`Refetching segment ${segmentIndex} for job ${jobId}`);
      
      const creditCost = 1; // 1 credit per image refetch
      const currentCredits = await getCredits(ctx.chat.id);
      
      if (currentCredits < creditCost) {
        return ctx.answerCbQuery(`Insufficient credits. Need ${creditCost}, have ${currentCredits}`, true);
      }

      await useCredits(ctx.chat.id, creditCost);
      
      try {
        // ✅ Use worker endpoint
        const success = await triggerSegmentRefetch(parseInt(jobId), parseInt(segmentIndex));
        
        console.log(`Refetch trigger result: ${success}`);
        
        if (success) {
          await ctx.editMessageCaption(
            `🔄 **Refetching Image for Segment ${parseInt(segmentIndex) + 1}...**\n\n` +
            ctx.callbackQuery.message.caption.split('\n\n').slice(1).join('\n\n') + 
            `\n\n*${creditCost} credits deducted*`,
            { parse_mode: 'Markdown' }
          );
          
          await ctx.answerCbQuery(`Refetching segment... ${creditCost} credits deducted`);
        } else {
          await ctx.answerCbQuery('Failed to trigger refetch', true);
        }
      } catch (error) {
        console.error('Error in refetch segment:', error.message);
        await ctx.answerCbQuery('Error processing request', true);
      }
      return;
    }

    // Handle individual segment upload (4-part callback data)
    if (callbackData.startsWith('upload_segment_')) {
      const [action, type, jobId, segmentIndex] = callbackData.split('_');
      
      console.log(`Setting up upload for segment ${segmentIndex} in job ${jobId}`);
      
      const userData = userStates.get(ctx.chat.id) || {};
      userData.uploadingSegmentImage = {
        jobId: jobId,
        segmentIndex: parseInt(segmentIndex)
      };
      userStates.set(ctx.chat.id, userData);

      await ctx.editMessageCaption(
        `📤 **Upload Image for Segment ${parseInt(segmentIndex) + 1}**\n\n` +
        ctx.callbackQuery.message.caption.split('\n\n').slice(1).join('\n\n') + 
        '\n\n*Please send your image now:*',
        { parse_mode: 'Markdown' }
      );
      
      await ctx.answerCbQuery('Send your image for this segment');
      return;
    }

    // ✅ NEW: Handle stock video segment approvals (4-part callback data)
if (callbackData.startsWith('approve_video_')) {
  const [action, type, jobId, segmentIndex] = callbackData.split('_');
  const segIdx = parseInt(segmentIndex);
  const jId = parseInt(jobId);
  
  console.log(`Approving video segment ${segIdx} for job ${jId}`);
  
  try {
    const response = await axios.post(`${WORKER_BASE_URL}/approve-video-segment`, { 
      jobId: jId, 
      segmentIndex: segIdx
    });

    if (response.data.success) {
      await ctx.editMessageCaption(
        `✅ **Video Segment ${segIdx + 1} Approved!**\n\n` +
        ctx.callbackQuery.message.caption.split('\n\n').slice(1).join('\n\n'),
        { parse_mode: 'Markdown' }
      );
      await ctx.answerCbQuery('✅ Approved!');
    } else {
      await ctx.answerCbQuery('Failed to approve video', true);
    }
  } catch (error) {
    console.error('Error approving video:', error.message);
    await ctx.answerCbQuery('Error processing request', true);
  }
  return;
}

// ✅ NEW: Handle stock video refetch (4-part callback data)
if (callbackData.startsWith('refetch_video_')) {
  const [action, type, jobId, segmentIndex] = callbackData.split('_');
  
  console.log(`Refetching stock video for segment ${segmentIndex} in job ${jobId}`);
  
  const creditCost = 5; // 5 credits per video refetch (higher than images)
  const currentCredits = await getCredits(ctx.chat.id);
  
  if (currentCredits < creditCost) {
    return ctx.answerCbQuery(`Insufficient credits. Need ${creditCost}, have ${currentCredits}`, true);
  }

  await useCredits(ctx.chat.id, creditCost);
  
  try {
    const response = await axios.post(`${WORKER_BASE_URL}/refetch-video-segment`, {
      jobId: parseInt(jobId),
      segmentIndex: parseInt(segmentIndex)
    });
    
    console.log(`Video refetch trigger result:`, response.data);
    
    if (response.data.success) {
      await ctx.editMessageCaption(
        `🔄 **Refetching Stock Video for Segment ${parseInt(segmentIndex) + 1}...**\n\n` +
        ctx.callbackQuery.message.caption.split('\n\n').slice(1).join('\n\n') + 
        `\n\n*${creditCost} credits deducted*`,
        { parse_mode: 'Markdown' }
      );
      
      await ctx.answerCbQuery(`Refetching video... ${creditCost} credits deducted`);
    } else {
      await ctx.answerCbQuery('Failed to trigger refetch', true);
    }
  } catch (error) {
    console.error('Error in refetch video segment:', error.message);
    await ctx.answerCbQuery('Error processing request', true);
  }
  return;
}
    // Handle 3-part callback data (script and audio)
    const [action, type, jobId] = callbackData.split('_');
    
    console.log(`Processing ${action} ${type} for job ${jobId}`);

    if (action === 'approve') {
      if (type === 'script') {
        console.log(`Approving script for job ${jobId}`);
        
        try {
          const response = await axios.post(`${WORKER_BASE_URL}/approve-script`, { jobId });
          console.log('Script approval response:', response.data);
          
          if (response.data.success) {
            await safeEditMessage(ctx, '✅ Script approved! Moving to next stage...');
            await ctx.answerCbQuery('Script approved!');
          } else {
            console.error('Script approval failed:', response.data);
            await ctx.answerCbQuery('Failed to approve script', true);
          }
        } catch (error) {
          console.error('Error calling approve-script:', error.message);
          await ctx.answerCbQuery('Error processing request', true);
        }
        
      } else if (type === 'audio') {
        console.log(`Approving audio for job ${jobId}`);
        
        try {
          const response = await axios.post(`${WORKER_BASE_URL}/approve-audio`, { jobId });
          console.log('Audio approval response:', response.data);
          
          if (response.data.success) {
            await safeEditMessage(ctx, '✅ Audio approved! Moving to final video generation...');
            await ctx.answerCbQuery('Audio approved!');
          } else {
            console.error('Audio approval failed:', response.data);
            await ctx.answerCbQuery('Failed to approve audio', true);
          }
        } catch (error) {
          console.error('Error calling approve-audio:', error.message);
          await ctx.answerCbQuery('Error processing request', true);
        }
      }
      
    } else if (action === 'edit' && type === 'script') {
      console.log(`Setting up script edit for job ${jobId}`);
      
      const userData = userStates.get(ctx.chat.id) || {};
      userData.editingScript = jobId;
      userStates.set(ctx.chat.id, userData);
      
      await safeEditMessage(ctx, '✏️ Please send your edited script:');
      await ctx.answerCbQuery('Send your edited script');
      
    } else if (action === 'regenerate') {
      console.log(`Regenerating ${type} for job ${jobId}`);
      
      const jobInfo = await getJobInfo(jobId);
      if (!jobInfo) {
        console.error(`Job ${jobId} not found for regeneration`);
        return ctx.answerCbQuery('Job not found', true);
      }

      let creditCost = 0;

      if (type === 'script') {
  creditCost = 2; // Flat 2 credits for script regeneration
      } else if (type === 'audio') {
  const duration = jobInfo.duration || 1;
  const isPremium = PREMIUM_VOICES.includes(jobInfo.voice);
  creditCost = isPremium ? duration * 8 : duration * 5;
}

      const currentCredits = await getCredits(ctx.chat.id);
      if (currentCredits < creditCost) {
        return ctx.answerCbQuery(`Insufficient credits. Need ${creditCost}, have ${currentCredits}`, true);
      }

      await useCredits(ctx.chat.id, creditCost);
      console.log(`Deducted ${creditCost} credits for ${type} regeneration`);
      
      try {
        const success = await triggerRegeneration(jobId, type);
        console.log(`Regeneration trigger result: ${success}`);

        if (success) {
          const message = type === 'script' ? 'Regenerating script...' : 'Regenerating audio...';
          await safeEditMessage(ctx, `🔄 ${message} (${creditCost} credits deducted)`);
          await ctx.answerCbQuery(`Regenerating... ${creditCost} credits deducted`);
        } else {
          await ctx.answerCbQuery('Failed to trigger regeneration', true);
        }
      } catch (error) {
        console.error('Error in regeneration:', error.message);
        await ctx.answerCbQuery('Error processing request', true);
      }
    }
    
  } catch (error) {
    console.error('Callback query error:', error);
    await ctx.answerCbQuery('Error processing request', true);
  }
});

bot.command('admin', (ctx) => {
  if (!isAdmin(ctx)) return;
  ctx.reply('🔐 Admin Panel Access Granted.\nYou’ll be notified of user submissions here.');
});

bot.command('approve', async (ctx) => { 
  if (!isAdmin(ctx)) return;

  const parts = ctx.message.text.split(' ');
  if (parts.length !== 3) {
    return ctx.reply('Usage: /approve <telegramId> <credits>\n\nExample: /approve 123456789 500');
  }

  const telegramId = String(parts[1]);
  const credits = parseInt(parts[2]);

  if (isNaN(credits) || credits <= 0) {
    return ctx.reply('❌ Invalid credit amount. Must be a positive number.');
  }

  try {
    const transactionId = `admin_${ctx.from.id}_${telegramId}_${Date.now()}`;
    
    const result = await setCredits(telegramId, credits, transactionId, 'admin_approval');
    
    if (result.alreadyProcessed) {
      return ctx.reply(`⚠️ Credits already added to user ${telegramId} recently.`);
    }

    const expiryDate = new Date(result.expiresAt);
    
    // ✅ Notify admin
    ctx.reply(
      `✅ *Credits Approved*\n\n` +
      `👤 User: ${telegramId}\n` +
      `💰 Credits: ${credits}\n` +
      `📅 Expires: ${expiryDate.toDateString()}\n` +
      `⏰ Valid for: 30 days`,
      { parse_mode: 'Markdown' }
    );

    // ✅ Notify user
    try {
      await bot.telegram.sendMessage(
        telegramId,
        `🎉 *Credits Received!*\n\n` +
        `💰 Amount: *${credits}* credits\n` +
        `📅 Expires: *${expiryDate.toDateString()}*\n` +
        `⏰ Valid for: *30 days*\n\n` +
        `You can now create videos! Use /start to begin.`,
        { parse_mode: 'Markdown' }
      );
    } catch (error) {
      ctx.reply(`⚠️ Could not notify user ${telegramId}. They may not have started the bot yet.`);
    }
    
  } catch (error) {
    console.error('Error in admin approval:', error);
    ctx.reply(`❌ Error adding credits: ${error.message}`);
  }
});

bot.command('endsupport', async (ctx) => {
  // ✅ User can end their own support session
  if (!isAdmin(ctx)) {
    const userData = userStates.get(ctx.chat.id) || {};
    delete userData.supportMode;
    userStates.set(ctx.chat.id, userData);
    await setUserSession(ctx.chat.id, { supportMode: false });
    
    return ctx.reply('✅ You have exited support mode. Use /support to start a new session.');
  }
  
  // ✅ Admin ending another user's support session
  const parts = ctx.message.text.split(' ');
  if (parts.length !== 2) {
    return ctx.reply('Usage: /endsupport <telegramId>\n\nOr users can type /endsupport themselves.');
  }

  const targetId = Number(parts[1]);
  if (isNaN(targetId)) {
    return ctx.reply('❌ Invalid Telegram ID.');
  }

  // Clear from memory
  const state = userStates.get(targetId);
  if (state?.supportMode) {
    delete state.supportMode;
    userStates.set(targetId, state);
  }
  
  // Clear from database
  await setUserSession(targetId, { supportMode: false });

  try {
    await bot.telegram.sendMessage(
      targetId,
      '✅ Your support session has been closed. Type /support to start a new one.'
    );
    ctx.reply(`✅ Support mode ended for user ${targetId}.`);
  } catch (err) {
    console.error('Failed to notify user:', err.message);
    ctx.reply(`⚠️ Support mode ended for ${targetId}, but failed to notify them.`);
  }
});

bot.command('status', async (ctx) => {
  const creditInfo = await getCredits(ctx.chat.id);
  
  let statusMsg = `🧾 *Your Status*\n\n`;
  
  if (creditInfo.isExpired) {
    statusMsg += `💰 Credits: ~~${creditInfo.amount}~~ (Expired)\n`;
    statusMsg += `📅 Expired on: ${new Date(creditInfo.expiresAt).toDateString()}\n\n`;
    statusMsg += `⚠️ Please contact /support to top up your credits.`;
  } else if (creditInfo.expiresAt) {
    const expiryDate = new Date(creditInfo.expiresAt);
    const daysLeft = Math.ceil((expiryDate - new Date()) / (1000 * 60 * 60 * 24));
    
    statusMsg += `💰 Credits: *${creditInfo.amount}*\n`;
    statusMsg += `📅 Expires: ${expiryDate.toDateString()}\n`;
    statusMsg += `⏰ Days left: *${daysLeft}*`;
  } else {
    statusMsg += `💰 Credits: ${creditInfo.amount}\n`;
    statusMsg += `📅 No expiration set`;
  }

  ctx.reply(statusMsg, { parse_mode: 'Markdown' });
});
bot.command('mydashboard', async (ctx) => {
  await createSessionIfNotExists(ctx.chat.id);

  const creditInfo = await getCredits(ctx.chat.id);

  let msg = `📊 *Your Dashboard*\n\n`;
  
  if (creditInfo.isExpired) {
    msg += `💰 Credits: ~~${creditInfo.amount}~~ *(Expired)*\n`;
    msg += `📅 Expired: ${new Date(creditInfo.expiresAt).toDateString()}\n\n`;
    msg += `⚠️ Contact /support to renew`;
  } else if (creditInfo.expiresAt) {
    const expiryDate = new Date(creditInfo.expiresAt);
    const daysLeft = Math.ceil((expiryDate - new Date()) / (1000 * 60 * 60 * 24));
    
    msg += `💰 Credits: *${creditInfo.amount}*\n`;
    msg += `📅 Expires: ${expiryDate.toDateString()}\n`;
    msg += `⏰ Days Left: *${daysLeft} day(s)*\n`;
  } else {
    msg += `💰 Credits: ${creditInfo.amount}\n`;
    msg += `📅 No expiration`;
  }

  return ctx.replyWithMarkdown(msg, { disable_web_page_preview: true });
});

// samples command - Show sample videos created by Syinth
bot.command('samples', async (ctx) => {
  try {
    await ctx.reply('🎬 *Here are some videos created with Syinth:*', { parse_mode: 'Markdown' });
    
    const samplesDir = path.join(__dirname, 'sample-videos');
    
    // Check if directory exists
    if (!fs.existsSync(samplesDir)) {
      console.warn('⚠️ sample-videos directory not found');
      return ctx.reply('⚠️ Sample videos are not available at the moment.');
    }
    
    // Get all video files
    const files = fs.readdirSync(samplesDir).filter(file => 
      file.endsWith('.mp4') || file.endsWith('.mov') || file.endsWith('.avi')
    );
    
    if (files.length === 0) {
      return ctx.reply('⚠️ No sample videos found.');
    }
    
    // Send each sample video
    for (let i = 0; i < files.length; i++) {
      const filePath = path.join(samplesDir, files[i]);
      
      try {
        await ctx.replyWithVideo(
          { source: filePath },
          {
            caption: `🎥 *Sample ${i + 1}*`,
            parse_mode: 'Markdown',
            supports_streaming: true
          }
        );
      } catch (err) {
        console.warn(`⚠️ Could not send sample video ${files[i]}:`, err.message);
      }
    }
    
    await ctx.reply(
      '✨ *Ready to create your own?*\n\n' +
      'Use /start to begin making professional videos in minutes!',
      { parse_mode: 'Markdown' }
    );
    
  } catch (error) {
    console.error('Error in /samples command:', error);
    ctx.reply('❌ An error occurred while loading samples. Please try again later.');
  }
});

// ✅ NEW: /demo command - Show tutorial video
bot.command('demo', async (ctx) => {
  await ctx.reply(
    '📚 *This is a step by step guide on how to generate videos using Syinth*\n\n' +
    '▶️ Watch the full tutorial here:\nhttps://youtu.be/7Nf3poWtzxg\n\n' +
    'Here are some use cases:\nhttps://youtube.com/@syinthofficial?si=4GuORiyXssU55LVD\n\n' +
    '✨ Ready to get started? Use /start\n' +
    '💬 Need help? Use /support',
    { 
      parse_mode: 'Markdown',
      disable_web_page_preview: false  // Shows YouTube preview in Telegram
    }
  );
});

bot.command('sendvideo', async (ctx) => {
  if (!isAdmin(ctx)) return;

  const parts = ctx.message.text.split(' ');
  if (parts.length !== 2) {
    return ctx.reply('Usage: /sendvideo <telegramId>\nThen reply with the video to this message.');
  }

  const targetId = parts[1];
  if (!/^\d+$/.test(targetId)) {
    return ctx.reply('❌ Invalid Telegram ID.');
  }

  // Save a temporary state that admin is about to send a video
 const prevState = userStates.get(ctx.chat.id) || {};
userStates.set(ctx.chat.id, {
  ...prevState,       // keep any previous data
  sendVideoTo: targetId  // add/overwrite only this field
});


  ctx.reply('📹 Now reply to this message with the video you want to send to the user.');
});

// ✅ UPDATED: Video handler with admin support reply
bot.on('video', async (ctx) => {
  const state = userStates.get(ctx.chat.id) || {};

  // ✅ FIRST: Check if admin is replying to a support message
  if (isAdmin(ctx) && ctx.message.reply_to_message) {
    const repliedMessage = ctx.message.reply_to_message;
    
    if (isSupportMessage(repliedMessage)) {
      const userId = extractUserIdFromSupportMessage(repliedMessage);
      
      if (userId) {
        try {
          const caption = ctx.message.caption || '';
          
          await bot.telegram.sendVideo(userId, ctx.message.video.file_id, {
            caption: caption ? `💬 *Support Reply:*\n${caption}` : `💬 *Support Reply:* (Video)`,
            parse_mode: 'Markdown'
          });
          
          console.log(`✅ Admin ${ctx.from.id} sent video to user ${userId}`);
          return ctx.reply('✅ Your video has been sent to the user.');
        } catch (err) {
          console.error('Failed to send video reply:', err.message);
          return ctx.reply(`❌ Could not send video. Error: ${err.message}`);
        }
      }
    }
  }

  // ✅ Handle admin replacing video for segment
  if (state?.adminReplacingMedia && isAdmin(ctx)) {
    const { jobId, segmentIndex, userId, mediaType } = state.adminReplacingMedia;
    
    if (mediaType !== 'video') {
      return ctx.reply('❌ This segment needs an image, not a video');
    }
    
    try {
      await ctx.reply('📥 Processing your video...');
      
      const video = ctx.message.video;
      
      if (video.file_size > 20 * 1024 * 1024) {
        const sizeMB = (video.file_size / (1024 * 1024)).toFixed(1);
        return ctx.reply(`❌ Video too large: ${sizeMB}MB (Max: 20MB)`);
      }
      
      const fileInfo = await ctx.telegram.getFile(video.file_id);
      const fileUrl = `https://api.telegram.org/file/bot${process.env.BOT_TOKEN}/${fileInfo.file_path}`;
      
      const response = await axios.get(fileUrl, { 
        responseType: 'arraybuffer',
        timeout: 120000,
        maxContentLength: 20 * 1024 * 1024
      });
      
      const fileBuffer = Buffer.from(response.data);
      const fileName = `jobs/${jobId}/stock-videos/admin-${segmentIndex}.mp4`;
      
      const uploadedUrl = await uploadFile(fileName, fileBuffer, 'video/mp4');
      
      await axios.post(`${WORKER_BASE_URL}/update-segment-media`, {
        jobId,
        segmentIndex,
        mediaUrl: uploadedUrl,
        mediaType: 'video',
        videoDuration: video.duration || 5,
        source: 'admin_override'
      });
      
      const segments = (await axios.get(`${WORKER_BASE_URL}/job-info/${jobId}`)).data.job.segments;
      const segmentText = segments[segmentIndex]?.text || '';
      
      await bot.telegram.sendVideo(
        userId,
        { source: fileBuffer, filename: `admin_segment_${segmentIndex + 1}.mp4` },
        {
          caption: `🎬 **Video clip for Segment ${segmentIndex + 1}/${segments.length}**\n\n` +
                  `📝 **Text:** ${segmentText.substring(0, 150)}${segmentText.length > 150 ? '...' : ''}\n\n` +
                  `❓ **Is this video suitable?**`,
          parse_mode: 'Markdown',
          supports_streaming: true,
          reply_markup: {
            inline_keyboard: [
              [
                { text: '✅ Approve', callback_data: `approve_video_${jobId}_${segmentIndex}` },
                { text: '🔄 Refetch', callback_data: `refetch_video_${jobId}_${segmentIndex}` }
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
  
  // ✅ Handle /sendvideo command
  if (state?.sendVideoTo) {
    const targetId = state.sendVideoTo;
    const fileId = ctx.message.video.file_id;

    try {
      await bot.telegram.sendVideo(targetId, fileId, {
        caption: '🎬 Here is your generated video! Enjoy!',
      });
      ctx.reply(`✅ Video sent to user ${targetId}.`);
      userStates.delete(ctx.chat.id);
    } catch (error) {
      console.error('Send video error:', error.message);
      ctx.reply(`❌ Failed to send video to ${targetId}.`);
    }
    return;
  }
  
  // ✅ Handle support mode - user sending video
  const session = await getUserSession(ctx.chat.id);
  if (state?.supportMode || session?.supportMode) {
    const userInfo = 
      `🆘 *Support Request*\n\n` +
      `👤 From: [${ctx.from.first_name}](tg://user?id=${ctx.from.id})\n` +
      `🆔 User ID: \`${ctx.from.id}\`\n` +
      `📱 Username: @${ctx.from.username || 'N/A'}\n`;
    
    try {
      const caption = ctx.message.caption || '';
      
      for (const adminId of ADMIN_IDS) {
        await bot.telegram.sendVideo(adminId, ctx.message.video.file_id, {
          caption: userInfo + `\n💬 *Message:*\n${caption || '(Video)'}`,
          parse_mode: 'Markdown'
        });
      }
      
      return ctx.reply('✅ Your video has been sent to support.');
    } catch (err) {
      console.error('Failed to forward support video:', err.message);
      return ctx.reply('❌ Failed to send video. Please try again.');
    }
  }
  
  // ✅ Default - ignore unexpected videos
  ctx.reply(
    '🎥 I received your video, but I\'m not expecting any uploads right now.\n\n' +
    'If you want to create a video, please use /start.'
  );
});

// ✅ UPDATED: Photo handler with admin support reply
bot.on('photo', async (ctx) => {
  const userData = userStates.get(ctx.chat.id) || {};

  // ✅ FIRST: Check if admin is replying to a support message
  if (isAdmin(ctx) && ctx.message.reply_to_message) {
    const repliedMessage = ctx.message.reply_to_message;
    
    if (isSupportMessage(repliedMessage)) {
      const userId = extractUserIdFromSupportMessage(repliedMessage);
      
      if (userId) {
        try {
          const photo = ctx.message.photo[ctx.message.photo.length - 1];
          const caption = ctx.message.caption || '';
          
          await bot.telegram.sendPhoto(userId, photo.file_id, {
            caption: caption ? `💬 *Support Reply:*\n${caption}` : `💬 *Support Reply:* (Image)`,
            parse_mode: 'Markdown'
          });
          
          console.log(`✅ Admin ${ctx.from.id} sent photo to user ${userId}`);
          return ctx.reply('✅ Your image has been sent to the user.');
        } catch (err) {
          console.error('Failed to send photo reply:', err.message);
          return ctx.reply(`❌ Could not send image. Error: ${err.message}`);
        }
      }
    }
  }

  // ✅ Check if admin is replacing segment media
  if (userData.adminReplacingMedia && isAdmin(ctx)) {
    const { jobId, segmentIndex, userId, mediaType } = userData.adminReplacingMedia;
    
    if (mediaType !== 'image' && mediaType !== undefined) {
      return ctx.reply('❌ This segment needs a video, not an image');
    }
    
    try {
      await ctx.reply('📥 Processing your image...');
      
      const photo = ctx.message.photo[ctx.message.photo.length - 1];
      
      const fileInfo = await ctx.telegram.getFile(photo.file_id);
      const fileUrl = `https://api.telegram.org/file/bot${process.env.BOT_TOKEN}/${fileInfo.file_path}`;
      
      const response = await axios.get(fileUrl, { 
        responseType: 'arraybuffer',
        timeout: 60000,
        maxContentLength: 20 * 1024 * 1024
      });
      
      const fileBuffer = Buffer.from(response.data);
      const fileExtension = fileInfo.file_path.split('.').pop() || 'jpg';
      const fileName = `jobs/${jobId}/images/admin-${segmentIndex}.${fileExtension}`;
      
      const uploadedUrl = await uploadFile(fileName, fileBuffer, `image/${fileExtension}`);
      
      await axios.post(`${WORKER_BASE_URL}/update-segment-media`, {
        jobId,
        segmentIndex,
        mediaUrl: uploadedUrl,
        mediaType: 'image',
        source: 'admin_override'
      });
      
      // Send to user for approval
      const jobInfo = await getJobInfo(jobId);
      const segments = jobInfo?.segments || [];
      const segmentText = segments[segmentIndex]?.text || '';
      
      await bot.telegram.sendPhoto(
        userId,
        { source: fileBuffer, filename: `segment_${segmentIndex + 1}.jpg` },
        {
          caption: `🖼️ **Image for Segment ${segmentIndex + 1}/${segments.length}**\n\n` +
                  `📝 **Text:** ${segmentText.substring(0, 150)}${segmentText.length > 150 ? '...' : ''}\n\n` +
                  `❓ **Is this image relevant?**`,
          parse_mode: 'Markdown',
          reply_markup: {
            inline_keyboard: [
              [
                { text: '✅ Approve', callback_data: `approve_segment_${jobId}_${segmentIndex}` },
                { text: '🔄 Refetch', callback_data: `refetch_segment_${jobId}_${segmentIndex}` }
              ]
            ]
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

  // ✅ Handle user uploading segment image
  if (userData.uploadingSegmentImage) {
    const { jobId, segmentIndex } = userData.uploadingSegmentImage;
    
    try {
      const jobInfo = await getJobInfo(jobId);
      if (!jobInfo) {
        return ctx.reply('❌ Invalid job ID. Please restart the process.');
      }

      const photo = ctx.message.photo[ctx.message.photo.length - 1];
      const fileId = photo.file_id;
      
      const fileInfo = await ctx.telegram.getFile(fileId);
      const fileUrl = `https://api.telegram.org/file/bot${process.env.BOT_TOKEN}/${fileInfo.file_path}`;
      
      const response = await axios.get(fileUrl, { 
        responseType: 'arraybuffer',
        timeout: 30000,
        maxContentLength: 50 * 1024 * 1024
      });
      
      if (response.data.length > 50 * 1024 * 1024) {
        return ctx.reply('❌ Image too large. Please upload images smaller than 50MB.');
      }
      
      const fileExtension = fileInfo.file_path.split('.').pop() || 'jpg';
      const fileName = `jobs/${jobId}/images/query-${segmentIndex}.${fileExtension}`;
      
      const fileBuffer = Buffer.from(response.data);
      const uploadResult = await uploadFile(fileName, fileBuffer, `image/${fileExtension}`);
      
      const updateResponse = await axios.post(`${WORKER_BASE_URL}/upload-segment-image`, {
        jobId,
        segmentIndex,
        imageUrl: uploadResult,
        fileName: fileName,
        source: 'user_upload'
      });

      if (updateResponse.data.success) {
        delete userData.uploadingSegmentImage;
        userStates.set(ctx.chat.id, userData);
        
        return ctx.reply(`✅ Image uploaded for segment ${segmentIndex + 1}! Moving to next segment...`);
      } else {
        throw new Error('Failed to update segment in database');
      }
      
    } catch (error) {
      console.error('Error uploading segment image:', error);
      
      if (error.code === 'ECONNABORTED') {
        return ctx.reply('❌ Upload timeout. Please try with a smaller image.');
      } else {
        return ctx.reply('❌ Failed to upload segment image. Please try again.');
      }
    }
  }
  
  // ✅ Handle support mode - user sending photo
  const session = await getUserSession(ctx.chat.id);
  if (userData?.supportMode || session?.supportMode) {
    const userInfo = 
      `🆘 *Support Request*\n\n` +
      `👤 From: [${ctx.from.first_name}](tg://user?id=${ctx.from.id})\n` +
      `🆔 User ID: \`${ctx.from.id}\`\n` +
      `📱 Username: @${ctx.from.username || 'N/A'}\n`;
    
    try {
      const photo = ctx.message.photo[ctx.message.photo.length - 1];
      const caption = ctx.message.caption || '';
      
      for (const adminId of ADMIN_IDS) {
        await bot.telegram.sendPhoto(adminId, photo.file_id, {
          caption: userInfo + `\n💬 *Message:*\n${caption || '(Photo)'}`,
          parse_mode: 'Markdown'
        });
      }
      
      return ctx.reply('✅ Your image has been sent to support.');
    } catch (err) {
      console.error('Failed to forward support photo:', err.message);
      return ctx.reply('❌ Failed to send image. Please try again.');
    }
  }
  
  // ✅ Default response
  ctx.reply(
    '📷 I received your image, but I\'m not expecting any uploads right now.\n\n' +
    'If you want to create a video, please use /start to begin the process.'
  );
});


// SIMPLIFIED "DONE" HANDLER - Replace your existing bot.hears(/^done$/i, async (ctx) => { block with this:
bot.hears(/^done$/i, async (ctx) => {
  // For individual segment system, "done" isn't needed since each segment is processed individually
  // Provide a helpful message
  ctx.reply('ℹ️ This command is not needed in the current system. Each image segment is processed individually when you upload it.');
});

// 4. ADD CLEANUP FUNCTION for orphaned files
async function cleanupOrphanedFiles(jobId) {
  try {
    // This would be called when a job fails or is cancelled
    // You'd need to track uploaded files and clean them up
    const filesToDelete = []; // Get from database or tracking system
    
    for (const fileName of filesToDelete) {
      try {
        await deleteFile(fileName);
        console.log(`Cleaned up orphaned file: ${fileName}`);
      } catch (error) {
        console.error(`Failed to delete orphaned file ${fileName}:`, error);
      }
    }
  } catch (error) {
    console.error('Error during cleanup:', error);
  }
}

// 5. ADD STORAGE HEALTH CHECK
async function checkStorageHealth() {
  try {
    // Test upload/download/delete cycle
    const testKey = `health_check_${Date.now()}.txt`;
    const testData = Buffer.from('Health check test');
    
    const uploadUrl = await uploadFile(testKey, testData, 'text/plain');
    console.log('✅ Storage upload test passed');
    
    const downloadUrl = await getFileUrl(testKey);
    console.log('✅ Storage URL generation test passed');
    
    await deleteFile(testKey);
    console.log('✅ Storage delete test passed');
    
    return true;
  } catch (error) {
    console.error('❌ Storage health check failed:', error);
    return false;
  }
}

// Run storage health check on startup
checkStorageHealth().then(healthy => {
  if (!healthy) {
    console.warn('⚠️  Storage system may have issues - check your R2 configuration');
  }
});

// Helper function to calculate regeneration costs
function calculateRegenerationCost(type, jobData) {
  switch (type) {
    case 'script':
      return 2; // Flat 2 credits for script regeneration
      
    case 'images':
      const segments = jobData.segments || [];
      return segments.length * 1; // 1 credit per image
      
    case 'audio':
      const duration = jobData.duration || 1;
      const isPremium = PREMIUM_VOICES.includes(jobData.voice);
      return isPremium ? duration * 8 : duration * 5; // 8 for premium, 5 for basic
      
    default:
      return 0;
  }
}
// ✅ NEW: Admin command to manually put user in support mode
bot.command('startsupport', async (ctx) => {
  if (!isAdmin(ctx)) return;
  
  const parts = ctx.message.text.split(' ');
  if (parts.length !== 2) {
    return ctx.reply('Usage: /startsupport <telegramId>\n\nThis will enable support mode for the user so they can message you.');
  }
  
  const targetId = parts[1];
  if (!/^\d+$/.test(targetId)) {
    return ctx.reply('❌ Invalid Telegram ID.');
  }
  
  try {
    // Enable support mode for user
    const userState = userStates.get(Number(targetId)) || {};
    userState.supportMode = true;
    userStates.set(Number(targetId), userState);
    await setUserSession(targetId, { supportMode: true, expectingHash: false });
    
    // Notify user
    await bot.telegram.sendMessage(
      targetId,
      '💬 *Support Mode Activated*\n\nAn admin has opened a support session with you.',
      { parse_mode: 'Markdown' }
    );
    
    ctx.reply(`✅ Support mode enabled for user ${targetId}. They have been notified.`);
  } catch (err) {
    console.error('Failed to enable support mode:', err.message);
    ctx.reply(`❌ Failed to enable support mode: ${err.message}`);
  }
});

bot.command('support', async (ctx) => {
  // ✅ Store in BOTH memory and database
  const userData = userStates.get(ctx.chat.id) || {};
  userData.supportMode = true;
  userStates.set(ctx.chat.id, userData);
  
  // Also save to database session (persists across restarts)
  await setUserSession(ctx.chat.id, { 
    supportMode: true,
    expectingHash: false  // ✅ Clear crypto expectation when entering support
  });
  
  ctx.reply(
    '💬 *Support Mode Activated*\n\n' +
    'Send your message and our team will respond shortly.',
    { parse_mode: 'Markdown' }
  );
});

bot.on('text', async (ctx) => {
  const userData = userStates.get(ctx.chat.id) || {};
  const message = ctx.message.text;

  console.log('=== TEXT HANDLER DEBUG ===');
  console.log('User ID:', ctx.chat.id);
  console.log('Message:', message.substring(0, 50));
  console.log('userData.supportMode:', userData?.supportMode);
  console.log('==========================');

  // ✅ Handle quick video JSON input (admin)
  if (userData.awaitingQuickVideo && isAdmin(ctx)) {
    await handleQuickVideoJSON(ctx, userData, message);
    return;
  }

  // ✅ Handle script editing
  if (userData.editingScript) {
    const jobId = userData.editingScript;
    try {
      const response = await axios.post(`${WORKER_BASE_URL}/update-script`, {
        jobId,
        script: message
      });
      if (response.data.success) {
        delete userData.editingScript;
        userStates.set(ctx.chat.id, userData);
        return ctx.reply('✅ Script updated and approved! Moving to next stage...');
      } else {
        return ctx.reply('❌ Failed to update script. Please try again.');
      }
    } catch (error) {
      console.error('Script update error:', error);
      return ctx.reply('❌ Failed to update script. Please try again.');
    }
  }

  // ✅ Admin replying to support message (text)
  if (isAdmin(ctx) && ctx.message.reply_to_message) {
    const repliedMessage = ctx.message.reply_to_message;
    if (isSupportMessage(repliedMessage)) {
      const userId = extractUserIdFromSupportMessage(repliedMessage);
      if (userId) {
        try {
          await bot.telegram.sendMessage(
            userId,
            `💬 *Support Reply:*\n${message}`,
            { parse_mode: 'Markdown' }
          );
          console.log(`✅ Admin ${ctx.from.id} replied to user ${userId}`);
          return ctx.reply('✅ Your reply has been sent to the user.');
        } catch (err) {
          console.error('Failed to send reply:', err.message);
          return ctx.reply(`❌ Could not deliver reply. Error: ${err.message}`);
        }
      }
    }
  }

  // ✅ Check support mode
  const session = await getUserSession(ctx.chat.id);
  const isInSupportMode = userData?.supportMode === true || session?.supportMode === true;

  console.log('Support mode check:', {
    userDataSupport: userData?.supportMode,
    sessionSupport: session?.supportMode,
    isInSupportMode
  });

  // ✅ USER IN SUPPORT MODE - Forward messages to admins
  if (isInSupportMode && !message.startsWith('/')) {
    console.log(`📨 Forwarding support message from ${ctx.chat.id} to admins`);
    const userInfo =
      `🆘 *Support Request*\n\n` +
      `👤 From: [${ctx.from.first_name}](tg://user?id=${ctx.from.id})\n` +
      `🆔 User ID: \`${ctx.from.id}\`\n` +
      `📱 Username: @${ctx.from.username || 'N/A'}\n`;
    try {
      for (const adminId of ADMIN_IDS) {
        await bot.telegram.sendMessage(adminId,
          userInfo + `\n💬 *Message:*\n${message}`,
          { parse_mode: 'Markdown' }
        );
      }
      console.log(`✅ Support message forwarded to ${ADMIN_IDS.length} admins`);
      return ctx.reply('✅ Your message has been sent to support. Please wait for a reply.');
    } catch (err) {
      console.error('Failed to forward support message:', err.message);
      return ctx.reply('❌ Failed to send message. Please try again.');
    }
  }

  // ✅ Ignore certain admin commands
  if (message === '/admin' || message === '/credit') return;

  // ✅ Skip fallbacks for command messages
if (message.startsWith('/')) return;

  // --- CAPTURE SCRIPT OR PROMPT ---
  if (userData.bufferingScript && userData.mode === 'script') {
    userData.scriptBuffer.push(message);
    userStates.set(ctx.chat.id, userData);
    setScriptTimeout(ctx, ctx.chat.id);
    console.log(`📥 Buffered script part ${userData.scriptBuffer.length} for user ${ctx.chat.id}`);
    return;
  }

  // ✅ First message for script/prompt
  if (!userData.inputText && userData.mode) {
    if (userData.mode === 'script') {
      userData.scriptBuffer = [message];
      userData.bufferingScript = true;
      userStates.set(ctx.chat.id, userData);
      setScriptTimeout(ctx, ctx.chat.id);
      console.log(`📥 Started script buffering for user ${ctx.chat.id}`);
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

  // ✅ Duration: Accept any number between 1-30 minutes
if (!userData.duration && userData.inputText) {
    const durationInput = parseInt(message);
    
    // Check if it's a valid number
    if (isNaN(durationInput)) {
      return ctx.reply(
        '⚠️ Please enter a valid number for duration (1-30 minutes).\n\n' +
        '💡 You can type any number or use the quick buttons below:',
        Markup.keyboard([
          ['1', '2', '3'],
          ['4', '5', '10'],
          ['15', '20', '30']
        ]).oneTime().resize()
      );
    }
    
    // Check if it's within valid range
    if (durationInput < 1 || durationInput > 30) {
      return ctx.reply(
        `⚠️ Duration must be between 1 and 30 minutes.\n\n` +
        `You entered: ${durationInput} minutes\n\n` +
        '💡 Please enter a valid duration:',
        Markup.keyboard([
          ['1', '2', '3'],
          ['4', '5', '10'],
          ['15', '20', '30']
        ]).oneTime().resize()
      );
    }
    
    // Valid duration - proceed
    userData.duration = durationInput;
    userStates.set(ctx.chat.id, userData);
    
    return ctx.reply(
      `✅ Duration set to ${durationInput} minute${durationInput > 1 ? 's' : ''}\n\n` +
      'Choose the video type:',
      Markup.keyboard([['Shorts', 'Reels'], ['Longform']]).oneTime().resize()
    );
  }

  // ✅ Video type
  if (!userData.videotype && ['Shorts', 'Reels', 'Longform'].includes(message)) {
  userData.videotype = message.toLowerCase();
  userStates.set(ctx.chat.id, userData);

  // Show paginated voice browser
  await showVoicePage(ctx, 0);
  
  // Then show selection keyboard
  return ctx.reply(
    '👆 Browse samples above, then choose your voice:',
    Markup.keyboard([
      ['Max', 'Ashley', 'Ava'],
      ['Roger', 'Lora', 'Cassie⭐'],
      ['Ryan⭐', 'Rachel⭐', 'Missy⭐'],
      ['Amy⭐', 'Patrick⭐', 'Andre⭐'],
      ['Stan⭐', 'Lance⭐', 'Alice⭐'],
      ['Liz⭐', 'Dave⭐', 'Candice⭐'],
      ['Autumn⭐', 'Desmond⭐', 'Charlotte⭐'],
      ['Ace⭐', 'Liam⭐', 'Keisha⭐'],
      ['Kent⭐', 'Daisy⭐', 'Lucy⭐'],
      ['Linda⭐', 'Jamal⭐', 'Sydney⭐'],
      ['Sally⭐', 'Violet⭐', 'Rhihanon⭐'],
      ['Mark⭐']
    ]).oneTime().resize()
  );
} else if (!userData.videotype && userData.inputText) {
    return ctx.reply(
      '⚠️ Please choose a video type from the options:',
      Markup.keyboard([['Shorts', 'Reels'], ['Longform']]).oneTime().resize()
    );
  }

  // ✅ Voice
  const validVoiceButtons = ['Max', 'Ashley', 'Ava', 'Roger', 'Lora', 'Cassie⭐', 'Ryan⭐', 'Rachel⭐', 'Missy⭐', 'Amy⭐', 'Patrick⭐', 'Andre⭐', 'Stan⭐', 'Lance⭐', 'Alice⭐', 'Liz⭐', 'Dave⭐', 'Candice⭐', 'Autumn⭐', 'Desmond⭐', 'Charlotte⭐', 'Ace⭐', 'Liam⭐', 'Keisha⭐', 'Kent⭐', 'Daisy⭐', 'Lucy⭐', 'Linda⭐', 'Jamal⭐', 'Sydney⭐', 'Sally⭐', 'Violet⭐', 'Rhihanon⭐', 'Mark⭐'];

 // After voice is selected
if (!userData.voice && validVoiceButtons.includes(message)) {
  userData.voice = message.replace('⭐', '').trim();
  userStates.set(ctx.chat.id, userData);
  
  return ctx.reply(
    'What type of media would you like to use?',
    Markup.keyboard([
      ['Images Only'],
      ['Videos Only'],
      ['Images + Videos']
    ]).oneTime().resize()
  );
} else if (!userData.voice && userData.videotype) {
    return ctx.reply(
      '⚠️ Please choose a voice from the options:',
      Markup.keyboard([
        ['Max', 'Ashley', 'Ava'],
        ['Roger', 'Lora', 'Cassie⭐'],
        ['Ryan⭐', 'Rachel⭐', 'Missy⭐'],
        ['Amy⭐', 'Patrick⭐', 'Andre⭐'],
        ['Stan⭐', 'Lance⭐', 'Alice⭐'],
        ['Liz⭐', 'Dave⭐', 'Candice⭐'],
        ['Autumn⭐', 'Desmond⭐', 'Charlotte⭐'],
        ['Ace⭐', 'Liam⭐', 'Keisha⭐'],
        ['Kent⭐', 'Daisy⭐', 'Lucy⭐'],
        ['Linda⭐', 'Jamal⭐', 'Sydney⭐'],
        ['Sally⭐', 'Violet⭐', 'Rhihanon⭐'],
        ['Mark⭐']
      ]).oneTime().resize()
    );
  }

 if (userData.voice && !userData.mediaType && [
  'Images Only',
  'Videos Only',
  'Images + Videos'
].includes(message)) {

  if (message === 'Images Only') {
    userData.mediaType = 'images';
  } else if (message === 'Videos Only') {
    userData.mediaType = 'videos';
  } else if (message === 'Images + Videos') {
    userData.mediaType = 'mixed';
  }

  userStates.set(ctx.chat.id, userData);

  return ctx.reply(
    'Do you want to provide the media yourself?',
    Markup.keyboard([['Yes'], ['No']]).oneTime().resize()
  );
}

  // ✅ NEW: Handle media mode selection (Yes/No)
if (userData.mediaType && !userData.mediaMode && ['Yes', 'No'].includes(message)) {
  
  // Map Yes → manual, No → auto
  if (message === 'Yes') {
    userData.mediaMode = 'manual';
  } else {
    userData.mediaMode = 'auto';
  }
  
  userStates.set(ctx.chat.id, userData);
  
  // Proceed to captions
  return ctx.reply(
    'Do you want to add captions to your video?',
    Markup.keyboard([['Yes'], ['No']]).oneTime().resize()
  );
}

  // ✅ Captions Yes/No
  if (userData.mediaMode && !userData.hasOwnProperty('addCaptions') && ['Yes', 'No'].includes(message)) {
    if (message === 'No') {
      userData.addCaptions = false;
      userStates.set(ctx.chat.id, userData);

      await showCreditBreakdown(ctx, userData);
      const deduction = await tryDeductCredits(ctx, userData);

      if (!deduction.success) {
  await ctx.reply(
    `❌ ${deduction.reason}\n\n` +
    `💰 Required: ${deduction.creditCost} credits\n` +
    `💳 You have: ${deduction.currentCredits} credits\n\n` +
    `Please contact /support to get more credits`,
    { reply_markup: { remove_keyboard: true } }
  );
  
  // Clean up state
  userStates.delete(ctx.chat.id);
  return;
}

      await confirmSubmission(
        ctx,
        `✅ Deducted ${deduction.creditCost} credit(s).\n💰 Remaining: ${deduction.remaining}\n\n🎬 Processing your video...`
      );

      const submitted = await submitVideoJob(ctx, userData);
      if (!submitted) return;
      userStates.delete(ctx.chat.id);
      return;

    } else {
  userData.addCaptions = true;
  userStates.set(ctx.chat.id, userData);

  // Show paginated caption browser
  await showCaptionPage(ctx, 0);
  
  // Then show selection keyboard
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
  } else if (userData.mediaMode && !userData.hasOwnProperty('addCaptions')) {
    return ctx.reply(
      '⚠️ Please choose Yes or No:',
      Markup.keyboard([['Yes'], ['No']]).oneTime().resize()
    );
  }

  // ✅ Caption style
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
    `🚫 You need ${deduction.creditCost} credit(s) but only have ${deduction.currentCredits}.\n\n` +
    `Please contact /support to top up your credits.`,
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

  } else if (userData.addCaptions && !userData.captionStyle) {
    return ctx.reply(
      '⚠️ Please choose a caption style from the options:',
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

  // ✅ NEW: Media mode fallback
if (userData.mediaType && !userData.mediaMode && !message.startsWith('/') && !isInSupportMode) {
  return ctx.reply(
    '⚠️ Please answer: Do you want to provide the media yourself?',
    Markup.keyboard([['Yes'], ['No']]).oneTime().resize()
  );
}

// ✅ NEW: Media type fallback  
if (userData.voice && !userData.mediaType && !message.startsWith('/') && !isInSupportMode) {
  return ctx.reply(
    '⚠️ Please choose a media type:',
    Markup.keyboard([
      ['Images Only'],
      ['Videos Only'],
      ['Images + Videos']
    ]).oneTime().resize()
  );
}

  // ✅ Content flow fallback (very first step)
   if (
    !userData.content_flow &&
    !message.startsWith('/') &&
    !isInSupportMode &&
    Object.keys(userData).length > 0
  ) {
    return ctx.reply(
      '⚠️ Please choose a video type to get started:',
      Markup.keyboard([['📰 Essay Styled Videos'], ['📋 Listicle Videos']]).oneTime().resize()
    );
  }
  // ✅ Script/Prompt mode fallback
  if (userData.content_flow && !userData.mode && !message.startsWith('/') && !isInSupportMode) {
    return ctx.reply(
      '⚠️ Please choose how you would like to begin:',
      Markup.keyboard([['📝 Script'], ['💡 Prompt']]).oneTime().resize()
    );
  }

});

module.exports = {
  bot,
  calculateRegenerationCost,
  notifyScriptForReview,                       
  notifySegmentImageForReview,
  notifySegmentUploadRequest,
  notifyAllImagesComplete,
  notifyAudioForReview,            
  notifyVideoComplete
};
