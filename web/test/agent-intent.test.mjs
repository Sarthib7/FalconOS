import test from 'node:test';
import assert from 'node:assert/strict';
import { parseAgentIntent } from '../dashboard/agent-intent.mjs';

test('V129: supported chat phrases map to bounded typed intents', () => {
  assert.deepEqual(parseAgentIntent('Find Solana USDC yields'), { type: 'discover' });
  assert.deepEqual(parseAgentIntent('simulate allocation'), { type: 'simulate' });
  assert.deepEqual(parseAgentIntent('explain last plan'), { type: 'explain' });
});

test('V129: ambiguous or free-text approval never mutates simulation state', () => {
  assert.deepEqual(parseAgentIntent('yes do it'), { type: 'unsupported' });
  assert.deepEqual(parseAgentIntent('move all my money wherever you want'), { type: 'unsupported' });
  assert.deepEqual(parseAgentIntent('x'.repeat(281)), { type: 'unsupported' });
});
