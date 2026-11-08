import { createHash, randomUUID } from 'node:crypto';
import { MeshError } from '../domain.mjs';
import { canonicalWalletAddress, deriveWalletOwnerId } from '../wallet-auth.mjs';
import { canonicalBytes, sha256, stableStringify } from '../council/evidence.ts';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const OWNER = /^wallet_[0-9a-f]{56}$/;
const KINDS = new Set(['wallet', 'mandate', 'delegation', 'portfolio', 'runner', 'action', 'accounting', 'review']);
const TERMINAL = new Set(['CONFIRMED', 'FAILED', 'REFUNDED']);
const PRIVATE_KEYS = new Set(['accesstoken', 'appsecret', 'authorizationprivatekey', 'privatekey', 'seedphrase', 'userjwt']);
const MAX_BYTES = 192 * 1024;


function ownerLockKey(owner) {
  validateOwner(owner);
  return createHash('sha256').update('falcon_mesh:' + owner, 'utf8').digest().readBigInt64BE().toString();
}
export function lifecycleError(code, message) { return new MeshError(code, message); }
export function validateOwner(owner) {
  if (typeof owner !== 'string' || !OWNER.test(owner)) throw lifecycleError('INVALID_INPUT', 'A verified wallet owner is required.');
  return owner;
}
export function ownerWallet(owner, wallet) {
  validateOwner(owner);
  const address = canonicalWalletAddress(wallet);
  if (deriveWalletOwnerId(address) !== owner) throw lifecycleError('UNAUTHORIZED', 'Wallet does not match the verified owner.');
  return address;
}
export function requestId(value) {
  if (typeof value !== 'string' || !UUID.test(value)) throw lifecycleError('INVALID_INPUT', 'A UUID request identifier is required.');
  return value.toLowerCase();
}
export function recordHash(value) { return sha256(canonicalBytes(value)); }
export function cloneRecord(value) {
  let nodes = 0;
  const visit = (item, depth = 0) => {
    if (++nodes > 16000 || depth > 24) throw lifecycleError('TOO_LARGE', 'Financial record is too large.');
    if (item === null || typeof item === 'boolean') return;
    if (typeof item === 'string') {
      if (Buffer.byteLength(item, 'utf8') > MAX_BYTES) throw lifecycleError('TOO_LARGE', 'Financial record string is too large.');
      return;
    }
    if (typeof item === 'number' && Number.isFinite(item)) return;
    if (!item || typeof item !== 'object' || (!Array.isArray(item) && ![Object.prototype, null].includes(Object.getPrototypeOf(item)))) {
      throw lifecycleError('INVALID_INPUT', 'Financial records require plain JSON data.');
    }
    for (const [key, entry] of Object.entries(item)) {
      if (PRIVATE_KEYS.has(key.toLowerCase())) throw lifecycleError('INVALID_INPUT', 'Credentials cannot be retained in financial records.');
      visit(entry, depth + 1);
    }
  };
  visit(value);
  let encoded;
  try { encoded = JSON.stringify(value); } catch { throw lifecycleError('INVALID_INPUT', 'Financial record is not serializable.'); }
  if (Buffer.byteLength(encoded, 'utf8') > MAX_BYTES) throw lifecycleError('TOO_LARGE', 'Financial record exceeds its size limit.');
  return JSON.parse(encoded);
}

// NEAR CFO and lending use exactly the same owner lock. Only DB work belongs in callbacks.
export function createOwnerTransaction(pool) {
  if (!pool || typeof pool.connect !== 'function') throw new TypeError('A PostgreSQL pool is required.');
  return async (owner, work) => {
    validateOwner(owner);
    const lock = ownerLockKey(owner);
    for (let attempt = 0; attempt < 3; attempt += 1) {
      let client;
      try { client = await pool.connect(); } catch { throw lifecycleError('STORAGE_UNAVAILABLE', 'Financial storage is unavailable.'); }
      let releaseError;
      try {
        await client.query('BEGIN');
        await client.query('SELECT pg_advisory_xact_lock($1::bigint)', [lock]);
        const result = await work(client);
        await client.query('COMMIT');
        return result;
      } catch (error) {
        try { await client.query('ROLLBACK'); } catch (rollbackError) { releaseError = rollbackError; }
        if (!releaseError && ['40001', '40P01'].includes(error?.code) && attempt < 2) continue;
        throw error instanceof MeshError ? error : lifecycleError('STORAGE_UNAVAILABLE', 'Financial storage could not complete the request.');
      } finally { client.release(releaseError); }
    }
    throw lifecycleError('STORAGE_UNAVAILABLE', 'Financial transaction could not complete.');
  };
}

export async function databaseTime(client) {
  const result = await client.query(`SELECT to_char(clock_timestamp() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS now`);
  const at = result.rows?.[0]?.now;
  if (typeof at !== 'string' || !Number.isFinite(Date.parse(at)) || new Date(at).toISOString() !== at) {
    throw lifecycleError('STORAGE_UNAVAILABLE', 'Financial database clock is unavailable.');
  }
  return at;
}

export async function openFinancialActions(client, owner) {
  const result = await client.query(`SELECT DISTINCT ON (analysis->>'recordKind', analysis->'data'->>'actionId')
      analysis->>'recordKind' AS record_kind, analysis->'data'->>'actionId' AS action_id,
      analysis->'data'->>'status' AS status
    FROM falcon_mesh.analyses WHERE owner_id=$1 AND analysis->>'recordKind'=ANY($2::text[])
    ORDER BY analysis->>'recordKind', analysis->'data'->>'actionId', COALESCE((analysis->>'sequence')::bigint,0) DESC`,
  [owner, ['cfo/action/1', 'cfo/lending-action/1']]);
  return result.rows.filter(row => !TERMINAL.has(row.status)).map(row => row.action_id);
}

function tag(kind) {
  if (!KINDS.has(kind)) throw lifecycleError('INVALID_INPUT', 'Unsupported lending record kind.');
  return 'cfo/lending-' + kind + '/1';
}
function decode(row, owner) {
  if (!row) return null;
  const analysis = row.analysis;
  const kind = typeof analysis?.kind === 'string' ? analysis.kind.replace(/^lending-/, '') : '';
  if (!KINDS.has(kind) || analysis.recordKind !== tag(kind) || row.graph?.domain !== 'cfo') {
    throw lifecycleError('STORAGE_UNAVAILABLE', 'Retained lending record has an invalid domain.');
  }
  const data = cloneRecord(analysis.data);
  ownerWallet(owner, data.wallet);
  const expected = recordHash({ owner, requestId: row.request_id, kind: analysis.kind, data,
    sequence: analysis.sequence, recordId: row.id });
  if (expected !== analysis.contentHash || row.graph.contentHash !== expected) {
    throw lifecycleError('STORAGE_UNAVAILABLE', 'Retained lending record failed integrity validation.');
  }
  return { id: row.id, requestId: row.request_id, createdAt: new Date(row.created_at).toISOString(),
    kind, sequence: analysis.sequence, contentHash: expected, data };
}

export function createLendingJournal(pool) {
  const transaction = createOwnerTransaction(pool);
  return {
    // A session lock spans committed state and bounded external sign/send calls.
    // Nested DB transactions use this same connection, never replay external effects.
    async exclusive(owner, wallet, work) {
      ownerWallet(owner, wallet);
      const client = await pool.connect();
      let locked = false;
      let discard;
      try {
        await client.query('SELECT pg_advisory_lock($1::bigint)', [ownerLockKey(owner)]);
        locked = true;
        const scoped = createLendingJournal({
          connect: async () => ({ query: (...args) => client.query(...args), release() {} }),
        });
        return await work(scoped);
      } finally {
        if (locked) {
          try { await client.query('SELECT pg_advisory_unlock($1::bigint)', [ownerLockKey(owner)]); }
          catch (error) { discard = error; }
        }
        client.release(discard);
      }
    },
    async dueOwners() {
      const result = await pool.query(`SELECT owner_id, analysis->'data' AS data FROM (
        SELECT DISTINCT ON (owner_id) owner_id,analysis FROM falcon_mesh.analyses
        WHERE analysis->>'recordKind'='cfo/lending-runner/1'
        ORDER BY owner_id,COALESCE((analysis->>'sequence')::bigint,0) DESC
      ) heads WHERE analysis->'data'->>'state'='RUNNING'
        AND (analysis->'data'->>'nextRunAt')::timestamptz<=clock_timestamp()
        AND (analysis->'data'->'lease' IS NULL OR analysis->'data'->'lease'='null'::jsonb
          OR (analysis->'data'->'lease'->>'expiresAt')::timestamptz<=clock_timestamp())
      ORDER BY analysis->'data'->>'nextRunAt',owner_id LIMIT 32`);
      return result.rows.map(row => ({ owner: validateOwner(row.owner_id),
        wallet: ownerWallet(row.owner_id, row.data.wallet) }));
    },
    async withOwner(owner, wallet, work) {
      const address = ownerWallet(owner, wallet);
      return transaction(owner, async client => {
        const now = await databaseTime(client);
        const latest = async kind => {
          const result = await client.query(`SELECT id,request_id,created_at,graph,analysis FROM falcon_mesh.analyses
            WHERE owner_id=$1 AND analysis->>'recordKind'=$2
            ORDER BY COALESCE((analysis->>'sequence')::bigint,0) DESC,id DESC LIMIT 1`, [owner, tag(kind)]);
          return decode(result.rows[0], owner);
        };
        const latestFor = async (kind, field, value) => {
          if (!['actionId', 'grantId', 'controlRequestId', 'signature'].includes(field) || typeof value !== 'string' || value.length > 128) {
            throw lifecycleError('INVALID_INPUT', 'Financial record selector is invalid.');
          }
          const result = await client.query(`SELECT id,request_id,created_at,graph,analysis FROM falcon_mesh.analyses
            WHERE owner_id=$1 AND analysis->>'recordKind'=$2 AND analysis->'data'->>$3=$4
            ORDER BY COALESCE((analysis->>'sequence')::bigint,0) DESC,id DESC LIMIT 1`,
          [owner, tag(kind), field, value]);
          return decode(result.rows[0], owner);
        };
        const byRequest = async value => {
          const result = await client.query('SELECT id,request_id,created_at,graph,analysis FROM falcon_mesh.analyses WHERE owner_id=$1 AND request_id=$2', [owner, requestId(value)]);
          if (!result.rows.length) return null;
          if (!String(result.rows[0].analysis?.recordKind || '').startsWith('cfo/lending-')) {
            throw lifecycleError('CONFLICT', 'Request identifier belongs to a different owner operation.');
          }
          return decode(result.rows[0], owner);
        };
        const list = async (kind, limit = 100) => {
          if (!Number.isSafeInteger(limit) || limit < 1 || limit > 200) throw lifecycleError('INVALID_INPUT', 'History limit is invalid.');
          const result = await client.query(`SELECT id,request_id,created_at,graph,analysis FROM falcon_mesh.analyses
            WHERE owner_id=$1 AND analysis->>'recordKind'=$2 ORDER BY COALESCE((analysis->>'sequence')::bigint,0) DESC,id DESC LIMIT $3`, [owner, tag(kind), limit]);
          return result.rows.map(row => decode(row, owner));
        };
        const append = async ({ kind, data, requestId: inputId = randomUUID(), expectedHeadId, exclusiveAction = false }) => {
          const id = requestId(inputId);
          const clean = cloneRecord(data);
          if (clean.wallet !== address) throw lifecycleError('UNAUTHORIZED', 'Retained lending wallet must match its owner.');
          const prior = await byRequest(id);
          if (prior) {
            if (prior.kind !== kind || stableStringify(prior.data) !== stableStringify(clean)) throw lifecycleError('CONFLICT', 'Request identifier is bound to different content.');
            return { record: prior, inserted: false };
          }
          if (expectedHeadId !== undefined && (await latest(kind))?.id !== expectedHeadId) {
            if (!(expectedHeadId === null && await latest(kind) === null)) throw lifecycleError('CONFLICT', 'Financial state changed before the transition.');
          }
          if (exclusiveAction && (await openFinancialActions(client, owner)).length) throw lifecycleError('CONFLICT', 'An unresolved owner action already reserves funds.');
          const sequenceResult = await client.query(`SELECT (COALESCE(MAX((analysis->>'sequence')::bigint),0)+1)::text AS next_sequence FROM falcon_mesh.analyses WHERE owner_id=$1 AND graph->>'domain'='cfo'`, [owner]);
          const sequence = sequenceResult.rows[0]?.next_sequence;
          if (!/^[1-9][0-9]*$/.test(sequence || '')) throw lifecycleError('STORAGE_UNAVAILABLE', 'Financial append sequence is unavailable.');
          const recordId = randomUUID();
          const qualifiedKind = 'lending-' + kind;
          const contentHash = recordHash({ owner, requestId: id, kind: qualifiedKind, data: clean, sequence, recordId });
          const graph = { schemaVersion: 1, domain: 'cfo', recordKind: tag(kind), wallet: address, sequence, contentHash, executionReady: false };
          const analysis = { schemaVersion: 1, recordKind: tag(kind), kind: qualifiedKind, requestId: id, wallet: address, sequence, contentHash, data: clean };
          const at = await databaseTime(client);
          const result = await client.query(`INSERT INTO falcon_mesh.analyses(owner_id,id,request_id,created_at,observation_id,max_hops,graph,analysis)
            VALUES($1,$2,$3,$4,$5,1,$6::jsonb,$7::jsonb) RETURNING id,request_id,created_at,graph,analysis`,
          [owner, recordId, id, at, 'cfo:lending-' + kind, JSON.stringify(graph), JSON.stringify(analysis)]);
          return { record: decode(result.rows[0], owner), inserted: true };
        };
        return work({ now, latest, latestFor, byRequest, list, append, openActions: () => openFinancialActions(client, owner) });
      });
    },
  };
}
