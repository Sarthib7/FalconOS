const MAX_UNITS = 18446744073709551615n;
const SCALE = 1000000n;
const MAX_EVENTS = 200;
const POLICY_VERSION = 'treasury-rules/1';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const BALANCE_KEYS = ['totalUnits', 'reserveUnits', 'undelegatedUnits', 'idleUnits', 'positionUnits'];
const MANDATE_KEYS = ['investmentCapUnits', 'minLiquidityUnits', 'maxObservationAgeSeconds'];
const SETUP_KEYS = ['totalUsdc', 'reserveUsdc', 'investmentCapUsdc', 'minLiquidityUsdc', 'maxObservationAgeSeconds'];
const NODE_KINDS = {
  mandate: 'mandate', reserve: 'protected-cash', undelegated: 'owner-cash',
  account: 'investment-account', position: 'lending-position', observation: 'observation',
};
const REQUIRED_EDGES = [
  { source: 'mandate', target: 'account', relation: 'authorizes' },
  { source: 'mandate', target: 'reserve', relation: 'excludes' },
  { source: 'mandate', target: 'undelegated', relation: 'excludes' },
  { source: 'account', target: 'position', relation: 'owns' },
  { source: 'position', target: 'observation', relation: 'depends_on' },
];
const CHECKS = [
  ['relationships', 'Required relationships', ['mandate', 'reserve', 'undelegated', 'account', 'position', 'observation']],
  ['authority', 'Agent authority', ['mandate']],
  ['observation', 'Synthetic observation', ['observation']],
  ['freshness', 'Observation age', ['mandate', 'observation']],
  ['liquidity_floor', 'Supply liquidity floor', ['mandate', 'observation']],
  ['position', 'Position route', ['position']],
  ['redemption_liquidity', 'Full redemption liquidity', ['position', 'observation']],
  ['idle_balance', 'Delegated idle balance', ['account']],
  ['investment_cap', 'Investment cap', ['mandate', 'account', 'position']],
];

function exactKeys(value, keys, name) {
  if (!value || typeof value !== 'object' || Array.isArray(value)
      || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) {
    throw new Error(`${name} must be a plain object.`);
  }
  const actual = Reflect.ownKeys(value);
  if (actual.length !== keys.length || actual.some((key) => !keys.includes(key))) {
    throw new Error(`${name} has missing or unknown fields.`);
  }
  if (actual.some((key) => !Object.prototype.hasOwnProperty.call(Object.getOwnPropertyDescriptor(value, key), 'value'))) {
    throw new Error(`${name} must contain data fields, not accessors.`);
  }
}

function uuid(value, name) {
  if (typeof value !== 'string' || !UUID.test(value)) throw new Error(`${name} must be a UUID.`);
  return value;
}

function timestamp(value, name) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)) {
    throw new Error(`${name} must be a canonical UTC ISO timestamp.`);
  }
  const ms = Date.parse(value);
  if (!Number.isFinite(ms) || new Date(ms).toISOString() !== value) {
    throw new Error(`${name} must be a valid UTC date.`);
  }
  return ms;
}

function units(value, name) {
  if (typeof value !== 'string' || value.length > 20 || !/^(0|[1-9]\d*)$/.test(value)) {
    throw new Error(`${name} must be an unsigned integer-unit string.`);
  }
  const amount = BigInt(value);
  if (amount > MAX_UNITS) throw new Error(`${name} exceeds the unsigned 64-bit token amount limit.`);
  return amount;
}

function parseUsdc(value, name) {
  if (typeof value !== 'string' || value.length > 21 || !/^(0|[1-9]\d*)(?:\.\d{1,6})?$/.test(value)) {
    throw new Error(`${name} must be an unsigned USDC decimal string with at most six fractional digits.`);
  }
  const [whole, fraction = ''] = value.split('.');
  const amount = BigInt(whole) * SCALE + BigInt(fraction.padEnd(6, '0'));
  if (amount > MAX_UNITS) throw new Error(`${name} exceeds the unsigned 64-bit token amount limit.`);
  return amount;
}

export function formatUsdc(integerUnits) {
  const amount = units(integerUnits, 'Amount');
  const fraction = (amount % SCALE).toString().padStart(6, '0').replace(/0+$/, '');
  return `${amount / SCALE}${fraction ? `.${fraction}` : ''}`;
}

function ageLimit(value) {
  if (!Number.isInteger(value) || value < 1 || value > 3600) {
    throw new Error('Observation age limit must be an integer from 1 through 3600 seconds.');
  }
}

function validateSetup(setup) {
  exactKeys(setup, SETUP_KEYS, 'Setup');
  const total = parseUsdc(setup.totalUsdc, 'Total USDC');
  const reserve = parseUsdc(setup.reserveUsdc, 'Spending reserve');
  const cap = parseUsdc(setup.investmentCapUsdc, 'Investment cap');
  parseUsdc(setup.minLiquidityUsdc, 'Minimum liquidity');
  ageLimit(setup.maxObservationAgeSeconds);
  if (reserve + cap > total) throw new Error('Spending reserve plus investment cap exceeds total USDC.');
}

function validateObservation(observation, normalized = false) {
  const amountKey = normalized ? 'availableLiquidityUnits' : 'availableLiquidityUsdc';
  exactKeys(observation, ['source', 'status', 'observedAt', amountKey], 'Observation');
  if (observation.source !== 'synthetic') throw new Error('Only synthetic observations are allowed in simulation.');
  if (!['ok', 'unavailable'].includes(observation.status)) throw new Error('Observation status is invalid.');
  timestamp(observation.observedAt, 'Observation time');
  if (observation.status === 'ok') {
    (normalized ? units : parseUsdc)(observation[amountKey], 'Available liquidity');
  } else if (observation[amountKey] !== null) {
    throw new Error('An unavailable observation must have null liquidity.');
  }
}

function validateLedger(balances, mandate) {
  exactKeys(balances, BALANCE_KEYS, 'Balances');
  exactKeys(mandate, MANDATE_KEYS, 'Mandate');
  const parsed = Object.fromEntries(BALANCE_KEYS.map((key) => [key, units(balances[key], key)]));
  const cap = units(mandate.investmentCapUnits, 'Investment cap');
  units(mandate.minLiquidityUnits, 'Minimum liquidity');
  ageLimit(mandate.maxObservationAgeSeconds);
  if (parsed.reserveUnits + parsed.undelegatedUnits + parsed.idleUnits + parsed.positionUnits !== parsed.totalUnits) {
    throw new Error('Balance conservation failed.');
  }
  if (parsed.idleUnits + parsed.positionUnits > cap) throw new Error('Delegated balances exceed the investment cap.');
}

function revision(value) {
  if (!Number.isInteger(value) || value < 0 || value > MAX_EVENTS) throw new Error('Revision must match a bounded event count.');
}

function validateDecision(value) {
  exactKeys(value, ['mode', 'action', 'status', 'amountUnits', 'reasons', 'evidenceNodeIds', 'graphId', 'policyVersion', 'checks'], 'Decision');
  if (value.policyVersion !== POLICY_VERSION) throw new Error('Decision policy version is unsupported.');
  if (value.mode !== 'simulation' || !['SUPPLY', 'REDEEM', 'HOLD'].includes(value.action)
      || !['READY', 'BLOCKED', 'NO_DATA'].includes(value.status)) throw new Error('Decision mode, action, or status is invalid.');
  units(value.amountUnits, 'Decision amount');
  if (!Array.isArray(value.reasons) || !value.reasons.length || value.reasons.length > 10
      || value.reasons.some((reason) => typeof reason !== 'string' || !reason || reason.length > 500)) {
    throw new Error('Decision reasons are invalid.');
  }
  if (!Array.isArray(value.evidenceNodeIds) || value.evidenceNodeIds.length > 6
      || value.evidenceNodeIds.some((id) => !Object.hasOwn(NODE_KINDS, id))) throw new Error('Decision evidence IDs are invalid.');
  if (typeof value.graphId !== 'string' || !value.graphId || value.graphId.length > 100) throw new Error('Decision graph ID is invalid.');
  if (!Array.isArray(value.checks) || value.checks.length !== CHECKS.length) throw new Error('Decision checks are invalid.');
  value.checks.forEach((check, index) => {
    exactKeys(check, ['id', 'label', 'status', 'detail', 'evidenceNodeIds'], 'Decision check');
    if (check.id !== CHECKS[index][0] || check.label !== CHECKS[index][1]
        || !['PASS', 'BLOCKED', 'NO_DATA', 'SKIPPED'].includes(check.status)
        || typeof check.detail !== 'string' || !check.detail || check.detail.length > 500
        || !Array.isArray(check.evidenceNodeIds) || check.evidenceNodeIds.length > 6
        || check.evidenceNodeIds.some((id) => !Object.hasOwn(NODE_KINDS, id))) throw new Error('Decision check is invalid.');
  });
}

function validateState(state) {
  exactKeys(state, ['runId', 'revision', 'createdAt', 'at', 'mode', 'revoked', 'balances', 'mandate', 'observation', 'lastDecision'], 'State');
  uuid(state.runId, 'Run ID');
  revision(state.revision);
  if (timestamp(state.at, 'State time') < timestamp(state.createdAt, 'Creation time')) throw new Error('State time precedes creation.');
  if (state.mode !== 'simulation' || typeof state.revoked !== 'boolean') throw new Error('State mode or revocation is invalid.');
  validateLedger(state.balances, state.mandate);
  if (state.observation !== null) validateObservation(state.observation, true);
  if (state.lastDecision !== null) validateDecision(state.lastDecision);
}

function graphId(runId, currentRevision, at) { return `${runId}:${currentRevision}:${at}`; }

export function buildGraph(state, at) {
  validateState(state);
  if (timestamp(at, 'Graph time') < timestamp(state.at, 'State time')) throw new Error('Graph time precedes state time.');
  const { balances: balance, mandate, observation } = state;
  const node = (id, label, detail, data) => ({ id, kind: NODE_KINDS[id], label, detail, data });
  return {
    id: graphId(state.runId, state.revision, at), mode: 'simulation', at, revision: state.revision,
    nodes: [
      node('mandate', 'Owner mandate', state.revoked ? 'Revoked. Agent movement is blocked.' : 'Fixed cap and liquidity rules.', { ...mandate, revoked: state.revoked }),
      node('reserve', 'Spending reserve', 'Outside agent authority.', { reserveUnits: balance.reserveUnits }),
      node('undelegated', 'Undelegated cash', 'Outside agent authority.', { undelegatedUnits: balance.undelegatedUnits }),
      node('account', 'Investment account', 'Delegated idle USDC. Simulation only.', { runId: state.runId, totalUnits: balance.totalUnits, idleUnits: balance.idleUnits }),
      node('position', 'Lending position', 'Owner-controlled simulated position.', { positionUnits: balance.positionUnits }),
      node('observation', 'Synthetic liquidity', observation ? `${observation.status} at ${observation.observedAt}` : 'No observation recorded.', { observation: observation ? { ...observation } : null }),
    ],
    edges: REQUIRED_EDGES.map((edge) => ({ ...edge })),
  };
}

function readGraph(graph) {
  exactKeys(graph, ['id', 'mode', 'at', 'revision', 'nodes', 'edges'], 'Graph');
  timestamp(graph.at, 'Graph time');
  revision(graph.revision);
  if (graph.mode !== 'simulation' || !Array.isArray(graph.nodes) || graph.nodes.length !== 6
      || !Array.isArray(graph.edges) || graph.edges.length > REQUIRED_EDGES.length) throw new Error('Graph structure or mode is invalid.');
  const nodes = new Map();
  for (const node of graph.nodes) {
    exactKeys(node, ['id', 'kind', 'label', 'detail', 'data'], 'Graph node');
    if (!Object.hasOwn(NODE_KINDS, node.id) || node.kind !== NODE_KINDS[node.id] || nodes.has(node.id)) throw new Error('Graph node identity is invalid or duplicated.');
    if (typeof node.label !== 'string' || !node.label || node.label.length > 100
        || typeof node.detail !== 'string' || !node.detail || node.detail.length > 500) throw new Error('Graph node text is invalid.');
    nodes.set(node.id, node.data);
  }
  const get = (id, keys) => { const data = nodes.get(id); exactKeys(data, keys, `${id} graph data`); return data; };
  const mandateData = get('mandate', [...MANDATE_KEYS, 'revoked']);
  if (typeof mandateData.revoked !== 'boolean') throw new Error('Graph revocation must be a boolean.');
  const mandate = Object.fromEntries(MANDATE_KEYS.map((key) => [key, mandateData[key]]));
  const reserve = get('reserve', ['reserveUnits']);
  const undelegated = get('undelegated', ['undelegatedUnits']);
  const account = get('account', ['runId', 'totalUnits', 'idleUnits']);
  const position = get('position', ['positionUnits']);
  const { observation } = get('observation', ['observation']);
  uuid(account.runId, 'Graph run ID');
  if (graph.id !== graphId(account.runId, graph.revision, graph.at)) throw new Error('Graph identity does not match its state and time.');
  const balances = { totalUnits: account.totalUnits, ...reserve, ...undelegated, idleUnits: account.idleUnits, ...position };
  validateLedger(balances, mandate);
  if (observation !== null) validateObservation(observation, true);
  const signatures = new Set();
  for (const edge of graph.edges) {
    exactKeys(edge, ['source', 'target', 'relation'], 'Graph edge');
    const signature = JSON.stringify([edge.source, edge.target, edge.relation]);
    if (signatures.has(signature) || !REQUIRED_EDGES.some((required) => required.source === edge.source
        && required.target === edge.target && required.relation === edge.relation)) throw new Error('Graph edge is invalid or duplicated.');
    signatures.add(signature);
  }
  return { mandate, balances, observation, revoked: mandateData.revoked, missingEdges: REQUIRED_EDGES.filter((edge) => !signatures.has(JSON.stringify([edge.source, edge.target, edge.relation]))) };
}

function evaluateGraph(graph, ownerRedemption) {
  const { mandate, balances, observation, revoked, missingEdges } = readGraph(graph);
  const checks = [];
  const check = (status, detail) => {
    const [id, label, evidenceNodeIds] = CHECKS[checks.length];
    checks.push({ id, label, status, detail, evidenceNodeIds: [...evidenceNodeIds] });
  };
  const result = (action, status, amount, reason, evidenceNodeIds) => {
    while (checks.length < CHECKS.length) check('SKIPPED', 'Not evaluated because an earlier check determined the action.');
    return {
      mode: 'simulation', action, status, amountUnits: amount.toString(), reasons: [reason], evidenceNodeIds, graphId: graph.id,
      policyVersion: POLICY_VERSION, checks,
    };
  };
  check(missingEdges.length ? 'BLOCKED' : 'PASS', missingEdges.length
    ? `Missing relationships: ${missingEdges.map((edge) => `${edge.source} ${edge.relation} ${edge.target}`).join('; ')}.`
    : 'All five required relationships are present.');
  if (missingEdges.length) return result('HOLD', 'BLOCKED', 0n, 'Required graph relationships are missing. Simulation movement is blocked.', ['mandate', 'account', 'position', 'observation']);
  check(ownerRedemption ? 'SKIPPED' : revoked ? 'BLOCKED' : 'PASS', ownerRedemption
    ? 'Explicit owner redemption does not use agent authority. The mandate remains unchanged.'
    : revoked ? 'The mandate is revoked. Agent movement is blocked.' : 'The owner mandate permits agent movement within its rules.');
  if (revoked && !ownerRedemption) return result('HOLD', 'BLOCKED', 0n, 'The mandate is revoked. Every agent movement is blocked.', ['mandate']);
  check(observation === null || observation.status === 'unavailable' ? 'NO_DATA' : 'PASS', observation === null
    ? 'No synthetic observation has been recorded.' : observation.status === 'unavailable'
      ? 'The synthetic observation is unavailable.' : 'The synthetic observation contains an available liquidity amount.');
  if (observation === null || observation.status === 'unavailable') return result('HOLD', 'NO_DATA', 0n, 'A usable synthetic liquidity observation is required.', ['observation']);
  const age = timestamp(graph.at, 'Graph time') - timestamp(observation.observedAt, 'Observation time');
  check(age < 0 || age > mandate.maxObservationAgeSeconds * 1000 ? 'NO_DATA' : 'PASS', age < 0
    ? 'The synthetic observation is from the future.'
    : `Observation age is ${age / 1000} second${age === 1000 ? '' : 's'}. The maximum is ${mandate.maxObservationAgeSeconds} second${mandate.maxObservationAgeSeconds === 1 ? '' : 's'}.`);
  if (age < 0) return result('HOLD', 'NO_DATA', 0n, 'The synthetic observation is from the future.', ['observation']);
  if (age > mandate.maxObservationAgeSeconds * 1000) return result('HOLD', 'NO_DATA', 0n, 'The synthetic observation is stale.', ['mandate', 'observation']);
  const liquidity = units(observation.availableLiquidityUnits, 'Available liquidity');
  const position = units(balances.positionUnits, 'Position');
  const belowFloor = liquidity < units(mandate.minLiquidityUnits, 'Minimum liquidity');
  check(ownerRedemption ? 'SKIPPED' : belowFloor ? 'BLOCKED' : 'PASS', ownerRedemption
    ? 'Owner redemption does not require the supply liquidity floor. Full redemption liquidity is checked separately.'
    : `Synthetic liquidity is ${formatUsdc(liquidity.toString())} USDC. The supply floor is ${formatUsdc(mandate.minLiquidityUnits)} USDC.${belowFloor ? ' New supply is blocked; an existing position requires redemption checks.' : ''}`);
  check('PASS', position === 0n ? 'No simulated position is funded.' : `The simulated position holds ${formatUsdc(position.toString())} USDC.`);
  if (ownerRedemption || (belowFloor && position > 0n)) {
    if (position === 0n) return result('HOLD', 'READY', 0n, 'There is no simulated position to redeem.', ['position']);
    check(liquidity < position ? 'BLOCKED' : 'PASS', liquidity < position
      ? 'Synthetic liquidity cannot cover the full position. The position is preserved.'
      : 'Synthetic liquidity covers full redemption of the position.');
    if (liquidity < position) return result('REDEEM', 'BLOCKED', position, 'Synthetic liquidity cannot cover full redemption. The position is preserved.', ['position', 'observation']);
    return result('REDEEM', 'READY', position, ownerRedemption ? 'The owner requested full simulated redemption.' : 'Liquidity is below the mandate floor. Redeem the full simulated position.', ['mandate', 'position', 'observation']);
  }
  check('SKIPPED', 'This path does not request redemption.');
  if (belowFloor) return result('HOLD', 'BLOCKED', 0n, 'Synthetic liquidity is below the mandate floor. New supply is blocked.', ['mandate', 'observation']);
  if (position > 0n) return result('HOLD', 'READY', 0n, 'The simulated position is already funded.', ['account', 'position']);
  const idle = units(balances.idleUnits, 'Delegated idle');
  check('PASS', idle === 0n ? 'No delegated idle USDC is available to supply.' : `${formatUsdc(idle.toString())} delegated idle USDC is available.`);
  if (idle === 0n) return result('HOLD', 'READY', 0n, 'There is no delegated idle USDC to supply.', ['account']);
  check(position + idle > units(mandate.investmentCapUnits, 'Investment cap') ? 'BLOCKED' : 'PASS',
    `Proposed position is ${formatUsdc((position + idle).toString())} USDC. The investment cap is ${formatUsdc(mandate.investmentCapUnits)} USDC.`);
  if (position + idle > units(mandate.investmentCapUnits, 'Investment cap')) return result('HOLD', 'BLOCKED', 0n, 'The proposed supply exceeds the investment cap.', ['mandate', 'account', 'position']);
  return result('SUPPLY', 'READY', idle, 'Fresh synthetic liquidity meets the floor. Supply delegated idle USDC within the cap.', ['mandate', 'account', 'position', 'observation']);
}

export function decide(graph) { return evaluateGraph(graph, false); }

function validateEvent(event) {
  const keys = event?.type === 'observe' ? ['id', 'at', 'type', 'observation'] : ['id', 'at', 'type'];
  exactKeys(event, keys, 'Event');
  uuid(event.id, 'Event ID');
  timestamp(event.at, 'Event time');
  if (!['observe', 'cycle', 'revoke', 'owner_redeem'].includes(event.type)) throw new Error('Event type is invalid.');
  if (event.type === 'observe') validateObservation(event.observation);
}

function initialState(run) {
  const total = parseUsdc(run.setup.totalUsdc, 'Total USDC');
  const reserve = parseUsdc(run.setup.reserveUsdc, 'Spending reserve');
  const cap = parseUsdc(run.setup.investmentCapUsdc, 'Investment cap');
  return {
    runId: run.id, revision: 0, createdAt: run.createdAt, at: run.createdAt, mode: 'simulation', revoked: false,
    balances: { totalUnits: total.toString(), reserveUnits: reserve.toString(), undelegatedUnits: (total - reserve - cap).toString(), idleUnits: cap.toString(), positionUnits: '0' },
    mandate: { investmentCapUnits: cap.toString(), minLiquidityUnits: parseUsdc(run.setup.minLiquidityUsdc, 'Minimum liquidity').toString(), maxObservationAgeSeconds: run.setup.maxObservationAgeSeconds },
    observation: null, lastDecision: null,
  };
}

function applyEvent(state, event) {
  const graph = buildGraph(state, event.at);
  let decision = null;
  let outcome = { mode: 'simulation', status: 'RECORDED', action: null, amountUnits: '0', message: '' };
  if (event.type === 'observe') {
    state.observation = {
      source: 'synthetic', status: event.observation.status, observedAt: event.observation.observedAt,
      availableLiquidityUnits: event.observation.status === 'ok' ? parseUsdc(event.observation.availableLiquidityUsdc, 'Available liquidity').toString() : null,
    };
    outcome.message = 'Synthetic observation recorded. No simulated funds moved.';
  } else if (event.type === 'revoke') {
    state.revoked = true;
    outcome.message = 'Simulation mandate permanently revoked. Owner redemption remains separate.';
  } else {
    decision = event.type === 'owner_redeem' ? evaluateGraph(graph, true) : decide(graph);
    outcome = { mode: 'simulation', status: decision.status === 'READY' ? 'HELD' : decision.status, action: decision.action, amountUnits: '0', message: `Simulation: ${decision.reasons.join(' ')}` };
    if (decision.status === 'READY' && decision.action !== 'HOLD') {
      const amount = units(decision.amountUnits, 'Decision amount');
      const idle = units(state.balances.idleUnits, 'Delegated idle');
      const position = units(state.balances.positionUnits, 'Position');
      if (state.revoked && event.type !== 'owner_redeem') throw new Error('Revoked agent cannot settle a simulated action.');
      if (decision.action === 'SUPPLY') {
        if (amount > idle || amount + position > units(state.mandate.investmentCapUnits, 'Investment cap')) throw new Error('Simulated supply exceeds available funds or the investment cap.');
        state.balances.idleUnits = (idle - amount).toString();
        state.balances.positionUnits = (position + amount).toString();
      } else {
        if (amount !== position || !state.observation || amount > units(state.observation.availableLiquidityUnits, 'Available liquidity')) throw new Error('Full simulated redemption cannot settle.');
        state.balances.idleUnits = (idle + amount).toString();
        state.balances.positionUnits = '0';
      }
      outcome.status = 'SIMULATED';
      outcome.amountUnits = amount.toString();
    }
    state.lastDecision = decision;
  }
  state.at = event.at;
  state.revision += 1;
  validateState(state);
  return { eventId: event.id, type: event.type, at: event.at, graph, decision, outcome, balances: { ...state.balances } };
}

export function replayRun(run) {
  const saved = run?.schemaVersion === 2;
  exactKeys(run, ['schemaVersion', 'mode', 'id', 'createdAt', 'setup', 'events', ...(saved ? ['policyVersion', 'legacyEventCount', 'records'] : [])], 'Run');
  if (![1, 2].includes(run.schemaVersion) || run.mode !== 'simulation') throw new Error('Run schema or mode is unsupported.');
  if (saved && run.policyVersion !== POLICY_VERSION) throw new Error('Run policy version is unsupported.');
  uuid(run.id, 'Run ID');
  timestamp(run.createdAt, 'Creation time');
  validateSetup(run.setup);
  if (!Array.isArray(run.events) || run.events.length > MAX_EVENTS) throw new Error('A simulation run can contain at most 200 events.');
  if (saved && (!Number.isInteger(run.legacyEventCount) || run.legacyEventCount < 0 || run.legacyEventCount > run.events.length)) {
    throw new Error('Legacy event count must fit the saved journal.');
  }
  if (saved && !Array.isArray(run.records)) throw new Error('Saved records must be an array.');
  const state = initialState(run);
  const entries = [];
  const ids = new Set();
  for (const rawEvent of run.events) {
    validateEvent(rawEvent);
    const identity = rawEvent.id.toLowerCase();
    if (ids.has(identity)) throw new Error('Journal contains a duplicate event ID.');
    ids.add(identity);
    if (timestamp(rawEvent.at, 'Event time') < timestamp(state.at, 'Prior event time')) throw new Error('Event time precedes creation or the prior event.');
    entries.push(applyEvent(state, rawEvent));
  }
  if (saved) {
    if (run.records.length !== entries.length) throw new Error('Saved records must contain one entry per event.');
    entries.forEach((entry, index) => {
      if (!matchesRecord(run.records[index], entry)) throw new Error(`Saved record ${index + 1} does not match replay under ${POLICY_VERSION}.`);
    });
  }
  return { state, graph: buildGraph(state, state.at), entries, policyVersion: POLICY_VERSION, legacyEventCount: saved ? run.legacyEventCount : run.events.length };
}

function matchesRecord(actual, expected) {
  if (expected === null || typeof expected !== 'object') return actual === expected;
  if (!actual || typeof actual !== 'object' || Array.isArray(actual) !== Array.isArray(expected)) return false;
  if (!Array.isArray(actual) && ![Object.prototype, null].includes(Object.getPrototypeOf(actual))) return false;
  const keys = Reflect.ownKeys(expected);
  const actualKeys = Reflect.ownKeys(actual);
  return actualKeys.length === keys.length && keys.every((key) => {
    const descriptor = Object.getOwnPropertyDescriptor(actual, key);
    return descriptor && Object.hasOwn(descriptor, 'value') && matchesRecord(descriptor.value, expected[key]);
  });
}

export function createRun(input) {
  exactKeys(input, ['id', 'createdAt', ...SETUP_KEYS], 'Run setup');
  const { id, createdAt, ...setup } = input;
  const run = { schemaVersion: 2, mode: 'simulation', id, createdAt, setup, events: [], policyVersion: POLICY_VERSION, legacyEventCount: 0, records: [] };
  replayRun(run);
  return run;
}

function eventContent(event) {
  return JSON.stringify([event.id.toLowerCase(), event.at, event.type, event.type === 'observe'
    ? [event.observation.source, event.observation.status, event.observation.observedAt, event.observation.availableLiquidityUsdc] : null]);
}

export function appendEvent(run, event) {
  const view = replayRun(run);
  validateEvent(event);
  const previous = run.events.find((entry) => entry.id.toLowerCase() === event.id.toLowerCase());
  if (previous) {
    if (eventContent(previous) !== eventContent(event)) throw new Error('Event ID was reused with conflicting content.');
    return run;
  }
  if (run.events.length >= MAX_EVENTS) throw new Error('A simulation run can contain at most 200 events.');
  if (timestamp(event.at, 'Event time') < timestamp(view.state.at, 'Prior event time')) throw new Error('Event time precedes creation or the prior event.');
  const entry = applyEvent(view.state, event);
  return JSON.parse(JSON.stringify({
    ...run, schemaVersion: 2, policyVersion: POLICY_VERSION, legacyEventCount: view.legacyEventCount,
    events: [...run.events, event], records: [...view.entries, entry],
  }));
}
