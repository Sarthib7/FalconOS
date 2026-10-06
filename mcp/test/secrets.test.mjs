import assert from 'node:assert/strict';
import test from 'node:test';
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';
import { runServer } from './support/child.mjs';
import { ACCESS_TOKEN, IDS, ORIGIN, RESOURCE, SERVICE_SECRET, SIGNED_TX, UNSIGNED_TX, startFakeMesh } from './support/harness.mjs';

test('V153: unexpected MCP handler failures return generic errors without leaking OAuth credentials', async () => {
  const mesh = await startFakeMesh({
    'POST /v1/lending/intents': () => ({ status: 200, body: {} }),
    'GET /v1/lending/intents': () => ({ status: 429, headers: { 'Retry-After': '3' }, body: { error: { code: 'RATE_LIMITED', message: 'Rate limit exceeded. Retry shortly.' } } }),
  });
  const server = runServer({
    FALCON_MESH_API_URL: mesh.url,
    FALCON_MCP_ORIGIN: ORIGIN,
    FALCON_MCP_OAUTH_ISSUER: mesh.url,
    FALCON_MCP_OAUTH_RESOURCE: RESOURCE,
    FALCON_MCP_OAUTH_SERVICE_SECRET: SERVICE_SECRET,
    PORT: '0',
  });
  const client = new Client({ name: 'secrets-test', version: '1.0.0' }, { versionNegotiation: { mode: 'auto' } });
  try {
    const port = await server.listening();
    await client.connect(new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${port}/mcp`), {
      requestInit: { headers: { Authorization: 'Bearer ' + ACCESS_TOKEN } },
    }));
    const call = (name, args) => client.callTool({ name, arguments: args });
    const results = new Map();
    const record = async (label, promise) => { results.set(label, JSON.stringify(await promise)); };

    await record('yield', call('falcon_yield_opportunities', {}));
    await record('refresh', call('falcon_refresh_evidence', {}));
    await record('decision', call('falcon_reserve_decision', { proposedUsdc: '0.5', maxUsdc: '1', minBookLiquidityUsdc: '2', maxEvidenceAgeSeconds: 120 }));
    await record('prepare-unexpected', call('falcon_prepare_transaction', { action: 'redeem', amountUsdc: '0.5', analysisId: IDS.analysis }));
    await record('prepare-bad-amount', call('falcon_prepare_transaction', { action: 'redeem', amountUsdc: '1e3', analysisId: IDS.analysis }));
    await record('submit', call('falcon_submit_signed', { intentId: IDS.intent, signedTransactionBase64: SIGNED_TX }));
    await record('receipt', call('falcon_check_receipt', { intentId: IDS.intent }));
    await record('activity-429', call('falcon_activity', {}));

    const unexpected = JSON.parse(results.get('prepare-unexpected'));
    assert.equal(unexpected.structuredContent.code, 'INTERNAL_ERROR');
    assert.doesNotMatch(JSON.stringify(unexpected), /TypeError|node_modules|at file:/);
    assert.ok(results.get('activity-429').includes('RATE_LIMITED'));
    for (const [label, text] of results) {
      for (const secret of [ACCESS_TOKEN, SERVICE_SECRET]) assert.equal(text.includes(secret), false, label + ' leaks a credential');
      if (label !== 'prepare-unexpected' && label !== 'refresh') assert.equal(text.includes('at file:') || text.includes('node_modules'), false, label + ' has a stack trace');
    }
    assert.equal(results.get('submit').includes(SIGNED_TX), false);
    assert.equal(results.get('prepare-unexpected').includes(mesh.url), false);

    await client.close();
    const exit = await server.stop();
    assert.equal(exit.code, 0);
    const logs = server.output.stdout + '\n' + server.output.stderr;
    for (const secret of [ACCESS_TOKEN, SERVICE_SECRET, SIGNED_TX, UNSIGNED_TX, '0.5', 'redeem']) {
      assert.equal(logs.includes(secret), false, 'logs contain ' + secret.slice(0, 8));
    }
    assert.match(server.output.stderr, /unexpected|MESH_UNAVAILABLE|INTERNAL_ERROR/i);
    assert.doesNotMatch(server.output.stderr, /TypeError|node_modules|at file:/);
    assert.ok(logs.length < 2000, 'logs stay short');
  } finally {
    await client.close().catch(() => {});
    if (server.child.exitCode === null) await server.stop();
    await mesh.close();
  }
});