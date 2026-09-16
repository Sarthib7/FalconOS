import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

// Run the /dash inline module against a stub DOM. Snapshot-only: no CoinGecko API.
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
  return {
    getElementById: mk,
    querySelectorAll(sel) {
      if (sel.includes('data-mandate')) return mandates;
      return [];
    },
    hidden: false,
    _els: els,
  };
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const resp = (body) => new Response(body, { status: 200 });

function runDash(route) {
  const doc = makeDoc();
  const fetchImpl = (url) => {
    const s = String(url);
    if (s.includes('dash-snapshot')) return route.snap(s);
    return Promise.reject(new Error(`unrouted ${s}`));
  };
  new Function('document', 'fetch', script)(doc, fetchImpl);
  return doc;
}

const freshState = (doc) => doc._els['dash-fresh']?.attrs['data-state'];
const priceRead = (doc) => doc._els['dt-price-read']?.innerHTML ?? '';

test('valid snapshot renders snapshot state', async () => {
  const doc = runDash({ snap: () => Promise.resolve(resp(SNAP)) });
  await sleep(120);
  assert.equal(freshState(doc), 'snapshot');
  assert.match(priceRead(doc), /0\.999/);
  assert.match(priceRead(doc), /snapshot/i);
  assert.doesNotMatch(priceRead(doc), /live/i);
});

test('missing snapshot renders NO_DATA', async () => {
  const doc = runDash({ snap: () => Promise.reject(new Error('down')) });
  await sleep(120);
  assert.equal(freshState(doc), 'nodata');
  assert.equal(doc._els['dt-vol'].textContent, 'NO_DATA');
});

test('invalid snapshot payload renders NO_DATA', async () => {
  const doc = runDash({ snap: () => Promise.resolve(resp('{"instruments":{}}')) });
  await sleep(120);
  assert.equal(freshState(doc), 'nodata');
});

test('instrument switch updates the readout', async () => {
  const doc = runDash({ snap: () => Promise.resolve(resp(SNAP)) });
  await sleep(120);
  assert.match(priceRead(doc), /USDC/);
  doc._els['btn-payments'].click();
  await sleep(50);
  assert.match(priceRead(doc), /SOL/);
});
