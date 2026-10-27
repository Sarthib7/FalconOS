import test from 'node:test';
import assert from 'node:assert/strict';
import { projectDecisionTrace } from '../council/decision-trace.mjs';

test('V213: the complete trace including its hash obeys the wire-size limit', () => {
  const root = { id: '12345678-1234-4234-8234-123456789001', contentHash: 'a'.repeat(64),
    sequence: '1', createdAt: '2026-01-01T00:00:00.000Z' };
  const project = text => projectDecisionTrace({ domain: 'cfo', root,
    nodes: [{ id: 'cfo:' + root.id, kind: 'plan', status: 'REVIEW', facts: { text } }], edges: [], issues: [] });
  const limit = 128 * 1024;
  const baselineBytes = Buffer.byteLength(JSON.stringify(project('')));
  const remaining = limit - baselineBytes;
  assert.equal(Buffer.byteLength(JSON.stringify(project('x'.repeat(remaining)))), limit);
  assert.throws(() => project('x'.repeat(remaining + 1)), error => error.code === 'TOO_LARGE');
});
