import test from 'node:test';
import assert from 'node:assert/strict';
import { createStore } from '../treasury/store.mjs';
import { replayRun } from '../treasury/domain.mjs';

const KEY = 'falcon.treasury.simulation.v1';
const id = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const at = n => `2026-09-26T12:00:${String(n).padStart(2, '0')}.000Z`;
const setup = () => ({ id: id(1), createdAt: at(0), totalUsdc: '1000', reserveUsdc: '200', investmentCapUsdc: '500', minLiquidityUsdc: '1000', maxObservationAgeSeconds: 60 });

function environment() {
  const records = new Map();
  const storage = {
    writes: 0, failRead: false, failWrite: false,
    getItem(key) { if (this.failRead) throw new Error('denied'); return records.get(key) ?? null; },
    setItem(key, value) { if (this.failWrite) throw new Error('quota'); this.writes++; records.set(key, value); },
  };
  let pending = Promise.resolve();
  const locks = {
    calls: [],
    request(name, options, callback) {
      this.calls.push({ name, options });
      const result = pending.then(callback);
      pending = result.catch(() => {});
      return result;
    },
  };
  return { records, storage, locks, store: createStore({ storage, locks }) };
}

test('V78 V82 V83: saved setup survives a new store instance with exact protected balances', async () => {
  const env = environment();
  assert.equal(env.store.load(), null);
  const created = await env.store.create(setup());
  const reopened = createStore({ storage: env.storage, locks: env.locks }).load();
  assert.deepEqual(reopened, created);
  assert.deepEqual(reopened.view.state.balances, { totalUnits: '1000000000', reserveUnits: '200000000', undelegatedUnits: '300000000', idleUnits: '500000000', positionUnits: '0' });
  assert.deepEqual(JSON.parse(env.storage.getItem(KEY)), created.run);
  assert.deepEqual(replayRun(created.run), created.view);
  assert.deepEqual(created.run.events, []);
  assert.equal(env.storage.writes, 1);
  assert.deepEqual(env.locks.calls, [{ name: KEY, options: { mode: 'exclusive' } }]);
});

test('V78 V82: rejected setup leaves no record and permits a corrected retry', async () => {
  const env = environment();
  await assert.rejects(env.store.create({ ...setup(), reserveUsdc: '900' }), /reserve plus investment cap/);
  assert.equal(env.storage.getItem(KEY), null);
  assert.equal(env.storage.writes, 0);
  const corrected = await env.store.create(setup());
  assert.equal(corrected.run.setup.reserveUsdc, '200');
  assert.equal(env.storage.writes, 1);
});

test('V82: a failed initial write returns an error and leaves the browser empty', async () => {
  const env = environment();
  env.storage.failWrite = true;
  await assert.rejects(env.store.create(setup()), /Could not save/);
  assert.equal(env.storage.getItem(KEY), null);
  assert.equal(env.store.load(), null);
  assert.equal(env.storage.writes, 0);
  env.storage.failWrite = false;
  await env.store.create(setup());
  assert.equal(env.storage.writes, 1);
});

test('V82: concurrent setup attempts serialize and retain the first saved mandate', async () => {
  const env = environment();
  const other = createStore({ storage: env.storage, locks: env.locks });
  const results = await Promise.allSettled([env.store.create(setup()), other.create({ ...setup(), id: id(2), reserveUsdc: '100' })]);
  assert.equal(results[0].status, 'fulfilled');
  assert.equal(results[1].status, 'rejected');
  assert.match(results[1].reason.message, /already has a simulation/);
  assert.equal(env.store.load().run.id, id(1));
  assert.equal(env.store.load().run.setup.reserveUsdc, '200');
  assert.equal(env.storage.writes, 1);
});

test('V82 V83: corrupt or nonempty saved records cannot be replaced by setup', async () => {
  const valid = await environment().store.create(setup());
  const corruptRecords = ['{broken', '{}', 'null',
    JSON.stringify({ ...valid.run, mode: 'live' }),
    JSON.stringify({ ...valid.run, events: [{ id: id(2), at: at(1), type: 'cycle' }] }),
    JSON.stringify({ ...valid.run, setup: { ...valid.run.setup, investmentCapUsdc: '900' } }),
  ];
  for (const corrupt of corruptRecords) {
    const env = environment();
    env.records.set(KEY, corrupt);
    assert.throws(() => env.store.load(), /not valid JSON|failed validation/);
    await assert.rejects(env.store.create(setup()), /not valid JSON|failed validation/);
    assert.equal(env.storage.getItem(KEY), corrupt);
    assert.equal(env.storage.writes, 0);
  }
});

test('V82: unavailable reads and unavailable Web Locks fail without writing', async () => {
  const env = environment();
  env.storage.failRead = true;
  await assert.rejects(env.store.create(setup()), /Could not read/);
  env.storage.failRead = false;
  await assert.rejects(createStore({ storage: env.storage, locks: {} }).create(setup()), /Web Locks/);
  assert.equal(env.storage.writes, 0);
});

test('V82: creating again cannot overwrite a saved setup', async () => {
  const env = environment();
  await env.store.create(setup());
  const before = env.storage.getItem(KEY);
  await assert.rejects(env.store.create({ ...setup(), id: id(5) }), /already has a simulation/);
  assert.equal(env.storage.getItem(KEY), before);
  assert.equal(env.storage.writes, 1);
});

test('V82: oversized saved records remain intact', async () => {
  const env = environment();
  const oversized = ' '.repeat(256 * 1024 + 1);
  env.records.set(KEY, oversized);
  assert.throws(() => env.store.load(), /record limit/);
  await assert.rejects(env.store.create(setup()), /record limit/);
  assert.equal(env.storage.getItem(KEY), oversized);
  assert.equal(env.storage.writes, 0);
});

test('V82: read-only reload needs no lock and returned objects cannot change persisted setup', async () => {
  const env = environment();
  const created = await env.store.create(setup());
  const saved = env.storage.getItem(KEY);
  created.run.setup.reserveUsdc = '0';
  created.view.state.balances.reserveUnits = '0';
  const reopened = createStore({ storage: env.storage, locks: {} }).load();
  assert.equal(reopened.run.setup.reserveUsdc, '200');
  assert.equal(reopened.view.state.balances.reserveUnits, '200000000');
  assert.equal(env.storage.getItem(KEY), saved);
  assert.equal(env.storage.writes, 1);
});
