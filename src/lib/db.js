// Same connection pattern as Hale (hale-api/src/config/db.js)
const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
  max: 20,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 2000,
});

pool.on('error', (err) => {
  console.error('Unexpected DB pool error:', err);
});

const query = (text, params) => pool.query(text, params);
const q = query; // short alias used across Waka Bonny routes
const getClient = () => pool.connect();

// Run fn(client) inside a transaction
async function tx(fn) {
  const client = await getClient();
  try {
    await client.query('BEGIN');
    const out = await fn(client);
    await client.query('COMMIT');
    return out;
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
}

module.exports = { query, q, getClient, tx, pool };
