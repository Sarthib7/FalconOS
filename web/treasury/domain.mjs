const MAX_UNITS = 18446744073709551615n;
const SCALE = 1000000n;
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

function validateState(state) {
  exactKeys(state, ['runId', 'revision', 'createdAt', 'at', 'mode', 'revoked', 'balances', 'mandate', 'observation', 'lastDecision'], 'State');
  uuid(state.runId, 'Run ID');
  if (state.revision !== 0) throw new Error('Saved setup revision must be zero.');
  if (timestamp(state.at, 'State time') < timestamp(state.createdAt, 'Creation time')) throw new Error('State time precedes creation.');
  if (state.mode !== 'simulation' || typeof state.revoked !== 'boolean') throw new Error('State mode or revocation is invalid.');
  validateLedger(state.balances, state.mandate);
  if (state.at !== state.createdAt || state.revoked || state.observation !== null || state.lastDecision !== null
      || state.balances.positionUnits !== '0' || state.balances.idleUnits !== state.mandate.investmentCapUnits) {
    throw new Error('Only a saved setup state is supported.');
  }
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

export function replayRun(run) {
  exactKeys(run, ['schemaVersion', 'mode', 'id', 'createdAt', 'setup', 'events'], 'Run');
  if (run.schemaVersion !== 1 || run.mode !== 'simulation') throw new Error('Run schema or mode is unsupported.');
  uuid(run.id, 'Run ID');
  timestamp(run.createdAt, 'Creation time');
  validateSetup(run.setup);
  if (!Array.isArray(run.events) || run.events.length !== 0) throw new Error('Saved setup requires an empty event journal.');
  const state = initialState(run);
  const entries = [];
  return { state, graph: buildGraph(state, state.at), entries };
}

export function createRun(input) {
  exactKeys(input, ['id', 'createdAt', ...SETUP_KEYS], 'Run setup');
  const { id, createdAt, ...setup } = input;
  const run = { schemaVersion: 1, mode: 'simulation', id, createdAt, setup, events: [] };
  replayRun(run);
  return run;
}

