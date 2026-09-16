import { createHash } from 'node:crypto';

export const STOCKS_SCHEMA_VERSION = 1 as const;
export const STOCK_VENUE = 'solana' as const;
export type StockVenue = typeof STOCK_VENUE;
export type DataProvenance = 'live' | 'synthetic' | 'historical';
export type SnapshotStatus = 'READY' | 'NO_DATA';
export type StockField = 'price' | 'liquidity';
export const STOCK_FIELDS = ['price', 'liquidity'] as const;
export type CaptureStatus = 'ok' | 'outage' | 'invalid';
export type SourceRole = 'primary' | 'secondary';
export type Continuity = 'continuous' | 'gap';

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

function integerFinite(value: unknown, name: string): number {
  if (typeof value !== 'number' || !Number.isInteger(value)) throw new TypeError(`${name} must be an integer`);
  return value;
}

function booleanValue(value: unknown, name: string): boolean {
  if (typeof value !== 'boolean') throw new TypeError(`${name} must be boolean`);
  return value;
}

function isoTime(value: unknown, name: string): string {
  const result = stringValue(value, name);
  if (!Number.isFinite(Date.parse(result))) throw new TypeError(`${name} must be an ISO timestamp`);
  return result;
}

function hashValue(value: unknown, name: string): string {
  const result = stringValue(value, name);
  if (!SHA256.test(result)) throw new TypeError(`${name} must be lowercase SHA-256`);
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

export interface StockLimits {
  minLiquidity: string;
  maxWeightBps: number;
}

export interface StockFees {
  takerBps: number;
  makerBps: number;
}

export interface StockCapabilities {
  tradable: boolean;
  redeemable: boolean;
}

export interface StockCorporateAction {
  lastEventId: string | null;
  asOf: string | null;
}

export interface StockRegistryEntry {
  schemaVersion: typeof STOCKS_SCHEMA_VERSION;
  registryVersion: string;
  venue: StockVenue;
  assetId: string;
  underlying: string;
  instrumentType: 'tokenized-equity';
  priceScale: number;
  quantityScale: number;
  limits: StockLimits;
  fees: StockFees;
  capabilities: StockCapabilities;
  corporateAction: StockCorporateAction;
  provenance: DataProvenance;
}

function scale(value: unknown, name: string): number {
  const result = integerFinite(value, name);
  if (result < 0 || result > 18) throw new TypeError(`${name} must be between 0 and 18`);
  return result;
}

function bps(value: unknown, name: string): number {
  const result = integerFinite(value, name);
  if (result < 0 || result > 10000) throw new TypeError(`${name} must be between 0 and 10000 bps`);
  return result;
}

export function validateStockRegistry(value: unknown): StockRegistryEntry {
  const object = record(value, 'stock registry entry');
  exactKeys(object, ['schemaVersion', 'registryVersion', 'venue', 'assetId', 'underlying', 'instrumentType', 'priceScale', 'quantityScale', 'limits', 'fees', 'capabilities', 'corporateAction', 'provenance'], 'stock registry entry');
  if (object.schemaVersion !== STOCKS_SCHEMA_VERSION) throw new TypeError('stock registry schemaVersion must be 1');
  if (object.instrumentType !== 'tokenized-equity') throw new TypeError('stock registry instrumentType must be tokenized-equity');
  const limits = record(object.limits, 'stock registry limits');
  exactKeys(limits, ['minLiquidity', 'maxWeightBps'], 'stock registry limits');
  const fees = record(object.fees, 'stock registry fees');
  exactKeys(fees, ['takerBps', 'makerBps'], 'stock registry fees');
  const capabilities = record(object.capabilities, 'stock registry capabilities');
  exactKeys(capabilities, ['tradable', 'redeemable'], 'stock registry capabilities');
  const corporateAction = record(object.corporateAction, 'stock registry corporateAction');
  exactKeys(corporateAction, ['lastEventId', 'asOf'], 'stock registry corporateAction');
  const maxWeightBps = bps(limits.maxWeightBps, 'stock registry limits.maxWeightBps');
  if (maxWeightBps < 1) throw new TypeError('stock registry limits.maxWeightBps must be at least 1');
  return {
    schemaVersion: STOCKS_SCHEMA_VERSION,
    registryVersion: stringValue(object.registryVersion, 'stock registry registryVersion'),
    venue: enumValue(object.venue, [STOCK_VENUE], 'stock registry venue'),
    assetId: stringValue(object.assetId, 'stock registry assetId'),
    underlying: stringValue(object.underlying, 'stock registry underlying'),
    instrumentType: 'tokenized-equity',
    priceScale: scale(object.priceScale, 'stock registry priceScale'),
    quantityScale: scale(object.quantityScale, 'stock registry quantityScale'),
    limits: { minLiquidity: integerString(limits.minLiquidity, 'stock registry limits.minLiquidity'), maxWeightBps },
    fees: { takerBps: bps(fees.takerBps, 'stock registry fees.takerBps'), makerBps: bps(fees.makerBps, 'stock registry fees.makerBps') },
    capabilities: { tradable: booleanValue(capabilities.tradable, 'stock registry capabilities.tradable'), redeemable: booleanValue(capabilities.redeemable, 'stock registry capabilities.redeemable') },
    corporateAction: { lastEventId: corporateAction.lastEventId === null ? null : stringValue(corporateAction.lastEventId, 'stock registry corporateAction.lastEventId'), asOf: corporateAction.asOf === null ? null : isoTime(corporateAction.asOf, 'stock registry corporateAction.asOf') },
    provenance: provenance(object.provenance),
  };
}

export interface SourceSpec {
  sourceId: string;
  adapterVersion: string;
  semanticVersion: string;
}

export interface FieldSourcePolicy {
  field: StockField;
  primary: SourceSpec;
  secondary: SourceSpec | null;
}

export interface AssetSourcePrecedence {
  schemaVersion: typeof STOCKS_SCHEMA_VERSION;
  policyVersion: string;
  fields: readonly FieldSourcePolicy[];
}

function validateSourceSpec(value: unknown, name: string): SourceSpec {
  const object = record(value, name);
  exactKeys(object, ['sourceId', 'adapterVersion', 'semanticVersion'], name);
  return {
    sourceId: stringValue(object.sourceId, `${name}.sourceId`),
    adapterVersion: stringValue(object.adapterVersion, `${name}.adapterVersion`),
    semanticVersion: stringValue(object.semanticVersion, `${name}.semanticVersion`),
  };
}

export function validateAssetSourcePrecedence(value: unknown): AssetSourcePrecedence {
  const object = record(value, 'asset source precedence');
  exactKeys(object, ['schemaVersion', 'policyVersion', 'fields'], 'asset source precedence');
  if (object.schemaVersion !== STOCKS_SCHEMA_VERSION) throw new TypeError('asset source precedence schemaVersion must be 1');
  if (!Array.isArray(object.fields) || object.fields.length === 0) throw new TypeError('asset source precedence fields must be a non-empty array');
  const seen = new Set<StockField>();
  const fields: FieldSourcePolicy[] = [];
  for (const raw of object.fields) {
    const policy = record(raw, 'field source policy');
    exactKeys(policy, ['field', 'primary', 'secondary'], 'field source policy');
    const field = enumValue(policy.field, STOCK_FIELDS, 'field source policy field');
    if (seen.has(field)) throw new TypeError(`field source policy ${field} duplicated`);
    seen.add(field);
    fields.push({ field, primary: validateSourceSpec(policy.primary, `${field} primary source`), secondary: policy.secondary === null ? null : validateSourceSpec(policy.secondary, `${field} secondary source`) });
  }
  for (const field of STOCK_FIELDS) if (!seen.has(field)) throw new TypeError(`asset source precedence missing policy for ${field}`);
  return { schemaVersion: STOCKS_SCHEMA_VERSION, policyVersion: stringValue(object.policyVersion, 'asset source precedence policyVersion'), fields };
}

export interface CaptureFailure {
  retryable: boolean;
  retryAfterMs: number | null;
  reason: string;
}

export interface FieldCapture {
  field: StockField;
  sourceId: string;
  sourceRole: SourceRole;
  adapterVersion: string;
  semanticVersion: string;
  status: CaptureStatus;
  eventAt: string;
  capturedAt: string;
  sequence: number;
  continuity: Continuity;
  rawBytes: string | Uint8Array;
  normalizedValue: string | null;
  equivalenceValidated: boolean;
  failure: CaptureFailure | null;
}

export interface AssetCaptureInput {
  registry: StockRegistryEntry;
  precedence: AssetSourcePrecedence;
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
  sourceId: string;
  sourceRole: SourceRole;
  status: CaptureStatus;
  eventAt: string;
  capturedAt: string;
  sequence: number;
  continuity: Continuity;
  rawBytesBase64: string;
  rawSha256: string;
  normalizedValue: string | null;
  equivalenceValidated: boolean;
}

export interface SourceDecision {
  assetId: string;
  field: StockField;
  policyVersion: string;
  primarySourceId: string;
  secondarySourceId: string | null;
  selectedSourceId: string | null;
  selectedRole: SourceRole | null;
  selectedCapturedAt: string | null;
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
  sourcePrecedence: Record<string, AssetSourcePrecedence>;
  projections: Record<string, AssetProjection>;
  rawManifest: { schemaVersion: typeof STOCKS_SCHEMA_VERSION; entries: readonly RawManifestEntry[] };
  normalized: { schemaVersion: typeof STOCKS_SCHEMA_VERSION; assets: Record<string, AssetProjection> };
  sourceDecisions: readonly SourceDecision[];
  missing: readonly string[];
  conflicts: readonly string[];
  bytes: string;
  hash: string;
  frozen: true;
}

interface FieldCaptureView {
  capture: FieldCapture;
  eventAtMs: number;
  capturedAtMs: number;
}

function manifestEntry(assetId: string, capture: FieldCapture): RawManifestEntry {
  const bytes = typeof capture.rawBytes === 'string' ? Buffer.from(capture.rawBytes, 'utf8') : new Uint8Array(capture.rawBytes);
  return {
    assetId,
    field: capture.field,
    sourceId: capture.sourceId,
    sourceRole: capture.sourceRole,
    status: capture.status,
    eventAt: capture.eventAt,
    capturedAt: capture.capturedAt,
    sequence: capture.sequence,
    continuity: capture.continuity,
    rawBytesBase64: Buffer.from(bytes).toString('base64'),
    rawSha256: createHash('sha256').update(bytes).digest('hex'),
    normalizedValue: capture.normalizedValue,
    equivalenceValidated: capture.equivalenceValidated,
  };
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
  const sourcePrecedence: Record<string, AssetSourcePrecedence> = {};
  const projections: Record<string, AssetProjection> = {};
  const rawEntries: RawManifestEntry[] = [];
  const sourceDecisions: SourceDecision[] = [];
  const selectedTimes: number[] = [];

  for (const assetId of assetIds) {
    const assetInput = input.assets[assetId];
    if (assetInput === undefined) {
      missing.push(`${assetId}.asset`);
      continue;
    }
    const registry = validateStockRegistry(assetInput.registry);
    if (registry.assetId !== assetId) throw new TypeError(`asset ${assetId} registry assetId mismatch`);
    const precedence = validateAssetSourcePrecedence(assetInput.precedence);
    registries[assetId] = registry;
    sourcePrecedence[assetId] = precedence;
    if (!Array.isArray(assetInput.captures)) throw new TypeError(`asset ${assetId} captures must be an array`);

    const capturesByField = new Map<StockField, FieldCaptureView[]>();
    for (const capture of assetInput.captures) {
      const field = enumValue(capture.field, STOCK_FIELDS, `asset ${assetId} capture.field`);
      enumValue(capture.sourceRole, ['primary', 'secondary'], `asset ${assetId} ${field}.sourceRole`);
      enumValue(capture.status, ['ok', 'outage', 'invalid'], `asset ${assetId} ${field}.status`);
      enumValue(capture.continuity, ['continuous', 'gap'], `asset ${assetId} ${field}.continuity`);
      stringValue(capture.sourceId, `asset ${assetId} ${field}.sourceId`);
      stringValue(capture.adapterVersion, `asset ${assetId} ${field}.adapterVersion`);
      stringValue(capture.semanticVersion, `asset ${assetId} ${field}.semanticVersion`);
      booleanValue(capture.equivalenceValidated, `asset ${assetId} ${field}.equivalenceValidated`);
      const sequence = integerFinite(capture.sequence, `asset ${assetId} ${field}.sequence`);
      if (sequence < 0) throw new TypeError(`asset ${assetId} ${field}.sequence must be non-negative`);
      const eventAtMs = Date.parse(isoTime(capture.eventAt, `asset ${assetId} ${field}.eventAt`));
      const capturedAtCaptureMs = Date.parse(isoTime(capture.capturedAt, `asset ${assetId} ${field}.capturedAt`));
      if (capture.status === 'ok') {
        if (capture.failure !== null) throw new TypeError(`asset ${assetId} ${field} ok capture must not carry a failure`);
        integerString(capture.normalizedValue, `asset ${assetId} ${field}.normalizedValue`);
      } else {
        const failure = record(capture.failure, `asset ${assetId} ${field}.failure`);
        exactKeys(failure, ['retryable', 'retryAfterMs', 'reason'], `asset ${assetId} ${field}.failure`);
        booleanValue(failure.retryable, `asset ${assetId} ${field}.failure.retryable`);
        if (failure.retryAfterMs !== null) integerFinite(failure.retryAfterMs, `asset ${assetId} ${field}.failure.retryAfterMs`);
        stringValue(failure.reason, `asset ${assetId} ${field}.failure.reason`);
        if (capture.normalizedValue !== null) throw new TypeError(`asset ${assetId} ${field} failing capture must not carry a normalized value`);
      }
      rawEntries.push(manifestEntry(assetId, capture));
      if (eventAtMs > capturedAtCaptureMs) conflicts.push(`${assetId}.${field}.event-after-receipt`);
      if (capturedAtCaptureMs > capturedAtMs) conflicts.push(`${assetId}.${field}.future`);
      const views = capturesByField.get(field) ?? [];
      views.push({ capture, eventAtMs, capturedAtMs: capturedAtCaptureMs });
      capturesByField.set(field, views);
    }

    for (const field of STOCK_FIELDS) {
      const policy = precedence.fields.find(entry => entry.field === field);
      if (policy === undefined) {
        missing.push(`${assetId}.${field}.policy`);
        continue;
      }
      const views = capturesByField.get(field) ?? [];
      const primaries = views.filter(view => view.capture.sourceRole === 'primary');
      const secondaries = views.filter(view => view.capture.sourceRole === 'secondary');
      if (primaries.length > 1 || secondaries.length > 1) conflicts.push(`${assetId}.${field}.duplicate-role`);
      const primary = primaries[0];
      const secondary = secondaries[0];
      const decision: SourceDecision = { assetId, field, policyVersion: precedence.policyVersion, primarySourceId: policy.primary.sourceId, secondarySourceId: policy.secondary?.sourceId ?? null, selectedSourceId: null, selectedRole: null, selectedCapturedAt: null };
      if (primary !== undefined && primary.capture.sourceId !== policy.primary.sourceId) conflicts.push(`${assetId}.${field}.primary-identity`);
      if (secondary !== undefined && (policy.secondary === null || secondary.capture.sourceId !== policy.secondary.sourceId)) conflicts.push(`${assetId}.${field}.secondary-identity`);
      let selected: FieldCaptureView | undefined;
      let selectedRole: SourceRole | null = null;
      if (primary === undefined) {
        missing.push(`${assetId}.${field}.primary-missing`);
      } else if (primary.capture.status === 'invalid') {
        conflicts.push(`${assetId}.${field}.primary-invalid`);
      } else if (primary.capture.status === 'ok') {
        if (secondary !== undefined && secondary.capture.status === 'ok' && secondary.capture.normalizedValue !== primary.capture.normalizedValue) {
          conflicts.push(`${assetId}.${field}.source-disagreement`);
        } else {
          selected = primary;
          selectedRole = 'primary';
        }
      } else if (secondary !== undefined && secondary.capture.status === 'ok' && secondary.capture.equivalenceValidated && policy.secondary !== null && secondary.capture.sourceId === policy.secondary.sourceId) {
        selected = secondary;
        selectedRole = 'secondary';
      } else {
        missing.push(`${assetId}.${field}.${primary.capture.status}`);
      }
      const fieldValue = selected?.capture.normalizedValue ?? null;
      if (selected !== undefined) {
        decision.selectedSourceId = selected.capture.sourceId;
        decision.selectedRole = selectedRole;
        decision.selectedCapturedAt = selected.capture.capturedAt;
        selectedTimes.push(selected.capturedAtMs);
      }
      sourceDecisions.push(decision);
      const projection = projections[assetId] ?? { assetId, underlying: registry.underlying, fields: { price: null, liquidity: null } };
      projection.fields[field] = fieldValue;
      projections[assetId] = projection;
    }
  }

  if (selectedTimes.length > 1 && Math.max(...selectedTimes) - Math.min(...selectedTimes) > input.coherenceCapMs) {
    conflicts.push('basket.coherence-cap');
  }

  rawEntries.sort((a, b) => a.assetId.localeCompare(b.assetId) || a.field.localeCompare(b.field) || a.sourceRole.localeCompare(b.sourceRole) || a.sourceId.localeCompare(b.sourceId));
  sourceDecisions.sort((a, b) => a.assetId.localeCompare(b.assetId) || a.field.localeCompare(b.field));
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
  const payload = { envelope, registries, sourcePrecedence, projections, rawManifest, normalized, sourceDecisions, missing: dedupMissing, conflicts: dedupConflicts };
  const bytes = stableStringify(payload);
  return freezeDeep({
    envelope,
    registries,
    sourcePrecedence,
    projections,
    rawManifest,
    normalized,
    sourceDecisions,
    missing: dedupMissing,
    conflicts: dedupConflicts,
    bytes,
    hash: sha256Utf8(bytes),
    frozen: true as const,
  });
}

export function validateCanonicalBasketSnapshot(value: unknown): CanonicalBasketSnapshot {
  const object = record(value, 'canonical basket snapshot');
  exactKeys(object, ['envelope', 'registries', 'sourcePrecedence', 'projections', 'rawManifest', 'normalized', 'sourceDecisions', 'missing', 'conflicts', 'bytes', 'hash', 'frozen'], 'canonical basket snapshot');
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
  const hash = hashValue(object.hash, 'basket hash');
  const missing = object.missing;
  const conflicts = object.conflicts;
  if (!Array.isArray(missing) || !Array.isArray(conflicts)) throw new TypeError('basket missing/conflicts must be arrays');
  const payload = { envelope: object.envelope, registries: object.registries, sourcePrecedence: object.sourcePrecedence, projections: object.projections, rawManifest: object.rawManifest, normalized: object.normalized, sourceDecisions: object.sourceDecisions, missing: object.missing, conflicts: object.conflicts };
  if (stableStringify(payload) !== bytes) throw new TypeError('basket bytes do not match canonical payload');
  if (sha256Utf8(bytes) !== hash) throw new TypeError('basket hash does not match bytes');
  if (sha256Utf8(stableStringify(object.rawManifest)) !== envelope.rawManifestSha256) throw new TypeError('basket rawManifestSha256 mismatch');
  if (sha256Utf8(stableStringify(object.normalized)) !== envelope.normalizedProjectionSha256) throw new TypeError('basket normalizedProjectionSha256 mismatch');
  const expectedStatus: SnapshotStatus = missing.length === 0 && conflicts.length === 0 ? 'READY' : 'NO_DATA';
  if (status !== expectedStatus) throw new TypeError('basket status does not match missing/conflicts');
  return object as unknown as CanonicalBasketSnapshot;
}

export interface BasketLeg {
  assetId: string;
  underlying: string;
  targetWeightBps: number;
}

export type ProposalStatus = 'PROPOSED' | 'NO_DATA';

export interface BasketProposal {
  schemaVersion: typeof STOCKS_SCHEMA_VERSION;
  kind: 'basket-proposal';
  proposalId: string;
  status: ProposalStatus;
  specialist: 'stocks';
  legs: readonly BasketLeg[];
  invalidations: readonly string[];
  confidence: string | null;
  horizon: string | null;
  snapshotHash: string;
  expiresAt: string;
  provenance: DataProvenance;
  authority: 'non-binding-advisory';
  executionReady: false;
}

export interface BasketProposalInput {
  proposalId: string;
  snapshot: CanonicalBasketSnapshot;
  legs: readonly BasketLeg[];
  invalidations: readonly string[];
  confidence: string | null;
  horizon: string | null;
  expiresAt: string;
}

export function createBasketProposal(input: BasketProposalInput): BasketProposal {
  const proposalId = stringValue(input.proposalId, 'proposalId');
  const snapshot = validateCanonicalBasketSnapshot(input.snapshot);
  if (!Array.isArray(input.legs) || input.legs.length === 0) throw new TypeError('basket proposal legs must be a non-empty array');
  const seen = new Set<string>();
  let weightSum = 0;
  const legs: BasketLeg[] = [];
  for (const leg of input.legs) {
    const assetId = stringValue(leg.assetId, 'basket leg assetId');
    if (seen.has(assetId)) throw new TypeError(`basket leg ${assetId} duplicated`);
    seen.add(assetId);
    if (!snapshot.envelope.assetIds.includes(assetId)) throw new TypeError(`basket leg ${assetId} not in snapshot`);
    const projection = snapshot.projections[assetId];
    const registry = snapshot.registries[assetId];
    if (projection === undefined || registry === undefined) throw new TypeError(`basket leg ${assetId} missing snapshot binding`);
    const underlying = stringValue(leg.underlying, `basket leg ${assetId} underlying`);
    if (underlying !== projection.underlying) throw new TypeError(`basket leg ${assetId} underlying mismatch`);
    const targetWeightBps = integerFinite(leg.targetWeightBps, `basket leg ${assetId} targetWeightBps`);
    if (targetWeightBps < 1 || targetWeightBps > 10000) throw new TypeError(`basket leg ${assetId} targetWeightBps out of range`);
    if (targetWeightBps > registry.limits.maxWeightBps) throw new TypeError(`basket leg ${assetId} targetWeightBps exceeds registry max-weight cap`);
    weightSum += targetWeightBps;
    legs.push({ assetId, underlying, targetWeightBps });
  }
  if (weightSum !== 10000) throw new TypeError('basket leg targetWeightBps must sum to 10000');
  const invalidations = input.invalidations.map((item, index) => stringValue(item, `basket invalidation ${index}`));
  const confidence = input.confidence === null ? null : integerString(input.confidence, 'basket confidence');
  if (confidence !== null && Number(confidence) > 10000) throw new TypeError('basket confidence must be at most 10000 bps');
  const horizon = input.horizon === null ? null : stringValue(input.horizon, 'basket horizon');
  const expiresAt = isoTime(input.expiresAt, 'basket expiresAt');
  if (Date.parse(expiresAt) <= Date.parse(snapshot.envelope.capturedAt)) throw new TypeError('basket expiresAt must be after snapshot capturedAt');
  const status: ProposalStatus = snapshot.envelope.status === 'READY' ? 'PROPOSED' : 'NO_DATA';
  return freezeDeep({
    schemaVersion: STOCKS_SCHEMA_VERSION,
    kind: 'basket-proposal' as const,
    proposalId,
    status,
    specialist: 'stocks' as const,
    legs,
    invalidations,
    confidence,
    horizon,
    snapshotHash: snapshot.hash,
    expiresAt,
    provenance: snapshot.envelope.provenance,
    authority: 'non-binding-advisory' as const,
    executionReady: false as const,
  });
}

export function hashBasketProposal(proposal: BasketProposal | null): string | null {
  return proposal === null ? null : sha256Utf8(stableStringify(proposal));
}

export function validateBasketProposal(value: unknown): BasketProposal {
  const object = record(value, 'basket proposal');
  exactKeys(object, ['schemaVersion', 'kind', 'proposalId', 'status', 'specialist', 'legs', 'invalidations', 'confidence', 'horizon', 'snapshotHash', 'expiresAt', 'provenance', 'authority', 'executionReady'], 'basket proposal');
  if (object.schemaVersion !== STOCKS_SCHEMA_VERSION || object.kind !== 'basket-proposal' || object.specialist !== 'stocks' || object.authority !== 'non-binding-advisory' || object.executionReady !== false) throw new TypeError('invalid basket proposal authority');
  enumValue(object.status, ['PROPOSED', 'NO_DATA'], 'basket proposal status');
  stringValue(object.proposalId, 'basket proposalId');
  if (!Array.isArray(object.legs) || object.legs.length === 0) throw new TypeError('basket proposal legs invalid');
  const seen = new Set<string>();
  let weightSum = 0;
  for (const raw of object.legs) {
    const leg = record(raw, 'basket leg');
    exactKeys(leg, ['assetId', 'underlying', 'targetWeightBps'], 'basket leg');
    const assetId = stringValue(leg.assetId, 'basket leg assetId');
    if (seen.has(assetId)) throw new TypeError(`basket leg ${assetId} duplicated`);
    seen.add(assetId);
    stringValue(leg.underlying, `basket leg ${assetId} underlying`);
    const targetWeightBps = integerFinite(leg.targetWeightBps, `basket leg ${assetId} targetWeightBps`);
    if (targetWeightBps < 1 || targetWeightBps > 10000) throw new TypeError(`basket leg ${assetId} targetWeightBps out of range`);
    weightSum += targetWeightBps;
  }
  if (weightSum !== 10000) throw new TypeError('basket proposal weights must sum to 10000');
  if (!Array.isArray(object.invalidations)) throw new TypeError('basket invalidations invalid');
  if (object.confidence !== null) integerString(object.confidence, 'basket confidence');
  if (object.horizon !== null) stringValue(object.horizon, 'basket horizon');
  hashValue(object.snapshotHash, 'basket snapshotHash');
  isoTime(object.expiresAt, 'basket expiresAt');
  provenance(object.provenance);
  return object as unknown as BasketProposal;
}

export type RiskStatus = 'PASS' | 'BLOCK' | 'NO_DATA';

export interface RiskReview {
  schemaVersion: typeof STOCKS_SCHEMA_VERSION;
  kind: 'risk-review';
  reviewId: string;
  requestId: string;
  runId: string;
  status: RiskStatus;
  critical: boolean;
  veto: boolean;
  reasons: readonly string[];
  snapshotHash: string;
  proposalHash: string | null;
}

export interface RiskReviewFailure {
  schemaVersion: typeof STOCKS_SCHEMA_VERSION;
  kind: 'risk-review-failure';
  code: 'TRANSPORT_FAILURE' | 'INVALID_REVIEW' | 'NO_DATA';
  authority: 'veto-only';
}

export interface RiskReviewInput {
  reviewId: string;
  requestId: string;
  runId: string;
  status: RiskStatus;
  critical: boolean;
  reasons: readonly string[];
  snapshotHash: string;
  proposalHash: string | null;
}

export function createRiskReview(input: RiskReviewInput): RiskReview {
  const status = enumValue(input.status, ['PASS', 'BLOCK', 'NO_DATA'], 'risk review status');
  if (typeof input.critical !== 'boolean') throw new TypeError('risk review critical must be boolean');
  if (input.critical && status === 'PASS') throw new TypeError('critical risk review cannot pass');
  const reasons = input.reasons.map((item, index) => stringValue(item, `risk reason ${index}`));
  return freezeDeep({
    schemaVersion: STOCKS_SCHEMA_VERSION,
    kind: 'risk-review' as const,
    reviewId: stringValue(input.reviewId, 'reviewId'),
    requestId: stringValue(input.requestId, 'requestId'),
    runId: stringValue(input.runId, 'runId'),
    status,
    critical: input.critical,
    veto: status === 'BLOCK' || input.critical,
    reasons,
    snapshotHash: hashValue(input.snapshotHash, 'risk snapshotHash'),
    proposalHash: input.proposalHash === null ? null : hashValue(input.proposalHash, 'risk proposalHash'),
  });
}

export interface Citation {
  assetId: string;
  underlying: string;
  field: StockField;
  sourceId: string;
  rawSha256: string;
}

export interface StocksAdviceRequest {
  schemaVersion: typeof STOCKS_SCHEMA_VERSION;
  kind: 'stocks.advice';
  requestId: string;
  runId: string;
  snapshot: CanonicalBasketSnapshot;
}

export interface LeadRequest {
  schemaVersion: typeof STOCKS_SCHEMA_VERSION;
  kind: 'stocks.lead-request';
  role: 'lead-specialist';
  requestId: string;
  runId: string;
  snapshot: CanonicalBasketSnapshot;
  snapshotHash: string;
}

export interface LeadResponse {
  schemaVersion: typeof STOCKS_SCHEMA_VERSION;
  kind: 'stocks.lead-response';
  role: 'lead-specialist';
  requestId: string;
  runId: string;
  snapshotHash: string;
  status: ProposalStatus;
  proposal: BasketProposal | null;
}

export interface RiskRequest {
  schemaVersion: typeof STOCKS_SCHEMA_VERSION;
  kind: 'stocks.risk-request';
  role: 'independent-risk-reviewer';
  requestId: string;
  runId: string;
  snapshot: CanonicalBasketSnapshot;
  snapshotHash: string;
  leadProposal: BasketProposal | null;
  leadProposalHash: string | null;
}

export interface RiskResponse {
  schemaVersion: typeof STOCKS_SCHEMA_VERSION;
  kind: 'stocks.risk-response';
  role: 'independent-risk-reviewer';
  requestId: string;
  runId: string;
  reviewId: string;
  status: RiskStatus;
  critical: boolean;
  reasons: readonly string[];
  snapshotHash: string;
  leadProposalHash: string | null;
}

export type AdviceStatus = 'PUBLISHED' | 'BLOCKED' | 'NO_DATA';

export interface StocksAdviceResponse {
  schemaVersion: typeof STOCKS_SCHEMA_VERSION;
  kind: 'stocks.advice';
  requestId: string;
  runId: string;
  status: AdviceStatus;
  proposal: BasketProposal | null;
  riskReview: RiskReview | RiskReviewFailure;
  snapshotHash: string;
  citations: readonly Citation[];
  authority: 'advisory-only';
  executionReady: false;
}

export interface StocksHostTransport {
  lead(request: LeadRequest): Promise<LeadResponse>;
  riskReview(request: RiskRequest): Promise<RiskResponse>;
}

export interface HostTransportBoundary {
  readonly kind: 'host-controlled';
  readonly transport: StocksHostTransport;
}

export function createStocksAdviceRequest(input: { requestId: string; runId: string; snapshot: CanonicalBasketSnapshot }): StocksAdviceRequest {
  validateCanonicalBasketSnapshot(input.snapshot);
  return freezeDeep({ schemaVersion: STOCKS_SCHEMA_VERSION, kind: 'stocks.advice' as const, requestId: stringValue(input.requestId, 'requestId'), runId: stringValue(input.runId, 'runId'), snapshot: input.snapshot });
}

export function createHostTransportBoundary(transport: StocksHostTransport): HostTransportBoundary {
  if (typeof transport.lead !== 'function' || typeof transport.riskReview !== 'function') throw new TypeError('stocks host transport must provide lead and riskReview');
  return Object.freeze({ kind: 'host-controlled' as const, transport });
}

export interface PublishStocksAdviceInput {
  requestId: string;
  runId: string;
  snapshot: CanonicalBasketSnapshot;
  proposal: BasketProposal | null;
  riskReview: RiskReview | RiskReviewFailure;
}

function basketCitations(snapshot: CanonicalBasketSnapshot, proposal: BasketProposal): Citation[] {
  const citations: Citation[] = [];
  for (const leg of proposal.legs) {
    for (const field of STOCK_FIELDS) {
      const decision = snapshot.sourceDecisions.find(entry => entry.assetId === leg.assetId && entry.field === field && entry.selectedSourceId !== null);
      if (decision === undefined || decision.selectedSourceId === null) continue;
      const entry = snapshot.rawManifest.entries.find(item => item.assetId === leg.assetId && item.field === field && item.sourceId === decision.selectedSourceId);
      if (entry === undefined) continue;
      citations.push({ assetId: leg.assetId, underlying: leg.underlying, field, sourceId: decision.selectedSourceId, rawSha256: entry.rawSha256 });
    }
  }
  citations.sort((a, b) => a.assetId.localeCompare(b.assetId) || a.field.localeCompare(b.field));
  return citations;
}

export function publishStocksAdvice(input: PublishStocksAdviceInput): StocksAdviceResponse {
  const requestId = stringValue(input.requestId, 'requestId');
  const runId = stringValue(input.runId, 'runId');
  const snapshot = validateCanonicalBasketSnapshot(input.snapshot);
  const proposal = input.proposal;
  const review = input.riskReview;
  let status: AdviceStatus;
  let publishedProposal: BasketProposal | null;
  if (proposal === null || proposal.status === 'NO_DATA') {
    status = 'NO_DATA';
    publishedProposal = null;
  } else if (review.kind === 'risk-review-failure' || review.status === 'NO_DATA') {
    status = 'NO_DATA';
    publishedProposal = null;
  } else if (review.status === 'BLOCK' || review.critical) {
    status = 'BLOCKED';
    publishedProposal = null;
  } else {
    status = 'PUBLISHED';
    publishedProposal = proposal;
  }
  const citations = publishedProposal === null ? [] : basketCitations(snapshot, publishedProposal);
  const response = freezeDeep({
    schemaVersion: STOCKS_SCHEMA_VERSION,
    kind: 'stocks.advice' as const,
    requestId,
    runId,
    status,
    proposal: publishedProposal,
    riskReview: review,
    snapshotHash: snapshot.hash,
    citations,
    authority: 'advisory-only' as const,
    executionReady: false as const,
  });
  return validateStocksAdviceResponse(response);
}

export function validateStocksAdviceResponse(value: unknown): StocksAdviceResponse {
  const object = record(value, 'stocks advice response');
  if (!isDeepFrozen(object)) throw new TypeError('stocks advice response must be deeply frozen');
  exactKeys(object, ['schemaVersion', 'kind', 'requestId', 'runId', 'status', 'proposal', 'riskReview', 'snapshotHash', 'citations', 'authority', 'executionReady'], 'stocks advice response');
  if (object.schemaVersion !== STOCKS_SCHEMA_VERSION || object.kind !== 'stocks.advice' || object.authority !== 'advisory-only' || object.executionReady !== false) throw new TypeError('invalid stocks advice response');
  const status = enumValue(object.status, ['PUBLISHED', 'BLOCKED', 'NO_DATA'], 'stocks advice status');
  stringValue(object.requestId, 'requestId');
  stringValue(object.runId, 'runId');
  hashValue(object.snapshotHash, 'snapshotHash');
  const review = record(object.riskReview, 'risk review record');
  if (review.kind !== 'risk-review' && review.kind !== 'risk-review-failure') throw new TypeError('stocks advice risk review kind invalid');
  const citations = object.citations;
  if (!Array.isArray(citations)) throw new TypeError('stocks advice citations must be an array');
  for (const raw of citations) {
    const citation = record(raw, 'stocks advice citation');
    exactKeys(citation, ['assetId', 'underlying', 'field', 'sourceId', 'rawSha256'], 'stocks advice citation');
    stringValue(citation.assetId, 'citation assetId');
    stringValue(citation.underlying, 'citation underlying');
    enumValue(citation.field, STOCK_FIELDS, 'citation field');
    stringValue(citation.sourceId, 'citation sourceId');
    hashValue(citation.rawSha256, 'citation rawSha256');
  }
  if (status === 'PUBLISHED') {
    if (object.proposal === null) throw new TypeError('published advice requires a proposal');
    validateBasketProposal(object.proposal);
    if (review.kind !== 'risk-review' || review.status !== 'PASS' || review.critical === true) throw new TypeError('published advice requires a passing risk review');
    if (citations.length === 0) throw new TypeError('published advice requires citations');
  } else {
    if (object.proposal !== null) throw new TypeError('non-published advice must have a null proposal');
    if (citations.length !== 0) throw new TypeError('non-published advice must have no citations');
  }
  return object as unknown as StocksAdviceResponse;
}

export async function invokeStocksAdvice(boundary: HostTransportBoundary, request: StocksAdviceRequest): Promise<StocksAdviceResponse> {
  const requestId = request.requestId;
  const runId = request.runId;
  const snapshotHash = request.snapshot.hash;
  try {
    validateCanonicalBasketSnapshot(request.snapshot);
    const leadRequest: LeadRequest = freezeDeep({ schemaVersion: STOCKS_SCHEMA_VERSION, kind: 'stocks.lead-request' as const, role: 'lead-specialist' as const, requestId, runId, snapshot: request.snapshot, snapshotHash });
    const leadObject = record(await boundary.transport.lead(leadRequest), 'lead response');
    exactKeys(leadObject, ['schemaVersion', 'kind', 'role', 'requestId', 'runId', 'snapshotHash', 'status', 'proposal'], 'lead response');
    if (leadObject.schemaVersion !== STOCKS_SCHEMA_VERSION || leadObject.kind !== 'stocks.lead-response' || leadObject.role !== 'lead-specialist' || leadObject.requestId !== requestId || leadObject.runId !== runId || leadObject.snapshotHash !== snapshotHash) throw new TypeError('lead response binding mismatch');
    const leadStatus = enumValue(leadObject.status, ['PROPOSED', 'NO_DATA'], 'lead status');
    const proposal = leadObject.proposal === null ? null : validateBasketProposal(leadObject.proposal);
    if (proposal !== null && (proposal.snapshotHash !== snapshotHash || proposal.status !== leadStatus)) throw new TypeError('lead proposal binding mismatch');
    const leadProposalHash = hashBasketProposal(proposal);
    const riskRequest: RiskRequest = freezeDeep({ schemaVersion: STOCKS_SCHEMA_VERSION, kind: 'stocks.risk-request' as const, role: 'independent-risk-reviewer' as const, requestId, runId, snapshot: request.snapshot, snapshotHash, leadProposal: proposal, leadProposalHash });
    const riskObject = record(await boundary.transport.riskReview(riskRequest), 'risk response');
    exactKeys(riskObject, ['schemaVersion', 'kind', 'role', 'requestId', 'runId', 'reviewId', 'status', 'critical', 'reasons', 'snapshotHash', 'leadProposalHash'], 'risk response');
    if (riskObject.schemaVersion !== STOCKS_SCHEMA_VERSION || riskObject.kind !== 'stocks.risk-response' || riskObject.role !== 'independent-risk-reviewer' || riskObject.requestId !== requestId || riskObject.runId !== runId || riskObject.snapshotHash !== snapshotHash || riskObject.leadProposalHash !== leadProposalHash) throw new TypeError('risk response binding mismatch');
    const riskReview = createRiskReview({ reviewId: stringValue(riskObject.reviewId, 'reviewId'), requestId, runId, status: enumValue(riskObject.status, ['PASS', 'BLOCK', 'NO_DATA'], 'risk status'), critical: riskObject.critical as boolean, reasons: riskObject.reasons as readonly string[], snapshotHash, proposalHash: leadProposalHash });
    return publishStocksAdvice({ requestId, runId, snapshot: request.snapshot, proposal, riskReview });
  } catch {
    const failure: RiskReviewFailure = { schemaVersion: STOCKS_SCHEMA_VERSION, kind: 'risk-review-failure', code: 'NO_DATA', authority: 'veto-only' };
    return publishStocksAdvice({ requestId, runId, snapshot: request.snapshot, proposal: null, riskReview: failure });
  }
}
