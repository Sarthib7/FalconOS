import { randomUUID } from "node:crypto";
import { canonicalBytes, freezeDeep, sha256, stableStringify } from "./evidence.ts";

export const COUNCIL_MODEL = "gpt-6-luna";
export const COUNCIL_REASONING_EFFORT = "max";
export const COUNCIL_POLICY_VERSION = "codex-readonly/1";

const MAX_REQUEST_BYTES = 64 * 1024;
const MAX_MODEL_RESULT_BYTES = 48 * 1024;
const MAX_JSON_DEPTH = 32;
const MAX_JSON_NODES = 12000;
const MAX_JSON_STRING_BYTES = MAX_REQUEST_BYTES;
const MAX_CITATIONS = 16;
const MAX_MISSING = 32;
const MAX_REASONS = 32;
const HASH_PATTERN = /^[0-9a-f]{64}$/;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const SNAPSHOT_KEYS = [
  "schemaVersion", "domain", "adapterVersion", "sourceUrl", "capturedAt",
  "rawBodySha256", "rawBodyBytes", "sourceRefs", "modelVersion", "modelResult",
];
const MODEL_RESULT_KEYS = [
  "modelVersion", "status", "seriesSummaries", "unknowns", "counterCase",
  "investmentAssessment", "executionReady",
];
const LEAD_RESPONSE_KEYS = [
  "schemaVersion", "role", "runId", "callId", "snapshotHash", "status",
  "thesis", "counterCase", "citations", "proposal", "missingEvidence", "executionReady",
];
const RISK_RESPONSE_KEYS = [
  "schemaVersion", "role", "runId", "callId", "snapshotHash", "proposalHash",
  "status", "reason", "citations", "missingEvidence", "executionReady",
];
const PREFLIGHT_KEYS = [
  "status", "policyVersion", "requestedModel", "requestedReasoningEffort",
  "executableVersion", "checkedAt", "policyHash", "verifiedControls", "reasons",
];
const CONTROL_KEYS = [
  "userConfigIsolated", "webSearchDisabled", "commandToolsDisabled", "patchToolsDisabled",
  "inheritedMcpDisabled", "readOnlySandbox", "boundedIO", "controlledProbePassed",
];

function isRecord(value) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function exactKeys(value, expected) {
  if (!isRecord(value)) return false;
  const keys = Reflect.ownKeys(value);
  if (keys.some(key => typeof key !== "string")) return false;
  if (keys.length !== expected.length) return false;
  const actual = new Set(keys);
  return expected.every(key => actual.has(key));
}

function validUnicode(value) {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code === 0) return false;
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (!(next >= 0xdc00 && next <= 0xdfff)) return false;
      index += 1;
    } else if (code >= 0xdc00 && code <= 0xdfff) {
      return false;
    }
  }
  return true;
}

function stringBytes(value) {
  return Buffer.byteLength(JSON.stringify(value), "utf8");
}

function boundedString(value, minBytes, maxBytes) {
  if (typeof value !== "string" || !validUnicode(value) || value.trim().length === 0) return false;
  const bytes = Buffer.byteLength(value, "utf8");
  return bytes >= minBytes && bytes <= maxBytes;
}

function canonicalTime(value) {
  return typeof value === "string"
    && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)
    && Number.isFinite(Date.parse(value))
    && new Date(value).toISOString() === value;
}

function assertSafeJson(value, maxBytes, label = "JSON value") {
  let encodedBytes = 0;
  let nodes = 0;
  const ancestors = new WeakSet();
  const addBytes = count => {
    encodedBytes += count;
    if (encodedBytes > maxBytes) throw new Error(label + " exceeds its byte limit.");
  };
  const visit = (item, depth) => {
    nodes += 1;
    if (nodes > MAX_JSON_NODES || depth > MAX_JSON_DEPTH) throw new Error(label + " exceeds its structural limit.");
    if (item === null) {
      addBytes(4);
      return;
    }
    if (typeof item === "string") {
      if (!validUnicode(item) || Buffer.byteLength(item, "utf8") > MAX_JSON_STRING_BYTES) {
        throw new Error(label + " contains an invalid or oversized string.");
      }
      addBytes(stringBytes(item));
      return;
    }
    if (typeof item === "boolean") {
      addBytes(item ? 4 : 5);
      return;
    }
    if (typeof item === "number") {
      if (!Number.isFinite(item)) throw new Error(label + " contains a non-finite number.");
      addBytes(Buffer.byteLength(JSON.stringify(item), "utf8"));
      return;
    }
    if (typeof item !== "object") throw new Error(label + " must contain only JSON values.");
    if (ancestors.has(item)) throw new Error(label + " must not contain cycles.");
    ancestors.add(item);
    const prototype = Object.getPrototypeOf(item);
    if (Array.isArray(item)) {
      if (prototype !== Array.prototype || item.length > MAX_JSON_NODES) throw new Error(label + " contains an unsupported array.");
      const ownKeys = Reflect.ownKeys(item);
      if (ownKeys.length !== item.length + 1 || ownKeys.some(key => typeof key !== "string")) {
        throw new Error(label + " contains an array with extra or missing entries.");
      }
      addBytes(2);
      for (let index = 0; index < item.length; index += 1) {
        const key = String(index);
        const descriptor = Object.getOwnPropertyDescriptor(item, key);
        if (!descriptor || !descriptor.enumerable || !Object.hasOwn(descriptor, "value")) {
          throw new Error(label + " contains an invalid array entry.");
        }
        if (index) addBytes(1);
        visit(descriptor.value, depth + 1);
      }
      const lengthDescriptor = Object.getOwnPropertyDescriptor(item, "length");
      if (!lengthDescriptor || lengthDescriptor.enumerable || !Object.hasOwn(lengthDescriptor, "value")) {
        throw new Error(label + " contains an invalid array length.");
      }
      ancestors.delete(item);
      return;
    }
    if (prototype !== Object.prototype && prototype !== null) throw new Error(label + " must contain plain objects only.");
    const ownKeys = Reflect.ownKeys(item);
    if (ownKeys.some(key => typeof key !== "string")) throw new Error(label + " contains symbol keys.");
    addBytes(2);
    for (let index = 0; index < ownKeys.length; index += 1) {
      const key = ownKeys[index];
      const descriptor = Object.getOwnPropertyDescriptor(item, key);
      if (!descriptor || !descriptor.enumerable || !Object.hasOwn(descriptor, "value")) {
        throw new Error(label + " contains an accessor or hidden property.");
      }
      if (!validUnicode(key) || Buffer.byteLength(key, "utf8") > MAX_JSON_STRING_BYTES) {
        throw new Error(label + " contains an invalid property name.");
      }
      if (index) addBytes(1);
      addBytes(stringBytes(key) + 1);
      visit(descriptor.value, depth + 1);
    }
    ancestors.delete(item);
  };
  visit(value, 0);
  return encodedBytes;
}

function cloneSafeJson(value, maxBytes, label) {
  assertSafeJson(value, maxBytes, label);
  return JSON.parse(stableStringify(value));
}

function validStringArray(value, minItems, maxItems, maxStringBytes) {
  if (!Array.isArray(value) || value.length < minItems || value.length > maxItems) return false;
  return value.every(item => boundedString(item, 1, maxStringBytes));
}

function validateSourceRefs(value) {
  if (!Array.isArray(value) || value.length < 1 || value.length > 4) return false;
  const seen = new Set();
  for (const ref of value) {
    if (!exactKeys(ref, ["revisionId", "sha256"])) return false;
    if (!UUID_PATTERN.test(ref.revisionId) || !HASH_PATTERN.test(ref.sha256) || seen.has(ref.revisionId)) return false;
    seen.add(ref.revisionId);
  }
  return true;
}

function validateModelResult(value) {
  if (!exactKeys(value, MODEL_RESULT_KEYS)) return false;
  if (value.modelVersion !== "near-observed/1" || !["OBSERVED", "NO_DATA"].includes(value.status)) return false;
  if (!isRecord(value.seriesSummaries)) return false;
  if (!validStringArray(value.unknowns, 0, 32, 512)) return false;
  if (!validStringArray(value.counterCase, 1, 16, 1024)) return false;
  if (value.executionReady !== false) return false;
  const assessment = value.investmentAssessment;
  if (!exactKeys(assessment, ["status", "reasons", "proposal"])) return false;
  if (!["NO_DATA", "REVIEW"].includes(assessment.status)
      || !validStringArray(assessment.reasons, 0, 32, 512)
      || assessment.proposal !== null) return false;
  try {
    assertSafeJson(value, MAX_MODEL_RESULT_BYTES, "modelResult");
  } catch {
    return false;
  }
  return true;
}

function validateSnapshot(snapshot, modelResult, sourceRefs, snapshotHash, nowText) {
  assertSafeJson(snapshot, MAX_REQUEST_BYTES, "snapshot");
  assertSafeJson(modelResult, MAX_MODEL_RESULT_BYTES, "modelResult argument");
  assertSafeJson(sourceRefs, MAX_REQUEST_BYTES, "sourceRefs argument");
  if (!exactKeys(snapshot, SNAPSHOT_KEYS)) throw new Error("Snapshot fields do not match the retained case schema.");
  if (snapshot.schemaVersion !== 1 || snapshot.domain !== "near-thesis"
      || snapshot.adapterVersion !== "near-revenue/1"
      || snapshot.sourceUrl !== "https://revenue.near.org/"
      || snapshot.modelVersion !== "near-observed/1") {
    throw new Error("Snapshot identity is unsupported.");
  }
  if (!canonicalTime(snapshot.capturedAt) || Date.parse(snapshot.capturedAt) > Date.parse(nowText)) {
    throw new Error("Snapshot capture time is invalid or in the future.");
  }
  if (!HASH_PATTERN.test(snapshot.rawBodySha256)
      || !Number.isInteger(snapshot.rawBodyBytes)
      || snapshot.rawBodyBytes < 1
      || snapshot.rawBodyBytes > 1024 * 1024) {
    throw new Error("Snapshot raw-source identity is invalid.");
  }
  if (!validateSourceRefs(snapshot.sourceRefs) || !validateSourceRefs(sourceRefs)) {
    throw new Error("Snapshot source references are invalid.");
  }
  if (stableStringify(sourceRefs) !== stableStringify(snapshot.sourceRefs)) {
    throw new Error("Source references do not match the snapshot.");
  }
  if (!validateModelResult(snapshot.modelResult) || !validateModelResult(modelResult)) {
    throw new Error("Deterministic model result is invalid.");
  }
  if (stableStringify(modelResult) !== stableStringify(snapshot.modelResult)) {
    throw new Error("Model result does not match the snapshot.");
  }
  const snapshotCopy = JSON.parse(stableStringify(snapshot));
  if (!HASH_PATTERN.test(snapshotHash) || sha256(canonicalBytes(snapshotCopy)) !== snapshotHash) {
    throw new Error("Snapshot hash does not match the canonical retained snapshot.");
  }
  return freezeDeep(snapshotCopy);
}

function validCitationList(value, sourceRefs) {
  if (!Array.isArray(value) || value.length > MAX_CITATIONS) return false;
  const seen = new Set();
  for (const citation of value) {
    if (!exactKeys(citation, ["revisionId", "sha256", "supports"])) return false;
    if (!UUID_PATTERN.test(citation.revisionId) || !HASH_PATTERN.test(citation.sha256)
        || !boundedString(citation.supports, 1, 512) || seen.has(citation.revisionId)) return false;
    const source = sourceRefs.find(ref => ref.revisionId === citation.revisionId);
    if (!source || source.sha256 !== citation.sha256) return false;
    seen.add(citation.revisionId);
  }
  return true;
}

function validProposal(value) {
  return exactKeys(value, ["summary", "conditions"])
    && boundedString(value.summary, 1, 4096)
    && validStringArray(value.conditions, 1, 16, 512);
}

function validLead(response, request, sourceRefs) {
  if (!exactKeys(response, LEAD_RESPONSE_KEYS)
      || response.schemaVersion !== 1
      || response.role !== "lead"
      || response.runId !== request.runId
      || response.callId !== request.callId
      || response.snapshotHash !== request.snapshotHash
      || !["PROPOSED", "NO_DATA"].includes(response.status)
      || !boundedString(response.thesis, 1, 8192)
      || !boundedString(response.counterCase, 1, 8192)
      || !validCitationList(response.citations, sourceRefs)
      || !validStringArray(response.missingEvidence, 0, MAX_MISSING, 512)
      || response.executionReady !== false) return false;
  if (response.status === "NO_DATA") return response.proposal === null;
  return response.proposal !== null
    && validProposal(response.proposal)
    && response.citations.length >= 1;
}

function validRisk(response, request, sourceRefs, canPass) {
  if (!exactKeys(response, RISK_RESPONSE_KEYS)
      || response.schemaVersion !== 1
      || response.role !== "risk"
      || response.runId !== request.runId
      || response.callId !== request.callId
      || response.snapshotHash !== request.snapshotHash
      || response.proposalHash !== request.proposal.hash
      || !["PASS", "BLOCKED", "NO_DATA"].includes(response.status)
      || !boundedString(response.reason, 1, 4096)
      || !validCitationList(response.citations, sourceRefs)
      || !validStringArray(response.missingEvidence, 0, MAX_MISSING, 512)
      || response.executionReady !== false) return false;
  if (response.status === "PASS") {
    return canPass && response.citations.length >= 1 && response.missingEvidence.length === 0;
  }
  return true;
}

function safeAuditValue(value) {
  try {
    return freezeDeep(cloneSafeJson(value, MAX_REQUEST_BYTES, "review response"));
  } catch {
    return null;
  }
}

function addReason(reasons, value) {
  if (!boundedString(value, 1, 512) || reasons.includes(value)) return;
  if (reasons.length < MAX_REASONS) {
    reasons.push(value);
  } else if (reasons.length === MAX_REASONS && !reasons.includes("Additional validated reasons were omitted at the response limit.")) {
    reasons[MAX_REASONS - 1] = "Additional validated reasons were omitted at the response limit.";
  }
}

function result(runId, snapshotHash, lead, risk, status, proposal, reasons) {
  return freezeDeep({
    schemaVersion: 1,
    runId,
    snapshotHash,
    lead,
    risk,
    status,
    proposal,
    reasons,
    executionReady: false,
  });
}

function noData(runId, snapshotHash, reason, lead = null, risk = null, reasons = []) {
  const safeReasons = [];
  for (const item of reasons) addReason(safeReasons, item);
  addReason(safeReasons, reason);
  if (safeReasons.length === 0) safeReasons.push("Review could not produce a verified result.");
  return result(
    UUID_PATTERN.test(runId) ? runId : null,
    HASH_PATTERN.test(snapshotHash) ? snapshotHash : null,
    lead,
    risk,
    "NO_DATA",
    null,
    safeReasons,
  );
}

function validatePreflight(value, nowText) {
  try {
    assertSafeJson(value, MAX_REQUEST_BYTES, "preflight result");
  } catch {
    return false;
  }
  if (!exactKeys(value, PREFLIGHT_KEYS)
      || !["VERIFIED", "NO_DATA"].includes(value.status)
      || value.policyVersion !== COUNCIL_POLICY_VERSION
      || value.requestedModel !== COUNCIL_MODEL
      || value.requestedReasoningEffort !== COUNCIL_REASONING_EFFORT
      || !(value.executableVersion === null || boundedString(value.executableVersion, 1, 128))
      || !canonicalTime(value.checkedAt)
      || Date.parse(value.checkedAt) > Date.parse(nowText)
      || !(value.policyHash === null || HASH_PATTERN.test(value.policyHash))
      || !exactKeys(value.verifiedControls, CONTROL_KEYS)
      || CONTROL_KEYS.some(key => typeof value.verifiedControls[key] !== "boolean")
      || !validStringArray(value.reasons, 0, MAX_REASONS, 512)) return false;
  const allControls = CONTROL_KEYS.every(key => value.verifiedControls[key]);
  if (value.status === "VERIFIED") {
    return allControls && value.policyHash !== null && value.executableVersion === "0.160.0" && value.reasons.length === 0;
  }
  return value.reasons.length > 0 || !allControls;
}

function createRequestBase(runId, callId, snapshotHash, snapshot) {
  return {
    schemaVersion: 1,
    runId,
    callId,
    snapshotHash,
    snapshot,
    modelResult: snapshot.modelResult,
    sourceRefs: snapshot.sourceRefs,
  };
}

export async function runCouncilReview({
  runId,
  snapshotHash,
  snapshot,
  modelResult,
  sourceRefs,
  transport,
  now = () => new Date().toISOString(),
} = {}) {
  let nowText;
  try {
    nowText = now();
  } catch {
    return noData(runId, snapshotHash, "Review clock is unavailable.");
  }
  if (!canonicalTime(nowText)) return noData(runId, snapshotHash, "Review clock did not return a canonical UTC time.");

  let frozenSnapshot;
  try {
    if (!UUID_PATTERN.test(runId)) throw new Error("Run identity is invalid.");
    frozenSnapshot = validateSnapshot(snapshot, modelResult, sourceRefs, snapshotHash, nowText);
  } catch (error) {
    const reason = error instanceof Error ? error.message : "Review input is invalid.";
    return noData(runId, snapshotHash, reason);
  }
  if (!transport || typeof transport.preflight !== "function" || typeof transport.call !== "function") {
    return noData(runId, snapshotHash, "A trusted review transport is unavailable.");
  }

  let preflight;
  try {
    preflight = await transport.preflight();
  } catch {
    return noData(runId, snapshotHash, "Review host preflight failed.");
  }
  try {
    nowText = now();
  } catch {
    return noData(runId, snapshotHash, "Review clock became unavailable during host preflight.");
  }
  if (!canonicalTime(nowText)) return noData(runId, snapshotHash, "Review clock did not return a canonical UTC time.");
  if (!validatePreflight(preflight, nowText)) {
    return noData(runId, snapshotHash, "Review host preflight was missing, malformed, stale-dated, or unverified.");
  }
  if (preflight.status !== "VERIFIED") {
    return noData(runId, snapshotHash, "Review host controls are not verified.", null, null, preflight.reasons);
  }

  const reasons = [];
  const modelGate = frozenSnapshot.modelResult;
  const assessment = modelGate.investmentAssessment;
  if (modelGate.status !== "OBSERVED") addReason(reasons, "Deterministic model status is NO_DATA.");
  if (assessment.status !== "REVIEW") {
    if (assessment.reasons.length) assessment.reasons.forEach(reason => addReason(reasons, reason));
    else addReason(reasons, "Investment assessment is NO_DATA.");
  }

  let leadRequest = freezeDeep({
    ...createRequestBase(runId, randomUUID(), snapshotHash, frozenSnapshot),
    role: "lead",
  });
  try {
    if (canonicalBytes(leadRequest).byteLength > MAX_REQUEST_BYTES) {
      return noData(runId, snapshotHash, "Lead request exceeds the 64 KiB review packet limit.");
    }
  } catch {
    return noData(runId, snapshotHash, "Lead request cannot be serialized safely.");
  }

  let leadRaw = null;
  let leadAccepted = false;
  try {
    leadRaw = await transport.call(leadRequest);
    const candidate = safeAuditValue(leadRaw);
    leadRaw = candidate;
    leadAccepted = candidate !== null && validLead(candidate, leadRequest, frozenSnapshot.sourceRefs);
  } catch {
    leadRaw = null;
  }
  if (!leadAccepted) addReason(reasons, "Lead review failed validation or did not bind to this run and snapshot.");

  const proposalValue = leadAccepted && leadRaw.status === "PROPOSED" ? leadRaw.proposal : null;
  const proposalBinding = proposalValue === null
    ? { hash: null, value: null }
    : { hash: sha256(canonicalBytes(proposalValue)), value: proposalValue };
  const riskRequest = freezeDeep({
    ...createRequestBase(runId, randomUUID(), snapshotHash, frozenSnapshot),
    role: "risk",
    proposal: proposalBinding,
  });
  if (riskRequest.callId === leadRequest.callId) {
    return noData(runId, snapshotHash, "Lead and Risk call identities were not distinct.", leadRaw, null, reasons);
  }
  try {
    if (canonicalBytes(riskRequest).byteLength > MAX_REQUEST_BYTES) {
      return noData(runId, snapshotHash, "Risk request exceeds the 64 KiB review packet limit.", leadRaw, null, reasons);
    }
  } catch {
    return noData(runId, snapshotHash, "Risk request cannot be serialized safely.", leadRaw, null, reasons);
  }

  const canPass = leadAccepted
    && leadRaw.status === "PROPOSED"
    && leadRaw.missingEvidence.length === 0
    && assessment.status === "REVIEW"
    && modelGate.status === "OBSERVED"
    && proposalValue !== null;
  let riskRaw = null;
  let riskAccepted = false;
  try {
    riskRaw = await transport.call(riskRequest);
    const candidate = safeAuditValue(riskRaw);
    riskRaw = candidate;
    riskAccepted = candidate !== null && validRisk(candidate, riskRequest, frozenSnapshot.sourceRefs, canPass);
  } catch {
    riskRaw = null;
  }
  if (!riskAccepted) addReason(reasons, "Risk review failed validation or did not bind to this proposal, run, and snapshot.");

  if (riskAccepted && riskRaw.status === "BLOCKED") {
    addReason(reasons, riskRaw.reason);
    riskRaw.missingEvidence.forEach(reason => addReason(reasons, reason));
    return result(runId, snapshotHash, leadRaw, riskRaw, "BLOCKED", null, reasons);
  }

  if (leadAccepted && leadRaw.status === "NO_DATA") {
    leadRaw.missingEvidence.forEach(reason => addReason(reasons, reason));
  } else if (leadAccepted && leadRaw.missingEvidence.length) {
    leadRaw.missingEvidence.forEach(reason => addReason(reasons, reason));
    addReason(reasons, "Lead proposal has critical missing evidence.");
  }
  if (riskAccepted && riskRaw.status === "NO_DATA") {
    addReason(reasons, riskRaw.reason);
    riskRaw.missingEvidence.forEach(reason => addReason(reasons, reason));
  }

  const approvedForResearch = leadAccepted
    && leadRaw.status === "PROPOSED"
    && leadRaw.missingEvidence.length === 0
    && riskAccepted
    && riskRaw.status === "PASS"
    && riskRaw.missingEvidence.length === 0
    && assessment.status === "REVIEW"
    && modelGate.status === "OBSERVED";
  if (!approvedForResearch) {
    if (reasons.length === 0) addReason(reasons, "Research review did not produce a complete Lead proposal and independent Risk pass.");
    return result(runId, snapshotHash, leadRaw, riskRaw, "NO_DATA", null, reasons);
  }
  return result(runId, snapshotHash, leadRaw, riskRaw, "REVIEW", leadRaw.proposal, []);
}
