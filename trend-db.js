// trend-db.js
const pool = require('./db');

// ─────────────────────────────────────────────
// Table setup
// ─────────────────────────────────────────────

async function initTrendTables() {
  try {
    // Subniche templates
    await pool.query(`
      CREATE TABLE IF NOT EXISTS trend_subniches (
        id            SERIAL PRIMARY KEY,
        name          TEXT NOT NULL,
        description   TEXT,
        content_type  TEXT NOT NULL DEFAULT 'videos', -- 'videos' or 'shorts'
        created_by    BIGINT,                          -- telegram_id, NULL = system
        is_public     BOOLEAN DEFAULT FALSE,
        channel_count INT DEFAULT 0,
        created_at    TIMESTAMP DEFAULT NOW(),
        updated_at    TIMESTAMP DEFAULT NOW()
      );
    `);

    // Competitor channels per subniche
    await pool.query(`
      CREATE TABLE IF NOT EXISTS trend_channels (
        id                SERIAL PRIMARY KEY,
        subniche_id       INT NOT NULL REFERENCES trend_subniches(id) ON DELETE CASCADE,
        channel_id        TEXT NOT NULL,               -- UC... id or @handle as submitted
        resolved_id       TEXT,                        -- canonical UC... id after resolution
        channel_name      TEXT,
        channel_thumbnail TEXT,
        added_by          BIGINT,                      -- telegram_id
        created_at        TIMESTAMP DEFAULT NOW(),
        UNIQUE (subniche_id, channel_id)
      );
    `);

    // Cached trending results — shared across all users
    // Cache key = subniche_id + calendar date (UTC)
    await pool.query(`
      CREATE TABLE IF NOT EXISTS trend_cache (
        id                 SERIAL PRIMARY KEY,
        subniche_id        INT NOT NULL REFERENCES trend_subniches(id) ON DELETE CASCADE,
        cache_date         DATE NOT NULL DEFAULT CURRENT_DATE,
        channel_id         TEXT NOT NULL,
        channel_name       TEXT,
        video_id           TEXT NOT NULL,
        title              TEXT NOT NULL,
        url                TEXT NOT NULL,
        thumbnail          TEXT,
        view_count         BIGINT DEFAULT 0,
        view_count_text    TEXT,
        published_time_text TEXT,
        duration_seconds   INT DEFAULT 0,
        is_short           BOOLEAN DEFAULT FALSE,
        viral_score        NUMERIC(10, 2) DEFAULT 0,   -- views / channel baseline
        channel_baseline   BIGINT DEFAULT 0,           -- median views for that channel
        fetched_at         TIMESTAMP DEFAULT NOW(),
        UNIQUE (subniche_id, cache_date, video_id)
      );
    `);

    // Track which subniches have been fetched today
    // so we know whether to serve cache or trigger a fresh fetch
    await pool.query(`
      CREATE TABLE IF NOT EXISTS trend_fetch_log (
        id          SERIAL PRIMARY KEY,
        subniche_id INT NOT NULL REFERENCES trend_subniches(id) ON DELETE CASCADE,
        fetch_date  DATE NOT NULL DEFAULT CURRENT_DATE,
        fetched_by  BIGINT,                            -- telegram_id who triggered it
        status      TEXT DEFAULT 'pending',            -- pending | complete | error
        error_msg   TEXT,
        started_at  TIMESTAMP DEFAULT NOW(),
        completed_at TIMESTAMP,
        UNIQUE (subniche_id, fetch_date)
      );
    `);

    // Index for fast cache lookups
    await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_trend_cache_subniche_date
        ON trend_cache (subniche_id, cache_date);
    `);

    await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_trend_cache_viral_score
        ON trend_cache (subniche_id, cache_date, viral_score DESC);
    `);

    console.log('✅ Trend tables initialized');
  } catch (err) {
    console.error('❌ Failed to initialize trend tables:', err.message);
    throw err;
  }
}

// ─────────────────────────────────────────────
// Subniche CRUD
// ─────────────────────────────────────────────

async function createSubniche({ name, description, content_type, created_by }) {
  const { rows } = await pool.query(
    `INSERT INTO trend_subniches
       (name, description, content_type, created_by, is_public)
     VALUES ($1, $2, $3, $4, TRUE)
     RETURNING *`,
    [name, description || null, content_type || 'videos', created_by || null]
  );
  return rows[0];
}

async function getSubnicheById(id) {
  const { rows } = await pool.query(
    `SELECT s.*, COUNT(c.id)::int AS channel_count
     FROM trend_subniches s
     LEFT JOIN trend_channels c ON c.subniche_id = s.id
     WHERE s.id = $1
     GROUP BY s.id`,
    [id]
  );
  return rows[0] || null;
}

async function getPublicSubniches() {
  const { rows } = await pool.query(
    `SELECT s.*, COUNT(c.id)::int AS channel_count
     FROM trend_subniches s
     LEFT JOIN trend_channels c ON c.subniche_id = s.id
     WHERE s.is_public = TRUE
     GROUP BY s.id
     ORDER BY s.created_at ASC`
  );
  return rows;
}

async function getUserSubniches(telegram_id) {
  const { rows } = await pool.query(
    `SELECT s.*, COUNT(c.id)::int AS channel_count
     FROM trend_subniches s
     LEFT JOIN trend_channels c ON c.subniche_id = s.id
     WHERE s.created_by = $1
     GROUP BY s.id
     ORDER BY s.created_at DESC`,
    [telegram_id]
  );
  return rows;
}

// All subniches a user can access — public ones + their own private ones
async function getAllSubniches() {
  const { rows } = await pool.query(
    `SELECT s.*, COUNT(c.id)::int AS channel_count
     FROM trend_subniches s
     LEFT JOIN trend_channels c ON c.subniche_id = s.id
     GROUP BY s.id
     ORDER BY s.created_at ASC`
  );
  return rows;
}

async function updateSubnicheChannelCount(subniche_id) {
  await pool.query(
    `UPDATE trend_subniches
     SET channel_count = (
       SELECT COUNT(*) FROM trend_channels WHERE subniche_id = $1
     ),
     updated_at = NOW()
     WHERE id = $1`,
    [subniche_id]
  );
}

// ─────────────────────────────────────────────
// Channel CRUD
// ─────────────────────────────────────────────

async function addChannel({ subniche_id, channel_id, channel_name, channel_thumbnail, resolved_id, added_by }) {
  const { rows } = await pool.query(
    `INSERT INTO trend_channels
       (subniche_id, channel_id, resolved_id, channel_name, channel_thumbnail, added_by)
     VALUES ($1, $2, $3, $4, $5, $6)
     ON CONFLICT (subniche_id, channel_id) DO UPDATE
       SET channel_name = EXCLUDED.channel_name,
           channel_thumbnail = EXCLUDED.channel_thumbnail,
           resolved_id = EXCLUDED.resolved_id
     RETURNING *`,
    [subniche_id, channel_id, resolved_id || null, channel_name || null, channel_thumbnail || null, added_by || null]
  );
  await updateSubnicheChannelCount(subniche_id);
  return rows[0];
}

async function getChannelsForSubniche(subniche_id) {
  const { rows } = await pool.query(
    `SELECT * FROM trend_channels WHERE subniche_id = $1 ORDER BY created_at ASC`,
    [subniche_id]
  );
  return rows;
}

// ─────────────────────────────────────────────
// Cache operations
// ─────────────────────────────────────────────

// Check if a fetch has already completed for this subniche today (UTC)
async function isCachedToday(subniche_id) {
  const { rows } = await pool.query(
    `SELECT id FROM trend_fetch_log
     WHERE subniche_id = $1
       AND fetch_date = CURRENT_DATE
       AND status = 'complete'`,
    [subniche_id]
  );
  return rows.length > 0;
}

// Check if a fetch is currently in progress
async function isFetchInProgress(subniche_id) {
  const { rows } = await pool.query(
    `SELECT id, started_at FROM trend_fetch_log
     WHERE subniche_id = $1
       AND fetch_date = CURRENT_DATE
       AND status = 'pending'`,
    [subniche_id]
  );
  if (rows.length === 0) return false;
  // If pending for more than 10 minutes, consider it stale/crashed
  const started = new Date(rows[0].started_at);
  const ageMinutes = (Date.now() - started.getTime()) / 60000;
  return ageMinutes < 10;
}

async function startFetchLog(subniche_id, fetched_by) {
  // Upsert — if a stale pending exists, overwrite it
  await pool.query(
    `INSERT INTO trend_fetch_log (subniche_id, fetch_date, fetched_by, status, started_at)
     VALUES ($1, CURRENT_DATE, $2, 'pending', NOW())
     ON CONFLICT (subniche_id, fetch_date)
     DO UPDATE SET status = 'pending', fetched_by = EXCLUDED.fetched_by, started_at = NOW(), error_msg = NULL`,
    [subniche_id, fetched_by]
  );
}

async function completeFetchLog(subniche_id) {
  await pool.query(
    `UPDATE trend_fetch_log
     SET status = 'complete', completed_at = NOW()
     WHERE subniche_id = $1 AND fetch_date = CURRENT_DATE`,
    [subniche_id]
  );
}

async function failFetchLog(subniche_id, error_msg) {
  await pool.query(
    `UPDATE trend_fetch_log
     SET status = 'error', error_msg = $2, completed_at = NOW()
     WHERE subniche_id = $1 AND fetch_date = CURRENT_DATE`,
    [subniche_id, error_msg]
  );
}

// Insert a batch of trending videos into cache
async function saveTrendingResults(subniche_id, results) {
  if (!results || results.length === 0) return;

  for (const r of results) {
    await pool.query(
      `INSERT INTO trend_cache
         (subniche_id, cache_date, channel_id, channel_name, video_id, title, url,
          thumbnail, view_count, view_count_text, published_time_text,
          duration_seconds, is_short, viral_score, channel_baseline)
       VALUES ($1, CURRENT_DATE, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
       ON CONFLICT (subniche_id, cache_date, video_id) DO UPDATE
         SET viral_score = EXCLUDED.viral_score,
             view_count  = EXCLUDED.view_count,
             fetched_at  = NOW()`,
      [
        subniche_id,
        r.channel_id,
        r.channel_name,
        r.video_id,
        r.title,
        r.url,
        r.thumbnail || null,
        r.view_count || 0,
        r.view_count_text || null,
        r.published_time_text || null,
        r.duration_seconds || 0,
        r.is_short || false,
        r.viral_score || 0,
        r.channel_baseline || 0,
      ]
    );
  }
}

// Get cached trending results for today, sorted by viral score
async function getCachedTrending(subniche_id, limit = 20) {
  const { rows } = await pool.query(
    `SELECT * FROM trend_cache
     WHERE subniche_id = $1
       AND cache_date = CURRENT_DATE
     ORDER BY viral_score DESC
     LIMIT $2`,
    [subniche_id, limit]
  );
  return rows;
}

module.exports = {
  initTrendTables,
  createSubniche,
  getSubnicheById,
  getAllSubniches,          // ← replaces the three above
  updateSubnicheChannelCount,
  addChannel,
  getChannelsForSubniche,
  isCachedToday,
  isFetchInProgress,
  startFetchLog,
  completeFetchLog,
  failFetchLog,
  saveTrendingResults,
  getCachedTrending,
};
