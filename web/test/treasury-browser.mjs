import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { mkdtemp, readFile, readdir, writeFile } from 'node:fs/promises';
import { extname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { replayRun } from '../treasury/domain.mjs';

// Run separately from unit tests. Uses an isolated Chrome profile and local HTTP server.
const root = resolve(process.env.FALCON_TREASURY_WEB_ROOT || fileURLToPath(new URL('../dist/', import.meta.url)));
const artifactDir = await mkdtemp('/private/tmp/falcon-treasury-browser-');
const setupOnly = process.argv.includes('--setup-only');
const KEY = 'falcon.treasury.simulation.v1';
const server = createServer(async (request, response) => {
  try {
    let pathname = decodeURIComponent(new URL(request.url, 'http://localhost').pathname);
    if (pathname.endsWith('/')) pathname += 'index.html';
    const path = resolve(root, `.${pathname}`);
    if (!path.startsWith(root + sep)) throw new Error('Invalid path');
    const body = await readFile(path);
    response.writeHead(200, { 'Content-Type': ({ '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css' })[extname(path)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
    response.end(body);
  } catch { response.writeHead(404); response.end('Not found'); }
});
await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
const origin = `http://127.0.0.1:${server.address().port}`;
const chrome = spawn(process.env.FALCON_CHROME_BIN || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', [
  '--headless=new', '--disable-gpu', '--disable-background-networking', '--disable-component-update',
  '--disable-default-apps', '--disable-sync', '--disable-extensions', '--no-first-run',
  '--no-default-browser-check', '--metrics-recording-only', `--user-data-dir=${artifactDir}/profile`,
  '--remote-debugging-pipe', 'about:blank',
], { stdio: ['ignore', 'ignore', 'pipe', 'pipe', 'pipe'] });

let sequence = 0;
let buffer = '';
let stderr = '';
const pending = new Map();
const exceptions = [];
const remoteRequests = [];
const checks = [];
chrome.stderr.on('data', (data) => { stderr += data.toString(); });
chrome.on('error', failPending);
chrome.on('exit', (code, signal) => failPending(new Error(`Chrome exited ${code}/${signal}: ${stderr.slice(-500)}`)));
function failPending(error) {
  for (const item of pending.values()) { clearTimeout(item.timer); item.reject(error); }
  pending.clear();
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
        if (message.error) item.reject(new Error(JSON.stringify(message.error)));
        else item.resolve(message.result);
      }
    }
    if (message.method === 'Runtime.exceptionThrown') exceptions.push(message.params.exceptionDetails);
    if (message.method === 'Network.requestWillBeSent') {
      const url = message.params.request.url;
      if (/^https?:/.test(url) && !url.startsWith(`${origin}/`)) remoteRequests.push(url);
    }
  }
});
function call(method, params = {}, sessionId) {
  return new Promise((resolve, reject) => {
    const id = ++sequence;
    const timer = setTimeout(() => { pending.delete(id); reject(new Error(`CDP timeout: ${method}`)); }, 15000);
    pending.set(id, { resolve, reject, timer });
    chrome.stdio[3].write(`${JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) })}\0`);
  });
}
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function page() {
  const target = await call('Target.createTarget', { url: 'about:blank' });
  const { sessionId } = await call('Target.attachToTarget', { targetId: target.targetId, flatten: true });
  const send = (method, params = {}) => call(method, params, sessionId);
  await send('Page.enable'); await send('Runtime.enable'); await send('Network.enable');
  const evaluate = async (expression) => {
    const result = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    if (result.exceptionDetails) throw new Error(JSON.stringify(result.exceptionDetails));
    return result.result.value;
  };
  const wait = async (expression) => {
    for (let i = 0; i < 60; i++) { if (await evaluate(expression)) return; await pause(50); }
    throw new Error(`Page condition timed out: ${expression}`);
  };
  const click = (id) => evaluate(`document.getElementById(${JSON.stringify(id)}).click()`);
  const events = () => evaluate(`JSON.parse(localStorage.getItem(${JSON.stringify(KEY)}))?.events.length ?? 0`);
  const event = async (id) => { const count = await events(); await click(id); await wait(`JSON.parse(localStorage.getItem(${JSON.stringify(KEY)}))?.events.length === ${count + 1}`); };
  const open = async () => { await send('Page.navigate', { url: `${origin}/treasury/` }); await wait('document.readyState === "complete" && (!document.getElementById("setup-panel").hidden || !document.getElementById("workspace").hidden || !document.getElementById("error-message").hidden)'); };
  const reload = async () => {
    await evaluate('document.documentElement.dataset.awaitingReload = "true"');
    await send('Page.reload');
    await wait('document.readyState === "complete" && !document.documentElement.dataset.awaitingReload');
  };
  await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1120, deviceScaleFactor: 1, mobile: false });
  await open();
  return { target, send, evaluate, wait, click, event, events, open, reload };
}
function check(name, value, detail) {
  checks.push({ name, pass: Boolean(value), ...(detail ? { detail } : {}) });
  assert.ok(value, name);
}
async function screenshot(p, name, full = false) {
  const metrics = full ? await p.send('Page.getLayoutMetrics') : null;
  const shot = await p.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: full,
    ...(full ? { clip: { x: 0, y: 0, width: metrics.cssContentSize.width, height: metrics.cssContentSize.height, scale: 1 } } : {}),
  });
  await writeFile(`${artifactDir}/${name}.png`, Buffer.from(shot.data, 'base64'));
}

try {
  await call('Browser.setDownloadBehavior', { behavior: 'allow', downloadPath: artifactDir });
  const p = await page();
  check('V84: fresh browser shows labeled demo defaults', await p.evaluate('!document.getElementById("setup-panel").hidden && document.querySelector(".demo-note").textContent.includes("Demo defaults")'));
  await p.evaluate('document.getElementById("reserve-usdc").value = "900"');
  await p.click('create-run'); await p.wait('!document.getElementById("error-message").hidden');
  check('V85: rejected setup preserves editable input without saving a run', await p.evaluate(`localStorage.getItem(${JSON.stringify(KEY)}) === null && !document.getElementById('setup-fields').disabled && document.getElementById('reserve-usdc').value === '900'`));
  await p.evaluate('document.getElementById("reserve-usdc").value = "200"');
  await p.click('create-run');
  await p.wait('!document.getElementById("workspace").hidden || !document.getElementById("error-message").hidden');
  check('V85: setup snapshots enabled form values before disabling controls', await p.evaluate('!document.getElementById("workspace").hidden && document.getElementById("total-balance").textContent === "1000"'), await p.evaluate('document.getElementById("error-message").textContent'));
  check('V84 V85: corrected setup clears obsolete error status', await p.evaluate('document.getElementById("error-message").hidden && !document.getElementById("loop-status").textContent.includes("error")'));
  const initial = await p.evaluate(`JSON.parse(localStorage.getItem(${JSON.stringify(KEY)}))`);
  check('V78: setup saves exact reserve, cap, and undelegated remainder', initial.setup.reserveUsdc === '200' && initial.setup.investmentCapUsdc === '500' && replayRun(initial).state.balances.undelegatedUnits === '300000000');
  if (!setupOnly) {
    await p.event('run-cycle');
    check('V81: missing observation gives NO_DATA', await p.evaluate('document.getElementById("decision-status").textContent === "NO_DATA" && document.getElementById("position-balance").textContent === "0"'));
    await p.event('scenario-healthy'); await p.event('run-cycle');
    check('V78 V80: supply moves only the 500 delegated USDC', await p.evaluate('document.getElementById("position-balance").textContent === "500" && document.getElementById("idle-balance").textContent === "0" && document.getElementById("reserve-balance").textContent === "200"'));
    const supplyRecord = await p.evaluate(`JSON.parse(localStorage.getItem(${JSON.stringify(KEY)})).records.at(-1)`);
    check('V87: browser saves the original input, policy, checks, and outcome', supplyRecord.decision.policyVersion === 'treasury-rules/1' && supplyRecord.graph.nodes.find(n => n.id === 'position').data.positionUnits === '0' && supplyRecord.balances.positionUnits === '500000000' && supplyRecord.decision.checks.some(c => c.id === 'investment_cap' && c.status === 'PASS'));
    await p.click('rule-check-investment_cap');
    check('V88: selecting a rule marks supporting graph nodes with visible labels', await p.evaluate('document.getElementById("graph-node-account").dataset.evidence === "true" && document.getElementById("graph-node-account").textContent.includes("Evidence") && document.getElementById("rule-check-investment_cap").getAttribute("aria-pressed") === "true"'));
    await p.event('scenario-low');
    check('V89: recording new evidence shows current state separately', await p.evaluate('document.getElementById("graph-context").dataset.eventId === ""'));
    await p.click('rule-check-freshness');
    await p.click('graph-node-observation');
    check('V88 V89: latest-decision check opens its old evidence after a newer observation', await p.evaluate(`document.getElementById('graph-context').dataset.eventId === ${JSON.stringify(supplyRecord.eventId)} && JSON.parse(document.getElementById('node-data').textContent).observation.availableLiquidityUnits === ${JSON.stringify(supplyRecord.graph.nodes.find(n => n.id === 'observation').data.observation.availableLiquidityUnits)}`));
    const historicalFacts = await p.evaluate('document.getElementById("node-facts").textContent');
    check('V89: inspector gives source and age at the original decision', historicalFacts.includes('Synthetic input') && historicalFacts.includes('Age at decision'));
    await pause(1100);
    await p.click('graph-node-observation');
    check('V89: historical evidence age does not advance with the wall clock', await p.evaluate('document.getElementById("node-facts").textContent') === historicalFacts);
    await p.evaluate('document.getElementById("rule-check-investment_cap").focus()');
    await p.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, nativeVirtualKeyCode: 13, text: '\r' });
    await p.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, nativeVirtualKeyCode: 13 });
    check('V88 V89: keyboard selects a rule and retains a usable focus', await p.evaluate('document.getElementById("rule-check-investment_cap").getAttribute("aria-pressed") === "true" && document.activeElement.id === "rule-check-investment_cap"'));
    await p.event('run-cycle');
    check('V81: illiquid exit is blocked and retains position', await p.evaluate('document.getElementById("decision-status").textContent === "BLOCKED" && document.getElementById("position-balance").textContent === "500"'));
    await p.click('inspect-decision'); await p.click('graph-node-position');
    check('V79 V84: graph inspection shows the selected decision input', await p.evaluate('document.getElementById("graph-context").textContent.includes("Input graph") && JSON.parse(document.getElementById("node-data").textContent).positionUnits === "500000000"'));
    const ax = await p.send('Accessibility.getFullAXTree');
    check('V86: graph relationships are available to assistive technology', ax.nodes.some((n) => n.name?.value?.includes('Owner mandate → authorizes → Investment account')));
    await p.evaluate('document.getElementById("graph-node-reserve").focus()');
    await p.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, nativeVirtualKeyCode: 13, text: '\r' });
    await p.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, nativeVirtualKeyCode: 13 });
    check('V84: keyboard opens graph node details', await p.evaluate('document.getElementById("node-title").textContent === "Spending reserve"'), await p.evaluate('({ active: document.activeElement.id, title: document.getElementById("node-title").textContent })'));
    await p.click('rule-check-redemption_liquidity'); await p.click('graph-node-observation');
    check('V88: blocked rule remains visibly linked to its decision and outcome', await p.evaluate('document.getElementById("rule-check-redemption_liquidity").dataset.status === "BLOCKED" && !document.getElementById("graph-result").hidden && document.getElementById("graph-outcome-status").textContent.includes("BLOCKED")'));
    await p.evaluate('scrollTo(0,0)'); await screenshot(p, 'decision-graph', true);
    await p.click('show-current');
    await p.evaluate('scrollTo(0,0)'); await screenshot(p, 'desktop', true);
    await p.event('scenario-stale'); await p.event('run-cycle');
    check('V81: stale evidence gives NO_DATA without movement', await p.evaluate('document.getElementById("decision-status").textContent === "NO_DATA" && document.getElementById("position-balance").textContent === "500"'));
    await p.event('scenario-unavailable'); await p.event('run-cycle');
    check('V81: unavailable evidence gives NO_DATA', await p.evaluate('document.getElementById("decision-status").textContent === "NO_DATA"'));
    const customBefore = await p.events();
    await p.evaluate('document.getElementById("custom-liquidity").value = "-1"; document.getElementById("custom-evidence-form").dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }))');
    await p.wait('!document.getElementById("error-message").hidden');
    check('V78 V85: invalid custom liquidity preserves history and editable fields', await p.events() === customBefore && await p.evaluate('!document.getElementById("custom-evidence-fields").disabled && document.getElementById("custom-liquidity").value === "-1"'));
    await p.evaluate('document.getElementById("custom-liquidity").value = "750"; document.getElementById("custom-evidence-age").value = "0"');
    await p.event('record-custom-evidence'); await p.event('run-cycle');
    check('V79 V81 V88: custom graph evidence causes a liquid redemption below the floor', await p.evaluate('document.getElementById("decision-status").textContent === "READY" && document.getElementById("position-balance").textContent === "0" && document.getElementById("idle-balance").textContent === "500" && document.getElementById("reserve-balance").textContent === "200"'));
    await p.event('scenario-healthy');
    const beforeLoop = await p.events();
    await p.click('start-agent');
    await p.wait(`JSON.parse(localStorage.getItem(${JSON.stringify(KEY)})).events.length === ${beforeLoop + 1}`);
    check('V84: explicit start runs the first bounded cycle', await p.evaluate('document.getElementById("loop-status").dataset.running === "true"'));
    await p.click('stop-agent');
    const stoppedCount = await p.events();
    await pause(5200);
    check('V84: stop prevents the next scheduled cycle', await p.events() === stoppedCount);
    await p.event('owner-redeem');
    check('V80 V81: owner redemption returns delegated idle only', await p.evaluate('document.getElementById("position-balance").textContent === "0" && document.getElementById("idle-balance").textContent === "500" && document.getElementById("reserve-balance").textContent === "200"'));
    const saved = await p.evaluate(`localStorage.getItem(${JSON.stringify(KEY)})`);
    await p.reload(); await p.wait('document.getElementById("workspace")?.hidden === false');
    check('V83 V84: reload preserves the exact journal and stays stopped', await p.evaluate(`localStorage.getItem(${JSON.stringify(KEY)}) === ${JSON.stringify(saved)} && document.getElementById('loop-status').dataset.running === 'false'`));
    await p.click('export-run');
    let downloaded;
    for (let i = 0; i < 60; i++) { downloaded = (await readdir(artifactDir)).find((name) => name.endsWith('.json')); if (downloaded) break; await pause(50); }
    const exported = JSON.parse(await readFile(`${artifactDir}/${downloaded}`, 'utf8'));
    check('V83: downloaded JSON replays the saved run', JSON.stringify(replayRun(exported)) === JSON.stringify(replayRun(JSON.parse(saved))));
    const other = await page();
    await p.event('scenario-healthy'); await p.event('run-cycle');
    await other.wait('document.getElementById("position-balance").textContent === "500"');
    check('V82 V84: another tab receives saved changes with its loop stopped', await other.evaluate('document.getElementById("loop-status").dataset.running === "false"'));
    await call('Target.closeTarget', { targetId: other.target.targetId });
    await p.click('revoke-mandate');
    check('V80: revocation requires a visible confirmation', await p.evaluate('document.getElementById("revoke-dialog").open'));
    await p.click('cancel-revoke');
    check('V80: cancelling retains active authority', !(await p.evaluate(`JSON.parse(localStorage.getItem(${JSON.stringify(KEY)})).events.some(e => e.type === 'revoke')`)));
    await p.click('revoke-mandate'); await p.event('confirm-revoke');
    check('V80 V84: revocation disables agent movement', await p.evaluate('document.getElementById("run-cycle").disabled && document.getElementById("start-agent").disabled && document.getElementById("mandate-status").textContent === "Permanently revoked"'));
    await p.event('owner-redeem');
    check('V80: explicit owner exit works after revocation', await p.evaluate('document.getElementById("position-balance").textContent === "0" && document.getElementById("idle-balance").textContent === "500"'));
    for (const width of [390, 320]) {
      await p.send('Emulation.setDeviceMetricsOverride', { width, height: 844, deviceScaleFactor: 1, mobile: true });
      check(`V84: ${width}px page has no horizontal overflow`, await p.evaluate('document.documentElement.scrollWidth <= innerWidth'));
    }
    await p.evaluate('scrollTo(0,0)'); await screenshot(p, 'mobile');
    await p.click('inspect-decision');
    await p.evaluate('document.querySelector(".decision-layout").scrollIntoView({ block: "start" })');
    await screenshot(p, 'mobile-graph');
    await p.click('graph-node-observation');
    await p.evaluate('document.getElementById("node-inspector").scrollIntoView({ block: "start" })');
    await screenshot(p, 'mobile-inspector');
    const copy = await p.evaluate('document.body.innerText');
    await writeFile(`${artifactDir}/ui-copy.txt`, copy);
    const legacy = JSON.parse(saved);
    legacy.schemaVersion = 1;
    delete legacy.policyVersion; delete legacy.records; delete legacy.legacyEventCount;
    const legacyText = JSON.stringify(legacy);
    await p.evaluate(`localStorage.setItem(${JSON.stringify(KEY)}, ${JSON.stringify(legacyText)})`);
    await p.reload(); await p.wait('document.getElementById("workspace")?.hidden === false');
    check('V87: legacy load labels reconstruction without changing stored commands', await p.evaluate(`localStorage.getItem(${JSON.stringify(KEY)}) === ${JSON.stringify(legacyText)} && !document.getElementById('legacy-history-note').hidden && document.querySelectorAll('.legacy-label').length === ${legacy.events.length}`));
    await p.click('export-run');
    check('V90: legacy export describes commands without claiming saved snapshots', await p.evaluate(`document.getElementById('action-message').textContent.includes('Legacy commands') && localStorage.getItem(${JSON.stringify(KEY)}) === ${JSON.stringify(legacyText)}`));
    await p.event('run-cycle');
    check('V87: next legacy command saves versioned history and retains its provenance', await p.evaluate(`JSON.parse(localStorage.getItem(${JSON.stringify(KEY)})).schemaVersion === 2 && JSON.parse(localStorage.getItem(${JSON.stringify(KEY)})).legacyEventCount === ${legacy.events.length} && document.getElementById('graph-record-label').textContent.includes('Saved input snapshot')`));
    const versioned = await p.evaluate(`localStorage.getItem(${JSON.stringify(KEY)})`);
    for (const mutate of [run => { run.policyVersion = 'treasury-rules/999'; }, run => { run.records[0].outcome.message = 'Altered record'; }]) {
      const changed = JSON.parse(versioned); mutate(changed); const raw = JSON.stringify(changed);
      await p.evaluate(`localStorage.setItem(${JSON.stringify(KEY)}, ${JSON.stringify(raw)})`);
      await p.reload(); await p.wait('document.getElementById("error-message")?.hidden === false');
      check('V87: unsupported policy or altered snapshot fails without replacing history', await p.evaluate(`localStorage.getItem(${JSON.stringify(KEY)}) === ${JSON.stringify(raw)} && document.getElementById('setup-panel').hidden && document.getElementById('error-message').textContent.includes('failed validation')`));
    }
    // Corruption is confined to this disposable Chrome profile.
    await p.evaluate(`localStorage.setItem(${JSON.stringify(KEY)}, '{broken')`);
    await p.reload(); await p.wait('document.getElementById("error-message")?.hidden === false');
    check('V82: corrupt history remains intact and cannot be replaced by setup', await p.evaluate(`localStorage.getItem(${JSON.stringify(KEY)}) === '{broken' && document.getElementById('setup-panel').hidden && document.getElementById('error-message').textContent.includes('not valid JSON')`));
    check('V77: no remote page requests', remoteRequests.length === 0, remoteRequests);
    check('V84: no browser runtime exceptions', exceptions.length === 0, exceptions);
  }
} catch (error) {
  if (checks.at(-1)?.pass !== false) checks.push({ name: error.message, pass: false });
  process.exitCode = 1;
} finally {
  const report = { passed: checks.filter((c) => c.pass).length, total: checks.length, checks, exceptions, remoteRequests, artifactDir, root };
  await writeFile(`${artifactDir}/report.json`, JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
  try { await call('Browser.close'); } catch {}
  chrome.kill();
  server.close();
}
