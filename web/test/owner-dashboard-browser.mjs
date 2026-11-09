import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { createHash, generateKeyPairSync, randomBytes, randomUUID } from 'node:crypto';
import { request as httpRequest } from 'node:http';
import { createServer as createTlsServer } from 'node:https';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { extname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { MeshError } from '../../mesh/domain.mjs';
import { createApi } from '../../mesh/http.mjs';
import { createStore } from '../../mesh/store.mjs';
import { createLendingStore } from '../../mesh/lending-store.mjs';
import { createWalletAuth } from '../../mesh/wallet-auth.mjs';
import { createReviewJobStore } from '../../mesh/research/review-store.mjs';
import { createResearchActivity } from '../../mesh/research/activity.mjs';
import { LENDING_CONFIG } from '../../mesh/kamino-wire.mjs';
import { createCfoStore } from '../../mesh/cfo/store.mjs';
import { createCfoService } from '../../mesh/cfo/service.mjs';
import { createIntentsAdapter } from '../../mesh/cfo/intents.mjs';
import { canonicalBytes, sha256 } from '../../mesh/council/evidence.ts';
import { createFixtureTransport } from './support/fixture-transport.mjs';

// V185/V190/V191 and R5: actual built UI, wallet-message auth, Mesh HTTP and PostgreSQL.
// Only test-owned keys, a local controlled CFO adapter and localhost TLS are used.
// A single authenticated overview read can fail deterministically; no external page request is dispatched.
const databaseUrl = process.env.FALCON_MESH_TEST_DATABASE_URL;
assert.ok(databaseUrl, 'An initialized disposable FALCON_MESH_TEST_DATABASE_URL is required.');
const require = createRequire(new URL('../../mesh/package.json', import.meta.url));
const { Pool } = require('pg');
const { PublicKey } = require('@solana/web3.js');
const root = resolve(process.env.FALCON_OWNER_WEB_ROOT || fileURLToPath(new URL('../dist/', import.meta.url)));
const apiPort = Number(process.env.FALCON_OWNER_BROWSER_PORT || 8792);
assert.ok(Number.isInteger(apiPort) && apiPort > 0 && apiPort <= 65535, 'Invalid test API port.');
const apiOrigin = `https://127.0.0.1:${apiPort}`;
const artifacts = await mkdtemp(join(tmpdir(), 'falcon-owner-browser-'));
const pool = new Pool({ connectionString: databaseUrl, max: 3, connectionTimeoutMillis: 3000 });
const store = createStore(pool);
const lending = createLendingStore(pool, { meshStore: store });
const cfoStore = createCfoStore(pool);
const FIXTURE_RESERVE = 'nep141:solana:usdc-fixture';
const FIXTURE_GT = 'nep141:base-0x0bb69b79bc829e1cfcc34a740110886d98d2bd14.omft.near';
const FIXTURE_TLO = 'nep141:eth-0x0f38f1ce62776d4a0038bc6cac66877a5687383b.omft.near';
const FIXTURE_ASSETS = [
  { assetId: FIXTURE_RESERVE, symbol: 'USDC', decimals: 6, blockchain: 'sol', contractAddress: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v', kind: 'reserve', protocol: null },
  { assetId: FIXTURE_GT, symbol: 'gtUSDCp', decimals: 18, blockchain: 'base', contractAddress: '0x0bb69b79bc829e1cfcc34a740110886d98d2bd14', kind: 'receipt', protocol: null },
  { assetId: FIXTURE_TLO, symbol: 'TLO', decimals: 8, blockchain: 'eth', contractAddress: '0x0f38f1ce62776d4a0038bc6cac66877a5687383b', kind: 'receipt', protocol: null },
];
const EXPECTED_CONSUMER_TEMPLATE = Object.freeze({
  id: 'falcon-cfo-consumer',
  version: 1,
  maxPositionBps: 2500,
  slippageBps: 50,
  maxFeeBps: 100,
  maxEvidenceAgeSeconds: 300,
  monitorIntervalSeconds: 300,
  maxMonitorCycles: 12,
});
let fixtureEnabled = false, failNextOverviewRead = false;
const fixtureCalls = { assets: 0, capture: 0, quote: 0, generateIntent: 0, validateSigned: 0, submitIntent: 0, status: 0, reconcile: 0, review: 0 };
const disabledIntents = createIntentsAdapter({ enabled: false });
function fixturePortfolio(wallet, blockHeight = 10) {
  return {
    schemaVersion: 1, chain: 'near', network: 'mainnet', wallet,
    signerId: Buffer.from(new PublicKey(wallet).toBytes()).toString('hex'),
    capturedAt: new Date(Date.now() - 1000).toISOString(), blockHash: `owner-browser-fixture-${blockHeight}`, blockHeight,
    assets: FIXTURE_ASSETS,
    balances: [
      { assetId: FIXTURE_RESERVE, balanceBaseUnits: '5000000' },
      { assetId: FIXTURE_GT, balanceBaseUnits: '1000000000000000000' },
      { assetId: FIXTURE_TLO, balanceBaseUnits: '0' },
    ],
    status: 'OBSERVED', reasons: [],
  };
}
function fixtureQuote(input) {
  const deadline = input.deadline;
  const amountIn = BigInt(input.amount);
  const origin = FIXTURE_ASSETS.find(asset => asset.assetId === input.originAsset);
  const destination = FIXTURE_ASSETS.find(asset => asset.assetId === input.destinationAsset);
  const amountOut = amountIn * 10n ** BigInt(destination.decimals) / 10n ** BigInt(origin.decimals);
  if (amountOut <= 0n) throw new Error('Controlled fixture quote amount must be positive.');
  const capturedAt = new Date(Date.now() - 1000).toISOString();
  const raw = {
    timestamp: capturedAt,
    quoteRequest: {
      dry: false, swapType: 'EXACT_INPUT', slippageTolerance: input.slippageBps,
      originAsset: input.originAsset, depositType: 'INTENTS', destinationAsset: input.destinationAsset,
      amount: input.amount, refundTo: input.signerId, refundType: 'INTENTS',
      recipient: input.signerId, recipientType: 'INTENTS', deadline,
    },
    quote: {
      amountIn: amountIn.toString(), minAmountIn: amountIn.toString(),
      amountOut: amountOut.toString(), minAmountOut: amountOut.toString(),
      deadline, depositAddress: 'fixture-near-deposit-address',
      refundFee: '0', withdrawFee: '0', signature: 'fixture-quote-signature',
    },
  };
  return { schemaVersion: 1, capturedAt, raw, sha256: sha256(canonicalBytes(raw)), signatureVerified: true };
}
const fixtureIntents = {
  async assets() { fixtureCalls.assets += 1; return FIXTURE_ASSETS; },
  async capturePortfolio(wallet) { fixtureCalls.capture += 1; return fixturePortfolio(wallet, 10 + fixtureCalls.capture); },
  async quote(input) { fixtureCalls.quote += 1; return fixtureQuote(input); },
  async generateIntent(quote, signerId) {
    fixtureCalls.generateIntent += 1;
    return { standard: 'raw_ed25519', payload: JSON.stringify({ signerId, quoteHash: quote.sha256 }) };
  },
  async validateSigned() { fixtureCalls.validateSigned += 1; throw new Error('Financial signing is forbidden in the owner browser fixture.'); },
  async submitIntent() { fixtureCalls.submitIntent += 1; throw new Error('Intent submission is forbidden in the owner browser fixture.'); },
  async status() { fixtureCalls.status += 1; throw new Error('Provider status is unavailable in the owner browser fixture.'); },
  async reconcile() { fixtureCalls.reconcile += 1; throw new Error('Provider reconciliation is unavailable in the owner browser fixture.'); },
};
const cfoAdapter = Object.fromEntries(Object.keys(fixtureIntents).map(method => [method, (...args) => (
  fixtureEnabled ? fixtureIntents[method](...args) : disabledIntents[method](...args)
)]));
const cfoService = createCfoService({
  store: cfoStore,
  adapter: cfoAdapter,
  review: async () => { fixtureCalls.review += 1; throw new Error('Model review is forbidden in the owner browser fixture.'); },
});
let latestAuthenticatedOverview = null, lastPrepareResponse = null;
let nextOverviewResponseTransform = null;
function transformFixtureOverviewOnce(overview) {
  const transform = nextOverviewResponseTransform;
  nextOverviewResponseTransform = null;
  if (!transform) return overview;
  if (!fixtureEnabled || !Array.isArray(overview?.actions) || typeof transform.actionId !== 'string') {
    throw new Error('Invalid fixture-only CFO overview transform request.');
  }
  let transformed = false;
  const actions = overview.actions.map(record => {
    if (transformed || record?.data?.actionId !== transform.actionId) return record;
    transformed = true;
    if (transform.kind === 'corrupt-quote-bytes') {
      const quote = record.data.quote;
      const raw = quote?.raw;
      const bounds = raw?.quote;
      if (!isRecord(quote) || !isRecord(raw) || !isRecord(bounds) || bounds.amountOut !== '123456') {
        throw new Error('Fixture quote corruption target is not the expected retained quote.');
      }
      return {
        ...record,
        data: {
          ...record.data,
          quote: { ...quote, raw: { ...raw, quote: { ...bounds, amountOut: '123457' } } },
        },
      };
    }
    if (transform.kind === 'mismatch-mandate-context') {
      if (typeof transform.mandateId !== 'string') throw new Error('Fixture mandate mismatch requires an exact replacement ID.');
      return { ...record, data: { ...record.data, mandateId: transform.mandateId } };
    }
    throw new Error('Unknown fixture-only CFO overview transform.');
  });
  if (!transformed) throw new Error('Fixture-only CFO overview transform did not find its retained action.');
  return { ...overview, actions };
}
function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
const cfo = new Proxy(cfoService, {
  get(target, property, receiver) {
    if (property === 'overview') return async (...args) => {
      if (failNextOverviewRead) {
        failNextOverviewRead = false;
        throw new MeshError('STORAGE_UNAVAILABLE', 'Controlled retained action read failure.');
      }
      const value = await target.overview(...args);
      const response = transformFixtureOverviewOnce(value);
      latestAuthenticatedOverview = response;
      return response;
    };
    if (property === 'prepareAction') return async (...args) => {
      lastPrepareResponse = await target.prepareAction(...args);
      return lastPrepareResponse;
    };
    return Reflect.get(target, property, receiver);
  },
});
const key = generateKeyPairSync('ed25519');
const publicBytes = key.publicKey.export({ format: 'der', type: 'spki' }).subarray(-32);
const privateBase64 = key.privateKey.export({ format: 'der', type: 'pkcs8' }).toString('base64');
const walletAddress = new PublicKey(publicBytes).toBase58();
const otherKey = generateKeyPairSync('ed25519');
const otherPublicBytes = otherKey.publicKey.export({ format: 'der', type: 'spki' }).subarray(-32);
const otherWalletAddress = new PublicKey(otherPublicBytes).toBase58();
const tokens = new Set();
const requests = [], checks = [], exceptions = [];
const targetEvents = [], pageEvents = [], networkEvents = [], loadingFailures = [];
const networkRequestById = new Map(), pending = new Map();
let chrome, api, gateway, site, transport, walletAuth, origin;
let clockOffset = 0, sequence = 0, buffer = '', stderr = '', rejectLogout = false;
let browserPhase = 'pre-launch', browserProcessState = 'not-started', browserExit = null;
let targetCreated = false, pageSessionAttached = false, navigationResult = null;
const pause = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));
function displayedAmountEquals(text, baseUnits, decimals, symbol) {
  if (typeof text !== 'string' || typeof baseUnits !== 'string' || !Number.isSafeInteger(decimals) || decimals < 0) return false;
  const escapedSymbol = symbol.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = new RegExp(`(?:^|\\s)([0-9][0-9,]*(?:\\.[0-9]+)?)\\s+${escapedSymbol}(?=$|\\s)`).exec(text);
  if (!match || !/^(?:\d+|\d{1,3}(?:,\d{3})+)(?:\.\d+)?$/.test(match[1])) return false;
  const [whole, fraction = ''] = match[1].replaceAll(',', '').split('.');
  if (fraction.length > decimals) return false;
  try {
    const shownBaseUnits = BigInt(whole) * (10n ** BigInt(decimals))
      + BigInt(fraction.padEnd(decimals, '0') || '0');
    return shownBaseUnits === BigInt(baseUnits);
  } catch { return false; }
}
function diagnosticText(value, limit = 160) {
  if (typeof value !== 'string') return null;
  return safe(value)
    .replace(/-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g, '[redacted-private-key]')
    .replace(/\b(?:authorization|proxy-authorization)\b\s*[:=]\s*(?:bearer\s+)?[^\s,;]+/gi, '[redacted-auth]')
    .replace(/\bbearer\s+[A-Za-z0-9._~+/-]+=*/gi, '[redacted-auth]')
    .replace(/\b(?:x-api-key|api[_ -]?key|private[_ -]?key|secret)\b\s*[:=]\s*[^\s,;]+/gi, '[redacted-secret]')
    .replace(/\b[A-Za-z0-9_-]{80,}={0,2}\b/g, '[redacted-opaque]')
    .slice(0, limit);
}
function diagnosticReviewReason(value) {
  if (typeof value !== 'string' || !value.trim()) return null;
  if (/\bhash\b/i.test(value)) return 'quote-hash-mismatch';
  if (/\b(stale|expired|expiry|deadline)\b/i.test(value)) return 'quote-stale-or-expired';
  if (/\b(amount|debit|minimum|fee|destination|quote bound)\b/i.test(value)) return 'quote-bound-mismatch';
  if (/\b(owner|portfolio|mandate|wallet|signer)\b/i.test(value)) return 'owner-context-mismatch';
  if (/\b(unavailable|failed|error|blocked|retry)\b/i.test(value)) return 'read-unavailable-or-blocked';
  return 'review-reason-present';
}
const safe = value => JSON.parse(JSON.stringify(value).replaceAll(databaseUrl, '[redacted-database]').replaceAll(privateBase64, '[redacted-test-key]').replace(/wsi1_[A-Za-z0-9_-]{43}/g, '[redacted-session]'));
const safeText = (value, limit = 256) => typeof value === 'string' ? safe(value).slice(0, limit) : null;
const safeUrl = value => {
  try {
    const url = new URL(value);
    return ['http:', 'https:'].includes(url.protocol) ? { origin: url.origin, path: safe(url.pathname) } : { protocol: url.protocol };
  } catch { return null; }
};
const keepLast = (items, item, limit = 128) => { items.push(item); if (items.length > limit) items.shift(); };
function rememberNetworkRequest(requestId, request) {
  if (!networkRequestById.has(requestId) && networkRequestById.size >= 512) networkRequestById.delete(networkRequestById.keys().next().value);
  networkRequestById.set(requestId, request);
}
function browserDiagnostics() {
  return {
    phase: browserPhase,
    processState: browserProcessState,
    exit: browserExit,
    targetCreated,
    pageSessionAttached,
    navigationResult,
    targetEvents,
    pageEvents,
    networkEvents,
    loadingFailures,
    stderr: safe(stderr).replaceAll(artifacts, '[redacted-browser-artifacts]').replace(/(https?:\/\/[^\s?#]+)[?#][^\s]*/g, '$1').slice(-2000),
  };
}
function check(name, condition, diagnostics) {
  const pass = Boolean(condition);
  checks.push({ name, pass, ...(!pass && diagnostics ? { diagnostics } : {}) });
  assert.ok(pass, name);
}
function failPending(error) { for (const item of pending.values()) { clearTimeout(item.timer); item.reject(error); } pending.clear(); }
function call(method, params = {}, sessionId) {
  return new Promise((resolve, reject) => {
    const id = ++sequence;
    const timer = setTimeout(() => { pending.delete(id); reject(Error(`CDP timeout: ${method}`)); }, 20000);
    pending.set(id, { resolve, reject, timer });
    chrome.stdio[3].write(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }) + '\0');
  });
}
function receive(data) {
  buffer += data.toString();
  let end;
  while ((end = buffer.indexOf('\0')) >= 0) {
    const raw = buffer.slice(0, end); buffer = buffer.slice(end + 1);
    if (!raw) continue;
    const message = JSON.parse(raw);
    if (message.id) {
      const item = pending.get(message.id);
      if (item) { pending.delete(message.id); clearTimeout(item.timer); message.error ? item.reject(Error(JSON.stringify(safe(message.error)))) : item.resolve(message.result); }
    }
    transport?.receive(message);
    const params = message.params ?? {};
    if (['Target.targetCreated', 'Target.targetInfoChanged', 'Target.attachedToTarget', 'Target.detachedFromTarget'].includes(message.method)) {
      const info = params.targetInfo;
      keepLast(targetEvents, { event: message.method, type: safeText(info?.type, 32), url: safeUrl(info?.url), attached: message.method === 'Target.attachedToTarget' });
    }
    if (['Page.frameStartedNavigating', 'Page.frameNavigated', 'Page.frameStartedLoading', 'Page.frameStoppedLoading', 'Page.loadEventFired', 'Page.domContentEventFired'].includes(message.method)) {
      const frame = params.frame;
      keepLast(pageEvents, {
        event: message.method,
        frameId: safeText(params.frameId ?? frame?.id, 128),
        loaderId: safeText(params.loaderId ?? frame?.loaderId, 128),
        url: safeUrl(params.url ?? frame?.url),
        timestamp: Number.isFinite(params.timestamp) ? params.timestamp : null,
      });
    }
    if (message.method === 'Network.requestWillBeSent') {
      const request = { method: safeText(params.request?.method, 16), url: safeUrl(params.request?.url), type: safeText(params.type, 32) };
      rememberNetworkRequest(params.requestId, request);
      keepLast(networkEvents, { event: message.method, requestId: safeText(params.requestId, 128), ...request });
    }
    if (message.method === 'Network.responseReceived') {
      const response = params.response ?? {};
      keepLast(networkEvents, {
        event: message.method,
        requestId: safeText(params.requestId, 128),
        type: safeText(params.type, 32),
        url: safeUrl(response.url),
        status: Number.isFinite(response.status) ? response.status : null,
        mimeType: safeText(response.mimeType, 96),
      });
    }
    if (message.method === 'Network.loadingFailed') {
      keepLast(loadingFailures, {
        requestId: safeText(params.requestId, 128),
        request: networkRequestById.get(params.requestId) ?? null,
        errorText: safeText(params.errorText),
        blockedReason: safeText(params.blockedReason, 64),
        canceled: Boolean(params.canceled),
        type: safeText(params.type, 32),
      });
      networkRequestById.delete(params.requestId);
    }
    if (message.method === 'Runtime.exceptionThrown') keepLast(exceptions, safe(params.exceptionDetails));
  }
}
const listen = (server, port = 0) => new Promise((resolve, reject) => { server.once('error', reject); server.listen(port, '127.0.0.1', resolve); });
async function close(server) { if (server?.listening) { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); } }
const activityReads = () => requests.filter(row => row.method === 'GET' && row.path === '/v1/activity').length;
const verifyPosts = () => requests.filter(row => row.method === 'POST' && row.path === '/v1/auth/wallet/verify').length;
const cfoOverviewReads = () => requests.filter(row => row.method === 'GET' && row.path === '/v1/cfo');
const cfoPosts = path => requests.filter(row => row.method === 'POST' && row.path.startsWith('/v1/cfo/') && (!path || row.path === `/v1/cfo/${path}`));

try {
  await readFile(join(root, 'dashboard/index.html'));
  await store.ready();
  const tlsKey = join(artifacts, 'localhost.key'), tlsCert = join(artifacts, 'localhost.crt');
  const certificate = spawnSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '1', '-subj', '/CN=127.0.0.1', '-keyout', tlsKey, '-out', tlsCert], { cwd: artifacts, encoding: 'utf8' });
  assert.equal(certificate.status, 0, 'Temporary localhost certificate creation failed.');
  const tls = { key: await readFile(tlsKey), cert: await readFile(tlsCert) };
  site = createTlsServer(tls, async (request, response) => {
    try {
      let pathname = decodeURIComponent(new URL(request.url, 'https://local.invalid').pathname);
      if (pathname.endsWith('/')) pathname += 'index.html';
      const filename = resolve(root, '.' + pathname);
      if (!filename.startsWith(root + sep)) throw Error('Invalid path');
      const content = await readFile(filename);
      response.writeHead(200, { 'content-type': ({ '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml' })[extname(filename)] || 'application/octet-stream', 'cache-control': 'no-store' });
      response.end(content);
    } catch { response.writeHead(404); response.end('Not found'); }
  });
  await listen(site); origin = `https://127.0.0.1:${site.address().port}`;
  const allowedOrigins = new Set([origin]);
  walletAuth = createWalletAuth(pool, { allowedOrigins, clock: () => Date.now() + clockOffset });
  await walletAuth.ready();
  const credential = randomBytes(32).toString('hex');
  api = createApi({ store, lending, cfo, walletAuth, researchActivity: createResearchActivity({ store, reviewJobStore: createReviewJobStore(pool) }), tokenHashes: new Map([[createHash('sha256').update(credential).digest('hex'), 'owner_browser_fixture']]), allowedOrigins });
  await listen(api);
  // TLS forwarding preserves native browser CORS and the real auth handler.
  gateway = createTlsServer(tls, (request, response) => {
    const url = new URL(request.url, apiOrigin);
    const requestRecord = { method: request.method, path: url.pathname, hasQuery: Boolean(url.search), status: null };
    requests.push(requestRecord);
    if (rejectLogout && request.method === 'POST' && url.pathname === '/v1/auth/wallet/logout') {
      request.resume();
      requestRecord.status = 503;
      response.writeHead(503, { 'content-type': 'application/json', 'access-control-allow-origin': origin });
      response.end(JSON.stringify({ error: { code: 'STORAGE_UNAVAILABLE', message: 'Controlled logout outage.' } }));
      return;
    }
    const upstream = httpRequest({ hostname: '127.0.0.1', port: api.address().port, method: request.method, path: request.url, headers: request.headers }, incoming => {
      requestRecord.status = incoming.statusCode;
      response.writeHead(incoming.statusCode, incoming.headers); incoming.pipe(response);
    });
    upstream.on('error', () => { requestRecord.status = 502; if (!response.headersSent) response.writeHead(502); response.end(); });
    request.pipe(upstream);
  });
  await listen(gateway, apiPort);
  transport = createFixtureTransport({ call, allowedOrigins: [origin, apiOrigin], rpcUrl: LENDING_CONFIG.rpcUrl,
    respond() { throw Error('Owner dashboard must not call a financial RPC.'); },
    onError(error) { keepLast(exceptions, safe(String(error))); process.exitCode = 1; failPending(error); } });
  browserPhase = 'launching';
  // Keep the private fixture profile off the host keychain and persistent-cookie loader.
  chrome = spawn(process.env.FALCON_CHROME_BIN || '/Applications/Brave Browser.app/Contents/MacOS/Brave Browser', ['--headless=new', '--disable-gpu', '--disable-background-networking', '--disable-component-update', '--disable-default-apps', '--disable-sync', '--disable-extensions', '--no-first-run', '--no-default-browser-check', '--metrics-recording-only', '--ignore-certificate-errors', '--password-store=basic', '--use-mock-keychain', `--user-data-dir=${artifacts}/profile`, '--remote-debugging-pipe', 'about:blank'], { stdio: ['ignore', 'ignore', 'pipe', 'pipe', 'pipe'] });
  browserProcessState = 'spawn-requested';
  chrome.stderr.on('data', data => { stderr = (stderr + data.toString()).slice(-2000); });
  chrome.on('spawn', () => { browserProcessState = 'started'; });
  chrome.on('error', error => {
    browserProcessState = 'error';
    browserExit = { error: safeText(error.message) };
    failPending(error);
  });
  chrome.on('exit', (code, signal) => {
    browserProcessState = 'exited';
    browserExit = { code, signal };
    failPending(Error(`Browser exited ${code}/${signal}: ${browserDiagnostics().stderr}`));
  });
  chrome.stdio[4].on('data', receive);
  browserPhase = 'creating-target';
  const target = await call('Target.createTarget', { url: 'about:blank' });
  targetCreated = Boolean(target.targetId);
  browserPhase = 'attaching-target';
  const { sessionId } = await call('Target.attachToTarget', { targetId: target.targetId, flatten: true });
  pageSessionAttached = Boolean(sessionId);
  const send = (method, params = {}) => call(method, params, sessionId);
  browserPhase = 'enabling-page-domains';
  await send('Page.enable'); await send('Runtime.enable'); await send('Network.enable'); await transport.install(send);
  browserPhase = 'installing-wallet-script';
  await send('Page.addScriptToEvaluateOnNewDocument', { source: `(() => {
    const decode = text => Uint8Array.from(atob(text), char => char.charCodeAt(0));
    const account = Object.freeze({ address: ${JSON.stringify(walletAddress)}, publicKey: decode(${JSON.stringify(publicBytes.toString('base64'))}), chains: ['solana:devnet'], features: ['solana:signMessage'] });
    const alternateAccount = Object.freeze({ address: ${JSON.stringify(otherWalletAddress)}, publicKey: decode(${JSON.stringify(otherPublicBytes.toString('base64'))}), chains: ['solana:devnet'], features: ['solana:signMessage'] });
    const listeners = new Set(); let accounts = [], privateKey;
    const control = window.__ownerTestWallet = {
      signCalls: 0, reject: false,
      switchWallet() { accounts = [alternateAccount]; for (const listener of listeners) listener({ accounts }); },
    };
    const wallet = { version: '1.0.0', name: 'Ephemeral fixture wallet', icon: 'data:image/svg+xml;base64,PHN2Zy8+', chains: ['solana:devnet'], get accounts() { return accounts; }, features: {
      'standard:connect': { version: '1.0.0', async connect() { accounts = [account]; return { accounts }; } },
      'standard:events': { version: '1.0.0', on(name, listener) { if (name !== 'change') throw Error('Unexpected event'); listeners.add(listener); return () => listeners.delete(listener); } },
      'solana:signMessage': { version: '1.0.0', async signMessage(input) {
        control.signCalls++; if (control.reject) throw Error('Controlled signature rejection');
        if (input.account !== account) throw Error('Wrong message account');
        privateKey ??= crypto.subtle.importKey('pkcs8', decode(${JSON.stringify(privateBase64)}), { name: 'Ed25519' }, false, ['sign']);
        return [{ signedMessage: input.message, signature: new Uint8Array(await crypto.subtle.sign('Ed25519', await privateKey, input.message)) }];
      } }
    } };
    addEventListener('wallet-standard:app-ready', event => event.detail.register(wallet));
    dispatchEvent(new CustomEvent('wallet-standard:register-wallet', { detail: api => api.register(wallet) }));
  })();` });
  const evaluate = async expression => {
    const result = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    if (result.exceptionDetails) throw Error(JSON.stringify(safe(result.exceptionDetails)));
    return result.result.value;
  };
  const wait = async expression => { for (let i = 0; i < 400; i++) { if (await evaluate(expression)) return; await pause(50); } throw Error('Page condition timed out: ' + expression); };
  const ownerVisible = `Boolean([...document.querySelectorAll('section')].find(el => (el.getAttribute('aria-label') || (el.getAttribute('aria-labelledby') || '').split(' ').map(id => document.getElementById(id)?.textContent || '').join(' ')).trim() === 'Verified owner dashboard'))`;
  const button = name => `[...document.querySelectorAll('button')].find(el => (el.getAttribute('aria-label')?.trim() || el.textContent.trim()) === ${JSON.stringify(name)})`;
  const screenshotElement = async (filename, selector) => {
    const encoded = JSON.stringify(selector);
    await evaluate(`document.querySelector(${encoded})?.scrollIntoView({ block: 'center', inline: 'nearest' })`);
    await pause(120);
    await writeFile(join(artifacts, filename), Buffer.from((await send('Page.captureScreenshot', { format: 'png' })).data, 'base64'));
  };
  const click = async name => { await wait(`Boolean(${button(name)} && !${button(name)}.disabled)`); await evaluate(`${button(name)}.click()`); };
  const clickSelector = async selector => {
    const encoded = JSON.stringify(selector);
    await wait(`Boolean(document.querySelector(${encoded}) && !document.querySelector(${encoded}).disabled)`);
    await evaluate(`document.querySelector(${encoded}).click()`);
  };
  const fieldValue = selector => evaluate(`document.querySelector(${JSON.stringify(selector)})?.value ?? null`);
  const fillField = async (selector, value) => {
    const encodedSelector = JSON.stringify(selector), encodedValue = JSON.stringify(value);
    const changed = await evaluate(`(() => {
      const input = document.querySelector(${encodedSelector});
      if (!input || !('value' in input)) return false;
      const view = input.ownerDocument.defaultView;
      const prototype = input instanceof view.HTMLSelectElement ? view.HTMLSelectElement.prototype : view.HTMLInputElement.prototype;
      const setter = Object.getOwnPropertyDescriptor(prototype, 'value')?.set;
      if (setter) setter.call(input, ${encodedValue}); else input.value = ${encodedValue};
      input.dispatchEvent(new Event('input', { bubbles: true }));
      input.dispatchEvent(new Event('change', { bubbles: true }));
      return true;
    })()`);
    assert.equal(changed, true, `Missing form control ${selector}.`);
  };
  const waitUntil = async predicate => {
    for (let i = 0; i < 400; i++) { if (await predicate()) return; await pause(50); }
    throw Error('Server-side smoke condition timed out.');
  };
  const sessionKey = 'falconos.bot.wallet-session.v1';
  const rememberToken = async () => { const token = await evaluate(`sessionStorage.getItem(${JSON.stringify(sessionKey)})`); assert.match(token, /^wsi1_[A-Za-z0-9_-]{43}$/); tokens.add(token); return token; };
  const signIn = async () => { await click('Sign in with Ephemeral fixture wallet'); await wait(ownerVisible); await wait(`Boolean(${button('Refresh activity')} && !${button('Refresh activity')}.disabled)`); return rememberToken(); };
  browserPhase = 'setting-page-metrics';
  await send('Emulation.setDeviceMetricsOverride', { width: 1360, height: 950, deviceScaleFactor: 1, mobile: false });
  browserPhase = 'navigating';
  const navigation = await send('Page.navigate', { url: origin + '/dashboard/' });
  navigationResult = {
    frameId: safeText(navigation?.frameId, 128),
    loaderId: safeText(navigation?.loaderId, 128),
    errorText: safeText(navigation?.errorText),
    isDownload: navigation?.isDownload === true,
  };
  if (navigationResult.errorText) throw Error(`Page.navigate failed: ${navigationResult.errorText}`);
  browserPhase = 'waiting-for-dashboard';
  await wait(`document.readyState === 'complete' && Boolean(${button('Sign in with Ephemeral fixture wallet')})`);
  browserPhase = 'dashboard-ready';
  check('V185: anonymous entry neither mounts owner content nor reads owner activity', !await evaluate(ownerVisible) && activityReads() === 0);
  check('V185: entering the dashboard never requests a wallet signature', await evaluate('window.__ownerTestWallet.signCalls === 0'));
  await evaluate(`sessionStorage.setItem(${JSON.stringify(sessionKey)}, 'wsi1_' + 'a'.repeat(43))`);
  await send('Page.reload');
  await wait(`document.readyState === 'complete' && Boolean(${button('Sign in with Ephemeral fixture wallet')})`);
  await wait(`!sessionStorage.getItem(${JSON.stringify(sessionKey)})`);
  check('V185: forged storage is rejected before owner activity or content', !await evaluate(ownerVisible) && activityReads() === 0);
  const firstSession = await signIn();
  check('V185: one explicit test-wallet message signature completes real server verification', await evaluate('window.__ownerTestWallet.signCalls === 1') && verifyPosts() === 1 && activityReads() === 1);
  const identity = await walletAuth.getSession(firstSession);
  const savedDecision = await store.createDecision(identity.ownerId, {
    requestId: randomUUID(),
    scenario: { proposedUnits: '1', maxProposedUnits: '1', minBookLiquidityUnits: '1', maxObservationAgeSeconds: 300 },
  }, new Date().toISOString());
  const beforeRefresh = activityReads(); await click('Refresh activity');
  await wait(`Boolean(${button('Refresh activity')} && !${button('Refresh activity')}.disabled)`);
  check('V191: refresh reads retained activity without another signature', activityReads() === beforeRefresh + 1 && await evaluate('window.__ownerTestWallet.signCalls === 1'));
  await wait(`document.body.innerText.includes(${JSON.stringify(savedDecision.analysis.summary)})`);
  check('V191: the built view renders an actual retained domain decision', await evaluate(`document.body.innerText.includes(${JSON.stringify(savedDecision.analysis.summary)}) && !document.querySelector('.owner-load-error')`));
  await click('NEAR · Intents');
  await wait(`Boolean(document.getElementById('cfo-title')) && document.body.innerText.includes('T82_PROOF_UNVERIFIED')`);
  check('V197: CFO loads retained state without a capture or financial signature', requests.filter(row => row.path.startsWith('/v1/cfo') && row.method === 'POST').length === 0 && await evaluate('window.__ownerTestWallet.signCalls === 1'));
  check('V200: actual CFO surface labels the mainnet signing boundary', await evaluate(`Boolean(document.getElementById('cfo-mainnet-warning')) && !document.querySelector('.cfo-payload')`));
  await click('Capture finalized portfolio');
  await wait(`Boolean(${button('Capture finalized portfolio')} && !${button('Capture finalized portfolio')}.disabled) && document.body.innerText.includes('Portfolio data is unavailable')`);
  const unavailablePortfolio = await cfoStore.latest(identity.ownerId, 'portfolio');
  check('V198: disabled provider is retained as CFO_PROVIDER_DISABLED NO_DATA rather than fabricated funds',
    unavailablePortfolio?.data.status === 'NO_DATA'
      && unavailablePortfolio.data.reasons.includes('CFO_PROVIDER_DISABLED')
      && unavailablePortfolio.data.balances.length === 0
      && await evaluate('window.__ownerTestWallet.signCalls === 1'));
  await writeFile(join(artifacts, 'owner-desktop.png'), Buffer.from((await send('Page.captureScreenshot', { format: 'png' })).data, 'base64'));
  await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
  check('V190: owner dashboard fits a mobile viewport', await evaluate('document.documentElement.scrollWidth <= innerWidth'));
  await writeFile(join(artifacts, 'owner-mobile.png'), Buffer.from((await send('Page.captureScreenshot', { format: 'png' })).data, 'base64'));
  clockOffset = 31 * 60_000; await click('Refresh activity');
  await wait(`!(${ownerVisible}) && Boolean(${button('Sign in with Ephemeral fixture wallet')})`);
  check('V185: server-expired session clears private content and local session', !await evaluate(`Boolean(sessionStorage.getItem(${JSON.stringify(sessionKey)}))`));
  clockOffset = 0; const revoked = await signIn();
  assert.equal(await walletAuth.revokeSession(revoked), true);
  const beforeRestore = activityReads(); await send('Page.reload');
  await wait(`document.readyState === 'complete' && Boolean(${button('Sign in with Ephemeral fixture wallet')}) && !sessionStorage.getItem(${JSON.stringify(sessionKey)})`);
  check('V185: revoked session restore never reads activity or mounts private content', activityReads() === beforeRestore && !await evaluate(ownerVisible));
  const loggedOut = await signIn(); await click('Sign out');
  await wait(`!(${ownerVisible}) && !sessionStorage.getItem(${JSON.stringify(sessionKey)})`);
  check('V185: logout revokes the actual server session', await walletAuth.getSession(loggedOut) === null);
  const uncertainLogout = await signIn(); rejectLogout = true; await click('Sign out');
  await wait(`!(${ownerVisible}) && !sessionStorage.getItem(${JSON.stringify(sessionKey)})`);
  check('V185: failed logout clears this tab without pretending server revocation', !await evaluate(ownerVisible) && await walletAuth.getSession(uncertainLogout) !== null);
  rejectLogout = false;
  const beforeRejected = verifyPosts(); await evaluate('window.__ownerTestWallet.reject = true');
  await click('Sign in with Ephemeral fixture wallet');
  await wait(`Boolean(${button('Sign in with Ephemeral fixture wallet')} && !${button('Sign in with Ephemeral fixture wallet')}.disabled)`);
  check('V185: rejected wallet signature cannot verify or open owner content', verifyPosts() === beforeRejected && !await evaluate(ownerVisible));
  check('V191/V197: only explicit capture adds a CFO POST; load and refresh never start financial work', requests.every(row => !row.hasQuery && (row.method !== 'POST' || ['/v1/auth/wallet/challenge', '/v1/auth/wallet/verify', '/v1/auth/wallet/logout', '/v1/cfo/capture'].includes(row.path))) && requests.filter(row => row.method === 'POST' && row.path === '/v1/cfo/capture').length === 1);
  await send('Emulation.setDeviceMetricsOverride', { width: 1360, height: 950, deviceScaleFactor: 1, mobile: false });
  await evaluate('window.__ownerTestWallet.reject = false');
  const r5Session = await signIn();
  await click('NEAR · Intents');
  const r5Identity = await walletAuth.getSession(r5Session);
  assert.ok(r5Identity);
  const r5SignCallsAtEntry = await evaluate('window.__ownerTestWallet.signCalls');
  fixtureEnabled = true;
  const capturesBeforeFixture = cfoPosts('capture').length;
  const readsBeforeFixture = cfoOverviewReads().length;
  await click('Capture finalized portfolio');
  await waitUntil(() => cfoPosts('capture').length === capturesBeforeFixture + 1 && cfoPosts('capture').at(-1)?.status === 200);
  await waitUntil(() => cfoOverviewReads().length > readsBeforeFixture && cfoOverviewReads().at(-1)?.status === 200);
  await wait(`document.body.innerText.includes('gtUSDCp')`);
  const observedPortfolio = await cfoStore.latest(r5Identity.ownerId, 'portfolio');
  const observedReceipt = observedPortfolio?.data.assets?.find(asset => asset.assetId === FIXTURE_GT);
  const heldReceipt = observedPortfolio?.data.balances?.find(balance => balance.assetId === FIXTURE_GT);
  check('V215: consumer action context uses an observed fixture asset with exact decimals and held balance',
    observedPortfolio?.data.status === 'OBSERVED' && observedPortfolio.data.wallet === walletAddress
      && observedReceipt?.symbol === 'gtUSDCp' && observedReceipt.decimals === 18
      && heldReceipt?.balanceBaseUnits === '1000000000000000000');
  const overviewTemplate = latestAuthenticatedOverview?.policyTemplate;
  const templateMetadataMatches = overviewTemplate && Object.keys(overviewTemplate).length === Object.keys(EXPECTED_CONSUMER_TEMPLATE).length
    && Object.entries(EXPECTED_CONSUMER_TEMPLATE).every(([key, value]) => overviewTemplate[key] === value);
  check('V214: authenticated overview supplies the exact flat consumer copy metadata', Boolean(templateMetadataMatches));

  const policyFieldSelectors = [
    '#cfo-reserveAssetId', '#cfo-reserve-floor-amount', '#cfo-action-cap-amount',
    '#cfo-target-0-assetId', '#cfo-target-0-weightBps',
    '#cfo-maxPositionBps', '#cfo-slippageBps', '#cfo-maxFeeBps',
    '#cfo-maxEvidenceAgeSeconds', '#cfo-monitorIntervalSeconds', '#cfo-maxMonitorCycles',
  ];
  const readFields = selectors => evaluate(`Object.fromEntries(${JSON.stringify(selectors)}.map(selector => [selector, document.querySelector(selector)?.value ?? null]))`);
  await wait(`Boolean(document.querySelector('#cfo-reserveAssetId'))`);
  await evaluate(`(() => {
    const sheet = document.querySelector('.cfo-policy-sheet');
    const template = sheet?.querySelector('.cfo-evidence-details');
    if (!sheet || !template) return false;
    if (!sheet.open) sheet.querySelector(':scope > summary')?.click();
    if (!template.open) template.querySelector(':scope > summary')?.click();
    return sheet.open && template.open;
  })()`);
  await wait(`document.querySelector('.cfo-policy-sheet')?.open === true
    && document.querySelector('.cfo-policy-sheet .cfo-evidence-details')?.open === true`);
  if (await fieldValue('#cfo-target-0-assetId') === null) await click('Add receipt target');
  await wait(`Boolean(document.querySelector('#cfo-target-0-assetId'))`);
  for (const [selector, value] of [
    ['#cfo-reserveAssetId', FIXTURE_RESERVE],
    ['#cfo-reserve-floor-amount', '0.1'],
    ['#cfo-action-cap-amount', '0.5'],
    ['#cfo-target-0-assetId', FIXTURE_GT],
    ['#cfo-target-0-weightBps', '25'],
    ['#cfo-maxPositionBps', '50'],
    ['#cfo-slippageBps', '0.25'],
    ['#cfo-maxFeeBps', '2'],
    ['#cfo-maxEvidenceAgeSeconds', '600'],
    ['#cfo-monitorIntervalSeconds', '120'],
    ['#cfo-maxMonitorCycles', '4'],
  ]) await fillField(selector, value);
  const mandateSubmit = `document.querySelector('#cfo-reserveAssetId')?.closest('form')?.querySelector('button[type="submit"]')`;
  const readsBeforeInitialMandateSave = cfoOverviewReads().length;
  const mandatePostsBeforeInitialSave = cfoPosts('mandate').length;
  await wait(`Boolean(${mandateSubmit} && !${mandateSubmit}.disabled)`);
  await evaluate(`${mandateSubmit}.click()`);
  await waitUntil(() => cfoPosts('mandate').length === mandatePostsBeforeInitialSave + 1 && cfoPosts('mandate').at(-1)?.status === 200);
  await waitUntil(() => cfoOverviewReads().length > readsBeforeInitialMandateSave && cfoOverviewReads().at(-1)?.status === 200);
  await wait(`Boolean(${mandateSubmit} && !${mandateSubmit}.disabled)`);
  const originalMandate = await cfoStore.latest(r5Identity.ownerId, 'mandate');
  assert.ok(originalMandate, 'The explicitly saved fixture mandate must be retained in PostgreSQL.');
  const originalMandateData = JSON.stringify(originalMandate.data);
  const originalMandateIsFixtureBound = originalMandate.data.reserveAssetId === FIXTURE_RESERVE
    && originalMandate.data.reserveFloorBaseUnits === '100000'
    && originalMandate.data.maxActionReserveBaseUnits === '500000'
    && originalMandate.data.maxPositionBps === 5000
    && originalMandate.data.slippageBps === 25
    && originalMandate.data.maxFeeBps === 200
    && originalMandate.data.maxEvidenceAgeSeconds === 600
    && originalMandate.data.monitorIntervalSeconds === 120
    && originalMandate.data.maxMonitorCycles === 4
    && originalMandate.data.targets.length === 1
    && originalMandate.data.targets[0].assetId === FIXTURE_GT
    && originalMandate.data.targets[0].weightBps === 2500;
  check('V214: explicit setup retains the selected reserve, capital bounds and receipt target', originalMandateIsFixtureBound);

  const draftBeforeCopy = await readFields(policyFieldSelectors);
  const mandatePostsBeforeCopy = cfoPosts('mandate').length;
  const cfoPostsBeforeCopy = cfoPosts().length;
  const capturesBeforeCopy = fixtureCalls.capture;
  const quoteCallsBeforeCopy = fixtureCalls.quote;
  const generatedBeforeCopy = fixtureCalls.generateIntent;
  await clickSelector('[data-testid="cfo-use-template"]');
  await wait(`document.querySelector('#cfo-maxPositionBps')?.value === '25'
    && document.querySelector('#cfo-slippageBps')?.value === '0.5'
    && document.querySelector('#cfo-maxFeeBps')?.value === '1'
    && document.querySelector('#cfo-maxEvidenceAgeSeconds')?.value === '300'
    && document.querySelector('#cfo-monitorIntervalSeconds')?.value === '300'
    && document.querySelector('#cfo-maxMonitorCycles')?.value === '12'`);
  const draftAfterCopy = await readFields(policyFieldSelectors);
  const expectedTemplateDraft = {
    '#cfo-maxPositionBps': '25',
    '#cfo-slippageBps': '0.5',
    '#cfo-maxFeeBps': '1',
    '#cfo-maxEvidenceAgeSeconds': '300',
    '#cfo-monitorIntervalSeconds': '300',
    '#cfo-maxMonitorCycles': '12',
  };
  const templateDraftChanged = Object.entries(expectedTemplateDraft).every(([selector, value]) =>
    draftAfterCopy[selector] === value && draftBeforeCopy[selector] !== value);
  const protectedDraftSelectors = [
    '#cfo-reserveAssetId', '#cfo-reserve-floor-amount', '#cfo-action-cap-amount',
    '#cfo-target-0-assetId', '#cfo-target-0-weightBps',
  ];
  const protectedDraftPreserved = protectedDraftSelectors.every(selector => draftAfterCopy[selector] === draftBeforeCopy[selector]);
  const mandateAfterCopy = await cfoStore.latest(r5Identity.ownerId, 'mandate');
  await screenshotElement('owner-r5-policy.png', '[data-testid="cfo-use-template"]');
  check('V214: explicit template copy changes only six risk/operation draft fields and never saves or starts work',
    templateDraftChanged && protectedDraftPreserved
      && cfoPosts('mandate').length === mandatePostsBeforeCopy
      && cfoPosts().length === cfoPostsBeforeCopy
      && mandateAfterCopy?.id === originalMandate.id
      && JSON.stringify(mandateAfterCopy.data) === originalMandateData
      && fixtureCalls.capture === capturesBeforeCopy
      && fixtureCalls.quote === quoteCallsBeforeCopy
      && fixtureCalls.generateIntent === generatedBeforeCopy);

  const draftRefreshCount = cfoOverviewReads().length;
  await click('Refresh service state');
  await waitUntil(() => cfoOverviewReads().length === draftRefreshCount + 1 && cfoOverviewReads().at(-1)?.status === 200);
  await wait(`Boolean(${button('Refresh service state')} && !${button('Refresh service state')}.disabled)`);
  const draftAfterRefresh = await readFields(policyFieldSelectors);
  const mandateAfterRefresh = await cfoStore.latest(r5Identity.ownerId, 'mandate');
  check('V214: a dirty template draft survives an authenticated overview refresh without rewriting saved limits',
    JSON.stringify(draftAfterRefresh) === JSON.stringify(draftAfterCopy)
      && mandateAfterRefresh?.id === originalMandate.id
      && JSON.stringify(mandateAfterRefresh.data) === originalMandateData
      && latestAuthenticatedOverview?.policyTemplate
      && Object.entries(EXPECTED_CONSUMER_TEMPLATE).every(([key, value]) => latestAuthenticatedOverview.policyTemplate[key] === value));

  const readsBeforeTemplateSave = cfoOverviewReads().length;
  const mandatePostsBeforeTemplateSave = cfoPosts('mandate').length;
  await evaluate(`${mandateSubmit}.click()`);
  await waitUntil(() => cfoPosts('mandate').length === mandatePostsBeforeTemplateSave + 1 && cfoPosts('mandate').at(-1)?.status === 200);
  await waitUntil(() => cfoOverviewReads().length > readsBeforeTemplateSave && cfoOverviewReads().at(-1)?.status === 200);
  await wait(`Boolean(${mandateSubmit} && !${mandateSubmit}.disabled)`);
  const savedMandate = await cfoStore.latest(r5Identity.ownerId, 'mandate');
  const savedMandateUsesTemplate = savedMandate?.data.maxPositionBps === EXPECTED_CONSUMER_TEMPLATE.maxPositionBps
    && savedMandate.data.slippageBps === EXPECTED_CONSUMER_TEMPLATE.slippageBps
    && savedMandate.data.maxFeeBps === EXPECTED_CONSUMER_TEMPLATE.maxFeeBps
    && savedMandate.data.maxEvidenceAgeSeconds === EXPECTED_CONSUMER_TEMPLATE.maxEvidenceAgeSeconds
    && savedMandate.data.monitorIntervalSeconds === EXPECTED_CONSUMER_TEMPLATE.monitorIntervalSeconds
    && savedMandate.data.maxMonitorCycles === EXPECTED_CONSUMER_TEMPLATE.maxMonitorCycles
    && savedMandate.data.reserveAssetId === originalMandate.data.reserveAssetId
    && savedMandate.data.reserveFloorBaseUnits === originalMandate.data.reserveFloorBaseUnits
    && savedMandate.data.maxActionReserveBaseUnits === originalMandate.data.maxActionReserveBaseUnits
    && savedMandate.data.targets[0].assetId === originalMandate.data.targets[0].assetId
    && savedMandate.data.targets[0].weightBps === originalMandate.data.targets[0].weightBps;
  check('V214: a separate explicit save adopts numeric template limits without changing capital or targets', savedMandateUsesTemplate);

  const expectedRedeemBaseUnits = '123456789012345678';
  await fillField('#cfo-action-type', 'redeem');
  await click('Select gtUSDCp');
  await wait(`Boolean(document.querySelector('#cfo-action-amount') && !document.querySelector('#cfo-action-amount').disabled)`);
  check('V215: selected position has no inferred amount before explicit owner entry',
    await fieldValue('#cfo-action-amount') === '');
  await fillField('#cfo-action-amount', '0.123456789012345678');
  await screenshotElement('owner-r5-amount.png', '#cfo-action-amount');
  const overviewReadsBeforePlan = cfoOverviewReads().length;
  const planPostsBefore = cfoPosts('plans').length;
  await click('Check deterministic exit plan');
  await waitUntil(() => cfoPosts('plans').length === planPostsBefore + 1 && cfoPosts('plans').at(-1)?.status === 200);
  await waitUntil(() => cfoOverviewReads().length > overviewReadsBeforePlan && cfoOverviewReads().at(-1)?.status === 200);
  await wait(`Boolean(${button('Prepare exact unsigned action')} && !${button('Prepare exact unsigned action')}.disabled)`);
  const planRecord = await cfoStore.latest(r5Identity.ownerId, 'plan');
  check('V215: exact human amount uses observed 18-decimal held-token metadata, not a default or Number conversion',
    observedReceipt?.decimals === 18
      && planRecord?.data.request.action === 'redeem'
      && planRecord.data.request.sourceAssetId === FIXTURE_GT
      && planRecord.data.request.targetAssetId === FIXTURE_RESERVE
      && planRecord.data.request.inputBaseUnits === expectedRedeemBaseUnits
      && BigInt(expectedRedeemBaseUnits) > BigInt(Number.MAX_SAFE_INTEGER)
      && fixtureCalls.review === 0);

  const preparePostsBefore = cfoPosts('prepare').length;
  const cfoPostsBeforePrepare = cfoPosts().length;
  const overviewReadsBeforePrepare = cfoOverviewReads().length;
  failNextOverviewRead = true;
  await click('Prepare exact unsigned action');
  await wait(`Boolean(document.querySelector('[data-testid="cfo-retry-quote-read"]')
    && !document.querySelector('[data-testid="cfo-retry-quote-read"]').disabled)`);
  await waitUntil(() => cfoOverviewReads().length === overviewReadsBeforePrepare + 1 && cfoOverviewReads().at(-1)?.status === 503);
  await screenshotElement('owner-r5-quote-blocked.png', '[data-testid="cfo-retry-quote-read"]');
  const preparePostsAfterFailure = cfoPosts('prepare');
  const actionHeadBeforeRetry = await cfoStore.latest(r5Identity.ownerId, 'action');
  assert.ok(actionHeadBeforeRetry?.data.actionId, 'The single prepare must create a retained action head.');
  const preparedActionId = actionHeadBeforeRetry.data.actionId;
  const preparedAction = await cfoStore.latestAction(r5Identity.ownerId, preparedActionId);
  const preparedQuote = preparedAction?.data.quote;
  const preparedQuoteRequest = preparedQuote?.raw?.quoteRequest;
  const preparedQuoteBounds = preparedQuote?.raw?.quote;
  const preparedResponseMatches = lastPrepareResponse?.actionId === preparedActionId
    && lastPrepareResponse.standard === 'raw_ed25519'
    && typeof lastPrepareResponse.payload === 'string' && lastPrepareResponse.payload.length > 0
    && lastPrepareResponse.expiresAt === preparedQuoteBounds?.deadline;
  const actionBoundsAreExact = preparedAction?.data.status === 'PREPARED'
    && preparedAction.data.wallet === walletAddress
    && preparedAction.data.action === 'redeem'
    && preparedAction.data.planId === planRecord?.id
    && preparedAction.data.mandateId === savedMandate?.id
    && preparedAction.data.portfolioId === observedPortfolio?.id
    && preparedAction.data.sourceAssetId === FIXTURE_GT
    && preparedAction.data.targetAssetId === FIXTURE_RESERVE
    && preparedAction.data.inputBaseUnits === expectedRedeemBaseUnits
    && /^[0-9a-f]{64}$/.test(preparedQuote?.sha256 ?? '')
    && preparedQuote.signatureVerified === true
    && preparedQuoteRequest?.originAsset === FIXTURE_GT
    && preparedQuoteRequest?.destinationAsset === FIXTURE_RESERVE
    && preparedQuoteRequest?.amount === expectedRedeemBaseUnits
    && preparedQuoteRequest?.dry === false
    && preparedQuoteRequest?.swapType === 'EXACT_INPUT'
    && preparedQuoteRequest?.depositType === 'INTENTS'
    && preparedQuoteRequest?.refundType === 'INTENTS'
    && preparedQuoteRequest?.recipientType === 'INTENTS'
    && preparedQuoteRequest?.slippageTolerance === savedMandate?.data.slippageBps
    && preparedQuoteRequest?.refundTo === observedPortfolio?.data.signerId
    && preparedQuoteRequest?.recipient === observedPortfolio?.data.signerId
    && preparedQuoteRequest?.deadline === preparedQuoteBounds?.deadline
    && preparedQuote?.raw?.timestamp === preparedQuote.capturedAt
    && preparedQuoteBounds?.amountIn === expectedRedeemBaseUnits
    && preparedQuoteBounds?.minAmountIn === expectedRedeemBaseUnits
    && preparedQuoteBounds?.amountOut === '123456'
    && preparedQuoteBounds?.minAmountOut === '123456'
    && preparedQuoteBounds?.refundFee === '0'
    && preparedQuoteBounds?.withdrawFee === '0'
    && preparedQuoteBounds?.depositAddress === 'fixture-near-deposit-address'
    && typeof preparedQuoteBounds?.deadline === 'string'
    && Date.parse(preparedQuoteBounds.deadline) > Date.now()
    && preparedAction.data.payload === lastPrepareResponse?.payload;
  const signButtonSelector = '[data-testid="cfo-sign-exact-action"]';
  const retainedQuoteRetryReady = `(() => {
    const retry = document.querySelector('[data-testid="cfo-retry-quote-read"]');
    return Boolean(retry && !retry.disabled && retry.getAttribute('aria-busy') !== 'true');
  })()`;
  const signUnavailableAfterFailedRead = await evaluate(`(() => {
    const button = document.querySelector(${JSON.stringify(signButtonSelector)});
    return !button || button.disabled;
  })()`);
  check('V216: failed authenticated quote read leaves one exact action retained but signing unavailable',
    failNextOverviewRead === false
      && cfoOverviewReads().length === overviewReadsBeforePrepare + 1
      && cfoOverviewReads().at(-1)?.status === 503
      && preparePostsAfterFailure.length === preparePostsBefore + 1
      && preparePostsAfterFailure.at(-1)?.status === 200
      && actionBoundsAreExact && preparedResponseMatches
      && signUnavailableAfterFailedRead
      && await evaluate('window.__ownerTestWallet.signCalls') === r5SignCallsAtEntry);
  const generationCallsAtFailedRead = fixtureCalls.generateIntent;
  const quoteCallsAtFailedRead = fixtureCalls.quote;
  const reviewCallsAtFailedRead = fixtureCalls.review;
  await clickSelector('[data-testid="cfo-retry-quote-read"]');
  await waitUntil(() => cfoOverviewReads().length === overviewReadsBeforePrepare + 2 && cfoOverviewReads().at(-1)?.status === 200);
  await wait(`Boolean(document.querySelector(${JSON.stringify(signButtonSelector)})
    && !document.querySelector(${JSON.stringify(signButtonSelector)}).disabled)`);
  const signPromptEnabledAfterRetry = await evaluate(`(() => {
    const button = document.querySelector(${JSON.stringify(signButtonSelector)});
    return Boolean(button && !button.disabled);
  })()`);
  const retainedOverviewAction = latestAuthenticatedOverview?.actions?.find(record => record.data?.actionId === preparedActionId);
  const retainedOverviewPlan = latestAuthenticatedOverview?.plans?.find(record => record?.id === planRecord.id);
  const retainedOverviewQuote = retainedOverviewAction?.data.quote;
  const retainedQuoteRequest = retainedOverviewQuote?.raw?.quoteRequest;
  const retainedQuoteBounds = retainedOverviewQuote?.raw?.quote;
  const retryReadRows = cfoOverviewReads().slice(overviewReadsBeforePrepare);
  const retryReadIs503Then200 = retryReadRows.length === 2
    && retryReadRows[0].status === 503 && retryReadRows[1].status === 200;
  const retainedActionContextMatches = retainedOverviewAction?.id === preparedAction.id
    && retainedOverviewAction.data.status === 'PREPARED'
    && retainedOverviewAction.data.actionId === preparedActionId
    && retainedOverviewAction.data.action === preparedAction.data.action
    && retainedOverviewAction.data.planId === planRecord.id
    && retainedOverviewAction.data.mandateId === savedMandate.id
    && retainedOverviewAction.data.portfolioId === observedPortfolio.id
    && retainedOverviewAction.data.wallet === walletAddress
    && retainedOverviewAction.data.sourceAssetId === FIXTURE_GT
    && retainedOverviewAction.data.targetAssetId === FIXTURE_RESERVE
    && retainedOverviewAction.data.inputBaseUnits === expectedRedeemBaseUnits
    && retainedOverviewAction.data.standard === preparedAction.data.standard
    && retainedOverviewPlan?.data?.wallet === walletAddress
    && retainedOverviewPlan?.data?.request?.action === 'redeem'
    && retainedOverviewPlan.data.request.sourceAssetId === FIXTURE_GT
    && retainedOverviewPlan.data.request.targetAssetId === FIXTURE_RESERVE
    && retainedOverviewPlan.data.request.inputBaseUnits === expectedRedeemBaseUnits
    && latestAuthenticatedOverview?.mandate?.id === savedMandate.id
    && latestAuthenticatedOverview.mandate.data.wallet === walletAddress
    && latestAuthenticatedOverview?.portfolio?.id === observedPortfolio.id
    && latestAuthenticatedOverview.portfolio.data.wallet === walletAddress;
  const retainedQuoteEnvelopeMatches = retainedOverviewQuote?.schemaVersion === 1
    && retainedOverviewQuote.signatureVerified === true
    && retainedOverviewQuote.capturedAt === preparedQuote.capturedAt
    && retainedOverviewQuote.raw?.timestamp === preparedQuote.raw.timestamp;
  const retainedQuoteHashMatches = /^[0-9a-f]{64}$/.test(retainedOverviewQuote?.sha256 ?? '')
    && retainedOverviewQuote.sha256 === preparedQuote.sha256;
  const retainedQuoteRequestChecks = {
    sourceAsset: retainedQuoteRequest?.originAsset === FIXTURE_GT,
    destinationAsset: retainedQuoteRequest?.destinationAsset === FIXTURE_RESERVE,
    exactInput: retainedQuoteRequest?.amount === expectedRedeemBaseUnits,
    dryRunDisabled: retainedQuoteRequest?.dry === false,
    exactInputSwap: retainedQuoteRequest?.swapType === 'EXACT_INPUT',
    depositType: retainedQuoteRequest?.depositType === 'INTENTS',
    refundType: retainedQuoteRequest?.refundType === 'INTENTS',
    recipientType: retainedQuoteRequest?.recipientType === 'INTENTS',
    slippage: retainedQuoteRequest?.slippageTolerance === savedMandate.data.slippageBps,
    refundSigner: retainedQuoteRequest?.refundTo === observedPortfolio.data.signerId,
    recipientSigner: retainedQuoteRequest?.recipient === observedPortfolio.data.signerId,
    expiry: retainedQuoteRequest?.deadline === preparedQuoteBounds.deadline,
  };
  const retainedQuoteRequestMatches = Object.values(retainedQuoteRequestChecks).every(Boolean);
  const retainedQuoteBoundsChecks = {
    exactInput: retainedQuoteBounds?.amountIn === expectedRedeemBaseUnits,
    minimumInput: retainedQuoteBounds?.minAmountIn === expectedRedeemBaseUnits,
    estimatedOutput: retainedQuoteBounds?.amountOut === '123456',
    minimumOutput: retainedQuoteBounds?.minAmountOut === '123456',
    originRefundFee: retainedQuoteBounds?.refundFee === '0',
    destinationWithdrawalFee: retainedQuoteBounds?.withdrawFee === '0',
    destination: retainedQuoteBounds?.depositAddress === 'fixture-near-deposit-address',
    expiryMatchesPreparedQuote: retainedQuoteBounds?.deadline === preparedQuoteBounds.deadline,
    expiryIsFuture: typeof retainedQuoteBounds?.deadline === 'string'
      && Date.parse(retainedQuoteBounds.deadline) > Date.now(),
  };
  const retainedQuoteBoundsMatch = Object.values(retainedQuoteBoundsChecks).every(Boolean);
  const visibleQuoteFields = await evaluate(`(() => {
    const root = document.querySelector('.cfo-quote-review');
    if (!root) return null;
    return Object.fromEntries([...root.querySelectorAll('dl > div')].map(row => [
      row.querySelector('dt')?.innerText?.trim() ?? '',
      row.querySelector('dd')?.innerText?.trim() ?? '',
    ]).filter(([label, value]) => label && value));
  })()`);
  const displayedAmountChecks = {
    exactDebit: displayedAmountEquals(visibleQuoteFields?.['Exact debit'], expectedRedeemBaseUnits, 18, 'gtUSDCp'),
    minimumDebit: displayedAmountEquals(visibleQuoteFields?.['Minimum debit bound'], expectedRedeemBaseUnits, 18, 'gtUSDCp'),
    estimatedOutput: displayedAmountEquals(visibleQuoteFields?.['Estimated output'], '123456', 6, 'USDC'),
    minimumOutput: displayedAmountEquals(visibleQuoteFields?.['Minimum output bound'], '123456', 6, 'USDC'),
    originRefundFee: displayedAmountEquals(visibleQuoteFields?.['Origin refund fee'], '0', 18, 'gtUSDCp'),
    destinationWithdrawalFee: displayedAmountEquals(visibleQuoteFields?.['Destination withdrawal fee'], '0', 6, 'USDC'),
  };
  const displayedContextChecks = {
    sourceAsset: visibleQuoteFields?.['Source asset'] === 'gtUSDCp',
    destinationAsset: visibleQuoteFields?.['Destination asset'] === 'USDC',
    destination: visibleQuoteFields?.Destination === preparedQuoteBounds.depositAddress,
    expiry: visibleQuoteFields?.['Quote expires'] === preparedQuoteBounds.deadline,
  };
  const displayedExactBounds = Object.values(displayedAmountChecks).every(Boolean)
    && Object.values(displayedContextChecks).every(Boolean);
  await clickSelector('.cfo-payload-panel details.cfo-evidence-details > summary');
  const technicalAudit = await evaluate(`(() => {
    const details = document.querySelector('.cfo-payload-panel details.cfo-evidence-details');
    if (!details) return { opened: false, actionIdMatches: false, quoteHashMatches: false };
    const text = details.querySelector('pre')?.innerText ?? '';
    return {
      opened: details.open,
      actionIdMatches: text.includes(${JSON.stringify(preparedActionId)}),
      quoteHashMatches: text.includes(${JSON.stringify(preparedQuote.sha256)}),
    };
  })()`);
  const technicalAuditHasExactIdentity = technicalAudit.opened
    && technicalAudit.actionIdMatches && technicalAudit.quoteHashMatches;
  const retryPrepareWasSingle = cfoPosts('prepare').length === preparePostsBefore + 1
    && cfoPosts().length === cfoPostsBeforePrepare + 1;
  const retryDidNoGeneration = fixtureCalls.generateIntent === generationCallsAtFailedRead
    && fixtureCalls.quote === quoteCallsAtFailedRead
    && fixtureCalls.review === reviewCallsAtFailedRead;
  const retryDidNotSign = await evaluate('window.__ownerTestWallet.signCalls') === r5SignCallsAtEntry
    && cfoPosts('signatures').length === 0
    && cfoPosts('relay').length === 0
    && fixtureCalls.validateSigned === 0
    && fixtureCalls.submitIntent === 0;
  const quoteReviewStatus = await evaluate(`document.querySelector('.cfo-quote-review .cfo-action-status')?.innerText ?? ''`);
  const quoteReviewReason = await evaluate(`document.querySelector('.cfo-quote-review [role="alert"]')?.innerText ?? ''`);
  const retryPredicateConjuncts = {
    getRetryIs503Then200: retryReadIs503Then200,
    sameActionPlanOwnerMandatePortfolio: retainedActionContextMatches,
    samePublicQuoteEnvelope: retainedQuoteEnvelopeMatches,
    samePublicQuoteHash: retainedQuoteHashMatches,
    exactQuoteRequest: retainedQuoteRequestMatches,
    exactInputMinimumCostDestinationAndExpiry: retainedQuoteBoundsMatch,
    exactDisplayedAmountsAndBounds: displayedExactBounds,
    rawIdentifiersAndHashCheckedInOpenTechnicalAudit: technicalAuditHasExactIdentity,
    onePrepareOnly: retryPrepareWasSingle,
    noQuoteIntentOrReviewGeneration: retryDidNoGeneration,
    noSignature: retryDidNotSign,
    signPromptEnabledAfterRetry,
  };
  const retryPredicateDiagnostics = {
    conjuncts: retryPredicateConjuncts,
    overviewContext: {
      planMatches: retainedOverviewPlan?.data?.wallet === walletAddress
        && retainedOverviewPlan?.data?.request?.action === 'redeem'
        && retainedOverviewPlan.data.request.sourceAssetId === FIXTURE_GT
        && retainedOverviewPlan.data.request.targetAssetId === FIXTURE_RESERVE
        && retainedOverviewPlan.data.request.inputBaseUnits === expectedRedeemBaseUnits,
      mandateMatches: latestAuthenticatedOverview?.mandate?.id === savedMandate.id
        && latestAuthenticatedOverview.mandate.data.wallet === walletAddress,
      portfolioMatches: latestAuthenticatedOverview?.portfolio?.id === observedPortfolio.id
        && latestAuthenticatedOverview.portfolio.data.wallet === walletAddress,
    },
    retainedActionFields: {
      recordIdMatches: retainedOverviewAction?.id === preparedAction.id,
      actionIdMatches: retainedOverviewAction?.data?.actionId === preparedActionId,
      statusMatches: retainedOverviewAction?.data?.status === 'PREPARED',
      planMatches: retainedOverviewAction?.data?.planId === planRecord.id,
      ownerWalletMatches: retainedOverviewAction?.data?.wallet === walletAddress,
      mandateMatches: retainedOverviewAction?.data?.mandateId === savedMandate.id,
      portfolioMatches: retainedOverviewAction?.data?.portfolioId === observedPortfolio.id,
      sourceMatches: retainedOverviewAction?.data?.sourceAssetId === FIXTURE_GT,
      destinationAssetMatches: retainedOverviewAction?.data?.targetAssetId === FIXTURE_RESERVE,
      exactInputMatches: retainedOverviewAction?.data?.inputBaseUnits === expectedRedeemBaseUnits,
      formatMatches: retainedOverviewAction?.data?.standard === preparedAction.data.standard,
    },
    retainedQuoteFields: {
      schemaVersionMatches: retainedOverviewQuote?.schemaVersion === 1,
      signatureVerifiedMatches: retainedOverviewQuote?.signatureVerified === true,
      hashMatchesPreparedQuote: retainedQuoteHashMatches,
      capturedAtMatches: retainedOverviewQuote?.capturedAt === preparedQuote.capturedAt,
      request: retainedQuoteRequestChecks,
      bounds: retainedQuoteBoundsChecks,
    },
    displayedFields: {
      amounts: displayedAmountChecks,
      context: displayedContextChecks,
      technicalAudit,
    },
    requests: {
      retryStatuses: retryReadRows.map(row => row.status),
      preparePostsSinceStart: cfoPosts('prepare').length - preparePostsBefore,
      generatedIntentsSinceFailedRead: fixtureCalls.generateIntent - generationCallsAtFailedRead,
      quotesSinceFailedRead: fixtureCalls.quote - quoteCallsAtFailedRead,
      reviewsSinceFailedRead: fixtureCalls.review - reviewCallsAtFailedRead,
      signaturesAtEntry: r5SignCallsAtEntry,
      signaturesNow: await evaluate('window.__ownerTestWallet.signCalls'),
    },
    quoteReviewStatus: diagnosticText(quoteReviewStatus),
    quoteReviewReason: diagnosticReviewReason(quoteReviewReason),
  };
  check('V216: GET-only retry reads the same persisted action bounds before enabling its wallet prompt',
    Object.values(retryPredicateConjuncts).every(Boolean), retryPredicateDiagnostics);
  const cfoWorkSnapshot = async () => ({
    cfoPosts: cfoPosts().length,
    preparePosts: cfoPosts('prepare').length,
    signaturePosts: cfoPosts('signatures').length,
    relayPosts: cfoPosts('relay').length,
    allHttpPosts: requests.filter(row => row.method === 'POST').length,
    adapterCalls: { ...fixtureCalls },
    walletSignCalls: await evaluate('window.__ownerTestWallet.signCalls'),
  });
  const workCounterChecksSince = async baseline => {
    const current = await cfoWorkSnapshot();
    const adapterChecks = Object.fromEntries(Object.entries(baseline.adapterCalls).map(([name, count]) => [
      `${name}AdapterCallsUnchanged`, current.adapterCalls[name] === count,
    ]));
    return {
      cfoPostsUnchanged: current.cfoPosts === baseline.cfoPosts,
      preparePostsUnchanged: current.preparePosts === baseline.preparePosts,
      signaturePostsUnchanged: current.signaturePosts === baseline.signaturePosts,
      relayPostsUnchanged: current.relayPosts === baseline.relayPosts,
      allHttpPostsUnchanged: current.allHttpPosts === baseline.allHttpPosts,
      ...adapterChecks,
      walletSignCallsUnchanged: current.walletSignCalls === baseline.walletSignCalls,
    };
  };
  const postPrepareWorkBaseline = await cfoWorkSnapshot();

  const quoteCorruptionReadBefore = cfoOverviewReads().length;
  nextOverviewResponseTransform = { kind: 'corrupt-quote-bytes', actionId: preparedActionId };
  await click('Refresh service state');
  await waitUntil(() => cfoOverviewReads().length === quoteCorruptionReadBefore + 1
    && cfoOverviewReads().at(-1)?.status === 200);
  await wait(retainedQuoteRetryReady);
  const quoteCorruptedAction = latestAuthenticatedOverview?.actions?.find(record => record.data?.actionId === preparedActionId);
  const storedActionAfterQuoteCorruption = await cfoStore.latestAction(r5Identity.ownerId, preparedActionId);
  const quoteCorruptionSignUnavailable = await evaluate(`(() => {
    const button = document.querySelector(${JSON.stringify(signButtonSelector)});
    return !button || button.disabled;
  })()`);
  const quoteCorruptionWorkChecks = await workCounterChecksSince(postPrepareWorkBaseline);
  const quoteCorruptionNoWork = Object.values(quoteCorruptionWorkChecks).every(Boolean);
  const quoteCorruptionChecks = {
    exactlyOneSuccessfulGet: cfoOverviewReads().length === quoteCorruptionReadBefore + 1
      && cfoOverviewReads().at(-1)?.status === 200,
    transformedSameAction: quoteCorruptedAction?.id === preparedAction.id
      && quoteCorruptedAction?.data?.actionId === preparedActionId,
    rawQuoteBytesChanged: quoteCorruptedAction?.data?.quote?.raw?.quote?.amountOut === '123457',
    actionContextOtherwiseMatches: quoteCorruptedAction?.data?.wallet === walletAddress
      && quoteCorruptedAction?.data?.planId === planRecord.id
      && quoteCorruptedAction?.data?.mandateId === savedMandate.id
      && quoteCorruptedAction?.data?.portfolioId === observedPortfolio.id
      && quoteCorruptedAction?.data?.sourceAssetId === FIXTURE_GT
      && quoteCorruptedAction?.data?.targetAssetId === FIXTURE_RESERVE
      && quoteCorruptedAction?.data?.inputBaseUnits === expectedRedeemBaseUnits,
    claimedQuoteHashPreserved: quoteCorruptedAction?.data?.quote?.sha256 === preparedQuote.sha256,
    persistedQuoteUnchanged: storedActionAfterQuoteCorruption?.id === preparedAction.id
      && storedActionAfterQuoteCorruption?.data?.quote?.raw?.quote?.amountOut === '123456'
      && storedActionAfterQuoteCorruption?.data?.quote?.sha256 === preparedQuote.sha256,
    signingUnavailable: quoteCorruptionSignUnavailable,
    noPrepareGenerationReviewSignOrRelay: quoteCorruptionNoWork,
  };
  check('V216: changed retained quote bytes with the original claimed hash keep signing blocked',
    Object.values(quoteCorruptionChecks).every(Boolean), {
      checks: quoteCorruptionChecks,
      noWorkCounters: quoteCorruptionWorkChecks,
      quoteReviewReason: diagnosticReviewReason(await evaluate(
        `document.querySelector('.cfo-quote-review [role="alert"]')?.textContent ?? ''`)),
    });

  const contextMismatchReadBefore = cfoOverviewReads().length;
  const mismatchedMandateId = randomUUID();
  nextOverviewResponseTransform = {
    kind: 'mismatch-mandate-context', actionId: preparedActionId, mandateId: mismatchedMandateId,
  };
  await click('Refresh service state');
  await waitUntil(() => cfoOverviewReads().length === contextMismatchReadBefore + 1
    && cfoOverviewReads().at(-1)?.status === 200);
  await wait(retainedQuoteRetryReady);
  const contextMismatchedAction = latestAuthenticatedOverview?.actions?.find(record => record.data?.actionId === preparedActionId);
  const storedActionAfterContextMismatch = await cfoStore.latestAction(r5Identity.ownerId, preparedActionId);
  const contextMismatchSignUnavailable = await evaluate(`(() => {
    const button = document.querySelector(${JSON.stringify(signButtonSelector)});
    return !button || button.disabled;
  })()`);
  const contextMismatchWorkChecks = await workCounterChecksSince(postPrepareWorkBaseline);
  const contextMismatchNoWork = Object.values(contextMismatchWorkChecks).every(Boolean);
  const contextMismatchChecks = {
    exactlyOneSuccessfulGet: cfoOverviewReads().length === contextMismatchReadBefore + 1
      && cfoOverviewReads().at(-1)?.status === 200,
    transformedSameAction: contextMismatchedAction?.id === preparedAction.id
      && contextMismatchedAction?.data?.actionId === preparedActionId,
    mandateContextMismatchApplied: contextMismatchedAction?.data?.mandateId === mismatchedMandateId
      && mismatchedMandateId !== savedMandate.id,
    otherContextRemainsCurrent: contextMismatchedAction?.data?.wallet === walletAddress
      && contextMismatchedAction?.data?.planId === planRecord.id
      && contextMismatchedAction?.data?.portfolioId === observedPortfolio.id
      && latestAuthenticatedOverview?.mandate?.id === savedMandate.id
      && latestAuthenticatedOverview?.portfolio?.id === observedPortfolio.id
      && contextMismatchedAction?.data?.quote?.sha256 === preparedQuote.sha256
      && contextMismatchedAction?.data?.quote?.raw?.quote?.amountOut === '123456',
    persistedActionContextUnchanged: storedActionAfterContextMismatch?.id === preparedAction.id
      && storedActionAfterContextMismatch?.data?.mandateId === savedMandate.id,
    signingUnavailable: contextMismatchSignUnavailable,
    noPrepareGenerationReviewSignOrRelay: contextMismatchNoWork,
  };
  check('V216: a retained action mandate mismatch keeps signing unavailable',
    Object.values(contextMismatchChecks).every(Boolean), {
      checks: contextMismatchChecks,
      noWorkCounters: contextMismatchWorkChecks,
      quoteReviewReason: diagnosticReviewReason(await evaluate(
        `document.querySelector('.cfo-quote-review [role="alert"]')?.textContent ?? ''`)),
    });

  const genuineRecoveryReadBefore = cfoOverviewReads().length;
  nextOverviewResponseTransform = null;
  await click('Refresh service state');
  await waitUntil(() => cfoOverviewReads().length === genuineRecoveryReadBefore + 1
    && cfoOverviewReads().at(-1)?.status === 200);
  await wait(`Boolean(document.querySelector(${JSON.stringify(signButtonSelector)})
    && !document.querySelector(${JSON.stringify(signButtonSelector)}).disabled)`);
  const restoredOverviewAction = latestAuthenticatedOverview?.actions?.find(record => record.data?.actionId === preparedActionId);
  const restoredOverviewPlan = latestAuthenticatedOverview?.plans?.find(record => record?.id === planRecord.id);
  const storedActionAfterGenuineRecovery = await cfoStore.latestAction(r5Identity.ownerId, preparedActionId);
  const genuineRecoveryWorkChecks = await workCounterChecksSince(postPrepareWorkBaseline);
  const genuineRecoveryNoWork = Object.values(genuineRecoveryWorkChecks).every(Boolean);
  const genuineRecoverySignEnabled = await evaluate(`(() => {
    const button = document.querySelector(${JSON.stringify(signButtonSelector)});
    return Boolean(button && !button.disabled);
  })()`);
  const genuineRecoveryChecks = {
    exactlyOneSuccessfulGet: cfoOverviewReads().length === genuineRecoveryReadBefore + 1
      && cfoOverviewReads().at(-1)?.status === 200,
    sameActionRecord: restoredOverviewAction?.id === preparedAction.id
      && restoredOverviewAction?.data?.actionId === preparedActionId
      && restoredOverviewAction?.data?.status === 'PREPARED'
      && restoredOverviewAction?.data?.action === 'redeem'
      && restoredOverviewAction?.data?.sourceAssetId === FIXTURE_GT
      && restoredOverviewAction?.data?.targetAssetId === FIXTURE_RESERVE
      && restoredOverviewAction?.data?.inputBaseUnits === expectedRedeemBaseUnits,
    samePlanOwnerMandatePortfolio: restoredOverviewAction?.data?.planId === planRecord.id
      && restoredOverviewPlan?.data?.wallet === walletAddress
      && restoredOverviewPlan?.data?.request?.action === 'redeem'
      && restoredOverviewPlan.data.request.sourceAssetId === FIXTURE_GT
      && restoredOverviewPlan.data.request.targetAssetId === FIXTURE_RESERVE
      && restoredOverviewPlan.data.request.inputBaseUnits === expectedRedeemBaseUnits
      && restoredOverviewAction?.data?.wallet === walletAddress
      && restoredOverviewAction?.data?.mandateId === savedMandate.id
      && latestAuthenticatedOverview?.mandate?.id === savedMandate.id
      && latestAuthenticatedOverview.mandate.data.wallet === walletAddress
      && restoredOverviewAction?.data?.portfolioId === observedPortfolio.id
      && latestAuthenticatedOverview?.portfolio?.id === observedPortfolio.id
      && latestAuthenticatedOverview.portfolio.data.wallet === walletAddress,
    genuineQuoteRestored: restoredOverviewAction?.data?.quote?.sha256 === preparedQuote.sha256
      && restoredOverviewAction?.data?.quote?.signatureVerified === true
      && restoredOverviewAction?.data?.quote?.raw?.quoteRequest?.originAsset === FIXTURE_GT
      && restoredOverviewAction?.data?.quote?.raw?.quoteRequest?.destinationAsset === FIXTURE_RESERVE
      && restoredOverviewAction?.data?.quote?.raw?.quoteRequest?.amount === expectedRedeemBaseUnits
      && restoredOverviewAction?.data?.quote?.raw?.quote?.amountIn === expectedRedeemBaseUnits
      && restoredOverviewAction?.data?.quote?.raw?.quote?.minAmountIn === expectedRedeemBaseUnits
      && restoredOverviewAction?.data?.quote?.raw?.quote?.amountOut === '123456'
      && restoredOverviewAction?.data?.quote?.raw?.quote?.minAmountOut === '123456'
      && restoredOverviewAction?.data?.quote?.raw?.quote?.refundFee === '0'
      && restoredOverviewAction?.data?.quote?.raw?.quote?.withdrawFee === '0'
      && restoredOverviewAction?.data?.quote?.raw?.quote?.depositAddress === preparedQuoteBounds.depositAddress
      && restoredOverviewAction?.data?.quote?.raw?.quote?.deadline === preparedQuoteBounds.deadline,
    persistedActionStillUnsigned: storedActionAfterGenuineRecovery?.id === preparedAction.id
      && storedActionAfterGenuineRecovery?.data?.status === 'PREPARED'
      && storedActionAfterGenuineRecovery?.data?.signatureBase64 === null
      && storedActionAfterGenuineRecovery?.data?.signedData === null,
    signingEnabledForSameAction: genuineRecoverySignEnabled,
    noPrepareGenerationReviewSignOrRelay: genuineRecoveryNoWork,
  };
  check('V216: GET-only recovery restores the same genuine retained action after bounded response corruption',
    Object.values(genuineRecoveryChecks).every(Boolean), {
      checks: genuineRecoveryChecks,
      noWorkCounters: genuineRecoveryWorkChecks,
    });

  await evaluate('window.__ownerTestWallet.switchWallet()');
  await wait(`(() => {
    const button = document.querySelector(${JSON.stringify(signButtonSelector)});
    return !button || button.disabled;
  })()`);
  const actionAfterWalletSwitch = await cfoStore.latestAction(r5Identity.ownerId, preparedActionId);
  check('V216: a wallet-account change invalidates the old action prompt without signing or registering it',
    (await evaluate(`(() => {
      const button = document.querySelector(${JSON.stringify(signButtonSelector)});
      return !button || button.disabled;
    })()`))
      && await evaluate('window.__ownerTestWallet.signCalls') === r5SignCallsAtEntry
      && cfoPosts('signatures').length === 0
      && cfoPosts('relay').length === 0
      && actionAfterWalletSwitch?.data.status === 'PREPARED'
      && actionAfterWalletSwitch.data.signatureBase64 === null
      && actionAfterWalletSwitch.data.signedData === null);
  check('V216: fixture workflow uses only explicit records and never starts provider/model/sign/relay work',
    cfoPosts('capture').length === 2
      && cfoPosts('mandate').length === 2
      && cfoPosts('plans').length === 1
      && cfoPosts('prepare').length === 1
      && cfoPosts().length === 6
      && cfoPosts('signatures').length === 0
      && cfoPosts('relay').length === 0
      && cfoPosts('reconcile').length === 0
      && cfoPosts('monitor').length === 0
      && requests.every(row => row.method !== 'POST' || [
        '/v1/auth/wallet/challenge', '/v1/auth/wallet/verify', '/v1/auth/wallet/logout',
        '/v1/cfo/capture', '/v1/cfo/mandate', '/v1/cfo/plans', '/v1/cfo/prepare',
      ].includes(row.path))
      && fixtureCalls.assets >= 1
      && fixtureCalls.capture === 1
      && fixtureCalls.generateIntent === 1
      && fixtureCalls.validateSigned === 0
      && fixtureCalls.submitIntent === 0
      && fixtureCalls.status === 0
      && fixtureCalls.reconcile === 0
      && fixtureCalls.review === 0
      && requests.every(row => !row.hasQuery));
  await transport.drain();
  check('V185: browser has no uncaught runtime exception', exceptions.length === 0);
} catch (error) {
  if (checks.at(-1)?.pass !== false) checks.push({ name: safe(String(error)), pass: false });
  process.exitCode = 1;
} finally {
  try { await transport?.drain(); } catch (error) { checks.push({ name: safe(String(error)), pass: false }); process.exitCode = 1; }
  if (chrome) { try { await call('Browser.close'); } catch {} chrome.kill(); }
  for (const token of tokens) { try { await walletAuth?.revokeSession(token); } catch { process.exitCode = 1; } }
  await cfo.close();
  await close(gateway); await close(api); await close(site); await pool.end();
  await rm(join(artifacts, 'localhost.key'), { force: true }); await rm(join(artifacts, 'localhost.crt'), { force: true });
  const report = safe({ passed: checks.filter(row => row.pass).length, total: checks.length, checks, exceptions, requests, browserDiagnostics: browserDiagnostics(), artifacts, limitation: 'Production-built UI and real disposable PostgreSQL HTTP/auth/store path. Controlled in-process observed-portfolio, quote and unsigned-action fixtures only; test-key message signatures and localhost TLS only. No external provider/model, real user wallet, financial signature, relay, settlement, funds or deployment.' });
  await writeFile(join(artifacts, 'report.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
}
