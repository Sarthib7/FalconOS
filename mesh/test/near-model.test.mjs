import test from 'node:test';
import assert from 'node:assert/strict';
import { captureNearEvidence, decodeNearEvidence } from '../research/near-source.mjs';
import { evaluateNearModel } from '../research/near-model.mjs';

const capturedAt = '2026-10-21T13:55:16.791Z';
const RAW_NUMBER = Symbol('raw-number');
const n = (lexeme) => ({ [RAW_NUMBER]: lexeme });
function serialize(value) {
  if (value && typeof value === 'object' && Object.prototype.hasOwnProperty.call(value, RAW_NUMBER)) return value[RAW_NUMBER];
  if (Array.isArray(value)) return '[' + value.map(serialize).join(',') + ']';
  if (value && typeof value === 'object') return '{' + Object.entries(value).map(([key, item]) => JSON.stringify(key) + ':' + serialize(item)).join(',') + '}';
  return JSON.stringify(value);
}
function makeRow(fields) { return fields; }
function makePage({ revenueSeries, intentVolumeSeries, totalFeesSeries }) {
  const payload = serialize({ revenueSeries, intentVolumeSeries, totalFeesSeries });
  const chunk = 'self.__next_f.push([1,' + JSON.stringify('0:' + payload) + ']);';
  return '<html><script>' + chunk + '</script></html>';
}
async function decodedFixture(series) {
  const html = makePage(series);
  const packet = await captureNearEvidence({ fetchImpl: async () => new Response(html), now: () => capturedAt });
  return decodeNearEvidence(packet);
}
function revenue(period, revenueUsd, revenueNear, cumulativeUsd, cumulativeNear, isStale = '0') {
  return makeRow({
    period_month: period,
    revenue_usd: n(revenueUsd), revenue_near: n(revenueNear),
    cumulative_revenue_usd: n(cumulativeUsd), cumulative_revenue_near: n(cumulativeNear),
    is_stale: n(isStale),
  });
}
function volume(date, value, cumulative, source = 'dune:5179085', isStale = '0') {
  return makeRow({ date_at: date, volume_usd: n(value), cumulative_volume_usd: n(cumulative), source_used: source, is_stale: n(isStale) });
}
function fees(date, values = {}) {
  return makeRow({
    date_at: date,
    total_fees_near: n(values.total ?? '1.000000000000000001'),
    protocol_fee_near: n(values.protocol ?? '0.100000000000000001'),
    intents_revenue_near: n(values.intents ?? '0.200000000000000001'),
    burn_revenue_near: n(values.burn ?? '0.010000000000000001'),
    cumulative_fees_near: n(values.cumulativeNear ?? '10.000000000000000001'),
    cumulative_protocol_fee_near: n(values.cumulativeProtocol ?? '1.000000000000000001'),
    cumulative_intents_revenue_near: n(values.cumulativeIntents ?? '2.000000000000000001'),
    fees_usd: n(values.usd ?? '100.000000000000000001'),
    cumulative_fees_usd: n(values.cumulativeUsd ?? '1000.000000000000000001'),
    near_source_used: values.nearSource ?? 'dune:6732575',
    usd_source_used: values.usdSource ?? 'dune:6162763',
    is_stale: n(values.isStale ?? '0'),
  });
}
function fixtureRows() {
  return {
    revenueSeries: [
      revenue('2026-09-01', '9007199254740993.100000000000000001', '3.1', '10.1', '2.1'),
      revenue('2026-10-01', '9007199254740993.100000000000000002', '3.2', '20.2', '5.3'),
    ],
    intentVolumeSeries: [
      volume('2026-10-19', '9007199254740993.100000000000000001', '1000.1'),
      volume('2026-10-20', '9007199254740993.100000000000000002', '1000.2'),
    ],
    totalFeesSeries: [
      fees('2026-10-18', {
        total: '0', protocol: '0', intents: '0', burn: '0', cumulativeNear: '0', cumulativeProtocol: '0', cumulativeIntents: '0',
        usd: '0', cumulativeUsd: '0', nearSource: 'none',
      }),
      fees('2026-10-19', { total: '1.000000000000000001', cumulativeNear: '10.000000000000000001' }),
      fees('2026-10-20', { total: '1.000000000000000002', cumulativeNear: '11.000000000000000003' }),
    ],
  };
}

test('replays exact source decimals and reports observations without an investment conclusion', async () => {
  const decoded = await decodedFixture(fixtureRows());
  const model = evaluateNearModel(decoded);
  const replay = evaluateNearModel(decoded);
  assert.deepEqual(model, replay);
  assert.deepEqual(Object.keys(model).sort(), [
    'counterCase', 'executionReady', 'investmentAssessment', 'modelVersion', 'seriesSummaries', 'status', 'unknowns',
  ]);
  assert.equal(model.modelVersion, 'near-observed/1');
  assert.equal(model.status, 'OBSERVED');
  assert.equal(model.executionReady, false);
  assert.equal(model.investmentAssessment.status, 'NO_DATA');
  assert.equal(model.investmentAssessment.proposal, null);
  assert.deepEqual(model.investmentAssessment.reasons, ['NATIVE_TOKEN_DEMAND_UNVERIFIED', 'NET_CAPTURE_METHODOLOGY_UNVERIFIED']);
  assert.equal(model.seriesSummaries.intentVolumeSeries.sampleCount, 2);
  assert.equal(model.seriesSummaries.intentVolumeSeries.firstLabel, '2026-10-19');
  assert.equal(model.seriesSummaries.intentVolumeSeries.lastLabel, '2026-10-20');
  assert.equal(model.seriesSummaries.intentVolumeSeries.current.volume_usd, '9007199254740993.100000000000000002');
  assert.equal(model.seriesSummaries.intentVolumeSeries.comparisons[0].direction, 'higher');
  assert.equal(model.seriesSummaries.intentVolumeSeries.comparisons[0].status, 'COMPARED');
  assert.equal(model.seriesSummaries.totalFeesSeries.current.total_fees_near, '1.000000000000000002');
  assert.equal(model.seriesSummaries.totalFeesSeries.current.publisherStaleClaim, false);
  assert.ok(model.unknowns.some((item) => item.includes('native-token-demand')));
  assert.ok(model.unknowns.some((item) => item.includes('economic-net-revenue')));
  assert.ok(model.unknowns.some((item) => item.includes('unverified-zero') && item.includes('total_fees_near')));
  assert.ok(model.unknowns.every((item) => typeof item === 'string' && item.length >= 1 && item.length <= 512));
  assert.ok(Array.isArray(model.counterCase) && model.counterCase.length > 0);
  assert.ok(model.counterCase.every((item) => typeof item === 'string' && item.length <= 1024));
  assert.equal(Object.hasOwn(model.seriesSummaries.intentVolumeSeries, 'rows'), false);
});

test('missing query IDs and non-comparable source rows remain unknown with a reason', async () => {
  const rows = fixtureRows();
  rows.intentVolumeSeries[1].source_used = 'dune:other-query';
  rows.totalFeesSeries[2].near_source_used = 'none';
  rows.totalFeesSeries[2].total_fees_near = n('0');
  const model = evaluateNearModel(await decodedFixture(rows));
  const volume = model.seriesSummaries.intentVolumeSeries.comparisons[0];
  const fees = model.seriesSummaries.totalFeesSeries.comparisons[0];
  assert.equal(volume.status, 'UNKNOWN');
  assert.match(volume.reason, /different publisher query\/source identifiers/);
  assert.equal(fees.status, 'UNKNOWN');
  assert.match(fees.reason, /missing or marked none/);
  assert.ok(model.unknowns.some((item) => item.includes('fee-volume-ratio') && item.includes('zero volume denominator')));
});

test('empty published series return NO_DATA while investment readiness remains blocked', async () => {
  const model = evaluateNearModel(await decodedFixture({ revenueSeries: [], intentVolumeSeries: [], totalFeesSeries: [] }));
  assert.equal(model.status, 'NO_DATA');
  assert.equal(model.investmentAssessment.status, 'NO_DATA');
  assert.equal(model.investmentAssessment.proposal, null);
  assert.equal(model.executionReady, false);
  assert.equal(model.seriesSummaries.totalFeesSeries.sampleCount, 0);
});
