import assert from 'node:assert/strict';
import { once } from 'node:events';
import { request } from 'node:http';
import test from 'node:test';
import { runServer } from './support/child.mjs';
import { ORIGIN, startFakeMesh, startStack, testConfig } from './support/harness.mjs';
import { createApp } from '../src/http.mjs';

function send(port, { method = 'GET', path = '/', headers = {}, payload } = {}) {
  return new Promise((resolve, reject) => {
    const req = request({ host: '127.0.0.1', port, method, path, headers }, res => {
      const chunks = [];
      res.on('data', chunk => chunks.push(chunk));
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, text: Buffer.concat(chunks).toString('utf8') }));
    });
    req.on('error', reject);
    req.setTimeout(5000, () => req.destroy(new Error('timeout')));
    req.end(payload);
  });
}

const rpc = JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' });
const mcpHeaders = extra => ({ 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream', ...extra });

test('(l) /healthz is alive and /readyz follows Mesh readiness', async () => {
  let ready = true;
  const stack = await startStack({ overrides: { 'GET /readyz': () => (ready ? { status: 200, body: { status: 'ready' } } : { status: 503, body: { error: { code: 'STORAGE_UNAVAILABLE', message: 'x' } } }) } });
  try {
    const port = new URL(stack.url).port;
    const health = await send(port, { path: '/healthz' });
    assert.equal(health.status, 200);
    assert.deepEqual(JSON.parse(health.text), { status: 'alive' });
    const readyResponse = await send(port, { path: '/readyz' });
    assert.equal(readyResponse.status, 200);
    assert.deepEqual(JSON.parse(readyResponse.text), { status: 'ready' });
    ready = false;
    assert.equal((await send(port, { path: '/readyz' })).status, 503);
    ready = true;
    await stack.mesh.close();
    const down = await send(port, { path: '/readyz' });
    assert.equal(down.status, 503);
    assert.equal(down.text.includes('127.0.0.1'), false);
    assert.equal((await send(port, { path: '/healthz' })).status, 200, 'liveness does not depend on Mesh');
    assert.equal((await send(port, { path: '/nope' })).status, 404);
    assert.equal((await send(port, { method: 'POST', path: '/healthz' })).status, 404);
  } finally { await stack.stop(); }
});

test('(l) an unexpected Host is rejected with 403 on /mcp but health probes still answer', async () => {
  const stack = await startStack();
  try {
    const port = new URL(stack.url).port;
    const evil = await send(port, { method: 'POST', path: '/mcp', headers: mcpHeaders({ Host: 'evil.example' }), payload: rpc });
    assert.equal(evil.status, 403);
    assert.equal(stack.mesh.calls.length, 0);
    const good = await send(port, { method: 'POST', path: '/mcp', headers: mcpHeaders(), payload: rpc });
    assert.equal(good.status, 200);
    assert.match(good.text, /falcon_connect/);
    const rebinding = await send(port, { method: 'POST', path: '/mcp', headers: mcpHeaders({ Host: 'localhost.evil.example:80' }), payload: rpc });
    assert.equal(rebinding.status, 403);
    assert.equal((await send(port, { path: '/healthz', headers: { Host: 'healthcheck.railway.app' } })).status, 200);
  } finally { await stack.stop(); }
});

test('(l) a browser Origin that is not allowed is rejected with 403', async () => {
  const stack = await startStack();
  try {
    const port = new URL(stack.url).port;
    const evil = await send(port, { method: 'POST', path: '/mcp', headers: mcpHeaders({ Origin: 'https://evil.example' }), payload: rpc });
    assert.equal(evil.status, 403);
    const own = await send(port, { method: 'POST', path: '/mcp', headers: mcpHeaders({ Origin: ORIGIN }), payload: rpc });
    assert.equal(own.status, 200);
  } finally { await stack.stop(); }
});

test('(l) all three methods reach the MCP handler', async () => {
  const stack = await startStack();
  try {
    const port = new URL(stack.url).port;
    for (const method of ['GET', 'DELETE']) {
      const response = await send(port, { method, path: '/mcp', headers: { Accept: 'application/json, text/event-stream' } });
      assert.ok(![403, 404, 500].includes(response.status), `${method} -> ${response.status}`);
    }
  } finally { await stack.stop(); }
});

test('(l) a non-loopback bind accepts only the configured hosts', async () => {
  const mesh = await startFakeMesh();
  const config = testConfig(mesh.url, { FALCON_MCP_HOST: '0.0.0.0', FALCON_MCP_ALLOWED_HOSTS: 'mcp.falcon.test' });
  const { server, close } = createApp({ config });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const port = server.address().port;
  try {
    assert.equal((await send(port, { method: 'POST', path: '/mcp', headers: mcpHeaders({ Host: 'mcp.falcon.test' }), payload: rpc })).status, 200);
    assert.equal((await send(port, { method: 'POST', path: '/mcp', headers: mcpHeaders({ Host: `mcp.falcon.test:${port}` }), payload: rpc })).status, 200);
    assert.equal((await send(port, { method: 'POST', path: '/mcp', headers: mcpHeaders(), payload: rpc })).status, 403, 'raw 127.0.0.1 Host is not allowed on a public bind');
    assert.equal((await send(port, { method: 'POST', path: '/mcp', headers: mcpHeaders({ Host: 'mcp.other.test' }), payload: rpc })).status, 403);
  } finally { await close(); await mesh.close(); }
});

test('(k) startup refuses a non-loopback host without allowed hosts', async () => {
  const server = runServer({ FALCON_MESH_API_URL: 'https://mesh.example.com', FALCON_MCP_ORIGIN: 'https://mcp.example.com', FALCON_MCP_HOST: '0.0.0.0' });
  const exit = await server.exited;
  assert.equal(exit.code, 1);
  assert.match(server.output.stderr, /FALCON_MCP_ALLOWED_HOSTS is required/);
  assert.equal(server.output.stdout, '');
});

test('(k) startup refuses a non-https non-loopback Mesh URL', async () => {
  const server = runServer({ FALCON_MESH_API_URL: 'http://mesh.example.com', FALCON_MCP_ORIGIN: 'https://mcp.example.com' });
  const exit = await server.exited;
  assert.equal(exit.code, 1);
  assert.match(server.output.stderr, /FALCON_MESH_API_URL must use https/);
  assert.equal(server.output.stdout, '');
});

test('(k) startup refuses a missing Mesh URL or origin', async () => {
  const noMesh = runServer({ FALCON_MCP_ORIGIN: 'https://mcp.example.com' });
  assert.equal((await noMesh.exited).code, 1);
  assert.match(noMesh.output.stderr, /FALCON_MESH_API_URL is required/);
  const noOrigin = runServer({ FALCON_MESH_API_URL: 'https://mesh.example.com' });
  assert.equal((await noOrigin.exited).code, 1);
  assert.match(noOrigin.output.stderr, /FALCON_MCP_ORIGIN is required/);
});

test('(k) a valid public configuration starts and stops cleanly on SIGTERM', async () => {
  const server = runServer({
    FALCON_MESH_API_URL: 'https://mesh.example.com', FALCON_MCP_ORIGIN: 'https://mcp.example.com', FALCON_MCP_HOST: '127.0.0.1', FALCON_MCP_ALLOWED_HOSTS: 'mcp.example.com', PORT: '0',
  });
  const port = await server.listening();
  assert.equal((await send(port, { path: '/healthz' })).status, 200);
  const exit = await server.stop();
  assert.equal(exit.code, 0);
});
