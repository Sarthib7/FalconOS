import { createHash, randomUUID } from 'node:crypto';
import { MeshError } from '../domain.mjs';
import { canonicalWalletAddress, deriveWalletOwnerId } from '../wallet-auth.mjs';
import { canonicalBytes, sha256, stableStringify } from '../council/evidence.ts';

const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const HASH = /^[a-f0-9]{64}$/;
const MAX_RECORD_BYTES = 192 * 1024;
const LIST_LIMIT = 200;
const KINDS = new Set(['mandate', 'portfolio', 'quotes', 'plan', 'review', 'action', 'monitor', 'devnet-proof']);
const TERMINAL_ACTION_STATES = new Set(['CONFIRMED', 'REFUNDED', 'FAILED']);
const MANDATE_FIELDS = [
  'schemaVersion', 'wallet', 'reserveAssetId', 'reserveFloorBaseUnits', 'maxActionReserveBaseUnits',
  'maxPositionBps', 'slippageBps', 'maxFeeBps', 'maxEvidenceAgeSeconds', 'targets',
  'monitorIntervalSeconds', 'maxMonitorCycles',
];
const PORTFOLIO_FIELDS = [
  'schemaVersion', 'chain', 'network', 'wallet', 'signerId', 'capturedAt', 'blockHash', 'blockHeight',
  'assets', 'balances', 'status', 'reasons',
];
const SNAPSHOT_FIELDS = [
  'schemaVersion', 'domain', 'capturedAt', 'portfolio', 'mandate', 'mandateHash', 'request', 'quotes',
  'proposal', 'checks', 'reasons', 'status',
];
const PROPOSAL_FIELDS = ['action', 'sourceAssetId', 'targetAssetId', 'inputBaseUnits', 'reason', 'expiresAt'];
const REQUEST_FIELDS = ['requestId', 'action', 'sourceAssetId', 'targetAssetId', 'inputBaseUnits'];
const SOURCE_REF_FIELDS = ['revisionId', 'sha256'];
const QUOTE_FIELDS = ['schemaVersion', 'capturedAt', 'raw', 'sha256', 'signatureVerified'];
const QUOTE_BINDING_FIELDS = ['role', 'quoteHash', 'sourceAssetId', 'targetAssetId', 'inputBaseUnits'];
const QUOTE_SET_FIELDS = ['schemaVersion', 'wallet', 'quotes'];
const ACTION_STATES = new Set([
  'PREPARING', 'PREPARED', 'SIGNED', 'SUBMISSION_UNKNOWN', 'SUBMITTED', 'PENDING',
  'EXIT_CONFIRMED', 'AWAITING_NEXT_LEG', 'NEXT_LEG_READY', 'CONFIRMED', 'REFUNDED', 'FAILED', 'UNVERIFIED',
]);
const ACTION_FIELDS = [
  'schemaVersion', 'wallet', 'actionId', 'action', 'planId', 'mandateId', 'leg', 'status', 'rotationState',
  'sourceAssetId', 'targetAssetId', 'rotationTargetAssetId', 'inputBaseUnits', 'preparationLeaseUntil', 'portfolioId', 'quote', 'standard', 'payload',
  'signatureBase64', 'signedData', 'intentHash', 'correlationId', 'providerStatus', 'nearTxHashes',
  'amounts', 'reason', 'receiptPortfolioId', 'nextPlanId', 'beforeReserveBaseUnits', 'createdFromRequestId',
];
const ACTION_OPEN_STATES = new Set([...ACTION_STATES].filter(status => !TERMINAL_ACTION_STATES.has(status)));
const MONITOR_FIELDS = [
  'schemaVersion', 'wallet', 'enabled', 'processId', 'cyclesCompleted', 'maxCycles', 'intervalSeconds',
  'nextRunAt', 'leaseUntil', 'status',
];
const REVIEW_FIELDS = [
  'schemaVersion', 'wallet', 'jobId', 'planId', 'snapshotHash', 'state', 'phase', 'result',
  'deadlineAt', 'leaseUntil', 'workerId', 'sourceRefs',
];

function fail(code, message) { throw new MeshError(code, message); }
function invalid(message) { fail('INVALID_INPUT', message); }
function conflict(message = 'CFO request conflicts with an existing retained record.') { fail('CONFLICT', message); }
function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    && [Object.prototype, null].includes(Object.getPrototypeOf(value));
}
function exact(value, fields, name) {
  if (!isObject(value) || Object.keys(value).length !== fields.length || fields.some(field => !Object.hasOwn(value, field))) {
    invalid(name + ' fields do not match the schema.');
  }
}
function id(value, name) {
  if (typeof value !== 'string' || !UUID.test(value)) invalid(name + ' must be a UUID.');
  return value.toLowerCase();
}
function canonicalTime(value, name) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)
      || !Number.isFinite(Date.parse(value)) || new Date(Date.parse(value)).toISOString() !== value) {
    invalid(name + ' must be a canonical UTC timestamp.');
  }
}
function ownerId(owner) {
  if (typeof owner !== 'string' || !/^wallet_[a-f0-9]{56}$/.test(owner)) invalid('CFO owner is invalid.');
  return owner;
}
function walletForOwner(owner, wallet) {
  ownerId(owner);
  let canonical;
  try { canonical = canonicalWalletAddress(wallet); }
  catch { invalid('CFO wallet is invalid.'); }
  if (deriveWalletOwnerId(canonical) !== owner) fail('UNAUTHORIZED', 'CFO wallet does not match the verified owner.');
  return canonical;
}
function validJson(value, depth = 0) {
  if (depth > 20) invalid('CFO record nesting exceeds its limit.');
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) invalid('CFO records may contain only finite JSON numbers.');
    return;
  }
  if (Array.isArray(value)) {
    if (value.length > 4096) invalid('CFO record array exceeds its limit.');
    for (const child of value) validJson(child, depth + 1);
    return;
  }
  if (!isObject(value)) invalid('CFO record must contain plain JSON values.');
  const keys = Reflect.ownKeys(value);
  if (keys.length > 256 || keys.some(key => typeof key !== 'string')) invalid('CFO record fields exceed their limit.');
  for (const key of keys) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor?.enumerable || !Object.hasOwn(descriptor, 'value')) invalid('CFO record must contain data fields.');
    validJson(descriptor.value, depth + 1);
  }
}
function jsonBytes(value, message = 'CFO record exceeds its storage limit.') {
  validJson(value);
  let encoded;
  try { encoded = JSON.stringify(value); } catch { invalid('CFO record is not valid JSON.'); }
  if (typeof encoded !== 'string' || Buffer.byteLength(encoded, 'utf8') > MAX_RECORD_BYTES) {
    fail('TOO_LARGE', message);
  }
  return encoded;
}
function exactWithOptional(value, required, optional, name) {
  if (!isObject(value) || required.some(key => !Object.hasOwn(value, key))
      || Object.keys(value).some(key => !required.includes(key) && !optional.includes(key))) {
    invalid(name + ' fields do not match the schema.');
  }
}
function units(value, name, { positive = false } = {}) {
  if (typeof value !== 'string' || value.length > 39 || !/^(0|[1-9]\d*)$/.test(value)) invalid(name + ' must be an unsigned integer string.');
  const amount = BigInt(value);
  if (amount > ((1n << 128n) - 1n) || (positive && amount === 0n)) invalid(name + ' is outside the supported range.');
  return amount;
}
function assertSnapshot(value) {
  exact(value, SNAPSHOT_FIELDS, 'CFO snapshot');
  if (value.schemaVersion !== 1 || value.domain !== 'cfo' || !['REVIEW', 'BLOCKED', 'NO_DATA'].includes(value.status)
      || !Array.isArray(value.quotes) || value.quotes.length > 8 || !Array.isArray(value.checks) || value.checks.length > 32
      || !Array.isArray(value.reasons) || value.reasons.length > 32 || !HASH.test(value.mandateHash ?? '')) invalid('CFO snapshot is invalid.');
  canonicalTime(value.capturedAt, 'CFO snapshot capture time');
  exact(value.mandate, MANDATE_FIELDS, 'CFO snapshot mandate');
  exact(value.portfolio, PORTFOLIO_FIELDS, 'CFO snapshot portfolio');
  exact(value.request, REQUEST_FIELDS, 'CFO snapshot request');
  if (value.proposal !== null) exact(value.proposal, PROPOSAL_FIELDS, 'CFO snapshot proposal');
  for (const quote of value.quotes) exact(quote, QUOTE_FIELDS, 'CFO quote envelope');
}
function validateData(kind, data, owner) {
  if (!KINDS.has(kind)) invalid('CFO record kind is unsupported.');
  if (!isObject(data) || (kind !== 'devnet-proof' && data.schemaVersion !== 1) || typeof data.wallet !== 'string') invalid('CFO record data is invalid.');
  const wallet = walletForOwner(owner, data.wallet);
  if (wallet !== data.wallet) invalid('CFO record wallet is not canonical.');
  switch (kind) {
    case 'mandate': {
      exact(data, MANDATE_FIELDS, 'CFO mandate');
      for (const field of ['reserveFloorBaseUnits', 'maxActionReserveBaseUnits']) units(data[field], field);
      for (const field of ['maxPositionBps', 'slippageBps', 'maxFeeBps', 'maxEvidenceAgeSeconds', 'monitorIntervalSeconds', 'maxMonitorCycles']) {
        if (!Number.isSafeInteger(data[field]) || data[field] < 0) invalid('CFO mandate limit is invalid.');
      }
      if (!Array.isArray(data.targets) || data.targets.length > 2) invalid('CFO mandate targets are invalid.');
      for (const target of data.targets) {
        exact(target, ['assetId', 'weightBps'], 'CFO target');
        if (typeof target.assetId !== 'string' || !Number.isSafeInteger(target.weightBps) || target.weightBps < 0 || target.weightBps > 10000) invalid('CFO target is invalid.');
      }
      break;
    }
    case 'portfolio': {
      exact(data, PORTFOLIO_FIELDS, 'CFO portfolio');
      if (data.chain !== 'near' || data.network !== 'mainnet' || !/^[a-f0-9]{64}$/.test(data.signerId ?? '')
          || !['OBSERVED', 'NO_DATA'].includes(data.status) || !Array.isArray(data.assets) || data.assets.length > 16
          || !Array.isArray(data.balances) || data.balances.length > 16 || !Array.isArray(data.reasons) || data.reasons.length > 32) invalid('CFO portfolio is invalid.');
      canonicalTime(data.capturedAt, 'CFO portfolio capture time');
      for (const balance of data.balances) {
        exact(balance, ['assetId', 'balanceBaseUnits'], 'CFO balance');
        if (typeof balance.assetId !== 'string') invalid('CFO balance asset is invalid.');
        units(balance.balanceBaseUnits, 'CFO balance');
      }
      break;
    }
    case 'plan': {
      exactWithOptional(data,
        ['schemaVersion', 'wallet', 'request', 'snapshot', 'snapshotHash', 'sourceRefs', 'quoteBindings', 'status', 'reviewJobId', 'workflow'],
        ['parentPlanId', 'actionId'], 'CFO plan');
      assertSnapshot(data.snapshot);
      if (data.snapshotHash !== sha256(canonicalBytes(data.snapshot)) || !HASH.test(data.snapshotHash)
          || data.status !== data.snapshot.status || !Array.isArray(data.sourceRefs) || data.sourceRefs.length < 1 || data.sourceRefs.length > 4
          || !Array.isArray(data.quoteBindings) || data.quoteBindings.length > 8
          || !['SINGLE', 'ROTATION_EXIT', 'ROTATION_ENTRY'].includes(data.workflow)) invalid('CFO plan binding is invalid.');
      exact(data.request, REQUEST_FIELDS, 'CFO plan request');
      for (const ref of data.sourceRefs) {
        exact(ref, SOURCE_REF_FIELDS, 'CFO source reference');
        id(ref.revisionId, 'CFO source record ID');
        if (!HASH.test(ref.sha256)) invalid('CFO source hash is invalid.');
      }
      for (const binding of data.quoteBindings) {
        exact(binding, QUOTE_BINDING_FIELDS, 'CFO quote binding');
        if (!['ACTION', 'VALUATION', 'PROJECTED_EXIT', 'ROUNDTRIP_EXIT'].includes(binding.role)
            || typeof binding.sourceAssetId !== 'string' || typeof binding.targetAssetId !== 'string'
            || !HASH.test(binding.quoteHash) || !data.snapshot.quotes.some(quote => quote.sha256 === binding.quoteHash)) invalid('CFO quote binding is invalid.');
        units(binding.inputBaseUnits, 'CFO quote binding input', { positive: true });
      }
      if (data.reviewJobId !== null) id(data.reviewJobId, 'CFO review job ID');
      if (data.parentPlanId !== undefined && data.parentPlanId !== null) id(data.parentPlanId, 'CFO parent plan ID');
      if (data.actionId !== undefined && data.actionId !== null) id(data.actionId, 'CFO action ID');
      break;
    }
    case 'review': {
      exact(data, REVIEW_FIELDS, 'CFO review job');
      id(data.jobId, 'CFO review job ID'); id(data.planId, 'CFO review plan ID');
      if (!HASH.test(data.snapshotHash) || !['PENDING', 'COMPLETE', 'UNKNOWN'].includes(data.state)
          || !['PREFLIGHT', 'LEAD', 'RISK', 'TERMINAL'].includes(data.phase)
          || !Array.isArray(data.sourceRefs) || data.sourceRefs.length > 8) invalid('CFO review job is invalid.');
      canonicalTime(data.deadlineAt, 'CFO review deadline');
      if (data.leaseUntil !== null) canonicalTime(data.leaseUntil, 'CFO review lease');
      if (data.workerId !== null) id(data.workerId, 'CFO review worker ID');
      if (data.result !== null) jsonBytes(data.result, 'CFO review result exceeds its storage limit.');
      for (const ref of data.sourceRefs) {
        exact(ref, SOURCE_REF_FIELDS, 'CFO source reference');
        id(ref.revisionId, 'CFO source record ID');
        if (!HASH.test(ref.sha256)) invalid('CFO source hash is invalid.');
      }
      break;
    }
    case 'quotes': {
      exact(data, QUOTE_SET_FIELDS, 'CFO quote set');
      if (!Array.isArray(data.quotes) || data.quotes.length > 8) invalid('CFO quote set is invalid.');
      for (const quote of data.quotes) {
        exact(quote, QUOTE_FIELDS, 'CFO quote envelope');
        if (quote.schemaVersion !== 1 || quote.signatureVerified !== true || !HASH.test(quote.sha256 ?? '')) invalid('CFO quote envelope is not verified.');
        canonicalTime(quote.capturedAt, 'CFO quote capture time');
      }
      break;
    }
    case 'devnet-proof': {
      exact(data, ['wallet', 'supplyIntentId', 'redeemIntentId', 'explorerEvidence'], 'CFO T82 proof');
      id(data.supplyIntentId, 'T82 supply intent ID'); id(data.redeemIntentId, 'T82 redeem intent ID');
      if (data.supplyIntentId === data.redeemIntentId || !Array.isArray(data.explorerEvidence)
          || data.explorerEvidence.length !== 2) invalid('CFO T82 proof is incomplete.');
      for (const evidence of data.explorerEvidence) {
        exact(evidence, ['signature', 'url', 'capturedAt', 'slot', 'status', 'contentSha256'], 'T82 Explorer evidence');
        if (typeof evidence.signature !== 'string' || evidence.signature.length < 1 || evidence.signature.length > 128
            || typeof evidence.url !== 'string' || evidence.url.length > 2048 || !evidence.url.startsWith('https://')
            || !['confirmed', 'finalized'].includes(evidence.status) || !HASH.test(evidence.contentSha256 ?? '')
            || (!(Number.isSafeInteger(evidence.slot) && evidence.slot >= 0)
              && !(typeof evidence.slot === 'string' && /^(0|[1-9]\d*)$/.test(evidence.slot)))) invalid('CFO Explorer evidence is invalid.');
        canonicalTime(evidence.capturedAt, 'T82 Explorer capture time');
      }
      if (new Set(data.explorerEvidence.map(item => item.signature)).size !== 2
          || new Set(data.explorerEvidence.map(item => item.contentSha256)).size !== 2) invalid('CFO Explorer evidence must be independently retained.');
      break;
    }
    case 'action': {
      exact(data, ACTION_FIELDS, 'CFO action');
      id(data.actionId, 'CFO action ID'); id(data.planId, 'CFO action plan ID'); id(data.mandateId, 'CFO action mandate ID'); id(data.portfolioId, 'CFO action portfolio ID');
      if (!['invest', 'redeem', 'rotate', 'reinvest'].includes(data.action)
          || !Number.isSafeInteger(data.leg) || data.leg < 0 || data.leg > 1
          || !ACTION_STATES.has(data.status) || !['NONE', 'IN_PROGRESS', 'COMPLETE', 'INCOMPLETE'].includes(data.rotationState)
          || typeof data.sourceAssetId !== 'string' || typeof data.targetAssetId !== 'string'
          || (data.action === 'rotate' ? typeof data.rotationTargetAssetId !== 'string' : data.rotationTargetAssetId !== null)) invalid('CFO action is invalid.');
      if (data.quote !== null) exact(data.quote, QUOTE_FIELDS, 'CFO action quote');
      if (data.preparationLeaseUntil !== null) canonicalTime(data.preparationLeaseUntil, 'CFO action preparation lease');
      if ((data.status === 'PREPARING') !== (data.preparationLeaseUntil !== null)
          || (data.status === 'PREPARING' && (data.signatureBase64 !== null || data.signedData !== null || data.intentHash !== null))) invalid('CFO preparation lease must only cover unsigned, undispatched work.');
      if (data.standard !== null && data.standard !== 'raw_ed25519') invalid('CFO action signature standard is invalid.');
      if (data.payload !== null && (typeof data.payload !== 'string' || Buffer.byteLength(data.payload, 'utf8') > 32 * 1024)) invalid('CFO unsigned payload exceeds its limit.');
      if (data.signatureBase64 !== null && (typeof data.signatureBase64 !== 'string' || data.signatureBase64.length > 256)) invalid('CFO signature exceeds its limit.');
      if (data.signedData !== null) jsonBytes(data.signedData, 'CFO signed intent exceeds its storage limit.');
      if (data.intentHash !== null && (typeof data.intentHash !== 'string' || data.intentHash.length > 256)) invalid('CFO intent hash is invalid.');
      if (data.correlationId !== null && (typeof data.correlationId !== 'string' || data.correlationId.length > 256)) invalid('CFO correlation ID is invalid.');
      if (data.nearTxHashes !== null && (!Array.isArray(data.nearTxHashes) || data.nearTxHashes.length > 16
          || data.nearTxHashes.some(hash => typeof hash !== 'string' || hash.length > 128))) invalid('CFO transaction hashes are invalid.');
      if (data.amounts !== null) jsonBytes(data.amounts, 'CFO settlement amounts exceed their limit.');
      if (data.reason !== null && (typeof data.reason !== 'string' || Buffer.byteLength(data.reason, 'utf8') > 512)) invalid('CFO action reason exceeds its limit.');
      if (data.receiptPortfolioId !== null) id(data.receiptPortfolioId, 'CFO receipt portfolio ID');
      if (data.nextPlanId !== null) id(data.nextPlanId, 'CFO next plan ID');
      if (data.beforeReserveBaseUnits !== null) units(data.beforeReserveBaseUnits, 'CFO baseline reserve balance');
      id(data.createdFromRequestId, 'CFO action request ID');
      break;
    }
    case 'monitor': {
      exact(data, MONITOR_FIELDS, 'CFO monitor');
      if (typeof data.enabled !== 'boolean' || !Number.isSafeInteger(data.cyclesCompleted) || data.cyclesCompleted < 0
          || !Number.isSafeInteger(data.maxCycles) || data.maxCycles < 1 || data.cyclesCompleted > data.maxCycles
          || !Number.isSafeInteger(data.intervalSeconds) || data.intervalSeconds < 1
          || !['RUNNING', 'STOPPED', 'COMPLETE', 'STOPPED_ON_RESTART', 'NO_DATA'].includes(data.status)) invalid('CFO monitor state is invalid.');
      id(data.processId, 'CFO monitor process ID');
      if (data.nextRunAt !== null) canonicalTime(data.nextRunAt, 'CFO monitor next run');
      if (data.leaseUntil !== null) canonicalTime(data.leaseUntil, 'CFO monitor lease');
      break;
    }
  }
  jsonBytes(data);
  return JSON.parse(JSON.stringify(data));
}
function contentHash(owner, requestId, kind, data, sequence, recordId) {
  return sha256(canonicalBytes({ owner, requestId, kind, data, sequence, recordId }));
}
function recordKind(kind) { return 'cfo/' + kind + '/1'; }
function failStorage() { return new MeshError('STORAGE_UNAVAILABLE', 'CFO storage could not complete the request.'); }
function safeError(error) { return error instanceof MeshError ? error : failStorage(); }
function rowRecord(row, owner) {
  const analysis = row?.analysis;
  const kind = analysis?.kind;
  const sequence = analysis?.sequence;
  if (!analysis || analysis.schemaVersion !== 1 || !KINDS.has(kind) || analysis.recordKind !== recordKind(kind)
      || analysis.requestId !== row.request_id || analysis.contentHash !== row.graph?.contentHash
      || analysis.wallet !== row.graph?.wallet || typeof analysis.wallet !== 'string'
      || typeof sequence !== 'string' || !/^[1-9]\d*$/.test(sequence) || BigInt(sequence) > 9223372036854775807n
      || row.graph?.sequence !== sequence || row.graph?.schemaVersion !== 1 || row.graph?.domain !== 'cfo'
      || row.graph?.recordKind !== recordKind(kind) || row.graph?.executionReady !== false
      || analysis.contentHash !== contentHash(owner, row.request_id, kind, analysis.data, sequence, row.id)) {
    fail('STORAGE_UNAVAILABLE', 'Retained CFO record failed integrity verification.');
  }
  try {
    walletForOwner(owner, analysis.wallet);
    const validated = validateData(kind, analysis.data, owner);
    if (stableStringify(validated) !== stableStringify(analysis.data)) throw new Error('record mismatch');
  } catch { fail('STORAGE_UNAVAILABLE', 'Retained CFO record owner binding or typed data is invalid.'); }
  return {
    id: row.id,
    requestId: row.request_id,
    createdAt: new Date(row.created_at).toISOString(),
    kind,
    data: analysis.data,
    contentHash: analysis.contentHash,
    sequence,
  };
}

export function createCfoStore(pool) {
  if (!pool || typeof pool.connect !== 'function' || typeof pool.query !== 'function') throw new TypeError('CFO store requires a PostgreSQL pool.');

  async function transaction(owner, work) {
    ownerId(owner);
    const lock = createHash('sha256').update('falcon_mesh:' + owner, 'utf8').digest().readBigInt64BE().toString();
    for (let attempt = 0; attempt < 3; attempt += 1) {
      let client;
      try { client = await pool.connect(); }
      catch { throw failStorage(); }
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
        throw safeError(error);
      } finally { client.release(releaseError); }
    }
    throw failStorage();
  }

  async function databaseTime(client) {
    const result = await client.query(`SELECT to_char(clock_timestamp() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS now`);
    const at = result.rows?.[0]?.now;
    try { canonicalTime(at, 'PostgreSQL CFO clock'); }
    catch { throw failStorage(); }
    return at;
  }

  async function latestRow(client, owner, kind) {
    const result = await client.query(
      `SELECT id, request_id, created_at, graph, analysis FROM falcon_mesh.analyses
       WHERE owner_id = $1 AND analysis->>'recordKind' = $2
       ORDER BY COALESCE((analysis->>'sequence')::bigint, 0) DESC, id DESC LIMIT 1`,
      [owner, recordKind(kind)],
    );
    return result.rows[0] ?? null;
  }
  async function latestReviewRow(client, owner, jobId) {
    const result = await client.query(
      `SELECT id, request_id, created_at, graph, analysis FROM falcon_mesh.analyses
       WHERE owner_id = $1 AND analysis->>'recordKind' = $2 AND analysis->'data'->>'jobId' = $3
       ORDER BY COALESCE((analysis->>'sequence')::bigint, 0) DESC, id DESC LIMIT 1`,
      [owner, recordKind('review'), jobId],
    );
    return result.rows[0] ?? null;
  }
  async function verifySourceReferences(client, owner, kind, data) {
    if (!['plan', 'review'].includes(kind)) return;
    const foundKinds = new Set();
    for (const reference of data.sourceRefs) {
      const result = await client.query(
        `SELECT id, graph, analysis FROM falcon_mesh.analyses
         WHERE owner_id = $1 AND id = $2 AND graph->>'domain' = 'cfo' LIMIT 1`,
        [owner, reference.revisionId],
      );
      const row = result.rows[0];
      if (!row || row.graph?.contentHash !== reference.sha256 || row.analysis?.contentHash !== reference.sha256
          || row.analysis?.wallet !== data.wallet || !['mandate', 'portfolio', 'quotes'].includes(row.analysis?.kind)) {
        conflict('CFO source reference is missing, changed, or belongs to another owner.');
      }
      foundKinds.add(row.analysis.kind);
    }
    if (kind === 'plan' && !['mandate', 'portfolio', 'quotes'].every(sourceKind => foundKinds.has(sourceKind))) {
      conflict('CFO plans require retained mandate, portfolio, and quote source records.');
    }
    if (kind === 'review') {
      const result = await client.query(
        `SELECT id, request_id, created_at, graph, analysis FROM falcon_mesh.analyses
         WHERE owner_id = $1 AND id = $2 AND graph->>'domain' = 'cfo' LIMIT 1`,
        [owner, data.planId],
      );
      const plan = result.rows[0] ? rowRecord(result.rows[0], owner) : null;
      if (!plan || plan.kind !== 'plan' || plan.data.wallet !== data.wallet
          || plan.data.reviewJobId !== data.jobId || plan.data.snapshotHash !== data.snapshotHash
          || stableStringify(plan.data.sourceRefs) !== stableStringify(data.sourceRefs)) {
        conflict('CFO review job is not bound to its retained owner plan and source records.');
      }
    }
  }

  async function openActionIds(client, owner) {
    const result = await client.query(
      `SELECT DISTINCT ON (analysis->'data'->>'actionId')
         analysis->'data'->>'actionId' AS action_id, analysis->'data'->>'status' AS status
       FROM falcon_mesh.analyses
       WHERE owner_id = $1 AND analysis->>'recordKind' = $2
       ORDER BY analysis->'data'->>'actionId', COALESCE((analysis->>'sequence')::bigint, 0) DESC`,
      [owner, recordKind('action')],
    );
    return result.rows.filter(row => ACTION_OPEN_STATES.has(row.status)).map(row => row.action_id);
  }

  return {
    async clock(owner) {
      return transaction(owner, client => databaseTime(client));
    },

    async get(owner, recordId) {
      ownerId(owner);
      const normalizedId = id(recordId, 'Record ID');
      try {
        const result = await pool.query(
          `SELECT id, request_id, created_at, graph, analysis FROM falcon_mesh.analyses
           WHERE owner_id = $1 AND id = $2 AND graph->>'domain' = 'cfo'`,
          [owner, normalizedId],
        );
        return result.rows[0] ? rowRecord(result.rows[0], owner) : null;
      } catch (error) { throw safeError(error); }
    },

    async byRequest(owner, requestId) {
      ownerId(owner);
      const normalizedRequest = id(requestId, 'Request ID');
      try {
        const result = await pool.query(
          `SELECT id, request_id, created_at, graph, analysis FROM falcon_mesh.analyses
           WHERE owner_id = $1 AND request_id = $2 AND graph->>'domain' = 'cfo' LIMIT 1`,
          [owner, normalizedRequest],
        );
        return result.rows[0] ? rowRecord(result.rows[0], owner) : null;
      } catch (error) { throw safeError(error); }
    },

    async latest(owner, kind) {
      ownerId(owner);
      if (!KINDS.has(kind)) invalid('CFO record kind is unsupported.');
      try {
        const result = await pool.query(
          `SELECT id, request_id, created_at, graph, analysis FROM falcon_mesh.analyses
           WHERE owner_id = $1 AND analysis->>'recordKind' = $2
           ORDER BY COALESCE((analysis->>'sequence')::bigint, 0) DESC, id DESC LIMIT 1`,
          [owner, recordKind(kind)],
        );
        return result.rows[0] ? rowRecord(result.rows[0], owner) : null;
      } catch (error) { throw safeError(error); }
    },

    async latestAction(owner, actionId) {
      ownerId(owner);
      const normalizedActionId = id(actionId, 'Action ID');
      try {
        const result = await pool.query(
          `SELECT id, request_id, created_at, graph, analysis FROM falcon_mesh.analyses
           WHERE owner_id = $1 AND analysis->>'recordKind' = $2 AND analysis->'data'->>'actionId' = $3
           ORDER BY COALESCE((analysis->>'sequence')::bigint, 0) DESC, id DESC LIMIT 1`,
          [owner, recordKind('action'), normalizedActionId],
        );
        return result.rows[0] ? rowRecord(result.rows[0], owner) : null;
      } catch (error) { throw safeError(error); }
    },

    async actionByRequest(owner, actionId, requestId) {
      ownerId(owner);
      const normalizedActionId = id(actionId, 'Action ID');
      const normalizedRequestId = id(requestId, 'Request ID');
      try {
        const result = await pool.query(
          `SELECT id, request_id, created_at, graph, analysis FROM falcon_mesh.analyses
           WHERE owner_id = $1 AND analysis->>'recordKind' = $2
             AND analysis->'data'->>'actionId' = $3
             AND analysis->'data'->>'createdFromRequestId' = $4
           ORDER BY COALESCE((analysis->>'sequence')::bigint, 0) DESC, id DESC LIMIT 1`,
          [owner, recordKind('action'), normalizedActionId, normalizedRequestId],
        );
        return result.rows[0] ? rowRecord(result.rows[0], owner) : null;
      } catch (error) { throw safeError(error); }
    },
    async latestReview(owner, jobId) {
      ownerId(owner);
      const normalizedJobId = id(jobId, 'Review job ID');
      try {
        const result = await pool.query(
          `SELECT id, request_id, created_at, graph, analysis FROM falcon_mesh.analyses
           WHERE owner_id = $1 AND analysis->>'recordKind' = $2 AND analysis->'data'->>'jobId' = $3
           ORDER BY COALESCE((analysis->>'sequence')::bigint, 0) DESC, id DESC LIMIT 1`,
          [owner, recordKind('review'), normalizedJobId],
        );
        return result.rows[0] ? rowRecord(result.rows[0], owner) : null;
      } catch (error) { throw safeError(error); }
    },
    async list(owner, options = {}) {
      ownerId(owner);
      exactWithOptional(options, [], ['kind', 'limit'], 'CFO history filter');
      const kind = options.kind ?? null;
      const limit = options.limit ?? LIST_LIMIT;
      if ((kind !== null && !KINDS.has(kind)) || !Number.isSafeInteger(limit) || limit < 1 || limit > LIST_LIMIT) {
        invalid('CFO history kind or limit is invalid.');
      }
      try {
        const result = await pool.query(
          `SELECT id, request_id, created_at, graph, analysis FROM falcon_mesh.analyses
           WHERE owner_id = $1 AND graph->>'domain' = 'cfo'
             AND ($3::text IS NULL OR analysis->>'recordKind' = $3)
           ORDER BY COALESCE((analysis->>'sequence')::bigint, 0) DESC, id DESC LIMIT $2`,
          [owner, limit, kind === null ? null : recordKind(kind)],
        );
        return result.rows.map(row => rowRecord(row, owner));
      } catch (error) { throw safeError(error); }
    },

    // Immutable append, exact request-content dedupe, latest-kind CAS, and the single-action reservation share this owner transaction.
    async append(owner, input) {
      ownerId(owner);
      exactWithOptional(input, ['requestId', 'kind', 'data'], ['expectedHeadId', 'expectedMandateId', 'expectedPortfolioId', 'exclusiveAction'], 'CFO append');
      const requestId = id(input.requestId, 'Request ID');
      const kind = input.kind;
      if (!KINDS.has(kind)) invalid('CFO record kind is unsupported.');
      const data = validateData(kind, input.data, owner);
      const expectedHeadId = input.expectedHeadId === undefined ? undefined
        : input.expectedHeadId === null ? null : id(input.expectedHeadId, 'Expected CFO head ID');
      const expectedMandateId = input.expectedMandateId === undefined ? undefined
        : input.expectedMandateId === null ? null : id(input.expectedMandateId, 'Expected mandate ID');
      const expectedPortfolioId = input.expectedPortfolioId === undefined ? undefined
        : input.expectedPortfolioId === null ? null : id(input.expectedPortfolioId, 'Expected portfolio ID');
      let exclusive = null;
      if (input.exclusiveAction !== undefined) {
        exact(input.exclusiveAction, ['mode', 'actionId', 'assetId', 'baseUnits', 'portfolioId', 'mandateId'], 'CFO action reservation');
        exclusive = {
          mode: input.exclusiveAction.mode,
          actionId: id(input.exclusiveAction.actionId, 'Action ID'),
          assetId: input.exclusiveAction.assetId,
          baseUnits: units(input.exclusiveAction.baseUnits, 'Reserved action units', { positive: true }).toString(),
          portfolioId: id(input.exclusiveAction.portfolioId, 'Portfolio record ID'),
          mandateId: id(input.exclusiveAction.mandateId, 'Mandate record ID'),
        };
        if (!['CREATE', 'CONTINUE'].includes(exclusive.mode)
            || kind !== 'action' || data.actionId !== exclusive.actionId || data.mandateId !== exclusive.mandateId
            || data.portfolioId !== exclusive.portfolioId || data.sourceAssetId !== exclusive.assetId
            || data.inputBaseUnits !== exclusive.baseUnits) invalid('CFO action reservation does not match its retained action.');
      }
      return transaction(owner, async client => {
        const existing = await client.query(
          'SELECT id, request_id, created_at, graph, analysis FROM falcon_mesh.analyses WHERE owner_id = $1 AND request_id = $2 LIMIT 1',
          [owner, requestId],
        );
        if (existing.rows[0]) {
          const saved = rowRecord(existing.rows[0], owner);
          if (saved.kind !== kind || stableStringify(saved.data) !== stableStringify(data)) conflict('CFO request ID is already bound to different content.');
          return { record: saved, inserted: false };
        }
        if (expectedHeadId !== undefined) {
          const head = kind === 'review' ? await latestReviewRow(client, owner, data.jobId) : await latestRow(client, owner, kind);
          if ((head?.id ?? null) !== expectedHeadId) conflict('CFO record head changed before the requested transition.');
        }
        if (expectedMandateId !== undefined) {
          const mandateHead = await latestRow(client, owner, 'mandate');
          if ((mandateHead?.id ?? null) !== expectedMandateId) conflict('CFO mandate changed before the requested owner action transition.');
        }
        if (expectedPortfolioId !== undefined) {
          const portfolioHead = await latestRow(client, owner, 'portfolio');
          if ((portfolioHead?.id ?? null) !== expectedPortfolioId) conflict('CFO portfolio changed before the requested owner action transition.');
        }
        await verifySourceReferences(client, owner, kind, data);
        if (exclusive) {
          const openIds = await openActionIds(client, owner);
          if (exclusive.mode === 'CREATE' && openIds.length > 0) conflict('Another unresolved CFO action already reserves owner funds.');
          if (exclusive.mode === 'CONTINUE') {
            if (openIds.length !== 1 || openIds[0] !== exclusive.actionId) conflict('Rotation continuation does not own the exclusive action reservation.');
            const latestAction = await client.query(
              `SELECT id, request_id, created_at, graph, analysis FROM falcon_mesh.analyses
               WHERE owner_id = $1 AND analysis->>'recordKind' = $2 AND analysis->'data'->>'actionId' = $3
               ORDER BY COALESCE((analysis->>'sequence')::bigint, 0) DESC, id DESC LIMIT 1`,
              [owner, recordKind('action'), exclusive.actionId],
            );
            const priorAction = latestAction.rows[0] ? rowRecord(latestAction.rows[0], owner) : null;
            if (!priorAction || priorAction.data.action !== 'rotate' || priorAction.data.leg !== 0
                || priorAction.data.status !== 'AWAITING_NEXT_LEG') conflict('Only an unsigned rotation with a confirmed exit may reserve its entry leg.');
          }
          const portfolioRow = await latestRow(client, owner, 'portfolio');
          const mandateRow = await latestRow(client, owner, 'mandate');
          if (!portfolioRow || portfolioRow.id !== exclusive.portfolioId) conflict('The portfolio changed before action funds could be reserved.');
          if (!mandateRow || mandateRow.id !== exclusive.mandateId) conflict('The mandate changed before action funds could be reserved.');
          const portfolio = portfolioRow.analysis?.data;
          const mandate = mandateRow.analysis?.data;
          if (portfolio?.status !== 'OBSERVED' || portfolio.wallet !== data.wallet || mandate?.wallet !== data.wallet) conflict('Verified current owner portfolio and mandate are required to reserve action funds.');
          const available = BigInt(portfolio.balances.find(balance => balance.assetId === exclusive.assetId)?.balanceBaseUnits ?? '0');
          const amount = BigInt(exclusive.baseUnits);
          if (available < amount) conflict('The observed portfolio does not cover the reserved action amount.');
          const quote = data.quote?.raw;
          if (data.quote?.signatureVerified !== true || quote?.quoteRequest?.originAsset !== exclusive.assetId
              || quote?.quoteRequest?.destinationAsset !== data.targetAssetId
              || quote?.quoteRequest?.amount !== exclusive.baseUnits || quote?.quote?.amountIn !== exclusive.baseUnits) {
            conflict('Action reservation does not bind its exact owner-bound executable quote.');
          }
          if (exclusive.assetId === mandate.reserveAssetId) {
            const floor = BigInt(mandate.reserveFloorBaseUnits);
            const cap = BigInt(mandate.maxActionReserveBaseUnits);
            if (amount > cap || available - amount < floor) conflict('The current mandate reserve cap or floor blocks this action reservation.');
          } else {
            if (quote.quoteRequest.destinationAsset !== mandate.reserveAssetId) conflict('A receipt exit must route to the saved reserve.');
            const reserveValue = units(quote.quote.minAmountOut, 'Quoted exit reserve value');
            if (reserveValue > BigInt(mandate.maxActionReserveBaseUnits)) conflict('Current mandate reserve cap blocks this exit reservation.');
          }
        }
        const at = await databaseTime(client);
        const sequenceResult = await client.query(
          `SELECT (COALESCE(MAX((analysis->>'sequence')::bigint), 0) + 1)::text AS next_sequence
           FROM falcon_mesh.analyses WHERE owner_id = $1 AND graph->>'domain' = 'cfo'`,
          [owner],
        );
        const sequence = sequenceResult.rows?.[0]?.next_sequence;
        if (typeof sequence !== 'string' || !/^[1-9]\d*$/.test(sequence)) throw failStorage();
        const rowId = randomUUID();
        const digest = contentHash(owner, requestId, kind, data, sequence, rowId);
        const graph = { schemaVersion: 1, domain: 'cfo', recordKind: recordKind(kind), wallet: data.wallet, sequence, contentHash: digest, executionReady: false };
        const analysis = { schemaVersion: 1, recordKind: recordKind(kind), kind, requestId, wallet: data.wallet, sequence, contentHash: digest, data };
        const inserted = await client.query(
          `INSERT INTO falcon_mesh.analyses (owner_id, id, request_id, created_at, observation_id, max_hops, graph, analysis)
           VALUES ($1, $2, $3, $4, $5, 1, $6::jsonb, $7::jsonb) ON CONFLICT (owner_id, request_id) DO NOTHING
           RETURNING id, request_id, created_at, graph, analysis`,
          [owner, rowId, requestId, at, 'cfo:' + kind, JSON.stringify(graph), JSON.stringify(analysis)],
        );
        if (!inserted.rows.length) conflict('CFO request was concurrently retained with different content.');
        return { record: rowRecord(inserted.rows[0], owner), inserted: true };
      });
    },
  };
}
