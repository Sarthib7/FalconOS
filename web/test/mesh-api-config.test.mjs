// Pure unit tests for web/dashboard/api.mjs resolveApiBase.
// These run with `node --test` and import no browser or Vite globals.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { API_BASE, meshRequest, resolveApiBase } from '../dashboard/api.mjs';

test('dev fallback: returns localhost:8791 when VITE_MESH_API_URL is absent and not production', () => {
  assert.equal(resolveApiBase({}), 'http://127.0.0.1:8791');
});

test('dev fallback: returns localhost:8791 with explicit PROD=false', () => {
  assert.equal(resolveApiBase({ PROD: false }), 'http://127.0.0.1:8791');
});

test('missing production URL: returns null so the module still loads and the page renders', () => {
  // Must NOT throw — throwing at module load would crash the entire bot page.
  assert.equal(resolveApiBase({ PROD: true }), null);
});

test('missing production URL: does not return a localhost string', () => {
  const result = resolveApiBase({ PROD: true });
  assert.ok(
    result === null || !result.includes('127.0.0.1'),
    'must not silently fall back to localhost in production',
  );
});

test('configured production URL: uses VITE_MESH_API_URL verbatim', () => {
  assert.equal(
    resolveApiBase({ PROD: true, VITE_MESH_API_URL: 'https://mesh.falconos.example' }),
    'https://mesh.falconos.example',
  );
});

test('configured production URL: strips trailing slash', () => {
  assert.equal(
    resolveApiBase({ PROD: true, VITE_MESH_API_URL: 'https://mesh.falconos.example/' }),
    'https://mesh.falconos.example',
  );
});

test('configured production URL: rejects plain http so session tokens never travel in cleartext', () => {
  assert.equal(resolveApiBase({ PROD: true, VITE_MESH_API_URL: 'http://mesh.falconos.example' }), null);
});

test('configured dev URL: honours VITE_MESH_API_URL even when not in production', () => {
  assert.equal(
    resolveApiBase({ PROD: false, VITE_MESH_API_URL: 'http://127.0.0.1:9000' }),
    'http://127.0.0.1:9000',
  );
});

test('OAuth approval requests send the request handle without cookies or bearer credentials', async () => {
  const originalFetch = globalThis.fetch;
  let call;
  globalThis.fetch = async (url, options) => {
    call = { url, options };
    return { ok: true, status: 200, json: async () => ({ clientName: 'Client' }) };
  };
  try {
    const request = 'far1_' + 'A'.repeat(43);
    assert.deepEqual(await meshRequest(null, '/v1/oauth/approval/context', { request }), { clientName: 'Client' });
    assert.equal(call.url, API_BASE + '/v1/oauth/approval/context');
    assert.equal(call.options.credentials, 'omit');
    assert.equal(call.options.redirect, 'error');
    assert.deepEqual(call.options.headers, { accept: 'application/json', 'content-type': 'application/json' });
    assert.deepEqual(JSON.parse(call.options.body), { request });
  } finally {
    globalThis.fetch = originalFetch;
  }
});
