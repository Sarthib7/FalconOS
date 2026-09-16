import { createHash } from 'node:crypto';

export const STOCKS_SCHEMA_VERSION = 1 as const;
export const STOCK_VENUE = 'solana' as const;
export type StockVenue = typeof STOCK_VENUE;
export type DataProvenance = 'live' | 'synthetic' | 'historical';
export type SnapshotStatus = 'READY' | 'NO_DATA';
export type StockField = 'price' | 'liquidity';
export const STOCK_FIELDS = ['price', 'liquidity'] as const;
export type CaptureStatus = 'ok' | 'outage' | 'invalid';

const SHA256 = /^[a-f0-9]{64}$/;
const NON_EMPTY = /\S/;
const INTEGER = /^(?:0|[1-9]\d*)$/;

type RecordValue = Record<string, unknown>;

function record(value: unknown, name: string): RecordValue {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new TypeError(`${name} must be an object`);
  return value as RecordValue;
}

function exactKeys(value: RecordValue, keys: readonly string[], name: string): void {
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) throw new TypeError(`${name} has unexpected keys`);
}

function stringValue(value: unknown, name: string): string {
  if (typeof value !== 'string' || !NON_EMPTY.test(value)) throw new TypeError(`${name} must be non-empty`);
  return value;
}

function integerString(value: unknown, name: string): string {
  const result = stringValue(value, name);
  if (!INTEGER.test(result)) throw new TypeError(`${name} must be a non-negative integer string`);
  return result;
}

function isoTime(value: unknown, name: string): string {
  const result = stringValue(value, name);
  if (!Number.isFinite(Date.parse(result))) throw new TypeError(`${name} must be an ISO timestamp`);
  return result;
}

function provenance(value: unknown): DataProvenance {
  if (value !== 'live' && value !== 'synthetic' && value !== 'historical') throw new TypeError('provenance must be live, synthetic, or historical');
  return value;
}

function enumValue<T extends string>(value: unknown, allowed: readonly T[], name: string): T {
  if (typeof value !== 'string' || !allowed.includes(value as T)) throw new TypeError(`${name} is invalid`);
  return value as T;
}

function integerFinite(value: unknown, name: string): number {
  if (typeof value !== 'number' || !Number.isInteger(value)) throw new TypeError(`${name} must be an integer`);
  return value;
}

function stableStringify(value: unknown): string {
  if (value === null || typeof value === 'string' || typeof value === 'boolean' || typeof value === 'number') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  const object = value as RecordValue;
  return `{${Object.keys(object).sort().map(key => `${JSON.stringify(key)}:${stableStringify(object[key])}`).join(',')}}`;
}

function sha256Utf8(text: string): string {
  return createHash('sha256').update(Buffer.from(text, 'utf8')).digest('hex');
}

function freezeDeep<T>(value: T): T {
  if (typeof value !== 'object' || value === null) return value;
  for (const child of Object.values(value as RecordValue)) freezeDeep(child);
  return Object.freeze(value);
}

function isDeepFrozen(value: unknown, seen = new WeakSet<object>()): boolean {
  if (typeof value !== 'object' || value === null) return true;
  if (seen.has(value)) return true;
  seen.add(value);
  if (!Object.isFrozen(value)) return false;
  return Object.values(value as RecordValue).every(child => isDeepFrozen(child, seen));
}

export interface StockRegistryEntry {
  schemaVersion: typeof STOCKS_SCHEMA_VERSION;
  venue: StockVenue;
  assetId: string;
  underlying: string;
  precision: number;
}

export function validateStockRegistry(value: unknown): StockRegistryEntry {
  const object = record(value, 'stock registry entry');
  exactKeys(object, ['schemaVersion', 'venue', 'assetId', 'underlying', 'precision'], 'stock registry entry');
  if (object.schemaVersion !== STOCKS_SCHEMA_VERSION) throw new TypeError('stock registry schemaVersion must be 1');
  const venue = enumValue(object.venue, [STOCK_VENUE], 'stock registry venue');
  const assetId = stringValue(object.assetId, 'stock registry assetId');
  const underlying = stringValue(object.underlying, 'stock registry underlying');
  const precision = integerFinite(object.precision, 'stock registry precision');
  if (precision < 0 || precision > 18) throw new TypeError('stock registry precision must be between 0 and 18');
  return { schemaVersion: STOCKS_SCHEMA_VERSION, venue, assetId, underlying, precision };
}

export interface FieldCapture {
  field: StockField;
  status: CaptureStatus;
  capturedAt: string;
  sequence: number;
  rawBytes: string | Uint8Array;
  normalizedValue: string | null;
}

export interface AssetCaptureInput {
  registry: StockRegistryEntry;
  captures: readonly FieldCapture[];
}

export interface CanonicalBasketSnapshotInput {
  assetIds: readonly string[];
  assets: Readonly<Record<string, AssetCaptureInput>>;
  capturedAt: string;
  coherenceCapMs: number;
  provenance: DataProvenance;
}

export interface RawManifestEntry {
  assetId: string;
  field: StockField;
  status: CaptureStatus;
  capturedAt: string | null;
  sequence: number;
  rawBytesBase64: string;
  rawSha256: string;
  normalizedValue: string | null;
}

export interface AssetProjection {
  assetId: string;
  underlying: string;
  fields: Record<StockField, string | null>;
}

export interface CanonicalBasketSnapshotEnvelope {
  schemaVersion: typeof STOCKS_SCHEMA_VERSION;
  kind: 'canonical-basket-snapshot';
  status: SnapshotStatus;
  provenance: DataProvenance;
  venue: StockVenue;
  capturedAt: string;
  coherenceCapMs: number;
  assetIds: readonly string[];
  rawManifestSha256: string;
  normalizedProjectionSha256: string;
}

export interface CanonicalBasketSnapshot {
  envelope: CanonicalBasketSnapshotEnvelope;
  registries: Record<string, StockRegistryEntry>;
  projections: Record<string, AssetProjection>;
  rawManifest: { schemaVersion: typeof STOCKS_SCHEMA_VERSION; entries: readonly RawManifestEntry[] };
  normalized: { schemaVersion: typeof STOCKS_SCHEMA_VERSION; assets: Record<string, AssetProjection> };
  missing: readonly string[];
  conflicts: readonly string[];
  bytes: string;
  hash: string;
  frozen: true;
}

export function createCanonicalBasketSnapshot(input: CanonicalBasketSnapshotInput): CanonicalBasketSnapshot {
  const capturedAt = isoTime(input.capturedAt, 'basket capturedAt');
  const capturedAtMs = Date.parse(capturedAt);
  if (!Number.isInteger(input.coherenceCapMs) || input.coherenceCapMs <= 0) throw new TypeError('basket coherenceCapMs must be a positive integer');
  if (!Array.isArray(input.assetIds) || input.assetIds.length === 0) throw new TypeError('basket assetIds must be a non-empty array');
  const assetIds = [...input.assetIds];
  if (new Set(assetIds).size !== assetIds.length) throw new TypeError('basket assetIds must be unique');

  const missing: string[] = [];
  const conflicts: string[] = [];
  const registries: Record<string, StockRegistryEntry> = {};
  const projections: Record<string, AssetProjection> = {};
  const rawEntries: RawManifestEntry[] = [];
  const selectedTimes: number[] = [];

  for (const assetId of assetIds) {
    const assetInput = input.assets[assetId];
    if (assetInput === undefined) {
      missing.push(`${assetId}.asset`);
      continue;
    }
    const registry = validateStockRegistry(assetInput.registry);
    if (registry.assetId !== assetId) throw new TypeError(`asset ${assetId} registry assetId mismatch`);
    registries[assetId] = registry;
    if (!Array.isArray(assetInput.captures)) throw new TypeError(`asset ${assetId} captures must be an array`);
    const fieldValues: Record<StockField, string | null> = { price: null, liquidity: null };
    const seenFields = new Set<StockField>();
    for (const capture of assetInput.captures) {
      const field = enumValue(capture.field, STOCK_FIELDS, `asset ${assetId} capture.field`);
      if (seenFields.has(field)) throw new TypeError(`asset ${assetId} duplicate field ${field}`);
      seenFields.add(field);
      const status = enumValue(capture.status, ['ok', 'outage', 'invalid'], `asset ${assetId} ${field}.status`);
      const sequence = integerFinite(capture.sequence, `asset ${assetId} ${field}.sequence`);
      if (sequence < 0) throw new TypeError(`asset ${assetId} ${field}.sequence must be non-negative`);
      const bytes = typeof capture.rawBytes === 'string' ? Buffer.from(capture.rawBytes, 'utf8') : new Uint8Array(capture.rawBytes);
      let capturedAtEntry: string | null = null;
      let normalizedValue: string | null = null;
      if (status === 'ok') {
        capturedAtEntry = isoTime(capture.capturedAt, `asset ${assetId} ${field}.capturedAt`);
        const ms = Date.parse(capturedAtEntry);
        if (ms > capturedAtMs) conflicts.push(`${assetId}.${field}.future`);
        else selectedTimes.push(ms);
        normalizedValue = integerString(capture.normalizedValue, `asset ${assetId} ${field}.normalizedValue`);
        fieldValues[field] = normalizedValue;
      } else {
        missing.push(`${assetId}.${field}.${status}`);
      }
      rawEntries.push({
        assetId,
        field,
        status,
        capturedAt: capturedAtEntry,
        sequence,
        rawBytesBase64: Buffer.from(bytes).toString('base64'),
        rawSha256: createHash('sha256').update(bytes).digest('hex'),
        normalizedValue,
      });
    }
    for (const field of STOCK_FIELDS) if (!seenFields.has(field)) missing.push(`${assetId}.${field}.missing`);
    projections[assetId] = { assetId, underlying: registry.underlying, fields: fieldValues };
  }

  if (selectedTimes.length > 1 && Math.max(...selectedTimes) - Math.min(...selectedTimes) > input.coherenceCapMs) {
    conflicts.push('basket.coherence-cap');
  }

  rawEntries.sort((a, b) => a.assetId.localeCompare(b.assetId) || a.field.localeCompare(b.field));
  const rawManifest = { schemaVersion: STOCKS_SCHEMA_VERSION as typeof STOCKS_SCHEMA_VERSION, entries: rawEntries };
  const normalized = { schemaVersion: STOCKS_SCHEMA_VERSION as typeof STOCKS_SCHEMA_VERSION, assets: projections };
  const dedupMissing = [...new Set(missing)].sort();
  const dedupConflicts = [...new Set(conflicts)].sort();
  const status: SnapshotStatus = dedupMissing.length === 0 && dedupConflicts.length === 0 ? 'READY' : 'NO_DATA';
  const envelope: CanonicalBasketSnapshotEnvelope = {
    schemaVersion: STOCKS_SCHEMA_VERSION,
    kind: 'canonical-basket-snapshot',
    status,
    provenance: provenance(input.provenance),
    venue: STOCK_VENUE,
    capturedAt,
    coherenceCapMs: input.coherenceCapMs,
    assetIds,
    rawManifestSha256: sha256Utf8(stableStringify(rawManifest)),
    normalizedProjectionSha256: sha256Utf8(stableStringify(normalized)),
  };
  const payload = { envelope, registries, projections, rawManifest, normalized, missing: dedupMissing, conflicts: dedupConflicts };
  const bytes = stableStringify(payload);
  return freezeDeep({
    envelope,
    registries,
    projections,
    rawManifest,
    normalized,
    missing: dedupMissing,
    conflicts: dedupConflicts,
    bytes,
    hash: sha256Utf8(bytes),
    frozen: true as const,
  });
}

export function validateCanonicalBasketSnapshot(value: unknown): CanonicalBasketSnapshot {
  const object = record(value, 'canonical basket snapshot');
  exactKeys(object, ['envelope', 'registries', 'projections', 'rawManifest', 'normalized', 'missing', 'conflicts', 'bytes', 'hash', 'frozen'], 'canonical basket snapshot');
  if (!isDeepFrozen(object)) throw new TypeError('canonical basket snapshot must be deeply frozen');
  if (object.frozen !== true) throw new TypeError('canonical basket snapshot frozen flag must be true');
  const envelope = record(object.envelope, 'basket envelope');
  exactKeys(envelope, ['schemaVersion', 'kind', 'status', 'provenance', 'venue', 'capturedAt', 'coherenceCapMs', 'assetIds', 'rawManifestSha256', 'normalizedProjectionSha256'], 'basket envelope');
  if (envelope.schemaVersion !== STOCKS_SCHEMA_VERSION || envelope.kind !== 'canonical-basket-snapshot') throw new TypeError('basket envelope invalid');
  const status = enumValue(envelope.status, ['READY', 'NO_DATA'], 'basket status');
  provenance(envelope.provenance);
  enumValue(envelope.venue, [STOCK_VENUE], 'basket venue');
  isoTime(envelope.capturedAt, 'basket capturedAt');
  if (!Number.isInteger(envelope.coherenceCapMs) || (envelope.coherenceCapMs as number) <= 0) throw new TypeError('basket coherenceCapMs invalid');
  if (!Array.isArray(envelope.assetIds) || envelope.assetIds.length === 0) throw new TypeError('basket assetIds invalid');
  const bytes = stringValue(object.bytes, 'basket bytes');
  const hash = stringValue(object.hash, 'basket hash');
  if (!SHA256.test(hash)) throw new TypeError('basket hash must be lowercase SHA-256');
  const missing = object.missing;
  const conflicts = object.conflicts;
  if (!Array.isArray(missing) || !Array.isArray(conflicts)) throw new TypeError('basket missing/conflicts must be arrays');
  const payload = { envelope: object.envelope, registries: object.registries, projections: object.projections, rawManifest: object.rawManifest, normalized: object.normalized, missing: object.missing, conflicts: object.conflicts };
  if (stableStringify(payload) !== bytes) throw new TypeError('basket bytes do not match canonical payload');
  if (sha256Utf8(bytes) !== hash) throw new TypeError('basket hash does not match bytes');
  if (sha256Utf8(stableStringify(object.rawManifest)) !== envelope.rawManifestSha256) throw new TypeError('basket rawManifestSha256 mismatch');
  if (sha256Utf8(stableStringify(object.normalized)) !== envelope.normalizedProjectionSha256) throw new TypeError('basket normalizedProjectionSha256 mismatch');
  const expectedStatus: SnapshotStatus = missing.length === 0 && conflicts.length === 0 ? 'READY' : 'NO_DATA';
  if (status !== expectedStatus) throw new TypeError('basket status does not match missing/conflicts');
  return object as unknown as CanonicalBasketSnapshot;
}
