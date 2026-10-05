import { createHash } from 'node:crypto';
import { createServer } from 'node:http';
import { MeshError } from './domain.mjs';
import { CONNECTORS } from './live.mjs';

const BODY_LIMIT = 1024 * 1024;
const EVIDENCE_EXCHANGES = 2;
const STATUSES = { INVALID_INPUT: 400, UNAUTHORIZED: 401, ORIGIN_DENIED: 403, NOT_FOUND: 404, CONFLICT: 409, TOO_LARGE: 413, RATE_LIMITED: 429, STORAGE_UNAVAILABLE: 503, AUTH_UNAVAILABLE: 503, INTERNAL_ERROR: 500 };

export function parseTokenHashes(raw) {
  let value;
  try { value = JSON.parse(raw); } catch { throw new Error('FALCON_MESH_TOKEN_HASHES must be a JSON object.'); }
  if (!value || Array.isArray(value) || typeof value !== 'object' || !Object.keys(value).length
      || Object.entries(value).some(([hash, owner]) => !/^[a-f0-9]{64}$/.test(hash) || typeof owner !== 'string' || !/^[a-z0-9_-]{1,64}$/.test(owner))) {
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

async function body(request) {
  if (request.headers['content-type']?.split(';')[0].trim().toLowerCase() !== 'application/json') {
    throw new MeshError('INVALID_INPUT', 'Content-Type must be application/json.');
  }
  if (request.headers['content-encoding'] && request.headers['content-encoding'] !== 'identity') {
    throw new MeshError('INVALID_INPUT', 'Compressed request bodies are not supported.');
  }
  if (Number(request.headers['content-length']) > BODY_LIMIT) throw new MeshError('TOO_LARGE', 'Request exceeds 1 MiB.');
  const bytes = await new Promise((resolve, reject) => {
    const chunks = [];
    let length = 0;
    const onData = chunk => {
      length += chunk.length;
      if (length > BODY_LIMIT) {
        request.removeListener('data', onData);
        request.resume();
        reject(new MeshError('TOO_LARGE', 'Request exceeds 1 MiB.'));
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
  store, lending = null, yieldService = null, walletAuth = null, tokenHashes, allowedOrigins = new Set(), now = () => new Date().toISOString(), verifySupabaseToken = null,
  rateWindowMs = 60000, rateMaxPerOwner = 120, rateMaxGlobal = 600, clock = () => Date.now(),
}) {
  if (!(tokenHashes instanceof Map) || !tokenHashes.size) throw new Error('Mesh authentication is required.');
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
  const server = createServer({ maxHeaderSize: 8192, requestTimeout: 15000, headersTimeout: 10000 }, async (request, response) => {
    const send = (status, payload) => {
      response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
      response.end(JSON.stringify(payload));
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
          const session = await walletAuth.getSession(walletBearer);
          if (!session) throw new MeshError('UNAUTHORIZED', 'A valid wallet session is required.');
          send(200, session); return;
        }
        if (request.method === 'POST' && url.pathname === '/v1/auth/wallet/logout') {
          const input = await body(request); keys(input, []);
          if (!await walletAuth.revokeSession(walletBearer)) throw new MeshError('UNAUTHORIZED', 'A valid wallet session is required.');
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
        walletSession = await walletAuth.getSession(bearer);
        if (!walletSession) throw new MeshError('UNAUTHORIZED', 'A valid wallet session is required.');
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
            // decisionId is the only optional key; the lending store requires it for supply and forbids it for redeem.
            keys(input, ['requestId', 'analysisId', 'wallet', 'action', 'inputBaseUnits', ...(input && typeof input === 'object' && Object.hasOwn(input, 'decisionId') ? ['decisionId'] : [])]);
            // For lending prepare, require wallet === session.walletAddress when using wallet-session auth
            if (walletSession && input.wallet !== walletSession.walletAddress) {
              throw new MeshError('UNAUTHORIZED', 'Lending wallet must match the authenticated session wallet.');
            }
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
      if (known && code === 'RATE_LIMITED' && Number.isInteger(error.retryAfter)) response.setHeader('Retry-After', String(error.retryAfter));
      if (request.method === 'POST') request.resume();
      if (known && code === 'RATE_LIMITED' && Number.isInteger(error.retryAfter)) response.setHeader('Retry-After', String(error.retryAfter));
      // Prepare failures attach already-JSON-safe external RPC exchanges (kamino.mjs). Surface the last few, bounded; never for the unknown-error fallback.
      const evidence = known && Array.isArray(error.evidence?.exchanges) ? { exchanges: error.evidence.exchanges.slice(-EVIDENCE_EXCHANGES) } : null;
      send(STATUSES[code], { error: { code, message: known ? error.message : 'Mesh storage could not complete the request.', ...(evidence && { evidence }) } });
    }
  });
  server.maxRequestsPerSocket = 100;
  return server;
}
