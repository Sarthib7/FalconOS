import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { gzipSync } from 'node:zlib';
import { NEAR_EVIDENCE_LIMITS, NEAR_REVENUE_ADAPTER_VERSION, NEAR_REVENUE_SOURCE_URL, captureNearEvidence, decodeNearEvidence, inspectNearPacket } from '../research/near-source.mjs';
import { sha256 } from '../council/evidence.ts';

const capturedAt = '2026-10-21T13:55:16.791Z';
const rawNumberTag = Symbol('raw-number');
const n = (lexeme) => ({ [rawNumberTag]: lexeme });

function serialize(value) {
  if (value && typeof value === 'object' && Object.prototype.hasOwnProperty.call(value, rawNumberTag)) return value[rawNumberTag];
  if (Array.isArray(value)) return '[' + value.map(serialize).join(',') + ']';
  if (value && typeof value === 'object') return '{' + Object.entries(value).map(([key, item]) => JSON.stringify(key) + ':' + serialize(item)).join(',') + '}';
  return JSON.stringify(value);
}

function revenueRow(overrides = {}) {
  return {
    period_month: '2026-10-01',
    revenue_usd: n('9007199254740993.1234567890123456789'),
    revenue_near: n('3.5000000000000000001'),
    cumulative_revenue_usd: n('12345.67'),
    cumulative_revenue_near: n('12.75'),
    is_stale: n('0'),
    ...overrides,
  };
}
function volumeRow(overrides = {}) {
  return {
    date_at: '2026-10-20',
    volume_usd: n('100.000000000000000001'),
    cumulative_volume_usd: n('1200.000000000000000001'),
    source_used: 'dune:5179085',
    is_stale: n('0'),
    ...overrides,
  };
}
function feesRow(overrides = {}) {
  return {
    date_at: '2026-10-20',
    total_fees_near: n('10.000000000000000001'),
    protocol_fee_near: n('1.100000000000000001'),
    intents_revenue_near: n('2.200000000000000002'),
    burn_revenue_near: n('0.300000000000000003'),
    cumulative_fees_near: n('100.000000000000000001'),
    cumulative_protocol_fee_near: n('11.100000000000000001'),
    cumulative_intents_revenue_near: n('22.200000000000000002'),
    fees_usd: n('987.654321098765432109'),
    cumulative_fees_usd: n('4567.890123456789012345'),
    near_source_used: 'dune:6732575',
    usd_source_used: 'dune:6162763',
    is_stale: n('0'),
    ...overrides,
  };
}
function payloadText(overrides = {}) {
  const payload = {
    revenueSeries: [revenueRow()],
    intentVolumeSeries: [volumeRow()],
    totalFeesSeries: [feesRow()],
    ...overrides,
  };
  return serialize(payload);
}
function page(payload = payloadText(), { duplicate = false } = {}) {
  const chunk = 'self.__next_f.push([1,' + JSON.stringify('0:' + payload) + ']);';
  return '<!doctype html><html><head></head><body><script>' + chunk + '</script>'
    + (duplicate ? '<script>' + chunk + '</script>' : '') + '</body></html>';
}
function responseFor(body, init = {}) {
  return new Response(body, { status: 200, ...init });
}
async function captureHtml(html) {
  return captureNearEvidence({ fetchImpl: async () => responseFor(html), now: () => capturedAt });
}

function packetForCompressed(compressed, rawBodyBytes, rawBodySha256) {
  const totalParts = Math.ceil(compressed.byteLength / NEAR_EVIDENCE_LIMITS.partBytes);
  const fields = {
    schemaVersion: 1,
    adapterVersion: NEAR_REVENUE_ADAPTER_VERSION,
    sourceKey: 'near-revenue',
    sourceUrl: NEAR_REVENUE_SOURCE_URL,
    capturedAt,
    rawBodySha256,
    rawBodyBytes,
    codec: 'gzip-base64',
    compressedBytes: compressed.byteLength,
  };
  const parts = [];
  for (let index = 0; index < totalParts; index += 1) {
    const bytes = compressed.subarray(index * NEAR_EVIDENCE_LIMITS.partBytes, Math.min(compressed.byteLength, (index + 1) * NEAR_EVIDENCE_LIMITS.partBytes));
    parts.push({ index, totalParts, sha256: sha256(bytes), dataBase64: bytes.toString('base64') });
  }
  return { ...fields, parts };
}

test('captures only the fixed public page and preserves raw numeric JSON lexemes', async () => {
  let request;
  const html = page();
  const htmlBytes = Buffer.from(html, 'utf8');
  const packet = await captureNearEvidence({
    fetchImpl: async (url, options) => {
      request = { url, options };
      return responseFor(html);
    },
    now: () => capturedAt,
  });
  assert.equal(request.url, NEAR_REVENUE_SOURCE_URL);
  assert.equal(request.options.method, 'GET');
  assert.equal(request.options.redirect, 'error');
  assert.ok(request.options.signal instanceof AbortSignal);
  assert.deepEqual(Object.keys(packet).sort(), [
    'adapterVersion', 'capturedAt', 'codec', 'compressedBytes', 'parts', 'rawBodyBytes', 'rawBodySha256', 'schemaVersion', 'sourceKey', 'sourceUrl',
  ]);
  assert.equal(packet.rawBodySha256, sha256(htmlBytes));
  assert.equal(packet.rawBodyBytes, htmlBytes.byteLength);
  assert.equal(packet.capturedAt, capturedAt);
  assert.equal(packet.adapterVersion, 'near-revenue/1');
  assert.equal(packet.sourceKey, 'near-revenue');
  assert.ok(packet.parts.length <= 3);
  const decoded = decodeNearEvidence(packet);
  assert.equal(decoded.series.revenueSeries[0].revenue_usd, '9007199254740993.1234567890123456789');
  assert.equal(decoded.series.revenueSeries[0].revenue_near, '3.5000000000000000001');
  assert.equal(decoded.series.intentVolumeSeries[0].volume_usd, '100.000000000000000001');
  assert.equal(decoded.series.totalFeesSeries[0].fees_usd, '987.654321098765432109');
  assert.equal(decoded.series.revenueSeries[0].is_stale, '0');
  assert.deepEqual(decoded.issues, []);
});

test('V186: selects the complete research payload beside independent revenue widgets', async () => {
  const widget = serialize({ revenueSeries: [revenueRow()], emissionsMonthly: [], emissionsDaily: [] });
  for (const html of [page(widget) + page(), page() + page(widget)]) {
    const packet = await captureHtml(html);
    const decoded = decodeNearEvidence(packet);
    assert.equal(decoded.series.intentVolumeSeries[0].volume_usd, '100.000000000000000001');
    assert.equal(decoded.series.totalFeesSeries[0].fees_usd, '987.654321098765432109');
    assert.equal(inspectNearPacket(packet).rawText, html);
  }
  await assert.rejects(captureHtml(page(widget) + page(payloadText(), { duplicate: true })), { code: 'SOURCE_PAYLOAD_AMBIGUOUS' });
});

test('splits a bounded compressed body into independently verifiable parts', async () => {
  const noise = randomBytes(96 * 1024).toString('base64');
  const packet = await captureHtml(page() + '<aside>' + noise + '</aside>');
  assert.ok(packet.parts.length > 1);
  assert.ok(packet.parts.length <= 3);
  assert.equal(packet.parts.reduce((sum, part) => sum + Buffer.from(part.dataBase64, 'base64').byteLength, 0), packet.compressedBytes);
  for (const part of packet.parts) {
    assert.ok(Buffer.from(part.dataBase64, 'base64').byteLength <= NEAR_EVIDENCE_LIMITS.partBytes);
    assert.equal(decodeNearEvidence(packet).schemaVersion, 1);
  }
});

test('rejects atomic part corruption, part-map mismatch, and raw-body digest mismatch', async () => {
  const packet = await captureHtml(page() + '<aside>' + randomBytes(80 * 1024).toString('base64') + '</aside>');
  const damaged = structuredClone(packet);
  const encoded = damaged.parts[0].dataBase64;
  damaged.parts[0].dataBase64 = (encoded[0] === 'A' ? 'B' : 'A') + encoded.slice(1);
  assert.throws(() => decodeNearEvidence(damaged), { code: 'PART_HASH_MISMATCH' });

  const mismatched = structuredClone(packet);
  mismatched.parts[0].totalParts += 1;
  assert.throws(() => decodeNearEvidence(mismatched), { code: 'PACKET_PARTS' });

  const wrongRawHash = structuredClone(packet);
  wrongRawHash.rawBodySha256 = '0'.repeat(64);
  assert.throws(() => decodeNearEvidence(wrongRawHash), { code: 'RAW_HASH_MISMATCH' });
});

test('rejects decompression bombs and responses over one MiB', async () => {
  const bombBody = Buffer.alloc(NEAR_EVIDENCE_LIMITS.rawBytes + 1, 0);
  const bomb = packetForCompressed(gzipSync(bombBody, { level: 9 }), NEAR_EVIDENCE_LIMITS.rawBytes, sha256(bombBody));
  assert.throws(() => decodeNearEvidence(bomb), { code: 'GZIP_INVALID' });

  const tooLarge = '<script></script>' + 'x'.repeat(NEAR_EVIDENCE_LIMITS.rawBytes + 1);
  await assert.rejects(captureNearEvidence({ fetchImpl: async () => responseFor(tooLarge), now: () => capturedAt }), { code: 'BODY_TOO_LARGE' });
});

test('rejects missing, ambiguous, and drifted source payloads while retaining bounded raw evidence', async () => {
  await assert.rejects(captureHtml('<html><script>window.__other.push([1,"ignored"])</script></html>'), (error) => {
    assert.equal(error.code, 'SOURCE_PAYLOAD_MISSING');
    assert.ok(error.packet);
    assert.equal(error.packet.rawBodyBytes, Buffer.byteLength('<html><script>window.__other.push([1,"ignored"])</script></html>'));
    return true;
  });
  await assert.rejects(captureHtml(page(payloadText(), { duplicate: true })), { code: 'SOURCE_PAYLOAD_AMBIGUOUS' });

  const missingSeries = serialize({ revenueSeries: [revenueRow()], intentVolumeSeries: [volumeRow()] });
  await assert.rejects(captureHtml(page(missingSeries)), { code: 'SOURCE_SCHEMA_DRIFT' });
  const drifted = serialize({
    revenueSeries: [revenueRow({ unexpected: 'new-field' })],
    intentVolumeSeries: [volumeRow()],
    totalFeesSeries: [feesRow()],
  });
  await assert.rejects(captureHtml(page(drifted)), { code: 'SOURCE_SCHEMA_DRIFT' });
  const invalidFlag = serialize({
    revenueSeries: [revenueRow({ is_stale: n('2') })],
    intentVolumeSeries: [volumeRow()],
    totalFeesSeries: [feesRow()],
  });
  await assert.rejects(captureHtml(page(invalidFlag)), { code: 'SOURCE_SCHEMA_DRIFT' });
  const booleanFlag = serialize({
    revenueSeries: [revenueRow({ is_stale: false })],
    intentVolumeSeries: [volumeRow()],
    totalFeesSeries: [feesRow()],
  });
  await assert.rejects(captureHtml(page(booleanFlag)), { code: 'SOURCE_SCHEMA_DRIFT' });
});

test('integrity-only inspection reconstructs raw HTML without publisher parsing', async () => {
  const html = page(serialize({ revenueSeries: [revenueRow()], intentVolumeSeries: [volumeRow()] }));
  const rawBody = Buffer.from(html, 'utf8');
  await assert.rejects(captureHtml(html), (error) => {
    assert.equal(error.code, 'SOURCE_SCHEMA_DRIFT');
    assert.ok(error.packet);
    const inspected = inspectNearPacket(error.packet);
    assert.deepEqual(Object.keys(inspected).sort(), ['rawBodyBytes', 'rawBodySha256', 'rawText']);
    assert.equal(inspected.rawText, html);
    assert.equal(inspected.rawBodyBytes, rawBody.byteLength);
    assert.equal(inspected.rawBodySha256, sha256(rawBody));
    return true;
  });
});
test('source zero with none remains an exact publisher row, not a verified zero', async () => {
  const html = page(payloadText({
    intentVolumeSeries: [volumeRow({ volume_usd: n('0'), cumulative_volume_usd: n('0'), source_used: 'none' })],
    totalFeesSeries: [feesRow({
      total_fees_near: n('0'), protocol_fee_near: n('0'), intents_revenue_near: n('0'), burn_revenue_near: n('0'),
      cumulative_fees_near: n('0'), cumulative_protocol_fee_near: n('0'), cumulative_intents_revenue_near: n('0'), near_source_used: 'none',
    })],
  }));
  const decoded = decodeNearEvidence(await captureHtml(html));
  assert.equal(decoded.series.intentVolumeSeries[0].source_used, 'none');
  assert.equal(decoded.series.intentVolumeSeries[0].volume_usd, '0');
  assert.equal(decoded.series.totalFeesSeries[0].near_source_used, 'none');
  assert.equal(decoded.series.totalFeesSeries[0].total_fees_near, '0');
});
