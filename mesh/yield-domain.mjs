const U64_MAX = 18446744073709551615n;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function record(value, name) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) throw new Error(name + ' must be a plain object.');
}
function exactKeys(value, expected, name) {
  record(value, name);
  const actual = Object.keys(value);
  if (actual.length !== expected.length || expected.some(key => !Object.hasOwn(value, key))) throw new Error(name + ' fields do not match the simulation contract.');
}
function units(value, name) {
  if (typeof value !== 'string' || !/^(0|[1-9][0-9]{0,19})$/.test(value)) throw new Error(name + ' must be an unsigned integer-unit string.');
  const result = BigInt(value);
  if (result > U64_MAX) throw new Error(name + ' exceeds the USDC base-unit limit.');
  return result;
}
function iso(value, name) {
  if (typeof value !== 'string' || !Number.isFinite(Date.parse(value)) || new Date(value).toISOString() !== value) throw new Error(name + ' must be a canonical UTC timestamp.');
  return value;
}
function parsePositions(value) {
  if (!Array.isArray(value) || value.length > 100) throw new Error('Positions must be an array of at most 100 entries.');
  const seen = new Set();
  return value.map((position, index) => {
    exactKeys(position, ['poolId', 'units'], 'Position ' + (index + 1));
    if (typeof position.poolId !== 'string' || !/^[a-zA-Z0-9-]{1,128}$/.test(position.poolId)) throw new Error('Position pool ID is invalid.');
    if (seen.has(position.poolId)) throw new Error('Portfolio contains duplicate pool IDs.');
    seen.add(position.poolId);
    const amount = units(position.units, 'Position amount');
    if (amount === 0n) throw new Error('Zero-value positions must be omitted.');
    return { poolId: position.poolId, units: amount.toString() };
  });
}
function readPortfolio(value) {
  exactKeys(value, ['totalUnits', 'reserveUnits', 'undelegatedUnits', 'idleUnits', 'positions'], 'Portfolio');
  const total = units(value.totalUnits, 'Total balance'), reserve = units(value.reserveUnits, 'Reserve balance');
  const undelegated = units(value.undelegatedUnits, 'Undelegated balance'), idle = units(value.idleUnits, 'Idle balance');
  const positions = parsePositions(value.positions);
  const invested = positions.reduce((sum, item) => sum + units(item.units, 'Position amount'), 0n);
  if (reserve + undelegated + idle + invested !== total) throw new Error('Portfolio balance conservation failed.');
  return { totalUnits: total.toString(), reserveUnits: reserve.toString(), undelegatedUnits: undelegated.toString(), idleUnits: idle.toString(), positions };
}
function noPlan(input, status, reason, before, sourceSnapshot = null) {
  return { requestId: input.requestId, simulatedAt: input.simulatedAt, mode: 'simulation', status, executionReady: false, reason,
    policy: input.policy ?? null, sourceSnapshot, before, after: before, allocations: [], flows: [],
    costs: { status: 'UNKNOWN', amountUnits: null, reason: 'Provider data does not include an executable route quote or transfer costs.' } };
}
function compare(a, b) {
  if (a.baseApyBps !== b.baseApyBps) return b.baseApyBps - a.baseApyBps;
  const aTvl = BigInt(a.tvlUsdCents), bTvl = BigInt(b.tvlUsdCents);
  if (aTvl !== bTvl) return aTvl > bTvl ? -1 : 1;
  return a.poolId.localeCompare(b.poolId);
}

export function simulateAllocation(input) {
  exactKeys(input, ['requestId', 'simulatedAt', 'portfolio', 'policy', 'opportunities', 'sourceSnapshot'], 'Simulation request');
  if (typeof input.requestId !== 'string' || !UUID.test(input.requestId)) throw new Error('Request ID must be a UUID.');
  iso(input.simulatedAt, 'Simulation time');
  const before = readPortfolio(input.portfolio);
  record(input.policy, 'Policy');
  if (Object.keys(input.policy).some(key => !['investmentCapUnits', 'maxVenueConcentrationBps', 'maxVenues'].includes(key))) throw new Error('Policy contains unsupported fields.');
  if (!Array.isArray(input.opportunities) || input.opportunities.length > 1000) throw new Error('Opportunities must be a bounded array.');
  if (!Object.hasOwn(input.policy, 'investmentCapUnits') || !Object.hasOwn(input.policy, 'maxVenueConcentrationBps') || !Object.hasOwn(input.policy, 'maxVenues')) {
    return noPlan(input, 'REVIEW', 'Set the investment cap, maximum protocol concentration, and protocol count before simulating.', before, input.sourceSnapshot);
  }
  const investmentCap = units(input.policy.investmentCapUnits, 'Investment cap');
  const concentration = input.policy.maxVenueConcentrationBps, maxVenues = input.policy.maxVenues;
  if (!Number.isInteger(concentration) || concentration < 1 || concentration > 10000) throw new Error('Maximum protocol concentration must be between 1 and 10000 basis points.');
  if (!Number.isInteger(maxVenues) || maxVenues < 1 || maxVenues > 100) throw new Error('Maximum protocol count must be between 1 and 100.');
  const candidates = [], seen = new Set();
  for (const [index, item] of input.opportunities.entries()) {
    record(item, 'Opportunity ' + (index + 1));
    if (typeof item.project !== 'string' || item.project.length === 0 || item.project.length > 128 || item.project.trim() !== item.project
      || typeof item.poolId !== 'string' || !/^[a-zA-Z0-9-]{1,128}$/.test(item.poolId)
      || !Number.isInteger(item.baseApyBps) || item.baseApyBps < 0
      || typeof item.tvlUsdCents !== 'string' || !/^(0|[1-9][0-9]{0,19})$/.test(item.tvlUsdCents)) throw new Error('Opportunity project, identity, APY, or TVL is invalid.');
    if (seen.has(item.poolId)) throw new Error('Opportunity pool IDs must be unique.');
    seen.add(item.poolId); candidates.push(item);
  }
  if (!candidates.length) return noPlan(input, 'NO_DATA', 'No eligible Solana USDC lending opportunities were returned.', before, input.sourceSnapshot);
  candidates.sort(compare);
  const current = new Map(before.positions.map(position => [position.poolId, units(position.units, 'Position amount')]));
  const positionUnits = before.positions.reduce((sum, position) => sum + units(position.units, 'Position amount'), 0n);
  const deployable = units(before.idleUnits, 'Idle balance') + positionUnits;
  const budget = deployable < investmentCap ? deployable : investmentCap;
  if (budget === 0n) return noPlan(input, 'REVIEW', 'No delegated USDC is available for this simulation.', before, input.sourceSnapshot);
  const perProjectCap = budget * BigInt(concentration) / 10000n;
  if (perProjectCap === 0n) return noPlan(input, 'REVIEW', 'The protocol cap leaves no allocatable USDC units.', before, input.sourceSnapshot);
  const targets = new Map();
  const selectedProjects = new Set();
  let remaining = budget;
  for (const opportunity of candidates) {
    if (selectedProjects.has(opportunity.project)) continue;
    if (selectedProjects.size >= maxVenues || remaining === 0n) break;
    selectedProjects.add(opportunity.project);
    const amount = remaining < perProjectCap ? remaining : perProjectCap;
    if (amount > 0n) { targets.set(opportunity.poolId, amount); remaining -= amount; }
  }
  const flows = [];
  for (const [poolId, oldAmount] of [...current.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    const newAmount = targets.get(poolId) || 0n;
    if (oldAmount > newAmount) flows.push({ type: 'REDEEM', from: { kind: 'venue', poolId }, to: { kind: 'idle' }, amountUnits: (oldAmount - newAmount).toString() });
  }
  for (const [poolId, newAmount] of targets.entries()) {
    const oldAmount = current.get(poolId) || 0n;
    if (newAmount > oldAmount) flows.push({ type: 'SUPPLY', from: { kind: 'idle' }, to: { kind: 'venue', poolId }, amountUnits: (newAmount - oldAmount).toString() });
  }
  const allocations = candidates.filter(item => targets.has(item.poolId)).map(item => ({
    poolId: item.poolId, project: item.project, units: targets.get(item.poolId).toString(),
    baseApyBps: item.baseApyBps, apyRewardBps: item.apyRewardBps, tvlUsdCents: item.tvlUsdCents,
    source: item.provider, retrievedAt: item.retrievedAt, providerAsOf: item.providerAsOf,
  }));
  const allocated = [...targets.values()].reduce((sum, amount) => sum + amount, 0n);
  const after = {
    totalUnits: before.totalUnits, reserveUnits: before.reserveUnits, undelegatedUnits: before.undelegatedUnits,
    idleUnits: (units(before.totalUnits, 'Total balance') - units(before.reserveUnits, 'Reserve balance') - units(before.undelegatedUnits, 'Undelegated balance') - allocated).toString(),
    positions: allocations.map(item => ({ poolId: item.poolId, units: item.units })),
  };
  const afterTotal = units(after.reserveUnits, 'Reserve balance') + units(after.undelegatedUnits, 'Undelegated balance') + units(after.idleUnits, 'Idle balance') + after.positions.reduce((sum, item) => sum + units(item.units, 'Position amount'), 0n);
  if (afterTotal !== units(after.totalUnits, 'Total balance')) throw new Error('Simulated allocation failed balance conservation.');
  return {
    requestId: input.requestId, simulatedAt: input.simulatedAt, mode: 'simulation', status: flows.length ? 'SIMULATED' : 'HOLD', executionReady: false,
    policy: { ...input.policy }, sourceSnapshot: input.sourceSnapshot, before, after, allocations, flows,
    costs: { status: 'UNKNOWN', amountUnits: null, reason: 'Provider data does not include route quotes or transfer costs.' },
    warnings: ['Reported APY is not guaranteed.', 'Per-pool source measurement time may be unknown.', 'No live funds move in this simulation.'],
  };
}
