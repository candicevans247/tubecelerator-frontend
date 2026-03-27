// sessions.js - No subscription plans, credit-only system
const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

async function initSessionsTable() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS sessions (
      telegram_id BIGINT PRIMARY KEY,
      plan TEXT,
      expiration TIMESTAMP,
      usage INT DEFAULT 0,
      data JSONB DEFAULT '{}'
    )
  `);
  console.log('✅ Sessions table is ready');
}

initSessionsTable();

// ✅ Create or update user session
async function setUserSession(telegramId, data) {
  const existing = await getUserSession(telegramId);

  if (!existing) {
    await pool.query(
      `INSERT INTO sessions (telegram_id, plan, expiration, usage, data)
       VALUES ($1, $2, $3, $4, $5)`,
      [
        telegramId,
        null,
        null,
        data.usage || 0,
        JSON.stringify(data)
      ]
    );
  } else {
    const mergedData = { ...existing, ...data };
    await pool.query(
      `UPDATE sessions 
       SET plan = $2, expiration = $3, usage = $4, data = $5
       WHERE telegram_id = $1`,
      [
        telegramId,
        null,
        null,
        mergedData.usage || 0,
        JSON.stringify(mergedData)
      ]
    );
  }
}

// ✅ Get user session
async function getUserSession(telegramId) {
  const res = await pool.query(
    `SELECT * FROM sessions WHERE telegram_id = $1`,
    [telegramId]
  );
  return res.rows[0] ? { ...res.rows[0], ...res.rows[0].data } : null;
}

// ✅ Create session on first interaction — called from /start
async function createSessionIfNotExists(telegramId, userData = {}) {
  const existing = await getUserSession(telegramId);
  if (!existing) {
    await pool.query(
      `INSERT INTO sessions (telegram_id, plan, expiration, usage, data)
       VALUES ($1, NULL, NULL, 0, $2)
       ON CONFLICT (telegram_id) DO NOTHING`,
      [telegramId, JSON.stringify({
        joinedAt: new Date().toISOString(),
        ...userData
      })]
    );
    console.log(`✅ New session created for user ${telegramId}`);
  }
}

// ✅ Track usage (useful for analytics)
async function trackUsage(telegramId, minutesUsed) {
  const session = await getUserSession(telegramId);
  const usage = (session?.usage || 0) + minutesUsed;
  await setUserSession(telegramId, { usage });
}

// ✅ Check if user is new (no session ever created)
async function isNewUser(telegramId) {
  const session = await getUserSession(telegramId);
  return !session;
}

// ✅ Admin helper
async function listAllSessions() {
  const res = await pool.query(`SELECT * FROM sessions`);
  return res.rows;
}

module.exports = {
  setUserSession,
  getUserSession,
  createSessionIfNotExists,
  trackUsage,
  isNewUser,
  listAllSessions
};
