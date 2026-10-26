import { createHash } from 'node:crypto';
import { createServer } from 'node:http';
import { MeshError } from './domain.mjs';
import { CONNECTORS } from './live.mjs';
import { readWalletStatus } from './wallet-status.mjs';
import { inspectTransaction } from './transaction-inspection.mjs';
import { PUBLIC_OWNER_ID } from './public-graph.mjs';
import { projectActivity } from './activity.mjs';


const BODY_LIMIT = 1024 * 1024;
const ACTIVITY_LIMIT_BYTES = 1024 * 1024;

const EVIDENCE_EXCHANGES = 2;
const STATUSES = { INVALID_INPUT: 400, UNAUTHORIZED: 401, FORBIDDEN: 403, ORIGIN_DENIED: 403, NOT_FOUND: 404, CONFLICT: 409, TOO_LARGE: 413, RATE_LIMITED: 429, STORAGE_UNAVAILABLE: 503, AUTH_UNAVAILABLE: 503, INTERNAL_ERROR: 500 };

export function parseTokenHashes(raw) {
  let value;
  try { value = JSON.parse(raw); } catch { throw new Error('FALCON_MESH_TOKEN_HASHES must be a JSON object.'); }
  if (!value || Array.isArray(value) || typeof value !== 'object' || !Object.keys(value).length
      || Object.entries(value).some(([hash, owner]) => !/^[a-f0-9]{64}$/.test(hash) || typeof owner !== 'string' || !/^[a-z0-9_-]{1,64}$/.test(owner) || owner === PUBLIC_OWNER_ID)) {
    throw new Error('FALCON_MESH_TOKEN_HASHES must map SHA-256 hashes to owner slugs.');
  }
  return new Map(Object.entries(value));
}

export function parseOrigins(raw = '') {
  return new Set(raw.split(',').map(value => value.trim()).filter(Boolean).map(value => {
    let url;
    try { url = new URL(value); } catch { throw new Error('Mesh origins must be exact HTTP(S) origins.'); }
    if (url.origin !== value || url.username || url.password || (url.protocol !== 'https:'
        && !(url.protocol === 'http:' && ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)))) {
      throw new Error('Mesh origins require HTTPS or a loopback HTTP origin.');
    }
    return value;
  }));
}

function keys(value, expected) {
  if (!value || typeof value !== 'object' || Array.isArray(value)
      || Object.keys(value).length !== expected.length || expected.some(key => !Object.hasOwn(value, key))) {
    throw new MeshError('INVALID_INPUT', 'Request fields do not match the endpoint.');
  }
}

const RESEARCH_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const PUBLIC_NEAR_BASE = '/v1/public/research/near';
const PUBLIC_NEAR_CASE_ID = /^\/v1\/public\/research\/near\/cases\/([^/]+)$/;
const PUBLIC_NEAR_SOURCE_ID = /^\/v1\/public\/research\/near\/sources\/([^/]+)$/;
const PUBLIC_NEAR_CASE_PATH = PUBLIC_NEAR_BASE + '/case';
const PUBLIC_NEAR_REPLAY_PATH = PUBLIC_NEAR_BASE + '/replay';

function normalizeResearchUuid(value) {
  if (typeof value !== 'string' || !RESEARCH_UUID.test(value)) throw new MeshError('INVALID_INPUT', 'A valid UUID is required.');
  return value.toLowerCase();
}

function requireSessionLendingWallet(walletSession, wallet) {
  if (walletSession && wallet !== walletSession.walletAddress) {
    throw new MeshError('UNAUTHORIZED', 'Lending wallet must match the authenticated session wallet.');
  }
}

async function body(request, limit = BODY_LIMIT) {
  const tooLargeMessage = limit === BODY_LIMIT ? 'Request exceeds 1 MiB.' : 'Request exceeds the endpoint limit.';
  if (request.headers['content-type']?.split(';')[0].trim().toLowerCase() !== 'application/json') {
    throw new MeshError('INVALID_INPUT', 'Content-Type must be application/json.');
  }
  if (request.headers['content-encoding'] && request.headers['content-encoding'] !== 'identity') {
    throw new MeshError('INVALID_INPUT', 'Compressed request bodies are not supported.');
  }
  if (Number(request.headers['content-length']) > limit) throw new MeshError('TOO_LARGE', tooLargeMessage);
  const bytes = await new Promise((resolve, reject) => {
    const chunks = [];
    let length = 0;
    const onData = chunk => {
      length += chunk.length;
      if (length > limit) {
        request.removeListener('data', onData);
        request.resume();
        reject(new MeshError('TOO_LARGE', tooLargeMessage));
      } else chunks.push(chunk);
    };
    request.on('data', onData);
    request.once('end', () => resolve(Buffer.concat(chunks)));
    request.once('error', reject);
    request.once('aborted', () => reject(new MeshError('INVALID_INPUT', 'Request body was interrupted.')));
  });
  try {
    return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
  } catch { throw new MeshError('INVALID_INPUT', 'Request body must contain valid UTF-8 JSON.'); }
}

export function createApi({
  store, lending = null, yieldService = null, publicGraph = null, researchService = null, researchReviewService = null, researchActivity = null, cfo = null, walletAuth = null, tokenHashes, allowedOrigins = new Set(), now = () => new Date().toISOString(), verifySupabaseToken = null,
  rateWindowMs = 60000, rateMaxPerOwner = 120, rateMaxGlobal = 600,
  walletLookupMaxPerSource = 240, walletLookupMaxGlobal = rateMaxGlobal, clock = () => Date.now(),
  walletStatus = readWalletStatus, transactionInspection = inspectTransaction,
}) {
  if (!(tokenHashes instanceof Map) || !tokenHashes.size) throw new Error('Mesh authentication is required.');
  if ([...tokenHashes.values()].includes(PUBLIC_OWNER_ID)) throw new Error('The public graph namespace cannot be configured as an authenticated owner.');
  let windowStart = clock();
  let globalCount = 0;
  const ownerCounts = new Map();
  const rateLimit = owner => {
    const time = clock();
    if (time - windowStart >= rateWindowMs) { windowStart = time; globalCount = 0; ownerCounts.clear(); }
    const nextOwner = (ownerCounts.get(owner) || 0) + 1;
    const nextGlobal = globalCount + 1;
    if (nextOwner > rateMaxPerOwner || nextGlobal > rateMaxGlobal) {
      const error = new MeshError('RATE_LIMITED', 'Rate limit exceeded. Retry shortly.');
      error.retryAfter = Math.max(1, Math.ceil((windowStart + rateWindowMs - time) / 1000));
      throw error;
    }
    ownerCounts.set(owner, nextOwner);
    globalCount = nextGlobal;
  };
  // Reserve before pre-auth reads; successful auth lookups release, while public reads keep their slot.
  // In-flight reservations are counted too, so concurrent requests cannot outrun the budget.
  let lookupWindowStart = clock();
  let lookupGlobal = 0;
  const lookupSources = new Map();
  const reserveWalletLookup = source => {
    const time = clock();
    if (time - lookupWindowStart >= rateWindowMs) {
      lookupWindowStart = time; lookupGlobal = 0; lookupSources.clear();
    }
    const count = lookupSources.get(source) || 0;
    if (count >= walletLookupMaxPerSource || lookupGlobal >= walletLookupMaxGlobal) {
      const error = new MeshError('RATE_LIMITED', 'Rate limit exceeded. Retry shortly.');
      error.retryAfter = Math.max(1, Math.ceil((lookupWindowStart + rateWindowMs - time) / 1000));
      throw error;
    }
    lookupSources.set(source, count + 1);
    lookupGlobal++;
    const reservedWindow = lookupWindowStart;
    return () => {
      if (lookupWindowStart !== reservedWindow) return;
      const remaining = lookupSources.get(source) - 1;
      if (remaining) lookupSources.set(source, remaining);
      else lookupSources.delete(source);
      lookupGlobal--;
    };
  };
  const server = createServer({ maxHeaderSize: 8192, requestTimeout: 15000, headersTimeout: 10000 }, async (request, response) => {
    const send = (status, payload, maxBytes = null) => {
      const serialized = JSON.stringify(payload);
      if (maxBytes !== null && Buffer.byteLength(serialized, 'utf8') > maxBytes) {
        throw new MeshError('TOO_LARGE', 'Activity response exceeds 1 MiB.');
      }
      response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
      response.end(serialized);
    };
    try {
      const origin = request.headers.origin;
      if (origin) {
        if (!allowedOrigins.has(origin)) throw new MeshError('ORIGIN_DENIED', 'This browser origin is not allowed.');
        response.setHeader('Access-Control-Allow-Origin', origin);
        response.setHeader('Vary', 'Origin');
      }
      const url = new URL(request.url, 'http://mesh.invalid');
      if (url.search) throw new MeshError('INVALID_INPUT', 'Query parameters are not supported.');
      if (request.method === 'OPTIONS') {
        if (!origin || !url.pathname.startsWith('/v1/')) throw new MeshError('ORIGIN_DENIED', 'A permitted browser origin is required.');
        const requestedHeaders = (request.headers['access-control-request-headers'] || '').toLowerCase().split(',').map(value => value.trim()).filter(Boolean);
        if (!['GET', 'POST'].includes(request.headers['access-control-request-method']) || requestedHeaders.some(name => !['authorization', 'content-type'].includes(name))) {
          throw new MeshError('ORIGIN_DENIED', 'This cross-origin request is not allowed.');
        }
        response.writeHead(204, { 'Access-Control-Allow-Methods': 'GET, POST', 'Access-Control-Allow-Headers': 'Authorization, Content-Type', 'Access-Control-Max-Age': '300' });
        response.end(); return;
      }
      if (request.method === 'GET' && url.pathname === '/healthz') { send(200, { status: 'alive' }); return; }
      if (request.method === 'GET' && url.pathname === '/readyz') {
        try { await store.ready(); await walletAuth?.ready(); send(200, { status: 'ready' }); }
        catch (error) {
          process.stderr.write(`readyz store.ready failed: ${error?.code || error?.name || 'UnknownError'}\n`);
          send(503, { error: { code: 'STORAGE_UNAVAILABLE', message: 'Mesh storage is not ready.' } });
        }
        return;
      }
      if (url.pathname === '/v1/public/graph/live') {
        if (request.method !== 'GET') throw new MeshError('NOT_FOUND', 'Endpoint not found.');
        reserveWalletLookup(request.socket.remoteAddress || 'unknown');
        if (request.headers.authorization || Number(request.headers['content-length'] || 0) > 0 || request.headers['transfer-encoding']) {
          throw new MeshError('INVALID_INPUT', 'The public graph does not accept credentials or a request body.');
        }
        if (!publicGraph) throw new MeshError('STORAGE_UNAVAILABLE', 'The public graph service is not configured.');
        send(200, await publicGraph.get()); return;
      }
      if (url.pathname === '/v1/wallet/status' || url.pathname === '/v1/transactions/decode') {
        if (request.method !== 'POST') throw new MeshError('NOT_FOUND', 'Endpoint not found.');
        // Public reads retain their reservation on success; auth lookups release only after validation.
        reserveWalletLookup(request.socket.remoteAddress || 'unknown');
        const isStatus = url.pathname === '/v1/wallet/status';
        const input = await body(request, isStatus ? 512 : 4096);
        const result = await (isStatus ? walletStatus(input) : transactionInspection(input));
        send(200, result); return;
      }
      const publicResearchPath = url.pathname === PUBLIC_NEAR_BASE || url.pathname.startsWith(PUBLIC_NEAR_BASE + '/');
      if (publicResearchPath) {
        const caseMatch = PUBLIC_NEAR_CASE_ID.exec(url.pathname);
        const sourceMatch = PUBLIC_NEAR_SOURCE_ID.exec(url.pathname);
        const isCaseRoot = url.pathname === PUBLIC_NEAR_CASE_PATH;
        const isReplay = url.pathname === PUBLIC_NEAR_REPLAY_PATH;
        const expectedMethod = isReplay ? 'POST' : 'GET';
        if ((!caseMatch && !sourceMatch && !isCaseRoot && !isReplay) || request.method !== expectedMethod) {
          throw new MeshError('NOT_FOUND', 'Public research endpoint not found.');
        }
        reserveWalletLookup(request.socket.remoteAddress || 'unknown');
        const hasCredential = ['authorization', 'cookie', 'proxy-authorization', 'x-api-key'].some(name => Object.hasOwn(request.headers, name));
        const hasGetBody = !isReplay && (Number(request.headers['content-length'] || 0) > 0 || request.headers['transfer-encoding']);
        if (hasCredential || hasGetBody) throw new MeshError('INVALID_INPUT', 'Public research endpoints do not accept credentials or GET bodies.');
        if (!researchService) throw new MeshError('STORAGE_UNAVAILABLE', 'The research service is not configured.');
        if (isCaseRoot) {
          const result = await researchService.getPublicCase();
          if (result == null) throw new MeshError('NOT_FOUND', 'Public research case not found.');
          send(200, result); return;
        }
        if (caseMatch) {
          const caseId = normalizeResearchUuid(caseMatch[1]);
          const result = await researchService.getPublicCase(caseId);
          if (result == null) throw new MeshError('NOT_FOUND', 'Public research case not found.');
          send(200, result); return;
        }
        if (sourceMatch) {
          const revisionId = normalizeResearchUuid(sourceMatch[1]);
          const source = await researchService.getPublicSource(revisionId);
          if (source == null) throw new MeshError('NOT_FOUND', 'Public research source not found.');
          send(200, { ...source, executionReady: false }); return;
        }
        const input = await body(request); keys(input, ['caseId']);
        const caseId = normalizeResearchUuid(input.caseId);
        const result = await researchService.replayPublicCase({ caseId });
        if (result == null) throw new MeshError('NOT_FOUND', 'Public research case not found.');
        send(200, result); return;
      }
      if (url.pathname.startsWith('/v1/auth/wallet/')) {
        if (!walletAuth) throw new MeshError('AUTH_UNAVAILABLE', 'Wallet authentication is not configured.');
        if (!origin || !allowedOrigins.has(origin)) throw new MeshError('ORIGIN_DENIED', 'A permitted browser origin is required.');
        const walletBearer = /^Bearer ([A-Za-z0-9._~-]{32,4096})$/.exec(request.headers.authorization || '')?.[1] ?? null;
        if (request.method === 'POST' && url.pathname === '/v1/auth/wallet/challenge') {
          rateLimit('wallet-auth:' + (request.socket.remoteAddress || 'unknown'));
          const input = await body(request); keys(input, ['address']);
          send(200, await walletAuth.createChallenge(input.address, origin)); return;
        }
        if (request.method === 'POST' && url.pathname === '/v1/auth/wallet/verify') {
          rateLimit('wallet-auth:' + (request.socket.remoteAddress || 'unknown'));
          const input = await body(request); keys(input, ['challengeId', 'signature']);
          send(200, await walletAuth.verifyChallenge(input.challengeId, input.signature, origin)); return;
        }
        if (request.method === 'GET' && url.pathname === '/v1/auth/wallet/session') {
          const release = walletBearer && reserveWalletLookup(request.socket.remoteAddress || 'unknown');
          const session = await walletAuth.getSession(walletBearer);
          if (!session) throw new MeshError('UNAUTHORIZED', 'A valid wallet session is required.');
          release?.();
          send(200, session); return;
        }
        if (request.method === 'POST' && url.pathname === '/v1/auth/wallet/logout') {
          const input = await body(request); keys(input, []);
          const release = walletBearer && reserveWalletLookup(request.socket.remoteAddress || 'unknown');
          if (!await walletAuth.revokeSession(walletBearer)) throw new MeshError('UNAUTHORIZED', 'A valid wallet session is required.');
          release?.();
          send(200, { revoked: true }); return;
        }
        throw new MeshError('NOT_FOUND', 'Wallet authentication endpoint not found.');
      }
      const bearer = /^Bearer ([A-Za-z0-9._~-]{32,4096})$/.exec(request.headers.authorization || '')?.[1] ?? null;
      const meshToken = bearer && bearer.length <= 256 ? bearer : null;
      const meshOwner = meshToken && tokenHashes.get(createHash('sha256').update(meshToken).digest('hex'));
      let owner = meshOwner;
      let walletSession = null;
      // Wallet-session auth for owner-scoped endpoints
      if (!owner && bearer?.startsWith('wsi1_')) {
        if (!walletAuth) throw new MeshError('AUTH_UNAVAILABLE', 'Wallet authentication is not configured.');
        const release = reserveWalletLookup(request.socket.remoteAddress || 'unknown');
        walletSession = await walletAuth.getSession(bearer);
        if (!walletSession) throw new MeshError('UNAUTHORIZED', 'A valid wallet session is required.');
        release();
        owner = walletSession.ownerId;
      }
      // Supabase JWT auth for yield routes only
      if (url.pathname.startsWith('/v1/yield/') && !owner) {
        if (!bearer) throw new MeshError('UNAUTHORIZED', 'A valid access token is required.');
        if (typeof verifySupabaseToken !== 'function') throw new MeshError('AUTH_UNAVAILABLE', 'Supabase authentication is not configured.');
        try {
          const userId = await verifySupabaseToken(bearer);
          if (typeof userId !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(userId)) {
            throw new MeshError('UNAUTHORIZED', 'A valid Supabase session is required.');
          }
          owner = userId;
        } catch (error) {
          if (error instanceof MeshError) throw error;
          if (error?.code === 'SUPABASE_AUTH_RATE_LIMITED') {
            const limited = new MeshError('RATE_LIMITED', 'Supabase session verification is rate limited. Retry shortly.');
            limited.retryAfter = Number.isInteger(error.retryAfter) ? error.retryAfter : 60;
            throw limited;
          }
          throw new MeshError('AUTH_UNAVAILABLE', 'User authentication is unavailable.');
        }
      }
      if (!owner) throw new MeshError('UNAUTHORIZED', 'A valid mesh access token is required.');
      rateLimit(owner);
      if (url.pathname === '/v1/cfo' || url.pathname.startsWith('/v1/cfo/')) {
        if (!walletSession?.walletAddress) {
          throw new MeshError('UNAUTHORIZED', 'CFO access requires a verified wallet session. Operator tokens cannot authorize funds.');
        }
        if (!cfo) throw new MeshError('STORAGE_UNAVAILABLE', 'The CFO service is not configured.');
        const wallet = walletSession.walletAddress;
        if (request.method === 'GET') {
          if (Number(request.headers['content-length'] || 0) > 0 || request.headers['transfer-encoding']) {
            request.resume();
            throw new MeshError('INVALID_INPUT', 'CFO reads do not accept a body.');
          }
          if (url.pathname === '/v1/cfo') {
            send(200, await cfo.overview(owner, wallet), ACTIVITY_LIMIT_BYTES);
            return;
          }
          const recordPath = /^\/v1\/cfo\/records\/([^/]+)$/.exec(url.pathname);
          if (recordPath) {
            const record = await cfo.getRecord(owner, wallet, normalizeResearchUuid(recordPath[1]));
            if (!record) throw new MeshError('NOT_FOUND', 'CFO record not found.');
            send(200, { record }, ACTIVITY_LIMIT_BYTES);
            return;
          }
          throw new MeshError('NOT_FOUND', 'CFO endpoint not found.');
        }
        const routes = {
          '/v1/cfo/mandate': ['saveMandate', ['requestId', 'mandate']],
          '/v1/cfo/capture': ['capturePortfolio', ['requestId']],
          '/v1/cfo/plans': ['planCycle', ['requestId', 'action', 'sourceAssetId', 'targetAssetId', 'inputBaseUnits']],
          '/v1/cfo/prepare': ['prepareAction', ['requestId', 'planId']],
          '/v1/cfo/signatures': ['registerSignedAction', ['requestId', 'actionId', 'signatureBase64']],
          '/v1/cfo/relay': ['relaySignedAction', ['requestId', 'actionId']],
          '/v1/cfo/reconcile': ['reconcileAction', ['requestId', 'actionId']],
          '/v1/cfo/monitor': ['setMonitor', ['requestId', 'enabled']],
        };
        const route = routes[url.pathname];
        if (request.method !== 'POST' || !route) throw new MeshError('NOT_FOUND', 'CFO endpoint not found.');
        const input = await body(request, 64 * 1024);
        keys(input, route[1]);
        normalizeResearchUuid(input.requestId);
        if (route[0] === 'saveMandate') {
          if (!input.mandate || typeof input.mandate !== 'object' || Array.isArray(input.mandate)) {
            throw new MeshError('INVALID_INPUT', 'A CFO mandate is required.');
          }
          if (Object.hasOwn(input.mandate, 'wallet') && input.mandate.wallet !== wallet) {
            throw new MeshError('UNAUTHORIZED', 'The mandate wallet must match the verified session.');
          }
          input.mandate = { ...input.mandate, wallet };
        }
        send(200, await cfo[route[0]](owner, wallet, input), ACTIVITY_LIMIT_BYTES);
        return;
      }
      if (url.pathname === '/v1/research/near/activity' || url.pathname === '/v1/activity') {
        if (request.method !== 'GET') throw new MeshError('NOT_FOUND', 'Activity endpoint not found.');
        if (Number(request.headers['content-length'] || 0) > 0 || request.headers['transfer-encoding']) {
          request.resume();
          throw new MeshError('INVALID_INPUT', 'Activity endpoints do not accept request bodies.');
        }
        if (!researchActivity || typeof researchActivity.get !== 'function') {
          throw new MeshError('STORAGE_UNAVAILABLE', 'The activity service is not configured.');
        }
        if (url.pathname === '/v1/research/near/activity') {
          send(200, await researchActivity.get(owner), ACTIVITY_LIMIT_BYTES);
          return;
        }
        if (typeof store?.listDecisions !== 'function' || typeof lending?.list !== 'function') {
          throw new MeshError('STORAGE_UNAVAILABLE', 'The activity service is not configured.');
        }
        const [decisions, intents, research] = await Promise.all([
          store.listDecisions(owner),
          lending.list(owner),
          researchActivity.get(owner),
        ]);
        send(200, projectActivity({ decisions, intents, research }), ACTIVITY_LIMIT_BYTES);
        return;
      }

      if (url.pathname === '/v1/research/near/adopt') {
        if (request.method !== 'POST') throw new MeshError('NOT_FOUND', 'Research endpoint not found.');
        const input = await body(request); keys(input, ['requestId', 'publicCaseId']);
        const adoption = {
          requestId: normalizeResearchUuid(input.requestId),
          publicCaseId: normalizeResearchUuid(input.publicCaseId),
        };
        if (!researchService) throw new MeshError('STORAGE_UNAVAILABLE', 'The research service is not configured.');
        send(200, await researchService.adoptCase(owner, adoption)); return;
      }
      if (url.pathname === '/v1/research/near/review') {
        if (request.method !== 'POST') throw new MeshError('NOT_FOUND', 'Research endpoint not found.');
        const input = await body(request, 1024); keys(input, ['requestId', 'analysisId']);
        const review = {
          requestId: normalizeResearchUuid(input.requestId),
          analysisId: normalizeResearchUuid(input.analysisId),
        };
        if (!researchReviewService) throw new MeshError('STORAGE_UNAVAILABLE', 'The research review service is not configured.');
        send(200, await researchReviewService.review(owner, review)); return;
      }
      if (url.pathname === '/v1/public/graph/adopt') {
        if (request.method !== 'POST') throw new MeshError('NOT_FOUND', 'Endpoint not found.');
        const input = await body(request); keys(input, ['requestId', 'reserveRequestId']);
        send(200, await store.adoptPublicGraph(owner, input, now())); return;
      }
      if (url.pathname === '/v1/public/decisions/reserve') {
        if (request.method !== 'POST') throw new MeshError('NOT_FOUND', 'Endpoint not found.');
        const input = await body(request); keys(input, ['requestId', 'analysisId', 'scenario']);
        send(200, { record: await store.createPublicDecision(owner, input, now()) }); return;
      }
      if (url.pathname === '/v1/public/lending/intents') {
        if (request.method !== 'POST') throw new MeshError('NOT_FOUND', 'Endpoint not found.');
        if (!lending) throw new MeshError('STORAGE_UNAVAILABLE', 'The lending service is not configured.');
        const input = await body(request);
        keys(input, ['requestId', 'analysisId', 'wallet', 'action', 'inputBaseUnits', ...(input && typeof input === 'object' && Object.hasOwn(input, 'decisionId') ? ['decisionId'] : [])]);
        requireSessionLendingWallet(walletSession, input.wallet);
        send(200, { record: await lending.preparePublic(owner, input) }); return;
      }
      if (url.pathname.startsWith('/v1/yield/')) {
        if (!yieldService) throw new MeshError('STORAGE_UNAVAILABLE', 'The yield simulation service is not configured.');
        if (request.method === 'GET' && url.pathname === '/v1/yield/opportunities') {
          send(200, await yieldService.getOpportunities()); return;
        }
        if (request.method === 'POST' && url.pathname === '/v1/yield/simulations') {
          const input = await body(request); keys(input, ['requestId', 'simulatedAt', 'portfolio', 'policy']);
          let plan;
          try { plan = await yieldService.simulate(input); }
          catch (error) { if (error instanceof MeshError) throw error; throw new MeshError('INVALID_INPUT', 'Simulation request does not match the yield plan contract.'); }
          send(200, { plan }); return;
        }
        throw new MeshError('NOT_FOUND', 'Yield endpoint not found.');
      }
      if (url.pathname.startsWith('/v1/lending/')) {
        if (!lending) throw new MeshError('STORAGE_UNAVAILABLE', 'The lending service is not configured.');
        if (url.pathname === '/v1/lending/intents') {
          if (request.method === 'GET') { send(200, { records: await lending.list(owner), limit: 20 }); return; }
          if (request.method === 'POST') {
            const input = await body(request);
            keys(input, ['requestId', 'analysisId', 'wallet', 'action', 'inputBaseUnits', ...(input && typeof input === 'object' && Object.hasOwn(input, 'decisionId') ? ['decisionId'] : [])]);
            requireSessionLendingWallet(walletSession, input.wallet);
            send(200, { record: await lending.prepare(owner, input) }); return;
          }
        }
        const match = /^\/v1\/lending\/intents\/([a-f0-9-]{36})(?:\/(submit|receipt))?$/i.exec(url.pathname);
        if (match && request.method === 'GET' && !match[2]) {
          const result = await lending.get(owner, match[1]);
          if (!result) throw new MeshError('NOT_FOUND', 'Lending record not found.');
          send(200, result); return;
        }
        if (match && request.method === 'POST' && match[2]) {
          const input = await body(request); keys(input, match[2] === 'submit' ? ['requestId', 'transactionBase64'] : ['requestId']);
          if (walletSession) {
            const existing = await lending.get(owner, match[1]);
            if (!existing) throw new MeshError('NOT_FOUND', 'Lending record not found.');
            requireSessionLendingWallet(walletSession, existing.record?.request?.wallet);
          }
          send(200, { event: await lending[match[2]](owner, match[1], input) }); return;
        }
        throw new MeshError('NOT_FOUND', 'Lending endpoint not found.');
      }
      if (request.method === 'GET' && url.pathname === '/v1/graph') { send(200, { graph: await store.getGraph(owner, now()) }); return; }
      if (request.method === 'GET' && url.pathname === '/v1/graph/live') { send(200, { graph: await store.getGraph(owner, now(), 'live') }); return; }
      if (request.method === 'GET' && url.pathname === '/v1/connectors') { send(200, { connectors: CONNECTORS }); return; }
      if (request.method === 'POST' && url.pathname === '/v1/captures') {
        const input = await body(request); keys(input, ['requestId', 'connectorId', 'expectedRevisionId']);
        send(200, { source: await store.captureSource(owner, input) }); return;
      }
      if (request.method === 'POST' && url.pathname === '/v1/sources') {
        const input = await body(request); keys(input, ['revisions']);
        send(200, { sources: await store.ingestSources(owner, input.revisions, now()) }); return;
      }
      if (request.method === 'POST' && ['/v1/analyses', '/v1/analyses/live'].includes(url.pathname)) {
        const input = await body(request); keys(input, ['requestId', 'observationId', 'maxHops']);
        send(200, { record: await store.createAnalysis(owner, input, now(), url.pathname.endsWith('/live') ? 'live' : 'synthetic') }); return;
      }
      if (request.method === 'GET' && url.pathname === '/v1/analyses') {
        send(200, { records: await store.listAnalyses(owner), limit: 20 }); return;
      }
      if (request.method === 'POST' && url.pathname === '/v1/decisions/reserve') {
        const input = await body(request); keys(input, ['requestId', 'scenario']);
        send(200, { record: await store.createDecision(owner, input, now()) }); return;
      }
      if (request.method === 'GET' && url.pathname === '/v1/decisions') {
        send(200, { records: await store.listDecisions(owner), limit: 20 }); return;
      }
      const decision = /^\/v1\/decisions\/([a-f0-9-]{36})$/i.exec(url.pathname);
      if (request.method === 'GET' && decision) {
        const record = await store.getDecision(owner, decision[1]);
        if (!record) throw new MeshError('NOT_FOUND', 'Decision record not found.');
        send(200, { record }); return;
      }
      const resource = /^\/v1\/(sources|analyses)\/([a-f0-9-]{36})$/i.exec(url.pathname);
      if (request.method === 'GET' && resource) {
        const result = resource[1] === 'sources' ? await store.getSource(owner, resource[2]) : await store.getAnalysis(owner, resource[2]);
        if (!result) throw new MeshError('NOT_FOUND', 'Record not found.');
        send(200, { [resource[1] === 'sources' ? 'source' : 'record']: result }); return;
      }
      throw new MeshError('NOT_FOUND', 'Endpoint not found.');
    } catch (error) {
      if (response.headersSent) { response.destroy(); return; }
      const known = error instanceof MeshError && Object.hasOwn(STATUSES, error.code);
      const code = known ? error.code : 'STORAGE_UNAVAILABLE';
      if (request.method === 'POST') request.resume();
      if (known && code === 'RATE_LIMITED' && Number.isInteger(error.retryAfter)) response.setHeader('Retry-After', String(error.retryAfter));
      // Prepare failures attach already-JSON-safe external RPC exchanges (kamino.mjs). Surface the last few, bounded; never for the unknown-error fallback.
      const evidence = known && !request.url?.startsWith('/v1/public/') && Array.isArray(error.evidence?.exchanges) ? { exchanges: error.evidence.exchanges.slice(-EVIDENCE_EXCHANGES) } : null;
      send(STATUSES[code], { error: { code, message: known ? error.message : 'Mesh storage could not complete the request.', ...(evidence && { evidence }) } });
    }
  });
  server.maxRequestsPerSocket = 100;
  return server;
}
