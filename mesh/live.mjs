import { createHash } from 'node:crypto';
import { MeshError } from './domain.mjs';

const PROGRAM = 'KLend2g3cP87fffoy8q1mQqGKjrxjC8boSyAYavgmjD';
const GENESIS = 'EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG';
const DOCS = 'kamino-program-docs';
const RPC = 'solana-devnet-klend';
const BODY_LIMIT = 40 * 1024;
const CONTENT_LIMIT = 128 * 1024;
const TIMEOUT_MS = 5000;
const HASH = /^[a-f0-9]{64}$/;
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const ID = /^[a-zA-Z0-9][a-zA-Z0-9._:/-]{0,127}$/;
const META_KEYS = ['revisionId', 'sourceKey', 'sourceUrl', 'observedAt', 'capturedAt', 'sha256'];
const ACCOUNT_ID = `account:devnet:${PROGRAM}`;
const DOCUMENT_ID = `document:live:${DOCS}`;
const PROTOCOL_ID = 'protocol:live:kamino';
const observationId = id => `observation:live:${id}`;
const STATUSES = ['ok', 'unavailable', 'invalid', 'too_large'];

export const CONNECTORS = Object.freeze([
  Object.freeze({ id: DOCS, label: 'Official Kamino program deployments', sourceUrl: 'https://raw.githubusercontent.com/Kamino-Finance/klend/master/README.md', network: null }),
  Object.freeze({ id: RPC, label: 'Solana Devnet Kamino program account', sourceUrl: 'https://api.devnet.solana.com', network: 'devnet' }),
]);

function invalid(message) { throw new MeshError('INVALID_INPUT', message); }
function exact(value, fields, name) {
  if (!value || typeof value !== 'object' || Array.isArray(value)
      || ![Object.prototype, null].includes(Object.getPrototypeOf(value))
      || Reflect.ownKeys(value).length !== fields.length
      || Reflect.ownKeys(value).some(key => !fields.includes(key)
        || !Object.hasOwn(Object.getOwnPropertyDescriptor(value, key), 'value'))) invalid(`${name} fields are invalid.`);
}
function time(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)
      || !Number.isFinite(Date.parse(value)) || new Date(value).toISOString() !== value) invalid('Capture time is invalid.');
  return Date.parse(value);
}
function safeText(value, limit) {
  return typeof value === 'string' && value.isWellFormed() && value.length <= limit && !/[\u0000-\u001f\u007f]/.test(value);
}
function hash(value) { return createHash('sha256').update(value).digest('hex'); }
function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`;
  return JSON.stringify(value);
}
function equal(left, right) { return canonical(left) === canonical(right); }
function registry(id) {
  const connector = CONNECTORS.find(item => item.id === id);
  if (!connector) invalid('Connector is not registered.');
  return connector;
}
function base64(value, limit = BODY_LIMIT) {
  if (typeof value !== 'string' || value.length > Math.ceil(limit / 3) * 4) invalid('Captured base64 exceeds its limit.');
  const bytes = Buffer.from(value, 'base64');
  if (bytes.length > limit || bytes.toString('base64') !== value) invalid('Captured base64 is invalid.');
  return bytes;
}
function publicKey(value) {
  if (typeof value !== 'string' || value.length < 32 || value.length > 44 || !/^[1-9A-HJ-NP-Za-km-z]+$/.test(value)) return false;
  const alphabet = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
  let number = 0n;
  for (const character of value) number = number * 58n + BigInt(alphabet.indexOf(character));
  let length = 0;
  while (number > 0n) { number >>= 8n; length += 1; }
  return length + (value.match(/^1*/)?.[0].length || 0) === 32;
}
function request(id, index = 0) {
  if (id === DOCS) return { method: 'GET', bodyBase64: null };
  const body = index === 0
    ? { jsonrpc: '2.0', id: 1, method: 'getGenesisHash' }
    : { jsonrpc: '2.0', id: 2, method: 'getAccountInfo', params: [PROGRAM, { encoding: 'base64', commitment: 'confirmed' }] };
  return { method: 'POST', bodyBase64: Buffer.from(JSON.stringify(body)).toString('base64') };
}
function parseResponse(exchange, id) {
  const raw = base64(exchange.response.bodyBase64);
  const value = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(raw));
  if (!value || typeof value !== 'object' || Array.isArray(value) || value.jsonrpc !== '2.0'
      || value.id !== id || Object.hasOwn(value, 'error') || !Object.hasOwn(value, 'result')) throw new Error('Invalid RPC response');
  return value.result;
}
function transportResult(exchange) {
  if (exchange.failure) return { status: exchange.failure === 'TOO_LARGE' ? 'too_large' : 'unavailable', reasonCode: exchange.failure };
  if (exchange.response.httpStatus < 200 || exchange.response.httpStatus >= 300) return { status: 'unavailable', reasonCode: 'HTTP_ERROR' };
  return null;
}

function derive(id, exchanges) {
  let outcome = transportResult(exchanges[0]);
  let chain = null;
  let details = { slot: null, programOwner: null, executable: null, dataSha256: null };
  if (id === DOCS) {
    if (exchanges.length !== 1) invalid('Document capture must contain one exchange.');
    if (!outcome) {
      try {
        const text = new TextDecoder('utf-8', { fatal: true }).decode(base64(exchanges[0].response.bodyBase64));
        const claims = [...text.matchAll(/^\s*[*-]\s+Devnet:\s*`([^`\r\n]+)`\s*$/gm)];
        outcome = /^## Deployments\s*$/m.test(text) && claims.length === 1 && claims[0][1] === PROGRAM
          ? { status: 'ok', reasonCode: null } : { status: 'invalid', reasonCode: 'DOCUMENT_CLAIM_MISMATCH' };
      } catch { outcome = { status: 'invalid', reasonCode: 'INVALID_DOCUMENT' }; }
    }
  } else {
    if (!outcome) {
      try {
        const genesis = parseResponse(exchanges[0], 1);
        if (genesis !== GENESIS) outcome = { status: 'invalid', reasonCode: 'WRONG_CLUSTER' };
        else chain = { network: 'devnet', genesisHash: GENESIS, commitment: 'confirmed', slot: null };
      } catch { outcome = { status: 'invalid', reasonCode: 'INVALID_GENESIS_RESPONSE' }; }
    }
    if (outcome) {
      if (exchanges.length !== 1) invalid('An account read cannot follow a failed genesis check.');
    } else {
      if (exchanges.length !== 2) invalid('Successful genesis check requires an account exchange.');
      outcome = transportResult(exchanges[1]);
      if (!outcome) {
        try {
          const result = parseResponse(exchanges[1], 2);
          if (!result || typeof result !== 'object' || !Number.isSafeInteger(result.context?.slot) || result.context.slot < 0
              || !Object.hasOwn(result, 'value')) throw new Error('Invalid account context');
          chain.slot = String(result.context.slot);
          details.slot = chain.slot;
          const account = result.value;
          if (account === null) outcome = { status: 'unavailable', reasonCode: 'ACCOUNT_MISSING' };
          else {
            if (!account || typeof account !== 'object' || typeof account.executable !== 'boolean' || !publicKey(account.owner)
                || !Array.isArray(account.data) || account.data.length !== 2 || account.data[1] !== 'base64') throw new Error('Invalid account');
            const bytes = base64(account.data[0]);
            if (!bytes.length || (Object.hasOwn(account, 'space') && account.space !== bytes.length)) throw new Error('Invalid account data');
            details = { slot: chain.slot, programOwner: account.owner, executable: account.executable, dataSha256: hash(bytes) };
            outcome = account.executable ? { status: 'ok', reasonCode: null } : { status: 'invalid', reasonCode: 'NOT_EXECUTABLE' };
          }
        } catch { outcome = { status: 'invalid', reasonCode: 'INVALID_ACCOUNT_RESPONSE' }; details = { slot: null, programOwner: null, executable: null, dataSha256: null }; chain.slot = null; }
      }
    }
  }
  const node = (nodeId, kind, label, properties) => ({ id: nodeId, kind, label, properties });
  const edge = (edgeId, source, target, relation) => ({ id: edgeId, source, target, relation });
  const account = node(ACCOUNT_ID, 'account', 'Kamino program address on Devnet', { network: 'devnet', genesisHash: GENESIS, address: PROGRAM });
  let nodes;
  let edges;
  if (id === DOCS) {
    nodes = [
      node(DOCUMENT_ID, 'document', 'Official Kamino deployment document', { url: registry(DOCS).sourceUrl }),
      node(PROTOCOL_ID, 'protocol', 'Kamino Lending', { protocolId: 'kamino-lending' }),
      node(observationId(DOCS), 'observation', 'Official document capture', { observationType: 'document', ...outcome, claimsProgram: outcome.status === 'ok' }),
    ];
    edges = [edge('edge:live:documents', DOCUMENT_ID, PROTOCOL_ID, 'documents'), edge('edge:live:document-observation', observationId(DOCS), DOCUMENT_ID, 'observes')];
    if (outcome.status === 'ok') { nodes.push(account); edges.push(edge('edge:live:program-claim', DOCUMENT_ID, ACCOUNT_ID, 'claims_program')); }
  } else {
    nodes = [account, node(observationId(RPC), 'observation', 'Devnet program account capture', { observationType: 'program_account', ...outcome, ...details })];
    edges = [edge('edge:live:account-observation', observationId(RPC), ACCOUNT_ID, 'observes')];
  }
  return { ...outcome, chain, nodes, edges };
}

async function fetchExchange(connector, input, { fetchImpl, now }) {
  const startedAt = now(); time(startedAt);
  const controller = new AbortController();
  let timer;
  let reader;
  let failure = null;
  let response = null;
  try {
    response = await Promise.race([
      (async () => {
        const fetched = await fetchImpl(connector.sourceUrl, {
          method: input.method, body: input.bodyBase64 === null ? undefined : base64(input.bodyBase64).toString('utf8'),
          headers: input.method === 'POST' ? { 'content-type': 'application/json', accept: 'application/json' } : { accept: 'text/plain' },
          signal: controller.signal, redirect: 'error', credentials: 'omit', cache: 'no-store',
        });
        if (fetched.redirected || (fetched.url && new URL(fetched.url).href !== new URL(connector.sourceUrl).href)
            || !Number.isInteger(fetched.status) || fetched.status < 100 || fetched.status > 599
            || (fetched.body !== null && !fetched.body?.getReader)) throw new Error('Invalid transport response');
        reader = fetched.body?.getReader();
        const chunks = [];
        let size = 0;
        while (reader) {
          const { done, value } = await reader.read();
          if (done) break;
          if (!(value instanceof Uint8Array)) throw new Error('Invalid transport bytes');
          size += value.byteLength;
          if (size > BODY_LIMIT) { const error = new Error('Capture exceeds body limit'); error.code = 'TOO_LARGE'; throw error; }
          chunks.push(Buffer.from(value));
        }
        const raw = Buffer.concat(chunks);
        const header = fetched.headers?.get('content-type') ?? null;
        return { httpStatus: fetched.status, contentType: safeText(header, 128) ? header : null, bodyBase64: raw.toString('base64'), sha256: hash(raw), byteLength: raw.length };
      })(),
      new Promise((_, reject) => { timer = setTimeout(() => { controller.abort(); const error = new Error('Capture deadline reached'); error.code = 'TIMEOUT'; reject(error); }, TIMEOUT_MS); }),
    ]);
  } catch (error) {
    failure = ['TIMEOUT', 'TOO_LARGE'].includes(error?.code) ? error.code : controller.signal.aborted ? 'TIMEOUT' : 'TRANSPORT';
    controller.abort();
    if (reader) void reader.cancel().catch(() => {});
  } finally { clearTimeout(timer); }
  const completedAt = now();
  if (time(completedAt) < time(startedAt)) invalid('Capture clock moved backwards.');
  return { startedAt, completedAt, request: input, response, failure };
}

export async function captureSource(connectorId, { fetchImpl = globalThis.fetch, now = () => new Date().toISOString() } = {}) {
  const connector = registry(connectorId);
  const exchanges = [await fetchExchange(connector, request(connectorId), { fetchImpl, now })];
  if (connectorId === RPC && !transportResult(exchanges[0])) {
    let genesis;
    try { genesis = parseResponse(exchanges[0], 1); } catch {}
    if (genesis === GENESIS) exchanges.push(await fetchExchange(connector, request(connectorId, 1), { fetchImpl, now }));
  }
  const { nodes, edges, ...outcome } = derive(connectorId, exchanges);
  const document = {
    schemaVersion: 2, mode: 'live', sourceKey: `live:${connectorId}`, sourceUrl: connector.sourceUrl,
    observedAt: exchanges.at(-1).completedAt,
    capture: { connectorId, connectorVersion: '1', registryVersion: '1', projectionVersion: '1', ...outcome, exchanges }, nodes, edges,
  };
  const content = JSON.stringify(document);
  validateLiveSource(content, document.observedAt);
  return content;
}

export function validateLiveSource(content, capturedAt) {
  const cutoff = time(capturedAt);
  if (typeof content !== 'string' || !content.isWellFormed()) invalid('Live source must contain valid UTF-8 JSON.');
  if (Buffer.byteLength(content, 'utf8') > CONTENT_LIMIT) throw new MeshError('TOO_LARGE', 'Live source exceeds 128 KiB.');
  let document;
  try { document = JSON.parse(content); } catch { invalid('Live source must be JSON.'); }
  exact(document, ['schemaVersion', 'mode', 'sourceKey', 'sourceUrl', 'observedAt', 'capture', 'nodes', 'edges'], 'Live source');
  if (document.schemaVersion !== 2 || document.mode !== 'live') invalid('Only live source version 2 is supported.');
  const capture = document.capture;
  exact(capture, ['connectorId', 'connectorVersion', 'registryVersion', 'projectionVersion', 'status', 'reasonCode', 'exchanges', 'chain'], 'Capture');
  const connector = registry(capture.connectorId);
  if (document.sourceKey !== `live:${connector.id}` || document.sourceUrl !== connector.sourceUrl
      || capture.connectorVersion !== '1' || capture.registryVersion !== '1' || capture.projectionVersion !== '1') invalid('Capture identity or version is invalid.');
  if (!Array.isArray(capture.exchanges) || capture.exchanges.length < 1 || capture.exchanges.length > 2) invalid('Capture exchanges are invalid.');
  let previous = 0;
  for (const [index, exchange] of capture.exchanges.entries()) {
    exact(exchange, ['startedAt', 'completedAt', 'request', 'response', 'failure'], 'Exchange');
    const start = time(exchange.startedAt);
    const end = time(exchange.completedAt);
    if (start < previous || end < start || end > cutoff) invalid('Capture exchange times are invalid.');
    previous = end;
    if (!equal(exchange.request, request(connector.id, index))) invalid('Capture request does not match its registered operation.');
    if (![null, 'TRANSPORT', 'TIMEOUT', 'TOO_LARGE'].includes(exchange.failure)) invalid('Capture failure is invalid.');
    if (exchange.failure !== null) {
      if (exchange.response !== null) invalid('Incomplete response cannot retain a complete body.');
    } else {
      exact(exchange.response, ['httpStatus', 'contentType', 'bodyBase64', 'sha256', 'byteLength'], 'Captured response');
      const response = exchange.response;
      if (!Number.isInteger(response.httpStatus) || response.httpStatus < 100 || response.httpStatus > 599
          || !(response.contentType === null || safeText(response.contentType, 128))) invalid('Captured transport metadata is invalid.');
      const raw = base64(response.bodyBase64);
      if (response.byteLength !== raw.length || typeof response.sha256 !== 'string' || !HASH.test(response.sha256) || response.sha256 !== hash(raw)) invalid('Captured response does not match its retained bytes.');
    }
  }
  if (document.observedAt !== capture.exchanges.at(-1).completedAt || time(document.observedAt) > cutoff) invalid('Observation time does not match capture completion.');
  const projected = derive(connector.id, capture.exchanges);
  if (!equal({ status: capture.status, reasonCode: capture.reasonCode, chain: capture.chain }, { status: projected.status, reasonCode: projected.reasonCode, chain: projected.chain })
      || !equal(document.nodes, projected.nodes) || !equal(document.edges, projected.edges)) invalid('Live projection does not match its retained capture.');
  return document;
}

function revisionHash(sources) {
  return hash(JSON.stringify(sources.map(source => [source.revisionId, source.sha256]).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)));
}
function validateMetadata(source, withContent = false) {
  exact(source, [...META_KEYS, ...(withContent ? ['content'] : [])], 'Live revision');
  if (typeof source.revisionId !== 'string' || !UUID.test(source.revisionId) || typeof source.sha256 !== 'string' || !HASH.test(source.sha256)) invalid('Live revision identity is invalid.');
  if (time(source.observedAt) > time(source.capturedAt)) invalid('Live revision predates its observation.');
  const connector = CONNECTORS.find(item => source.sourceKey === `live:${item.id}` && source.sourceUrl === item.sourceUrl);
  if (!connector) invalid('Live revision source is not registered.');
  return connector;
}
function sorted(values) { return [...values].sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0); }

export function projectLiveGraph(revisions, at) {
  time(at);
  if (!Array.isArray(revisions)) invalid('Live source revisions must be an array.');
  const ids = new Set();
  const keys = new Set();
  const nodes = new Map();
  const edges = new Map();
  const issues = new Set();
  const sources = [];
  function merge(map, item, id) {
    if (map.has(item.id)) {
      const previous = map.get(item.id);
      const { sourceRevisionIds, ...definition } = previous;
      if (!equal(definition, item)) issues.add(`Conflicting live definitions: ${item.id}.`);
      previous.sourceRevisionIds = [...new Set([...sourceRevisionIds, id])].sort();
    } else map.set(item.id, { ...structuredClone(item), sourceRevisionIds: [id] });
  }
  for (const revision of [...revisions].sort((a, b) => String(a?.revisionId).localeCompare(String(b?.revisionId)))) {
    validateMetadata(revision, true);
    if (ids.has(revision.revisionId.toLowerCase()) || keys.has(revision.sourceKey)) invalid('Live sources contain duplicate identities.');
    ids.add(revision.revisionId.toLowerCase()); keys.add(revision.sourceKey);
    const document = validateLiveSource(revision.content, revision.capturedAt);
    if (hash(revision.content) !== revision.sha256 || ['sourceKey', 'sourceUrl', 'observedAt'].some(key => revision[key] !== document[key])) invalid('Live revision does not match retained content.');
    if (sources.length >= 32) continue;
    const { content, ...metadata } = revision;
    sources.push(metadata);
    if (document.capture.status !== 'ok') issues.add(`Current capture ${document.capture.connectorId} failed: ${document.capture.reasonCode}.`);
    for (const node of document.nodes) merge(nodes, node, revision.revisionId);
    for (const edge of document.edges) merge(edges, edge, revision.revisionId);
  }
  for (const edge of edges.values()) if (!nodes.has(edge.source) || !nodes.has(edge.target)) issues.add(`Missing live endpoint: ${edge.id}.`);
  return {
    schemaVersion: 2, mode: 'live', revision: revisionHash(revisions), asOf: at,
    nodes: sorted(nodes.values()).slice(0, 256), edges: sorted(edges.values()).slice(0, 512), sources,
    issues: [...issues].sort(), coverage: { status: revisions.length > 32 || nodes.size > 256 || edges.size > 512 ? 'truncated' : 'complete', nodeLimit: 256, edgeLimit: 512, sourceLimit: 32 },
  };
}

function readGraph(graph) {
  exact(graph, ['schemaVersion', 'mode', 'revision', 'asOf', 'nodes', 'edges', 'sources', 'issues', 'coverage'], 'Live graph');
  if (graph.schemaVersion !== 2 || graph.mode !== 'live' || typeof graph.revision !== 'string' || !HASH.test(graph.revision)) invalid('Live graph identity is invalid.');
  time(graph.asOf);
  exact(graph.coverage, ['status', 'nodeLimit', 'edgeLimit', 'sourceLimit'], 'Live coverage');
  if (!['complete', 'truncated'].includes(graph.coverage.status) || graph.coverage.nodeLimit !== 256 || graph.coverage.edgeLimit !== 512 || graph.coverage.sourceLimit !== 32) invalid('Live graph limits are invalid.');
  if (!Array.isArray(graph.sources) || graph.sources.length > 32 || !Array.isArray(graph.nodes) || graph.nodes.length > 256
      || !Array.isArray(graph.edges) || graph.edges.length > 512 || !Array.isArray(graph.issues) || graph.issues.some(issue => !safeText(issue, 500))) invalid('Live graph arrays are invalid.');
  const sources = new Map();
  const keys = new Set();
  for (const source of graph.sources) {
    validateMetadata(source);
    if (sources.has(source.revisionId) || keys.has(source.sourceKey)) invalid('Live graph has duplicate sources.');
    sources.set(source.revisionId, source); keys.add(source.sourceKey);
  }
  if (graph.coverage.status === 'complete' && revisionHash(graph.sources) !== graph.revision) invalid('Live graph revision does not match its sources.');
  const ids = new Set();
  for (const item of [...graph.nodes, ...graph.edges]) {
    if (typeof item?.id !== 'string' || !ID.test(item.id) || ids.has(item.id)) invalid('Live graph IDs are invalid.');
    ids.add(item.id);
    if (!Array.isArray(item.sourceRevisionIds) || !item.sourceRevisionIds.length || new Set(item.sourceRevisionIds).size !== item.sourceRevisionIds.length
        || item.sourceRevisionIds.some(id => !sources.has(id))) invalid('Live graph provenance is invalid.');
  }
  for (const node of graph.nodes) {
    exact(node, ['id', 'kind', 'label', 'properties', 'sourceRevisionIds'], 'Live node');
    if (!safeText(node.label, 120) || !node.label.trim()) invalid('Live label is invalid.');
    const properties = node.properties;
    if (node.kind === 'document') {
      exact(properties, ['url'], 'Document properties');
      if (node.id !== DOCUMENT_ID || properties.url !== registry(DOCS).sourceUrl) invalid('Live document identity is invalid.');
    } else if (node.kind === 'protocol') {
      exact(properties, ['protocolId'], 'Protocol properties');
      if (node.id !== PROTOCOL_ID || properties.protocolId !== 'kamino-lending') invalid('Live protocol identity is invalid.');
    } else if (node.kind === 'account') {
      exact(properties, ['network', 'genesisHash', 'address'], 'Account properties');
      if (node.id !== ACCOUNT_ID || properties.network !== 'devnet' || properties.genesisHash !== GENESIS || properties.address !== PROGRAM) invalid('Live account identity is invalid.');
    } else if (node.kind === 'observation') {
      const docs = node.id === observationId(DOCS);
      if (!docs && node.id !== observationId(RPC)) invalid('Live observation identity is invalid.');
      exact(properties, docs ? ['observationType', 'status', 'reasonCode', 'claimsProgram'] : ['observationType', 'status', 'reasonCode', 'slot', 'programOwner', 'executable', 'dataSha256'], 'Observation properties');
      if (properties.observationType !== (docs ? 'document' : 'program_account') || !STATUSES.includes(properties.status)
          || !(properties.reasonCode === null || safeText(properties.reasonCode, 80))) invalid('Live observation status is invalid.');
      if (docs && typeof properties.claimsProgram !== 'boolean') invalid('Document claim is invalid.');
      if (!docs && (!(properties.slot === null || typeof properties.slot === 'string' && /^(0|[1-9]\d{0,15})$/.test(properties.slot) && Number.isSafeInteger(Number(properties.slot)))
          || !(properties.programOwner === null || publicKey(properties.programOwner)) || !(properties.executable === null || typeof properties.executable === 'boolean')
          || !(properties.dataSha256 === null || typeof properties.dataSha256 === 'string' && HASH.test(properties.dataSha256)))) invalid('Account observation is invalid.');
    } else invalid('Synthetic nodes cannot enter live analysis.');
  }
  const expectedEdges = new Map([
    ['edge:live:documents', [DOCUMENT_ID, PROTOCOL_ID, 'documents']],
    ['edge:live:program-claim', [DOCUMENT_ID, ACCOUNT_ID, 'claims_program']],
    ['edge:live:document-observation', [observationId(DOCS), DOCUMENT_ID, 'observes']],
    ['edge:live:account-observation', [observationId(RPC), ACCOUNT_ID, 'observes']],
  ]);
  for (const edge of graph.edges) {
    exact(edge, ['id', 'source', 'target', 'relation', 'sourceRevisionIds'], 'Live edge');
    if (!equal(expectedEdges.get(edge.id), [edge.source, edge.target, edge.relation])) invalid('Live relationship is invalid.');
  }
  return sources;
}

export function analyzeLiveGraph(graph, query, at) {
  const sources = readGraph(graph);
  const now = time(at);
  if (!query || typeof query !== 'object' || Array.isArray(query) || Object.keys(query).some(key => !['observationId', 'maxHops'].includes(key))
      || typeof query.observationId !== 'string' || !ID.test(query.observationId)) invalid('Live analysis query is invalid.');
  const maxHops = query.maxHops === undefined ? 3 : query.maxHops;
  if (!Number.isInteger(maxHops) || maxHops < 1 || maxHops > 3) invalid('maxHops must be between 1 and 3.');
  const nodes = new Map(graph.nodes.map(node => [node.id, node]));
  const visitedNodes = new Set();
  const visitedEdges = new Set();
  const evidence = new Set();
  let coverageStatus = 'complete';
  function finish(status, summary) {
    return {
      schemaVersion: 2, mode: 'live', policyVersion: 'mesh-public-evidence/1', at, graphRevision: graph.revision, observationId: query.observationId,
      status, summary, totalAffectedUnits: null, availableLiquidityUnits: null, positionResults: [], sourceRevisionIds: [...evidence].sort(),
      coverage: { status: coverageStatus, maxHops, nodeLimit: 64, edgeLimit: 128, visitedNodeIds: [...visitedNodes].sort(), visitedEdgeIds: [...visitedEdges].sort() },
    };
  }
  if (graph.coverage.status !== 'complete') { coverageStatus = 'truncated'; return finish('NO_DATA', 'The live graph is incomplete.'); }
  if (graph.issues.length) { coverageStatus = 'conflicting_evidence'; return finish('NO_DATA', 'Current live captures contain errors or conflicting evidence.'); }
  if (nodes.get(query.observationId)?.kind !== 'observation') { coverageStatus = 'missing_dependency'; return finish('NO_DATA', 'Select a current live observation.'); }
  const queue = [[query.observationId, 0]];
  visitedNodes.add(query.observationId);
  for (let cursor = 0; cursor < queue.length; cursor += 1) {
    const [id, hops] = queue[cursor];
    for (const edge of graph.edges.filter(item => item.source === id || item.target === id)) {
      const other = edge.source === id ? edge.target : edge.source;
      if (!nodes.has(other)) { coverageStatus = 'missing_dependency'; return finish('NO_DATA', 'A live relationship endpoint is missing.'); }
      if (!visitedNodes.has(other) && hops >= maxHops) { coverageStatus = 'truncated'; continue; }
      if (!visitedEdges.has(edge.id) && visitedEdges.size >= 128 || !visitedNodes.has(other) && visitedNodes.size >= 64) { coverageStatus = 'truncated'; continue; }
      visitedEdges.add(edge.id);
      if (!visitedNodes.has(other)) { visitedNodes.add(other); queue.push([other, hops + 1]); }
    }
  }
  for (const node of graph.nodes.filter(item => visitedNodes.has(item.id))) node.sourceRevisionIds.forEach(id => evidence.add(id));
  for (const edge of graph.edges.filter(item => visitedEdges.has(item.id))) edge.sourceRevisionIds.forEach(id => evidence.add(id));
  if (coverageStatus !== 'complete') return finish('NO_DATA', 'The live analysis reached its traversal limit.');
  if (![DOCUMENT_ID, PROTOCOL_ID, ACCOUNT_ID, observationId(DOCS), observationId(RPC)].every(id => visitedNodes.has(id))
      || visitedEdges.size !== 4 || !CONNECTORS.every(connector => [...evidence].some(id => sources.get(id).sourceKey === `live:${connector.id}`))) {
    coverageStatus = 'missing_dependency'; return finish('NO_DATA', 'Both the linked official document and Devnet account capture are required.');
  }
  for (const id of evidence) {
    const source = sources.get(id);
    const age = now - time(source.observedAt);
    if (age < 0 || time(source.capturedAt) > now) return finish('NO_DATA', 'Live evidence is from after the analysis time.');
    if (age > 300000) return finish('NO_DATA', 'Live evidence is older than 300 seconds.');
  }
  const document = nodes.get(observationId(DOCS)).properties;
  const account = nodes.get(observationId(RPC)).properties;
  if (document.status !== 'ok' || document.reasonCode !== null || document.claimsProgram !== true
      || account.status !== 'ok' || account.reasonCode !== null || account.executable !== true || account.slot === null
      || account.programOwner === null || account.dataSha256 === null) return finish('NO_DATA', 'The linked program evidence is unavailable.');
  return finish('OBSERVED', `The official document names this Devnet program. RPC reports its account executable at slot ${account.slot}. Lending usability and wallet ownership are not assessed.`);
}
