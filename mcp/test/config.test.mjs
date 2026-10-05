import assert from 'node:assert/strict';
import test from 'node:test';
import { ConfigError, parseConfig } from '../src/config.mjs';

const base = { FALCON_MESH_API_URL: 'https://mesh.internal.example', FALCON_MCP_ORIGIN: 'https://mcp.example.com' };

test('defaults are loopback with documented limits', () => {
  const config = parseConfig({ ...base });
  assert.equal(config.port, 8792);
  assert.equal(config.host, '127.0.0.1');
  assert.deepEqual(config.rate, { windowMs: 60000, perSession: 60, perWallet: 10, global: 300 });
  assert.equal(config.meshUrl, 'https://mesh.internal.example');
});

test('a non-loopback host without allowed hosts is refused', () => {
  for (const host of ['0.0.0.0', '::', '10.0.0.5', 'mcp.example.com']) {
    assert.throws(() => parseConfig({ ...base, FALCON_MCP_HOST: host }), error => error instanceof ConfigError && /FALCON_MCP_ALLOWED_HOSTS/.test(error.message), host);
  }
  const config = parseConfig({ ...base, FALCON_MCP_HOST: '0.0.0.0', FALCON_MCP_ALLOWED_HOSTS: 'MCP.example.com, other.example.com' });
  assert.deepEqual(config.allowedHosts, ['mcp.example.com', 'other.example.com']);
  assert.throws(() => parseConfig({ ...base, FALCON_MCP_HOST: '0.0.0.0', FALCON_MCP_ALLOWED_HOSTS: ' , ' }), ConfigError);
  assert.throws(() => parseConfig({ ...base, FALCON_MCP_ALLOWED_HOSTS: 'https://mcp.example.com' }), ConfigError);
  assert.throws(() => parseConfig({ ...base, FALCON_MCP_ALLOWED_HOSTS: '*.example.com' }), ConfigError);
  assert.throws(() => parseConfig({ ...base, FALCON_MCP_ALLOWED_HOSTS: 'mcp.example.com:443' }), ConfigError);
});

test('Mesh URL must be https unless it is loopback', () => {
  assert.throws(() => parseConfig({ ...base, FALCON_MESH_API_URL: 'http://mesh.internal.example' }), error => error instanceof ConfigError && /https/.test(error.message));
  assert.throws(() => parseConfig({ ...base, FALCON_MESH_API_URL: 'http://10.0.0.5:8791' }), ConfigError);
  for (const url of ['http://127.0.0.1:8791', 'http://localhost:8791', 'http://[::1]:8791']) assert.equal(parseConfig({ ...base, FALCON_MESH_API_URL: url }).meshUrl, url);
  assert.throws(() => parseConfig({ ...base, FALCON_MESH_API_URL: 'https://user:pw@mesh.example' }), ConfigError);
  assert.throws(() => parseConfig({ ...base, FALCON_MESH_API_URL: 'ftp://mesh.example' }), ConfigError);
  assert.throws(() => parseConfig({ ...base, FALCON_MESH_API_URL: 'not a url' }), ConfigError);
  assert.throws(() => parseConfig({ FALCON_MCP_ORIGIN: base.FALCON_MCP_ORIGIN }), ConfigError);
});

test('MCP origin must be an exact origin and is required', () => {
  assert.throws(() => parseConfig({ FALCON_MESH_API_URL: base.FALCON_MESH_API_URL }), ConfigError);
  for (const origin of ['https://mcp.example.com/', 'https://mcp.example.com/path', 'mcp.example.com', 'ftp://mcp.example.com', 'HTTPS://MCP.example.com']) {
    assert.throws(() => parseConfig({ ...base, FALCON_MCP_ORIGIN: origin }), ConfigError, origin);
  }
});

test('numeric knobs must be positive integers', () => {
  assert.throws(() => parseConfig({ ...base, FALCON_MCP_RATE_MAX_PER_SESSION: '0' }), ConfigError);
  assert.throws(() => parseConfig({ ...base, FALCON_MCP_RATE_MAX_GLOBAL: '1.5' }), ConfigError);
  assert.throws(() => parseConfig({ ...base, PORT: '70000' }), ConfigError);
  assert.equal(parseConfig({ ...base, FALCON_MCP_RATE_MAX_PER_SESSION: '5' }).rate.perSession, 5);
});
