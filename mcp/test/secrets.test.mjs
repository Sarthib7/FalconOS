import assert from 'node:assert/strict';
import test from 'node:test';
import bs58 from 'bs58';
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';
import { runServer } from './support/child.mjs';
import { IDS, ORIGIN, SESSION, SIGNED_TX, UNSIGNED_TX, startFakeMesh } from './support/harness.mjs';

const signature = Buffer.from(Array.from({ length: 64 }, (_, i) => (i * 11 + 5) % 256));

test('(i) the session and signatures never reach stdout, stderr, errors or any result except falcon_connect_verify', async () => {
  const mesh = await startFakeMesh({
    // Forces an unexpected handler failure: a 200 without the record the tool destructures.
    'POST /v1/lending/intents': () => ({ status: 200, body: {} }),
    'GET /v1/lending/intents': () => ({ status: 429, headers: { 'Retry-After': '3' }, body: { error: { code: 'RATE_LIMITED', message: 'Rate limit exceeded. Retry shortly.' } } }),
  });
  const server = runServer({ FALCON_MESH_API_URL: mesh.url, FALCON_MCP_ORIGIN: ORIGIN, PORT: '0' });
  const client = new Client({ name: 'secrets-test', version: '1.0.0' }, { versionNegotiation: { mode: 'auto' } });
  try {
    const port = await server.listening();
    await client.connect(new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${port}/mcp`)));
    const call = (name, args) => client.callTool({ name, arguments: args });
    const results = new Map();
    const record = async (label, promise) => { results.set(label, JSON.stringify(await promise)); };

    await record('connect', call('falcon_connect', { wallet: '9xQeWvG816bUx9EPjHmaT23yvVM2ZWbrrpZb9PusVFin' }));
    await record('verify', call('falcon_connect_verify', { challengeId: IDS.challenge, signature: bs58.encode(signature) }));
    await record('verify-bad', call('falcon_connect_verify', { challengeId: IDS.challenge, signature: bs58.encode(signature.subarray(1)) }));
    await record('yield', call('falcon_yield_opportunities', { session: SESSION }));
    await record('refresh', call('falcon_refresh_evidence', { session: SESSION }));
    await record('decision', call('falcon_reserve_decision', { session: SESSION, proposedUsdc: '0.5', maxUsdc: '1', minBookLiquidityUsdc: '2', maxEvidenceAgeSeconds: 120 }));
    await record('prepare-unexpected', call('falcon_prepare_transaction', { session: SESSION, action: 'redeem', amountUsdc: '0.5', analysisId: IDS.analysis }));
    await record('prepare-bad-amount', call('falcon_prepare_transaction', { session: SESSION, action: 'redeem', amountUsdc: '1e3', analysisId: IDS.analysis }));
    await record('prepare-unknown-key', call('falcon_prepare_transaction', { session: SESSION, action: 'redeem', amountUsdc: '1', analysisId: IDS.analysis, wallet: 'x' }));
    await record('submit', call('falcon_submit_signed', { session: SESSION, intentId: IDS.intent, signedTransactionBase64: SIGNED_TX }));
    await record('receipt', call('falcon_check_receipt', { session: SESSION, intentId: IDS.intent }));
    await record('activity-429', call('falcon_activity', { session: SESSION }));
    await record('bad-session-shape', call('falcon_activity', { session: `${SESSION.slice(0, 20)} bad shape` }));
    await record('wrong-session', call('falcon_activity', { session: 'wsi1_AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA' }));
    await record('disconnect', call('falcon_disconnect', { session: SESSION }));

    assert.ok(results.get('verify').includes(SESSION), 'falcon_connect_verify returns the session');
    assert.ok(results.get('prepare-unexpected').includes('INTERNAL_ERROR'), 'the unexpected-failure path was exercised');
    assert.ok(results.get('activity-429').includes('RATE_LIMITED'));
    const forms = [signature.toString('base64'), bs58.encode(signature), SESSION];
    for (const [label, text] of results) {
      for (const secret of forms) {
        if (label === 'verify' && secret === SESSION) continue;
        assert.equal(text.includes(secret), false, `${label} leaks a secret`);
      }
      if (label !== 'prepare-unexpected' && label !== 'refresh') assert.equal(text.includes('at file:') || text.includes('node_modules'), false, `${label} has a stack trace`);
    }
    assert.equal(results.get('submit').includes(SIGNED_TX), false);
    assert.ok(results.get('prepare-unexpected').includes('"isError":true'));
    assert.equal(results.get('prepare-unexpected').includes(mesh.url), false);

    await client.close();
    const exit = await server.stop();
    assert.equal(exit.code, 0);
    const logs = `${server.output.stdout}\n${server.output.stderr}`;
    for (const secret of [...forms, SIGNED_TX, UNSIGNED_TX, '0.5', 'redeem']) assert.equal(logs.includes(secret), false, `logs contain ${secret.slice(0, 8)}`);
    assert.match(server.output.stderr, /unexpected/);
    assert.ok(logs.length < 2000, 'logs stay short');
  } finally {
    await client.close().catch(() => {});
    if (server.child.exitCode === null) await server.stop();
    await mesh.close();
  }
});
