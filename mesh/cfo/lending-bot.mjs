import { randomUUID } from 'node:crypto';
import { lifecycleError, ownerWallet, requestId, recordHash, cloneRecord } from './lifecycle.mjs';
import { validateBotMandate, units, fresh, selectLendingAction } from './lending-strategy.mjs';
import { runCfoReview } from './review.mjs';
import { createAccounting, observeAccounting, reconcileAccounting, accountingOverview, feeOwed } from './lending-accounting.mjs';

const TERMINAL = new Set(['CONFIRMED', 'FAILED', 'REFUNDED']);
const REVIEW_MS = 120000;
const LEASE_MS = 45000;
const add = (at, ms) => new Date(Date.parse(at) + ms).toISOString();
const fail = (code, message) => { throw lifecycleError(code, message); };
const reason = error => /^[A-Z][A-Z0-9_]{0,63}$/.test(error?.code || '') ? error.code : 'PROVIDER_UNAVAILABLE';
const meta = (operation, input) => ({ operation, hash: recordHash(Object.fromEntries(Object.entries(input)
  .filter(([key]) => !['requestId', 'accessToken'].includes(key)))) });
function runnerData(wallet, value = {}) {
  return { wallet, state: 'STOPPED', nextRunAt: null, reason: null, lease: null, lastActionAt: null,
    rotation: null, mandateId: null, reviewCallsUsed: 0, ...value };
}
function runnerDto(value) { return { state: value.state, nextRunAt: value.nextRunAt, reason: value.reason }; }
function actionDto(record) {
  const value = record.data;
  return { actionId: value.actionId, status: value.status, action: value.action,
    reserveAddress: value.reserveAddress, amountBaseUnits: value.amountBaseUnits, amountUnit: value.amountUnit,
    signature: value.signature ?? null, createdAt: value.createdAt, reason: value.reason ?? null };
}
function delegationDto(record) {
  if (!record) return null;
  const d = record.data.delegation;
  return { status: d.status, policyIds: d.policyIds ?? [], policyHash: d.policyHash ?? null,
    signerId: d.signerId ?? null, expiresAt: d.expiresAt ?? null, summary: d.summary ?? [], reason: d.reason ?? null };
}
async function state(tx, wallet) {
  const result = { wallet };
  for (const kind of ['wallet', 'mandate', 'delegation', 'portfolio', 'runner', 'accounting']) result[kind] = await tx.latest(kind);
  result.run = runnerData(wallet, result.runner?.data);
  return result;
}
async function prior(tx, kind, operation, input) {
  requestId(input.requestId);
  const record = await tx.byRequest(input.requestId);
  if (!record) return null;
  const expected = meta(operation, input);
  if (record.kind !== kind || record.data._request?.operation !== expected.operation || record.data._request.hash !== expected.hash) {
    fail('CONFLICT', 'Request identifier already belongs to different content or operation.');
  }
  return await tx.latestFor(kind, 'controlRequestId', input.requestId) || record;
}
async function control(tx, kind, operation, input, data, options = {}) {
  return (await tx.append({ kind, requestId: input.requestId,
    data: { ...data, controlRequestId: input.requestId, _request: meta(operation, input) }, ...options })).record;
}
async function transition(tx, record, patch) {
  return (await tx.append({ kind: record.kind, expectedHeadId: record.id, data: { ...record.data, ...patch } })).record;
}
async function noOpen(tx) {
  if ((await tx.openActions()).length) fail('CONFLICT', 'An unresolved financial action reserves this owner. Reconcile it before another action.');
}
function requireMandate(s, at, allowExpired = false) {
  const value = s.mandate?.data.mandate;
  if (!value) fail('CONFLICT', 'Save and accept an explicit owner mandate first.');
  if (!allowExpired && Date.parse(value.expiresAt) <= Date.parse(at)) fail('CONFLICT', 'The owner mandate has expired.');
  return value;
}
function requireLink(s) {
  if (!s.wallet?.data.link) fail('CONFLICT', 'Link the dedicated customer-owned Falcon wallet first.');
  return s.wallet.data.link;
}
function checkedPortfolio(value, wallet) {
  if (!value || value.schemaVersion !== 1 || value.chain !== 'solana' || value.network !== 'mainnet-beta' || value.wallet !== wallet
      || !['OBSERVED', 'NO_DATA'].includes(value.status)) fail('PROVIDER_UNAVAILABLE', 'Solana adapter returned an invalid portfolio identity.');
  return cloneRecord(value);
}
function availableActions(records) {
  const seen = new Set();
  return records.filter(record => {
    if (seen.has(record.data.actionId)) return false;
    seen.add(record.data.actionId);
    return true;
  }).slice(0, 40).map(actionDto);
}

export function createLendingBotService({ journal, adapter, walletProvider, reviewTransport, config, reserves, review = runCfoReview } = {}) {
  if (!journal || !['withOwner', 'exclusive', 'dueOwners'].every(key => typeof journal[key] === 'function')) throw new TypeError('Lending requires the shared durable financial journal.');
  if (!adapter || !['capture', 'prepare', 'prepareFeeTransfer', 'verifySigned', 'submit', 'reconcile', 'policyRules', 'isExpired'].every(key => typeof adapter[key] === 'function')) throw new TypeError('Lending requires the complete Solana adapter.');
  if (!walletProvider || !['configuration', 'verifyWalletLink', 'prepareDelegation', 'verifyDelegation', 'prepareRevocation', 'revokeDelegation', 'signTransaction'].every(key => typeof walletProvider[key] === 'function')) throw new TypeError('Lending requires the complete customer-owned wallet provider.');
  if (!config || !Array.isArray(config.reviewGrants) || !Array.isArray(reserves) || reserves.length !== 2) throw new TypeError('Lending requires explicit pilot configuration and two supported reserves.');
  const active = new Map();
  let closing = false;
  let timer = null;
  let polling = false;
  const addresses = reserves.map(value => value.reserveAddress);
  function grantFor(owner, wallet, at) {
    return config.reviewGrants.find(value => value.ownerId === owner && value.wallet === wallet && Date.parse(value.expiresAt) > Date.parse(at)) || null;
  }
  function configuration() {
    const provider = walletProvider.configuration();
    const issues = [...provider.issues];
    if (!config.executionEnabled) issues.push('DELEGATED_EXECUTION_DISABLED');
    if (config.feeBps === null || !config.feeRecipient) issues.push('EXPLICIT_FEE_TERMS_REQUIRED');
    return { walletProviderConfigured: provider.configured, executionEnabled: config.executionEnabled,
      appId: provider.appId, signerId: provider.signerId, feeBps: config.feeBps, feeRecipient: config.feeRecipient,
      availableReserves: reserves.map(value => ({ reserveAddress: value.reserveAddress, marketAddress: value.marketAddress,
        mint: value.mint, symbol: 'USDC', decimals: 6 })), issues };
  }
  async function snapshot(owner, wallet) {
    return journal.withOwner(owner, wallet, tx => state(tx, wallet));
  }
  async function saveObservation(owner, wallet, portfolio, input = null) {
    return journal.withOwner(owner, wallet, async tx => {
      const s = await state(tx, wallet);
      if (input) {
        const existing = await prior(tx, 'portfolio', 'capture', input);
        if (existing) return existing.data.portfolio;
      }
      if (s.portfolio?.data.portfolio?.status === 'OBSERVED' && portfolio.status === 'OBSERVED'
          && portfolio.slot < s.portfolio.data.portfolio.slot) fail('CONFLICT', 'A newer portfolio observation is already retained.');
      if (input) await control(tx, 'portfolio', 'capture', input, { wallet, portfolio });
      else await tx.append({ kind: 'portfolio', data: { wallet, portfolio } });
      if (portfolio.status === 'OBSERVED' && s.mandate && !(await tx.openActions()).length) {
        const terms = s.mandate.data.mandate;
        const accounting = s.accounting ? observeAccounting(s.accounting.data.state, portfolio)
          : createAccounting({ portfolio, feeBps: terms.feeBps, feeRecipient: terms.feeRecipient });
        await tx.append({ kind: 'accounting', data: { wallet, state: accounting } });
      }
      return portfolio;
    });
  }
  async function stop(owner, wallet, input, status = 'PAUSED') {
    const result = await journal.withOwner(owner, wallet, async tx => {
      const old = await prior(tx, 'runner', 'pause', input);
      if (old) return runnerDto(old.data);
      const s = await state(tx, wallet);
      const next = runnerData(wallet, { ...s.run, state: status, nextRunAt: null, lease: null,
        reason: 'Stopped by owner. Already-submitted transactions may still settle.' });
      const retained = await control(tx, 'runner', 'pause', input, next);
      for (const id of await tx.openActions()) {
        const action = await tx.latestFor('action', 'actionId', id);
        if (action?.data.mode === 'WORKER' && !action.data.signature && !action.data.signedTransactionBase64) {
          await transition(tx, action, { status: 'FAILED', reason: 'Owner stopped the unsigned run before any app broadcast.' });
        }
      }
      return runnerDto(retained.data);
    });
    active.get(owner)?.controller.abort();
    return { runner: result };
  }
  async function verifyCurrentDelegation(s, at) {
    const mandate = requireMandate(s, at);
    const link = requireLink(s);
    if (!s.delegation || s.delegation.data.mandateId !== s.mandate.id) fail('CONFLICT', 'Install and verify delegation for the current mandate.');
    const rules = await adapter.policyRules({ wallet: s.wallet.data.wallet, mandate });
    const verified = await walletProvider.verifyDelegation({ link, mandate, delegation: s.delegation.data.delegation, rules });
    if (verified.status !== 'ACTIVE') fail('UNAUTHORIZED', 'Current customer-owned delegation is not active or its exact scope changed.');
    return { mandate, link, rules, verified };
  }
  async function actionById(tx, id) {
    requestId(id);
    const record = await tx.latestFor('action', 'actionId', id);
    if (!record) fail('NOT_FOUND', 'Treasury action was not found for this owner.');
    return record;
  }
  async function requireUnusedSignature(tx, actionId, signature) {
    if (typeof signature !== 'string' || !signature || signature.length > 128) fail('PROVIDER_UNAVAILABLE', 'The verified chain signature is invalid.');
    const previous = await tx.latestFor('action', 'signature', signature);
    if (previous && previous.data.actionId !== actionId) fail('CONFLICT', 'This chain signature already belongs to another financial action.');
  }
  async function retireExpiredOwnerAction(owner, wallet) {
    return journal.exclusive(owner, wallet, async locked => {
      const record = await locked.withOwner(owner, wallet, async tx => {
        const open = await tx.openActions();
        return open.length === 1 ? tx.latestFor('action', 'actionId', open[0]) : null;
      });
      if (!record || record.data.mode !== 'OWNER' || record.data.status !== 'PREPARED'
          || record.data.signature || record.data.signedTransactionBase64
          || !await adapter.isExpired({ prepared: record.data.prepared })) return false;
      await locked.withOwner(owner, wallet, async tx => {
        const current = await actionById(tx, record.data.actionId);
        if (current.id !== record.id) fail('CONFLICT', 'Unsigned owner action changed during expiry verification.');
        await transition(tx, current, { status: 'FAILED',
          reason: 'Never registered for app broadcast; the original blockhash is now finalized-expired.' });
      });
      return true;
    });
  }
  async function retainPrepared(owner, wallet, input, operation, prepared, extra = {}, expectedMandateId = null) {
    return journal.withOwner(owner, wallet, async tx => {
      const old = await prior(tx, 'action', operation, input);
      if (old) return { ownerAction: { actionId: old.data.actionId, prepared: old.data.prepared } };
      await noOpen(tx);
      const s = await state(tx, wallet);
      const mandate = requireMandate(s, tx.now, true);
      if (expectedMandateId !== null && expectedMandateId !== s.mandate.id) fail('CONFLICT', 'Owner mandate changed during recovery preparation.');
      if (prepared.wallet !== wallet || prepared.network !== 'mainnet-beta' || prepared.chain !== 'solana'
          || !fresh(prepared.observedAt, tx.now, mandate.maxEvidenceAgeSeconds) || Date.parse(prepared.expiresAt) <= Date.parse(tx.now)) {
        fail('CONFLICT', 'Prepared owner action has stale or mismatched evidence.');
      }
      if (units(prepared.feeLamports) > units(mandate.maxFeeLamports)) fail('CONFLICT', 'Prepared transaction exceeds the owner native fee cap.');
      const record = await control(tx, 'action', operation, input, { wallet, actionId: randomUUID(), createdAt: tx.now,
        action: prepared.action, reserveAddress: prepared.reserveAddress, amountBaseUnits: prepared.amountBaseUnits,
        amountUnit: prepared.amountUnit, prepared, status: 'PREPARED', signature: null, signedTransactionBase64: null,
        mandateId: s.mandate.id, portfolioId: s.portfolio?.id ?? null, mode: 'OWNER', reason: null, ...extra }, { exclusiveAction: true });
      return { ownerAction: { actionId: record.data.actionId, prepared } };
    });
  }
  async function reconcileOne(owner, wallet, actionId) {
    return journal.exclusive(owner, wallet, async locked => {
      const original = await locked.withOwner(owner, wallet, tx => actionById(tx, actionId));
      if (TERMINAL.has(original.data.status)) return { action: actionDto(original) };
      if (!original.data.signature || !original.data.prepared) fail('CONFLICT', 'This action has no submitted signature to reconcile.');
      const proof = await adapter.reconcile({ prepared: original.data.prepared, signature: original.data.signature });
      if (!['PENDING', 'CONFIRMED', 'FAILED', 'UNVERIFIED'].includes(proof?.status) || proof.signature !== original.data.signature) {
        fail('PROVIDER_UNAVAILABLE', 'Transaction reconciliation returned an invalid identity.');
      }
      let portfolio = null;
      if (['CONFIRMED', 'FAILED'].includes(proof.status)) portfolio = checkedPortfolio(await adapter.capture({ wallet }), wallet);
      return locked.withOwner(owner, wallet, async tx => {
        const current = await actionById(tx, actionId);
        if (current.id !== original.id) fail('CONFLICT', 'Action changed during reconciliation.');
        const s = await state(tx, wallet);
        const terminal = ['CONFIRMED', 'FAILED'].includes(proof.status);
        const next = await transition(tx, current, { status: terminal ? proof.status : 'SUBMISSION_UNKNOWN',
          reconciliation: proof, reason: terminal ? proof.reason ?? null : 'Transaction effects remain unverified; funds stay reserved.' });
        if (terminal) {
          if (portfolio.status === 'OBSERVED') await tx.append({ kind: 'portfolio', data: { wallet, portfolio } });
          if (s.accounting) {
            const accounting = reconcileAccounting(s.accounting.data.state, {
              action: { ...next.data, sequence: Number(next.sequence) }, receipt: proof, portfolio,
            });
            await tx.append({ kind: 'accounting', data: { wallet, state: accounting } });
          }
          const rotation = proof.status === 'CONFIRMED' && next.data.mode === 'WORKER'
            ? next.data.action === 'redeem' ? { targetReserveAddress: next.data.decision.targetReserveAddress,
              supplyLimitBaseUnits: proof.amounts.usdcCreditBaseUnits, startedAt: tx.now, exitActionId: actionId }
              : next.data.action === 'supply' ? null : s.run.rotation : s.run.rotation;
          await tx.append({ kind: 'runner', data: runnerData(wallet, { ...s.run, lastActionAt: tx.now, rotation,
            reason: rotation ? 'INCOMPLETE: exit confirmed; customer cash awaits a fresh reviewed entry.' : s.run.reason }) });
        }
        return { action: actionDto(next) };
      });
    });
  }
  async function sendOwner(owner, wallet, input) {
    return journal.exclusive(owner, wallet, async locked => {
      const current = await locked.withOwner(owner, wallet, async tx => {
        const old = await prior(tx, 'action', 'submitOwnerSignature', input);
        if (old) return old;
        return actionById(tx, input.actionId);
      });
      if (current.data.mode !== 'OWNER') fail('UNAUTHORIZED', 'This endpoint accepts only explicit owner recovery or fee actions.');
      if (current.data.status !== 'PREPARED') return { action: actionDto(current) };
      if (await adapter.isExpired({ prepared: current.data.prepared })) fail('CONFLICT', 'The owner transaction blockhash has expired.');
      const verified = await adapter.verifySigned({ prepared: current.data.prepared, signedTransactionBase64: input.signedTransactionBase64 });
      const unknown = await locked.withOwner(owner, wallet, async tx => {
        const latest = await actionById(tx, input.actionId);
        if (latest.id !== current.id || Date.parse(current.data.prepared.expiresAt) <= Date.parse(tx.now)) fail('CONFLICT', 'Owner transaction changed or expired before submission.');
        const s = await state(tx, wallet);
        if (current.data.action === 'fee') {
          const owed = s.accounting ? feeOwed(s.accounting.data.state) : null;
          if (owed === null || units(String(owed)) !== units(current.data.amountBaseUnits)
              || current.data.prepared.recipient !== config.feeRecipient) fail('CONFLICT', 'Fee entitlement or accepted recipient changed.');
        }
        await requireUnusedSignature(tx, current.data.actionId, verified.signature);
        return control(tx, 'action', 'submitOwnerSignature', input, { ...current.data,
          status: 'SUBMISSION_UNKNOWN', signature: verified.signature, signedTransactionBase64: verified.signedTransactionBase64,
          reason: 'Exact signed bytes are durable before the first broadcast.' }, { expectedHeadId: current.id });
      });
      try { await adapter.submit({ prepared: unknown.data.prepared, signedTransactionBase64: unknown.data.signedTransactionBase64 }); }
      catch { return { action: actionDto(unknown) }; }
      return { action: actionDto(unknown) };
    });
  }

  async function finishRun(owner, wallet, leaseId, message, blocked = false) {
    return journal.withOwner(owner, wallet, async tx => {
      const s = await state(tx, wallet);
      if (s.run.state !== 'RUNNING' || s.run.lease?.id !== leaseId) return;
      const mandate = s.mandate?.data.mandate;
      await tx.append({ kind: 'runner', data: runnerData(wallet, { ...s.run,
        state: blocked ? 'BLOCKED' : 'RUNNING', lease: null, reason: message,
        nextRunAt: blocked || !mandate ? null : add(tx.now, mandate.monitorIntervalSeconds * 1000) }) });
    });
  }
  async function failUnsigned(owner, wallet, actionId, message) {
    if (!actionId) return;
    await journal.withOwner(owner, wallet, async tx => {
      const current = await actionById(tx, actionId);
      if (!TERMINAL.has(current.data.status) && !current.data.signature && !current.data.signedTransactionBase64) {
        await transition(tx, current, { status: 'FAILED', reason: message });
      }
    });
  }
  async function refreshLease(owner, wallet, leaseId, entry) {
    return journal.withOwner(owner, wallet, async tx => {
      const s = await state(tx, wallet);
      if (closing || entry.controller.signal.aborted || s.run.state !== 'RUNNING' || s.run.lease?.id !== leaseId) {
        fail('CONFLICT', 'This treasury run is stopped or no longer owns its lease.');
      }
      const grant = grantFor(owner, wallet, tx.now);
      if (!grant || (entry.grantId && grant.grantId !== entry.grantId)) fail('UNAUTHORIZED', 'The finite review grant expired or changed.');
      entry.reviewAt = tx.now;
      await tx.append({ kind: 'runner', data: runnerData(wallet, { ...s.run,
        lease: { id: leaseId, expiresAt: add(tx.now, LEASE_MS) } }) });
      return tx.now;
    });
  }
  function financialSnapshot(s, decision, at, runId) {
    const mandate = s.mandate.data.mandate;
    const portfolio = s.portfolio.data.portfolio;
    const source = portfolio.positions.find(p => p.reserveAddress === decision.reserveAddress);
    const target = portfolio.positions.find(p => p.reserveAddress === decision.targetReserveAddress);
    if (!source?.receiptMint || !target?.receiptMint) fail('PROVIDER_UNAVAILABLE', 'Current receipt mint evidence is required for review.');
    const action = decision.action === 'redeem' ? 'reinvest' : s.run.rotation ? 'reinvest' : 'invest';
    const sourceAssetId = decision.action === 'redeem' ? source.receiptMint : reserves[0].mint;
    const targetAssetId = target.receiptMint;
    const expiresAt = new Date(Math.min(Date.parse(mandate.expiresAt),
      Date.parse(portfolio.observedAt) + mandate.maxEvidenceAgeSeconds * 1000)).toISOString();
    const detail = decision.action === 'redeem'
      ? 'Receipt exit for two-stage reinvestment. This is not atomic; the later entry needs a fresh independent review.'
      : 'Native USDC supply to the exact reviewed reserve. The owner retains the receipt tokens.';
    const proposal = { action, sourceAssetId, targetAssetId, inputBaseUnits: decision.amountBaseUnits,
      reason: detail, expiresAt };
    return { schemaVersion: 1, domain: 'cfo', capturedAt: at, portfolio, mandate,
      mandateHash: recordHash(mandate), request: { requestId: runId, action, sourceAssetId, targetAssetId,
        inputBaseUnits: decision.amountBaseUnits }, quotes: [], proposal,
      checks: [
        { id: 'chain-and-units', status: 'PASS', detail: `Solana mainnet-beta ${decision.action}: ${decision.amountBaseUnits} ${decision.action === 'redeem' ? 'receipt-base-units' : 'USDC-base-units'}.` },
        { id: 'hold-and-two-reserves', status: 'PASS', detail: `Both supported reserves and HOLD compared. Estimated net benefit ${decision.expectedNetBenefitBaseUnits} USDC base units; conservative cost bound ${decision.costBoundBaseUnits}. APY can change.` },
        { id: 'authority', status: 'PASS', detail: 'Council advice cannot sign, widen a policy, or authorize fees. Current scoped owner delegation and deterministic execution guards remain mandatory.' },
      ], reasons: [], status: 'REVIEW' };
  }
  async function reviewedAction(owner, wallet, leaseId, entry, selection) {
    const reserved = await journal.withOwner(owner, wallet, async tx => {
      const s = await state(tx, wallet);
      const mandate = requireMandate(s, tx.now);
      const grant = grantFor(owner, wallet, tx.now);
      if (s.run.state !== 'RUNNING' || s.run.lease?.id !== leaseId || !grant) fail('UNAUTHORIZED', 'Current run and review grant are required.');
      await noOpen(tx);
      const current = selectLendingAction({ portfolio: s.portfolio?.data.portfolio, mandate, at: tx.now,
        lastActionAt: s.run.lastActionAt, rotation: s.run.rotation });
      if (current.status !== 'REVIEW' || recordHash(current.action) !== recordHash(selection.action)) fail('CONFLICT', 'The financial proposal changed before review reservation.');
      const usage = await tx.latestFor('review', 'grantId', grant.grantId);
      const usedCalls = usage?.data.usedCalls ?? 0;
      const required = selection.action.action === 'redeem' ? 4 : 2;
      if (usedCalls + required > grant.maxCalls || s.run.reviewCallsUsed + required > mandate.maxReviewCalls) {
        fail('UNAUTHORIZED', 'Finite review budget cannot cover this action and any required fresh rotation entry.');
      }
      const actionId = randomUUID();
      const packet = financialSnapshot(s, selection.action, tx.now, actionId);
      const snapshotHash = recordHash(packet);
      const sourceRefs = [s.mandate, s.portfolio].map(record => ({ revisionId: record.id, sha256: record.contentHash }));
      const reviewRecord = (await tx.append({ kind: 'review', data: { wallet, grantId: grant.grantId,
        usedCalls: usedCalls + 2, runId: actionId, snapshot: packet, snapshotHash, sourceRefs, status: 'PENDING', result: null } })).record;
      const action = (await tx.append({ kind: 'action', exclusiveAction: true, data: { wallet, actionId,
        createdAt: tx.now, action: selection.action.action, reserveAddress: selection.action.reserveAddress,
        amountBaseUnits: selection.action.amountBaseUnits,
        amountUnit: selection.action.action === 'redeem' ? 'receipt-base-units' : 'usdc-base-units',
        mode: 'WORKER', status: 'REVIEW_PENDING', prepared: null, signature: null, signedTransactionBase64: null,
        mandateId: s.mandate.id, portfolioId: s.portfolio.id, reviewId: reviewRecord.id, snapshotHash, leaseId,
        decision: selection.action, reason: null } })).record;
      await tx.append({ kind: 'runner', data: runnerData(wallet, { ...s.run, reviewCallsUsed: s.run.reviewCallsUsed + 2 }) });
      return { reviewRecord, action, grant };
    });
    entry.actionId = reserved.action.data.actionId;
    entry.grantId = reserved.grant.grantId;
    entry.reviewAt = reserved.reviewRecord.createdAt;
    const controller = entry.controller;
    const timeout = setTimeout(() => controller.abort(), REVIEW_MS);
    timeout.unref?.();
    const transport = reviewTransport ? {
      async preflight({ auditRequest }) {
        await refreshLease(owner, wallet, leaseId, entry);
        const result = await reviewTransport.preflight({ auditRequest, signal: controller.signal, budgetMs: REVIEW_MS });
        await refreshLease(owner, wallet, leaseId, entry);
        return result;
      },
      async call(request) {
        await refreshLease(owner, wallet, leaseId, entry);
        const result = await reviewTransport.call(request, { signal: controller.signal, budgetMs: REVIEW_MS });
        await refreshLease(owner, wallet, leaseId, entry);
        return result;
      },
    } : null;
    let verdict;
    try {
      verdict = await review({ runId: reserved.action.data.actionId,
        snapshot: reserved.reviewRecord.data.snapshot, snapshotHash: reserved.reviewRecord.data.snapshotHash,
        sourceRefs: reserved.reviewRecord.data.sourceRefs, transport, now: () => entry.reviewAt });
    } finally { clearTimeout(timeout); }
    const accepted = verdict?.status === 'REVIEW' && verdict.snapshotHash === reserved.action.data.snapshotHash
      && verdict.lead?.status === 'PROPOSED' && verdict.risk?.status === 'PASS'
      && verdict.lead.callId !== verdict.risk.callId
      && recordHash(verdict.proposal) === recordHash(reserved.reviewRecord.data.snapshot.proposal);
    const stored = await journal.withOwner(owner, wallet, async tx => {
      const current = await actionById(tx, reserved.action.data.actionId);
      const latestReview = await tx.latestFor('review', 'grantId', reserved.grant.grantId);
      const s = await state(tx, wallet);
      if (current.id !== reserved.action.id || latestReview?.id !== reserved.reviewRecord.id
          || s.run.state !== 'RUNNING' || s.run.lease?.id !== leaseId || controller.signal.aborted) fail('CONFLICT', 'Review was stopped or its retained evidence changed.');
      const finalReview = await transition(tx, latestReview, { status: accepted ? 'REVIEW' : 'NO_DATA', result: verdict ?? null });
      return transition(tx, current, { reviewId: finalReview.id, status: accepted ? 'REVIEWED' : 'FAILED',
        reason: accepted ? null : 'Independent same-snapshot Lead/Risk did not admit the proposal.' });
    });
    return accepted ? stored : null;
  }
  async function dispatchWorker(owner, wallet, leaseId, entry, reviewed) {
    return journal.exclusive(owner, wallet, async locked => {
      const setup = await locked.withOwner(owner, wallet, async tx => {
        const s = await state(tx, wallet);
        const action = await actionById(tx, reviewed.data.actionId);
        if (closing || entry.controller.signal.aborted || s.run.state !== 'RUNNING' || s.run.lease?.id !== leaseId
            || action.id !== reviewed.id || action.data.status !== 'REVIEWED'
            || s.mandate?.id !== action.data.mandateId || s.portfolio?.id !== action.data.portfolioId) fail('CONFLICT', 'Current financial authorization changed before signing.');
        const mandate = requireMandate(s, tx.now);
        if (!grantFor(owner, wallet, tx.now) || !fresh(s.portfolio.data.portfolio.observedAt, tx.now, mandate.maxEvidenceAgeSeconds)) fail('UNAUTHORIZED', 'Review grant or original source evidence expired before signing.');
        return { s, at: tx.now, action };
      });
      const verifiedScope = await verifyCurrentDelegation(setup.s, setup.at);
      const currentPortfolio = checkedPortfolio(await adapter.capture({ wallet }), wallet);
      const currentAt = await locked.withOwner(owner, wallet, tx => tx.now);
      const guard = selectLendingAction({ portfolio: currentPortfolio, mandate: verifiedScope.mandate, at: currentAt,
        lastActionAt: setup.s.run.lastActionAt, rotation: setup.s.run.rotation });
      const fixed = reviewed.data.decision;
      if (guard.status !== 'REVIEW' || guard.action.action !== fixed.action
          || guard.action.reserveAddress !== fixed.reserveAddress || guard.action.targetReserveAddress !== fixed.targetReserveAddress
          || units(guard.action.amountBaseUnits) < units(fixed.amountBaseUnits)
          || units(guard.action.costBoundBaseUnits) > units(fixed.costBoundBaseUnits)) fail('CONFLICT', 'Fresh executable state no longer admits the exact reviewed amount and reserve.');
      const gross = BigInt(guard.action.expectedNetBenefitBaseUnits) + units(guard.action.costBoundBaseUnits);
      const fixedNet = gross * units(fixed.amountBaseUnits) / units(guard.action.amountBaseUnits) - units(guard.action.costBoundBaseUnits);
      if (fixedNet < units(verifiedScope.mandate.minNetBenefitBaseUnits)) fail('CONFLICT', 'The fixed reviewed amount no longer beats HOLD after current costs.');
      const prepared = await adapter.prepare({ wallet, action: fixed.action, reserveAddress: fixed.reserveAddress,
        amountBaseUnits: fixed.amountBaseUnits, maxFeeLamports: verifiedScope.mandate.maxFeeLamports,
        maxEvidenceAgeSeconds: verifiedScope.mandate.maxEvidenceAgeSeconds });
      if (prepared.wallet !== wallet || prepared.action !== fixed.action || prepared.reserveAddress !== fixed.reserveAddress
          || prepared.amountBaseUnits !== fixed.amountBaseUnits || prepared.amountUnit !== reviewed.data.amountUnit
          || units(prepared.feeLamports) > units(verifiedScope.mandate.maxFeeLamports)
          || prepared.maxTotalCostUsdcBaseUnits === null || prepared.maxTotalCostUsdcBaseUnits === undefined
          || units(prepared.maxTotalCostUsdcBaseUnits) > units(fixed.costBoundBaseUnits)) fail('CONFLICT', 'Prepared transaction identity, units or admitted actual cost exceeds the reviewed bounds.');
      const signing = await locked.withOwner(owner, wallet, async tx => {
        const s = await state(tx, wallet);
        const current = await actionById(tx, reviewed.data.actionId);
        if (current.id !== reviewed.id || s.run.state !== 'RUNNING' || s.run.lease?.id !== leaseId
            || s.mandate?.id !== current.data.mandateId || s.portfolio?.id !== current.data.portfolioId
            || !fresh(setup.s.portfolio.data.portfolio.observedAt, tx.now, verifiedScope.mandate.maxEvidenceAgeSeconds)
            || Date.parse(prepared.expiresAt) <= Date.parse(tx.now) || Date.parse(verifiedScope.mandate.expiresAt) <= Date.parse(tx.now)
            || !grantFor(owner, wallet, tx.now) || entry.controller.signal.aborted || closing) fail('CONFLICT', 'Signing authority expired or changed during exact preparation.');
        return transition(tx, current, { status: 'SIGNING', prepared, executionObservation: currentPortfolio });
      });
      const signed = await walletProvider.signTransaction({ link: verifiedScope.link, mandate: verifiedScope.mandate,
        delegation: setup.s.delegation.data.delegation, rules: verifiedScope.rules, transactionBase64: prepared.transactionBase64 });
      const checked = await adapter.verifySigned({ prepared, signedTransactionBase64: signed.signedTransactionBase64 });
      const unknown = await locked.withOwner(owner, wallet, async tx => {
        const s = await state(tx, wallet);
        const current = await actionById(tx, reviewed.data.actionId);
        if (current.id !== signing.id || s.run.state !== 'RUNNING' || s.run.lease?.id !== leaseId
            || s.mandate?.id !== current.data.mandateId || Date.parse(prepared.expiresAt) <= Date.parse(tx.now)
            || Date.parse(verifiedScope.mandate.expiresAt) <= Date.parse(tx.now) || entry.controller.signal.aborted || closing) {
          fail('CONFLICT', 'Signed-only result was not authorized for a new submission.');
        }
        await requireUnusedSignature(tx, current.data.actionId, checked.signature);
        return transition(tx, current, { status: 'SUBMISSION_UNKNOWN', signature: checked.signature,
          signedTransactionBase64: checked.signedTransactionBase64, reason: 'Exact signed bytes committed before bounded RPC broadcast.' });
      });
      try { await adapter.submit({ prepared, signedTransactionBase64: unknown.data.signedTransactionBase64 }); }
      catch { /* Uncertain send stays reserved. Reconcile this exact signature, never replace it. */ }
      return actionDto(unknown);
    });
  }
  async function cycle(owner, wallet, entry) {
    const leaseId = randomUUID();
    const claimed = await journal.withOwner(owner, wallet, async tx => {
      const s = await state(tx, wallet);
      if (closing || !config.executionEnabled || s.run.state !== 'RUNNING'
          || !s.run.nextRunAt || Date.parse(s.run.nextRunAt) > Date.parse(tx.now)
          || (s.run.lease && Date.parse(s.run.lease.expiresAt) > Date.parse(tx.now))) return false;
      entry.reviewAt = tx.now;
      await tx.append({ kind: 'runner', data: runnerData(wallet, { ...s.run,
        lease: { id: leaseId, expiresAt: add(tx.now, LEASE_MS) } }) });
      return true;
    });
    if (!claimed) return;
    let heartbeat = null;
    try {
      const open = await journal.withOwner(owner, wallet, tx => tx.openActions());
      if (open.length) {
        const action = await journal.withOwner(owner, wallet, tx => tx.latestFor('action', 'actionId', open[0]));
        if (!action) {
          await finishRun(owner, wallet, leaseId, 'Another financial domain reserves this owner; treasury stays on HOLD.');
          return;
        }
        if (action.data.signature) {
          const result = await reconcileOne(owner, wallet, action.data.actionId);
          await finishRun(owner, wallet, leaseId, result.action.status === 'CONFIRMED'
            ? 'Finalized effects reconciled. The next decision uses actual customer funds.'
            : 'Exact submitted action remains reserved until finalized effects are known.');
          return result;
        }
        if (action.data.mode === 'WORKER') {
          await failUnsigned(owner, wallet, action.data.actionId, 'Previous scoped sign-only run did not commit any broadcast. A new run requires fresh evidence and budget.');
        } else if (action.data.status === 'PREPARED' && await adapter.isExpired({ prepared: action.data.prepared })) {
          await failUnsigned(owner, wallet, action.data.actionId, 'Owner action was never registered for broadcast and its blockhash is now finalized-expired.');
        } else {
          await finishRun(owner, wallet, leaseId, 'An unsigned owner action reserves this wallet. Register its signature or wait for authoritative blockhash expiry.');
          return;
        }
      }
      const before = await snapshot(owner, wallet);
      const beforeAt = await journal.withOwner(owner, wallet, tx => tx.now);
      await verifyCurrentDelegation(before, beforeAt);
      const observed = checkedPortfolio(await adapter.capture({ wallet }), wallet);
      await saveObservation(owner, wallet, observed);
      const s = await snapshot(owner, wallet);
      const at = await journal.withOwner(owner, wallet, tx => tx.now);
      const mandate = requireMandate(s, at);
      const selection = selectLendingAction({ portfolio: observed, mandate, at,
        lastActionAt: s.run.lastActionAt, rotation: s.run.rotation });
      if (selection.status !== 'REVIEW') {
        await finishRun(owner, wallet, leaseId, selection.reason);
        return selection;
      }
      await refreshLease(owner, wallet, leaseId, entry);
      heartbeat = setInterval(() => {
        void refreshLease(owner, wallet, leaseId, entry).catch(() => entry.controller.abort());
      }, 10000);
      heartbeat.unref?.();
      const reviewed = await reviewedAction(owner, wallet, leaseId, entry, selection);
      clearInterval(heartbeat); heartbeat = null;
      if (!reviewed) {
        await finishRun(owner, wallet, leaseId, 'HOLD: independent Lead/Risk did not admit the exact proposal.');
        return;
      }
      const action = await dispatchWorker(owner, wallet, leaseId, entry, reviewed);
      await finishRun(owner, wallet, leaseId, 'Submission recorded. Waiting for exact finalized transaction effects.');
      return { action };
    } catch (error) {
      await failUnsigned(owner, wallet, entry.actionId, 'No broadcast was committed: ' + reason(error));
      await finishRun(owner, wallet, leaseId, 'HOLD: ' + reason(error), error?.code === 'UNAUTHORIZED');
      throw error;
    } finally { clearInterval(heartbeat); }
  }

  const service = {
    async overview(owner, inputWallet) {
      const wallet = ownerWallet(owner, inputWallet);
      return journal.withOwner(owner, wallet, async tx => {
        const s = await state(tx, wallet);
        const c = configuration();
        const issues = [...c.issues];
        if (!s.wallet) issues.push('DEDICATED_WALLET_LINK_REQUIRED');
        if (!s.mandate) issues.push('OWNER_MANDATE_REQUIRED');
        if (!s.delegation || s.delegation.data.delegation.status !== 'ACTIVE') issues.push('CUSTOMER_DELEGATION_REQUIRED');
        if (!grantFor(owner, wallet, tx.now)) issues.push('FINITE_OPERATOR_REVIEW_GRANT_REQUIRED');
        if (!s.portfolio || s.portfolio.data.portfolio.status !== 'OBSERVED') issues.push('CURRENT_PORTFOLIO_REQUIRED');
        return { schemaVersion: 1, domain: 'solana-lending-bot', chain: 'solana', network: 'mainnet-beta',
          status: issues.length ? 'SETUP_REQUIRED' : 'READY', configuration: c,
          walletLink: s.wallet ? { providerWalletId: s.wallet.data.link.providerWalletId, walletAddress: s.wallet.data.link.walletAddress } : null,
          mandate: s.mandate ? { id: s.mandate.id, data: s.mandate.data.mandate } : null,
          delegation: delegationDto(s.delegation), portfolio: s.portfolio?.data.portfolio ?? null,
          runner: runnerDto(s.run), actions: availableActions(await tx.list('action', 200)),
          accounting: accountingOverview(s.accounting?.data.state ?? null), issues };
      });
    },
    async linkWallet(owner, inputWallet, input) {
      const wallet = ownerWallet(owner, inputWallet);
      requestId(input.requestId);
      const before = await snapshot(owner, wallet);
      if (before.run.state === 'RUNNING') fail('CONFLICT', 'Pause the bot before changing wallet linkage.');
      const link = await walletProvider.verifyWalletLink({ accessToken: input.accessToken, walletAddress: wallet });
      if (link.walletAddress !== wallet || !link.providerWalletId || !link.userId || !link.ownerId) fail('UNAUTHORIZED', 'Provider wallet ownership does not match this Falcon session.');
      return journal.withOwner(owner, wallet, async tx => {
        const old = await prior(tx, 'wallet', 'linkWallet', input);
        if (old) return { walletLink: { providerWalletId: old.data.link.providerWalletId, walletAddress: wallet } };
        await noOpen(tx);
        const s = await state(tx, wallet);
        if (s.run.state === 'RUNNING' || (s.wallet && recordHash(s.wallet.data.link) !== recordHash(link))) fail('CONFLICT', 'The existing dedicated wallet identity cannot change while enrolled.');
        await control(tx, 'wallet', 'linkWallet', input, { wallet, link });
        return { walletLink: { providerWalletId: link.providerWalletId, walletAddress: wallet } };
      });
    },
    async saveMandate(owner, inputWallet, input) {
      const wallet = ownerWallet(owner, inputWallet);
      return journal.withOwner(owner, wallet, async tx => {
        const old = await prior(tx, 'mandate', 'saveMandate', input);
        if (old) return { mandate: { id: old.id, data: old.data.mandate } };
        const s = await state(tx, wallet);
        requireLink(s);
        await noOpen(tx);
        if (s.run.state === 'RUNNING') fail('CONFLICT', 'Pause before changing the owner mandate.');
        if (s.delegation?.data.delegation.status === 'ACTIVE') fail('CONFLICT', 'Revoke the active delegation before changing its mandate.');
        const mandate = validateBotMandate(input.mandate, { reserves: addresses, feeBps: config.feeBps, feeRecipient: config.feeRecipient, at: tx.now });
        if (s.accounting && s.mandate && (s.mandate.data.mandate.feeBps !== mandate.feeBps || s.mandate.data.mandate.feeRecipient !== mandate.feeRecipient)) {
          fail('CONFLICT', 'Existing enrollment keeps its accepted fee terms; do not reprice historical capital or gains.');
        }
        const record = await control(tx, 'mandate', 'saveMandate', input, { wallet, mandate });
        await tx.append({ kind: 'runner', data: runnerData(wallet, { ...s.run, state: 'STOPPED', nextRunAt: null, lease: null,
          mandateId: record.id, reviewCallsUsed: 0, reason: 'New mandate requires fresh customer delegation.' }) });
        return { mandate: { id: record.id, data: mandate } };
      });
    },
    async prepareDelegation(owner, inputWallet, input) {
      const wallet = ownerWallet(owner, inputWallet);
      return journal.exclusive(owner, wallet, async locked => {
        const setup = await locked.withOwner(owner, wallet, async tx => {
          const old = await prior(tx, 'delegation', 'prepareDelegation', input);
          if (old) return { old };
          const s = await state(tx, wallet);
          requireLink(s); requireMandate(s, tx.now); await noOpen(tx);
          if (s.run.state === 'RUNNING') fail('CONFLICT', 'Pause before preparing a new delegation.');
          const pending = await control(tx, 'delegation', 'prepareDelegation', input, { wallet, mandateId: s.mandate.id,
            delegation: { status: 'PREPARING', policyIds: [], policyHash: null, signerId: configuration().signerId,
              expiresAt: s.mandate.data.mandate.expiresAt, summary: [], reason: null } });
          return { s, pending, at: tx.now };
        });
        if (setup.old) return { delegation: delegationDto(setup.old) };
        const { s, pending } = setup;
        const mandate = s.mandate.data.mandate;
        try {
          const rules = await adapter.policyRules({ wallet, mandate });
          const prepared = await walletProvider.prepareDelegation({ accessToken: input.accessToken, link: s.wallet.data.link, mandate, rules });
          return locked.withOwner(owner, wallet, async tx => {
            const next = await transition(tx, pending, { delegation: { ...prepared, status: 'PREPARED', reason: null } });
            return { delegation: delegationDto(next) };
          });
        } catch (error) {
          await locked.withOwner(owner, wallet, tx => transition(tx, pending, { delegation: { ...pending.data.delegation,
            status: 'UNAVAILABLE', reason: 'Policy preparation failed: ' + reason(error) } }));
          throw error;
        }
      });
    },
    async verifyDelegation(owner, inputWallet, input) {
      const wallet = ownerWallet(owner, inputWallet);
      const s = await snapshot(owner, wallet);
      const at = await journal.withOwner(owner, wallet, tx => tx.now);
      const verified = await verifyCurrentDelegation(s, at);
      return journal.withOwner(owner, wallet, async tx => {
        const old = await prior(tx, 'delegation', 'verifyDelegation', input);
        if (old) return { delegation: delegationDto(old) };
        const current = await state(tx, wallet);
        if (current.mandate?.id !== s.mandate.id || current.delegation?.id !== s.delegation.id) fail('CONFLICT', 'Delegation changed during verification.');
        const record = await control(tx, 'delegation', 'verifyDelegation', input, { ...s.delegation.data,
          delegation: { ...s.delegation.data.delegation, ...verified.verified } });
        return { delegation: delegationDto(record) };
      });
    },
    async capture(owner, inputWallet, input) {
      const wallet = ownerWallet(owner, inputWallet);
      requestId(input.requestId);
      const old = await journal.withOwner(owner, wallet, tx => prior(tx, 'portfolio', 'capture', input));
      if (old) return { portfolio: old.data.portfolio };
      const portfolio = checkedPortfolio(await adapter.capture({ wallet }), wallet);
      return { portfolio: await saveObservation(owner, wallet, portfolio, input) };
    },
    async start(owner, inputWallet, input) {
      const wallet = ownerWallet(owner, inputWallet);
      const s = await snapshot(owner, wallet);
      const at = await journal.withOwner(owner, wallet, tx => tx.now);
      if (!config.executionEnabled || !walletProvider.configuration().configured) fail('UNAUTHORIZED', 'Delegated execution requires explicit operator configuration.');
      if (!grantFor(owner, wallet, at)) fail('UNAUTHORIZED', 'A finite operator review grant is required.');
      await verifyCurrentDelegation(s, at);
      return journal.withOwner(owner, wallet, async tx => {
        const old = await prior(tx, 'runner', 'start', input);
        if (old) return { runner: runnerDto(old.data) };
        const current = await state(tx, wallet);
        requireMandate(current, tx.now);
        if (current.runner?.id !== s.runner?.id || current.mandate?.id !== s.mandate?.id
            || current.delegation?.id !== s.delegation?.id) fail('CONFLICT', 'Runner, mandate or delegation changed before start.');
        if (!current.portfolio || !fresh(current.portfolio.data.portfolio.observedAt, tx.now, current.mandate.data.mandate.maxEvidenceAgeSeconds)
            || !current.accounting) fail('CONFLICT', 'Capture a current portfolio and initialize accounting first.');
        if (current.run.state === 'RUNNING') return { runner: runnerDto((await control(tx, 'runner', 'start', input, current.run)).data) };
        const next = runnerData(wallet, { ...current.run, state: 'RUNNING', nextRunAt: tx.now, lease: null, reason: null });
        return { runner: runnerDto((await control(tx, 'runner', 'start', input, next)).data) };
      });
    },
    async pause(owner, inputWallet, input) { return stop(owner, ownerWallet(owner, inputWallet), input); },
    async prepareRevocation(owner, inputWallet, input) {
      const wallet = ownerWallet(owner, inputWallet);
      requestId(input.requestId);
      await stop(owner, wallet, { requestId: randomUUID() });
      const s = await snapshot(owner, wallet);
      const revocation = await walletProvider.prepareRevocation({ accessToken: input.accessToken, link: requireLink(s), delegation: s.delegation?.data.delegation });
      if (revocation.walletAddress !== wallet || revocation.scope !== 'ALL_DELEGATED_SIGNERS') fail('PROVIDER_UNAVAILABLE', 'Revocation preview has an invalid wallet or scope.');
      return { revocation };
    },
    async revoke(owner, inputWallet, input) {
      const wallet = ownerWallet(owner, inputWallet);
      requestId(input.requestId);
      await stop(owner, wallet, { requestId: randomUUID() });
      const s = await snapshot(owner, wallet);
      const verified = await walletProvider.revokeDelegation({ accessToken: input.accessToken, link: requireLink(s), delegation: s.delegation?.data.delegation });
      if (verified.status !== 'REVOKED') fail('CONFLICT', 'Delegated signers remain or provider revocation is unverified.');
      return journal.withOwner(owner, wallet, async tx => {
        const current = await state(tx, wallet);
        if (current.wallet?.id !== s.wallet.id) fail('CONFLICT', 'Wallet changed during revocation verification.');
        const record = await control(tx, 'delegation', 'revoke', input, { wallet, mandateId: current.mandate?.id ?? null,
          delegation: { ...current.delegation?.data.delegation, ...verified } });
        const runner = runnerData(wallet, { ...current.run, state: 'REVOKED', nextRunAt: null, lease: null, reason: 'Provider confirms all delegated signers are removed.' });
        await tx.append({ kind: 'runner', data: runner });
        return { runner: runnerDto(runner), delegation: delegationDto(record) };
      });
    },
    async prepareWithdrawal(owner, inputWallet, input) {
      const wallet = ownerWallet(owner, inputWallet);
      requestId(input.requestId); units(input.receiptBaseUnits, 'Receipt withdrawal', true);
      if (!addresses.includes(input.reserveAddress)) fail('INVALID_INPUT', 'Withdrawal reserve is not supported.');
      await stop(owner, wallet, { requestId: randomUUID() });
      await retireExpiredOwnerAction(owner, wallet);
      const s = await snapshot(owner, wallet);
      const at = await journal.withOwner(owner, wallet, tx => tx.now);
      const mandate = requireMandate(s, at, true);
      const prepared = await adapter.prepare({ wallet, action: 'redeem', reserveAddress: input.reserveAddress,
        amountBaseUnits: input.receiptBaseUnits, maxFeeLamports: mandate.maxFeeLamports, maxEvidenceAgeSeconds: mandate.maxEvidenceAgeSeconds });
      return retainPrepared(owner, wallet, input, 'prepareWithdrawal', prepared, {}, s.mandate.id);
    },
    async prepareFeeClaim(owner, inputWallet, input) {
      const wallet = ownerWallet(owner, inputWallet);
      requestId(input.requestId);
      await stop(owner, wallet, { requestId: randomUUID() });
      await retireExpiredOwnerAction(owner, wallet);
      const observed = checkedPortfolio(await adapter.capture({ wallet }), wallet);
      await saveObservation(owner, wallet, observed);
      const s = await snapshot(owner, wallet);
      const at = await journal.withOwner(owner, wallet, tx => tx.now);
      const mandate = requireMandate(s, at, true);
      const owed = s.accounting ? feeOwed(s.accounting.data.state) : null;
      if (owed === null || units(String(owed)) === 0n) fail('CONFLICT', 'No reconciled positive performance fee is currently payable.');
      if (mandate.feeRecipient !== config.feeRecipient || mandate.feeBps !== config.feeBps) fail('CONFLICT', 'Accepted fee terms do not match the current disclosed configuration.');
      const prepared = await adapter.prepareFeeTransfer({ wallet, recipient: mandate.feeRecipient,
        amountBaseUnits: String(owed), maxFeeLamports: mandate.maxFeeLamports });
      return retainPrepared(owner, wallet, input, 'prepareFeeClaim', prepared, { feeAccountingHash: recordHash(s.accounting.data.state) }, s.mandate.id);
    },
    async submitOwnerSignature(owner, inputWallet, input) {
      const wallet = ownerWallet(owner, inputWallet);
      requestId(input.requestId); requestId(input.actionId);
      if (typeof input.signedTransactionBase64 !== 'string' || input.signedTransactionBase64.length > 16384) fail('INVALID_INPUT', 'A bounded signed transaction is required.');
      return sendOwner(owner, wallet, input);
    },
    async reconcile(owner, inputWallet, input) {
      const wallet = ownerWallet(owner, inputWallet);
      requestId(input.requestId); requestId(input.actionId);
      return reconcileOne(owner, wallet, input.actionId);
    },
    tick(owner, inputWallet) {
      const wallet = ownerWallet(owner, inputWallet);
      if (closing) return Promise.resolve();
      if (active.has(owner)) return active.get(owner).promise;
      const entry = { controller: new AbortController(), actionId: null, grantId: null, reviewAt: null, promise: null };
      entry.promise = Promise.resolve().then(() => cycle(owner, wallet, entry)).finally(() => {
        if (active.get(owner) === entry) active.delete(owner);
      });
      active.set(owner, entry);
      return entry.promise;
    },
    startScheduler() {
      if (timer || closing || !config.executionEnabled) return;
      timer = setInterval(() => {
        if (polling || closing) return;
        polling = true;
        void journal.dueOwners().then(owners => {
          for (const item of owners) {
            if (!active.has(item.owner)) void service.tick(item.owner, item.wallet).catch(() => undefined);
          }
        }).catch(() => undefined).finally(() => { polling = false; });
      }, 1000);
      timer.unref?.();
    },
    async close() {
      closing = true;
      clearInterval(timer); timer = null;
      for (const run of active.values()) run.controller.abort();
      await Promise.allSettled([...active.values()].map(run => run.promise));
    },
  };
  return service;
}
