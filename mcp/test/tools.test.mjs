import assert from 'node:assert/strict';
import test from 'node:test';
import { ACCESS_TOKEN, IDS, SERVICE_SECRET, SIGNED_TX, UNSIGNED_TX, WALLET, startStack } from './support/harness.mjs';
import { TOOL_NAMES } from '../src/tools.mjs';

const prepareArgs = { action: 'supply', amountUsdc: '0.5', analysisId: IDS.analysis, decisionId: IDS.decision };
const body = result => result.structuredContent ?? JSON.parse(result.content[0].text);

async function withStack(options, run) {
  const stack = await startStack(options);
  try { await run(stack); } finally { await stack.stop(); }
}

test('tools/list exposes only session-free OAuth tool schemas', () => withStack({}, async ({ client }) => {
  const { tools } = await client.listTools();
  assert.deepEqual(tools.map(tool => tool.name).sort(), [...TOOL_NAMES].sort());
  assert.equal(tools.length, 7);
  const byName = new Map(tools.map(tool => [tool.name, tool]));
  for (const tool of tools) {
    assert.equal(tool.inputSchema.type, 'object', tool.name);
    assert.equal(tool.inputSchema.additionalProperties, false, tool.name);
    assert.equal(Object.hasOwn(tool.inputSchema.properties, 'session'), false, tool.name);
    assert.equal(tool.inputSchema.required?.includes('session') ?? false, false, tool.name);
    assert.ok(tool.description.length > 20, tool.name);
  }
  assert.equal(Object.hasOwn(byName.get('falcon_prepare_transaction').inputSchema.properties, 'wallet'), false);
  for (const name of ['falcon_yield_opportunities', 'falcon_activity']) assert.equal(byName.get(name).annotations.readOnlyHint, true, name);
  for (const name of ['falcon_prepare_transaction', 'falcon_submit_signed', 'falcon_check_receipt']) {
    assert.equal(byName.get(name).annotations.readOnlyHint, false, name);
    assert.equal(byName.get(name).annotations.destructiveHint, false, name);
  }
  assert.match(client.getInstructions(), /browser sign-in with Phantom/);
  assert.match(client.getInstructions(), /Devnet/);
}));

test('every tool uses the OAuth bearer only in the Authorization header', () => withStack({}, async ({ call, mesh }) => {
  const results = [
    await call('falcon_yield_opportunities', {}),
    await call('falcon_refresh_evidence', {}),
    await call('falcon_reserve_decision', { proposedUsdc: '0.5', maxUsdc: '1', minBookLiquidityUsdc: '2', maxEvidenceAgeSeconds: 120 }),
    await call('falcon_prepare_transaction', prepareArgs),
    await call('falcon_submit_signed', { intentId: IDS.intent, signedTransactionBase64: SIGNED_TX }),
    await call('falcon_check_receipt', { intentId: IDS.intent }),
    await call('falcon_activity', {}),
  ];
  for (const result of results) assert.equal(result.isError, undefined, JSON.stringify(result.content));
  assert.ok(mesh.calls.length >= 12);
  for (const sent of mesh.calls) {
    assert.equal(sent.headers.authorization, 'Bearer ' + ACCESS_TOKEN, sent.method + ' ' + sent.path);
    assert.equal(sent.headers['x-falcon-mcp-service-token'], SERVICE_SECRET, sent.method + ' ' + sent.path);
    assert.equal(sent.raw.includes(ACCESS_TOKEN), false, 'bearer stays out of request body');
    assert.equal(sent.raw.includes(SERVICE_SECRET), false, 'service secret stays out of request body');
    assert.equal(sent.path.includes(ACCESS_TOKEN), false);
    assert.equal(sent.path.includes(SERVICE_SECRET), false);
    assert.equal(Object.hasOwn(sent.body ?? {}, 'session'), false);
    assert.equal(sent.headers.origin, undefined);
  }
}));

test('full journey returns the contract output shapes', () => withStack({}, async ({ call, mesh }) => {
  const yieldResult = body(await call('falcon_yield_opportunities', { }));
  assert.equal(yieldResult.opportunities.length, 1);
  assert.equal(yieldResult.limits.length >= 3, true);
  assert.match(yieldResult.limits.join(' '), /not a realized return/);
  assert.match(yieldResult.limits.join(' '), /guaranteed/);

  const refresh = body(await call('falcon_refresh_evidence', { }));
  assert.equal(refresh.analysisId, IDS.analysis);
  assert.equal(refresh.status, 'OBSERVED');
  assert.equal(refresh.reserveStatus, 'OBSERVED');
  assert.deepEqual(refresh.reserve, { availableLiquidityUnits: '5000000', availableLiquidityUsdc: '5', slot: 123 });
  assert.match(refresh.capturedAt, /^2026-10-05T10:00:0\d\.000Z$/);
  const captures = mesh.calls.filter(item => item.path === '/v1/captures');
  assert.deepEqual(captures.map(item => item.body.connectorId), ['kamino-program-docs', 'solana-devnet-klend', 'solana-devnet-reserve-liquidity']);
  assert.deepEqual(captures.map(item => item.body.expectedRevisionId), [IDS.head, null, null]);
  for (const item of captures) assert.match(item.body.requestId, /^[a-f0-9-]{36}$/);
  const [programAnalysis, reserveAnalysis] = mesh.calls.filter(item => item.path === '/v1/analyses/live');
  assert.deepEqual({ ...programAnalysis.body, requestId: undefined }, { requestId: undefined, observationId: 'observation:live:solana-devnet-klend', maxHops: 3 });
  assert.equal(reserveAnalysis.body.observationId, 'observation:live:solana-devnet-reserve-liquidity');
  const decision = body(await call('falcon_reserve_decision', { proposedUsdc: '0.5', maxUsdc: '1', minBookLiquidityUsdc: '2.25', maxEvidenceAgeSeconds: 120 }));
  assert.equal(decision.decisionId, IDS.decision);
  assert.equal(decision.status, 'REVIEW');
  assert.equal(decision.proposedUsdc, '0.5');
  assert.equal(decision.maxUsdc, '1');
  assert.match(decision.next, /may be prepared/);
  const decisionCall = mesh.calls.find(item => item.path === '/v1/decisions/reserve');
  assert.deepEqual(decisionCall.body.scenario, { proposedUnits: '500000', maxProposedUnits: '1000000', minBookLiquidityUnits: '2250000', maxObservationAgeSeconds: 120 });
  const prepared = body(await call('falcon_prepare_transaction', prepareArgs));
  assert.deepEqual(Object.keys(prepared), ['intentId', 'action', 'amountUsdc', 'wallet', 'unsignedTransactionBase64', 'messageSha256', 'expiresInSeconds', 'decisionId', 'summary', 'next']);
  assert.equal(prepared.intentId, IDS.intent);
  assert.equal(prepared.unsignedTransactionBase64, UNSIGNED_TX);
  assert.equal(prepared.expiresInSeconds, 120);
  assert.equal(prepared.wallet, WALLET);

  const submitted = body(await call('falcon_submit_signed', { intentId: IDS.intent, signedTransactionBase64: SIGNED_TX }));
  assert.equal(submitted.event.kind, 'SUBMITTED');
  assert.equal(submitted.event.data.signature, 'txsig');
  assert.equal(JSON.stringify(submitted).includes(SIGNED_TX), false, 'signed bytes are not echoed');
  const submitCall = mesh.calls.find(item => item.path.endsWith('/submit'));
  assert.equal(submitCall.body.transactionBase64, SIGNED_TX);
  assert.match(submitCall.body.requestId, /^[a-f0-9-]{36}$/);

  const receipt = body(await call('falcon_check_receipt', { intentId: IDS.intent, requestId: IDS.head }));
  assert.equal(receipt.event.data.status, 'CONFIRMED');
  assert.equal(mesh.calls.find(item => item.path.endsWith('/receipt')).body.requestId, IDS.head);

  const activity = body(await call('falcon_activity', { }));
  assert.equal(activity.trail.length, 1);
  assert.equal(activity.trail[0].decision.id, IDS.decision);
  assert.equal(activity.trail[0].decision.status, 'REVIEW');
  assert.equal(activity.trail[0].intent.status, 'SUBMITTED');
  assert.equal(activity.trail[0].intent.amountUsdc, '1');
  assert.deepEqual(activity.counts, { decisions: 1, intents: 1 });
}));

test('falcon_activity returns empty arrays and never invents rows', () => withStack({
  overrides: {
    'GET /v1/decisions': () => ({ status: 200, body: { records: [], limit: 20 } }),
    'GET /v1/lending/intents': () => ({ status: 200, body: { records: [], limit: 20 } }),
  },
}, async ({ call }) => {
  assert.deepEqual(body(await call('falcon_activity', { })), { trail: [], counts: { decisions: 0, intents: 0 }, limit: 20 });
}));

test('falcon_activity keeps decisions without intents and redeems without decisions', () => withStack({
  overrides: {
    'GET /v1/decisions': () => ({ status: 200, body: { records: [{ id: IDS.decision, createdAt: '2026-10-05T09:00:00.000Z', analysis: { status: 'BLOCKED', summary: 'No.', expiresAt: null } }], limit: 20 } }),
    'GET /v1/lending/intents': () => ({ status: 200, body: { records: [{ id: IDS.intent, createdAt: '2026-10-05T10:00:00.000Z', request: { wallet: WALLET, action: 'redeem', inputBaseUnits: '250000' }, status: 'PREPARED', signature: null }], limit: 20 } }),
  },
}, async ({ call }) => {
  const { trail } = body(await call('falcon_activity', { }));
  assert.equal(trail.length, 2);
  assert.equal(trail[0].intent.action, 'redeem');
  assert.equal(trail[0].decision, null);
  assert.equal(trail[0].intent.amountUsdc, '0.25');
  assert.equal(trail[1].intent, null);
  assert.equal(trail[1].decision.status, 'BLOCKED');
}));

test('(f) prepare_transaction rejects supply without decisionId and redeem with one BEFORE any Mesh call', () => withStack({}, async ({ call, mesh }) => {
  const { decisionId, ...withoutDecision } = prepareArgs;
  const supply = await call('falcon_prepare_transaction', withoutDecision);
  assert.equal(supply.isError, true);
  assert.match(supply.content[0].text, /Supply needs a decisionId from a REVIEW result of falcon_reserve_decision/);
  const redeem = await call('falcon_prepare_transaction', { ...prepareArgs, action: 'redeem' });
  assert.equal(redeem.isError, true);
  assert.match(redeem.content[0].text, /decisionId is not allowed for redeem/);
  assert.equal(mesh.calls.some(call => call.path === '/v1/lending/intents'), false, 'no intent for invalid combinations');
}));

test('prepare derives wallet from OAuth identity and rejects a supplied wallet', () => withStack({}, async ({ call, mesh }) => {
  const rejected = await call('falcon_prepare_transaction', { ...prepareArgs, wallet: 'AttackerWallet11111111111111111111111111111' });
  assert.equal(rejected.isError, true);
  assert.match(rejected.content[0].text, /Unrecognized key/);
  assert.equal(mesh.calls.some(item => item.path === '/v1/lending/intents'), false);

  const result = await call('falcon_prepare_transaction', prepareArgs);
  assert.equal(result.isError, undefined);
  const intentCall = mesh.calls.find(item => item.path === '/v1/lending/intents');
  assert.equal(intentCall.body.wallet, WALLET);
  assert.equal(intentCall.body.inputBaseUnits, '500000');
  assert.equal(intentCall.body.decisionId, IDS.decision);
  assert.equal(intentCall.body.action, 'supply');
  assert.equal(body(result).wallet, WALLET);
  assert.deepEqual(Object.keys(intentCall.body).sort(), ['action', 'analysisId', 'decisionId', 'inputBaseUnits', 'requestId', 'wallet']);
  assert.equal(mesh.calls.some(item => item.path === '/v1/auth/wallet/session'), false);
}));

test('(f) a redeem sends no decisionId key; zero and bad amounts are refused locally', () => withStack({}, async ({ call, mesh }) => {
  const { decisionId, ...redeem } = { ...prepareArgs, action: 'redeem', amountUsdc: '0.25' };
  assert.equal((await call('falcon_prepare_transaction', redeem)).isError, undefined);
  const intent = mesh.calls.find(item => item.path === '/v1/lending/intents').body;
  assert.equal(Object.hasOwn(intent, 'decisionId'), false);
  assert.equal(intent.inputBaseUnits, '250000');
  const before = mesh.calls.filter(item => item.path !== '/v1/oauth/introspect').length;
  for (const amountUsdc of ['0', '1e3', '-1', '1.1234567', '', '01', '18446744073709.551616']) {
    assert.equal((await call('falcon_prepare_transaction', { ...redeem, amountUsdc })).isError, true, amountUsdc);
  }
  assert.equal(mesh.calls.filter(item => item.path !== '/v1/oauth/introspect').length, before);
}));

test('(g) Mesh 409 and 429 map to isError with the Mesh code and retryAfterSeconds', () => withStack({
  overrides: {
    'GET /v1/yield/opportunities': () => ({ status: 409, body: { error: { code: 'CONFLICT', message: 'Source head changed. Refresh before capturing it.' } } }),
    'POST /v1/lending/intents/44444444-4444-4444-8444-444444444444/receipt': () => ({ status: 429, headers: { 'Retry-After': '17' }, body: { error: { code: 'RATE_LIMITED', message: 'Rate limit exceeded. Retry shortly.' } } }),
  },
}, async ({ call }) => {
  const conflict = await call('falcon_yield_opportunities', { });
  assert.equal(conflict.isError, true);
  assert.deepEqual(body(conflict), { code: 'CONFLICT', message: 'Source head changed. Refresh before capturing it.' });


  const limited = await call('falcon_check_receipt', { intentId: IDS.intent });
  assert.equal(limited.isError, true);
  assert.deepEqual(body(limited), { code: 'RATE_LIMITED', message: 'Rate limit exceeded. Retry shortly.', retryAfterSeconds: 17 });
  assert.deepEqual(limited.structuredContent, body(limited));
}));

test('(g) an individual Mesh 409 passes through with its own code', async () => {
  await withStack({ overrides: { 'POST /v1/analyses/live': () => ({ status: 409, body: { error: { code: 'CONFLICT', message: 'Analysis request changed.' } } }) } }, async ({ call }) => {
    const result = await call('falcon_refresh_evidence', {});
    assert.equal(result.isError, true);
    assert.deepEqual(body(result), { code: 'CONFLICT', message: 'Analysis request changed.' });
  });
});

test('Mesh error text that is not the documented shape becomes MESH_UNAVAILABLE', () => withStack({
  overrides: { 'GET /v1/yield/opportunities': () => ({ status: 502, body: '<html>Bad gateway https://user:pw@internal/ stack at x</html>' }) },
}, async ({ call }) => {
  const result = await call('falcon_yield_opportunities', { });
  assert.equal(result.isError, true);
  const output = body(result);
  assert.equal(output.code, 'MESH_UNAVAILABLE');
  assert.equal(JSON.stringify(output).includes('internal'), false);
  assert.equal(JSON.stringify(output).includes('stack'), false);
}));


test('(h) a Mesh timeout maps to MESH_UNAVAILABLE', () => withStack({
  overrides: { 'GET /v1/yield/opportunities': () => ({ hang: true }) },
  meshTimeouts: { timeoutMs: 150 },
}, async ({ call }) => {
  const started = Date.now();
  const result = await call('falcon_yield_opportunities', { });
  assert.equal(body(result).code, 'MESH_UNAVAILABLE');
  assert.ok(Date.now() - started < 3000);
}));

test('(j) the per-token limiter returns RATE_LIMITED after the configured count', () => withStack({
  env: { FALCON_MCP_RATE_MAX_PER_TOKEN: '2' },
}, async ({ call, mesh }) => {
  assert.equal((await call('falcon_activity', {})).isError, undefined);
  assert.equal((await call('falcon_yield_opportunities', {})).isError, undefined);
  const before = mesh.calls.filter((item) => item.path !== '/v1/oauth/introspect').length;
  const limited = await call('falcon_activity', {});
  assert.equal(limited.isError, true);
  const output = body(limited);
  assert.equal(output.code, 'RATE_LIMITED');
  assert.ok(Number.isInteger(output.retryAfterSeconds) && output.retryAfterSeconds >= 1 && output.retryAfterSeconds <= 60);
  assert.match(output.message, /Retry in \d+ seconds/);
  assert.equal(mesh.calls.filter((item) => item.path !== '/v1/oauth/introspect').length, before, 'limited calls do not reach data endpoints');
}));

test('(j) the global rate limit covers different MCP tools', () => withStack({
  env: { FALCON_MCP_RATE_MAX_GLOBAL: '2' },
}, async ({ call }) => {
  assert.equal((await call('falcon_activity', {})).isError, undefined);
  assert.equal((await call('falcon_yield_opportunities', {})).isError, undefined);
  assert.equal(body(await call('falcon_check_receipt', { intentId: IDS.intent })).code, 'RATE_LIMITED');
}));


test('a missing analysisId names the tool that returns it, for supply and redeem', () => withStack({}, async ({ call, mesh }) => {
  for (const args of [{ action: 'supply', decisionId: IDS.decision }, { action: 'redeem' }]) {
    const result = await call('falcon_prepare_transaction', { amountUsdc: '0.1', ...args });
    assert.equal(result.isError, true);
    assert.match(result.content[0].text, /analysisId is required\. Get it from falcon_refresh_evidence first\./);
  }
  assert.equal(mesh.calls.some(c => c.path === '/v1/lending/intents'), false);
}));

test('falcon_refresh_evidence returns NO_DATA when reserve analysis is not OBSERVED', () => withStack({
  overrides: {
    'POST /v1/analyses/live': (c) => c.body?.observationId === 'observation:live:solana-devnet-reserve-liquidity'
      ? ({ status: 200, body: { record: { id: IDS.reserveAnalysis, analysis: { status: 'NO_DATA', summary: 'Reserve evidence not ready.' }, graph: { issues: ['Current capture solana-devnet-reserve-liquidity failed: timeout'] } } } })
      : ({ status: 200, body: { record: { id: IDS.analysis, graph: { nodes: [{ id: 'observation:live:solana-devnet-reserve-liquidity', properties: { status: 'ok', slot: 123, availableLiquidityUnits: '5000000' } }] }, analysis: { status: 'OBSERVED', summary: 'Evidence observed.' } } } }),
  },
}, async ({ call }) => {
  const refresh = body(await call('falcon_refresh_evidence', { }));
  assert.equal(refresh.status, 'NO_DATA');
  assert.equal(refresh.reserveStatus, 'NO_DATA');
  assert.equal(refresh.analysisId, IDS.analysis, 'analysisId still from program analysis');
  assert.match(refresh.summary, /solana-devnet-reserve-liquidity/);
  assert.match(refresh.next, /Wait a few seconds and call falcon_refresh_evidence again\./);
  assert.ok(!refresh.next.includes('falcon_reserve_decision'), 'must not suggest reserve_decision when not OBSERVED');
}));

test('usdc schema: malformed input gets format error, not too-large', () => withStack({}, async ({ call }) => {
  const redeem = { action: 'redeem', amountUsdc: '1', analysisId: IDS.analysis };
  for (const badAmount of ['1e3', '0.1234567']) {
    const result = await call('falcon_prepare_transaction', { ...redeem, amountUsdc: badAmount });
    assert.equal(result.isError, true, `${badAmount} must be rejected`);
    const msg = result.content[0].text;
    assert.ok(!msg.includes('too large'), `${badAmount}: must not say "too large", got: ${msg}`);
    assert.ok(msg.includes('decimal USDC string'), `${badAmount}: must say format error, got: ${msg}`);
  }
}));
