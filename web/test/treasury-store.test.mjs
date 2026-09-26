import test from 'node:test';
import assert from 'node:assert/strict';
import { createStore } from '../treasury/store.mjs';

const KEY = 'falcon.treasury.simulation.v1';
const id = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const at = n => `2026-09-26T12:00:${String(n).padStart(2, '0')}.000Z`;
const setup = () => ({ id: id(1), createdAt: at(0), totalUsdc: '1000', reserveUsdc: '200', investmentCapUsdc: '500', minLiquidityUsdc: '1000', maxObservationAgeSeconds: 60 });
const observation = () => ({ id: id(2), at: at(1), type: 'observe', observation: { source: 'synthetic', status: 'ok', observedAt: at(1), availableLiquidityUsdc: '10000' } });
const cycle = (n = 3) => ({ id: id(n), at: at(n), type: 'cycle' });

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

test('V82 V83: a saved supply survives a new store instance', async () => {
  const env = environment();
  await env.store.create(setup());
  await env.store.dispatch(observation(), 0);
  const supplied = await env.store.dispatch(cycle(), 1);
  const reopened = createStore({ storage: env.storage, locks: env.locks }).load();
  assert.deepEqual(reopened, supplied);
  assert.equal(reopened.view.state.balances.positionUnits, '500000000');
  assert.equal(env.locks.calls.length, 3);
  assert.ok(env.locks.calls.every(call => call.name === KEY && call.options.mode === 'exclusive'));
});

test('V82: a failed storage write preserves the prior position, revision, and raw history', async () => {
  const env = environment();
  await env.store.create(setup());
  await env.store.dispatch(observation(), 0);
  const before = env.storage.getItem(KEY);
  env.storage.failWrite = true;
  await assert.rejects(env.store.dispatch(cycle(), 1), /Could not save/);
  assert.equal(env.storage.getItem(KEY), before);
  assert.equal(env.store.load().view.state.balances.positionUnits, '0');
  assert.equal(env.store.load().view.state.revision, 1);
});

test('V82: concurrent stores serialize; the stale second writer cannot overwrite a committed action', async () => {
  const env = environment();
  const other = createStore({ storage: env.storage, locks: env.locks });
  await env.store.create(setup());
  await env.store.dispatch(observation(), 0);
  const results = await Promise.allSettled([env.store.dispatch(cycle(3), 1), other.dispatch(cycle(4), 1)]);
  assert.equal(results[0].status, 'fulfilled');
  assert.equal(results[1].status, 'rejected');
  assert.match(results[1].reason.message, /changed in another tab/);
  assert.equal(env.store.load().run.events.length, 2);
  assert.equal(env.store.load().view.state.balances.positionUnits, '500000000');
});

test('V82: corrupt stored data cannot be replaced by initialization or another event', async () => {
  for (const corrupt of ['{broken', '{}', 'null']) {
    const env = environment();
    env.records.set(KEY, corrupt);
    assert.throws(() => env.store.load(), /not valid JSON|failed validation/);
    await assert.rejects(env.store.create(setup()), /not valid JSON|failed validation/);
    await assert.rejects(env.store.dispatch(cycle(), 0), /not valid JSON|failed validation/);
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

test('V82 V83: exact retries are idempotent even after the original revision; conflicting retries fail', async () => {
  const env = environment();
  await env.store.create(setup());
  await env.store.dispatch(observation(), 0);
  const first = await env.store.dispatch(cycle(), 1);
  const writes = env.storage.writes;
  const retry = await env.store.dispatch(cycle(), 1);
  assert.deepEqual(retry, first);
  assert.equal(env.storage.writes, writes);
  await assert.rejects(env.store.dispatch({ ...cycle(), type: 'revoke' }, 1));
  assert.equal(env.storage.writes, writes);
});

test('V82: create never overwrites a valid run', async () => {
  const env = environment();
  assert.equal(env.store.load(), null);
  await env.store.create(setup());
  const before = env.storage.getItem(KEY);
  await assert.rejects(env.store.create({ ...setup(), id: id(5) }), /already has a simulation/);
  assert.equal(env.storage.getItem(KEY), before);
});

test('V82: oversized saved records and malformed revisions stop before writing', async () => {
  const env = environment();
  env.records.set(KEY, ' '.repeat(256 * 1024 + 1));
  assert.throws(() => env.store.load(), /record limit/);
  env.records.clear();
  await env.store.create(setup());
  const writes = env.storage.writes;
  for (const revision of [-1, '0', NaN, Infinity, 0.5]) await assert.rejects(env.store.dispatch(cycle(), revision), /revision/);
  assert.equal(env.storage.writes, writes);
});
