import assert from 'node:assert/strict';
import test from 'node:test';
import { PREIPO_CONFIG } from '../cli.ts';

test('Stocks CLI exposes the approved PreStocks basket configuration', () => {
  assert.equal(PREIPO_CONFIG.assets.length, 2);
  assert.equal(PREIPO_CONFIG.assets.reduce((sum, asset) => sum + asset.targetWeightBps, 0), 10_000);
  assert.ok(PREIPO_CONFIG.assets.every(asset => asset.minLiquidity === '500000'));
  assert.equal(PREIPO_CONFIG.coherenceCapMs, 120_000);
});
