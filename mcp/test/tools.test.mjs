import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import bs58 from 'bs58';
import packageJson from '../package.json' with { type: 'json' };
import { IDS, ORIGIN, SESSION, SIGNED_TX, TRANSACTION_SIGNATURE, UNSIGNED_TX, WALLET, body, preparedRecord, startStack } from './support/harness.mjs';
import { TOOL_NAMES, registerFalconTools } from '../src/tools.mjs';
import { fingerprintInputSchemas } from '../src/schema-fingerprint.mjs';

const PUBLIC_TOOLS = ['falcon_public_graph', 'falcon_wallet_status', 'falcon_decode_transaction', 'falcon_self_test'];
const AUTHENTICATED = TOOL_NAMES.filter(name => !['falcon_connect', 'falcon_connect_verify', ...PUBLIC_TOOLS].includes(name));
const signature = Buffer.from(Array.from({ length: 64 }, (_, i) => (i * 5 + 1) % 256));
const prepareArgs = { session: SESSION, action: 'supply', amountUsdc: '0.5', analysisId: IDS.analysis, decisionId: IDS.decision };

async function withStack(options, run) {
  const stack = await startStack(options);
  try { await run(stack); } finally { await stack.stop(); }
}

function preflightFixture(now = Date.now()) {
  const record = preparedRecord({ body: { wallet: WALLET, action: 'supply', inputBaseUnits: '500000', decisionId: IDS.decision } }, {}, now);
  return { ...record.intent, createdAt: record.createdAt };
}

function prepareOverride(options = {}) {
  return {
    overrides: { 'POST /v1/public/lending/intents': () => {
      const fixture = preflightFixture();
      return { status: 200, body: { record: { id: IDS.intent, createdAt: fixture.createdAt, request: { decisionId: IDS.decision }, intent: {
        ...fixture, action: 'supply', wallet: WALLET, inputBaseUnits: '500000', estimatedAmounts: { liquidityBaseUnits: '500000' },
        evidenceSource: 'public', publicGraphRevision: IDS.head, sourceAnalysisId: IDS.analysis, ...options.intent,
      } } } };
    } },
    clock: () => new Date(),
  };
}

test('prepare returns a bounded Falcon RPC preflight tied to the serialized transaction message and fails closed', () => withStack(prepareOverride(), async ({ call }) => {
  const valid = await call('falcon_prepare_transaction', prepareArgs);
  assert.equal(valid.isError, undefined, JSON.stringify(body(valid)));
  const output = body(valid);
  assert.deepEqual(output.preflight.network, preflightFixture().preflight.network);
  assert.equal(output.preflight.messageSha256, preflightFixture().preflight.messageSha256);
  assert.match(output.preflightTrust, /Falcon RPC verified.*not independent.*not human approval/i);
  for (const bad of [
    { intent: { preflight: undefined } },
    { intent: { preflight: { ...preflightFixture().preflight, messageSha256: 'ab'.repeat(32) } } },
    { intent: { preflight: { ...preflightFixture().preflight, costs: { ...preflightFixture().preflight.costs, totalSolLamports: 'NaN' } } } },
    { intent: { preflight: { ...preflightFixture().preflight, costs: { ...preflightFixture().preflight.costs, feeLamports: '18446744073709551616', rentLamports: '0', totalSolLamports: '18446744073709551616', walletSolBalanceLamports: '18446744073709551616' } } } },
    { intent: { preflight: { ...preflightFixture().preflight, privateRpcTrace: 'https://user:pass@secret.invalid/rpc?key=secret' } } },
  ]) {
    const stack = await startStack(prepareOverride(bad));
    try {
      const result = await stack.call('falcon_prepare_transaction', prepareArgs);
      assert.equal(result.isError, true);
      assert.doesNotMatch(result.content[0].text, /secret.invalid|user:pass|privateRpcTrace/);
    } finally { await stack.stop(); }
  }
}));

test('tools/list exposes exactly fourteen strict tools and the action-dependent prepare schema', () => withStack({}, async ({ client }) => {
  const { tools } = await client.listTools();
  assert.deepEqual(tools.map(tool => tool.name).sort(), [...TOOL_NAMES].sort());
  assert.equal(tools.length, 14);
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
  for (const name of PUBLIC_TOOLS) assert.equal(byName.get(name).inputSchema.required?.includes('session') ?? false, false, name);
  assert.deepEqual(Object.keys(byName.get('falcon_public_graph').inputSchema.properties), []);
  assert.deepEqual(Object.keys(byName.get('falcon_connect').inputSchema.properties), ['wallet']);
  assert.deepEqual(Object.keys(byName.get('falcon_connect_verify').inputSchema.properties), ['challengeId', 'signature']);
  const prepare = byName.get('falcon_prepare_transaction').inputSchema;
  const reserveDecision = byName.get('falcon_reserve_decision').inputSchema;
  assert.equal(Object.hasOwn(prepare.properties, 'wallet'), false);
  assert.equal(prepare.additionalProperties, false);
  assert.deepEqual(prepare.required, ['session', 'action', 'analysisId']);
  assert.deepEqual(reserveDecision.required, ['session', 'analysisId', 'proposedUsdc', 'maxUsdc', 'minBookLiquidityUsdc', 'maxEvidenceAgeSeconds']);
  assert.equal(reserveDecision.properties.analysisId.pattern, prepare.properties.analysisId.pattern);
  const supply = prepare.allOf.find(rule => rule.if?.properties?.action?.const === 'supply');
  const redeem = prepare.allOf.find(rule => rule.if?.properties?.action?.const === 'redeem');
  assert.ok(supply.then.required.includes('amountUsdc') && supply.then.required.includes('decisionId'));
  assert.ok(supply.then.not.required.includes('amountReceiptTokens'));
  assert.ok(redeem.then.required.includes('amountReceiptTokens'));
  assert.ok(redeem.then.not.anyOf.some(rule => rule.required.includes('amountUsdc')));
  assert.ok(redeem.then.not.anyOf.some(rule => rule.required.includes('decisionId')));
  assert.equal(prepare.properties.session.maxLength, 256);
  assert.equal(prepare.properties.analysisId.pattern, prepare.properties.decisionId.pattern);
  const statusSchema = byName.get('falcon_wallet_status').inputSchema;
  assert.equal(statusSchema.properties.chain.default, 'solana');
  assert.equal(statusSchema.properties.network.default, 'devnet');
  const decodeSchema = byName.get('falcon_decode_transaction').inputSchema;
  assert.equal(decodeSchema.properties.transactionBase64.maxLength, 1644);
  assert.equal(decodeSchema.properties.chain.default, 'solana');
  assert.equal(decodeSchema.properties.network.default, 'devnet');
  for (const name of ['falcon_yield_opportunities', 'falcon_activity', ...PUBLIC_TOOLS]) assert.equal(byName.get(name).annotations.readOnlyHint, true, name);
  for (const name of ['falcon_prepare_transaction', 'falcon_submit_signed', 'falcon_check_receipt']) {
    assert.equal(byName.get(name).annotations.readOnlyHint, false, name);
    assert.equal(byName.get(name).annotations.destructiveHint, false, name);
  }
  assert.notEqual(byName.get('falcon_disconnect').annotations.readOnlyHint, true);
  assert.match(client.getInstructions(), /Devnet/);
  assert.match(client.getInstructions(), /human alone/);
  assert.match(client.getInstructions(), /Reuse an existing unexpired session/);
}));
test('falcon_public_graph exposes only the fixed metadata-only graph without a signer or session', () => withStack({
  overrides: {
    'GET /v1/public/graph/live': () => ({ status: 200, body: {
      scope: 'public-market-evidence', chain: 'solana', network: 'devnet',
      graph: {
        revisionId: IDS.head,
        sources: [{ sourceKey: 'live:solana-devnet-klend', revisionId: 'source-revision-1', content: 'private-marker', rawExchanges: [{ requestBody: 'private-marker' }], exchanges: [{ bodyBase64: 'private-marker' }], ownerRecord: { id: 'private-marker' }, record: { id: 'private-marker' }, wallet: WALLET, session: SESSION, customGraphId: 'private-marker' }],
        nodes: [{ id: 'market', kind: 'source', properties: { status: 'OBSERVED', content: 'private-marker', ownerId: 'private-marker', privateGraphData: 'private-marker', privateData: 'private-marker', customData: 'private-marker' } }],
        edges: [], issues: [],
      },
      programAnalysis: { status: 'OBSERVED', summary: 'Program observed.', policyVersion: 'mesh-public-evidence/1', content: 'private-marker' },
      reserveAnalysis: { status: 'OBSERVED', summary: 'Reserve observed.', availableLiquidityUnits: '5000000', slot: 123, policyVersion: 'mesh-reserve-liquidity/1' },
      status: 'OBSERVED', policyDefinitionId: 'decision:mesh-reserve-scenario/1', policyVersion: 'mesh-reserve-scenario/2',
      maxSupplyBaseUnits: '1000000', customGraphsSupported: false, executionReady: false,
      ownerRecord: { id: 'private-marker' }, privateGraph: { id: 'private-marker' },
    } }),
  },
}, async ({ call, mesh }) => {
  const result = await call('falcon_public_graph', {});
  assert.equal(result.isError, undefined);
  const graph = body(result);
  assert.deepEqual(graph, {
    scope: 'public-market-evidence', chain: 'solana', network: 'devnet',
    graph: {
      revisionId: IDS.head,
      sources: [{ sourceKey: 'live:solana-devnet-klend', revisionId: 'source-revision-1' }],
      nodes: [{ id: 'market', kind: 'source', properties: { status: 'OBSERVED' } }], edges: [], issues: [],
    },
    programAnalysis: { status: 'OBSERVED', summary: 'Program observed.', policyVersion: 'mesh-public-evidence/1' },
    reserveAnalysis: { status: 'OBSERVED', summary: 'Reserve observed.', availableLiquidityUnits: '5000000', slot: 123, policyVersion: 'mesh-reserve-liquidity/1' },
    status: 'OBSERVED', policyDefinitionId: 'decision:mesh-reserve-scenario/1', policyVersion: 'mesh-reserve-scenario/2',
    maxSupplyBaseUnits: '1000000', customGraphsSupported: false, executionReady: false,
  });
  assert.deepEqual([mesh.calls[0].method, mesh.calls[0].path, mesh.calls[0].raw], ['GET', '/v1/public/graph/live', '']);
  assert.equal(mesh.calls[0].headers.authorization, undefined);
  assert.equal(mesh.calls[0].headers.origin, undefined);
  assert.equal(JSON.stringify(graph).includes(WALLET), false);
  assert.equal(JSON.stringify(graph).includes(SESSION), false);
  assert.equal(JSON.stringify(graph).includes('private-marker'), false);
  const beforeCustom = mesh.calls.length;
  assert.equal((await call('falcon_public_graph', { graphId: 'custom' })).isError, true);
  assert.equal(mesh.calls.length, beforeCustom, 'the public graph tool has no selector input');
}));
test('falcon_public_graph returns current NO_DATA instead of a prior observation', () => {
  let reads = 0;
  return withStack({
    overrides: {
      'GET /v1/public/graph/live': () => {
        reads += 1;
        const status = reads === 1 ? 'OBSERVED' : 'NO_DATA';
        return { status: 200, body: {
          scope: 'public-market-evidence', chain: 'solana', network: 'devnet',
          graph: { revisionId: reads === 1 ? IDS.head : 'current-no-data-revision', sources: [], nodes: [], edges: [], issues: [] },
          programAnalysis: { status, policyVersion: 'mesh-public-evidence/1' },
          reserveAnalysis: { status, policyVersion: 'mesh-reserve-liquidity/1' },
          status, policyDefinitionId: 'decision:mesh-reserve-scenario/1', policyVersion: 'mesh-reserve-scenario/2',
          maxSupplyBaseUnits: '1000000', customGraphsSupported: false, executionReady: false,
        } };
      },
    },
  }, async ({ call }) => {
    const observed = body(await call('falcon_public_graph', {}));
    const current = body(await call('falcon_public_graph', {}));
    assert.equal(reads, 2);
    assert.equal(observed.status, 'OBSERVED');
    assert.equal(current.status, 'NO_DATA');
    assert.equal(current.graph.revisionId, 'current-no-data-revision');
    assert.notEqual(current.graph.revisionId, observed.graph.revisionId);
  });
});

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
    await call('falcon_reserve_decision', { session: SESSION, analysisId: IDS.analysis, proposedUsdc: '0.5', maxUsdc: '1', minBookLiquidityUsdc: '2', maxEvidenceAgeSeconds: 120 }),
    await call('falcon_prepare_transaction', prepareArgs),
    await call('falcon_submit_signed', { session: SESSION, intentId: IDS.intent, signedTransactionBase64: SIGNED_TX }),
    await call('falcon_check_receipt', { session: SESSION, intentId: IDS.intent }),
    await call('falcon_activity', { session: SESSION }),
    await call('falcon_disconnect', { session: SESSION }),
  ];
  for (const result of results) assert.equal(result.isError, undefined, JSON.stringify(result.content));
  assert.equal(mesh.calls.length, 10);
  for (const sent of mesh.calls) {
    assert.equal(sent.headers.authorization, `Bearer ${SESSION}`, `${sent.method} ${sent.path}`);
    assert.equal(sent.raw.includes(SESSION), false, `body of ${sent.path}`);
    assert.equal(sent.path.includes(SESSION), false);
    assert.equal(Object.hasOwn(sent.body ?? {}, 'session'), false);
    assert.equal(sent.headers.origin !== undefined, sent.path.startsWith('/v1/auth/wallet/'), `Origin only on wallet auth routes: ${sent.path}`);
  }
}));

test('public graph, owner adoption, reserve decision, and prepare stay bound to one public revision', () => withStack({}, async ({ call, mesh }) => {
  const publicGraph = body(await call('falcon_public_graph', {}));
  assert.equal(publicGraph.scope, 'public-market-evidence');
  assert.equal(publicGraph.status, 'OBSERVED');
  assert.equal(publicGraph.executionReady, false);
  const graphRequest = mesh.calls[0];
  assert.deepEqual([graphRequest.method, graphRequest.path, graphRequest.raw], ['GET', '/v1/public/graph/live', '']);
  assert.equal(graphRequest.headers.authorization, undefined);
  assert.equal(graphRequest.headers.origin, undefined);

  const yieldResult = body(await call('falcon_yield_opportunities', { session: SESSION }));
  assert.equal(yieldResult.opportunities.length, 1);
  assert.equal(yieldResult.limits.length >= 3, true);
  assert.match(yieldResult.limits.join(' '), /not a realized return/);
  assert.match(yieldResult.limits.join(' '), /guaranteed/);

  const refresh = body(await call('falcon_refresh_evidence', { session: SESSION }));
  assert.equal(refresh.analysisId, IDS.analysis);
  assert.equal(refresh.programAnalysisId, IDS.analysis);
  assert.equal(refresh.reserveAnalysisId, IDS.reserveAnalysis);
  assert.equal(refresh.graphRevision, IDS.head);
  assert.equal(refresh.evidenceSource, 'public');
  assert.equal(refresh.status, 'OBSERVED');
  assert.equal(refresh.programStatus, 'OBSERVED');
  assert.equal(refresh.reserveStatus, 'OBSERVED');
  assert.equal(refresh.programAnalysis.evidenceSource, 'public');
  assert.equal(refresh.reserveAnalysis.publicGraphRevision, IDS.head);
  assert.equal(refresh.programAnalysis.policyVersion, 'mesh-public-evidence/1');
  assert.equal(refresh.reserveAnalysis.policyVersion, 'mesh-reserve-liquidity/1');
  assert.deepEqual(refresh.reserve, { availableLiquidityUnits: '5000000', availableLiquidityUsdc: '5', slot: 123 });
  assert.match(refresh.capturedAt, /^2026-10-05T10:00:00.000Z$/);
  assert.equal(JSON.stringify(refresh).includes(SESSION), false);
  const adoption = mesh.calls.find(item => item.path === '/v1/public/graph/adopt');
  assert.deepEqual(Object.keys(adoption.body).sort(), ['requestId', 'reserveRequestId']);
  assert.match(adoption.body.requestId, /^[a-f0-9-]{36}$/);
  assert.match(adoption.body.reserveRequestId, /^[a-f0-9-]{36}$/);
  assert.notEqual(adoption.body.requestId, adoption.body.reserveRequestId);
  assert.equal(mesh.calls.some(item => ['/v1/graph/live', '/v1/captures', '/v1/analyses/live'].includes(item.path)), false);

  const decision = body(await call('falcon_reserve_decision', {
    session: SESSION, analysisId: refresh.analysisId, proposedUsdc: '0.5', maxUsdc: '1', minBookLiquidityUsdc: '2.25', maxEvidenceAgeSeconds: 120,
  }));
  assert.equal(decision.decisionId, IDS.decision);
  assert.equal(decision.status, 'REVIEW');
  assert.equal(decision.proposedUsdc, '0.5');
  assert.equal(decision.maxUsdc, '1');
  assert.equal(decision.minBookLiquidityUsdc, '2.25');
  assert.equal(decision.maxEvidenceAgeSeconds, 120);
  assert.equal(decision.evidenceSource, 'public');
  assert.equal(decision.publicGraphRevision, IDS.head);
  assert.equal(decision.sourceAnalysisId, IDS.analysis);
  assert.deepEqual(decision.decisionGraph, {
    nodes: [
      { id: 'evidence', kind: 'evidence', properties: { status: 'OBSERVED', graphRevision: IDS.head } },
      { id: 'scenario', kind: 'owner-input', properties: { proposedUnits: '500000', maxProposedUnits: '1000000', minBookLiquidityUnits: '2250000', maxObservationAgeSeconds: 120 } },
      { id: 'decision', kind: 'result', properties: { status: 'REVIEW' } },
    ],
    edges: [{ from: 'evidence', to: 'decision', kind: 'supports' }, { from: 'scenario', to: 'decision', kind: 'evaluates' }], issues: [],
  });
  assert.match(decision.next, /may be prepared/);
  const decisionCall = mesh.calls.find(item => item.path === '/v1/public/decisions/reserve');
  assert.equal(decisionCall.body.analysisId, IDS.analysis);
  assert.match(decisionCall.body.requestId, /^[a-f0-9-]{36}$/);
  assert.deepEqual(decisionCall.body.scenario, { proposedUnits: '500000', maxProposedUnits: '1000000', minBookLiquidityUnits: '2250000', maxObservationAgeSeconds: 120 });

  const prepared = body(await call('falcon_prepare_transaction', prepareArgs));
  assert.deepEqual(Object.keys(prepared), ['intentId', 'action', 'amountUsdc', 'wallet', 'unsignedTransactionBase64', 'messageSha256', 'preflight', 'preflightTrust', 'expiresInSeconds', 'decisionId', 'evidenceSource', 'publicGraphRevision', 'sourceAnalysisId', 'summary', 'next']);
  assert.equal(prepared.intentId, IDS.intent);
  assert.equal(prepared.unsignedTransactionBase64, UNSIGNED_TX);
  assert.ok(prepared.expiresInSeconds > 0 && prepared.expiresInSeconds <= 120);
  assert.equal(prepared.preflight.validity.expiresAt, prepared.preflight.validity.decisionExpiresAt);
  assert.equal(prepared.wallet, WALLET);
  assert.equal(prepared.evidenceSource, 'public');
  assert.equal(prepared.publicGraphRevision, IDS.head);
  assert.equal(prepared.sourceAnalysisId, IDS.analysis);
  assert.ok(prepared.next.includes('signTransaction (not signAndSendTransaction)'));
  const prepareCall = mesh.calls.find(item => item.method === 'POST' && item.path === '/v1/public/lending/intents');
  assert.equal(prepareCall.body.analysisId, IDS.analysis);
  assert.equal(prepareCall.body.decisionId, IDS.decision);
  assert.equal(prepareCall.headers.authorization, 'Bearer ' + SESSION);
  assert.equal(mesh.calls.some(item => item.method === 'POST' && item.path === '/v1/lending/intents'), false, 'prepare uses only the public endpoint');

  const submitted = body(await call('falcon_submit_signed', { session: SESSION, intentId: IDS.intent, signedTransactionBase64: SIGNED_TX }));
  assert.equal(submitted.event.kind, 'SUBMITTED');
  assert.equal(submitted.event.data.signature, TRANSACTION_SIGNATURE);
  const submittedMetadata = { chain: 'solana', network: 'devnet', cluster: 'devnet', explorerUrl: 'https://explorer.solana.com/tx/' + TRANSACTION_SIGNATURE + '?cluster=devnet' };
  assert.deepEqual(Object.fromEntries(Object.keys(submittedMetadata).map(key => [key, submitted.event.data[key]])), submittedMetadata);
  assert.equal(Object.hasOwn(submitted.event.data, 'transactionBase64'), false);
  assert.equal(JSON.stringify(submitted).includes(SIGNED_TX), false, 'signed bytes are not echoed');
  assert.equal(JSON.stringify(submitted).includes(SESSION), false, 'session is not echoed');
  const submitCall = mesh.calls.find(item => item.path.endsWith('/submit'));
  assert.equal(submitCall.body.transactionBase64, SIGNED_TX);
  assert.match(submitCall.body.requestId, /^[a-f0-9-]{36}$/);

  const receipt = body(await call('falcon_check_receipt', { session: SESSION, intentId: IDS.intent, requestId: IDS.head }));
  assert.equal(receipt.event.data.status, 'CONFIRMED');
  assert.equal(receipt.event.data.signature, TRANSACTION_SIGNATURE);
  assert.deepEqual(Object.fromEntries(Object.keys(submittedMetadata).map(key => [key, receipt.event.data[key]])), submittedMetadata);
  assert.equal(Object.hasOwn(receipt.event.data, 'transactionBase64'), false);
  assert.equal(JSON.stringify(receipt).includes(SIGNED_TX), false, 'receipt does not retain signed bytes');
  assert.equal(JSON.stringify(receipt).includes(SESSION), false, 'receipt does not echo the session');
  assert.equal(mesh.calls.find(item => item.path.endsWith('/receipt')).body.requestId, IDS.head);

  const activity = body(await call('falcon_activity', { session: SESSION }));
  assert.equal(activity.trail.length, 1);
  assert.equal(activity.trail[0].decision.id, IDS.decision);
  assert.equal(activity.trail[0].decision.status, 'REVIEW');
  assert.equal(activity.trail[0].intent.status, 'SUBMITTED');
  assert.equal(activity.trail[0].intent.amountUsdc, '1');
  assert.deepEqual(activity.counts, { decisions: 1, intents: 1 });
}));
test('reserve decision requires the adopted analysis and every human scenario input', () => withStack({}, async ({ call, mesh }) => {
  const scenario = { proposedUsdc: '0.5', maxUsdc: '1', minBookLiquidityUsdc: '2', maxEvidenceAgeSeconds: 120 };
  for (const args of [
    { session: SESSION, ...scenario },
    { session: SESSION, analysisId: 'not-a-uuid', ...scenario },
    { session: SESSION, analysisId: IDS.analysis, proposedUsdc: '0.5', maxUsdc: '1', maxEvidenceAgeSeconds: 120 },
  ]) assert.equal((await call('falcon_reserve_decision', args)).isError, true);
  assert.equal(mesh.calls.length, 0, 'missing graph binding or scenario input cannot reach Mesh');
}));

test('falcon_activity returns empty arrays and never invents rows', () => withStack({
  overrides: {
    'GET /v1/decisions': () => ({ status: 200, body: { records: [], limit: 20 } }),
    'GET /v1/lending/intents': () => ({ status: 200, body: { records: [], limit: 20 } }),
  },
}, async ({ call }) => {
  assert.deepEqual(body(await call('falcon_activity', { session: SESSION })), { trail: [], counts: { decisions: 0, intents: 0 }, limit: 20 });
}));

test('V148 activity keeps decisions without intents and labels redeem burns as receipt tokens', () => withStack({
  overrides: {
    'GET /v1/decisions': () => ({ status: 200, body: { records: [{ id: IDS.decision, createdAt: '2026-10-05T09:00:00.000Z', analysis: { status: 'BLOCKED', summary: 'No.', expiresAt: null } }], limit: 20 } }),
    'GET /v1/lending/intents': () => ({ status: 200, body: { records: [{ id: IDS.intent, createdAt: '2026-10-05T10:00:00.000Z', request: { wallet: WALLET, action: 'redeem', inputBaseUnits: '250000' }, status: 'PREPARED', signature: null }], limit: 20 } }),
  },
}, async ({ call }) => {
  const { trail } = body(await call('falcon_activity', { session: SESSION }));
  assert.equal(trail.length, 2);
  assert.equal(trail[0].intent.action, 'redeem');
  assert.equal(trail[0].decision, null);
  assert.equal(trail[0].intent.amountReceiptTokens, '0.25');
  assert.equal(Object.hasOwn(trail[0].intent, 'amountUsdc'), false);
  assert.equal(trail[1].intent, null);
  assert.equal(trail[1].decision.status, 'BLOCKED');
}));

test('prepare action fields are enforced before any Mesh request', () => withStack({}, async ({ call, mesh }) => {
  const { decisionId, ...withoutDecision } = prepareArgs;
  assert.equal((await call('falcon_prepare_transaction', withoutDecision)).isError, true);
  assert.equal((await call('falcon_prepare_transaction', { ...prepareArgs, action: 'redeem' })).isError, true);
  assert.equal(mesh.calls.length, 0, 'no Mesh request for invalid action fields');
}));

test('prepare rejects caller wallet, fake intent, and malformed session before using the session wallet', () => withStack({
  overrides: { 'GET /v1/auth/wallet/session': () => ({ status: 200, body: { walletAddress: '11111111111111111111111111111111', ownerId: 'o', expiresAt: 'x' } }) },
}, async ({ call, mesh }) => {
  for (const input of [
    { ...prepareArgs, wallet: 'AttackerWallet11111111111111111111111111111' },
    { ...prepareArgs, intentId: IDS.intent },
    { ...prepareArgs, session: 'fake-session-token' },
  ]) assert.equal((await call('falcon_prepare_transaction', input)).isError, true);
  assert.equal(mesh.calls.length, 0, 'invalid identity fields never reach Mesh');

  const ok = await call('falcon_prepare_transaction', prepareArgs);
  assert.equal(ok.isError, undefined);
  const intent = mesh.calls[1].body;
  assert.equal(intent.wallet, '11111111111111111111111111111111');
  assert.equal(intent.inputBaseUnits, '500000');
  assert.equal(intent.decisionId, IDS.decision);
  assert.equal(intent.action, 'supply');
  assert.equal(body(ok).wallet, '11111111111111111111111111111111');
  assert.deepEqual(Object.keys(intent).sort(), ['action', 'analysisId', 'decisionId', 'inputBaseUnits', 'requestId', 'wallet']);
}));

test('V148 redeem sends receipt-token units and displays burn plus non-1:1 estimated USDC output', () => withStack({
  overrides: { 'POST /v1/public/lending/intents': call => ({ status: 200, body: { record: preparedRecord(call, { estimatedAmounts: { liquidityBaseUnits: '375000', receiptBaseUnits: '250000' } }) } }) },
}, async ({ call, mesh }) => {
  const redeem = { session: SESSION, action: 'redeem', amountReceiptTokens: '0.25', analysisId: IDS.analysis };
  const result = await call('falcon_prepare_transaction', redeem);
  assert.equal(result.isError, undefined);
  const prepared = body(result);
  assert.equal(prepared.amountReceiptTokens, '0.25');
  assert.equal(prepared.estimatedUsdc, '0.375');
  assert.equal(Object.hasOwn(prepared, 'amountUsdc'), false);
  assert.match(prepared.summary, /0\.25 receipt tokens.*estimated 0\.375 USDC/);
  const intent = mesh.calls.find(item => item.path === '/v1/public/lending/intents').body;
  assert.equal(Object.hasOwn(intent, 'decisionId'), false);
  assert.equal(intent.inputBaseUnits, '250000');
  const before = mesh.calls.length;
  for (const amountReceiptTokens of ['0', '1e3', '-1', '1.1234567', '', '01', '18446744073709.551616']) {
    assert.equal((await call('falcon_prepare_transaction', { ...redeem, amountReceiptTokens })).isError, true, amountReceiptTokens);
  }
  assert.equal(mesh.calls.length, before);
}));

test('prepare rejects missing or cross-action amounts and unknown UUID or intent fields before Mesh', () => withStack({}, async ({ call, mesh }) => {
  const { amountUsdc, ...supply } = prepareArgs;
  const { decisionId, ...redeem } = supply;
  for (const input of [
    supply, { ...supply, amountReceiptTokens: '0.5' }, { ...prepareArgs, amountReceiptTokens: '0.5' },
    { ...redeem, action: 'redeem' }, { ...redeem, action: 'redeem', amountUsdc: '0.5' },
    { ...redeem, action: 'redeem', amountUsdc: '0.5', amountReceiptTokens: '0.25' },
    { ...prepareArgs, intentId: IDS.intent },
    { ...prepareArgs, analysisId: 'not-a-uuid' },
    { ...prepareArgs, decisionId: 'not-a-uuid' },
  ]) assert.equal((await call('falcon_prepare_transaction', input)).isError, true, JSON.stringify(input));
  assert.equal(mesh.calls.length, 0);
}));

test('V151: prepare remains available when sequential Devnet RPC work exceeds the ordinary Mesh timeout', () => withStack({
  overrides: {
    'POST /v1/public/lending/intents': async call => {
      await new Promise(resolve => setTimeout(resolve, 16_000));
      return { status: 200, body: { record: preparedRecord(call, { estimatedAmounts: { liquidityBaseUnits: '500000', receiptBaseUnits: '500000' } }) } };
    },
  },
}, async ({ call }) => {
  const prepared = body(await call('falcon_prepare_transaction', prepareArgs));
  assert.equal(prepared.intentId, IDS.intent);
  assert.equal(prepared.unsignedTransactionBase64, UNSIGNED_TX);
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
  await withStack({ overrides: { 'POST /v1/public/graph/adopt': () => ({ status: 409, body: { error: { code: 'CONFLICT', message: 'Public graph revision changed.' } } }) } }, async ({ call }) => {
    const result = await call('falcon_refresh_evidence', { session: SESSION });
    assert.equal(result.isError, true);
    assert.deepEqual(body(result), { code: 'CONFLICT', message: 'Public graph revision changed.' });
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

test('prepare still requires a returned analysis UUID for supply and redeem', () => withStack({}, async ({ call, mesh }) => {
  for (const args of [{ action: 'supply', decisionId: IDS.decision }, { action: 'redeem' }]) {
    const result = await call('falcon_prepare_transaction', { session: SESSION, ...(args.action === 'supply' ? { amountUsdc: '0.1' } : { amountReceiptTokens: '0.1' }), ...args });
    assert.equal(result.isError, true);
  }
  assert.equal(mesh.calls.some(c => c.path === '/v1/public/lending/intents'), false);
}));

test('falcon_refresh_evidence returns NO_DATA when reserve analysis is not OBSERVED', () => withStack({
  overrides: {
    'POST /v1/public/graph/adopt': () => ({ status: 200, body: {
      record: { id: IDS.analysis, graph: { sources: [{ capturedAt: '2026-10-05T10:00:00.000Z' }] }, analysis: { status: 'OBSERVED', summary: 'Evidence observed.', evidenceSource: 'public', publicGraphRevision: IDS.head } },
      reserveRecord: { id: IDS.reserveAnalysis, graph: { sources: [{ capturedAt: '2026-10-05T10:00:00.000Z' }] }, analysis: { status: 'NO_DATA', summary: 'Reserve evidence not ready.', availableLiquidityUnits: null, evidenceSource: 'public', publicGraphRevision: IDS.head } },
      graphRevision: IDS.head, evidenceSource: 'public',
    } }),
  },
}, async ({ call }) => {
  const refresh = body(await call('falcon_refresh_evidence', { session: SESSION }));
  assert.equal(refresh.status, 'NO_DATA');
  assert.equal(refresh.reserveStatus, 'NO_DATA');
  assert.equal(refresh.analysisId, IDS.analysis, 'analysisId still from program analysis');
  assert.match(refresh.summary, /Reserve evidence not ready/);
  assert.equal(refresh.graphRevision, IDS.head);
  assert.equal(refresh.evidenceSource, 'public');
  assert.equal(Object.hasOwn(refresh, 'reserve'), false, 'NO_DATA has no older liquidity fallback');
  assert.ok(!refresh.next.includes('falcon_reserve_decision'), 'must not suggest reserve_decision when not OBSERVED');
}));

test('USDC schema rejects malformed decimal strings before any Mesh request', () => withStack({}, async ({ call, mesh }) => {
  const supply = { session: SESSION, action: 'supply', amountUsdc: '1', analysisId: IDS.analysis, decisionId: IDS.decision };
  for (const amountUsdc of ['1e3', '0.1234567']) {
    assert.equal((await call('falcon_prepare_transaction', { ...supply, amountUsdc })).isError, true, amountUsdc);
  }
  assert.equal(mesh.calls.length, 0);
}));

test('self-test is metadata-only and fingerprints the actual tools/list schemas', () => withStack({}, async ({ call, client, mesh }) => {
  const { tools } = await client.listTools();
  const result = await call('falcon_self_test', {});
  assert.equal(result.isError, undefined);
  const selfTest = body(result);
  assert.equal(selfTest.serverVersion, packageJson.version);
  assert.equal(selfTest.serverVersion, '0.3.1');
  assert.equal(selfTest.chain, 'solana');
  assert.equal(selfTest.network, 'devnet');
  assert.deepEqual(selfTest.tools, TOOL_NAMES);
  assert.equal(selfTest.toolCount, 14);
  assert.match(selfTest.schemaFingerprint, /^sha256:[a-f0-9]{64}$/);
  assert.equal(selfTest.schemaFingerprint, fingerprintInputSchemas(tools.map(({ name, inputSchema }) => ({ name, inputSchema }))));
  assert.equal(body(await call('falcon_self_test', {})).schemaFingerprint, selfTest.schemaFingerprint, 'fingerprint is deterministic');
  assert.deepEqual(selfTest.readiness, { signer: 'not_checked', funding: 'not_checked', transaction: 'not_checked' });
  assert.equal(Object.hasOwn(selfTest, 'status'), false, 'self-test makes no health claim');
  assert.equal(mesh.calls.length, 0, 'self-test does not contact Mesh');
  assert.equal((await call('falcon_self_test', { wallet: WALLET })).isError, true, 'self-test rejects unknown arguments');
  assert.equal(mesh.calls.length, 0);
}));

test('public status and decode validate inputs, default context, and send no bearer', () => withStack({}, async ({ call, mesh }) => {
  const statusResult = await call('falcon_wallet_status', { wallet: WALLET, forAction: 'supply' });
  assert.equal(statusResult.isError, undefined, JSON.stringify(statusResult.content));
  const status = body(statusResult);
  assert.equal(status.walletAddress, WALLET);
  assert.equal(status.chain, 'solana');
  assert.equal(status.network, 'devnet');
  assert.equal(status.slot, 123);
  assert.deepEqual(Object.keys(status.sol), ['balanceLamports']);
  for (const token of [status.usdc, status.receipt]) assert.deepEqual(Object.keys(token).sort(), ['balanceBaseUnits', 'decimals', 'exists', 'mint', 'tokenAccount']);
  assert.ok(Array.isArray(status.missing));
  assert.equal(status.faucet.humanOnly, true);
  assert.deepEqual(Object.keys(status.faucet.links).sort(), ['solFaucet', 'usdcFaucet']);
  assert.equal(status.executionReady, false);
  const statusCall = mesh.calls[0];
  assert.equal(statusCall.method, 'POST');
  assert.equal(statusCall.path, '/v1/wallet/status');
  assert.equal(statusCall.headers.authorization, undefined);
  assert.deepEqual(statusCall.body, { wallet: WALLET, chain: 'solana', network: 'devnet', forAction: 'supply' });

  const decodedResult = await call('falcon_decode_transaction', { transactionBase64: 'AQIDBA==' });
  assert.equal(decodedResult.isError, undefined, JSON.stringify(decodedResult.content));
  const decoded = body(decodedResult);
  assert.equal(decoded.networkAttestation, 'requested-context-only');
  assert.equal(decoded.executionReady, false);
  assert.equal(decoded.safeToSign, false);
  assert.ok(Array.isArray(decoded.instructions));
  assert.ok(Array.isArray(decoded.lookupTables));
  assert.ok(Array.isArray(decoded.riskFlags));
  assert.equal(Object.hasOwn(decoded, 'transactionBase64'), false);
  const decodeCall = mesh.calls[1];
  assert.equal(decodeCall.path, '/v1/transactions/decode');
  assert.equal(decodeCall.headers.authorization, undefined);
  assert.deepEqual(decodeCall.body, { transactionBase64: 'AQIDBA==', chain: 'solana', network: 'devnet' });

  const beforeInvalid = mesh.calls.length;
  const invalid = [
    ['falcon_wallet_status', { wallet: 'not-a-base58-wallet' }],
    ['falcon_wallet_status', { wallet: WALLET, chain: 'mainnet' }],
    ['falcon_wallet_status', { wallet: WALLET, forAction: 'transfer' }],
    ['falcon_wallet_status', { wallet: WALLET, session: SESSION }],
    ['falcon_decode_transaction', { transactionBase64: '%%%%' }],
    ['falcon_decode_transaction', { transactionBase64: 'AAAA====' }],
    ['falcon_decode_transaction', { transactionBase64: 'A'.repeat(3_904) }],
    ['falcon_decode_transaction', { transactionBase64: 'AQIDBA==', intentId: IDS.intent }],
  ];
  for (const [name, args] of invalid) assert.equal((await call(name, args)).isError, true, `${name}: ${JSON.stringify(args).slice(0, 100)}`);
  assert.equal(mesh.calls.length, beforeInvalid, 'invalid public inputs never reach Mesh');
}));

test('wallet status uses the bounded per-wallet public-read limiter', () => withStack({ env: { FALCON_MCP_RATE_MAX_CONNECT: '1' } }, async ({ call, mesh }) => {
  assert.equal((await call('falcon_wallet_status', { wallet: WALLET })).isError, undefined);
  const limited = await call('falcon_wallet_status', { wallet: WALLET });
  assert.equal(limited.isError, true);
  assert.equal(body(limited).code, 'RATE_LIMITED');
  assert.equal(mesh.calls.filter(item => item.path === '/v1/wallet/status').length, 1);
}));

test('V159: public receipts redact raw RPC bodies that contain signed bytes and session data', () => {
  const raw = Buffer.from(JSON.stringify({ transaction: [SIGNED_TX, 'base64'], session: SESSION })).toString('base64');
  const exchange = { url: 'https://api.devnet.solana.com', startedAt: '2026-10-05T10:00:00.000Z', completedAt: '2026-10-05T10:00:01.000Z',
    request: { method: 'POST', rpcMethod: 'getTransaction', bodyBase64: raw },
    response: { httpStatus: 200, contentType: 'application/json', bodyBase64: raw, byteLength: 100, sha256: 'ab'.repeat(32) } };
  const output = kind => ({ status: 200, body: { event: { id: IDS.head, intentId: IDS.intent, kind, data: { status: 'PENDING', signature: TRANSACTION_SIGNATURE, network: 'devnet',
    explorerUrl: `https://explorer.solana.com/tx/${TRANSACTION_SIGNATURE}?cluster=devnet`, transactionBase64: SIGNED_TX, exchanges: [exchange] } } } });
  return withStack({ overrides: {
    [`POST /v1/lending/intents/${IDS.intent}/submit`]: () => output('SUBMITTED'),
    [`POST /v1/lending/intents/${IDS.intent}/receipt`]: () => output('RECEIPT'),
  } }, async ({ call }) => {
    for (const [name, args] of [
      ['falcon_submit_signed', { session: SESSION, intentId: IDS.intent, signedTransactionBase64: SIGNED_TX }],
      ['falcon_check_receipt', { session: SESSION, intentId: IDS.intent }],
    ]) {
      const result = body(await call(name, args));
      assert.equal(result.event.data.signature, TRANSACTION_SIGNATURE);
      assert.equal(result.event.data.status, 'PENDING');
      const evidence = result.event.data.exchanges[0];
      assert.equal(Object.hasOwn(evidence.request, 'bodyBase64'), false);
      assert.equal(Object.hasOwn(evidence.response, 'bodyBase64'), false);
      assert.equal(evidence.response.sha256, exchange.response.sha256);
      assert.equal(JSON.stringify(result).includes(raw), false);
      assert.equal(JSON.stringify(result).includes(SIGNED_TX), false);
      assert.equal(JSON.stringify(result).includes(SESSION), false);
    }
  });
});
