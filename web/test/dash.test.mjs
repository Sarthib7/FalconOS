import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

// Run the /dash inline module against a stub DOM with crafted payloads.
// No network: every fetch is served by the per-test route table.
const html = await readFile(new URL('../dash/index.html', import.meta.url), 'utf8');
const script = html.match(/<script>\n([\s\S]*?)\n  <\/script>/)[1];
const SNAP = await readFile(new URL('../public/dash-snapshot.json', import.meta.url), 'utf8');

function makeDoc() {
  const els = {};
  const mk = (id) => (els[id] ??= {
    id,
    innerHTML: '',
    textContent: '',
    attrs: {},
    dataset: {},
    _outer: '',
    _listeners: {},
    setAttribute(k, v) {
      this.attrs[k] = String(v);
      if (k.startsWith('data-')) this.dataset[k.slice(5)] = String(v);
    },
    getAttribute(k) { return this.attrs[k]; },
    set outerHTML(v) { this._outer = v; },
    get outerHTML() { return this._outer; },
    querySelector() { return mk(`${id}::c`); },
    addEventListener(type, fn) { this._listeners[type] = fn; },
    click() { if (this._listeners.click) this._listeners.click(); },
  });
  const mandates = ['liquidity', 'payments', 'markets'].map((m) => {
    const el = mk(`btn-${m}`);
    el.dataset.mandate = m;
    return el;
  });
  const tfs = ['1D', '7D', '30D'].map((t) => {
    const el = mk(`tf-${t}`);
    el.dataset.tf = t;
    return el;
  });
  return {
    getElementById: mk,
    querySelectorAll(sel) {
      if (sel.includes('data-mandate')) return mandates;
      if (sel.includes('data-tf')) return tfs;
      return [];
    },
    hidden: false,
    _els: els,
  };
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const resp = (body) => new Response(body, { status: 200 });
const nowSec = () => Math.floor(Date.now() / 1000);

function priceBody(over = {}) {
  const base = (usd) => ({ usd, usd_24h_vol: 5e8, usd_24h_change: 1.2, last_updated_at: nowSec() - 30 });
  const body = {
    'usd-coin': base(1.0),
    'solana': base(100),
    'jupiter-exchange-solana': base(0.2),
  };
  for (const [k, v] of Object.entries(over)) body[k] = { ...body[k], ...v };
  return JSON.stringify(body);
}

function ohlcBody(mutate) {
  const rows = [];
  const start = Date.now() - 40 * 1800e3;
  for (let i = 0; i < 40; i++) rows.push([start + i * 1800e3, 100, 101, 99, 100]);
  if (mutate) mutate(rows);
  return JSON.stringify(rows);
}

function runDash(route) {
  const doc = makeDoc();
  const fetchImpl = (url, opts) => {
    const s = String(url);
    if (s.includes('simple/price')) return route.price(s, opts);
    if (s.includes('/ohlc')) return route.ohlc(s, opts);
    if (s.includes('dash-snapshot')) return route.snap ? route.snap(s, opts) : Promise.reject(new Error('no snapshot'));
    return Promise.reject(new Error(`unrouted ${s}`));
  };
  new Function('document', 'fetch', 'setInterval', 'window', script)(doc, fetchImpl, () => 0, {});
  return doc;
}

const freshState = (doc) => doc._els['dash-fresh']?.attrs['data-state'];
const priceRead = (doc) => doc._els['dt-price-read']?.innerHTML ?? '';

test('valid payloads render the live state', async () => {
  const doc = runDash({
    price: () => Promise.resolve(resp(priceBody())),
    ohlc: () => Promise.resolve(resp(ohlcBody())),
  });
  await sleep(120);
  assert.equal(freshState(doc), 'live');
  assert.match(priceRead(doc), /1\.0000/);
  assert.match(priceRead(doc), /live/);
});

test('null provider price falls back to the snapshot, never renders 0', async () => {
  const doc = runDash({
    price: () => Promise.resolve(resp(priceBody({ 'usd-coin': { usd: null } }))),
    ohlc: () => Promise.resolve(resp(ohlcBody())),
    snap: () => Promise.resolve(resp(SNAP)),
  });
  await sleep(120);
  assert.equal(freshState(doc), 'stale');
  assert.doesNotMatch(priceRead(doc), /\b0\.0000\b/);
});

test('zero-close OHLC row rejects the payload and falls back', async () => {
  const doc = runDash({
    price: () => Promise.resolve(resp(priceBody())),
    ohlc: () => Promise.resolve(resp(ohlcBody((rows) => { rows[10][4] = 0; }))),
    snap: () => Promise.resolve(resp(SNAP)),
  });
  await sleep(120);
  assert.equal(freshState(doc), 'stale');
});

test('non-monotonic OHLC timestamps reject the payload and fall back', async () => {
  const doc = runDash({
    price: () => Promise.resolve(resp(priceBody())),
    ohlc: () => Promise.resolve(resp(ohlcBody((rows) => { rows[6][0] = rows[5][0]; }))),
    snap: () => Promise.resolve(resp(SNAP)),
  });
  await sleep(120);
  assert.equal(freshState(doc), 'stale');
});

test('total failure renders NO_DATA', async () => {
  const doc = runDash({
    price: () => Promise.reject(new Error('down')),
    ohlc: () => Promise.reject(new Error('down')),
  });
  await sleep(120);
  assert.equal(freshState(doc), 'nodata');
  assert.equal(doc._els['dt-vol'].textContent, 'NO_DATA');
});

test('forced refresh wins over a slow superseded request', async () => {
  let priceCall = 0;
  const doc = runDash({
    price: () => {
      priceCall += 1;
      if (priceCall === 1) {
        return new Promise((r) => setTimeout(() => r(resp(priceBody({ 'usd-coin': { usd: 1.11 } }))), 250));
      }
      return Promise.resolve(resp(priceBody({ 'usd-coin': { usd: 2.22 } })));
    },
    ohlc: () => Promise.resolve(resp(ohlcBody())),
  });
  await sleep(50);
  doc._els['dash-refresh'].click(); // force refresh while request 1 is pending
  await sleep(120);
  assert.match(priceRead(doc), /2\.2200/);
  await sleep(250); // let the superseded request settle
  doc._els['btn-liquidity'].click(); // unforced reload must serve the cached forced result
  await sleep(50);
  assert.match(priceRead(doc), /2\.2200/);
  assert.doesNotMatch(priceRead(doc), /1\.1100/);
});
