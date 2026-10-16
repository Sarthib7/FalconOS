import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { createServer as createHttpServer } from 'node:http';
import { createServer as createTcpServer } from 'node:net';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createFixtureTransport } from './support/fixture-transport.mjs';

const chromePath = process.env.FALCON_CHROME_BIN || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const testTimeout = 60_000;
const apiObservations = [];
const pageObservations = [];
const probeObservations = { httpConnections: 0, httpRequests: [], httpsConnections: 0 };
const transportsBySession = new Map();
const pendingCommands = new Map();
const activePages = new Set();
const cleanupReleases = new Set();
let profileDir;
let chrome;
let chromeClosed;
let chromeExited;
let chromeExitError;
let cdpSequence = 0;
let cdpBuffer = '';
let stderr = '';
let pageServer;
let apiServer;
let httpProbeServer;
let httpsProbeServer;
let pageOrigin;
let apiOrigin;
let httpProbeOrigin;
let httpsProbeOrigin;
let rpcHttpUrl;
let rpcHttpsUrl;
let apiAccessControlMode = 'correct';
let redirectTarget;

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

function deferredResponse(payload) {
  const gate = deferred();
  const fallback = { payload };
  const release = () => gate.resolve(fallback);
  cleanupReleases.add(release);
  return {
    promise: gate.promise,
    resolve(value = fallback) { cleanupReleases.delete(release); gate.resolve(value); },
    reject(error) { cleanupReleases.delete(release); gate.reject(error); },
  };
}

const pause = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

async function listen(server) {
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  return `http://127.0.0.1:${server.address().port}`;
}

async function closeServer(server) {
  if (!server?.listening) return;
  server.closeAllConnections?.();
  for (const socket of server._ownedSockets || []) socket.destroy();
  await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
}

function observeSockets(server, onConnection) {
  server._ownedSockets = new Set();
  server.on('connection', (socket) => {
    onConnection?.();
    server._ownedSockets.add(socket);
    socket.once('close', () => server._ownedSockets.delete(socket));
  });
}

async function readBody(request) {
  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  return Buffer.concat(chunks).toString('utf8');
}

function corsRequestObservation(request, body) {
  return {
    method: request.method,
    path: new URL(request.url, apiOrigin).pathname,
    origin: request.headers.origin ?? null,
    requestMethod: request.headers['access-control-request-method'] ?? null,
    requestHeaders: request.headers['access-control-request-headers'] ?? null,
    authorization: request.headers.authorization ?? null,
    contentType: request.headers['content-type'] ?? null,
    body,
  };
}

function corsHeaders() {
  const headers = {
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'authorization,content-type',
    'Access-Control-Max-Age': '0',
    'Cache-Control': 'no-store',
  };
  if (apiAccessControlMode === 'correct') headers['Access-Control-Allow-Origin'] = pageOrigin;
  if (apiAccessControlMode === 'wrong') headers['Access-Control-Allow-Origin'] = 'http://127.0.0.1:1';
  return headers;
}

async function startServers() {
  pageServer = createHttpServer((request, response) => {
    const pathname = new URL(request.url, pageOrigin || 'http://127.0.0.1').pathname;
    pageObservations.push({ method: request.method, path: pathname });
    if (pathname === '/redirect') {
      response.writeHead(302, { Location: redirectTarget, 'Cache-Control': 'no-store' });
      response.end();
      return;
    }
    response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
    response.end('<!doctype html><meta charset="utf-8"><title>transport fixture</title><main>local transport fixture</main>');
  });
  pageOrigin = await listen(pageServer);

  apiServer = createHttpServer(async (request, response) => {
    const body = await readBody(request);
    apiObservations.push(corsRequestObservation(request, body));
    const headers = corsHeaders();
    if (request.method === 'OPTIONS') {
      response.writeHead(204, headers);
      response.end();
      return;
    }
    if (request.method === 'POST') {
      response.writeHead(200, { ...headers, 'Content-Type': 'application/json' });
      response.end('{"accepted":true,"source":"native-cors"}');
      return;
    }
    response.writeHead(405, headers);
    response.end();
  });
  apiOrigin = await listen(apiServer);

  httpProbeServer = createHttpServer(async (request, response) => {
    const body = await readBody(request);
    probeObservations.httpRequests.push({ method: request.method, path: new URL(request.url, httpProbeOrigin).pathname, body });
    response.writeHead(200, { 'Content-Type': 'application/json' });
    response.end('{"unexpected":"network reached local probe"}');
  });
  httpProbeOrigin = await listen(httpProbeServer);
  observeSockets(httpProbeServer, () => { probeObservations.httpConnections += 1; });

  // A raw owned TCP listener counts HTTPS attempts before any TLS error can mask them.
  httpsProbeServer = createTcpServer((socket) => socket.destroy());
  observeSockets(httpsProbeServer, () => { probeObservations.httpsConnections += 1; });
  const httpsListenerOrigin = await listen(httpsProbeServer);
  httpsProbeOrigin = httpsListenerOrigin.replace(/^http:/, 'https:');
  rpcHttpUrl = `${httpProbeOrigin}/rpc`;
  rpcHttpsUrl = `${httpsProbeOrigin}/rpc`;
}

function rejectPendingCommands(error) {
  for (const [id, command] of pendingCommands) {
    clearTimeout(command.timer);
    command.reject(error);
    pendingCommands.delete(id);
  }
}

function dispatchMessage(message) {
  if (message.id !== undefined) {
    const command = pendingCommands.get(message.id);
    if (command) {
      pendingCommands.delete(message.id);
      clearTimeout(command.timer);
      if (message.error) command.reject(new Error(`${command.method}: ${JSON.stringify(message.error)}`));
      else command.resolve(message.result);
    }
  }
  if (message.sessionId) {
    const page = transportsBySession.get(message.sessionId);
    if (page) {
      if (message.method === 'Network.requestWillBeSent' || message.method === 'Network.loadingFailed') {
        const params = message.params || {};
        page.networkEvents.push({
          method: message.method,
          requestId: params.requestId,
          url: params.request?.url,
          blockedReason: params.blockedReason,
          errorText: params.errorText,
        });
      }
      try {
        const result = page.transport.receive(message);
        if (result && typeof result.then === 'function') result.catch((error) => page.receiveErrors.push(error));
      } catch (error) {
        page.receiveErrors.push(error);
      }
    }
  }
}

function consumeCdpData(data) {
  cdpBuffer += data.toString('utf8');
  let separator;
  while ((separator = cdpBuffer.indexOf('\0')) >= 0) {
    const raw = cdpBuffer.slice(0, separator);
    cdpBuffer = cdpBuffer.slice(separator + 1);
    if (raw) dispatchMessage(JSON.parse(raw));
  }
}

function call(method, params = {}, sessionId) {
  if (chromeExitError) return Promise.reject(chromeExitError);
  return new Promise((resolve, reject) => {
    const id = ++cdpSequence;
    const timer = setTimeout(() => {
      pendingCommands.delete(id);
      reject(new Error(`CDP timeout: ${method}; Chrome pid=${chrome?.pid} exit=${chrome?.exitCode}/${chrome?.signalCode}: ${stderr}`));
    }, 15_000);
    pendingCommands.set(id, { method, resolve, reject, timer });
    const message = { id, method, params, ...(sessionId ? { sessionId } : {}) };
    try {
      chrome.stdio[3].write(`${JSON.stringify(message)}\0`, (error) => {
        if (!error) return;
        const command = pendingCommands.get(id);
        if (!command) return;
        pendingCommands.delete(id);
        clearTimeout(command.timer);
        reject(error);
      });
    } catch (error) {
      pendingCommands.delete(id);
      clearTimeout(timer);
      reject(error);
    }
  });
}

async function runtime(page, expression) {
  const response = await page.send('Runtime.evaluate', {
    expression,
    awaitPromise: true,
    returnByValue: true,
    userGesture: true,
  });
  if (response.exceptionDetails) {
    const detail = response.exceptionDetails.exception?.description || response.exceptionDetails.text;
    throw new Error(`Runtime.evaluate failed: ${detail}`);
  }
  return response.result?.value;
}

async function waitUntil(predicate, message, timeout = 5_000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    if (await predicate()) return;
    await pause(10);
  }
  throw new Error(`Timed out waiting for ${message}`);
}

async function startBrowser() {
  profileDir = await mkdtemp(join(tmpdir(), 'falcon-mesh-native-cors-'));
  chrome = spawn(chromePath, [
    '--headless=new', '--disable-gpu', '--disable-background-networking', '--disable-component-update',
    '--disable-default-apps', '--disable-sync', '--disable-extensions', '--no-first-run',
    '--no-default-browser-check', '--metrics-recording-only', `--user-data-dir=${join(profileDir, 'profile')}`,
    '--host-resolver-rules=MAP *.invalid ~NOTFOUND,EXCLUDE 127.0.0.1',
    '--remote-debugging-pipe', 'about:blank',
  ], { stdio: ['ignore', 'ignore', 'pipe', 'pipe', 'pipe'] });
  chromeClosed = new Promise((resolve) => chrome.once('close', resolve));
  chromeExited = new Promise((resolve) => { chrome.once('exit', resolve); chrome.once('error', resolve); });
  chrome.stderr.on('data', (data) => { stderr = (stderr + data.toString()).slice(-2_000); });
  chrome.on('error', (error) => {
    chromeExitError = error;
    rejectPendingCommands(error);
  });
  chrome.on('exit', (code, signal) => {
    const error = new Error(`Chrome exited ${code}/${signal}: ${stderr}`);
    chromeExitError = error;
    rejectPendingCommands(error);
  });
  chrome.stdio[4].on('data', consumeCdpData);
  await once(chrome, 'spawn');
  await call('Browser.getVersion');
}

function transportFor({ rpcUrl = rpcHttpUrl, respond = async () => ({ payload: { jsonrpc: '2.0', id: 1, result: 'fixture' } }), onError = () => {}, fixtureCall = call } = {}) {
  return createFixtureTransport({
    call: fixtureCall,
    allowedOrigins: [pageOrigin, apiOrigin],
    rpcUrl,
    respond,
    onError,
  });
}

async function openPage({ fixture = true, rpcUrl = rpcHttpUrl, respond, onError, spyNativeFetch = false, fixtureCall = call } = {}) {
  const target = await call('Target.createTarget', { url: 'about:blank' });
  const { sessionId } = await call('Target.attachToTarget', { targetId: target.targetId, flatten: true });
  const send = (method, params = {}) => call(method, params, sessionId);
  const page = {
    targetId: target.targetId,
    sessionId,
    send,
    transport: transportFor({ rpcUrl, respond, onError, fixtureCall }),
    networkEvents: [],
    receiveErrors: [],
  };
  activePages.add(page);
  transportsBySession.set(sessionId, page);
  try {
    await send('Page.enable');
    await send('Runtime.enable');
    await send('Network.enable');
    if (spyNativeFetch) {
      await send('Page.addScriptToEvaluateOnNewDocument', { source: `(() => {
        const nativeFetch = globalThis.fetch;
        globalThis.__meshNativeFetchReturned = null;
        globalThis.fetch = function (...args) {
          const promise = Reflect.apply(nativeFetch, this, args);
          globalThis.__meshNativeFetchReturned = promise;
          return promise;
        };
      })();` });
    }
    await page.transport.install(send, { fixture });
    await send('Page.navigate', { url: `${pageOrigin}/` });
    await waitUntil(() => runtime(page, 'location.origin').then((value) => value === pageOrigin), 'the local page origin');
    return page;
  } catch (error) {
    await closePage(page);
    throw error;
  }
}

async function closePage(page) {
  if (!activePages.has(page)) return;
  transportsBySession.delete(page.sessionId);
  try { await call('Target.closeTarget', { targetId: page.targetId }); } catch {}
  activePages.delete(page);
}

function corsFetchScript(path) {
  return `(() => fetch(${JSON.stringify(`${apiOrigin}${path}`)}, {
    method: 'POST', mode: 'cors', cache: 'no-store',
    headers: { Authorization: 'Bearer native-cors-fixture', 'Content-Type': 'application/json' },
    body: JSON.stringify({ kind: 'native-cors' }),
  }).then(async response => ({ ok: true, status: response.status, body: await response.json() }))
    .catch(error => ({ ok: false, name: error.name, message: error.message })))()`;
}

function rpcFetchScript(url, method, id, signalExpression = null) {
  const body = JSON.stringify({ jsonrpc: '2.0', id, method, params: [] });
  const signal = signalExpression ? `, signal: ${signalExpression}` : '';
  return `(() => {
    window.__rpcFinished = false;
    window.__rpcResult = undefined;
    window.__rpcPromise = fetch(${JSON.stringify(url)}, {
      method: 'POST', mode: 'cors', cache: 'no-store',
      headers: { 'Content-Type': 'application/json' }, body: ${JSON.stringify(body)}${signal},
    }).then(async response => ({ ok: true, status: response.status, payload: await response.json() }))
      .catch(error => ({ ok: false, name: error.name, message: error.message }))
      .then(result => { window.__rpcResult = result; window.__rpcFinished = true; return result; });
    return true;
  })()`;
}

function corsBatchScript() {
  return [
    '(() => {',
    '  const send = async sequence => {',
    '    const response = await fetch(' + JSON.stringify(apiOrigin) + ' + "/v1/native-cors/" + sequence, {',
    '      method: "POST", mode: "cors", cache: "no-store",',
    '      headers: { Authorization: "Bearer native-cors-fixture", "Content-Type": "application/json" },',
    '      body: JSON.stringify({ kind: "native-cors", sequence }),',
    '    });',
    '    return { sequence, status: response.status, body: await response.json() };',
    '  };',
    '  return (async () => {',
    '    const results = [];',
    '    for (let sequence = 0; sequence < 32; sequence += 1) results.push(await send(sequence));',
    '    for (let batch = 0; batch < 4; batch += 1) {',
    '      results.push(...await Promise.all([0, 1, 2, 3].map(offset => send(32 + batch * 4 + offset))));',
    '    }',
    '    return results;',
    '  })();',
    '})()',
  ].join('\n');
}

function expectedCorsObservation(path, method, sequence = null) {
  const preflight = method === 'OPTIONS';
  return {
    method,
    path,
    origin: pageOrigin,
    requestMethod: preflight ? 'POST' : null,
    requestHeaders: preflight ? 'authorization,content-type' : null,
    authorization: preflight ? null : 'Bearer native-cors-fixture',
    contentType: preflight ? null : 'application/json',
    body: preflight ? '' : JSON.stringify({ kind: 'native-cors', sequence }),
  };
}

function observationOrder(left, right) {
  return left.path.localeCompare(right.path) || left.method.localeCompare(right.method);
}

async function awaitRpcResult(page) {
  await waitUntil(() => runtime(page, 'window.__rpcFinished === true'), 'the RPC fetch result');
  return runtime(page, 'window.__rpcResult');
}

function resetProbeObservations() {
  probeObservations.httpConnections = 0;
  probeObservations.httpRequests.length = 0;
  probeObservations.httpsConnections = 0;
}

function resetApiObservations(mode = 'correct') {
  apiAccessControlMode = mode;
  apiObservations.length = 0;
}

before(async () => {
  await startServers();
  await startBrowser();
}, { timeout: testTimeout });

after(async () => {
  const cleanupErrors = [];
  const attempt = async (action) => {
    try { await action(); } catch (error) { cleanupErrors.push(error); }
  };
  for (const release of [...cleanupReleases]) await attempt(release);
  for (const page of [...activePages]) await attempt(() => page.transport.drain());
  for (const page of [...activePages]) await attempt(() => closePage(page));
  if (chrome) {
    await attempt(async () => {
      const waitForExit = async () => {
        let timer;
        try {
          await Promise.race([chromeExited, new Promise((resolve) => { timer = setTimeout(resolve, 2_000); })]);
        } finally { clearTimeout(timer); }
      };
      if (chrome.exitCode === null && chrome.signalCode === null) {
        try { await call('Browser.close'); } catch {}
        await waitForExit();
      }
      for (const signal of ['SIGTERM', 'SIGKILL']) {
        if (chrome.exitCode !== null || chrome.signalCode !== null) break;
        chrome.kill(signal);
        await waitForExit();
      }
      await chromeExited;
      for (const stream of chrome.stdio) stream?.destroy();
      await chromeClosed;
      if (chrome.exitCode !== 0 || chrome.signalCode !== null) {
        throw new Error(`Chrome did not shut down cleanly: ${chrome.exitCode}/${chrome.signalCode}: ${stderr}`);
      }
    });
  }
  await attempt(() => rejectPendingCommands(new Error('CDP harness cleanup')));
  await attempt(() => closeServer(httpsProbeServer));
  await attempt(() => closeServer(httpProbeServer));
  await attempt(() => closeServer(apiServer));
  await attempt(() => closeServer(pageServer));
  if (profileDir) await attempt(() => rm(profileDir, { recursive: true, force: true }));
  if (cleanupErrors.length) throw new AggregateError(cleanupErrors, 'Browser harness cleanup failed');
}, { timeout: testTimeout });

test('V184: exercises native CORS serial and parallel POSTs plus exact preflight and ACAO rejection', { timeout: testTimeout }, async () => {
  resetApiObservations('correct');
  const callbackCalls = [];
  const page = await openPage({ respond: async (request) => { callbackCalls.push(request); return { payload: {} }; } });
  try {
    const results = await runtime(page, corsBatchScript());
    assert.equal(results.length, 48);
    assert.ok(results.every((result) => result.status === 200 && result.body.accepted === true && result.body.source === 'native-cors'));
    const serialExpected = [];
    for (let sequence = 0; sequence < 32; sequence += 1) {
      const path = '/v1/native-cors/' + sequence;
      serialExpected.push(expectedCorsObservation(path, 'OPTIONS'), expectedCorsObservation(path, 'POST', sequence));
    }
    assert.deepEqual(apiObservations.slice(0, serialExpected.length), serialExpected, 'all 32 serial exchanges must expose exact preflight and POST observations');
    const parallelExpected = [];
    for (let sequence = 32; sequence < 48; sequence += 1) {
      const path = '/v1/native-cors/' + sequence;
      parallelExpected.push(expectedCorsObservation(path, 'OPTIONS'), expectedCorsObservation(path, 'POST', sequence));
    }
    assert.deepEqual(apiObservations.slice(serialExpected.length).sort(observationOrder), parallelExpected.sort(observationOrder), 'four parallel-4 batches must expose every exact OPTIONS/POST exchange');
    assert.deepEqual(callbackCalls, [], 'an API request outside the exact RPC URL must remain native fetch');
    await page.transport.drain();
    assert.deepEqual(page.receiveErrors, []);

    for (const mode of ['missing', 'wrong']) {
      resetApiObservations(mode);
      const result = await runtime(page, corsFetchScript('/v1/' + mode + '-acao'));
      assert.equal(result.ok, false, mode + ' ACAO must reject fetch');
      assert.equal(result.name, 'TypeError');
      assert.deepEqual(apiObservations, [expectedCorsObservation('/v1/' + mode + '-acao', 'OPTIONS')], mode + ' ACAO must fail before POST reaches the server');
      await page.transport.drain();
    }
  } finally {
    await closePage(page);
  }
});


test('V184: blocks loopback egress with RPC bridge present and absent', { timeout: testTimeout }, async () => {
  for (const fixture of [true, false]) {
    for (const rpcUrl of [rpcHttpUrl, rpcHttpsUrl]) {
      resetProbeObservations();
      const callbackCalls = [];
      const page = await openPage({
        fixture,
        rpcUrl,
        spyNativeFetch: true,
        respond: async (request) => {
          callbackCalls.push(request);
          const rpc = JSON.parse(request.postData);
          return { payload: { jsonrpc: '2.0', id: rpc.id, result: 'fixture-only' } };
        },
      });
      try {
        const otherRpcUrl = rpcUrl === rpcHttpUrl ? rpcHttpsUrl : rpcHttpUrl;
        const targets = [
          { url: rpcUrl, rpc: true, configured: true },
          { url: `${rpcUrl}?not-exact=1`, rpc: true },
          { url: otherRpcUrl, rpc: true },
          { url: `${httpProbeOrigin}/unknown`, rpc: false },
          { url: `${httpsProbeOrigin}/unknown`, rpc: false },
        ];
        const probe = await runtime(page, `Promise.all(${JSON.stringify(targets)}.map(async target => {
          const options = target.rpc
            ? { method: 'POST', mode: 'cors', cache: 'no-store', headers: { 'Content-Type': 'application/json' }, body: '{"jsonrpc":"2.0","id":7,"method":"probe","params":[]}' }
            : { method: 'GET', mode: 'no-cors', cache: 'no-store' };
          try {
            const response = await fetch(target.url, options);
            const result = { url: target.url, ok: true, status: response.status };
            if (target.configured) result.payload = await response.json();
            return result;
          } catch (error) {
            return { url: target.url, ok: false, name: error.name };
          }
        }))`);
        assert.equal(probeObservations.httpConnections, 0, 'no TCP connection may reach the owned HTTP egress listener');
        assert.deepEqual(probeObservations.httpRequests, [], 'no HTTP request may reach the owned HTTP egress listener');
        assert.equal(probeObservations.httpsConnections, 0, 'no TCP connection may reach the owned HTTPS probe before TLS');
        assert.equal(probe.length, targets.length);
        const configuredResult = probe.find((item) => item.url === rpcUrl);
        assert.equal(configuredResult.ok, fixture, 'only the configured RPC URL is bridged');
        assert.equal(configuredResult.status, fixture ? 200 : undefined);
        if (fixture) assert.deepEqual(configuredResult.payload, { jsonrpc: '2.0', id: 7, result: 'fixture-only' }, 'the exact RPC bridge returns the requested JSON fixture payload');
        assert.equal(await runtime(page, `(() => {
          const promise = fetch(${JSON.stringify(`${rpcUrl}?identity-check=1`)}, {
            method: 'POST', mode: 'cors', cache: 'no-store',
            headers: { 'Content-Type': 'application/json' }, body: '{}',
          });
          promise.catch(() => {});
          return promise === window.__meshNativeFetchReturned;
        })()`), true, 'non-exact RPC fetch returns the native fetch promise unchanged');
        await page.transport.drain();
        assert.deepEqual(callbackCalls.map(({ url, method }) => ({ url, method })), fixture ? [{ url: rpcUrl, method: 'POST' }] : []);
        assert.deepEqual(page.receiveErrors, []);
      } finally {
        await closePage(page);
      }
    }
  }
});

test('V184: blocks omitted-port reserved HTTP and HTTPS hosts at inspector before DNS', { timeout: testTimeout }, async () => {
  const urls = [
    'http://mesh-transport-probe.invalid/guard-check',
    'https://mesh-transport-probe.invalid/guard-check',
  ];
  assert.ok(urls.every((url) => new URL(url).port === ''), 'both reserved probes must omit explicit ports');
  const page = await openPage({ fixture: false });
  try {
    const expression = 'Promise.all(' + JSON.stringify(urls) + '.map(url => fetch(url, { mode: "no-cors", cache: "no-store" })'
      + '.then(() => ({ ok: true }), error => ({ ok: false, name: error.name }))))';
    const results = await runtime(page, expression);
    assert.deepEqual(results.map((result) => result.ok), [false, false]);
    await waitUntil(() => urls.every((url) => {
      const started = page.networkEvents.find((event) => event.method === 'Network.requestWillBeSent' && event.url === url);
      return started && page.networkEvents.some((event) => event.method === 'Network.loadingFailed' && event.requestId === started.requestId);
    }), 'Network.loadingFailed for both omitted-port probes');
    for (const url of urls) {
      const started = page.networkEvents.filter((event) => event.method === 'Network.requestWillBeSent' && event.url === url);
      assert.equal(started.length, 1, 'exactly one CDP request must match ' + url);
      const failed = page.networkEvents.find((event) => event.method === 'Network.loadingFailed' && event.requestId === started[0].requestId);
      assert.ok(failed, 'the loading failure must use the exact requestId for ' + url);
      assert.equal(failed.blockedReason, 'inspector', 'the request must be blocked by CDP before reserved-host resolution');
    }
    await page.transport.drain();
    assert.deepEqual(page.receiveErrors, []);
  } finally {
    await closePage(page);
  }
});

test('V184: bridges a public reserved RPC URL without wire and inspector-blocks it without the bridge', { timeout: testTimeout }, async () => {
  const rpcUrl = 'https://rpc.fixture.invalid';
  const normalizedRpcUrl = 'https://rpc.fixture.invalid/';
  const rpcPayload = { jsonrpc: '2.0', id: 41, result: 'fixture-only-public-rpc' };
  const fixtureCalls = [];
  const fixtureErrors = [];
  const bridgedPage = await openPage({
    rpcUrl,
    onError: (error) => fixtureErrors.push(error),
    respond: async (request) => {
      fixtureCalls.push(request);
      const body = JSON.parse(request.postData);
      return { payload: { jsonrpc: '2.0', id: body.id, result: rpcPayload.result } };
    },
  });
  try {
    await runtime(bridgedPage, rpcFetchScript(rpcUrl, 'public-rpc-fixture', 41));
    assert.deepEqual(await awaitRpcResult(bridgedPage), { ok: true, status: 200, payload: rpcPayload });
    assert.deepEqual(fixtureCalls.map(({ url, method }) => ({ url, method })), [{ url: normalizedRpcUrl, method: 'POST' }]);
    assert.equal(JSON.parse(fixtureCalls[0].postData).method, 'public-rpc-fixture');
    assert.equal(bridgedPage.networkEvents.some((event) => event.method === 'Network.requestWillBeSent' && event.url === normalizedRpcUrl), false, 'the fixture bridge must answer without a browser network request');
    await bridgedPage.transport.drain();
    assert.deepEqual(fixtureErrors, []);
  } finally {
    await closePage(bridgedPage);
  }

  const nativeCalls = [];
  const nativeErrors = [];
  const guardedPage = await openPage({
    fixture: false,
    rpcUrl,
    onError: (error) => nativeErrors.push(error),
    respond: async (request) => { nativeCalls.push(request); return { payload: {} }; },
  });
  try {
    await runtime(guardedPage, rpcFetchScript(rpcUrl, 'public-rpc-without-bridge', 42));
    const result = await awaitRpcResult(guardedPage);
    assert.equal(result.ok, false);
    assert.equal(result.name, 'TypeError');
    await waitUntil(() => {
      const started = guardedPage.networkEvents.find((event) => event.method === 'Network.requestWillBeSent' && event.url === normalizedRpcUrl);
      return started && guardedPage.networkEvents.some((event) => event.method === 'Network.loadingFailed' && event.requestId === started.requestId);
    }, 'inspector-blocked public RPC request');
    const started = guardedPage.networkEvents.filter((event) => event.method === 'Network.requestWillBeSent' && event.url === normalizedRpcUrl);
    assert.equal(started.length, 1);
    const failed = guardedPage.networkEvents.find((event) => event.method === 'Network.loadingFailed' && event.requestId === started[0].requestId);
    assert.ok(failed);
    assert.equal(failed.blockedReason, 'inspector', 'host resolver failure must not stand in for a guard block');
    assert.deepEqual(nativeCalls, [], 'a missing fixture bridge must not fall through to host RPC');
    assert.deepEqual(nativeErrors, []);
    await guardedPage.transport.drain();
  } finally {
    await closePage(guardedPage);
  }
});

test('V184: blocks redirects from an allowed page origin to a denied loopback target', { timeout: testTimeout }, async () => {
  resetProbeObservations();
  pageObservations.length = 0;
  redirectTarget = `${httpProbeOrigin}/redirected`;
  const page = await openPage({ fixture: false });
  try {
    const result = await runtime(page, `fetch(${JSON.stringify(`${pageOrigin}/redirect`)}, {
      mode: 'no-cors', cache: 'no-store', redirect: 'follow',
    }).then(response => ({ ok: true, status: response.status }))
      .catch(error => ({ ok: false, name: error.name }))`);
    assert.equal(result.ok, false, 'redirect target must be blocked');
    assert.ok(pageObservations.some((entry) => entry.method === 'GET' && entry.path === '/redirect'), 'the allowed origin served the redirect');
    await page.transport.drain();
    assert.equal(probeObservations.httpConnections, 0);
    assert.deepEqual(probeObservations.httpRequests, []);
    assert.equal(probeObservations.httpsConnections, 0);
  } finally {
    redirectTarget = undefined;
    await closePage(page);
  }
});

test('V184: rejects wildcard, non-origin and same-origin RPC configurations', { timeout: testTimeout }, async () => {
  const validRpc = rpcHttpUrl;
  const invalidOrigins = [
    '*',
    'http://127.0.0.1:*',
    pageOrigin + '/path',
    pageOrigin + '/',
    `${pageOrigin}?query=1`,
    `${pageOrigin}#fragment`,
    'http://user:secret@127.0.0.1:1234',
    'https://example.invalid',
  ];
  for (const invalidOrigin of invalidOrigins) {
    assert.throws(() => createFixtureTransport({
      call,
      allowedOrigins: [pageOrigin, apiOrigin, invalidOrigin],
      rpcUrl: validRpc,
      respond: async () => ({ payload: {} }),
      onError() {},
    }), `invalid allowed origin must be rejected: ${invalidOrigin}`);
  }
  for (const sameOriginRpc of [`${pageOrigin}/rpc`, `${apiOrigin}/rpc`]) {
    assert.throws(() => createFixtureTransport({
      call,
      allowedOrigins: [pageOrigin, apiOrigin],
      rpcUrl: sameOriginRpc,
      respond: async () => ({ payload: {} }),
      onError() {},
    }), `RPC URL on allowed origin must be rejected: ${sameOriginRpc}`);
  }
});

test('V184: bridges only the exact RPC URL and handles caller abort without cancelling host work', { timeout: testTimeout }, async () => {
  resetProbeObservations();
  const callbackCalls = [];
  const callbackStarted = deferred();
  const heldReply = deferredResponse({ jsonrpc: '2.0', id: 13, result: 'reply-after-abort' });
  const page = await openPage({
    respond: async (request) => {
      callbackCalls.push(request);
      callbackStarted.resolve(request);
      return heldReply.promise;
    },
  });
  try {
    const aborted = await runtime(page, `(() => {
      const controller = new AbortController();
      controller.abort();
      return fetch(${JSON.stringify(rpcHttpUrl)}, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{"jsonrpc":"2.0","id":12,"method":"already-aborted"}',
        signal: controller.signal,
      }).then(() => ({ ok: true }), error => ({ ok: false, name: error.name }));
    })()`);
    assert.deepEqual(aborted, { ok: false, name: 'AbortError' });
    assert.deepEqual(callbackCalls, [], 'an already-aborted caller must not dispatch host work');

    await runtime(page, `(() => {
      window.__abortController = new AbortController();
      window.__rpcFinished = false;
      window.__rpcPromise = fetch(${JSON.stringify(rpcHttpUrl)}, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{"jsonrpc":"2.0","id":13,"method":"abort-after-dispatch"}',
        signal: window.__abortController.signal,
      }).then(response => response.json()).then(value => ({ ok: true, value }), error => ({ ok: false, name: error.name }))
        .then(result => { window.__rpcResult = result; window.__rpcFinished = true; return result; });
      return true;
    })()`);
    const dispatched = await callbackStarted.promise;
    assert.equal(dispatched.url, rpcHttpUrl);
    const drain = page.transport.drain();
    let drainSettled = false;
    void drain.then(() => { drainSettled = true; }, () => { drainSettled = true; });
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(drainSettled, false, 'drain must wait for in-flight host callback work');
    const abortedAfterDispatch = await runtime(page, `(() => {
      window.__abortController.abort();
      return window.__rpcPromise;
    })()`);
    assert.deepEqual(abortedAfterDispatch, { ok: false, name: 'AbortError' });
    assert.equal(callbackCalls.length, 1, 'abort after dispatch must not cancel host work');
    heldReply.resolve();
    await drain;
    assert.deepEqual(page.receiveErrors, []);
    assert.equal(probeObservations.httpConnections, 0);
    assert.deepEqual(probeObservations.httpRequests, []);
  } finally {
    await closePage(page);
  }
});

test('V184: preserves the calling context across hash and child-frame navigation', { timeout: testTimeout }, async () => {
  const started = deferred();
  const reply = deferredResponse({ jsonrpc: '2.0', id: 41, result: 'same-context' });
  const errors = [];
  const page = await openPage({
    onError: error => errors.push(error),
    respond: async request => { started.resolve(request); return reply.promise; },
  });
  try {
    await runtime(page, rpcFetchScript(rpcHttpUrl, 'same-context', 41));
    await started.promise;
    await runtime(page, 'new Promise((resolve, reject) => { location.hash = "fixture-hash"; const frame = document.createElement("iframe"); frame.onload = () => resolve(true); frame.onerror = () => reject(new Error("Owned frame failed")); frame.src = ' + JSON.stringify(pageOrigin + '/child') + '; document.body.append(frame); })');
    reply.resolve();
    assert.deepEqual(await awaitRpcResult(page), { ok: true, status: 200, payload: { jsonrpc: '2.0', id: 41, result: 'same-context' } });
    await page.transport.drain();
    assert.deepEqual(errors, []);
  } finally {
    reply.resolve();
    await closePage(page);
  }
});

test('V184: does not let a stale RPC completion resolve a new page after navigation', { timeout: testTimeout }, async () => {
  resetProbeObservations();
  const oldStarted = deferred();
  const newStarted = deferred();
  const oldReply = deferredResponse({ jsonrpc: '2.0', id: 21, result: 'stale-page-result' });
  const newReply = deferredResponse({ jsonrpc: '2.0', id: 22, result: 'fresh-page-result' });
  const errors = [];
  let callbackIndex = 0;
  const page = await openPage({
    onError: (error) => errors.push(error),
    respond: async (request) => {
      callbackIndex += 1;
      if (callbackIndex === 1) { oldStarted.resolve(request); return oldReply.promise; }
      newStarted.resolve(request);
      return newReply.promise;
    },
  });
  try {
    await runtime(page, rpcFetchScript(rpcHttpUrl, 'old-page-call', 21));
    await oldStarted.promise;
    await page.send('Page.navigate', { url: `${pageOrigin}/next` });
    await waitUntil(() => runtime(page, 'location.pathname').then((value) => value === '/next'), 'navigation to the new page context');
    await runtime(page, rpcFetchScript(rpcHttpUrl, 'new-page-call', 22));
    await newStarted.promise;

    const drain = page.transport.drain();
    let drainSettled = false;
    void drain.then(() => { drainSettled = true; }, () => { drainSettled = true; });
    oldReply.resolve();
    await waitUntil(() => errors.length > 0, 'the old execution context rejection');
    assert.equal(await runtime(page, 'window.__rpcFinished'), false, 'the old completion must not resolve the new page RPC');
    assert.equal(drainSettled, false, 'drain must still await the new page callback');
    newReply.resolve();
    const newResult = await awaitRpcResult(page);
    assert.deepEqual(newResult, { ok: true, status: 200, payload: { jsonrpc: '2.0', id: 22, result: 'fresh-page-result' } });
    await assert.rejects(drain);
    assert.ok(errors.length > 0, 'stale completion must reach onError');
    assert.equal(probeObservations.httpConnections, 0);
    assert.deepEqual(probeObservations.httpRequests, []);
  } finally {
    await closePage(page);
  }
});

test('V184: latches a late callback rejection and rejects drain without native RPC fallback', { timeout: testTimeout }, async () => {
  resetProbeObservations();
  const callbackStarted = deferred();
  const heldReply = deferredResponse({ jsonrpc: '2.0', id: 31, result: 'unused' });
  const errors = [];
  const page = await openPage({
    onError: (error) => errors.push(error),
    respond: async (request) => {
      callbackStarted.resolve(request);
      return heldReply.promise;
    },
  });
  try {
    await runtime(page, rpcFetchScript(rpcHttpUrl, 'late-rejection', 31));
    await callbackStarted.promise;
    const drain = page.transport.drain();
    let drainSettled = false;
    void drain.then(() => { drainSettled = true; }, () => { drainSettled = true; });
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(drainSettled, false, 'drain must remain pending while the callback is in flight');
    const rejection = new Error('late fixture callback rejection');
    heldReply.reject(rejection);
    const pageResult = await awaitRpcResult(page);
    assert.equal(pageResult.ok, false, 'the page fetch must reject instead of falling back to real RPC');
    await assert.rejects(drain, error => error === rejection);
    assert.ok(errors.includes(rejection));
    assert.equal(probeObservations.httpConnections, 0);
    assert.deepEqual(probeObservations.httpRequests, []);
  } finally {
    await closePage(page);
  }
});


test('V184: a context-id reuse race cannot resolve the replacement page', { timeout: testTimeout }, async () => {
  const oldStarted = deferred();
  const newStarted = deferred();
  const evaluated = deferred();
  const oldReply = deferredResponse({ jsonrpc: '2.0', id: 51, result: 'old-context' });
  const newReply = deferredResponse({ jsonrpc: '2.0', id: 52, result: 'new-context' });
  const errors = [];
  let page;
  let injectNavigation = false;
  let replacementContextId;
  let callbacks = 0;
  const fixtureCall = async (method, params, sessionId) => {
    if (!injectNavigation || method !== 'Runtime.evaluate') return call(method, params, sessionId);
    injectNavigation = false;
    await page.send('Page.navigate', { url: pageOrigin + '/context-race' });
    await waitUntil(() => runtime(page, 'location.pathname').then(value => value === '/context-race'), 'replacement page navigation');
    await runtime(page, rpcFetchScript(rpcHttpUrl, 'new-context', 52));
    await newStarted.promise;
    await waitUntil(() => Number.isSafeInteger(replacementContextId), 'the replacement execution context');
    // Model Chromium rebinding a numeric ID between the freshness check and evaluation.
    // The actual response still executes in a real browser; unique IDs are never remapped.
    const target = params.contextId === undefined ? params : { ...params, contextId: replacementContextId };
    try { return await call(method, target, sessionId); }
    finally { evaluated.resolve(); }
  };
  page = await openPage({
    fixtureCall,
    onError: error => errors.push(error),
    respond: async request => {
      callbacks += 1;
      if (callbacks === 1) { oldStarted.resolve(request); return oldReply.promise; }
      newStarted.resolve(request);
      return newReply.promise;
    },
  });
  const receive = page.transport.receive;
  page.transport.receive = message => {
    if (message.method === 'Runtime.executionContextCreated' && message.params.context.auxData?.isDefault) replacementContextId = message.params.context.id;
    return receive(message);
  };
  try {
    await runtime(page, rpcFetchScript(rpcHttpUrl, 'old-context', 51));
    await oldStarted.promise;
    injectNavigation = true;
    oldReply.resolve();
    await evaluated.promise;
    await waitUntil(() => errors.length > 0, 'stale response rejection');
    assert.equal(await runtime(page, 'window.__rpcFinished'), false, 'the stale response must not resolve a replacement caller');
    newReply.resolve();
    assert.deepEqual(await awaitRpcResult(page), { ok: true, status: 200, payload: { jsonrpc: '2.0', id: 52, result: 'new-context' } });
    await assert.rejects(page.transport.drain());
  } finally {
    oldReply.resolve();
    newReply.resolve();
    await closePage(page);
  }
});

test('V184: missing unique context metadata fails before fixture work', { timeout: testTimeout }, async () => {
  resetProbeObservations();
  const errors = [];
  let callbacks = 0;
  const page = await openPage({
    onError: error => errors.push(error),
    respond: async () => { callbacks += 1; return { payload: {} }; },
  });
  const receive = page.transport.receive;
  page.transport.receive = message => {
    if (message.method === 'Runtime.executionContextCreated') {
      const { uniqueId, ...context } = message.params.context;
      return receive({ ...message, params: { ...message.params, context } });
    }
    return receive(message);
  };
  try {
    await page.send('Page.navigate', { url: pageOrigin + '/missing-context-identity' });
    await waitUntil(() => runtime(page, 'location.pathname').then(value => value === '/missing-context-identity'), 'the metadata-filtered context');
    await runtime(page, rpcFetchScript(rpcHttpUrl, 'missing-context-identity', 61));
    await waitUntil(() => errors.length > 0, 'missing identity rejection');
    await assert.rejects(page.transport.drain());
    assert.equal(callbacks, 0);
    assert.equal(probeObservations.httpConnections, 0);
    assert.deepEqual(probeObservations.httpRequests, []);
  } finally {
    await closePage(page);
  }
});
