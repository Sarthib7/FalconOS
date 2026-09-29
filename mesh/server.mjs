import { Pool } from 'pg';
import { createApi, parseOrigins, parseTokenHashes } from './http.mjs';
import { createStore } from './store.mjs';
import { createLendingStore } from './lending-store.mjs';
import { prepareLending, verifySignedLending, readLendingReceipt } from './kamino.mjs';

const tokenHashes = parseTokenHashes(process.env.FALCON_MESH_TOKEN_HASHES);
const allowedOrigins = parseOrigins(process.env.FALCON_MESH_ORIGINS);
if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required.');
const port = Number(process.env.PORT || 8791);
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('PORT must be between 1 and 65535.');
const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 5, connectionTimeoutMillis: 5000, statement_timeout: 10000, idle_in_transaction_session_timeout: 15000 });
pool.on('error', () => process.stderr.write('Mesh database connection failed.\n'));
const store = createStore(pool);
const lending = createLendingStore(pool, { meshStore: store, prepareLending, verifySignedLending, readLendingReceipt });
const server = createApi({ store, lending, tokenHashes, allowedOrigins });
server.on('error', () => { process.stderr.write('Mesh HTTP service failed to start.\n'); process.exitCode = 1; void pool.end(); });
server.listen(port, process.env.FALCON_MESH_HOST || '127.0.0.1', () => process.stdout.write(`Falcon mesh listening on port ${port}.\n`));
let closing = false;
async function shutdown() {
  if (closing) return;
  closing = true;
  const timer = setTimeout(() => process.exit(1), 15000).unref();
  server.closeAllConnections();
  await new Promise(resolve => server.close(resolve));
  await pool.end();
  clearTimeout(timer);
}
process.once('SIGINT', () => void shutdown());
process.once('SIGTERM', () => void shutdown());
