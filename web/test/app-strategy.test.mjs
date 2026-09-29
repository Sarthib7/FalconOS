import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { ANALOG_MINTS, DEFAULT_COUNCIL_BASE, DEVNET_BASE_MINT, baseUnitsToUsdc, fetchAdvice, parseAdvice, removeLeg, resolveCouncilBase, setLegAllocation, toView, usdcToBaseUnits } from '../app/strategy.mjs';

const PUBLISHED = {
  status: 'PUBLISHED',
  snapshot_sha256: 'ab'.repeat(32),
  created_at: '2026-09-29T00:00:00Z',
  execution_ready: false,
  reasons: [],
  evidence: [{ asset_id: 'aapl-1', underlying: 'AAPL', token_price: 190 }],
  citations: [],
  legs: [
    { asset_id: 'aapl-1', underlying: 'AAPL', target_weight_bps: 6000 },
    { asset_id: 'msft-1', underlying: 'MSFT', target_weight_bps: 4000 },
  ],
};
const MINTS = { AAPL: 'MintAapl11111111111111111111111111111111111' };
const respond = (body, { ok = true, status = 200 } = {}) => async () => ({ ok, status, json: async () => body });

test('fetchAdvice issues a read-only GET to {base}/advice and parses PUBLISHED', async () => {
  const calls = [];
  const result = await fetchAdvice({ base: 'http://council.test', fetchImpl: async (url, init) => { calls.push([url, init]); return { ok: true, status: 200, json: async () => PUBLISHED }; } });
  assert.equal(result.ok, true);
  assert.equal(calls[0][0], 'http://council.test/advice');
  assert.equal(calls[0][1].method, 'GET');
  assert.equal(calls[0][1].body, undefined);
  assert.equal(result.advice.status, 'PUBLISHED');
  assert.deepEqual(result.advice.legs.map((leg) => leg.underlying), ['AAPL', 'MSFT']);
  assert.equal(result.advice.snapshotSha256, PUBLISHED.snapshot_sha256);
});

test('toView sizes a PUBLISHED decision through plan.mjs with correct allocations', () => {
  const { decision, plan, planError } = toView({ advice: parseAdvice(PUBLISHED), capitalBaseUnits: '5000000', analogMints: MINTS });
  assert.equal(planError, null);
  assert.equal(decision.status, 'PUBLISHED');
  assert.equal(decision.legs.length, 2);
  assert.deepEqual(plan.legs.map((leg) => leg.allocationBaseUnits), ['3000000', '2000000']);
  assert.equal(plan.residualBaseUnits, '0');
  assert.equal(plan.mode, 'devnet-analog');
  assert.ok(!('executionReady' in plan) && !('execution_ready' in plan));
});

test('unconfigured analog mint keeps executable:false with the devnet-analog label', () => {
  const { plan } = toView({ advice: parseAdvice(PUBLISHED), capitalBaseUnits: '1000000', analogMints: MINTS });
  const [aapl, msft] = plan.legs;
  assert.equal(aapl.executable, true);
  assert.equal(msft.executable, false);
  assert.equal(msft.analogMint, null);
  assert.match(msft.label, /Devnet analog/);
  const dflt = toView({ advice: parseAdvice(PUBLISHED), capitalBaseUnits: '1000000' });
  assert.ok(dflt.plan.legs.every((leg) => leg.executable === false && leg.analogMint === null), 'AAPL/MSFT are not in the default analog config');
});

test('BLOCKED and NO_DATA carry reasons and never build a plan', () => {
  for (const status of ['BLOCKED', 'NO_DATA']) {
    const advice = parseAdvice({ status, reasons: ['stale snapshot'], legs: [], execution_ready: false });
    const { decision, plan } = toView({ advice, capitalBaseUnits: '5000000', analogMints: MINTS });
    assert.equal(decision.status, status);
    assert.deepEqual(decision.reasons, ['stale snapshot']);
    assert.equal(plan, null);
  }
});

test('PUBLISHED without positive capital yields no plan; bad weights surface planError', () => {
  const advice = parseAdvice(PUBLISHED);
  for (const capital of [null, undefined, '0', 'nope']) assert.equal(toView({ advice, capitalBaseUnits: capital }).plan, null);
  const skewed = parseAdvice({ ...PUBLISHED, legs: [{ asset_id: 'a', underlying: 'A', target_weight_bps: 5000 }] });
  const view = toView({ advice: skewed, capitalBaseUnits: '1000000' });
  assert.equal(view.plan, null);
  assert.match(view.planError, /sum to 10000/);
});

test('failed and malformed fetches return typed errors instead of throwing', async () => {
  const cases = [
    [async () => { throw new Error('ECONNREFUSED'); }, 'network'],
    [respond({}, { ok: false, status: 503 }), 'http'],
    [async () => ({ ok: true, status: 200, json: async () => { throw new SyntaxError('bad json'); } }), 'malformed'],
    [respond({ status: 'MAYBE' }), 'malformed'],
    [respond({ ...PUBLISHED, legs: [] }), 'malformed'],
    [respond({ ...PUBLISHED, legs: [{ asset_id: 'x', underlying: 'X', target_weight_bps: '10000' }] }), 'malformed'],
    [respond({ ...PUBLISHED, execution_ready: true }), 'malformed'],
    [respond(null), 'malformed'],
  ];
  for (const [fetchImpl, code] of cases) {
    const result = await fetchAdvice({ base: 'http://council.test', fetchImpl });
    assert.equal(result.ok, false);
    assert.equal(result.error.code, code);
    assert.equal(typeof result.error.message, 'string');
  }
});

test('fetchAdvice aborts a hung council with a network error', async () => {
  const hang = (url, { signal }) => new Promise((resolve, reject) => signal.addEventListener('abort', () => reject(new Error('aborted'))));
  const result = await fetchAdvice({ base: 'http://council.test', fetchImpl: hang, timeoutMs: 5 });
  assert.deepEqual([result.ok, result.error.code], [false, 'network']);
  assert.match(result.error.message, /timed out/);
});

test('council base resolves from window global, then data attribute, then default', () => {
  assert.equal(resolveCouncilBase({ global: {}, dataset: undefined }), DEFAULT_COUNCIL_BASE);
  assert.equal(resolveCouncilBase({ global: {}, dataset: { councilBase: 'http://data.test/' } }), 'http://data.test');
  assert.equal(resolveCouncilBase({ global: { FALCON_COUNCIL_BASE: 'http://win.test' }, dataset: { councilBase: 'http://data.test' } }), 'http://win.test');
});

test('USDC text converts to exact 6-decimal base units and back', () => {
  assert.equal(usdcToBaseUnits('1'), '1000000');
  assert.equal(usdcToBaseUnits(' 12.5 '), '12500000');
  assert.equal(usdcToBaseUnits('0.000001'), '1');
  assert.equal(baseUnitsToUsdc('12500000'), '12.5');
  assert.equal(baseUnitsToUsdc('1'), '0.000001');
  assert.equal(baseUnitsToUsdc('0'), '0');
  for (const bad of ['', '-1', '1.0000001', '1e3', 'abc', '99999999999999.999999', null]) assert.throws(() => usdcToBaseUnits(bad));
});

test('leg edits go through plan.mjs: residual is live, invalid input keeps the plan', () => {
  const { plan } = toView({ advice: parseAdvice(PUBLISHED), capitalBaseUnits: '5000000', analogMints: MINTS });
  const edited = setLegAllocation(plan, 'aapl-1', '2');
  assert.equal(edited.error, null);
  assert.deepEqual(edited.plan.legs.map((leg) => leg.allocationBaseUnits), ['2000000', '2000000']);
  assert.equal(edited.plan.residualBaseUnits, '1000000');
  const over = setLegAllocation(edited.plan, 'msft-1', '4');
  assert.match(over.error, /exceed capital/);
  assert.equal(over.plan, edited.plan);
  assert.match(setLegAllocation(plan, 'aapl-1', 'abc').error, /USDC amount/);
  const removed = removeLeg(plan, 'msft-1');
  assert.deepEqual(removed.plan.legs.map((leg) => leg.assetId), ['aapl-1']);
  assert.equal(removed.plan.residualBaseUnits, '2000000');
  assert.match(removeLeg(plan, 'nope').error, /no leg matches/);
});

test('strategy module stays advisory: no wallet or send code, panel markup present', () => {
  const source = readFileSync(new URL('../app/strategy.mjs', import.meta.url), 'utf8');
  assert.doesNotMatch(source, /signTransaction|sendTransaction|method: 'POST'|execution_ready: true/);
  const html = readFileSync(new URL('../app/index.html', import.meta.url), 'utf8');
  for (const id of ['strategy-capital', 'strategy-load', 'strategy-status', 'strategy-legs', 'strategy-plan', 'strategy-residual']) assert.match(html, new RegExp(`id="${id}"`));
  assert.doesNotMatch(html, /id="strategy-execute"/, 'no batch execute-all control');
});

test('default analog config maps council underlyings to dwSOL against a dUSDC base, making legs executable', () => {
  assert.equal(DEVNET_BASE_MINT, 'USDCoctVLVnvTXBEuP9s8hntucdJokbo17RwHuNXemT');
  assert.deepEqual({ ...ANALOG_MINTS }, { OPENAI: 'So11111111111111111111111111111111111111112', SPACEX: 'So11111111111111111111111111111111111111112' });
  const advice = parseAdvice({ ...PUBLISHED, legs: [
    { asset_id: 'openai-1', underlying: 'OPENAI', target_weight_bps: 6000 },
    { asset_id: 'spacex-1', underlying: 'SPACEX', target_weight_bps: 4000 },
  ] });
  const { plan } = toView({ advice, capitalBaseUnits: '10000000' });
  assert.deepEqual(plan.legs.map((leg) => [leg.executable, leg.analogMint]), [[true, ANALOG_MINTS.OPENAI], [true, ANALOG_MINTS.SPACEX]]);
  assert.ok(!('executionReady' in plan), 'advisory boundary: plan never carries execution readiness');
});
