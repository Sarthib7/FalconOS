import { once } from 'node:events';
import { createServer } from 'node:http';
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';
import { parseConfig } from '../../src/config.mjs';
import { createApp } from '../../src/http.mjs';

export const ORIGIN = 'https://mcp.falcon.test';
export const RESOURCE = 'https://mcp.falcon.test/mcp';
export const SERVICE_SECRET = 'B'.repeat(43);
export const ACCESS_TOKEN = 'fao1_' + 'A'.repeat(43);
export const WALLET = '9xQeWvG816bUx9EPjHmaT23yvVM2ZWbrrpZb9PusVFin';
export const OWNER_ID = 'wallet_' + 'a'.repeat(56);
export const IDS = {
  analysis: '22222222-2222-4222-8222-222222222222',
  reserveAnalysis: '66666666-6666-4666-8666-666666666666',
  decision: '33333333-3333-4333-8333-333333333333',
  intent: '44444444-4444-4444-8444-444444444444',
  head: '55555555-5555-4555-8555-555555555555',
};
export const UNSIGNED_TX = 'AQAAunsignedTransactionBytesForTests//AAAA==';
export const SIGNED_TX = 'AQBBsignedTransactionBytesForTests//BBBB==';

const PROGRAM = 'observation:live:solana-devnet-klend';
const RESERVE = 'observation:live:solana-devnet-reserve-liquidity';

function json(value) { return { status: 200, body: value }; }

function defaults(call) {
  const id = IDS.intent;
  const event = (kind, data) => ({ id: 'e1', requestId: 'r1', intentId: id, createdAt: '2026-10-05T10:00:00.000Z', kind, data });
  return {
    'POST /v1/oauth/introspect': () => json(call.headers.authorization === 'Bearer ' + ACCESS_TOKEN
      ? { active: true, clientId: 'https://client.example/metadata.json', scopes: ['falcon'], resource: RESOURCE, ownerId: OWNER_ID, walletAddress: WALLET, expiresAt: '2099-10-05T10:00:00.000Z' }
      : { active: false }),
    'GET /v1/yield/opportunities': () => json({ status: 'READY', provider: 'defillama', opportunities: [{ poolId: 'p1', apy: 4.2 }] }),
    'GET /v1/graph/live': () => json({ graph: { sources: [{ revisionId: IDS.head, sourceKey: 'live:kamino-program-docs' }] } }),
    'POST /v1/captures': () => json({ source: { revisionId: call.body.requestId, sourceKey: 'live:' + call.body.connectorId, capturedAt: '2026-10-05T10:00:00.000Z' } }),
    'POST /v1/analyses/live': c => c.body?.observationId === RESERVE
      ? json({ record: { id: IDS.reserveAnalysis, analysis: { status: 'OBSERVED', summary: 'Reserve observed.' } } })
      : json({ record: { id: IDS.analysis, graph: { nodes: [{ id: RESERVE, properties: { status: 'ok', slot: 123, availableLiquidityUnits: '5000000' } }] }, analysis: { status: 'OBSERVED', summary: 'Evidence observed.', observationId: PROGRAM } } }),
    'POST /v1/decisions/reserve': () => json({ record: { id: IDS.decision, analysis: { status: 'REVIEW', summary: 'Review the supply.', checks: [{ id: 'liquidity', status: 'PASS' }], expiresAt: '2026-10-05T10:05:00.000Z', limits: ['Not approval.'] } } }),
    'POST /v1/lending/intents': () => json({ record: { id, intent: { transactionBase64: UNSIGNED_TX, messageSha256: 'ab'.repeat(32) } } }),
    ['POST /v1/lending/intents/' + id + '/submit']: () => json({ event: event('SUBMITTED', { signature: 'txsig', transactionSha256: 'cd'.repeat(32), transactionBase64: SIGNED_TX }) }),
    ['POST /v1/lending/intents/' + id + '/receipt']: () => json({ event: event('RECEIPT', { status: 'CONFIRMED', signature: 'txsig' }) }),
    'GET /v1/decisions': () => json({ records: [{ id: IDS.decision, createdAt: '2026-10-05T10:00:00.000Z', analysis: { status: 'REVIEW', summary: 'Review the supply.', expiresAt: '2026-10-05T10:05:00.000Z' } }], limit: 20 }),
    'GET /v1/lending/intents': () => json({ records: [{ id, requestId: 'r1', analysisId: IDS.analysis, createdAt: '2026-10-05T10:01:00.000Z', request: { wallet: WALLET, action: 'supply', inputBaseUnits: '1000000', decisionId: IDS.decision }, status: 'SUBMITTED', signature: 'txsig' }], limit: 20 }),
  };
}

const BODY_KEYS = {
  'POST /v1/analyses/live': ['requestId', 'observationId', 'maxHops'],
  'POST /v1/captures': ['requestId', 'connectorId', 'expectedRevisionId'],
};
const sameKeys = (body, expected) => body && typeof body === 'object' && !Array.isArray(body)
  && Object.keys(body).length === expected.length && expected.every(key => Object.hasOwn(body, key));

// Fake Mesh. Protected routes require both the OAuth bearer and private service secret.
export async function startFakeMesh(overrides = {}) {
  const calls = [];
  const sockets = new Set();
  const server = createServer(async (request, response) => {
    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);
    const raw = Buffer.concat(chunks).toString('utf8');
    let body = null;
    try { body = raw ? JSON.parse(raw) : null; } catch { body = null; }
    const path = new URL(request.url, 'http://fake.mesh').pathname;
    const call = { method: request.method, path: request.url, pathname: path, headers: request.headers, raw, body };
    calls.push(call);
    const send = (status, payload, headers = {}) => { response.writeHead(status, { 'Content-Type': 'application/json', ...headers }); response.end(typeof payload === 'string' ? payload : JSON.stringify(payload)); };
    const key = request.method + ' ' + path;
    if (key === 'GET /readyz') { const o = overrides[key]; if (o) { const r = await o(call); return send(r.status, r.body, r.headers); } return send(200, { status: 'ready' }); }
    if (path.startsWith('/v1/')) {
      if (request.headers['x-falcon-mcp-service-token'] !== SERVICE_SECRET) return send(401, { error: { code: 'UNAUTHORIZED', message: 'OAuth service authentication is required.' } });
      if (key === 'POST /v1/oauth/introspect') {
        const handler = overrides[key] ?? defaults(call)[key];
        const result = await handler(call);
        return send(result.status, result.body, result.headers);
      }
      if (request.headers.authorization !== 'Bearer ' + ACCESS_TOKEN) return send(401, { error: { code: 'UNAUTHORIZED', message: 'A valid MCP access token is required.' } });
    }
    const expectedKeys = BODY_KEYS[key];
    if (expectedKeys && !sameKeys(body, expectedKeys)) return send(400, { error: { code: 'INVALID_INPUT', message: 'Request fields do not match the endpoint.' } });
    const handler = overrides[key] ?? defaults(call)[key];
    if (!handler) return send(404, { error: { code: 'NOT_FOUND', message: 'Endpoint not found.' } });
    const result = await handler(call);
    if (result.hang) return;
    return send(result.status, result.body, result.headers);
  });
  server.on('connection', socket => { sockets.add(socket); socket.once('close', () => sockets.delete(socket)); });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  return { url: 'http://127.0.0.1:' + server.address().port, calls, async close() { for (const socket of sockets) socket.destroy(); server.close(); } };
}

export function testConfig(meshUrl, extra = {}) {
  return parseConfig({
    FALCON_MESH_API_URL: meshUrl,
    FALCON_MCP_ORIGIN: ORIGIN,
    FALCON_MCP_OAUTH_ISSUER: meshUrl,
    FALCON_MCP_OAUTH_RESOURCE: RESOURCE,
    FALCON_MCP_OAUTH_SERVICE_SECRET: SERVICE_SECRET,
    PORT: '0',
    ...extra,
  });
}

// MCP app on a random loopback port, driven by the official client over real HTTP.
export async function startStack({ overrides, env = {}, meshTimeouts, clock } = {}) {
  const mesh = await startFakeMesh(overrides);
  const config = testConfig(mesh.url, env);
  const { server, close } = createApp({ config, meshTimeouts, clock });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const url = 'http://127.0.0.1:' + server.address().port;
  const client = new Client({ name: 'falcon-mcp-test', version: '1.0.0' }, { versionNegotiation: { mode: 'auto' } });
  const transport = new StreamableHTTPClientTransport(new URL(url + '/mcp'), { requestInit: { headers: { Authorization: 'Bearer ' + ACCESS_TOKEN } } });
  await client.connect(transport);
  return {
    url, mesh, client, config,
    async call(name, args) { return client.callTool({ name, arguments: args }); },
    async stop() { await client.close(); await close(); await mesh.close(); },
  };
}
