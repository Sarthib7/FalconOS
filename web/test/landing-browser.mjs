import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createServer } from 'node:http';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { extname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { createLocalWaitlist } from '../waitlist-local.mjs';
import { buckets, inspectScenario, scenarios, traceJson, usdc } from '../landing/model.mjs';

// Serves an existing build. Creates only fresh disposable SQLite databases.
// Every delivery-provider response is injected. No external email is sent.
const root = resolve(process.env.FALCON_LANDING_WEB_ROOT || fileURLToPath(new URL('../dist/', import.meta.url)));
const sourcePath = process.env.FALCON_LANDING_SOURCE || '/Users/sarthiborkar/Library/Application Support/Open Design/namespaces/release-stable/data/projects/886c2e41-d9d4-45e0-a67d-148f20cfca61/falconos-landing.html';
const artifactDir = await mkdtemp('/private/tmp/falcon-landing-browser-');
const checks = [], exceptions = [], remoteRequests = [], apiRequests = [], providerCalls = [], downloads = [];
const pending = new Map();
const adapters = new Map();
let server, chrome, origin, sourceHtml;
let activePage;
let activeEmailMode = 'capture';
let sequence = 0, buffer = '', stderr = '';
const pause = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));

function check(name, value, detail) {
  checks.push({ name, pass: Boolean(value), ...(detail === undefined ? {} : { detail }) });
  assert.ok(value, name);
}
function readRows(mode, sql) {
  const db = new DatabaseSync(`${artifactDir}/${mode}.sqlite`, { readOnly: true });
  try { return db.prepare(sql).all().map(row => ({ ...row })); } finally { db.close(); }
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
        if (message.error) item.reject(new Error(JSON.stringify(message.error)));
        else item.resolve(message.result);
      }
    }
    if (message.method === 'Runtime.exceptionThrown') exceptions.push(message.params.exceptionDetails);
    if (message.method === 'Browser.downloadWillBegin') downloads.push({ ...message.params, state: 'inProgress' });
    if (message.method === 'Browser.downloadProgress') {
      const download = downloads.find(item => item.guid === message.params.guid);
      if (download) Object.assign(download, message.params);
    }
    if (message.method === 'Network.requestWillBeSent') {
      const request = message.params.request;
      const url = new URL(request.url);
      if (url.origin === origin && url.pathname === '/api/waitlist') apiRequests.push({ method: request.method, mode: activeEmailMode });
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
async function page({ source = false, reduced = false, width = 1440, height = 1080 } = {}) {
  const target = await call('Target.createTarget', { url: 'about:blank' });
  const { sessionId } = await call('Target.attachToTarget', { targetId: target.targetId, flatten: true });
  const send = (method, params = {}) => call(method, params, sessionId);
  await send('Page.enable'); await send('Runtime.enable'); await send('Network.enable');
  if (!source) await send('Page.addScriptToEvaluateOnNewDocument', { source: `window.__landingDraws = 0; const draw = WebGLRenderingContext.prototype.drawArrays; WebGLRenderingContext.prototype.drawArrays = function(...args) { window.__landingDraws += 1; return draw.apply(this,args); };` });
  await send('Fetch.enable', { patterns: [{ urlPattern: '*', requestStage: 'Request' }] });
  await send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: width === 320 });
  await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: reduced ? 'reduce' : 'no-preference' }] });
  if (source) await send('Emulation.setScriptExecutionDisabled', { value: true });
  const evaluate = async expression => {
    const result = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true, userGesture: true });
    if (result.exceptionDetails) throw new Error(JSON.stringify(result.exceptionDetails));
    return result.result.value;
  };
  const wait = async (expression, attempts = 400) => {
    for (let n = 0; n < attempts; n++) { if (await evaluate(expression)) return; await pause(50); }
    throw new Error(`Page condition timed out: ${expression}`);
  };
  const click = selector => evaluate(`document.querySelector(${JSON.stringify(selector)}).click()`);
  await send('Page.navigate', { url: `${origin}${source ? '/__opendesign__' : '/'}` });
  await wait(source ? 'document.readyState === "complete"' : 'document.readyState === "complete" && Boolean(document.getElementById("tour-toggle"))');
  await evaluate('document.fonts.ready.then(()=>true)');
  return { send, evaluate, wait, click };
}
async function screenshot(p, name, full = false) {
  const metrics = full ? await p.send('Page.getLayoutMetrics') : null;
  const result = await p.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: full,
    ...(full ? { clip: { x: 0, y: 0, width: metrics.cssContentSize.width, height: metrics.cssContentSize.height, scale: 1 } } : {}) });
  await writeFile(`${artifactDir}/${name}.png`, Buffer.from(result.data, 'base64'));
}
async function inputEmail(p, email) {
  await p.evaluate(`(() => { const input = document.getElementById('waitlist-email'); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,${JSON.stringify(email)}); input.dispatchEvent(new Event('input',{bubbles:true})); })()`);
}
async function signup(p, email) {
  if (await p.evaluate('Boolean(document.getElementById("waitlist-another"))')) await p.click('#waitlist-another');
  await p.wait('Boolean(document.getElementById("waitlist-email"))');
  await inputEmail(p, email);
  await p.click('#waitlist-submit');
  await p.wait('Boolean(document.getElementById("waitlist-success")) || (document.getElementById("waitlist-submit")?.disabled === false && document.getElementById("waitlist-status").getAttribute("role") === "alert")');
  return p.evaluate('({text:document.getElementById("waitlist-status").textContent,error:document.getElementById("waitlist-status").getAttribute("role")==="alert",value:document.getElementById("waitlist-email")?.value ?? document.querySelector("#waitlist-success span").textContent})');
}
async function closeServer() {
  if (!server?.listening) return;
  server.closeAllConnections(); await new Promise(resolve => server.close(resolve));
}

try {
  const builtHtml = await readFile(`${root}/index.html`, 'utf8');
  sourceHtml = await readFile(sourcePath, 'utf8');
  const sourceScenarios = JSON.parse(sourceHtml.match(/<script id="treasury-scenarios" type="application\/json">([\s\S]*?)<\/script>/)?.[1] ?? 'null');
  check('V104: React scenarios exactly preserve the active OpenDesign source fixtures', JSON.stringify(sourceScenarios) === JSON.stringify(scenarios));
  check('V104: served landing is the compiled React entry', builtHtml.includes('<div id="root"></div>') && /type="module"/.test(builtHtml) && !builtHtml.includes('/landing/main.jsx'));
  const sourceParseError = /const presentation\s*=\s*const presentation\s*=/.test(sourceHtml);
  check('V104: static source comparison records the known script parse error', sourceParseError);
  for (const mode of ['capture', 'accepted', 'failed', 'unavailable']) {
    const options = { databasePath: `${artifactDir}/${mode}.sqlite`, ipSalt: `fixture-only-${mode}`,
      fetchImpl: async (url, request) => {
        assert.equal(url, 'https://api.resend.com/emails'); assert.equal(request.redirect, 'error');
        assert.ok(['accepted', 'failed'].includes(mode), 'Unconfigured capture must never call a provider');
        const [job] = readRows(mode, 'SELECT * FROM waitlist_email_outbox');
        assert.equal(job.status, 'inflight');
        assert.equal(readRows(mode, 'SELECT email FROM waitlist_entries').length, 1);
        assert.equal(request.headers['idempotency-key'], `waitlist/${job.id}`);
        providerCalls.push({ mode, idempotencyKey: request.headers['idempotency-key'] });
        return mode === 'accepted' ? new Response(JSON.stringify({ id: '49a3999c-0ce1-4ea6-ab68-afcd6dc2e794' }), { status: 200 })
          : new Response(JSON.stringify({ message: 'Controlled provider failure' }), { status: 503 });
      } };
    if (['accepted', 'failed'].includes(mode)) options.emailEnv = { RESEND_API_KEY: 'fixture-key-not-a-credential', WAITLIST_FROM_EMAIL: 'waitlist@example.com' };
    adapters.set(mode, createLocalWaitlist(options));
  }
  adapters.get('unavailable').close();
  server = createServer((request, response) => {
    void adapters.get(activeEmailMode).middleware(request, response, async () => {
      try {
        let pathname = decodeURIComponent(new URL(request.url, 'http://local.invalid').pathname);
        if (pathname === '/__opendesign__') {
          response.writeHead(200, { 'content-type': 'text/html', 'cache-control': 'no-store' }); response.end(sourceHtml); return;
        }
        if (pathname.endsWith('/')) pathname += 'index.html';
        const filename = resolve(root, `.${pathname}`);
        if (!filename.startsWith(root + sep)) throw Error('Invalid path');
        const body = await readFile(filename);
        response.writeHead(200, { 'content-type': ({ '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.ttf': 'font/ttf', '.woff2': 'font/woff2', '.txt': 'text/plain', '.json': 'application/json' })[extname(filename)] || 'application/octet-stream', 'cache-control': 'no-store' });
        response.end(body);
      } catch { response.writeHead(404); response.end('Not found'); }
    }).catch(error => { if (!response.headersSent) response.writeHead(500); response.end('Test server failed'); failPending(error); });
  });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  origin = `http://127.0.0.1:${server.address().port}`;
  const chromePath = process.env.CHROME_BIN || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
  chrome = spawn(chromePath, ['--headless=new', '--no-first-run', '--no-default-browser-check', '--disable-background-networking', '--disable-component-update', '--disable-sync', '--metrics-recording-only', `--user-data-dir=${artifactDir}/chrome`, '--remote-debugging-pipe', 'about:blank'], { stdio: ['ignore', 'ignore', 'pipe', 'pipe', 'pipe'] });
  chrome.stderr.on('data', data => { stderr = (stderr + data.toString()).slice(-2000); });
  chrome.on('error', failPending); chrome.on('exit', (code, signal) => failPending(new Error(`Chrome exited ${code}/${signal}: ${stderr}`)));
  chrome.stdio[4].on('data', receive);
  await call('Browser.setDownloadBehavior', { behavior: 'allow', downloadPath: artifactDir, eventsEnabled: true });
  await call('Browser.grantPermissions', { origin, permissions: ['clipboardReadWrite', 'clipboardSanitizedWrite'] });

  const p = await page();
  activePage = p;
  await p.evaluate(`(() => { window.__landingDialogEvents = []; const dialog = document.getElementById('json-dialog'); for (const name of ['click','close','cancel']) document.addEventListener(name, event => { if (event.target.closest?.('#json-dialog') || ['view-json','close-json'].includes(event.target.id)) window.__landingDialogEvents.push({event:name,target:event.target.id,open:dialog.open,time:performance.now()}); }, true); })()`);
  check('V104: desktop React landing renders the source heading and local fonts', await p.evaluate('document.querySelector("h1").textContent.includes("Your rules") && getComputedStyle(document.body).fontFamily.includes("Geist") && document.fonts.check("16px Geist")'));
  await screenshot(p, 'landing-desktop-hero');
  await p.evaluate('document.getElementById("explorer").scrollIntoView({block:"start"})');
  await p.click('[data-scenario="supply"]');
  for (const scenario of scenarios) {
    await p.click(`[data-scenario="${scenario.id}"]`);
    await p.wait(`document.querySelector('[data-scenario="${scenario.id}"]').getAttribute('aria-pressed') === 'true'`);
    const displayed = await p.evaluate(`({ title:document.getElementById('scenario-title').textContent, decision:document.querySelector('#desk-decision .figure-current').textContent, moved:document.querySelector('#desk-moved .figure-current').textContent, reason:document.getElementById('inspector-copy').textContent, balances:${JSON.stringify(buckets.map(([key]) => key))}.flatMap(key=>['before','after'].map(phase=>document.querySelector('#balance-'+key+'-'+phase+' .figure-current').textContent)), playing:document.getElementById('tour-toggle').getAttribute('aria-pressed') })`);
    const balances = buckets.flatMap(([key]) => [usdc(scenario.before[key]), usdc(scenario.entry.balances[key])]);
    check(`V104: ${scenario.id} changes exact balances, action, movement and reason`, displayed.title === scenario.label && displayed.decision === scenario.entry.decision.action && displayed.moved === usdc(scenario.entry.outcome.amountUnits) && displayed.reason === scenario.entry.decision.reasons.join(' ') && JSON.stringify(displayed.balances) === JSON.stringify(balances) && displayed.playing === 'false', displayed);
    await p.click('#view-json');
    await p.wait('document.getElementById("json-dialog").open');
    if (scenario.id === 'supply') {
      await p.evaluate('document.getElementById("json-dialog").dispatchEvent(new Event("close")); new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))');
      check('V104/B73: a delayed close event cannot dismiss the current JSON view', await p.evaluate('document.getElementById("json-dialog").open'));
    }
    check(`V104: ${scenario.id} JSON preserves the complete synthetic snapshot`, await p.evaluate('document.getElementById("json-text").value') === traceJson(scenario));
    await p.click('#close-json');
    await p.wait('!document.getElementById("json-dialog").open');
  }
  const last = scenarios.at(-1);
  for (const id of ['mandate', 'reserve', 'undelegated', 'account', 'position', 'observation', 'decision', 'outcome']) {
    await p.click(`[data-node="${id}"]`);
    const detail = inspectScenario(last, id);
    check(`V104: graph node ${id} opens its source-backed inspector`, await p.evaluate(`document.querySelector('[data-node="${id}"]').getAttribute('aria-pressed') === 'true' && document.getElementById('inspector-title').textContent === ${JSON.stringify(detail.title)} && document.getElementById('inspector-copy').textContent === ${JSON.stringify(detail.copy)}`));
  }
  await p.evaluate('document.getElementById("rules-disclosure").open = true');
  for (const rule of last.entry.decision.checks) {
    await p.click(`[data-check="${rule.id}"]`);
    const inspected = await p.evaluate('({title:document.getElementById("inspector-title").textContent,copy:document.getElementById("inspector-copy").textContent,evidence:[...document.querySelectorAll("[data-node][data-evidence=true]")].map(node=>node.dataset.node).sort()})');
    check(`V104: rule ${rule.id} retains its result and exact graph evidence`, inspected.title === rule.label && inspected.copy === rule.detail && JSON.stringify(inspected.evidence) === JSON.stringify([...rule.evidenceNodeIds].sort()), inspected);
  }
  await screenshot(p, 'landing-desktop-stale-inspector', true);
  await p.click('#view-json'); await p.wait('document.getElementById("json-dialog").open');
  await p.click('#copy-json');
  await p.wait('document.getElementById("copy-status").textContent.length > 0');
  const copyState = await p.evaluate('({status:document.getElementById("copy-status").textContent,start:document.getElementById("json-text").selectionStart,end:document.getElementById("json-text").selectionEnd})');
  const clipboard = copyState.status === 'Copied.' ? await p.evaluate('navigator.clipboard.readText()') : null;
  check('V104: JSON copy writes exact bytes or selects the full fallback text', copyState.status === 'Copied.' ? clipboard === traceJson(last) : copyState.status.startsWith('Text selected.') && copyState.start === 0 && copyState.end === traceJson(last).length, copyState);
  await p.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
  await p.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
  await p.wait('!document.getElementById("json-dialog").open');
  check('V104: closing JSON restores focus to its trigger', await p.evaluate('document.activeElement.id === "view-json"'));
  await p.click('#export-json');
  for (let attempt = 0; attempt < 100 && !downloads.some(item => item.state === 'completed'); attempt++) await pause(50);
  const downloaded = downloads.find(item => item.state === 'completed');
  check('V104: JSON export downloads the complete selected trace', downloaded?.suggestedFilename === `falcon-${last.id}-synthetic-trace.json` && await readFile(`${artifactDir}/${downloaded.suggestedFilename}`, 'utf8') === traceJson(last));

  await p.evaluate('document.getElementById("explorer").scrollIntoView({block:"start"})');
  await p.click('#tour-toggle');
  await p.wait('document.getElementById("tour-toggle").getAttribute("aria-pressed") === "true"');
  await p.wait('document.querySelector("[data-scenario=supply]").getAttribute("aria-pressed") === "true"', 200);
  check('V104: visible tour advances to the next scenario', await p.evaluate('document.getElementById("tour-toggle").getAttribute("aria-pressed") === "true"'));
  await p.click('[data-node="reserve"]');
  await pause(6800);
  check('V104: manual graph inspection stops the tour without later advancement', await p.evaluate('document.getElementById("tour-toggle").getAttribute("aria-pressed") === "false" && document.querySelector("[data-scenario=supply]").getAttribute("aria-pressed") === "true" && document.querySelector("[data-node=reserve]").getAttribute("aria-pressed") === "true"'));
  await p.click('#tour-toggle'); await p.click('#tour-toggle');
  check('V104: tour pause button clears playing state', await p.evaluate('document.getElementById("tour-toggle").getAttribute("aria-pressed") === "false"'));
  await p.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] });
  await p.wait('document.getElementById("tour-toggle").disabled');
  await pause(300);
  const reducedDraws = await p.evaluate('window.__landingDraws');
  await pause(300);
  check('V104: reduced motion pauses canvas and disables automatic tour', await p.evaluate('document.getElementById("tour-toggle").getAttribute("aria-pressed") === "false" && document.getElementById("tour-toggle").textContent === "Tour paused" && matchMedia("(prefers-reduced-motion: reduce)").matches') && await p.evaluate('window.__landingDraws') === reducedDraws, await p.evaluate('({renderer:document.body.dataset.metalRenderer,drawCount:window.__landingDraws})'));
  await p.send('Emulation.setDeviceMetricsOverride', { width: 320, height: 844, deviceScaleFactor: 1, mobile: true });
  await p.evaluate('scrollTo(0,0)');
  check('V104: mobile landing fits a 320px viewport', await p.evaluate('document.documentElement.scrollWidth <= innerWidth'));
  await screenshot(p, 'landing-mobile-hero');
  await p.click('#menu-toggle');
  check('V104: mobile menu opens with accessible expanded state', await p.evaluate('document.getElementById("menu-toggle").getAttribute("aria-expanded") === "true" && document.getElementById("site-nav").classList.contains("is-open")'));
  await p.click('#site-nav a[href="#waitlist"]');
  check('V104: mobile navigation closes and focuses its destination', await p.evaluate('document.getElementById("menu-toggle").getAttribute("aria-expanded") === "false" && document.activeElement.id === "waitlist-title" && location.hash === "#waitlist"'));
  await p.click('#menu-toggle');
  await p.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
  await p.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
  check('V104: Escape closes mobile navigation and restores toggle focus', await p.evaluate('document.getElementById("menu-toggle").getAttribute("aria-expanded") === "false" && document.activeElement.id === "menu-toggle"'));
  await p.evaluate('document.getElementById("explorer").scrollIntoView({block:"start"})');
  await screenshot(p, 'landing-mobile-explorer', true);
  const requestCount = apiRequests.length;
  await inputEmail(p, 'invalid-address'); await p.click('#waitlist-submit');
  check('V105: invalid email remains visible without an API request', apiRequests.length === requestCount && await p.evaluate('!document.getElementById("waitlist-email").validity.valid && document.getElementById("waitlist-email").value === "invalid-address"') && readRows('capture', 'SELECT email FROM waitlist_entries').length === 0);
  const registered = await signup(p, 'Browser.Capture@Example.com');
  const row = readRows('capture', 'SELECT email, source, ip_hash FROM waitlist_entries')[0];
  check('V105/V106: unconfigured delivery reports only durable registration', registered.text === 'Your address is registered.' && !registered.error && row.email === 'browser.capture@example.com' && row.source === 'landing' && /^[a-f0-9]{64}$/.test(row.ip_hash) && readRows('capture', 'SELECT id FROM waitlist_email_outbox').length === 0 && providerCalls.length === 0, registered);
  const beforeDuplicate = apiRequests.length;
  const duplicate = await signup(p, 'browser.capture@example.com');
  check('V105: repeat signup reports the retained registration without another request', duplicate.text === 'Your address is already registered.' && apiRequests.length === beforeDuplicate && readRows('capture', 'SELECT email FROM waitlist_entries').length === 1);
  for (let n = 0; n < 4; n++) await signup(p, `rate-${n}@example.com`);
  const limited = await signup(p, 'rate-retained@example.com');
  check('V105: rate limit stays visible and preserves email for retry', limited.error && limited.value === 'rate-retained@example.com' && /too_many_requests|rate/i.test(limited.text) && readRows('capture', 'SELECT email FROM waitlist_entries').length === 5, limited);
  activeEmailMode = 'accepted';
  const accepted = await signup(p, 'accepted@example.com');
  const acceptedJob = readRows('accepted', 'SELECT status, provider_email_id FROM waitlist_email_outbox')[0];
  check('V106: provider acceptance claim follows retained outbox evidence', accepted.text === 'Your address is registered. Confirmation email accepted for delivery.' && acceptedJob.status === 'accepted' && acceptedJob.provider_email_id === '49a3999c-0ce1-4ea6-ab68-afcd6dc2e794', accepted);
  await signup(p, 'accepted@example.com');
  check('V106: repeated signup cannot duplicate an accepted provider attempt', providerCalls.filter(item => item.mode === 'accepted').length === 1);
  activeEmailMode = 'failed';
  const failed = await signup(p, 'failed@example.com');
  check('V106: provider failure preserves registration without a delivery claim', failed.text === 'Your address is registered. Confirmation email is not confirmed.' && failed.value === 'failed@example.com' && readRows('failed', 'SELECT email FROM waitlist_entries').length === 1 && readRows('failed', 'SELECT provider_email_id FROM waitlist_email_outbox')[0].provider_email_id === null, failed);
  activeEmailMode = 'unavailable';
  const unavailable = await signup(p, 'retry-retained@example.com');
  check('V105: backend storage failure remains visible and preserves retry input', unavailable.error && unavailable.text === 'waitlist_unavailable' && unavailable.value === 'retry-retained@example.com' && readRows('unavailable', 'SELECT email FROM waitlist_entries').length === 0, unavailable);
  await p.evaluate('document.getElementById("waitlist").scrollIntoView({block:"start"})');
  await screenshot(p, 'landing-mobile-waitlist-error');
  const sourceDesktop = await page({ source: true, reduced: true });
  await screenshot(sourceDesktop, 'opendesign-desktop-static-scripts-disabled');
  const sourceMobile = await page({ source: true, reduced: true, width: 320, height: 844 });
  await screenshot(sourceMobile, 'opendesign-mobile-static-scripts-disabled');
  check('V104/V106: browser makes no external HTTP requests', remoteRequests.length === 0, remoteRequests);
  check('V104: React browser has no uncaught runtime exceptions', exceptions.length === 0, exceptions);
  await writeFile(`${artifactDir}/ui-copy.txt`, await p.evaluate('document.body.innerText'));
} catch (error) {
  if (activePage) {
    try { await writeFile(`${artifactDir}/failure-state.json`, JSON.stringify(await activePage.evaluate('({dialogOpen:document.getElementById("json-dialog").open,focus:document.activeElement.id,events:window.__landingDialogEvents})'), null, 2)); } catch {}
  }
  if (checks.at(-1)?.pass !== false) checks.push({ name: error instanceof Error ? error.message : String(error), pass: false });
  process.exitCode = 1;
} finally {
  if (chrome) { try { await call('Browser.close'); } catch {} chrome.kill(); }
  await closeServer(); for (const adapter of adapters.values()) adapter.close();
  const report = { passed: checks.filter(item => item.pass).length, total: checks.length, checks, exceptions, remoteRequests, apiRequests, providerCalls, downloads, artifactDir, root,
    source: { path: sourcePath, sha256: sourceHtml ? createHash('sha256').update(sourceHtml).digest('hex') : null, comparison: 'Static screenshots with source scripts disabled. Source has a known duplicate const presentation parse error; no source interaction parity is claimed.' },
    limitations: 'Fresh disposable SQLite and injected provider responses. No production bindings, real email delivery, or inbox receipt tested.' };
  await writeFile(`${artifactDir}/report.json`, JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
}
