import assert from 'node:assert/strict';
import test from 'node:test';
import { takeOAuthApprovalRequest } from '../bot/oauth-approval-flow.mjs';

const request = 'far1_' + 'A'.repeat(43);

function take(pathname, search, hash) {
  const updates = [];
  const value = takeOAuthApprovalRequest({ pathname, search, hash }, { replaceState: (...args) => updates.push(args) });
  return { value, updates };
}

test('V152: OAuth approval handle is read from the fragment and removed before page requests', () => {
  const result = take('/oauth/approve', '?from=mcp', '#request=' + request);
  assert.equal(result.value, request);
  assert.deepEqual(result.updates, [[null, '', '/oauth/approve?from=mcp']]);
});

test('V152: malformed or repeated approval handles fail closed and still clear the fragment', () => {
  const malformed = take('/oauth/approve', '', '#request=invalid');
  assert.equal(malformed.value, null);
  assert.deepEqual(malformed.updates, [[null, '', '/oauth/approve']]);
  const repeated = take('/oauth/approve', '', '#request=' + request + '&request=' + request);
  assert.equal(repeated.value, null);
  assert.deepEqual(repeated.updates, [[null, '', '/oauth/approve']]);
});

test('V152: other bot routes keep their fragments unchanged', () => {
  const result = take('/', '', '#mesh-state');
  assert.equal(result.value, null);
  assert.deepEqual(result.updates, []);
});
