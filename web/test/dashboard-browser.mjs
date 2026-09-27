import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { createServer } from 'node:http';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { extname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { appendEvent, createRun, formatUsdc, replayRun } from '../treasury/domain.mjs';

// Every browser profile, storage record and source action is disposable.
// The dashboard is synthetic. No service token, wallet or external HTTP is used.
const root = resolve(process.env.FALCON_DASHBOARD_WEB_ROOT || fileURLToPath(new URL('../dist/', import.meta.url)));
const sourceRoot = process.env.FALCON_DASHBOARD_SOURCE || '/Users/sarthiborkar/Library/Application Support/Open Design/namespaces/release-stable/data/projects/886c2e41-d9d4-45e0-a67d-148f20cfca61';
const evidenceRoot = process.env.FALCON_DASHBOARD_EVIDENCE || '/private/tmp/falcon-dashboard-source-r9g2sbv8';
await mkdir(evidenceRoot, { recursive: true });
const artifactDir = await mkdtemp(`${evidenceRoot}/browser-`);
const sourceOnly = process.argv.includes('--source-only');
const sourceRegressions = process.argv.includes('--source-regressions');
const targetCase = process.argv.find(argument => argument.startsWith('--case='))?.slice('--case='.length);
if (targetCase && !['legacy', 'clipboard', 'fonts'].includes(targetCase)) throw Error('Unknown dashboard browser case.');
const KEY = 'falconos-control-centre-preview-v1';
const SENTINELS = { 'falcon.treasury.simulation.v1': 'existing-treasury-record-marker', 'falconos-workspace-v1': 'existing-advisory-record-marker' };
const SOURCE_FILES = ['falconos-workspace.html', 'falconos-advisory-workspace.html', 'falconos-knowledge.html', 'falconos-capital.html'];
const VIEWS = { overview: 'Control Centre', decisions: 'Decision desk', knowledge: 'Knowledge mesh', connections: 'Connections' };
const checks = [], exceptions = [], remoteRequests = [], localRequests = [], localResponses = [], downloads = [];
const pending = new Map();
let server, chrome, origin, activePage, sourceData;
let sequence = 0, buffer = '', stderr = '';
const pause = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));
const hash = text => createHash('sha256').update(text).digest('hex');
const prettyUnits = value => {
  const [whole, fraction] = formatUsdc(value).split('.');
  return whole.replace(/\B(?=(\d{3})+(?!\d))/g, ',') + (fraction ? `.${fraction}` : '');
};
function check(name, value, detail, fatal = true) {
  checks.push({ name, pass: Boolean(value), ...(detail === undefined ? {} : { detail }) });
  if (fatal) assert.ok(value, name);
  else if (!value) process.exitCode = 1;
}
function failPending(error) {
  for (const item of pending.values()) { clearTimeout(item.timer); item.reject(error); }
  pending.clear();
}
function call(method, params = {}, sessionId, timeoutMs = 20000) {
  return new Promise((resolve, reject) => {
    const id = ++sequence;
    const timer = setTimeout(() => { pending.delete(id); reject(Error(`CDP timeout: ${method}`)); }, timeoutMs);
    pending.set(id, { resolve, reject, timer });
    chrome.stdio[3].write(`${JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) })}\0`);
  });
}
function receive(data) {
  buffer += data.toString();
  let index;
  while ((index = buffer.indexOf('\0')) >= 0) {
    const raw = buffer.slice(0, index); buffer = buffer.slice(index + 1);
    if (!raw) continue;
    const message = JSON.parse(raw);
    if (message.id) {
      const item = pending.get(message.id);
      if (item) {
        pending.delete(message.id); clearTimeout(item.timer);
        if (message.error) item.reject(Error(JSON.stringify(message.error))); else item.resolve(message.result);
      }
    }
    if (message.method === 'Runtime.exceptionThrown') exceptions.push(message.params.exceptionDetails);
    if (message.method === 'Browser.downloadWillBegin') downloads.push({ ...message.params, state: 'inProgress' });
    if (message.method === 'Browser.downloadProgress') {
      const item = downloads.find(item => item.guid === message.params.guid);
      if (item) Object.assign(item, message.params);
    }
    if (message.method === 'Network.requestWillBeSent') {
      const url = new URL(message.params.request.url);
      if (url.origin === origin) localRequests.push({ method: message.params.request.method, path: url.pathname });
    }
    if (message.method === 'Network.responseReceived') {
      const response = message.params.response;
      const url = new URL(response.url);
      if (url.origin === origin) localResponses.push({ path: url.pathname, status: response.status, type: message.params.type });
    }
    if (message.method === 'Fetch.requestPaused') {
      const url = new URL(message.params.request.url);
      const allowed = !['http:', 'https:'].includes(url.protocol) || url.origin === origin;
      if (!allowed) remoteRequests.push(`${url.origin}${url.pathname}`);
      void call(allowed ? 'Fetch.continueRequest' : 'Fetch.failRequest', { requestId: message.params.requestId,
        ...(allowed ? {} : { errorReason: 'BlockedByClient' }) }, message.sessionId).catch(failPending);
    }
  }
}
async function page({ source = false, isolated = false, seed, path, reduced = true, width = 1440, ready, fastLoop = false, noLocks = false } = {}) {
  const context = isolated ? await call('Target.createBrowserContext') : null;
  const target = await call('Target.createTarget', { url: 'about:blank', ...(context ? { browserContextId: context.browserContextId } : {}) });
  const { sessionId } = await call('Target.attachToTarget', { targetId: target.targetId, flatten: true });
  await call('Target.activateTarget', { targetId: target.targetId });
  const send = (method, params = {}) => call(method, params, sessionId);
  await send('Page.enable'); await send('Runtime.enable'); await send('Network.enable');
  await send('Fetch.enable', { patterns: [{ urlPattern: '*', requestStage: 'Request' }] });
  await send('Emulation.setDeviceMetricsOverride', { width, height: width === 320 ? 844 : 1080, deviceScaleFactor: 1, mobile: width === 320 });
  await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: reduced ? 'reduce' : 'no-preference' }] });
  await send('Page.addScriptToEvaluateOnNewDocument', { source: `(() => {
    const RealDate = Date; window.__dashboardClockOffset = 0;
    window.Date = class extends RealDate { constructor(...args) { super(...(args.length ? args : [RealDate.now()+window.__dashboardClockOffset])); } static now() { return RealDate.now()+window.__dashboardClockOffset; } };
    const originalGet = Storage.prototype.getItem; const originalSet = Storage.prototype.setItem;
    window.__dashboardFailWrites = false;
    Storage.prototype.setItem = function(key,value) { if (key === ${JSON.stringify(KEY)} && window.__dashboardFailWrites) throw new DOMException('Controlled storage failure','QuotaExceededError'); return originalSet.call(this,key,value); };
    ${seed ? `if (sessionStorage.getItem('dashboard-test-seeded') !== 'yes') { for (const [key,value] of Object.entries(${JSON.stringify(seed)})) originalSet.call(localStorage,key,value); sessionStorage.setItem('dashboard-test-seeded','yes'); }` : ''}
    ${noLocks ? "Object.defineProperty(navigator,'locks',{value:undefined,configurable:true});" : ''}
    ${fastLoop ? 'const timer = window.setTimeout; window.setTimeout = (fn,ms,...args) => timer(fn,ms === 5000 ? 40 : ms,...args);' : ''}
  })();` });
  const evaluate = async expression => {
    let result;
    try { result = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true, userGesture: true }); }
    catch (error) { throw Error(`${error.message}: ${expression.slice(0, 300)}`); }
    if (result.exceptionDetails) throw Error(JSON.stringify(result.exceptionDetails));
    return result.result.value;
  };
  const wait = async (expression, attempts = 300) => {
    for (let n = 0; n < attempts; n++) { if (await evaluate(expression)) return; await pause(50); }
    throw Error(`Page condition timed out: ${expression}`);
  };
  const click = selector => evaluate(`(() => { const node = document.querySelector(${JSON.stringify(selector)}); if (!node) throw Error('Missing selector: '+${JSON.stringify(selector)}); node.click(); })()`);
  const destination = path ?? (source ? '/__source__/falconos-workspace.html' : '/dashboard/');
  const condition = ready ?? 'document.readyState === "complete" && Boolean(document.querySelector("#view .panel"))';
  const open = async () => { await send('Page.navigate', { url: `${origin}${destination}` }); await wait(condition); await evaluate('document.fonts.ready.then(()=>true)'); };
  const reload = async () => {
    await evaluate('document.documentElement.dataset.awaitingReload = "yes"');
    await send('Page.reload'); await wait(`!document.documentElement.dataset.awaitingReload && (${condition})`);
  };
  const close = async () => { await call('Target.closeTarget', { targetId: target.targetId }); if (context) await call('Target.disposeBrowserContext', { browserContextId: context.browserContextId }); };
  await open();
  return { send, evaluate, wait, click, reload, close, target, source };
}
async function route(p, view) {
  await p.click(`[data-route="${view}"]`);
  await p.wait(`location.hash === '#${view}' && document.getElementById('page-title').textContent === ${JSON.stringify(VIEWS[view])}`);
}
async function screenshot(p, name, full = false) {
  const metrics = full ? await p.send('Page.getLayoutMetrics') : null;
  const result = await p.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: full,
    ...(full ? { clip: { x: 0, y: 0, width: metrics.cssContentSize.width, height: metrics.cssContentSize.height, scale: 1 } } : {}) });
  await writeFile(`${artifactDir}/${name}.png`, Buffer.from(result.data, 'base64'));
}
async function snapshots(p, prefix) {
  for (const width of [1440, 320]) {
    await p.send('Emulation.setDeviceMetricsOverride', { width, height: width === 320 ? 844 : 1080, deviceScaleFactor: 1, mobile: width === 320 });
    for (const view of Object.keys(VIEWS)) {
      await route(p, view); await p.evaluate('scrollTo(0,0)');
      check(`V107: ${prefix} ${view} fits ${width}px`, await p.evaluate('document.documentElement.scrollWidth <= innerWidth'));
      await screenshot(p, `${prefix}-${view}-${width}`, true);
    }
  }
}
async function verifyFonts(p, prefix) {
  const fonts = await p.evaluate(`(async () => {
    const requested = ['400 16px "Geist"', '500 16px "Geist"', '600 16px "Geist"', '400 16px "Geist Mono"'];
    const loads = await Promise.allSettled(requested.map(font => document.fonts.load(font)));
    return { loads: loads.map(result => result.status), checks: requested.map(font => document.fonts.check(font)),
      faces: [...document.fonts].map(face => ({ family: face.family.replaceAll('"', '').replaceAll("'", ''), weight: face.weight, status: face.status })) };
  })()`);
  const expected = [['Geist', '400'], ['Geist', '500'], ['Geist', '600'], ['Geist Mono', '400']];
  check(`V107/B82: ${prefix} loads all four original font faces`, fonts.loads.every(status => status === 'fulfilled') && fonts.checks.every(Boolean) && expected.every(([family, weight]) => fonts.faces.some(face => face.family === family && face.weight === weight && face.status === 'loaded')), fonts);
  await p.send('DOM.enable'); await p.send('CSS.enable');
  const { root: document } = await p.send('DOM.getDocument');
  const bindings = [];
  for (const [selector, family] of [['#page-title', 'Geist Mono'], ['#page-description', 'Geist']]) {
    const { nodeId } = await p.send('DOM.querySelector', { nodeId: document.nodeId, selector });
    const result = await p.send('CSS.getPlatformFontsForNode', { nodeId });
    bindings.push({ selector, expected: family, fonts: result.fonts });
  }
  check(`V107/B82: ${prefix} renders text with custom Geist and Geist Mono`, bindings.every(binding => binding.fonts.some(font => font.isCustomFont && font.glyphCount > 0 && font.familyName === binding.expected)), bindings);
  if (prefix === 'react') {
    const responses = localResponses.filter(response => /\/geist[^/]+\.ttf$/.test(response.path));
    check('V107/B82: four local font resources return HTTP 200', new Set(responses.filter(response => response.status === 200).map(response => response.path)).size === 4 && responses.every(response => response.status === 200), responses);
  }
}
async function field(p, selector, value) {
  await p.evaluate(`(() => { const input=document.querySelector(${JSON.stringify(selector)}); Object.getOwnPropertyDescriptor(input instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLInputElement.prototype,'value').set.call(input,${JSON.stringify(value)}); input.dispatchEvent(new Event('input',{bubbles:true})); input.dispatchEvent(new Event('change',{bubbles:true})); })()`);
}
const saved = p => p.evaluate(`localStorage.getItem(${JSON.stringify(KEY)})`);
async function event(p, action) {
  const before = JSON.parse(await saved(p)).events.length;
  await p.click(`[data-action="${action}"]`);
  await p.wait(`JSON.parse(localStorage.getItem(${JSON.stringify(KEY)})).events.length === ${before + 1}`);
  return JSON.parse(await saved(p));
}
async function closeDialog(p, id) {
  await p.click(`#${id} [data-close]`); await p.wait(`!document.getElementById('${id}').open`);
}
const traceStatus = p => p.evaluate('document.querySelector(".trace-summary .badge")?.textContent.trim().replaceAll(" ","_")');
function recentRun() {
  const start = Date.now() - 2000;
  const at = delta => new Date(start + delta).toISOString();
  let run = createRun({ id: randomUUID(), createdAt: at(0), totalUsdc: '1000', reserveUsdc: '200', investmentCapUsdc: '500', minLiquidityUsdc: '1000', maxObservationAgeSeconds: 60 });
  run = appendEvent(run, { id: randomUUID(), at: at(100), type: 'observe', observation: { source: 'synthetic', status: 'ok', observedAt: at(100), availableLiquidityUsdc: '2000' } });
  return appendEvent(run, { id: randomUUID(), at: at(200), type: 'cycle' });
}
async function evidenceRegressions(p, fatal) {
  await route(p, 'knowledge');
  const source = sourceData.knowledge.liquid.sources[0];
  await p.click(`[data-source="${source.revisionId}"]`);
  const actual = await p.evaluate('document.querySelector("#knowledge-inspector .source-json").textContent');
  check('V109/B75: source inspector preserves exact retained bytes', actual === source.content, { retainedSha256: hash(source.content), displayedSha256: hash(actual) }, fatal);
  await p.click('[data-action="export-mesh"]'); await p.wait('document.getElementById("export-dialog").open');
  const description = await p.evaluate('document.querySelector("#export-dialog .dialog-content .form-note").textContent');
  const exported = JSON.parse(await p.evaluate('document.getElementById("export-json").value'));
  check('V111/B77: knowledge export describes graph, analysis and sources without commands', exported.graph && exported.analysis && exported.sources && /graph/i.test(description) && /analysis/i.test(description) && /source/i.test(description) && !/commands|outcomes/i.test(description), { description, keys: Object.keys(exported) }, fatal);
  await closeDialog(p, 'export-dialog');
}
async function clockRegression({ source = false, fatal = true } = {}) {
  const run = recentRun();
  const p = await page({ source, isolated: true, seed: { [KEY]: JSON.stringify(run) } });
  await route(p, 'decisions');
  assert.equal(await traceStatus(p), 'READY');
  await p.evaluate('window.__dashboardClockOffset = 61000');
  await pause(1300);
  const actual = await traceStatus(p);
  check('V110/B76: current decision expires with its evidence without another click', actual === 'NO_DATA', { observed: actual, age: await p.evaluate('document.getElementById("evidence-age").textContent') }, fatal);
  if (!source) {
    await p.click(`[data-history="${run.events[1].id}"]`);
    const before = await p.evaluate('document.querySelector(".trace-summary").textContent');
    await p.evaluate('window.__dashboardClockOffset = 121000'); await pause(1100);
    check('V110: historical decision retains original cutoff after the live clock advances', await traceStatus(p) === 'READY' && await p.evaluate('document.querySelector(".trace-summary").textContent') === before && await saved(p) === JSON.stringify(run));
  }
  await p.close();
}
async function legacyReferences() {
  for (const file of SOURCE_FILES.slice(1)) {
    const seed = { [KEY]: 'active-dashboard-marker', 'falcon.treasury.simulation.v1': 'existing-treasury-marker' };
    const p = await page({ isolated: true, seed, path: `/__source__/${file}`, ready: 'document.readyState === "complete" && Boolean(document.getElementById("workspace-menu"))' });
    check(`V108/V111: original reference ${file} writes only its own legacy namespace`, await p.evaluate(`localStorage.length === 3 && Boolean(JSON.parse(localStorage.getItem('falconos-workspace-v1'))) && Object.entries(${JSON.stringify(seed)}).every(([key,value]) => localStorage.getItem(key) === value)`));
    await p.close();
  }
}

try {
  const html = await readFile(`${sourceRoot}/falconos-workspace.html`, 'utf8');
  sourceData = JSON.parse(html.match(/<script id="cc-data" type="application\/json">([\s\S]*?)<\/script>/)[1]);
  if (!sourceOnly && !sourceRegressions) {
    await readFile(`${root}/dashboard/index.html`);
    const portedData = JSON.parse(await readFile(new URL('../dashboard/data.json', import.meta.url), 'utf8'));
    check('V109: ported fixtures equal the exact parsed OpenDesign payload', JSON.stringify(portedData) === JSON.stringify(sourceData));
  }
  server = createServer(async (request, response) => {
    try {
      let pathname = decodeURIComponent(new URL(request.url, 'http://local.invalid').pathname);
      let filename;
      if (pathname.startsWith('/__source__/')) {
        const name = pathname.slice('/__source__/'.length);
        if (!SOURCE_FILES.includes(name)) throw Error('Unknown source reference');
        filename = `${sourceRoot}/${name}`;
      } else {
        if (pathname.endsWith('/')) pathname += 'index.html';
        filename = resolve(root, `.${pathname}`);
        if (!filename.startsWith(root + sep)) throw Error('Invalid path');
      }
      const body = await readFile(filename);
      response.writeHead(200, { 'content-type': ({ '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.ttf': 'font/ttf', '.json': 'application/json' })[extname(filename)] || 'application/octet-stream', 'cache-control': 'no-store' });
      response.end(body);
    } catch { response.writeHead(404); response.end('Not found'); }
  });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  origin = `http://127.0.0.1:${server.address().port}`;
  chrome = spawn(process.env.CHROME_BIN || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', ['--headless=new', '--no-first-run', '--no-default-browser-check', '--disable-background-networking', '--disable-component-update', '--disable-sync', '--metrics-recording-only', `--user-data-dir=${artifactDir}/chrome`, '--remote-debugging-pipe', 'about:blank'], { stdio: ['ignore', 'ignore', 'pipe', 'pipe', 'pipe'] });
  chrome.stderr.on('data', data => { stderr = (stderr + data.toString()).slice(-2000); });
  chrome.on('error', failPending); chrome.on('exit', (code, signal) => failPending(Error(`Chrome exited ${code}/${signal}: ${stderr}`)));
  chrome.stdio[4].on('data', receive);
  await call('Browser.getVersion', {}, undefined, 60000);
  if (!sourceOnly && !sourceRegressions && !targetCase) {
    await call('Browser.setDownloadBehavior', { behavior: 'allow', downloadPath: artifactDir, eventsEnabled: true });
  }
  if (sourceRegressions) {
    activePage = await page({ source: true, isolated: true });
    await evidenceRegressions(activePage, false); await clockRegression({ source: true, fatal: false });
    await queuedLoopStop({ source: true, fatal: false });
  } else if (sourceOnly) {
    activePage = await page({ source: true, isolated: true });
    await verifyFonts(activePage, 'source'); await snapshots(activePage, 'source'); await legacyReferences();
  } else if (targetCase === 'legacy') {
    await legacyCase();
  } else if (targetCase) {
    activePage = await page();
    if (targetCase === 'fonts') await verifyFonts(activePage, 'react');
    else await staleClipboard(activePage);
  } else {
    await runReact();
  }
  check('V111: instrumented pages attempted no external HTTP requests', remoteRequests.length === 0, remoteRequests);
  check('V107: browser has no uncaught runtime exceptions', exceptions.length === 0, exceptions);
} catch (error) {
  if (checks.at(-1)?.pass !== false) checks.push({ name: error instanceof Error ? error.message : String(error), pass: false });
  process.exitCode = 1;
  if (activePage) { try { await writeFile(`${artifactDir}/failure-copy.txt`, await activePage.evaluate('document.body.innerText')); } catch {} }
} finally {
  if (chrome) { try { await call('Browser.close'); } catch {} chrome.kill(); for (const pipe of chrome.stdio) pipe?.destroy(); }
  if (server?.listening) { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
  const report = { passed: checks.filter(item => item.pass).length, total: checks.length, checks, exceptions, remoteRequests, localRequests, localResponses, downloads, artifactDir, root, sourceRoot, ...(localRequests.length ? {} : { startupStderr: stderr }), mode: sourceRegressions ? 'original-source-negative-control' : sourceOnly ? 'original-source-screenshots' : targetCase ? `react-${targetCase}` : 'react-integration', limitations: 'Isolated synthetic browser records. Source screenshots execute original scripts with outbound HTTP blocked. No live service, wallet, hosting or email delivery tested.' };
  await writeFile(`${artifactDir}/report.json`, JSON.stringify(report, null, 2)); console.log(JSON.stringify(report, null, 2));
}

async function runReact() {
  const source = await page({ source: true, isolated: true });
  await verifyFonts(source, 'source'); await snapshots(source, 'source'); await source.close();
  const p = await page({ seed: SENTINELS }); activePage = p;
  await verifyFonts(p, 'react');
  check('V107/V108: default Hold sample is read-only and leaves existing records intact', await p.evaluate('document.querySelector("[data-sample=hold]").getAttribute("aria-pressed") === "true"') && await saved(p) === null && await p.evaluate(`Object.entries(${JSON.stringify(SENTINELS)}).every(([key,value])=>localStorage.getItem(key)===value)`));
  await snapshots(p, 'react');
  await p.send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1080, deviceScaleFactor: 1, mobile: false });
  for (const name of ['supply', 'hold', 'redeem', 'blocked', 'stale']) {
    const view = replayRun(sourceData.samples[name]);
    const latest = view.entries.findLast(entry => entry.decision);
    await route(p, 'overview'); await p.click(`[data-sample="${name}"]`);
    await p.wait(`document.querySelector('[data-sample="${name}"]').getAttribute('aria-pressed') === 'true'`);
    const balances = await p.evaluate('[...document.querySelectorAll("[data-figure^=balance-] .figure-face")].map(node=>node.textContent)');
    check(`V109: ${name} displays canonical sample balances and recorded decision`, JSON.stringify(balances) === JSON.stringify(['reserveUnits', 'undelegatedUnits', 'idleUnits', 'positionUnits'].map(key => prettyUnits(view.state.balances[key]))) && await p.evaluate(`document.querySelector('.overview-decision').textContent.includes(${JSON.stringify(latest.decision.reasons[0])}) && document.querySelector('.overview-decision .badge').textContent.trim().replaceAll(' ','_') === ${JSON.stringify(latest.decision.status)}`));
    await route(p, 'decisions');
    await p.click(`[data-history="${latest.eventId}"]`);
    check(`V109: ${name} history opens original graph cutoff and result`, await traceStatus(p) === latest.decision.status && await p.evaluate(`document.querySelector('.trace-summary').textContent.includes(${JSON.stringify(new Date(latest.graph.at).toISOString().slice(11, 19))}) && document.querySelector('[data-history="${latest.eventId}"]').getAttribute('aria-pressed') === 'true'`));
  }
  check('V108: browsing every sample caused no simulation write', await saved(p) === null);
  await p.evaluate('document.querySelector("[data-node=reserve]").focus()');
  await p.send('Input.dispatchKeyEvent', { type: 'keyDown', key: ' ', code: 'Space', windowsVirtualKeyCode: 32 });
  await p.send('Input.dispatchKeyEvent', { type: 'keyUp', key: ' ', code: 'Space', windowsVirtualKeyCode: 32 });
  check('V107: Space activates a graph node and retains keyboard focus', await p.evaluate('document.querySelector("[data-node=reserve]").getAttribute("aria-pressed") === "true" && document.activeElement.dataset.node === "reserve" && document.querySelector(".inspector-panel").textContent.includes("Spending reserve")'));
  await p.click('[data-check="freshness"]');
  const staleCheck = replayRun(sourceData.samples.stale).entries.at(-1).decision.checks.find(item => item.id === 'freshness');
  check('V109: rule inspector marks its exact evidence nodes', JSON.stringify(await p.evaluate('[...document.querySelectorAll(".trace-node.evidence")].map(node=>node.dataset.node).sort()')) === JSON.stringify([...staleCheck.evidenceNodeIds].sort()) && await p.evaluate(`document.querySelector('.inspector-panel').textContent.includes(${JSON.stringify(staleCheck.detail)})`));
  check('V107: reduced motion creates no running transition animations', await p.evaluate('matchMedia("(prefers-reduced-motion: reduce)").matches && document.getAnimations().every(animation=>animation.playState !== "running")'));

  await p.evaluate('document.getElementById("new-run").focus()'); await p.click('#new-run');
  await p.wait('document.getElementById("setup-dialog").open');
  await field(p, '#setup-form [name="totalUsdc"]', '1.0000001'); await p.click('#create-submit');
  check('V108: invalid setup is marked without changing stored history', await saved(p) === null && await p.evaluate('document.getElementById("setup-dialog").open && document.querySelector("#setup-form [name=totalUsdc]").getAttribute("aria-invalid") === "true"'));
  await field(p, '#setup-form [name="totalUsdc"]', '1000'); await p.click('#create-submit');
  await p.wait(`Boolean(localStorage.getItem(${JSON.stringify(KEY)})) && !document.getElementById('setup-dialog').open`);
  const initial = JSON.parse(await saved(p));
  check('V108/V109: setup saves one isolated schema-2 run with exact authority boundaries', initial.schemaVersion === 2 && initial.events.length === 0 && replayRun(initial).state.balances.undelegatedUnits === '300000000' && initial.setup.reserveUsdc === '200' && initial.setup.investmentCapUsdc === '500');
  await route(p, 'decisions');
  await event(p, 'preset-healthy');
  const supplied = await event(p, 'cycle');
  const supplyEntry = supplied.records.at(-1);
  check('V109: supply records the original input and moves only delegated 500 USDC', supplyEntry.decision.action === 'SUPPLY' && supplyEntry.decision.status === 'READY' && supplyEntry.balances.positionUnits === '500000000' && supplyEntry.balances.idleUnits === '0' && supplyEntry.balances.reserveUnits === '200000000' && supplyEntry.graph.nodes.find(node => node.id === 'position').data.positionUnits === '0');
  await event(p, 'preset-low'); const blocked = await event(p, 'cycle');
  check('V109: low liquidity blocks full exit and preserves the position', blocked.records.at(-1).decision.status === 'BLOCKED' && blocked.records.at(-1).balances.positionUnits === '500000000');
  await event(p, 'preset-stale'); const stale = await event(p, 'cycle');
  check('V109: stale evidence records NO_DATA with zero movement', stale.records.at(-1).decision.status === 'NO_DATA' && stale.records.at(-1).outcome.amountUnits === '0');
  await p.click(`[data-history="${supplyEntry.eventId}"]`);
  check('V110: older supply remains READY after later blocked and stale cycles', await traceStatus(p) === 'READY' && JSON.stringify(JSON.parse(await saved(p)).records.find(entry => entry.eventId === supplyEntry.eventId)) === JSON.stringify(supplyEntry));
  const beforeFailure = await saved(p);
  await p.evaluate('window.__dashboardFailWrites = true'); await p.click('[data-action="cycle"]');
  await p.wait('!document.getElementById("error-banner").hidden');
  check('V108: failed persistence leaves committed record and history unchanged', await saved(p) === beforeFailure && await p.evaluate(`document.querySelectorAll('[data-history]').length === ${JSON.parse(beforeFailure).events.length} && /save|storage/i.test(document.getElementById('error-text').textContent)`));
  await p.evaluate('window.__dashboardFailWrites = false');
  await event(p, 'preset-healthy');
  const beforeReload = await saved(p); await p.reload(); await route(p, 'decisions');
  check('V108/V110: reload retains exact record and leaves the loop stopped', await saved(p) === beforeReload && await p.evaluate('document.getElementById("loop-state").textContent.startsWith("Stopped")'));
  const other = await page(); await route(other, 'decisions');
  await call('Target.activateTarget', { targetId: p.target.targetId });
  const beforeLoop = JSON.parse(await saved(p)).events.length;
  await p.click('#start-loop');
  await p.wait(`JSON.parse(localStorage.getItem(${JSON.stringify(KEY)})).events.length === ${beforeLoop + 1}`);
  await other.wait(`document.querySelectorAll('[data-history]').length === ${beforeLoop + 1}`);
  await event(other, 'preset-healthy');
  await p.wait('document.getElementById("loop-state").textContent.startsWith("Stopped")');
  check('V108/V110: another tab receives committed writes and stops an active loop', await saved(p) === await saved(other) && await other.evaluate('document.getElementById("loop-state").textContent.startsWith("Stopped")'));
  await call('Target.activateTarget', { targetId: p.target.targetId });
  const beforeHide = JSON.parse(await saved(p)).events.length;
  await p.click('#start-loop'); await p.wait(`JSON.parse(localStorage.getItem(${JSON.stringify(KEY)})).events.length === ${beforeHide + 1}`);
  await call('Target.activateTarget', { targetId: other.target.targetId });
  await p.wait('document.hidden && document.getElementById("loop-state").textContent.startsWith("Stopped")');
  const hiddenRecord = await saved(p); await pause(5200);
  check('V110: hidden page cancels its next scheduled cycle', await saved(p) === hiddenRecord);
  await other.close(); await call('Target.activateTarget', { targetId: p.target.targetId });
  await p.click('[data-action="revoke"]'); await p.wait('document.getElementById("revoke-dialog").open');
  await closeDialog(p, 'revoke-dialog');
  check('V111: cancelling revocation preserves authority', replayRun(JSON.parse(await saved(p))).state.revoked === false);
  await p.click('[data-action="revoke"]'); const revoked = await event(p, 'confirm-revoke');
  check('V109/V110: revocation preserves the position and disables agent cycles', replayRun(revoked).state.revoked && replayRun(revoked).state.balances.positionUnits === '500000000' && await p.evaluate('document.querySelector("[data-action=cycle]").disabled && document.getElementById("start-loop").disabled'));
  const redeemed = await event(p, 'owner-redeem');
  check('V109: owner redemption remains available after revocation', redeemed.records.at(-1).decision.action === 'REDEEM' && redeemed.records.at(-1).balances.positionUnits === '0' && redeemed.records.at(-1).balances.idleUnits === '500000000');
  await p.evaluate('document.querySelector("[data-action=export]").focus()'); await p.click('[data-action="export"]');
  await p.wait('document.getElementById("export-dialog").open');
  const exported = await p.evaluate('document.getElementById("export-json").value');
  check('V111: treasury export replays every retained event and snapshot', JSON.stringify(replayRun(JSON.parse(exported))) === JSON.stringify(replayRun(redeemed)));
  await call('Browser.grantPermissions', { origin, permissions: ['clipboardReadWrite', 'clipboardSanitizedWrite'] });
  await p.click('[data-action="copy-export"]'); await p.wait('/copied|selected/i.test(document.getElementById("export-status").textContent)');
  const copied = await p.evaluate('document.getElementById("export-status").textContent');
  check('V111: export copy writes exact bytes or selects the complete fallback', /copied/i.test(copied) ? await p.evaluate('navigator.clipboard.readText()') === exported : await p.evaluate(`document.getElementById('export-json').selectionStart === 0 && document.getElementById('export-json').selectionEnd === ${exported.length}`));
  await p.click('[data-action="download-export"]');
  for (let n = 0; n < 100 && !downloads.some(item => item.state === 'completed'); n++) await pause(50);
  const download = downloads.find(item => item.state === 'completed');
  check('V111: exported download contains the complete saved record', Boolean(download) && await readFile(`${artifactDir}/${download.suggestedFilename}`, 'utf8') === exported);
  await p.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
  await p.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
  await p.wait('!document.getElementById("export-dialog").open');
  check('V107/V111: Escape closes export and restores trigger focus', await p.evaluate('document.activeElement.dataset.action === "export"'));
  await p.click('[data-action="export"]'); await p.wait('document.getElementById("export-dialog").open');
  await p.evaluate('document.getElementById("export-dialog").dispatchEvent(new Event("close")); new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))');
  check('V111: delayed native close event cannot dismiss a reopened export', await p.evaluate('document.getElementById("export-dialog").open'));
  await closeDialog(p, 'export-dialog');
  await staleClipboard(p);
  check('V108: saved operations preserve existing treasury and advisory bytes', await p.evaluate(`Object.entries(${JSON.stringify(SENTINELS)}).every(([key,value])=>localStorage.getItem(key)===value)`));

  await route(p, 'knowledge');
  for (const name of ['liquid', 'illiquid', 'stale', 'missing']) {
    for (const depth of ['3', '2', '1']) {
      const expected = sourceData.knowledge[name].analyses[depth];
      await chooseKnowledge(p, name, depth);
      const text = await p.evaluate('document.querySelector(".mesh-result").textContent');
      check(`V109: ${name}/${depth} uses the retained sample analysis and coverage`, await p.evaluate('document.querySelector(".mesh-result .badge").textContent.trim().replaceAll(" ","_")') === expected.status && text.includes(expected.summary) && text.includes(expected.coverage.status.replaceAll('_', ' ')));
    }
  }
  await chooseKnowledge(p, 'liquid', '3'); await evidenceRegressions(p, true);
  await field(p, '#entity-search', 'position:unrelated');
  check('V109: entity directory can inspect the unrelated position without adding it to the exit', await p.evaluate('document.querySelectorAll("#entity-directory [data-entity]").length === 1 && document.querySelector("#entity-directory [data-entity]").dataset.entity === "position:unrelated" && document.querySelector(".mesh-result").textContent.includes("500")'));
  await p.click('#entity-directory [data-entity]');
  check('V109: entity selection opens its retained relationships and provenance', await p.evaluate('document.getElementById("knowledge-inspector").textContent.includes("position:unrelated") && document.querySelectorAll("#knowledge-inspector [data-source]").length > 0'));
  await route(p, 'connections');
  check('V111: connections distinguish embedded samples and link to the separate live mesh', await p.evaluate('document.getElementById("view").textContent.includes("DISCONNECTED") && document.getElementById("view").textContent.includes("NOT CAPTURED") && [...document.querySelectorAll("a[href]")].some(link=>new URL(link.href).pathname==="/mesh/")'));
  await clockRegression();
  await storageCases();
  await queuedLoopStop();
  await boundedLoop();
  await legacyReferences();
  check('V111: dashboard made no backend, wallet, or provider requests', localRequests.every(request => request.method === 'GET' && !request.path.startsWith('/v1/') && !request.path.startsWith('/api/')));
  await writeFile(`${artifactDir}/ui-copy.txt`, await p.evaluate('document.body.innerText'));
}

async function chooseKnowledge(p, name, depth) {
  await field(p, '#mesh-scenario', name); await field(p, '#mesh-depth', depth);
  await p.click('#analyze-sample');
  const summary = sourceData.knowledge[name].analyses[depth].summary;
  await p.wait(`!document.getElementById('analyze-sample').disabled && document.querySelector('.mesh-result').textContent.includes(${JSON.stringify(summary)})`);
}
async function staleClipboard(p) {
  for (const outcome of ['resolve', 'reject']) {
    await route(p, 'decisions');
    await p.click('[data-action="export"]'); await p.wait('document.getElementById("export-dialog").open');
    await p.evaluate(`(() => {
      window.__dashboardOriginalClipboard = navigator.clipboard.writeText;
      navigator.clipboard.writeText = () => new Promise((resolve, reject) => {
        window.__dashboardFinishCopy = () => ${outcome === 'resolve' ? 'resolve()' : "reject(new Error('Controlled clipboard rejection'))"};
      });
    })()`);
    await p.click('[data-action="copy-export"]');
    await p.wait('typeof window.__dashboardFinishCopy === "function"');
    await closeDialog(p, 'export-dialog');
    await route(p, 'knowledge');
    await p.click('[data-action="export-mesh"]'); await p.wait('document.getElementById("export-dialog").open');
    const before = await p.evaluate('document.getElementById("export-status").textContent');
    await p.evaluate('document.querySelector("[data-action=download-export]").focus(); window.__dashboardFinishCopy();');
    await pause(100);
    check(`V111/B79: delayed clipboard ${outcome} cannot change a newer export or its focus`, await p.evaluate(`document.getElementById('export-dialog').open && document.getElementById('export-status').textContent === ${JSON.stringify(before)} && document.activeElement.dataset.action === 'download-export'`));
    await p.evaluate('navigator.clipboard.writeText = window.__dashboardOriginalClipboard; delete window.__dashboardFinishCopy;');
    await closeDialog(p, 'export-dialog');
  }
}
async function legacyCase() {
  const legacy = structuredClone(sourceData.samples.hold);
  legacy.schemaVersion = 1; delete legacy.records; delete legacy.policyVersion; delete legacy.legacyEventCount;
  const legacyRaw = JSON.stringify(legacy);
  replayRun(legacy);
  const legacyPage = await page({ isolated: true, seed: { ...SENTINELS, [KEY]: legacyRaw }, ready: 'document.readyState === "complete"' });
  await legacyPage.evaluate('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))');
  check('V108/B78: valid schema-1 history renders Overview without changing saved bytes', await legacyPage.evaluate('document.getElementById("page-title")?.textContent === "Control Centre" && Boolean(document.querySelector(".balance-chart"))') && await saved(legacyPage) === legacyRaw);
  await legacyPage.reload(); await route(legacyPage, 'decisions');
  await legacyPage.click('[data-action="export"]'); await legacyPage.wait('document.getElementById("export-dialog").open');
  const description = await legacyPage.evaluate('document.querySelector("#export-dialog .dialog-content .form-note").textContent');
  const json = JSON.parse(await legacyPage.evaluate('document.getElementById("export-json").value'));
  check('V111/B78: legacy export describes commands without claiming saved snapshots', json.schemaVersion === 1 && !Object.hasOwn(json, 'records') && /command/i.test(description) && !/contains[^.]*graphs|includes[^.]*graphs/i.test(description), description);
  await legacyPage.close();
}
async function storageCases() {
  await legacyCase();
  for (const raw of ['{broken', JSON.stringify({ ...sourceData.samples.hold, policyVersion: 'unsupported-policy' })]) {
    const p = await page({ isolated: true, seed: { ...SENTINELS, [KEY]: raw } });
    check('V108: corrupt or unsupported record remains intact and cannot be replaced', await saved(p) === raw && await p.evaluate('!document.getElementById("storage-banner").hidden && /validation|JSON|invalid|unsupported/i.test(document.getElementById("storage-text").textContent)'));
    await p.click('#new-run');
    check('V108: setup cannot overwrite an unreadable existing record', await saved(p) === raw && await p.evaluate('!document.getElementById("setup-dialog").open'));
    await p.close();
  }
  const unavailable = await page({ isolated: true, noLocks: true });
  await unavailable.click('#new-run');
  check('V108: absent Web Locks retains sample inspection and blocks persistent setup', await saved(unavailable) === null && await unavailable.evaluate('!document.getElementById("setup-dialog").open && document.getElementById("storage-text").textContent.includes("Web Locks")'));
  await unavailable.close();
}
async function queuedLoopStop({ source = false, fatal = true } = {}) {
  const run = recentRun();
  const raw = JSON.stringify(run);
  const p = await page({ source, isolated: true, seed: { [KEY]: raw } });
  await route(p, 'decisions');
  await p.evaluate(`window.__dashboardHeldLock = navigator.locks.request(${JSON.stringify(KEY)}, () => new Promise(resolve => { window.__dashboardReleaseLock = resolve; })); true`);
  await p.wait('typeof window.__dashboardReleaseLock === "function"');
  try {
    await p.click('#start-loop');
    await p.wait(`navigator.locks.query().then(state => state.pending.some(lock => lock.name === ${JSON.stringify(KEY)}))`);
    check('V110/B80: Stop stays available while a loop cycle waits for the storage lock', await p.evaluate('!document.getElementById("start-loop").disabled'), undefined, false);
    await p.click('#start-loop');
    await p.evaluate('window.__dashboardReleaseLock(); window.__dashboardHeldLock');
    await pause(150);
    check('V110/B80: stopping a queued loop prevents its cycle from being saved after lock release', await saved(p) === raw && await p.evaluate('document.getElementById("loop-state").textContent.startsWith("Stopped") && document.getElementById("error-banner").hidden'), undefined, fatal);
  } finally {
    await p.evaluate('window.__dashboardReleaseLock(); window.__dashboardHeldLock');
    await p.close();
  }
}
async function boundedLoop() {
  const run = recentRun();
  const p = await page({ isolated: true, seed: { [KEY]: JSON.stringify(run) }, fastLoop: true });
  await route(p, 'decisions'); await p.click('#start-loop');
  await p.wait(`JSON.parse(localStorage.getItem(${JSON.stringify(KEY)})).events.length === ${run.events.length + 10} && document.getElementById('loop-state').textContent.startsWith('Stopped')`);
  const raw = await saved(p); await pause(160);
  check('V110: manually started loop stops after exactly ten retained cycles', await saved(p) === raw && JSON.parse(raw).events.slice(run.events.length).every(event => event.type === 'cycle'), { fixture: 'Only the five-second loop delay is accelerated to 40ms.' });
  await p.reload(); await route(p, 'decisions'); await pause(160);
  check('V110: reload does not restart a completed loop', await saved(p) === raw && await p.evaluate('document.getElementById("loop-state").textContent.startsWith("Stopped")'));
  await p.click('#start-loop');
  await p.wait(`JSON.parse(localStorage.getItem(${JSON.stringify(KEY)})).events.length > ${JSON.parse(raw).events.length}`);
  await p.send('Page.navigate', { url: `${origin}/` });
  await p.wait('location.pathname === "/" && document.readyState === "complete" && !document.getElementById("loop-state")');
  const afterLeaving = await saved(p); await pause(200);
  check('V110: leaving the dashboard stops subsequent simulation cycles', await saved(p) === afterLeaving);
  await p.close();
}
