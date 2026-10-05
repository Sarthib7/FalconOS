// Pure unit tests for web/dashboard/api.mjs resolveApiBase.
// These run with `node --test` and import no browser or Vite globals.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { resolveApiBase } from '../dashboard/api.mjs';

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

test('configured dev URL: honours VITE_MESH_API_URL even when not in production', () => {
  assert.equal(
    resolveApiBase({ PROD: false, VITE_MESH_API_URL: 'http://127.0.0.1:9000' }),
    'http://127.0.0.1:9000',
  );
});
