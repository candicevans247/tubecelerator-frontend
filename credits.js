// credits.js - WITH 30-DAY EXPIRATION
const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

// ✅ Auto-create credits table with expiration
async function initCreditsTable() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS credits (
      telegram_id BIGINT PRIMARY KEY,
      credits DECIMAL(10,2) DEFAULT 0,
      expires_at TIMESTAMP,
      credited_at TIMESTAMP DEFAULT NOW()
    )
  `);
  
  // Add expiration column if it doesn't exist (for existing tables)
  try {
    await pool.query(`ALTER TABLE credits ADD COLUMN IF NOT EXISTS expires_at TIMESTAMP`);
    await pool.query(`ALTER TABLE credits ADD COLUMN IF NOT EXISTS credited_at TIMESTAMP DEFAULT NOW()`);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_credits_expiration ON credits(expires_at)`);
  } catch (error) {
    // Columns likely already exist
  }
  
  // Create transactions table
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

// ✅ UPDATED: Set credits with 30-day expiration
async function setCredits(telegramId, count, transactionId = null, operationType = 'admin_grant') {
  telegramId = String(telegramId);
  
  // Generate transaction ID if not provided
  if (!transactionId) {
    transactionId = `admin_${telegramId}_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
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
    
    // ✅ NEW: Calculate 30-day expiration from now
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + 30); // 30 days from now
    
    // ✅ SET credits with expiration
    await pool.query(`
      INSERT INTO credits (telegram_id, credits, expires_at, credited_at)
      VALUES ($1, $2, $3, NOW())
      ON CONFLICT (telegram_id) 
      DO UPDATE SET 
        credits = EXCLUDED.credits,
        expires_at = EXCLUDED.expires_at,
        credited_at = NOW()
    `, [telegramId, count, expiresAt]);
    
    // Record transaction
    await pool.query(
      'INSERT INTO credit_transactions (telegram_id, transaction_id, credits, operation_type) VALUES ($1, $2, $3, $4)',
      [telegramId, transactionId, count, operationType]
    );
    
    await pool.query('COMMIT');
    
    console.log(`✅ Set ${count} credits for ${telegramId} (expires: ${expiresAt.toDateString()}, transaction: ${transactionId})`);
    return { 
      success: true, 
      alreadyProcessed: false,
      expiresAt: expiresAt.toISOString()
    };
    
  } catch (error) {
    await pool.query('ROLLBACK');
    console.error(`❌ Error in setCredits:`, error);
    throw error;
  }
}

// ✅ UPDATED: Add credits (adds to existing, extends expiration)
async function addCredits(telegramId, count, transactionId = null, operationType = 'manual') {
  telegramId = String(telegramId);
  
  if (!transactionId) {
    transactionId = `add_${telegramId}_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  try {
    await pool.query('BEGIN');
    
    const existing = await pool.query(
      'SELECT * FROM credit_transactions WHERE telegram_id = $1 AND transaction_id = $2',
      [telegramId, transactionId]
    );
    
    if (existing.rows.length > 0) {
      console.log(`✅ Transaction ${transactionId} already processed - skipping`);
      await pool.query('ROLLBACK');
      return { success: true, alreadyProcessed: true };
    }
    
    // ✅ NEW: Extend expiration by 30 days from now
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + 30);
    
    // Add credits and update expiration
    await pool.query(`
      INSERT INTO credits (telegram_id, credits, expires_at, credited_at)
      VALUES ($1, $2, $3, NOW())
      ON CONFLICT (telegram_id) 
      DO UPDATE SET 
        credits = credits.credits + EXCLUDED.credits,
        expires_at = EXCLUDED.expires_at,
        credited_at = NOW()
    `, [telegramId, count, expiresAt]);
    
    await pool.query(
      'INSERT INTO credit_transactions (telegram_id, transaction_id, credits, operation_type) VALUES ($1, $2, $3, $4)',
      [telegramId, transactionId, count, operationType]
    );
    
    await pool.query('COMMIT');
    
    console.log(`✅ Added ${count} credits to ${telegramId} (expires: ${expiresAt.toDateString()})`);
    return { 
      success: true, 
      alreadyProcessed: false,
      expiresAt: expiresAt.toISOString()
    };
    
  } catch (error) {
    await pool.query('ROLLBACK');
    console.error(`❌ Error in addCredits:`, error);
    throw error;
  }
}

// ✅ NEW: Reset credits to zero (for expired credits)
async function resetCredits(telegramId, reason = 'expired') {
  telegramId = String(telegramId);
  
  try {
    await pool.query(`
      UPDATE credits 
      SET credits = 0, expires_at = NULL 
      WHERE telegram_id = $1
    `, [telegramId]);
    
    console.log(`✅ Reset credits to 0 for ${telegramId} (reason: ${reason})`);
    return { success: true };
    
  } catch (error) {
    console.error(`❌ Error in resetCredits:`, error);
    throw error;
  }
}

// ✅ UPDATED: Get credits with expiration info
async function getCredits(telegramId) {
  telegramId = String(telegramId);
  const res = await pool.query(`SELECT credits, expires_at FROM credits WHERE telegram_id = $1`, [telegramId]);
  
  if (res.rows.length === 0) {
    return { amount: 0, expiresAt: null, isExpired: false };
  }
  
  const credits = res.rows[0].credits || 0;
  const expiresAt = res.rows[0].expires_at;
  
  // Check if expired
  const isExpired = expiresAt ? new Date(expiresAt) < new Date() : false;
  
  return {
    amount: isExpired ? 0 : credits, // Return 0 if expired
    expiresAt: expiresAt ? expiresAt : null,
    isExpired
  };
}

// ✅ NEW: Check if credits are expired
async function areCreditsExpired(telegramId) {
  const creditInfo = await getCredits(telegramId);
  return creditInfo.isExpired;
}

// ✅ UPDATED: Use credits (checks expiration first)
async function useCredits(telegramId, count = 1) {
  telegramId = String(telegramId);

  if (count === 0) {
    const creditInfo = await getCredits(telegramId);
    return { success: true, remaining: creditInfo.amount };
  }

  // ✅ Check expiration first
  const creditInfo = await getCredits(telegramId);
  
  if (creditInfo.isExpired) {
    return { 
      success: false, 
      reason: '⏳ Your credits have expired. Please contact admin for renewal.' 
    };
  }

  // ✅ Atomic update with expiration check
  const result = await pool.query(`
    UPDATE credits 
    SET credits = credits - $2 
    WHERE telegram_id = $1 
    AND credits >= $2
    AND (expires_at IS NULL OR expires_at > NOW())
    RETURNING credits
  `, [telegramId, count]);

  if (result.rows.length === 0) {
    return { success: false, reason: '❌ Not enough credits or credits expired.' };
  }

  const remaining = result.rows[0].credits;
  console.log(`✅ Deducted ${count} credits from ${telegramId}. Remaining: ${remaining}`);
  return { success: true, remaining };
}

// ✅ NEW: Auto-expire old credits (run periodically)
async function expireOldCredits() {
  try {
    const result = await pool.query(`
      UPDATE credits 
      SET credits = 0 
      WHERE expires_at < NOW() 
      AND credits > 0
      RETURNING telegram_id, credits
    `);
    
    if (result.rows.length > 0) {
      console.log(`⏳ Expired credits for ${result.rows.length} user(s)`);
      return result.rows;
    }
    
    return [];
  } catch (error) {
    console.error(`❌ Error expiring credits:`, error);
    return [];
  }
}

// Calculate credit cost (unchanged)
function calculateCreditCost({ durationMinutes, isPremiumVoice }) {
  const duration = Math.max(0, Number(durationMinutes) || 0);
  const baseRate = 10;
  const premiumExtra = 5;
  
  const baseCost = duration * baseRate;
  const premiumCost = isPremiumVoice ? duration * premiumExtra : 0;
  
  return baseCost + premiumCost;
}

module.exports = {
  setCredits,      // Set exact amount with 30-day expiration
  addCredits,      // Add to existing with 30-day expiration
  resetCredits,    // Reset to zero
  getCredits,      // Get credits with expiration info
  areCreditsExpired, // Check if expired
  useCredits,      // Use credits (checks expiration)
  expireOldCredits,  // Expire old credits
  calculateCreditCost
};
