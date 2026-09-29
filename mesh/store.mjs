import { createHash, randomUUID } from 'node:crypto';
import { MeshError, validateSource, projectGraph, analyzeGraph } from './domain.mjs';
import { CONNECTORS, captureSource as captureLiveSource, validateLiveSource, projectLiveGraph, analyzeLiveGraph } from './live.mjs';

const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const ID = /^[a-zA-Z0-9][a-zA-Z0-9._:/-]{0,127}$/;
const SOURCE_LIMIT = 32;
const SCHEMA_VERSION = 'falcon_mesh_schema_version=2';
const COLUMNS = {
  source_revisions: { owner_id: 'text', revision_id: 'uuid', source_key: 'text', source_url: 'text', observed_at: 'timestamptz', captured_at: 'timestamptz', sha256: 'text', content: 'text' },
  source_heads: { owner_id: 'text', source_key: 'text', revision_id: 'uuid' },
  analyses: { owner_id: 'text', id: 'uuid', request_id: 'uuid', created_at: 'timestamptz', observation_id: 'text', max_hops: 'int2', graph: 'jsonb', analysis: 'jsonb' },
  lending_intents: { owner_id: 'text', id: 'uuid', request_id: 'uuid', analysis_id: 'uuid', created_at: 'timestamptz', request: 'jsonb', intent: 'jsonb' },
  lending_events: { owner_id: 'text', intent_id: 'uuid', id: 'uuid', request_id: 'uuid', created_at: 'timestamptz', kind: 'text', data: 'jsonb' },
};

function invalid(message) { throw new MeshError('INVALID_INPUT', message); }
function ownerId(owner) {
  if (typeof owner !== 'string' || !/^[a-z0-9_-]{1,64}$/.test(owner)) invalid('Owner is invalid.');
}
function uuid(value) {
  if (typeof value !== 'string' || !UUID.test(value)) invalid('Record ID must be a UUID.');
  return value.toLowerCase();
}
function timestamp(at) {
  if (typeof at !== 'string' || !Number.isFinite(Date.parse(at)) || new Date(at).toISOString() !== at) {
    invalid('Time must be a canonical UTC ISO string.');
  }
}
function exactKeys(value, required, optional = []) {
  if (!value || typeof value !== 'object' || Array.isArray(value)
      || required.some(key => !Object.hasOwn(value, key))
      || Object.keys(value).some(key => !required.includes(key) && !optional.includes(key))) {
    invalid('Record fields do not match the schema.');
  }
}
function source(row) {
  return {
    revisionId: row.revision_id, sourceKey: row.source_key, sourceUrl: row.source_url,
    observedAt: new Date(row.observed_at).toISOString(), capturedAt: new Date(row.captured_at).toISOString(),
    sha256: row.sha256, content: row.content,
  };
}
function sourceMetadata(row) {
  const { content, ...metadata } = source(row);
  return metadata;
}
function record(row) {
  return { id: row.id, requestId: row.request_id, createdAt: new Date(row.created_at).toISOString(), graph: row.graph, analysis: row.analysis };
}
function safeError(error) {
  if (error instanceof MeshError) return error;
  return new MeshError('STORAGE_UNAVAILABLE', 'Mesh storage could not complete the request.');
}

async function currentSources(client, owner) {
  const result = await client.query(`
    SELECT r.* FROM falcon_mesh.source_heads h
    JOIN falcon_mesh.source_revisions r
      ON r.owner_id = h.owner_id AND r.source_key = h.source_key AND r.revision_id = h.revision_id
    WHERE h.owner_id = $1 ORDER BY h.source_key LIMIT 33`, [owner]);
  if (result.rows.length > SOURCE_LIMIT) throw new MeshError('TOO_LARGE', 'Owner source limit is 32 documents.');
  return result.rows.map(source);
}

export function createStore(pool, { capture = captureLiveSource, now = () => new Date().toISOString() } = {}) {
  async function transaction(owner, repeatable, work) {
    const lock = createHash('sha256').update(`falcon_mesh:${owner}`).digest().readBigInt64BE().toString();
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const client = await pool.connect();
      let releaseError;
      try {
        await client.query(repeatable ? 'BEGIN ISOLATION LEVEL REPEATABLE READ' : 'BEGIN');
        await client.query('SELECT pg_advisory_xact_lock($1::bigint)', [lock]);
        const result = await work(client);
        await client.query('COMMIT');
        return result;
      } catch (error) {
        try { await client.query('ROLLBACK'); } catch (rollbackError) { releaseError = rollbackError; }
        if (!releaseError && ['40001', '40P01'].includes(error?.code) && attempt < 2) continue;
        throw error;
      } finally { client.release(releaseError); }
    }
  }

  async function saveSources(owner, revisions, at, mode) {
      ownerId(owner); timestamp(at);
      if (!Array.isArray(revisions) || revisions.length < 1 || revisions.length > 4) invalid('Provide between one and four source revisions.');
      const seenIds = new Set();
      const seenKeys = new Set();
      const prepared = revisions.map(input => {
        exactKeys(input, ['revisionId', 'expectedRevisionId', 'content']);
        const revisionId = uuid(input.revisionId);
        const expectedRevisionId = input.expectedRevisionId === null ? null : uuid(input.expectedRevisionId);
        const parsed = mode === 'live' ? validateLiveSource(input.content, at) : validateSource(input.content, at);
        if (mode !== 'live' && parsed.sourceKey.startsWith('live:')) invalid('The live: source prefix is reserved for server captures.');
        if (Buffer.from(input.content, 'utf8').toString('utf8') !== input.content || input.content.includes('\0')) {
          invalid('Source content must be valid UTF-8 text without null bytes.');
        }
        if (seenIds.has(revisionId) || seenKeys.has(parsed.sourceKey)) invalid('A batch must contain distinct revisions and source keys.');
        seenIds.add(revisionId); seenKeys.add(parsed.sourceKey);
        return { revisionId, expectedRevisionId, content: input.content, parsed, sha256: createHash('sha256').update(input.content, 'utf8').digest('hex') };
      });
      return transaction(owner, false, async client => {
        const heads = await client.query('SELECT source_key, revision_id FROM falcon_mesh.source_heads WHERE owner_id = $1 ORDER BY source_key LIMIT 33', [owner]);
        if (heads.rows.length > SOURCE_LIMIT) throw new MeshError('TOO_LARGE', 'Owner source limit is 32 documents.');
        const current = new Map(heads.rows.map(row => [row.source_key, row.revision_id]));
        const saved = [];
        for (const item of prepared) {
          const existing = await client.query('SELECT * FROM falcon_mesh.source_revisions WHERE owner_id = $1 AND revision_id = $2', [owner, item.revisionId]);
          if (existing.rows.length) {
            if (existing.rows[0].content !== item.content) throw new MeshError('CONFLICT', 'Source revision ID already has different content.');
            saved.push(sourceMetadata(existing.rows[0]));
            continue;
          }
          const currentRevision = current.get(item.parsed.sourceKey) ?? null;
          if (currentRevision !== item.expectedRevisionId) throw new MeshError('CONFLICT', 'Source head changed. Refresh before updating it.');
          if (currentRevision === null && current.size >= SOURCE_LIMIT) throw new MeshError('TOO_LARGE', 'Owner source limit is 32 documents.');
          const inserted = await client.query(`
            INSERT INTO falcon_mesh.source_revisions
              (owner_id, revision_id, source_key, source_url, observed_at, captured_at, sha256, content)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *`,
          [owner, item.revisionId, item.parsed.sourceKey, item.parsed.sourceUrl, item.parsed.observedAt, at, item.sha256, item.content]);
          await client.query(`
            INSERT INTO falcon_mesh.source_heads (owner_id, source_key, revision_id) VALUES ($1, $2, $3)
            ON CONFLICT (owner_id, source_key) DO UPDATE SET revision_id = EXCLUDED.revision_id`,
          [owner, item.parsed.sourceKey, item.revisionId]);
          current.set(item.parsed.sourceKey, item.revisionId);
          saved.push(sourceMetadata(inserted.rows[0]));
        }
        return saved;
      });
  }

  function selectedSources(revisions, mode) {
    if (!['synthetic', 'live'].includes(mode)) invalid('Graph mode is invalid.');
    return revisions.filter(revision => JSON.parse(revision.content).mode === mode);
  }
  const methods = {
    async ingestSources(owner, revisions, at) {
      return saveSources(owner, revisions, at, 'synthetic');
    },

    async captureSource(owner, input) {
      ownerId(owner);
      exactKeys(input, ['requestId', 'connectorId', 'expectedRevisionId']);
      const revisionId = uuid(input.requestId);
      const expectedRevisionId = input.expectedRevisionId === null ? null : uuid(input.expectedRevisionId);
      if (!CONNECTORS.some(connector => connector.id === input.connectorId)) invalid('Connector is not registered.');
      const key = `live:${input.connectorId}`;
      function reuse(existing) {
        if (existing.sourceKey !== key || JSON.parse(existing.content).mode !== 'live') {
          throw new MeshError('CONFLICT', 'Capture request ID already belongs to another source.');
        }
        const { content, ...metadata } = existing;
        return metadata;
      }
      const existing = await methods.getSource(owner, revisionId);
      if (existing) return reuse(existing);
      const head = await pool.query('SELECT revision_id FROM falcon_mesh.source_heads WHERE owner_id = $1 AND source_key = $2', [owner, key]);
      if ((head.rows[0]?.revision_id ?? null) !== expectedRevisionId) throw new MeshError('CONFLICT', 'Source head changed. Refresh before capturing it.');
      const content = await capture(input.connectorId, { now });
      const at = now();
      const parsed = validateLiveSource(content, at);
      if (parsed.sourceKey !== key) invalid('Capture does not match its registered connector.');
      try {
        return (await saveSources(owner, [{ revisionId, expectedRevisionId, content }], at, 'live'))[0];
      } catch (error) {
        if (error instanceof MeshError && error.code === 'CONFLICT') {
          const winner = await methods.getSource(owner, revisionId);
          if (winner) return reuse(winner);
        }
        throw error;
      }
    },

    async getGraph(owner, at, mode = 'synthetic') {
      ownerId(owner); timestamp(at);
      const revisions = selectedSources(await currentSources(pool, owner), mode);
      return mode === 'live' ? projectLiveGraph(revisions, at) : projectGraph(revisions, at);
    },

    async getSource(owner, revisionId) {
      ownerId(owner);
      const result = await pool.query('SELECT * FROM falcon_mesh.source_revisions WHERE owner_id = $1 AND revision_id = $2', [owner, uuid(revisionId)]);
      return result.rows.length ? source(result.rows[0]) : null;
    },

    async createAnalysis(owner, query, at, mode = 'synthetic') {
      ownerId(owner); timestamp(at);
      if (!['synthetic', 'live'].includes(mode)) invalid('Analysis mode is invalid.');
      exactKeys(query, ['requestId', 'observationId'], ['maxHops']);
      const requestId = uuid(query.requestId);
      const maxHops = query.maxHops === undefined ? 3 : query.maxHops;
      if (typeof query.observationId !== 'string' || !ID.test(query.observationId)) invalid('Observation ID is invalid.');
      if (!Number.isInteger(maxHops) || maxHops < 1 || maxHops > 3) invalid('maxHops must be between 1 and 3.');
      return transaction(owner, true, async client => {
        const existing = await client.query('SELECT * FROM falcon_mesh.analyses WHERE owner_id = $1 AND request_id = $2', [owner, requestId]);
        if (existing.rows.length) {
          const saved = existing.rows[0];
          if (saved.observation_id !== query.observationId || saved.max_hops !== maxHops || saved.graph.mode !== mode) {
            throw new MeshError('CONFLICT', 'Analysis request ID already has different arguments.');
          }
          return record(saved);
        }
        const revisions = selectedSources(await currentSources(client, owner), mode);
        const graph = mode === 'live' ? projectLiveGraph(revisions, at) : projectGraph(revisions, at);
        const analysis = (mode === 'live' ? analyzeLiveGraph : analyzeGraph)(graph, { observationId: query.observationId, maxHops }, at);
        const saved = await client.query(`
          INSERT INTO falcon_mesh.analyses (owner_id, id, request_id, created_at, observation_id, max_hops, graph, analysis)
          VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8::jsonb)
          ON CONFLICT (owner_id, request_id) DO NOTHING RETURNING *`,
        [owner, randomUUID(), requestId, at, query.observationId, maxHops, JSON.stringify(graph), JSON.stringify(analysis)]);
        if (!saved.rows.length) throw new MeshError('CONFLICT', 'Analysis request changed. Retry with the same request ID.');
        return record(saved.rows[0]);
      });
    },

    async getAnalysis(owner, id) {
      ownerId(owner);
      const result = await pool.query('SELECT * FROM falcon_mesh.analyses WHERE owner_id = $1 AND id = $2', [owner, uuid(id)]);
      return result.rows.length ? record(result.rows[0]) : null;
    },

    async listAnalyses(owner) {
      ownerId(owner);
      const result = await pool.query('SELECT id, created_at, analysis FROM falcon_mesh.analyses WHERE owner_id = $1 ORDER BY created_at DESC, id DESC LIMIT 20', [owner]);
      return result.rows.map(row => ({ id: row.id, createdAt: new Date(row.created_at).toISOString(), analysis: row.analysis }));
    },

    async ready() {
      const marker = await pool.query("SELECT obj_description(oid, 'pg_namespace') AS version FROM pg_namespace WHERE nspname = 'falcon_mesh'");
      if (marker.rows[0]?.version !== SCHEMA_VERSION) throw new MeshError('STORAGE_UNAVAILABLE', 'Mesh schema version is not ready.');
      const result = await pool.query(`
        SELECT c.table_name, c.column_name, c.udt_name, c.is_nullable
        FROM information_schema.columns c JOIN information_schema.tables t
          ON t.table_schema = c.table_schema AND t.table_name = c.table_name
        WHERE c.table_schema = 'falcon_mesh' AND t.table_type = 'BASE TABLE'
          AND c.table_name IN ('source_revisions', 'source_heads', 'analyses', 'lending_intents', 'lending_events')`);
      const expected = Object.entries(COLUMNS).flatMap(([table, columns]) => Object.entries(columns).map(([column, type]) => `${table}.${column}:${type}:NO`)).sort();
      const actual = result.rows.map(row => `${row.table_name}.${row.column_name}:${row.udt_name}:${row.is_nullable}`).sort();
      if (expected.length !== actual.length || expected.some((value, index) => value !== actual[index])) {
        throw new MeshError('STORAGE_UNAVAILABLE', 'Mesh schema columns are not ready.');
      }
      return true;
    },
  };
  return Object.fromEntries(Object.entries(methods).map(([name, method]) => [name, async (...args) => {
    try { return await method(...args); } catch (error) { throw safeError(error); }
  }]));
}
