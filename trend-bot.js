// trend-bot.js
// All Telegram bot handlers for the Trending Topics feature.
// Exported as a setup function and called from telegram-bot.js.

const { Markup } = require('telegraf');
const axios = require('axios');

const {
  initTrendTables,
  createSubniche,
  getSubnicheById,
  getAllSubniches,
  getChannelsForSubniche,
  addChannel,
  isCachedToday,
  isFetchInProgress,
  getCachedTrending,
} = require('./trend-db');

const {
  fetchAndCacheTrending,
  resolveChannel,
} = require('./trend-fetcher');

// ─────────────────────────────────────────────
// State keys used in the shared userStates Map
// (passed in from telegram-bot.js)
// ─────────────────────────────────────────────
// userStates.get(chatId).trendFlow = {
//   step: 'name' | 'content_type' | 'channels' | 'visibility'
//   name: string
//   content_type: 'videos' | 'shorts'
//   channels: string[]          -- raw inputs from user
//   resolvedChannels: object[]  -- after resolution
//   subniche_id: number         -- set after subniche created
// }

// ─────────────────────────────────────────────
// Formatting helpers
// ─────────────────────────────────────────────

function formatViralScore(score) {
  if (score >= 10) return '🔥🔥🔥 ' + score.toFixed(1) + 'x';
  if (score >= 5)  return '🔥🔥 '   + score.toFixed(1) + 'x';
  if (score >= 2)  return '🔥 '     + score.toFixed(1) + 'x';
  return '📈 ' + score.toFixed(1) + 'x';
}

function formatDuration(seconds) {
  if (!seconds || seconds === 0) return 'N/A';
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${s.toString().padStart(2, '0')}`;
}

function buildTrendingItemMessage(item, rank, total) {
  const scoreLabel = formatViralScore(item.viral_score);
  const duration   = item.is_short ? '📱 Short' : `⏱ ${formatDuration(item.duration_seconds)}`;

  return (
    `*#${rank} of ${total}*\n\n` +
    `📺 *${escapeMarkdown(item.title)}*\n\n` +
    `${scoreLabel} above channel average\n` +
    `👁 ${item.view_count_text || item.view_count.toLocaleString()} views\n` +
    `📅 ${item.published_time_text}\n` +
    `${duration}\n` +
    `📢 Channel: ${escapeMarkdown(item.channel_name)}\n\n` +
    `💡 *Baseline for this channel:* ${Number(item.channel_baseline).toLocaleString()} views`
  );
}

function escapeMarkdown(text) {
  if (!text) return '';
  return text.replace(/([_*[\]()~`>#+\-=|{}.!\\])/g, '\\$1');
}

// ─────────────────────────────────────────────
// Paginated subniche list keyboard
// ─────────────────────────────────────────────
function buildSubnicheKeyboard(subniches, page = 0, pageSize = 5) {
  const start   = page * pageSize;
  const slice   = subniches.slice(start, start + pageSize);
  const hasNext = start + pageSize < subniches.length;
  const hasPrev = page > 0;

  const rows = slice.map(s => [{
    text:          `${s.content_type === 'shorts' ? '📱' : '🎬'} ${s.name} (${s.channel_count} channels)`,
    callback_data: `trend_view_${s.id}_0`   // second param = result page index
  }]);

  const navRow = [];
  if (hasPrev) navRow.push({ text: '◀️ Prev', callback_data: `trend_list_${page - 1}` });
  navRow.push({ text: `${page + 1}/${Math.ceil(subniches.length / pageSize)}`, callback_data: 'noop' });
  if (hasNext) navRow.push({ text: 'Next ▶️', callback_data: `trend_list_${page + 1}` });

  if (navRow.length > 0) rows.push(navRow);

  rows.push([{ text: '➕ Create My Own Template', callback_data: 'trend_create' }]);

  return { inline_keyboard: rows };
}

// ─────────────────────────────────────────────
// Trending results navigation keyboard
// ─────────────────────────────────────────────
function buildResultKeyboard(item, currentIndex, total, subniche_id) {
  const rows = [];

  // Create video button — passes the video title as the prompt seed
  rows.push([{
    text:          '🎬 Create Video About This',
    callback_data: `trend_create_video_${item.video_id}_${subniche_id}`
  }]);

  // Navigation
  const navRow = [];
  if (currentIndex > 0) {
    navRow.push({
      text:          '◀️ Prev',
      callback_data: `trend_view_${subniche_id}_${currentIndex - 1}`
    });
  }
  navRow.push({
    text:          `${currentIndex + 1}/${total}`,
    callback_data: 'noop'
  });
  if (currentIndex < total - 1) {
    navRow.push({
      text:          'Next ▶️',
      callback_data: `trend_view_${subniche_id}_${currentIndex + 1}`
    });
  }
  if (navRow.length > 0) rows.push(navRow);

  // Back to subniche list
  rows.push([{ text: '🔙 Back to Templates', callback_data: 'trend_list_0' }]);

  return { inline_keyboard: rows };
}

// ─────────────────────────────────────────────
// Main setup function — call this from
// telegram-bot.js passing the bot instance
// and the shared userStates Map
// ─────────────────────────────────────────────
function setupTrendBot(bot, userStates) {

  // ── /trends command and button entry point ──────────────────────
  async function showTrendingHome(ctx) {
    const chatId    = ctx.chat?.id || ctx.from?.id;
    const subniches = await getAllSubniches(chatId);

    if (subniches.length === 0) {
      const message =
        `📈 *Trending Topics Finder*\n\n` +
        `No templates yet\\.\n\n` +
        `Create your first template by submitting competitor channel URLs\\. ` +
        `The bot will monitor those channels and surface their viral videos for you to recreate\\.`;

      const keyboard = {
        inline_keyboard: [[
          { text: '➕ Create My First Template', callback_data: 'trend_create' }
        ]]
      };

      if (ctx.callbackQuery) {
        await ctx.editMessageText(message, {
          parse_mode:   'MarkdownV2',
          reply_markup: keyboard
        });
      } else {
        await ctx.reply(message, {
          parse_mode:   'MarkdownV2',
          reply_markup: keyboard
        });
      }
      return;
    }

    const message =
      `📈 *Trending Topics Finder*\n\n` +
      `Choose a template to see what's trending, or create your own tracker\\.\n\n` +
      `🎬 = Longform videos  📱 = Shorts`;

    const keyboard = buildSubnicheKeyboard(subniches, 0);

    if (ctx.callbackQuery) {
      await ctx.editMessageText(message, {
        parse_mode:   'MarkdownV2',
        reply_markup: keyboard
      });
    } else {
      await ctx.reply(message, {
        parse_mode:   'MarkdownV2',
        reply_markup: keyboard
      });
    }
  }

  bot.command('trends', async (ctx) => {
    await showTrendingHome(ctx);
  });

  // ── Subniche list pagination ────────────────────────────────────
  bot.action(/^trend_list_(\d+)$/, async (ctx) => {
    await ctx.answerCbQuery();
    const page      = parseInt(ctx.match[1]);
    const chatId    = ctx.from.id;
    const subniches = await getAllSubniches(chatId);

    if (subniches.length === 0) {
      return showTrendingHome(ctx);
    }

    const message =
      `📈 *Trending Topics Finder*\n\n` +
      `Choose a template to see what's trending, or create your own tracker\\.\n\n` +
      `🎬 = Longform videos  📱 = Shorts`;

    await ctx.editMessageText(message, {
      parse_mode:   'MarkdownV2',
      reply_markup: buildSubnicheKeyboard(subniches, page)
    });
  });

  // ── View trending results for a subniche ───────────────────────
  bot.action(/^trend_view_(\d+)_(\d+)$/, async (ctx) => {
  await ctx.answerCbQuery('Loading...');

  const subniche_id = parseInt(ctx.match[1]);
  const resultIndex = parseInt(ctx.match[2]);
  const chatId      = ctx.from.id;

  const subniche = await getSubnicheById(subniche_id);
  if (!subniche) {
    return ctx.answerCbQuery('Template not found', true);
  }

  // ── Deduct 5 credits before doing anything ─────────────────────
  // Applies whether results come from cache or a fresh fetch.
  // Navigation between results (Next/Prev) does NOT re-charge —
  // only the initial view trigger (resultIndex === 0) costs credits.
  if (resultIndex === 0) {
    const { getCredits, useCredits } = require('./credits');
    const TREND_CREDIT_COST = 5;

    const creditInfo     = await getCredits(chatId);
    const currentCredits = typeof creditInfo === 'object'
      ? creditInfo.amount
      : creditInfo;

    if (currentCredits < TREND_CREDIT_COST) {
      await ctx.editMessageText(
        `❌ *Insufficient Credits*\n\n` +
        `Viewing trending topics costs *${TREND_CREDIT_COST} credits* per request.\n` +
        `You have: *${currentCredits} credit(s)*\n\n` +
        `Contact /support to top up.`,
        {
          parse_mode:   'Markdown',
          reply_markup: {
            inline_keyboard: [[
              { text: '🔙 Back to Templates', callback_data: 'trend_list_0' }
            ]]
          }
        }
      );
      return;
    }

    const deduction = await useCredits(chatId, TREND_CREDIT_COST);
    if (!deduction.success) {
      await ctx.editMessageText(
        `❌ *Could not deduct credits*\n\n${deduction.reason}\n\nContact /support.`,
        {
          parse_mode:   'Markdown',
          reply_markup: {
            inline_keyboard: [[
              { text: '🔙 Back to Templates', callback_data: 'trend_list_0' }
            ]]
          }
        }
      );
      return;
    }

    console.log(
      `💰 [trend-bot] ${TREND_CREDIT_COST} credits deducted from user ${chatId} ` +
      `for trending view — subniche ${subniche_id} | remaining: ${deduction.remaining}`
    );
  }

  // ── Check cache state ─────────────────────────────────────────
  const cached = await isCachedToday(subniche_id);

  if (!cached) {
    const inProgress = await isFetchInProgress(subniche_id);

    if (inProgress) {
      await ctx.editMessageText(
        `⏳ *Fetching trending videos for "${escapeMarkdown(subniche.name)}"\\.\\.\\.*\n\n` +
        `Someone else triggered a fetch moments ago\\. ` +
        `Results will be ready in about a minute\\. ` +
        `Tap below to check again\\.\n\n` +
        `_Note: checking again will not charge another 5 credits\\._`,
        {
          parse_mode:   'MarkdownV2',
          reply_markup: {
            inline_keyboard: [[
              // resultIndex 1 here so the re-check doesn't charge again
              { text: '🔄 Check Again', callback_data: `trend_recheck_${subniche_id}` },
              { text: '🔙 Back',        callback_data: 'trend_list_0'                  }
            ]]
          }
        }
      );
      return;
    }

    // No cache — trigger fresh fetch
    await ctx.editMessageText(
      `🔍 *Fetching trending videos for "${escapeMarkdown(subniche.name)}"\\.\\.\\.*\n\n` +
      `Scanning ${subniche.channel_count} competitor channel(s) for viral content ` +
      `from the last 30 days\\. This takes about 30\\-60 seconds\\.`,
      { parse_mode: 'MarkdownV2' }
    );

    try {
      await fetchAndCacheTrending(subniche_id, chatId);
    } catch (fetchErr) {
      console.error(
        `❌ [trend-bot] Fetch failed for subniche ${subniche_id}:`,
        fetchErr.message
      );

      // Fetch failed — refund the 5 credits since user got nothing
      try {
        const { setCredits } = require('./credits');
        await setCredits(
          String(chatId),
          5,
          `refund_trend_${subniche_id}_${Date.now()}`,
          'trend_fetch_failed'
        );
        console.log(`💰 [trend-bot] Refunded 5 credits to user ${chatId} — fetch failed`);
      } catch (refundErr) {
        console.error(`❌ [trend-bot] Refund failed:`, refundErr.message);
      }

      await ctx.editMessageText(
        `❌ *Failed to fetch trending videos*\n\n` +
        `Error: ${escapeMarkdown(fetchErr.message)}\n\n` +
        `Your 5 credits have been refunded\\.\n\n` +
        `Please try again or contact /support`,
        {
          parse_mode:   'MarkdownV2',
          reply_markup: {
            inline_keyboard: [[
              { text: '🔄 Try Again', callback_data: `trend_view_${subniche_id}_0` },
              { text: '🔙 Back',      callback_data: 'trend_list_0'                }
            ]]
          }
        }
      );
      return;
    }
  }

  // ── Serve results ─────────────────────────────────────────────
  const results = await getCachedTrending(subniche_id, 20);

  if (results.length === 0) {
    await ctx.editMessageText(
      `😕 *No trending videos found for "${escapeMarkdown(subniche.name)}"*\n\n` +
      `None of the tracked channels posted videos in the last 30 days that ` +
      `exceeded their baseline performance\\.\n\n` +
      `Try again tomorrow when new videos have been posted\\.`,
      {
        parse_mode:   'MarkdownV2',
        reply_markup: {
          inline_keyboard: [[
            { text: '🔙 Back to Templates', callback_data: 'trend_list_0' }
          ]]
        }
      }
    );
    return;
  }

  const safeIndex = Math.min(resultIndex, results.length - 1);
  const item      = results[safeIndex];
  const message   = buildTrendingItemMessage(item, safeIndex + 1, results.length);
  const keyboard  = buildResultKeyboard(item, safeIndex, results.length, subniche_id);

  try {
    await ctx.editMessageText(message, {
      parse_mode:   'Markdown',
      reply_markup: keyboard
    });
  } catch (editErr) {
    await ctx.reply(message, {
      parse_mode:   'Markdown',
      reply_markup: keyboard
    });
  }
});

  // No credit charge on recheck — user already paid
bot.action(/^trend_recheck_(\d+)$/, async (ctx) => {
  await ctx.answerCbQuery('Checking...');

  const subniche_id = parseInt(ctx.match[1]);
  const subniche    = await getSubnicheById(subniche_id);
  if (!subniche) return ctx.answerCbQuery('Template not found', true);

  const cached     = await isCachedToday(subniche_id);
  const inProgress = await isFetchInProgress(subniche_id);

  if (!cached && inProgress) {
    // Still running — tell them to wait a bit more
    await ctx.answerCbQuery('Still fetching, please wait a moment...', true);
    return;
  }

  if (!cached && !inProgress) {
    // Fetch crashed without completing — show error
    await ctx.editMessageText(
      `❌ *Fetch did not complete*\n\n` +
      `Something went wrong during the fetch\\. ` +
      `Please tap Try Again — your original 5 credits were refunded\\.`,
      {
        parse_mode:   'MarkdownV2',
        reply_markup: {
          inline_keyboard: [[
            { text: '🔄 Try Again', callback_data: `trend_view_${subniche_id}_0` },
            { text: '🔙 Back',      callback_data: 'trend_list_0'                }
          ]]
        }
      }
    );
    return;
  }

  // Cache is ready — show results (no charge, use index 1 to skip credit block)
  const results = await getCachedTrending(subniche_id, 20);
  if (results.length === 0) {
    await ctx.editMessageText(
      `😕 *No trending videos found*\n\nTry again tomorrow\\.`,
      {
        parse_mode:   'MarkdownV2',
        reply_markup: {
          inline_keyboard: [[
            { text: '🔙 Back to Templates', callback_data: 'trend_list_0' }
          ]]
        }
      }
    );
    return;
  }

  const item    = results[0];
  const message = buildTrendingItemMessage(item, 1, results.length);
  const keyboard = buildResultKeyboard(item, 0, results.length, subniche_id);

  try {
    await ctx.editMessageText(message, {
      parse_mode:   'Markdown',
      reply_markup: keyboard
    });
  } catch (e) {
    await ctx.reply(message, {
      parse_mode:   'Markdown',
      reply_markup: keyboard
    });
  }
});
  // ── Create video from trending topic ───────────────────────────
  bot.action(/^trend_create_video_(.+)_(\d+)$/, async (ctx) => {
    await ctx.answerCbQuery('Loading video details...');

    const video_id    = ctx.match[1];
    const subniche_id = parseInt(ctx.match[2]);
    const chatId      = ctx.from.id;

    // Get the cached item so we have the title
    const results = await getCachedTrending(subniche_id, 20);
    const item    = results.find(r => r.video_id === video_id);

    if (!item) {
      await ctx.answerCbQuery('Video details not found', true);
      return;
    }

    // Pre-seed the user's state for the video creation flow
    // This drops them into the existing flow with the topic pre-filled
    const userData = userStates.get(chatId) || {};
    userData.topLevelFlow  = 'video';
    userData.trendSeed     = {
      title:      item.title,
      video_id:   item.video_id,
      channel:    item.channel_name,
      viral_score: item.viral_score,
    };
    userStates.set(chatId, userData);

    const prompt =
      `📈 *Trending Topic Detected*\n\n` +
      `*"${item.title}"*\n\n` +
      `${formatViralScore(item.viral_score)} above channel average on *${item.channel_name}*\n` +
      `👁 ${item.view_count_text} views | 📅 ${item.published_time_text}\n\n` +
      `Choose how you want to create your video about this topic:`;

    await ctx.editMessageText(prompt, {
      parse_mode:   'Markdown',
      reply_markup: {
        inline_keyboard: [
          [{
            text:          '✍️ Write My Own Script',
            callback_data: `trend_use_script_${video_id}`
          }],
          [{
            text:          '🤖 Generate Script from Title',
            callback_data: `trend_use_prompt_${video_id}`
          }],
          [{
            text:          '🔙 Back to Results',
            callback_data: `trend_view_${subniche_id}_0`
          }]
        ]
      }
    });
  });

  // ── Use trending topic as prompt ────────────────────────────────
  bot.action(/^trend_use_prompt_(.+)$/, async (ctx) => {
    await ctx.answerCbQuery();
    const chatId   = ctx.from.id;
    const userData = userStates.get(chatId) || {};

    if (!userData.trendSeed) {
      return ctx.answerCbQuery('Session expired. Please start again.', true);
    }

    // Set mode to prompt, use the video title as the prompt
    userData.mode      = 'prompt';
    userData.inputText = `Create a video about: "${userData.trendSeed.title}"`;
    userStates.set(chatId, userData);

    await ctx.editMessageText(
      `✅ *Topic set as prompt:*\n\n_"${userData.trendSeed.title}"_\n\n` +
      `Now choose your content flow:`,
      {
        parse_mode:   'Markdown',
        reply_markup: {
          inline_keyboard: [
            [{ text: '📰 Essay Styled Video', callback_data: 'trend_flow_news'     }],
            [{ text: '📋 Listicle Video',      callback_data: 'trend_flow_listicle' }],
          ]
        }
      }
    );
  });

  // ── Use trending topic — user will write own script ─────────────
  bot.action(/^trend_use_script_(.+)$/, async (ctx) => {
    await ctx.answerCbQuery();
    const chatId   = ctx.from.id;
    const userData = userStates.get(chatId) || {};

    if (!userData.trendSeed) {
      return ctx.answerCbQuery('Session expired. Please start again.', true);
    }

    userData.mode            = 'script';
    userData.awaitingTrendScript = true;
    userStates.set(chatId, userData);

    await ctx.editMessageText(
      `✍️ *Write your script about:*\n\n_"${userData.trendSeed.title}"_\n\n` +
      `Send your script now. You can send it in multiple messages — ` +
      `tap *Done* or wait 15 seconds after your last message.`,
      {
        parse_mode: 'Markdown',
        reply_markup: { remove_keyboard: true }
      }
    );

    await ctx.reply(
      'Send your script:',
      Markup.keyboard([['❌ Cancel']]).oneTime().resize()
    );
  });

  // ── Flow selection after prompt seeding ────────────────────────
  bot.action(/^trend_flow_(news|listicle)$/, async (ctx) => {
    await ctx.answerCbQuery();
    const chatId      = ctx.from.id;
    const userData    = userStates.get(chatId) || {};
    const contentFlow = ctx.match[1];

    userData.content_flow = contentFlow;
    userStates.set(chatId, userData);

    // Hand off to the existing duration step
    await ctx.reply(
      `✅ *${contentFlow === 'listicle' ? 'Listicle' : 'Essay Styled'} video selected!*\n\n` +
      `How long should the video be?`,
      {
        parse_mode: 'Markdown',
        ...Markup.keyboard([['1', '2', '3'], ['4', '5']]).oneTime().resize()
      }
    );
  });

  // ── Start template creation flow ────────────────────────────────
  bot.action('trend_create', async (ctx) => {
    await ctx.answerCbQuery();
    const chatId   = ctx.from.id;
    const userData = userStates.get(chatId) || {};

    userData.trendFlow = { step: 'name', channels: [] };
    userStates.set(chatId, userData);

    await ctx.editMessageText(
      `➕ *Create a Trending Template*\n\n` +
      `What is this template tracking?\n\n` +
      `*Examples:*\n` +
      `• Celebrity Drama\n` +
      `• Nollywood Gossip\n` +
      `• Music Industry Beef\n` +
      `• Reality TV Highlights\n\n` +
      `Type a name for your template:`,
      { parse_mode: 'Markdown' }
    );
  });

  // ── Text handler for template creation flow ─────────────────────
  // This is exported and called from telegram-bot.js's text handler
  // at the TOP of the handler before other checks (high priority).
  async function handleTrendFlowText(ctx, userData, message) {
    const chatId    = ctx.chat.id;
    const trendFlow = userData.trendFlow;

    if (!trendFlow) return false; // not in trend flow

    // ── Step 1: Collect template name ───────────────────────────
    if (trendFlow.step === 'name') {
      const name = message.trim();

      if (name.length < 2) {
        await ctx.reply('⚠️ Name too short. Please enter a descriptive name:');
        return true;
      }
      if (name.length > 60) {
        await ctx.reply('⚠️ Name too long (max 60 characters). Try a shorter name:');
        return true;
      }

      trendFlow.name = name;
      trendFlow.step = 'content_type';
      userStates.set(chatId, userData);

      await ctx.reply(
        `✅ *"${name}"*\n\nWhat type of content do you want to track?`,
        {
          parse_mode:   'Markdown',
          reply_markup: {
            inline_keyboard: [
              [{ text: '🎬 Longform Videos', callback_data: 'trend_type_videos' }],
              [{ text: '📱 Shorts',           callback_data: 'trend_type_shorts' }],
            ]
          }
        }
      );
      return true;
    }

    // ── Step 3: Collect channel URLs ────────────────────────────
    if (trendFlow.step === 'channels') {
      const input = message.trim();

      // Check for done signals
      if (['done', '/done', '✅ done'].includes(input.toLowerCase())) {
        return await finishChannelCollection(ctx, userData, chatId);
      }

      if (trendFlow.channels.length >= 20) {
        await ctx.reply(
          '⚠️ Maximum 20 channels per template. Type *Done* to finish.',
          { parse_mode: 'Markdown' }
        );
        return true;
      }

      // Extract channel identifier from the input
      // Accepts: full URL, @handle, UC... ID
      const channelInput = extractChannelId(input);

      if (!channelInput) {
        await ctx.reply(
          `⚠️ Couldn't parse that as a YouTube channel.\n\n` +
          `Please send:\n` +
          `• A full URL: \`https://www.youtube.com/@ChannelName\`\n` +
          `• A handle: \`@ChannelName\`\n` +
          `• A channel ID: \`UCxxxxxxxxxxxxxxxx\``,
          { parse_mode: 'Markdown' }
        );
        return true;
      }

      // Check for duplicate in this session
      if (trendFlow.channels.includes(channelInput)) {
        await ctx.reply(`⚠️ Already added: \`${channelInput}\``, { parse_mode: 'Markdown' });
        return true;
      }

      // Resolve the channel to get its name
      await ctx.reply('🔍 Resolving channel...');

      const resolved = await resolveChannel(channelInput);

      trendFlow.channels.push(channelInput);
      if (!trendFlow.resolvedChannels) trendFlow.resolvedChannels = [];
      trendFlow.resolvedChannels.push({
        channel_id:        channelInput,
        resolved_id:       resolved.resolved_id,
        channel_name:      resolved.channel_name,
        channel_thumbnail: resolved.channel_thumbnail,
      });

      userStates.set(chatId, userData);

      const count = trendFlow.channels.length;
      await ctx.reply(
        `✅ *Added: ${resolved.channel_name}*\n\n` +
        `Channels so far: ${count}/20\n\n` +
        `Send another channel URL, or type *Done* to finish:`,
        {
          parse_mode:   'Markdown',
          reply_markup: {
            inline_keyboard: [[
              { text: '✅ Done — Save Template', callback_data: 'trend_channels_done' }
            ]]
          }
        }
      );
      return true;
    }

    return false; // not handled here
  }

  // ── Content type selection ──────────────────────────────────────
  bot.action(/^trend_type_(videos|shorts)$/, async (ctx) => {
    await ctx.answerCbQuery();
    const chatId      = ctx.from.id;
    const userData    = userStates.get(chatId) || {};
    const trendFlow   = userData.trendFlow;

    if (!trendFlow || trendFlow.step !== 'content_type') {
      return ctx.answerCbQuery('Session expired', true);
    }

    trendFlow.content_type = ctx.match[1];
    trendFlow.step         = 'channels';
    userStates.set(chatId, userData);

    await ctx.editMessageText(
      `✅ Tracking: *${trendFlow.content_type === 'shorts' ? '📱 Shorts' : '🎬 Longform Videos'}*\n\n` +
      `Now send me competitor channel URLs, one at a time.\n\n` +
      `*Accepted formats:*\n` +
      `• \`https://www.youtube.com/@ChannelName\`\n` +
      `• \`@ChannelName\`\n` +
      `• \`UCxxxxxxxxxxxxxxxx\`\n\n` +
      `You can add up to 20 channels. Type *Done* or tap the button when finished.`,
      {
        parse_mode:   'Markdown',
        reply_markup: {
          inline_keyboard: [[
            { text: '✅ Done — Save Template', callback_data: 'trend_channels_done' }
          ]]
        }
      }
    );
  });

  // ── Done button during channel collection ───────────────────────
  bot.action('trend_channels_done', async (ctx) => {
    await ctx.answerCbQuery();
    const chatId   = ctx.from.id;
    const userData = userStates.get(chatId) || {};
    await finishChannelCollection(ctx, userData, chatId);
  });

  // ── Visibility selection ────────────────────────────────────────
  bot.action(/^trend_visibility_(public|private)$/, async (ctx) => {
    await ctx.answerCbQuery();
    const chatId     = ctx.from.id;
    const userData   = userStates.get(chatId) || {};
    const trendFlow  = userData.trendFlow;
    const is_public  = ctx.match[1] === 'public';

    if (!trendFlow || !trendFlow.name) {
      return ctx.answerCbQuery('Session expired', true);
    }

    try {
      // Create the subniche
      const subniche = await createSubniche({
        name:         trendFlow.name,
        content_type: trendFlow.content_type || 'videos',
        created_by:   chatId,
        is_public,
      });

      // Add all resolved channels
      const resolved = trendFlow.resolvedChannels || [];
      for (const ch of resolved) {
        await addChannel({
          subniche_id:       subniche.id,
          channel_id:        ch.channel_id,
          resolved_id:       ch.resolved_id,
          channel_name:      ch.channel_name,
          channel_thumbnail: ch.channel_thumbnail,
          added_by:          chatId,
        });
      }

      // Clear trend flow state
      delete userData.trendFlow;
      userStates.set(chatId, userData);

      const channelList = resolved
        .map(ch => `• ${ch.channel_name}`)
        .join('\n');

      await ctx.editMessageText(
        `🎉 *Template Created!*\n\n` +
        `📋 *Name:* ${trendFlow.name}\n` +
        `${trendFlow.content_type === 'shorts' ? '📱 Shorts' : '🎬 Longform'}\n` +
        `${is_public ? '🌍 Public' : '🔒 Private'}\n\n` +
        `*Channels tracked (${resolved.length}):*\n${channelList}\n\n` +
        `Tap below to see what's trending now:`,
        {
          parse_mode:   'Markdown',
          reply_markup: {
            inline_keyboard: [
              [{ text: '🔥 See Trending Now', callback_data: `trend_view_${subniche.id}_0` }],
              [{ text: '📈 All Templates',    callback_data: 'trend_list_0'               }],
            ]
          }
        }
      );

    } catch (err) {
      console.error('❌ [trend-bot] Error creating subniche:', err.message);
      await ctx.editMessageText(
        `❌ *Failed to create template*\n\nError: ${err.message}\n\nPlease try again.`,
        { parse_mode: 'Markdown' }
      );
    }
  });

  // Return the text handler so telegram-bot.js can call it
   return { handleTrendFlowText, showTrendingHome };
}

// ─────────────────────────────────────────────
// Helper — finish channel collection step
// ─────────────────────────────────────────────
async function finishChannelCollection(ctx, userData, chatId) {
  const trendFlow = userData.trendFlow;

  if (!trendFlow.resolvedChannels || trendFlow.resolvedChannels.length === 0) {
    const msg = '⚠️ You need to add at least one channel before saving.';
    if (ctx.callbackQuery) {
      await ctx.answerCbQuery(msg, true);
    } else {
      await ctx.reply(msg);
    }
    return true;
  }

  // ── No visibility step — save immediately as public ──────────────
  try {
    const subniche = await createSubniche({
      name:         trendFlow.name,
      content_type: trendFlow.content_type || 'videos',
      created_by:   chatId,
    });

    for (const ch of trendFlow.resolvedChannels) {
      await addChannel({
        subniche_id:       subniche.id,
        channel_id:        ch.channel_id,
        resolved_id:       ch.resolved_id,
        channel_name:      ch.channel_name,
        channel_thumbnail: ch.channel_thumbnail,
        added_by:          chatId,
      });
    }

    delete userData.trendFlow;
    userStates.set(chatId, userData);

    const channelList = trendFlow.resolvedChannels
      .map(ch => `• ${ch.channel_name}`)
      .join('\n');

    const summaryText =
      `🎉 *Template Created!*\n\n` +
      `📋 *Name:* ${trendFlow.name}\n` +
      `*Type:* ${trendFlow.content_type === 'shorts' ? '📱 Shorts' : '🎬 Longform'}\n` +
      `🌍 Public — visible to all users\n\n` +
      `*Channels tracked (${trendFlow.resolvedChannels.length}):*\n${channelList}\n\n` +
      `Tap below to see what's trending now:`;

    const keyboard = {
      inline_keyboard: [
        [{ text: '🔥 See Trending Now', callback_data: `trend_view_${subniche.id}_0` }],
        [{ text: '📈 All Templates',    callback_data: 'trend_list_0'               }],
      ]
    };

    if (ctx.callbackQuery) {
      await ctx.editMessageText(summaryText, { parse_mode: 'Markdown', reply_markup: keyboard });
    } else {
      await ctx.reply(summaryText, { parse_mode: 'Markdown', reply_markup: keyboard });
    }

  } catch (err) {
    console.error('❌ [trend-bot] Error creating subniche:', err.message);
    const errorText = `❌ *Failed to create template*\n\nError: ${err.message}\n\nPlease try again.`;
    if (ctx.callbackQuery) {
      await ctx.editMessageText(errorText, { parse_mode: 'Markdown' });
    } else {
      await ctx.reply(errorText, { parse_mode: 'Markdown' });
    }
  }

  return true;
}
// ─────────────────────────────────────────────
// Extract a usable channel identifier from
// various input formats users might send
// ─────────────────────────────────────────────
function extractChannelId(input) {
  if (!input) return null;
  const s = input.trim();

  // Full YouTube URL
  // https://www.youtube.com/@handle
  // https://www.youtube.com/channel/UCxxx
  // https://www.youtube.com/c/customname
  // https://www.youtube.com/user/username
  const urlPatterns = [
    /youtube\.com\/@([\w.-]+)/i,
    /youtube\.com\/channel\/(UC[\w-]+)/i,
    /youtube\.com\/c\/([\w.-]+)/i,
    /youtube\.com\/user\/([\w.-]+)/i,
  ];

  for (const pattern of urlPatterns) {
    const match = s.match(pattern);
    if (match) {
      // Re-add @ for handle-style, keep as-is for UC IDs
      return match[1].startsWith('UC') ? match[1] : `@${match[1]}`;
    }
  }

  // @handle directly
  if (s.startsWith('@') && s.length > 1) return s;

  // UC... channel ID directly
  if (/^UC[\w-]{20,}$/.test(s)) return s;

  return null;
}

module.exports = { setupTrendBot, initTrendTables };
