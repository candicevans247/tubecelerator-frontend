// trend-fetcher.js
const axios = require('axios');
require('dotenv').config();

const {
  getChannelsForSubniche,
  getSubnicheById,
  startFetchLog,
  completeFetchLog,
  failFetchLog,
  saveTrendingResults,
} = require('./trend-db');

const SCRAPEBADGER_API_KEY  = process.env.SCRAPEBADGER_API_KEY;
const SCRAPEBADGER_BASE_URL = 'https://scrapebadger.com/v1/youtube';

// ─────────────────────────────────────────────
// How far back we look for "recent" videos
// ─────────────────────────────────────────────
const RECENCY_DAYS = 30;

// A video must score at or above this multiple of 
// the channel baseline to be marked trending.
// 1.0 = at baseline, 2.0 = 2x baseline, etc.
const MIN_VIRAL_SCORE = 1.0;

// ─────────────────────────────────────────────
// ScrapeBadger HTTP client
// ─────────────────────────────────────────────
const sbClient = axios.create({
  baseURL: SCRAPEBADGER_BASE_URL,
  headers: {
    'X-API-Key': SCRAPEBADGER_API_KEY,
    'Content-Type': 'application/json',
  },
  timeout: 30000,
});

// ─────────────────────────────────────────────
// Parse YouTube's relative time strings into
// an approximate Date so we can apply the
// 30-day recency filter.
//
// ScrapeBadger returns strings like:
//   "3 days ago", "2 weeks ago", "1 month ago",
//   "5 hours ago", "just now"
//
// We convert these to a JS Date by subtracting
// from today. Precision doesn't need to be exact —
// we just need to know if it's within 30 days.
// ─────────────────────────────────────────────
function parseRelativeDate(text) {
  if (!text) return null;
  const t = text.toLowerCase().trim();

  if (t === 'just now' || t === 'moments ago') return new Date();

  const match = t.match(/^(\d+)\s+(second|minute|hour|day|week|month|year)s?\s+ago$/);
  if (!match) return null;

  const value = parseInt(match[1]);
  const unit  = match[2];
  const now   = new Date();

  const msMap = {
    second: 1000,
    minute: 60 * 1000,
    hour:   60 * 60 * 1000,
    day:    24 * 60 * 60 * 1000,
    week:   7 * 24 * 60 * 60 * 1000,
    month:  30 * 24 * 60 * 60 * 1000,
    year:   365 * 24 * 60 * 60 * 1000,
  };

  return new Date(now.getTime() - value * msMap[unit]);
}

function isWithinRecencyWindow(publishedTimeText, days = RECENCY_DAYS) {
  const date = parseRelativeDate(publishedTimeText);
  if (!date) return false; // can't parse — exclude to be safe

  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - days);
  return date >= cutoff;
}

// ─────────────────────────────────────────────
// Parse view count text into a number
// Handles: "1.8M views", "340K views", "1,820,000 views"
// ─────────────────────────────────────────────
function parseViewCount(raw) {
  if (typeof raw === 'number') return raw;
  if (!raw) return 0;

  const s = String(raw).replace(/,/g, '').toLowerCase().trim();
  const match = s.match(/^([\d.]+)\s*([kmb])?/);
  if (!match) return 0;

  const num = parseFloat(match[1]);
  const suffix = match[2];

  if (suffix === 'k') return Math.round(num * 1000);
  if (suffix === 'm') return Math.round(num * 1000000);
  if (suffix === 'b') return Math.round(num * 1000000000);
  return Math.round(num);
}

// ─────────────────────────────────────────────
// Calculate the median view count for a set of
// videos — used as the channel baseline.
// We use median rather than mean because a single
// breakout viral video would skew the mean too high.
// ─────────────────────────────────────────────
function calculateMedianViews(videos) {
  const counts = videos
    .map(v => parseViewCount(v.view_count || v.view_count_text))
    .filter(n => n > 0)
    .sort((a, b) => a - b);

  if (counts.length === 0) return 0;

  const mid = Math.floor(counts.length / 2);
  return counts.length % 2 !== 0
    ? counts[mid]
    : Math.round((counts[mid - 1] + counts[mid]) / 2);
}

// ─────────────────────────────────────────────
// Fetch one page of videos from ScrapeBadger.
// content_type: 'videos' | 'shorts'
// sort_by: 'newest' (we always use newest for
//          the recency window approach)
// ─────────────────────────────────────────────
async function fetchChannelPage(channel_id, content_type, continuation = null) {
  const endpoint = content_type === 'shorts'
    ? `/channels/${encodeURIComponent(channel_id)}/shorts`
    : `/channels/${encodeURIComponent(channel_id)}/videos`;

  const params = { sort_by: 'newest' };
  if (continuation) params.continuation = continuation;

  const { data } = await sbClient.get(endpoint, { params });
  return data; // { channel_id, items, continuation }
}

// ─────────────────────────────────────────────
// Fetch videos for a channel within the recency
// window. We paginate until either:
//   a) we find a video older than RECENCY_DAYS, or
//   b) continuation is null (no more pages)
//
// Max pages guard prevents runaway API spend on
// channels that post extremely frequently.
// ─────────────────────────────────────────────
async function fetchRecentVideosForChannel(channel_id, content_type, maxPages = 3) {
  const allVideos = [];
  let continuation = null;
  let page = 0;
  let hitOldContent = false;

  while (page < maxPages && !hitOldContent) {
    let pageData;
    try {
      pageData = await fetchChannelPage(channel_id, content_type, continuation);
    } catch (err) {
      console.warn(
        `⚠️ [trend-fetcher] Failed to fetch page ${page + 1} for ${channel_id}: ${err.message}`
      );
      break;
    }

    const items = pageData.items || [];
    if (items.length === 0) break;

    for (const item of items) {
      if (item.type !== 'video') continue;

      if (!isWithinRecencyWindow(item.published_time_text)) {
        // This video is older than 30 days — everything after
        // this (sorted newest first) will also be older, so stop.
        hitOldContent = true;
        break;
      }

      allVideos.push({
        video_id:            item.video_id,
        title:               item.title,
        url:                 item.url,
        thumbnail:           item.thumbnail,
        view_count:          parseViewCount(item.view_count || item.view_count_text),
        view_count_text:     item.view_count_text || '',
        published_time_text: item.published_time_text || '',
        duration_seconds:    item.length_seconds || 0,
        is_short:            item.is_short || content_type === 'shorts',
      });
    }

    continuation = pageData.continuation;
    if (!continuation) break;
    page++;

    // Small delay between pages to be a good API citizen
    if (page < maxPages && !hitOldContent) {
      await new Promise(r => setTimeout(r, 500));
    }
  }

  return allVideos;
}

// ─────────────────────────────────────────────
// Resolve a channel handle/URL to a canonical
// channel ID and name using ScrapeBadger's
// resolve endpoint (2 credits — cheap).
// ─────────────────────────────────────────────
async function resolveChannel(channel_input) {
  try {
    const { data } = await sbClient.get('/channels/resolve', {
      params: { handle: channel_input }
    });
    // Response shape: { channel_id, title, thumbnail, ... }
    return {
      resolved_id:       data.channel_id   || channel_input,
      channel_name:      data.title        || channel_input,
      channel_thumbnail: data.thumbnail    || null,
    };
  } catch (err) {
    console.warn(`⚠️ [trend-fetcher] Could not resolve channel "${channel_input}": ${err.message}`);
    // Return the input as-is — fetching will still work for UC... IDs and @handles
    return {
      resolved_id:       channel_input,
      channel_name:      channel_input,
      channel_thumbnail: null,
    };
  }
}

// ─────────────────────────────────────────────
// Score and filter videos for a single channel.
// Returns only videos that meet MIN_VIRAL_SCORE.
// ─────────────────────────────────────────────
function scoreChannelVideos(videos, channel_id, channel_name) {
  if (videos.length === 0) return [];

  const baseline = calculateMedianViews(videos);

  console.log(
    `  📊 Channel: ${channel_name} | ` +
    `Videos in window: ${videos.length} | ` +
    `Baseline (median): ${baseline.toLocaleString()} views`
  );

  const scored = videos
    .map(v => ({
      ...v,
      channel_id,
      channel_name,
      channel_baseline: baseline,
      viral_score: baseline > 0
        ? Math.round((v.view_count / baseline) * 100) / 100
        : 0,
    }))
    .filter(v => v.viral_score >= MIN_VIRAL_SCORE)
    .sort((a, b) => b.viral_score - a.viral_score);

  console.log(
    `  ✅ Trending (score ≥ ${MIN_VIRAL_SCORE}): ${scored.length} video(s)`
  );

  return scored;
}

// ─────────────────────────────────────────────
// Main entry point — fetch, score, and cache
// trending videos for a subniche.
//
// Called by trend-bot.js when a user triggers
// a fetch and no valid cache exists for today.
// ─────────────────────────────────────────────
async function fetchAndCacheTrending(subniche_id, triggered_by) {
  const subniche = await getSubnicheById(subniche_id);
  if (!subniche) throw new Error(`Subniche ${subniche_id} not found`);

  const channels = await getChannelsForSubniche(subniche_id);
  if (channels.length === 0) throw new Error(`Subniche has no channels configured`);

  const content_type = subniche.content_type || 'videos';

  console.log(
    `🔍 [trend-fetcher] Fetching for subniche "${subniche.name}" ` +
    `| type: ${content_type} | channels: ${channels.length}`
  );

  await startFetchLog(subniche_id, triggered_by);

  const allTrending = [];

  for (const channel of channels) {
    const channelId = channel.resolved_id || channel.channel_id;
    console.log(`\n  ▶ Processing channel: ${channel.channel_name || channelId}`);

    try {
      const recentVideos = await fetchRecentVideosForChannel(channelId, content_type);

      if (recentVideos.length === 0) {
        console.log(`  ℹ️ No videos in the last ${RECENCY_DAYS} days for this channel`);
        continue;
      }

      const scored = scoreChannelVideos(
        recentVideos,
        channelId,
        channel.channel_name || channelId
      );

      allTrending.push(...scored);

      // Small delay between channels
      await new Promise(r => setTimeout(r, 800));

    } catch (err) {
      console.error(
        `  ❌ Error processing channel ${channelId}: ${err.message}`
      );
      // Continue with remaining channels — don't abort the whole fetch
    }
  }

  // Sort all results by viral score descending
  allTrending.sort((a, b) => b.viral_score - a.viral_score);

  // Save to cache
  await saveTrendingResults(subniche_id, allTrending);
  await completeFetchLog(subniche_id);

  console.log(
    `\n✅ [trend-fetcher] Done: ${allTrending.length} trending item(s) cached for "${subniche.name}"`
  );

  return allTrending;
}

module.exports = {
  fetchAndCacheTrending,
  resolveChannel,
  parseRelativeDate,
  isWithinRecencyWindow,
  parseViewCount,
};
