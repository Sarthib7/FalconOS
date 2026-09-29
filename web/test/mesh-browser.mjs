import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createHash, generateKeyPairSync, randomBytes, randomUUID } from 'node:crypto';
import { createServer } from 'node:http';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { extname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createApi } from '../../mesh/http.mjs';
import { createStore } from '../../mesh/store.mjs';
import { createLendingStore } from '../../mesh/lending-store.mjs';
import { captureSource } from '../../mesh/live.mjs';
import { prepareLending, verifySignedLending, readLendingReceipt } from '../../mesh/kamino.mjs';
import { LENDING_CONFIG } from '../../mesh/kamino-wire.mjs';
import { createKaminoBrowserFixture } from '../../mesh/test/support/kamino-fixtures.mjs';

// Requires an initialized disposable database. This harness never creates or changes its schema.
const databaseUrl = process.env.FALCON_MESH_TEST_DATABASE_URL;
if (!databaseUrl) throw new Error('Set FALCON_MESH_TEST_DATABASE_URL to an initialized disposable Postgres database.');
const require = createRequire(new URL('../../mesh/package.json', import.meta.url));
const { Pool } = require('pg');
const { PublicKey } = require('@solana/web3.js');
const root = resolve(process.env.FALCON_MESH_WEB_ROOT || fileURLToPath(new URL('../dist-mesh/', import.meta.url)));
const artifactDir = await mkdtemp('/private/tmp/falcon-mesh-browser-');
const owner = `browser_${randomUUID().replaceAll('-', '')}`;
const credential = `test-only-${randomBytes(32).toString('hex')}`;
const otherOwner = `browser_${randomUUID().replaceAll('-', '')}`;
const otherCredential = `test-only-${randomBytes(32).toString('hex')}`;
const apiPort = Number(process.env.FALCON_MESH_TEST_PORT || 8791);
const apiOrigin = `http://127.0.0.1:${apiPort}`;
const pool = new Pool({ connectionString: databaseUrl, max: 3, connectionTimeoutMillis: 3000 });
const testKey = generateKeyPairSync('ed25519');
const testPublicKey = testKey.publicKey.export({ format: 'der', type: 'spki' }).subarray(-32);
const testPrivatePkcs8 = testKey.privateKey.export({ format: 'der', type: 'pkcs8' }).toString('base64');
const testWalletAddress = new PublicKey(testPublicKey).toBase58();
const fixture = createKaminoBrowserFixture(testWalletAddress);
let failCapture = false;
let uncertainSend = false;
const signedTransactions = new Map();
const broadcasts = [];
const fixtureRpcMethods = [];
const store = createStore(pool, { capture: (id, options) => captureSource(id, { ...options, fetchImpl: async (...args) => {
  if (failCapture) throw new Error('Controlled connector outage');
  return fixture.publicFetch(...args);
} }) });
const lending = createLendingStore(pool, {
  meshStore: store,
  prepareLending: input => prepareLending(input, { fetchImpl: fixture.prepareFetch(input) }),
  verifySignedLending: (intent, transactionBase64) => {
    const signature = verifySignedLending(intent, transactionBase64);
    signedTransactions.set(signature, transactionBase64);
    return signature;
  },
  readLendingReceipt: (intent, signature) => {
    assert.ok(signedTransactions.has(signature), 'Receipt must use actual browser-signed bytes');
    return readLendingReceipt(intent, signature, { fetchImpl: fixture.receiptFetch(intent, signedTransactions.get(signature)) });
  },
});
const checks = [];
const exceptions = [];
const remoteRequests = [];
const apiRequests = [];
const pending = new Map();
let staticServer;
let apiServer;
let chrome;
let origin;
let sequence = 0;
let buffer = '';
let stderr = '';

const pause = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));
const safe = (value) => JSON.parse(JSON.stringify(value).replaceAll(credential, '[redacted-token]').replaceAll(otherCredential, '[redacted-token]').replaceAll(databaseUrl, '[redacted-database]').replaceAll(testPrivatePkcs8, '[redacted-ephemeral-test-key]'));
function check(name, value, detail) {
  checks.push({ name, pass: Boolean(value), ...(detail === undefined ? {} : { detail: safe(detail) }) });
  assert.ok(value, name);
}
function failPending(error) {
  for (const item of pending.values()) { clearTimeout(item.timer); item.reject(error); }
  pending.clear();
}
function call(method, params = {}, sessionId) {
  return new Promise((resolve, reject) => {
    const id = ++sequence;
    const timer = setTimeout(() => { pending.delete(id); reject(new Error(`CDP timeout: ${method}`)); }, 20000);
    pending.set(id, { resolve, reject, timer });
    chrome.stdio[3].write(`${JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) })}\0`);
  });
}
function requestDestination(url) {
  try { const target = new URL(url); return { origin: target.origin, path: target.pathname, search: target.search, protocol: target.protocol }; }
  catch { return null; }
}
async function fulfillDevnet(message) {
  const { request, requestId } = message.params;
  const headers = [{ name: 'Content-Type', value: 'application/json' }, { name: 'Access-Control-Allow-Origin', value: origin },
    { name: 'Access-Control-Allow-Headers', value: 'content-type' }, { name: 'Access-Control-Allow-Methods', value: 'POST, OPTIONS' }];
  if (request.method === 'OPTIONS') return call('Fetch.fulfillRequest', { requestId, responseCode: 204, responseHeaders: headers }, message.sessionId);
  assert.equal(request.method, 'POST');
  const rpc = JSON.parse(request.postData);
  fixtureRpcMethods.push(rpc.method);
  let result;
  if (rpc.method === 'getGenesisHash') result = LENDING_CONFIG.genesisHash;
  else if (rpc.method === 'getBlockHeight') result = 123456780;
  else {
    assert.equal(rpc.method, 'sendTransaction', 'No unregistered browser RPC method');
    const [transactionBase64, options] = rpc.params;
    assert.deepEqual(options, { encoding: 'base64', skipPreflight: false, preflightCommitment: 'confirmed', maxRetries: 2 });
    const signature = [...signedTransactions].find(([, bytes]) => bytes === transactionBase64)?.[0];
    assert.ok(signature, 'Broadcast bytes must pass the actual backend verifier');
    const retained = (await lending.list(owner)).find(record => record.signature === signature);
    assert.ok(retained, 'The signature must be durable before broadcast');
    const saved = await lending.get(owner, retained.id);
    const submission = saved.events.find(event => event.kind === 'SUBMITTED');
    assert.equal(submission.data.transactionSha256, createHash('sha256').update(Buffer.from(transactionBase64, 'base64')).digest('hex'));
    broadcasts.push({ intentId: retained.id, signature, transactionSha256: submission.data.transactionSha256, registeredEventId: submission.id, uncertain: uncertainSend });
    if (uncertainSend) return call('Fetch.failRequest', { requestId, errorReason: 'Failed' }, message.sessionId);
    result = signature;
  }
  return call('Fetch.fulfillRequest', { requestId, responseCode: 200, responseHeaders: headers,
    body: Buffer.from(JSON.stringify({ jsonrpc: '2.0', id: rpc.id, result })).toString('base64') }, message.sessionId);
}
function receive(data) {
  buffer += data.toString();
  let index;
  while ((index = buffer.indexOf('\0')) >= 0) {
    const raw = buffer.slice(0, index);
    buffer = buffer.slice(index + 1);
    if (!raw) continue;
    const message = JSON.parse(raw);
    if (message.id) {
      const item = pending.get(message.id);
      if (item) {
        pending.delete(message.id); clearTimeout(item.timer);
        if (message.error) item.reject(new Error(JSON.stringify(safe(message.error))));
        else item.resolve(message.result);
      }
    }
    if (message.method === 'Runtime.exceptionThrown') exceptions.push(safe(message.params.exceptionDetails));
    if (message.method === 'Network.requestWillBeSent') {
      const target = requestDestination(message.params.request.url);
      if (target?.origin === apiOrigin) apiRequests.push({ method: message.params.request.method, path: target.path, hasQuery: Boolean(target.search) });
    }
    if (message.method === 'Fetch.requestPaused') {
      if (message.params.request.url === LENDING_CONFIG.rpcUrl || message.params.request.url === `${LENDING_CONFIG.rpcUrl}/`) {
        void fulfillDevnet(message).catch(error => failPending(error));
        continue;
      }
      const target = requestDestination(message.params.request.url);
      const allowed = target && (!['http:', 'https:'].includes(target.protocol) || [origin, apiOrigin].includes(target.origin));
      if (!allowed) remoteRequests.push(target ? `${target.origin}${target.path}` : 'unparseable destination');
      void call(allowed ? 'Fetch.continueRequest' : 'Fetch.failRequest', {
        requestId: message.params.requestId, ...(allowed ? {} : { errorReason: 'BlockedByClient' }),
      }, message.sessionId).catch((error) => failPending(error));
    }
  }
}

async function page() {
  const target = await call('Target.createTarget', { url: 'about:blank' });
  const { sessionId } = await call('Target.attachToTarget', { targetId: target.targetId, flatten: true });
  const send = (method, params = {}) => call(method, params, sessionId);
  await send('Page.enable'); await send('Runtime.enable'); await send('Network.enable');
  await send('Fetch.enable', { patterns: [{ urlPattern: '*', requestStage: 'Request' }] });
  // Ephemeral test wallet uses the real Wallet Standard discovery and browser Ed25519 API.
  // Only the test control flags are exposed. The test key remains in this injected closure.
  await send('Page.addScriptToEvaluateOnNewDocument', { source: `(() => {
    const decode = value => Uint8Array.from(atob(value), c => c.charCodeAt(0));
    const account = Object.freeze({ address: ${JSON.stringify(testWalletAddress)}, publicKey: decode(${JSON.stringify(testPublicKey.toString('base64'))}), chains: ['solana:devnet'], features: ['solana:signTransaction'] });
    const listeners = new Set(); let accounts = []; let privateKey;
    const controls = window.__meshTestWallet = { changeDuringSign: false, signCalls: 0 };
    const wallet = { version: '1.0.0', name: 'Ephemeral fixture wallet', icon: 'data:image/svg+xml;base64,PHN2Zy8+', chains: ['solana:devnet'], get accounts() { return accounts; }, features: {
      'standard:connect': { version: '1.0.0', async connect() { accounts = [account]; return { accounts }; } },
      'standard:disconnect': { version: '1.0.0', async disconnect() { accounts = []; for (const listener of listeners) listener({ accounts }); } },
      'standard:events': { version: '1.0.0', on(event, listener) { if (event !== 'change') throw Error('Unexpected wallet event'); listeners.add(listener); return () => listeners.delete(listener); } },
      'solana:signTransaction': { version: '1.0.0', supportedTransactionVersions: [0], async signTransaction(input) {
        controls.signCalls += 1;
        if (input.account !== account || input.chain !== 'solana:devnet') throw Error('Unexpected signing account or chain');
        const bytes = input.transaction.slice(); let offset = 0; let count = 0; let shift = 0; let byte;
        do { byte = bytes[offset++]; count |= (byte & 127) << shift; shift += 7; } while (byte & 128);
        if (count !== 1) throw Error('Fixture requires one signer');
        privateKey ??= crypto.subtle.importKey('pkcs8', decode(${JSON.stringify(testPrivatePkcs8)}), { name: 'Ed25519' }, false, ['sign']);
        const signature = new Uint8Array(await crypto.subtle.sign('Ed25519', await privateKey, bytes.slice(offset + count * 64)));
        bytes.set(signature, offset);
        if (controls.changeDuringSign) { accounts = []; for (const listener of listeners) listener({ accounts }); }
        return [{ signedTransaction: bytes }];
      } }
    } };
    addEventListener('wallet-standard:app-ready', event => event.detail.register(wallet));
    dispatchEvent(new CustomEvent('wallet-standard:register-wallet', { detail: api => api.register(wallet) }));
  })();` });
  const evaluate = async (expression) => {
    const result = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    if (result.exceptionDetails) throw new Error(JSON.stringify(safe(result.exceptionDetails)));
    return result.result.value;
  };
  const wait = async (expression) => {
    for (let attempt = 0; attempt < 400; attempt++) {
      if (await evaluate(expression)) return;
      await pause(50);
    }
    throw new Error(`Page condition timed out: ${safe(expression)}`);
  };
  const click = (id) => evaluate(`document.getElementById(${JSON.stringify(id)}).click()`);
  const select = (selector) => evaluate(`document.querySelector(${JSON.stringify(selector)}).click()`);
  const reload = async () => {
    await evaluate('document.documentElement.dataset.awaitingReload = "true"');
    await send('Page.reload');
    await wait('document.readyState === "complete" && !document.documentElement.dataset.awaitingReload && document.getElementById("connect")');
  };
  await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1120, deviceScaleFactor: 1, mobile: false });
  await send('Page.navigate', { url: `${origin}/mesh/` });
  await wait('document.readyState === "complete" && document.getElementById("connect") && document.getElementById("api-location").textContent');
  return { send, evaluate, wait, click, select, reload };
}
async function screenshot(p, name, full = false) {
  const metrics = full ? await p.send('Page.getLayoutMetrics') : null;
  const result = await p.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: full,
    ...(full ? { clip: { x: 0, y: 0, width: metrics.cssContentSize.width, height: metrics.cssContentSize.height, scale: 1 } } : {}),
  });
  await writeFile(`${artifactDir}/${name}.png`, Buffer.from(result.data, 'base64'));
}
async function connect(p, access = credential) {
  await p.evaluate(`document.getElementById('access-token').value = ${JSON.stringify(access)}; true`);
  await p.click('connect');
  await p.wait('(!document.getElementById("mesh-workspace").hidden && !document.getElementById("refresh-mesh").disabled) || !document.getElementById("mesh-error").hidden');
  check('V96: explicit connection loads the authenticated workspace', await p.evaluate('!document.getElementById("mesh-workspace").hidden && document.getElementById("mesh-error").hidden'), await p.evaluate('document.getElementById("mesh-error").textContent'));
}
async function scenario(p, name) {
  const before = await p.evaluate('document.getElementById("graph-revision").textContent');
  await p.evaluate('document.getElementById("scenario-controls").open = true');
  await p.click(`scenario-${name}`);
  await p.wait(`!document.getElementById('refresh-mesh').disabled && (!document.getElementById('mesh-error').hidden || document.getElementById('graph-revision').textContent !== ${JSON.stringify(before)})`);
  check(`V91/V96: ${name} scenario saves new current source revisions`, await p.evaluate('document.getElementById("mesh-error").hidden && document.getElementById("snapshot-context").textContent === "Current source snapshot"'), await p.evaluate('document.getElementById("mesh-error").textContent'));
}
async function analyze(p, expected) {
  const before = await p.evaluate('document.querySelectorAll(".history-record").length');
  await p.click('run-analysis');
  await p.wait(`!document.getElementById('refresh-mesh').disabled && (!document.getElementById('mesh-error').hidden || document.querySelectorAll('.history-record').length === ${before + 1})`);
  check(`V93/V96: analysis returns ${expected} through the API`, await p.evaluate(`document.getElementById('mesh-error').hidden && document.getElementById('analysis-status').textContent === ${JSON.stringify(expected)}`), await p.evaluate('document.getElementById("mesh-error").textContent'));
  const id = await p.evaluate('document.querySelector(".history-record[aria-pressed=true]").dataset.recordId');
  return store.getAnalysis(owner, id);
}
async function openHistory(p, id) {
  await p.select(`.history-record[data-record-id="${id}"]`);
  await p.wait(`!document.getElementById('refresh-mesh').disabled && document.querySelector('.history-record[data-record-id="${id}"]').getAttribute('aria-pressed') === 'true'`);
}
async function openSource(p, id) {
  await p.select(`button[data-source-id="${id}"]`);
  await p.wait(`!document.getElementById('refresh-mesh').disabled && !document.getElementById('source-inspector').hidden && document.getElementById('source-facts').textContent.includes(${JSON.stringify(id)})`);
}
async function liveCapture(p, id, expected = 'ok') {
  const before = await p.evaluate('document.getElementById("graph-revision").textContent');
  await p.select(`[data-connector-id="${id}"]`);
  await p.wait(`!document.getElementById('refresh-mesh').disabled && (!document.getElementById('mesh-error').hidden || document.getElementById('graph-revision').textContent !== ${JSON.stringify(before)})`);
  check(`V99: ${id} capture retains ${expected} through the API`, await p.evaluate(`document.getElementById('mesh-error').hidden && document.getElementById('capture-result').dataset.status === ${JSON.stringify(expected)}`), await p.evaluate('document.getElementById("mesh-error").textContent'));
  const graph = await store.getGraph(owner, new Date().toISOString(), 'live');
  return store.getSource(owner, graph.sources.find(source => source.sourceKey === `live:${id}`).revisionId);
}
async function connectWallet(p) {
  await p.wait('!document.getElementById("lending-connect").disabled');
  await p.click('lending-connect');
  await p.wait(`document.getElementById('lending-wallet-status').textContent.includes(${JSON.stringify(testWalletAddress)})`);
}
async function prepareIntent(p, amount) {
  const previous = await p.evaluate('document.getElementById("lending-raw").textContent');
  await p.evaluate(`document.getElementById('lending-amount').value = ${JSON.stringify(amount)}`);
  await p.click('lending-prepare');
  await p.wait(`!document.getElementById('lending-history-refresh').disabled && (document.getElementById('lending-message').dataset.error === 'true' || document.getElementById('lending-raw').textContent !== ${JSON.stringify(previous)})`);
  check('V101: actual adapter prepares an unsigned lending intent through the API fixture', await p.evaluate('document.getElementById("lending-message").dataset.error === "false" && document.getElementById("lending-state").textContent === "PREPARED" && !document.getElementById("lending-sign").disabled'), await p.evaluate('document.getElementById("lending-message").textContent'));
  return p.evaluate('JSON.parse(document.getElementById("lending-raw").textContent)');
}
async function deferApiResponse(p, path, method, stage) {
  // Hold a real API response, including its real decoded body. No owner payload is fabricated.
  await p.evaluate(`(() => {
    if (!window.__meshDeferredApi) {
      const nativeFetch = window.fetch.bind(window);
      const control = window.__meshDeferredApi = { next: null };
      window.fetch = async (...args) => {
        const url = new URL(args[0] instanceof Request ? args[0].url : args[0], location.href);
        const method = args[1]?.method ?? (args[0] instanceof Request ? args[0].method : 'GET');
        const hold = control.next;
        const match = hold && !hold.claimed && url.origin === ${JSON.stringify(apiOrigin)} && url.pathname === hold.path && method === hold.method;
        if (match) hold.claimed = true;
        const response = await nativeFetch(...args);
        if (!match) return response;
        hold.status = response.status;
        const pause = () => { hold.ready = true; return new Promise(resolve => { hold.release = resolve; }); };
        if (hold.stage === 'json') {
          const readJson = response.json.bind(response);
          response.json = async () => { const payload = await readJson(); hold.decoded = true; await pause(); return payload; };
        } else await pause();
        return response;
      };
    }
    window.__meshDeferredApi.next = { path: ${JSON.stringify(path)}, method: ${JSON.stringify(method)}, stage: ${JSON.stringify(stage)}, claimed: false, ready: false, status: null, decoded: false };
  })()`);
}
async function releaseAcrossWorkspace(p, name, stage) {
  await p.wait('window.__meshDeferredApi.next.ready');
  check(`V92/V96: ${name} response reaches the real API before the workspace switch`, await p.evaluate(`window.__meshDeferredApi.next.status === 200 && (${JSON.stringify(stage)} !== 'json' || window.__meshDeferredApi.next.decoded)`));
  await p.click('disconnect');
  await connect(p, otherCredential);
  await p.evaluate('window.__meshDeferredApi.next.release()');
  await p.wait('!document.getElementById("lending-history-refresh").disabled');
  check(`V92/V96 B68: delayed ${name} response cannot populate the next owner's workspace`, await p.evaluate(`
    document.getElementById('node-count').textContent === '0' &&
    document.querySelectorAll('.history-record').length === 0 &&
    document.getElementById('lending-history').children.length === 0 &&
    document.getElementById('lending-intent').hidden &&
    document.getElementById('lending-sign').disabled && document.getElementById('lending-receipt').disabled &&
    (document.getElementById('lending-message').textContent === '' ||
      (document.getElementById('lending-message').dataset.error === 'true' &&
       /workspace changed/i.test(document.getElementById('lending-message').textContent)))
  `), await p.evaluate('({message:document.getElementById("lending-message").textContent, history:document.getElementById("lending-history").children.length, intentHidden:document.getElementById("lending-intent").hidden})'));
  await p.click('disconnect');
  await connect(p);
}
async function closeServer(server) {
  if (!server?.listening) return;
  server.closeAllConnections();
  await new Promise((resolve) => server.close(resolve));
}

try {
  await readFile(`${root}/mesh/index.html`);
  await store.ready();
  staticServer = createServer(async (request, response) => {
    try {
      let pathname = decodeURIComponent(new URL(request.url, 'http://local.invalid').pathname);
      if (pathname.endsWith('/')) pathname += 'index.html';
      const filename = resolve(root, `.${pathname}`);
      if (!filename.startsWith(root + sep)) throw new Error('Invalid path');
      const body = await readFile(filename);
      response.writeHead(200, { 'Content-Type': ({ '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css' })[extname(filename)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
      response.end(body);
    } catch { response.writeHead(404); response.end('Not found'); }
  });
  await new Promise((resolve, reject) => { staticServer.once('error', reject); staticServer.listen(0, '127.0.0.1', resolve); });
  origin = `http://127.0.0.1:${staticServer.address().port}`;
  apiServer = createApi({ store, lending, tokenHashes: new Map([[createHash('sha256').update(credential).digest('hex'), owner], [createHash('sha256').update(otherCredential).digest('hex'), otherOwner]]), allowedOrigins: new Set([origin]) });
  await new Promise((resolve, reject) => { apiServer.once('error', reject); apiServer.listen(apiPort, '127.0.0.1', resolve); });
  const anonymous = await fetch(`${apiOrigin}/v1/graph`, { redirect: 'error' });
  check('V92: the real API rejects an unauthenticated graph request', anonymous.status === 401);
  await anonymous.arrayBuffer();
  chrome = spawn(process.env.FALCON_CHROME_BIN || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', [
    '--headless=new', '--disable-gpu', '--disable-background-networking', '--disable-component-update',
    '--disable-default-apps', '--disable-sync', '--disable-extensions', '--no-first-run',
    '--no-default-browser-check', '--metrics-recording-only', `--user-data-dir=${artifactDir}/profile`,
    '--remote-debugging-pipe', 'about:blank',
  ], { stdio: ['ignore', 'ignore', 'pipe', 'pipe', 'pipe'] });
  chrome.stderr.on('data', (data) => { stderr = (stderr + data.toString()).slice(-2000); });
  chrome.on('error', failPending);
  chrome.on('exit', (code, signal) => failPending(new Error(`Chrome exited ${code}/${signal}: ${safe(stderr)}`)));
  chrome.stdio[4].on('data', receive);

  const p = await page();
  check('V96: a fresh viewer waits for Connect and uses a password input', await p.evaluate('document.getElementById("mesh-workspace").hidden && document.getElementById("access-token").type === "password"') && apiRequests.length === 0);
  await connect(p);
  check('V91/V96: a unique owner starts with an empty graph and history', await p.evaluate('document.getElementById("node-count").textContent === "0" && document.querySelectorAll(".history-record").length === 0'));
  check('V96: connecting clears the token input and uses no browser storage', await p.evaluate('document.getElementById("access-token").value === "" && localStorage.length === 0 && sessionStorage.length === 0'));
  await scenario(p, 'liquid');
  const original = await analyze(p, 'READY');
  const affected = original.analysis.positionResults.map((result) => result.positionId).sort();
  check('V93: two shared positions form the 500 USDC exit and exclude the unrelated position', JSON.stringify(affected) === JSON.stringify(['position:one', 'position:two']) && original.analysis.totalAffectedUnits === '500000000' && original.analysis.availableLiquidityUnits === '600000000' && await p.evaluate(`Boolean(document.querySelector('.mesh-node[data-node-id="position:unrelated"]')) && document.querySelectorAll('.position-result').length === 2`));

  await p.select('.position-result[data-position-id="position:one"]');
  const firstPath = original.analysis.positionResults.find((result) => result.positionId === 'position:one');
  const highlighted = await p.evaluate('({nodes:[...document.querySelectorAll(".mesh-node[data-path=true]")].map(n=>n.dataset.nodeId).sort(),edges:[...document.querySelectorAll(".mesh-edge[data-path=true]")].map(n=>n.dataset.edgeId).sort()})');
  check('V93/V96: selecting a result highlights exactly its returned path and labels it', JSON.stringify(highlighted.nodes) === JSON.stringify([...firstPath.pathNodeIds].sort()) && JSON.stringify(highlighted.edges) === JSON.stringify([...firstPath.pathEdgeIds].sort()) && await p.evaluate(`document.querySelector('.mesh-node[data-path=true]').textContent.includes('Analysis path') && document.querySelector('.mesh-node[data-node-id="position:unrelated"]').dataset.path === 'false'`));
  await p.evaluate(`document.querySelector('.mesh-node[data-node-id="position:two"]').focus()`);
  await p.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, nativeVirtualKeyCode: 13, text: '\r' });
  await p.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, nativeVirtualKeyCode: 13 });
  check('V96: keyboard selection opens the matching entity and its relationships', await p.evaluate('document.getElementById("entity-id").textContent === "position:two" && document.getElementById("entity-connections").textContent.includes("supplied to")'));
  const originalSource = original.graph.sources.find((source) => source.sourceKey === 'demo/liquidity');
  await openSource(p, originalSource.revisionId);
  const originalContent = await store.getSource(owner, originalSource.revisionId);
  const originalFacts = await p.evaluate('document.getElementById("source-facts").textContent');
  check('V91/V96: source inspector opens exact retained content and historical freshness', await p.evaluate('document.getElementById("source-content").textContent') === originalContent.content && originalFacts.includes(originalSource.sha256) && originalFacts.includes('Age at analysis') && originalFacts.includes('Fresh'));
  await p.evaluate('document.getElementById("source-content-details").open = true; document.querySelector(".mesh-layout").scrollIntoView({block:"start"})');
  await screenshot(p, 'mesh-desktop');
  await p.evaluate('scrollTo(0,0)'); await screenshot(p, 'mesh-desktop-full', true);

  await scenario(p, 'illiquid');
  check('V96: new source revisions clear the previous displayed analysis', await p.evaluate('document.getElementById("analysis-status").textContent === "Awaiting analysis" && document.querySelectorAll(".mesh-node[data-path=true]").length === 0'));
  const blocked = await analyze(p, 'BLOCKED');
  check('V93: 400 USDC blocks the full 500 USDC combined exit', blocked.analysis.totalAffectedUnits === '500000000' && blocked.analysis.availableLiquidityUnits === '400000000' && blocked.analysis.positionResults.every((result) => result.status === 'BLOCKED'));
  await openHistory(p, original.id);
  await openSource(p, originalSource.revisionId);
  check('V94/V96: prior history keeps its original graph, source content, cutoff and result', JSON.stringify(await store.getAnalysis(owner, original.id)) === JSON.stringify(original) && await p.evaluate('document.getElementById("analysis-status").textContent === "READY" && document.getElementById("snapshot-context").textContent.includes("Saved analysis")') && await p.evaluate('document.getElementById("source-content").textContent') === originalContent.content && await p.evaluate('document.getElementById("source-facts").textContent') === originalFacts);

  await scenario(p, 'stale');
  const stale = await analyze(p, 'NO_DATA');
  check('V93: stale observation remains NO_DATA with an explicit reason', /older than 300 seconds/i.test(stale.analysis.summary));
  const staleSource = stale.graph.sources.find((source) => source.sourceKey === 'demo/liquidity');
  await openSource(p, staleSource.revisionId);
  check('V96: stale source stays visible in the evidence inspector', await p.evaluate('document.getElementById("source-facts").textContent.includes("Stale")'));
  await scenario(p, 'missing');
  const missing = await analyze(p, 'NO_DATA');
  check('V93: missing observation relationship reports incomplete coverage', missing.analysis.coverage.status === 'missing_dependency');
  await scenario(p, 'liquid');
  await p.evaluate('document.getElementById("max-hops").value = "1"');
  const shallow = await analyze(p, 'NO_DATA');
  check('V93: one-hop traversal cannot claim a complete answer', shallow.analysis.coverage.status === 'truncated' && shallow.analysis.coverage.maxHops === 1);
  await p.evaluate('document.getElementById("max-hops").value = "3"');
  const latestReady = await analyze(p, 'READY');
  const historyBeforeReload = await store.listAnalyses(owner);
  const requestCount = apiRequests.length;
  await p.reload();
  check('V96: reload removes the token and requires explicit reconnection', await p.evaluate('document.getElementById("access-token").value === "" && document.getElementById("mesh-workspace").hidden && localStorage.length === 0 && sessionStorage.length === 0') && apiRequests.length === requestCount);
  await connect(p);
  check('V94/V96: reconnection restores persistent history without browser storage', await p.evaluate('document.querySelectorAll(".history-record").length') === historyBeforeReload.length && JSON.stringify(await store.listAnalyses(owner)) === JSON.stringify(historyBeforeReload));
  await openHistory(p, latestReady.id);
  await p.select('.position-result[data-position-id="position:one"]');
  const latestSource = latestReady.graph.sources.find((source) => source.sourceKey === 'demo/liquidity');
  await openSource(p, latestSource.revisionId);
  await p.send('Emulation.setDeviceMetricsOverride', { width: 320, height: 844, deviceScaleFactor: 1, mobile: true });
  check('V96: 320px view has no horizontal overflow', await p.evaluate('document.documentElement.scrollWidth <= innerWidth'));
  await p.evaluate('document.querySelector(".mesh-layout").scrollIntoView({block:"start"})'); await screenshot(p, 'mesh-mobile-graph');
  await p.evaluate('document.getElementById("source-inspector").scrollIntoView({block:"start"})'); await screenshot(p, 'mesh-mobile-source');
  await p.evaluate('scrollTo(0,0)'); await screenshot(p, 'mesh-mobile-full', true);

  await p.send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1120, deviceScaleFactor: 1, mobile: false });
  await p.evaluate('document.getElementById("mesh-mode").value = "live"; document.getElementById("mesh-mode").dispatchEvent(new Event("change", {bubbles:true}))');
  await p.wait('document.getElementById("mesh-mode").value === "live" && !document.getElementById("refresh-mesh").disabled');
  check('V100: switching to live excludes all synthetic positions', await p.evaluate('document.getElementById("node-count").textContent === "0" && document.querySelectorAll("[data-connector-id]").length === 2 && !document.getElementById("live-connectors").hidden'));
  const documentSource = await liveCapture(p, 'kamino-program-docs');
  const programSource = await liveCapture(p, 'solana-devnet-klend');
  await p.evaluate('document.getElementById("observation-id").value = "observation:live:solana-devnet-klend"');
  const observed = await analyze(p, 'OBSERVED');
  check('V100: connected public analysis has no money result or synthetic node', observed.graph.mode === 'live' && observed.analysis.positionResults.length === 0 && observed.analysis.totalAffectedUnits === null && observed.graph.nodes.every(node => ['document', 'protocol', 'account', 'observation'].includes(node.kind)) && await p.evaluate('document.getElementById("analysis-limit").textContent.includes("does not prove lending usability")'));
  const liveHighlighted = await p.evaluate('({nodes:[...document.querySelectorAll(".mesh-node[data-path=true]")].map(node=>node.dataset.nodeId).sort(),edges:[...document.querySelectorAll(".mesh-edge[data-path=true]")].map(edge=>edge.dataset.edgeId).sort()})');
  check('V100: viewer highlights exactly the returned live traversal', JSON.stringify(liveHighlighted.nodes) === JSON.stringify(observed.analysis.coverage.visitedNodeIds) && JSON.stringify(liveHighlighted.edges) === JSON.stringify(observed.analysis.coverage.visitedEdgeIds), liveHighlighted);
  await openSource(p, programSource.revisionId);
  const capture = JSON.parse(programSource.content).capture;
  const rawResponses = await p.evaluate('[...document.querySelectorAll("#source-exchanges .response-content")].map(node=>node.textContent)');
  check('V99: inspector shows exact retained RPC responses and hashes', JSON.stringify(rawResponses) === JSON.stringify(capture.exchanges.map(exchange => Buffer.from(exchange.response.bodyBase64, 'base64').toString('utf8'))) && (await p.evaluate('document.getElementById("source-exchanges").textContent')).includes(capture.exchanges[1].response.sha256) && (await p.evaluate('document.getElementById("source-capture-facts").textContent')).includes(capture.chain.slot));
  await p.evaluate('document.getElementById("source-exchanges").querySelectorAll("details").forEach(node=>node.open=true)');
  await screenshot(p, 'mesh-live-evidence', true);
  failCapture = true;
  const failedSource = await liveCapture(p, 'kamino-program-docs', 'unavailable');
  failCapture = false;
  const failedAnalysis = await analyze(p, 'NO_DATA');
  check('V99/V100: failed refresh replaces current success and blocks analysis', failedSource.revisionId !== documentSource.revisionId && failedAnalysis.graph.sources.some(source => source.revisionId === failedSource.revisionId) && !failedAnalysis.graph.sources.some(source => source.revisionId === documentSource.revisionId));
  await openHistory(p, observed.id);
  await openSource(p, documentSource.revisionId);
  check('V94/V100: successful live history preserves its original bytes after failed refresh', await p.evaluate('document.getElementById("analysis-status").textContent === "OBSERVED" && document.getElementById("source-capture-facts").dataset.status === "ok"') && await p.evaluate('document.getElementById("source-content").textContent') === documentSource.content && JSON.stringify(await store.getAnalysis(owner, observed.id)) === JSON.stringify(observed));
  await liveCapture(p, 'kamino-program-docs');
  const terminalAnalysis = await analyze(p, 'OBSERVED');
  check('V101: test wallet is discovered by the actual Wallet Standard registry', await p.evaluate('document.getElementById("lending-wallet").textContent.includes("Ephemeral fixture wallet")'));
  await connectWallet(p);
  const firstIntent = await prepareIntent(p, '1');
  check('V101: terminal retains exact analysis, reserve and unsigned message for review', firstIntent.analysisId === terminalAnalysis.id && firstIntent.intent.wallet === testWalletAddress && firstIntent.intent.action === 'supply' && firstIntent.intent.inputBaseUnits === '1000000' && firstIntent.intent.accounts.reserve === LENDING_CONFIG.reserve && await p.evaluate('document.getElementById("lending-facts").textContent.includes("At most 1") && document.getElementById("lending-dependencies").children.length > 0'));
  await p.click('lending-sign');
  await p.wait('!document.getElementById("lending-history-refresh").disabled && (document.getElementById("lending-message").textContent.includes("Devnet accepted") || document.getElementById("lending-message").dataset.error === "true")');
  check('V102: real browser signature is durable before the intercepted broadcast', broadcasts.length === 1 && broadcasts[0].intentId === firstIntent.id && await p.evaluate('document.getElementById("lending-state").textContent === "SUBMITTED" && document.getElementById("lending-sign").disabled && window.__meshTestWallet.signCalls === 1'), await p.evaluate('document.getElementById("lending-message").textContent'));
  await p.click('lending-receipt');
  await p.wait('!document.getElementById("lending-history-refresh").disabled && document.getElementById("lending-state").textContent === "CONFIRMED"');
  const confirmed = await lending.get(owner, firstIntent.id);
  const receiptEvent = confirmed.events.find(event => event.kind === 'RECEIPT');
  check('V102: actual receipt decoder reconciles signed fixture transaction and exact transfers', receiptEvent.data.status === 'CONFIRMED' && receiptEvent.data.signature === broadcasts[0].signature && receiptEvent.data.amounts.liquidityBaseUnits === '1000000' && receiptEvent.data.amounts.receiptBaseUnits === '1000000' && await p.evaluate('document.getElementById("lending-facts").textContent.includes("Verified transfer")'));
  await p.evaluate('document.getElementById("lending-terminal").scrollIntoView({block:"start"})');
  await screenshot(p, 'mesh-lending-confirmed');
  await p.reload();
  await connect(p);
  await p.click('lending-history-refresh');
  await p.wait(`!document.getElementById('lending-history-refresh').disabled && Boolean(document.querySelector('[data-intent-id="${firstIntent.id}"]'))`);
  await p.select(`[data-intent-id="${firstIntent.id}"]`);
  await p.wait('!document.getElementById("lending-history-refresh").disabled && document.getElementById("lending-state").textContent === "CONFIRMED"');
  check('V102: reload restores immutable intent, signature and confirmed receipt from PostgreSQL', JSON.stringify(await lending.get(owner, firstIntent.id)) === JSON.stringify(confirmed) && await p.evaluate(`document.getElementById('lending-facts').textContent.includes(${JSON.stringify(broadcasts[0].signature)}) && document.querySelectorAll('#lending-events li').length === 2 && document.getElementById('lending-sign').disabled`));
  await openHistory(p, terminalAnalysis.id);
  await connectWallet(p);
  const raceIntent = await prepareIntent(p, '0.8');
  const beforeRace = broadcasts.length;
  await p.evaluate('window.__meshTestWallet.changeDuringSign = true');
  await p.click('lending-sign');
  await p.wait('!document.getElementById("lending-history-refresh").disabled && document.getElementById("lending-message").dataset.error === "true"');
  check('V102: wallet change during signing prevents registration and broadcast', broadcasts.length === beforeRace && (await lending.get(owner, raceIntent.id)).events.length === 0 && await p.evaluate('document.getElementById("lending-sign").disabled && /changed/i.test(document.getElementById("lending-message").textContent)'), await p.evaluate('document.getElementById("lending-message").textContent'));
  await p.evaluate('window.__meshTestWallet.changeDuringSign = false');
  await connectWallet(p);
  const uncertainIntent = await prepareIntent(p, '0.7');
  uncertainSend = true;
  await p.click('lending-sign');
  await p.wait('!document.getElementById("lending-history-refresh").disabled && document.getElementById("lending-message").textContent.includes("Send result is uncertain")');
  uncertainSend = false;
  const uncertain = await lending.get(owner, uncertainIntent.id);
  check('V102: uncertain send retains the registered signature and blocks another signature', broadcasts.length === beforeRace + 1 && broadcasts.at(-1).uncertain && uncertain.events.length === 1 && uncertain.events[0].kind === 'SUBMITTED' && uncertain.events[0].data.signature === broadcasts.at(-1).signature && await p.evaluate('document.getElementById("lending-state").textContent === "SUBMITTED" && document.getElementById("lending-sign").disabled && !document.getElementById("lending-receipt").disabled'));
  await p.send('Emulation.setDeviceMetricsOverride', { width: 320, height: 844, deviceScaleFactor: 1, mobile: true });
  check('V96/V102: live graph and prepared terminal fit a 320px viewport', await p.evaluate('document.documentElement.scrollWidth <= innerWidth'));
  await p.evaluate('document.getElementById("lending-terminal").scrollIntoView({block:"start"})');
  await screenshot(p, 'mesh-lending-mobile-uncertain');

  await p.reload();
  await connect(p);
  await p.click('lending-history-refresh');
  await p.wait(`!document.getElementById('lending-history-refresh').disabled && Boolean(document.querySelector('[data-intent-id="${uncertainIntent.id}"]'))`);
  await p.select(`[data-intent-id="${uncertainIntent.id}"]`);
  await p.wait('!document.getElementById("lending-history-refresh").disabled && document.getElementById("lending-state").textContent === "SUBMITTED"');
  await connectWallet(p);
  check('V102 B69: reloaded registered transaction exposes an explicit broadcast retry', await p.evaluate('Boolean(document.getElementById("lending-retry")) && !document.getElementById("lending-retry").disabled && document.getElementById("lending-sign").disabled'));
  const retrySignCalls = await p.evaluate('window.__meshTestWallet.signCalls');
  const previousBroadcast = broadcasts.at(-1);
  const previousSubmissions = apiRequests.filter(request => request.method === 'POST' && request.path.endsWith('/submit')).length;
  await p.click('lending-retry');
  await p.wait('!document.getElementById("lending-history-refresh").disabled && (document.getElementById("lending-message").textContent.includes("Devnet accepted") || document.getElementById("lending-message").dataset.error === "true")');
  check('V102 B69: retry after reload broadcasts the identical retained bytes without signing or registering again', broadcasts.length === beforeRace + 2
    && broadcasts.at(-1).signature === previousBroadcast.signature && broadcasts.at(-1).transactionSha256 === previousBroadcast.transactionSha256
    && broadcasts.at(-1).registeredEventId === previousBroadcast.registeredEventId && !broadcasts.at(-1).uncertain
    && (await lending.get(owner, uncertainIntent.id)).events.length === uncertain.events.length
    && apiRequests.filter(request => request.method === 'POST' && request.path.endsWith('/submit')).length === previousSubmissions
    && await p.evaluate(`window.__meshTestWallet.signCalls === ${retrySignCalls} && document.getElementById('lending-sign').disabled && document.getElementById('lending-message').dataset.error === 'false'`), await p.evaluate('document.getElementById("lending-message").textContent'));

  await deferApiResponse(p, '/v1/lending/intents', 'GET', 'json');
  await p.click('lending-history-refresh');
  await releaseAcrossWorkspace(p, 'lending history', 'json');

  await p.click('lending-history-refresh');
  await p.wait(`!document.getElementById('lending-history-refresh').disabled && Boolean(document.querySelector('[data-intent-id="${firstIntent.id}"]'))`);
  await deferApiResponse(p, `/v1/lending/intents/${firstIntent.id}`, 'GET', 'response');
  await p.select(`[data-intent-id="${firstIntent.id}"]`);
  await releaseAcrossWorkspace(p, 'saved lending intent', 'response');

  await openHistory(p, terminalAnalysis.id);
  await p.evaluate('document.getElementById("lending-amount").value = "0.6"');
  await deferApiResponse(p, '/v1/lending/intents', 'POST', 'json');
  await p.click('lending-prepare');
  await releaseAcrossWorkspace(p, 'prepared lending intent', 'json');

  await p.click('lending-history-refresh');
  await p.wait(`!document.getElementById('lending-history-refresh').disabled && Boolean(document.querySelector('[data-intent-id="${uncertainIntent.id}"]'))`);
  await p.select(`[data-intent-id="${uncertainIntent.id}"]`);
  await p.wait('!document.getElementById("lending-receipt").disabled');
  await deferApiResponse(p, `/v1/lending/intents/${uncertainIntent.id}/receipt`, 'POST', 'json');
  await p.click('lending-receipt');
  await releaseAcrossWorkspace(p, 'lending receipt', 'json');

  await openHistory(p, latestReady.id);
  await closeServer(apiServer);
  await p.click('refresh-mesh');
  await p.wait('!document.getElementById("mesh-error").hidden && !document.getElementById("refresh-mesh").disabled');
  check('V96: offline API keeps the saved result visibly historical and disables current analysis', await p.evaluate('document.getElementById("analysis-status").textContent === "READY" && document.getElementById("analysis-context").textContent.includes("LAST REQUEST FAILED") && !document.getElementById("snapshot-context").textContent.startsWith("Current") && document.getElementById("run-analysis").disabled && document.getElementById("scenario-liquid").disabled'));
  await p.evaluate('document.getElementById("mesh-error").scrollIntoView({block:"start"})'); await screenshot(p, 'mesh-offline-error');
  const copy = await p.evaluate('document.body.innerText');
  check('V96: visible content and API URLs contain no access token', !copy.includes(credential) && !copy.includes(otherCredential) && apiRequests.every((request) => !request.hasQuery));
  await writeFile(`${artifactDir}/ui-copy.txt`, safe(copy));
  check('V96/V102: browser used only local services and explicitly intercepted Devnet fixture RPC', remoteRequests.length === 0 && fixtureRpcMethods.includes('sendTransaction'), remoteRequests);
  check('V96: browser has no uncaught runtime exceptions', exceptions.length === 0, exceptions);
} catch (error) {
  if (checks.at(-1)?.pass !== false) checks.push({ name: safe(error instanceof Error ? error.message : String(error)), pass: false });
  process.exitCode = 1;
} finally {
  if (chrome) { try { await call('Browser.close'); } catch {} chrome.kill(); }
  await closeServer(apiServer);
  await closeServer(staticServer);
  await pool.end();
  const report = safe({ passed: checks.filter((item) => item.pass).length, total: checks.length, checks, exceptions, remoteRequests, apiRequestCount: apiRequests.length, fixtureRpcMethods, broadcasts, artifactDir, root, owner, database: 'Explicit FALCON_MESH_TEST_DATABASE_URL; existing schema; unique test owner retained for inspection.', limitation: 'Controlled connector, balance, simulation, and receipt fixtures. Ephemeral wallet signs locally. No external RPC or real Devnet transaction occurred.' });
  await writeFile(`${artifactDir}/report.json`, JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
}
