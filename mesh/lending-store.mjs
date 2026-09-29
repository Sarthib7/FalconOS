import { createHash, randomUUID } from 'node:crypto';
import { PublicKey } from '@solana/web3.js';
import { MeshError } from './domain.mjs';
import { analyzeLiveGraph } from './live.mjs';
import { verifyLendingVersions } from './kamino.mjs';

const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const SIGNATURE = /^[1-9A-HJ-NP-Za-km-z]{64,88}$/;
const JSON_LIMIT = 1024 * 1024;
const RECEIPT_STATUSES = ['PENDING', 'FAILED', 'UNVERIFIED', 'CONFIRMED'];

function fail(code, message) { throw new MeshError(code, message); }
function ownerId(owner) {
  if (typeof owner !== 'string' || !/^[a-z0-9_-]{1,64}$/.test(owner)) fail('INVALID_INPUT', 'Owner is invalid.');
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
  exact(input, ['requestId', 'analysisId', 'wallet', 'action', 'inputBaseUnits']);
  const requestId = uuid(input.requestId);
  const analysisId = uuid(input.analysisId);
  try {
    if (typeof input.wallet !== 'string' || new PublicKey(input.wallet).toBase58() !== input.wallet) throw new Error('Invalid wallet');
  } catch { fail('INVALID_INPUT', 'Wallet must be a canonical Solana address.'); }
  if (!['supply', 'redeem'].includes(input.action) || typeof input.inputBaseUnits !== 'string'
      || !/^[1-9][0-9]{0,19}$/.test(input.inputBaseUnits) || BigInt(input.inputBaseUnits) > 18446744073709551615n) {
    fail('INVALID_INPUT', 'Lending action or positive integer amount is invalid.');
  }
  return { requestId, analysisId, request: { wallet: input.wallet, action: input.action, inputBaseUnits: input.inputBaseUnits } };
}
function storedRecord(row) {
  return { id: row.id, requestId: row.request_id, analysisId: row.analysis_id, createdAt: new Date(row.created_at).toISOString(), request: row.request, intent: row.intent };
}
function storedEvent(row) {
  return { id: row.id, requestId: row.request_id, intentId: row.intent_id, createdAt: new Date(row.created_at).toISOString(), kind: row.kind, data: row.data };
}
function sameRequest(row, input) {
  return row.analysis_id === input.analysisId && ['wallet', 'action', 'inputBaseUnits'].every(key => row.request[key] === input.request[key]);
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

export function createLendingStore(pool, { meshStore, prepareLending, verifySignedLending, readLendingReceipt, now = () => new Date().toISOString() }) {
  const stamp = () => timestamp(now());
  const findIntent = async (client, owner, id) => (await client.query('SELECT * FROM falcon_mesh.lending_intents WHERE owner_id = $1 AND id = $2', [owner, id])).rows[0] ?? null;
  const findRequest = async (client, owner, requestId) => (await client.query('SELECT * FROM falcon_mesh.lending_intents WHERE owner_id = $1 AND request_id = $2', [owner, requestId])).rows[0] ?? null;
  const findEvent = async (client, owner, requestId) => (await client.query('SELECT * FROM falcon_mesh.lending_events WHERE owner_id = $1 AND request_id = $2', [owner, requestId])).rows[0] ?? null;
  const findSubmission = async (client, owner, id) => (await client.query("SELECT * FROM falcon_mesh.lending_events WHERE owner_id = $1 AND intent_id = $2 AND kind = 'SUBMITTED'", [owner, id])).rows[0] ?? null;

  async function write(owner, work) {
    const client = await pool.connect();
    let releaseError;
    try {
      await client.query('BEGIN');
      const lock = createHash('sha256').update(`falcon_mesh:${owner}`).digest().readBigInt64BE().toString();
      await client.query('SELECT pg_advisory_xact_lock($1::bigint)', [lock]);
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
  }
  async function currentUnderLock(client, owner, analysis, at) {
    requireAnalysis(analysis, at);
    const result = await client.query(`
      SELECT r.revision_id, r.sha256, r.content FROM falcon_mesh.source_heads h
      JOIN falcon_mesh.source_revisions r ON r.owner_id = h.owner_id AND r.source_key = h.source_key AND r.revision_id = h.revision_id
      WHERE h.owner_id = $1 ORDER BY h.source_key LIMIT 33`, [owner]);
    if (result.rows.length > 32) fail('CONFLICT', 'Current source coverage exceeds the analysis limit.');
    const live = result.rows.filter(row => JSON.parse(row.content).mode === 'live');
    if (live.length !== analysis.graph.sources.length || live.some(row => !analysis.graph.sources.some(source => source.revisionId === row.revision_id && source.sha256 === row.sha256))) {
      fail('CONFLICT', 'Live source heads changed. Refresh and analyze them again.');
    }
  }
  async function insertEvent(client, owner, id, requestId, kind, data, at) {
    const encoded = jsonObject(data);
    const result = await client.query(`
      INSERT INTO falcon_mesh.lending_events (owner_id, intent_id, id, request_id, created_at, kind, data)
      VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb) RETURNING *`, [owner, id, randomUUID(), requestId, at, kind, encoded]);
    return storedEvent(result.rows[0]);
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
      const current = await meshStore.getGraph(owner, at, 'live');
      if (current.revision !== analysis.graph.revision) fail('CONFLICT', 'Live source heads changed. Refresh and analyze them again.');
      const intent = await prepareLending(normalized.request);
      const encoded = jsonObject(intent);
      if (intent.schemaVersion !== 1 || intent.network !== 'devnet' || ['wallet', 'action', 'inputBaseUnits'].some(key => intent[key] !== normalized.request[key])) {
        fail('INVALID_INPUT', 'Prepared intent does not match the lending request.');
      }
      return write(owner, async client => {
        const winner = await findRequest(client, owner, normalized.requestId);
        if (winner) return reuseIntent(winner, normalized);
        const committedAt = stamp();
        await currentUnderLock(client, owner, analysis, committedAt);
        const result = await client.query(`
          INSERT INTO falcon_mesh.lending_intents (owner_id, id, request_id, analysis_id, created_at, request, intent)
          VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7::jsonb) RETURNING *`,
        [owner, randomUUID(), normalized.requestId, normalized.analysisId, committedAt, jsonObject(normalized.request, 4096), encoded]);
        return storedRecord(result.rows[0]);
      });
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
