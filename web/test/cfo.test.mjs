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
const cfo = await vite.ssrLoadModule('/dashboard/Cfo.jsx');
const { buildMandateFromForm, buildPlanFields, formatBaseUnits } = cfo;
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
test('CFO mandate permits an explicit reserve-only allocation with a zero reserve floor', () => {
  const form = validForm();
  form.reserveFloorBaseUnits = '0';
  const result = buildMandateFromForm(form, [], 'verified-owner-wallet');
  assert.deepEqual(result.errors, {});
  assert.deepEqual(result.mandate.targets, []);
  assert.equal(result.mandate.reserveFloorBaseUnits, '0');
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

const consumerTemplate = () => ({
  id: 'falcon-cfo-consumer',
  version: 1,
  maxPositionBps: 2500,
  slippageBps: 50,
  maxFeeBps: 100,
  maxEvidenceAgeSeconds: 300,
  monitorIntervalSeconds: 300,
  maxMonitorCycles: 12,
});

test('CFO token amount parsing preserves exact values beyond safe integer range and at precision boundaries', () => {
  assert.equal(cfo.parseTokenAmount('9007199254740993.123456', 6), '9007199254740993123456');
  assert.equal(cfo.parseTokenAmount('0.000001', 6), '1');
  assert.equal(cfo.parseTokenAmount('1', 0), '1');
  assert.equal(cfo.parseTokenAmount('0', 6), '0');
});

test('CFO token amount parsing rejects non-decimal syntax, excess precision, and unknown decimals', () => {
  for (const text of ['', '-1', '+1', '1e2', '1,000', '0.0000001', '1.', '.1']) {
    assert.equal(cfo.parseTokenAmount(text, 6), null, `unexpectedly parsed ${text}`);
  }
  assert.equal(cfo.parseTokenAmount('1.0', 0), null);
  for (const decimals of [undefined, null, -1, 6.5, Number.NaN, 256, Number.MAX_SAFE_INTEGER + 1]) {
    assert.equal(cfo.parseTokenAmount('1', decimals), null, `unexpectedly accepted decimals=${decimals}`);
  }
});

test('CFO base units convert back to ungrouped exact input text', () => {
  assert.equal(cfo.baseUnitsInputText('9007199254740993123456', 6), '9007199254740993.123456');
  assert.equal(cfo.baseUnitsInputText('1', 6), '0.000001');
  assert.equal(cfo.baseUnitsInputText('1000000', 6), '1');
  assert.equal(cfo.baseUnitsInputText('1234567', 0), '1234567');
  assert.equal(cfo.baseUnitsInputText('-1', 6), null);
  assert.equal(cfo.baseUnitsInputText('1', undefined), null);
});

test('CFO template copy rejects malformed metadata without changing the draft', () => {
  const form = {
    ...validForm(),
    wallet: 'verified-owner',
    targets: [{ assetId: 'receipt-a', weightBps: '7000' }],
  };
  const before = { ...form, targets: form.targets.map(target => ({ ...target })) };
  const malformed = {
    ...consumerTemplate(),
    maxPositionBps: 25000,
    reserveFloorBaseUnits: '0',
    maxActionReserveBaseUnits: '1',
    reserveAssetId: 'attacker-reserve',
    wallet: 'attacker-wallet',
    targets: [{ assetId: 'attacker-target', weightBps: 10000 }],
  };
  const injectedFields = {
    ...consumerTemplate(),
    reserveFloorBaseUnits: '0',
    maxActionReserveBaseUnits: '1',
    reserveAssetId: 'attacker-reserve',
    wallet: 'attacker-wallet',
    targets: [{ assetId: 'attacker-target', weightBps: 10000 }],
  };
  const malformedInputs = [
    null,
    { ...consumerTemplate(), id: 'other-template' },
    { ...consumerTemplate(), version: 2 },
    { ...consumerTemplate(), maxFeeBps: undefined },
    injectedFields,
  ];
  for (const invalid of malformedInputs) assert.equal(cfo.copyConsumerTemplate(form, invalid), null);
  assert.equal(cfo.copyConsumerTemplate(form, malformed), null);
  assert.deepEqual(form, before);
});

test('CFO template copy changes only non-money limits and preserves saved numeric mandates', () => {
  const form = {
    ...validForm(),
    wallet: 'verified-owner',
    targets: validTargets(),
  };
  const template = consumerTemplate();
  const originalForm = { ...form, targets: form.targets.map(target => ({ ...target })) };
  const originalTemplate = { ...template };
  const saved = buildMandateFromForm(form, form.targets, 'verified-owner');
  const savedMandate = {
    ...saved.mandate,
    targets: saved.mandate.targets.map(target => ({ ...target })),
  };

  const draft = cfo.copyConsumerTemplate(form, template);
  assert.notEqual(draft, form);
  assert.deepEqual(draft, {
    ...form,
    maxPositionBps: '2500',
    slippageBps: '50',
    maxFeeBps: '100',
    maxEvidenceAgeSeconds: '300',
    monitorIntervalSeconds: '300',
    maxMonitorCycles: '12',
  });
  assert.deepEqual(form, originalForm);
  assert.deepEqual(template, originalTemplate);
  assert.deepEqual(saved.mandate, savedMandate);
  assert.equal(saved.mandate.maxPositionBps, 7500);
  assert.equal(draft.reserveAssetId, form.reserveAssetId);
  assert.equal(draft.reserveFloorBaseUnits, form.reserveFloorBaseUnits);
  assert.equal(draft.maxActionReserveBaseUnits, form.maxActionReserveBaseUnits);
  assert.deepEqual(draft.targets, form.targets);
  assert.equal(draft.wallet, form.wallet);
  template.maxPositionBps = 4000;
  const updatedDraft = cfo.copyConsumerTemplate(form, template);
  assert.equal(updatedDraft.maxPositionBps, '4000');
  assert.equal(form.maxPositionBps, '7500');
  assert.equal(draft.maxPositionBps, '2500');
  assert.deepEqual(saved.mandate, savedMandate);
});

test('CFO action heads keep the newest terminal transition and put unresolved logical heads first', () => {
  const action = (actionId, status, recordId) => ({
    id: recordId,
    data: { actionId, status },
  });
  const records = [
    action('action-confirmed', 'CONFIRMED', 'record-a'),
    action('action-z-first', 'SUBMISSION_UNKNOWN', 'record-c'),
    action('action-failed', 'FAILED', 'record-z'),
    action('action-a-second', 'SIGNED', 'record-b'),
    action('action-confirmed', 'SIGNED', 'record-y'),
    action('action-failed', 'PREPARED', 'record-x'),
  ];
  const heads = cfo.actionHeadRecords(records);
  assert.deepEqual(heads.map(record => [record.data.actionId, record.data.status]), [
    ['action-z-first', 'SUBMISSION_UNKNOWN'],
    ['action-a-second', 'SIGNED'],
    ['action-confirmed', 'CONFIRMED'],
    ['action-failed', 'FAILED'],
  ]);
});
