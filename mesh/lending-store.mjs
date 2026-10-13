import { createHash, randomUUID } from 'node:crypto';
import { PublicKey } from '@solana/web3.js';
import { MeshError } from './domain.mjs';
import { LENDING_CONFIG as C, deriveAccounts, deserializeLendingTransaction, validateLendingTransaction } from './kamino-wire.mjs';
import { analyzeLiveGraph, CONNECTORS } from './live.mjs';
import { verifyLendingVersions } from './kamino.mjs';
import { RESERVE_DECISION_MARKER } from './scenario.mjs';
import { PUBLIC_OWNER_ID, PUBLIC_PROGRAM_OBSERVATION, lockMeshOwner, lockPublicGraph } from './public-graph.mjs';

const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const SIGNATURE = /^[1-9A-HJ-NP-Za-km-z]{64,88}$/;
const JSON_LIMIT = 1024 * 1024;
const RECEIPT_STATUSES = ['PENDING', 'FAILED', 'UNVERIFIED', 'CONFIRMED'];

const REQUEST_KEYS = ['requestId', 'analysisId', 'wallet', 'action', 'inputBaseUnits'];
function fail(code, message) { throw new MeshError(code, message); }
function ownerId(owner) {
  if (typeof owner !== 'string' || owner === PUBLIC_OWNER_ID || !/^[a-z0-9_-]{1,64}$/.test(owner)) fail('INVALID_INPUT', 'Owner is invalid.');
}
function uuid(value) {
  if (typeof value !== 'string' || !UUID.test(value)) fail('INVALID_INPUT', 'Record ID must be a UUID.');
  return value.toLowerCase();
}
function exact(value, keys) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).length !== keys.length
      || keys.some(key => !Object.hasOwn(value, key))) fail('INVALID_INPUT', 'Lending request fields are invalid.');
}
function timestamp(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)
      || !Number.isFinite(Date.parse(value)) || new Date(value).toISOString() !== value) fail('INVALID_INPUT', 'Lending time is invalid.');
  return value;
}
function jsonObject(value, limit = JSON_LIMIT) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail('INVALID_INPUT', 'Lending evidence must be an object.');
  const parents = new Set();
  function check(item, depth) {
    if (depth > 64) fail('TOO_LARGE', 'Lending evidence is too deeply nested.');
    if (item === null || typeof item === 'boolean' || typeof item === 'number' && Number.isFinite(item)) return;
    if (typeof item === 'string') {
      if (!item.isWellFormed() || item.includes('\0')) fail('INVALID_INPUT', 'Lending evidence contains invalid text.');
      return;
    }
    if (typeof item !== 'object' || parents.has(item) || ![Object.prototype, Array.prototype, null].includes(Object.getPrototypeOf(item))) {
      fail('INVALID_INPUT', 'Lending evidence must contain JSON values.');
    }
    parents.add(item);
    for (const [key, child] of Object.entries(item)) { check(key, depth + 1); check(child, depth + 1); }
    parents.delete(item);
  }
  check(value, 0);
  const encoded = JSON.stringify(value);
  if (Buffer.byteLength(encoded, 'utf8') > limit) fail('TOO_LARGE', 'Lending evidence exceeds its storage limit.');
  return encoded;
}
function requestFields(input) {
  // `decisionId` is the only optional key: supply requires it, redeem forbids it (exits are never gated).
  const hasDecision = Boolean(input) && typeof input === 'object' && Object.hasOwn(input, 'decisionId');
  exact(input, hasDecision ? [...REQUEST_KEYS, 'decisionId'] : REQUEST_KEYS);
  const requestId = uuid(input.requestId);
  const analysisId = uuid(input.analysisId);
  try {
    if (typeof input.wallet !== 'string' || new PublicKey(input.wallet).toBase58() !== input.wallet) throw new Error('Invalid wallet');
  } catch { fail('INVALID_INPUT', 'Wallet must be a canonical Solana address.'); }
  if (!['supply', 'redeem'].includes(input.action) || typeof input.inputBaseUnits !== 'string'
      || !/^[1-9][0-9]{0,19}$/.test(input.inputBaseUnits) || BigInt(input.inputBaseUnits) > 18446744073709551615n) {
    fail('INVALID_INPUT', 'Lending action or positive integer amount is invalid.');
  }
  if (input.action === 'redeem' && hasDecision) fail('INVALID_INPUT', 'A redeem must not carry a reserve decision.');
  if (input.action === 'supply' && !hasDecision) fail('INVALID_INPUT', 'A supply requires the ID of a saved reserve decision.');
  const decisionId = hasDecision ? uuid(input.decisionId) : undefined;
  const request = { wallet: input.wallet, action: input.action, inputBaseUnits: input.inputBaseUnits };
  return { requestId, analysisId, decisionId, request, stored: hasDecision ? { ...request, decisionId } : request };
}
function storedRecord(row) {
  return { id: row.id, requestId: row.request_id, analysisId: row.analysis_id, createdAt: new Date(row.created_at).toISOString(), request: row.request, intent: row.intent };
}
function storedEvent(row) {
  return { id: row.id, requestId: row.request_id, intentId: row.intent_id, createdAt: new Date(row.created_at).toISOString(), kind: row.kind, data: row.data };
}
function sameRequest(row, input) {
  return row.analysis_id === input.analysisId && row.request.decisionId === input.decisionId
    && ['wallet', 'action', 'inputBaseUnits'].every(key => row.request[key] === input.request[key]);
}
// Only a saved, live, unexpired REVIEW reserve decision of THIS owner, for this analysis revision and amount, can authorize a supply.
// Missing, foreign, wrong-kind and non-REVIEW decisions share one message so existence is not leaked.
async function requireDecision(db, owner, input, graphRevision, at) {
  const result = await db.query('SELECT analysis FROM falcon_mesh.analyses WHERE owner_id = $1 AND id = $2 AND observation_id = $3', [owner, input.decisionId, RESERVE_DECISION_MARKER]);
  const decision = result.rows[0]?.analysis;
  if (decision?.kind !== 'reserve_scenario_decision' || decision.mode !== 'live' || decision.status !== 'REVIEW' || typeof decision.expiresAt !== 'string') {
    fail('CONFLICT', 'A fresh REVIEW reserve decision for this amount is required.');
  }
  if (Date.parse(decision.expiresAt) <= Date.parse(at)) fail('CONFLICT', 'The reserve decision has expired. Save a new decision before supplying.');
  if (decision.graphRevision !== graphRevision) fail('CONFLICT', 'Reserve decision evidence changed. Save a new decision before supplying.');
  if (BigInt(input.request.inputBaseUnits) > BigInt(decision.scenario.proposedUnits)) fail('CONFLICT', 'The amount exceeds the proposal in the reserve decision. Save a new decision for this amount.');
  return { expiresAt: decision.expiresAt, maxObservationAgeSeconds: decision.scenario.maxObservationAgeSeconds };
}
function requireAnalysis(record, at) {
  if (!record || record.graph?.mode !== 'live' || record.analysis?.mode !== 'live' || record.analysis.status !== 'OBSERVED'
      || record.analysis.policyVersion !== 'mesh-public-evidence/1' || record.analysis.graphRevision !== record.graph.revision) {
    fail('CONFLICT', 'A saved live OBSERVED analysis is required.');
  }
  const evaluated = analyzeLiveGraph(record.graph, { observationId: record.analysis.observationId, maxHops: record.analysis.coverage.maxHops }, at);
  if (evaluated.status !== 'OBSERVED') fail('CONFLICT', 'Live analysis evidence is no longer fresh and complete. Refresh and analyze it again.');
}
function signedBytes(value) {
  if (typeof value !== 'string' || !value || value.length > Math.ceil(1232 / 3) * 4) fail('INVALID_INPUT', 'Signed transaction is invalid or exceeds its size limit.');
  const bytes = Buffer.from(value, 'base64');
  if (!bytes.length || bytes.length > 1232 || bytes.toString('base64') !== value) fail('INVALID_INPUT', 'Signed transaction encoding is invalid.');
  return bytes;
}
const preflightKeys = ['schemaVersion', 'status', 'verification', 'messageSha256', 'checkedAt', 'network', 'simulation', 'costs', 'validity'];
const networkKeys = ['chain', 'network', 'genesisHash', 'rpcHost', 'snapshotSlot'];
const simulationKeys = ['slot', 'err', 'unitsConsumed', 'liquidityDeltaBaseUnits', 'receiptDeltaBaseUnits', 'vaultLiquidityDeltaBaseUnits'];
const costKeys = ['feeLamports', 'feeQuoteSlot', 'rentLamports', 'totalSolLamports', 'walletSolBalanceLamports', 'destinationAta', 'createsDestinationAta', 'accountSize'];
const validityKeys = ['blockhash', 'lastValidBlockHeight', 'observedBlockHeight', 'oraclePublishTime', 'oracleExpiresAt', 'intentExpiresAt', 'decisionExpiresAt', 'expiresAt'];
const U64_MAX = 18446744073709551615n;
function unsignedDecimal(value) { return typeof value === 'string' && /^(0|[1-9][0-9]*)$/.test(value) && BigInt(value) <= U64_MAX; }
function signedDecimal(value) { return typeof value === 'string' && /^(0|-?[1-9][0-9]*)$/.test(value) && BigInt(value) >= -U64_MAX && BigInt(value) <= U64_MAX; }
function safeSlot(value) { return Number.isSafeInteger(value) && value > 0; }
function minTime(...values) { return new Date(Math.min(...values.map(value => Date.parse(value)))).toISOString(); }
function validatePreparedPreflight(intent, request) {
  const invalid = () => fail('INVALID_INPUT', 'Prepared Falcon preflight does not match the lending request.');
  try {
    const pre = intent?.preflight;
    exact(pre, preflightKeys); exact(pre.network, networkKeys); exact(pre.simulation, simulationKeys);
    exact(pre.costs, costKeys); exact(pre.validity, validityKeys);
    if (pre.schemaVersion !== 1 || pre.status !== 'VERIFIED' || pre.verification !== 'falcon-rpc'
        || !/^[a-f0-9]{64}$/.test(pre.messageSha256) || pre.messageSha256 !== intent.messageSha256
        || typeof intent.transactionBase64 !== 'string' || !intent.transactionBase64) invalid();
    const txBytes = signedBytes(intent.transactionBase64);
    const tx = deserializeLendingTransaction(txBytes);
    validateLendingTransaction(tx, intent);
    if (createHash('sha256').update(tx.message.serialize()).digest('hex') !== pre.messageSha256) invalid();
    if (intent.schemaVersion !== 1 || intent.network !== 'devnet' || intent.genesisHash !== C.genesisHash
        || intent.wallet !== request.wallet || intent.action !== request.action || intent.inputBaseUnits !== request.inputBaseUnits) invalid();
    if (pre.network.chain !== 'solana' || pre.network.network !== 'devnet' || pre.network.genesisHash !== C.genesisHash
        || pre.network.rpcHost !== 'api.devnet.solana.com' || !safeSlot(pre.network.snapshotSlot)
        || pre.network.snapshotSlot !== intent.snapshot?.slot) invalid();
    if (!safeSlot(pre.simulation.slot) || pre.simulation.slot < pre.network.snapshotSlot || pre.simulation.err !== null
        || pre.simulation.unitsConsumed !== null && (!Number.isSafeInteger(pre.simulation.unitsConsumed) || pre.simulation.unitsConsumed < 0)
        || !signedDecimal(pre.simulation.liquidityDeltaBaseUnits) || !signedDecimal(pre.simulation.receiptDeltaBaseUnits)
        || !signedDecimal(pre.simulation.vaultLiquidityDeltaBaseUnits)) invalid();
    const liquidityDelta = BigInt(pre.simulation.liquidityDeltaBaseUnits);
    const receiptDelta = BigInt(pre.simulation.receiptDeltaBaseUnits);
    const vaultDelta = BigInt(pre.simulation.vaultLiquidityDeltaBaseUnits);
    if (liquidityDelta === 0n || receiptDelta === 0n || vaultDelta !== -liquidityDelta
        || intent.action === 'supply' && (liquidityDelta >= 0n || receiptDelta <= 0n)
        || intent.action === 'redeem' && (liquidityDelta <= 0n || receiptDelta >= 0n)) invalid();
    if (!unsignedDecimal(pre.costs.feeLamports) || !unsignedDecimal(pre.costs.rentLamports) || !unsignedDecimal(pre.costs.totalSolLamports)
        || !unsignedDecimal(pre.costs.walletSolBalanceLamports) || !safeSlot(pre.costs.feeQuoteSlot)
        || pre.costs.feeQuoteSlot < pre.network.snapshotSlot || pre.costs.accountSize !== 165
        || typeof pre.costs.createsDestinationAta !== 'boolean' || pre.costs.createsDestinationAta !== intent.createDestinationAta) invalid();
    const accounts = deriveAccounts(request.wallet);
    const destination = request.action === 'supply' ? accounts.walletReceipt : accounts.walletLiquidity;
    if (pre.costs.destinationAta !== destination || BigInt(pre.costs.totalSolLamports) !== BigInt(pre.costs.feeLamports) + BigInt(pre.costs.rentLamports)
        || BigInt(pre.costs.totalSolLamports) > BigInt(pre.costs.walletSolBalanceLamports)
        || (pre.costs.createsDestinationAta ? BigInt(pre.costs.rentLamports) <= 0n : BigInt(pre.costs.rentLamports) !== 0n)) invalid();
    const v = pre.validity;
    if (typeof v.blockhash !== 'string' || new PublicKey(v.blockhash).toBase58() !== v.blockhash
        || v.blockhash !== intent.blockhash || !Number.isSafeInteger(v.lastValidBlockHeight) || v.lastValidBlockHeight <= 0
        || !Number.isSafeInteger(v.observedBlockHeight) || v.observedBlockHeight < 0 || v.observedBlockHeight > v.lastValidBlockHeight
        || v.lastValidBlockHeight !== intent.lastValidBlockHeight) invalid();
    timestamp(pre.checkedAt); timestamp(v.oraclePublishTime); timestamp(v.oracleExpiresAt); timestamp(v.expiresAt);
    const oracleAgeSeconds = (Date.parse(v.oracleExpiresAt) - Date.parse(v.oraclePublishTime)) / 1000;
    if (!Number.isSafeInteger(oracleAgeSeconds) || oracleAgeSeconds <= 0
        || Number(intent.snapshot?.decoded?.oracleMaxAgeSeconds) !== oracleAgeSeconds
        || v.expiresAt !== v.oracleExpiresAt || v.intentExpiresAt !== null || v.decisionExpiresAt !== null) invalid();
    return pre;
  } catch (error) {
    if (error instanceof MeshError) throw error;
    invalid();
  }
}
function bindPreflightExpiry(intent, committedAt, decision = null) {
  const preflight = intent.preflight;
  const decisionExpiresAt = decision === null ? null : timestamp(decision.expiresAt);
  const producerAgeSeconds = (Date.parse(preflight.validity.oracleExpiresAt) - Date.parse(preflight.validity.oraclePublishTime)) / 1000;
  const ownerAgeSeconds = decision === null ? producerAgeSeconds : decision.maxObservationAgeSeconds;
  if (!Number.isSafeInteger(ownerAgeSeconds) || ownerAgeSeconds <= 0) fail('CONFLICT', 'Reserve decision observation age is invalid.');
  const oracleExpiresAt = new Date(Date.parse(preflight.validity.oraclePublishTime) + Math.min(producerAgeSeconds, ownerAgeSeconds) * 1000).toISOString();
  const ceiling = new Date(Date.parse(committedAt) + 120000).toISOString();
  const intentExpiresAt = decisionExpiresAt === null ? ceiling : minTime(ceiling, decisionExpiresAt);
  const expiresAt = minTime(oracleExpiresAt, intentExpiresAt);
  if (Date.parse(expiresAt) <= Date.parse(committedAt)) fail('CONFLICT', 'Prepared preflight evidence expired before commit.');
  return { ...intent, preflight: { ...preflight, validity: { ...preflight.validity, oracleExpiresAt,
    intentExpiresAt, decisionExpiresAt, expiresAt } } };
}
function requireBoundPreflight(intent, at, createdAt) {
  const v = intent?.preflight?.validity;
  if (!v || !timestamp(v.intentExpiresAt) || !timestamp(v.expiresAt) || v.decisionExpiresAt !== null && !timestamp(v.decisionExpiresAt)) {
    fail('CONFLICT', 'Prepared preflight validity is missing or malformed.');
  }
  const expected = minTime(v.oracleExpiresAt, v.intentExpiresAt);
  if (v.expiresAt !== expected || v.decisionExpiresAt && Date.parse(v.intentExpiresAt) > Date.parse(v.decisionExpiresAt)
      || createdAt && Date.parse(v.intentExpiresAt) > Date.parse(createdAt) + 120000) fail('CONFLICT', 'Prepared preflight validity bounds changed.');
  if (Date.parse(v.expiresAt) <= Date.parse(at) || Date.parse(v.intentExpiresAt) <= Date.parse(at)) fail('CONFLICT', 'Prepared intent has expired. Prepare a new transaction.');
}

export function createLendingStore(pool, { meshStore, prepareLending, verifySignedLending, readLendingReceipt, now = () => new Date().toISOString() }) {
  const stamp = () => timestamp(now());
  const findIntent = async (client, owner, id) => (await client.query('SELECT * FROM falcon_mesh.lending_intents WHERE owner_id = $1 AND id = $2', [owner, id])).rows[0] ?? null;
  const findRequest = async (client, owner, requestId) => (await client.query('SELECT * FROM falcon_mesh.lending_intents WHERE owner_id = $1 AND request_id = $2', [owner, requestId])).rows[0] ?? null;
  const findEvent = async (client, owner, requestId) => (await client.query('SELECT * FROM falcon_mesh.lending_events WHERE owner_id = $1 AND request_id = $2', [owner, requestId])).rows[0] ?? null;
  const findSubmission = async (client, owner, id) => (await client.query("SELECT * FROM falcon_mesh.lending_events WHERE owner_id = $1 AND intent_id = $2 AND kind = 'SUBMITTED'", [owner, id])).rows[0] ?? null;

  async function write(owner, work, publicBinding = false) {
    const client = await pool.connect();
    let releaseError;
    try {
      await client.query('BEGIN');
      if (publicBinding) await lockPublicGraph(client, 'shared');
      await lockMeshOwner(client, owner);
      const result = await work(client);
      await client.query('COMMIT');
      return result;
    } catch (error) {
      try { await client.query('ROLLBACK'); } catch (rollbackError) { releaseError = rollbackError; }
      throw error;
    } finally { client.release(releaseError); }
  }

  function reuseIntent(row, input) {
    if (!sameRequest(row, input)) fail('CONFLICT', 'Lending request ID already has different arguments.');
    requireBoundPreflight(row.intent, stamp(), new Date(row.created_at).toISOString());
    return storedRecord(row);
  }
  function reuseEvent(row, id, kind, transactionSha256) {
    if (row.intent_id !== id || row.kind !== kind || kind === 'SUBMITTED' && row.data.transactionSha256 !== transactionSha256) {
      fail('CONFLICT', 'Lending event request ID already has different arguments.');
    }
    return storedEvent(row);
  }
  function requireUnexpired(row, at) {
    const age = Date.parse(at) - new Date(row.created_at).getTime();
    if (age < 0 || age > 120000) fail('CONFLICT', 'Prepared intent has expired. Prepare a new transaction.');
    requireBoundPreflight(row.intent, at, new Date(row.created_at).toISOString());
  }
  async function currentUnderLock(client, owner, analysis, at, publicBinding = false) {
    requireAnalysis(analysis, at);
    if (publicBinding && (analysis.analysis?.evidenceSource !== 'public'
        || analysis.analysis?.publicGraphRevision !== analysis.graph.revision
        || analysis.analysis?.graphRevision !== analysis.graph.revision)) {
      fail('CONFLICT', 'A current adopted public analysis is required.');
    }
    const sourceOwner = publicBinding ? PUBLIC_OWNER_ID : owner;
    const result = await client.query('SELECT r.revision_id, r.source_key, r.sha256, r.content FROM falcon_mesh.source_heads h ' +
      'JOIN falcon_mesh.source_revisions r ON r.owner_id = h.owner_id AND r.source_key = h.source_key AND r.revision_id = h.revision_id ' +
      'WHERE h.owner_id = $1 ORDER BY h.source_key LIMIT 33', [sourceOwner]);
    if (result.rows.length > 32) fail('CONFLICT', 'Current source coverage exceeds the analysis limit.');
    const live = result.rows.filter(row => JSON.parse(row.content).mode === 'live');
    if (publicBinding) {
      const expected = CONNECTORS.map(connector => 'live:' + connector.id);
      const graphKeys = analysis.graph.sources.map(source => source.sourceKey);
      if (live.length !== expected.length || graphKeys.length !== expected.length
          || expected.some(key => !live.some(row => row.source_key === key) || !graphKeys.includes(key))) {
        fail('CONFLICT', 'The public source bundle changed; do not broadcast this transaction. Refresh, adopt and prepare again.');
      }
    }
    if (live.length !== analysis.graph.sources.length || live.some(row => !analysis.graph.sources.some(source => source.revisionId === row.revision_id && source.sha256 === row.sha256))) {
      fail('CONFLICT', publicBinding
        ? 'The public source bundle changed; do not broadcast this transaction. Refresh, adopt and prepare again.'
        : 'Live source heads changed. Refresh and analyze them again.');
    }
  }
  async function requirePublicDecision(db, owner, input, graphRevision, at) {
    const result = await db.query('SELECT analysis FROM falcon_mesh.analyses WHERE owner_id = $1 AND id = $2 AND observation_id = $3',
      [owner, input.decisionId, RESERVE_DECISION_MARKER]);
    const decision = result.rows[0]?.analysis;
    if (decision?.kind !== 'reserve_scenario_decision' || decision.mode !== 'live' || decision.status !== 'REVIEW'
        || decision.evidenceSource !== 'public' || decision.publicGraphRevision !== graphRevision
        || decision.graphRevision !== graphRevision || decision.sourceAnalysisId !== input.analysisId
        || typeof decision.expiresAt !== 'string') {
      fail('CONFLICT', 'A fresh REVIEW public reserve decision for this analysis and amount is required.');
    }
    if (Date.parse(decision.expiresAt) <= Date.parse(at)) fail('CONFLICT', 'The public reserve decision has expired. Save a new decision before supplying.');
    if (BigInt(input.request.inputBaseUnits) > BigInt(decision.scenario.proposedUnits)) fail('CONFLICT', 'The amount exceeds the proposal in the reserve decision. Save a new decision for this amount.');
    return { expiresAt: decision.expiresAt, maxObservationAgeSeconds: decision.scenario.maxObservationAgeSeconds };
  }

  async function loadPublicAnalysis(client, owner, id) {
    const result = await client.query('SELECT * FROM falcon_mesh.analyses WHERE owner_id = $1 AND id = $2 AND observation_id <> $3',
      [owner, id, RESERVE_DECISION_MARKER]);
    const row = result.rows[0];
    return row ? { id: row.id, requestId: row.request_id, createdAt: new Date(row.created_at).toISOString(), graph: row.graph, analysis: row.analysis } : null;
  }

  async function requireCurrentPublicIntent(client, owner, row, at) {
    if (!row || row.intent?.evidenceSource !== 'public' || row.intent?.sourceAnalysisId !== row.analysis_id
        || typeof row.intent?.publicGraphRevision !== 'string') fail('CONFLICT', 'A current public-bound lending intent is required.');
    const analysis = await loadPublicAnalysis(client, owner, row.analysis_id);
    if (!analysis || analysis.analysis?.evidenceSource !== 'public'
        || analysis.analysis.publicGraphRevision !== row.intent.publicGraphRevision) {
      fail('CONFLICT', 'The public lending analysis is no longer current. Refresh and prepare again.');
    }
    await currentUnderLock(client, owner, analysis, at, true);
    if (analysis.graph.revision !== row.intent.publicGraphRevision) fail('CONFLICT', 'The public lending intent is stale. Refresh and prepare again.');
    if (row.request.action === 'supply') {
      await requirePublicDecision(client, owner, {
        analysisId: row.analysis_id, decisionId: row.request.decisionId,
        request: { inputBaseUnits: row.request.inputBaseUnits },
      }, row.intent.publicGraphRevision, at);
    }
    return analysis;
  }

  async function insertEvent(client, owner, id, requestId, kind, data, at) {
    const encoded = jsonObject(data);
    const result = await client.query(`
      INSERT INTO falcon_mesh.lending_events (owner_id, intent_id, id, request_id, created_at, kind, data)
      VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb) RETURNING *`, [owner, id, randomUUID(), requestId, at, kind, encoded]);
    return storedEvent(result.rows[0]);
  }

  async function submitPublic(owner, id, input, requestId, transactionSha256) {
    const preflight = await write(owner, async client => {
      const row = await findIntent(client, owner, id);
      if (!row) fail('NOT_FOUND', 'Lending intent not found.');
      await requireCurrentPublicIntent(client, owner, row, stamp());
      const repeated = await findEvent(client, owner, requestId);
      if (repeated) return { event: reuseEvent(repeated, id, 'SUBMITTED', transactionSha256) };
      const existing = await findSubmission(client, owner, id);
      if (existing) return { event: reuseEvent(existing, id, 'SUBMITTED', transactionSha256) };
      return { row };
    }, true);
    if (preflight.event) return preflight.event;

    const row = preflight.row;
    verifyLendingVersions(row.intent);
    requireUnexpired(row, stamp());
    const signature = await verifySignedLending(row.intent, input.transactionBase64);
    if (typeof signature !== 'string' || !SIGNATURE.test(signature)) fail('INVALID_INPUT', 'Verified transaction signature is invalid.');
    return write(owner, async client => {
      const current = await findIntent(client, owner, id);
      if (!current) fail('NOT_FOUND', 'Lending intent not found.');
      const at = stamp();
      await requireCurrentPublicIntent(client, owner, current, at);
      const duplicate = await findEvent(client, owner, requestId);
      if (duplicate) return reuseEvent(duplicate, id, 'SUBMITTED', transactionSha256);
      const registered = await findSubmission(client, owner, id);
      if (registered) return reuseEvent(registered, id, 'SUBMITTED', transactionSha256);
      const reused = await client.query("SELECT intent_id FROM falcon_mesh.lending_events WHERE owner_id = $1 AND kind = 'SUBMITTED' AND data->>'signature' = $2 LIMIT 1", [owner, signature]);
      if (reused.rows.length) fail('CONFLICT', 'This signature is already registered to another lending intent. Open its retained history.');
      requireUnexpired(current, at);
      return insertEvent(client, owner, id, requestId, 'SUBMITTED', { signature, transactionSha256, transactionBase64: input.transactionBase64 }, at);
    }, true);
  }

  const methods = {
    async prepare(owner, input) {
      ownerId(owner);
      const normalized = requestFields(input);
      const existing = await findRequest(pool, owner, normalized.requestId);
      if (existing) return reuseIntent(existing, normalized);
      const analysis = await meshStore.getAnalysis(owner, normalized.analysisId);
      if (!analysis) fail('NOT_FOUND', 'Analysis not found.');
      const at = stamp();
      requireAnalysis(analysis, at);
      // Fail before the adapter spends any RPC; the same rule is enforced again under the owner lock below.
      const decisionExpiresAt = normalized.decisionId
        ? await requireDecision(pool, owner, normalized, analysis.analysis.graphRevision, at) : null;
      const current = await meshStore.getGraph(owner, at, 'live');
      if (current.revision !== analysis.graph.revision) fail('CONFLICT', 'Live source heads changed. Refresh and analyze them again.');
      const intent = await prepareLending(normalized.request);
      validatePreparedPreflight(intent, normalized.request);
      return write(owner, async client => {
        const winner = await findRequest(client, owner, normalized.requestId);
        if (winner) return reuseIntent(winner, normalized);
        const committedAt = stamp();
        await currentUnderLock(client, owner, analysis, committedAt);
        const committedDecisionExpiresAt = normalized.decisionId
          ? await requireDecision(client, owner, normalized, analysis.analysis.graphRevision, committedAt) : null;
        const encoded = jsonObject(bindPreflightExpiry(intent, committedAt, committedDecisionExpiresAt));
        const result = await client.query(`
          INSERT INTO falcon_mesh.lending_intents (owner_id, id, request_id, analysis_id, created_at, request, intent)
          VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7::jsonb) RETURNING *`,
        [owner, randomUUID(), normalized.requestId, normalized.analysisId, committedAt, jsonObject(normalized.stored, 4096), encoded]);
        return storedRecord(result.rows[0]);
      });
    },

    async preparePublic(owner, input) {
      ownerId(owner);
      const normalized = requestFields(input);
      const preflightAt = stamp();
      const preflight = await write(owner, async client => {
        const existing = await findRequest(client, owner, normalized.requestId);
        if (existing) {
          if (existing.intent?.evidenceSource !== 'public') fail('CONFLICT', 'This request ID belongs to a private lending intent.');
          await requireCurrentPublicIntent(client, owner, existing, preflightAt);
          return { existing };
        }
        const analysis = await loadPublicAnalysis(client, owner, normalized.analysisId);
        if (!analysis) fail('CONFLICT', 'A current adopted public program analysis is required.');
        await currentUnderLock(client, owner, analysis, preflightAt, true);
        const decisionExpiresAt = normalized.decisionId
          ? await requirePublicDecision(client, owner, normalized, analysis.graph.revision, preflightAt) : null;
        return { analysis, decisionExpiresAt };
      }, true);
      if (preflight.existing) return reuseIntent(preflight.existing, normalized);

      const prepared = await prepareLending(normalized.request);
      validatePreparedPreflight(prepared, normalized.request);
      const intent = {
        ...prepared, evidenceSource: 'public',
        publicGraphRevision: preflight.analysis.graph.revision, sourceAnalysisId: preflight.analysis.id,
      };
      return write(owner, async client => {
        const winner = await findRequest(client, owner, normalized.requestId);
        if (winner) {
          if (winner.intent?.evidenceSource !== 'public') fail('CONFLICT', 'This request ID belongs to a private lending intent.');
          await requireCurrentPublicIntent(client, owner, winner, stamp());
          return reuseIntent(winner, normalized);
        }
        const committedAt = stamp();
        const analysis = await loadPublicAnalysis(client, owner, normalized.analysisId);
        if (!analysis) fail('CONFLICT', 'A current adopted public program analysis is required.');
        await currentUnderLock(client, owner, analysis, committedAt, true);
        if (analysis.graph.revision !== intent.publicGraphRevision) fail('CONFLICT', 'The public graph changed during preparation. Prepare again.');
        const committedDecisionExpiresAt = normalized.decisionId
          ? await requirePublicDecision(client, owner, normalized, analysis.graph.revision, committedAt) : null;
        const encoded = jsonObject(bindPreflightExpiry(intent, committedAt, committedDecisionExpiresAt));
        const result = await client.query('INSERT INTO falcon_mesh.lending_intents (owner_id, id, request_id, analysis_id, created_at, request, intent) VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7::jsonb) RETURNING *',
          [owner, randomUUID(), normalized.requestId, normalized.analysisId, committedAt, jsonObject(normalized.stored, 4096), encoded]);
        return storedRecord(result.rows[0]);
      }, true);
    },

    async get(owner, id) {
      ownerId(owner); id = uuid(id);
      const row = await findIntent(pool, owner, id);
      if (!row) return null;
      const events = await pool.query(`SELECT * FROM falcon_mesh.lending_events WHERE owner_id = $1 AND intent_id = $2
        ORDER BY created_at ASC, CASE WHEN kind = 'SUBMITTED' THEN 0 ELSE 1 END, id ASC`, [owner, id]);
      return { record: storedRecord(row), events: events.rows.map(storedEvent) };
    },

    async list(owner) {
      ownerId(owner);
      const result = await pool.query(`
        SELECT i.id, i.request_id, i.analysis_id, i.created_at, i.request,
          submitted.data->>'signature' AS signature,
          COALESCE(receipt.data->>'status', CASE WHEN submitted.id IS NULL THEN 'PREPARED' ELSE 'SUBMITTED' END) AS status
        FROM falcon_mesh.lending_intents i
        LEFT JOIN LATERAL (SELECT e.id, e.data FROM falcon_mesh.lending_events e
          WHERE e.owner_id = i.owner_id AND e.intent_id = i.id AND e.kind = 'SUBMITTED' LIMIT 1) submitted ON true
        LEFT JOIN LATERAL (SELECT e.data FROM falcon_mesh.lending_events e
          WHERE e.owner_id = i.owner_id AND e.intent_id = i.id AND e.kind = 'RECEIPT'
          ORDER BY (e.data->>'status' = 'CONFIRMED') DESC, e.created_at DESC, e.id DESC LIMIT 1) receipt ON true
        WHERE i.owner_id = $1 ORDER BY i.created_at DESC, i.id DESC LIMIT 20`, [owner]);
      return result.rows.map(row => ({ id: row.id, requestId: row.request_id, analysisId: row.analysis_id, createdAt: new Date(row.created_at).toISOString(), request: row.request, status: row.status, signature: row.signature }));
    },

    async submit(owner, id, input) {
      ownerId(owner); id = uuid(id);
      exact(input, ['requestId', 'transactionBase64']);
      const requestId = uuid(input.requestId);
      const transactionSha256 = createHash('sha256').update(signedBytes(input.transactionBase64)).digest('hex');
      const row = await findIntent(pool, owner, id);
      if (!row) fail('NOT_FOUND', 'Lending intent not found.');
      if (row.intent?.evidenceSource === 'public') return submitPublic(owner, id, input, requestId, transactionSha256);
      const repeated = await findEvent(pool, owner, requestId);
      if (repeated) return reuseEvent(repeated, id, 'SUBMITTED', transactionSha256);
      const existing = await findSubmission(pool, owner, id);
      if (existing) return reuseEvent(existing, id, 'SUBMITTED', transactionSha256);
      verifyLendingVersions(row.intent);
      requireUnexpired(row, stamp());
      const signature = await verifySignedLending(row.intent, input.transactionBase64);
      if (typeof signature !== 'string' || !SIGNATURE.test(signature)) fail('INVALID_INPUT', 'Verified transaction signature is invalid.');
      const analysis = await meshStore.getAnalysis(owner, row.analysis_id);
      return write(owner, async client => {
        const duplicate = await findEvent(client, owner, requestId);
        if (duplicate) return reuseEvent(duplicate, id, 'SUBMITTED', transactionSha256);
        const registered = await findSubmission(client, owner, id);
        if (registered) return reuseEvent(registered, id, 'SUBMITTED', transactionSha256);
        const reused = await client.query("SELECT intent_id FROM falcon_mesh.lending_events WHERE owner_id = $1 AND kind = 'SUBMITTED' AND data->>'signature' = $2 LIMIT 1", [owner, signature]);
        if (reused.rows.length) fail('CONFLICT', 'This signature is already registered to another lending intent. Open its retained history.');
        const at = stamp(); requireUnexpired(row, at);
        await currentUnderLock(client, owner, analysis, at);
        return insertEvent(client, owner, id, requestId, 'SUBMITTED', { signature, transactionSha256, transactionBase64: input.transactionBase64 }, at);
      });
    },

    async receipt(owner, id, input) {
      ownerId(owner); id = uuid(id);
      exact(input, ['requestId']);
      const requestId = uuid(input.requestId);
      const row = await findIntent(pool, owner, id);
      if (!row) fail('NOT_FOUND', 'Lending intent not found.');
      const repeated = await findEvent(pool, owner, requestId);
      if (repeated) return reuseEvent(repeated, id, 'RECEIPT');
      verifyLendingVersions(row.intent);
      const submitted = await findSubmission(pool, owner, id);
      if (!submitted) fail('CONFLICT', 'Register the signed transaction before checking its receipt.');
      const data = await readLendingReceipt(row.intent, submitted.data.signature);
      jsonObject(data);
      if (!RECEIPT_STATUSES.includes(data.status) || data.signature !== submitted.data.signature) fail('INVALID_INPUT', 'Receipt does not match the registered transaction.');
      return write(owner, async client => {
        const duplicate = await findEvent(client, owner, requestId);
        if (duplicate) return reuseEvent(duplicate, id, 'RECEIPT');
        return insertEvent(client, owner, id, requestId, 'RECEIPT', data, stamp());
      });
    },
  };
  return Object.fromEntries(Object.entries(methods).map(([name, method]) => [name, async (...args) => {
    try { return await method(...args); }
    catch (error) {
      if (error instanceof MeshError) throw error;
      throw new MeshError('STORAGE_UNAVAILABLE', 'Lending storage or verification could not complete the request.');
    }
  }]));
}
