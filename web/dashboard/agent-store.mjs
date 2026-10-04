const KEY = 'falconos.yield.agent.simulation.v1';
const LIMIT = 2 * 1024 * 1024;
const MAX_RECEIPTS = 200;
const U64_MAX = 18446744073709551615n;

function exactKeys(value, expected, name) {
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || Object.keys(value).length !== expected.length || expected.some(key => !Object.hasOwn(value, key))) {
    throw new Error(name + ' fields do not match the local simulation contract.');
  }
}
function amount(value, name) {
  if (typeof value !== 'string' || !/^(0|[1-9][0-9]{0,19})$/.test(value) || BigInt(value) > U64_MAX) throw new Error(name + ' must be a valid USDC base-unit string.');
  return value;
}
export function parseUsdcInput(value) {
  if (typeof value !== 'string' || !/^(0|[1-9][0-9]{0,12})(?:\.[0-9]{1,6})?$/.test(value.trim())) throw new Error('USDC amount must be a decimal with at most six fractional digits.');
  const [whole, fractional = ''] = value.trim().split('.');
  const parsed = BigInt(whole) * 1000000n + BigInt((fractional + '000000').slice(0, 6));
  if (parsed > U64_MAX) throw new Error('USDC amount is outside the supported base-unit range.');
  return parsed.toString();
}
export function parseBpsInput(value) {
  if (typeof value !== 'string' || !/^(0|[1-9][0-9]{0,2})(?:\.[0-9]{1,2})?$/.test(value.trim())) throw new Error('Venue concentration must be a percentage with at most two decimals.');
  const [whole, fractional = ''] = value.trim().split('.');
  const result = BigInt(whole) * 100n + BigInt((fractional + '00').slice(0, 2));
  if (result < 1n || result > 10000n) throw new Error('Venue concentration must be above 0 and at most 100 percent.');
  return Number(result);
}
function portfolio(value) {
  exactKeys(value, ['totalUnits', 'reserveUnits', 'undelegatedUnits', 'idleUnits', 'positions'], 'Portfolio');
  const total = BigInt(amount(value.totalUnits, 'Total balance'));
  const reserve = BigInt(amount(value.reserveUnits, 'Reserve balance'));
  const undelegated = BigInt(amount(value.undelegatedUnits, 'Undelegated balance'));
  const idle = BigInt(amount(value.idleUnits, 'Idle balance'));
  if (!Array.isArray(value.positions) || value.positions.length > 100) throw new Error('Positions must be an array of at most 100 entries.');
  const ids = new Set();
  const positions = value.positions.map((item, index) => {
    exactKeys(item, ['poolId', 'units'], 'Position ' + (index + 1));
    if (typeof item.poolId !== 'string' || !/^[a-zA-Z0-9-]{1,128}$/.test(item.poolId) || ids.has(item.poolId)) throw new Error('Position pool ID is invalid or duplicated.');
    ids.add(item.poolId); return { poolId: item.poolId, units: amount(item.units, 'Position balance') };
  });
  const sum = reserve + undelegated + idle + positions.reduce((n, p) => n + BigInt(p.units), 0n);
  if (sum !== total) throw new Error('Portfolio conservation failed.');
  return { totalUnits: total.toString(), reserveUnits: reserve.toString(), undelegatedUnits: undelegated.toString(), idleUnits: idle.toString(), positions };
}
function policy(value) {
  exactKeys(value, ['investmentCapUnits', 'maxVenueConcentrationBps', 'maxVenues'], 'Policy');
  const investmentCapUnits = amount(value.investmentCapUnits, 'Investment cap');
  if (investmentCapUnits === '0') throw new Error('Investment cap must be positive.');
  if (!Number.isInteger(value.maxVenueConcentrationBps) || value.maxVenueConcentrationBps < 1 || value.maxVenueConcentrationBps > 10000) throw new Error('Maximum venue concentration must be between 1 and 10000 basis points.');
  if (!Number.isInteger(value.maxVenues) || value.maxVenues < 1 || value.maxVenues > 100) throw new Error('Maximum venue count must be between 1 and 100.');
  return { investmentCapUnits, maxVenueConcentrationBps: value.maxVenueConcentrationBps, maxVenues: value.maxVenues };
}
function validateState(value) {
  exactKeys(value, ['schemaVersion', 'revision', 'portfolio', 'policy', 'receipts'], 'Yield simulation state');
  if (value.schemaVersion !== 1 || !Number.isInteger(value.revision) || value.revision < 0 || value.revision > MAX_RECEIPTS) throw new Error('Yield simulation state version or revision is invalid.');
  if (!Array.isArray(value.receipts) || value.receipts.length > MAX_RECEIPTS) throw new Error('Yield simulation receipt history is invalid.');
  return { schemaVersion: 1, revision: value.revision, portfolio: portfolio(value.portfolio), policy: policy(value.policy), receipts: value.receipts };
}
function samePortfolio(a, b) { return JSON.stringify(portfolio(a)) === JSON.stringify(portfolio(b)); }

export function createYieldAgentStore({ storage, locks, key = KEY } = {}) {
  function backend() {
    try {
      const value = storage ?? globalThis.localStorage;
      if (!value || typeof value.getItem !== 'function' || typeof value.setItem !== 'function') throw new Error();
      return value;
    } catch { throw new Error('Browser storage is unavailable. The simulated portfolio cannot be saved.'); }
  }
  function lockProvider() {
    try {
      const value = locks ?? globalThis.navigator?.locks;
      if (!value || typeof value.request !== 'function') throw new Error();
      return value;
    } catch { throw new Error('Web Locks are unavailable. This browser cannot safely save a yield simulation.'); }
  }
  function load() {
    let raw;
    try { raw = backend().getItem(key); } catch { throw new Error('Saved simulation could not be read. Existing state is unchanged.'); }
    if (raw === null) return null;
    if (typeof raw !== 'string' || raw.length > LIMIT) throw new Error('Saved simulation exceeds its storage limit. Existing state is unchanged.');
    let value;
    try { value = JSON.parse(raw); } catch { throw new Error('Saved simulation is invalid JSON. Existing state is unchanged.'); }
    return validateState(value);
  }
  async function locked(fn) { return lockProvider().request(key, { mode: 'exclusive' }, fn); }
  function write(value) {
    const validated = validateState(value);
    const text = JSON.stringify(validated);
    if (text.length > LIMIT) throw new Error('Yield simulation history exceeds its storage limit. Existing state is unchanged.');
    try { backend().setItem(key, text); } catch { throw new Error('Yield simulation could not be saved. Existing state is unchanged.'); }
    return validated;
  }
  async function initialize(initialPortfolio, initialPolicy) {
    const normalized = portfolio(initialPortfolio), normalizedPolicy = policy(initialPolicy);
    return locked(() => {
      if (load()) throw new Error('A yield simulation already exists. Load it instead of replacing it.');
      return write({ schemaVersion: 1, revision: 0, portfolio: normalized, policy: normalizedPolicy, receipts: [] });
    });
  }
  async function updatePolicy(nextPolicy, expectedRevision) {
    if (!Number.isInteger(expectedRevision) || expectedRevision < 0) throw new Error('Expected revision is invalid.');
    const normalized = policy(nextPolicy);
    return locked(() => {
      const current = load();
      if (!current) throw new Error('Create a simulated portfolio before changing its policy.');
      if (current.revision !== expectedRevision) throw new Error('Yield simulation changed in another tab. Reload before changing policy.');
      if (current.receipts.length >= MAX_RECEIPTS) throw new Error('Yield simulation history is full. Export it before continuing.');
      return write({ ...current, revision: current.revision + 1, policy: normalized });
    });
  }
  async function applyPlan(plan, expectedRevision) {
    if (!Number.isInteger(expectedRevision) || expectedRevision < 0) throw new Error('Expected revision is invalid.');
    if (!plan || plan.mode !== 'simulation' || plan.executionReady !== false || !['SIMULATED', 'HOLD'].includes(plan.status)) {
      throw new Error('Only a simulation-only plan can update the local portfolio.');
    }
    const before = portfolio(plan.before), after = portfolio(plan.after), planPolicy = policy(plan.policy);
    if (before.totalUnits !== after.totalUnits || before.reserveUnits !== after.reserveUnits || before.undelegatedUnits !== after.undelegatedUnits) {
      throw new Error('A simulation plan cannot change total funds, reserve, or undelegated cash.');
    }
    return locked(() => {
      const current = load();
      if (!current) throw new Error('Create a simulated portfolio before applying a plan.');
      if (current.revision !== expectedRevision) throw new Error('Yield simulation changed in another tab. Reload before applying this plan.');
      if (!samePortfolio(current.portfolio, before)) throw new Error('Plan source portfolio is stale. Refresh the simulation before applying it.');
      if (JSON.stringify(current.policy) !== JSON.stringify(planPolicy)) throw new Error('Plan policy is stale. Refresh the simulation before applying it.');
      if (current.receipts.length >= MAX_RECEIPTS) throw new Error('Yield simulation history is full. Export it before continuing.');
      const receipt = JSON.parse(JSON.stringify(plan));
      return write({ schemaVersion: 1, revision: current.revision + 1, portfolio: after, policy: current.policy, receipts: [...current.receipts, receipt] });
    });
  }
  return { load, initialize, updatePolicy, applyPlan };
}
