import assert from 'node:assert/strict';
import { once } from 'node:events';
import { request } from 'node:http';
import test from 'node:test';
import { runServer } from './support/child.mjs';
import { ACCESS_TOKEN, ORIGIN, RESOURCE, SERVICE_SECRET, startFakeMesh, startStack, testConfig } from './support/harness.mjs';
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
const auth = { Authorization: 'Bearer ' + ACCESS_TOKEN };
const startupOAuth = {
  FALCON_MCP_OAUTH_ISSUER: 'https://api.example.com',
  FALCON_MCP_OAUTH_RESOURCE: 'https://mcp.example.com/mcp',
  FALCON_MCP_OAUTH_SERVICE_SECRET: SERVICE_SECRET,
};

test('(l) health stays live and readiness follows Mesh', async () => {
  let ready = true;
  const stack = await startStack({ overrides: { 'GET /readyz': () => (ready ? { status: 200, body: { status: 'ready' } } : { status: 503, body: { error: { code: 'STORAGE_UNAVAILABLE', message: 'x' } } }) } });
  try {
    const port = new URL(stack.url).port;
    assert.equal((await send(port, { path: '/healthz' })).status, 200);
    assert.deepEqual(JSON.parse((await send(port, { path: '/healthz' })).text), { status: 'alive' });
    assert.equal((await send(port, { path: '/readyz' })).status, 200);
    ready = false;
    assert.equal((await send(port, { path: '/readyz' })).status, 503);
    ready = true;
    await stack.mesh.close();
    const down = await send(port, { path: '/readyz' });
    assert.equal(down.status, 503);
    assert.equal(down.text.includes('127.0.0.1'), false);
    assert.equal((await send(port, { path: '/healthz' })).status, 200);
    assert.equal((await send(port, { path: '/nope' })).status, 404);
    assert.equal((await send(port, { method: 'POST', path: '/healthz' })).status, 404);
  } finally { await stack.stop(); }
});

test('RFC 9728 metadata names the exact resource and issuer', async () => {
  const stack = await startStack();
  try {
    const port = new URL(stack.url).port;
    const response = await send(port, { path: '/.well-known/oauth-protected-resource/mcp' });
    assert.equal(response.status, 200);
    assert.deepEqual(JSON.parse(response.text), {
      resource: RESOURCE, authorization_servers: [stack.config.oauthIssuer], scopes_supported: ['falcon'], resource_name: 'FalconOS MCP',
    });
    assert.equal(JSON.parse((await send(port, { path: '/.well-known/oauth-protected-resource' })).text).resource, RESOURCE);
  } finally { await stack.stop(); }
});

test('missing or invalid bearer gets OAuth challenge before Mesh tool traffic', async () => {
  const stack = await startStack();
  try {
    const port = new URL(stack.url).port;
    const baselineCalls = stack.mesh.calls.length;
    const baselineIntrospections = stack.mesh.calls.filter(call => call.pathname === '/v1/oauth/introspect').length;
    const missing = await send(port, { method: 'POST', path: '/mcp', headers: mcpHeaders(), payload: rpc });
    assert.equal(missing.status, 401);
    assert.match(missing.headers['www-authenticate'], /resource_metadata=/);
    assert.match(missing.headers['www-authenticate'], /oauth-protected-resource\/mcp/);
    assert.equal(stack.mesh.calls.length, baselineCalls);
    const invalid = await send(port, { method: 'POST', path: '/mcp', headers: mcpHeaders({ Authorization: 'Bearer fao1_' + 'C'.repeat(43) }), payload: rpc });
    assert.equal(invalid.status, 401);
    assert.match(invalid.headers['www-authenticate'], /error="invalid_token"/);
    assert.equal(stack.mesh.calls.filter(call => call.pathname === '/v1/oauth/introspect').length, baselineIntrospections + 1);
  } finally { await stack.stop(); }
});
test('OAuth introspection outage returns a sanitized service error before MCP tools run', async () => {
  const overrides = {};
  const stack = await startStack({ overrides });
  try {
    overrides['POST /v1/oauth/introspect'] = () => ({ status: 503, body: { error: { code: 'STORAGE_UNAVAILABLE', message: 'private storage detail' } } });
    const port = new URL(stack.url).port;
    const response = await send(port, { method: 'POST', path: '/mcp', headers: mcpHeaders(auth), payload: rpc });
    assert.equal(response.status, 503);
    assert.deepEqual(JSON.parse(response.text), { error: { code: 'AUTH_UNAVAILABLE', message: 'Falcon token verification is unavailable.' } });
    assert.equal(response.text.includes('private'), false);
    assert.equal(stack.mesh.calls.filter(call => call.pathname !== '/v1/oauth/introspect').length, 0);
  } finally { await stack.stop(); }
});


test('Host validation runs before OAuth introspection and health probes ignore Host', async () => {
  const stack = await startStack();
  try {
    const port = new URL(stack.url).port;
    const baselineCalls = stack.mesh.calls.length;
    const evil = await send(port, { method: 'POST', path: '/mcp', headers: mcpHeaders({ Host: 'evil.example', ...auth }), payload: rpc });
    assert.equal(evil.status, 403);
    assert.equal(stack.mesh.calls.length, baselineCalls);
    const good = await send(port, { method: 'POST', path: '/mcp', headers: mcpHeaders(auth), payload: rpc });
    assert.equal(good.status, 200);
    assert.match(good.text, /falcon_yield_opportunities/);
    assert.doesNotMatch(good.text, /falcon_connect/);
    const rebinding = await send(port, { method: 'POST', path: '/mcp', headers: mcpHeaders({ Host: 'localhost.evil.example:80', ...auth }), payload: rpc });
    assert.equal(rebinding.status, 403);
    assert.equal((await send(port, { path: '/healthz', headers: { Host: 'healthcheck.railway.app' } })).status, 200);
  } finally { await stack.stop(); }
});

test('disallowed browser origins are rejected before OAuth introspection', async () => {
  const stack = await startStack();
  try {
    const port = new URL(stack.url).port;
    const baselineCalls = stack.mesh.calls.length;
    const evil = await send(port, { method: 'POST', path: '/mcp', headers: mcpHeaders({ Origin: 'https://evil.example', ...auth }), payload: rpc });
    assert.equal(evil.status, 403);
    assert.equal(stack.mesh.calls.length, baselineCalls);
    const own = await send(port, { method: 'POST', path: '/mcp', headers: mcpHeaders({ Origin: ORIGIN, ...auth }), payload: rpc });
    assert.equal(own.status, 200);
  } finally { await stack.stop(); }
});

test('all MCP HTTP methods require a bearer before reaching the handler', async () => {
  const stack = await startStack();
  try {
    const port = new URL(stack.url).port;
    for (const method of ['GET', 'POST', 'DELETE']) {
      const response = await send(port, { method, path: '/mcp', headers: mcpHeaders(), payload: method === 'POST' ? rpc : undefined });
      assert.equal(response.status, 401, method);
      assert.match(response.headers['www-authenticate'], /resource_metadata=/, method);
    }
  } finally { await stack.stop(); }
});

test('a non-loopback bind accepts only configured hosts after bearer auth', async () => {
  const mesh = await startFakeMesh();
  const config = testConfig(mesh.url, { FALCON_MCP_HOST: '0.0.0.0', FALCON_MCP_ALLOWED_HOSTS: 'mcp.falcon.test' });
  const { server, close } = createApp({ config });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const port = server.address().port;
  try {
    assert.equal((await send(port, { method: 'POST', path: '/mcp', headers: mcpHeaders({ Host: 'mcp.falcon.test', ...auth }), payload: rpc })).status, 200);
    assert.equal((await send(port, { method: 'POST', path: '/mcp', headers: mcpHeaders({ Host: 'mcp.falcon.test:' + port, ...auth }), payload: rpc })).status, 200);
    assert.equal((await send(port, { method: 'POST', path: '/mcp', headers: mcpHeaders(auth), payload: rpc })).status, 403);
    assert.equal((await send(port, { method: 'POST', path: '/mcp', headers: mcpHeaders({ Host: 'mcp.other.test', ...auth }), payload: rpc })).status, 403);
  } finally { await close(); await mesh.close(); }
});

test('startup refuses a non-loopback host without allowed hosts', async () => {
  const server = runServer({ FALCON_MESH_API_URL: 'https://mesh.example.com', FALCON_MCP_ORIGIN: 'https://mcp.example.com', FALCON_MCP_HOST: '0.0.0.0', ...startupOAuth });
  assert.equal((await server.exited).code, 1);
  assert.match(server.output.stderr, /FALCON_MCP_ALLOWED_HOSTS is required/);
  assert.equal(server.output.stdout, '');
});

test('startup refuses a non-https non-loopback Mesh URL', async () => {
  const server = runServer({ FALCON_MESH_API_URL: 'http://mesh.example.com', FALCON_MCP_ORIGIN: 'https://mcp.example.com', ...startupOAuth });
  assert.equal((await server.exited).code, 1);
  assert.match(server.output.stderr, /FALCON_MESH_API_URL must use https/);
  assert.equal(server.output.stdout, '');
});

test('startup refuses a missing Mesh URL or origin', async () => {
  const noMesh = runServer({ FALCON_MCP_ORIGIN: 'https://mcp.example.com', ...startupOAuth });
  assert.equal((await noMesh.exited).code, 1);
  assert.match(noMesh.output.stderr, /FALCON_MESH_API_URL is required/);
  const noOrigin = runServer({ FALCON_MESH_API_URL: 'https://mesh.example.com', ...startupOAuth });
  assert.equal((await noOrigin.exited).code, 1);
  assert.match(noOrigin.output.stderr, /FALCON_MCP_ORIGIN is required/);
});

test('a valid OAuth configuration starts and stops cleanly on SIGTERM', async () => {
  const server = runServer({
    FALCON_MESH_API_URL: 'https://mesh.example.com', FALCON_MCP_ORIGIN: 'https://mcp.example.com', FALCON_MCP_HOST: '127.0.0.1', FALCON_MCP_ALLOWED_HOSTS: 'mcp.example.com', PORT: '0', ...startupOAuth,
  });
  const port = await server.listening();
  assert.equal((await send(port, { path: '/healthz' })).status, 200);
  assert.equal((await server.stop()).code, 0);
});
