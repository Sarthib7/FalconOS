import { createHash, randomUUID } from 'node:crypto';
import { MeshError, validateSource, projectGraph, analyzeGraph } from './domain.mjs';
import { CONNECTORS, captureSource as captureLiveSource, validateLiveSource, projectLiveGraph, analyzeLiveGraph } from './live.mjs';
import { RESERVE_DECISION_MARKER, parseScenario, evaluateReserveScenario } from './scenario.mjs';
import { PUBLIC_OWNER_ID, PUBLIC_PROGRAM_OBSERVATION, PUBLIC_RESERVE_OBSERVATION, lockPublicGraph } from './public-graph.mjs';
import { canonicalBytes, sha256, stableStringify } from './council/evidence.ts';
import { NEAR_REVENUE_ADAPTER_VERSION, NEAR_REVENUE_SOURCE_URL, inspectNearPacket } from './research/near-source.mjs';

const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const ID = /^[a-zA-Z0-9][a-zA-Z0-9._:/-]{0,127}$/;
const SOURCE_LIMIT = 32;
const SCHEMA_VERSION = 'falcon_mesh_schema_version=3';
const RESEARCH_SOURCE_KEY = 'research:near';
const RESEARCH_PART_PREFIX = 'research:near:packet:';
const RESEARCH_MANIFEST_KIND = 'near-research/manifest';
const RESEARCH_ANALYSIS_KIND = 'near-research/adopted/1';
const RESEARCH_NO_DATA_KIND = 'near-research/no-data/1';
const COLUMNS = {
  source_revisions: { owner_id: 'text', revision_id: 'uuid', source_key: 'text', source_url: 'text', observed_at: 'timestamptz', captured_at: 'timestamptz', sha256: 'text', content: 'text' },
  source_heads: { owner_id: 'text', source_key: 'text', revision_id: 'uuid' },
  analyses: { owner_id: 'text', id: 'uuid', request_id: 'uuid', created_at: 'timestamptz', observation_id: 'text', max_hops: 'int2', graph: 'jsonb', analysis: 'jsonb' },
  lending_intents: { owner_id: 'text', id: 'uuid', request_id: 'uuid', analysis_id: 'uuid', created_at: 'timestamptz', request: 'jsonb', intent: 'jsonb' },
  lending_events: { owner_id: 'text', intent_id: 'uuid', id: 'uuid', request_id: 'uuid', created_at: 'timestamptz', kind: 'text', data: 'jsonb' },
};

function invalid(message) { throw new MeshError('INVALID_INPUT', message); }
function ownerId(owner) {
  if (typeof owner !== 'string' || owner === PUBLIC_OWNER_ID || !/^[a-z0-9_-]{1,64}$/.test(owner)) invalid('Owner is invalid.');
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

function researchObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    && [Object.prototype, null].includes(Object.getPrototypeOf(value));
}

function readResearchManifest(row) {
  let manifest;
  try {
    if (sha256(new TextEncoder().encode(row.content)) !== row.sha256) throw new Error();
    manifest = JSON.parse(row.content);
  } catch {
    throw new MeshError('STORAGE_UNAVAILABLE', 'Retained research manifest is corrupt.');
  }
  const expected = ['schemaVersion', 'recordKind', 'caseId', 'snapshotHash', 'sourceRefs', 'rawParts', 'status', 'case'];
  if (!researchObject(manifest) || Object.keys(manifest).length !== expected.length
    || expected.some(key => !Object.hasOwn(manifest, key)) || manifest.schemaVersion !== 1
    || manifest.recordKind !== RESEARCH_MANIFEST_KIND || manifest.caseId !== manifest.case?.caseId
    || manifest.case?.manifestRevisionId !== row.revision_id || manifest.case?.caseId === undefined
    || manifest.snapshotHash !== manifest.case?.snapshotHash || manifest.status !== manifest.case?.status
    || !Array.isArray(manifest.sourceRefs) || !Array.isArray(manifest.rawParts)
    || stableStringify(manifest.sourceRefs) !== stableStringify(manifest.case?.sourceRefs)) {
    throw new MeshError('STORAGE_UNAVAILABLE', 'Retained research manifest is invalid.');
  }
  return manifest;
}

function prepareResearchPublication(input) {
  exactKeys(input, ['case', 'packet', 'expectedManifestRevisionId']);
  const value = input.case;
  const caseKeys = ['schemaVersion', 'caseType', 'caseId', 'requestId', 'createdAt', 'status', 'snapshot', 'snapshotHash', 'modelResult', 'sourceRefs', 'manifestRevisionId', 'issues', 'executionReady'];
  exactKeys(value, caseKeys);
  if (value.schemaVersion !== 1 || value.caseType !== 'near-thesis' || !['OBSERVED', 'NO_DATA'].includes(value.status)
    || value.executionReady !== false || !Array.isArray(value.sourceRefs) || value.sourceRefs.length > 3
    || !Array.isArray(value.issues) || value.issues.length > 32
    || value.issues.some(issue => typeof issue !== 'string' || issue.length < 1 || Buffer.byteLength(issue, 'utf8') > 512)) {
    invalid('Research case fields are invalid.');
  }
  uuid(value.caseId); uuid(value.requestId); uuid(value.manifestRevisionId); timestamp(value.createdAt);
  const refs = value.sourceRefs.map(ref => {
    exactKeys(ref, ['revisionId', 'sha256']);
    return { revisionId: uuid(ref.revisionId), sha256: ref.sha256 };
  });
  if (refs.some(ref => !/^[a-f0-9]{64}$/.test(ref.sha256))
    || new Set(refs.map(ref => ref.revisionId)).size !== refs.length) invalid('Research source references are invalid.');
  let parts = [];
  if (input.packet !== null) {
    try { inspectNearPacket(input.packet); }
    catch { invalid('Research packet failed integrity verification.'); }
    const packet = input.packet;
    if (packet.adapterVersion !== NEAR_REVENUE_ADAPTER_VERSION || packet.sourceUrl !== NEAR_REVENUE_SOURCE_URL
      || packet.parts.length !== refs.length || !refs.length) invalid('Research packet references do not match.');
    const common = {
      schemaVersion: packet.schemaVersion, adapterVersion: packet.adapterVersion,
      sourceKey: packet.sourceKey, sourceUrl: packet.sourceUrl, capturedAt: packet.capturedAt,
      rawBodySha256: packet.rawBodySha256, rawBodyBytes: packet.rawBodyBytes,
      codec: packet.codec, compressedBytes: packet.compressedBytes,
    };
    parts = packet.parts.map((part, index) => {
      const content = stableStringify({ ...common, parts: [part] });
      if (Buffer.byteLength(content, 'utf8') >= 128 * 1024
        || refs[index].sha256 !== sha256(new TextEncoder().encode(content))) invalid('Research part envelope exceeds storage bounds.');
      return {
        revisionId: refs[index].revisionId,
        sourceKey: RESEARCH_PART_PREFIX + value.caseId + ':' + index,
        sourceUrl: NEAR_REVENUE_SOURCE_URL,
        observedAt: packet.capturedAt,
        capturedAt: packet.capturedAt,
        sha256: refs[index].sha256,
        content,
        partSha256: part.sha256,
        partIndex: index,
      };
    });
    if (value.snapshot !== null && (value.snapshot.capturedAt !== packet.capturedAt
      || value.snapshot.rawBodySha256 !== packet.rawBodySha256 || value.snapshot.rawBodyBytes !== packet.rawBodyBytes)) {
      invalid('Research snapshot does not match its retained packet.');
    }
  } else if (refs.length !== 0) invalid('Research source references require a retained packet.');

  if (value.snapshot === null) {
    if (value.status !== 'NO_DATA' || value.snapshotHash !== null || value.modelResult !== null) invalid('A missing research snapshot must be NO_DATA.');
  } else {
    if (input.packet === null || refs.length === 0) invalid('A research snapshot requires retained raw packet parts.');
    const snapshotKeys = ['schemaVersion', 'domain', 'adapterVersion', 'sourceUrl', 'capturedAt', 'rawBodySha256', 'rawBodyBytes', 'sourceRefs', 'modelVersion', 'modelResult'];
    exactKeys(value.snapshot, snapshotKeys);
    if (value.snapshot.schemaVersion !== 1 || value.snapshot.domain !== 'near-thesis'
      || value.snapshot.adapterVersion !== NEAR_REVENUE_ADAPTER_VERSION || value.snapshot.sourceUrl !== NEAR_REVENUE_SOURCE_URL
      || value.snapshot.modelVersion !== 'near-observed/1' || !researchObject(value.modelResult)
      || value.modelResult.executionReady !== false || !['OBSERVED', 'NO_DATA'].includes(value.modelResult.status)
      || value.status !== value.modelResult.status || stableStringify(value.snapshot.sourceRefs) !== stableStringify(refs)
      || stableStringify(value.snapshot.modelResult) !== stableStringify(value.modelResult)
      || value.snapshotHash !== sha256(canonicalBytes(value.snapshot)) || !/^[a-f0-9]{64}$/.test(value.snapshotHash)) {
      invalid('Research snapshot or hash is invalid.');
    }
    timestamp(value.snapshot.capturedAt);
    if (!Number.isSafeInteger(value.snapshot.rawBodyBytes) || value.snapshot.rawBodyBytes < 1 || value.snapshot.rawBodyBytes > 1024 * 1024
      || !/^[a-f0-9]{64}$/.test(value.snapshot.rawBodySha256)) invalid('Research snapshot source metadata is invalid.');
  }
  if (Buffer.byteLength(JSON.stringify(value), 'utf8') >= 96 * 1024) invalid('Research case exceeds storage bounds.');
  if (input.expectedManifestRevisionId !== null) uuid(input.expectedManifestRevisionId);
  return { case: value, refs, parts, expectedManifestRevisionId: input.expectedManifestRevisionId };
}

async function findPublicResearchCase(client, caseId) {
  const result = await client.query('SELECT * FROM falcon_mesh.source_revisions WHERE owner_id = $1 AND source_key = $2 ORDER BY captured_at DESC, revision_id',
    [PUBLIC_OWNER_ID, RESEARCH_SOURCE_KEY]);
  for (const row of result.rows) {
    const manifest = readResearchManifest(row);
    if (manifest.caseId === caseId) return { manifest, row };
  }
  return null;
}

export function createStore(pool, { capture = captureLiveSource, now = () => new Date().toISOString() } = {}) {
  async function transaction(owner, repeatable, work, publicLockMode = null) {
    const lock = createHash('sha256').update(`falcon_mesh:${owner}`).digest().readBigInt64BE().toString();
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const client = await pool.connect();
      let releaseError;
      try {
        await client.query(repeatable && !publicLockMode ? 'BEGIN ISOLATION LEVEL REPEATABLE READ' : 'BEGIN');
        if (publicLockMode) await lockPublicGraph(client, publicLockMode);
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

  async function getPublicResearchBundle() {
    return transaction(PUBLIC_OWNER_ID, false, async client => {
      const sources = await currentSources(client, PUBLIC_OWNER_ID);
      const head = sources.find(source => source.sourceKey === RESEARCH_SOURCE_KEY);
      if (!head) return null;
      const manifest = readResearchManifest({ revision_id: head.revisionId, sha256: head.sha256, content: head.content });
      return { manifestRevisionId: head.revisionId, manifest, case: manifest.case };
    }, 'shared');
  }
  async function getRetainedPublicResearchCase() {
    return transaction(PUBLIC_OWNER_ID, false, async client => {
      const result = await client.query(`
        SELECT r.* FROM falcon_mesh.source_heads h
        JOIN falcon_mesh.source_revisions r
          ON r.owner_id = h.owner_id AND r.source_key = h.source_key AND r.revision_id = h.revision_id
        WHERE h.owner_id = $1 AND h.source_key = $2`,
      [PUBLIC_OWNER_ID, RESEARCH_SOURCE_KEY]);
      if (!result.rows.length) return null;
      return readResearchManifest(result.rows[0]).case;
    }, 'shared');
  }


  async function getPublicResearchCase(caseId) {
    const id = uuid(caseId);
    return transaction(PUBLIC_OWNER_ID, false, async client => {
      const found = await findPublicResearchCase(client, id);
      return found?.manifest.case ?? null;
    }, 'shared');
  }

  async function getPublicResearchSource(revisionId) {
    const id = uuid(revisionId);
    return transaction(PUBLIC_OWNER_ID, false, async client => {
      const result = await client.query('SELECT * FROM falcon_mesh.source_revisions WHERE owner_id = $1 AND revision_id = $2 AND source_key LIKE $3',
        [PUBLIC_OWNER_ID, id, RESEARCH_PART_PREFIX + '%']);
      return result.rows.length ? source(result.rows[0]) : null;
    }, 'shared');
  }

  async function publishPublicResearchCase(input) {
    const prepared = prepareResearchPublication(input);
    const value = prepared.case;
    const manifestRevisionId = uuid(value.manifestRevisionId);
    return transaction(PUBLIC_OWNER_ID, false, async client => {
      const current = await currentSources(client, PUBLIC_OWNER_ID);
      const head = current.find(source => source.sourceKey === RESEARCH_SOURCE_KEY);
      if ((head?.revisionId ?? null) !== prepared.expectedManifestRevisionId) {
        throw new MeshError('CONFLICT', 'The public research manifest changed during capture.');
      }
      if (!head && current.length >= SOURCE_LIMIT) throw new MeshError('TOO_LARGE', 'Public source limit is 32 documents.');
      const priorCase = await findPublicResearchCase(client, value.caseId);
      if (priorCase) throw new MeshError('CONFLICT', 'Research case ID already exists.');
      const ids = [...prepared.parts.map(part => part.revisionId), manifestRevisionId];
      const existingIds = await client.query('SELECT revision_id FROM falcon_mesh.source_revisions WHERE owner_id = $1 AND revision_id = ANY($2::uuid[])',
        [PUBLIC_OWNER_ID, ids]);
      if (existingIds.rows.length) throw new MeshError('CONFLICT', 'Research source revision ID already exists.');
      for (const part of prepared.parts) {
        await client.query('INSERT INTO falcon_mesh.source_revisions (owner_id, revision_id, source_key, source_url, observed_at, captured_at, sha256, content) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)',
          [PUBLIC_OWNER_ID, part.revisionId, part.sourceKey, part.sourceUrl, part.observedAt, part.capturedAt, part.sha256, part.content]);
      }
      const manifest = {
        schemaVersion: 1,
        recordKind: RESEARCH_MANIFEST_KIND,
        caseId: value.caseId,
        snapshotHash: value.snapshotHash,
        sourceRefs: prepared.refs,
        rawParts: prepared.parts.map(part => ({
          revisionId: part.revisionId, sha256: part.sha256, partIndex: part.partIndex, partSha256: part.partSha256,
        })),
        status: value.status,
        case: value,
      };
      const manifestContent = stableStringify(manifest);
      if (Buffer.byteLength(manifestContent, 'utf8') >= 128 * 1024) throw new MeshError('TOO_LARGE', 'Research manifest exceeds 128 KiB.');
      const manifestHash = sha256(new TextEncoder().encode(manifestContent));
      await client.query('INSERT INTO falcon_mesh.source_revisions (owner_id, revision_id, source_key, source_url, observed_at, captured_at, sha256, content) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)',
        [PUBLIC_OWNER_ID, manifestRevisionId, RESEARCH_SOURCE_KEY, NEAR_REVENUE_SOURCE_URL, value.createdAt, value.createdAt, manifestHash, manifestContent]);
      await client.query('INSERT INTO falcon_mesh.source_heads (owner_id, source_key, revision_id) VALUES ($1, $2, $3) ON CONFLICT (owner_id, source_key) DO UPDATE SET revision_id = EXCLUDED.revision_id',
        [PUBLIC_OWNER_ID, RESEARCH_SOURCE_KEY, manifestRevisionId]);
      return { manifestRevisionId, manifest, case: value };
    }, 'shared');
  }

  async function adoptResearchCase(owner, input, at) {
    ownerId(owner); timestamp(at);
    exactKeys(input, ['requestId', 'publicCaseId']);
    const requestId = uuid(input.requestId);
    const publicCaseId = uuid(input.publicCaseId);
    return transaction(owner, false, async client => {
      const existing = await client.query('SELECT * FROM falcon_mesh.analyses WHERE owner_id = $1 AND request_id = $2', [owner, requestId]);
      if (existing.rows.length) {
        const saved = existing.rows[0];
        if (saved.analysis?.publicCaseId !== publicCaseId) {
          throw new MeshError('CONFLICT', 'Research adoption request ID already belongs to another case.');
        }
        if (saved.analysis?.recordKind === RESEARCH_ANALYSIS_KIND && saved.analysis?.snapshotHash
          && saved.analysis?.snapshot && Array.isArray(saved.analysis?.sourceRefs)) {
          return { status: 'ADOPTED', analysisId: saved.id, publicCaseId, snapshotHash: saved.analysis.snapshotHash, sourceRefs: saved.analysis.sourceRefs, executionReady: false };
        }
        if (saved.analysis?.recordKind === RESEARCH_NO_DATA_KIND && saved.analysis?.status === 'NO_DATA'
          && saved.analysis?.snapshotHash === null) {
          return { status: 'NO_DATA', analysisId: null, publicCaseId, snapshotHash: null, sourceRefs: saved.analysis.sourceRefs ?? [], executionReady: false };
        }
        throw new MeshError('CONFLICT', 'Research adoption request ID already belongs to a different record.');
      }

      const found = await findPublicResearchCase(client, publicCaseId);
      if (!found) throw new MeshError('NOT_FOUND', 'Public research case was not found.');
      const savedCase = found.manifest.case;
      if (savedCase.snapshot === null) {
        const graph = {
          schemaVersion: 1, domain: 'near-thesis', caseType: 'near-thesis', publicCaseId,
          snapshot: null, snapshotHash: null, sourceRefs: savedCase.sourceRefs, issues: savedCase.issues,
          status: 'NO_DATA', executionReady: false,
        };
        const analysis = {
          recordKind: RESEARCH_NO_DATA_KIND, status: 'NO_DATA', publicCaseId, snapshot: null, snapshotHash: null,
          sourceRefs: savedCase.sourceRefs, issues: savedCase.issues, evidenceSource: 'public', executionReady: false,
        };
        const saved = await client.query('INSERT INTO falcon_mesh.analyses (owner_id, id, request_id, created_at, observation_id, max_hops, graph, analysis) VALUES ($1, $2, $3, $4, $5, 1, $6::jsonb, $7::jsonb) ON CONFLICT (owner_id, request_id) DO NOTHING RETURNING id',
          [owner, randomUUID(), requestId, at, RESEARCH_SOURCE_KEY + '/' + publicCaseId, JSON.stringify(graph), JSON.stringify(analysis)]);
        if (!saved.rows.length) throw new MeshError('CONFLICT', 'Research adoption request changed. Retry with the same request ID.');
        return { status: 'NO_DATA', analysisId: null, publicCaseId, snapshotHash: null, sourceRefs: savedCase.sourceRefs, executionReady: false };
      }
      if (savedCase.snapshotHash !== sha256(canonicalBytes(savedCase.snapshot))
        || stableStringify(savedCase.snapshot.sourceRefs) !== stableStringify(savedCase.sourceRefs)) {
        throw new MeshError('STORAGE_UNAVAILABLE', 'Retained research snapshot failed integrity verification.');
      }
      const partRows = await client.query('SELECT revision_id, source_key, sha256 FROM falcon_mesh.source_revisions WHERE owner_id = $1 AND revision_id = ANY($2::uuid[]) AND source_key LIKE $3',
        [PUBLIC_OWNER_ID, savedCase.sourceRefs.map(ref => ref.revisionId), RESEARCH_PART_PREFIX + '%']);
      const publicParts = new Map(partRows.rows.map(row => [row.revision_id, row]));
      if (publicParts.size !== savedCase.sourceRefs.length || savedCase.sourceRefs.some((ref, index) => {
        const part = publicParts.get(ref.revisionId);
        return !part || part.sha256 !== ref.sha256 || part.source_key !== RESEARCH_PART_PREFIX + publicCaseId + ':' + index;
      })) throw new MeshError('STORAGE_UNAVAILABLE', 'Retained research source references are incomplete.');
      const graph = {
        schemaVersion: 1, domain: 'near-thesis', caseType: 'near-thesis', publicCaseId,
        snapshotHash: savedCase.snapshotHash, snapshot: savedCase.snapshot, sourceRefs: savedCase.sourceRefs, executionReady: false,
      };
      const analysis = {
        recordKind: RESEARCH_ANALYSIS_KIND, status: savedCase.status, publicCaseId,
        snapshotHash: savedCase.snapshotHash, snapshot: savedCase.snapshot, modelResult: savedCase.modelResult,
        sourceRefs: savedCase.sourceRefs, issues: savedCase.issues, evidenceSource: 'public', executionReady: false,
      };
      if (Buffer.byteLength(JSON.stringify(graph), 'utf8') + Buffer.byteLength(JSON.stringify(analysis), 'utf8') > 192 * 1024) {
        throw new MeshError('TOO_LARGE', 'Research adoption exceeds analysis bounds.');
      }
      const saved = await client.query('INSERT INTO falcon_mesh.analyses (owner_id, id, request_id, created_at, observation_id, max_hops, graph, analysis) VALUES ($1, $2, $3, $4, $5, 1, $6::jsonb, $7::jsonb) ON CONFLICT (owner_id, request_id) DO NOTHING RETURNING *',
        [owner, randomUUID(), requestId, at, RESEARCH_SOURCE_KEY + '/' + publicCaseId, JSON.stringify(graph), JSON.stringify(analysis)]);
      if (!saved.rows.length) throw new MeshError('CONFLICT', 'Research adoption request changed. Retry with the same request ID.');
      return { status: 'ADOPTED', analysisId: saved.rows[0].id, publicCaseId, snapshotHash: savedCase.snapshotHash, sourceRefs: savedCase.sourceRefs, executionReady: false };
    }, 'shared');
  }

  async function publicConnectorSources(client) {
    const sources = await currentSources(client, PUBLIC_OWNER_ID);
    const expected = new Set(CONNECTORS.map(connector => 'live:' + connector.id));
    return sources.filter(source => expected.has(source.sourceKey));
  }

  function selectedSources(revisions, mode) {
    if (!['synthetic', 'live'].includes(mode)) invalid('Graph mode is invalid.');
    return revisions.filter(revision => JSON.parse(revision.content).mode === mode);
  }
  async function getPublicBundle() {
    const sources = await transaction(PUBLIC_OWNER_ID, false, publicConnectorSources, 'shared');
    const expected = CONNECTORS.map(connector => 'live:' + connector.id);
    if (sources.length !== expected.length || expected.some(key => !sources.some(source => source.sourceKey === key))) return null;
    return { sources };
  }

  async function publishPublicBundle(revisions, expectedSources = null) {
    if (!Array.isArray(revisions) || revisions.length !== CONNECTORS.length) invalid('The fixed public source bundle is incomplete.');
    const seenIds = new Set();
    const seenKeys = new Set();
    const prepared = revisions.map(input => {
      exactKeys(input, ['revisionId', 'capturedAt', 'content']);
      const revisionId = uuid(input.revisionId);
      timestamp(input.capturedAt);
      const document = validateLiveSource(input.content, input.capturedAt);
      if (Buffer.from(input.content, 'utf8').toString('utf8') !== input.content || input.content.includes('\0')) invalid('Source content must be valid UTF-8 text without null bytes.');
      if (seenIds.has(revisionId) || seenKeys.has(document.sourceKey)) invalid('The fixed public source bundle contains duplicate identities.');
      if (!CONNECTORS.some(connector => document.sourceKey === 'live:' + connector.id)) invalid('The public source is not registered.');
      seenIds.add(revisionId); seenKeys.add(document.sourceKey);
      return { revisionId, capturedAt: input.capturedAt, content: input.content, document, sha256: createHash('sha256').update(input.content, 'utf8').digest('hex') };
    });
    const expected = CONNECTORS.map(connector => 'live:' + connector.id);
    if (seenKeys.size !== expected.length || expected.some(key => !seenKeys.has(key))) invalid('The fixed public source bundle is incomplete.');
    return transaction(PUBLIC_OWNER_ID, false, async client => {
      const current = await publicConnectorSources(client);
      const unchanged = expectedSources === null ? current.length === 0
        : current.length === expectedSources.length && expectedSources.every(expected => current.some(source =>
          source.revisionId === expected.revisionId && source.sourceKey === expected.sourceKey && source.sha256 === expected.sha256));
      if (!unchanged) throw new MeshError('CONFLICT', 'The public source head changed during capture.');
      if (current.length && (current.length !== expected.length || expected.some(key => !current.some(source => source.sourceKey === key)))) {
        throw new MeshError('CONFLICT', 'The public source bundle is incomplete.');
      }
      const previous = new Map(current.map(source => [source.sourceKey, source]));
      for (const item of prepared) {
        const prior = previous.get(item.document.sourceKey);
        if (prior && Date.parse(item.capturedAt) < Date.parse(prior.capturedAt)) throw new MeshError('CONFLICT', 'A newer public source bundle is already published.');
      }
      for (const item of prepared) {
        await client.query('INSERT INTO falcon_mesh.source_revisions (owner_id, revision_id, source_key, source_url, observed_at, captured_at, sha256, content) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)',
          [PUBLIC_OWNER_ID, item.revisionId, item.document.sourceKey, item.document.sourceUrl, item.document.observedAt, item.capturedAt, item.sha256, item.content]);
        await client.query('INSERT INTO falcon_mesh.source_heads (owner_id, source_key, revision_id) VALUES ($1, $2, $3) ON CONFLICT (owner_id, source_key) DO UPDATE SET revision_id = EXCLUDED.revision_id',
          [PUBLIC_OWNER_ID, item.document.sourceKey, item.revisionId]);
      }
      return { sources: await publicConnectorSources(client) };
    }, 'exclusive');
  }

  async function invalidatePublicBundle(expectedSources) {
    return transaction(PUBLIC_OWNER_ID, false, async client => {
      const current = await publicConnectorSources(client);
      const unchanged = expectedSources === undefined ? true
        : expectedSources === null ? current.length === 0
          : current.length === expectedSources.length && expectedSources.every(expected => current.some(source =>
            source.revisionId === expected.revisionId && source.sourceKey === expected.sourceKey && source.sha256 === expected.sha256));
      if (!unchanged) return false;
      await client.query('DELETE FROM falcon_mesh.source_heads WHERE owner_id = $1 AND source_key = ANY($2::text[])',
        [PUBLIC_OWNER_ID, CONNECTORS.map(connector => 'live:' + connector.id)]);
      return true;
    }, 'exclusive');
  }

  async function adoptPublicGraph(owner, input, at) {
    ownerId(owner); timestamp(at);
    exactKeys(input, ['requestId', 'reserveRequestId']);
    const requestId = uuid(input.requestId);
    const reserveRequestId = uuid(input.reserveRequestId);
    if (requestId === reserveRequestId) invalid('Program and reserve request IDs must differ.');
    return transaction(owner, false, async client => {
      const sources = await publicConnectorSources(client);
      const expected = CONNECTORS.map(connector => 'live:' + connector.id);
      if (sources.length !== expected.length || expected.some(key => !sources.some(source => source.sourceKey === key))) {
        throw new MeshError('CONFLICT', 'A complete current public source bundle is required.');
      }
      const graph = projectLiveGraph(sources, at);
      const ownerHeads = await client.query('SELECT source_key FROM falcon_mesh.source_heads WHERE owner_id = $1', [owner]);
      const ownerKeys = new Set(ownerHeads.rows.map(row => row.source_key));
      const additions = sources.filter(source => !ownerKeys.has(source.sourceKey)).length;
      if (ownerHeads.rows.length + additions > SOURCE_LIMIT) throw new MeshError('TOO_LARGE', 'Owner source limit is 32 documents.');
      for (const sourceRow of sources) {
        await client.query('INSERT INTO falcon_mesh.source_revisions (owner_id, revision_id, source_key, source_url, observed_at, captured_at, sha256, content) SELECT $1, revision_id, source_key, source_url, observed_at, captured_at, sha256, content FROM falcon_mesh.source_revisions WHERE owner_id = $2 AND revision_id = $3 ON CONFLICT (owner_id, revision_id) DO NOTHING',
          [owner, PUBLIC_OWNER_ID, sourceRow.revisionId]);
        const copied = await client.query('SELECT 1 FROM falcon_mesh.source_revisions target JOIN falcon_mesh.source_revisions public_source ON public_source.owner_id = $2 AND public_source.revision_id = $3 WHERE target.owner_id = $1 AND target.revision_id = $3 AND target.source_key = public_source.source_key AND target.source_url = public_source.source_url AND target.observed_at = public_source.observed_at AND target.captured_at = public_source.captured_at AND target.sha256 = public_source.sha256 AND target.content = public_source.content',
          [owner, PUBLIC_OWNER_ID, sourceRow.revisionId]);
        if (!copied.rows.length) throw new MeshError('CONFLICT', 'The public source revision could not be adopted exactly.');
        await client.query('INSERT INTO falcon_mesh.source_heads (owner_id, source_key, revision_id) VALUES ($1, $2, $3) ON CONFLICT (owner_id, source_key) DO UPDATE SET revision_id = EXCLUDED.revision_id',
          [owner, sourceRow.sourceKey, sourceRow.revisionId]);
      }

      async function analysisFor(id, observationId) {
        const existing = await client.query('SELECT * FROM falcon_mesh.analyses WHERE owner_id = $1 AND request_id = $2', [owner, id]);
        if (existing.rows.length) {
          const saved = existing.rows[0];
          if (saved.observation_id !== observationId || saved.graph?.revision !== graph.revision
              || saved.analysis?.evidenceSource !== 'public' || saved.analysis?.publicGraphRevision !== graph.revision) {
            throw new MeshError('CONFLICT', 'Public adoption request ID already has different or stale evidence.');
          }
          return record(saved);
        }
        const base = analyzeLiveGraph(graph, { observationId, maxHops: 3 }, at);
        const analysis = { ...base, evidenceSource: 'public', publicGraphRevision: graph.revision };
        const saved = await client.query('INSERT INTO falcon_mesh.analyses (owner_id, id, request_id, created_at, observation_id, max_hops, graph, analysis) VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8::jsonb) ON CONFLICT (owner_id, request_id) DO NOTHING RETURNING *',
          [owner, randomUUID(), id, at, observationId, 3, JSON.stringify(graph), JSON.stringify(analysis)]);
        if (!saved.rows.length) throw new MeshError('CONFLICT', 'Public adoption request changed. Retry with the same request IDs.');
        return record(saved.rows[0]);
      }

      const programRecord = await analysisFor(requestId, PUBLIC_PROGRAM_OBSERVATION);
      const reserveRecord = await analysisFor(reserveRequestId, PUBLIC_RESERVE_OBSERVATION);
      return { record: programRecord, reserveRecord, graphRevision: graph.revision, evidenceSource: 'public' };
    }, 'shared');
  }

  async function createPublicDecision(owner, input, at) {
    ownerId(owner); timestamp(at);
    exactKeys(input, ['requestId', 'analysisId', 'scenario']);
    const requestId = uuid(input.requestId);
    const analysisId = uuid(input.analysisId);
    const scenario = parseScenario(input.scenario);
    return transaction(owner, false, async client => {
      const sources = await publicConnectorSources(client);
      const expected = CONNECTORS.map(connector => 'live:' + connector.id);
      if (sources.length !== expected.length || expected.some(key => !sources.some(source => source.sourceKey === key))) {
        throw new MeshError('CONFLICT', 'A complete current public source bundle is required.');
      }
      const publicGraph = projectLiveGraph(sources, at);
      const found = await client.query('SELECT * FROM falcon_mesh.analyses WHERE owner_id = $1 AND id = $2 AND observation_id = $3',
        [owner, analysisId, PUBLIC_PROGRAM_OBSERVATION]);
      const sourceRecord = found.rows[0];
      const currentProgram = analyzeLiveGraph(publicGraph, { observationId: PUBLIC_PROGRAM_OBSERVATION, maxHops: 3 }, at);
      if (!sourceRecord || sourceRecord.analysis?.evidenceSource !== 'public'
          || sourceRecord.analysis?.publicGraphRevision !== publicGraph.revision
          || sourceRecord.analysis?.graphRevision !== publicGraph.revision
          || sourceRecord.graph?.mode !== 'live' || sourceRecord.graph?.revision !== publicGraph.revision
          || sourceRecord.analysis?.status !== 'OBSERVED' || currentProgram.status !== 'OBSERVED') {
        throw new MeshError('CONFLICT', 'A current adopted public program analysis is required.');
      }
      const existing = await client.query('SELECT * FROM falcon_mesh.analyses WHERE owner_id = $1 AND request_id = $2', [owner, requestId]);
      if (existing.rows.length) {
        const saved = existing.rows[0];
        if (saved.observation_id !== RESERVE_DECISION_MARKER || saved.analysis?.evidenceSource !== 'public'
            || saved.analysis?.publicGraphRevision !== publicGraph.revision || saved.analysis?.sourceAnalysisId !== analysisId
            || !Object.keys(scenario).every(key => saved.analysis?.scenario?.[key] === scenario[key])) {
          throw new MeshError('CONFLICT', 'Public decision request ID already has different or stale evidence.');
        }
        return record(saved);
      }
      const analysis = {
        ...evaluateReserveScenario(sourceRecord.graph, scenario, at),
        evidenceSource: 'public', publicGraphRevision: publicGraph.revision, sourceAnalysisId: analysisId,
      };
      const saved = await client.query('INSERT INTO falcon_mesh.analyses (owner_id, id, request_id, created_at, observation_id, max_hops, graph, analysis) VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8::jsonb) ON CONFLICT (owner_id, request_id) DO NOTHING RETURNING *',
        [owner, randomUUID(), requestId, at, RESERVE_DECISION_MARKER, 3, JSON.stringify(sourceRecord.graph), JSON.stringify(analysis)]);
      if (!saved.rows.length) throw new MeshError('CONFLICT', 'Public decision request changed. Retry with the same request ID.');
      return record(saved.rows[0]);
    }, 'shared');
  }

  const methods = {
    async getPublicBundle() {
      return getPublicBundle();
    },

    async getPublicResearchBundle() {
      return getPublicResearchBundle();
    },
    async getRetainedPublicResearchCase() {
      return getRetainedPublicResearchCase();
    },

    async getPublicResearchCase(caseId) {
      return getPublicResearchCase(caseId);
    },

    async getPublicResearchSource(revisionId) {
      return getPublicResearchSource(revisionId);
    },

    async publishPublicResearchCase(input) {
      return publishPublicResearchCase(input);
    },

    async adoptResearchCase(owner, input, at) {
      return adoptResearchCase(owner, input, at);
    },

    async publishPublicBundle(revisions, expectedSources) {
      return publishPublicBundle(revisions, expectedSources);
    },

    async invalidatePublicBundle(expectedSources) {
      return invalidatePublicBundle(expectedSources);
    },

    async adoptPublicGraph(owner, input, at) {
      return adoptPublicGraph(owner, input, at);
    },

    async createPublicDecision(owner, input, at) {
      return createPublicDecision(owner, input, at);
    },

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
      if (query.observationId === RESERVE_DECISION_MARKER) invalid('Decision marker is not a source observation.');
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

    async createDecision(owner, input, at) {
      ownerId(owner); timestamp(at);
      exactKeys(input, ['requestId', 'scenario']);
      const requestId = uuid(input.requestId);
      const scenario = parseScenario(input.scenario);
      return transaction(owner, false, async client => {
        const existing = await client.query('SELECT * FROM falcon_mesh.analyses WHERE owner_id = $1 AND request_id = $2', [owner, requestId]);
        if (existing.rows.length) {
          const saved = existing.rows[0];
          if (saved.observation_id !== RESERVE_DECISION_MARKER
              || !Object.keys(scenario).every(key => saved.analysis?.scenario?.[key] === scenario[key])) {
            throw new MeshError('CONFLICT', 'Decision request ID already has different arguments.');
          }
          return record(saved);
        }
        const revisions = selectedSources(await currentSources(client, owner), 'live');
        const graph = projectLiveGraph(revisions, at);
        const analysis = evaluateReserveScenario(graph, scenario, at);
        const saved = await client.query(`
          INSERT INTO falcon_mesh.analyses (owner_id, id, request_id, created_at, observation_id, max_hops, graph, analysis)
          VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8::jsonb)
          ON CONFLICT (owner_id, request_id) DO NOTHING RETURNING *`,
        [owner, randomUUID(), requestId, at, RESERVE_DECISION_MARKER, 3, JSON.stringify(graph), JSON.stringify(analysis)]);
        if (!saved.rows.length) throw new MeshError('CONFLICT', 'Decision request changed. Retry with the same request ID.');
        return record(saved.rows[0]);
      });
    },

    async getAnalysis(owner, id) {
      ownerId(owner);
      const result = await pool.query("SELECT * FROM falcon_mesh.analyses WHERE owner_id = $1 AND id = $2 AND observation_id <> $3 AND COALESCE(analysis->>'recordKind', '') NOT LIKE 'near-research/%'", [owner, uuid(id), RESERVE_DECISION_MARKER]);
      return result.rows.length ? record(result.rows[0]) : null;
    },

    async listAnalyses(owner) {
      ownerId(owner);
      const result = await pool.query("SELECT id, created_at, analysis FROM falcon_mesh.analyses WHERE owner_id = $1 AND observation_id <> $2 AND COALESCE(analysis->>'recordKind', '') NOT LIKE 'near-research/%' ORDER BY created_at DESC, id DESC LIMIT 20", [owner, RESERVE_DECISION_MARKER]);
      return result.rows.map(row => ({ id: row.id, createdAt: new Date(row.created_at).toISOString(), analysis: row.analysis }));
    },

    async getResearchAnalysis(owner, id) {
      ownerId(owner);
      const result = await pool.query("SELECT * FROM falcon_mesh.analyses WHERE owner_id = $1 AND id = $2 AND analysis->>'recordKind' LIKE 'near-research/adopted/%'", [owner, uuid(id)]);
      return result.rows.length ? record(result.rows[0]) : null;
    },

    async listResearchAnalyses(owner) {
      ownerId(owner);
      const result = await pool.query("SELECT id, created_at, analysis FROM falcon_mesh.analyses WHERE owner_id = $1 AND analysis->>'recordKind' LIKE 'near-research/adopted/%' ORDER BY created_at DESC, id DESC LIMIT 20", [owner]);
      return result.rows.map(row => ({ id: row.id, createdAt: new Date(row.created_at).toISOString(), analysis: row.analysis }));
    },
    async listResearchActivityAnalyses(owner) {
      ownerId(owner);
      const result = await pool.query(`
        SELECT id, created_at, analysis->>'snapshotHash' AS snapshot_hash,
          analysis->'modelResult'->'investmentAssessment'->>'status' AS investment_status
        FROM falcon_mesh.analyses
        WHERE owner_id = $1 AND analysis->>'recordKind' = $2
        ORDER BY created_at DESC, id DESC LIMIT 20`,
      [owner, RESEARCH_ANALYSIS_KIND]);
      return result.rows.map(row => ({
        analysisId: row.id,
        createdAt: new Date(row.created_at).toISOString(),
        snapshotHash: row.snapshot_hash,
        investmentStatus: row.investment_status,
      }));
    },


    async getDecision(owner, id) {
      ownerId(owner);
      const result = await pool.query('SELECT * FROM falcon_mesh.analyses WHERE owner_id = $1 AND id = $2 AND observation_id = $3', [owner, uuid(id), RESERVE_DECISION_MARKER]);
      return result.rows.length ? record(result.rows[0]) : null;
    },

    async listDecisions(owner) {
      ownerId(owner);
      const result = await pool.query('SELECT id, created_at, analysis FROM falcon_mesh.analyses WHERE owner_id = $1 AND observation_id = $2 ORDER BY created_at DESC, id DESC LIMIT 20', [owner, RESERVE_DECISION_MARKER]);
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
