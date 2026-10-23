const ACTIVITY_LIMIT = 20;
const BASE_UNIT = 1_000_000n;
const DECIMAL_BASE_UNITS = /^(0|[1-9][0-9]*)$/;

function unitsFromBase(value) {
  if (typeof value !== 'string' || value.length > 20 || !DECIMAL_BASE_UNITS.test(value)) return null;
  const units = BigInt(value);
  const whole = units / BASE_UNIT;
  const fraction = units % BASE_UNIT;
  if (fraction === 0n) return whole.toString();
  return `${whole}.${fraction.toString().padStart(6, '0').replace(/0+$/, '')}`;
}

function decisionSummary(row) {
  const analysis = row?.analysis ?? {};
  return {
    id: row?.id ?? null,
    createdAt: row?.createdAt ?? null,
    status: analysis.status ?? null,
    summary: analysis.summary ?? null,
    expiresAt: analysis.expiresAt ?? null,
  };
}

export function projectActivity({ decisions, intents, research }) {
  const decisionRecords = Array.isArray(decisions) ? decisions : [];
  const intentRecords = Array.isArray(intents) ? intents : [];
  const byId = new Map();
  for (const row of decisionRecords) {
    const id = typeof row?.id === 'string' ? row.id : '';
    byId.set(id, decisionSummary(row));
  }

  const used = new Set();
  const trail = [];
  for (const row of intentRecords) {
    const request = row?.request ?? {};
    const decisionId = typeof request.decisionId === 'string' ? request.decisionId : null;
    let decision = null;
    if (decisionId !== null) {
      used.add(decisionId);
      decision = byId.get(decisionId) ?? {
        id: decisionId, createdAt: null, status: null, summary: null, expiresAt: null,
      };
    }

    const action = request.action ?? null;
    const intent = {
      id: row?.id ?? null,
      createdAt: row?.createdAt ?? null,
      action,
      wallet: request.wallet ?? null,
      status: row?.status ?? null,
      transactionSignature: row?.signature ?? null,
      [action === 'redeem' ? 'amountReceiptTokens' : 'amountUsdc']: unitsFromBase(request.inputBaseUnits),
    };
    trail.push({ at: row?.createdAt ?? null, decision, intent });
  }

  for (const [id, summary] of [...byId.entries()].sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0)) {
    if (!used.has(id)) trail.push({ at: summary.createdAt, decision: summary, intent: null });
  }
  trail.sort((left, right) => {
    const leftAt = typeof left.at === 'string' ? left.at : '';
    const rightAt = typeof right.at === 'string' ? right.at : '';
    return leftAt < rightAt ? 1 : leftAt > rightAt ? -1 : 0;
  });

  return {
    trail,
    counts: { decisions: decisionRecords.length, intents: intentRecords.length },
    limit: ACTIVITY_LIMIT,
    research,
  };
}
