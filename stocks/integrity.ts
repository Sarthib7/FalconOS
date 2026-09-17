import { hashBasketProposal, validateBasketProposal, validateCanonicalBasketSnapshot } from './stocks.ts';
import type { BasketProposal, CanonicalBasketSnapshot } from './stocks.ts';

export const INTEGRITY_SCHEMA_VERSION = 1 as const;
export type IntegrityStatus = 'VERIFIED' | 'STALE' | 'DIVERGENT' | 'NO_DATA';
export type IntegrityCheckStatus = 'PASS' | 'FAIL' | 'UNKNOWN';
export type EvidenceFreshness = 'KNOWN' | 'UNKNOWN';

export interface IntegrityCheck {
  code: 'snapshot-status' | 'required-evidence' | 'source-selection' | 'snapshot-freshness' | 'reference-freshness' | 'proposal-binding';
  status: IntegrityCheckStatus;
  detail: string;
}

export interface MarketIntegrityReport {
  schemaVersion: typeof INTEGRITY_SCHEMA_VERSION;
  kind: 'stocks.market-integrity';
  snapshotHash: string;
  proposalHash: string | null;
  snapshotCapturedAt: string;
  checkedAt: string;
  freshness: EvidenceFreshness;
  status: IntegrityStatus;
  checks: readonly IntegrityCheck[];
  refusalCodes: readonly string[];
  warnings: readonly string[];
  authority: 'advisory-only';
  executionReady: false;
}

export interface MarketIntegrityInput {
  snapshot: CanonicalBasketSnapshot;
  proposal: BasketProposal | null;
  checkedAt: string;
  maxAgeMs: number;
}

const HASH = /^[a-f0-9]{64}$/;

function isoTime(value: string, name: string): string {
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) throw new TypeError(`${name} must be an ISO timestamp`);
  return new Date(parsed).toISOString();
}

function check(code: IntegrityCheck['code'], status: IntegrityCheckStatus, detail: string): IntegrityCheck {
  return { code, status, detail };
}

export function evaluateMarketIntegrity(input: MarketIntegrityInput): MarketIntegrityReport {
  const snapshot = validateCanonicalBasketSnapshot(input.snapshot);
  const checkedAt = isoTime(input.checkedAt, 'integrity checkedAt');
  if (!Number.isInteger(input.maxAgeMs) || input.maxAgeMs <= 0) throw new TypeError('integrity maxAgeMs must be a positive integer');

  let proposal: BasketProposal | null = null;
  let proposalHash: string | null = null;
  let proposalExpired = false;
  if (input.proposal !== null) {
    proposal = validateBasketProposal(input.proposal);
    if (proposal.snapshotHash !== snapshot.hash) throw new TypeError('integrity proposal snapshot hash mismatch');
    proposalExpired = Date.parse(proposal.expiresAt) <= Date.parse(checkedAt);
    proposalHash = hashBasketProposal(proposal);
    if (proposalHash !== null && !HASH.test(proposalHash)) throw new TypeError('integrity proposalHash must be sha256');
  }

  const checks: IntegrityCheck[] = [];
  const refusalCodes: string[] = [];
  const warnings: string[] = [];
  const snapshotReady = snapshot.envelope.status === 'READY';
  const hasMissing = snapshot.missing.length > 0;
  const hasConflicts = snapshot.conflicts.length > 0;
  const selectedCount = snapshot.sourceDecisions.filter(decision => decision.selectedSourceId !== null).length;
  const expectedSelections = snapshot.envelope.assetIds.length * 2;
  const ageMs = Date.parse(checkedAt) - Date.parse(snapshot.envelope.capturedAt);

  checks.push(snapshotReady
    ? check('snapshot-status', 'PASS', 'canonical snapshot status is READY')
    : check('snapshot-status', 'FAIL', `canonical snapshot status is ${snapshot.envelope.status}`));
  if (!snapshotReady && !hasConflicts) refusalCodes.push('snapshot-not-ready');

  checks.push(!hasMissing
    ? check('required-evidence', 'PASS', 'required fields have selected evidence')
    : check('required-evidence', 'FAIL', `${snapshot.missing.length} required evidence item(s) are missing`));
  if (hasMissing) refusalCodes.push('required-evidence-missing');

  checks.push(selectedCount === expectedSelections
    ? check('source-selection', 'PASS', 'every asset field has one selected source')
    : check('source-selection', 'FAIL', `${expectedSelections - selectedCount} asset field source selection(s) are unavailable`));
  if (selectedCount !== expectedSelections) refusalCodes.push('source-selection-incomplete');

  const snapshotFresh = ageMs >= 0 && ageMs <= input.maxAgeMs;
  checks.push(snapshotFresh
    ? check('snapshot-freshness', 'PASS', `snapshot age is ${ageMs}ms within ${input.maxAgeMs}ms`)
    : check('snapshot-freshness', 'FAIL', ageMs < 0 ? 'checkedAt precedes snapshot capture' : `snapshot age is ${ageMs}ms`));
  if (!snapshotFresh) refusalCodes.push(ageMs < 0 ? 'snapshot-time-invalid' : 'snapshot-stale');

  checks.push(hasConflicts
    ? check('source-selection', 'FAIL', `${snapshot.conflicts.length} canonical conflict(s) are recorded`)
    : check('source-selection', 'PASS', 'canonical snapshot has no recorded conflicts'));
  if (hasConflicts) refusalCodes.push('canonical-conflict');

  if (proposal !== null) {
    checks.push(proposalExpired
      ? check('proposal-binding', 'FAIL', 'proposal expiry is at or before checkedAt')
      : check('proposal-binding', 'PASS', 'proposal snapshot hash matches canonical snapshot and expiry is in the future'));
    if (proposalExpired) refusalCodes.push('proposal-expired');
  }

  const liveReferenceAgeUnknown = snapshot.envelope.provenance === 'live';
  checks.push(liveReferenceAgeUnknown
    ? check('reference-freshness', 'UNKNOWN', 'provider reference freshness is not independently attested')
    : check('reference-freshness', 'PASS', 'synthetic or historical reference freshness is bounded by the snapshot'));
  if (liveReferenceAgeUnknown) warnings.push('reference-freshness-unknown');

  let status: IntegrityStatus = 'VERIFIED';
  if (hasConflicts) status = 'DIVERGENT';
  if (refusalCodes.some(code => code === 'snapshot-stale' || code === 'snapshot-time-invalid' || code === 'proposal-expired')) status = 'STALE';
  if (hasMissing || selectedCount !== expectedSelections || (!snapshotReady && !hasConflicts)) status = 'NO_DATA';

  return Object.freeze({
    schemaVersion: INTEGRITY_SCHEMA_VERSION,
    kind: 'stocks.market-integrity' as const,
    snapshotHash: snapshot.hash,
    proposalHash,
    snapshotCapturedAt: snapshot.envelope.capturedAt,
    checkedAt,
    freshness: liveReferenceAgeUnknown ? 'UNKNOWN' : 'KNOWN',
    status,
    checks: Object.freeze(checks),
    refusalCodes: Object.freeze([...new Set(refusalCodes)]),
    warnings: Object.freeze(warnings),
    authority: 'advisory-only' as const,
    executionReady: false as const,
  });
}
