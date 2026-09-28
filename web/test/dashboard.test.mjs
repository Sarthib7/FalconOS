import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { setImmediate } from 'node:timers/promises';
import { STORE_KEY, createStore } from '../dashboard/store.mjs';
import { createStore as createTreasuryStore } from '../treasury/store.mjs';
import { replayRun } from '../treasury/domain.mjs';
import { projectGraph, analyzeGraph } from '../../mesh/domain.mjs';
import { selectionAfterDispatch } from '../dashboard/selection.mjs';

const text = readFileSync(new URL('../dashboard/data.json', import.meta.url), 'utf8');
const data = JSON.parse(text);
const sha256 = value => createHash('sha256').update(value).digest('hex');

test('V88,V89: decision inspection stays selected across observations', () => {
  const latestDecision = 'decision-1';
  assert.equal(selectionAfterDispatch({ eventId: 'observe-1', decision: null, selectedEvent: latestDecision }), latestDecision);
  assert.equal(selectionAfterDispatch({ eventId: 'observe-2', decision: null, selectedEvent: null }), null);
  assert.equal(selectionAfterDispatch({ eventId: 'decision-2', decision: {}, selectedEvent: latestDecision }), 'decision-2');
  assert.equal(selectionAfterDispatch({ eventId: 'observe-3', decision: null, selectedEvent: 'historical-1' }), 'historical-1');
});
const TREASURY_KEY = 'falcon.treasury.simulation.v1';
const LEGACY_KEY = 'falconos-workspace-v1';
const id = number => `00000000-0000-4000-8000-${String(number).padStart(12, '0')}`;
const at = seconds => new Date(Date.parse('2026-09-27T12:00:00.000Z') + seconds * 1000).toISOString();
const setup = () => ({ id: id(1), createdAt: at(0), totalUsdc: '1000', reserveUsdc: '200',
  investmentCapUsdc: '500', minLiquidityUsdc: '1000', maxObservationAgeSeconds: 60 });
const observe = () => ({ id: id(2), at: at(1), type: 'observe', observation: {
  source: 'synthetic', status: 'ok', observedAt: at(1), availableLiquidityUsdc: '2000',
} });
const cycle = (number = 3) => ({ id: id(number), at: at(number), type: 'cycle' });

function environment() {
  const records = new Map();
  const storage = {
    writes: [], failRead: false, failWrite: false,
    getItem(key) { if (this.failRead) throw new Error('fixture denied'); return records.get(key) ?? null; },
    setItem(key, value) { if (this.failWrite) throw new Error('fixture quota'); this.writes.push(key); records.set(key, value); },
  };
  const pending = new Map();
  const locks = {
    calls: [],
    request(name, options, work) {
      this.calls.push({ name, options });
      const result = (pending.get(name) ?? Promise.resolve()).then(work);
      pending.set(name, result.catch(() => {}));
      return result;
    },
  };
  return { records, storage, locks, store: createStore({ storage, locks }) };
}

test('V107,V109: extracted data retains the active source payload and all five canonical treasury runs', () => {
  // SHA-256 of the original OpenDesign cc-data text, measured during extraction.
  assert.equal(sha256(text.trimEnd()), 'c7f52481db1d1c6f163b3567089735c27fc4cf792b7c526f7d9539b7848f5b7e');
  assert.deepEqual(Object.keys(data).sort(), ['knowledge', 'samples']);
  assert.deepEqual(Object.keys(data.samples).sort(), ['blocked', 'hold', 'redeem', 'stale', 'supply']);
  for (const run of Object.values(data.samples)) {
    const view = replayRun(run);
    assert.equal(run.schemaVersion, 2); assert.equal(run.mode, 'simulation');
    assert.deepEqual(view.entries, run.records);
    assert.equal(view.state.balances.totalUnits, '1000000000');
    assert.equal(view.state.balances.reserveUnits, '200000000');
    assert.equal(view.state.balances.undelegatedUnits, '300000000');
  }
});

test('V109: all eight retained source hashes and four graph projections match their exact source content', () => {
  assert.deepEqual(Object.keys(data.knowledge).sort(), ['illiquid', 'liquid', 'missing', 'stale']);
  let sourceCount = 0;
  for (const pack of Object.values(data.knowledge)) {
    for (const source of pack.sources) {
      sourceCount += 1;
      assert.equal(sha256(source.content), source.sha256);
      assert.equal(JSON.parse(source.content).mode, 'synthetic');
    }
    assert.deepEqual(projectGraph(pack.sources, pack.graph.asOf), pack.graph);
  }
  assert.equal(sourceCount, 8);
});

test('V109,V111: twelve knowledge analyses reproduce at saved cutoffs and exclude unrelated positions', () => {
  let analysisCount = 0;
  const statuses = { liquid: 'READY', illiquid: 'BLOCKED', stale: 'NO_DATA', missing: 'NO_DATA' };
  for (const [condition, pack] of Object.entries(data.knowledge)) {
    assert.deepEqual(Object.keys(pack.analyses), ['1', '2', '3']);
    for (const [depth, saved] of Object.entries(pack.analyses)) {
      analysisCount += 1;
      const result = analyzeGraph(pack.graph, { observationId: saved.observationId, maxHops: Number(depth) }, saved.at);
      assert.deepEqual(result, saved);
      assert.equal(result.mode, 'synthetic');
      assert.equal(result.status, depth === '3' ? statuses[condition] : 'NO_DATA');
      assert.ok(result.positionResults.every(position => ['position:one', 'position:two'].includes(position.positionId)));
      assert.ok(result.coverage.visitedNodeIds.every(node => !node.includes('unrelated')));
    }
  }
  assert.equal(analysisCount, 12);
});

test('V108: dashboard namespace isolates storage and locks while the treasury default remains unchanged', async () => {
  const env = environment();
  const treasury = createTreasuryStore({ storage: env.storage, locks: env.locks });
  await treasury.create(setup());
  const treasuryBytes = env.records.get(TREASURY_KEY);
  const legacyBytes = '{"original":"legacy fixture stays byte-for-byte"}';
  env.records.set(LEGACY_KEY, legacyBytes);
  assert.equal(env.store.load(), null);
  // Unknown caller options cannot redirect the fixed dashboard namespace.
  const dashboard = createStore({ storage: env.storage, locks: env.locks, key: TREASURY_KEY });
  await dashboard.create({ ...setup(), id: id(8) });
  await dashboard.dispatch(observe(), 0);
  const saved = await dashboard.dispatch(cycle(), 1);
  assert.equal(STORE_KEY, 'falconos-control-centre-preview-v1');
  assert.equal(env.records.get(TREASURY_KEY), treasuryBytes);
  assert.equal(env.records.get(LEGACY_KEY), legacyBytes);
  assert.deepEqual([...env.records.keys()].sort(), [TREASURY_KEY, LEGACY_KEY, STORE_KEY].sort());
  assert.deepEqual(env.storage.writes, [TREASURY_KEY, STORE_KEY, STORE_KEY, STORE_KEY]);
  assert.deepEqual(env.locks.calls.map(call => call.name), [TREASURY_KEY, STORE_KEY, STORE_KEY, STORE_KEY]);
  assert.ok(env.locks.calls.every(call => call.options.mode === 'exclusive'));
  assert.deepEqual(createStore({ storage: env.storage, locks: env.locks }).load(), saved);
  assert.deepEqual(JSON.parse(dashboard.exportRun()), saved.run);
  assert.deepEqual(replayRun(JSON.parse(dashboard.exportRun())), saved.view);
});

test('V108: corrupt dashboard bytes cannot be replaced by create, dispatch or export', async () => {
  const altered = structuredClone(data.samples.supply);
  altered.records[1].decision.amountUnits = '1';
  for (const raw of ['{broken', 'null', '{}', JSON.stringify(altered), ' '.repeat(2 * 1024 * 1024 + 1)]) {
    const env = environment();
    env.records.set(STORE_KEY, raw);
    const treasuryBytes = JSON.stringify(data.samples.hold);
    env.records.set(TREASURY_KEY, treasuryBytes);
    assert.throws(() => env.store.load());
    assert.throws(() => env.store.exportRun());
    await assert.rejects(env.store.create(setup()));
    await assert.rejects(env.store.dispatch(cycle(), 0));
    assert.equal(env.records.get(STORE_KEY), raw);
    assert.equal(env.records.get(TREASURY_KEY), treasuryBytes);
    assert.equal(env.storage.writes.length, 0);
  }
});

test('V108: quota failure preserves committed dashboard state and cannot create an unsaved run', async () => {
  const env = environment();
  env.storage.failWrite = true;
  await assert.rejects(env.store.create(setup()), /Could not save/);
  assert.equal(env.store.load(), null);
  env.storage.failWrite = false;
  await env.store.create(setup());
  const observed = await env.store.dispatch(observe(), 0);
  const before = env.records.get(STORE_KEY);
  env.storage.failWrite = true;
  await assert.rejects(env.store.dispatch(cycle(), 1), /Could not save/);
  assert.equal(env.records.get(STORE_KEY), before);
  assert.deepEqual(env.store.load(), observed);
  assert.equal(env.store.load().view.state.balances.positionUnits, '0');
});

test('V108: two dashboard stores serialize writes, reject stale revisions and preserve exact retries', async () => {
  const env = environment();
  const other = createStore({ storage: env.storage, locks: env.locks });
  await env.store.create(setup());
  await env.store.dispatch(observe(), 0);
  const results = await Promise.allSettled([env.store.dispatch(cycle(3), 1), other.dispatch(cycle(4), 1)]);
  assert.equal(results[0].status, 'fulfilled');
  assert.equal(results[1].status, 'rejected');
  assert.match(results[1].reason.message, /changed in another tab/);
  const before = env.records.get(STORE_KEY);
  const writes = env.storage.writes.length;
  const retry = await other.dispatch(cycle(3), 1);
  assert.deepEqual(retry, results[0].value);
  assert.equal(env.records.get(STORE_KEY), before);
  assert.equal(env.storage.writes.length, writes);
  assert.equal(env.store.load().run.events.length, 2);
  assert.ok(env.locks.calls.every(call => call.name === STORE_KEY));
});

test('V108: unavailable dashboard storage or Web Locks cannot write another namespace', async () => {
  const env = environment();
  env.storage.failRead = true;
  await assert.rejects(env.store.create(setup()), /Could not read/);
  env.storage.failRead = false;
  await assert.rejects(createStore({ storage: env.storage, locks: {} }).create(setup()), /Web Locks/);
  assert.equal(env.storage.writes.length, 0);
  assert.equal(env.records.size, 0);
});

test('V110 B80: stopping a cycle queued behind another native Web Lock preserves saved bytes', async t => {
  const env = environment();
  const locks = navigator.locks;
  const store = createStore({ storage: env.storage, locks });
  await store.create(setup());
  await store.dispatch(observe(), 0);
  const before = env.records.get(STORE_KEY), writes = env.storage.writes.length;
  const entered = Promise.withResolvers(), release = Promise.withResolvers();
  const holder = locks.request(STORE_KEY, () => { entered.resolve(); return release.promise; });
  t.after(() => release.resolve());
  await entered.promise;
  const controller = new AbortController();
  const pending = store.dispatch(cycle(), 1, { signal: controller.signal })
    .then(value => ({ value }), error => ({ error }));
  await setImmediate();
  assert.equal((await locks.query()).pending.filter(lock => lock.name === STORE_KEY).length, 1);
  controller.abort();
  release.resolve();
  await holder;
  const result = await pending;
  assert.equal(result.error?.name, 'AbortError');
  assert.equal(env.records.get(STORE_KEY), before);
  assert.equal(env.storage.writes.length, writes);
  assert.equal(store.load().run.events.length, 1);
});

test('V110 B80: cancellation before a granted callback enters prevents its write', async () => {
  const env = environment();
  await env.store.create(setup());
  await env.store.dispatch(observe(), 0);
  const before = env.records.get(STORE_KEY), writes = env.storage.writes.length;
  const granted = Promise.withResolvers(), enter = Promise.withResolvers();
  // Model the grant-to-callback gap. The manager no longer acts on the signal after grant.
  const store = createStore({ storage: env.storage, locks: {
    request: async (_name, _options, work) => { granted.resolve(); await enter.promise; return work(); },
  } });
  const controller = new AbortController();
  const pending = store.dispatch(cycle(), 1, { signal: controller.signal })
    .then(value => ({ value }), error => ({ error }));
  await granted.promise;
  controller.abort();
  enter.resolve();
  const result = await pending;
  assert.equal(result.error?.name, 'AbortError');
  assert.equal(env.records.get(STORE_KEY), before);
  assert.equal(env.storage.writes.length, writes);
});

test('V110 B80: abort after the synchronous commit enters preserves its recorded result', async () => {
  const env = environment();
  const store = createStore({ storage: env.storage, locks: navigator.locks });
  await store.create(setup());
  await store.dispatch(observe(), 0);
  const controller = new AbortController();
  const setItem = env.storage.setItem.bind(env.storage);
  env.storage.setItem = (key, value) => { controller.abort(); setItem(key, value); };
  const saved = await store.dispatch(cycle(), 1, { signal: controller.signal });
  assert.equal(controller.signal.aborted, true);
  assert.equal(saved.run.events.length, 2);
  assert.equal(saved.view.state.balances.positionUnits, '500000000');
  assert.deepEqual(store.load(), saved);
  assert.equal(env.storage.writes.length, 3);
});
