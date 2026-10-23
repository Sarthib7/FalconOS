import { Pool } from 'pg';
import { createApi, parseOrigins, parseTokenHashes } from './http.mjs';
import { createResearchService } from './research/service.mjs';
import { createStore } from './store.mjs';
import { PUBLIC_OWNER_ID, createPublicGraphService } from './public-graph.mjs';
import { createLendingStore } from './lending-store.mjs';
import { prepareLending, verifySignedLending, verifyLendingValidity, readLendingReceipt } from './kamino.mjs';
import { createWalletAuth } from './wallet-auth.mjs';
import { createYieldService } from './yield-data.mjs';
import { createSupabaseSessionVerifier } from './auth.mjs';
import { readWalletStatus } from './wallet-status.mjs';
import { inspectTransaction } from './transaction-inspection.mjs';
import { COUNCIL_LIMITS } from './council/host.mjs';
import { createOmpTransport } from './council/omp-host.mjs';
import { createReviewJobStore } from './research/review-store.mjs';
import { createResearchReviewService } from './research/review-jobs.mjs';

function parseReviewOwners(value) {
  if (value === undefined) return [];
  let owners;
  try { owners = JSON.parse(value); } catch { throw new Error('FALCON_MESH_RESEARCH_REVIEW_OWNERS must be a JSON array of owner IDs.'); }
  if (!Array.isArray(owners) || owners.some(owner => typeof owner !== 'string' || !/^[a-z0-9_-]{1,64}$/.test(owner)
      || owner === PUBLIC_OWNER_ID) || new Set(owners).size !== owners.length) {
    throw new Error('FALCON_MESH_RESEARCH_REVIEW_OWNERS must be a JSON array of unique owner IDs.');
  }
  return owners;
}

const researchReviewOwners = parseReviewOwners(process.env.FALCON_MESH_RESEARCH_REVIEW_OWNERS);

const tokenHashes = parseTokenHashes(process.env.FALCON_MESH_TOKEN_HASHES);
const allowedOrigins = parseOrigins(process.env.FALCON_MESH_ORIGINS);
if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required.');
const port = Number(process.env.PORT || 8791);
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('PORT must be between 1 and 65535.');
const rateWindowMs = Number(process.env.FALCON_MESH_RATE_WINDOW_MS ?? 60000);
if (!Number.isInteger(rateWindowMs) || rateWindowMs < 1) throw new Error('FALCON_MESH_RATE_WINDOW_MS must be a positive integer.');
const rateMaxPerOwner = Number(process.env.FALCON_MESH_RATE_MAX_PER_OWNER ?? 120);
if (!Number.isInteger(rateMaxPerOwner) || rateMaxPerOwner < 1) throw new Error('FALCON_MESH_RATE_MAX_PER_OWNER must be a positive integer.');
const rateMaxGlobal = Number(process.env.FALCON_MESH_RATE_MAX_GLOBAL ?? 600);
if (!Number.isInteger(rateMaxGlobal) || rateMaxGlobal < 1) throw new Error('FALCON_MESH_RATE_MAX_GLOBAL must be a positive integer.');
const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 5, connectionTimeoutMillis: 5000, statement_timeout: 10000, idle_in_transaction_session_timeout: 15000 });
pool.on('error', () => process.stderr.write('Mesh database connection failed.\n'));
const store = createStore(pool);
const reviewJobStore = createReviewJobStore(pool);

let reviewTransport;
let researchReviewService;
try {
  reviewTransport = createOmpTransport();
  researchReviewService = createResearchReviewService({
    jobStore: reviewJobStore,
    transport: reviewTransport,
    allowedOwners: researchReviewOwners,
    runDeadlineMs: COUNCIL_LIMITS.runMs,
  });
} catch (error) {
  try { await reviewTransport?.abort?.(); }
  finally {
    try { await reviewTransport?.close?.(); }
    finally { await pool.end(); }
  }
  throw error;
}
const researchService = createResearchService({ store });
const publicGraph = createPublicGraphService({ store });
const lending = createLendingStore(pool, { meshStore: store, prepareLending,
  verifySignedLending: async (intent, transactionBase64) => {
    const signature = verifySignedLending(intent, transactionBase64);
    await verifyLendingValidity(intent);
    return signature;
  }, readLendingReceipt });
const yieldService = createYieldService();
const walletAuth = createWalletAuth(pool, { allowedOrigins });
const verifySupabaseToken = createSupabaseSessionVerifier({
  url: process.env.FALCON_SUPABASE_URL,
  publishableKey: process.env.FALCON_SUPABASE_PUBLISHABLE_KEY,
});
let server;
try {
  server = createApi({
    store, lending, yieldService, publicGraph, researchService, researchReviewService, walletAuth, tokenHashes, allowedOrigins, rateWindowMs, rateMaxPerOwner, rateMaxGlobal, verifySupabaseToken,
    walletStatus: readWalletStatus,
    transactionInspection: inspectTransaction,
  });
} catch (error) {
  try { await researchReviewService.close(); }
  finally { await pool.end(); }
  throw error;
}

let shutdownPromise;
async function shutdown() {
  if (shutdownPromise) return shutdownPromise;
  const watchdog = setTimeout(() => process.exit(1), 15_000).unref();
  shutdownPromise = (async () => {
    let stopped = Promise.resolve();
    try {
      if (server.listening) {
        stopped = new Promise(resolve => server.close(resolve));
        server.closeAllConnections();
      }
    } catch {
      process.exitCode = 1;
    }
    let reviewStopped;
    try { reviewStopped = researchReviewService.close(); }
    catch { process.exitCode = 1; reviewStopped = Promise.resolve(); }
    try { await stopped; } catch { process.exitCode = 1; }
    try { await reviewStopped; } catch { process.exitCode = 1; }
    try { await pool.end(); } catch { process.exitCode = 1; }
  })().finally(() => clearTimeout(watchdog));
  return shutdownPromise;
}
server.on('error', () => {
  process.stderr.write('Mesh HTTP service failed to start.\n');
  process.exitCode = 1;
  void shutdown();
});
process.once('SIGINT', () => void shutdown());
process.once('SIGTERM', () => void shutdown());
try {
  server.listen(port, process.env.FALCON_MESH_HOST || '127.0.0.1', () => process.stdout.write(`Falcon mesh listening on port ${port}.\n`));
} catch {
  process.stderr.write('Mesh HTTP service failed to start.\n');
  process.exitCode = 1;
  void shutdown();
}
