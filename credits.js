// credits.js (PostgreSQL version with auto table creation + idempotency)
const { Pool } = require('pg');
const { isPlanExpired } = require('./sessions');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

// ✅ Auto-create credits table on startup
async function initCreditsTable() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS credits (
      telegram_id BIGINT PRIMARY KEY,
      credits DECIMAL(10,2) DEFAULT 0
    )
  `);
  
  // ✅ NEW: Create transactions table to track operations
  await pool.query(`
    CREATE TABLE IF NOT EXISTS credit_transactions (
      id SERIAL PRIMARY KEY,
      telegram_id BIGINT NOT NULL,
      transaction_id TEXT NOT NULL,
      credits INT NOT NULL,
      operation_type TEXT NOT NULL,
      created_at TIMESTAMP DEFAULT NOW(),
      UNIQUE(telegram_id, transaction_id)
    )
  `);
  
  console.log('✅ Credits and transactions tables are ready');
}

initCreditsTable();

// ✅ ONLY idempotent version - prevents all duplicate issues
async function addCredits(telegramId, count, transactionId = null, operationType = 'manual') {
  telegramId = String(telegramId);
  
  // Generate transaction ID if not provided (for backward compatibility)
  if (!transactionId) {
    transactionId = `manual_${telegramId}_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  try {
    // Start transaction
    await pool.query('BEGIN');
    
    // Check if this transaction was already processed
    const existing = await pool.query(
      'SELECT * FROM credit_transactions WHERE telegram_id = $1 AND transaction_id = $2',
      [telegramId, transactionId]
    );
    
    if (existing.rows.length > 0) {
      console.log(`✅ Transaction ${transactionId} already processed for ${telegramId} - skipping`);
      await pool.query('ROLLBACK');
      return { success: true, alreadyProcessed: true };
    }
    
    // Add credits
    await pool.query(`
      INSERT INTO credits (telegram_id, credits)
      VALUES ($1, $2)
      ON CONFLICT (telegram_id) 
      DO UPDATE SET credits = credits.credits + EXCLUDED.credits
    `, [telegramId, count]);
    
    // Record this transaction to prevent duplicates
    await pool.query(
      'INSERT INTO credit_transactions (telegram_id, transaction_id, credits, operation_type) VALUES ($1, $2, $3, $4)',
      [telegramId, transactionId, count, operationType]
    );
    
    // Commit transaction
    await pool.query('COMMIT');
    
    console.log(`✅ Credited ${count} to ${telegramId} (transaction: ${transactionId})`);
    return { success: true, alreadyProcessed: false };
    
  } catch (error) {
    await pool.query('ROLLBACK');
    console.error(`❌ Error in addCredits:`, error);
    throw error;
  }
}

// ✅ NEW: Set credits to exact amount (for plan renewals)
async function setCredits(telegramId, count, transactionId = null, operationType = 'renewal') {
  telegramId = String(telegramId);
  
  // Generate transaction ID if not provided
  if (!transactionId) {
    transactionId = `renewal_${telegramId}_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  try {
    await pool.query('BEGIN');
    
    // Check if this transaction was already processed
    const existing = await pool.query(
      'SELECT * FROM credit_transactions WHERE telegram_id = $1 AND transaction_id = $2',
      [telegramId, transactionId]
    );
    
    if (existing.rows.length > 0) {
      console.log(`✅ Transaction ${transactionId} already processed for ${telegramId} - skipping`);
      await pool.query('ROLLBACK');
      return { success: true, alreadyProcessed: true };
    }
    
    // ✅ SET credits to exact amount (not adding)
    await pool.query(`
      INSERT INTO credits (telegram_id, credits)
      VALUES ($1, $2)
      ON CONFLICT (telegram_id) 
      DO UPDATE SET credits = EXCLUDED.credits
    `, [telegramId, count]);
    
    // Record transaction
    await pool.query(
      'INSERT INTO credit_transactions (telegram_id, transaction_id, credits, operation_type) VALUES ($1, $2, $3, $4)',
      [telegramId, transactionId, count, operationType]
    );
    
    await pool.query('COMMIT');
    
    console.log(`✅ Set credits to ${count} for ${telegramId} (transaction: ${transactionId})`);
    return { success: true, alreadyProcessed: false };
    
  } catch (error) {
    await pool.query('ROLLBACK');
    console.error(`❌ Error in setCredits:`, error);
    throw error;
  }
}

// ✅ NEW: Reset credits to zero (for expired plans)
async function resetCredits(telegramId, reason = 'plan_expired') {
  telegramId = String(telegramId);
  
  try {
    await pool.query(`
      INSERT INTO credits (telegram_id, credits)
      VALUES ($1, 0)
      ON CONFLICT (telegram_id) 
      DO UPDATE SET credits = 0
    `, [telegramId]);
    
    console.log(`✅ Reset credits to 0 for ${telegramId} (reason: ${reason})`);
    return { success: true };
    
  } catch (error) {
    console.error(`❌ Error in resetCredits:`, error);
    throw error;
  }
}

// Get current credits
async function getCredits(telegramId) {
  telegramId = String(telegramId);
  const res = await pool.query(`SELECT credits FROM credits WHERE telegram_id = $1`, [telegramId]);
  return res.rows[0]?.credits || 0;
}

// Check if user has enough credits
async function hasCredits(telegramId, needed = 1) {
  const current = await getCredits(telegramId);
  return current >= needed;
}

// ✅ IMPROVED: Use credits with atomic operation (prevents race conditions)
async function useCredits(telegramId, count = 1) {
  telegramId = String(telegramId);

  if (count === 0) {
    const current = await getCredits(telegramId);
    return { success: true, remaining: current };
  }

  const { expired } = await isPlanExpired(telegramId);
  if (expired) {
    return { success: false, reason: '⏳ Your plan has expired. Please renew to use credits.' };
  }

  // ✅ IMPROVED: Atomic update with check (prevents race conditions)
  const result = await pool.query(`
    UPDATE credits 
    SET credits = credits - $2 
    WHERE telegram_id = $1 AND credits >= $2
    RETURNING credits
  `, [telegramId, count]);

  if (result.rows.length === 0) {
    return { success: false, reason: '❌ Not enough credits.' };
  }

  const remaining = result.rows[0].credits;
  console.log(`✅ Deducted ${count} credits from ${telegramId}. Remaining: ${remaining}`);
  return { success: true, remaining };
}

// Calculate how many credits a video will cost
function calculateCreditCost({ durationMinutes, isPremiumVoice }) {
  const duration = Math.max(0, Number(durationMinutes) || 0);
  const baseRate = 10; // 10 credits per minute for basic voice
  const premiumExtra = 5; // +5 credits per minute for premium voice
  
  const baseCost = duration * baseRate;
  const premiumCost = isPremiumVoice ? duration * premiumExtra : 0;
  
  return baseCost + premiumCost;
}

module.exports = {
  addCredits,      // For bonuses/manual additions
  setCredits,      // ✅ NEW: For plan renewals
  resetCredits,    // ✅ NEW: For expiring plans
  getCredits,
  hasCredits,
  useCredits,
  calculateCreditCost
};
