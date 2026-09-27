import { formatUsdc } from './domain.mjs';
import { createStore } from './store.mjs';

const store = createStore();
const $ = (id) => document.getElementById(id);
const SVG_NS = 'http://www.w3.org/2000/svg';
const MAX_EVENTS = 200;
const LOOP_CYCLES = 10;
const LOOP_DELAY_MS = 5000;
const NODE_POSITIONS = {
  reserve: [12, 16], mandate: [334, 16], undelegated: [656, 16],
  observation: [12, 218], position: [334, 218], account: [656, 218],
};
const EDGE_PATHS = {
  'mandate:reserve:excludes': ['M334 62H244', 289, 45],
  'mandate:undelegated:excludes': ['M566 62H656', 611, 45],
  'mandate:account:authorizes': ['M450 109V161H772V218', 640, 150],
  'account:position:owns': ['M656 264H566', 611, 248],
  'position:observation:depends_on': ['M334 264H244', 289, 248],
};
const EVENT_LABELS = { observe: 'Synthetic observation', cycle: 'Agent cycle', revoke: 'Mandate revoked', owner_redeem: 'Owner redemption' };

let current = null;
let busy = false;
let storageFailed = false;
let selectedNode = 'mandate';
let selectedHistoryId = null;
let selectedCheckId = null;
let selectedScenario = null;
let loopRunning = false;
let loopRemaining = 0;
let loopTimer = null;
let shownGraph = null;

function node(tag, className, text) {
  const element = document.createElement(tag);
  if (className) element.className = className;
  if (text !== undefined) element.textContent = text;
  return element;
}

function setText(id, value) { $(id).textContent = value; }
function money(units) { return formatUsdc(units); }
function tone(status) { return status === 'BLOCKED' ? 'blocked' : status === 'NO_DATA' ? 'warn' : 'ok'; }
function stamp(iso) { return new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'medium' }); }
function selectedEntry() { return current?.view.entries.find((entry) => entry.eventId === selectedHistoryId) ?? null; }
function latestDecisionEntry() { return current?.view.entries.findLast((entry) => entry.decision !== null) ?? null; }
function selectedCheck() { return selectedEntry()?.decision?.checks.find((check) => check.id === selectedCheckId) ?? null; }
function isLegacy(entry) { return current.view.entries.indexOf(entry) < current.view.legacyEventCount; }
function ageText(milliseconds) { return `${Number((milliseconds / 1000).toFixed(3))}s`; }

function message(text) { setText('action-message', text); }
function clearError() { $('error-message').hidden = true; setText('error-message', ''); }
function showError(error) {
  stopLoop('Agent stopped after an error.');
  setText('error-message', error instanceof Error ? error.message : String(error));
  $('error-message').hidden = false;
  message('The action did not complete. Check the error before trying again.');
}

function updateControls() {
  const locked = busy || storageFailed;
  const full = Boolean(current && current.run.events.length >= MAX_EVENTS);
  const revoked = Boolean(current?.view.state.revoked);
  $('setup-fields').disabled = locked;
  $('custom-evidence-fields').disabled = locked || !current || full;
  document.querySelectorAll('[data-scenario]').forEach((button) => { button.disabled = locked || !current || full; });
  $('run-cycle').disabled = locked || !current || full || revoked || loopRunning;
  $('start-agent').disabled = locked || !current || full || revoked || loopRunning;
  $('stop-agent').disabled = !loopRunning;
  $('owner-redeem').disabled = locked || !current || full;
  $('revoke-mandate').disabled = locked || !current || full || revoked;
  $('export-run').disabled = locked || !current;
  $('confirm-revoke').disabled = locked || !current || full || revoked;
  if (current) setText('event-count', `${current.run.events.length} / ${MAX_EVENTS} events saved`);
}

function stopLoop(reason = 'Agent stopped.') {
  loopRunning = false;
  if (loopTimer !== null) clearTimeout(loopTimer);
  loopTimer = null;
  setText('loop-status', reason);
  $('loop-status').dataset.running = 'false';
  updateControls();
}

function renderObservation() {
  if (!current) return;
  const { observation, mandate } = current.view.state;
  document.querySelectorAll('[data-scenario]').forEach((button) => {
    button.setAttribute('aria-pressed', String(button.dataset.scenario === selectedScenario));
  });
  if (!observation) {
    setText('observation-value', 'No synthetic observation recorded. Choose a condition above.');
    setText('observation-freshness', 'No data');
    $('observation-freshness').dataset.tone = 'warn';
    setText('observation-age', '');
    setText('observation-time', '');
    return;
  }
  const ageMs = Date.now() - Date.parse(observation.observedAt);
  const stale = ageMs > mandate.maxObservationAgeSeconds * 1000;
  const future = ageMs < 0;
  const unavailable = observation.status === 'unavailable';
  setText('observation-value', unavailable ? 'Synthetic pool data is unavailable.' : `Synthetic available liquidity: ${money(observation.availableLiquidityUnits)} USDC`);
  setText('observation-freshness', unavailable ? 'Unavailable' : future ? 'Future timestamp' : stale ? 'Stale evidence' : 'Fresh evidence');
  $('observation-freshness').dataset.tone = unavailable || future || stale ? 'warn' : 'ok';
  setText('observation-age', future ? '' : `${Math.floor(ageMs / 1000)}s old`);
  setText('observation-time', `Observed ${stamp(observation.observedAt)}`);
}

function renderNodeInspector() {
  const graphNode = shownGraph?.nodes.find((item) => item.id === selectedNode) ?? shownGraph?.nodes[0];
  if (!graphNode) return;
  selectedNode = graphNode.id;
  document.querySelectorAll('[data-node]').forEach((button) => button.setAttribute('aria-pressed', String(button.dataset.node === selectedNode)));
  setText('node-title', graphNode.label);
  setText('node-kind', graphNode.kind);
  setText('node-detail', graphNode.id === 'observation' && graphNode.data.observation ? 'Synthetic pool data recorded in this browser.' : graphNode.detail);
  setText('node-data', JSON.stringify(graphNode.data, null, 2));
  const entry = selectedEntry();
  setText('node-context', entry ? `EVENT ${current.view.entries.indexOf(entry) + 1} / ORIGINAL INPUT` : 'CURRENT STATE / INPUT SNAPSHOT');
  const mandate = shownGraph.nodes.find((item) => item.id === 'mandate').data;
  const observation = shownGraph.nodes.find((item) => item.id === 'observation').data.observation;
  const data = graphNode.data;
  const facts = [];
  if (graphNode.id === 'mandate') {
    facts.push(['Authority', data.revoked ? 'Revoked' : 'Active'], ['Investment cap', `${money(data.investmentCapUnits)} USDC`], ['Liquidity floor', `${money(data.minLiquidityUnits)} USDC`], ['Evidence age limit', `${data.maxObservationAgeSeconds}s`]);
  } else if (graphNode.id === 'observation') {
    facts.push(['Source', 'Synthetic input in this browser']);
    if (observation) {
      const age = Date.parse(shownGraph.at) - Date.parse(observation.observedAt);
      const status = observation.status === 'unavailable' ? 'Unavailable' : age < 0 ? 'Future timestamp' : age > mandate.maxObservationAgeSeconds * 1000 ? 'Stale' : 'Fresh';
      facts.push(['Evidence status', status], ['Observed at', stamp(observation.observedAt)], [entry?.decision ? 'Age at decision' : 'Age at input snapshot', age < 0 ? `${ageText(-age)} after snapshot` : ageText(age)], ['Available liquidity', observation.availableLiquidityUnits === null ? 'Unavailable' : `${money(observation.availableLiquidityUnits)} USDC`], ['Required liquidity', `${money(mandate.minLiquidityUnits)} USDC`], ['Allowed age', `${mandate.maxObservationAgeSeconds}s`]);
    } else facts.push(['Evidence status', 'Missing. No observation recorded.']);
  } else {
    const amounts = { reserve: ['Protected balance', 'reserveUnits'], undelegated: ['Undelegated balance', 'undelegatedUnits'], account: ['Delegated idle', 'idleUnits'], position: ['Supplied balance', 'positionUnits'] };
    const [label, key] = amounts[graphNode.id];
    facts.push([label, `${money(data[key])} USDC`]);
    if (['reserve', 'undelegated'].includes(graphNode.id)) facts.push(['Agent authority', 'Excluded from agent actions']);
    if (['account', 'position'].includes(graphNode.id)) facts.push(['Investment cap', `${money(mandate.investmentCapUnits)} USDC`]);
  }
  facts.push([entry?.decision ? 'Decision time' : 'Input snapshot time', stamp(shownGraph.at)]);
  $('node-facts').replaceChildren(...facts.map(([label, value]) => {
    const row = node('div');
    row.append(node('dt', '', label), node('dd', '', value));
    return row;
  }));
  const checks = entry?.decision?.checks.filter((check) => check.evidenceNodeIds.includes(graphNode.id)) ?? [];
  $('node-rules').replaceChildren(...checks.map((check) => {
    const item = node('p', '', `${check.status} · ${check.label}: ${check.detail}`);
    item.dataset.checkId = check.id;
    return item;
  }));
}

function renderGraph() {
  const entry = selectedEntry();
  shownGraph = entry?.graph ?? current.view.graph;
  const check = selectedCheck();
  const evidence = new Set(check?.evidenceNodeIds ?? entry?.decision?.evidenceNodeIds ?? []);
  setText('graph-context', entry ? `Event ${current.view.entries.indexOf(entry) + 1} / Input graph` : 'Current state');
  $('graph-context').dataset.eventId = entry?.eventId ?? '';
  setText('graph-snapshot', `${entry ? 'Original input' : 'Current input snapshot'} · ${stamp(shownGraph.at)} · ${entry?.decision?.policyVersion ?? current.view.policyVersion}`);
  setText('graph-evidence-label', check ? `${check.status} · ${check.label}. Marked nodes are this check's evidence. Marked links connect to that evidence.` : entry?.decision ? 'Evidence marks the inputs cited by this decision. Select a check to narrow the trace.' : 'Select a saved decision to trace its checks.');
  setText('graph-record-label', entry ? isLegacy(entry) ? 'Reconstructed legacy history. These inputs were replayed from the original commands.' : 'Saved input snapshot. Current balances remain in the cards above.' : 'The graph shows the latest state. Saved decision checks open their original input snapshot.');
  $('show-current').hidden = !entry;
  const buttons = shownGraph.nodes.map((graphNode) => {
    const button = node('button', 'graph-node');
    button.type = 'button';
    button.id = `graph-node-${graphNode.id}`;
    button.dataset.node = graphNode.id;
    button.dataset.evidence = String(evidence.has(graphNode.id));
    button.setAttribute('aria-pressed', String(graphNode.id === selectedNode));
    const [x, y] = NODE_POSITIONS[graphNode.id] ?? [12, 16];
    button.style.left = `${x / 9}%`;
    button.style.top = `${y / 3.3}%`;
    let summary = graphNode.detail;
    if (graphNode.id === 'observation') {
      const observation = graphNode.data.observation;
      summary = observation ? 'Unavailable evidence' : 'Missing evidence';
      if (observation?.status === 'ok') {
        const age = Date.parse(shownGraph.at) - Date.parse(observation.observedAt);
        const ageLimit = shownGraph.nodes.find((item) => item.id === 'mandate').data.maxObservationAgeSeconds * 1000;
        const freshness = age < 0 ? 'Future' : age > ageLimit ? 'Stale' : 'Fresh';
        summary = `${freshness} · ${money(observation.availableLiquidityUnits)} USDC`;
      }
    }
    button.append(node('span', 'node-type', graphNode.kind), node('strong', '', graphNode.label), node('span', 'node-summary', summary));
    if (evidence.has(graphNode.id)) button.append(node('span', 'evidence-marker', 'Evidence'));
    button.addEventListener('click', () => { selectedNode = graphNode.id; renderNodeInspector(); });
    return button;
  });
  $('graph-nodes').replaceChildren(...buttons);
  const paths = [];
  const relations = [];
  for (const edge of shownGraph.edges) {
    const relation = edge.relation.replaceAll('_', ' ');
    const source = shownGraph.nodes.find((item) => item.id === edge.source)?.label ?? edge.source;
    const target = shownGraph.nodes.find((item) => item.id === edge.target)?.label ?? edge.target;
    const highlighted = evidence.has(edge.source) || evidence.has(edge.target);
    const relationItem = node('li', highlighted ? 'evidence-relation' : '', `${source} → ${relation} → ${target}${highlighted ? ' · Evidence link' : ''}`);
    relationItem.dataset.source = edge.source;
    relationItem.dataset.target = edge.target;
    relations.push(relationItem);
    const position = EDGE_PATHS[`${edge.source}:${edge.target}:${edge.relation}`];
    if (!position) continue;
    const path = document.createElementNS(SVG_NS, 'path');
    path.setAttribute('d', position[0]);
    path.setAttribute('class', `connection${highlighted ? ' evidence-link' : ''}`);
    path.dataset.source = edge.source;
    path.dataset.target = edge.target;
    const label = document.createElementNS(SVG_NS, 'text');
    label.setAttribute('x', position[1]);
    label.setAttribute('y', position[2]);
    label.textContent = relation;
    paths.push(path, label);
  }
  $('graph-paths').replaceChildren(...paths);
  $('graph-relations').replaceChildren(...relations);
  $('graph-result').hidden = !entry?.decision;
  if (entry?.decision) {
    setText('graph-decision-title', `${entry.decision.action} · ${money(entry.decision.amountUnits)} USDC`);
    setText('graph-decision-detail', `${entry.decision.status} · ${entry.decision.policyVersion}`);
    setText('graph-outcome-status', entry.outcome.status);
    setText('graph-outcome-detail', entry.outcome.message);
    $('graph-decision-card').dataset.tone = tone(entry.decision.status);
    $('graph-outcome-card').dataset.tone = tone(entry.outcome.status);
  }
  renderNodeInspector();
}

function renderDecision() {
  const historical = selectedEntry();
  const entry = historical ?? latestDecisionEntry();
  const decision = entry?.decision;
  setText('decision-eyebrow', historical ? 'SELECTED EVENT' : 'LATEST SAVED DECISION');
  setText('decision-title', decision ? { SUPPLY: 'Supply', REDEEM: 'Redeem', HOLD: 'Hold' }[decision.action] : entry ? EVENT_LABELS[entry.type] : 'Ready when you are.');
  setText('decision-status', decision?.status ?? entry?.outcome.status ?? 'Awaiting a cycle');
  $('decision-status').dataset.tone = tone(decision?.status ?? entry?.outcome.status);
  setText('decision-amount', decision ? `${money(decision.amountUnits)} USDC` : '');
  setText('decision-time', entry ? `${historical ? 'Recorded' : 'Last evaluated'} ${stamp(entry.at)}` : '');
  setText('decision-policy', `Rules: ${decision?.policyVersion ?? current.view.policyVersion}${entry && isLegacy(entry) ? ' · Reconstructed legacy history' : ''}`);
  const reasons = decision?.reasons ?? (entry ? ['This event records a change. Run a cycle to evaluate the graph.'] : ['Choose synthetic evidence, then run one cycle.']);
  $('decision-reasons').replaceChildren(...reasons.map((reason) => node('li', '', reason)));
  setText('decision-outcome', entry?.outcome.message ?? 'No movement has been simulated.');
  $('inspect-decision').hidden = !decision || Boolean(historical);
  $('rule-checks-panel').hidden = !decision;
  setText('rule-checks-title', decision ? `Rule checks · Event ${current.view.entries.indexOf(entry) + 1}${historical ? '' : ' (latest decision)'}` : 'Rule checks');
  $('decision-checks').replaceChildren(...(decision?.checks ?? []).map((check, index) => {
    const item = node('li');
    const button = node('button', 'rule-check');
    button.type = 'button';
    button.id = `rule-check-${check.id}`;
    button.dataset.checkId = check.id;
    button.dataset.checkEventId = entry.eventId;
    button.dataset.status = check.status;
    button.setAttribute('aria-pressed', String(selectedHistoryId === entry.eventId && selectedCheckId === check.id));
    button.setAttribute('aria-controls', 'graph-nodes node-inspector');
    button.append(node('span', 'check-order', String(index + 1).padStart(2, '0')), node('span', 'check-label', check.label), node('span', 'check-status', check.status), node('span', 'check-detail', check.detail));
    button.addEventListener('click', () => {
      selectedNode = check.evidenceNodeIds[0] ?? 'mandate';
      inspectHistory(entry.eventId, check.id);
      $(`rule-check-${check.id}`).focus({ preventScroll: true });
    });
    item.append(button);
    return item;
  }));
  $('history-balances').hidden = !historical;
  if (historical) {
    const b = historical.balances;
    setText('history-balances', `After this event: reserve ${money(b.reserveUnits)}, undelegated ${money(b.undelegatedUnits)}, idle ${money(b.idleUnits)}, position ${money(b.positionUnits)} USDC. The balance cards above show current state.`);
  }
}

function inspectHistory(eventId, checkId = null) {
  selectedHistoryId = eventId;
  selectedCheckId = checkId;
  renderGraph();
  renderDecision();
  document.querySelectorAll('.history-event').forEach((button) => button.setAttribute('aria-pressed', String(button.dataset.eventId === eventId)));
}

function renderHistory() {
  const entries = current.view.entries;
  const legacyCount = current.view.legacyEventCount;
  $('legacy-history-note').hidden = legacyCount === 0;
  setText('legacy-history-note', `${legacyCount} legacy ${legacyCount === 1 ? 'event was' : 'events were'} reconstructed from saved commands. These are not original input snapshots. Later events retain their original input and outcome.`);
  $('empty-history').hidden = entries.length > 0;
  $('history-list').replaceChildren(...entries.map((entry, index) => {
    const item = node('li');
    const button = node('button', 'history-event');
    button.type = 'button';
    button.dataset.eventId = entry.eventId;
    button.setAttribute('aria-pressed', String(entry.eventId === selectedHistoryId));
    const body = node('span');
    body.append(node('span', 'event-name', EVENT_LABELS[entry.type]), node('span', 'event-message', entry.outcome.message));
    if (index < legacyCount) body.append(node('span', 'legacy-label', 'Reconstructed legacy history'));
    const meta = node('span', 'event-meta');
    const status = node('span', 'event-status', `${entry.outcome.action ? `${entry.outcome.action} · ` : ''}${entry.outcome.status}`);
    status.dataset.tone = tone(entry.outcome.status);
    meta.append(status, node('span', '', stamp(entry.at)));
    button.append(node('span', 'event-number', String(index + 1).padStart(2, '0')), body, meta);
    button.addEventListener('click', () => {
      inspectHistory(entry.eventId);
      $('graph-title').scrollIntoView({ block: 'start', behavior: 'instant' });
    });
    item.append(button);
    return item;
  }));
  setText('run-id', `Run ${current.run.id} · Created ${stamp(current.run.createdAt)} · ${current.view.policyVersion} · Saved in this browser`);
}

function render() {
  $('setup-panel').hidden = Boolean(current) || storageFailed;
  $('workspace').hidden = !current;
  if (current) {
    const { balances: b, mandate, revoked } = current.view.state;
    for (const [id, units] of Object.entries({ 'total-balance': b.totalUnits, 'reserve-balance': b.reserveUnits, 'undelegated-balance': b.undelegatedUnits, 'idle-balance': b.idleUnits, 'position-balance': b.positionUnits, 'mandate-cap': mandate.investmentCapUnits, 'mandate-liquidity': mandate.minLiquidityUnits })) setText(id, money(units));
    setText('mandate-age', `${mandate.maxObservationAgeSeconds}s`);
    setText('mandate-status', revoked ? 'Permanently revoked' : 'Active mandate');
    $('mandate-status').dataset.tone = revoked ? 'blocked' : 'ok';
    renderObservation();
    renderGraph();
    renderDecision();
    renderHistory();
  }
  updateControls();
}

async function command(type, payload = {}) {
  if (busy || !current || storageFailed) return false;
  busy = true;
  clearError();
  updateControls();
  try {
    const event = { id: crypto.randomUUID(), at: new Date().toISOString(), type, ...payload };
    current = await store.dispatch(event, current.view.state.revision);
    selectedHistoryId = current.view.entries.at(-1)?.decision ? event.id : null;
    selectedCheckId = null;
    if (current.view.state.revoked) stopLoop('Agent stopped. The mandate is permanently revoked.');
    else if (current.run.events.length >= MAX_EVENTS) stopLoop('Agent stopped. The 200-event limit is reached. Export the saved run.');
    render();
    message(current.view.entries.at(-1)?.outcome.message ?? 'Event saved.');
    return true;
  } catch (error) {
    showError(error);
    return false;
  } finally {
    busy = false;
    updateControls();
  }
}

async function recordScenario(scenario) {
  if (!current || busy || storageFailed) return;
  const { mandate, balances } = current.view.state;
  const floor = BigInt(mandate.minLiquidityUnits);
  const total = BigInt(balances.totalUnits);
  const position = BigInt(balances.positionUnits);
  const cap = BigInt(mandate.investmentCapUnits);
  let liquidity = total > floor ? total : floor;
  if (scenario === 'low') {
    const exitAmount = position > 0n ? position : cap;
    liquidity = floor / 2n < exitAmount / 2n ? floor / 2n : exitAmount / 2n;
  }
  const observation = {
    source: 'synthetic',
    status: scenario === 'unavailable' ? 'unavailable' : 'ok',
    observedAt: new Date(Date.now() - (scenario === 'stale' ? (mandate.maxObservationAgeSeconds + 1) * 1000 : 0)).toISOString(),
    availableLiquidityUsdc: scenario === 'unavailable' ? null : money(String(liquidity)),
  };
  if (await command('observe', { observation })) {
    selectedScenario = scenario;
    renderObservation();
    if (scenario === 'low' && floor === 0n) message('Zero liquidity recorded. A zero liquidity floor cannot trigger an automatic exit. Use owner redemption to test the exit.');
  }
}

async function loopTick() {
  loopTimer = null;
  if (!loopRunning) return;
  if (busy) {
    loopTimer = setTimeout(loopTick, LOOP_DELAY_MS);
    return;
  }
  const saved = await command('cycle');
  if (!saved || !loopRunning) return;
  loopRemaining -= 1;
  if (loopRemaining === 0) {
    stopLoop('Agent stopped after 10 cycles. Start it again to continue.');
    return;
  }
  setText('loop-status', `Agent running · ${LOOP_CYCLES - loopRemaining} / ${LOOP_CYCLES} cycles saved · Next cycle in 5s`);
  loopTimer = setTimeout(loopTick, LOOP_DELAY_MS);
}

$('setup-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  if (busy || current || storageFailed) return;
  const fields = new FormData(event.currentTarget);
  busy = true;
  clearError();
  updateControls();
  try {
    current = await store.create({
      id: crypto.randomUUID(), createdAt: new Date().toISOString(),
      totalUsdc: String(fields.get('totalUsdc')).trim(),
      reserveUsdc: String(fields.get('reserveUsdc')).trim(),
      investmentCapUsdc: String(fields.get('investmentCapUsdc')).trim(),
      minLiquidityUsdc: String(fields.get('minLiquidityUsdc')).trim(),
      maxObservationAgeSeconds: Number(fields.get('maxObservationAgeSeconds')),
    });
    stopLoop('Agent stopped. Choose evidence before running a cycle.');
    render();
    message('Simulation saved. Choose a synthetic observation, then run one cycle.');
    $('balances-title').scrollIntoView({ block: 'start', behavior: 'instant' });
  } catch (error) {
    showError(error);
  } finally {
    busy = false;
    updateControls();
  }
});

document.querySelectorAll('[data-scenario]').forEach((button) => button.addEventListener('click', () => recordScenario(button.dataset.scenario)));
$('custom-evidence-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  if (busy || !current || storageFailed) return;
  const fields = new FormData(event.currentTarget);
  const age = Number(fields.get('age'));
  if (!Number.isInteger(age) || age < 0 || age > 86400 || fields.get('age') === '') {
    showError(new Error('Evidence age must be an integer from 0 through 86400 seconds.'));
    return;
  }
  const observation = {
    source: 'synthetic', status: 'ok',
    observedAt: new Date(Date.now() - age * 1000).toISOString(),
    availableLiquidityUsdc: String(fields.get('liquidity')).trim(),
  };
  if (await command('observe', { observation })) {
    selectedScenario = null;
    renderObservation();
    message('Custom synthetic evidence saved. Run a cycle to evaluate the new input.');
  }
});
$('run-cycle').addEventListener('click', () => command('cycle'));
$('start-agent').addEventListener('click', () => {
  if (busy || !current || storageFailed || loopRunning || current.view.state.revoked || current.run.events.length >= MAX_EVENTS) return;
  loopRunning = true;
  loopRemaining = LOOP_CYCLES;
  $('loop-status').dataset.running = 'true';
  setText('loop-status', 'Agent running · Uses saved synthetic evidence · Up to 10 cycles');
  updateControls();
  void loopTick();
});
$('stop-agent').addEventListener('click', () => stopLoop('Agent stopped by you.'));
$('owner-redeem').addEventListener('click', () => {
  stopLoop('Agent stopped for an owner request.');
  void command('owner_redeem');
});
$('revoke-mandate').addEventListener('click', () => {
  stopLoop('Agent stopped while you review revocation.');
  $('revoke-dialog').returnValue = 'cancel';
  $('revoke-dialog').showModal();
});
$('revoke-dialog').addEventListener('close', () => {
  if ($('revoke-dialog').returnValue === 'confirm') void command('revoke');
});
$('show-current').addEventListener('click', () => inspectHistory(null));
$('inspect-decision').addEventListener('click', () => {
  const entry = latestDecisionEntry();
  if (entry) inspectHistory(entry.eventId);
});
$('export-run').addEventListener('click', () => {
  clearError();
  try {
    const json = store.exportRun();
    const url = URL.createObjectURL(new Blob([json], { type: 'application/json' }));
    const link = node('a');
    link.href = url;
    link.download = `falcon-treasury-simulation-${current.run.id}.json`;
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    message(JSON.parse(json).schemaVersion === 1
      ? 'Legacy commands prepared for download. This file has no saved rule version or input snapshots.'
      : 'Simulation JSON prepared for download. It includes commands, the rule version, input graphs, checks, and outcomes.');
  } catch (error) { showError(error); }
});

window.addEventListener('pagehide', () => stopLoop('Agent stopped when this page closed.'));
document.addEventListener('visibilitychange', () => {
  if (document.hidden && loopRunning) stopLoop('Agent stopped when this page was hidden.');
});
window.addEventListener('storage', (event) => {
  if (event.key !== 'falcon.treasury.simulation.v1' && event.key !== null) return;
  stopLoop('Agent stopped because saved state changed in another tab.');
  try {
    const saved = store.load();
    if (!saved) throw new Error('The saved simulation is missing. Reload to check browser storage.');
    current = saved;
    storageFailed = false;
    selectedHistoryId = null;
    selectedCheckId = null;
    selectedScenario = null;
    clearError();
    render();
    message('Loaded the saved change from another tab. The agent remains stopped.');
  } catch (error) {
    storageFailed = true;
    showError(error);
    render();
  }
});

try {
  current = store.load();
  render();
  if (current) {
    stopLoop(current.view.state.revoked ? 'Agent stopped. The mandate is permanently revoked.' : 'Agent stopped. Saved history restored.');
    message('Saved simulation restored. The agent stays stopped until you start it.');
  }
} catch (error) {
  storageFailed = true;
  showError(error);
  render();
}

// Display age only. This timer never records or refreshes an observation.
setInterval(renderObservation, 1000);
