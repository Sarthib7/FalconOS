import { randomUUID } from 'node:crypto';
import { MeshError } from '../domain.mjs';
import { canonicalBytes, freezeDeep, sha256, stableStringify } from '../council/evidence.ts';
import { NEAR_REVENUE_ADAPTER_VERSION, NEAR_REVENUE_SOURCE_URL, decodeNearEvidence, inspectNearPacket, captureNearEvidence } from './near-source.mjs';
import { NEAR_MODEL_VERSION, evaluateNearModel } from './near-model.mjs';

const SOURCE_CODES = new Set([
  'INVALID_PACKET', 'PACKET_SCHEMA', 'PACKET_LIMIT', 'PACKET_PARTS', 'PART_HASH_MISMATCH',
  'RAW_HASH_MISMATCH', 'RAW_SIZE_MISMATCH', 'GZIP_INVALID', 'BODY_TOO_LARGE', 'BODY_READ_FAILED',
  'HTTP_STATUS', 'FETCH_TIMEOUT', 'FETCH_FAILED', 'CAPTURE_TIME_INVALID', 'SOURCE_ENCODING_INVALID',
  'SOURCE_SCHEMA_DRIFT', 'SOURCE_PAYLOAD_MISSING', 'SOURCE_PAYLOAD_AMBIGUOUS', 'SOURCE_PARSE_FAILED',
]);
const PACKET_KEYS = [
  'schemaVersion', 'adapterVersion', 'sourceKey', 'sourceUrl', 'capturedAt',
  'rawBodySha256', 'rawBodyBytes', 'codec', 'compressedBytes', 'parts',
];
const PART_KEYS = ['index', 'totalParts', 'sha256', 'dataBase64'];
const PART_ENVELOPE_KEYS = [...PACKET_KEYS.filter(key => key !== 'parts'), 'parts'];
const CASE_KEYS = [
  'schemaVersion', 'caseType', 'caseId', 'requestId', 'createdAt', 'status', 'snapshot',
  'snapshotHash', 'modelResult', 'sourceRefs', 'manifestRevisionId', 'issues', 'executionReady',
];

function invalid(message) {
  throw new MeshError('INVALID_INPUT', message);
}

function exactObject(value, keys) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    && [Object.prototype, null].includes(Object.getPrototypeOf(value))
    && Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));
}

function canonicalTime(value) {
  return typeof value === 'string' && Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value;
}

function uuid(value) {
  if (typeof value !== 'string' || !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(value)) {
    invalid('Record ID must be a UUID.');
  }
  return value.toLowerCase();
}

function safeCode(error, fallback = 'UNAVAILABLE') {
  return typeof error?.code === 'string' && /^[A-Z0-9_]{1,48}$/.test(error.code) ? error.code : fallback;
}

function failureKind(stage, error) {
  if (stage === 'source' || SOURCE_CODES.has(error?.code)) return 'source';
  if (stage === 'model') return 'model';
  return 'capture';
}

function issueFor(stage, error) {
  return failureKind(stage, error) + ':' + safeCode(error, stage === 'model' ? 'MODEL_UNAVAILABLE' : 'UNAVAILABLE');
}

function packetCommon(packet) {
  return {
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
}

function sourceRefsFor(packet) {
  const common = packetCommon(packet);
  return packet.parts.map(part => {
    const envelope = stableStringify({ ...common, parts: [part] });
    return {
      revisionId: randomUUID(),
      sha256: sha256(new TextEncoder().encode(envelope)),
    };
  });
}

function snapshotFor(decoded, modelResult, sourceRefs) {
  return {
    schemaVersion: 1,
    domain: 'near-thesis',
    adapterVersion: NEAR_REVENUE_ADAPTER_VERSION,
    sourceUrl: NEAR_REVENUE_SOURCE_URL,
    capturedAt: decoded.capturedAt,
    rawBodySha256: decoded.rawBodySha256,
    rawBodyBytes: decoded.rawBodyBytes,
    sourceRefs,
    modelVersion: NEAR_MODEL_VERSION,
    modelResult,
  };
}

function assertCaseEnvelope(value) {
  const uuidPattern = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
  if (!exactObject(value, CASE_KEYS) || value.schemaVersion !== 1 || value.caseType !== 'near-thesis'
    || !uuidPattern.test(value.caseId) || !uuidPattern.test(value.requestId) || !uuidPattern.test(value.manifestRevisionId)
    || !['OBSERVED', 'NO_DATA'].includes(value.status) || value.executionReady !== false
    || !Array.isArray(value.sourceRefs) || value.sourceRefs.length > 3 || !Array.isArray(value.issues)) {
    throw new MeshError('STORAGE_UNAVAILABLE', 'Retained research case is invalid.');
  }
  if (!canonicalTime(value.createdAt) || (value.snapshotHash !== null && !/^[a-f0-9]{64}$/.test(value.snapshotHash))
    || value.issues.length > 32 || value.issues.some(issue => typeof issue !== 'string' || issue.length > 512)) {
    throw new MeshError('STORAGE_UNAVAILABLE', 'Retained research case is invalid.');
  }
  for (const ref of value.sourceRefs) {
    if (!exactObject(ref, ['revisionId', 'sha256']) || !uuidPattern.test(ref.revisionId)
      || !/^[a-f0-9]{64}$/.test(ref.sha256)) {
      throw new MeshError('STORAGE_UNAVAILABLE', 'Retained research case source references are invalid.');
    }
  }
  if (new Set(value.sourceRefs.map(ref => ref.revisionId.toLowerCase())).size !== value.sourceRefs.length) {
    throw new MeshError('STORAGE_UNAVAILABLE', 'Retained research case source references are duplicated.');
  }
  if (value.snapshot === null) {
    if (value.status !== 'NO_DATA' || value.snapshotHash !== null || value.modelResult !== null) {
      throw new MeshError('STORAGE_UNAVAILABLE', 'Retained NO_DATA case contains an invalid snapshot.');
    }
    return value;
  }
  const snapshotKeys = [
    'schemaVersion', 'domain', 'adapterVersion', 'sourceUrl', 'capturedAt', 'rawBodySha256',
    'rawBodyBytes', 'sourceRefs', 'modelVersion', 'modelResult',
  ];
  if (!value.sourceRefs.length || !exactObject(value.snapshot, snapshotKeys)
    || !exactObject(value.modelResult, Object.keys(value.modelResult ?? {}))
    || value.snapshot.schemaVersion !== 1 || value.snapshot.domain !== 'near-thesis'
    || value.snapshot.adapterVersion !== NEAR_REVENUE_ADAPTER_VERSION || value.snapshot.sourceUrl !== NEAR_REVENUE_SOURCE_URL
    || !canonicalTime(value.snapshot.capturedAt) || !/^[a-f0-9]{64}$/.test(value.snapshot.rawBodySha256)
    || !Number.isSafeInteger(value.snapshot.rawBodyBytes) || value.snapshot.rawBodyBytes < 1 || value.snapshot.rawBodyBytes > 1024 * 1024
    || value.snapshot.modelVersion !== NEAR_MODEL_VERSION || value.modelResult.executionReady !== false
    || !['OBSERVED', 'NO_DATA'].includes(value.modelResult.status) || value.status !== value.modelResult.status
    || stableStringify(value.snapshot.sourceRefs) !== stableStringify(value.sourceRefs)
    || stableStringify(value.snapshot.modelResult) !== stableStringify(value.modelResult)
    || value.snapshotHash !== sha256(canonicalBytes(value.snapshot))) {
    throw new MeshError('STORAGE_UNAVAILABLE', 'Retained research snapshot failed integrity verification.');
  }
  return value;
}

async function reconstructPacket(value, store) {
  if (value.sourceRefs.length === 0 || value.sourceRefs.length > 3) return null;
  let fields = null;
  const parts = [];
  for (let index = 0; index < value.sourceRefs.length; index += 1) {
    const ref = value.sourceRefs[index];
    const row = await store.getPublicResearchSource(ref.revisionId);
    if (!row || row.sourceKey !== 'research:near:packet:' + value.caseId + ':' + index
      || row.sourceUrl !== NEAR_REVENUE_SOURCE_URL || row.sha256 !== ref.sha256
      || typeof row.content !== 'string' || Buffer.byteLength(row.content, 'utf8') >= 128 * 1024
      || sha256(new TextEncoder().encode(row.content)) !== ref.sha256) {
      throw new MeshError('STORAGE_UNAVAILABLE', 'Retained public research source reference is missing or corrupt.');
    }
    let envelope;
    try { envelope = JSON.parse(row.content); }
    catch { throw new MeshError('STORAGE_UNAVAILABLE', 'Retained public research source envelope is invalid.'); }
    if (!exactObject(envelope, PART_ENVELOPE_KEYS) || !Array.isArray(envelope.parts) || envelope.parts.length !== 1
      || !exactObject(envelope.parts[0], PART_KEYS) || envelope.parts[0].index !== index
      || envelope.parts[0].totalParts !== value.sourceRefs.length) {
      throw new MeshError('STORAGE_UNAVAILABLE', 'Retained public research source part is invalid.');
    }
    const { parts: ignored, ...partFields } = envelope;
    if (fields === null) fields = partFields;
    else if (stableStringify(fields) !== stableStringify(partFields)) {
      throw new MeshError('STORAGE_UNAVAILABLE', 'Retained public research source parts do not form one packet.');
    }
    parts.push(envelope.parts[0]);
  }
  const packet = { ...fields, parts };
  if (packet.sourceKey !== 'near-revenue' || packet.sourceUrl !== NEAR_REVENUE_SOURCE_URL
    || packet.adapterVersion !== NEAR_REVENUE_ADAPTER_VERSION) {
    throw new MeshError('STORAGE_UNAVAILABLE', 'Retained public research packet identity is invalid.');
  }
  try { inspectNearPacket(packet); }
  catch { throw new MeshError('STORAGE_UNAVAILABLE', 'Retained public research packet failed integrity verification.'); }
  return packet;
}

export function createResearchService({
  store,
  capture = captureNearEvidence,
  now = () => new Date().toISOString(),
  captureTtlMs = 24 * 60 * 60 * 1000,
  failureTtlMs = 60 * 1000,
} = {}) {
  if (!store || typeof store.getPublicResearchBundle !== 'function'
    || typeof store.getPublicResearchCase !== 'function' || typeof store.getPublicResearchSource !== 'function'
    || typeof store.publishPublicResearchCase !== 'function' || typeof store.adoptResearchCase !== 'function'
    || typeof capture !== 'function' || typeof now !== 'function'
    || !Number.isFinite(captureTtlMs) || captureTtlMs < 0 || !Number.isFinite(failureTtlMs) || failureTtlMs < 0) {
    invalid('Research service configuration is invalid.');
  }

  let inFlight = null;
  let cached = null;

  function currentTime() {
    const value = now();
    if (!canonicalTime(value)) invalid('Research service clock must return canonical UTC time.');
    return value;
  }

  function fresh(bundle, at) {
    if (!bundle?.case) return false;
    const ttl = bundle.case.status === 'NO_DATA' ? failureTtlMs : captureTtlMs;
    const age = Date.parse(at) - Date.parse(bundle.case.createdAt);
    return age >= 0 && age <= ttl;
  }

  async function publish(caseValue, packet, expectedManifestRevisionId) {
    try {
      const result = await store.publishPublicResearchCase({ case: caseValue, packet, expectedManifestRevisionId });
      cached = { manifestRevisionId: result.manifestRevisionId, case: result.case };
      return result.case;
    } catch (error) {
      if (!(error instanceof MeshError) || error.code !== 'CONFLICT') throw error;
      const winner = await store.getPublicResearchBundle();
      if (!winner) throw error;
      cached = winner;
      return winner.case;
    }
  }

  async function refresh(expectedBundle) {
    const expectedManifestRevisionId = expectedBundle?.manifestRevisionId ?? null;
    const caseId = randomUUID();
    const requestId = randomUUID();
    const manifestRevisionId = randomUUID();
    let packet = null;
    let decoded = null;
    let modelResult = null;
    let failure = null;
    let stage = 'capture';

    try {
      packet = await capture({ now });
    } catch (error) {
      failure = error;
      packet = error?.packet ?? null;
    }
    if (!failure) {
      stage = 'source';
      try { decoded = decodeNearEvidence(packet); }
      catch (error) { failure = error; packet = error?.packet ?? packet; }
    }
    if (!failure) {
      stage = 'model';
      try { modelResult = evaluateNearModel(decoded); }
      catch (error) { failure = error; }
    }

    let retainedPacket = null;
    if (failure && packet && (stage !== 'capture' || SOURCE_CODES.has(failure.code))) {
      try {
        inspectNearPacket(packet);
        retainedPacket = packet;
      } catch { retainedPacket = null; }
    }
    const createdAt = currentTime();
    const sourceRefs = retainedPacket ? sourceRefsFor(retainedPacket) : [];
    if (failure) {
      const caseValue = {
        schemaVersion: 1,
        caseType: 'near-thesis',
        caseId,
        requestId,
        createdAt,
        status: 'NO_DATA',
        snapshot: null,
        snapshotHash: null,
        modelResult: null,
        sourceRefs,
        manifestRevisionId,
        issues: [issueFor(stage, failure)],
        executionReady: false,
      };
      return publish(caseValue, retainedPacket, expectedManifestRevisionId);
    }

    if (!packet || !decoded || !modelResult) throw new MeshError('STORAGE_UNAVAILABLE', 'NEAR source capture did not produce a model result.');
    const refs = sourceRefsFor(packet);
    const snapshot = snapshotFor(decoded, modelResult, refs);
    const snapshotHash = sha256(canonicalBytes(snapshot));
    const caseValue = {
      schemaVersion: 1,
      caseType: 'near-thesis',
      caseId,
      requestId,
      createdAt,
      status: modelResult.status,
      snapshot,
      snapshotHash,
      modelResult,
      sourceRefs: refs,
      manifestRevisionId,
      issues: decoded.issues,
      executionReady: false,
    };
    return publish(caseValue, packet, expectedManifestRevisionId);
  }

  async function getPublicCase(caseId) {
    if (caseId !== undefined) {
      const retained = await store.getPublicResearchCase(uuid(caseId));
      return retained ? freezeDeep(assertCaseEnvelope(retained)) : null;
    }
    const at = currentTime();
    const current = await store.getPublicResearchBundle();
    if (fresh(current, at)) {
      if (cached?.manifestRevisionId === current.manifestRevisionId) return freezeDeep(assertCaseEnvelope(cached.case));
      cached = current;
      return freezeDeep(assertCaseEnvelope(current.case));
    }
    if (!inFlight) inFlight = refresh(current).finally(() => { inFlight = null; });
    const retained = await inFlight;
    return freezeDeep(assertCaseEnvelope(retained));
  }

  async function getPublicSource(revisionId) {
    const result = await store.getPublicResearchSource(uuid(revisionId));
    return result ? freezeDeep(result) : null;
  }

  async function replayPublicCase(input) {
    if (!exactObject(input, ['caseId'])) invalid('Replay request must contain exactly caseId.');
    const retained = await getPublicCase(uuid(input.caseId));
    if (!retained) throw new MeshError('NOT_FOUND', 'Public research case was not found.');
    if (retained.snapshot === null) {
      if (retained.sourceRefs.length === 0) return retained;
      const packet = await reconstructPacket(retained, store);
      let stage = 'source';
      try {
        const decoded = decodeNearEvidence(packet);
        stage = 'model';
        evaluateNearModel(decoded);
      } catch (error) {
        if (retained.issues.length !== 1 || retained.issues[0] !== issueFor(stage, error)) {
          throw new MeshError('STORAGE_UNAVAILABLE', 'Retained NO_DATA case does not replay to its recorded failure.');
        }
        return retained;
      }
      throw new MeshError('STORAGE_UNAVAILABLE', 'Retained NO_DATA case replays as a successful model result.');
    }

    const packet = await reconstructPacket(retained, store);
    if (!packet) throw new MeshError('STORAGE_UNAVAILABLE', 'Retained research snapshot has no raw source packet.');
    let decoded;
    let modelResult;
    try {
      decoded = decodeNearEvidence(packet);
      modelResult = evaluateNearModel(decoded);
    } catch {
      throw new MeshError('STORAGE_UNAVAILABLE', 'Retained research source no longer replays successfully.');
    }
    const snapshot = snapshotFor(decoded, modelResult, retained.sourceRefs);
    const snapshotHash = sha256(canonicalBytes(snapshot));
    if (snapshotHash !== retained.snapshotHash || stableStringify(snapshot) !== stableStringify(retained.snapshot)
      || stableStringify(modelResult) !== stableStringify(retained.modelResult)) {
      throw new MeshError('STORAGE_UNAVAILABLE', 'Retained research snapshot differs from deterministic replay.');
    }
    return retained;
  }

  async function adoptCase(owner, input) {
    if (!exactObject(input, ['requestId', 'publicCaseId'])) invalid('Adoption request must contain exactly requestId and publicCaseId.');
    const requestId = uuid(input.requestId);
    const publicCaseId = uuid(input.publicCaseId);
    return freezeDeep(await store.adoptResearchCase(owner, { requestId, publicCaseId }, currentTime()));
  }

  return Object.freeze({ getPublicCase, getPublicSource, replayPublicCase, adoptCase });
}
