import { MeshError } from '../domain.mjs';
import { canonicalBytes, sha256, stableStringify } from '../council/evidence.ts';
import { DECISION_TRACE_LIMITS, projectDecisionTrace } from '../council/decision-trace.mjs';

function settlementAmounts(value) {
  const amount = part => part && typeof part.assetId === 'string' && part.assetId.length > 0
    && typeof part.baseUnits === 'string' && /^(0|[1-9]\d*)$/.test(part.baseUnits)
    ? { assetId: part.assetId, baseUnits: part.baseUnits } : null;
  const debit = amount(value?.debit);
  const credit = amount(value?.credit);
  return debit && credit ? { debit, credit } : null;
}

function nodeFor(record) {
  const data = record.data;
  let facts = {};
  switch (record.kind) {
    case 'portfolio':
      facts = { capturedAt: data.capturedAt, sourceTime: null, chain: data.chain, network: data.network,
        blockHash: typeof data.blockHash === 'string' ? data.blockHash : null,
        blockHeight: Number.isSafeInteger(data.blockHeight) && data.blockHeight >= 0 ? data.blockHeight : null };
      break;
    case 'mandate':
      facts = { reserveAssetId: data.reserveAssetId, reserveFloorBaseUnits: data.reserveFloorBaseUnits,
        maxActionReserveBaseUnits: data.maxActionReserveBaseUnits, maxEvidenceAgeSeconds: data.maxEvidenceAgeSeconds };
      break;
    case 'quotes':
      facts = { quotes: data.quotes.map(quote => ({ hash: quote.sha256, capturedAt: quote.capturedAt,
        sourceTime: quote.raw.timestamp,
        expiresAt: typeof quote.raw.quote.deadline === 'string' ? quote.raw.quote.deadline : null,
        signatureVerificationRecorded: quote.signatureVerified })) };
      break;
    case 'plan':
      facts = { snapshotHash: data.snapshotHash,
        proposalHash: data.snapshot.proposal === null ? null : sha256(canonicalBytes(data.snapshot.proposal)),
        action: data.request.action, sourceAssetId: data.request.sourceAssetId, targetAssetId: data.request.targetAssetId,
        inputBaseUnits: data.request.inputBaseUnits, reviewJobId: data.reviewJobId, checks: data.snapshot.checks };
      break;
    case 'review':
      facts = { jobId: data.jobId, planId: data.planId, snapshotHash: data.snapshotHash,
        phase: data.phase, jobState: data.state, resultStatus: data.result?.status ?? null };
      break;
    case 'action':
      facts = { actionId: data.actionId, action: data.action, leg: data.leg, rotationState: data.rotationState,
        sourceAssetId: data.sourceAssetId, targetAssetId: data.targetAssetId, inputBaseUnits: data.inputBaseUnits,
        signatureRecorded: data.signatureBase64 !== null, intentHash: data.intentHash,
        transactionHashes: data.nearTxHashes, settlementAmounts: settlementAmounts(data.amounts) };
      break;
    case 'monitor':
      facts = { enabledAtRevision: data.enabled, cyclesCompleted: data.cyclesCompleted,
        maxCycles: data.maxCycles, intervalSeconds: data.intervalSeconds };
      break;
    case 'devnet-proof':
      facts = { supplyIntentId: data.supplyIntentId, redeemIntentId: data.redeemIntentId };
      break;
  }
  return {
    id: 'cfo:' + record.id, recordId: record.id, kind: record.kind,
    contentHash: record.contentHash, sequence: record.sequence, createdAt: record.createdAt,
    status: data.status ?? data.result?.status ?? data.state ?? 'RECORDED', facts,
  };
}

export async function readCfoDecisionTrace({ store, owner, root, at, validateReview, validateQuote }) {
  const records = new Map([[root.id, root]]);
  const pending = [root];
  const nodes = new Map();
  const edges = new Map();
  const issues = new Set();
  const cutoff = BigInt(root.sequence);
  const edge = (from, to, relation) => {
    const value = { source: 'cfo:' + from.id, target: 'cfo:' + to.id, relation };
    edges.set(value.source + ':' + value.target + ':' + relation, value);
  };
  async function retain(from, id, relation, expectedHash = null) {
    let record = records.get(id);
    if (!record) record = await store.get(owner, id);
    if (!record || record.data.wallet !== root.data.wallet || BigInt(record.sequence) > cutoff) {
      issues.add('RETAINED_REFERENCE_UNAVAILABLE:' + id);
      return null;
    }
    if (expectedHash !== null && record.contentHash !== expectedHash) {
      throw new MeshError('STORAGE_UNAVAILABLE', 'Retained CFO trace source binding is invalid.');
    }
    if (!records.has(record.id)) {
      if (records.size >= DECISION_TRACE_LIMITS.records) {
        throw new MeshError('TOO_LARGE', 'The retained CFO trace exceeds its record limit.');
      }
      records.set(record.id, record);
      pending.push(record);
    }
    edge(from, record, relation);
    return record;
  }
  for (let index = 0; index < pending.length; index += 1) {
    const record = pending[index];
    const data = record.data;
    if (record.kind === 'quotes' && data.quotes.some(quote => !validateQuote(quote))) {
      throw new MeshError('STORAGE_UNAVAILABLE', 'Retained CFO trace quote integrity is invalid.');
    }
    nodes.set(record.id, nodeFor(record));
    if (record.kind === 'plan' || record.kind === 'review') {
      for (const ref of data.sourceRefs) await retain(record, ref.revisionId, 'uses-evidence', ref.sha256);
    }
    if (record.kind === 'review') {
      const plan = await retain(record, data.planId, 'reviews');
      if (!plan || plan.kind !== 'plan' || plan.data.reviewJobId !== data.jobId
          || plan.data.snapshotHash !== data.snapshotHash || !data.result || !validateReview(data.result, plan)) {
        issues.add('REVIEW_BINDING_UNAVAILABLE:' + record.id);
        continue;
      }
      for (const role of ['lead', 'risk']) {
        const result = data.result[role];
        if (result === null) continue;
        const proposalHash = sha256(canonicalBytes(plan.data.snapshot.proposal));
        if (!result || typeof result !== 'object' || result.role !== role || result.runId !== data.jobId
            || result.snapshotHash !== data.snapshotHash || result.proposalHash !== proposalHash
            || typeof result.callId !== 'string'
            || !(role === 'lead' ? ['PROPOSED', 'NO_DATA'] : ['PASS', 'BLOCK', 'NO_DATA']).includes(result.status)
            || !Array.isArray(result.citations)
            || result.citations.some(citation => !citation || !data.sourceRefs.some(ref =>
              citation.revisionId === ref.revisionId && citation.sha256 === ref.sha256))) {
          issues.add('ROLE_BINDING_UNAVAILABLE:' + role + ':' + record.id);
          continue;
        }
        const id = 'cfo:' + record.id + ':' + role;
        nodes.set(id, { id, recordId: record.id, kind: role, contentHash: sha256(canonicalBytes(result)),
          sequence: record.sequence, createdAt: record.createdAt, status: result.status,
          facts: { runId: result.runId, callId: result.callId, snapshotHash: result.snapshotHash,
            proposalHash: result.proposalHash,
            citations: result.citations.map(citation => ({ revisionId: citation.revisionId, sha256: citation.sha256 })),
            rationale: typeof (role === 'lead' ? result.thesis : result.reason) === 'string'
              ? (role === 'lead' ? result.thesis : result.reason) : null,
            counterCase: role === 'lead' && typeof result.counterCase === 'string' ? result.counterCase : null } });
        const roleEdge = { source: 'cfo:' + record.id, target: id, relation: 'retains-' + role };
        edges.set(id, roleEdge);
        for (const citation of result.citations) {
          if (!records.has(citation.revisionId)) continue;
          edges.set(id + ':' + citation.revisionId, {
            source: id, target: 'cfo:' + citation.revisionId, relation: 'cites',
          });
        }
      }
    }
    if (record.kind === 'action') {
      for (const [field, relation] of [['planId', 'implements'], ['mandateId', 'constrained-by'],
        ['portfolioId', 'starts-from'], ['receiptPortfolioId', 'reconciled-with'], ['nextPlanId', 'continues-with']]) {
        if (data[field] !== null) await retain(record, data[field], relation);
      }
    }
    if (record.kind === 'plan') {
      if (data.parentPlanId) await retain(record, data.parentPlanId, 'continues-plan');
      if (root.kind === 'action' && data.reviewJobId) {
        const review = await store.reviewAt(owner, data.reviewJobId, root.sequence);
        if (review) await retain(record, review.id, 'reviewed-by');
        else issues.add('REVIEW_NOT_RETAINED_AT_CUTOFF:' + data.reviewJobId);
      }
      for (const ref of data.sourceRefs) {
        const source = records.get(ref.revisionId);
        if (!source) continue;
        const expected = source.kind === 'mandate' ? data.snapshot.mandate
          : source.kind === 'portfolio' ? data.snapshot.portfolio
            : source.kind === 'quotes' ? { quotes: data.snapshot.quotes } : null;
        const actual = source.kind === 'quotes' ? { quotes: source.data.quotes } : source.data;
        if (expected === null || stableStringify(expected) !== stableStringify(actual)) {
          issues.add('SOURCE_SNAPSHOT_MISMATCH:' + source.id);
        }
      }
    }
  }
  const sourceLimits = new Map();
  for (const record of records.values()) {
    if (record.kind !== 'plan') continue;
    const mandate = record.data.sourceRefs.map(ref => records.get(ref.revisionId))
      .find(source => source?.kind === 'mandate');
    if (!mandate) continue;
    for (const ref of record.data.sourceRefs) {
      sourceLimits.set(ref.revisionId, Math.min(sourceLimits.get(ref.revisionId) ?? Infinity,
        mandate.data.maxEvidenceAgeSeconds));
    }
  }
  const evidence = [];
  const clock = Date.parse(at);
  for (const record of records.values()) {
    const maxAgeSeconds = sourceLimits.get(record.id) ?? null;
    const captures = record.kind === 'portfolio'
      ? [{ capturedAt: record.data.capturedAt, sourceTime: null, expiresAt: null }]
      : record.kind === 'quotes' ? record.data.quotes.map(quote =>
        ({ capturedAt: quote.capturedAt, sourceTime: quote.raw.timestamp,
          expiresAt: typeof quote.raw.quote.deadline === 'string' ? quote.raw.quote.deadline : null })) : [];
    for (const capture of captures) {
      const capturedAt = Date.parse(capture.capturedAt);
      const sourceAt = capture.sourceTime === null ? capturedAt : Date.parse(capture.sourceTime);
      const ageSeconds = Number.isFinite(sourceAt) ? (clock - sourceAt) / 1000 : null;
      const expiry = capture.expiresAt === null ? null : Date.parse(capture.expiresAt);
      const status = maxAgeSeconds === null || ageSeconds === null
        || (record.kind === 'quotes' && !Number.isFinite(expiry)) ? 'UNKNOWN'
        : capturedAt > clock || sourceAt > capturedAt ? 'UNKNOWN'
          : ageSeconds > maxAgeSeconds || (expiry !== null && expiry <= clock) ? 'STALE' : 'FRESH';
      evidence.push({ recordId: record.id, kind: record.kind, ...capture, maxAgeSeconds, ageSeconds, status,
        basis: capture.sourceTime === null ? 'capture-time' : 'provider-time-and-capture-time' });
    }
  }
  const freshnessStatus = evidence.some(source => source.status === 'STALE') ? 'STALE'
    : evidence.length === 0 || evidence.some(source => source.status === 'UNKNOWN') ? 'UNKNOWN' : 'FRESH';
  return {
    trace: projectDecisionTrace({ domain: 'cfo', root, nodes: [...nodes.values()],
      edges: [...edges.values()], issues: [...issues] }),
    freshness: { evaluatedAt: at, status: freshnessStatus, basis: 'capture-time-is-not-market-event-time', evidence },
  };
}
