import assert from 'node:assert/strict';
import test from 'node:test';
import { buildPlan, editPlan } from '../app/plan.mjs';

const LEGS = [
  { asset_id: 'aapl-1', underlying: 'AAPL', target_weight_bps: 6000 },
  { asset_id: 'msft-1', underlying: 'MSFT', target_weight_bps: 4000 },
];
const MINTS = { AAPL: 'MintAapl11111111111111111111111111111111111', 'msft-1': 'MintMsft11111111111111111111111111111111111' };
const alloc = (plan) => plan.legs.map((leg) => leg.allocationBaseUnits);

test('sizes a 60/40 basket exactly with zero residual', () => {
  const plan = buildPlan({ capitalBaseUnits: '5000000', legs: LEGS, analogMints: MINTS });
  assert.deepEqual(alloc(plan), ['3000000', '2000000']);
  assert.equal(plan.residualBaseUnits, '0');
  assert.equal(plan.capitalBaseUnits, '5000000');
  assert.equal(plan.legs[0].analogMint, MINTS.AAPL);
  assert.equal(plan.legs[1].analogMint, MINTS['msft-1']);
  assert.ok(plan.legs.every((leg) => leg.analog && leg.executable && /Devnet analog/.test(leg.label)));
  assert.match(plan.legs[0].label, /AAPL/);
});

test('floor rounding leaves an explicit residual', () => {
  const plan = buildPlan({ capitalBaseUnits: '1000001', legs: LEGS, analogMints: MINTS });
  assert.deepEqual(alloc(plan), ['600000', '400000']);
  assert.equal(plan.residualBaseUnits, '1');
});

test('sizing stays exact beyond Number precision', () => {
  const plan = buildPlan({ capitalBaseUnits: '18446744073709551615', legs: LEGS, analogMints: MINTS });
  assert.deepEqual(alloc(plan), ['11068046444225730969', '7378697629483820646']);
  assert.equal(plan.residualBaseUnits, '0');
});

test('editing a leg down grows the residual without mutating the input', () => {
  const plan = buildPlan({ capitalBaseUnits: '5000000', legs: LEGS, analogMints: MINTS });
  const edited = editPlan(plan, { legId: 'aapl-1', allocationBaseUnits: '1000000' });
  assert.deepEqual(alloc(edited), ['1000000', '2000000']);
  assert.equal(edited.residualBaseUnits, '2000000');
  assert.deepEqual(alloc(plan), ['3000000', '2000000']);
  assert.equal(plan.residualBaseUnits, '0');
});

test('removing a leg frees its allocation to residual', () => {
  const plan = buildPlan({ capitalBaseUnits: '5000000', legs: LEGS, analogMints: MINTS });
  const edited = editPlan(plan, { underlying: 'MSFT', remove: true });
  assert.deepEqual(edited.legs.map((leg) => leg.assetId), ['aapl-1']);
  assert.equal(edited.residualBaseUnits, '2000000');
  assert.equal(plan.legs.length, 2);
});

test('an edit pushing allocations over capital throws', () => {
  const plan = buildPlan({ capitalBaseUnits: '5000000', legs: LEGS, analogMints: MINTS });
  assert.throws(() => editPlan(plan, { legId: 'aapl-1', allocationBaseUnits: '3000001' }), /exceed capital/);
  assert.doesNotThrow(() => editPlan(plan, { legId: 'aapl-1', allocationBaseUnits: '3000000' }));
});

test('edits reject malformed amounts and unknown legs', () => {
  const plan = buildPlan({ capitalBaseUnits: '5000000', legs: LEGS, analogMints: MINTS });
  for (const bad of ['-1', '1.5', 'abc', '', -1, 1.5, NaN, '99999999999999999999999']) {
    assert.throws(() => editPlan(plan, { legId: 'aapl-1', allocationBaseUnits: bad }), Error, String(bad));
  }
  assert.throws(() => editPlan(plan, { legId: 'nope', allocationBaseUnits: '1' }), /no leg matches/);
  assert.throws(() => editPlan(plan, { legId: 'aapl-1' }), /exactly one/);
});

test('an unmapped analog mint is non-executable but keeps its allocation', () => {
  const plan = buildPlan({ capitalBaseUnits: '5000000', legs: LEGS, analogMints: { AAPL: MINTS.AAPL } });
  assert.equal(plan.legs[0].executable, true);
  assert.equal(plan.legs[1].analogMint, null);
  assert.equal(plan.legs[1].executable, false);
  assert.equal(plan.legs[1].allocationBaseUnits, '2000000');
  assert.equal(buildPlan({ capitalBaseUnits: '5000000', legs: LEGS }).legs[0].analogMint, null);
});

test('plan is advisory only: devnet-analog mode, no execution authority', () => {
  const plan = buildPlan({ capitalBaseUnits: '5000000', legs: LEGS, analogMints: MINTS });
  const edited = editPlan(plan, { legId: 'aapl-1', allocationBaseUnits: '1' });
  for (const p of [plan, edited]) {
    assert.equal(p.mode, 'devnet-analog');
    assert.equal('executionReady' in p, false);
    assert.ok(p.legs.every((leg) => !('executionReady' in leg)));
  }
});

test('rejects invalid capital', () => {
  for (const bad of ['-5', '1.5', 'NaN', '', '0', 0, -1, 1.5, NaN, undefined, null, '18446744073709551616']) {
    assert.throws(() => buildPlan({ capitalBaseUnits: bad, legs: LEGS, analogMints: MINTS }), Error, String(bad));
  }
});

test('rejects invalid legs', () => {
  const build = (legs) => buildPlan({ capitalBaseUnits: '1000000', legs, analogMints: MINTS });
  assert.throws(() => build([]), /non-empty/);
  assert.throws(() => build([{ ...LEGS[0], target_weight_bps: 5999.5 }, LEGS[1]]), /integer/);
  assert.throws(() => build([{ ...LEGS[0], target_weight_bps: NaN }, LEGS[1]]), /integer/);
  assert.throws(() => build([{ ...LEGS[0], target_weight_bps: -1 }, { ...LEGS[1], target_weight_bps: 10001 }]), /integer/);
  assert.throws(() => build([LEGS[0]]), /sum to 10000/);
  assert.throws(() => build([LEGS[0], { ...LEGS[1], asset_id: 'aapl-1' }]), /duplicate/);
});
