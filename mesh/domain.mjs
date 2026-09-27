import { createHash } from 'node:crypto';

const ID = /^[a-zA-Z0-9][a-zA-Z0-9._:/-]{0,127}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const HASH = /^[0-9a-f]{64}$/;
const MAX_UNITS = 18446744073709551615n;
const NODE_LIMIT = 256;
const EDGE_LIMIT = 512;
const SOURCE_LIMIT = 32;
const QUERY_NODES = 64;
const QUERY_EDGES = 128;
const SOURCE_FIELDS = ['revisionId', 'sourceKey', 'sourceUrl', 'observedAt', 'capturedAt', 'sha256'];
const RELATIONS = {
  supplied_to: [['position'], 'reserve'],
  operated_by: [['reserve'], 'protocol'],
  denominated_in: [['position', 'reserve'], 'asset'],
  observes: [['observation'], 'reserve'],
};

export class MeshError extends Error {
  constructor(code, message) { super(message); this.name = 'MeshError'; this.code = code; }
}

function invalid(message) { throw new MeshError('INVALID_INPUT', message); }
function exact(value, keys, name) {
  if (!value || typeof value !== 'object' || Array.isArray(value)
      || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) invalid(`${name} must be an object.`);
  const actual = Reflect.ownKeys(value);
  if (actual.length !== keys.length || actual.some((key) => !keys.includes(key))) invalid(`${name} has missing or unknown fields.`);
  if (actual.some((key) => !Object.hasOwn(Object.getOwnPropertyDescriptor(value, key), 'value'))) invalid(`${name} must contain data fields.`);
}
function identifier(value, name) {
  if (typeof value !== 'string' || !ID.test(value)) invalid(`${name} is invalid.`);
}
function time(value, name) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)) invalid(`${name} must be canonical UTC time.`);
  const result = Date.parse(value);
  if (!Number.isFinite(result) || new Date(result).toISOString() !== value) invalid(`${name} is invalid.`);
  return result;
}
function units(value, name) {
  if (typeof value !== 'string' || value.length > 20 || !/^(0|[1-9]\d*)$/.test(value) || BigInt(value) > MAX_UNITS) invalid(`${name} must be an unsigned u64 integer string.`);
  return BigInt(value);
}
function sourceUrl(value) {
  if (typeof value !== 'string' || !value.isWellFormed() || /[\u0000-\u001f\u007f]/.test(value) || !value.startsWith('synthetic://') || /\s/.test(value)) invalid('Source URL must use synthetic:// and valid text.');
  try { if (!new URL(value).hostname) invalid('Source URL needs a host.'); }
  catch { invalid('Source URL is invalid.'); }
}
function digest(value) { return createHash('sha256').update(value, 'utf8').digest('hex'); }
function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`;
  return JSON.stringify(value);
}
function sorted(items) { return [...items].sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0); }
function unique(items) { return [...new Set(items)].sort(); }
function validateNode(node, projected = false) {
  exact(node, ['id', 'kind', 'label', 'properties', ...(projected ? ['sourceRevisionIds'] : [])], 'Node');
  identifier(node.id, 'Node ID');
  if (!['position', 'reserve', 'protocol', 'asset', 'observation'].includes(node.kind)) invalid('Node kind is invalid.');
  if (typeof node.label !== 'string' || !node.label.isWellFormed() || /[\u0000-\u001f\u007f]/.test(node.label) || !node.label.trim() || node.label.length > 120) invalid('Node label is invalid.');
  if (node.kind === 'position') {
    exact(node.properties, ['amountUnits'], 'Position properties');
    units(node.properties.amountUnits, 'Position amount');
  } else if (node.kind === 'observation') {
    exact(node.properties, ['status', 'availableLiquidityUnits'], 'Observation properties');
    if (!['ok', 'unavailable'].includes(node.properties.status)) invalid('Observation status is invalid.');
    if (node.properties.status === 'ok') units(node.properties.availableLiquidityUnits, 'Liquidity');
    else if (node.properties.availableLiquidityUnits !== null) invalid('Unavailable liquidity must be null.');
  } else exact(node.properties, [], 'Node properties');
}
function validateEdge(edge, projected = false) {
  exact(edge, ['id', 'source', 'target', 'relation', ...(projected ? ['sourceRevisionIds'] : [])], 'Edge');
  for (const key of ['id', 'source', 'target']) identifier(edge[key], `Edge ${key}`);
  if (!Object.hasOwn(RELATIONS, edge.relation)) invalid('Edge relation is invalid.');
}
function wrongTypes(edge, nodes) {
  const [kinds, targetKind] = RELATIONS[edge.relation];
  return (nodes.has(edge.source) && !kinds.includes(nodes.get(edge.source).kind))
    || (nodes.has(edge.target) && nodes.get(edge.target).kind !== targetKind);
}

export function validateSource(content, capturedAt) {
  const captureTime = time(capturedAt, 'Capture time');
  if (typeof content !== 'string') invalid('Source content must be a JSON string.');
  if (Buffer.byteLength(content, 'utf8') > 128 * 1024) throw new MeshError('TOO_LARGE', 'Source content exceeds 128 KiB.');
  let document;
  try { document = JSON.parse(content); } catch { invalid('Source content is not valid JSON.'); }
  exact(document, ['schemaVersion', 'mode', 'sourceKey', 'sourceUrl', 'observedAt', 'nodes', 'edges'], 'Source');
  if (document.schemaVersion !== 1 || document.mode !== 'synthetic') invalid('Source version or mode is unsupported.');
  identifier(document.sourceKey, 'Source key');
  sourceUrl(document.sourceUrl);
  if (time(document.observedAt, 'Observation time') > captureTime) invalid('Source observation is from the future.');
  if (!Array.isArray(document.nodes) || document.nodes.length > 64 || !Array.isArray(document.edges) || document.edges.length > 128) invalid('Source graph exceeds its node or edge limit.');
  const ids = new Set();
  const nodes = new Map();
  for (const node of document.nodes) {
    validateNode(node);
    if (ids.has(node.id)) invalid('Source contains a duplicate graph ID.');
    ids.add(node.id); nodes.set(node.id, node);
  }
  for (const edge of document.edges) {
    validateEdge(edge);
    if (ids.has(edge.id)) invalid('Source contains a duplicate graph ID.');
    ids.add(edge.id);
    if (wrongTypes(edge, nodes)) invalid('Edge endpoint types do not match its relation.');
  }
  return document;
}

function validateMetadata(source, content = false) {
  exact(source, [...SOURCE_FIELDS, ...(content ? ['content'] : [])], 'Source revision');
  if (typeof source.revisionId !== 'string' || !UUID.test(source.revisionId)) invalid('Source revision ID must be a UUID.');
  identifier(source.sourceKey, 'Source key'); sourceUrl(source.sourceUrl);
  if (time(source.observedAt, 'Observation time') > time(source.capturedAt, 'Capture time')) invalid('Source observation is from the future.');
  if (typeof source.sha256 !== 'string' || !HASH.test(source.sha256)) invalid('Source hash is invalid.');
}
function graphDigest(sources) {
  return digest(JSON.stringify(sources.map((source) => [source.revisionId, source.sha256]).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)));
}

export function projectGraph(revisions, at) {
  time(at, 'Graph time');
  if (!Array.isArray(revisions)) invalid('Source revisions must be an array.');
  const sourceKeys = new Set();
  const revisionIds = new Set();
  const parsed = revisions.map((revision) => {
    validateMetadata(revision, true);
    if (revisionIds.has(revision.revisionId.toLowerCase()) || sourceKeys.has(revision.sourceKey)) invalid('Current sources contain a duplicate identity.');
    revisionIds.add(revision.revisionId.toLowerCase()); sourceKeys.add(revision.sourceKey);
    const document = validateSource(revision.content, revision.capturedAt);
    if (digest(revision.content) !== revision.sha256 || ['sourceKey', 'sourceUrl', 'observedAt'].some((key) => document[key] !== revision[key])) invalid('Source revision does not match its retained content.');
    return { revision, document };
  }).sort((a, b) => a.revision.revisionId < b.revision.revisionId ? -1 : 1);
  const nodes = new Map(); const edges = new Map(); const issues = new Set();
  function merge(target, item, revisionId, name) {
    const previous = target.get(item.id);
    if (previous) {
      const { sourceRevisionIds, ...definition } = previous;
      if (canonical(item) !== canonical(definition)) issues.add(`Conflicting ${name} definitions: ${item.id}.`);
      previous.sourceRevisionIds = unique([...sourceRevisionIds, revisionId]);
    } else target.set(item.id, { ...structuredClone(item), sourceRevisionIds: [revisionId] });
  }
  const chosen = parsed.slice(0, SOURCE_LIMIT);
  for (const { revision, document } of chosen) {
    for (const node of document.nodes) merge(nodes, node, revision.revisionId, 'node');
    for (const edge of document.edges) merge(edges, edge, revision.revisionId, 'edge');
  }
  for (const edge of edges.values()) {
    if (nodes.has(edge.id)) issues.add(`Conflicting node and edge identity: ${edge.id}.`);
    if (!nodes.has(edge.source) || !nodes.has(edge.target)) issues.add(`Missing endpoint for edge: ${edge.id}.`);
    else if (wrongTypes(edge, nodes)) issues.add(`Conflicting endpoint types for edge: ${edge.id}.`);
  }
  return {
    schemaVersion: 1, mode: 'synthetic', revision: graphDigest(revisions), asOf: at,
    nodes: sorted(nodes.values()).slice(0, NODE_LIMIT), edges: sorted(edges.values()).slice(0, EDGE_LIMIT),
    sources: chosen.map(({ revision: { content, ...metadata } }) => ({ ...metadata })),
    issues: [...issues].sort(),
    coverage: { status: revisions.length > SOURCE_LIMIT || nodes.size > NODE_LIMIT || edges.size > EDGE_LIMIT ? 'truncated' : 'complete', nodeLimit: NODE_LIMIT, edgeLimit: EDGE_LIMIT, sourceLimit: SOURCE_LIMIT },
  };
}

function readGraph(graph) {
  exact(graph, ['schemaVersion', 'mode', 'revision', 'asOf', 'nodes', 'edges', 'sources', 'issues', 'coverage'], 'Graph');
  if (graph.schemaVersion !== 1 || graph.mode !== 'synthetic' || typeof graph.revision !== 'string' || !HASH.test(graph.revision)) invalid('Graph identity or mode is invalid.');
  time(graph.asOf, 'Graph time');
  exact(graph.coverage, ['status', 'nodeLimit', 'edgeLimit', 'sourceLimit'], 'Graph coverage');
  if (!['complete', 'truncated'].includes(graph.coverage.status) || graph.coverage.nodeLimit !== NODE_LIMIT || graph.coverage.edgeLimit !== EDGE_LIMIT || graph.coverage.sourceLimit !== SOURCE_LIMIT) invalid('Graph coverage is invalid.');
  if (!Array.isArray(graph.nodes) || graph.nodes.length > NODE_LIMIT || !Array.isArray(graph.edges) || graph.edges.length > EDGE_LIMIT || !Array.isArray(graph.sources) || graph.sources.length > SOURCE_LIMIT) invalid('Graph exceeds its limits.');
  if (!Array.isArray(graph.issues) || graph.issues.some((issue) => typeof issue !== 'string' || !issue)) invalid('Graph issues are invalid.');
  const sources = new Map(); const sourceKeys = new Set();
  for (const source of graph.sources) {
    validateMetadata(source);
    if (sources.has(source.revisionId) || sourceKeys.has(source.sourceKey)) invalid('Graph sources contain duplicate identities.');
    sources.set(source.revisionId, source); sourceKeys.add(source.sourceKey);
  }
  if (graph.coverage.status === 'complete' && graphDigest(graph.sources) !== graph.revision) invalid('Graph revision does not match its sources.');
  const nodes = new Map(); const ids = new Set();
  for (const [rows, validate] of [[graph.nodes, validateNode], [graph.edges, validateEdge]]) {
    for (const item of rows) {
      validate(item, true);
      if (ids.has(item.id)) {
        if (!graph.issues.length) invalid('Graph contains duplicate identities.');
      }
      ids.add(item.id);
      if (!Array.isArray(item.sourceRevisionIds) || !item.sourceRevisionIds.length || item.sourceRevisionIds.length !== new Set(item.sourceRevisionIds).size || item.sourceRevisionIds.some((id) => !sources.has(id))) invalid('Graph evidence references are invalid.');
      if (rows === graph.nodes) nodes.set(item.id, item);
    }
  }
  return { nodes, sources };
}

export function analyzeGraph(graph, query, at) {
  const now = time(at, 'Analysis time');
  if (!query || typeof query !== 'object' || Array.isArray(query)) invalid('Analysis query must be an object.');
  exact(query, Object.hasOwn(query, 'maxHops') ? ['observationId', 'maxHops'] : ['observationId'], 'Analysis query');
  identifier(query.observationId, 'Observation ID');
  const maxHops = Object.hasOwn(query, 'maxHops') ? query.maxHops : 3;
  if (!Number.isInteger(maxHops) || maxHops < 1 || maxHops > 3) invalid('maxHops must be an integer from 1 to 3.');
  const { nodes, sources } = readGraph(graph);
  const visitedNodes = new Set(); const visitedEdges = new Set(); const evidence = new Set();
  const coverage = { status: 'complete', maxHops, nodeLimit: QUERY_NODES, edgeLimit: QUERY_EDGES, visitedNodeIds: [], visitedEdgeIds: [] };
  const result = { schemaVersion: 1, mode: 'synthetic', policyVersion: 'mesh-liquidity/1', at, graphRevision: graph.revision, observationId: query.observationId, status: 'NO_DATA', summary: '', totalAffectedUnits: null, availableLiquidityUnits: null, positionResults: [], sourceRevisionIds: [], coverage };
  function finish(status, summary, coverageStatus = coverage.status) {
    result.status = status; result.summary = summary; coverage.status = coverageStatus;
    coverage.visitedNodeIds = [...visitedNodes]; coverage.visitedEdgeIds = [...visitedEdges];
    result.sourceRevisionIds = [...evidence].sort();
    for (const position of result.positionResults) { position.status = status; position.reason = summary; }
    return result;
  }
  function visit(node, depth) {
    if (depth > maxHops) { coverage.status = 'truncated'; return false; }
    if (visitedNodes.has(node.id)) return true;
    if (visitedNodes.size >= QUERY_NODES) { coverage.status = 'truncated'; return false; }
    visitedNodes.add(node.id);
    for (const id of node.sourceRevisionIds) evidence.add(id);
    return true;
  }
  function follow(edge, from, depth) {
    const other = nodes.get(edge.source === from ? edge.target : edge.source);
    if (!other || wrongTypes(edge, nodes)) { coverage.status = 'missing_dependency'; return false; }
    if (!visitedEdges.has(edge.id) && visitedEdges.size >= QUERY_EDGES) { coverage.status = 'truncated'; return false; }
    if (!visit(other, depth)) return false;
    visitedEdges.add(edge.id);
    for (const id of edge.sourceRevisionIds) evidence.add(id);
    return true;
  }
  const edges = sorted(graph.edges);
  const outgoing = (id, relation) => edges.filter((edge) => edge.source === id && edge.relation === relation);
  const incoming = (id, relation) => edges.filter((edge) => edge.target === id && edge.relation === relation);
  function oneTarget(candidates, from, depth) {
    if (!candidates.length) { coverage.status = 'missing_dependency'; return null; }
    const targets = unique(candidates.map((edge) => edge.source === from ? edge.target : edge.source));
    if (targets.length !== 1) { coverage.status = 'conflicting_evidence'; return null; }
    for (const edge of candidates) if (!follow(edge, from, depth)) return null;
    return nodes.get(targets[0]);
  }
  if (graph.coverage.status !== 'complete') return finish('NO_DATA', 'The owner graph exceeds its projection limits.', 'truncated');
  if (graph.issues.length) return finish('NO_DATA', 'The owner graph has missing or conflicting evidence.', graph.issues.some((issue) => issue.startsWith('Conflicting')) ? 'conflicting_evidence' : 'missing_dependency');
  if (graph.edges.some((edge) => !nodes.has(edge.source) || !nodes.has(edge.target) || wrongTypes(edge, nodes))) return finish('NO_DATA', 'Graph relationships have missing or invalid endpoints.', 'missing_dependency');
  const observation = nodes.get(query.observationId);
  if (!observation || observation.kind !== 'observation') return finish('NO_DATA', 'The requested observation is missing.', 'missing_dependency');
  visit(observation, 0);
  const observedEdges = outgoing(observation.id, 'observes');
  const reserve = oneTarget(observedEdges, observation.id, 1);
  if (!reserve) return finish('NO_DATA', 'The observation must identify exactly one reserve.');
  const reserveObservations = unique(incoming(reserve.id, 'observes').map((edge) => edge.source));
  if (reserveObservations.length !== 1) return finish('NO_DATA', 'The reserve has multiple liquidity observations.', 'conflicting_evidence');
  const protocol = oneTarget(outgoing(reserve.id, 'operated_by'), reserve.id, 2);
  if (!protocol) return finish('NO_DATA', 'The reserve needs one protocol within the traversal bounds.');
  const asset = oneTarget(outgoing(reserve.id, 'denominated_in'), reserve.id, 2);
  if (!asset) return finish('NO_DATA', 'The reserve needs one asset within the traversal bounds.');
  const suppliedEdges = incoming(reserve.id, 'supplied_to');
  if (!suppliedEdges.length) return finish('NO_DATA', 'No supplied positions are connected to the reserve.', 'missing_dependency');
  const positions = sorted(unique(suppliedEdges.map((edge) => edge.source)).map((id) => nodes.get(id)));
  for (const position of positions) {
    const ownReserveEdges = outgoing(position.id, 'supplied_to');
    if (unique(ownReserveEdges.map((edge) => edge.target)).length !== 1) return finish('NO_DATA', 'A position is linked to conflicting reserves.', 'conflicting_evidence');
    for (const edge of ownReserveEdges) if (!follow(edge, reserve.id, 2)) return finish('NO_DATA', 'The position dependencies exceed traversal bounds.');
    const assetEdges = outgoing(position.id, 'denominated_in');
    const positionAsset = oneTarget(assetEdges, position.id, 3);
    if (!positionAsset) return finish('NO_DATA', 'A position needs one asset within the traversal bounds.');
    if (positionAsset.id !== asset.id) return finish('NO_DATA', 'A position and its reserve have different assets.', 'conflicting_evidence');
    const pathEdges = [observedEdges[0], ownReserveEdges[0]];
    const positionSources = unique([observation, reserve, position, protocol, asset, ...observedEdges, ...ownReserveEdges, ...outgoing(reserve.id, 'operated_by'), ...outgoing(reserve.id, 'denominated_in'), ...assetEdges].flatMap((item) => item.sourceRevisionIds));
    result.positionResults.push({ positionId: position.id, reserveId: reserve.id, status: 'NO_DATA', amountUnits: position.properties.amountUnits, reason: '', pathNodeIds: [observation.id, reserve.id, position.id], pathEdgeIds: pathEdges.map((edge) => edge.id), sourceRevisionIds: positionSources });
  }
  if (visitedNodes.size >= QUERY_NODES || visitedEdges.size >= QUERY_EDGES) return finish('NO_DATA', 'The analysis reached its traversal limits.', 'truncated');
  for (const id of observation.sourceRevisionIds) {
    const age = now - time(sources.get(id).observedAt, 'Observation time');
    if (age < 0) return finish('NO_DATA', 'Liquidity evidence is from the future.');
    if (age > 300000) return finish('NO_DATA', 'Liquidity evidence is older than 300 seconds.');
  }
  if ([...evidence].some((id) => time(sources.get(id).capturedAt, 'Capture time') > now)) return finish('NO_DATA', 'Evidence was captured after the analysis time.');
  if (observation.properties.status !== 'ok') return finish('NO_DATA', 'Liquidity evidence is unavailable.');
  const total = result.positionResults.reduce((sum, position) => sum + BigInt(position.amountUnits), 0n);
  const liquidity = BigInt(observation.properties.availableLiquidityUnits);
  result.totalAffectedUnits = total.toString(); result.availableLiquidityUnits = liquidity.toString();
  return total <= liquidity
    ? finish('READY', 'Synthetic reserve liquidity covers the combined full exit. This analysis does not authorize execution.')
    : finish('BLOCKED', 'Synthetic reserve liquidity does not cover the combined full exit. Every affected position remains blocked.');
}
