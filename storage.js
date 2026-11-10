const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');

const configured = Boolean(process.env.DATABASE_URL || process.env.PGHOST);
let pool = null;

function getPool() {
  if (!configured) return null;
  if (pool) return pool;
  const caPath = path.join(__dirname, 'supabase', 'prod-ca-2021.crt');
  const ca = fs.readFileSync(caPath, 'utf8');
  pool = new Pool({
    ...(process.env.DATABASE_URL ? { connectionString: process.env.DATABASE_URL } : {}),
    ssl: { ca, rejectUnauthorized: true },
    max: 5,
    connectionTimeoutMillis: 10000,
    idleTimeoutMillis: 30000,
  });
  pool.on('error', (error) => console.error('Error inesperado de PostgreSQL:', error.code || error.message));
  return pool;
}

async function load(initialState) {
  const db = getPool();
  if (!db) return null;
  await db.query(
    `INSERT INTO sortis_private.draw_state (id, state)
     VALUES ('main', $1::jsonb)
     ON CONFLICT (id) DO NOTHING`,
    [JSON.stringify(initialState)],
  );
  const { rows } = await db.query(
    `SELECT state, pending_spin AS "pendingSpin", revision
     FROM sortis_private.draw_state
     WHERE id = 'main'`,
  );
  if (!rows[0]) throw new Error('No se pudo inicializar el estado del sorteo');
  return rows[0];
}

async function save(state, pendingSpin) {
  const db = getPool();
  if (!db) return null;
  const { rows } = await db.query(
    `UPDATE sortis_private.draw_state
     SET state = $1::jsonb,
         pending_spin = $2::jsonb,
         revision = revision + 1,
         updated_at = now()
     WHERE id = 'main'
     RETURNING revision`,
    [JSON.stringify(state), pendingSpin ? JSON.stringify(pendingSpin) : null],
  );
  if (!rows[0]) throw new Error('No existe el estado principal del sorteo');
  return rows[0].revision;
}

async function health() {
  const db = getPool();
  if (!db) return { configured: false, ok: true };
  await db.query('SELECT 1');
  return { configured: true, ok: true };
}

async function close() {
  if (pool) await pool.end();
}

module.exports = { configured, load, save, health, close };
