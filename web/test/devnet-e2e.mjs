import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { createPrivateKey, createPublicKey, sign as edSign, verify as edVerify } from 'node:crypto';
import { existsSync } from 'node:fs';
import { createServer } from 'node:http';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { extname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import { Keypair, PublicKey, TransactionInstruction, TransactionMessage, VersionedTransaction } from '@solana/web3.js';

// Automated Devnet round-trip for /app/: SIWS sign-in -> capital -> council decision -> editable plan -> ONE leg executed
// as a real Devnet swap -> confirmation. Run separately from unit tests (`npm run test:devnet-e2e`); not a *.test.mjs.
//
//   FALCON_DEVNET_KEYPAIR=<path to JSON secret-key array | base58 secret>   mode=full  (funded: dUSDC + SOL fees)
//   (unset)                                                                 mode=dry   (ephemeral unfunded key)
//
// Exit codes: 0 full run passed (S2 proven) | 3 dry run reached broadcast (PIPELINE OK, NOT a pass for S2) | 1 failure.
//
// Test wallet: the harness registers a Wallet Standard wallet (solana:signMessage, drives SIWS) and a window.solana provider
// (signTransaction/signAllTransactions). Both delegate signing to THIS process over a CDP binding, so the secret key never
// enters the page and is never written anywhere. The harness only automates the human-signing surface; it changes no app code.
const EXIT_DRY_OK = 3;
const DEVNET_RPC = 'https://api.devnet.solana.com/'; // trailing slash: Chrome's canonical request URL
const RAYDIUM_BUILD = 'https://transaction-v1-devnet.raydium.io/transaction/swap-base-in';
const RAYDIUM_QUOTE = 'https://transaction-v1-devnet.raydium.io/compute/swap-base-in';
const DUSDC = 'USDCoctVLVnvTXBEuP9s8hntucdJokbo17RwHuNXemT';
const DUSDT = '9jWfcfEZToquBQmkoEViNSCt72veXwcvRGFQERXRjEk1';
const TOKEN_PROGRAM = new PublicKey('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA');
const ATA_PROGRAM = new PublicKey('ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL');
const CAPITAL = '0.2'; // dUSDC UI units -> OPENAI 0.12 / SPACEX 0.08
const LEG_BASE_UNITS = 120000n; // first leg: 60% of 0.2 dUSDC
const FUNDS_ERROR = /AccountNotFound|no record of a prior credit|insufficient|debit an account/i;
const BASE58 = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';

const webRoot = fileURLToPath(new URL('..', import.meta.url));
const root = resolve(webRoot, 'dist');
const pause = (ms) => new Promise((done) => setTimeout(done, ms));
const log = (line) => console.log(`[devnet-e2e] ${line}`);

function base58Decode(text) {
  let number = 0n;
  for (const character of text) {
    const digit = BASE58.indexOf(character);
    assert.ok(digit >= 0, 'FALCON_DEVNET_KEYPAIR is neither an existing file path nor a base58 secret');
    number = number * 58n + BigInt(digit);
  }
  const bytes = [];
  while (number > 0n) { bytes.push(Number(number & 255n)); number >>= 8n; }
  for (let i = 0; i < text.length && text[i] === '1'; i += 1) bytes.push(0);
  return Uint8Array.from(bytes.reverse());
}

async function loadKeypair() {
  const source = process.env.FALCON_DEVNET_KEYPAIR?.trim();
  if (!source) return { mode: 'dry', keypair: Keypair.generate() };
  const secret = existsSync(source) ? Uint8Array.from(JSON.parse(await readFile(source, 'utf8'))) : base58Decode(source);
  return { mode: 'full', keypair: Keypair.fromSecretKey(secret) };
}

const { mode, keypair } = await loadKeypair();
const address = keypair.publicKey.toBase58();
const privateKey = createPrivateKey({ key: Buffer.concat([Buffer.from('302e020100300506032b657004220420', 'hex'), Buffer.from(keypair.secretKey.subarray(0, 32))]), format: 'der', type: 'pkcs8' });
const publicKeyObject = createPublicKey({ key: Buffer.concat([Buffer.from('302a300506032b6570032100', 'hex'), Buffer.from(keypair.publicKey.toBytes())]), format: 'der', type: 'spki' });
const ata = (owner, mint) => PublicKey.findProgramAddressSync([owner.toBuffer(), TOKEN_PROGRAM.toBuffer(), new PublicKey(mint).toBuffer()], ATA_PROGRAM)[0];
log(`mode=${mode} wallet=${address}`);

if (!existsSync(resolve(root, 'app/index.html'))) {
  log('web/dist missing; running build:site');
  const build = spawnSync('npm', ['run', 'build:site'], { cwd: webRoot, stdio: 'inherit' });
  assert.equal(build.status, 0, 'build:site failed');
}

// ---- Devnet RPC (node side, read-only) ----
async function rpc(method, params, attempts = 4) {
  for (let attempt = 1; ; attempt += 1) {
    const response = await fetch(DEVNET_RPC, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }) });
    if (response.status === 429 && attempt < attempts) { await pause(1000 * attempt); continue; }
    const body = await response.json();
    if (body.error) throw new Error(`${method}: ${body.error.message}`);
    return body.result;
  }
}
async function tokenBalance(mint) {
  const result = await rpc('getTokenAccountsByOwner', [address, { mint }, { encoding: 'jsonParsed', commitment: 'confirmed' }]);
  return result.value.reduce((sum, item) => sum + BigInt(item.account.data.parsed.info.tokenAmount.amount), 0n);
}

// ---- Mock council: deterministic PUBLISHED /advice ----
const advice = {
  status: 'PUBLISHED', snapshot_sha256: 'e2e'.padEnd(64, '0'), created_at: '2026-09-29T00:00:00Z', execution_ready: false, reasons: [],
  evidence: [{ id: 'e2e-1', summary: 'Deterministic Devnet e2e advice' }], citations: [],
  legs: [{ asset_id: 'OPENAI', underlying: 'OPENAI', target_weight_bps: 6000 }, { asset_id: 'SPACEX', underlying: 'SPACEX', target_weight_bps: 4000 }],
};
const council = createServer((request, response) => {
  response.setHeader('access-control-allow-origin', '*');
  response.setHeader('access-control-allow-headers', '*');
  if (request.method === 'OPTIONS') { response.writeHead(204); response.end(); return; }
  if (request.url === '/advice') { response.writeHead(200, { 'content-type': 'application/json' }); response.end(JSON.stringify(advice)); return; }
  response.writeHead(404); response.end();
});
await new Promise((done, fail) => { council.once('error', fail); council.listen(0, '127.0.0.1', done); });
const councilBase = `http://127.0.0.1:${council.address().port}`;

// ---- Static server for web/dist ----
const site = createServer(async (request, response) => {
  try {
    let pathname = decodeURIComponent(new URL(request.url, 'http://localhost').pathname);
    if (pathname.endsWith('/')) pathname += 'index.html';
    const path = resolve(root, `.${pathname}`);
    if (!path.startsWith(root + sep)) throw new Error('Invalid path');
    const body = await readFile(path);
    response.writeHead(200, { 'Content-Type': ({ '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.svg': 'image/svg+xml' })[extname(path)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
    response.end(body);
  } catch { response.writeHead(404); response.end('Not found'); }
});
await new Promise((done, fail) => { site.once('error', fail); site.listen(0, '127.0.0.1', done); });
const origin = `http://127.0.0.1:${site.address().port}`;

// ---- Chrome over CDP pipe ----
const artifactDir = await mkdtemp(resolve(tmpdir(), 'falcon-devnet-e2e-'));
const chrome = spawn(process.env.FALCON_CHROME_BIN || process.env.CHROME_BIN || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', [
  '--headless=new', '--disable-gpu', '--disable-background-networking', '--disable-component-update', '--disable-default-apps',
  '--disable-sync', '--disable-extensions', '--no-first-run', '--no-default-browser-check', '--metrics-recording-only',
  `--user-data-dir=${artifactDir}/profile`, '--remote-debugging-pipe', 'about:blank',
], { stdio: ['ignore', 'ignore', 'pipe', 'pipe', 'pipe'] });

let sequence = 0;
let buffer = '';
let stderr = '';
let sessionId;
const pending = new Map();
const exceptions = [];
const trace = []; // ordered pipeline evidence: { step, ... }
const signCalls = { message: 0, transaction: 0 };
const sentTransactions = [];
const realSimulations = [];
chrome.stderr.on('data', (data) => { stderr += data.toString(); });
chrome.on('exit', (code, signal) => {
  const error = new Error(`Chrome exited ${code}/${signal}: ${stderr.slice(-500)}`);
  for (const item of pending.values()) { clearTimeout(item.timer); item.reject(error); }
  pending.clear();
});
function call(method, params = {}, session) {
  return new Promise((done, fail) => {
    const id = ++sequence;
    const timer = setTimeout(() => { pending.delete(id); fail(new Error(`CDP timeout: ${method}`)); }, 20000);
    pending.set(id, { resolve: done, reject: fail, timer });
    chrome.stdio[3].write(`${JSON.stringify({ id, method, params, ...(session ? { sessionId: session } : {}) })}\0`);
  });
}
const send = (method, params = {}) => call(method, params, sessionId);

function fulfill(requestId, payload) {
  return send('Fetch.fulfillRequest', {
    requestId, responseCode: 200,
    responseHeaders: [{ name: 'content-type', value: 'application/json' }, { name: 'access-control-allow-origin', value: '*' }],
    body: Buffer.from(JSON.stringify(payload)).toString('base64'),
  });
}

// Dry mode only. An unfunded key owns no dUSDC account, and both the app (input-account lookup) and Raydium (owner check on
// inputAccount) refuse before anything is signed. These three stubs stand in for the funded account state so the REAL
// quote, pool validation, wallet signing, signature verification and Devnet broadcast can still be exercised.
async function stubDryRequest({ requestId, request }) {
  if (request.method !== 'POST' || !request.postData) return false;
  if (request.url === DEVNET_RPC) {
    const body = JSON.parse(request.postData);
    if (body.method === 'getTokenAccountsByOwner' && body.params?.[0] === address && body.params?.[1]?.mint === DUSDC) {
      const pubkey = ata(keypair.publicKey, DUSDC).toBase58();
      trace.push({ step: 'stub-input-account', pubkey });
      await fulfill(requestId, { jsonrpc: '2.0', id: body.id, result: { context: { slot: 1 }, value: [{ pubkey, account: { data: ['', 'base64'], executable: false, lamports: 2039280, owner: TOKEN_PROGRAM.toBase58(), rentEpoch: 0, space: 165 } }] } });
      return true;
    }
    if (body.method === 'simulateTransaction') {
      // Record the REAL verdict (expected: rejected for missing funds), then let the pipeline proceed to signing.
      try { realSimulations.push((await rpc('simulateTransaction', [body.params[0], body.params[1]])).value.err); } catch (error) { realSimulations.push(`rpc: ${error.message}`); }
      await fulfill(requestId, { jsonrpc: '2.0', id: body.id, result: { context: { slot: 1 }, value: { err: null, logs: [], unitsConsumed: 0 } } });
      return true;
    }
    return false;
  }
  if (request.url === RAYDIUM_BUILD) {
    const body = JSON.parse(request.postData);
    assert.equal(body.wallet, address, 'app built the swap for a different wallet');
    const source = new PublicKey(body.inputAccount);
    const destination = ata(keypair.publicKey, DUSDT);
    const data = Buffer.alloc(9);
    data.writeUInt8(3, 0);
    data.writeBigUInt64LE(BigInt(body.swapResponse.data.inputAmount), 1);
    const message = new TransactionMessage({
      payerKey: keypair.publicKey, recentBlockhash: '11111111111111111111111111111111',
      instructions: [new TransactionInstruction({ programId: TOKEN_PROGRAM, keys: [{ pubkey: source, isSigner: false, isWritable: true }, { pubkey: destination, isSigner: false, isWritable: true }, { pubkey: keypair.publicKey, isSigner: true, isWritable: false }], data })],
    }).compileToV0Message();
    trace.push({ step: 'stub-build' });
    await fulfill(requestId, { id: 'e2e-dry', success: true, version: 'V0', data: [{ transaction: Buffer.from(new VersionedTransaction(message).serialize()).toString('base64') }] });
    return true;
  }
  return false;
}

async function onPaused(params) {
  try { if (mode === 'dry' && await stubDryRequest(params)) return; } catch (error) { log(`stub error: ${error.message}`); }
  await send('Fetch.continueRequest', { requestId: params.requestId }).catch(() => {});
}

async function onBinding({ payload }) {
  const { id, kind, data } = JSON.parse(payload);
  signCalls[kind] += 1;
  trace.push({ step: `sign-${kind}` });
  const signature = edSign(null, Buffer.from(data, 'base64'), privateKey).toString('base64');
  await send('Runtime.evaluate', { expression: `window.__falconSigned(${id}, ${JSON.stringify(signature)})` });
}

function onRequest({ request }) {
  const { url } = request;
  if (url === DEVNET_RPC && request.postData) {
    let body;
    try { body = JSON.parse(request.postData); } catch { return; }
    if (['simulateTransaction', 'getBlockHeight', 'getSignatureStatuses'].includes(body.method)) trace.push({ step: `rpc-${body.method}` });
    if (body.method === 'sendTransaction') { trace.push({ step: 'rpc-sendTransaction' }); sentTransactions.push(body.params[0]); }
  } else if (url.startsWith(RAYDIUM_QUOTE) && request.method === 'GET') trace.push({ step: 'raydium-quote' });
  else if (url === RAYDIUM_BUILD && request.method === 'POST') trace.push({ step: 'raydium-build-request' });
}

chrome.stdio[4].on('data', (data) => {
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
        if (message.error) item.reject(new Error(JSON.stringify(message.error))); else item.resolve(message.result);
      }
    }
    if (message.method === 'Runtime.exceptionThrown') exceptions.push(message.params.exceptionDetails);
    if (message.method === 'Runtime.bindingCalled' && message.params.name === 'falconSign') onBinding(message.params).catch((error) => log(`sign error: ${error.message}`));
    if (message.method === 'Fetch.requestPaused') onPaused(message.params);
    if (message.method === 'Network.requestWillBeSent') onRequest(message.params);
  }
});

// Runs before any app script: Wallet Standard wallet (drives SIWS) + window.solana (signs trade transactions).
const injected = `(() => {
  const address = ${JSON.stringify(address)};
  const publicKey = Uint8Array.from(${JSON.stringify([...keypair.publicKey.toBytes()])});
  const pending = new Map();
  let sequence = 0;
  window.__falconSigned = (id, signature) => { const item = pending.get(id); pending.delete(id); item(Uint8Array.from(atob(signature), (c) => c.charCodeAt(0))); };
  const sign = (kind, bytes) => new Promise((done) => {
    const id = ++sequence;
    pending.set(id, done);
    let binary = '';
    for (const byte of bytes) binary += String.fromCharCode(byte);
    window.falconSign(JSON.stringify({ id, kind, data: btoa(binary) }));
  });
  window.FALCON_COUNCIL_BASE = ${JSON.stringify(councilBase)};

  const account = Object.freeze({ address, publicKey, chains: ['solana:devnet'], features: ['solana:signMessage'] });
  const signMessage = async (...inputs) => Promise.all(inputs.map(async ({ message }) => ({ signedMessage: message, signature: await sign('message', message) })));
  const wallet = {
    version: '1.0.0', name: 'Falcon E2E Test Wallet', icon: '', chains: ['solana:devnet'], accounts: [account],
    features: {
      'standard:connect': { version: '1.0.0', connect: async () => ({ accounts: [account] }) },
      'standard:events': { version: '1.0.0', on: () => () => {} },
      'standard:disconnect': { version: '1.0.0', disconnect: async () => {} },
      'solana:signMessage': { version: '1.0.0', signMessage },
    },
  };
  const register = (api) => api.register(wallet);
  try { window.dispatchEvent(new CustomEvent('wallet-standard:register-wallet', { detail: register })); } catch {}
  window.addEventListener('wallet-standard:app-ready', ({ detail }) => register(detail));

  const key = { toString: () => address, toBase58: () => address, toBytes: () => publicKey };
  const provider = {
    publicKey: key,
    connect: async () => ({ publicKey: key }),
    disconnect: async () => {},
    signTransaction: async (tx) => {
      const keys = tx.message.staticAccountKeys;
      const index = keys.findIndex((item) => item.toBase58() === address);
      if (index < 0 || index >= tx.message.header.numRequiredSignatures) throw new Error('test wallet is not a required signer');
      tx.addSignature(keys[index], await sign('transaction', tx.message.serialize()));
      return tx;
    },
    signAllTransactions: async (txs) => Promise.all(txs.map((tx) => provider.signTransaction(tx))),
  };
  window.solana = provider;
})();`;

const evaluate = async (expression) => {
  const result = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
  if (result.exceptionDetails) throw new Error(JSON.stringify(result.exceptionDetails));
  return result.result.value;
};
const wait = async (expression, timeoutMs = 20000) => {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) { if (await evaluate(expression)) return; await pause(100); }
  throw new Error(`Page condition timed out: ${expression}`);
};
const text = (id) => evaluate(`document.getElementById(${JSON.stringify(id)}).textContent`);
const click = (selector) => evaluate(`document.querySelector(${JSON.stringify(selector)}).click()`);
const setValue = (selector, value) => evaluate(`(() => { const el = document.querySelector(${JSON.stringify(selector)}); el.value = ${JSON.stringify(value)}; el.dispatchEvent(new Event('change', { bubbles: true })); })()`);
const steps = [];
const check = (name, value, detail) => { steps.push(name); assert.ok(value, `${name}${detail ? `: ${detail}` : ''}`); log(`ok - ${name}`); };
const ordersKey = `falconos:orders:devnet:v1:${address}`;

async function screenshot(name) {
  try { await writeFile(`${artifactDir}/${name}.png`, Buffer.from((await send('Page.captureScreenshot', { format: 'png' })).data, 'base64')); return `${artifactDir}/${name}.png`; } catch { return null; }
}

let failed = null;
let result = null;
const watchdog = setTimeout(() => { console.error('[devnet-e2e] FAIL - watchdog: exceeded 4 minutes'); process.exit(1); }, 240000);
try {
  const target = await call('Target.createTarget', { url: 'about:blank' });
  ({ sessionId } = await call('Target.attachToTarget', { targetId: target.targetId, flatten: true }));
  await send('Page.enable'); await send('Runtime.enable'); await send('Network.enable');
  await send('Runtime.addBinding', { name: 'falconSign' });
  await send('Page.addScriptToEvaluateOnNewDocument', { source: injected });
  if (mode === 'dry') await send('Fetch.enable', { patterns: [{ urlPattern: `${DEVNET_RPC}*` }, { urlPattern: 'https://transaction-v1-devnet.raydium.io/transaction/*' }] });
  await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1600, deviceScaleFactor: 1, mobile: false });

  let dusdcBefore = null;
  let dusdtBefore = null;
  if (mode === 'full') {
    [dusdcBefore, dusdtBefore] = [await tokenBalance(DUSDC), await tokenBalance(DUSDT)];
    log(`balances before: dUSDC=${dusdcBefore} dUSDT=${dusdtBefore}`);
    check('funded keypair holds enough dUSDC for the first leg', dusdcBefore >= LEG_BASE_UNITS, `dUSDC=${dusdcBefore}, need ${LEG_BASE_UNITS} base units`);
  }

  // 1. SIWS sign-in through the registered Wallet Standard wallet.
  await send('Page.navigate', { url: `${origin}/app/` });
  await wait('document.readyState === "complete" && document.getElementById("login-action")');
  check('gate: workspace hidden before sign-in', await evaluate('document.getElementById("workspace-view").hidden === true'));
  await click('#login-action');
  await wait('!document.getElementById("workspace-view").hidden', 30000);
  check('SIWS: message signed by test wallet and proof verified', signCalls.message === 1 && await text('wallet-address') === address);
  await wait('document.getElementById("wallet-connection-state").textContent.includes("wallet connected")', 30000);
  check('trade bridge: window.solana bound to the signed-in wallet', (await text('wallet-connection-state')).includes('wallet connected'));

  // 2. Capital + council decision + editable plan.
  await setValue('#strategy-capital', CAPITAL);
  await click('#strategy-load');
  await wait('document.getElementById("strategy-status").textContent === "PUBLISHED" && document.querySelectorAll("#strategy-plan input[data-leg]").length === 2');
  check('decision: PUBLISHED with OPENAI 60% / SPACEX 40%', await evaluate(`[...document.querySelectorAll('#strategy-legs tr')].map((r) => r.textContent).join('|') === 'OPENAI60.00%|SPACEX40.00%'`));
  const allocations = () => evaluate(`[...document.querySelectorAll('#strategy-plan input[data-leg]')].map((i) => i.dataset.leg + '=' + i.value).join(',')`);
  check('plan: capital 0.2 dUSDC sized to 0.12 / 0.08, no residual', await allocations() === 'OPENAI=0.12,SPACEX=0.08' && await text('strategy-residual') === '0');
  await setValue('#strategy-plan input[data-leg="SPACEX"]', '0.07');
  check('plan: allocations are editable (residual follows the edit)', await text('strategy-residual') === '0.01', await text('strategy-message'));
  await setValue('#strategy-plan input[data-leg="SPACEX"]', '0.08');
  check('plan: edit reverted to the sized plan', await allocations() === 'OPENAI=0.12,SPACEX=0.08' && await text('strategy-residual') === '0');
  check('plan: both legs executable', await evaluate(`[...document.querySelectorAll('#strategy-plan button[data-action="execute"]')].every((b) => !b.disabled)`));

  // 3. Execute ONE leg (OPENAI). The wallet signs through the test provider; nothing else is clicked.
  await click('#strategy-plan button[data-action="execute"][data-leg="OPENAI"]');
  const legButton = `document.querySelector('#strategy-plan button[data-action="execute"][data-leg="OPENAI"]').textContent`;
  await wait(`${legButton} === 'Executing…'`, 5000);
  await wait(`${legButton} !== 'Executing…'`, 120000);
  const message = await text('strategy-message');
  const seen = (step) => trace.some((entry) => entry.step === step);

  if (mode === 'dry') {
    const missing = ['raydium-quote', 'raydium-build-request', 'stub-input-account', 'stub-build', 'rpc-simulateTransaction', 'sign-transaction', 'rpc-getBlockHeight'].filter((step) => !seen(step));
    if (missing.length || !seen('rpc-sendTransaction')) throw new Error(`pipeline stopped BEFORE broadcast (missing: ${[...missing, ...(seen('rpc-sendTransaction') ? [] : ['rpc-sendTransaction'])].join(', ')}). App said: ${message}`);
    const signed = VersionedTransaction.deserialize(Buffer.from(sentTransactions.at(-1), 'base64'));
    check('broadcast: sent transaction is paid and signed by the test wallet', signed.message.staticAccountKeys[0].equals(keypair.publicKey)
      && edVerify(null, Buffer.from(signed.message.serialize()), publicKeyObject, Buffer.from(signed.signatures[0])));
    check('broadcast: Devnet rejected the send for missing funds (not a wiring error)', FUNDS_ERROR.test(message), message);
    check('journal: nothing persisted for a failed send', await evaluate(`JSON.parse(localStorage.getItem(${JSON.stringify(ordersKey)}) || '[]').length === 0`));
    result = { funds: message, realSimulation: realSimulations.at(-1) };
  } else {
    check('leg confirmed in the app', /leg confirmed on Devnet/.test(message), message);
    const signature = message.match(/: ([1-9A-HJ-NP-Za-km-z]{80,90})(?: |$)/)?.[1];
    check('app reported a signature', Boolean(signature), message);
    let status = null;
    for (let i = 0; i < 30 && !['confirmed', 'finalized'].includes(status?.confirmationStatus); i += 1) {
      status = (await rpc('getSignatureStatuses', [[signature], { searchTransactionHistory: true }])).value[0];
      if (!['confirmed', 'finalized'].includes(status?.confirmationStatus)) await pause(1000);
    }
    check(`RPC: ${signature} is confirmed with no error`, ['confirmed', 'finalized'].includes(status?.confirmationStatus) && status.err === null, JSON.stringify(status));
    const orders = JSON.parse(await evaluate(`localStorage.getItem(${JSON.stringify(ordersKey)}) || '[]'`));
    const order = orders.find((item) => item.signature === signature);
    check('journal: confirmed OPENAI leg order saved with the signature', order?.status === 'confirmed' && order.leg?.assetId === 'OPENAI' && order.inputBaseUnits === LEG_BASE_UNITS.toString());
    let dusdcAfter = dusdcBefore; let dusdtAfter = dusdtBefore;
    for (let i = 0; i < 20 && (dusdcAfter === dusdcBefore || dusdtAfter === dusdtBefore); i += 1) {
      await pause(1500);
      [dusdcAfter, dusdtAfter] = [await tokenBalance(DUSDC), await tokenBalance(DUSDT)];
    }
    const minOut = BigInt(order.outputBaseUnits) * 9950n / 10000n;
    log(`balances after: dUSDC=${dusdcAfter} (delta ${dusdcAfter - dusdcBefore}) dUSDT=${dusdtAfter} (delta ${dusdtAfter - dusdtBefore}); quoted out=${order.outputBaseUnits}`);
    check('tokens reconciled: dUSDC down by exactly the leg allocation', dusdcBefore - dusdcAfter === LEG_BASE_UNITS);
    check('tokens reconciled: dUSDT up by at least the 50 bps slippage floor of the quote', dusdtAfter - dusdtBefore >= minOut && dusdtAfter > dusdtBefore);
    await evaluate('window.__beforeReload = true');
    await send('Page.reload');
    await wait('!window.__beforeReload && document.readyState === "complete" && !document.getElementById("workspace-view").hidden', 30000);
    check('journal reload: session and order survive a page reload', await evaluate(`JSON.parse(localStorage.getItem(${JSON.stringify(ordersKey)})).some((o) => o.signature === ${JSON.stringify(signature)} && o.status === 'confirmed') && document.getElementById('saved-order-count').textContent === '1' && [...document.querySelectorAll('#activity-rows a')].some((a) => a.href.includes(${JSON.stringify(signature)}))`));
    result = { signature, dusdcDelta: dusdcAfter - dusdcBefore, dusdtDelta: dusdtAfter - dusdtBefore };
  }
} catch (error) {
  failed = error;
  const shot = await screenshot('failure');
  console.error(`[devnet-e2e] FAIL - ${error.message}`);
  console.error(`[devnet-e2e] trace: ${trace.map((entry) => entry.step).join(' > ') || '(none)'}`);
  if (exceptions.length) console.error(`[devnet-e2e] page exceptions: ${JSON.stringify(exceptions.map((e) => e.exception?.description || e.text)).slice(0, 800)}`);
  if (shot) console.error(`[devnet-e2e] screenshot: ${shot}`);
} finally {
  clearTimeout(watchdog);
  chrome.removeAllListeners('exit');
  if (chrome.exitCode === null && chrome.signalCode === null) {
    const exited = new Promise((done) => chrome.once('exit', done));
    chrome.kill();
    await exited;
  }
  site.close(); council.close();
  if (!failed) await rm(artifactDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
}

if (failed) process.exit(1);
log(`pipeline: ${trace.map((entry) => entry.step).join(' > ')}`);
if (mode === 'dry') {
  log(`real Devnet simulation of the unfunded swap (informational): ${JSON.stringify(result.realSimulation)}`);
  log(`Devnet broadcast rejection: ${result.funds}`);
  console.log('PIPELINE OK - funded Devnet keypair required to confirm (set FALCON_DEVNET_KEYPAIR). S2 is NOT proven by this run.');
  process.exit(EXIT_DRY_OK);
}
console.log(`PASS - confirmed ${result.signature} (dUSDC ${result.dusdcDelta}, dUSDT +${result.dusdtDelta}); order journal persisted across reload.`);
process.exit(0);
