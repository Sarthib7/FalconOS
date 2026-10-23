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
import { createApi } from '../../mesh/http.mjs';
import { createStore } from '../../mesh/store.mjs';
import { createLendingStore } from '../../mesh/lending-store.mjs';
import { createWalletAuth } from '../../mesh/wallet-auth.mjs';
import { createReviewJobStore } from '../../mesh/research/review-store.mjs';
import { createResearchActivity } from '../../mesh/research/activity.mjs';
import { LENDING_CONFIG } from '../../mesh/kamino-wire.mjs';
import { createFixtureTransport } from './support/fixture-transport.mjs';

// V185/V190/V191: actual built UI, wallet signatures, Mesh auth and PostgreSQL.
// Only test-owned message keys and temporary localhost certificates are used.
// The API is not intercepted. External page requests are denied before dispatch.
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
const key = generateKeyPairSync('ed25519');
const publicBytes = key.publicKey.export({ format: 'der', type: 'spki' }).subarray(-32);
const privateBase64 = key.privateKey.export({ format: 'der', type: 'pkcs8' }).toString('base64');
const walletAddress = new PublicKey(publicBytes).toBase58();
const tokens = new Set();
const requests = [], checks = [], exceptions = [];
const pending = new Map();
let chrome, api, gateway, site, transport, walletAuth, origin;
let clockOffset = 0, sequence = 0, buffer = '', stderr = '', rejectLogout = false;
const pause = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));
const safe = value => JSON.parse(JSON.stringify(value).replaceAll(databaseUrl, '[redacted-database]').replaceAll(privateBase64, '[redacted-test-key]').replace(/wsi1_[A-Za-z0-9_-]{43}/g, '[redacted-session]'));
function check(name, condition) { checks.push({ name, pass: Boolean(condition) }); assert.ok(condition, name); }
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
    if (message.method === 'Runtime.exceptionThrown') exceptions.push(safe(message.params.exceptionDetails));
  }
}
const listen = (server, port = 0) => new Promise((resolve, reject) => { server.once('error', reject); server.listen(port, '127.0.0.1', resolve); });
async function close(server) { if (server?.listening) { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); } }
const activityReads = () => requests.filter(row => row.method === 'GET' && row.path === '/v1/activity').length;
const verifyPosts = () => requests.filter(row => row.method === 'POST' && row.path === '/v1/auth/wallet/verify').length;

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
  api = createApi({ store, lending, walletAuth, researchActivity: createResearchActivity({ store, reviewJobStore: createReviewJobStore(pool) }), tokenHashes: new Map([[createHash('sha256').update(credential).digest('hex'), 'owner_browser_fixture']]), allowedOrigins });
  await listen(api);
  // TLS forwarding preserves native browser CORS and the real auth handler.
  gateway = createTlsServer(tls, (request, response) => {
    const url = new URL(request.url, apiOrigin);
    requests.push({ method: request.method, path: url.pathname, hasQuery: Boolean(url.search) });
    if (rejectLogout && request.method === 'POST' && url.pathname === '/v1/auth/wallet/logout') {
      request.resume();
      response.writeHead(503, { 'content-type': 'application/json', 'access-control-allow-origin': origin });
      response.end(JSON.stringify({ error: { code: 'STORAGE_UNAVAILABLE', message: 'Controlled logout outage.' } }));
      return;
    }
    const upstream = httpRequest({ hostname: '127.0.0.1', port: api.address().port, method: request.method, path: request.url, headers: request.headers }, incoming => {
      response.writeHead(incoming.statusCode, incoming.headers); incoming.pipe(response);
    });
    upstream.on('error', () => { if (!response.headersSent) response.writeHead(502); response.end(); });
    request.pipe(upstream);
  });
  await listen(gateway, apiPort);
  transport = createFixtureTransport({ call, allowedOrigins: [origin, apiOrigin], rpcUrl: LENDING_CONFIG.rpcUrl,
    respond() { throw Error('Owner dashboard must not call a financial RPC.'); },
    onError(error) { exceptions.push(safe(String(error))); process.exitCode = 1; failPending(error); } });
  chrome = spawn(process.env.FALCON_CHROME_BIN || '/Applications/Brave Browser.app/Contents/MacOS/Brave Browser', ['--headless=new', '--disable-gpu', '--disable-background-networking', '--disable-component-update', '--disable-default-apps', '--disable-sync', '--disable-extensions', '--no-first-run', '--no-default-browser-check', '--metrics-recording-only', '--ignore-certificate-errors', `--user-data-dir=${artifacts}/profile`, '--remote-debugging-pipe', 'about:blank'], { stdio: ['ignore', 'ignore', 'pipe', 'pipe', 'pipe'] });
  chrome.stderr.on('data', data => { stderr = (stderr + data.toString()).slice(-2000); });
  chrome.on('error', failPending);
  chrome.on('exit', (code, signal) => failPending(Error(`Browser exited ${code}/${signal}: ${safe(stderr)}`)));
  chrome.stdio[4].on('data', receive);
  const target = await call('Target.createTarget', { url: 'about:blank' });
  const { sessionId } = await call('Target.attachToTarget', { targetId: target.targetId, flatten: true });
  const send = (method, params = {}) => call(method, params, sessionId);
  await send('Page.enable'); await send('Runtime.enable'); await send('Network.enable'); await transport.install(send);
  await send('Page.addScriptToEvaluateOnNewDocument', { source: `(() => {
    const decode = text => Uint8Array.from(atob(text), char => char.charCodeAt(0));
    const account = Object.freeze({ address: ${JSON.stringify(walletAddress)}, publicKey: decode(${JSON.stringify(publicBytes.toString('base64'))}), chains: ['solana:devnet'], features: ['solana:signMessage'] });
    const listeners = new Set(); let accounts = [], privateKey;
    const control = window.__ownerTestWallet = { signCalls: 0, reject: false };
    const wallet = { version: '1.0.0', name: 'Ephemeral fixture wallet', icon: 'data:image/svg+xml;base64,PHN2Zy8+', chains: ['solana:devnet'], get accounts() { return accounts; }, features: {
      'standard:connect': { version: '1.0.0', async connect() { accounts = [account]; return { accounts }; } },
      'standard:disconnect': { version: '1.0.0', async disconnect() { accounts = []; for (const listener of listeners) listener({ accounts }); } },
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
  const button = name => `[...document.querySelectorAll('button')].find(el => el.textContent.trim() === ${JSON.stringify(name)})`;
  const click = async name => { await wait(`Boolean(${button(name)} && !${button(name)}.disabled)`); await evaluate(`${button(name)}.click()`); };
  const sessionKey = 'falconos.bot.wallet-session.v1';
  const rememberToken = async () => { const token = await evaluate(`sessionStorage.getItem(${JSON.stringify(sessionKey)})`); assert.match(token, /^wsi1_[A-Za-z0-9_-]{43}$/); tokens.add(token); return token; };
  const signIn = async () => { await click('Sign in with Ephemeral fixture wallet'); await wait(ownerVisible); await wait(`Boolean(${button('Refresh activity')} && !${button('Refresh activity')}.disabled)`); return rememberToken(); };
  await send('Emulation.setDeviceMetricsOverride', { width: 1360, height: 950, deviceScaleFactor: 1, mobile: false });
  await send('Page.navigate', { url: origin + '/dashboard/' });
  await wait(`document.readyState === 'complete' && Boolean(${button('Sign in with Ephemeral fixture wallet')})`);
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
  check('V191: human load and refresh make no capture, review, transaction or model-start POST', requests.every(row => !row.hasQuery && (row.method !== 'POST' || ['/v1/auth/wallet/challenge', '/v1/auth/wallet/verify', '/v1/auth/wallet/logout'].includes(row.path))));
  await transport.drain();
  check('V185: browser has no uncaught runtime exception', exceptions.length === 0);
} catch (error) {
  if (checks.at(-1)?.pass !== false) checks.push({ name: safe(String(error)), pass: false });
  process.exitCode = 1;
} finally {
  try { await transport?.drain(); } catch (error) { checks.push({ name: safe(String(error)), pass: false }); process.exitCode = 1; }
  if (chrome) { try { await call('Browser.close'); } catch {} chrome.kill(); }
  for (const token of tokens) { try { await walletAuth?.revokeSession(token); } catch { process.exitCode = 1; } }
  await close(gateway); await close(api); await close(site); await pool.end();
  await rm(join(artifacts, 'localhost.key'), { force: true }); await rm(join(artifacts, 'localhost.crt'), { force: true });
  const report = safe({ passed: checks.filter(row => row.pass).length, total: checks.length, checks, exceptions, requests, artifacts, limitation: 'Production-built UI and real disposable PostgreSQL auth/read path. Ephemeral message signatures and localhost TLS only. No external provider, real user wallet, model inference, deployment or financial action.' });
  await writeFile(join(artifacts, 'report.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
}
