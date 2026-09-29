// Advisory strategy client (SPEC I18 / V117 / V119): read-only council GET + pure view model.
// No wallet, signing, or execution here. All sizing/edit math is delegated to plan.mjs.
import { buildPlan, editPlan } from './plan.mjs';

export const DEFAULT_COUNCIL_BASE = 'http://127.0.0.1:8787';
export const USDC_DECIMALS = 6;
const FETCH_TIMEOUT_MS = 8000;
const STATUSES = new Set(['PUBLISHED', 'BLOCKED', 'NO_DATA']);
const U64_MAX = 18446744073709551615n;

// Devnet swap config (SPEC I18): plan capital is denominated in base mint 4zMMC (a Devnet USDC test mint held by the
// executing wallet; on-chain identity not independently verified). Each council leg is proxied by dUSDT via a live 2-hop
// Raydium Devnet route through CPMM/AMM pools that pass V76 validation (owners DRaycpLY.../DRaya7K..., verified 2026-09-29;
// 4zMMC->dUSDT ~0.45% impact at 0.01, confirmed on Devnet tx 3VWRqNm...). Legs without a mapped mint stay executable:false.
export const DEVNET_BASE_MINT = '4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU';
const DEVNET_ANALOG_MINT = '9jWfcfEZToquBQmkoEViNSCt72veXwcvRGFQERXRjEk1';
export const ANALOG_MINTS = Object.freeze({ OPENAI: DEVNET_ANALOG_MINT, SPACEX: DEVNET_ANALOG_MINT });

// Override order: window.FALCON_COUNCIL_BASE, then <body data-council-base>, then the default.
export function resolveCouncilBase({ global = globalThis, dataset = global.document?.body?.dataset } = {}) {
  const raw = global.FALCON_COUNCIL_BASE || dataset?.councilBase || DEFAULT_COUNCIL_BASE;
  return String(raw).trim().replace(/\/+$/, '');
}

const fail = (code, message) => ({ ok: false, error: { code, message } });

// Validates the /advice payload. Returns a normalized advice or throws Error (caller wraps as typed error).
export function parseAdvice(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('advice is not an object');
  if (!STATUSES.has(raw.status)) throw new Error(`advice status "${raw.status}" is not recognised`);
  if (raw.execution_ready !== undefined && raw.execution_ready !== false) throw new Error('advice must not be execution_ready');
  const reasons = raw.reasons === undefined ? [] : raw.reasons;
  if (!Array.isArray(reasons) || reasons.some((reason) => typeof reason !== 'string')) throw new Error('advice reasons must be strings');
  const legs = raw.legs === undefined ? [] : raw.legs;
  if (!Array.isArray(legs)) throw new Error('advice legs must be an array');
  for (const leg of legs) {
    if (!leg || typeof leg.asset_id !== 'string' || !leg.asset_id || typeof leg.underlying !== 'string' || !leg.underlying || !Number.isInteger(leg.target_weight_bps)) {
      throw new Error('advice leg is malformed');
    }
  }
  if (raw.status === 'PUBLISHED' && !legs.length) throw new Error('PUBLISHED advice has no legs');
  if (raw.evidence !== undefined && !Array.isArray(raw.evidence)) throw new Error('advice evidence must be an array');
  return {
    status: raw.status,
    reasons,
    legs: legs.map(({ asset_id, underlying, target_weight_bps }) => ({ asset_id, underlying, target_weight_bps })),
    evidence: raw.evidence ?? [],
    snapshotSha256: typeof raw.snapshot_sha256 === 'string' ? raw.snapshot_sha256 : null,
    createdAt: typeof raw.created_at === 'string' ? raw.created_at : null,
  };
}

// Read-only GET {base}/advice. Never throws: resolves { ok:true, advice } or { ok:false, error:{code,message} }.
export async function fetchAdvice({ base = resolveCouncilBase(), fetchImpl = globalThis.fetch, timeoutMs = FETCH_TIMEOUT_MS } = {}) {
  if (typeof fetchImpl !== 'function') return fail('network', 'fetch is unavailable');
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl(`${base}/advice`, { method: 'GET', headers: { accept: 'application/json' }, cache: 'no-store', redirect: 'error', signal: controller.signal });
    if (!response.ok) return fail('http', `Council returned HTTP ${response.status}`);
    let body;
    try { body = await response.json(); } catch { return fail('malformed', 'Council response is not valid JSON'); }
    try { return { ok: true, advice: parseAdvice(body) }; } catch (error) { return fail('malformed', error.message); }
  } catch (error) {
    return fail('network', controller.signal.aborted ? 'Council request timed out' : `Council unreachable: ${error?.message || 'network error'}`);
  } finally {
    clearTimeout(timer);
  }
}

// Pure view model: { decision, plan, planError }. A plan exists only for PUBLISHED advice with positive capital.
export function toView({ advice, capitalBaseUnits, analogMints = ANALOG_MINTS } = {}) {
  const decision = { status: advice.status, reasons: advice.reasons, legs: advice.legs, evidence: advice.evidence ?? [] };
  let capital = 0n;
  try { capital = BigInt(capitalBaseUnits ?? 0); } catch { capital = 0n; }
  if (advice.status !== 'PUBLISHED' || capital <= 0n) return { decision, plan: null, planError: null };
  try {
    return { decision, plan: buildPlan({ capitalBaseUnits: capital.toString(), legs: advice.legs, analogMints }), planError: null };
  } catch (error) {
    return { decision, plan: null, planError: error.message };
  }
}

// Decimal USDC text -> 6-decimal base-unit string. Throws Error on anything but a positive in-range amount.
export function usdcToBaseUnits(value) {
  const text = typeof value === 'string' ? value.trim() : '';
  if (text.length > 40 || !/^\d+(?:\.\d{1,6})?$/.test(text)) throw new Error(`Enter a USDC amount with at most ${USDC_DECIMALS} decimal places.`);
  const [whole, fraction = ''] = text.split('.');
  const units = BigInt(whole) * 10n ** BigInt(USDC_DECIMALS) + BigInt(fraction.padEnd(USDC_DECIMALS, '0'));
  if (units > U64_MAX) throw new Error('USDC amount is outside the supported range.');
  return units.toString();
}

export function baseUnitsToUsdc(value) {
  const units = BigInt(value);
  const fraction = (units % 10n ** BigInt(USDC_DECIMALS)).toString().padStart(USDC_DECIMALS, '0').replace(/0+$/, '');
  return `${units / 10n ** BigInt(USDC_DECIMALS)}${fraction ? `.${fraction}` : ''}`;
}

// Editing wrappers over plan.mjs. Never throw: { plan } on success, { plan: <unchanged>, error } otherwise.
function tryEdit(plan, edit) {
  try { return { plan: editPlan(plan, edit), error: null }; } catch (error) { return { plan, error: error.message }; }
}

export function setLegAllocation(plan, assetId, usdcText) {
  let allocationBaseUnits;
  try { allocationBaseUnits = usdcToBaseUnits(usdcText); } catch (error) { return { plan, error: error.message }; }
  return tryEdit(plan, { legId: assetId, allocationBaseUnits });
}

export const removeLeg = (plan, assetId) => tryEdit(plan, { legId: assetId, remove: true });
