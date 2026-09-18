import assert from 'node:assert/strict';
import test from 'node:test';
import { PREIPO_ASSETS } from '../preipo.ts';

test('Stocks CLI uses the approved PreStocks basket configuration', () => {
  assert.equal(PREIPO_ASSETS.length, 2);
  assert.equal(PREIPO_ASSETS.reduce((sum, asset) => sum + asset.targetWeightBps, 0), 10_000);
  assert.ok(PREIPO_ASSETS.every(asset => asset.minLiquidity === '500000'));
});
