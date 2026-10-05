import { readFile } from 'node:fs/promises';
import { Pool } from 'pg';
import { createStore } from './store.mjs';

async function main() {
  if (process.env.FALCON_MESH_ALLOW_SCHEMA_SETUP !== '1') {
    throw new Error('Set FALCON_MESH_ALLOW_SCHEMA_SETUP=1 only after reviewing the target and mesh/schema.sql.');
  }
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required for explicit schema setup.');
  const schema = await readFile(new URL('./schema.sql', import.meta.url), 'utf8');
  const lending = await readFile(new URL('./migrations/0002_lending.sql', import.meta.url), 'utf8');
  const walletAuth = await readFile(new URL('./migrations/0003_wallet_auth.sql', import.meta.url), 'utf8');
  const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 1, connectionTimeoutMillis: 5000, statement_timeout: 10000 });
  pool.on('error', () => process.stderr.write('Mesh schema setup connection failed.\n'));
  let client;
  try {
    client = await pool.connect();
    await client.query('BEGIN');
    await client.query(schema);
    await client.query(lending);
    await client.query(walletAuth);
    await createStore(client).ready();
    await client.query('COMMIT');
    process.stdout.write('Falcon mesh schema version 3 created from the complete local history.\n');
  } catch {
    if (client) { try { await client.query('ROLLBACK'); } catch {} }
    throw new Error('Mesh schema setup failed. Verify the database target and whether the schema already exists.');
  } finally {
    client?.release();
    await pool.end();
  }
}

main().catch(error => { process.stderr.write(`${error.message}\n`); process.exitCode = 1; });
