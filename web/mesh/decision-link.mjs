// Pure helpers that tie reserve decisions to Devnet lending intents. No DOM, no network.
// They only filter and label what the service already returned; the service re-checks every rule.
const U64 = /^(0|[1-9]\d{0,19})$/;
const INTENT_STATUSES = ['PREPARED', 'SUBMITTED', 'PENDING', 'CONFIRMED', 'FAILED', 'UNVERIFIED'];
const isObject = value => Boolean(value) && typeof value === 'object' && !Array.isArray(value);

export const usdc = units => {
  const value = BigInt(units);
  const fraction = String(value % 1000000n).padStart(6, '0').replace(/0+$/, '');
  return `${value / 1000000n}${fraction ? `.${fraction}` : ''}`;
};
const stamp = ms => `${new Date(ms).toISOString().slice(0, 19).replace('T', ' ')} UTC`;

// Reserve decisions a supply may be prepared from: live REVIEW decisions whose review window has not ended.
// A window that ends exactly at nowMs has ended. Newest first.
export function eligibleDecisions(records, nowMs) {
  if (!Array.isArray(records) || !Number.isFinite(nowMs)) return [];
  const rows = [];
  for (const item of records) {
    if (!isObject(item) || typeof item.id !== 'string' || !item.id || !isObject(item.analysis)) continue;
    const { analysis } = item;
    if (analysis.kind !== 'reserve_scenario_decision' || analysis.mode !== 'live' || analysis.status !== 'REVIEW') continue;
    const expires = typeof analysis.expiresAt === 'string' ? Date.parse(analysis.expiresAt) : NaN;
    if (!Number.isFinite(expires) || expires <= nowMs) continue;
    const proposed = analysis.scenario?.proposedUnits;
    if (typeof proposed !== 'string' || !U64.test(proposed)) continue;
    const created = Date.parse(item.createdAt);
    rows.push({
      id: item.id, createdAt: item.createdAt, createdMs: Number.isFinite(created) ? created : 0,
      proposedUnits: proposed, expiresAt: analysis.expiresAt,
      label: `Propose ${usdc(proposed)} USDC · review window ends ${stamp(expires)} · ${item.id.slice(0, 8)}`,
    });
  }
  rows.sort((left, right) => right.createdMs - left.createdMs || (left.id < right.id ? 1 : -1));
  return rows.map(({ createdMs, ...row }) => row);
}

// Lending intents that were prepared from one decision, with the status the service reports for each.
// A row without a status has no events yet, so it is PREPARED. Rows are never created here.
export function linkedIntents(history, decisionId) {
  if (!Array.isArray(history) || typeof decisionId !== 'string' || !decisionId) return [];
  const rows = [];
  for (const item of history) {
    if (!isObject(item) || typeof item.id !== 'string' || !isObject(item.request) || item.request.decisionId !== decisionId) continue;
    const status = item.status === undefined || item.status === null ? 'PREPARED' : INTENT_STATUSES.includes(item.status) ? item.status : 'UNKNOWN';
    rows.push({
      id: item.id, createdAt: item.createdAt, action: item.request.action, inputBaseUnits: item.request.inputBaseUnits,
      status, signature: typeof item.signature === 'string' ? item.signature : null,
    });
  }
  return rows;
}

export const NO_DECISION_REASON = 'Supply needs a fresh reserve decision. Save one on the Operate page with status REVIEW, then load decisions here. A BLOCKED, NO_DATA or expired decision cannot be used.';
export const supplyBlockReason = eligible => Array.isArray(eligible) && eligible.length > 0 ? '' : NO_DECISION_REASON;
