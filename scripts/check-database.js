require('dotenv').config({ quiet: true });
const fs = require('fs');
const path = require('path');
const { Client } = require('pg');

async function main() {
  const ca = fs.readFileSync(path.join(__dirname, '..', 'supabase', 'prod-ca-2021.crt'), 'utf8');
  const client = new Client({ ssl: { ca, rejectUnauthorized: true }, connectionTimeoutMillis: 10000 });
  try {
    await client.connect();
    const { rows } = await client.query("SELECT to_regclass('sortis_private.draw_state') IS NOT NULL AS table_exists");
    if (!rows[0].table_exists) throw new Error('MISSING_TABLE');
    const stateResult = await client.query(
      `SELECT revision,
              jsonb_array_length(state->'participants') AS participants,
              jsonb_array_length(state->'history') AS results,
              pending_spin IS NOT NULL AS pending
       FROM sortis_private.draw_state
       WHERE id = 'main'`,
    );
    await client.query('BEGIN');
    try {
      await client.query("UPDATE sortis_private.draw_state SET updated_at = updated_at WHERE id = 'main'");
    } finally {
      await client.query('ROLLBACK');
    }
    const saved = stateResult.rows[0];
    const detail = saved
      ? ` Estado: ${saved.participants} participantes, ${saved.results} resultados, revision ${saved.revision}, giro pendiente: ${saved.pending ? 'si' : 'no'}.`
      : ' El estado se inicializara al arrancar el servidor.';
    console.log(`Supabase: conexion TLS verificada; tabla draw_state disponible.${detail}`);
  } catch (error) {
    // Never print connection strings, configuration, or credentials.
    console.error('No se pudo verificar Supabase. Codigo:', error.code || (error.message === 'MISSING_TABLE' ? 'MISSING_TABLE' : 'CONNECTION_ERROR'));
    process.exitCode = 1;
  } finally {
    await client.end().catch(() => {});
  }
}

main();
