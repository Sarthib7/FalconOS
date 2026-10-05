import assert from 'node:assert/strict';
import test from 'node:test';
import bs58 from 'bs58';
import { IDS, ORIGIN, SESSION, SIGNED_TX, UNSIGNED_TX, WALLET, body, startStack } from './support/harness.mjs';
import { TOOL_NAMES } from '../src/tools.mjs';

const AUTHENTICATED = TOOL_NAMES.filter(name => !['falcon_connect', 'falcon_connect_verify'].includes(name));
const signature = Buffer.from(Array.from({ length: 64 }, (_, i) => (i * 5 + 1) % 256));
const prepareArgs = { session: SESSION, action: 'supply', amountUsdc: '0.5', analysisId: IDS.analysis, decisionId: IDS.decision };

async function withStack(options, run) {
  const stack = await startStack(options);
  try { await run(stack); } finally { await stack.stop(); }
}

test('(a) tools/list shows exactly the ten tools with strict schemas and annotations', () => withStack({}, async ({ client }) => {
  const { tools } = await client.listTools();
  assert.deepEqual(tools.map(tool => tool.name).sort(), [...TOOL_NAMES].sort());
  assert.equal(tools.length, 10);
  for (const tool of tools) {
    assert.equal(tool.inputSchema.type, 'object', tool.name);
    assert.equal(tool.inputSchema.additionalProperties, false, `${tool.name} must reject extra keys`);
    assert.ok(tool.description.length > 20, tool.name);
  }
  const byName = new Map(tools.map(tool => [tool.name, tool]));
  for (const name of AUTHENTICATED) {
    const schema = byName.get(name).inputSchema;
    assert.ok(schema.required.includes('session'), `${name} requires session`);
    assert.equal(schema.properties.session.pattern, '^wsi1_[A-Za-z0-9_-]{20,}$');
  }
  assert.deepEqual(Object.keys(byName.get('falcon_connect').inputSchema.properties), ['wallet']);
  assert.deepEqual(Object.keys(byName.get('falcon_connect_verify').inputSchema.properties), ['challengeId', 'signature']);
  assert.equal(Object.hasOwn(byName.get('falcon_prepare_transaction').inputSchema.properties, 'wallet'), false);
  for (const name of ['falcon_yield_opportunities', 'falcon_activity']) assert.equal(byName.get(name).annotations.readOnlyHint, true, name);
  for (const name of ['falcon_prepare_transaction', 'falcon_submit_signed', 'falcon_check_receipt']) {
    assert.equal(byName.get(name).annotations.readOnlyHint, false, name);
    assert.equal(byName.get(name).annotations.destructiveHint, false, name);
  }
  assert.notEqual(byName.get('falcon_disconnect').annotations.readOnlyHint, true);
  assert.match(client.getInstructions(), /Devnet/);
}));

test('(b) falcon_connect sends Origin and the address body, and no Authorization', () => withStack({}, async ({ call, mesh }) => {
  const result = await call('falcon_connect', { wallet: WALLET });
  assert.equal(result.isError, undefined);
  const [sent] = mesh.calls;
  assert.equal(sent.path, '/v1/auth/wallet/challenge');
  assert.equal(sent.method, 'POST');
  assert.equal(sent.headers.origin, ORIGIN);
  assert.equal(sent.headers.authorization, undefined);
  assert.deepEqual(sent.body, { address: WALLET });
  const output = body(result);
  assert.deepEqual(Object.keys(output), ['challengeId', 'message', 'expiresAt', 'next']);
  assert.equal(output.challengeId, IDS.challenge);
  assert.match(output.message, /mcp\.falcon\.test wants you to sign in/);
  assert.match(output.next, /mcp\.falcon\.test/);
  assert.match(output.next, /signMessage/);
  assert.match(output.next, /falcon_connect_verify/);
  assert.deepEqual(result.structuredContent, output);
}));

test('(b) falcon_connect rejects a malformed wallet and extra keys before any Mesh call', () => withStack({}, async ({ call, mesh }) => {
  assert.equal((await call('falcon_connect', { wallet: 'not-a-wallet' })).isError, true);
  assert.equal((await call('falcon_connect', { wallet: WALLET, origin: 'https://evil.example' })).isError, true);
  assert.equal(mesh.calls.length, 0);
}));

test('(c) falcon_connect_verify sends the same canonical base64 for base58 and base64 input', () => withStack({}, async ({ call, mesh }) => {
  for (const input of [signature.toString('base64'), bs58.encode(signature)]) {
    const result = await call('falcon_connect_verify', { challengeId: IDS.challenge, signature: input });
    assert.equal(result.isError, undefined);
    assert.equal(body(result).session, SESSION);
  }
  const verifies = mesh.calls.filter(item => item.path === '/v1/auth/wallet/verify');
  assert.equal(verifies.length, 2);
  for (const sent of verifies) {
    assert.equal(sent.headers.origin, ORIGIN);
    assert.deepEqual(sent.body, { challengeId: IDS.challenge, signature: signature.toString('base64') });
  }
  const output = body(await call('falcon_connect_verify', { challengeId: IDS.challenge, signature: bs58.encode(signature) }));
  assert.deepEqual(Object.keys(output), ['session', 'walletAddress', 'expiresAt', 'note']);
  assert.equal(output.walletAddress, WALLET);
}));

test('(c) falcon_connect_verify rejects wrong lengths without calling Mesh', () => withStack({}, async ({ call, mesh }) => {
  for (const input of [Buffer.alloc(63, 4).toString('base64'), Buffer.alloc(65, 4).toString('base64'), bs58.encode(Buffer.alloc(63, 4)), bs58.encode(Buffer.alloc(65, 4)), 'x'.repeat(88)]) {
    const result = await call('falcon_connect_verify', { challengeId: IDS.challenge, signature: input });
    assert.equal(result.isError, true);
    assert.equal(body(result).code, 'INVALID_INPUT');
  }
  assert.equal(mesh.calls.length, 0);
}));

test('(d) every authenticated tool sends Bearer and never puts the session in a body or path', () => withStack({}, async ({ call, mesh }) => {
  const results = [
    await call('falcon_yield_opportunities', { session: SESSION }),
    await call('falcon_refresh_evidence', { session: SESSION }),
    await call('falcon_reserve_decision', { session: SESSION, proposedUsdc: '0.5', maxUsdc: '1', minBookLiquidityUsdc: '2', maxEvidenceAgeSeconds: 120 }),
    await call('falcon_prepare_transaction', prepareArgs),
    await call('falcon_submit_signed', { session: SESSION, intentId: IDS.intent, signedTransactionBase64: SIGNED_TX }),
    await call('falcon_check_receipt', { session: SESSION, intentId: IDS.intent }),
    await call('falcon_activity', { session: SESSION }),
    await call('falcon_disconnect', { session: SESSION }),
  ];
  for (const result of results) assert.equal(result.isError, undefined, JSON.stringify(result.content));
  assert.ok(mesh.calls.length >= 12);
  for (const sent of mesh.calls) {
    assert.equal(sent.headers.authorization, `Bearer ${SESSION}`, `${sent.method} ${sent.path}`);
    assert.equal(sent.raw.includes(SESSION), false, `body of ${sent.path}`);
    assert.equal(sent.path.includes(SESSION), false);
    assert.equal(Object.hasOwn(sent.body ?? {}, 'session'), false);
    assert.equal(sent.headers.origin !== undefined, sent.path.startsWith('/v1/auth/wallet/'), `Origin only on wallet auth routes: ${sent.path}`);
  }
}));

test('full journey returns the contract output shapes', () => withStack({}, async ({ call, mesh }) => {
  const yieldResult = body(await call('falcon_yield_opportunities', { session: SESSION }));
  assert.equal(yieldResult.opportunities.length, 1);
  assert.equal(yieldResult.limits.length >= 3, true);
  assert.match(yieldResult.limits.join(' '), /not a realized return/);
  assert.match(yieldResult.limits.join(' '), /guaranteed/);

  const refresh = body(await call('falcon_refresh_evidence', { session: SESSION }));
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
  const decision = body(await call('falcon_reserve_decision', { session: SESSION, proposedUsdc: '0.5', maxUsdc: '1', minBookLiquidityUsdc: '2.25', maxEvidenceAgeSeconds: 120 }));
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
  assert.match(prepared.next, /signTransaction \(not signAndSendTransaction\)/);

  const submitted = body(await call('falcon_submit_signed', { session: SESSION, intentId: IDS.intent, signedTransactionBase64: SIGNED_TX }));
  assert.equal(submitted.event.kind, 'SUBMITTED');
  assert.equal(submitted.event.data.signature, 'txsig');
  assert.equal(JSON.stringify(submitted).includes(SIGNED_TX), false, 'signed bytes are not echoed');
  assert.match(submitted.next, /never broadcasts|has not broadcast/);
  const submitCall = mesh.calls.find(item => item.path.endsWith('/submit'));
  assert.equal(submitCall.body.transactionBase64, SIGNED_TX);
  assert.match(submitCall.body.requestId, /^[a-f0-9-]{36}$/);

  const receipt = body(await call('falcon_check_receipt', { session: SESSION, intentId: IDS.intent, requestId: IDS.head }));
  assert.equal(receipt.event.data.status, 'CONFIRMED');
  assert.equal(mesh.calls.find(item => item.path.endsWith('/receipt')).body.requestId, IDS.head);

  const activity = body(await call('falcon_activity', { session: SESSION }));
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
  assert.deepEqual(body(await call('falcon_activity', { session: SESSION })), { trail: [], counts: { decisions: 0, intents: 0 }, limit: 20 });
}));

test('falcon_activity keeps decisions without intents and redeems without decisions', () => withStack({
  overrides: {
    'GET /v1/decisions': () => ({ status: 200, body: { records: [{ id: IDS.decision, createdAt: '2026-10-05T09:00:00.000Z', analysis: { status: 'BLOCKED', summary: 'No.', expiresAt: null } }], limit: 20 } }),
    'GET /v1/lending/intents': () => ({ status: 200, body: { records: [{ id: IDS.intent, createdAt: '2026-10-05T10:00:00.000Z', request: { wallet: WALLET, action: 'redeem', inputBaseUnits: '250000' }, status: 'PREPARED', signature: null }], limit: 20 } }),
  },
}, async ({ call }) => {
  const { trail } = body(await call('falcon_activity', { session: SESSION }));
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
  assert.equal(mesh.calls.length, 0, 'no Mesh request for invalid combinations');
}));

test('(f) prepare_transaction rejects a caller-supplied wallet and reads the wallet from the session endpoint', () => withStack({
  overrides: { 'GET /v1/auth/wallet/session': () => ({ status: 200, body: { walletAddress: 'SessionWallet1111111111111111111111111111111', ownerId: 'o', expiresAt: 'x' } }) },
}, async ({ call, mesh }) => {
  const rejected = await call('falcon_prepare_transaction', { ...prepareArgs, wallet: 'AttackerWallet11111111111111111111111111111' });
  assert.equal(rejected.isError, true);
  assert.match(rejected.content[0].text, /Unrecognized key/);
  assert.equal(mesh.calls.length, 0);

  const ok = await call('falcon_prepare_transaction', prepareArgs);
  assert.equal(ok.isError, undefined);
  assert.deepEqual(mesh.calls.map(item => `${item.method} ${item.path}`), ['GET /v1/auth/wallet/session', 'POST /v1/lending/intents']);
  const intent = mesh.calls[1].body;
  assert.equal(intent.wallet, 'SessionWallet1111111111111111111111111111111');
  assert.equal(intent.inputBaseUnits, '500000');
  assert.equal(intent.decisionId, IDS.decision);
  assert.equal(intent.action, 'supply');
  assert.equal(body(ok).wallet, 'SessionWallet1111111111111111111111111111111');
  assert.deepEqual(Object.keys(intent).sort(), ['action', 'analysisId', 'decisionId', 'inputBaseUnits', 'requestId', 'wallet']);
}));

test('(f) a redeem sends no decisionId key; zero and bad amounts are refused locally', () => withStack({}, async ({ call, mesh }) => {
  const { decisionId, ...redeem } = { ...prepareArgs, action: 'redeem', amountUsdc: '0.25' };
  assert.equal((await call('falcon_prepare_transaction', redeem)).isError, undefined);
  const intent = mesh.calls.find(item => item.path === '/v1/lending/intents').body;
  assert.equal(Object.hasOwn(intent, 'decisionId'), false);
  assert.equal(intent.inputBaseUnits, '250000');
  const before = mesh.calls.length;
  for (const amountUsdc of ['0', '1e3', '-1', '1.1234567', '', '01', '18446744073709.551616']) {
    assert.equal((await call('falcon_prepare_transaction', { ...redeem, amountUsdc })).isError, true, amountUsdc);
  }
  assert.equal(mesh.calls.length, before);
}));

test('(g) Mesh 409, 401 and 429 map to isError with the Mesh code and retryAfterSeconds', () => withStack({
  overrides: {
    'GET /v1/yield/opportunities': () => ({ status: 409, body: { error: { code: 'CONFLICT', message: 'Source head changed. Refresh before capturing it.' } } }),
    'POST /v1/lending/intents/44444444-4444-4444-8444-444444444444/receipt': () => ({ status: 429, headers: { 'Retry-After': '17' }, body: { error: { code: 'RATE_LIMITED', message: 'Rate limit exceeded. Retry shortly.' } } }),
    'GET /v1/decisions': () => ({ status: 401, body: { error: { code: 'UNAUTHORIZED', message: 'A valid wallet session is required.' } } }),
  },
}, async ({ call }) => {
  const conflict = await call('falcon_yield_opportunities', { session: SESSION });
  assert.equal(conflict.isError, true);
  assert.deepEqual(body(conflict), { code: 'CONFLICT', message: 'Source head changed. Refresh before capturing it.' });

  const unauthorized = await call('falcon_activity', { session: SESSION });
  assert.equal(unauthorized.isError, true);
  assert.deepEqual(body(unauthorized), { code: 'UNAUTHORIZED', message: 'A valid wallet session is required. Sign in again with falcon_connect, then falcon_connect_verify.' });

  const limited = await call('falcon_check_receipt', { session: SESSION, intentId: IDS.intent });
  assert.equal(limited.isError, true);
  assert.deepEqual(body(limited), { code: 'RATE_LIMITED', message: 'Rate limit exceeded. Retry shortly.', retryAfterSeconds: 17 });
  assert.deepEqual(limited.structuredContent, body(limited));
}));

test('(g) individual 409 and 401 pass through with their own codes', async () => {
  await withStack({ overrides: { 'POST /v1/analyses/live': () => ({ status: 409, body: { error: { code: 'CONFLICT', message: 'Analysis request changed.' } } }) } }, async ({ call }) => {
    const result = await call('falcon_refresh_evidence', { session: SESSION });
    assert.equal(result.isError, true);
    assert.deepEqual(body(result), { code: 'CONFLICT', message: 'Analysis request changed.' });
  });
  await withStack({}, async ({ call }) => {
    const wrong = await call('falcon_yield_opportunities', { session: 'wsi1_AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA' });
    assert.equal(wrong.isError, true);
    assert.deepEqual(body(wrong), { code: 'UNAUTHORIZED', message: 'A valid wallet session is required. Sign in again with falcon_connect, then falcon_connect_verify.' });
  });
});

test('Mesh error text that is not the documented shape becomes MESH_UNAVAILABLE', () => withStack({
  overrides: { 'GET /v1/yield/opportunities': () => ({ status: 502, body: '<html>Bad gateway https://user:pw@internal/ stack at x</html>' }) },
}, async ({ call }) => {
  const result = await call('falcon_yield_opportunities', { session: SESSION });
  assert.equal(result.isError, true);
  const output = body(result);
  assert.equal(output.code, 'MESH_UNAVAILABLE');
  assert.equal(JSON.stringify(output).includes('internal'), false);
  assert.equal(JSON.stringify(output).includes('stack'), false);
}));

test('(h) a Mesh connection failure maps to MESH_UNAVAILABLE', async () => {
  const stack = await startStack();
  try {
    await stack.mesh.close();
    const result = await stack.call('falcon_yield_opportunities', { session: SESSION });
    assert.equal(result.isError, true);
    assert.deepEqual(Object.keys(body(result)).sort(), ['code', 'message']);
    assert.equal(body(result).code, 'MESH_UNAVAILABLE');
    assert.equal(JSON.stringify(result).includes('127.0.0.1'), false, 'no URL in the error');
  } finally { await stack.stop(); }
});

test('(h) a Mesh timeout maps to MESH_UNAVAILABLE', () => withStack({
  overrides: { 'GET /v1/yield/opportunities': () => ({ hang: true }) },
  meshTimeouts: { timeoutMs: 150 },
}, async ({ call }) => {
  const started = Date.now();
  const result = await call('falcon_yield_opportunities', { session: SESSION });
  assert.equal(body(result).code, 'MESH_UNAVAILABLE');
  assert.ok(Date.now() - started < 3000);
}));

test('(j) the per-session limiter returns RATE_LIMITED after the configured count', () => withStack({
  env: { FALCON_MCP_RATE_MAX_PER_SESSION: '2' },
}, async ({ call, mesh }) => {
  assert.equal((await call('falcon_activity', { session: SESSION })).isError, undefined);
  assert.equal((await call('falcon_yield_opportunities', { session: SESSION })).isError, undefined);
  const before = mesh.calls.length;
  const limited = await call('falcon_activity', { session: SESSION });
  assert.equal(limited.isError, true);
  const output = body(limited);
  assert.equal(output.code, 'RATE_LIMITED');
  assert.ok(Number.isInteger(output.retryAfterSeconds) && output.retryAfterSeconds >= 1 && output.retryAfterSeconds <= 60);
  assert.match(output.message, /Retry in \d+ seconds/);
  assert.equal(mesh.calls.length, before, 'limited calls do not reach Mesh');
  const other = await call('falcon_activity', { session: 'wsi1_BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB' });
  assert.equal(body(other).code, 'UNAUTHORIZED', 'another session has its own budget and reaches Mesh');
}));

test('(j) falcon_connect is limited per wallet and everything shares the global ceiling', async () => {
  await withStack({ env: { FALCON_MCP_RATE_MAX_CONNECT: '2' } }, async ({ call }) => {
    assert.equal((await call('falcon_connect', { wallet: WALLET })).isError, undefined);
    assert.equal((await call('falcon_connect', { wallet: WALLET })).isError, undefined);
    assert.equal(body(await call('falcon_connect', { wallet: WALLET })).code, 'RATE_LIMITED');
    assert.equal((await call('falcon_connect', { wallet: 'So11111111111111111111111111111111111111112' })).isError, undefined);
  });
  await withStack({ env: { FALCON_MCP_RATE_MAX_GLOBAL: '2' } }, async ({ call }) => {
    assert.equal((await call('falcon_connect', { wallet: WALLET })).isError, undefined);
    assert.equal((await call('falcon_activity', { session: SESSION })).isError, undefined);
    const limited = await call('falcon_yield_opportunities', { session: 'wsi1_CCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCC' });
    assert.equal(body(limited).code, 'RATE_LIMITED');
  });
});

test('(c) falcon_connect_verify UNAUTHORIZED adds retry hint without leaking check details', () => withStack({
  overrides: { 'POST /v1/auth/wallet/verify': () => ({ status: 401, body: { error: { code: 'UNAUTHORIZED', message: 'A valid wallet session is required.' } } }) },
}, async ({ call }) => {
  const result = await call('falcon_connect_verify', { challengeId: IDS.challenge, signature: Buffer.alloc(64, 4).toString('base64') });
  assert.equal(result.isError, true);
  const output = body(result);
  assert.equal(output.code, 'UNAUTHORIZED');
  assert.match(output.message, /Call falcon_connect for a new challenge and sign it again\./);
}));

test('(b2) session tools turn UNAUTHORIZED into a sign-in-again step', () => withStack({
  overrides: { 'GET /v1/decisions': () => ({ status: 401, body: { error: { code: 'UNAUTHORIZED', message: 'A valid wallet session is required.' } } }) },
}, async ({ call }) => {
  const result = await call('falcon_activity', { session: SESSION });
  assert.equal(result.isError, true);
  assert.deepEqual(body(result), { code: 'UNAUTHORIZED', message: 'A valid wallet session is required. Sign in again with falcon_connect, then falcon_connect_verify.' });
}));

test('a missing analysisId names the tool that returns it, for supply and redeem', () => withStack({}, async ({ call, mesh }) => {
  for (const args of [{ action: 'supply', decisionId: IDS.decision }, { action: 'redeem' }]) {
    const result = await call('falcon_prepare_transaction', { session: SESSION, amountUsdc: '0.1', ...args });
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
  const refresh = body(await call('falcon_refresh_evidence', { session: SESSION }));
  assert.equal(refresh.status, 'NO_DATA');
  assert.equal(refresh.reserveStatus, 'NO_DATA');
  assert.equal(refresh.analysisId, IDS.analysis, 'analysisId still from program analysis');
  assert.match(refresh.summary, /solana-devnet-reserve-liquidity/);
  assert.match(refresh.next, /Wait a few seconds and call falcon_refresh_evidence again\./);
  assert.ok(!refresh.next.includes('falcon_reserve_decision'), 'must not suggest reserve_decision when not OBSERVED');
}));

test('usdc schema: malformed input gets format error, not too-large', () => withStack({}, async ({ call }) => {
  const redeem = { session: SESSION, action: 'redeem', amountUsdc: '1', analysisId: IDS.analysis };
  for (const badAmount of ['1e3', '0.1234567']) {
    const result = await call('falcon_prepare_transaction', { ...redeem, amountUsdc: badAmount });
    assert.equal(result.isError, true, `${badAmount} must be rejected`);
    const msg = result.content[0].text;
    assert.ok(!msg.includes('too large'), `${badAmount}: must not say "too large", got: ${msg}`);
    assert.ok(msg.includes('decimal USDC string'), `${badAmount}: must say format error, got: ${msg}`);
  }
}));
