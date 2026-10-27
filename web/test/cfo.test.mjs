import assert from 'node:assert/strict';
import test, { after } from 'node:test';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';

const webRoot = fileURLToPath(new URL('../', import.meta.url));
const vite = await createServer({
  configFile: false,
  root: webRoot,
  appType: 'custom',
  logLevel: 'error',
  server: { middlewareMode: true, hmr: false },
});
const { buildMandateFromForm, buildPlanFields, formatBaseUnits } = await vite.ssrLoadModule('/dashboard/Cfo.jsx');
after(() => vite.close());

test('CFO balance formatting preserves exact token decimals and large values', () => {
  assert.equal(formatBaseUnits('1002000', 6), '1.002000');
  assert.equal(formatBaseUnits('0000000', 6), '0.000000');
  assert.equal(formatBaseUnits('1234000001', 6), '1,234.000001');
  assert.equal(formatBaseUnits('9007199254740993123456789', 18), '9,007,199.254740993123456789');
  assert.equal(formatBaseUnits('1234567', 0), '1,234,567');
});

test('CFO balance formatting rejects non-integer units or invalid decimal metadata', () => {
  assert.equal(formatBaseUnits('-1', 6), null);
  assert.equal(formatBaseUnits('1.5', 6), null);
  assert.equal(formatBaseUnits('12', -1), null);
  assert.equal(formatBaseUnits('12', 2.5), null);
});

const validForm = () => ({
  reserveAssetId: 'solana:mainnet:usdc',
  reserveFloorBaseUnits: '9007199254740993123456789',
  maxActionReserveBaseUnits: '100000000000000000000',
  maxPositionBps: '7500',
  slippageBps: '50',
  maxFeeBps: '25',
  maxEvidenceAgeSeconds: '900',
  monitorIntervalSeconds: '60',
  maxMonitorCycles: '12',
});

const validTargets = () => [
  { assetId: 'nep141:base-0x0bb69b79bc829e1cfcc34a740110886d98d2bd14.omft.near', weightBps: '6500' },
  { assetId: 'nep141:eth-0x0f38f1ce62776d4a0038bc6cac66877a5687383b.omft.near', weightBps: '3500' },
];

test('CFO mandate builder keeps money as exact strings and encodes bounded settings as integers', () => {
  const result = buildMandateFromForm(validForm(), validTargets(), 'verified-owner-wallet');
  assert.deepEqual(result.errors, {});
  const mandate = result.mandate;
  assert.equal(mandate.reserveFloorBaseUnits, '9007199254740993123456789');
  assert.equal(mandate.maxActionReserveBaseUnits, '100000000000000000000');
  assert.equal(mandate.maxPositionBps, 7500);
  assert.equal(mandate.slippageBps, 50);
  assert.deepEqual(mandate.targets.map(target => target.weightBps), [6500, 3500]);
});

test('CFO mandate builder rejects missing limits, non-string money, and excess target weight', () => {
  const incomplete = validForm();
  incomplete.reserveFloorBaseUnits = Number.MAX_SAFE_INTEGER;
  incomplete.maxActionReserveBaseUnits = '0';
  incomplete.maxFeeBps = '';
  const result = buildMandateFromForm(incomplete, [
    { assetId: 'receipt-a', weightBps: '10000' },
    { assetId: 'receipt-b', weightBps: '1' },
  ], 'verified-owner-wallet');
  assert.equal(result.mandate, null);
  assert.ok(result.errors.maxActionReserveBaseUnits);
  assert.ok(result.errors.reserveFloorBaseUnits);
  assert.ok(result.errors.maxFeeBps);
  assert.ok(result.errors.targets);
});

test('CFO mandate builder requires unique receipt targets distinct from the reserve', () => {
  const form = validForm();
  const result = buildMandateFromForm(form, [
    { assetId: form.reserveAssetId, weightBps: '4000' },
    { assetId: form.reserveAssetId, weightBps: '4000' },
  ], 'verified-owner-wallet');
  assert.equal(result.mandate, null);
  assert.ok(result.errors['target-0-assetId']);
  assert.ok(result.errors['target-1-assetId']);
});
test('CFO mandate permits an explicit reserve-only allocation', () => {
  const result = buildMandateFromForm(validForm(), [], 'verified-owner-wallet');
  assert.deepEqual(result.errors, {});
  assert.deepEqual(result.mandate.targets, []);
});

test('CFO plan builder uses explicit nulls for mandate-weighted invest and reinvest requests', () => {
  const invest = buildPlanFields({
    action: 'invest', sourceAssetId: 'solana:mainnet:usdc', targetAssetId: '', inputBaseUnits: '',
  });
  assert.deepEqual(invest.errors, {});
  assert.deepEqual(invest.fields, {
    action: 'invest', sourceAssetId: 'solana:mainnet:usdc', targetAssetId: null, inputBaseUnits: null,
  });

  const reinvest = buildPlanFields({
    action: 'reinvest', sourceAssetId: 'solana:mainnet:usdc', targetAssetId: '', inputBaseUnits: '',
  });
  assert.deepEqual(reinvest.errors, {});
  assert.deepEqual(reinvest.fields, {
    action: 'reinvest', sourceAssetId: 'solana:mainnet:usdc', targetAssetId: null, inputBaseUnits: null,
  });
});

test('CFO plan builder keeps explicit exit amounts as strings and rejects zero', () => {
  const redeem = buildPlanFields({
    action: 'redeem', sourceAssetId: 'receipt-asset', targetAssetId: 'solana:mainnet:usdc', inputBaseUnits: '9007199254740993123456789',
  });
  assert.deepEqual(redeem.errors, {});
  assert.deepEqual(redeem.fields, {
    action: 'redeem',
    sourceAssetId: 'receipt-asset',
    targetAssetId: 'solana:mainnet:usdc',
    inputBaseUnits: '9007199254740993123456789',
  });
  const zero = buildPlanFields({
    action: 'rotate', sourceAssetId: 'receipt-asset', targetAssetId: 'target-asset', inputBaseUnits: '0',
  });
  assert.equal(zero.fields, null);
  assert.ok(zero.errors.inputBaseUnits);
});
