import { freezeDeep, stableStringify } from '../council/evidence.ts';
import { NEAR_REVENUE_ADAPTER_VERSION, NEAR_REVENUE_ROW_FIELDS, NEAR_REVENUE_SOURCE_URL } from './near-source.mjs';

export const NEAR_MODEL_VERSION = 'near-observed/1';
const SERIES_NAMES = Object.freeze(['revenueSeries', 'intentVolumeSeries', 'totalFeesSeries']);
const SERIES_CONFIG = Object.freeze({
  revenueSeries: Object.freeze({ label: 'period_month', source: null, comparisons: Object.freeze([]) }),
  intentVolumeSeries: Object.freeze({
    label: 'date_at', source: 'source_used',
    comparisons: Object.freeze([
      Object.freeze({ field: 'volume_usd', unit: 'USD', source: 'source_used' }),
      Object.freeze({ field: 'cumulative_volume_usd', unit: 'USD', source: 'source_used' }),
    ]),
  }),
  totalFeesSeries: Object.freeze({
    label: 'date_at', source: null,
    comparisons: Object.freeze([
      Object.freeze({ field: 'total_fees_near', unit: 'NEAR', source: 'near_source_used' }),
      Object.freeze({ field: 'cumulative_fees_near', unit: 'NEAR', source: 'near_source_used' }),
      Object.freeze({ field: 'fees_usd', unit: 'USD', source: 'usd_source_used' }),
      Object.freeze({ field: 'cumulative_fees_usd', unit: 'USD', source: 'usd_source_used' }),
    ]),
  }),
});
const SERIES_UNITS = Object.freeze({
  revenueSeries: Object.freeze({ revenue_usd: 'USD', revenue_near: 'NEAR', cumulative_revenue_usd: 'USD', cumulative_revenue_near: 'NEAR' }),
  intentVolumeSeries: Object.freeze({ volume_usd: 'USD', cumulative_volume_usd: 'USD' }),
  totalFeesSeries: Object.freeze({
    total_fees_near: 'NEAR', protocol_fee_near: 'NEAR', intents_revenue_near: 'NEAR', burn_revenue_near: 'NEAR',
    cumulative_fees_near: 'NEAR', cumulative_protocol_fee_near: 'NEAR', cumulative_intents_revenue_near: 'NEAR',
    fees_usd: 'USD', cumulative_fees_usd: 'USD',
  }),
});
const SOURCE_METRICS = Object.freeze({
  source_used: Object.freeze(['volume_usd', 'cumulative_volume_usd']),
  near_source_used: Object.freeze([
    'total_fees_near', 'protocol_fee_near', 'intents_revenue_near', 'burn_revenue_near',
    'cumulative_fees_near', 'cumulative_protocol_fee_near', 'cumulative_intents_revenue_near',
  ]),
  usd_source_used: Object.freeze(['fees_usd', 'cumulative_fees_usd']),
});
const MAX_NUMERIC_LEXEME = 512;
const MAX_NUMERIC_EXPONENT = 512;
const MAX_MODEL_OUTPUT_BYTES = 48 * 1024;

export class NearModelError extends Error {
  constructor(code = 'INVALID_DECODED_EVIDENCE') {
    super('Decoded NEAR evidence is invalid for the observed model.');
    this.name = 'NearModelError';
    this.code = code;
  }
}

function fail() {
  throw new NearModelError();
}

function isPlainRecord(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function hasExactDataKeys(value, expected) {
  if (!isPlainRecord(value)) return false;
  const keys = Reflect.ownKeys(value);
  if (keys.length !== expected.length) return false;
  const allowed = new Set(expected);
  for (const key of keys) {
    if (typeof key !== 'string' || !allowed.has(key)) return false;
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || !Object.prototype.hasOwnProperty.call(descriptor, 'value') || descriptor.enumerable !== true) return false;
  }
  return true;
}

function decimalParts(lexeme) {
  if (typeof lexeme !== 'string' || lexeme.length > MAX_NUMERIC_LEXEME
    || !/^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?$/.test(lexeme)) return null;
  const exponentMatch = /[eE]([+-]?\d+)$/.exec(lexeme);
  const exponent = exponentMatch ? Number(exponentMatch[1]) : 0;
  if (!Number.isSafeInteger(exponent) || Math.abs(exponent) > MAX_NUMERIC_EXPONENT) return null;
  let text = lexeme;
  let sign = 1n;
  if (text[0] === '-') { sign = -1n; text = text.slice(1); }
  const exponentIndex = text.search(/[eE]/);
  const base = exponentIndex < 0 ? text : text.slice(0, exponentIndex);
  const pointIndex = base.indexOf('.');
  const fractionalDigits = pointIndex < 0 ? 0 : base.length - pointIndex - 1;
  let digits = pointIndex < 0 ? base : base.slice(0, pointIndex) + base.slice(pointIndex + 1);
  digits = digits.replace(/^0+/, '') || '0';
  let coefficient;
  try { coefficient = BigInt(digits) * sign; }
  catch { return null; }
  let scale = fractionalDigits - exponent;
  if (Math.abs(scale) > MAX_NUMERIC_LEXEME + MAX_NUMERIC_EXPONENT) return null;
  if (scale < 0) {
    coefficient *= 10n ** BigInt(-scale);
    scale = 0;
  }
  while (scale > 0 && coefficient !== 0n && coefficient % 10n === 0n) {
    coefficient /= 10n;
    scale -= 1;
  }
  return { coefficient, scale };
}

function compareDecimal(left, right) {
  const a = decimalParts(left);
  const b = decimalParts(right);
  if (!a || !b) fail();
  const scale = Math.max(a.scale, b.scale);
  const leftInteger = a.coefficient * (10n ** BigInt(scale - a.scale));
  const rightInteger = b.coefficient * (10n ** BigInt(scale - b.scale));
  return leftInteger < rightInteger ? -1 : leftInteger > rightInteger ? 1 : 0;
}

function isZeroDecimal(lexeme) {
  const value = decimalParts(lexeme);
  return value !== null && value.coefficient === 0n;
}

function validateDecoded(decoded) {
  const keys = ['schemaVersion', 'adapterVersion', 'sourceUrl', 'capturedAt', 'rawBodySha256', 'rawBodyBytes', 'series', 'issues'];
  if (!hasExactDataKeys(decoded, keys) || decoded.schemaVersion !== 1 || decoded.adapterVersion !== NEAR_REVENUE_ADAPTER_VERSION
    || decoded.sourceUrl !== NEAR_REVENUE_SOURCE_URL || typeof decoded.capturedAt !== 'string'
    || !Number.isFinite(Date.parse(decoded.capturedAt)) || new Date(decoded.capturedAt).toISOString() !== decoded.capturedAt
    || !/^[a-f0-9]{64}$/.test(decoded.rawBodySha256) || !Number.isSafeInteger(decoded.rawBodyBytes)
    || decoded.rawBodyBytes < 1 || decoded.rawBodyBytes > 1024 * 1024 || !Array.isArray(decoded.issues)
    || decoded.issues.length > 32 || !hasExactDataKeys(decoded.series, SERIES_NAMES)) fail();
  for (const issue of decoded.issues) if (typeof issue !== 'string' || issue.length < 1 || issue.length > 512) fail();
  for (const seriesName of SERIES_NAMES) {
    const rows = decoded.series[seriesName];
    if (!Array.isArray(rows) || rows.length > 150000) fail();
    const expectedFields = NEAR_REVENUE_ROW_FIELDS[seriesName];
    for (const row of rows) {
      if (!hasExactDataKeys(row, expectedFields)) fail();
      const config = SERIES_CONFIG[seriesName];
      if (typeof row[config.label] !== 'string' || row[config.label].length === 0 || row[config.label].length > 256
        || typeof row.is_stale !== 'string' || (row.is_stale !== '0' && row.is_stale !== '1')) fail();
      for (const key of Object.keys(row)) {
        if (key === config.label || key === 'is_stale' || key === 'source_used' || key === 'near_source_used' || key === 'usd_source_used') {
          if (typeof row[key] !== 'string' || row[key].length > 256) fail();
        } else if (!decimalParts(row[key])) fail();
      }
      for (const sourceKey of ['source_used', 'near_source_used', 'usd_source_used']) {
        if (Object.prototype.hasOwnProperty.call(row, sourceKey) && typeof row[sourceKey] !== 'string') fail();
      }
    }
  }
}

function sourceReference(row, sourceField) {
  if (!sourceField) return null;
  const value = row[sourceField];
  return typeof value === 'string' ? value : null;
}

function rowObservation(row) {
  if (!row) return null;
  return { ...row, publisherStaleClaim: row.is_stale === '1' };
}

function makeComparison(config, comparison, previous, current, adapterVersion) {
  const labelField = config.label;
  const previousLabel = previous?.[labelField] ?? null;
  const currentLabel = current?.[labelField] ?? null;
  const sourceBefore = sourceReference(previous ?? {}, comparison.source);
  const sourceNow = sourceReference(current ?? {}, comparison.source);
  const base = {
    field: comparison.field,
    unit: comparison.unit,
    previousLabel,
    currentLabel,
    adapterVersion,
    kind: 'exact-direction',
  };
  if (!previous || !current) return { ...base, status: 'UNKNOWN', reason: 'Fewer than two published rows are available.' };
  if (!sourceBefore || sourceBefore === 'none' || !sourceNow || sourceNow === 'none') {
    return { ...base, status: 'UNKNOWN', reason: 'A publisher query/source identifier is missing or marked none.' };
  }
  if (sourceBefore !== sourceNow) return { ...base, status: 'UNKNOWN', reason: 'The adjacent rows use different publisher query/source identifiers.' };
  if (previousLabel === currentLabel) return { ...base, status: 'UNKNOWN', reason: 'The adjacent rows have the same period label.' };
  const direction = compareDecimal(current[comparison.field], previous[comparison.field]);
  return {
    ...base,
    status: 'COMPARED',
    sourceId: sourceNow,
    direction: direction > 0 ? 'higher' : direction < 0 ? 'lower' : 'unchanged',
  };
}

function noSourceZeroUnknowns(seriesName, rows, labelField) {
  const groups = new Map();
  for (const row of rows) {
    for (const sourceField of Object.keys(SOURCE_METRICS)) {
      if (row[sourceField] !== 'none') continue;
      for (const field of SOURCE_METRICS[sourceField]) {
        if (!isZeroDecimal(row[field])) continue;
        const groupKey = sourceField + '\u0000' + field;
        let group = groups.get(groupKey);
        if (!group) {
          group = { sourceField, field, count: 0, firstLabel: row[labelField], lastLabel: row[labelField] };
          groups.set(groupKey, group);
        }
        group.count += 1;
        group.lastLabel = row[labelField];
      }
    }
  }
  return [...groups.values()].map((group) => 'unverified-zero: ' + seriesName + '.' + group.field
    + '; ' + group.sourceField + '=none; rows=' + group.count + '; labels=' + group.firstLabel + '…' + group.lastLabel);
}

function summarizeSeries(seriesName, rows, unknowns, adapterVersion) {
  const config = SERIES_CONFIG[seriesName];
  const previous = rows.length > 1 ? rows[rows.length - 2] : null;
  const current = rows.length > 0 ? rows[rows.length - 1] : null;
  const summary = {
    sampleCount: rows.length,
    labelField: config.label,
    labelSemantics: 'publisher label; not normalized to a UTC window',
    firstLabel: rows[0]?.[config.label] ?? null,
    lastLabel: current?.[config.label] ?? null,
    unitFields: SERIES_UNITS[seriesName],
    previous: rowObservation(previous),
    current: rowObservation(current),
    comparisons: config.comparisons.map((item) => makeComparison(config, item, previous, current, adapterVersion)),
    sourceField: config.source,
    previousSourceId: sourceReference(previous ?? {}, config.source),
    currentSourceId: sourceReference(current ?? {}, config.source),
  };
  if (rows.length === 0) unknowns.push('missing-series-rows: ' + seriesName + ' contains no published rows.');
  if (seriesName === 'revenueSeries') unknowns.push('comparison-provenance-missing: revenueSeries has no published query/source identifier; no trend comparison is claimed.');
  for (const comparison of summary.comparisons) {
    if (comparison.status === 'UNKNOWN') {
      unknowns.push('comparison-unknown: ' + seriesName + '.' + comparison.field + ' ('
        + String(comparison.previousLabel ?? 'none') + ' → ' + String(comparison.currentLabel ?? 'none') + '): ' + comparison.reason);
    }
  }
  unknowns.push(...noSourceZeroUnknowns(seriesName, rows, config.label));
  return summary;
}

export function evaluateNearModel(decoded) {
  validateDecoded(decoded);
  const unknowns = [
    'native-token-demand: NATIVE_TOKEN_DEMAND_UNVERIFIED; published rows do not prove NEAR bought from the market or incremental native-token demand.',
    'economic-net-revenue: NET_CAPTURE_METHODOLOGY_UNVERIFIED; no net-revenue attribution or fee/volume/revenue join is made.',
    'cross-series-periods: date_at and period_month labels do not establish a shared exact reporting window.',
    'freshness: is_stale is publisher metadata, not independent proof of source freshness.',
    'fee-volume-ratio: query identifiers and period labels are unreconciled; a zero volume denominator is undefined, so no ratio is computed.',
  ];
  const seriesSummaries = {};
  let sampleCount = 0;
  for (const seriesName of SERIES_NAMES) {
    const rows = decoded.series[seriesName];
    sampleCount += rows.length;
    seriesSummaries[seriesName] = summarizeSeries(seriesName, rows, unknowns, decoded.adapterVersion);
  }
  const counterCase = [
    'Observed publisher rows support activity reporting only; they do not establish economic net revenue, market purchases, or native-token demand.',
    'Monthly revenue rows publish no query/source identifier, and source-native date labels are not normalized into UTC windows.',
    'Fee, volume, and revenue rows retain distinct query identifiers, units, and publisher stale flags; no cross-series reconciliation is asserted.',
  ];
  if (unknowns.length > 32 || unknowns.some((item) => item.length < 1 || item.length > 512)) {
    throw new NearModelError('MODEL_OUTPUT_TOO_LARGE');
  }
  const result = {
    modelVersion: NEAR_MODEL_VERSION,
    status: sampleCount > 0 ? 'OBSERVED' : 'NO_DATA',
    seriesSummaries,
    unknowns,
    counterCase,
    investmentAssessment: {
      status: 'NO_DATA',
      reasons: ['NATIVE_TOKEN_DEMAND_UNVERIFIED', 'NET_CAPTURE_METHODOLOGY_UNVERIFIED'],
      proposal: null,
    },
    executionReady: false,
  };
  if (Buffer.byteLength(stableStringify(result), 'utf8') > MAX_MODEL_OUTPUT_BYTES) throw new NearModelError('MODEL_OUTPUT_TOO_LARGE');
  return freezeDeep(result);
}
