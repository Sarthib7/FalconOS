import { gzipSync, gunzipSync } from 'node:zlib';
import { freezeDeep, sha256, stableStringify } from '../council/evidence.ts';

export const NEAR_REVENUE_SOURCE_URL = 'https://revenue.near.org/';
export const NEAR_REVENUE_ADAPTER_VERSION = 'near-revenue/1';
export const NEAR_EVIDENCE_SCHEMA_VERSION = 1;
export const NEAR_EVIDENCE_CODEC = 'gzip-base64';
export const NEAR_EVIDENCE_LIMITS = Object.freeze({
  rawBytes: 1024 * 1024,
  compressedBytes: 192 * 1024,
  partBytes: 64 * 1024,
  parts: 3,
  sourceEnvelopeBytes: 128 * 1024,
  fetchDeadlineMs: 15000,
});

const RAW_NUMBER = Symbol('RawJsonNumber');
const MAX_JSON_DEPTH = 96;
const MAX_JSON_TOKENS = 150000;
const MAX_SCAN_ATTEMPTS = 20000;
const MAX_NUMERIC_LEXEME = 512;
const MAX_NUMERIC_EXPONENT = 512;
const REQUIRED_SERIES = Object.freeze(['revenueSeries', 'intentVolumeSeries', 'totalFeesSeries']);
const SERIES_SCHEMAS = Object.freeze({
  revenueSeries: Object.freeze({
    label: 'period_month',
    stringFields: Object.freeze(['period_month']),
    numberFields: Object.freeze(['revenue_usd', 'revenue_near', 'cumulative_revenue_usd', 'cumulative_revenue_near']),
    flagFields: Object.freeze(['is_stale']),
    unitFields: Object.freeze({ revenue_usd: 'USD', revenue_near: 'NEAR', cumulative_revenue_usd: 'USD', cumulative_revenue_near: 'NEAR' }),
  }),
  intentVolumeSeries: Object.freeze({
    label: 'date_at',
    stringFields: Object.freeze(['date_at', 'source_used']),
    numberFields: Object.freeze(['volume_usd', 'cumulative_volume_usd']),
    flagFields: Object.freeze(['is_stale']),
    unitFields: Object.freeze({ volume_usd: 'USD', cumulative_volume_usd: 'USD' }),
  }),
  totalFeesSeries: Object.freeze({
    label: 'date_at',
    stringFields: Object.freeze(['date_at', 'near_source_used', 'usd_source_used']),
    numberFields: Object.freeze([
      'total_fees_near', 'protocol_fee_near', 'intents_revenue_near', 'burn_revenue_near',
      'cumulative_fees_near', 'cumulative_protocol_fee_near', 'cumulative_intents_revenue_near',
      'fees_usd', 'cumulative_fees_usd',
    ]),
    flagFields: Object.freeze(['is_stale']),
    unitFields: Object.freeze({
      total_fees_near: 'NEAR', protocol_fee_near: 'NEAR', intents_revenue_near: 'NEAR', burn_revenue_near: 'NEAR',
      cumulative_fees_near: 'NEAR', cumulative_protocol_fee_near: 'NEAR', cumulative_intents_revenue_near: 'NEAR',
      fees_usd: 'USD', cumulative_fees_usd: 'USD',
    }),
  }),
});
export const NEAR_REVENUE_ROW_FIELDS = Object.freeze(Object.fromEntries(
  Object.entries(SERIES_SCHEMAS).map(([name, schema]) => [name, Object.freeze([
    ...schema.stringFields, ...schema.numberFields, ...schema.flagFields,
  ])]),
));
const ERROR_MESSAGES = Object.freeze({
  INVALID_PACKET: 'Evidence packet is not a supported source packet.',
  PACKET_SCHEMA: 'Evidence packet schema or field types are invalid.',
  PACKET_LIMIT: 'Evidence packet exceeds a configured size limit.',
  PACKET_PARTS: 'Evidence packet parts are incomplete or inconsistent.',
  PART_HASH_MISMATCH: 'Evidence packet part integrity check failed.',
  RAW_HASH_MISMATCH: 'Evidence packet raw-body integrity check failed.',
  RAW_SIZE_MISMATCH: 'Evidence packet raw-body size check failed.',
  GZIP_INVALID: 'Evidence packet gzip body is invalid or exceeds the decompression limit.',
  BODY_TOO_LARGE: 'The public source response exceeds the raw-body limit.',
  BODY_READ_FAILED: 'The public source response could not be read safely.',
  HTTP_STATUS: 'The public source returned a non-success HTTP status.',
  FETCH_TIMEOUT: 'The public source request exceeded its deadline.',
  FETCH_FAILED: 'The public source request failed.',
  CAPTURE_TIME_INVALID: 'The local capture timestamp is invalid.',
  SOURCE_ENCODING_INVALID: 'The source response is not valid UTF-8.',
  SOURCE_SCHEMA_DRIFT: 'The source payload does not match the supported published schema.',
  SOURCE_PAYLOAD_MISSING: 'No supported NEAR revenue payload was found in the page.',
  SOURCE_PAYLOAD_AMBIGUOUS: 'More than one NEAR revenue payload was found in the page.',
  SOURCE_PARSE_FAILED: 'The source page could not be decoded safely.',
});

export class NearEvidenceError extends Error {
  constructor(code, packet) {
    super(ERROR_MESSAGES[code] ?? ERROR_MESSAGES.SOURCE_PARSE_FAILED);
    this.name = 'NearEvidenceError';
    this.code = code;
    if (packet !== undefined) this.packet = packet;
  }
}

class RawJsonNumber {
  constructor(lexeme) {
    this.lexeme = lexeme;
    Object.defineProperty(this, RAW_NUMBER, { value: true });
  }
}

function fail(code, packet) {
  throw new NearEvidenceError(code, packet);
}

function isRawNumber(value) {
  return Boolean(value && typeof value === 'object' && value[RAW_NUMBER] === true);
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

function isDenseDataArray(value, maxLength) {
  if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype || value.length > maxLength) return false;
  const keys = Reflect.ownKeys(value);
  if (keys.length !== value.length + 1 || !keys.includes('length')) return false;
  for (let index = 0; index < value.length; index += 1) {
    const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
    if (!descriptor || !Object.prototype.hasOwnProperty.call(descriptor, 'value') || descriptor.enumerable !== true) return false;
  }
  return true;
}

function isCanonicalIsoTimestamp(value) {
  return typeof value === 'string' && Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value;
}

function parseJsonNumber(text, start) {
  const match = /^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/.exec(text.slice(start));
  if (!match) throw new SyntaxError('Invalid JSON number.');
  const lexeme = match[0];
  if (lexeme.length > MAX_NUMERIC_LEXEME) throw new RangeError('JSON number is too long.');
  return { value: new RawJsonNumber(lexeme), end: start + lexeme.length };
}

function parseJsonAt(text, start = 0) {
  let offset = start;
  let tokens = 0;
  const skipWhitespace = () => {
    while (offset < text.length && /[\u0009\u000a\u000d\u0020]/.test(text[offset])) offset += 1;
  };
  const parseString = () => {
    const begin = offset;
    offset += 1;
    let escaped = false;
    while (offset < text.length) {
      const character = text[offset];
      if (escaped) {
        escaped = false;
        offset += 1;
        continue;
      }
      if (character === '\\') {
        escaped = true;
        offset += 1;
        continue;
      }
      if (character === '"') {
        offset += 1;
        return JSON.parse(text.slice(begin, offset));
      }
      offset += 1;
    }
    throw new SyntaxError('Unterminated JSON string.');
  };
  const parseValue = (depth) => {
    skipWhitespace();
    if (depth > MAX_JSON_DEPTH || ++tokens > MAX_JSON_TOKENS) throw new RangeError('JSON parse bound exceeded.');
    const character = text[offset];
    if (character === '"') return parseString();
    if (character === '{') {
      offset += 1;
      skipWhitespace();
      const result = {};
      if (text[offset] === '}') { offset += 1; return result; }
      while (offset < text.length) {
        skipWhitespace();
        if (text[offset] !== '"') throw new SyntaxError('JSON object key is not a string.');
        const key = parseString();
        if (Object.prototype.hasOwnProperty.call(result, key)) throw new SyntaxError('Duplicate JSON object key.');
        skipWhitespace();
        if (text[offset] !== ':') throw new SyntaxError('Missing JSON object colon.');
        offset += 1;
        const value = parseValue(depth + 1);
        Object.defineProperty(result, key, { value, enumerable: true, writable: true, configurable: true });
        skipWhitespace();
        if (text[offset] === '}') { offset += 1; return result; }
        if (text[offset] !== ',') throw new SyntaxError('Missing JSON object comma.');
        offset += 1;
      }
      throw new SyntaxError('Unterminated JSON object.');
    }
    if (character === '[') {
      offset += 1;
      skipWhitespace();
      const result = [];
      if (text[offset] === ']') { offset += 1; return result; }
      while (offset < text.length) {
        result.push(parseValue(depth + 1));
        skipWhitespace();
        if (text[offset] === ']') { offset += 1; return result; }
        if (text[offset] !== ',') throw new SyntaxError('Missing JSON array comma.');
        offset += 1;
      }
      throw new SyntaxError('Unterminated JSON array.');
    }
    if (character === 't' && text.startsWith('true', offset)) { offset += 4; return true; }
    if (character === 'f' && text.startsWith('false', offset)) { offset += 5; return false; }
    if (character === 'n' && text.startsWith('null', offset)) { offset += 4; return null; }
    if (character === '-' || (character >= '0' && character <= '9')) {
      const parsed = parseJsonNumber(text, offset);
      offset = parsed.end;
      return parsed.value;
    }
    throw new SyntaxError('Invalid JSON value.');
  };
  const value = parseValue(0);
  skipWhitespace();
  return { value, end: offset };
}

function scanStringEnd(text, start) {
  let escaped = false;
  for (let index = start + 1; index < text.length; index += 1) {
    const character = text[index];
    if (escaped) { escaped = false; continue; }
    if (character === '\\') { escaped = true; continue; }
    if (character === '"') return index + 1;
  }
  return text.length;
}

function decodeFlightArgument(script, openParen) {
  let offset = openParen + 1;
  while (offset < script.length && /\s/.test(script[offset])) offset += 1;
  if (script[offset] !== '[') return null;
  const start = offset;
  const stack = [];
  let inString = false;
  let escaped = false;
  for (; offset < script.length; offset += 1) {
    const character = script[offset];
    if (inString) {
      if (escaped) escaped = false;
      else if (character === '\\') escaped = true;
      else if (character === '"') inString = false;
      continue;
    }
    if (character === '"') { inString = true; continue; }
    if (character === '[' || character === '{') stack.push(character);
    else if (character === ']' || character === '}') {
      const expected = character === ']' ? '[' : '{';
      if (stack.pop() !== expected) return null;
      if (stack.length === 0) {
        const argument = script.slice(start, offset + 1);
        let end = offset + 1;
        while (end < script.length && /\s/.test(script[end])) end += 1;
        if (script[end] !== ')') return null;
        try {
          const value = JSON.parse(argument);
          if (Array.isArray(value) && value.length === 2 && value[0] === 1 && typeof value[1] === 'string') return value[1];
        } catch { return null; }
        return null;
      }
    }
  }
  return null;
}

function extractFlightChunks(html) {
  const chunks = [];
  const scriptPattern = /<script\b[^>]*>([\s\S]*?)<\/script\s*>/gi;
  let scriptMatch;
  while ((scriptMatch = scriptPattern.exec(html)) !== null) {
    const script = scriptMatch[1];
    const callPattern = /self\.__next_f\.push\s*\(/g;
    let callMatch;
    while ((callMatch = callPattern.exec(script)) !== null) {
      const chunk = decodeFlightArgument(script, callMatch.index + callMatch[0].length - 1);
      if (chunk !== null) chunks.push(chunk);
    }
  }
  return chunks;
}

function hasSeriesKey(record) {
  return REQUIRED_SERIES.some((name) => Object.prototype.hasOwnProperty.call(record, name));
}

function collectPayloadCandidates(flightText, candidates, state, depth = 0) {
  if (depth > 8 || state.attempts > MAX_SCAN_ATTEMPTS) return;
  let offset = 0;
  while (offset < flightText.length && state.attempts <= MAX_SCAN_ATTEMPTS) {
    const character = flightText[offset];
    if (character === '"') {
      const stringEnd = scanStringEnd(flightText, offset);
      try {
        const parsed = parseJsonAt(flightText, offset);
        if (parsed.end === stringEnd && typeof parsed.value === 'string'
          && parsed.value.includes('revenueSeries')
          && (parsed.value.includes('intentVolumeSeries') || parsed.value.includes('totalFeesSeries'))) {
          collectPayloadCandidates(parsed.value, candidates, state, depth + 1);
        }
      } catch { /* Flight text also contains non-JSON quoted protocol fragments. */ }
      offset = stringEnd;
      continue;
    }
    const delimiter = offset === 0 || /[\s:[,;]/.test(flightText[offset - 1]);
    if (delimiter && (character === '{' || character === '[')) {
      state.attempts += 1;
      try {
        const parsed = parseJsonAt(flightText, offset);
        walkJsonValue(parsed.value, candidates, state, depth + 1);
        offset = parsed.end;
        continue;
      } catch (error) {
        if (error instanceof RangeError) fail('SOURCE_PARSE_FAILED');
      }
    }
    offset += 1;
  }
  if (state.attempts > MAX_SCAN_ATTEMPTS) fail('SOURCE_PARSE_FAILED');
}

function walkJsonValue(value, candidates, state, depth) {
  if (depth > MAX_JSON_DEPTH) fail('SOURCE_PARSE_FAILED');
  if (Array.isArray(value)) {
    for (const item of value) walkJsonValue(item, candidates, state, depth + 1);
    return;
  }
  if (!isPlainRecord(value)) {
    if (typeof value === 'string' && value.includes('revenueSeries')
      && (value.includes('intentVolumeSeries') || value.includes('totalFeesSeries'))) {
      collectPayloadCandidates(value, candidates, state, depth + 1);
    }
    return;
  }
  if (hasSeriesKey(value)) candidates.push(value);
  for (const key of Object.keys(value)) walkJsonValue(value[key], candidates, state, depth + 1);
}

function extractPayload(html) {
  const chunks = extractFlightChunks(html);
  if (chunks.length === 0) fail('SOURCE_PAYLOAD_MISSING');
  const candidates = [];
  const state = { attempts: 0 };
  for (const chunk of chunks) collectPayloadCandidates(chunk, candidates, state);
  if (candidates.length === 0) fail('SOURCE_PAYLOAD_MISSING');
  let selected;
  for (const candidate of candidates) {
    if (!REQUIRED_SERIES.every((name) => Object.prototype.hasOwnProperty.call(candidate, name))) continue;
    if (selected !== undefined) fail('SOURCE_PAYLOAD_AMBIGUOUS');
    selected = candidate;
  }
  if (selected === undefined) fail('SOURCE_SCHEMA_DRIFT');
  return selected;
}

function assertExactKeys(record, keys) {
  if (!hasExactDataKeys(record, keys)) fail('SOURCE_SCHEMA_DRIFT');
}

function assertSourceString(value) {
  if (typeof value !== 'string' || value.length > 256) fail('SOURCE_SCHEMA_DRIFT');
  return value;
}

function assertSourceNumber(value) {
  if (!isRawNumber(value) || !isValidDecimalLexeme(value.lexeme)) fail('SOURCE_SCHEMA_DRIFT');
  return value.lexeme;
}

function isValidDecimalLexeme(lexeme) {
  if (typeof lexeme !== 'string' || lexeme.length > MAX_NUMERIC_LEXEME
    || !/^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?$/.test(lexeme)) return false;
  const exponent = /[eE]([+-]?\d+)$/.exec(lexeme);
  if (exponent && Math.abs(Number(exponent[1])) > MAX_NUMERIC_EXPONENT) return false;
  return true;
}

function normalizeSeriesRow(row, schema) {
  const keys = [...schema.stringFields, ...schema.numberFields, ...schema.flagFields];
  assertExactKeys(row, keys);
  const normalized = {};
  for (const key of schema.stringFields) normalized[key] = assertSourceString(row[key]);
  for (const key of schema.numberFields) normalized[key] = assertSourceNumber(row[key]);
  for (const key of schema.flagFields) {
    const flag = assertSourceNumber(row[key]);
    if (flag !== '0' && flag !== '1') fail('SOURCE_SCHEMA_DRIFT');
    normalized[key] = flag;
  }
  if (normalized[schema.label].length === 0) fail('SOURCE_SCHEMA_DRIFT');
  return normalized;
}

function parsePayload(payload) {
  assertExactKeys(payload, REQUIRED_SERIES);
  const series = {};
  for (const name of REQUIRED_SERIES) {
    const rows = payload[name];
    if (!Array.isArray(rows) || rows.length > MAX_JSON_TOKENS) fail('SOURCE_SCHEMA_DRIFT');
    const schema = SERIES_SCHEMAS[name];
    series[name] = rows.map((row) => normalizeSeriesRow(row, schema));
  }
  return series;
}

function makePartEnvelope(packetFields, part) {
  return stableStringify({ ...packetFields, parts: [part] });
}

function makePacket(rawBody, capturedAt) {
  if (rawBody.byteLength < 1 || rawBody.byteLength > NEAR_EVIDENCE_LIMITS.rawBytes) fail('BODY_TOO_LARGE');
  let compressed;
  try { compressed = gzipSync(rawBody, { level: 9 }); }
  catch { fail('SOURCE_PARSE_FAILED'); }
  if (compressed.byteLength < 1 || compressed.byteLength > NEAR_EVIDENCE_LIMITS.compressedBytes) fail('PACKET_LIMIT');
  const totalParts = Math.ceil(compressed.byteLength / NEAR_EVIDENCE_LIMITS.partBytes);
  if (totalParts < 1 || totalParts > NEAR_EVIDENCE_LIMITS.parts) fail('PACKET_LIMIT');
  const packetFields = {
    schemaVersion: NEAR_EVIDENCE_SCHEMA_VERSION,
    adapterVersion: NEAR_REVENUE_ADAPTER_VERSION,
    sourceKey: 'near-revenue',
    sourceUrl: NEAR_REVENUE_SOURCE_URL,
    capturedAt,
    rawBodySha256: sha256(rawBody),
    rawBodyBytes: rawBody.byteLength,
    codec: NEAR_EVIDENCE_CODEC,
    compressedBytes: compressed.byteLength,
  };
  const parts = [];
  for (let index = 0; index < totalParts; index += 1) {
    const bytes = compressed.subarray(index * NEAR_EVIDENCE_LIMITS.partBytes, Math.min(compressed.byteLength, (index + 1) * NEAR_EVIDENCE_LIMITS.partBytes));
    const part = { index, totalParts, sha256: sha256(bytes), dataBase64: bytes.toString('base64') };
    if (Buffer.byteLength(makePartEnvelope(packetFields, part), 'utf8') > NEAR_EVIDENCE_LIMITS.sourceEnvelopeBytes) fail('PACKET_LIMIT');
    parts.push(part);
  }
  return freezeDeep({ ...packetFields, parts });
}

function assertPacketRecord(packet) {
  const packetKeys = [
    'schemaVersion', 'adapterVersion', 'sourceKey', 'sourceUrl', 'capturedAt',
    'rawBodySha256', 'rawBodyBytes', 'codec', 'compressedBytes', 'parts',
  ];
  if (!hasExactDataKeys(packet, packetKeys)) fail('INVALID_PACKET');
  if (packet.schemaVersion !== NEAR_EVIDENCE_SCHEMA_VERSION || packet.adapterVersion !== NEAR_REVENUE_ADAPTER_VERSION
    || packet.sourceKey !== 'near-revenue' || packet.sourceUrl !== NEAR_REVENUE_SOURCE_URL
    || packet.codec !== NEAR_EVIDENCE_CODEC || !isCanonicalIsoTimestamp(packet.capturedAt)
    || !/^[a-f0-9]{64}$/.test(packet.rawBodySha256)
    || !Number.isSafeInteger(packet.rawBodyBytes) || packet.rawBodyBytes < 1 || packet.rawBodyBytes > NEAR_EVIDENCE_LIMITS.rawBytes
    || !Number.isSafeInteger(packet.compressedBytes) || packet.compressedBytes < 1 || packet.compressedBytes > NEAR_EVIDENCE_LIMITS.compressedBytes) fail('PACKET_SCHEMA');
  const expectedParts = Math.ceil(packet.compressedBytes / NEAR_EVIDENCE_LIMITS.partBytes);
  if (!isDenseDataArray(packet.parts, NEAR_EVIDENCE_LIMITS.parts) || packet.parts.length !== expectedParts || expectedParts < 1) fail('PACKET_PARTS');
  return packet;
}

function verifyPacket(packet) {
  assertPacketRecord(packet);
  const compressedChunks = [];
  for (let index = 0; index < packet.parts.length; index += 1) {
    const part = packet.parts[index];
    if (!hasExactDataKeys(part, ['index', 'totalParts', 'sha256', 'dataBase64'])
      || part.index !== index || part.totalParts !== packet.parts.length || !/^[a-f0-9]{64}$/.test(part.sha256)
      || typeof part.dataBase64 !== 'string') fail('PACKET_PARTS');
    const expectedLength = Math.min(NEAR_EVIDENCE_LIMITS.partBytes, packet.compressedBytes - index * NEAR_EVIDENCE_LIMITS.partBytes);
    if (expectedLength < 1 || part.dataBase64.length !== 4 * Math.ceil(expectedLength / 3)
      || part.dataBase64.length > 4 * Math.ceil(NEAR_EVIDENCE_LIMITS.partBytes / 3)) fail('PACKET_LIMIT');
    const decoded = Buffer.from(part.dataBase64, 'base64');
    if (decoded.byteLength !== expectedLength || decoded.toString('base64') !== part.dataBase64) fail('PACKET_PARTS');
    const envelopeFields = {
      schemaVersion: packet.schemaVersion,
      adapterVersion: packet.adapterVersion,
      sourceKey: packet.sourceKey,
      sourceUrl: packet.sourceUrl,
      capturedAt: packet.capturedAt,
      rawBodySha256: packet.rawBodySha256,
      rawBodyBytes: packet.rawBodyBytes,
      codec: packet.codec,
      compressedBytes: packet.compressedBytes,
    };
    if (Buffer.byteLength(makePartEnvelope(envelopeFields, part), 'utf8') > NEAR_EVIDENCE_LIMITS.sourceEnvelopeBytes) fail('PACKET_LIMIT');
    if (sha256(decoded) !== part.sha256) fail('PART_HASH_MISMATCH');
    compressedChunks.push(decoded);
  }
  const compressed = Buffer.concat(compressedChunks, packet.compressedBytes);
  if (compressed.byteLength !== packet.compressedBytes) fail('PACKET_PARTS');
  let rawBody;
  try { rawBody = gunzipSync(compressed, { maxOutputLength: NEAR_EVIDENCE_LIMITS.rawBytes }); }
  catch { fail('GZIP_INVALID'); }
  if (rawBody.byteLength > NEAR_EVIDENCE_LIMITS.rawBytes) fail('GZIP_INVALID');
  if (rawBody.byteLength !== packet.rawBodyBytes) fail('RAW_SIZE_MISMATCH');
  if (sha256(rawBody) !== packet.rawBodySha256) fail('RAW_HASH_MISMATCH');
  return rawBody;
}

function decodeSourceText(html, packet) {
  try {
    const payload = extractPayload(html);
    const series = parsePayload(payload);
    return freezeDeep({
      schemaVersion: NEAR_EVIDENCE_SCHEMA_VERSION,
      adapterVersion: NEAR_REVENUE_ADAPTER_VERSION,
      sourceUrl: NEAR_REVENUE_SOURCE_URL,
      capturedAt: packet.capturedAt,
      rawBodySha256: packet.rawBodySha256,
      rawBodyBytes: packet.rawBodyBytes,
      series,
      issues: [],
    });
  } catch (error) {
    if (error instanceof NearEvidenceError) {
      if (error.packet === undefined) error.packet = packet;
      throw error;
    }
    fail('SOURCE_PARSE_FAILED', packet);
  }
}

export function inspectNearPacket(packet) {
  let rawBody;
  try { rawBody = verifyPacket(packet); }
  catch (error) {
    if (error instanceof NearEvidenceError) throw error;
    fail('INVALID_PACKET');
  }
  let rawText;
  try { rawText = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(rawBody); }
  catch { fail('SOURCE_ENCODING_INVALID', packet); }
  return freezeDeep({ rawText, rawBodySha256: packet.rawBodySha256, rawBodyBytes: packet.rawBodyBytes });
}

export function decodeNearEvidence(packet) {
  const inspection = inspectNearPacket(packet);
  return decodeSourceText(inspection.rawText, packet);
}

async function readResponseBytes(response) {
  const contentLength = response.headers?.get?.('content-length');
  if (typeof contentLength === 'string' && /^\d+$/.test(contentLength) && Number(contentLength) > NEAR_EVIDENCE_LIMITS.rawBytes) fail('BODY_TOO_LARGE');
  const body = response.body;
  if (body && typeof body.getReader === 'function') {
    const reader = body.getReader();
    const chunks = [];
    let total = 0;
    try {
      while (true) {
        const item = await reader.read();
        if (item.done) break;
        const bytes = item.value instanceof Uint8Array ? item.value : new Uint8Array(item.value);
        total += bytes.byteLength;
        if (total > NEAR_EVIDENCE_LIMITS.rawBytes) {
          try { await reader.cancel(); } catch { /* cancellation is best effort after the limit is crossed */ }
          fail('BODY_TOO_LARGE');
        }
        chunks.push(Buffer.from(bytes));
      }
    } catch (error) {
      if (error instanceof NearEvidenceError) throw error;
      fail('BODY_READ_FAILED');
    }
    return Buffer.concat(chunks, total);
  }
  if (typeof response.arrayBuffer === 'function') {
    let bytes;
    try { bytes = new Uint8Array(await response.arrayBuffer()); }
    catch { fail('BODY_READ_FAILED'); }
    if (bytes.byteLength > NEAR_EVIDENCE_LIMITS.rawBytes) fail('BODY_TOO_LARGE');
    return Buffer.from(bytes);
  }
  fail('BODY_READ_FAILED');
}

export async function captureNearEvidence({ fetchImpl = globalThis.fetch, now = () => new Date().toISOString() } = {}) {
  if (typeof fetchImpl !== 'function') fail('FETCH_FAILED');
  const controller = new AbortController();
  let timeoutId;
  const timeout = new Promise((_, reject) => {
    timeoutId = setTimeout(() => {
      controller.abort();
      reject(new NearEvidenceError('FETCH_TIMEOUT'));
    }, NEAR_EVIDENCE_LIMITS.fetchDeadlineMs);
  });
  try {
    const rawBody = await Promise.race([
      (async () => {
        let response;
        try {
          response = await fetchImpl(NEAR_REVENUE_SOURCE_URL, { method: 'GET', redirect: 'error', signal: controller.signal });
        } catch { fail('FETCH_FAILED'); }
        if (!response || !Number.isInteger(response.status) || response.status < 200 || response.status >= 300 || response.ok === false) fail('HTTP_STATUS');
        return readResponseBytes(response);
      })(),
      timeout,
    ]);
    let capturedAt;
    try { capturedAt = now(); }
    catch { fail('CAPTURE_TIME_INVALID'); }
    if (!isCanonicalIsoTimestamp(capturedAt)) fail('CAPTURE_TIME_INVALID');
    const packet = makePacket(rawBody, capturedAt);
    // Parse once before publishing a capture so source drift fails closed with the bounded packet attached.
    decodeNearEvidence(packet);
    return packet;
  } catch (error) {
    if (error instanceof NearEvidenceError) throw error;
    fail('FETCH_FAILED');
  } finally {
    clearTimeout(timeoutId);
  }
}
