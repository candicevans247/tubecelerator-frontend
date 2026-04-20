// frontend/db.js
const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
  max: 1,                        // ✅ Only 1 connection total
  idleTimeoutMillis: 10000,      // ✅ Close after 10s idle
  connectionTimeoutMillis: 5000,
  allowExitOnIdle: true           // ✅ CRITICAL - allows process to exit
});

pool.on('error', (err) => {
  console.error('❌ Unexpected database pool error:', err.message);
});

module.exports = pool;
