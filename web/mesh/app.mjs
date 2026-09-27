import { makeDemoDocuments } from '../../mesh/fixtures.mjs';
import { mountLendingTerminal } from './terminal.mjs';

const $ = (id) => document.getElementById(id);
const SVG_NS = 'http://www.w3.org/2000/svg';
const API_BASE = (import.meta.env?.VITE_MESH_API_URL || 'http://127.0.0.1:8791').replace(/\/$/, '');
const KINDS = { synthetic: ['observation', 'reserve', 'position', 'protocol', 'asset'], live: ['observation', 'document', 'account', 'protocol'] };
const KIND_LABELS = { observation: 'Observation', reserve: 'Reserve', position: 'Position', protocol: 'Protocol', asset: 'Asset', document: 'Document', account: 'Program account' };
const RELATIONS = { observes: 'observes', supplied_to: 'supplied to', operated_by: 'operated by', denominated_in: 'denominated in', documents: 'documents', claims_program: 'claims program' };
let token = '';
let sessionGeneration = 0;
let mode = 'synthetic';
let connectors = [];
let captureResult = null;
let connected = false;
let busy = false;
let currentGraph = null;
let currentVerified = false;
let record = null;
let history = [];
let selectedNodeId = null;
let selectedPositionId = null;
let selectedSource = null;
let lastRequestFailed = false;

function element(tag, className, text) {
  const value = document.createElement(tag);
  if (className) value.className = className;
  if (text !== undefined) value.textContent = text;
  return value;
}
function text(id, value) { $(id).textContent = value; }
function stamp(value) { return new Date(value).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'medium' }); }
function units(value) {
  if (value === null || value === undefined) return 'Not determined';
  if (typeof value !== 'string' || !/^\d+$/.test(value)) return 'Invalid amount';
  const amount = BigInt(value);
  const fraction = String(amount % 1000000n).padStart(6, '0').replace(/0+$/, '');
  return `${amount / 1000000n}${fraction ? `.${fraction}` : ''} USDC`;
}
function shownGraph() { return record?.graph ?? currentGraph; }
function currentReady() { return currentVerified && currentGraph?.mode === mode; }
function cutoff() { return record?.analysis.at ?? shownGraph()?.asOf; }
function label(id) { return shownGraph()?.nodes.find((item) => item.id === id)?.label ?? id; }
function sourceAge(source) {
  const seconds = (Date.parse(cutoff()) - Date.parse(source.observedAt)) / 1000;
  if (!Number.isFinite(seconds)) return { status: 'Unknown time', age: 'Not determined' };
  const observations = shownGraph()?.nodes.filter((item) => item.kind === 'observation' && item.sourceRevisionIds.includes(source.revisionId)) ?? [];
  const failed = shownGraph()?.mode === 'live' && observations.find((item) => item.properties.status !== 'ok');
  if (failed) return { status: `Capture ${failed.properties.status}`, age: `${Number(seconds.toFixed(3))}s` };
  const isObservation = observations.length > 0;
  const status = seconds < 0 ? 'Future timestamp' : isObservation ? seconds > 300 ? 'Stale' : 'Fresh' : 'Recorded source';
  return { status, age: `${Number(seconds.toFixed(3))}s` };
}
function selectedPaths() {
  const paths = record?.analysis.positionResults ?? [];
  return selectedPositionId ? paths.filter((path) => path.positionId === selectedPositionId) : paths;
}
function pathIds() {
  if (record?.analysis.mode === 'live') {
    const analysis = record.analysis;
    return { nodes: new Set(analysis.coverage.visitedNodeIds), edges: new Set(analysis.coverage.visitedEdgeIds), sources: new Set(analysis.sourceRevisionIds) };
  }
  const paths = selectedPaths();
  return { nodes: new Set(paths.flatMap((path) => path.pathNodeIds)), edges: new Set(paths.flatMap((path) => path.pathEdgeIds)), sources: new Set(paths.flatMap((path) => path.sourceRevisionIds)) };
}
function facts(target, rows) {
  target.replaceChildren(...rows.map(([name, value]) => {
    const row = element('div');
    row.append(element('dt', '', name), element('dd', '', value));
    return row;
  }));
}
function clearSource() { selectedSource = null; $('source-inspector').hidden = true; }
function validateGraph(graph) {
  if (!graph || !['synthetic', 'live'].includes(graph.mode) || graph.schemaVersion !== (graph.mode === 'live' ? 2 : 1) || typeof graph.revision !== 'string'
    || !Array.isArray(graph.nodes) || !Array.isArray(graph.edges) || !Array.isArray(graph.sources)
    || !Array.isArray(graph.issues) || !graph.coverage || !Number.isFinite(Date.parse(graph.asOf))) {
    throw new Error('The service returned an unsupported graph. Refresh after checking the service.');
  }
  if (graph.nodes.some((item) => !item || typeof item.id !== 'string' || typeof item.label !== 'string' || !KINDS[graph.mode].includes(item.kind) || !item.properties || !Array.isArray(item.sourceRevisionIds))
    || graph.edges.some((item) => !item || typeof item.id !== 'string' || typeof item.source !== 'string' || typeof item.target !== 'string' || typeof item.relation !== 'string')
    || graph.sources.some((item) => !item || typeof item.revisionId !== 'string' || typeof item.sourceKey !== 'string')) {
    throw new Error('The service returned incomplete graph data.');
  }
  return graph;
}
function acceptRecord(value) {
  validateGraph(value?.graph);
  const analysis = value?.analysis;
  const live = value.graph.mode === 'live';
  if (!analysis || analysis.mode !== value.graph.mode || !((live ? ['OBSERVED', 'NO_DATA'] : ['READY', 'BLOCKED', 'NO_DATA']).includes(analysis.status))
    || analysis.policyVersion !== (live ? 'mesh-public-evidence/1' : 'mesh-liquidity/1')
    || (!live && !Array.isArray(analysis.positionResults)) || !Array.isArray(analysis.sourceRevisionIds)
    || analysis.graphRevision !== value.graph.revision || !analysis.coverage || !Number.isFinite(Date.parse(analysis.at))) {
    throw new Error('The saved analysis does not match its graph.');
  }
  const nodes = new Set(value.graph.nodes.map((item) => item.id));
  const edges = new Set(value.graph.edges.map((item) => item.id));
  const sources = new Set(value.graph.sources.map((item) => item.revisionId));
  if (!Array.isArray(analysis.coverage.visitedNodeIds) || !Array.isArray(analysis.coverage.visitedEdgeIds)
    || analysis.coverage.visitedNodeIds.some((id) => !nodes.has(id)) || analysis.coverage.visitedEdgeIds.some((id) => !edges.has(id))
    || analysis.sourceRevisionIds.some((id) => !sources.has(id))) throw new Error('The saved analysis references evidence outside its graph.');
  for (const result of analysis.positionResults ?? []) {
    if (!Array.isArray(result.pathNodeIds) || !Array.isArray(result.pathEdgeIds) || !Array.isArray(result.sourceRevisionIds)
      || result.pathNodeIds.some((id) => !nodes.has(id)) || result.pathEdgeIds.some((id) => !edges.has(id))) {
      throw new Error('The saved analysis references a path outside its graph.');
    }
  }
  record = value;
  mode = value.graph.mode;
  selectedPositionId = null;
  selectedNodeId = analysis.observationId;
  clearSource();
}

async function api(path, body) {
  const generation = sessionGeneration;
  const requestToken = token;
  const requireCurrentSession = () => {
    if (generation !== sessionGeneration || requestToken !== token) throw new Error('The workspace changed while this request was pending. Load the current workspace before trying again.');
  };
  let response;
  try {
    response = await fetch(`${API_BASE}${path}`, {
      method: body === undefined ? 'GET' : 'POST', credentials: 'omit', redirect: 'error',
      headers: { accept: 'application/json', authorization: `Bearer ${requestToken}`, ...(body === undefined ? {} : { 'content-type': 'application/json' }) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(path === '/v1/captures' || path.startsWith('/v1/lending/') ? 45000 : 15000),
    });
  } catch {
    requireCurrentSession();
    throw new Error('The mesh service did not respond. Check the service and its allowed viewer origin, then refresh.');
  }
  requireCurrentSession();
  let payload;
  try { payload = await response.json(); } catch {
    requireCurrentSession();
    throw new Error(`The mesh service returned an unreadable response (HTTP ${response.status}).`);
  }
  requireCurrentSession();
  if (!response.ok) throw new Error(`${payload?.error?.code ?? `HTTP ${response.status}`}: ${payload?.error?.message ?? 'The request failed.'}`);
  return payload;
}

function controls() {
  $('access-token').disabled = busy || connected;
  $('connect').disabled = busy || connected;
  $('disconnect').hidden = !connected;
  $('disconnect').disabled = busy;
  $('refresh-mesh').disabled = busy || !connected;
  $('mesh-mode').disabled = busy || !connected;
  document.querySelectorAll('[data-scenario]').forEach((button) => { button.disabled = busy || !connected || !currentReady() || mode !== 'synthetic'; });
  document.querySelectorAll('[data-connector-id]').forEach((button) => { button.disabled = busy || !connected || !currentReady() || mode !== 'live'; });
  $('observation-id').disabled = busy || !currentReady();
  $('max-hops').disabled = busy || !currentReady();
  $('run-analysis').disabled = busy || !connected || !currentReady() || !$('observation-id').value;
  document.querySelectorAll('[data-source-id], [data-record-id]').forEach((button) => { button.disabled = busy || !connected; });
}

async function action(work) {
  if (busy) return;
  const trigger = document.activeElement;
  const focus = trigger?.id ? { id: trigger.id } : trigger?.dataset.sourceId ? { sourceId: trigger.dataset.sourceId } : trigger?.dataset.recordId ? { recordId: trigger.dataset.recordId } : trigger?.dataset.connectorId ? { connectorId: trigger.dataset.connectorId } : null;
  busy = true;
  $('mesh-error').hidden = true;
  text('mesh-message', '');
  controls();
  try {
    await work();
    lastRequestFailed = false;
    render();
  } catch (error) {
    currentVerified = false;
    lastRequestFailed = true;
    if (!connected) token = '';
    text('mesh-error', error instanceof Error ? error.message : 'The request failed.');
    $('mesh-error').hidden = false;
    render();
  } finally {
    busy = false;
    controls();
    const target = focus?.id ? $(focus.id) : focus?.sourceId ? [...document.querySelectorAll('[data-source-id]')].find((button) => button.dataset.sourceId === focus.sourceId) : focus?.recordId ? [...document.querySelectorAll('[data-record-id]')].find((button) => button.dataset.recordId === focus.recordId) : focus?.connectorId ? [...document.querySelectorAll('[data-connector-id]')].find((button) => button.dataset.connectorId === focus.connectorId) : null;
    if (target && !target.disabled) target.focus({ preventScroll: true });
  }
}

async function loadCurrent(nextMode = mode) {
  const [graphResponse, historyResponse, connectorResponse] = await Promise.all([api(nextMode === 'live' ? '/v1/graph/live' : '/v1/graph'), api('/v1/analyses'), nextMode === 'live' ? api('/v1/connectors') : null]);
  const nextGraph = validateGraph(graphResponse.graph);
  if (nextGraph.mode !== nextMode) throw new Error('The service returned a graph for a different evidence mode.');
  if (!Array.isArray(historyResponse.records)) throw new Error('The service returned invalid analysis history.');
  if (nextMode === 'live' && (!Array.isArray(connectorResponse?.connectors) || connectorResponse.connectors.some((item) => !item || typeof item.id !== 'string' || typeof item.label !== 'string' || typeof item.sourceUrl !== 'string'))) throw new Error('The service returned an invalid source registry.');
  mode = nextMode;
  if (connectorResponse) connectors = connectorResponse.connectors;
  currentGraph = nextGraph;
  currentVerified = true;
  history = historyResponse.records;
  record = null;
  selectedPositionId = null;
  if (!currentGraph.nodes.some((item) => item.id === selectedNodeId)) selectedNodeId = currentGraph.nodes.find((item) => item.kind === 'observation')?.id ?? currentGraph.nodes[0]?.id ?? null;
  clearSource();
}

function renderGraph() {
  const graph = shownGraph();
  const highlighted = pathIds();
  const positions = new Map();
  const rowCounts = new Map();
  const kinds = KINDS[graph.mode];
  for (const item of graph.nodes) {
    const row = rowCounts.get(item.kind) ?? 0;
    rowCounts.set(item.kind, row + 1);
    positions.set(item.id, { x: 18 + kinds.indexOf(item.kind) * (kinds.length === 4 ? 260 : 196), y: 30 + row * 126 });
  }
  const height = Math.max(280, Math.max(0, ...rowCounts.values()) * 126 + 36);
  $('mesh-canvas').style.setProperty('--canvas-height', `${height}px`);
  $('mesh-connections').setAttribute('viewBox', `0 0 1000 ${height}`);
  $('empty-graph').hidden = graph.nodes.length > 0;
  $('mesh-canvas').hidden = graph.nodes.length === 0;
  $('mesh-nodes').replaceChildren(...graph.nodes.map((item) => {
    const button = element('button', 'mesh-node');
    const position = positions.get(item.id);
    button.type = 'button';
    button.dataset.nodeId = item.id;
    button.dataset.kind = item.kind;
    button.dataset.path = String(highlighted.nodes.has(item.id));
    button.setAttribute('aria-pressed', String(item.id === selectedNodeId));
    button.style.left = `${position.x / 10}%`;
    button.style.top = `${position.y}px`;
    button.append(element('span', 'node-kind', KIND_LABELS[item.kind]), element('strong', '', item.label));
    if (item.kind === 'position') button.append(element('span', 'node-value', units(item.properties.amountUnits)));
    if (item.kind === 'observation') button.append(element('span', 'node-value', graph.mode === 'live' ? `Capture: ${item.properties.status}` : item.properties.status === 'ok' ? units(item.properties.availableLiquidityUnits) : 'Unavailable'));
    if (item.kind === 'account') button.append(element('span', 'node-value', item.properties.network));
    if (highlighted.nodes.has(item.id)) button.append(element('span', 'path-marker', 'Analysis path'));
    button.addEventListener('click', () => selectNode(item.id));
    return button;
  }));
  const paths = [];
  for (const edge of graph.edges) {
    const from = positions.get(edge.source);
    const to = positions.get(edge.target);
    if (!from || !to) continue;
    const forward = to.x >= from.x;
    const x1 = from.x + (forward ? 166 : 0);
    const x2 = to.x + (forward ? 0 : 166);
    const y1 = from.y + 43;
    const y2 = to.y + 43;
    const center = (x1 + x2) / 2;
    const path = document.createElementNS(SVG_NS, 'path');
    path.setAttribute('d', `M${x1} ${y1}C${center} ${y1} ${center} ${y2} ${x2} ${y2}`);
    path.setAttribute('class', `mesh-edge${highlighted.edges.has(edge.id) ? ' on-path' : ''}`);
    path.dataset.edgeId = edge.id;
    path.dataset.source = edge.source;
    path.dataset.target = edge.target;
    path.dataset.path = String(highlighted.edges.has(edge.id));
    paths.push(path);
  }
  $('mesh-paths').replaceChildren(...paths);
  text('graph-coverage', `Projection: ${graph.coverage.status}`);
  $('graph-coverage').dataset.status = graph.coverage.status === 'complete' ? graph.mode === 'live' ? 'OBSERVED' : 'READY' : 'NO_DATA';
  $('graph-issues').hidden = graph.issues.length === 0;
  $('graph-issue-list').replaceChildren(...graph.issues.map((issue) => element('li', '', issue)));
  $('relationship-list').replaceChildren(...graph.edges.map((edge) => {
    const item = element('li', highlighted.edges.has(edge.id) ? 'on-path' : '', `${label(edge.source)} → ${RELATIONS[edge.relation] ?? edge.relation} → ${label(edge.target)}${highlighted.edges.has(edge.id) ? ' · Analysis path' : ''}`);
    item.dataset.edgeId = edge.id;
    return item;
  }));
  text('graph-revision', `Snapshot ${graph.revision}`);
  renderPaths();
  renderDirectory();
}

function renderPaths() {
  if (record?.analysis.mode === 'live') {
    const coverage = record.analysis.coverage;
    text('path-context', `Exact evidence traversal: ${coverage.visitedNodeIds.length} entities and ${coverage.visitedEdgeIds.length} relationships. Highlighting shows what the service visited, including incomplete evidence.`);
    const edges = new Map(record.graph.edges.map((edge) => [edge.id, edge]));
    $('selected-path').replaceChildren(...coverage.visitedEdgeIds.map((id) => {
      const edge = edges.get(id);
      const item = element('li', '', `${label(edge.source)} → ${RELATIONS[edge.relation] ?? edge.relation} → ${label(edge.target)}`);
      item.dataset.edgeId = id;
      return item;
    }));
    return;
  }
  const paths = selectedPaths();
  text('path-context', selectedPositionId ? `Exact returned path for ${label(selectedPositionId)}.` : paths.length ? `Showing all ${paths.length} returned position paths. Select a result below to isolate one path.` : record ? 'This analysis returned no position paths. Read its coverage and evidence gaps below.' : 'No analysis path selected. Run an analysis using the current sources.');
  $('selected-path').replaceChildren(...paths.map((path) => {
    const item = element('li', '', path.pathNodeIds.map(label).join(' → '));
    item.dataset.positionId = path.positionId;
    item.append(element('span', 'small-note', `${path.pathEdgeIds.length} exact relationships · ${path.status}`));
    return item;
  }));
}

function renderDirectory() {
  const graph = shownGraph();
  if (!graph) return;
  const query = $('entity-search').value.trim().toLowerCase();
  const matches = graph.nodes.filter((item) => `${item.label} ${item.kind} ${item.id}`.toLowerCase().includes(query));
  $('entity-directory').replaceChildren(...matches.map((item) => {
    const li = element('li');
    const button = element('button', 'directory-node', `${item.label} · ${KIND_LABELS[item.kind]}`);
    button.type = 'button';
    button.dataset.directoryId = item.id;
    button.setAttribute('aria-pressed', String(selectedNodeId === item.id));
    button.addEventListener('click', () => selectNode(item.id));
    li.append(button);
    return li;
  }));
  if (!matches.length) $('entity-directory').append(element('li', 'small-note', 'No entities match this snapshot.'));
}

function selectNode(id) {
  selectedNodeId = id;
  clearSource();
  document.querySelectorAll('[data-node-id], [data-directory-id]').forEach((button) => button.setAttribute('aria-pressed', String((button.dataset.nodeId ?? button.dataset.directoryId) === id)));
  renderInspector();
  controls();
}

function sourceButton(source, className = 'source-button') {
  const button = element('button', className);
  const freshness = sourceAge(source);
  button.type = 'button';
  button.dataset.sourceId = source.revisionId;
  button.append(element('strong', '', source.sourceKey), element('span', '', `${freshness.status} · ${freshness.age} at ${record ? 'analysis' : 'snapshot'}`));
  button.addEventListener('click', () => action(async () => {
    const response = await api(`/v1/sources/${encodeURIComponent(source.revisionId)}`);
    if (response.source?.revisionId !== source.revisionId || typeof response.source.content !== 'string') throw new Error('The service returned a different source revision.');
    selectedSource = response.source;
    text('mesh-message', `Opened retained source ${source.sourceKey}.`);
  }));
  return button;
}

function liveDocument(source) {
  try {
    const document = JSON.parse(source.content);
    return document?.mode === 'live' && document.schemaVersion === 2 && document.capture ? document : null;
  } catch { return null; }
}

function renderCapture(source) {
  const document = liveDocument(source);
  const capture = document?.capture;
  $('source-capture-facts').hidden = !capture;
  $('source-exchanges').hidden = !capture;
  $('source-exchanges').replaceChildren();
  if (!capture) return;
  const rows = [['Capture status', capture.status], ['Reason', capture.reasonCode ?? 'None'], ['Connector', capture.connectorId], ['Connector version', capture.connectorVersion], ['Receipt time', stamp(source.observedAt)]];
  if (capture.chain) rows.push(['Network', capture.chain.network], ['Genesis hash', capture.chain.genesisHash], ['Commitment', capture.chain.commitment], ['Slot', capture.chain.slot ?? 'Not returned']);
  facts($('source-capture-facts'), rows);
  $('source-capture-facts').dataset.status = capture.status;
  const note = element('p', 'small-note', 'Receipt time records when the service received this evidence. It is not publication time or block time.');
  $('source-exchanges').append(note);
  for (const [index, exchange] of (capture.exchanges ?? []).entries()) {
    const details = element('details', 'source-exchange');
    details.dataset.exchangeIndex = String(index);
    const response = exchange.response;
    details.append(element('summary', '', `Read retained response ${index + 1}${response ? ` / HTTP ${response.httpStatus}` : ' / no complete response'}`));
    const metadata = element('dl', 'facts');
    const exchangeRows = [['Started', stamp(exchange.startedAt)], ['Completed', stamp(exchange.completedAt)], ['Failure', exchange.failure ?? 'None']];
    if (response) exchangeRows.push(['Content type', response.contentType ?? 'Not returned'], ['Response bytes', String(response.byteLength)], ['Response SHA-256', response.sha256]);
    facts(metadata, exchangeRows);
    details.append(metadata);
    if (response) {
      let content;
      try { content = new TextDecoder('utf-8', { fatal: true }).decode(Uint8Array.from(atob(response.bodyBase64), (character) => character.charCodeAt(0))); }
      catch { content = `Response is not UTF-8 text. Retained base64:\n${response.bodyBase64}`; }
      details.append(element('pre', 'response-content', content));
    } else details.append(element('p', 'small-note', 'This capture retained no complete response body. Read the capture reason above.'));
    $('source-exchanges').append(details);
  }
}

function renderInspector() {
  const graph = shownGraph();
  const item = graph.nodes.find((value) => value.id === selectedNodeId);
  text('inspector-context', record ? 'SAVED ANALYSIS / SELECTED ENTITY' : 'CURRENT SNAPSHOT / SELECTED ENTITY');
  text('entity-title', item?.label ?? 'Select an entity.');
  text('entity-id', item?.id ?? '');
  $('entity-kind').hidden = !item;
  text('entity-kind', item ? KIND_LABELS[item.kind] : '');
  const rows = [];
  if (item?.kind === 'position') rows.push(['Supplied amount', units(item.properties.amountUnits)]);
  if (item?.kind === 'observation') {
    rows.push(['Evidence status', item.properties.status]);
    if (graph.mode === 'synthetic') rows.push(['Available liquidity', units(item.properties.availableLiquidityUnits)]);
    else {
      rows.push(['Observation type', item.properties.observationType === 'document' ? 'Document claim' : 'Program account'], ['Capture reason', item.properties.reasonCode ?? 'None']);
      if (item.properties.observationType === 'document') rows.push(['Claims this program', item.properties.claimsProgram ? 'Yes' : 'No']);
      else rows.push(['Slot', item.properties.slot ?? 'Not returned'], ['Program owner', item.properties.programOwner ?? 'Not returned'], ['Executable', item.properties.executable === null ? 'Not returned' : item.properties.executable ? 'Yes' : 'No'], ['Account data SHA-256', item.properties.dataSha256 ?? 'Not returned']);
    }
  }
  if (item?.kind === 'account') rows.push(['Network', item.properties.network], ['Address', item.properties.address], ['Genesis hash', item.properties.genesisHash]);
  if (item?.kind === 'document') rows.push(['Document URL', item.properties.url]);
  if (item) rows.push(['Evidence cutoff', stamp(cutoff())], ['Source revisions', String(item.sourceRevisionIds.length)]);
  facts($('entity-facts'), rows);
  const edges = item ? graph.edges.filter((edge) => edge.source === item.id || edge.target === item.id) : [];
  $('entity-connections-panel').hidden = !item;
  $('entity-connections').replaceChildren(...edges.map((edge) => {
    const li = element('li');
    const other = edge.source === item.id ? edge.target : edge.source;
    const button = element('button', 'connection-button', `${label(edge.source)} → ${RELATIONS[edge.relation] ?? edge.relation} → ${label(edge.target)}`);
    button.type = 'button';
    button.dataset.connectedNodeId = other;
    button.addEventListener('click', () => {
      selectNode(other);
      [...document.querySelectorAll('.mesh-node')].find((value) => value.dataset.nodeId === other)?.focus({ preventScroll: true });
    });
    li.append(button);
    return li;
  }));
  if (item && !edges.length) $('entity-connections').append(element('li', 'small-note', 'No relationships in this snapshot.'));
  const sources = item ? graph.sources.filter((source) => item.sourceRevisionIds.includes(source.revisionId)) : [];
  $('entity-sources-panel').hidden = !item;
  $('entity-sources').replaceChildren(...sources.map((source) => { const li = element('li'); li.append(sourceButton(source)); return li; }));
  $('source-inspector').hidden = !selectedSource;
  if (selectedSource) {
    const freshness = sourceAge(selectedSource);
    text('source-title', selectedSource.sourceKey);
    facts($('source-facts'), [['Source', selectedSource.sourceUrl], [graph.mode === 'live' ? 'Response receipt time' : 'Observed', stamp(selectedSource.observedAt)], ['Captured', stamp(selectedSource.capturedAt)], [`Age at ${record ? 'analysis' : 'snapshot'}`, freshness.age], ['Freshness', freshness.status], ['Revision', selectedSource.revisionId], ['SHA-256', selectedSource.sha256]]);
    text('source-content', selectedSource.content);
    text('source-loading', 'Retained content for this exact revision.');
    $('source-content-details').hidden = false;
    renderCapture(selectedSource);
  }
}

function renderAnalysis() {
  const analysis = record?.analysis;
  const live = mode === 'live';
  text('analysis-context', analysis ? lastRequestFailed ? 'SAVED RESULT / LAST REQUEST FAILED' : 'SAVED ANALYSIS / ORIGINAL EVIDENCE' : 'NO ANALYSIS FOR THIS SNAPSHOT');
  text('analysis-title', analysis ? { READY: 'Combined exit is covered.', BLOCKED: 'Combined exit is blocked.', NO_DATA: 'Evidence is incomplete.', OBSERVED: 'Public evidence is connected.' }[analysis.status] : 'An answer with a path.');
  text('analysis-status', analysis?.status ?? 'Awaiting analysis');
  $('analysis-status').dataset.status = analysis?.status ?? '';
  text('analysis-summary', analysis?.summary ?? 'Run an analysis to inspect the service’s result and its evidence.');
  facts($('analysis-facts'), analysis ? live ? [['Visited entities', String(analysis.coverage.visitedNodeIds.length)], ['Visited relationships', String(analysis.coverage.visitedEdgeIds.length)], ['Source revisions', String(analysis.sourceRevisionIds.length)]] : [['Connected positions', String(analysis.positionResults.length)], ['Combined exit', units(analysis.totalAffectedUnits)], ['Available liquidity', units(analysis.availableLiquidityUnits)]] : []);
  text('analysis-coverage', analysis ? `Coverage: ${analysis.coverage.status}. Traversal: at most ${analysis.coverage.maxHops} hops, ${analysis.coverage.nodeLimit} nodes, and ${analysis.coverage.edgeLimit} edges.` : 'Coverage will appear with the analysis.');
  $('position-results').replaceChildren(...(analysis?.positionResults ?? []).map((result) => {
    const button = element('button', 'position-result');
    button.type = 'button';
    button.dataset.positionId = result.positionId;
    button.dataset.status = result.status;
    button.setAttribute('aria-pressed', String(selectedPositionId === result.positionId));
    button.append(element('span', 'tiny-label', result.status), element('strong', '', label(result.positionId)), element('span', 'result-amount', units(result.amountUnits)), element('span', 'result-reason', result.reason), element('span', 'result-link', 'Trace this path ↑'));
    button.addEventListener('click', () => {
      selectedPositionId = selectedPositionId === result.positionId ? null : result.positionId;
      selectedNodeId = result.positionId;
      clearSource();
      renderGraph(); renderInspector(); renderSources(); renderAnalysis(); controls();
      [...document.querySelectorAll('.position-result')].find((value) => value.dataset.positionId === result.positionId)?.focus({ preventScroll: true });
    });
    return button;
  }));
  text('analysis-record', analysis ? `Saved ${stamp(record.createdAt)} · ${analysis.policyVersion} · Record ${record.id}` : '');
  text('analysis-limit', live ? 'OBSERVED means the linked document and account evidence passed this evidence check. It does not prove lending usability or authorize a transaction. Account ownership is program ownership, not wallet ownership.' : 'READY describes this synthetic combined-exit calculation. It does not predict a live fill or authorize movement.');
}

function renderSources() {
  const highlighted = pathIds();
  text('source-age-context', record ? 'Age at saved analysis' : 'Age at loaded snapshot');
  $('source-list').replaceChildren(...shownGraph().sources.map((source) => {
    const li = element('li');
    li.dataset.evidence = String(highlighted.sources.has(source.revisionId));
    li.append(sourceButton(source, 'source-row'));
    if (highlighted.sources.has(source.revisionId)) li.append(element('span', 'source-evidence', 'Supports selected analysis paths'));
    li.append(element('span', 'source-meta', `${shownGraph().mode === 'live' ? 'Response received' : 'Observed'} ${stamp(source.observedAt)} · Captured ${stamp(source.capturedAt)}`));
    return li;
  }));
}

function renderHistory() {
  text('history-count', `${history.length} loaded / latest 20`);
  $('empty-history').hidden = history.length > 0;
  $('analysis-history').replaceChildren(...history.map((entry) => {
    const li = element('li');
    const button = element('button', 'history-record');
    button.type = 'button';
    button.dataset.recordId = entry.id;
    button.dataset.status = entry.analysis.status;
    button.dataset.mode = entry.analysis.mode;
    button.setAttribute('aria-pressed', String(record?.id === entry.id));
    button.append(element('span', 'badge', entry.analysis.status), element('span', 'history-summary', `${entry.analysis.mode === 'live' ? 'Live sources' : 'Synthetic'} · ${entry.analysis.summary}`), element('span', 'small-note', stamp(entry.createdAt)));
    button.addEventListener('click', () => action(async () => {
      const response = await api(`/v1/analyses/${encodeURIComponent(entry.id)}`);
      const nextMode = validateGraph(response.record?.graph).mode;
      if (nextMode !== mode) await loadCurrent(nextMode);
      acceptRecord(response.record);
      text('mesh-message', 'Opened the saved analysis with its original graph and evidence cutoff.');
    }));
    li.append(button);
    return li;
  }));
}

function renderMode() {
  const live = mode === 'live';
  $('mesh-mode').value = mode;
  text('mode-symbol', live ? 'L' : 'S');
  $('mode-note').replaceChildren(element('strong', '', live ? 'Public documents and Devnet account evidence. ' : 'Synthetic USDC and source documents. '), document.createTextNode(live ? 'Capture the registered sources, then inspect the linked evidence. This view does not move funds.' : 'This mode uses a fixed liquidity analysis. It does not contact a live provider or move funds.'));
  text('mode-context', live ? 'Live captures use fixed sources. Synthetic scenarios stay in their own graph.' : 'Scenario documents and public captures stay in separate graphs.');
  $('synthetic-controls').hidden = live;
  $('live-connectors').hidden = !live;
  text('analysis-controls-title', live ? 'Do the public sources support this program?' : 'Can the connected positions exit?');
  text('analysis-controls-copy', live ? 'The service follows the document claim to the program account and its Devnet observation. Both sources must support the result.' : 'The service follows the observation through its reserve. It compares liquidity with the combined position amount.');
  text('observation-label', live ? 'Public evidence observation' : 'Liquidity observation');
  text('empty-graph', live ? 'No live captures are loaded. Capture the registered sources above to begin.' : 'No source documents are loaded. Open the synthetic scenario controls to begin.');
  if (!live) return;
  $('connector-list').replaceChildren(...connectors.map((connector) => {
    const item = element('li');
    const heading = element('div');
    heading.append(element('h3', '', connector.label), element('p', 'connector-url', connector.sourceUrl), element('p', 'small-note', connector.network ? `Network: ${connector.network}` : 'Official protocol document'));
    const source = currentGraph?.sources.find((value) => value.sourceKey === `live:${connector.id}`);
    const observation = source && currentGraph.nodes.find((value) => value.kind === 'observation' && value.sourceRevisionIds.includes(source.revisionId));
    const status = element('p', 'connector-status', source ? `Current capture: ${observation?.properties.status ?? 'Unknown'} · Response received ${stamp(source.observedAt)}${observation?.properties.reasonCode ? ` · ${observation.properties.reasonCode}` : ''}` : 'No current capture.');
    status.dataset.status = observation?.properties.status ?? 'empty';
    heading.append(status);
    const button = element('button', 'button', `Capture ${connector.label}`);
    button.type = 'button';
    button.dataset.connectorId = connector.id;
    button.addEventListener('click', () => action(async () => {
      if (mode !== 'live' || !currentReady()) return;
      text('mesh-message', `Capturing ${connector.label}. The service will retain the response or its failure reason.`);
      const requestId = crypto.randomUUID();
      const response = await api('/v1/captures', { requestId, connectorId: connector.id, expectedRevisionId: currentGraph.sources.find((value) => value.sourceKey === `live:${connector.id}`)?.revisionId ?? null });
      if (response.source?.revisionId !== requestId) throw new Error('The service returned a different capture revision. Refresh the sources.');
      await loadCurrent();
      const sourceResponse = await api(`/v1/sources/${encodeURIComponent(requestId)}`);
      if (sourceResponse.source?.revisionId !== requestId) throw new Error('The retained capture does not match this request.');
      const captured = liveDocument(sourceResponse.source);
      if (!captured || captured.capture.connectorId !== connector.id) throw new Error('The service returned an invalid live capture.');
      selectedSource = sourceResponse.source;
      captureResult = { label: connector.label, status: captured.capture.status, reason: captured.capture.reasonCode, at: selectedSource.observedAt };
      text('mesh-message', captured.capture.status === 'ok' ? 'Source capture saved. Run an analysis to inspect the connected evidence.' : 'The failed source capture was saved as current evidence. Inspect its reason before analyzing.');
    }));
    item.append(heading, button);
    return item;
  }));
  if (!connectors.length) $('connector-list').append(element('li', 'small-note', 'The service returned no registered sources.'));
  $('capture-result').hidden = !captureResult;
  if (captureResult) {
    $('capture-result').dataset.status = captureResult.status;
    text('capture-result', `Last capture: ${captureResult.label} · ${captureResult.status}${captureResult.reason ? ` · ${captureResult.reason}` : ''} · Response received ${stamp(captureResult.at)}. ${captureResult.status === 'ok' ? 'Evidence retained for analysis.' : 'The capture did not establish usable evidence.'}`);
  }
}

function render() {
  $('mesh-workspace').hidden = !connected || !currentGraph;
  renderMode();
  text('connection-status', connected ? lastRequestFailed ? 'Connected. Last request failed. Refresh before analyzing current sources.' : 'Connected. Sources and analyses are stored by the service.' : 'Disconnected. Connect to load your workspace.');
  $('connection-status').dataset.state = connected && !lastRequestFailed ? 'connected' : 'disconnected';
  if (connected && currentGraph) {
    const graph = shownGraph();
    text('snapshot-context', record ? 'Saved analysis / original graph' : currentVerified ? 'Current source snapshot' : 'Previous snapshot / refresh required');
    text('snapshot-time', `${record ? 'Analysis cutoff' : 'Loaded snapshot'} ${stamp(cutoff())}${lastRequestFailed ? ' · Latest request failed' : ''}`);
    text('node-count', String(graph.nodes.length)); text('edge-count', String(graph.edges.length)); text('source-count', String(graph.sources.length));
    const oldObservation = $('observation-id').value;
    const observations = currentGraph.mode === mode ? currentGraph.nodes.filter((item) => item.kind === 'observation') : [];
    $('observation-id').replaceChildren(...observations.map((item) => { const option = element('option', '', item.label); option.value = item.id; return option; }));
    if (observations.some((item) => item.id === oldObservation)) $('observation-id').value = oldObservation;
    text('analysis-control-note', !currentReady() ? 'Refresh the current sources before running an analysis or saving another source.' : observations.length ? 'This request uses current source heads. Selecting history does not change the analysis request.' : mode === 'live' ? 'Capture the registered sources to add public evidence observations.' : 'Load a synthetic scenario to add a liquidity observation.');
    renderGraph(); renderInspector(); renderAnalysis(); renderSources(); renderHistory();
  }
  controls();
  terminal.render();
}

$('connect-form').addEventListener('submit', (event) => {
  event.preventDefault();
  if (busy || connected) return;
  sessionGeneration += 1;
  token = $('access-token').value.trim();
  $('access-token').value = '';
  if (!token) return;
  void action(async () => {
    const endpoint = new URL(API_BASE);
    if (endpoint.username || endpoint.password || endpoint.search || endpoint.hash
      || (endpoint.protocol !== 'https:' && !(endpoint.protocol === 'http:' && ['127.0.0.1', 'localhost', '[::1]'].includes(endpoint.hostname)))) {
      throw new Error('The configured API address must use HTTPS, or HTTP on loopback for local development.');
    }
    await loadCurrent();
    connected = true;
    text('mesh-message', 'Workspace loaded. Choose a source or run an analysis.');
  });
});
$('disconnect').addEventListener('click', () => {
  if (busy) return;
  sessionGeneration += 1;
  token = ''; connected = false; currentGraph = null; currentVerified = false; record = null; history = [];
  mode = 'synthetic'; connectors = []; captureResult = null;
  selectedNodeId = null; selectedPositionId = null; lastRequestFailed = false; clearSource();
  $('mesh-error').hidden = true;
  $('access-token').value = '';
  text('mesh-message', 'Disconnected. The service keeps saved sources and analyses.');
  terminal.reset();
  render(); $('access-token').focus();
});
$('refresh-mesh').addEventListener('click', () => action(async () => { await loadCurrent(); text('mesh-message', 'Current source snapshot loaded. Saved analyses remain in history.'); }));
$('mesh-mode').addEventListener('change', (event) => {
  const nextMode = event.target.value;
  $('mesh-mode').value = mode;
  if (!connected || busy || !['synthetic', 'live'].includes(nextMode) || nextMode === mode) return;
  void action(async () => {
    await loadCurrent(nextMode);
    text('mesh-message', nextMode === 'live' ? 'Live source snapshot loaded. Capture the registered sources to retain public evidence.' : 'Synthetic source snapshot loaded. Choose a scenario or inspect saved evidence.');
  });
});
document.querySelectorAll('[data-scenario]').forEach((button) => button.addEventListener('click', () => action(async () => {
  if (!connected || !currentReady() || mode !== 'synthetic') return;
  const documents = makeDemoDocuments(new Date().toISOString(), button.dataset.scenario);
  const revisions = documents.map((document) => ({ revisionId: crypto.randomUUID(), expectedRevisionId: currentGraph.sources.find((source) => source.sourceKey === document.sourceKey)?.revisionId ?? null, content: JSON.stringify(document) }));
  await api('/v1/sources', { revisions });
  await loadCurrent();
  text('mesh-message', 'Synthetic source revisions saved. Run an analysis to inspect their effect.');
})));
$('analysis-form').addEventListener('submit', (event) => {
  event.preventDefault();
  if (!connected || !currentReady() || busy || !$('observation-id').value) return;
  const query = { requestId: crypto.randomUUID(), observationId: $('observation-id').value, maxHops: Number($('max-hops').value) };
  void action(async () => {
    const response = await api(mode === 'live' ? '/v1/analyses/live' : '/v1/analyses', query);
    acceptRecord(response.record);
    const historyResponse = await api('/v1/analyses');
    if (!Array.isArray(historyResponse.records)) throw new Error('The analysis was saved, but its history could not be loaded.');
    history = historyResponse.records;
    text('mesh-message', mode === 'live' ? 'Analysis saved with its graph and source revisions. The graph marks the exact evidence traversal.' : 'Analysis saved with its graph and source revisions. Select a position result to trace its path.');
  });
});
$('entity-search').addEventListener('input', renderDirectory);
window.addEventListener('pagehide', () => { sessionGeneration += 1; token = ''; });
text('api-location', `Service: ${API_BASE}`);
const terminal = mountLendingTerminal({ api, getAnalysis: () => lastRequestFailed ? null : record, isConnected: () => connected });
render();
