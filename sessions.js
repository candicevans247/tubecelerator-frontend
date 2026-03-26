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
        data.plan || null,
        data.expiration ? new Date(data.expiration) : null,
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
        mergedData.plan || null,
        mergedData.expiration ? new Date(mergedData.expiration) : null,
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

// ✅ Check if plan is expired
async function isPlanExpired(telegramId) {
  const session = await getUserSession(telegramId);

  if (!session) return { status: 'new', expired: false };
  if (!session.plan || session.plan === 'free') return { status: 'new', expired: false };

  const now = new Date();
  const expiryDate = new Date(session.expiration);

  if (isNaN(expiryDate)) return { status: 'active', expired: false };

  if (expiryDate < now) {
    const { resetCredits } = require('./credits');
    try {
      await resetCredits(telegramId, 'plan_expired');
      console.log(`🔄 Credits reset to 0 for expired plan (user: ${telegramId})`);
    } catch (error) {
      console.error(`⚠️ Failed to reset credits for ${telegramId}:`, error.message);
    }
    return { status: 'expired', expired: true };
  }

  return { status: 'active', expired: false };
}

// ✅ Expire plans and reset credits
async function expirePlansIfNeeded() {
  const expired = await pool.query(`
    SELECT telegram_id FROM sessions 
    WHERE expiration < NOW() 
    AND plan IS NOT NULL
  `);

  if (expired.rows.length === 0) return;

  console.log(`🔄 Expiring ${expired.rows.length} plan(s)...`);

  const { resetCredits } = require('./credits');

  for (const row of expired.rows) {
    try {
      await resetCredits(row.telegram_id, 'plan_expired');

      try {
        const { bot } = require('./telegram-bot');
        await bot.telegram.sendMessage(
          row.telegram_id,
          `⏳ *Your plan has expired.*\n\nYour credits have been reset to 0. Please subscribe to continue creating videos.`,
          { parse_mode: 'Markdown' }
        );
      } catch (notifyErr) {
        console.warn(`⚠️ Could not notify ${row.telegram_id}:`, notifyErr.message);
      }

    } catch (err) {
      console.error(`❌ Failed to expire plan for ${row.telegram_id}:`, err.message);
    }
  }

  await pool.query(`
    UPDATE sessions 
    SET plan = NULL, expiration = NULL 
    WHERE expiration < NOW()
  `);

  console.log(`✅ Expired ${expired.rows.length} plan(s) and reset their credits`);
}

// ✅ Activate a plan
async function activatePlan(telegramId, plan, durationDays = 30) {
  const expiration = new Date(Date.now() + durationDays * 24 * 60 * 60 * 1000);
  await setUserSession(telegramId, { plan, expiration: expiration.toISOString() });
}

// ✅ Track usage
async function trackUsage(telegramId, minutesUsed) {
  const session = await getUserSession(telegramId);
  const usage = (session?.usage || 0) + minutesUsed;
  await setUserSession(telegramId, { usage });
}

// ✅ Check if user is new (no session or no plan ever)
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
  isPlanExpired,
  expirePlansIfNeeded,
  activatePlan,
  trackUsage,
  isNewUser,              
  listAllSessions
};
