import test from 'node:test';
import assert from 'node:assert/strict';
import { eligibleDecisions, linkedIntents, supplyBlockReason } from '../mesh/decision-link.mjs';

const NOW = Date.parse('2026-10-05T12:00:00.000Z');
const iso = ms => new Date(ms).toISOString();
const decision = (id, overrides = {}, createdAt = iso(NOW - 60000)) => ({
  id, createdAt,
  analysis: {
    kind: 'reserve_scenario_decision', mode: 'live', status: 'REVIEW', expiresAt: iso(NOW + 60000),
    scenario: { proposedUnits: '500000', maxProposedUnits: '1000000', minBookLiquidityUnits: '0', maxObservationAgeSeconds: 120 },
    ...overrides,
  },
});
const ID_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const ID_B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const ID_C = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';

test('eligibleDecisions keeps a live REVIEW decision whose expiry is in the future', () => {
  const [row, ...rest] = eligibleDecisions([decision(ID_A)], NOW);
  assert.equal(rest.length, 0);
  assert.equal(row.id, ID_A);
  assert.equal(row.proposedUnits, '500000');
  assert.equal(row.expiresAt, iso(NOW + 60000));
  assert.match(row.label, /0\.5 USDC/);
  assert.match(row.label, /2026-10-05 12:01:00 UTC/);
});

test('eligibleDecisions: expiresAt equal to now is NOT eligible, one millisecond later is', () => {
  assert.deepEqual(eligibleDecisions([decision(ID_A, { expiresAt: iso(NOW) })], NOW), []);
  assert.deepEqual(eligibleDecisions([decision(ID_A, { expiresAt: iso(NOW - 1) })], NOW), []);
  assert.equal(eligibleDecisions([decision(ID_A, { expiresAt: iso(NOW + 1) })], NOW).length, 1);
});

test('eligibleDecisions rejects a null, missing or unparseable expiresAt', () => {
  assert.deepEqual(eligibleDecisions([decision(ID_A, { expiresAt: null })], NOW), []);
  assert.deepEqual(eligibleDecisions([decision(ID_A, { expiresAt: undefined })], NOW), []);
  assert.deepEqual(eligibleDecisions([decision(ID_A, { expiresAt: 'soon' })], NOW), []);
});

test('eligibleDecisions rejects the wrong kind, a non-live mode, and every status except REVIEW', () => {
  assert.deepEqual(eligibleDecisions([decision(ID_A, { kind: 'reserve_scenario' })], NOW), []);
  assert.deepEqual(eligibleDecisions([decision(ID_A, { kind: undefined })], NOW), []);
  assert.deepEqual(eligibleDecisions([decision(ID_A, { mode: 'synthetic' })], NOW), []);
  for (const status of ['BLOCKED', 'NO_DATA', 'OBSERVED', 'review', undefined]) {
    assert.deepEqual(eligibleDecisions([decision(ID_A, { status })], NOW), [], String(status));
  }
});

test('eligibleDecisions returns nothing for no rows or malformed input and never throws', () => {
  assert.deepEqual(eligibleDecisions([], NOW), []);
  assert.deepEqual(eligibleDecisions(undefined, NOW), []);
  assert.deepEqual(eligibleDecisions(null, NOW), []);
  assert.deepEqual(eligibleDecisions([null, 7, 'x', {}, { id: ID_A }, { id: ID_A, analysis: null }], NOW), []);
  assert.deepEqual(eligibleDecisions([decision(ID_A, { scenario: null })], NOW), []);
  assert.deepEqual(eligibleDecisions([decision(ID_A, { scenario: { proposedUnits: '12.5' } })], NOW), []);
  assert.deepEqual(eligibleDecisions([decision('')], NOW), []);
});

test('eligibleDecisions orders newest first and drops ineligible rows between eligible ones', () => {
  const rows = [
    decision(ID_A, {}, iso(NOW - 300000)),
    decision(ID_B, { status: 'BLOCKED' }, iso(NOW - 120000)),
    decision(ID_C, {}, iso(NOW - 10000)),
  ];
  assert.deepEqual(eligibleDecisions(rows, NOW).map(row => row.id), [ID_C, ID_A]);
  assert.deepEqual(eligibleDecisions([...rows].reverse(), NOW).map(row => row.id), [ID_C, ID_A]);
});

const intent = (id, request, status, createdAt = '2026-10-05T11:00:00.000Z') => ({ id, requestId: id, analysisId: ID_A, createdAt, request, status, signature: null });
const supply = decisionId => ({ requestId: ID_A, analysisId: ID_A, wallet: 'W', action: 'supply', inputBaseUnits: '250000', ...(decisionId && { decisionId }) });

test('linkedIntents returns only intents carrying the decision id, with their latest status', () => {
  const history = [
    intent('i1', supply(ID_B), 'CONFIRMED'),
    intent('i2', supply(ID_C), 'FAILED'),
    intent('i3', { requestId: ID_A, analysisId: ID_A, wallet: 'W', action: 'redeem', inputBaseUnits: '5' }, 'CONFIRMED'),
    intent('i4', supply(ID_B), 'SUBMITTED'),
    intent('i5', supply(ID_B), 'PENDING'),
    intent('i6', supply(ID_B), 'PREPARED'),
    intent('i7', supply(), 'CONFIRMED'),
  ];
  const rows = linkedIntents(history, ID_B);
  assert.deepEqual(rows.map(row => [row.id, row.status]), [['i1', 'CONFIRMED'], ['i4', 'SUBMITTED'], ['i5', 'PENDING'], ['i6', 'PREPARED']]);
  assert.equal(rows[0].action, 'supply');
  assert.equal(rows[0].inputBaseUnits, '250000');
  assert.equal(rows[0].createdAt, '2026-10-05T11:00:00.000Z');
  assert.deepEqual(linkedIntents(history, ID_C).map(row => row.id), ['i2']);
});

test('linkedIntents reports PREPARED when there is no event status and never invents rows', () => {
  assert.equal(linkedIntents([{ id: 'i1', request: supply(ID_B), createdAt: '2026-10-05T11:00:00.000Z' }], ID_B)[0].status, 'PREPARED');
  assert.equal(linkedIntents([intent('i1', supply(ID_B), null)], ID_B)[0].status, 'PREPARED');
  assert.deepEqual(linkedIntents([], ID_B), []);
  assert.deepEqual(linkedIntents(undefined, ID_B), []);
  assert.deepEqual(linkedIntents([null, 3, {}, { id: 'x' }, { id: 'x', request: null }], ID_B), []);
  assert.deepEqual(linkedIntents([intent('i1', supply(ID_B), 'CONFIRMED')], ID_C), []);
});

test('linkedIntents never matches on a missing or empty decision id and flags unknown statuses', () => {
  const history = [intent('i1', supply(), 'CONFIRMED'), intent('i2', { ...supply(), decisionId: '' }, 'CONFIRMED')];
  for (const id of [undefined, null, '', 5]) assert.deepEqual(linkedIntents(history, id), [], String(id));
  assert.equal(linkedIntents([intent('i1', supply(ID_B), 'MYSTERY')], ID_B)[0].status, 'UNKNOWN');
});

test('supplyBlockReason names a visible reason only when no decision is eligible', () => {
  const reason = supplyBlockReason([]);
  assert.equal(typeof reason, 'string');
  assert.match(reason, /reserve decision/i);
  assert.match(reason, /REVIEW/);
  assert.equal(supplyBlockReason(undefined), reason);
  assert.equal(supplyBlockReason(eligibleDecisions([decision(ID_A)], NOW)), '');
  assert.equal(supplyBlockReason(eligibleDecisions([decision(ID_A, { status: 'BLOCKED' })], NOW)), reason);
});
