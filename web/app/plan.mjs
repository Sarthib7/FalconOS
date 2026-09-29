// Advisory capital plan (SPEC V117 / I18): pure BigInt sizing, editable, Devnet-analog only.
// No execution authority: a plan never carries executionReady and never signs or sends anything.

const BPS_TOTAL = 10000;
const U64_MAX = 18446744073709551615n;
const MODE = 'devnet-analog';

function baseUnits(value, name) {
  let out;
  if (typeof value === 'bigint') out = value;
  else if (typeof value === 'string' && /^\d+$/.test(value)) out = BigInt(value);
  else if (typeof value === 'number' && Number.isSafeInteger(value) && value >= 0) out = BigInt(value);
  else throw new Error(`${name} must be a non-negative integer base-unit amount`);
  if (out < 0n || out > U64_MAX) throw new Error(`${name} is out of range`);
  return out;
}

function mintFor(analogMints, leg) {
  if (!analogMints || typeof analogMints !== 'object') return null;
  for (const key of [leg.asset_id, leg.underlying]) {
    if (Object.hasOwn(analogMints, key) && typeof analogMints[key] === 'string' && analogMints[key]) return analogMints[key];
  }
  return null;
}

function freeze(plan) {
  for (const leg of plan.legs) Object.freeze(leg);
  Object.freeze(plan.legs);
  return Object.freeze(plan);
}

function assemble(capital, legs) {
  const total = legs.reduce((sum, leg) => sum + BigInt(leg.allocationBaseUnits), 0n);
  if (total > capital) throw new Error(`allocations (${total}) exceed capital (${capital})`);
  return freeze({ mode: MODE, capitalBaseUnits: capital.toString(), legs, residualBaseUnits: (capital - total).toString() });
}

export function buildPlan({ capitalBaseUnits, legs, analogMints } = {}) {
  const capital = baseUnits(capitalBaseUnits, 'capitalBaseUnits');
  if (capital <= 0n) throw new Error('capitalBaseUnits must be positive');
  if (!Array.isArray(legs) || !legs.length) throw new Error('legs must be a non-empty array');
  const seen = new Set();
  let bpsSum = 0;
  const out = legs.map((leg) => {
    if (!leg || typeof leg !== 'object') throw new Error('leg must be an object');
    if (typeof leg.asset_id !== 'string' || !leg.asset_id) throw new Error('leg asset_id is required');
    if (typeof leg.underlying !== 'string' || !leg.underlying) throw new Error(`leg ${leg.asset_id} underlying is required`);
    if (seen.has(leg.asset_id)) throw new Error(`duplicate leg ${leg.asset_id}`);
    seen.add(leg.asset_id);
    const bps = leg.target_weight_bps;
    if (!Number.isInteger(bps) || bps < 0 || bps > BPS_TOTAL) throw new Error(`leg ${leg.asset_id} target_weight_bps must be an integer in 0..${BPS_TOTAL}`);
    bpsSum += bps;
    const analogMint = mintFor(analogMints, leg);
    return {
      assetId: leg.asset_id,
      underlying: leg.underlying,
      targetWeightBps: bps,
      allocationBaseUnits: (capital * BigInt(bps) / BigInt(BPS_TOTAL)).toString(),
      analogMint,
      analog: true,
      executable: analogMint !== null,
      label: `Devnet analog stand-in for ${leg.underlying} (not the real mainnet asset)`,
    };
  });
  if (bpsSum !== BPS_TOTAL) throw new Error(`target_weight_bps must sum to ${BPS_TOTAL}, got ${bpsSum}`);
  return assemble(capital, out);
}

export function editPlan(plan, edit = {}) {
  if (!plan || plan.mode !== MODE || !Array.isArray(plan.legs)) throw new Error('plan is invalid');
  const capital = baseUnits(plan.capitalBaseUnits, 'capitalBaseUnits');
  const { legId, underlying, allocationBaseUnits, remove } = edit;
  if ((legId === undefined) === (underlying === undefined)) throw new Error('edit needs exactly one of legId or underlying');
  const hasAlloc = allocationBaseUnits !== undefined;
  if (hasAlloc === (remove === true)) throw new Error('edit needs exactly one of allocationBaseUnits or remove');
  const matches = plan.legs.filter((leg) => (legId !== undefined ? leg.assetId === legId : leg.underlying === underlying));
  if (!matches.length) throw new Error(`no leg matches ${legId ?? underlying}`);
  if (matches.length > 1) throw new Error(`underlying ${underlying} is ambiguous; use legId`);
  const target = matches[0];
  if (remove === true) return assemble(capital, plan.legs.filter((leg) => leg !== target).map((leg) => ({ ...leg })));
  const alloc = baseUnits(allocationBaseUnits, 'allocationBaseUnits');
  return assemble(capital, plan.legs.map((leg) => ({ ...leg, ...(leg === target ? { allocationBaseUnits: alloc.toString() } : {}) })));
}
