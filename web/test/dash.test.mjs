import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { deriveMetrics, normalizeSnapshot, validOhlc, validPrice } from '../snapshot.mjs';

const html = await readFile(new URL('../dash/index.html', import.meta.url), 'utf8');

test('V57: dashboard route exposes private-preview gate', () => {
  assert.match(html, /Dashboard access is gated\./);
  assert.match(html, /public landing page shows a read-only market snapshot/i);
  assert.match(html, /Login \(Soon\)/);
  assert.match(html, /Connect wallet \(Soon\)/);
  assert.match(html, /Sign up \(Soon\)/);
  assert.doesNotMatch(html, /id="dt-price"/);
  assert.doesNotMatch(html, /Market stats/);
});

test('validOhlc rejects zero and negative price values', () => {
  const valid = [[1, 1, 2, 0.5, 1.5], [2, 1.5, 2, 1, 1.75]];
  for (const index of [1, 2, 3, 4]) {
    for (const value of [0, -1]) {
      const rows = valid.map(row => row.slice());
      rows[0][index] = value;
      assert.equal(validOhlc(rows), false, `field ${index} rejects ${value}`);
    }
  }
});

test('normalizeSnapshot emits normalized OHLC and derived metrics', () => {
  const raw = { observedAt: 1000, fetchedAt: '2026-01-01T00:00:00.000Z', instruments: {} };
  for (const [id, volume] of [['usd-coin', 1], ['solana', 2], ['jupiter-exchange-solana', 3]]) {
    raw.instruments[id] = { price: 2, change24h: 1, vol24h: volume, updatedAt: 1000, ohlc: [[1000, 1, 2, 0.5, 1.5], [2000, 1.5, 3, 1, 2.5]] };
  }
  const snapshot = normalizeSnapshot(raw, 1000);
  const instrument = snapshot.instruments['usd-coin'];
  assert.deepEqual(instrument.ohlc, [{ o: 1, h: 2, l: 0.5, c: 1.5 }, { o: 1.5, h: 3, l: 1, c: 2.5 }]);
  assert.equal(instrument.metrics.rangeHigh, 3);
  assert.equal(instrument.metrics.rangeLow, 0.5);
  assert.ok(Math.abs(instrument.metrics.volumeShare - 100 / 6) < 1e-12);
  assert.ok(Object.values(instrument.metrics).every(Number.isFinite));
});

test('normalizeSnapshot ignores forged metadata', () => {
  const raw = { observedAt: 9999999999, fetchedAt: 'forged', instruments: {} };
  for (const id of ['usd-coin', 'solana', 'jupiter-exchange-solana']) {
    raw.instruments[id] = { price: 2, change24h: 1, vol24h: 1, updatedAt: 1000, ohlc: [[1000, 1, 2, 0.5, 1.5], [2000, 1.5, 3, 1, 2.5]] };
  }
  const snapshot = normalizeSnapshot(raw, 1000);
  assert.equal(snapshot.observedAt, 1000);
  assert.notEqual(snapshot.fetchedAt, 'forged');
  assert.ok(Number.isFinite(Date.parse(snapshot.fetchedAt)));
});

test('deriveMetrics rejects non-finite derived values', () => {
  assert.throws(() => deriveMetrics([{ o: 1, h: 2, l: 1, c: Infinity }, { o: 1, h: 2, l: 1, c: 2 }], 1, 1), /invalid derived metrics/);
});

test('validPrice rejects stale and future provider timestamps', () => {
  const price = { usd: 1, usd_24h_vol: 1, usd_24h_change: 0, last_updated_at: 1000 };
  assert.equal(validPrice(price, 1000), true);
  assert.equal(validPrice({ ...price, last_updated_at: 1301 }, 1000), false);
  assert.equal(validPrice({ ...price, last_updated_at: 1000 - 7 * 86400 - 1 }, 1000), false);
  assert.equal(validPrice({ ...price, usd: 0 }, 1000), false);
});
