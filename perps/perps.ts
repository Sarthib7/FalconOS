import { createHash } from 'node:crypto';

export const PERPS_SCHEMA_VERSION = 1 as const;
export const PERPS_VENUES = ['phoenix', 'hyperliquid'] as const;
export type PerpsVenue = (typeof PERPS_VENUES)[number];
export type DataProvenance = 'live' | 'synthetic' | 'historical';
export type SnapshotStatus = 'READY' | 'NO_DATA';
export type SnapshotField = 'indexPrice' | 'markPrice' | 'fundingRate' | 'openInterest';
export const SNAPSHOT_FIELDS = ['indexPrice', 'markPrice', 'fundingRate', 'openInterest'] as const;

const SHA256 = /^[a-f0-9]{64}$/;
const NON_EMPTY = /\S/;
const DECIMAL = /^(?:0|[1-9]\d*)(?:\.\d+)?$/;
const SIGNED_DECIMAL = /^-?(?:0|[1-9]\d*)(?:\.\d+)?$/;

type RecordValue = Record<string, unknown>;

function record(value: unknown, name: string): RecordValue {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new TypeError(`${name} must be an object`);
  }
  return value as RecordValue;
}

function exactKeys(value: RecordValue, keys: readonly string[], name: string): void {
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) {
    throw new TypeError(`${name} has unexpected keys`);
  }
}

function stringValue(value: unknown, name: string): string {
  if (typeof value !== 'string' || !NON_EMPTY.test(value)) throw new TypeError(`${name} must be non-empty`);
  return value;
}

function hashValue(value: unknown, name: string): string {
  const result = stringValue(value, name);
  if (!SHA256.test(result)) throw new TypeError(`${name} must be lowercase SHA-256`);
  return result;
}

function optionalString(value: unknown, name: string): string | null {
  if (value === null) return null;
  return stringValue(value, name);
}

function decimal(value: unknown, name: string): string {
  const result = stringValue(value, name);
  if (!DECIMAL.test(result)) throw new TypeError(`${name} must be a non-negative decimal string`);
  return result;
}

function nullableDecimal(value: unknown, name: string): string | null {
  if (value === null) return null;
  return decimal(value, name);
}

function signedDecimal(value: unknown, name: string): string {
  const result = stringValue(value, name);
  if (!SIGNED_DECIMAL.test(result)) throw new TypeError(`${name} must be a signed decimal string`);
  return result;
}
function isoTime(value: unknown, name: string): string {
  const result = stringValue(value, name);
  if (!Number.isFinite(Date.parse(result))) throw new TypeError(`${name} must be an ISO timestamp`);
  return result;
}

function provenance(value: unknown): DataProvenance {
  if (value !== 'live' && value !== 'synthetic' && value !== 'historical') {
    throw new TypeError('provenance must be live, synthetic, or historical');
  }
  return value;
}

function stableStringify(value: unknown): string {
  if (value === null || typeof value === 'string' || typeof value === 'boolean' || typeof value === 'number') {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  const object = value as RecordValue;
  return `{${Object.keys(object).sort().map(key => `${JSON.stringify(key)}:${stableStringify(object[key])}`).join(',')}}`;
}

function sha256(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

function rawBytes(value: string | Uint8Array): Uint8Array {
  return typeof value === 'string' ? Buffer.from(value, 'utf8') : new Uint8Array(value);
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

function enumValue<T extends string>(value: unknown, allowed: readonly T[], name: string): T {
  if (typeof value !== 'string' || !allowed.includes(value as T)) throw new TypeError(`${name} is invalid`);
  return value as T;
}

export interface ContractRegistryEntry {
  schemaVersion: typeof PERPS_SCHEMA_VERSION;
  registryVersion: string;
  venue: PerpsVenue;
  nativeMarketId: string;
  underlying: 'SOL';
  instrumentType: 'perpetual';
  collateralAsset: string;
  settlementAsset: string;
  contractMultiplier: string;
  precision: { priceDecimals: string; quantityDecimals: string; tickSize: string; lotSize: string };
  limits: { minQuantity: string; maxQuantity: string; maxLeverage: string };
  fees: { maker: string; taker: string };
  marketData: { indexSource: string; markSource: string; fundingSource: string; openInterestSource: string };
  margin: { initial: string; maintenance: string; liquidation: string };
  capabilities: { funding: boolean; reduceOnly: boolean; nativeStop: boolean };
  provenance: { capturedAt: string; effectiveFrom: string | null; effectiveTo: string | null; rawSha256: string; adapterVersion: string };
}

export type RegistryResolution =
  | { status: 'READY'; entry: ContractRegistryEntry; missing: readonly string[]; conflicts: readonly string[] }
  | { status: 'NO_DATA'; entry: null; missing: readonly string[]; conflicts: readonly string[] };

export function validateContractRegistry(value: unknown): ContractRegistryEntry {
  const object = record(value, 'registry entry');
  exactKeys(object, ['schemaVersion', 'registryVersion', 'venue', 'nativeMarketId', 'underlying', 'instrumentType', 'collateralAsset', 'settlementAsset', 'contractMultiplier', 'precision', 'limits', 'fees', 'marketData', 'margin', 'capabilities', 'provenance'], 'registry entry');
  if (object.schemaVersion !== PERPS_SCHEMA_VERSION) throw new TypeError('registry schemaVersion must be 1');
  const precision = record(object.precision, 'registry precision');
  exactKeys(precision, ['priceDecimals', 'quantityDecimals', 'tickSize', 'lotSize'], 'registry precision');
  const limits = record(object.limits, 'registry limits');
  exactKeys(limits, ['minQuantity', 'maxQuantity', 'maxLeverage'], 'registry limits');
  const fees = record(object.fees, 'registry fees');
  exactKeys(fees, ['maker', 'taker'], 'registry fees');
  const marketData = record(object.marketData, 'registry marketData');
  exactKeys(marketData, ['indexSource', 'markSource', 'fundingSource', 'openInterestSource'], 'registry marketData');
  const margin = record(object.margin, 'registry margin');
  exactKeys(margin, ['initial', 'maintenance', 'liquidation'], 'registry margin');
  const capabilities = record(object.capabilities, 'registry capabilities');
  exactKeys(capabilities, ['funding', 'reduceOnly', 'nativeStop'], 'registry capabilities');
  const provenanceObject = record(object.provenance, 'registry provenance');
  exactKeys(provenanceObject, ['capturedAt', 'effectiveFrom', 'effectiveTo', 'rawSha256', 'adapterVersion'], 'registry provenance');
  const percentages = [
    ['fees.maker', fees.maker], ['fees.taker', fees.taker], ['margin.initial', margin.initial],
    ['margin.maintenance', margin.maintenance], ['margin.liquidation', margin.liquidation],
  ] as const;
  for (const [name, value] of percentages) decimal(value, name);
  for (const [name, value] of Object.entries(precision)) decimal(value, `precision.${name}`);
  for (const [name, value] of Object.entries(limits)) decimal(value, `limits.${name}`);
  for (const [name, value] of [['contractMultiplier', object.contractMultiplier]] as const) decimal(value, name);
  if (object.underlying !== 'SOL' || object.instrumentType !== 'perpetual') throw new TypeError('registry must describe SOL perpetual');
  if (typeof capabilities.funding !== 'boolean' || typeof capabilities.reduceOnly !== 'boolean' || typeof capabilities.nativeStop !== 'boolean') throw new TypeError('registry capabilities must be boolean');
  return {
    schemaVersion: PERPS_SCHEMA_VERSION,
    registryVersion: stringValue(object.registryVersion, 'registryVersion'),
    venue: enumValue(object.venue, PERPS_VENUES, 'venue'),
    nativeMarketId: stringValue(object.nativeMarketId, 'nativeMarketId'),
    underlying: 'SOL',
    instrumentType: 'perpetual',
    collateralAsset: stringValue(object.collateralAsset, 'collateralAsset'),
    settlementAsset: stringValue(object.settlementAsset, 'settlementAsset'),
    contractMultiplier: decimal(object.contractMultiplier, 'contractMultiplier'),
    precision: {
      priceDecimals: decimal(precision.priceDecimals, 'precision.priceDecimals'),
      quantityDecimals: decimal(precision.quantityDecimals, 'precision.quantityDecimals'),
      tickSize: decimal(precision.tickSize, 'precision.tickSize'),
      lotSize: decimal(precision.lotSize, 'precision.lotSize'),
    },
    limits: {
      minQuantity: decimal(limits.minQuantity, 'limits.minQuantity'),
      maxQuantity: decimal(limits.maxQuantity, 'limits.maxQuantity'),
      maxLeverage: decimal(limits.maxLeverage, 'limits.maxLeverage'),
    },
    fees: { maker: decimal(fees.maker, 'fees.maker'), taker: decimal(fees.taker, 'fees.taker') },
    marketData: {
      indexSource: stringValue(marketData.indexSource, 'marketData.indexSource'),
      markSource: stringValue(marketData.markSource, 'marketData.markSource'),
      fundingSource: stringValue(marketData.fundingSource, 'marketData.fundingSource'),
      openInterestSource: stringValue(marketData.openInterestSource, 'marketData.openInterestSource'),
    },
    margin: {
      initial: decimal(margin.initial, 'margin.initial'),
      maintenance: decimal(margin.maintenance, 'margin.maintenance'),
      liquidation: decimal(margin.liquidation, 'margin.liquidation'),
    },
    capabilities: { funding: capabilities.funding, reduceOnly: capabilities.reduceOnly, nativeStop: capabilities.nativeStop },
    provenance: {
      capturedAt: isoTime(provenanceObject.capturedAt, 'provenance.capturedAt'),
      effectiveFrom: provenanceObject.effectiveFrom === null ? null : isoTime(provenanceObject.effectiveFrom, 'provenance.effectiveFrom'),
      effectiveTo: provenanceObject.effectiveTo === null ? null : isoTime(provenanceObject.effectiveTo, 'provenance.effectiveTo'),
      rawSha256: hashValue(provenanceObject.rawSha256, 'provenance.rawSha256'),
      adapterVersion: stringValue(provenanceObject.adapterVersion, 'provenance.adapterVersion'),
    },
  };
}

export function resolveContractRegistry(value: unknown): RegistryResolution {
  const missing: string[] = [];
  const conflicts: string[] = [];
  if (!Array.isArray(value)) return { status: 'NO_DATA', entry: null, missing: ['registry.entries'], conflicts };
  const entries: ContractRegistryEntry[] = [];
  for (const candidate of value) {
    try { entries.push(validateContractRegistry(candidate)); } catch { missing.push('registry.invalid-entry'); }
  }
  const byVenue = new Map<PerpsVenue, ContractRegistryEntry>();
  for (const entry of entries) {
    const prior = byVenue.get(entry.venue);
    if (prior) conflicts.push(`registry.${entry.venue}`);
    else byVenue.set(entry.venue, entry);
  }
  if (entries.length !== 1 || missing.length > 0 || conflicts.length > 0) {
    if (entries.length === 0) missing.push('registry.entry');
    return { status: 'NO_DATA', entry: null, missing: [...new Set(missing)], conflicts };
  }
  return { status: 'READY', entry: entries[0]!, missing, conflicts };
}
export interface RegistrySetResolution {
  status: 'READY' | 'NO_DATA';
  entries: Readonly<Partial<Record<PerpsVenue, ContractRegistryEntry>>>;
  missing: readonly string[];
  conflicts: readonly string[];
}

export function resolveContractRegistrySet(value: unknown): RegistrySetResolution {
  const missing: string[] = [];
  const conflicts: string[] = [];
  const entries: Partial<Record<PerpsVenue, ContractRegistryEntry>> = {};
  if (!Array.isArray(value)) return { status: 'NO_DATA', entries, missing: ['registry.entries'], conflicts };
  for (const candidate of value) {
    try {
      const entry = validateContractRegistry(candidate);
      if (entries[entry.venue]) conflicts.push(`registry.${entry.venue}`);
      else entries[entry.venue] = entry;
    } catch {
      missing.push('registry.invalid-entry');
    }
  }
  for (const venue of PERPS_VENUES) if (!entries[venue]) missing.push(`registry.${venue}`);
  return { status: missing.length === 0 && conflicts.length === 0 ? 'READY' : 'NO_DATA', entries, missing: [...new Set(missing)], conflicts };
}

export interface SourceSpec {
  sourceId: string;
  adapterVersion: string;
  semanticVersion: string;
}
export interface SourcePrecedence {
  schemaVersion: typeof PERPS_SCHEMA_VERSION;
  venue: PerpsVenue;
  policyVersion: string;
  fields: Record<SnapshotField, { primary: SourceSpec; secondary: SourceSpec | null; freshnessTtlMs: number }>;
}


function validateSourceSpec(value: unknown, name: string): SourceSpec {
  const object = record(value, name);
  exactKeys(object, ['sourceId', 'adapterVersion', 'semanticVersion'], name);
  return { sourceId: stringValue(object.sourceId, `${name}.sourceId`), adapterVersion: stringValue(object.adapterVersion, `${name}.adapterVersion`), semanticVersion: stringValue(object.semanticVersion, `${name}.semanticVersion`) };
}

export function validateSourcePrecedence(value: unknown): SourcePrecedence {
  const object = record(value, 'source precedence');
  exactKeys(object, ['schemaVersion', 'venue', 'policyVersion', 'fields'], 'source precedence');
  if (object.schemaVersion !== PERPS_SCHEMA_VERSION) throw new TypeError('source precedence schemaVersion must be 1');
  const venue = enumValue(object.venue, PERPS_VENUES, 'source precedence venue');
  const fields = record(object.fields, 'source precedence fields') as Record<string, unknown>;
  exactKeys(fields, SNAPSHOT_FIELDS, 'source precedence fields');
  const result = {} as Record<SnapshotField, { primary: SourceSpec; secondary: SourceSpec | null; freshnessTtlMs: number }>;
  for (const field of SNAPSHOT_FIELDS) {
    const item = record(fields[field], `source precedence ${field}`);
    exactKeys(item, ['primary', 'secondary', 'freshnessTtlMs'], `source precedence ${field}`);
    const ttl = item.freshnessTtlMs;
    if (typeof ttl !== 'number' || !Number.isInteger(ttl) || ttl <= 0) throw new TypeError(`${field}.freshnessTtlMs must be positive integer`);
    const primary = validateSourceSpec(item.primary, `${field}.primary`);
    const secondary = item.secondary === null ? null : validateSourceSpec(item.secondary, `${field}.secondary`);
    if (secondary !== null && secondary.sourceId === primary.sourceId) throw new TypeError(`${field} primary and secondary source IDs must differ`);
    result[field] = { primary, secondary, freshnessTtlMs: ttl };
  }
  return { schemaVersion: PERPS_SCHEMA_VERSION, venue, policyVersion: stringValue(object.policyVersion, 'policyVersion'), fields: result };
}

export interface FieldCapture {
  field: SnapshotField;
  sourceId: string;
  sourceRole: 'primary' | 'secondary';
  status: 'ok' | 'outage' | 'invalid';
  capturedAt: string;
  sequence: number;
  continuity: 'continuous' | 'gap';
  rawBytes: string | Uint8Array;
  normalizedValue: string | null;
  adapterVersion: string;
  semanticVersion: string;
  equivalenceValidated: boolean;
}
export interface RawManifestEntry {
  field: SnapshotField;
  sourceId: string;
  sourceRole: 'primary' | 'secondary';
  status: FieldCapture['status'];
  capturedAt: string | null;
  sequence: number;
  continuity: FieldCapture['continuity'];
  rawBytesBase64: string | null;
  rawSha256: string | null;
  normalizedValue: string | null;
  adapterVersion: string;
  semanticVersion: string;
  equivalenceValidated: boolean;
}

export interface NormalizedProjection {
  schemaVersion: typeof PERPS_SCHEMA_VERSION;
  fields: Record<SnapshotField, string | null>;
}

export interface SourceDecision {
  field: SnapshotField;
  policyVersion: string;
  primarySourceId: string;
  secondarySourceId: string | null;
  selectedSourceId: string | null;
  selectedRole: 'primary' | 'secondary' | null;
  selectedCapturedAt: string | null;
  selectedValue: string | null;
  outcome: 'PRIMARY' | 'SECONDARY_FAILOVER' | 'NO_DATA' | 'CONFLICT';
  reason: string | null;
}

export interface SnapshotEnvelope {
  schemaVersion: typeof PERPS_SCHEMA_VERSION;
  status: SnapshotStatus;
  provenance: DataProvenance;
  venue: PerpsVenue;
  nativeMarketId: string;
  registryVersion: string;
  sourcePolicyVersion: string;
  capturedAt: string;
  coherenceCapMs: number;
  rawManifestSha256: string;
  normalizedProjectionSha256: string;
}
export interface CanonicalSnapshot {
  envelope: SnapshotEnvelope;
  registry: ContractRegistryEntry;
  sourcePrecedence: SourcePrecedence;
  rawManifest: { schemaVersion: typeof PERPS_SCHEMA_VERSION; entries: readonly RawManifestEntry[] };
  normalized: NormalizedProjection;
  sourceDecisions: readonly SourceDecision[];
  missing: readonly string[];
  conflicts: readonly string[];
  bytes: string;
  hash: string;
  frozen: true;
}

export interface CanonicalSnapshotInput {
  registry: ContractRegistryEntry;
  precedence: SourcePrecedence;
  captures: readonly FieldCapture[];
  capturedAt: string;
  coherenceCapMs: number;
  provenance: DataProvenance;
}

function validateCapture(value: FieldCapture): FieldCapture {
  enumValue(value.field, SNAPSHOT_FIELDS, 'capture.field');
  stringValue(value.sourceId, 'capture.sourceId');
  enumValue(value.sourceRole, ['primary', 'secondary'] as const, 'capture.sourceRole');
  enumValue(value.status, ['ok', 'outage', 'invalid'] as const, 'capture.status');
  const at = isoTime(value.capturedAt, 'capture.capturedAt');
  if (!Number.isInteger(value.sequence) || value.sequence < 0) throw new TypeError('capture.sequence must be non-negative integer');
  enumValue(value.continuity, ['continuous', 'gap'] as const, 'capture.continuity');
  if (value.normalizedValue !== null) {
    if (value.field === 'fundingRate') signedDecimal(value.normalizedValue, 'capture.normalizedValue');
    else decimal(value.normalizedValue, 'capture.normalizedValue');
  }
  stringValue(value.adapterVersion, 'capture.adapterVersion');
  stringValue(value.semanticVersion, 'capture.semanticVersion');
  if (typeof value.equivalenceValidated !== 'boolean') throw new TypeError('capture.equivalenceValidated must be boolean');
  if (!(typeof value.rawBytes === 'string' || value.rawBytes instanceof Uint8Array)) throw new TypeError('capture.rawBytes must be bytes');
  return { ...value, capturedAt: at, rawBytes: new Uint8Array(rawBytes(value.rawBytes)) };
}

function sourceMatches(capture: FieldCapture, source: SourceSpec): boolean {
  return capture.sourceId === source.sourceId && capture.adapterVersion === source.adapterVersion && capture.semanticVersion === source.semanticVersion;
}

export function createCanonicalSnapshot(input: CanonicalSnapshotInput): CanonicalSnapshot {
  const registry = validateContractRegistry(input.registry);
  const precedence = validateSourcePrecedence(input.precedence);
  if (registry.venue !== precedence.venue) throw new TypeError('registry and source precedence venue mismatch');
  const registrySources: Record<SnapshotField, string> = { indexPrice: registry.marketData.indexSource, markPrice: registry.marketData.markSource, fundingRate: registry.marketData.fundingSource, openInterest: registry.marketData.openInterestSource };
  for (const field of SNAPSHOT_FIELDS) {
    if (precedence.fields[field].primary.sourceId !== registrySources[field]) throw new TypeError(`${field} source policy does not match registry declaration`);
  }
  const capturedAt = isoTime(input.capturedAt, 'capturedAt');
  const now = Date.parse(capturedAt);
  if (!Number.isInteger(input.coherenceCapMs) || input.coherenceCapMs <= 0) throw new TypeError('coherenceCapMs must be positive integer');
  for (const field of SNAPSHOT_FIELDS) {
    if (precedence.fields[field].freshnessTtlMs > input.coherenceCapMs) throw new TypeError(`${field}.freshnessTtlMs exceeds coherenceCapMs`);
  }
  const captures = input.captures.map(validateCapture);
  const byField = new Map<SnapshotField, FieldCapture[]>();
  for (const field of SNAPSHOT_FIELDS) byField.set(field, captures.filter(capture => capture.field === field));
  const sourceDecisions: SourceDecision[] = [];
  const normalizedFields = {} as Record<SnapshotField, string | null>;
  const missing: string[] = [];
  const conflicts: string[] = [];
  const selectedTimes: number[] = [];
  for (const field of SNAPSHOT_FIELDS) {
    const policy = precedence.fields[field];
    const fieldCaptures = byField.get(field)!;
    const seenSourceKeys = new Set<string>();
    let duplicateSource = false;
    for (const capture of fieldCaptures) {
      const sourceKey = `${capture.sourceRole}:${capture.sourceId}`;
      if (seenSourceKeys.has(sourceKey)) duplicateSource = true;
      seenSourceKeys.add(sourceKey);
    }
    const primary = fieldCaptures.find(capture => capture.sourceRole === 'primary' && capture.sourceId === policy.primary.sourceId);
    const secondary = policy.secondary === null ? undefined : fieldCaptures.find(capture => capture.sourceRole === 'secondary' && capture.sourceId === policy.secondary!.sourceId);
    const hasUnconfiguredCapture = fieldCaptures.some(capture => {
      const configured = capture.sourceRole === 'primary'
        ? capture.sourceId === policy.primary.sourceId
        : policy.secondary !== null && capture.sourceId === policy.secondary.sourceId;
    });
    const hasSequenceGap = fieldCaptures.some(capture => capture.continuity === 'gap');
    let selected: FieldCapture | undefined;
    let outcome: SourceDecision['outcome'] = 'NO_DATA';
    let reason: string | null = null;
    if (duplicateSource) {
      conflicts.push(`${field}.duplicate-source`);
      reason = 'duplicate-source';
      outcome = 'CONFLICT';
    } else if (hasSequenceGap) {
      conflicts.push(`${field}.sequence-gap`);
      reason = 'sequence-gap';
      outcome = 'CONFLICT';
    } else if (hasUnconfiguredCapture) {
      conflicts.push(`${field}.source-policy`);
      reason = 'unconfigured-source';
      outcome = 'CONFLICT';
    } else if (!primary) {
      missing.push(`${field}.primary`);
      reason = 'primary-missing';
    } else if (primary.status === 'ok' && primary.normalizedValue !== null && sourceMatches(primary, policy.primary)) {
      selected = primary;
      outcome = 'PRIMARY';
      if (secondary?.status === 'ok' && secondary.normalizedValue !== null && !sourceMatches(secondary, policy.secondary!)) {
        conflicts.push(`${field}.secondary-source-binding`);
        outcome = 'CONFLICT';
        selected = undefined;
        reason = 'secondary-source-binding-conflict';
      } else if (secondary?.status === 'ok' && secondary.normalizedValue !== null && secondary.normalizedValue !== primary.normalizedValue) {
        conflicts.push(`${field}.primary-secondary`);
        outcome = 'CONFLICT';
        selected = undefined;
        reason = 'primary-secondary-disagreement';
      }
    } else if (primary.status === 'outage') {
      if (sourceMatches(primary, policy.primary) && secondary?.status === 'ok' && secondary.normalizedValue !== null && sourceMatches(secondary, policy.secondary!) && secondary.equivalenceValidated) {
        selected = secondary;
        outcome = 'SECONDARY_FAILOVER';
        reason = 'typed-primary-outage';
      } else {
        missing.push(`${field}.primary-outage`);
        reason = secondary?.status === 'ok' ? 'source-binding-or-equivalence-invalid' : 'secondary-unavailable';
      }
    } else {
      missing.push(`${field}.primary-invalid-or-source-binding`);
      reason = 'primary-invalid-or-source-binding';
    }
    if (!selected) normalizedFields[field] = null;
    else {
      const selectedAt = Date.parse(selected.capturedAt);
      if (selectedAt > now) {
        missing.push(`${field}.future`);
        normalizedFields[field] = null;
        selected = undefined;
        outcome = 'NO_DATA';
        reason = 'future-capture';
      } else if (now - selectedAt > input.coherenceCapMs) {
        missing.push(`${field}.coherence-age`);
        normalizedFields[field] = null;
        selected = undefined;
        outcome = 'NO_DATA';
        reason = 'coherence-age';
      } else if (now - selectedAt > policy.freshnessTtlMs) {
        missing.push(`${field}.stale`);
        normalizedFields[field] = null;
        selected = undefined;
        outcome = 'NO_DATA';
        reason = 'stale-capture';
      } else {
        normalizedFields[field] = selected.normalizedValue;
        selectedTimes.push(selectedAt);
      }
    }
    if (!selected && outcome === 'CONFLICT') conflicts.push(`${field}.critical`);
    sourceDecisions.push({
      field,
      policyVersion: precedence.policyVersion,
      primarySourceId: policy.primary.sourceId,
      secondarySourceId: policy.secondary?.sourceId ?? null,
      selectedSourceId: selected?.sourceId ?? null,
      selectedRole: selected?.sourceRole ?? null,
      selectedCapturedAt: selected?.capturedAt ?? null,
      selectedValue: selected?.normalizedValue ?? null,
      outcome,
      reason,
    });
  }
  if (selectedTimes.length > 1) {
    const spread = Math.max(...selectedTimes) - Math.min(...selectedTimes);
    if (spread > input.coherenceCapMs) {
      conflicts.push('snapshot.coherence-cap');
      for (const decision of sourceDecisions) {
        if (decision.selectedSourceId !== null) {
          normalizedFields[decision.field] = null;
          missing.push(`${decision.field}.coherence`);
        }
      }
    }
  }
  const normalized: NormalizedProjection = { schemaVersion: PERPS_SCHEMA_VERSION, fields: normalizedFields };
  const rawEntries: RawManifestEntry[] = captures
    .sort((a, b) => a.field.localeCompare(b.field) || a.sourceRole.localeCompare(b.sourceRole) || a.sourceId.localeCompare(b.sourceId))
    .map(capture => {
      const bytes = rawBytes(capture.rawBytes);
      return { field: capture.field, sourceId: capture.sourceId, sourceRole: capture.sourceRole, status: capture.status, capturedAt: capture.capturedAt, sequence: capture.sequence, continuity: capture.continuity, rawBytesBase64: Buffer.from(bytes).toString('base64'), rawSha256: sha256(bytes), normalizedValue: capture.normalizedValue, adapterVersion: capture.adapterVersion, semanticVersion: capture.semanticVersion, equivalenceValidated: capture.equivalenceValidated };
    });
  const rawManifest = { schemaVersion: PERPS_SCHEMA_VERSION as typeof PERPS_SCHEMA_VERSION, entries: rawEntries };
  const rawManifestSha256 = sha256(Buffer.from(stableStringify(rawManifest), 'utf8'));
  const normalizedProjectionSha256 = sha256(Buffer.from(stableStringify(normalized), 'utf8'));
  const status: SnapshotStatus = missing.length === 0 && conflicts.length === 0 ? 'READY' : 'NO_DATA';
  const envelope: SnapshotEnvelope = {
    schemaVersion: PERPS_SCHEMA_VERSION,
    status,
    provenance: provenance(input.provenance),
    venue: registry.venue,
    nativeMarketId: registry.nativeMarketId,
    registryVersion: registry.registryVersion,
    sourcePolicyVersion: precedence.policyVersion,
    capturedAt,
    coherenceCapMs: input.coherenceCapMs,
    rawManifestSha256,
    normalizedProjectionSha256,
  };
  const sourcePrecedence = precedence;
  const payload = { envelope, registry, sourcePrecedence, rawManifest, normalized, sourceDecisions, missing: [...new Set(missing)].sort(), conflicts: [...new Set(conflicts)].sort() };
  const bytes = stableStringify(payload);
  const result: CanonicalSnapshot = {
    envelope,
    registry,
    sourcePrecedence,
    rawManifest,
    normalized,
    sourceDecisions,
    missing: [...new Set(missing)].sort(),
    conflicts: [...new Set(conflicts)].sort(),
    bytes,
    hash: sha256(Buffer.from(bytes, 'utf8')),
    frozen: true,
  };
  return freezeDeep(result);
}
export interface CanonicalSnapshotBundleEnvelope {
  schemaVersion: typeof PERPS_SCHEMA_VERSION;
  kind: 'canonical-snapshot-bundle';
  status: SnapshotStatus;
  provenance: DataProvenance;
  capturedAt: string;
  coherenceCapMs: number;
  venues: readonly [PerpsVenue, PerpsVenue];
  rawManifestSha256: string;
  normalizedProjectionSha256: string;
}

export interface CanonicalSnapshotBundle {
  envelope: CanonicalSnapshotBundleEnvelope;
  registries: Record<PerpsVenue, ContractRegistryEntry>;
  sourcePrecedence: Record<PerpsVenue, SourcePrecedence>;
  markets: Record<PerpsVenue, CanonicalSnapshot>;
  rawManifest: { schemaVersion: typeof PERPS_SCHEMA_VERSION; entries: readonly (RawManifestEntry & { venue: PerpsVenue })[] };
  normalized: { schemaVersion: typeof PERPS_SCHEMA_VERSION; markets: Record<PerpsVenue, NormalizedProjection> };
  sourceDecisions: readonly (SourceDecision & { venue: PerpsVenue })[];
  missing: readonly string[];
  conflicts: readonly string[];
  bytes: string;
  hash: string;
  frozen: true;
}

export interface CanonicalSnapshotBundleInput {
  registries: Record<PerpsVenue, ContractRegistryEntry>;
  precedence: Record<PerpsVenue, SourcePrecedence>;
  captures: Record<PerpsVenue, readonly FieldCapture[]>;
  capturedAt: string;
  coherenceCapMs: number;
  provenance: DataProvenance;
}

function exactVenueKeys(value: unknown, name: string): Record<PerpsVenue, unknown> {
  const object = record(value, name);
  exactKeys(object, PERPS_VENUES, name);
  return object as Record<PerpsVenue, unknown>;
}

function validateCanonicalMarketSnapshot(value: unknown): CanonicalSnapshot {
  const object = record(value, 'canonical market snapshot');
  exactKeys(object, ['envelope', 'registry', 'sourcePrecedence', 'rawManifest', 'normalized', 'sourceDecisions', 'missing', 'conflicts', 'bytes', 'hash', 'frozen'], 'canonical market snapshot');
  if (!isDeepFrozen(object)) throw new TypeError('canonical market snapshot must be deeply frozen');
  const envelope = record(object.envelope, 'canonical market envelope');
  exactKeys(envelope, ['schemaVersion', 'status', 'provenance', 'venue', 'nativeMarketId', 'registryVersion', 'sourcePolicyVersion', 'capturedAt', 'coherenceCapMs', 'rawManifestSha256', 'normalizedProjectionSha256'], 'canonical market envelope');
  if (envelope.schemaVersion !== PERPS_SCHEMA_VERSION) throw new TypeError('canonical market schemaVersion must be 1');
  enumValue(envelope.status, ['READY', 'NO_DATA'] as const, 'canonical market status');
  provenance(envelope.provenance);
  const registry = validateContractRegistry(object.registry);
  enumValue(envelope.venue, PERPS_VENUES, 'canonical market venue');
  if (registry.venue !== envelope.venue || registry.nativeMarketId !== envelope.nativeMarketId || registry.registryVersion !== envelope.registryVersion) throw new TypeError('canonical market registry binding mismatch');
  stringValue(envelope.nativeMarketId, 'canonical market nativeMarketId');
  stringValue(envelope.registryVersion, 'canonical market registryVersion');
  const precedence = validateSourcePrecedence(object.sourcePrecedence);
  if (precedence.venue !== envelope.venue || precedence.policyVersion !== envelope.sourcePolicyVersion) throw new TypeError('canonical market source binding mismatch');
  stringValue(envelope.sourcePolicyVersion, 'canonical market sourcePolicyVersion');
  isoTime(envelope.capturedAt, 'canonical market capturedAt');
  if (typeof envelope.coherenceCapMs !== 'number' || !Number.isInteger(envelope.coherenceCapMs) || envelope.coherenceCapMs <= 0) throw new TypeError('canonical market coherenceCapMs invalid');
  const rawManifest = record(object.rawManifest, 'canonical market rawManifest');
  exactKeys(rawManifest, ['schemaVersion', 'entries'], 'canonical market rawManifest');
  if (rawManifest.schemaVersion !== PERPS_SCHEMA_VERSION || !Array.isArray(rawManifest.entries)) throw new TypeError('canonical market rawManifest invalid');
  const normalized = record(object.normalized, 'canonical market normalized');
  exactKeys(normalized, ['schemaVersion', 'fields'], 'canonical market normalized');
  if (normalized.schemaVersion !== PERPS_SCHEMA_VERSION) throw new TypeError('canonical market normalized schemaVersion invalid');
  const normalizedFields = record(normalized.fields, 'canonical market normalized fields');
  exactKeys(normalizedFields, SNAPSHOT_FIELDS, 'canonical market normalized fields');
  for (const field of SNAPSHOT_FIELDS) {
    const normalizedValue = normalizedFields[field];
    if (normalizedValue !== null) {
      if (field === 'fundingRate') signedDecimal(normalizedValue, `canonical market ${field}`);
      else decimal(normalizedValue, `canonical market ${field}`);
    }
  }
  if (!Array.isArray(rawManifest.entries)) throw new TypeError('canonical market rawManifest entries invalid');
  for (const [index, entryValue] of rawManifest.entries.entries()) {
    const entry = record(entryValue, `canonical market rawManifest entry ${index}`);
    exactKeys(entry, ['field', 'sourceId', 'sourceRole', 'status', 'capturedAt', 'sequence', 'continuity', 'rawBytesBase64', 'rawSha256', 'normalizedValue', 'adapterVersion', 'semanticVersion', 'equivalenceValidated'], `canonical market rawManifest entry ${index}`);
    enumValue(entry.field, SNAPSHOT_FIELDS, `canonical market rawManifest entry ${index}.field`);
    stringValue(entry.sourceId, `canonical market rawManifest entry ${index}.sourceId`);
    enumValue(entry.sourceRole, ['primary', 'secondary'] as const, `canonical market rawManifest entry ${index}.sourceRole`);
    enumValue(entry.status, ['ok', 'outage', 'invalid'] as const, `canonical market rawManifest entry ${index}.status`);
    isoTime(entry.capturedAt, `canonical market rawManifest entry ${index}.capturedAt`);
    if (typeof entry.sequence !== 'number' || !Number.isInteger(entry.sequence) || entry.sequence < 0) throw new TypeError(`canonical market rawManifest entry ${index}.sequence invalid`);
    enumValue(entry.continuity, ['continuous', 'gap'] as const, `canonical market rawManifest entry ${index}.continuity`);
    if (typeof entry.rawBytesBase64 !== 'string') throw new TypeError(`canonical market rawManifest entry ${index}.rawBytesBase64 invalid`);
    const decoded = Buffer.from(entry.rawBytesBase64, 'base64');
    if (decoded.toString('base64') !== entry.rawBytesBase64 || sha256(decoded) !== entry.rawSha256) throw new TypeError(`canonical market rawManifest entry ${index}.raw hash mismatch`);
    if (entry.normalizedValue !== null) {
      if (entry.field === 'fundingRate') signedDecimal(entry.normalizedValue, `canonical market rawManifest entry ${index}.normalizedValue`);
      else decimal(entry.normalizedValue, `canonical market rawManifest entry ${index}.normalizedValue`);
    }
    stringValue(entry.adapterVersion, `canonical market rawManifest entry ${index}.adapterVersion`);
    stringValue(entry.semanticVersion, `canonical market rawManifest entry ${index}.semanticVersion`);
    if (typeof entry.equivalenceValidated !== 'boolean') throw new TypeError(`canonical market rawManifest entry ${index}.equivalenceValidated invalid`);
  }
  if (!Array.isArray(object.sourceDecisions) || object.sourceDecisions.length !== SNAPSHOT_FIELDS.length) throw new TypeError('canonical market sourceDecisions invalid');
  const decisionFields = new Set<string>();
  for (const [index, decisionValue] of object.sourceDecisions.entries()) {
    const decision = record(decisionValue, `canonical market sourceDecision ${index}`);
    exactKeys(decision, ['field', 'policyVersion', 'primarySourceId', 'secondarySourceId', 'selectedSourceId', 'selectedRole', 'selectedCapturedAt', 'selectedValue', 'outcome', 'reason'], `canonical market sourceDecision ${index}`);
    const field = enumValue(decision.field, SNAPSHOT_FIELDS, `canonical market sourceDecision ${index}.field`);
    if (decisionFields.has(field)) throw new TypeError('canonical market sourceDecisions duplicate field');
    decisionFields.add(field);
    if (decision.policyVersion !== precedence.policyVersion || decision.primarySourceId !== precedence.fields[field].primary.sourceId || decision.secondarySourceId !== (precedence.fields[field].secondary?.sourceId ?? null)) throw new TypeError(`canonical market sourceDecision ${field} policy binding mismatch`);
    const selectedSourceId = optionalString(decision.selectedSourceId, `canonical market sourceDecision ${field}.selectedSourceId`);
    const selectedRole = decision.selectedRole === null ? null : enumValue(decision.selectedRole, ['primary', 'secondary'] as const, `canonical market sourceDecision ${field}.selectedRole`);
    const selectedValue = optionalString(decision.selectedValue, `canonical market sourceDecision ${field}.selectedValue`);
    if ((selectedSourceId === null) !== (selectedRole === null) || (selectedSourceId === null) !== (selectedValue === null)) throw new TypeError(`canonical market sourceDecision ${field} selection mismatch`);
    if (selectedValue !== null) {
      if (field === 'fundingRate') signedDecimal(selectedValue, `canonical market sourceDecision ${field}.selectedValue`);
      else decimal(selectedValue, `canonical market sourceDecision ${field}.selectedValue`);
    }
    if (decision.selectedCapturedAt !== null) isoTime(decision.selectedCapturedAt, `canonical market sourceDecision ${field}.selectedCapturedAt`);
    enumValue(decision.outcome, ['PRIMARY', 'SECONDARY_FAILOVER', 'NO_DATA', 'CONFLICT'] as const, `canonical market sourceDecision ${field}.outcome`);
    optionalString(decision.reason, `canonical market sourceDecision ${field}.reason`);
  }
  if (decisionFields.size !== SNAPSHOT_FIELDS.length) throw new TypeError('canonical market sourceDecisions missing field');
  for (const name of ['missing', 'conflicts'] as const) {
    if (!Array.isArray(object[name]) || object[name].some(item => typeof item !== 'string' || !NON_EMPTY.test(item))) throw new TypeError(`canonical market ${name} invalid`);
  }
  const reconstructedCaptures: FieldCapture[] = rawManifest.entries.map((entryValue, index) => {
    const entry = record(entryValue, `canonical market rawManifest entry ${index}`);
    return {
      field: enumValue(entry.field, SNAPSHOT_FIELDS, `canonical market rawManifest entry ${index}.field`),
      sourceId: stringValue(entry.sourceId, `canonical market rawManifest entry ${index}.sourceId`),
      sourceRole: enumValue(entry.sourceRole, ['primary', 'secondary'] as const, `canonical market rawManifest entry ${index}.sourceRole`),
      status: enumValue(entry.status, ['ok', 'outage', 'invalid'] as const, `canonical market rawManifest entry ${index}.status`),
      capturedAt: isoTime(entry.capturedAt, `canonical market rawManifest entry ${index}.capturedAt`),
      sequence: entry.sequence as number,
      continuity: enumValue(entry.continuity, ['continuous', 'gap'] as const, `canonical market rawManifest entry ${index}.continuity`),
      rawBytes: Buffer.from(entry.rawBytesBase64 as string, 'base64'),
      normalizedValue: entry.normalizedValue as string | null,
      adapterVersion: stringValue(entry.adapterVersion, `canonical market rawManifest entry ${index}.adapterVersion`),
      semanticVersion: stringValue(entry.semanticVersion, `canonical market rawManifest entry ${index}.semanticVersion`),
      equivalenceValidated: entry.equivalenceValidated as boolean,
    };
  });
  const reconstructed = createCanonicalSnapshot({ registry, precedence, captures: reconstructedCaptures, capturedAt: envelope.capturedAt as string, coherenceCapMs: envelope.coherenceCapMs as number, provenance: envelope.provenance as DataProvenance });
  if (stableStringify(reconstructed.envelope) !== stableStringify(envelope) || stableStringify(reconstructed.rawManifest) !== stableStringify(rawManifest) || stableStringify(reconstructed.normalized) !== stableStringify(normalized) || stableStringify(reconstructed.sourceDecisions) !== stableStringify(object.sourceDecisions) || stableStringify(reconstructed.missing) !== stableStringify(object.missing) || stableStringify(reconstructed.conflicts) !== stableStringify(object.conflicts)) throw new TypeError('canonical market derived projection mismatch');
  const rawManifestHash = sha256(Buffer.from(stableStringify(rawManifest), 'utf8'));
  const normalizedHash = sha256(Buffer.from(stableStringify(normalized), 'utf8'));
  if (object.frozen !== true) throw new TypeError('canonical market is not frozen');
  const payload = { envelope, registry: object.registry, sourcePrecedence: precedence, rawManifest, normalized, sourceDecisions: object.sourceDecisions, missing: object.missing, conflicts: object.conflicts };
  const bytes = stringValue(object.bytes, 'canonical market bytes');
  if (bytes !== stableStringify(payload) || sha256(Buffer.from(bytes, 'utf8')) !== hashValue(object.hash, 'canonical market hash')) throw new TypeError('canonical market bundle hash mismatch');
  return object as unknown as CanonicalSnapshot;
}
export function createCanonicalSnapshotBundle(input: CanonicalSnapshotBundleInput): CanonicalSnapshotBundle {
  const capturedAt = isoTime(input.capturedAt, 'bundle capturedAt');
  if (!Number.isInteger(input.coherenceCapMs) || input.coherenceCapMs <= 0) throw new TypeError('bundle coherenceCapMs must be positive integer');
  const inputRegistries = exactVenueKeys(input.registries, 'bundle registries');
  const inputPrecedence = exactVenueKeys(input.precedence, 'bundle precedence');
  const inputCaptures = exactVenueKeys(input.captures, 'bundle captures');
  const registries = {} as Record<PerpsVenue, ContractRegistryEntry>;
  const precedence = {} as Record<PerpsVenue, SourcePrecedence>;
  const markets = {} as Record<PerpsVenue, CanonicalSnapshot>;
  for (const venue of PERPS_VENUES) {
    const registry = validateContractRegistry(inputRegistries[venue]);
    const policy = validateSourcePrecedence(inputPrecedence[venue]);
    if (registry.venue !== venue) throw new TypeError(`bundle registries.${venue} venue mismatch`);
    if (policy.venue !== venue) throw new TypeError(`bundle precedence.${venue} venue mismatch`);
    const captures = inputCaptures[venue];
    if (!Array.isArray(captures)) throw new TypeError(`bundle captures.${venue} must be an array`);
    registries[venue] = registry;
    precedence[venue] = policy;
    markets[venue] = createCanonicalSnapshot({ registry, precedence: policy, captures: captures as readonly FieldCapture[], capturedAt, coherenceCapMs: input.coherenceCapMs, provenance: input.provenance });
  }
  const missing: string[] = [];
  const conflicts: string[] = [];
  const rawEntries: (RawManifestEntry & { venue: PerpsVenue })[] = [];
  const normalizedMarkets = {} as Record<PerpsVenue, NormalizedProjection>;
  const sourceDecisions: (SourceDecision & { venue: PerpsVenue })[] = [];
  const selectedTimes: number[] = [];
  for (const venue of PERPS_VENUES) {
    const market = markets[venue];
    for (const item of market.missing) missing.push(`${venue}.${item}`);
    for (const item of market.conflicts) conflicts.push(`${venue}.${item}`);
    normalizedMarkets[venue] = market.normalized;
    for (const entry of market.rawManifest.entries) rawEntries.push({ ...entry, venue });
    for (const decision of market.sourceDecisions) {
      sourceDecisions.push({ ...decision, venue });
      if (decision.selectedCapturedAt !== null) selectedTimes.push(Date.parse(decision.selectedCapturedAt));
    }
  }
  if (selectedTimes.length > 1 && Math.max(...selectedTimes) - Math.min(...selectedTimes) > input.coherenceCapMs) {
    conflicts.push('bundle.cross-venue-coherence-cap');
  }
  rawEntries.sort((a, b) => a.venue.localeCompare(b.venue) || a.field.localeCompare(b.field) || a.sourceRole.localeCompare(b.sourceRole) || a.sourceId.localeCompare(b.sourceId));
  sourceDecisions.sort((a, b) => a.venue.localeCompare(b.venue) || a.field.localeCompare(b.field));
  const rawManifest = { schemaVersion: PERPS_SCHEMA_VERSION as typeof PERPS_SCHEMA_VERSION, entries: rawEntries };
  const normalized = { schemaVersion: PERPS_SCHEMA_VERSION as typeof PERPS_SCHEMA_VERSION, markets: normalizedMarkets };
  const rawManifestSha256 = sha256(Buffer.from(stableStringify(rawManifest), 'utf8'));
  const normalizedProjectionSha256 = sha256(Buffer.from(stableStringify(normalized), 'utf8'));
  const status: SnapshotStatus = missing.length === 0 && conflicts.length === 0 ? 'READY' : 'NO_DATA';
  const envelope: CanonicalSnapshotBundleEnvelope = {
    schemaVersion: PERPS_SCHEMA_VERSION,
    kind: 'canonical-snapshot-bundle',
    status,
    provenance: provenance(input.provenance),
    capturedAt,
    coherenceCapMs: input.coherenceCapMs,
    venues: ['phoenix', 'hyperliquid'],
    rawManifestSha256,
    normalizedProjectionSha256,
  };
  const payload = { envelope, registries, sourcePrecedence: precedence, markets, rawManifest, normalized, sourceDecisions, missing: [...new Set(missing)].sort(), conflicts: [...new Set(conflicts)].sort() };
  const bytes = stableStringify(payload);
  return freezeDeep({
    envelope,
    registries,
    sourcePrecedence: precedence,
    markets,
    rawManifest,
    normalized,
    sourceDecisions,
    missing: [...new Set(missing)].sort(),
    conflicts: [...new Set(conflicts)].sort(),
    bytes,
    hash: sha256(Buffer.from(bytes, 'utf8')),
    frozen: true,
  });
}

export function validateCanonicalSnapshotBundle(value: unknown): CanonicalSnapshotBundle {
  const object = record(value, 'canonical snapshot bundle');
  exactKeys(object, ['envelope', 'registries', 'sourcePrecedence', 'markets', 'rawManifest', 'normalized', 'sourceDecisions', 'missing', 'conflicts', 'bytes', 'hash', 'frozen'], 'canonical snapshot bundle');
  if (!isDeepFrozen(object)) throw new TypeError('canonical snapshot bundle must be deeply frozen');
  const envelope = record(object.envelope, 'canonical bundle envelope');
  exactKeys(envelope, ['schemaVersion', 'kind', 'status', 'provenance', 'capturedAt', 'coherenceCapMs', 'venues', 'rawManifestSha256', 'normalizedProjectionSha256'], 'canonical bundle envelope');
  if (envelope.schemaVersion !== PERPS_SCHEMA_VERSION || envelope.kind !== 'canonical-snapshot-bundle') throw new TypeError('canonical bundle envelope invalid');
  enumValue(envelope.status, ['READY', 'NO_DATA'] as const, 'canonical bundle status');
  const bundleProvenance = provenance(envelope.provenance);
  const bundleCapturedAt = isoTime(envelope.capturedAt, 'canonical bundle capturedAt');
  if (typeof envelope.coherenceCapMs !== 'number' || !Number.isInteger(envelope.coherenceCapMs) || envelope.coherenceCapMs <= 0) throw new TypeError('canonical bundle coherenceCapMs invalid');
  if (!Array.isArray(envelope.venues) || envelope.venues.length !== 2 || envelope.venues[0] !== 'phoenix' || envelope.venues[1] !== 'hyperliquid') throw new TypeError('canonical bundle venues invalid');
  const registries = exactVenueKeys(object.registries, 'canonical bundle registries') as Record<PerpsVenue, unknown>;
  const sourcePrecedence = exactVenueKeys(object.sourcePrecedence, 'canonical bundle sourcePrecedence') as Record<PerpsVenue, unknown>;
  const markets = exactVenueKeys(object.markets, 'canonical bundle markets') as Record<PerpsVenue, unknown>;
  const validatedRegistries = {} as Record<PerpsVenue, ContractRegistryEntry>;
  const validatedPrecedence = {} as Record<PerpsVenue, SourcePrecedence>;
  const validatedMarkets = {} as Record<PerpsVenue, CanonicalSnapshot>;
  for (const venue of PERPS_VENUES) {
    validatedRegistries[venue] = validateContractRegistry(registries[venue]);
    validatedPrecedence[venue] = validateSourcePrecedence(sourcePrecedence[venue]);
    validatedMarkets[venue] = validateCanonicalMarketSnapshot(markets[venue]);
    if (validatedRegistries[venue].venue !== venue || validatedPrecedence[venue].venue !== venue) throw new TypeError(`canonical bundle ${venue} map binding mismatch`);
    if (stableStringify(validatedRegistries[venue]) !== stableStringify(validatedMarkets[venue].registry)) throw new TypeError(`canonical bundle ${venue} registry binding mismatch`);
    if (stableStringify(validatedPrecedence[venue]) !== stableStringify(validatedMarkets[venue].sourcePrecedence)) throw new TypeError(`canonical bundle ${venue} source binding mismatch`);
    const marketEnvelope = validatedMarkets[venue].envelope;
    if (marketEnvelope.venue !== venue || marketEnvelope.nativeMarketId !== validatedRegistries[venue].nativeMarketId || marketEnvelope.registryVersion !== validatedRegistries[venue].registryVersion || marketEnvelope.sourcePolicyVersion !== validatedPrecedence[venue].policyVersion || marketEnvelope.provenance !== bundleProvenance || marketEnvelope.capturedAt !== bundleCapturedAt || marketEnvelope.coherenceCapMs !== envelope.coherenceCapMs) throw new TypeError(`canonical bundle ${venue} envelope binding mismatch`);
  }
  const rawManifest = record(object.rawManifest, 'canonical bundle rawManifest');
  exactKeys(rawManifest, ['schemaVersion', 'entries'], 'canonical bundle rawManifest');
  if (rawManifest.schemaVersion !== PERPS_SCHEMA_VERSION || !Array.isArray(rawManifest.entries)) throw new TypeError('canonical bundle rawManifest invalid');
  const normalized = record(object.normalized, 'canonical bundle normalized');
  exactKeys(normalized, ['schemaVersion', 'markets'], 'canonical bundle normalized');
  if (normalized.schemaVersion !== PERPS_SCHEMA_VERSION) throw new TypeError('canonical bundle normalized schemaVersion invalid');
  const expectedRawEntries: (RawManifestEntry & { venue: PerpsVenue })[] = [];
  const expectedSourceDecisions: (SourceDecision & { venue: PerpsVenue })[] = [];
  const expectedMissing: string[] = [];
  const expectedConflicts: string[] = [];
  const selectedTimes: number[] = [];
  const expectedNormalizedMarkets = {} as Record<PerpsVenue, NormalizedProjection>;
  for (const venue of PERPS_VENUES) {
    const market = validatedMarkets[venue];
    expectedNormalizedMarkets[venue] = market.normalized;
    for (const entry of market.rawManifest.entries) expectedRawEntries.push({ ...entry, venue });
    for (const decision of market.sourceDecisions) {
      expectedSourceDecisions.push({ ...decision, venue });
      if (decision.selectedCapturedAt !== null) selectedTimes.push(Date.parse(decision.selectedCapturedAt));
    }
    for (const item of market.missing) expectedMissing.push(`${venue}.${item}`);
    for (const item of market.conflicts) expectedConflicts.push(`${venue}.${item}`);
  }
  if (selectedTimes.length > 1 && Math.max(...selectedTimes) - Math.min(...selectedTimes) > envelope.coherenceCapMs) expectedConflicts.push('bundle.cross-venue-coherence-cap');
  expectedRawEntries.sort((a, b) => a.venue.localeCompare(b.venue) || a.field.localeCompare(b.field) || a.sourceRole.localeCompare(b.sourceRole) || a.sourceId.localeCompare(b.sourceId));
  expectedSourceDecisions.sort((a, b) => a.venue.localeCompare(b.venue) || a.field.localeCompare(b.field));
  const expectedMissingList = [...new Set(expectedMissing)].sort();
  const expectedConflictsList = [...new Set(expectedConflicts)].sort();
  if (stableStringify(rawManifest) !== stableStringify({ schemaVersion: PERPS_SCHEMA_VERSION, entries: expectedRawEntries }) || stableStringify(normalized) !== stableStringify({ schemaVersion: PERPS_SCHEMA_VERSION, markets: expectedNormalizedMarkets }) || stableStringify(object.sourceDecisions) !== stableStringify(expectedSourceDecisions) || stableStringify(object.missing) !== stableStringify(expectedMissingList) || stableStringify(object.conflicts) !== stableStringify(expectedConflictsList)) throw new TypeError('canonical bundle projection binding mismatch');
  const expectedStatus: SnapshotStatus = expectedMissingList.length === 0 && expectedConflictsList.length === 0 ? 'READY' : 'NO_DATA';
  if (envelope.status !== expectedStatus) throw new TypeError('canonical bundle status binding mismatch');
  const rawManifestHash = sha256(Buffer.from(stableStringify(rawManifest), 'utf8'));
  const normalizedHash = sha256(Buffer.from(stableStringify(normalized), 'utf8'));
  if (rawManifestHash !== envelope.rawManifestSha256 || normalizedHash !== envelope.normalizedProjectionSha256) throw new TypeError('canonical bundle content hash mismatch');
  if (object.frozen !== true) throw new TypeError('canonical bundle is not frozen');
  const payload = { envelope, registries: validatedRegistries, sourcePrecedence: validatedPrecedence, markets: validatedMarkets, rawManifest, normalized, sourceDecisions: object.sourceDecisions, missing: object.missing, conflicts: object.conflicts };
  const bytes = stringValue(object.bytes, 'canonical bundle bytes');
  if (bytes !== stableStringify(payload) || sha256(Buffer.from(bytes, 'utf8')) !== hashValue(object.hash, 'canonical bundle hash')) throw new TypeError('canonical bundle hash mismatch');
  return object as unknown as CanonicalSnapshotBundle;
}

export interface PolicyState {
  policyId: string;
  policyVersion: string;
  maxLeverage: string;
  maxLoss: string;
}

export interface AccountState {
  accountId: string;
  availableCollateral: string;
  currentExposure: string;
}

function validatePolicy(value: PolicyState): PolicyState {
  const object = record(value, 'policy');
  exactKeys(object, ['policyId', 'policyVersion', 'maxLeverage', 'maxLoss'], 'policy');
  return { policyId: stringValue(object.policyId, 'policy.policyId'), policyVersion: stringValue(object.policyVersion, 'policy.policyVersion'), maxLeverage: decimal(object.maxLeverage, 'policy.maxLeverage'), maxLoss: decimal(object.maxLoss, 'policy.maxLoss') };
}

function validateAccount(value: AccountState): AccountState {
  const object = record(value, 'account');
  exactKeys(object, ['accountId', 'availableCollateral', 'currentExposure'], 'account');
  return { accountId: stringValue(object.accountId, 'account.accountId'), availableCollateral: decimal(object.availableCollateral, 'account.availableCollateral'), currentExposure: decimal(object.currentExposure, 'account.currentExposure') };
}

export type TradeStance = 'LONG' | 'SHORT' | 'FLAT' | 'NO_DATA';

function sourceDecisionsSha256(snapshot: CanonicalSnapshotBundle): string {
  return sha256(Buffer.from(stableStringify(snapshot.sourceDecisions), 'utf8'));
}

function selectedEvidenceSha256(snapshot: CanonicalSnapshotBundle): string {
  const selected = snapshot.sourceDecisions.map(decision => ({ venue: decision.venue, field: decision.field, selectedSourceId: decision.selectedSourceId, selectedRole: decision.selectedRole, selectedCapturedAt: decision.selectedCapturedAt, selectedValue: decision.selectedValue, outcome: decision.outcome }));
  return sha256(Buffer.from(stableStringify(selected), 'utf8'));
}
export interface TradeProposal {
  schemaVersion: typeof PERPS_SCHEMA_VERSION;
  kind: 'trade-proposal';
  proposalId: string;
  status: 'PROPOSED' | 'NO_DATA';
  specialist: 'perps';
  venue: PerpsVenue;
  nativeMarketId: string;
  stance: TradeStance;
  suggestedSize: string | null;
  suggestedLeverage: string | null;
  estimatedRiskBounds: { maxLoss: string | null; liquidationDistance: string | null; marginAtRisk: string | null };
  policyReference: { policyId: string; policyVersion: string } | null;
  policyBinding: PolicyState | null;
  accountReference: string | null;
  accountBinding: AccountState | null;
  scenarios: { base: string; upside: string; downside: string };
  confidence: number | null;
  horizon: string | null;
  invalidations: readonly string[];
  snapshotEvidence: { snapshotHash: string; rawManifestSha256: string; normalizedProjectionSha256: string; sourceDecisionsSha256: string; selectedEvidenceSha256: string; capturedAt: string };
  expiresAt: string;
  provenance: DataProvenance;
  authority: 'non-binding-advisory';
  executionReady: false;
}

export interface TradeProposalInput {
  proposalId: string;
  snapshot: CanonicalSnapshotBundle;
  venue: PerpsVenue;
  stance: Exclude<TradeStance, 'NO_DATA'>;
  suggestedSize?: string | null;
  suggestedLeverage?: string | null;
  estimatedRiskBounds?: { maxLoss?: string | null; liquidationDistance?: string | null; marginAtRisk?: string | null };
  scenarios: { base: string; upside: string; downside: string };
  confidence?: number | null;
  horizon?: string | null;
  invalidations: readonly string[];
  expiresAt: string;
  policy: PolicyState | null;
  account: AccountState | null;
  provenance: DataProvenance;
}

export function createTradeProposal(input: TradeProposalInput): TradeProposal {
  const snapshot = input.snapshot;
  const venue = enumValue(input.venue, PERPS_VENUES, 'proposal venue');
  const market = snapshot.markets[venue];
  const hasState = input.policy !== null && input.account !== null;
  const policy = input.policy === null ? null : validatePolicy(input.policy);
  const account = input.account === null ? null : validateAccount(input.account);
  const noData = snapshot.envelope.status === 'NO_DATA' || market.envelope.status === 'NO_DATA';
  const status = noData ? 'NO_DATA' : 'PROPOSED';
  const numeric = hasState && !noData;
  const expiresAt = isoTime(input.expiresAt, 'expiresAt');
  if (Date.parse(expiresAt) <= Date.parse(snapshot.envelope.capturedAt)) throw new TypeError('expiresAt must follow snapshot capture');
  const confidence = numeric ? (input.confidence ?? null) : null;
  if (confidence !== null && (typeof confidence !== 'number' || !Number.isFinite(confidence) || confidence < 0 || confidence > 1)) throw new TypeError('confidence must be between 0 and 1');
  const proposal: TradeProposal = {
    schemaVersion: PERPS_SCHEMA_VERSION,
    kind: 'trade-proposal',
    proposalId: stringValue(input.proposalId, 'proposalId'),
    status,
    specialist: 'perps',
    venue,
    nativeMarketId: market.registry.nativeMarketId,
    stance: noData ? 'NO_DATA' : input.stance,
    suggestedSize: numeric ? nullableDecimal(input.suggestedSize ?? null, 'suggestedSize') : null,
    suggestedLeverage: numeric ? nullableDecimal(input.suggestedLeverage ?? null, 'suggestedLeverage') : null,
    estimatedRiskBounds: {
      maxLoss: numeric ? nullableDecimal(input.estimatedRiskBounds?.maxLoss ?? null, 'estimatedRiskBounds.maxLoss') : null,
      liquidationDistance: numeric ? nullableDecimal(input.estimatedRiskBounds?.liquidationDistance ?? null, 'estimatedRiskBounds.liquidationDistance') : null,
      marginAtRisk: numeric ? nullableDecimal(input.estimatedRiskBounds?.marginAtRisk ?? null, 'estimatedRiskBounds.marginAtRisk') : null,
    },
    policyReference: policy === null ? null : { policyId: policy.policyId, policyVersion: policy.policyVersion },
    policyBinding: policy,
    accountReference: account?.accountId ?? null,
    accountBinding: account,
    scenarios: {
      base: stringValue(input.scenarios.base, 'scenarios.base'),
      upside: stringValue(input.scenarios.upside, 'scenarios.upside'),
      downside: stringValue(input.scenarios.downside, 'scenarios.downside'),
    },
    confidence,
    horizon: numeric ? optionalString(input.horizon ?? null, 'horizon') : null,
    invalidations: input.invalidations.map((value, index) => stringValue(value, `invalidations[${index}]`)),
    snapshotEvidence: { snapshotHash: snapshot.hash, rawManifestSha256: snapshot.envelope.rawManifestSha256, normalizedProjectionSha256: snapshot.envelope.normalizedProjectionSha256, sourceDecisionsSha256: sourceDecisionsSha256(snapshot), selectedEvidenceSha256: selectedEvidenceSha256(snapshot), capturedAt: snapshot.envelope.capturedAt },
    expiresAt,
    provenance: provenance(input.provenance),
    authority: 'non-binding-advisory',
    executionReady: false,
  };
  return freezeDeep(proposal);
}
export function hashTradeProposal(proposal: TradeProposal | null): string | null {
  return proposal === null ? null : sha256(Buffer.from(stableStringify(proposal), 'utf8'));
}


export function validateTradeProposal(value: unknown): TradeProposal {
  const object = record(value, 'trade proposal');
  exactKeys(object, ['schemaVersion', 'kind', 'proposalId', 'status', 'specialist', 'venue', 'nativeMarketId', 'stance', 'suggestedSize', 'suggestedLeverage', 'estimatedRiskBounds', 'policyReference', 'policyBinding', 'accountReference', 'accountBinding', 'scenarios', 'confidence', 'horizon', 'invalidations', 'snapshotEvidence', 'expiresAt', 'provenance', 'authority', 'executionReady'], 'trade proposal');
  if (object.schemaVersion !== PERPS_SCHEMA_VERSION || object.kind !== 'trade-proposal' || object.specialist !== 'perps' || object.executionReady !== false || object.authority !== 'non-binding-advisory') throw new TypeError('invalid trade proposal authority');
  stringValue(object.proposalId, 'proposalId');
  stringValue(object.nativeMarketId, 'nativeMarketId');
  const bounds = record(object.estimatedRiskBounds, 'estimatedRiskBounds');
  exactKeys(bounds, ['maxLoss', 'liquidationDistance', 'marginAtRisk'], 'estimatedRiskBounds');
  const scenarios = record(object.scenarios, 'scenarios');
  exactKeys(scenarios, ['base', 'upside', 'downside'], 'scenarios');
  stringValue(scenarios.base, 'scenarios.base');
  stringValue(scenarios.upside, 'scenarios.upside');
  stringValue(scenarios.downside, 'scenarios.downside');
  const evidence = record(object.snapshotEvidence, 'snapshotEvidence');
  exactKeys(evidence, ['snapshotHash', 'rawManifestSha256', 'normalizedProjectionSha256', 'sourceDecisionsSha256', 'selectedEvidenceSha256', 'capturedAt'], 'snapshotEvidence');
  if (object.status !== 'PROPOSED' && object.status !== 'NO_DATA') throw new TypeError('invalid trade proposal status');
  enumValue(object.venue, PERPS_VENUES, 'venue');
  enumValue(object.stance, ['LONG', 'SHORT', 'FLAT', 'NO_DATA'] as const, 'stance');
  nullableDecimal(object.suggestedSize, 'suggestedSize');
  nullableDecimal(object.suggestedLeverage, 'suggestedLeverage');
  nullableDecimal(bounds.maxLoss, 'estimatedRiskBounds.maxLoss');
  nullableDecimal(bounds.liquidationDistance, 'estimatedRiskBounds.liquidationDistance');
  nullableDecimal(bounds.marginAtRisk, 'estimatedRiskBounds.marginAtRisk');
  if (object.policyBinding !== null) validatePolicy(object.policyBinding as PolicyState);
  const policyReference = object.policyReference === null ? null : record(object.policyReference, 'policyReference');
  if (policyReference !== null) {
    exactKeys(policyReference, ['policyId', 'policyVersion'], 'policyReference');
    stringValue(policyReference.policyId, 'policyReference.policyId');
    stringValue(policyReference.policyVersion, 'policyReference.policyVersion');
  }
  if (object.policyBinding === null) {
    if (policyReference !== null) throw new TypeError('proposal policy binding mismatch');
  } else if (policyReference === null || policyReference.policyId !== (object.policyBinding as PolicyState).policyId || policyReference.policyVersion !== (object.policyBinding as PolicyState).policyVersion) throw new TypeError('proposal policy reference mismatch');
  if (object.accountBinding !== null) validateAccount(object.accountBinding as AccountState);
  if (object.accountReference !== null) stringValue(object.accountReference, 'accountReference');
  if (object.accountBinding === null) {
    if (object.accountReference !== null) throw new TypeError('proposal account binding mismatch');
  } else if (object.accountReference !== (object.accountBinding as AccountState).accountId) throw new TypeError('proposal account reference mismatch');
  optionalString(object.horizon, 'horizon');
  if (!Array.isArray(object.invalidations)) throw new TypeError('invalidations must be an array');
  for (const [index, invalidation] of object.invalidations.entries()) stringValue(invalidation, `invalidations[${index}]`);
  provenance(object.provenance);
  const expiresAt = isoTime(object.expiresAt, 'expiresAt');
  hashValue(evidence.snapshotHash, 'snapshotEvidence.snapshotHash');
  hashValue(evidence.rawManifestSha256, 'snapshotEvidence.rawManifestSha256');
  hashValue(evidence.normalizedProjectionSha256, 'snapshotEvidence.normalizedProjectionSha256');
  hashValue(evidence.sourceDecisionsSha256, 'snapshotEvidence.sourceDecisionsSha256');
  hashValue(evidence.selectedEvidenceSha256, 'snapshotEvidence.selectedEvidenceSha256');
  isoTime(evidence.capturedAt, 'snapshotEvidence.capturedAt');
  if (Date.parse(expiresAt) <= Date.parse(evidence.capturedAt as string)) throw new TypeError('expiresAt must follow snapshot evidence capture');
  validateProposalStateSemantics(object as unknown as TradeProposal, object.policyBinding as PolicyState | null, object.accountBinding as AccountState | null);
  const confidence = object.confidence;
  if (confidence !== null && (typeof confidence !== 'number' || !Number.isFinite(confidence) || confidence < 0 || confidence > 1)) throw new TypeError('invalid confidence');
  return object as unknown as TradeProposal;
}

export interface RiskReview {
  schemaVersion: typeof PERPS_SCHEMA_VERSION;
  kind: 'risk-review';
  reviewId: string;
  requestId: string;
  runId: string;
  status: 'PASS' | 'BLOCK' | 'NO_DATA';
  critical: boolean;
  veto: boolean;
  reasons: readonly string[];
  reviewer: 'independent-risk-reviewer';
  policyVersion: string | null;
  snapshotHash: string;
  leadProposalHash: string | null;
  authority: 'veto-only';
}

export interface RiskReviewFailure {
  schemaVersion: typeof PERPS_SCHEMA_VERSION;
  kind: 'risk-review-failure';
  code: 'TRANSPORT_FAILURE' | 'INVALID_REVIEW' | 'NO_DATA';
  authority: 'veto-only';
}

export interface LeadSpecialistRequest {
  schemaVersion: typeof PERPS_SCHEMA_VERSION;
  kind: 'council.lead-request';
  role: 'lead-specialist';
  requestId: string;
  runId: string;
  snapshot: CanonicalSnapshotBundle;
  snapshotEvidence: SnapshotEvidenceReference;
  policy: PolicyState | null;
  account: AccountState | null;
}

export interface LeadSpecialistResponse {
  schemaVersion: typeof PERPS_SCHEMA_VERSION;
  kind: 'council.lead-response';
  role: 'lead-specialist';
  requestId: string;
  runId: string;
  snapshotHash: string;
  proposal: TradeProposal | null;
  status: 'PROPOSED' | 'NO_DATA';
}

export interface RiskReviewRequest {
  schemaVersion: typeof PERPS_SCHEMA_VERSION;
  kind: 'council.risk-request';
  role: 'independent-risk-reviewer';
  requestId: string;
  runId: string;
  snapshot: CanonicalSnapshotBundle;
  snapshotEvidence: SnapshotEvidenceReference;
  policy: PolicyState | null;
  account: AccountState | null;
  leadProposal: TradeProposal | null;
  leadProposalHash: string | null;
}

export interface RiskReviewResponse {
  schemaVersion: typeof PERPS_SCHEMA_VERSION;
  kind: 'council.risk-response';
  role: 'independent-risk-reviewer';
  requestId: string;
  runId: string;
  reviewId: string;
  status: 'PASS' | 'BLOCK' | 'NO_DATA';
  critical: boolean;
  reasons: readonly string[];
  policyVersion: string | null;
  snapshotHash: string;
}
function validateProposalStateSemantics(proposal: TradeProposal, policy: PolicyState | null, account: AccountState | null): void {
  if (proposal.status === 'NO_DATA' && proposal.stance !== 'NO_DATA') throw new TypeError('NO_DATA proposal must use NO_DATA stance');
  if (proposal.status === 'PROPOSED' && proposal.stance === 'NO_DATA') throw new TypeError('PROPOSED proposal cannot use NO_DATA stance');
  const stateAllowsNumeric = policy !== null && account !== null && proposal.status !== 'NO_DATA';
  if (!stateAllowsNumeric && (proposal.suggestedSize !== null || proposal.suggestedLeverage !== null || proposal.estimatedRiskBounds.maxLoss !== null || proposal.estimatedRiskBounds.liquidationDistance !== null || proposal.estimatedRiskBounds.marginAtRisk !== null || proposal.confidence !== null || proposal.horizon !== null)) throw new TypeError('proposal dependent fields require complete policy/account state');
}
function validateBoundSnapshotEvidence(value: unknown): { evidence: SnapshotEvidenceReference; bundle: CanonicalSnapshotBundle } {
  const evidence = validateSnapshotEvidence(value);
  let parsed: unknown;
  try {
    const decoded = JSON.parse(evidence.bytes) as RecordValue;
    const decodedMarkets = decoded.markets as RecordValue;
    const rebuildMarket = (market: RecordValue): RecordValue => {
      const payload = { envelope: market.envelope, registry: market.registry, sourcePrecedence: market.sourcePrecedence, rawManifest: market.rawManifest, normalized: market.normalized, sourceDecisions: market.sourceDecisions, missing: market.missing, conflicts: market.conflicts };
      const bytes = stableStringify(payload);
      return { ...market, bytes, hash: sha256(Buffer.from(bytes, 'utf8')), frozen: true };
    };
    parsed = freezeDeep({ ...decoded, markets: { phoenix: rebuildMarket(decodedMarkets.phoenix as RecordValue), hyperliquid: rebuildMarket(decodedMarkets.hyperliquid as RecordValue) }, bytes: evidence.bytes, hash: evidence.snapshotHash, frozen: true });
  } catch {
    throw new TypeError('snapshot evidence bytes must encode canonical bundle');
  }
  const bundle = validateCanonicalSnapshotBundle(parsed);
  if (stableStringify(evidence) !== stableStringify(snapshotEvidence(bundle))) throw new TypeError('snapshot evidence bundle binding mismatch');
  return { evidence, bundle };
}

function validateProposalBinding(snapshot: CanonicalSnapshotBundle, proposal: TradeProposal, expectedPolicy: PolicyState | null = null, expectedAccount: AccountState | null = null): void {
  validateTradeProposal(proposal);
  const expiresAt = isoTime(proposal.expiresAt, 'expiresAt');
  if (Date.parse(expiresAt) <= Date.parse(snapshot.envelope.capturedAt)) throw new TypeError('proposal expiresAt must follow snapshot capture');
  const market = snapshot.markets[proposal.venue];
  const noData = snapshot.envelope.status === 'NO_DATA' || market.envelope.status === 'NO_DATA';
  if (noData && proposal.status !== 'NO_DATA') throw new TypeError('proposal status must be NO_DATA for unavailable snapshot');
  if (!noData && proposal.status !== 'PROPOSED') throw new TypeError('ready snapshot and market require PROPOSED proposal');
  if (proposal.nativeMarketId !== market.registry.nativeMarketId) throw new TypeError('proposal native market binding mismatch');
  if (proposal.snapshotEvidence.snapshotHash !== snapshot.hash || proposal.snapshotEvidence.rawManifestSha256 !== snapshot.envelope.rawManifestSha256 || proposal.snapshotEvidence.normalizedProjectionSha256 !== snapshot.envelope.normalizedProjectionSha256 || proposal.snapshotEvidence.sourceDecisionsSha256 !== sourceDecisionsSha256(snapshot) || proposal.snapshotEvidence.selectedEvidenceSha256 !== selectedEvidenceSha256(snapshot) || proposal.snapshotEvidence.capturedAt !== snapshot.envelope.capturedAt) throw new TypeError('proposal snapshot evidence binding mismatch');
  if (proposal.provenance !== snapshot.envelope.provenance) throw new TypeError('proposal provenance binding mismatch');
  const policy = expectedPolicy === null ? null : validatePolicy(expectedPolicy);
  const account = expectedAccount === null ? null : validateAccount(expectedAccount);
  if (stableStringify(proposal.policyBinding) !== stableStringify(policy)) throw new TypeError('proposal policy state binding mismatch');
  if (stableStringify(proposal.accountBinding) !== stableStringify(account)) throw new TypeError('proposal account state binding mismatch');
  validateProposalStateSemantics(proposal, policy, account);
}
function validateSnapshotEvidence(value: unknown): SnapshotEvidenceReference {
  const object = record(value, 'snapshot evidence');
  exactKeys(object, ['snapshotHash', 'bytes', 'rawManifestSha256', 'normalizedProjectionSha256', 'sourceDecisionsSha256', 'selectedEvidenceSha256', 'capturedAt', 'marketNativeIds'], 'snapshot evidence');
  const markets = record(object.marketNativeIds, 'snapshot evidence marketNativeIds');
  exactKeys(markets, ['phoenix', 'hyperliquid'], 'snapshot evidence marketNativeIds');
  const evidence = {
    snapshotHash: hashValue(object.snapshotHash, 'snapshot evidence hash'),
    bytes: stringValue(object.bytes, 'snapshot evidence bytes'),
    rawManifestSha256: hashValue(object.rawManifestSha256, 'snapshot evidence raw manifest hash'),
    normalizedProjectionSha256: hashValue(object.normalizedProjectionSha256, 'snapshot evidence normalized projection hash'),
    sourceDecisionsSha256: hashValue(object.sourceDecisionsSha256, 'snapshot evidence source decisions hash'),
    selectedEvidenceSha256: hashValue(object.selectedEvidenceSha256, 'snapshot evidence selected evidence hash'),
    capturedAt: isoTime(object.capturedAt, 'snapshot evidence capturedAt'),
    marketNativeIds: {
      phoenix: stringValue(markets.phoenix, 'snapshot evidence phoenix nativeMarketId'),
      hyperliquid: stringValue(markets.hyperliquid, 'snapshot evidence hyperliquid nativeMarketId'),
    },
  };
  if (sha256(Buffer.from(evidence.bytes, 'utf8')) !== evidence.snapshotHash) throw new TypeError('snapshot evidence content hash mismatch');
  return evidence;
}
function emptyAudit(evidence: SnapshotEvidenceReference | null, requestId: string, runId: string): CouncilAuditRecord {
  return freezeDeep({ schemaVersion: PERPS_SCHEMA_VERSION, kind: 'council.audit' as const, requestId, runId, snapshotEvidence: evidence, policy: null, account: null, lead: { role: 'lead-specialist' as const, requestId, runId, status: 'INVALID' as const, outcome: 'FAILED' as const, proposal: null, proposalHash: null, snapshotHash: evidence?.snapshotHash ?? null }, risk: { role: 'independent-risk-reviewer' as const, requestId, runId, status: 'INVALID' as const, reviewId: null, critical: null, veto: null, reasons: [], policyVersion: null, leadProposalHash: null, snapshotHash: null } });
}

function safeAdviceFailure(value: unknown, leadInput?: CouncilLeadAuditInput, leadProposal: TradeProposal | null = null): CouncilAdviceResponse {
  const object = typeof value === 'object' && value !== null ? value as RecordValue : {};
  const requestId = typeof object.requestId === 'string' && object.requestId.length > 0 ? object.requestId : 'invalid-request';
  const runId = typeof object.runId === 'string' && object.runId.length > 0 ? object.runId : 'invalid-run';
  let evidence: SnapshotEvidenceReference | null = null;
  let audit = emptyAudit(evidence, requestId, runId);
  try {
    const validatedRequest = validateCouncilAdviceRequest(value);
    evidence = snapshotEvidence(validatedRequest.snapshot);
    audit = createCouncilAudit(validatedRequest.snapshot, validatedRequest.requestId, validatedRequest.runId, validatedRequest.policy, validatedRequest.account, leadProposal, failureReview('NO_DATA'), leadInput);
  } catch {}
  return freezeDeep({ schemaVersion: PERPS_SCHEMA_VERSION, kind: 'council.advice', requestId, runId, status: 'NO_DATA', proposal: null, riskReview: failureReview('NO_DATA'), snapshotEvidence: evidence, audit, authority: 'advisory-only', executionReady: false });
}

function safeCopilotFailure(value: unknown): CouncilCopilotResponse {
  const object = typeof value === 'object' && value !== null ? value as RecordValue : {};
  const requestId = typeof object.requestId === 'string' && object.requestId.length > 0 ? object.requestId : 'invalid-request';
  const runId = typeof object.runId === 'string' && object.runId.length > 0 ? object.runId : 'invalid-run';
  let evidence: SnapshotEvidenceReference | null = null;
  try {
    const snapshot = validateCanonicalSnapshotBundle(object.snapshot);
    evidence = snapshotEvidence(snapshot);
  } catch {}
  return freezeDeep({ schemaVersion: PERPS_SCHEMA_VERSION, kind: 'council.copilot' as const, requestId, runId, status: 'NO_DATA' as const, explanation: null, snapshotEvidence: evidence, authority: 'explanation-only' as const, canCreateTradeProposal: false as const, executionReady: false as const });
}

function validateCallEnvelope(value: unknown, kind: LeadSpecialistRequest['kind'] | RiskReviewRequest['kind'], role: LeadSpecialistRequest['role'] | RiskReviewRequest['role']): RecordValue {
  const object = record(value, `${kind} request`);
  exactKeys(object, ['schemaVersion', 'kind', 'role', 'requestId', 'runId', 'snapshot', 'snapshotEvidence', 'policy', 'account', ...(kind === 'council.risk-request' ? ['leadProposal', 'leadProposalHash'] : [])], `${kind} request`);
  if (object.schemaVersion !== PERPS_SCHEMA_VERSION || object.kind !== kind || object.role !== role) throw new TypeError(`${kind} identity invalid`);
  stringValue(object.requestId, `${kind}.requestId`);
  stringValue(object.runId, `${kind}.runId`);
  const snapshot = validateCanonicalSnapshotBundle(object.snapshot);
  const evidence = validateSnapshotEvidence(object.snapshotEvidence);
  if (stableStringify(evidence) !== stableStringify(snapshotEvidence(snapshot))) throw new TypeError(`${kind} snapshot evidence mismatch`);
  if (object.policy !== null) validatePolicy(object.policy as PolicyState);
  if (object.account !== null) validateAccount(object.account as AccountState);
  if (kind === 'council.risk-request') {
    if (object.leadProposal !== null) validateProposalBinding(snapshot, object.leadProposal as TradeProposal, object.policy as PolicyState | null, object.account as AccountState | null);
    const expected = hashTradeProposal(object.leadProposal as TradeProposal | null);
    if (object.leadProposalHash !== expected) throw new TypeError('risk lead proposal hash mismatch');
  }
  return object;
}

export function createRiskReview(input: { reviewId: string; requestId: string; runId: string; status: RiskReview['status']; critical: boolean; reasons: readonly string[]; policyVersion: string | null; snapshotHash: string; leadProposalHash: string | null }): RiskReview {
  const status = enumValue(input.status, ['PASS', 'BLOCK', 'NO_DATA'] as const, 'risk review status');
  if (typeof input.critical !== 'boolean') throw new TypeError('risk review critical must be boolean');
  if (input.critical && status === 'PASS') throw new TypeError('critical risk review cannot pass');
  return freezeDeep({
    schemaVersion: PERPS_SCHEMA_VERSION,
    kind: 'risk-review',
    reviewId: stringValue(input.reviewId, 'reviewId'),
    requestId: stringValue(input.requestId, 'requestId'),
    runId: stringValue(input.runId, 'runId'),
    status,
    critical: input.critical,
    veto: status !== 'PASS',
    reasons: input.reasons.map((reason, index) => stringValue(reason, `risk reasons[${index}]`)),
    reviewer: 'independent-risk-reviewer',
    policyVersion: input.policyVersion === null ? null : stringValue(input.policyVersion, 'policyVersion'),
    snapshotHash: hashValue(input.snapshotHash, 'snapshotHash'),
    leadProposalHash: input.leadProposalHash === null ? null : hashValue(input.leadProposalHash, 'leadProposalHash'),
    authority: 'veto-only',
  });
}

export function validateRiskReview(value: unknown, expectedPolicy?: PolicyState | null): RiskReview | RiskReviewFailure {
  const object = record(value, 'risk review');
  if (object.kind === 'risk-review-failure') {
    exactKeys(object, ['schemaVersion', 'kind', 'code', 'authority'], 'risk review failure');
    if (object.schemaVersion !== PERPS_SCHEMA_VERSION || object.authority !== 'veto-only') throw new TypeError('invalid risk review failure');
    enumValue(object.code, ['TRANSPORT_FAILURE', 'INVALID_REVIEW', 'NO_DATA'] as const, 'risk review failure code');
    return object as unknown as RiskReviewFailure;
  }
  exactKeys(object, ['schemaVersion', 'kind', 'reviewId', 'requestId', 'runId', 'status', 'critical', 'veto', 'reasons', 'reviewer', 'policyVersion', 'snapshotHash', 'leadProposalHash', 'authority'], 'risk review');
  if (object.schemaVersion !== PERPS_SCHEMA_VERSION || object.kind !== 'risk-review' || object.reviewer !== 'independent-risk-reviewer' || object.authority !== 'veto-only') throw new TypeError('invalid risk review');
  stringValue(object.reviewId, 'risk review reviewId');
  stringValue(object.requestId, 'risk review requestId');
  stringValue(object.runId, 'risk review runId');
  enumValue(object.status, ['PASS', 'BLOCK', 'NO_DATA'] as const, 'risk review status');
  if (!Array.isArray(object.reasons)) throw new TypeError('risk review reasons must be an array');
  for (const [index, reason] of object.reasons.entries()) stringValue(reason, `risk reasons[${index}]`);
  if (object.policyVersion !== null) stringValue(object.policyVersion, 'risk review policyVersion');
  if (expectedPolicy !== undefined && object.policyVersion !== (expectedPolicy === null ? null : expectedPolicy.policyVersion)) throw new TypeError('risk review policy binding mismatch');
  if (typeof object.critical !== 'boolean' || typeof object.veto !== 'boolean' || object.veto !== (object.status !== 'PASS' || object.critical) || (object.critical && object.status === 'PASS')) throw new TypeError('invalid risk review veto');
  hashValue(object.snapshotHash, 'risk review snapshotHash');
  if (object.leadProposalHash !== null) hashValue(object.leadProposalHash, 'risk review leadProposalHash');
  return object as unknown as RiskReview;
}

function failureReview(code: RiskReviewFailure['code']): RiskReviewFailure {
  return { schemaVersion: PERPS_SCHEMA_VERSION, kind: 'risk-review-failure', code, authority: 'veto-only' };
}

export interface SnapshotEvidenceReference {
  snapshotHash: string;
  bytes: string;
  rawManifestSha256: string;
  normalizedProjectionSha256: string;
  sourceDecisionsSha256: string;
  selectedEvidenceSha256: string;
  capturedAt: string;
  marketNativeIds: Record<PerpsVenue, string>;
}

function snapshotEvidence(snapshot: CanonicalSnapshotBundle): SnapshotEvidenceReference {
  return {
    snapshotHash: snapshot.hash,
    bytes: snapshot.bytes,
    rawManifestSha256: snapshot.envelope.rawManifestSha256,
    normalizedProjectionSha256: snapshot.envelope.normalizedProjectionSha256,
    sourceDecisionsSha256: sourceDecisionsSha256(snapshot),
    selectedEvidenceSha256: selectedEvidenceSha256(snapshot),
    capturedAt: snapshot.envelope.capturedAt,
    marketNativeIds: {
      phoenix: snapshot.registries.phoenix.nativeMarketId,
      hyperliquid: snapshot.registries.hyperliquid.nativeMarketId,
    },
  };
}

export interface CouncilAdviceRequest {
  schemaVersion: typeof PERPS_SCHEMA_VERSION;
  kind: 'council.advice';
  requestId: string;
  runId: string;
  snapshot: CanonicalSnapshotBundle;
  policy: PolicyState | null;
  account: AccountState | null;
}

type CouncilLeadAuditStatus = 'CALLED' | 'NOT_CALLED' | 'INVALID';
type CouncilLeadAuditOutcome = 'PROPOSED' | 'NO_DATA' | 'FAILED';

interface CouncilLeadAuditInput {
  status: CouncilLeadAuditStatus;
  outcome: CouncilLeadAuditOutcome;
}

export interface CouncilAuditRecord {
  schemaVersion: typeof PERPS_SCHEMA_VERSION;
  kind: 'council.audit';
  requestId: string;
  runId: string;
  snapshotEvidence: SnapshotEvidenceReference | null;
  policy: PolicyState | null;
  account: AccountState | null;
  lead: {
    role: 'lead-specialist';
    requestId: string;
    runId: string;
    status: CouncilLeadAuditStatus;
    outcome: CouncilLeadAuditOutcome;
    proposal: TradeProposal | null;
    proposalHash: string | null;
    snapshotHash: string | null;
  };
  risk: {
    role: 'independent-risk-reviewer';
    requestId: string;
    runId: string;
    status: 'PASS' | 'BLOCK' | 'NO_DATA' | 'NOT_CALLED' | 'INVALID';
    reviewId: string | null;
    critical: boolean | null;
    veto: boolean | null;
    reasons: readonly string[];
    policyVersion: string | null;
    leadProposalHash: string | null;
    snapshotHash: string | null;
  };
}
function createCouncilAudit(snapshot: CanonicalSnapshotBundle, requestId: string, runId: string, policy: PolicyState | null, account: AccountState | null, proposal: TradeProposal | null, review: RiskReview | RiskReviewFailure | null, leadInput?: CouncilLeadAuditInput): CouncilAuditRecord {
  const normalizedPolicy = policy === null ? null : validatePolicy(policy);
  const normalizedAccount = account === null ? null : validateAccount(account);
  const lead = leadInput ?? { status: proposal === null ? 'NOT_CALLED' as const : 'CALLED' as const, outcome: proposal === null ? 'FAILED' as const : 'PROPOSED' as const };
  const risk = review?.kind === 'risk-review'
    ? { role: 'independent-risk-reviewer' as const, requestId, runId, status: review.status, reviewId: review.reviewId, critical: review.critical, veto: review.veto, reasons: review.reasons, policyVersion: review.policyVersion, leadProposalHash: review.leadProposalHash, snapshotHash: review.snapshotHash }
    : { role: 'independent-risk-reviewer' as const, requestId, runId, status: review?.kind === 'risk-review-failure' ? 'INVALID' as const : 'NOT_CALLED' as const, reviewId: null, critical: null, veto: null, reasons: [], policyVersion: null, leadProposalHash: null, snapshotHash: null };
  return freezeDeep({ schemaVersion: PERPS_SCHEMA_VERSION, kind: 'council.audit' as const, requestId, runId, snapshotEvidence: snapshotEvidence(snapshot), policy: normalizedPolicy, account: normalizedAccount, lead: { role: 'lead-specialist' as const, requestId, runId, status: lead.status, outcome: lead.outcome, proposal, proposalHash: hashTradeProposal(proposal), snapshotHash: snapshot.hash }, risk });
}
function validateCouncilAudit(value: unknown): CouncilAuditRecord {
  const object = record(value, 'council audit');
  exactKeys(object, ['schemaVersion', 'kind', 'requestId', 'runId', 'snapshotEvidence', 'policy', 'account', 'lead', 'risk'], 'council audit');
  if (object.schemaVersion !== PERPS_SCHEMA_VERSION || object.kind !== 'council.audit') throw new TypeError('invalid council audit');
  const requestId = stringValue(object.requestId, 'audit requestId');
  const runId = stringValue(object.runId, 'audit runId');
  const evidence = object.snapshotEvidence === null ? null : validateBoundSnapshotEvidence(object.snapshotEvidence).evidence;
  if (object.policy !== null) validatePolicy(object.policy as PolicyState);
  if (object.account !== null) validateAccount(object.account as AccountState);
  const lead = record(object.lead, 'audit lead');
  exactKeys(lead, ['role', 'requestId', 'runId', 'status', 'outcome', 'proposal', 'proposalHash', 'snapshotHash'], 'audit lead');
  if (lead.role !== 'lead-specialist' || lead.requestId !== requestId || lead.runId !== runId) throw new TypeError('audit lead identity mismatch');
  if (evidence === null) {
    if (lead.snapshotHash !== null || lead.proposal !== null) throw new TypeError('audit lead cannot bind absent snapshot evidence');
  } else if (hashValue(lead.snapshotHash, 'audit lead snapshotHash') !== evidence.snapshotHash) throw new TypeError('audit lead snapshot binding mismatch');
  enumValue(lead.status, ['CALLED', 'NOT_CALLED', 'INVALID'] as const, 'audit lead status');
  enumValue(lead.outcome, ['PROPOSED', 'NO_DATA', 'FAILED'] as const, 'audit lead outcome');
  if (lead.proposal !== null) validateTradeProposal(lead.proposal);
  if (lead.status === 'CALLED' && lead.outcome === 'PROPOSED' && lead.proposal === null) throw new TypeError('proposed audit lead requires proposal');
  if (lead.status === 'CALLED' && lead.outcome !== 'PROPOSED' && lead.proposal !== null) throw new TypeError('non-proposed audit lead cannot carry proposal');
  if (lead.status !== 'CALLED' && (lead.outcome !== 'FAILED' || lead.proposal !== null)) throw new TypeError('uncalled audit lead must be failed and empty');
  if (lead.proposal !== null && (stableStringify((lead.proposal as TradeProposal).policyBinding) !== stableStringify(object.policy) || stableStringify((lead.proposal as TradeProposal).accountBinding) !== stableStringify(object.account))) throw new TypeError('audit proposal state mismatch');
  const expectedProposalHash = hashTradeProposal(lead.proposal as TradeProposal | null);
  if (lead.proposalHash !== expectedProposalHash) throw new TypeError('audit lead proposal hash mismatch');
  const risk = record(object.risk, 'audit risk');
  exactKeys(risk, ['role', 'requestId', 'runId', 'status', 'reviewId', 'critical', 'veto', 'reasons', 'policyVersion', 'leadProposalHash', 'snapshotHash'], 'audit risk');
  if (risk.role !== 'independent-risk-reviewer' || risk.requestId !== requestId || risk.runId !== runId) throw new TypeError('audit risk identity mismatch');
  const riskStatus = enumValue(risk.status, ['PASS', 'BLOCK', 'NO_DATA', 'NOT_CALLED', 'INVALID'] as const, 'audit risk status');
  if (!Array.isArray(risk.reasons)) throw new TypeError('audit reasons must be array');
  for (const [index, reason] of risk.reasons.entries()) stringValue(reason, `audit reasons[${index}]`);
  if (riskStatus === 'PASS' || riskStatus === 'BLOCK' || riskStatus === 'NO_DATA') {
    if (risk.reviewId === null) throw new TypeError('called audit risk requires reviewId');
    stringValue(risk.reviewId, 'audit reviewId');
    if (typeof risk.critical !== 'boolean' || typeof risk.veto !== 'boolean' || risk.veto !== (riskStatus !== 'PASS')) throw new TypeError('audit risk status/veto mismatch');
    if (risk.policyVersion !== (object.policy === null ? null : (object.policy as RecordValue).policyVersion)) throw new TypeError('audit risk policy mismatch');
    if (risk.leadProposalHash !== expectedProposalHash) throw new TypeError('audit risk proposal hash mismatch');
    if (evidence === null) throw new TypeError('called audit risk requires snapshot evidence');
    if (risk.snapshotHash !== evidence.snapshotHash) throw new TypeError('audit risk snapshot mismatch');
    hashValue(risk.snapshotHash, 'audit snapshotHash');
    if (risk.leadProposalHash !== null) hashValue(risk.leadProposalHash, 'audit leadProposalHash');
  } else {
    if (risk.reviewId !== null || risk.critical !== null || risk.veto !== null || risk.reasons.length !== 0 || risk.policyVersion !== null || risk.leadProposalHash !== null || risk.snapshotHash !== null) throw new TypeError('uncalled audit risk must use null failure fields');
  }
  return object as unknown as CouncilAuditRecord;
}

export interface CouncilAdviceResponse {
  schemaVersion: typeof PERPS_SCHEMA_VERSION;
  kind: 'council.advice';
  requestId: string;
  runId: string;
  status: 'PUBLISHED' | 'BLOCKED' | 'NO_DATA';
  proposal: TradeProposal | null;
  riskReview: RiskReview | RiskReviewFailure;
  snapshotEvidence: SnapshotEvidenceReference | null;
  audit: CouncilAuditRecord;
  authority: 'advisory-only';
  executionReady: false;
}

export function validateCouncilAdviceRequest(value: unknown): CouncilAdviceRequest {
  const object = record(value, 'council.advice request');
  exactKeys(object, ['schemaVersion', 'kind', 'requestId', 'runId', 'snapshot', 'policy', 'account'], 'council.advice request');
  if (object.schemaVersion !== PERPS_SCHEMA_VERSION || object.kind !== 'council.advice') throw new TypeError('invalid council.advice request');
  stringValue(object.requestId, 'requestId');
  stringValue(object.runId, 'runId');
  validateCanonicalSnapshotBundle(object.snapshot);
  if (object.policy !== null) validatePolicy(object.policy as PolicyState);
  if (object.account !== null) validateAccount(object.account as AccountState);
  return object as unknown as CouncilAdviceRequest;
}

export function validateCouncilAdviceResponse(value: unknown): CouncilAdviceResponse {
  const object = record(value, 'council.advice response');
  if (!isDeepFrozen(value)) throw new TypeError('council advice response must be deeply frozen');
  exactKeys(object, ['schemaVersion', 'kind', 'requestId', 'runId', 'status', 'proposal', 'riskReview', 'snapshotEvidence', 'audit', 'authority', 'executionReady'], 'council.advice response');
  if (object.schemaVersion !== PERPS_SCHEMA_VERSION || object.kind !== 'council.advice' || object.authority !== 'advisory-only' || object.executionReady !== false) throw new TypeError('invalid council.advice response');
  stringValue(object.requestId, 'response requestId');
  stringValue(object.runId, 'response runId');
  const status = enumValue(object.status, ['PUBLISHED', 'BLOCKED', 'NO_DATA'] as const, 'council.advice status');
  const review = validateRiskReview(object.riskReview);
  if (review.kind === 'risk-review' && (review.requestId !== object.requestId || review.runId !== object.runId)) throw new TypeError('advice risk review identity mismatch');
  const boundEvidence = object.snapshotEvidence === null ? null : validateBoundSnapshotEvidence(object.snapshotEvidence);
  const audit = validateCouncilAudit(object.audit);
  if (audit.requestId !== object.requestId || audit.runId !== object.runId) throw new TypeError('advice audit identity mismatch');
  const leadAudit = audit.lead as RecordValue;
  if (leadAudit.proposal !== null) {
    if (boundEvidence === null) throw new TypeError('advice proposal requires snapshot evidence');
    validateProposalBinding(boundEvidence.bundle, leadAudit.proposal as TradeProposal, audit.policy as PolicyState | null, audit.account as AccountState | null);
  }
  const auditedRisk = audit.risk as RecordValue;
  if (stableStringify(boundEvidence?.evidence ?? null) !== stableStringify(audit.snapshotEvidence)) throw new TypeError('advice snapshot/audit evidence mismatch');
  if (review.kind === 'risk-review') {
    if (boundEvidence === null) throw new TypeError('advice risk review requires snapshot evidence');
    const auditedLead = audit.lead as RecordValue;
    const expectedLeadHash = hashTradeProposal(auditedLead.proposal as TradeProposal | null);
    if (auditedRisk.status !== review.status || auditedRisk.reviewId !== review.reviewId || auditedRisk.critical !== review.critical || auditedRisk.policyVersion !== review.policyVersion || auditedRisk.leadProposalHash !== review.leadProposalHash || review.leadProposalHash !== expectedLeadHash || auditedRisk.snapshotHash !== review.snapshotHash || review.snapshotHash !== boundEvidence.bundle.hash || stableStringify(auditedRisk.reasons) !== stableStringify(review.reasons)) throw new TypeError('advice risk audit mismatch');
  } else if (auditedRisk.status !== 'INVALID') throw new TypeError('advice risk failure audit mismatch');
  if (review.kind === 'risk-review' && review.status === 'BLOCK' && status !== 'BLOCKED') throw new TypeError('blocking risk review requires BLOCKED advice');
  if (object.proposal !== null) {
    if (boundEvidence === null) throw new TypeError('advice proposal requires snapshot evidence');
    const responseProposal = object.proposal as TradeProposal;
    validateTradeProposal(responseProposal);
    validateProposalBinding(boundEvidence.bundle, responseProposal, audit.policy as PolicyState | null, audit.account as AccountState | null);
    if (stableStringify(responseProposal) !== stableStringify((audit.lead as RecordValue).proposal)) throw new TypeError('advice proposal audit mismatch');
    const proposalEvidence = responseProposal.snapshotEvidence;
    const auditEvidence = audit.snapshotEvidence;
    if (proposalEvidence.snapshotHash !== auditEvidence?.snapshotHash || proposalEvidence.rawManifestSha256 !== auditEvidence?.rawManifestSha256 || proposalEvidence.normalizedProjectionSha256 !== auditEvidence?.normalizedProjectionSha256 || proposalEvidence.sourceDecisionsSha256 !== auditEvidence?.sourceDecisionsSha256 || proposalEvidence.selectedEvidenceSha256 !== auditEvidence?.selectedEvidenceSha256 || proposalEvidence.capturedAt !== auditEvidence?.capturedAt) throw new TypeError('advice proposal evidence mismatch');
  }
  if (status === 'PUBLISHED') {
    if (object.proposal === null || review.kind !== 'risk-review' || review.status !== 'PASS' || boundEvidence === null || boundEvidence.bundle.envelope.status !== 'READY') throw new TypeError('published advice requires ready pass bundle');
    const publishedProposal = object.proposal as TradeProposal;
    if (publishedProposal.status !== 'PROPOSED' || boundEvidence.bundle.markets[publishedProposal.venue].envelope.status !== 'READY') throw new TypeError('published advice requires proposed ready market');
  } else if (object.proposal !== null) {
    throw new TypeError('blocked or no-data advice cannot publish proposal');
  }
  if (status === 'BLOCKED') {
    if (review.kind !== 'risk-review' || review.status !== 'BLOCK' || !['CALLED', 'INVALID', 'NOT_CALLED'].includes(leadAudit.status as string)) throw new TypeError('blocked advice requires block review and valid lead audit');
  }
  if (status === 'NO_DATA' && review.kind === 'risk-review' && review.status === 'PASS') {
    const directNoLead = leadAudit.status === 'NOT_CALLED' && leadAudit.outcome === 'FAILED' && leadAudit.proposal === null;
    const leadNoData = leadAudit.status === 'CALLED' && leadAudit.outcome === 'NO_DATA' && leadAudit.proposal === null;
    if (!directNoLead && !leadNoData) throw new TypeError('no-data pass requires direct empty or lead no-data audit');
  }
  return object as unknown as CouncilAdviceResponse;
}

export function createCouncilAdviceRequest(input: { requestId: string; runId: string; snapshot: CanonicalSnapshotBundle; policy: PolicyState | null; account: AccountState | null }): CouncilAdviceRequest {
  validateCanonicalSnapshotBundle(input.snapshot);
  return freezeDeep({ schemaVersion: PERPS_SCHEMA_VERSION, kind: 'council.advice', requestId: stringValue(input.requestId, 'requestId'), runId: stringValue(input.runId, 'runId'), snapshot: input.snapshot, policy: input.policy === null ? null : validatePolicy(input.policy), account: input.account === null ? null : validateAccount(input.account) });
}

export function publishCouncilAdvice(input: { requestId: string; runId: string; snapshot: CanonicalSnapshotBundle; policy: PolicyState | null; account: AccountState | null; proposal: TradeProposal | null; riskReview: RiskReview | RiskReviewFailure | null; leadAudit?: CouncilLeadAuditInput }): CouncilAdviceResponse {
  const snapshot = validateCanonicalSnapshotBundle(input.snapshot);
  const requestId = stringValue(input.requestId, 'requestId');
  const runId = stringValue(input.runId, 'runId');
  if (input.policy !== null) validatePolicy(input.policy);
  if (input.account !== null) validateAccount(input.account);
  let review = input.riskReview;
  let leadProposal: TradeProposal | null = null;
  let proposal: TradeProposal | null = null;
  if (input.proposal !== null) {
    try {
      validateProposalBinding(snapshot, input.proposal, input.policy, input.account);
      leadProposal = input.proposal;
      proposal = input.proposal;
    } catch {
      const normalizedReview = failureReview('INVALID_REVIEW');
      const audit = createCouncilAudit(snapshot, requestId, runId, input.policy, input.account, null, normalizedReview, { status: 'INVALID', outcome: 'FAILED' });
      const response = freezeDeep({ schemaVersion: PERPS_SCHEMA_VERSION, kind: 'council.advice' as const, requestId, runId, status: 'NO_DATA' as const, proposal: null, riskReview: normalizedReview, snapshotEvidence: snapshotEvidence(snapshot), audit, authority: 'advisory-only' as const, executionReady: false as const });
      validateCouncilAdviceResponse(response);
      return response;
    }
  }
  if (review !== null) {
    try {
      review = validateRiskReview(review, input.policy);
    } catch {
      const normalizedReview = failureReview('INVALID_REVIEW');
      const audit = createCouncilAudit(snapshot, requestId, runId, input.policy, input.account, leadProposal, normalizedReview, input.leadAudit);
      const response = freezeDeep({ schemaVersion: PERPS_SCHEMA_VERSION, kind: 'council.advice' as const, requestId, runId, status: 'NO_DATA' as const, proposal: null, riskReview: normalizedReview, snapshotEvidence: snapshotEvidence(snapshot), audit, authority: 'advisory-only' as const, executionReady: false as const });
      validateCouncilAdviceResponse(response);
      return response;
    }
  }
  let status: CouncilAdviceResponse['status'] = 'PUBLISHED';
  let normalizedReview: RiskReview | RiskReviewFailure;
  if (review === null) {
    normalizedReview = failureReview('NO_DATA');
    status = 'NO_DATA';
    proposal = null;
  } else if (review.kind === 'risk-review-failure') {
    normalizedReview = review;
    status = 'NO_DATA';
    proposal = null;
  } else {
    normalizedReview = review;
    try {
      validateRiskReview(review, input.policy);
      const expectedProposalHash = hashTradeProposal(proposal);
      if (review.requestId !== requestId || review.runId !== runId || review.snapshotHash !== snapshot.hash || review.leadProposalHash !== expectedProposalHash) throw new TypeError('risk review binding mismatch');
    } catch {
      normalizedReview = failureReview('INVALID_REVIEW');
      status = 'NO_DATA';
      proposal = null;
    }
    if (status === 'PUBLISHED' && review.status === 'NO_DATA') {
      status = 'NO_DATA';
      proposal = null;
    } else if (status === 'PUBLISHED' && (review.status === 'BLOCK' || review.veto)) {
      status = 'BLOCKED';
      proposal = null;
    } else if (status === 'PUBLISHED' && (snapshot.envelope.status === 'NO_DATA' || proposal === null)) {
      status = 'NO_DATA';
      proposal = null;
    }
  }
  const audit = createCouncilAudit(snapshot, requestId, runId, input.policy, input.account, leadProposal, normalizedReview, input.leadAudit);
  const response = freezeDeep({ schemaVersion: PERPS_SCHEMA_VERSION, kind: 'council.advice' as const, requestId, runId, status, proposal, riskReview: normalizedReview, snapshotEvidence: snapshotEvidence(snapshot), audit, authority: 'advisory-only' as const, executionReady: false as const });
  validateCouncilAdviceResponse(response);
  return response;
}

export type CopilotSubjectKind = 'proposal' | 'snapshot' | 'result';

export interface CouncilCopilotRequest {
  schemaVersion: typeof PERPS_SCHEMA_VERSION;
  kind: 'council.copilot';
  requestId: string;
  runId: string;
  snapshot: CanonicalSnapshotBundle;
  snapshotEvidence: SnapshotEvidenceReference;
  subjectKind: CopilotSubjectKind;
  subject: TradeProposal | CanonicalSnapshotBundle | CouncilAdviceResponse;
  question: string;
}

export interface CouncilCopilotResponse {
  schemaVersion: typeof PERPS_SCHEMA_VERSION;
  kind: 'council.copilot';
  requestId: string;
  runId: string;
  status: 'EXPLAINED' | 'NO_DATA';
  explanation: string | null;
  snapshotEvidence: SnapshotEvidenceReference | null;
  authority: 'explanation-only';
  canCreateTradeProposal: false;
  executionReady: false;
}

function validateCopilotSubject(request: CouncilCopilotRequest): void {
  const evidence = validateSnapshotEvidence(request.snapshotEvidence);
  const boundSnapshot = validateCanonicalSnapshotBundle(request.snapshot);
  if (stableStringify(evidence) !== stableStringify(snapshotEvidence(boundSnapshot))) throw new TypeError('copilot request snapshot evidence mismatch');
  if (request.subjectKind === 'proposal') {
    const proposal = validateTradeProposal(request.subject);
    validateProposalBinding(boundSnapshot, proposal, proposal.policyBinding, proposal.accountBinding);
    const market = boundSnapshot.markets[proposal.venue];
    if (proposal.nativeMarketId !== market.registry.nativeMarketId || proposal.provenance !== boundSnapshot.envelope.provenance) throw new TypeError('copilot proposal identity mismatch');
    if (proposal.snapshotEvidence.snapshotHash !== evidence.snapshotHash || proposal.snapshotEvidence.rawManifestSha256 !== evidence.rawManifestSha256 || proposal.snapshotEvidence.normalizedProjectionSha256 !== evidence.normalizedProjectionSha256 || proposal.snapshotEvidence.sourceDecisionsSha256 !== evidence.sourceDecisionsSha256 || proposal.snapshotEvidence.selectedEvidenceSha256 !== evidence.selectedEvidenceSha256 || proposal.snapshotEvidence.capturedAt !== evidence.capturedAt) throw new TypeError('copilot proposal evidence mismatch');
  } else if (request.subjectKind === 'snapshot') {
    const subject = validateCanonicalSnapshotBundle(request.subject);
    if (stableStringify(subject) !== stableStringify(boundSnapshot)) throw new TypeError('copilot snapshot identity mismatch');
  } else {
    const result = validateCouncilAdviceResponse(request.subject);
    if (stableStringify(result.snapshotEvidence) !== stableStringify(evidence)) throw new TypeError('copilot result evidence mismatch');
  }
}

export function validateCouncilCopilotRequest(value: unknown): CouncilCopilotRequest {
  const object = record(value, 'council.copilot request');
  exactKeys(object, ['schemaVersion', 'kind', 'requestId', 'runId', 'snapshot', 'snapshotEvidence', 'subjectKind', 'subject', 'question'], 'council.copilot request');
  if (object.schemaVersion !== PERPS_SCHEMA_VERSION || object.kind !== 'council.copilot') throw new TypeError('invalid council.copilot request');
  const request = object as unknown as CouncilCopilotRequest;
  stringValue(request.requestId, 'copilot requestId');
  stringValue(request.runId, 'copilot runId');
  validateSnapshotEvidence(request.snapshotEvidence);
  enumValue(request.subjectKind, ['proposal', 'snapshot', 'result'] as const, 'copilot subjectKind');
  if (typeof request.question !== 'string' || !NON_EMPTY.test(request.question)) throw new TypeError('copilot question must be non-empty');
  validateCopilotSubject(request);
  return request;
}

export function validateCouncilCopilotResponse(value: unknown): CouncilCopilotResponse {
  const object = record(value, 'council.copilot response');
  exactKeys(object, ['schemaVersion', 'kind', 'requestId', 'runId', 'status', 'explanation', 'snapshotEvidence', 'authority', 'canCreateTradeProposal', 'executionReady'], 'council.copilot response');
  if (object.schemaVersion !== PERPS_SCHEMA_VERSION || object.kind !== 'council.copilot' || object.authority !== 'explanation-only' || object.canCreateTradeProposal !== false || object.executionReady !== false) throw new TypeError('invalid council.copilot response');
  stringValue(object.requestId, 'copilot response requestId');
  stringValue(object.runId, 'copilot response runId');
  enumValue(object.status, ['EXPLAINED', 'NO_DATA'] as const, 'copilot status');
  if (object.explanation !== null) stringValue(object.explanation, 'copilot explanation');
  if (object.snapshotEvidence === null) {
    if (object.status !== 'NO_DATA') throw new TypeError('Copilot response without snapshot evidence must be NO_DATA');
  } else {
    validateSnapshotEvidence(object.snapshotEvidence);
  }
  return object as unknown as CouncilCopilotResponse;
}

export function createCouncilCopilotRequest(input: { requestId: string; runId: string; snapshot: CanonicalSnapshotBundle; subjectKind: CopilotSubjectKind; subject: TradeProposal | CanonicalSnapshotBundle | CouncilAdviceResponse; question: string }): CouncilCopilotRequest {
  const request = freezeDeep({ schemaVersion: PERPS_SCHEMA_VERSION, kind: 'council.copilot' as const, requestId: stringValue(input.requestId, 'requestId'), runId: stringValue(input.runId, 'runId'), snapshot: input.snapshot, snapshotEvidence: snapshotEvidence(input.snapshot), subjectKind: input.subjectKind, subject: input.subject, question: stringValue(input.question, 'question') });
  validateCouncilCopilotRequest(request);
  return request;
}

export interface CouncilHostTransport {
  lead(request: LeadSpecialistRequest): Promise<LeadSpecialistResponse>;
  riskReview(request: RiskReviewRequest): Promise<RiskReviewResponse>;
  copilot(request: CouncilCopilotRequest): Promise<CouncilCopilotResponse>;
}

export interface HostTransportBoundary {
  readonly kind: 'host-controlled';
  readonly transport: CouncilHostTransport;
}

export function createHostTransportBoundary(transport: CouncilHostTransport): HostTransportBoundary {
  if (typeof transport.lead !== 'function' || typeof transport.riskReview !== 'function' || typeof transport.copilot !== 'function') throw new TypeError('host transport must provide lead, riskReview, and copilot');
  return Object.freeze({ kind: 'host-controlled' as const, transport });
}
export async function invokeCouncilAdvice(boundary: HostTransportBoundary, request: CouncilAdviceRequest): Promise<CouncilAdviceResponse> {
  let leadAudit: CouncilLeadAuditInput = { status: 'NOT_CALLED', outcome: 'FAILED' };
  let leadProposalForFallback: TradeProposal | null = null;
  try {
    validateCouncilAdviceRequest(request);
    leadAudit = { status: 'CALLED', outcome: 'FAILED' };
    const base = { schemaVersion: PERPS_SCHEMA_VERSION, snapshot: request.snapshot, snapshotEvidence: snapshotEvidence(request.snapshot), requestId: request.requestId, runId: request.runId, policy: request.policy, account: request.account };
    const leadRequest = freezeDeep({ ...base, kind: 'council.lead-request' as const, role: 'lead-specialist' as const });
    validateCallEnvelope(leadRequest, 'council.lead-request', 'lead-specialist');
    const lead = await boundary.transport.lead(leadRequest as LeadSpecialistRequest);
    leadAudit = { status: 'INVALID', outcome: 'FAILED' };
    const leadObject = record(lead, 'lead response');
    exactKeys(leadObject, ['schemaVersion', 'kind', 'role', 'requestId', 'runId', 'snapshotHash', 'proposal', 'status'], 'lead response');
    if (leadObject.schemaVersion !== PERPS_SCHEMA_VERSION || leadObject.kind !== 'council.lead-response' || leadObject.role !== 'lead-specialist' || leadObject.requestId !== request.requestId || leadObject.runId !== request.runId || leadObject.snapshotHash !== request.snapshot.hash) throw new TypeError('lead response binding mismatch');
    const leadProposal = leadObject.proposal as TradeProposal | null;
    if (leadProposal !== null) validateProposalBinding(request.snapshot, leadProposal, request.policy, request.account);
    const leadStatus = enumValue(leadObject.status, ['PROPOSED', 'NO_DATA'] as const, 'lead status');
    if ((leadStatus === 'PROPOSED') !== (leadProposal !== null)) throw new TypeError('lead status/proposal mismatch');
    leadProposalForFallback = leadProposal;
    leadAudit = { status: 'CALLED', outcome: leadStatus === 'PROPOSED' ? 'PROPOSED' : 'NO_DATA' };
    const leadProposalDigest = hashTradeProposal(leadProposal);
    const riskRequest = freezeDeep({ ...base, kind: 'council.risk-request' as const, role: 'independent-risk-reviewer' as const, leadProposal, leadProposalHash: leadProposalDigest });
    validateCallEnvelope(riskRequest, 'council.risk-request', 'independent-risk-reviewer');
    const risk = await boundary.transport.riskReview(riskRequest as RiskReviewRequest);
    const riskObject = record(risk, 'risk response');
    exactKeys(riskObject, ['schemaVersion', 'kind', 'role', 'requestId', 'runId', 'reviewId', 'status', 'critical', 'reasons', 'policyVersion', 'snapshotHash', 'leadProposalHash'], 'risk response');
    const riskReview = createRiskReview({ reviewId: stringValue(riskObject.reviewId, 'reviewId'), requestId: request.requestId, runId: request.runId, status: enumValue(riskObject.status, ['PASS', 'BLOCK', 'NO_DATA'] as const, 'risk status'), critical: riskObject.critical as boolean, reasons: riskObject.reasons as readonly string[], policyVersion: riskObject.policyVersion as string | null, snapshotHash: request.snapshot.hash, leadProposalHash: leadProposalDigest });
    if (riskObject.schemaVersion !== PERPS_SCHEMA_VERSION || riskObject.kind !== 'council.risk-response' || riskObject.role !== 'independent-risk-reviewer' || riskObject.requestId !== request.requestId || riskObject.runId !== request.runId || riskObject.snapshotHash !== request.snapshot.hash || riskObject.leadProposalHash !== leadProposalDigest) throw new TypeError('risk response binding mismatch');
    return publishCouncilAdvice({ requestId: request.requestId, runId: request.runId, snapshot: request.snapshot, policy: request.policy, account: request.account, proposal: leadProposal, riskReview, leadAudit });
  } catch {
    return safeAdviceFailure(request, leadAudit, leadProposalForFallback);
  }
}

export async function invokeCouncilCopilot(boundary: HostTransportBoundary, request: CouncilCopilotRequest): Promise<CouncilCopilotResponse> {
  try {
    validateCouncilCopilotRequest(request);
    const response = validateCouncilCopilotResponse(await boundary.transport.copilot(request));
    if (response.requestId !== request.requestId || response.runId !== request.runId || stableStringify(response.snapshotEvidence) !== stableStringify(request.snapshotEvidence)) throw new Error('copilot binding mismatch');
    return response;
  } catch {
    return safeCopilotFailure(request);
  }
}
