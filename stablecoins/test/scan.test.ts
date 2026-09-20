import test from 'node:test';
import assert from 'node:assert/strict';
import { assess, formatUnits, inputAmount } from '../scan.ts';
import { demoCycles } from '../../src/demo.ts';

const now = new Date('2026-09-05T12:00:00.000Z');

test('F3: positive quote difference stays REVIEW with unknown net profit', () => {
  const candidate = assess(demoCycles('100000000', now)[1]!, now);
  assert.equal(candidate.status, 'REVIEW');
  assert.equal(candidate.quotedDeltaUsdc, '0.100000');
  assert.equal(candidate.netProfitUsdc, null);
  assert.equal(candidate.executionReady, false);
  assert.ok(candidate.reasons.includes('COSTS_INCOMPLETE'));
  assert.deepEqual(candidate.gasEstimatesUsd[0], {chain: 'base', gas: '0.004234', l1Fee: null});
});

test('F3: reject a non-positive cycle and preserve exact units above floating-point precision', () => {
  assert.equal(assess(demoCycles('100000000', now)[0]!, now).status, 'REJECT');
  assert.equal(formatUnits(9007199254740993n), '9007199254.740993');
  assert.equal(formatUnits(-1n), '-0.000001');
  assert.equal(inputAmount('0.010001'), '10001');
});

test('F2/F3: unmatched intermediate inventory is not a candidate', () => {
  const cycle = demoCycles('100000000', now)[1]!;
  cycle.legs[1]!.quote!.inAmount = '86000001';
  assert.equal(assess(cycle, now).status, 'UNAVAILABLE');
  assert.ok(assess(cycle, now).reasons.includes('MISMATCHED_LEGS'));
});

test('F2: reject stale, future, and impossible observation times', () => {
  for (const change of ['stale', 'future', 'invalid', 'reversed']) {
    const cycle = demoCycles('100000000', now)[1]!;
    const leg = cycle.legs[0]!;
    if (change === 'stale') leg.startedAt = '2026-09-05T11:59:49.000Z';
    if (change === 'future') leg.receivedAt = '2026-09-05T12:00:01.000Z';
    if (change === 'invalid') leg.startedAt = 'invalid';
    if (change === 'reversed') leg.receivedAt = '2026-09-05T11:59:59.000Z';
    const result = assess(cycle, now);
    assert.equal(result.status, 'REJECT', change);
    assert.ok(result.reasons.includes('STALE_OR_INVALID_OBSERVATION_TIME'));
  }
});

test('F2: reject an expired RFQ and preserve source failure', () => {
  const cycle = demoCycles('100000000', now)[1]!;
  cycle.legs[1]!.quote!.expiresAt = now.toISOString();
  assert.ok(assess(cycle, now).reasons.includes('QUOTE_EXPIRED'));
  cycle.legs[1]!.quote = null;
  cycle.legs[1]!.error = 'HTTP 429';
  assert.equal(assess(cycle, now).status, 'UNAVAILABLE');
});

test('F2: reject stale, invalid, and future provider timestamps without treating them as creation times', () => {
  for (const timestamp of ['2026-09-05T11:59:49Z', '2026-09-05T12:00:01Z', 'invalid']) {
    const cycle = demoCycles('100000000', now)[1]!;
    cycle.legs[0]!.quote!.providerTimestamp = timestamp;
    assert.equal(assess(cycle, now).status, 'REJECT');
    assert.ok(assess(cycle, now).reasons.includes('PROVIDER_TIME_OUTSIDE_WINDOW'));
  }
});

test('F2: provider timestamp cannot postdate receipt, while equal time is accepted', () => {
  const cycle = demoCycles('100000000', now)[1]!;
  const leg = cycle.legs[0]!;
  leg.receivedAt = '2026-09-05T12:00:00.000Z';
  leg.quote!.providerTimestamp = '2026-09-05T12:00:00.001Z';
  const future = assess(cycle, now);
  assert.equal(future.status, 'REJECT');
  assert.ok(future.reasons.includes('STALE_OR_INVALID_OBSERVATION_TIME'));

  leg.quote!.providerTimestamp = leg.receivedAt;
  const equal = assess(cycle, now);
  assert.equal(equal.status, 'REVIEW');
  assert.equal(equal.reasons.includes('STALE_OR_INVALID_OBSERVATION_TIME'), false);
});

test('F2: bound input and reject malformed quote amounts', () => {
  for (const input of ['-1', 'NaN', 'Infinity', '1e2', '0', '501', '1.0000001']) {
    assert.throws(() => inputAmount(input));
  }
  const cycle = demoCycles('100000000', now)[0]!;
  cycle.legs[1]!.quote!.outAmount = 'Infinity';
  assert.equal(assess(cycle, now).status, 'UNAVAILABLE');
});
