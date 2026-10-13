const { Pool, types } = require('pg');

// NUMERIC -> float, BIGINT (count) -> int
types.setTypeParser(1700, (v) => (v === null ? null : parseFloat(v)));
types.setTypeParser(20, (v) => (v === null ? null : parseInt(v, 10)));
// DATE -> string 'YYYY-MM-DD' (hindari pergeseran zona waktu)
types.setTypeParser(1082, (v) => v);

const pool = new Pool({
  connectionString:
    process.env.DATABASE_URL || 'postgres://ttx:ttx@localhost:5432/ttx',
  max: 20,
});

async function query(text, params) {
  return pool.query(text, params);
}

async function one(text, params) {
  const r = await pool.query(text, params);
  return r.rows[0] || null;
}

async function many(text, params) {
  const r = await pool.query(text, params);
  return r.rows;
}

async function tx(fn) {
  const client = await pool.connect();
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

async function waitForDb(retries = 40) {
  for (let i = 0; i < retries; i++) {
    try {
      await pool.query('SELECT 1');
      return;
    } catch (e) {
      console.log(`[db] menunggu database... (${i + 1}/${retries})`);
      await new Promise((r) => setTimeout(r, 1500));
    }
  }
  throw new Error('Database tidak dapat dihubungi');
}

module.exports = { pool, query, one, many, tx, waitForDb };
