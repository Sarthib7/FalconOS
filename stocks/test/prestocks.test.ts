import assert from 'node:assert/strict';
import test from 'node:test';
import { fixtureAdapter } from '../adapters.ts';
import { divideIntegerByDecimal, effectiveMultiplier, multiplierFromSupply, multipliersAgree, parsePreStocks, parseScaledUiAccountState, scaledPreStocksAdapter } from '../prestocks.ts';

const AT = new Date(Date.now() - 1000).toISOString();

test('V64: parsePreStocks maps only valid rows by mint', () => {
  const entries = parsePreStocks([
    { name: 'OpenAI PreStocks', symbol: 'OPENAI', contract_address: 'PreMint1', markPrice: 967.4994641333656, tokenPrice: 983.5880055787931, supply: 1 },
    { symbol: 'NOMINT', markPrice: 10, tokenPrice: 10 },
    { symbol: 'BADPRICE', contract_address: 'PreMint2', markPrice: -5, tokenPrice: 10 },
    'garbage',
  ]);
  assert.equal(entries.size, 1);
  const entry = entries.get('PreMint1');
  assert.equal(entry?.symbol, 'OPENAI');
  assert.equal(entry?.markPrice, '967.4994641333656');
  assert.equal(entry?.tokenPrice, '983.5880055787931');
});

function scaledUiAccount(state: Record<string, unknown>): unknown {
  return {
    result: {
      value: {
        data: {
          program: 'spl-token-2022',
          parsed: { info: { extensions: [{ extension: 'scaledUiAmountConfig', state }] } },
        },
      },
    },
  };
}

test('V66: parseScaledUiAccountState rejects zero current multiplier', () => {
  for (const multiplier of ['0', '00', '00.0']) assert.equal(parseScaledUiAccountState(scaledUiAccount({ multiplier })), null);
});

test('V66: parseScaledUiAccountState rejects malformed pending multiplier', () => {
  assert.equal(parseScaledUiAccountState(scaledUiAccount({ multiplier: '1', newMultiplier: 'bad', newMultiplierEffectiveTimestamp: 1781065800 })), null);
});

test('V66: parseScaledUiAccountState rejects zero pending multiplier', () => {
  assert.equal(parseScaledUiAccountState(scaledUiAccount({ multiplier: '1', newMultiplier: '0', newMultiplierEffectiveTimestamp: 1781065800 })), null);
});

test('V66: parseScaledUiAccountState rejects pending without activation timestamp', () => {
  assert.equal(parseScaledUiAccountState(scaledUiAccount({ multiplier: '1', newMultiplier: '5' })), null);
});

test('V66: parseScaledUiAccountState rejects activation timestamp without pending multiplier', () => {
  assert.equal(parseScaledUiAccountState(scaledUiAccount({ multiplier: '1', newMultiplierEffectiveTimestamp: 1781065800 })), null);
});

test('V66: scaledPreStocksAdapter fails closed on invalid multiplier without throwing', async () => {
  const inner = fixtureAdapter({ mintA: { price: '605.00', liquidity: '5000000', at: AT } });
  const adapter = scaledPreStocksAdapter(inner, new Map([['mintA', '00.0']]), new Map([['mintA', '121.00']]), 500);
  const captures = await adapter.fetchAsset({ assetId: 'mintA', underlying: 'SPACEX', targetWeightBps: 10_000, priceScale: 6, quantityScale: 2, minLiquidity: '100000', maxWeightBps: 10_000 });
  assert.equal(captures.price.status, 'outage');
  assert.equal(captures.price.normalizedValue, null);
  assert.match(captures.price.failure?.reason ?? '', /multiplier invalid/);
});

test('V66: effectiveMultiplier picks the pending multiplier once its timestamp has passed', () => {
  const before = effectiveMultiplier({ multiplier: '1', newMultiplier: '5', newMultiplierEffectiveTimestamp: 1781065800 }, 1781065799);
  const after = effectiveMultiplier({ multiplier: '1', newMultiplier: '1.4861347', newMultiplierEffectiveTimestamp: 1784305800 }, 1784305800);
  assert.equal(before, '1');
  assert.equal(after, '1.4861347');
});

test('V66: multiplierFromSupply matches the live OPENAI and SPACEX mint ratios', () => {
  assert.equal(multiplierFromSupply('1901951695078', 9, '2826.556411779'), '1.4861346');
  assert.equal(multiplierFromSupply('8742515849291', 9, '43712.579246455'), '5');
});

test('V66: multipliersAgree rejects extension vs supply drift beyond 5bps', () => {
  assert.equal(multipliersAgree('1.4861347', '1.4861346'), true);
  assert.equal(multipliersAgree('5', '5.01'), false);
});

test('V66: divideIntegerByDecimal normalizes raw pool units to scaled units', () => {
  assert.equal(divideIntegerByDecimal('1477000000', '1.4861347'), '993853383');
  assert.equal(divideIntegerByDecimal('605000000', '5'), '121000000');
});

test('V66: scaledPreStocksAdapter fails closed when issuer corroboration disagrees', async () => {
  const inner = fixtureAdapter({ mintA: { price: '1477.00', liquidity: '5000000', at: AT } });
  const adapter = scaledPreStocksAdapter(inner, new Map([['mintA', '1.4861347']]), new Map([['mintA', '900.00']]), 500);
  const captures = await adapter.fetchAsset({ assetId: 'mintA', underlying: 'OPENAI', targetWeightBps: 10_000, priceScale: 6, quantityScale: 2, minLiquidity: '100000', maxWeightBps: 10_000 });
  assert.equal(captures.price.status, 'outage');
  assert.equal(captures.price.normalizedValue, null);
  assert.match(captures.price.failure?.reason ?? '', /source-disagreement/);
});

test('V66: scaledPreStocksAdapter publishes normalized price when issuer agrees', async () => {
  const inner = fixtureAdapter({ mintA: { price: '1477.00', liquidity: '5000000', at: AT } });
  const adapter = scaledPreStocksAdapter(inner, new Map([['mintA', '1.4861347']]), new Map([['mintA', '993.853383']]), 500);
  const captures = await adapter.fetchAsset({ assetId: 'mintA', underlying: 'OPENAI', targetWeightBps: 10_000, priceScale: 6, quantityScale: 2, minLiquidity: '100000', maxWeightBps: 10_000 });
  assert.equal(captures.price.status, 'ok');
  assert.equal(captures.price.normalizedValue, '993853383');
});
