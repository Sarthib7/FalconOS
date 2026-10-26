import { randomUUID } from 'node:crypto';
import { canonicalBytes, freezeDeep, sha256 } from '../council/evidence.ts';
import { COUNCIL_LIMITS, validatePreflight } from '../council/host.mjs';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const HASH = /^[0-9a-f]{64}$/;
const SNAPSHOT_KEYS = [
  'schemaVersion', 'domain', 'capturedAt', 'portfolio', 'mandate', 'mandateHash', 'request', 'quotes',
  'proposal', 'checks', 'reasons', 'status',
];
const REQUEST_KEYS = ['requestId', 'action', 'sourceAssetId', 'targetAssetId', 'inputBaseUnits'];
const PROPOSAL_KEYS = ['action', 'sourceAssetId', 'targetAssetId', 'inputBaseUnits', 'reason', 'expiresAt'];
const SOURCE_REF_KEYS = ['revisionId', 'sha256'];
const LEAD_KEYS = [
  'schemaVersion', 'role', 'runId', 'callId', 'snapshotHash', 'proposalHash', 'status', 'thesis',
  'counterCase', 'citations', 'missingEvidence', 'executionReady',
];
const RISK_KEYS = [
  'schemaVersion', 'role', 'runId', 'callId', 'snapshotHash', 'proposalHash', 'status', 'reason',
  'citations', 'missingEvidence', 'executionReady',
];
const MAX_REQUEST_BYTES = COUNCIL_LIMITS.requestBytes;
const MAX_REASONS = 32;

function isRecord(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function exact(value, keys) {
  if (!isRecord(value)) return false;
  const own = Reflect.ownKeys(value);
  return own.length === keys.length && own.every(key => typeof key === 'string') && keys.every(key => Object.hasOwn(value, key));
}

function canonicalTime(value) {
  return typeof value === 'string'
    && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)
    && Number.isFinite(Date.parse(value))
    && new Date(value).toISOString() === value;
}

function boundedText(value, maxBytes) {
  if (typeof value !== 'string' || value.trim().length === 0 || Buffer.byteLength(value, 'utf8') > maxBytes) return false;
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code === 0) return false;
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (!(next >= 0xdc00 && next <= 0xdfff)) return false;
      index += 1;
    } else if (code >= 0xdc00 && code <= 0xdfff) return false;
  }
  return true;
}

function textArray(value, maxItems, maxBytes) {
  return Array.isArray(value) && value.length <= maxItems && value.every(item => boundedText(item, maxBytes));
}

function safeJsonClone(value, maxBytes) {
  const text = JSON.stringify(value);
  if (typeof text !== 'string' || Buffer.byteLength(text, 'utf8') > maxBytes) return null;
  const clone = JSON.parse(text);
  if (canonicalBytes(clone).byteLength > maxBytes) return null;
  return clone;
}

function validRefs(value, { allowEmpty = false } = {}) {
  if (!Array.isArray(value) || value.length > 4 || (!allowEmpty && value.length < 1)) return false;
  const seen = new Set();
  for (const ref of value) {
    if (!exact(ref, SOURCE_REF_KEYS) || typeof ref.revisionId !== 'string' || !UUID.test(ref.revisionId)
        || typeof ref.sha256 !== 'string' || !HASH.test(ref.sha256) || seen.has(ref.revisionId)) return false;
    seen.add(ref.revisionId);
  }
  return true;
}

function validProposal(value, action) {
  return exact(value, PROPOSAL_KEYS)
    && value.action === action
    && (value.sourceAssetId === null || (typeof value.sourceAssetId === 'string' && value.sourceAssetId.length <= 256))
    && (value.targetAssetId === null || (typeof value.targetAssetId === 'string' && value.targetAssetId.length <= 256))
    && typeof value.inputBaseUnits === 'string'
    && /^(?:0|[1-9][0-9]*)$/.test(value.inputBaseUnits)
    && boundedText(value.reason, 512)
    && canonicalTime(value.expiresAt);
}

function validateSnapshot(snapshot, snapshotHash, nowText) {
  if (!exact(snapshot, SNAPSHOT_KEYS) || snapshot.schemaVersion !== 1 || snapshot.domain !== 'cfo'
      || !canonicalTime(snapshot.capturedAt) || Date.parse(snapshot.capturedAt) > Date.parse(nowText)
      || !isRecord(snapshot.portfolio) || !isRecord(snapshot.mandate)
      || typeof snapshot.mandateHash !== 'string' || !HASH.test(snapshot.mandateHash)
      || !exact(snapshot.request, REQUEST_KEYS)
      || typeof snapshot.request.requestId !== 'string' || !UUID.test(snapshot.request.requestId)
      || !['invest', 'redeem', 'rotate', 'reinvest', 'hold'].includes(snapshot.request.action)
      || !(snapshot.request.sourceAssetId === null || typeof snapshot.request.sourceAssetId === 'string')
      || !(snapshot.request.targetAssetId === null || typeof snapshot.request.targetAssetId === 'string')
      || !(snapshot.request.inputBaseUnits === null || (typeof snapshot.request.inputBaseUnits === 'string' && /^(?:0|[1-9][0-9]*)$/.test(snapshot.request.inputBaseUnits)))
      || !Array.isArray(snapshot.quotes) || snapshot.quotes.length > 32
      || !Array.isArray(snapshot.checks) || snapshot.checks.length > 64
      || snapshot.checks.some(check => !exact(check, ['id', 'status', 'detail'])
        || !boundedText(check.id, 64) || !['PASS', 'BLOCKED', 'NO_DATA'].includes(check.status) || typeof check.detail !== 'string' || Buffer.byteLength(check.detail, 'utf8') > 512)
      || !Array.isArray(snapshot.reasons) || snapshot.reasons.length > MAX_REASONS
      || snapshot.reasons.some(reason => typeof reason !== 'string' || Buffer.byteLength(reason, 'utf8') > 512)
      || !['REVIEW', 'BLOCKED', 'NO_DATA'].includes(snapshot.status)) return null;
  if (snapshot.status === 'REVIEW' && !validProposal(snapshot.proposal, snapshot.request.action)) return null;
  if (snapshot.status !== 'REVIEW' && snapshot.proposal !== null && !validProposal(snapshot.proposal, snapshot.request.action)) return null;
  const copy = safeJsonClone(snapshot, MAX_REQUEST_BYTES);
  if (copy === null || !HASH.test(snapshotHash) || sha256(canonicalBytes(copy)) !== snapshotHash) return null;
  return freezeDeep(copy);
}

function validCitations(value, sourceRefs) {
  if (!Array.isArray(value) || value.length > 16) return false;
  const seen = new Set();
  for (const citation of value) {
    if (!exact(citation, ['revisionId', 'sha256', 'supports'])
        || typeof citation.revisionId !== 'string' || !UUID.test(citation.revisionId)
        || typeof citation.sha256 !== 'string' || !HASH.test(citation.sha256)
        || !boundedText(citation.supports, 512) || seen.has(citation.revisionId)) return false;
    const ref = sourceRefs.find(item => item.revisionId === citation.revisionId);
    if (!ref || ref.sha256 !== citation.sha256) return false;
    seen.add(citation.revisionId);
  }
  return true;
}

function validLead(value, request, refs, proposalHash) {
  return exact(value, LEAD_KEYS)
    && value.schemaVersion === 1 && value.role === 'lead'
    && value.runId === request.runId && value.callId === request.callId
    && value.snapshotHash === request.snapshotHash && value.proposalHash === proposalHash
    && ['PROPOSED', 'NO_DATA'].includes(value.status)
    && boundedText(value.thesis, 8192) && boundedText(value.counterCase, 8192)
    && validCitations(value.citations, refs) && textArray(value.missingEvidence, 32, 512)
    && value.executionReady === false
    && (value.status !== 'PROPOSED' || value.citations.length > 0);
}

function validRisk(value, request, refs, proposalHash, canPass) {
  return exact(value, RISK_KEYS)
    && value.schemaVersion === 1 && value.role === 'risk'
    && value.runId === request.runId && value.callId === request.callId
    && value.snapshotHash === request.snapshotHash && value.proposalHash === proposalHash
    && ['PASS', 'BLOCKED', 'NO_DATA'].includes(value.status)
    && boundedText(value.reason, 4096)
    && validCitations(value.citations, refs) && textArray(value.missingEvidence, 32, 512)
    && value.executionReady === false
    && (value.status !== 'PASS' || (canPass && value.citations.length > 0 && value.missingEvidence.length === 0));
}

function appendReason(reasons, value) {
  if (typeof value === 'string' && value.trim() && Buffer.byteLength(value, 'utf8') <= 512 && !reasons.includes(value) && reasons.length < MAX_REASONS) reasons.push(value);
}

function result(runId, snapshotHash, lead, risk, status, proposal, reasons = []) {
  return freezeDeep({
    schemaVersion: 1,
    runId: UUID.test(runId) ? runId : null,
    snapshotHash: HASH.test(snapshotHash) ? snapshotHash : null,
    lead,
    risk,
    status,
    proposal: status === 'REVIEW' ? proposal : null,
    reasons: reasons.slice(0, MAX_REASONS),
    executionReady: false,
  });
}

function noData(runId, snapshotHash, reason, lead = null, risk = null, details = []) {
  const reasons = [];
  for (const item of details) appendReason(reasons, item);
  appendReason(reasons, reason);
  if (reasons.length === 0) reasons.push('CFO review could not produce a verified result.');
  return result(runId, snapshotHash, lead, risk, 'NO_DATA', null, reasons);
}

function validActionForReview(snapshot) {
  return snapshot.request.action === 'invest' || snapshot.request.action === 'reinvest';
}

export async function runCfoReview({ runId, snapshot, snapshotHash, sourceRefs, transport, now = () => new Date().toISOString() } = {}) {
  let nowText;
  try { nowText = now(); }
  catch { return noData(runId, snapshotHash, 'CFO review clock is unavailable.'); }
  if (!canonicalTime(nowText)) return noData(runId, snapshotHash, 'CFO review clock did not return canonical UTC time.');
  if (typeof runId !== 'string' || !UUID.test(runId)) return noData(runId, snapshotHash, 'CFO review run identity is invalid.');

  let frozenSnapshot;
  try { frozenSnapshot = validateSnapshot(snapshot, snapshotHash, nowText); }
  catch { frozenSnapshot = null; }
  if (!frozenSnapshot) return noData(runId, snapshotHash, 'CFO snapshot is malformed, future-dated, oversized, or does not match its canonical hash.');
  if (!validRefs(sourceRefs, { allowEmpty: true })) return noData(runId, snapshotHash, 'CFO source references are malformed or duplicated.');
  if (frozenSnapshot.status === 'BLOCKED') return result(runId, snapshotHash, null, null, 'BLOCKED', null, frozenSnapshot.reasons);
  if (frozenSnapshot.status === 'NO_DATA') return noData(runId, snapshotHash, 'Deterministic CFO policy returned NO_DATA.', null, null, frozenSnapshot.reasons);
  if (!validActionForReview(frozenSnapshot)) {
    return result(runId, snapshotHash, null, null, 'REVIEW', frozenSnapshot.proposal, []);
  }
  if (sourceRefs.length < 1) return noData(runId, snapshotHash, 'Buy review requires actual retained source references.');
  if (!transport || typeof transport.preflight !== 'function' || typeof transport.call !== 'function') {
    return noData(runId, snapshotHash, 'A trusted CFO review host is unavailable.');
  }
  const refs = freezeDeep(safeJsonClone(sourceRefs, MAX_REQUEST_BYTES));
  if (refs === null) return noData(runId, snapshotHash, 'CFO source references cannot be serialized safely.');

  const proposalHash = sha256(canonicalBytes(frozenSnapshot.proposal));
  const proposalBinding = freezeDeep({ hash: proposalHash, value: frozenSnapshot.proposal });
  const modelResult = freezeDeep({ domain: 'cfo', status: frozenSnapshot.status, proposal: frozenSnapshot.proposal });
  const makeRequest = (role, callId) => freezeDeep({
    schemaVersion: 1,
    role,
    runId,
    callId,
    snapshotHash,
    snapshot: frozenSnapshot,
    modelResult,
    sourceRefs: refs,
    proposal: proposalBinding,
  });
  const leadCallId = randomUUID();
  let riskCallId = randomUUID();
  while (riskCallId === leadCallId) riskCallId = randomUUID();
  const leadRequest = makeRequest('lead', leadCallId);
  const riskRequest = makeRequest('risk', riskCallId);
  try {
    if (canonicalBytes(leadRequest).byteLength > MAX_REQUEST_BYTES || canonicalBytes(riskRequest).byteLength > MAX_REQUEST_BYTES) {
      return noData(runId, snapshotHash, 'CFO review packet exceeds the shared 64 KiB request limit.');
    }
  } catch {
    return noData(runId, snapshotHash, 'CFO review request cannot be serialized safely.');
  }

  let preflight;
  try { preflight = await transport.preflight({ auditRequest: leadRequest }); }
  catch { return noData(runId, snapshotHash, 'CFO review host preflight failed.'); }
  try { nowText = now(); }
  catch { return noData(runId, snapshotHash, 'CFO review clock became unavailable during preflight.'); }
  if (!canonicalTime(nowText) || !validatePreflight(preflight, nowText)) {
    return noData(runId, snapshotHash, 'CFO review host preflight was missing, malformed, stale-dated, or unverified.');
  }
  if (preflight.status !== 'VERIFIED') return noData(runId, snapshotHash, 'CFO review host controls are not verified.', null, null, preflight.reasons);

  let leadRaw = null;
  let acceptedLead = false;
  try {
    const candidate = safeJsonClone(await transport.call(leadRequest), COUNCIL_LIMITS.modelJsonBytes);
    if (candidate !== null && validLead(candidate, leadRequest, refs, proposalHash)) {
      leadRaw = freezeDeep(candidate);
      acceptedLead = true;
    }
  } catch {}

  let riskRaw = null;
  let acceptedRisk = false;
  const canPass = acceptedLead && leadRaw.status === 'PROPOSED' && leadRaw.missingEvidence.length === 0;
  try {
    const candidate = safeJsonClone(await transport.call(riskRequest), COUNCIL_LIMITS.modelJsonBytes);
    if (candidate !== null && validRisk(candidate, riskRequest, refs, proposalHash, canPass)) {
      riskRaw = freezeDeep(candidate);
      acceptedRisk = true;
    }
  } catch {}

  const reasons = [];
  if (!acceptedLead) appendReason(reasons, 'Lead review failed CFO schema or snapshot/proposal binding validation.');
  if (acceptedLead && leadRaw.status === 'NO_DATA') appendReason(reasons, 'Lead review returned NO_DATA.');
  if (acceptedLead) for (const item of leadRaw.missingEvidence) appendReason(reasons, item);
  if (!acceptedRisk) appendReason(reasons, 'Risk review failed CFO schema or snapshot/proposal binding validation.');
  if (acceptedRisk && riskRaw.status === 'BLOCKED') {
    appendReason(reasons, riskRaw.reason);
    for (const item of riskRaw.missingEvidence) appendReason(reasons, item);
    return result(runId, snapshotHash, leadRaw, riskRaw, 'BLOCKED', null, reasons);
  }
  if (acceptedRisk && riskRaw.status === 'NO_DATA') {
    appendReason(reasons, riskRaw.reason);
    for (const item of riskRaw.missingEvidence) appendReason(reasons, item);
  }
  const readyForReview = acceptedLead && leadRaw.status === 'PROPOSED' && leadRaw.missingEvidence.length === 0
    && acceptedRisk && riskRaw.status === 'PASS' && riskRaw.missingEvidence.length === 0;
  if (!readyForReview) {
    if (reasons.length === 0) appendReason(reasons, 'CFO review did not produce a complete Lead result and independent Risk pass.');
    return result(runId, snapshotHash, leadRaw, riskRaw, 'NO_DATA', null, reasons);
  }
  return result(runId, snapshotHash, leadRaw, riskRaw, 'REVIEW', frozenSnapshot.proposal, []);
}
