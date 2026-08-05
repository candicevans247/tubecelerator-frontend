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

const RECENCY_DAYS    = 30;
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
  timeout: 60000, // increased — shorts with include_published_at can take ~5s per page
});

// ─────────────────────────────────────────────
// Parse a date value into a JS Date.
// Handles:
//   - ISO 8601 timestamps  "2026-08-04T09:21:52Z"  ← what shorts now return
//   - Unix timestamps (number)                      ← published_utc field
//   - Relative strings     "3 days ago"
//   - Absolute strings     "Jan 15, 2025"
//   - "just now" / "moments ago"
// ─────────────────────────────────────────────
function parseRelativeDate(text) {
  if (!text) return null;

  // Unix timestamp (number) — published_utc field from ScrapeBadger
  if (typeof text === 'number') {
    // Could be seconds or milliseconds
    const ms = text > 1e10 ? text : text * 1000;
    const d  = new Date(ms);
    return isNaN(d.getTime()) ? null : d;
  }

  const t = String(text).toLowerCase().trim();

  if (t === 'just now' || t === 'moments ago') return new Date();

  // ISO 8601 — "2026-08-04T09:21:52Z" — primary format for shorts
  if (text.includes('T') && (text.includes('Z') || text.includes('+'))) {
    const iso = new Date(text);
    if (!isNaN(iso.getTime())) return iso;
  }

  // Relative — "3 days ago", "2 weeks ago"
  const relativeMatch = t.match(/^(\d+)\s+(second|minute|hour|day|week|month|year)s?\s+ago$/);
  if (relativeMatch) {
    const value = parseInt(relativeMatch[1]);
    const unit  = relativeMatch[2];
    const now   = new Date();

    const msMap = {
      second: 1000,
      minute: 60 * 1000,
      hour:   60 * 60 * 1000,
      day:    24 * 60 * 60 * 1000,
      week:   7  * 24 * 60 * 60 * 1000,
      month:  30 * 24 * 60 * 60 * 1000,
      year:   365 * 24 * 60 * 60 * 1000,
    };

    return new Date(now.getTime() - value * msMap[unit]);
  }

  // Absolute date strings — "Jan 15, 2025"
  const absoluteAttempt = new Date(text);
  if (!isNaN(absoluteAttempt.getTime())) return absoluteAttempt;

  return null;
}

// ─────────────────────────────────────────────
// Resolve the best available date from an item.
// ScrapeBadger returns different fields depending
// on content type:
//
//  Longform videos:
//    published_time_text = "3 weeks ago"   (always present)
//    published_at        = null
//
//  Shorts (with include_published_at=true):
//    published_time_text = null
//    published_at        = "2026-08-04T09:21:52Z"  ← ISO timestamp
//    published_utc       = 1785835312.0             ← unix seconds
//
// We try each field in order of precision.
// ─────────────────────────────────────────────
function resolveItemDate(item) {
  // 1. Exact ISO timestamp — most precise, used by shorts
  if (item.published_at) {
    const d = parseRelativeDate(item.published_at);
    if (d) return d;
  }

  // 2. Unix timestamp — also from shorts endpoint
  if (item.published_utc) {
    const d = parseRelativeDate(item.published_utc);
    if (d) return d;
  }

  // 3. Relative text — used by longform videos
  if (item.published_time_text) {
    const d = parseRelativeDate(item.published_time_text);
    if (d) return d;
  }

  return null;
}

function isWithinRecencyWindow(item, days = RECENCY_DAYS) {
  const date = resolveItemDate(item);

  // ── Logging — helps diagnose future null-date issues ────────────
  if (!date) {
    console.warn(
      `  ⚠️  Could not resolve date for video "${item.video_id}" ` +
      `(published_at=${item.published_at}, ` +
      `published_utc=${item.published_utc}, ` +
      `published_time_text=${item.published_time_text}) — excluding`
    );
    return false;
  }

  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - days);
  return date >= cutoff;
}

// ─────────────────────────────────────────────
// Build a human-readable date label for storage.
// For shorts we won't have published_time_text,
// so we format the ISO timestamp ourselves.
// ─────────────────────────────────────────────
function buildPublishedLabel(item) {
  // Prefer the relative string if it exists (longform)
  if (item.published_time_text) return item.published_time_text;

  // For shorts, build one from the ISO timestamp
  if (item.published_at) {
    const d = new Date(item.published_at);
    if (!isNaN(d.getTime())) {
      const diffMs   = Date.now() - d.getTime();
      const diffDays = Math.floor(diffMs / (24 * 60 * 60 * 1000));

      if (diffDays === 0)  return 'Today';
      if (diffDays === 1)  return 'Yesterday';
      if (diffDays < 7)   return `${diffDays} days ago`;
      if (diffDays < 14)  return '1 week ago';
      if (diffDays < 30)  return `${Math.floor(diffDays / 7)} weeks ago`;
      return `${Math.floor(diffDays / 30)} months ago`;
    }
  }

  return 'Unknown date';
}

// ─────────────────────────────────────────────
// Parse view count text into a number
// ─────────────────────────────────────────────
function parseViewCount(raw) {
  if (typeof raw === 'number') return raw;
  if (!raw) return 0;

  const s     = String(raw).replace(/,/g, '').toLowerCase().trim();
  const match = s.match(/^([\d.]+)\s*([kmb])?/);
  if (!match) return 0;

  const num    = parseFloat(match[1]);
  const suffix = match[2];

  if (suffix === 'k') return Math.round(num * 1_000);
  if (suffix === 'm') return Math.round(num * 1_000_000);
  if (suffix === 'b') return Math.round(num * 1_000_000_000);
  return Math.round(num);
}

// ─────────────────────────────────────────────
// Median view count — used as channel baseline
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
// Fetch one page from ScrapeBadger.
// include_published_at is only sent for shorts
// because it adds ~5s per page.
// ─────────────────────────────────────────────
async function fetchChannelPage(channel_id, content_type, continuation = null) {
  const endpoint = content_type === 'shorts'
    ? `/channels/${encodeURIComponent(channel_id)}/shorts`
    : `/channels/${encodeURIComponent(channel_id)}/videos`;

  const params = { sort_by: 'newest' };
  if (continuation) params.continuation = continuation;

  // ← KEY FIX: opt-in to published date resolution for shorts
  if (content_type === 'shorts') {
    params.include_published_at = true;
  }

  const { data } = await sbClient.get(endpoint, { params });
  return data;
}

// ─────────────────────────────────────────────
// Fetch all recent videos for a channel within
// the recency window, paginating as needed.
// ─────────────────────────────────────────────
async function fetchRecentVideosForChannel(channel_id, content_type, maxPages = 3) {
  const allVideos  = [];
  let continuation = null;
  let page         = 0;
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

    // ── Debug log — first item on first page ─────────────────────
    if (page === 0 && items.length > 0) {
      console.log(
        `  🔬 Sample item for ${channel_id}:`,
        JSON.stringify({
          type:                items[0].type,
          video_id:            items[0].video_id,
          title:               items[0].title?.slice(0, 50),
          published_time_text: items[0].published_time_text,
          published_at:        items[0].published_at,
          published_utc:       items[0].published_utc,   // ← log this too
          view_count:          items[0].view_count,
          view_count_text:     items[0].view_count_text,
          is_short:            items[0].is_short,
        })
      );
    }

    for (const item of items) {
      // ── FIXED: shorts endpoint returns type "short", not "video" ─
      // Accept both so we don't accidentally skip all shorts items
      const validTypes = ['video', 'short'];
      if (!validTypes.includes(item.type)) continue;

      // ── FIXED: pass the whole item so resolveItemDate can check
      // published_at and published_utc in addition to published_time_text
      const withinWindow = isWithinRecencyWindow(item);

      if (!withinWindow) {
        // If the item has a resolvable date and it's old, stop paginating.
        // If it has no date at all, skip it but keep going — there may be
        // dated items further down the page.
        const resolvedDate = resolveItemDate(item);
        if (resolvedDate) {
          hitOldContent = true;
          break;
        }
        continue;
      }

      allVideos.push({
        video_id:            item.video_id,
        title:               item.title,
        url:                 item.url,
        thumbnail:           item.thumbnail,
        view_count:          parseViewCount(item.view_count || item.view_count_text),
        view_count_text:     item.view_count_text || '',
        // ← FIXED: store a human-readable label for display
        published_time_text: buildPublishedLabel(item),
        // ← Store the raw ISO date for any future date math
        published_at:        item.published_at || null,
        duration_seconds:    item.length_seconds || 0,
        is_short:            item.is_short || content_type === 'shorts',
      });
    }

    continuation = pageData.continuation;
    if (!continuation) break;
    page++;

    if (page < maxPages && !hitOldContent) {
      // Longer delay for shorts since include_published_at makes pages slower
      const delay = content_type === 'shorts' ? 1500 : 500;
      await new Promise(r => setTimeout(r, delay));
    }
  }

  return allVideos;
}

// ─────────────────────────────────────────────
// Resolve a channel handle/URL to a canonical
// channel ID and name
// ─────────────────────────────────────────────
async function resolveChannel(channel_input) {
  try {
    const { data } = await sbClient.get('/channels/resolve', {
      params: { handle: channel_input }
    });
    return {
      resolved_id:       data.channel_id   || channel_input,
      channel_name:      data.title        || channel_input,
      channel_thumbnail: data.thumbnail    || null,
    };
  } catch (err) {
    console.warn(
      `⚠️ [trend-fetcher] Could not resolve channel "${channel_input}": ${err.message}`
    );
    return {
      resolved_id:       channel_input,
      channel_name:      channel_input,
      channel_thumbnail: null,
    };
  }
}

// ─────────────────────────────────────────────
// Score and filter videos for a single channel
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
// Main entry point
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

      await new Promise(r => setTimeout(r, 800));

    } catch (err) {
      console.error(`  ❌ Error processing channel ${channelId}: ${err.message}`);
    }
  }

  allTrending.sort((a, b) => b.viral_score - a.viral_score);

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
