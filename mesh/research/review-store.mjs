import { createHash, randomUUID } from 'node:crypto';
import { MeshError } from '../domain.mjs';
import { PUBLIC_OWNER_ID } from '../public-graph.mjs';
import { canonicalBytes, sha256, stableStringify } from '../council/evidence.ts';

const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const HASH = /^[a-f0-9]{64}$/;
const ADOPTED_KIND = 'near-research/adopted/1';
const CLAIM_KIND = 'near-research/review/claim/1';
const PHASE_KIND = 'near-research/review/phase/1';
const TERMINAL_KIND = 'near-research/review/terminal/1';
const CLAIM_OBSERVATION = 'near-research/review';
const MAX_RUN_DEADLINE_MS = 10 * 60 * 1000;
const MAX_SNAPSHOT_BYTES = 192 * 1024;
const MAX_RESULT_BYTES = 64 * 1024;
const PHASE_INDEX = { PREFLIGHT: 0, LEAD: 1, RISK: 2 };
const PHASES = new Set(Object.keys(PHASE_INDEX));

function fail(code, message) { throw new MeshError(code, message); }
function invalid(message) { fail('INVALID_INPUT', message); }
function conflict(message = 'Review request conflicts with an existing owner record.') { fail('CONFLICT', message); }
function ownerId(owner) {
  if (typeof owner !== 'string' || owner === PUBLIC_OWNER_ID || !/^[a-z0-9_-]{1,64}$/.test(owner)) invalid('Owner is invalid.');
  return owner;
}
function uuid(value, name) {
  if (typeof value !== 'string' || !UUID.test(value)) invalid(name + ' must be a UUID.');
  return value.toLowerCase();
}
function exactKeys(value, expected, name) {
  if (!value || typeof value !== 'object' || Array.isArray(value)
      || Object.keys(value).length !== expected.length || expected.some(key => !Object.hasOwn(value, key))
      || Object.keys(value).some(key => !expected.includes(key))) invalid(name + ' fields do not match the schema.');
}
function canonicalTime(value, name) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)
      || !Number.isFinite(Date.parse(value)) || new Date(Date.parse(value)).toISOString() !== value) {
    invalid(name + ' must be a canonical UTC timestamp.');
  }
  return Date.parse(value);
}
function currentTime(now) {
  let value;
  try { value = now(); } catch { fail('STORAGE_UNAVAILABLE', 'Review storage clock is unavailable.'); }
  canonicalTime(value, 'Review storage clock');
  return value;
}
function deadlineDuration(value) {
  if (!Number.isSafeInteger(value) || value < 1 || value > MAX_RUN_DEADLINE_MS) {
    invalid('Review run deadline must be a positive bounded number of milliseconds.');
  }
  return value;
}
function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    && [Object.prototype, null].includes(Object.getPrototypeOf(value));
}
function jsonBytes(value, maxBytes, label) {
  let encoded;
  try { encoded = JSON.stringify(value); } catch { fail('STORAGE_UNAVAILABLE', label + ' is not valid JSON.'); }
  if (typeof encoded !== 'string' || Buffer.byteLength(encoded, 'utf8') > maxBytes) {
    fail('TOO_LARGE', label + ' exceeds its storage limit.');
  }
  return encoded;
}
function deterministicUuid(jobId, purpose) {
  const bytes = createHash('sha256').update('falcon_mesh:near-research:review:' + jobId + ':' + purpose, 'utf8').digest().subarray(0, 16);
  bytes[6] = (bytes[6] & 0x0f) | 0x50;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = bytes.toString('hex');
  return hex.slice(0, 8) + '-' + hex.slice(8, 12) + '-' + hex.slice(12, 16) + '-' + hex.slice(16, 20) + '-' + hex.slice(20);
}
function stableEqual(left, right) {
  try { return stableStringify(left) === stableStringify(right); } catch { return false; }
}
function validateRefs(refs) {
  if (!Array.isArray(refs) || refs.length < 1 || refs.length > 3) return false;
  const seen = new Set();
  return refs.every(ref => {
    if (!isRecord(ref) || Object.keys(ref).length !== 2 || !Object.hasOwn(ref, 'revisionId') || !Object.hasOwn(ref, 'sha256')
        || typeof ref.revisionId !== 'string' || !UUID.test(ref.revisionId) || typeof ref.sha256 !== 'string' || !HASH.test(ref.sha256)) return false;
    const id = ref.revisionId.toLowerCase();
    if (seen.has(id)) return false;
    seen.add(id);
    return true;
  });
}
function verifyAdopted(row) {
  const { graph, analysis } = row;
  if (!isRecord(graph) || !isRecord(analysis) || analysis.recordKind !== ADOPTED_KIND
      || graph.schemaVersion !== 1 || graph.domain !== 'near-thesis' || graph.caseType !== 'near-thesis'
      || graph.executionReady !== false || analysis.executionReady !== false) {
    fail('STORAGE_UNAVAILABLE', 'Retained adopted research record is invalid.');
  }
  const snapshot = graph.snapshot;
  const sourceRefs = graph.sourceRefs;
  const snapshotHash = graph.snapshotHash;
  if (!isRecord(snapshot) || !validateRefs(sourceRefs) || !HASH.test(snapshotHash ?? '')
      || snapshotHash !== analysis.snapshotHash || snapshotHash !== sha256(canonicalBytes(snapshot))
      || !stableEqual(snapshot, analysis.snapshot) || !stableEqual(snapshot.sourceRefs, sourceRefs)
      || !stableEqual(analysis.sourceRefs, sourceRefs) || !stableEqual(analysis.modelResult, snapshot.modelResult)
      || snapshot.schemaVersion !== 1 || snapshot.domain !== 'near-thesis' || snapshot.modelVersion !== 'near-observed/1'
      || !isRecord(snapshot.modelResult) || !validateRefs(snapshot.sourceRefs)) {
    fail('STORAGE_UNAVAILABLE', 'Retained adopted research snapshot binding is invalid.');
  }
  jsonBytes(snapshot, MAX_SNAPSHOT_BYTES, 'Retained review snapshot');
  return { analysisId: row.id, snapshot, snapshotHash, sourceRefs, modelResult: snapshot.modelResult };
}
function validateControllerResult(value, claim) {
  const keys = ['schemaVersion', 'runId', 'snapshotHash', 'lead', 'risk', 'status', 'proposal', 'reasons', 'executionReady'];
  if (!isRecord(value) || Object.keys(value).length !== keys.length || keys.some(key => !Object.hasOwn(value, key))
      || value.schemaVersion !== 1 || value.runId !== claim.id || value.snapshotHash !== claim.analysis.snapshotHash
      || !['REVIEW', 'BLOCKED', 'NO_DATA'].includes(value.status) || value.executionReady !== false
      || !Array.isArray(value.reasons) || value.reasons.length > 32
      || value.reasons.some(reason => typeof reason !== 'string' || Buffer.byteLength(reason, 'utf8') > 512)
      || (value.status !== 'REVIEW' && value.proposal !== null)
      || (value.status === 'REVIEW' && (!isRecord(value.proposal) || value.risk?.status === 'BLOCKED'))) {
    invalid('Controller review result does not match the retained job.');
  }
  const encoded = jsonBytes(value, MAX_RESULT_BYTES, 'Controller review result');
  return JSON.parse(encoded);
}
function noDataResult(claim) {
  return {
    schemaVersion: 1,
    runId: claim.id,
    snapshotHash: claim.analysis.snapshotHash,
    lead: null,
    risk: null,
    status: 'NO_DATA',
    proposal: null,
    reasons: ['Review did not produce a verified result before its deadline.'],
    executionReady: false,
  };
}
function envelope(claim, state, phase, result) {
  return {
    schemaVersion: 1,
    jobId: claim.id,
    requestId: claim.request_id,
    analysisId: claim.analysis.analysisId,
    snapshotHash: claim.analysis.snapshotHash,
    state,
    phase,
    result,
    executionReady: false,
  };
}
function assertClaim(row) {
  const analysis = row?.analysis;
  if (!row || !isRecord(analysis) || analysis.recordKind !== CLAIM_KIND
      || analysis.schemaVersion !== 1 || analysis.jobId !== row.id
      || analysis.requestId !== row.request_id || typeof analysis.analysisId !== 'string' || !UUID.test(analysis.analysisId)
      || !HASH.test(analysis.snapshotHash ?? '') || analysis.snapshotReference?.analysisId !== analysis.analysisId
      || analysis.snapshotReference?.snapshotHash !== analysis.snapshotHash
      || analysis.terminalRequestId !== deterministicUuid(row.id, 'terminal')) {
    fail('STORAGE_UNAVAILABLE', 'Retained review claim is invalid.');
  }
  canonicalTime(analysis.deadlineAt, 'Stored review deadline');
  return row;
}

export function createReviewJobStore(pool, { now = () => new Date().toISOString() } = {}) {
  if (!pool || typeof pool.connect !== 'function') throw new TypeError('Review job store requires a PostgreSQL pool.');

  async function transaction(owner, work) {
    const lock = createHash('sha256').update('falcon_mesh:' + owner, 'utf8').digest().readBigInt64BE().toString();
    for (let attempt = 0; attempt < 3; attempt += 1) {
      let client;
      try { client = await pool.connect(); }
      catch { throw new MeshError('STORAGE_UNAVAILABLE', 'Mesh storage could not complete the review request.'); }
      let releaseError;
      try {
        await client.query('BEGIN');
        await client.query('SELECT pg_advisory_xact_lock($1::bigint)', [lock]);
        const value = await work(client);
        await client.query('COMMIT');
        return value;
      } catch (error) {
        try { await client.query('ROLLBACK'); } catch (rollbackError) { releaseError = rollbackError; }
        if (!releaseError && ['40001', '40P01'].includes(error?.code) && attempt < 2) continue;
        if (error instanceof MeshError) throw error;
        throw new MeshError('STORAGE_UNAVAILABLE', 'Mesh storage could not complete the review request.');
      } finally {
        client.release(releaseError);
      }
    }
    throw new MeshError('STORAGE_UNAVAILABLE', 'Mesh storage could not complete the review request.');
  }

  async function loadAdopted(client, owner, analysisId) {
    const result = await client.query(
      "SELECT id, graph, analysis FROM falcon_mesh.analyses WHERE owner_id = $1 AND id = $2 AND analysis->>'recordKind' = $3 LIMIT 1",
      [owner, analysisId, ADOPTED_KIND],
    );
    if (!result.rows.length) fail('NOT_FOUND', 'Adopted research analysis was not found.');
    const row = result.rows[0];
    if (row.id !== analysisId) fail('STORAGE_UNAVAILABLE', 'Retained adopted research identity is invalid.');
    return verifyAdopted(row);
  }

  async function claimForRequest(client, owner, requestId) {
    const result = await client.query(
      'SELECT id, request_id, created_at, analysis FROM falcon_mesh.analyses WHERE owner_id = $1 AND request_id = $2 LIMIT 1',
      [owner, requestId],
    );
    return result.rows[0] ?? null;
  }

  async function claimById(client, owner, jobId) {
    const result = await client.query(
      "SELECT id, request_id, created_at, analysis FROM falcon_mesh.analyses WHERE owner_id = $1 AND id = $2 AND analysis->>'recordKind' = $3 LIMIT 1",
      [owner, jobId, CLAIM_KIND],
    );
    return result.rows[0] ? assertClaim(result.rows[0]) : null;
  }

  async function terminalForClaim(client, owner, claim) {
    const result = await client.query(
      'SELECT id, request_id, created_at, analysis FROM falcon_mesh.analyses WHERE owner_id = $1 AND request_id = $2 LIMIT 1',
      [owner, claim.analysis.terminalRequestId],
    );
    const row = result.rows[0];
    if (!row) return null;
    const terminal = row.analysis;
    if (!isRecord(terminal) || terminal.recordKind !== TERMINAL_KIND || terminal.jobId !== claim.id
        || terminal.analysisId !== claim.analysis.analysisId || terminal.snapshotHash !== claim.analysis.snapshotHash
        || terminal.requestId !== claim.request_id || terminal.phase !== 'TERMINAL'
        || !['COMPLETE', 'UNKNOWN'].includes(terminal.state)) {
      fail('STORAGE_UNAVAILABLE', 'Retained review terminal record conflicts with its claim.');
    }
    const resultValue = validateControllerResult(terminal.result, claim);
    if (terminal.state === 'UNKNOWN' && (resultValue.status !== 'NO_DATA' || resultValue.proposal !== null)) {
      fail('STORAGE_UNAVAILABLE', 'Retained unknown review result is invalid.');
    }
    return envelope(claim, terminal.state, 'TERMINAL', resultValue);
  }

  async function phaseForClaim(client, owner, claim) {
    const result = await client.query(
      'SELECT analysis FROM falcon_mesh.analyses '
        + 'WHERE owner_id = $1 AND analysis->>\'recordKind\' = $2 AND analysis->>\'jobId\' = $3 '
        + 'ORDER BY (analysis->>\'phaseIndex\')::int DESC LIMIT 1',
      [owner, PHASE_KIND, claim.id],
    );
    if (!result.rows.length) return 'PREFLIGHT';
    const analysis = result.rows[0].analysis;
    if (!isRecord(analysis) || analysis.recordKind !== PHASE_KIND || analysis.jobId !== claim.id
        || !PHASES.has(analysis.phase) || analysis.phaseIndex !== PHASE_INDEX[analysis.phase]) {
      fail('STORAGE_UNAVAILABLE', 'Retained review phase record is invalid.');
    }
    return analysis.phase;
  }

  async function insertRecord(client, owner, { id, requestId, at, graph, analysis }) {
    const result = await client.query(
      'INSERT INTO falcon_mesh.analyses (owner_id, id, request_id, created_at, observation_id, max_hops, graph, analysis) '
        + 'VALUES ($1, $2, $3, $4, $5, 1, $6::jsonb, $7::jsonb) '
        + 'ON CONFLICT (owner_id, request_id) DO NOTHING RETURNING id, request_id, created_at, analysis',
      [owner, id, requestId, at, CLAIM_OBSERVATION, JSON.stringify(graph), JSON.stringify(analysis)],
    );
    return result.rows[0] ?? null;
  }

  async function appendTerminal(client, owner, claim, state, resultValue, at) {
    let finalState = state;
    let terminalAt = at;
    let terminalResult = validateControllerResult(resultValue, claim);
    if (finalState === 'COMPLETE') {
      terminalAt = currentTime(now);
      if (Date.parse(terminalAt) >= Date.parse(claim.analysis.deadlineAt)) {
        finalState = 'UNKNOWN';
        terminalResult = validateControllerResult(noDataResult(claim), claim);
      }
    }
    const terminal = {
      schemaVersion: 1,
      recordKind: TERMINAL_KIND,
      jobId: claim.id,
      requestId: claim.request_id,
      analysisId: claim.analysis.analysisId,
      snapshotHash: claim.analysis.snapshotHash,
      state: finalState,
      phase: 'TERMINAL',
      result: terminalResult,
      executionReady: false,
    };
    const inserted = await insertRecord(client, owner, {
      id: randomUUID(),
      requestId: claim.analysis.terminalRequestId,
      at: terminalAt,
      graph: {
        schemaVersion: 1,
        domain: 'near-thesis',
        jobId: claim.id,
        snapshotHash: claim.analysis.snapshotHash,
        executionReady: false,
      },
      analysis: terminal,
    });
    if (inserted) return envelope(claim, finalState, 'TERMINAL', terminal.result);
    const retained = await terminalForClaim(client, owner, claim);
    if (retained) return retained;
    conflict('Review terminal identity is already used by another owner record.');
  }

  async function pendingOrExpire(client, owner, claim, at) {
    const terminal = await terminalForClaim(client, owner, claim);
    if (terminal) return terminal;
    if (Date.parse(at) >= Date.parse(claim.analysis.deadlineAt)) {
      return appendTerminal(client, owner, claim, 'UNKNOWN', noDataResult(claim), at);
    }
    return envelope(claim, 'PENDING', await phaseForClaim(client, owner, claim), null);
  }

  async function unresolvedClaim(client, owner) {
    const result = await client.query(
      'SELECT c.id, c.request_id, c.created_at, c.analysis FROM falcon_mesh.analyses AS c '
        + 'WHERE c.owner_id = $1 AND c.analysis->>\'recordKind\' = $2 '
        + 'AND NOT EXISTS (SELECT 1 FROM falcon_mesh.analyses AS t '
        + 'WHERE t.owner_id = c.owner_id AND t.request_id = (c.analysis->>\'terminalRequestId\')::uuid) '
        + 'ORDER BY c.created_at DESC, c.id DESC LIMIT 1',
      [owner, CLAIM_KIND],
    );
    return result.rows[0] ? assertClaim(result.rows[0]) : null;
  }

  async function matchesExisting(client, owner, row, requestId, analysisId, adopted) {
    if (!isRecord(row.analysis) || row.analysis.recordKind !== CLAIM_KIND) conflict();
    const claim = assertClaim(row);
    if (claim.request_id !== requestId || claim.analysis.requestId !== requestId
        || claim.analysis.analysisId !== analysisId || claim.analysis.snapshotHash !== adopted.snapshotHash
        || adopted.analysisId !== analysisId) conflict();
    const retainedAdoption = await loadAdopted(client, owner, analysisId);
    if (retainedAdoption.snapshotHash !== claim.analysis.snapshotHash
        || !stableEqual(retainedAdoption.sourceRefs, adopted.sourceRefs)) {
      fail('STORAGE_UNAVAILABLE', 'Retained review snapshot reference no longer matches its adoption.');
    }
    return claim;
  }

  return {
    async lookup(owner, input) {
      ownerId(owner);
      exactKeys(input, ['requestId', 'analysisId'], 'Review lookup');
      const requestId = uuid(input.requestId, 'Request ID');
      const analysisId = uuid(input.analysisId, 'Analysis ID');
      return transaction(owner, async client => {
        const row = await claimForRequest(client, owner, requestId);
        if (row) {
          if (!isRecord(row.analysis) || row.analysis.recordKind !== CLAIM_KIND) conflict();
          const claim = assertClaim(row);
          if (claim.analysis.analysisId !== analysisId) conflict();
          const adopted = await loadAdopted(client, owner, analysisId);
          await matchesExisting(client, owner, row, requestId, analysisId, adopted);
          return pendingOrExpire(client, owner, claim, currentTime(now));
        }
        await loadAdopted(client, owner, analysisId);
        return null;
      });
    },

    async claim(owner, input) {
      ownerId(owner);
      exactKeys(input, ['requestId', 'analysisId', 'runDeadlineMs'], 'Review claim');
      const requestId = uuid(input.requestId, 'Request ID');
      const analysisId = uuid(input.analysisId, 'Analysis ID');
      const runDeadlineMs = deadlineDuration(input.runDeadlineMs);
      return transaction(owner, async client => {
        const prior = await claimForRequest(client, owner, requestId);
        if (prior) {
          if (!isRecord(prior.analysis) || prior.analysis.recordKind !== CLAIM_KIND) conflict();
          const claim = assertClaim(prior);
          if (claim.analysis.analysisId !== analysisId) conflict();
          const adopted = await loadAdopted(client, owner, analysisId);
          await matchesExisting(client, owner, prior, requestId, analysisId, adopted);
          return { job: await pendingOrExpire(client, owner, claim, currentTime(now)), claimed: false, snapshot: null };
        }

        const adopted = await loadAdopted(client, owner, analysisId);
        const at = currentTime(now);
        const pending = await unresolvedClaim(client, owner);
        if (pending) {
          const pendingState = await pendingOrExpire(client, owner, pending, at);
          if (pendingState.state === 'PENDING') conflict('Another owner review job is still unresolved.');
        }

        const jobId = randomUUID();
        const deadlineAt = new Date(Date.parse(at) + runDeadlineMs).toISOString();
        const terminalRequestId = deterministicUuid(jobId, 'terminal');
        const analysis = {
          schemaVersion: 1,
          recordKind: CLAIM_KIND,
          jobId,
          requestId,
          analysisId,
          snapshotHash: adopted.snapshotHash,
          snapshotReference: { analysisId, snapshotHash: adopted.snapshotHash },
          terminalRequestId,
          deadlineAt,
          executionReady: false,
        };
        const inserted = await insertRecord(client, owner, {
          id: jobId,
          requestId,
          at,
          graph: {
            schemaVersion: 1,
            domain: 'near-thesis',
            snapshotReference: analysis.snapshotReference,
            executionReady: false,
          },
          analysis,
        });
        if (!inserted) {
          const raced = await claimForRequest(client, owner, requestId);
          if (raced?.analysis?.recordKind === CLAIM_KIND) {
            const claim = assertClaim(raced);
            if (claim.analysis.analysisId !== analysisId || claim.analysis.snapshotHash !== adopted.snapshotHash) conflict();
            return { job: await pendingOrExpire(client, owner, claim, currentTime(now)), claimed: false, snapshot: null };
          }
          conflict();
        }
        const claim = assertClaim(inserted);
        return {
          job: envelope(claim, 'PENDING', 'PREFLIGHT', null),
          claimed: true,
          snapshot: adopted.snapshot,
        };
      });
    },

    async phase(owner, jobIdInput, phase) {
      ownerId(owner);
      const jobId = uuid(jobIdInput, 'Job ID');
      if (!PHASES.has(phase)) invalid('Review phase is invalid.');
      return transaction(owner, async client => {
        const claim = await claimById(client, owner, jobId);
        if (!claim) fail('NOT_FOUND', 'Review job was not found.');
        const at = currentTime(now);
        const terminal = await terminalForClaim(client, owner, claim);
        if (terminal) return terminal;
        const job = await pendingOrExpire(client, owner, claim, at);
        if (job.state !== 'PENDING') return job;
        const currentIndex = PHASE_INDEX[job.phase];
        const nextIndex = PHASE_INDEX[phase];
        if (nextIndex < currentIndex) return job;
        const requestId = deterministicUuid(jobId, 'phase:' + phase);
        const analysis = {
          schemaVersion: 1,
          recordKind: PHASE_KIND,
          jobId,
          phase,
          phaseIndex: nextIndex,
          executionReady: false,
        };
        const inserted = await insertRecord(client, owner, {
          id: randomUUID(),
          requestId,
          at,
          graph: {
            schemaVersion: 1,
            domain: 'near-thesis',
            jobId,
            snapshotHash: claim.analysis.snapshotHash,
            phase,
            executionReady: false,
          },
          analysis,
        });
        if (!inserted) {
          const retained = await phaseForClaim(client, owner, claim);
          if (PHASE_INDEX[retained] < nextIndex) fail('STORAGE_UNAVAILABLE', 'Review phase identity conflicts with another record.');
          return envelope(claim, 'PENDING', retained, null);
        }
        return envelope(claim, 'PENDING', phase, null);
      });
    },

    async finish(owner, jobIdInput, result) {
      ownerId(owner);
      const jobId = uuid(jobIdInput, 'Job ID');
      return transaction(owner, async client => {
        const claim = await claimById(client, owner, jobId);
        if (!claim) fail('NOT_FOUND', 'Review job was not found.');
        const terminal = await terminalForClaim(client, owner, claim);
        if (terminal) return terminal;
        const at = currentTime(now);
        if (Date.parse(at) >= Date.parse(claim.analysis.deadlineAt)) {
          return appendTerminal(client, owner, claim, 'UNKNOWN', noDataResult(claim), at);
        }
        return appendTerminal(client, owner, claim, 'COMPLETE', result, at);
      });
    },
  };
}
