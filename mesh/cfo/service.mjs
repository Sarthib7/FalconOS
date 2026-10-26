import { createHash, randomUUID } from 'node:crypto';
import { PublicKey } from '@solana/web3.js';
import { MeshError } from '../domain.mjs';
import { canonicalWalletAddress, deriveWalletOwnerId } from '../wallet-auth.mjs';
import { canonicalBytes, sha256, stableStringify } from '../council/evidence.ts';
import { validateMandate, evaluatePlan } from './policy.mjs';
import { runCfoReview } from './review.mjs';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const HASH = /^[0-9a-f]{64}$/;
const MAX_REVIEW_MS = 120_000;
const ACTION_PREPARATION_LEASE_MS = 30_000;
const ROTATION_PLAN_LEASE_MS = 120_000;
const REVIEW_LEASE_MS = 30_000;
const REVIEW_HEARTBEAT_MS = 5_000;
const REVIEW_CLOSE_REASON = 'Review stopped when its service closed.';
const ACTIONS = new Set(['invest', 'redeem', 'rotate', 'reinvest', 'hold']);
const REVIEW_ACTIONS = new Set(['invest', 'reinvest']);
const PORTFOLIO_KEYS = ['schemaVersion', 'chain', 'network', 'wallet', 'signerId', 'capturedAt', 'blockHash', 'blockHeight', 'assets', 'balances', 'status', 'reasons'];
const QUOTE_KEYS = ['schemaVersion', 'capturedAt', 'raw', 'sha256', 'signatureVerified'];
const SNAPSHOT_KEYS = ['schemaVersion', 'domain', 'capturedAt', 'portfolio', 'mandate', 'mandateHash', 'request', 'quotes', 'proposal', 'checks', 'reasons', 'status'];
const REQUEST_KEYS = ['requestId', 'action', 'sourceAssetId', 'targetAssetId', 'inputBaseUnits'];
const REVIEW_RESULT_KEYS = ['schemaVersion', 'runId', 'snapshotHash', 'lead', 'risk', 'status', 'proposal', 'reasons', 'executionReady'];
const REVIEW_JOB_KEYS = ['jobId', 'requestId', 'snapshotHash', 'state', 'phase', 'result', 'executionReady'];
const GRANT_KEYS = ['ownerId', 'wallet', 'maxReserveBaseUnits', 'expiresAt', 'devnetProofId'];
const TRIAL_KEYS = ['ownerId', 'wallet', 'actionId', 'quoteHash', 'sourceAssetId', 'targetAssetId', 'inputBaseUnits', 'expiresAt', 'devnetProofId'];
const PROVIDER_CONFIGURATION_KEYS = ['enabled', 'partnerKeyConfigured', 'senderLookupKeyConfigured'];
const REDACTED_KEYS = new Set([
  'payload', 'signaturebase64', 'signeddata', 'privatekey', 'secret', 'apikey', 'authorization',
  'hidden', 'hiddenthinking', 'chainofthought', 'reasoning', 'rawmessages', 'messages', 'prompt',
]);

function fail(code, message) { throw new MeshError(code, message); }
function invalid(message) { fail('INVALID_INPUT', message); }
function conflict(message = 'CFO request conflicts with retained owner state.') { fail('CONFLICT', message); }
function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    && [Object.prototype, null].includes(Object.getPrototypeOf(value));
}
function exact(value, keys, name) {
  if (!isRecord(value) || Object.keys(value).length !== keys.length || keys.some(key => !Object.hasOwn(value, key))) {
    invalid(name + ' fields do not match the schema.');
  }
}
function exactOptional(value, required, optional, name) {
  if (!isRecord(value) || required.some(key => !Object.hasOwn(value, key))
      || Object.keys(value).some(key => !required.includes(key) && !optional.includes(key))) invalid(name + ' fields do not match the schema.');
}
function uuid(value, name) {
  if (typeof value !== 'string' || !UUID.test(value)) invalid(name + ' must be a UUID.');
  return value.toLowerCase();
}
function time(value, name) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)
      || !Number.isFinite(Date.parse(value)) || new Date(Date.parse(value)).toISOString() !== value) invalid(name + ' must be canonical UTC time.');
  return Date.parse(value);
}
function providerTimestamp(value) {
  if (typeof value !== 'string') return null;
  const match = /^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2}:\d{2})(?:\.(\d{1,9}))?Z$/.exec(value);
  if (!match) return null;
  try {
    const second = time(`${match[1]}T${match[2]}.000Z`, 'Provider quote timestamp');
    return second + Number((match[3] ?? '').padEnd(3, '0').slice(0, 3));
  } catch { return null; }
}
function units(value, name, { positive = false } = {}) {
  if (typeof value !== 'string' || value.length > 39 || !/^(0|[1-9]\d*)$/.test(value)) invalid(name + ' must be an exact integer-unit string.');
  const amount = BigInt(value);
  if (amount > ((1n << 128n) - 1n) || (positive && amount === 0n)) invalid(name + ' is outside the supported range.');
  return amount;
}
function safeCode(error, fallback = 'UNAVAILABLE') {
  const code = error?.code;
  return typeof code === 'string' && /^[A-Z0-9_]{1,48}$/.test(code) ? code : fallback;
}
function safeReason(error, fallback) { return fallback + ':' + safeCode(error); }
function cloneJson(value, maxBytes = 192 * 1024) {
  let encoded;
  try { encoded = JSON.stringify(value); } catch { fail('STORAGE_UNAVAILABLE', 'CFO data could not be safely retained.'); }
  if (typeof encoded !== 'string' || Buffer.byteLength(encoded, 'utf8') > maxBytes) fail('TOO_LARGE', 'CFO data exceeds its response limit.');
  try { return JSON.parse(encoded); } catch { fail('STORAGE_UNAVAILABLE', 'CFO data could not be safely retained.'); }
}
function deepPublic(value, depth = 0) {
  if (depth > 20) fail('STORAGE_UNAVAILABLE', 'Retained CFO response nesting exceeds its limit.');
  if (Array.isArray(value)) return value.slice(0, 256).map(item => deepPublic(item, depth + 1));
  if (!isRecord(value)) return value;
  const output = Object.create(null);
  for (const [key, child] of Object.entries(value)) {
    if (REDACTED_KEYS.has(key.toLowerCase().replaceAll('_', ''))) continue;
    output[key] = deepPublic(child, depth + 1);
  }
  return output;
}
function publicRecord(record) {
  if (!record) return null;
  return cloneJson({
    id: record.id,
    requestId: record.requestId,
    createdAt: record.createdAt,
    kind: record.kind,
    data: deepPublic(record.data),
  });
}
function walletOwner(owner, wallet) {
  let canonical;
  try { canonical = canonicalWalletAddress(wallet); }
  catch { fail('INVALID_INPUT', 'CFO wallet must be the canonical verified Solana address.'); }
  if (typeof owner !== 'string' || deriveWalletOwnerId(canonical) !== owner) fail('UNAUTHORIZED', 'CFO wallet does not match the server-verified owner.');
  return canonical;
}
function ownerKey(value, name) {
  if (typeof value !== 'string' || !/^wallet_[a-f0-9]{56}$/.test(value)) invalid(name + ' is invalid.');
  return value;
}
function validPortfolio(value, wallet) {
  try { exact(value, PORTFOLIO_KEYS, 'CFO portfolio'); }
  catch { return false; }
  if (value.schemaVersion !== 1 || value.chain !== 'near' || value.network !== 'mainnet' || value.wallet !== wallet
      || value.signerId !== Buffer.from(new PublicKey(wallet).toBytes()).toString('hex')
      || !['OBSERVED', 'NO_DATA'].includes(value.status) || !Array.isArray(value.assets) || value.assets.length > 16
      || !Array.isArray(value.balances) || value.balances.length > 16 || !Array.isArray(value.reasons) || value.reasons.length > 32) return false;
  try { time(value.capturedAt, 'Portfolio capture time'); } catch { return false; }
  if (value.status === 'OBSERVED' && (typeof value.blockHash !== 'string' || !value.blockHash || !Number.isSafeInteger(value.blockHeight) || value.blockHeight < 1)) return false;
  return true;
}
function noDataPortfolio(wallet, at, reason) {
  return {
    schemaVersion: 1,
    chain: 'near',
    network: 'mainnet',
    wallet,
    signerId: Buffer.from(new PublicKey(wallet).toBytes()).toString('hex'),
    capturedAt: at,
    blockHash: null,
    blockHeight: null,
    assets: [],
    balances: [],
    status: 'NO_DATA',
    reasons: [String(reason).slice(0, 512)],
  };
}
function balanceOf(portfolio, assetId) {
  return portfolio.balances.find(balance => balance.assetId === assetId)?.balanceBaseUnits ?? '0';
}
function verifyQuoteEnvelope(quote) {
  try { exact(quote, QUOTE_KEYS, 'Quote envelope'); }
  catch { return false; }
  if (quote.schemaVersion !== 1 || quote.signatureVerified !== true || !HASH.test(quote.sha256 ?? '')
      || !isRecord(quote.raw) || !isRecord(quote.raw.quoteRequest) || !isRecord(quote.raw.quote)) return false;
  try {
    const capturedAt = time(quote.capturedAt, 'Quote capture time');
    const providerAt = providerTimestamp(quote.raw.timestamp);
    return providerAt !== null && providerAt <= capturedAt && sha256(canonicalBytes(quote.raw)) === quote.sha256;
  } catch { return false; }
}
function quoteDeadline(quote) {
  try { return time(quote.raw.quote.deadline, 'Quote deadline'); }
  catch { return null; }
}
function quoteEvidenceFresh(quote, at, maxAgeSeconds) {
  const providerAt = providerTimestamp(quote.raw?.timestamp);
  const capturedAt = Date.parse(quote.capturedAt);
  const now = Date.parse(at);
  return providerAt !== null && providerAt <= capturedAt && capturedAt <= now
    && now - providerAt <= maxAgeSeconds * 1000;
}
function requestForAction({ requestId, action, sourceAssetId, targetAssetId, inputBaseUnits }) {
  return { requestId, action, sourceAssetId, targetAssetId, inputBaseUnits };
}
function validatePlanInput(input) {
  exact(input, ['requestId', 'action', 'sourceAssetId', 'targetAssetId', 'inputBaseUnits'], 'CFO plan request');
  const requestId = uuid(input.requestId, 'Request ID');
  if (!ACTIONS.has(input.action)) invalid('CFO action is unsupported.');
  for (const field of ['sourceAssetId', 'targetAssetId']) {
    if (input[field] !== null && (typeof input[field] !== 'string' || input[field].length < 1 || input[field].length > 128)) invalid('CFO asset ID is invalid.');
  }
  if (input.inputBaseUnits !== null) units(input.inputBaseUnits, 'CFO action input', { positive: true });
  if (input.action === 'hold') {
    if (input.sourceAssetId !== null || input.targetAssetId !== null || input.inputBaseUnits !== null) invalid('Hold requests cannot include asset or amount fields.');
  } else if (['invest', 'reinvest'].includes(input.action) && input.targetAssetId === null) {
    if (input.sourceAssetId === null) invalid('Target-weight buys require the mandate reserve source.');
  } else {
    if (input.sourceAssetId === null || input.targetAssetId === null) invalid('CFO action requires explicit source and target assets.');
    if (['redeem', 'rotate'].includes(input.action) && input.inputBaseUnits === null) invalid('CFO exit actions require an explicit input amount.');
    if (['invest', 'reinvest'].includes(input.action) && input.inputBaseUnits === null) invalid('An explicit buy target requires an explicit input amount.');
  }
  return requestForAction({ ...input, requestId });
}
function sourceRef(record) { return { revisionId: record.id, sha256: record.contentHash }; }
function snapshotHash(snapshot) { return sha256(canonicalBytes(snapshot)); }
function reviewNoData(jobId, hash, reason) {
  return {
    schemaVersion: 1,
    runId: jobId,
    snapshotHash: hash,
    lead: null,
    risk: null,
    status: 'NO_DATA',
    proposal: null,
    reasons: [String(reason).slice(0, 512)],
    executionReady: false,
  };
}
function validReviewResult(value, plan) {
  try { exact(value, REVIEW_RESULT_KEYS, 'CFO review result'); }
  catch { return false; }
  if (value.schemaVersion !== 1 || value.runId !== plan.data.reviewJobId || value.snapshotHash !== plan.data.snapshotHash
      || !['REVIEW', 'BLOCKED', 'NO_DATA'].includes(value.status) || value.executionReady !== false
      || !Array.isArray(value.reasons) || value.reasons.length > 32
      || value.reasons.some(reason => typeof reason !== 'string' || Buffer.byteLength(reason, 'utf8') > 512)) return false;
  if (value.status !== 'REVIEW') return value.proposal === null;
  const expected = plan.data.snapshot.proposal;
  if (!expected || stableStringify(value.proposal) !== stableStringify(expected)) return false;
  if (REVIEW_ACTIONS.has(plan.data.request.action)) {
    const lead = value.lead;
    const risk = value.risk;
    if (!isRecord(lead) || !isRecord(risk) || lead.status !== 'PROPOSED' || risk.status !== 'PASS'
        || typeof lead.callId !== 'string' || typeof risk.callId !== 'string' || lead.callId === risk.callId
        || lead.snapshotHash !== plan.data.snapshotHash || risk.snapshotHash !== plan.data.snapshotHash) return false;
    const expectedProposalHash = sha256(canonicalBytes(expected));
    if (lead.proposalHash !== expectedProposalHash || risk.proposalHash !== expectedProposalHash) return false;
  }
  return true;
}
function reviewJobDto(reviewRecord, plan) {
  if (!reviewRecord) return null;
  return cloneJson({
    jobId: reviewRecord.data.jobId,
    requestId: plan.data.request.requestId,
    snapshotHash: reviewRecord.data.snapshotHash,
    state: reviewRecord.data.state,
    phase: reviewRecord.data.phase,
    result: reviewRecord.data.result === null ? null : deepPublic(reviewRecord.data.result),
    executionReady: false,
  });
}
function quoteMatches(quote, binding, proposal, reserveAssetId) {
  const quoteTargetAssetId = proposal.action === 'redeem' || proposal.action === 'rotate'
    ? reserveAssetId : proposal.targetAssetId;
  return binding?.role === 'ACTION' && binding.quoteHash === quote?.sha256
    && binding.sourceAssetId === proposal.sourceAssetId && binding.targetAssetId === quoteTargetAssetId
    && binding.inputBaseUnits === proposal.inputBaseUnits;
}
function actionDto(record) {
  return {
    actionId: record.data.actionId,
    status: record.data.status,
    intentHash: record.data.intentHash,
    correlationId: record.data.correlationId,
    reconciliationRequired: ['SUBMISSION_UNKNOWN', 'SUBMITTED', 'PENDING', 'UNVERIFIED', 'AWAITING_NEXT_LEG', 'EXIT_CONFIRMED'].includes(record.data.status),
  };
}
async function settlementDto(record, store, owner) {
  const portfolio = record.data.receiptPortfolioId ? await store.get(owner, record.data.receiptPortfolioId) : null;
  return cloneJson({
    actionId: record.data.actionId,
    status: record.data.status,
    reason: record.data.reason,
    providerStatus: deepPublic(record.data.providerStatus),
    intentHash: record.data.intentHash,
    nearTxHashes: record.data.nearTxHashes,
    portfolio: publicRecord(portfolio),
    amounts: record.data.amounts,
  });
}
function addMilliseconds(at, milliseconds) { return new Date(Date.parse(at) + milliseconds).toISOString(); }
function sameRequest(left, right) { return stableStringify(left) === stableStringify(right); }
function reviewPass(job) {
  return job?.data.state === 'COMPLETE' && job.data.result?.status === 'REVIEW' && job.data.result.executionReady === false;
}
function confirmedAmountsMatch(amounts, action) {
  try {
    exact(amounts, ['debit', 'credit'], 'Confirmed CFO settlement amounts');
    exact(amounts.debit, ['assetId', 'baseUnits'], 'Confirmed CFO debit');
    exact(amounts.credit, ['assetId', 'baseUnits'], 'Confirmed CFO credit');
    const debit = units(amounts.debit.baseUnits, 'Confirmed debit', { positive: true });
    const credit = units(amounts.credit.baseUnits, 'Confirmed credit', { positive: true });
    const expectedDebit = units(action.quote.raw.quote.amountIn, 'Quoted debit', { positive: true });
    const minimumCredit = units(action.quote.raw.quote.minAmountOut, 'Quoted minimum credit', { positive: true });
    return amounts.debit.assetId === action.sourceAssetId && debit === expectedDebit
      && amounts.credit.assetId === action.targetAssetId && credit >= minimumCredit;
  } catch { return false; }
}

function validateGrant(input) {
  exact(input, GRANT_KEYS, 'CFO execution grant');
  const wallet = canonicalWalletAddress(input.wallet);
  const ownerId = ownerKey(input.ownerId, 'CFO grant owner');
  if (deriveWalletOwnerId(wallet) !== ownerId) invalid('CFO execution grant wallet and owner do not match.');
  units(input.maxReserveBaseUnits, 'CFO grant reserve cap', { positive: true });
  time(input.expiresAt, 'CFO grant expiry');
  uuid(input.devnetProofId, 'CFO T82 proof ID');
  return { ...input, ownerId, wallet, devnetProofId: input.devnetProofId.toLowerCase() };
}
function validateTrial(input) {
  exact(input, TRIAL_KEYS, 'CFO execution trial');
  const wallet = canonicalWalletAddress(input.wallet);
  const ownerId = ownerKey(input.ownerId, 'CFO trial owner');
  if (deriveWalletOwnerId(wallet) !== ownerId) invalid('CFO execution trial wallet and owner do not match.');
  uuid(input.actionId, 'CFO trial action ID');
  if (!HASH.test(input.quoteHash) || typeof input.sourceAssetId !== 'string' || typeof input.targetAssetId !== 'string') invalid('CFO execution trial quote binding is invalid.');
  units(input.inputBaseUnits, 'CFO trial input', { positive: true });
  time(input.expiresAt, 'CFO trial expiry');
  uuid(input.devnetProofId, 'CFO T82 proof ID');
  return { ...input, ownerId, wallet, actionId: input.actionId.toLowerCase(), devnetProofId: input.devnetProofId.toLowerCase() };
}
function validateProviderConfiguration(input) {
  const value = input === null ? { enabled: null, partnerKeyConfigured: null, senderLookupKeyConfigured: null } : input;
  exact(value, PROVIDER_CONFIGURATION_KEYS, 'CFO provider configuration');
  for (const key of PROVIDER_CONFIGURATION_KEYS) {
    if (value[key] !== null && typeof value[key] !== 'boolean') invalid('CFO provider configuration flags must be boolean or unknown.');
  }
  return { ...value };
}

export function createCfoService({
  store,
  adapter,
  reviewTransport,
  reviewOwners = [],
  executionGrants = [],
  executionTrials = [],
  providerConfiguration = null,
  verifyDevnetProof = async () => false,
  now = () => new Date().toISOString(),
  review = runCfoReview,
} = {}) {
  const requiredStore = ['get', 'byRequest', 'latest', 'latestAction', 'actionByRequest', 'latestReview', 'list', 'append', 'clock'];
  if (!store || requiredStore.some(method => typeof store[method] !== 'function')) throw new TypeError('CFO service requires the durable CFO store.');
  const requiredAdapter = ['assets', 'capturePortfolio', 'quote', 'generateIntent', 'validateSigned', 'submitIntent', 'status', 'reconcile'];
  if (!adapter || requiredAdapter.some(method => typeof adapter[method] !== 'function')) throw new TypeError('CFO service requires the complete NEAR Intents adapter.');
  if (!Array.isArray(reviewOwners) && !(reviewOwners instanceof Set)) invalid('CFO review grants must be a trusted list or set.');
  if (!Array.isArray(executionGrants) || !Array.isArray(executionTrials)) invalid('CFO execution grants and exact trials must be trusted arrays.');
  if (typeof verifyDevnetProof !== 'function' || typeof review !== 'function' || typeof now !== 'function') invalid('CFO service dependencies are invalid.');

  const reviewerOwners = new Set([...reviewOwners].map(value => ownerKey(value, 'CFO review owner')));
  const grants = executionGrants.map(validateGrant);
  const trials = executionTrials.map(validateTrial);
  const serviceId = randomUUID();
  const providerConfig = validateProviderConfiguration(providerConfiguration);
  const activeReviews = new Map();
  const activeMonitors = new Map();
  let closing = false;
  let closePromise = null;

  function identity(owner, wallet) { return walletOwner(owner, wallet); }
  function providerGateReason(stage) {
    if (providerConfig.enabled === false) return 'CFO_PROVIDER_DISABLED';
    if (['quote', 'generate', 'submit', 'status', 'reconcile'].includes(stage)
        && providerConfig.partnerKeyConfigured === false) return 'CFO_PARTNER_KEY_REQUIRED';
    if (stage === 'reconcile' && providerConfig.senderLookupKeyConfigured === false) return 'CFO_SENDER_LOOKUP_KEY_REQUIRED';
    return null;
  }
  function requireProvider(stage) {
    const reason = providerGateReason(stage);
    if (reason) fail('CONFLICT', reason);
  }
  function providerFailure(stage, error, fallback) {
    const message = typeof error?.message === 'string' ? error.message : '';
    const configuredReason = providerGateReason(stage);
    if (configuredReason) return configuredReason;
    if (/NEAR Intents provider is disabled/i.test(message)) return 'CFO_PROVIDER_DISABLED';
    if (['quote', 'generate', 'submit', 'status', 'reconcile'].includes(stage) && /API key is required/i.test(message)) return 'CFO_PARTNER_KEY_REQUIRED';
    if (stage === 'reconcile' && /NearBlocks|sender lookup/i.test(message)) return 'CFO_SENDER_LOOKUP_KEY_REQUIRED';
    return safeReason(error, fallback);
  }
  async function databaseNow(owner) { return store.clock(owner); }
  async function latestMandate(owner, wallet) {
    const record = await store.latest(owner, 'mandate');
    if (record && record.data.wallet !== wallet) fail('STORAGE_UNAVAILABLE', 'Retained CFO mandate owner binding is invalid.');
    return record;
  }
  async function latestPortfolio(owner, wallet) {
    const record = await store.latest(owner, 'portfolio');
    if (record && record.data.wallet !== wallet) fail('STORAGE_UNAVAILABLE', 'Retained CFO portfolio owner binding is invalid.');
    return record;
  }
  async function recordPortfolio(owner, wallet, requestId, { idempotent = true } = {}) {
    const existing = idempotent ? await store.byRequest(owner, requestId) : null;
    if (existing) {
      if (existing.kind !== 'portfolio' || existing.data.wallet !== wallet) conflict('CFO capture request ID is already bound to different content.');
      return existing;
    }
    let at = await databaseNow(owner);
    let portfolio;
    try {
      requireProvider('capture');
      portfolio = await adapter.capturePortfolio(wallet);
      if (!validPortfolio(portfolio, wallet)) throw new MeshError('STORAGE_UNAVAILABLE', 'NEAR Intents returned an invalid owner portfolio.');
      portfolio = cloneJson(portfolio, 96 * 1024);
    } catch (error) {
      at = await databaseNow(owner);
      portfolio = noDataPortfolio(wallet, at, providerFailure('capture', error, 'PORTFOLIO_UNAVAILABLE'));
    }
    try {
      const saved = await store.append(owner, { requestId, kind: 'portfolio', data: portfolio });
      return saved.record;
    } catch (error) {
      if (error instanceof MeshError && error.code === 'CONFLICT') {
        const winner = await store.byRequest(owner, requestId);
        if (winner?.kind === 'portfolio' && winner.data.wallet === wallet) return winner;
      }
      throw error;
    }
  }
  async function providerAssets() {
    requireProvider('assets');
    const assets = await adapter.assets();
    if (!Array.isArray(assets) || assets.length < 1 || assets.length > 16) throw new MeshError('STORAGE_UNAVAILABLE', 'NEAR Intents runtime asset listing is unavailable or invalid.');
    return assets;
  }
  function ageFresh(capturedAt, at, maxAgeSeconds) {
    const age = Date.parse(at) - Date.parse(capturedAt);
    return age >= 0 && age <= maxAgeSeconds * 1000;
  }
  function validateSnapshotForUse(plan, mandateRecord, portfolioRecord, at) {
    const data = plan.data;
    if (data.wallet !== portfolioRecord.data.wallet || data.wallet !== mandateRecord.data.wallet
        || data.snapshotHash !== snapshotHash(data.snapshot) || stableStringify(data.snapshot.mandate) !== stableStringify(mandateRecord.data)
        || !ageFresh(portfolioRecord.data.capturedAt, at, mandateRecord.data.maxEvidenceAgeSeconds)) conflict('CFO plan evidence or mandate is stale; create a fresh plan.');
    if (data.snapshot.status !== 'REVIEW' || !data.snapshot.proposal) conflict('CFO deterministic policy did not approve preparation.');
    for (const quote of data.snapshot.quotes) {
      if (!verifyQuoteEnvelope(quote) || !quoteEvidenceFresh(quote, at, mandateRecord.data.maxEvidenceAgeSeconds)
          || quoteDeadline(quote) === null || quoteDeadline(quote) <= Date.parse(at)) conflict('A retained executable quote is stale or expired; create a fresh plan.');
    }
  }
  async function actionEvidenceCurrent(owner, action, at) {
    const [mandateRecord, portfolioRecord] = await Promise.all([
      store.latest(owner, 'mandate'),
      store.latest(owner, 'portfolio'),
    ]);
    return Boolean(mandateRecord && portfolioRecord
      && mandateRecord.id === action.data.mandateId
      && portfolioRecord.id === action.data.portfolioId
      && mandateRecord.data.wallet === action.data.wallet
      && portfolioRecord.data.wallet === action.data.wallet
      && portfolioRecord.data.status === 'OBSERVED'
      && ageFresh(portfolioRecord.data.capturedAt, at, mandateRecord.data.maxEvidenceAgeSeconds)
      && quoteEvidenceFresh(action.data.quote, at, mandateRecord.data.maxEvidenceAgeSeconds)
      && quoteDeadline(action.data.quote) !== null && quoteDeadline(action.data.quote) > Date.parse(at));
  }
  async function evidenceRecords(owner, plan) {
    const refs = plan.data.sourceRefs;
    const records = await Promise.all(refs.map(ref => store.get(owner, ref.revisionId)));
    if (records.some((record, index) => !record || record.contentHash !== refs[index].sha256)) fail('STORAGE_UNAVAILABLE', 'A retained CFO source reference is missing or changed.');
    const mandateRecord = records.find(record => record.kind === 'mandate');
    const portfolioRecord = records.find(record => record.kind === 'portfolio');
    const quotesRecord = records.find(record => record.kind === 'quotes');
    if (!mandateRecord || !portfolioRecord || !quotesRecord) fail('STORAGE_UNAVAILABLE', 'Retained CFO evidence references are incomplete.');
    return { mandateRecord, portfolioRecord, quotesRecord };
  }
  async function reviewForPlan(owner, plan) {
    if (!plan.data.reviewJobId) return null;
    let current = await store.latestReview(owner, plan.data.reviewJobId);
    if (!current) return null;
    if (current.data.state === 'PENDING') {
      const at = await databaseNow(owner);
      if (Date.parse(at) >= Date.parse(current.data.deadlineAt) || Date.parse(at) >= Date.parse(current.data.leaseUntil)) {
        current = await finishUnknownReview(owner, current, plan, 'Review worker lease expired; no model call was resumed.');
      }
    }
    return current;
  }
  async function finishUnknownReview(owner, current, plan, reason) {
    if (!current || current.data.state !== 'PENDING') return current;
    const data = {
      ...current.data,
      state: 'UNKNOWN',
      phase: 'TERMINAL',
      result: reviewNoData(current.data.jobId, current.data.snapshotHash, reason),
      leaseUntil: null,
      workerId: null,
    };
    try {
      const result = await store.append(owner, {
        requestId: randomUUID(), kind: 'review', data, expectedHeadId: current.id,
      });
      return result.record;
    } catch (error) {
      if (error instanceof MeshError && error.code === 'CONFLICT') return store.latestReview(owner, current.data.jobId);
      throw error;
    }
  }
  async function updateReview(owner, jobId, workerId, updater) {
    let current = await store.latestReview(owner, jobId);
    if (!current || current.data.state !== 'PENDING' || current.data.workerId !== workerId) return null;
    const at = await databaseNow(owner);
    if (Date.parse(at) >= Date.parse(current.data.deadlineAt)) return finishUnknownReview(owner, current, { data: { reviewJobId: jobId } }, 'Review exceeded its database-clock deadline.');
    const data = updater({ ...current.data }, at);
    try {
      return (await store.append(owner, { requestId: randomUUID(), kind: 'review', data, expectedHeadId: current.id })).record;
    } catch (error) {
      if (error instanceof MeshError && error.code === 'CONFLICT') return null;
      throw error;
    }
  }
  function transportForReview(owner, jobId, entry) {
    if (!reviewTransport || typeof reviewTransport.preflight !== 'function' || typeof reviewTransport.call !== 'function') return null;
    return {
      async preflight({ auditRequest } = {}) {
        if (closing || entry.stopped || entry.timedOut) throw new Error('Review worker is no longer active.');
        await updateReview(owner, jobId, entry.workerId, (data, at) => ({ ...data, phase: 'PREFLIGHT', leaseUntil: addMilliseconds(at, REVIEW_LEASE_MS) }));
        entry.reviewAt = await databaseNow(owner);
        const response = await reviewTransport.preflight({ auditRequest, signal: entry.controller.signal, budgetMs: MAX_REVIEW_MS });
        entry.reviewAt = await databaseNow(owner);
        return response;
      },
      async call(request) {
        if (closing || entry.stopped || entry.timedOut) throw new Error('Review worker is no longer active.');
        const phase = request?.role === 'risk' ? 'RISK' : 'LEAD';
        await updateReview(owner, jobId, entry.workerId, (data, at) => ({ ...data, phase, leaseUntil: addMilliseconds(at, REVIEW_LEASE_MS) }));
        entry.reviewAt = await databaseNow(owner);
        const response = await reviewTransport.call(request, { signal: entry.controller.signal, budgetMs: MAX_REVIEW_MS });
        entry.reviewAt = await databaseNow(owner);
        return response;
      },
    };
  }
  async function runReviewWorker(owner, plan, reviewRecord) {
    if (closing) {
      await finishUnknownReview(owner, reviewRecord, plan, REVIEW_CLOSE_REASON);
      return;
    }
    const jobId = reviewRecord.data.jobId;
    const workerId = reviewRecord.data.workerId;
    const entry = { owner, plan, reviewRecord, jobId, workerId, controller: new AbortController(), timer: null, heartbeat: null, timedOut: false, stopped: false, reviewAt: await databaseNow(owner) };
    activeReviews.set(jobId, entry);
    entry.heartbeat = setInterval(() => {
      if (entry.stopped || closing) return;
      void updateReview(owner, jobId, workerId, (data, at) => ({ ...data, leaseUntil: addMilliseconds(at, REVIEW_LEASE_MS) })).catch(() => undefined);
    }, REVIEW_HEARTBEAT_MS);
    entry.heartbeat.unref?.();
    const transport = transportForReview(owner, jobId, entry);
    let resolveTimeout;
    const deadline = new Promise(resolve => { resolveTimeout = resolve; });
    entry.timer = setTimeout(() => {
      entry.timedOut = true;
      entry.controller.abort();
      resolveTimeout(null);
    }, MAX_REVIEW_MS);
    entry.timer.unref?.();
    const resultPromise = Promise.resolve().then(() => review({
      runId: jobId,
      snapshot: plan.data.snapshot,
      snapshotHash: plan.data.snapshotHash,
      sourceRefs: plan.data.sourceRefs,
      transport,
      now: () => entry.reviewAt,
    })).catch(() => null);
    try {
      const result = await Promise.race([resultPromise, deadline]);
      let accepted = result && validReviewResult(result, plan) ? cloneJson(result, 64 * 1024) : null;
      if (entry.timedOut || closing || entry.stopped || !accepted) accepted = reviewNoData(jobId, plan.data.snapshotHash, closing ? REVIEW_CLOSE_REASON : 'Review timed out or failed strict result binding.');
      await finishReview(owner, plan, reviewRecord, entry, accepted);
    } finally {
      entry.stopped = true;
      clearInterval(entry.heartbeat);
      clearTimeout(entry.timer);
      activeReviews.delete(jobId);
    }
  }
  async function finishReview(owner, plan, initialRecord, entry, result) {
    const latest = await store.latestReview(owner, initialRecord.data.jobId);
    if (!latest || latest.data.state !== 'PENDING' || latest.data.workerId !== entry.workerId) return latest;
    const state = result.status === 'NO_DATA' ? 'UNKNOWN' : 'COMPLETE';
    const data = { ...latest.data, state, phase: 'TERMINAL', result, leaseUntil: null, workerId: null };
    try {
      return (await store.append(owner, { requestId: randomUUID(), kind: 'review', data, expectedHeadId: latest.id })).record;
    } catch (error) {
      if (error instanceof MeshError && error.code === 'CONFLICT') return store.latestReview(owner, initialRecord.data.jobId);
      throw error;
    }
  }
  async function beginReview(owner, wallet, plan, { allowStart = false } = {}) {
    const jobId = plan.data.reviewJobId;
    const nowText = await databaseNow(owner);
    const existing = await store.latestReview(owner, jobId);
    if (existing) {
      if (existing.data.state === 'PENDING' && Date.parse(existing.data.leaseUntil) <= Date.parse(nowText)) {
        return finishUnknownReview(owner, existing, plan, 'Review worker was unavailable after its retained lease; no model call was resumed.');
      }
      return existing;
    }
    if (!allowStart || !reviewerOwners.has(owner)) {
      const reason = allowStart
        ? 'No trusted Lead/Risk reviewer grant is configured for this owner.'
        : 'No retained Lead/Risk review claim exists; a review was not dispatched again.';
      const data = {
        schemaVersion: 1, wallet, jobId, planId: plan.id, snapshotHash: plan.data.snapshotHash,
        state: 'UNKNOWN', phase: 'TERMINAL', result: reviewNoData(jobId, plan.data.snapshotHash, reason),
        deadlineAt: addMilliseconds(nowText, MAX_REVIEW_MS), leaseUntil: null, workerId: null, sourceRefs: plan.data.sourceRefs,
      };
      return (await store.append(owner, { requestId: jobId, kind: 'review', data })).record;
    }
    const workerId = serviceId;
    const pending = {
      schemaVersion: 1, wallet, jobId, planId: plan.id, snapshotHash: plan.data.snapshotHash,
      state: 'PENDING', phase: 'PREFLIGHT', result: null,
      deadlineAt: addMilliseconds(nowText, MAX_REVIEW_MS), leaseUntil: addMilliseconds(nowText, REVIEW_LEASE_MS),
      workerId, sourceRefs: plan.data.sourceRefs,
    };
    const claim = await store.append(owner, { requestId: jobId, kind: 'review', data: pending });
    if (claim.inserted) setImmediate(() => {
      if (closing) void finishUnknownReview(owner, claim.record, plan, REVIEW_CLOSE_REASON).catch(() => undefined);
      else void runReviewWorker(owner, plan, claim.record).catch(() => undefined);
    });
    return claim.record;
  }
  async function checkReviewForUse(owner, plan) {
    if (!plan.data.reviewJobId) return null;
    let reviewRecord = await reviewForPlan(owner, plan);
    if (!reviewRecord) {
      reviewRecord = await beginReview(owner, plan.data.wallet, plan);
      if (reviewRecord.data.state === 'PENDING' && !activeReviews.has(reviewRecord.data.jobId)) {
        // A retained claim without a local worker is never replayed after a process boundary.
        const nowText = await databaseNow(owner);
        if (Date.parse(reviewRecord.data.leaseUntil) <= Date.parse(nowText)) reviewRecord = await finishUnknownReview(owner, reviewRecord, plan, 'Review worker was unavailable after restart; no model call was resumed.');
      }
    }
    return reviewRecord;
  }


  async function quotePlan({ owner, wallet, request, mandate, portfolio, at }) {
    let runtimeAssets = null;
    const envelopes = [];
    const bindings = [];
    const errors = [];
    const byKey = new Map();
    const deadline = new Date(Math.min(
      Date.parse(at) + MAX_REVIEW_MS + 120_000,
      Date.parse(portfolio.capturedAt) + mandate.maxEvidenceAgeSeconds * 1000,
    )).toISOString();
    const receiptAssets = portfolio.assets.filter(asset => asset.kind === 'receipt').sort((a, b) => a.assetId.localeCompare(b.assetId));
    const runtimeById = new Map();
    try {
      runtimeAssets = await providerAssets();
      for (const asset of runtimeAssets) {
        if (!isRecord(asset) || typeof asset.assetId !== 'string' || runtimeById.has(asset.assetId)) throw new MeshError('STORAGE_UNAVAILABLE', 'NEAR Intents runtime asset registry is invalid.');
        runtimeById.set(asset.assetId, asset);
      }
      const normalized = validateMandate(mandate, runtimeAssets, wallet);
      if (stableStringify(normalized) !== stableStringify(mandate)) throw new MeshError('CONFLICT', 'Saved mandate no longer matches the runtime asset registry.');
    } catch (error) {
      errors.push(providerFailure('assets', error, 'ASSET_REGISTRY_UNAVAILABLE'));
      runtimeAssets = null;
    }
    async function addQuote(sourceAssetId, targetAssetId, amount, role) {
      const exactAmount = units(amount, 'Quote input', { positive: true }).toString();
      const key = sourceAssetId + '\0' + targetAssetId + '\0' + exactAmount;
      let quote = byKey.get(key);
      if (!quote) {
        if (!runtimeById.has(sourceAssetId) || !runtimeById.has(targetAssetId)) {
          errors.push('QUOTE_ASSET_NOT_RUNTIME_LISTED');
          return null;
        }
        try {
          requireProvider('quote');
          quote = await adapter.quote({
            signerId: portfolio.signerId,
            originAsset: sourceAssetId,
            destinationAsset: targetAssetId,
            amount: exactAmount,
            slippageBps: mandate.slippageBps,
            dry: false,
            deadline,
          });
          if (!verifyQuoteEnvelope(quote) || quote.raw.quoteRequest.originAsset !== sourceAssetId
              || quote.raw.quoteRequest.destinationAsset !== targetAssetId || quote.raw.quoteRequest.amount !== exactAmount) {
            throw new MeshError('STORAGE_UNAVAILABLE', 'NEAR Intents returned an invalid exact-action quote.');
          }
          byKey.set(key, quote);
          envelopes.push(quote);
        } catch (error) {
          errors.push(providerFailure('quote', error, 'QUOTE_UNAVAILABLE'));
          return null;
        }
      }
      bindings.push({ role, quoteHash: quote.sha256, sourceAssetId, targetAssetId, inputBaseUnits: exactAmount });
      return quote;
    }
    if (!['redeem', 'rotate'].includes(request.action)) {
      for (const asset of receiptAssets) {
        const held = balanceOf(portfolio, asset.assetId);
        if (BigInt(held) > 0n) await addQuote(asset.assetId, mandate.reserveAssetId, held, 'VALUATION');
      }
    }
    const firstAt = await databaseNow(owner);
    let evaluation = evaluatePlan({ portfolio, mandate, request, quotes: envelopes, at: firstAt });
    let actionProposal = evaluation.proposal;
    if (!actionProposal && request.action !== 'hold' && request.sourceAssetId !== null
        && request.targetAssetId !== null && request.inputBaseUnits !== null) {
      actionProposal = {
        action: request.action,
        sourceAssetId: request.action === 'invest' || request.action === 'reinvest' ? mandate.reserveAssetId : request.sourceAssetId,
        targetAssetId: request.targetAssetId,
        inputBaseUnits: request.inputBaseUnits,
        reason: '',
        expiresAt: deadline,
      };
    }
    if (actionProposal && request.action !== 'hold') {
      const actionTargetAssetId = request.action === 'redeem' || request.action === 'rotate'
        ? mandate.reserveAssetId : actionProposal.targetAssetId;
      const actionQuote = await addQuote(actionProposal.sourceAssetId, actionTargetAssetId, actionProposal.inputBaseUnits, 'ACTION');
      if (actionQuote && (request.action === 'invest' || request.action === 'reinvest')) {
        const minReceiptUnits = units(actionQuote.raw.quote.minAmountOut, 'Minimum quoted receipt units', { positive: true });
        await addQuote(actionProposal.targetAssetId, mandate.reserveAssetId, minReceiptUnits.toString(), 'ROUNDTRIP_EXIT');
        const projectedUnits = BigInt(balanceOf(portfolio, actionProposal.targetAssetId)) + minReceiptUnits;
        if (projectedUnits > 0n) await addQuote(actionProposal.targetAssetId, mandate.reserveAssetId, projectedUnits.toString(), 'PROJECTED_EXIT');
      }
    }
    const finalAt = await databaseNow(owner);
    evaluation = evaluatePlan({ portfolio, mandate, request, quotes: envelopes, at: finalAt });
    if (errors.length) {
      const reasons = [...evaluation.reasons, ...errors].slice(0, 32);
      evaluation = { ...evaluation, status: 'NO_DATA', proposal: evaluation.proposal, reasons };
    }
    return { evaluation, quotes: envelopes, quoteBindings: bindings, at: finalAt };
  }

  async function returnPlan(owner, record) {
    const job = await reviewForPlan(owner, record);
    const review = job ? reviewJobDto(job, record) : null;
    if (record.data.reviewJobId && !job && record.data.status === 'REVIEW') {
      const recovered = await beginReview(owner, record.data.wallet, record);
      return { plan: { ...publicRecord(record), review: reviewJobDto(recovered, record) }, review: reviewJobDto(recovered, record) };
    }
    return { plan: { ...publicRecord(record), review }, review };
  }

  const service = {
    async overview(owner, wallet) {
      const canonicalWallet = identity(owner, wallet);
      const at = await databaseNow(owner);
      const [mandate, portfolio, monitorRecord, plans, retainedActions] = await Promise.all([
        latestMandate(owner, canonicalWallet),
        latestPortfolio(owner, canonicalWallet),
        store.latest(owner, 'monitor'),
        store.list(owner, { kind: 'plan', limit: 20 }),
        store.list(owner, { kind: 'action', limit: 20 }),
      ]);
      let actions = retainedActions;
      const actionHeads = new Map();
      for (const record of actions) {
        if (!actionHeads.has(record.data.actionId)) actionHeads.set(record.data.actionId, record);
      }
      const unresolved = [...actionHeads.values()].find(record => !['CONFIRMED', 'REFUNDED', 'FAILED'].includes(record.data.status));
      if (['EXIT_CONFIRMED', 'AWAITING_NEXT_LEG'].includes(unresolved?.data.status)) {
        const recovered = await closeBlockedRotation(owner, canonicalWallet, unresolved);
        if (recovered.id !== unresolved.id) {
          actions = [recovered, ...actions].slice(0, 20);
          actionHeads.set(recovered.data.actionId, recovered);
        }
      }
      if (unresolved && ['PREPARING', 'PREPARED', 'NEXT_LEG_READY'].includes(unresolved.data.status)) {
        const recovered = await expireUnsignedPreparation(owner, unresolved, at);
        if (recovered.id !== unresolved.id) {
          actions = [recovered, ...actions].slice(0, 20);
          actionHeads.set(recovered.data.actionId, recovered);
        }
      }
      const hydratedPlans = [];
      for (const plan of plans) {
        const job = await reviewForPlan(owner, plan);
        hydratedPlans.push({ ...publicRecord(plan), review: job ? reviewJobDto(job, plan) : null });
      }
      const latestAction = [...actionHeads.values()].find(record => !['CONFIRMED', 'REFUNDED', 'FAILED'].includes(record.data.status)) ?? actions[0] ?? null;
      const openAction = latestAction && !['CONFIRMED', 'REFUNDED', 'FAILED'].includes(latestAction.data.status);
      const monitorData = monitorRecord?.data;
      const monitorLeaseValid = Boolean(monitorData?.enabled
        && monitorData.leaseUntil && Date.parse(monitorData.leaseUntil) > Date.parse(at));
      const localMonitorLive = monitorLeaseValid && monitorData.processId === serviceId && activeMonitors.has(owner);
      const monitor = monitorData ? {
        enabled: monitorLeaseValid,
        cyclesCompleted: monitorData.cyclesCompleted,
        maxCycles: monitorData.maxCycles,
        nextRunAt: monitorLeaseValid ? monitorData.nextRunAt : null,
        status: localMonitorLive ? 'RUNNING' : monitorData.enabled ? 'UNKNOWN' : monitorData.status,
      } : { enabled: false, cyclesCompleted: 0, maxCycles: 0, nextRunAt: null, status: 'STOPPED' };
      monitor.alerts = [];
      if (mandate && portfolio) {
        const reserve = portfolio.data.balances.find(balance => balance.assetId === mandate.data.reserveAssetId);
        if (portfolio.data.status !== 'OBSERVED' || !reserve
            || !ageFresh(portfolio.data.capturedAt, at, mandate.data.maxEvidenceAgeSeconds)) {
          monitor.alerts.push({ code: 'PORTFOLIO_CHECK_UNAVAILABLE', portfolioId: portfolio.id, mandateId: mandate.id });
        } else if (BigInt(reserve.balanceBaseUnits) < BigInt(mandate.data.reserveFloorBaseUnits)) {
          monitor.alerts.push({ code: 'RESERVE_BELOW_FLOOR', portfolioId: portfolio.id, mandateId: mandate.id });
        }
      }
      const reasons = [];
      if (providerConfig.enabled === false) reasons.push('CFO_PROVIDER_DISABLED');
      if (providerConfig.partnerKeyConfigured === false) reasons.push('CFO_PARTNER_KEY_REQUIRED');
      if (providerConfig.senderLookupKeyConfigured === false) reasons.push('CFO_SENDER_LOOKUP_KEY_REQUIRED');
      let readinessStatus = 'NO_DATA';
      if (!mandate) reasons.push('MANDATE_NOT_SAVED');
      if (!portfolio || portfolio.data.status !== 'OBSERVED') reasons.push('PORTFOLIO_CAPTURE_REQUIRED');
      else if (!mandate || !ageFresh(portfolio.data.capturedAt, at, mandate.data.maxEvidenceAgeSeconds)) reasons.push('PORTFOLIO_STALE');
      if (!reviewerOwners.has(owner)) reasons.push('LEAD_RISK_REVIEW_GRANT_REQUIRED');
      if (!grants.some(grant => grant.ownerId === owner && grant.wallet === canonicalWallet)
          || !trials.some(trial => trial.ownerId === owner && trial.wallet === canonicalWallet)) reasons.push('T82_PROOF_UNVERIFIED');
      if (openAction) {
        readinessStatus = 'BLOCKED';
        reasons.push(latestAction.data.status === 'SUBMISSION_UNKNOWN' ? 'SUBMISSION_UNKNOWN_FUNDS_REMAIN_RESERVED' : 'OPEN_ACTION_REMAINS_RESERVED');
      } else if (reasons.some(reason => [
        'T82_PROOF_UNVERIFIED', 'LEAD_RISK_REVIEW_GRANT_REQUIRED', 'CFO_PROVIDER_DISABLED',
        'CFO_PARTNER_KEY_REQUIRED', 'CFO_SENDER_LOOKUP_KEY_REQUIRED',
      ].includes(reason))) readinessStatus = 'BLOCKED';
      else if (reasons.length === 0) {
        readinessStatus = 'NO_DATA';
        reasons.push('READINESS_REQUIRES_A_FRESH_EXPLICIT_PLAN_AND_VERIFIED_PROVIDER_QUOTE');
      }
      return cloneJson({
        schemaVersion: 1,
        mandate: publicRecord(mandate),
        portfolio: publicRecord(portfolio),
        plans: hydratedPlans,
        actions: actions.map(publicRecord),
        monitor,
        readiness: { status: readinessStatus, reasons: reasons.slice(0, 16) },
      });
    },

    async getRecord(owner, wallet, recordId) {
      const canonicalWallet = identity(owner, wallet);
      const record = await store.get(owner, uuid(recordId, 'Record ID'));
      if (!record || record.data.wallet !== canonicalWallet) fail('NOT_FOUND', 'CFO record was not found.');
      return publicRecord(record);
    },

    async saveMandate(owner, wallet, input) {
      const canonicalWallet = identity(owner, wallet);
      exact(input, ['requestId', 'mandate'], 'CFO mandate request');
      const requestId = uuid(input.requestId, 'Request ID');
      const existing = await store.byRequest(owner, requestId);
      if (existing) {
        if (existing.kind !== 'mandate' || !sameRequest(existing.data, input.mandate)) conflict('CFO request ID is already bound to another mandate.');
        return publicRecord(existing);
      }
      const listed = await providerAssets();
      const mandate = validateMandate(input.mandate, listed, canonicalWallet);
      const saved = await store.append(owner, { requestId, kind: 'mandate', data: cloneJson(mandate, 16 * 1024) });
      return publicRecord(saved.record);
    },

    async capturePortfolio(owner, wallet, input) {
      const canonicalWallet = identity(owner, wallet);
      exact(input, ['requestId'], 'CFO portfolio capture request');
      const record = await recordPortfolio(owner, canonicalWallet, uuid(input.requestId, 'Request ID'));
      return publicRecord(record);
    },

    async planCycle(owner, wallet, input) {
      const canonicalWallet = identity(owner, wallet);
      const request = validatePlanInput(input);
      const existing = await store.byRequest(owner, request.requestId);
      if (existing) {
        if (existing.kind !== 'plan' || !sameRequest(existing.data.request, request)) conflict('CFO plan request ID is already bound to different content.');
        return returnPlan(owner, existing);
      }
      const [mandateRecord, portfolioRecord] = await Promise.all([latestMandate(owner, canonicalWallet), latestPortfolio(owner, canonicalWallet)]);
      if (!mandateRecord) conflict('Save an explicit CFO mandate before planning.');
      if (!portfolioRecord || portfolioRecord.data.status !== 'OBSERVED') conflict('Capture a verified current portfolio before planning.');
      const mandate = mandateRecord.data;
      const portfolio = portfolioRecord.data;
      const at = await databaseNow(owner);
      if (!ageFresh(portfolio.capturedAt, at, mandate.maxEvidenceAgeSeconds)) conflict('Portfolio evidence is stale; capture a fresh portfolio before planning.');
      const { evaluation, quotes, quoteBindings, at: evaluatedAt } = await quotePlan({ owner, wallet: canonicalWallet, request, mandate, portfolio, at });
      const quoteSet = await store.append(owner, {
        requestId: randomUUID(),
        kind: 'quotes',
        data: { schemaVersion: 1, wallet: canonicalWallet, quotes: cloneJson(quotes, 96 * 1024) },
      });
      const sourceRefs = [sourceRef(mandateRecord), sourceRef(portfolioRecord), sourceRef(quoteSet.record)];
      if (new Set(sourceRefs.map(ref => ref.revisionId)).size !== sourceRefs.length) fail('STORAGE_UNAVAILABLE', 'CFO source references are not unique.');
      const snapshot = {
        schemaVersion: 1,
        domain: 'cfo',
        capturedAt: evaluatedAt,
        portfolio,
        mandate,
        mandateHash: sha256(canonicalBytes(mandate)),
        request,
        quotes,
        proposal: evaluation.proposal,
        checks: evaluation.checks,
        reasons: evaluation.reasons,
        status: evaluation.status,
      };
      const hash = snapshotHash(snapshot);
      const reviewJobId = evaluation.status === 'REVIEW' && REVIEW_ACTIONS.has(request.action) ? randomUUID() : null;
      const workflow = request.action === 'rotate' ? 'ROTATION_EXIT' : request.action === 'reinvest' ? 'ROTATION_ENTRY' : 'SINGLE';
      const data = {
        schemaVersion: 1, wallet: canonicalWallet, request, snapshot, snapshotHash: hash,
        sourceRefs, quoteBindings, status: snapshot.status, reviewJobId, workflow,
      };
      let appended;
      try { appended = await store.append(owner, { requestId: request.requestId, kind: 'plan', data }); }
      catch (error) {
        if (error instanceof MeshError && error.code === 'CONFLICT') {
          const winner = await store.byRequest(owner, request.requestId);
          if (winner?.kind === 'plan' && sameRequest(winner.data.request, request)) return returnPlan(owner, winner);
        }
        throw error;
      }
      let plan = appended.record;
      if (reviewJobId && appended.inserted) {
        const job = await beginReview(owner, canonicalWallet, plan, { allowStart: true });
        if (job.data.state === 'PENDING') return { plan: { ...publicRecord(plan), review: reviewJobDto(job, plan) }, review: reviewJobDto(job, plan) };
        return { plan: { ...publicRecord(plan), review: reviewJobDto(job, plan) }, review: reviewJobDto(job, plan) };
      }
      return returnPlan(owner, plan);
    },

    async prepareAction(owner, wallet, input) {
      const canonicalWallet = identity(owner, wallet);
      exact(input, ['requestId', 'planId'], 'CFO prepare request');
      const requestId = uuid(input.requestId, 'Request ID');
      const planId = uuid(input.planId, 'Plan ID');
      const prior = await store.byRequest(owner, requestId);
      if (prior) {
        if (prior.kind !== 'action' || prior.data.createdFromRequestId !== requestId || prior.data.wallet !== canonicalWallet) conflict('CFO prepare request ID is already bound to another action.');
        const retained = await store.actionByRequest(owner, prior.data.actionId, requestId);
        const at = await databaseNow(owner);
        if (retained?.data.payload && retained.data.standard === 'raw_ed25519') {
          const current = await store.latestAction(owner, prior.data.actionId);
          if (!['PREPARED', 'NEXT_LEG_READY'].includes(retained.data.status)
              || !['PREPARED', 'NEXT_LEG_READY'].includes(current?.data.status)
              || retained.data.planId !== planId || !await actionEvidenceCurrent(owner, retained, at)
              || (['PREPARING', 'PREPARED', 'NEXT_LEG_READY'].includes(current?.data.status)
                && (await expireUnsignedPreparation(owner, current, at)).data.status === 'FAILED')) {
            conflict('The retained unsigned payload is stale or expired; it cannot be returned for another action.');
          }
          return { actionId: retained.data.actionId, standard: retained.data.standard, payload: retained.data.payload, expiresAt: retained.data.quote.raw.quote.deadline };
        }
        const current = await store.latestAction(owner, prior.data.actionId);
        if (current?.data.status === 'PREPARING') await expireUnsignedPreparation(owner, current, at);
        conflict('The retained preparation did not finish with an unsigned payload.');
      }
      const plan = await store.get(owner, planId);
      if (!plan || plan.kind !== 'plan' || plan.data.wallet !== canonicalWallet) fail('NOT_FOUND', 'CFO plan was not found.');
      const existingActions = (await store.list(owner, { kind: 'action' })).filter(record => record.data.planId === planId);
      let currentAction = existingActions[0] ?? null;
      if (currentAction) currentAction = await store.latestAction(owner, currentAction.data.actionId);
      let activePlan = plan;
      let leg = 0;
      if (currentAction?.data.status === 'PREPARING') {
        currentAction = await expireUnsignedPreparation(owner, currentAction, await databaseNow(owner));
        if (currentAction?.data.status === 'PREPARING') conflict('CFO intent generation is still in progress.');
      }
      if (currentAction && (currentAction.data.status === 'PREPARED' || currentAction.data.status === 'NEXT_LEG_READY')) {
        currentAction = await expireUnsignedPreparation(owner, currentAction, await databaseNow(owner));
        if (currentAction.data.status === 'FAILED') {
          if (currentAction.data.leg === 0 && currentAction.data.signatureBase64 === null
              && currentAction.data.signedData === null && currentAction.data.intentHash === null) currentAction = null;
          else conflict('The unsigned rotation entry expired; its confirmed proceeds remain available for a new explicit plan.');
        }
        if (currentAction) {
          const data = { ...currentAction.data, createdFromRequestId: requestId, preparationLeaseUntil: null };
          const recorded = await store.append(owner, {
            requestId, kind: 'action', data, expectedHeadId: currentAction.id,
            expectedMandateId: currentAction.data.mandateId, expectedPortfolioId: currentAction.data.portfolioId,
          });
          const action = recorded.record.data;
          return { actionId: action.actionId, standard: action.standard, payload: action.payload, expiresAt: action.quote.raw.quote.deadline };
        }
      }
      if (currentAction?.data.status === 'FAILED' && currentAction.data.signatureBase64 === null
          && currentAction.data.signedData === null && currentAction.data.intentHash === null) currentAction = null;
      if (currentAction) {
        if (currentAction.data.status !== 'AWAITING_NEXT_LEG') conflict('CFO action is not ready for another owner-approved leg.');
        const claim = await store.append(owner, {
          requestId, kind: 'action', expectedHeadId: currentAction.id,
          data: { ...currentAction.data, createdFromRequestId: requestId, preparationLeaseUntil: null },
        });
        if (!claim.inserted) {
          const retained = await store.actionByRequest(owner, currentAction.data.actionId, requestId);
          if (retained?.data.payload && retained.data.standard === 'raw_ed25519') {
            return { actionId: retained.data.actionId, standard: retained.data.standard, payload: retained.data.payload, expiresAt: retained.data.quote.raw.quote.deadline };
          }
          conflict('Rotation entry preparation is already in progress.');
        }
        currentAction = claim.record;
        let childPlan = currentAction.data.nextPlanId ? await store.get(owner, currentAction.data.nextPlanId) : null;
        let childReview = childPlan?.kind === 'plan' ? await checkReviewForUse(owner, childPlan) : null;
        currentAction = await closeBlockedRotation(owner, canonicalWallet, currentAction);
        if (currentAction.data.status === 'FAILED') conflict('The exit is confirmed, but this rotation entry is closed. Create a new explicit plan for the settled reserve.');
        if (!childPlan || childPlan.kind !== 'plan' || childPlan.data.status !== 'REVIEW') conflict('Confirmed settled funds still require fresh portfolio and deterministic entry evidence.');
        if (!reviewPass(childReview)) conflict('A bound Lead/Risk PASS is required before the rotation entry.');
        activePlan = childPlan;
        leg = 1;
      }
      const job = await checkReviewForUse(owner, activePlan);
      if (activePlan.data.status !== 'REVIEW' || !activePlan.data.snapshot.proposal
          || (REVIEW_ACTIONS.has(activePlan.data.request.action) && !reviewPass(job))) conflict('A bound Lead/Risk PASS is required before a new buy.');
      const { mandateRecord, portfolioRecord } = await evidenceRecords(owner, activePlan);
      const at = await databaseNow(owner);
      validateSnapshotForUse(activePlan, mandateRecord, portfolioRecord, at);
      if (currentAction && activePlan.data.workflow !== 'ROTATION_ENTRY') conflict('Rotation entry plan is not bound to the retained rotation.');
      const evaluation = evaluatePlan({
        portfolio: activePlan.data.snapshot.portfolio,
        mandate: mandateRecord.data,
        request: activePlan.data.request,
        quotes: activePlan.data.snapshot.quotes,
        at,
      });
      if (evaluation.status !== 'REVIEW' || !evaluation.proposal
          || stableStringify(evaluation.proposal) !== stableStringify(activePlan.data.snapshot.proposal)) conflict('Deterministic policy changed since review; create a fresh plan and Lead/Risk approval.');
      const quoteBinding = activePlan.data.quoteBindings.find(binding => binding.role === 'ACTION'
        && quoteMatches(activePlan.data.snapshot.quotes.find(quote => quote.sha256 === binding.quoteHash), binding, evaluation.proposal, mandateRecord.data.reserveAssetId));
      const quote = quoteBinding && activePlan.data.snapshot.quotes.find(item => item.sha256 === quoteBinding.quoteHash);
      if (!quote || quoteDeadline(quote) <= Date.parse(at)) conflict('The action quote expired; create a fresh plan.');
      requireProvider('generate');
      const actionId = currentAction?.data.actionId ?? randomUUID();
      const beforeReserveBaseUnits = balanceOf(portfolioRecord.data, mandateRecord.data.reserveAssetId);
      const preparationLeaseUntil = addMilliseconds(await databaseNow(owner), ACTION_PREPARATION_LEASE_MS);
      const executionTargetAssetId = ['redeem', 'rotate'].includes(evaluation.proposal.action)
        ? mandateRecord.data.reserveAssetId : evaluation.proposal.targetAssetId;
      let actionData;
      if (!currentAction) {
        actionData = {
          schemaVersion: 1, wallet: canonicalWallet, actionId, action: activePlan.data.request.action, planId: plan.id,
          mandateId: mandateRecord.id, leg: 0, status: 'PREPARING', rotationState: activePlan.data.request.action === 'rotate' ? 'IN_PROGRESS' : 'NONE',
          sourceAssetId: evaluation.proposal.sourceAssetId, targetAssetId: executionTargetAssetId,
          rotationTargetAssetId: activePlan.data.request.action === 'rotate' ? evaluation.proposal.targetAssetId : null,
          inputBaseUnits: evaluation.proposal.inputBaseUnits, preparationLeaseUntil, portfolioId: portfolioRecord.id, quote,
          standard: null, payload: null, signatureBase64: null, signedData: null,
          intentHash: null, correlationId: null, providerStatus: null, nearTxHashes: null, amounts: null,
          reason: null, receiptPortfolioId: null, nextPlanId: null, beforeReserveBaseUnits,
          createdFromRequestId: requestId,
        };
      } else {
        actionData = {
          ...currentAction.data,
          mandateId: mandateRecord.id,
          leg: 1,
          status: 'PREPARING',
          sourceAssetId: evaluation.proposal.sourceAssetId,
          targetAssetId: executionTargetAssetId,
          rotationTargetAssetId: currentAction.data.rotationTargetAssetId,
          inputBaseUnits: evaluation.proposal.inputBaseUnits,
          preparationLeaseUntil,
          portfolioId: portfolioRecord.id,
          quote,
          standard: null, payload: null, signatureBase64: null, signedData: null,
          intentHash: null, correlationId: null, providerStatus: null, nearTxHashes: null, amounts: null,
          reason: null, receiptPortfolioId: null, createdFromRequestId: requestId,
        };
      }
      const actionPreparationRequestId = leg === 0 ? requestId : randomUUID();
      let reserved;
      if (!currentAction) {
        reserved = await store.append(owner, {
          requestId, kind: 'action', data: actionData,
          expectedMandateId: mandateRecord.id,
          expectedPortfolioId: portfolioRecord.id,
          exclusiveAction: {
            mode: 'CREATE',
            actionId, assetId: actionData.sourceAssetId, baseUnits: actionData.inputBaseUnits,
            portfolioId: portfolioRecord.id, mandateId: mandateRecord.id,
          },
        });
      } else {
        reserved = await store.append(owner, {
          requestId: actionPreparationRequestId, kind: 'action', data: actionData, expectedHeadId: currentAction.id,
          expectedMandateId: mandateRecord.id, expectedPortfolioId: portfolioRecord.id,
          exclusiveAction: {
            mode: 'CONTINUE', actionId, assetId: actionData.sourceAssetId, baseUnits: actionData.inputBaseUnits,
            portfolioId: portfolioRecord.id, mandateId: mandateRecord.id,
          },
        });
      }
      if (!reserved.inserted) {
        const retained = await store.actionByRequest(owner, reserved.record.data.actionId, requestId);
        if (retained?.data.payload && retained.data.standard === 'raw_ed25519') {
          return { actionId: retained.data.actionId, standard: retained.data.standard, payload: retained.data.payload, expiresAt: retained.data.quote.raw.quote.deadline };
        }
        conflict('CFO unsigned intent generation is already in progress.');
      }
      let generated;
      try { generated = await adapter.generateIntent(quote, portfolioRecord.data.signerId); }
      catch (error) {
        const latest = await store.latestAction(owner, actionId);
        if (latest?.id === reserved.record.id) {
          await store.append(owner, {
            requestId: randomUUID(), kind: 'action', expectedHeadId: latest.id,
            data: { ...latest.data, status: 'FAILED', preparationLeaseUntil: null, rotationState: latest.data.action === 'rotate' ? 'INCOMPLETE' : latest.data.rotationState, reason: providerFailure('generate', error, 'INTENT_GENERATION_FAILED') },
          });
        }
        throw new MeshError('CONFLICT', providerFailure('generate', error, 'INTENT_GENERATION_FAILED'));
      }
      if (!isRecord(generated) || generated.standard !== 'raw_ed25519' || typeof generated.payload !== 'string'
          || Buffer.byteLength(generated.payload, 'utf8') > 32 * 1024) {
        const latest = await store.latestAction(owner, actionId);
        if (latest?.id === reserved.record.id) await store.append(owner, {
          requestId: randomUUID(), kind: 'action', expectedHeadId: latest.id,
          data: { ...latest.data, status: 'FAILED', preparationLeaseUntil: null, rotationState: latest.data.action === 'rotate' ? 'INCOMPLETE' : latest.data.rotationState, reason: 'GENERATED_INTENT_INVALID' },
        });
        fail('STORAGE_UNAVAILABLE', 'NEAR Intents generated an invalid unsigned payload.');
      }
      const latest = await store.latestAction(owner, actionId);
      if (!latest || latest.id !== reserved.record.id || latest.data.status !== 'PREPARING') conflict('CFO action changed while the unsigned intent was being generated.');
      const prepared = await store.append(owner, {
        requestId: randomUUID(), kind: 'action', expectedHeadId: latest.id,
        expectedMandateId: latest.data.mandateId, expectedPortfolioId: latest.data.portfolioId,
        data: { ...latest.data, status: leg === 0 ? 'PREPARED' : 'NEXT_LEG_READY', preparationLeaseUntil: null, createdFromRequestId: requestId, standard: generated.standard, payload: generated.payload },
      });
      return { actionId, standard: generated.standard, payload: generated.payload, expiresAt: quote.raw.quote.deadline };
    },

    async registerSignedAction(owner, wallet, input) {
      const canonicalWallet = identity(owner, wallet);
      exact(input, ['requestId', 'actionId', 'signatureBase64'], 'CFO signature request');
      const requestId = uuid(input.requestId, 'Request ID');
      const actionId = uuid(input.actionId, 'Action ID');
      if (typeof input.signatureBase64 !== 'string' || input.signatureBase64.length > 256) invalid('Wallet signature is invalid.');
      const previous = await store.byRequest(owner, requestId);
      if (previous) {
        if (previous.kind !== 'action' || previous.data.actionId !== actionId || previous.data.signatureBase64 !== input.signatureBase64) conflict('CFO signature request ID is already bound to different content.');
        return { actionId, status: 'SIGNED', expiresAt: previous.data.quote.raw.quote.deadline };
      }
      const current = await store.latestAction(owner, actionId);
      if (!current || current.data.wallet !== canonicalWallet) fail('NOT_FOUND', 'CFO action was not found.');
      if (!['PREPARED', 'NEXT_LEG_READY'].includes(current.data.status) || !current.data.payload || current.data.standard !== 'raw_ed25519') conflict('CFO action is not awaiting its owner signature.');
      const at = await databaseNow(owner);
      if (!await actionEvidenceCurrent(owner, current, at)) {
        await expireUnsignedPreparation(owner, current, at);
        conflict('The retained quote, portfolio, or mandate changed before owner signing.');
      }
      const intent = { standard: current.data.standard, payload: current.data.payload };
      const signedData = await adapter.validateSigned(intent, canonicalWallet, input.signatureBase64);
      if (!isRecord(signedData) || signedData.standard !== intent.standard || signedData.payload !== intent.payload) fail('UNAUTHORIZED', 'Wallet signature did not bind the retained generated intent.');
      const saved = await store.append(owner, {
        requestId, kind: 'action', expectedHeadId: current.id,
        expectedMandateId: current.data.mandateId, expectedPortfolioId: current.data.portfolioId,
        data: { ...current.data, status: 'SIGNED', signatureBase64: input.signatureBase64, signedData },
      });
      return { actionId, status: 'SIGNED', expiresAt: saved.record.data.quote.raw.quote.deadline };
    },

    async relaySignedAction(owner, wallet, input) {
      const canonicalWallet = identity(owner, wallet);
      exact(input, ['requestId', 'actionId'], 'CFO relay request');
      const requestId = uuid(input.requestId, 'Request ID');
      const actionId = uuid(input.actionId, 'Action ID');
      const prior = await store.byRequest(owner, requestId);
      if (prior) {
        if (prior.kind !== 'action' || prior.data.actionId !== actionId) conflict('CFO relay request ID is already bound to another record.');
        const current = await store.latestAction(owner, actionId);
        return actionDto(current ?? prior);
      }
      const current = await store.latestAction(owner, actionId);
      if (!current || current.data.wallet !== canonicalWallet) fail('NOT_FOUND', 'CFO action was not found.');
      if (current.data.status !== 'SIGNED') {
        if (['SUBMISSION_UNKNOWN', 'SUBMITTED', 'PENDING', 'UNVERIFIED', 'EXIT_CONFIRMED', 'AWAITING_NEXT_LEG'].includes(current.data.status)) return actionDto(current);
        conflict('CFO action is not durably signed for relay.');
      }
      const at = await databaseNow(owner);
      if (!await actionEvidenceCurrent(owner, current, at)) conflict('Signed CFO action uses a stale mandate, portfolio, or provider quote.');
      const grant = grants.find(item => item.ownerId === owner && item.wallet === canonicalWallet && Date.parse(item.expiresAt) > Date.parse(at));
      const trial = trials.find(item => item.ownerId === owner && item.wallet === canonicalWallet && item.actionId === actionId
        && item.quoteHash === current.data.quote.sha256 && item.sourceAssetId === current.data.sourceAssetId
        && item.targetAssetId === current.data.targetAssetId && item.inputBaseUnits === current.data.inputBaseUnits
        && item.devnetProofId === grant?.devnetProofId && Date.parse(item.expiresAt) > Date.parse(at));
      if (!grant || !trial) fail('UNAUTHORIZED', 'CFO execution grant and exact owner-approved trial are required.');
      const reserveAssetId = (await latestMandate(owner, canonicalWallet))?.data.reserveAssetId;
      if (!reserveAssetId) fail('STORAGE_UNAVAILABLE', 'Retained CFO mandate is missing.');
      const reserveSpend = current.data.quote.raw.quoteRequest.originAsset === reserveAssetId
        ? BigInt(current.data.quote.raw.quoteRequest.amount) : 0n;
      if (reserveSpend > BigInt(grant.maxReserveBaseUnits)) fail('UNAUTHORIZED', 'CFO action exceeds the execution grant reserve cap.');
      let proofVerified = false;
      try { proofVerified = await verifyDevnetProof({ owner, wallet: canonicalWallet, proofId: grant.devnetProofId }); } catch {}
      if (proofVerified !== true) fail('UNAUTHORIZED', 'T82_PROOF_UNVERIFIED: retained owner-approved supply, redemption, and independent Explorer evidence are required.');
      const proofAt = await databaseNow(owner);
      if (Date.parse(grant.expiresAt) <= Date.parse(proofAt) || Date.parse(trial.expiresAt) <= Date.parse(proofAt)
          || quoteDeadline(current.data.quote) === null || quoteDeadline(current.data.quote) <= Date.parse(proofAt)) {
        fail('UNAUTHORIZED', 'CFO grant, exact trial, or generated quote expired during T82 proof verification.');
      }
      const stillSigned = await store.latestAction(owner, actionId);
      if (!stillSigned || stillSigned.id !== current.id || stillSigned.data.status !== 'SIGNED'
          || !await actionEvidenceCurrent(owner, stillSigned, proofAt)) conflict('CFO action or signed quote became stale during T82 proof verification.');
      requireProvider('submit');
      const verified = await adapter.validateSigned(
        { standard: current.data.standard, payload: current.data.payload }, canonicalWallet, current.data.signatureBase64,
      );
      if (stableStringify(verified) !== stableStringify(current.data.signedData)) fail('UNAUTHORIZED', 'Stored signature no longer matches the exact generated intent.');
      const dispatchAt = await databaseNow(owner);
      if (Date.parse(grant.expiresAt) <= Date.parse(dispatchAt) || Date.parse(trial.expiresAt) <= Date.parse(dispatchAt)
          || !await actionEvidenceCurrent(owner, stillSigned, dispatchAt)) {
        fail('UNAUTHORIZED', 'CFO grant, exact trial, quote timestamp, mandate, or portfolio evidence expired before relay.');
      }
      const unknown = await store.append(owner, {
        requestId, kind: 'action', expectedHeadId: stillSigned.id,
        expectedMandateId: stillSigned.data.mandateId, expectedPortfolioId: stillSigned.data.portfolioId,
        data: { ...stillSigned.data, status: 'SUBMISSION_UNKNOWN', reason: 'Relay outcome is not yet reconciled.' },
      });
      if (!unknown.inserted) return actionDto(unknown.record);
      try {
        const submitted = await adapter.submitIntent(unknown.record.data.signedData);
        if (!isRecord(submitted) || typeof submitted.intentHash !== 'string' || typeof submitted.correlationId !== 'string') return actionDto(unknown.record);
        const currentUnknown = await store.latestAction(owner, actionId);
        if (!currentUnknown || currentUnknown.id !== unknown.record.id || currentUnknown.data.status !== 'SUBMISSION_UNKNOWN') return actionDto(currentUnknown ?? unknown.record);
        try {
          const retained = await store.append(owner, {
            requestId: randomUUID(), kind: 'action', expectedHeadId: currentUnknown.id,
            data: { ...currentUnknown.data, status: 'SUBMITTED', intentHash: submitted.intentHash, correlationId: submitted.correlationId, reason: null },
          });
          return actionDto(retained.record);
        } catch { return actionDto(currentUnknown); }
      } catch (error) {
        const latest = await store.latestAction(owner, actionId);
        if (latest?.id === unknown.record.id && latest.data.status === 'SUBMISSION_UNKNOWN') {
          try {
            const retained = await store.append(owner, {
              requestId: randomUUID(), kind: 'action', expectedHeadId: latest.id,
              data: { ...latest.data, reason: providerFailure('submit', error, 'SUBMISSION_UNKNOWN') },
            });
            return actionDto(retained.record);
          } catch {}
        }
        return actionDto(latest ?? unknown.record);
      }
    },

    async reconcileAction(owner, wallet, input) {
      const canonicalWallet = identity(owner, wallet);
      exact(input, ['requestId', 'actionId'], 'CFO reconciliation request');
      const requestId = uuid(input.requestId, 'Request ID');
      const actionId = uuid(input.actionId, 'Action ID');
      const prior = await store.byRequest(owner, requestId);
      if (prior) {
        if (prior.kind !== 'action' || prior.data.actionId !== actionId) conflict('CFO reconciliation request ID is already bound to another record.');
        return await settlementDto(await store.latestAction(owner, actionId) ?? prior, store, owner);
      }
      let current = await store.latestAction(owner, actionId);
      if (!current || current.data.wallet !== canonicalWallet) fail('NOT_FOUND', 'CFO action was not found.');
      if (!['SUBMISSION_UNKNOWN', 'SUBMITTED', 'PENDING', 'UNVERIFIED'].includes(current.data.status)) conflict('CFO action has no submitted or uncertain movement to reconcile.');
      const beforeRecord = await store.get(owner, current.data.portfolioId);
      if (!beforeRecord || beforeRecord.kind !== 'portfolio' || beforeRecord.data.wallet !== canonicalWallet) fail('STORAGE_UNAVAILABLE', 'CFO action portfolio evidence is missing.');
      let result;
      try {
        requireProvider('reconcile');
        result = await adapter.reconcile({
          quote: current.data.quote,
          signedData: current.data.signedData,
          intentHash: current.data.intentHash,
          beforePortfolio: beforeRecord.data,
        });
      } catch (error) {
        result = { status: 'UNVERIFIED', reason: providerFailure('reconcile', error, 'RECONCILIATION_UNAVAILABLE'), providerStatus: null, intentHash: current.data.intentHash, nearTxHashes: [], portfolio: null, amounts: null };
      }
      if (!isRecord(result) || !['PENDING', 'CONFIRMED', 'REFUNDED', 'FAILED', 'UNVERIFIED'].includes(result.status)) {
        result = { status: 'UNVERIFIED', reason: 'Provider reconciliation response was invalid.', providerStatus: null, intentHash: current.data.intentHash, nearTxHashes: [], portfolio: null, amounts: null };
      }
      if (['FAILED', 'REFUNDED'].includes(result.status)) {
        result = { ...result, status: 'UNVERIFIED', amounts: null, portfolio: null,
          reason: 'A failed relay or provider refund report does not prove that this signed intent is permanently settled or unusable.' };
      }
      if (current.data.intentHash && result.intentHash && result.intentHash !== current.data.intentHash) {
        result = { ...result, status: 'UNVERIFIED', intentHash: current.data.intentHash, amounts: null, portfolio: null,
          reason: 'Reconciliation cannot replace the retained signed intent identity.' };
      }
      if (result.status === 'CONFIRMED' && (!validPortfolio(result.portfolio, canonicalWallet) || result.portfolio.status !== 'OBSERVED'
          || !confirmedAmountsMatch(result.amounts, current.data)
          || typeof result.intentHash !== 'string' || !result.intentHash.length
          || (current.data.intentHash !== null && result.intentHash !== current.data.intentHash)
          || !Array.isArray(result.nearTxHashes) || result.nearTxHashes.length < 1)) {
        result = { ...result, status: 'UNVERIFIED', reason: 'Confirmed settlement did not include the exact verified owner portfolio, quote-bounded token deltas, and receipt hashes.' };
      }
      const status = result.status === 'PENDING' ? 'PENDING'
        : result.status === 'CONFIRMED' && current.data.action === 'rotate' && current.data.leg === 0 ? 'EXIT_CONFIRMED'
          : result.status;
      const nextData = {
        ...current.data,
        status,
        providerStatus: result.providerStatus === undefined ? null : cloneJson(result.providerStatus, 96 * 1024),
        intentHash: result.intentHash ?? current.data.intentHash,
        nearTxHashes: Array.isArray(result.nearTxHashes) ? result.nearTxHashes.slice(0, 16) : [],
        amounts: result.amounts === undefined ? null : result.amounts,
        reason: typeof result.reason === 'string' ? result.reason.slice(0, 512) : null,
        receiptPortfolioId: null,
        rotationState: current.data.action === 'rotate' ? status === 'CONFIRMED' ? 'COMPLETE' : status === 'REFUNDED' || status === 'FAILED' ? 'INCOMPLETE' : 'IN_PROGRESS' : current.data.rotationState,
      };
      if (result.status === 'CONFIRMED' && validPortfolio(result.portfolio, canonicalWallet)) {
        const receiptPortfolio = await store.append(owner, { requestId: randomUUID(), kind: 'portfolio', data: cloneJson(result.portfolio, 96 * 1024) });
        nextData.receiptPortfolioId = receiptPortfolio.record.id;
      }
      const saved = await store.append(owner, { requestId, kind: 'action', expectedHeadId: current.id, data: nextData });
      current = saved.record;
      if (current.data.status === 'EXIT_CONFIRMED') current = await createRotationEntry(owner, canonicalWallet, current, result);
      return await settlementDto(current, store, owner);
    },

    async setMonitor(owner, wallet, input) {
      const canonicalWallet = identity(owner, wallet);
      exact(input, ['requestId', 'enabled'], 'CFO monitor request');
      const requestId = uuid(input.requestId, 'Request ID');
      if (typeof input.enabled !== 'boolean') invalid('CFO monitor enabled must be boolean.');
      const prior = await store.byRequest(owner, requestId);
      if (prior) {
        if (prior.kind !== 'monitor' || prior.data.wallet !== canonicalWallet || prior.data.enabled !== input.enabled) conflict('CFO monitor request ID is already bound to different content.');
        return monitorOutput(prior.data);
      }
      const latest = await store.latest(owner, 'monitor');
      const mandateRecord = await latestMandate(owner, canonicalWallet);
      if (!mandateRecord) conflict('Save an explicit mandate before starting its monitor.');
      const at = await databaseNow(owner);
      let data;
      if (input.enabled) {
        const intervalSeconds = mandateRecord.data.monitorIntervalSeconds;
        const maxCycles = mandateRecord.data.maxMonitorCycles;
        data = {
          schemaVersion: 1, wallet: canonicalWallet, enabled: true, processId: serviceId, cyclesCompleted: 0,
          maxCycles, intervalSeconds, nextRunAt: addMilliseconds(at, intervalSeconds * 1000),
          leaseUntil: addMilliseconds(at, intervalSeconds * 1000 + REVIEW_LEASE_MS), status: 'RUNNING',
        };
      } else {
        const old = latest?.data;
        data = {
          schemaVersion: 1, wallet: canonicalWallet, enabled: false, processId: old?.processId ?? serviceId,
          cyclesCompleted: old?.cyclesCompleted ?? 0, maxCycles: old?.maxCycles ?? mandateRecord.data.maxMonitorCycles,
          intervalSeconds: old?.intervalSeconds ?? mandateRecord.data.monitorIntervalSeconds,
          nextRunAt: null, leaseUntil: null, status: 'STOPPED',
        };
      }
      const appended = await store.append(owner, {
        requestId, kind: 'monitor', data,
        ...(latest ? { expectedHeadId: latest.id } : { expectedHeadId: null }),
      });
      if (appended.inserted && data.enabled) scheduleMonitor(owner, canonicalWallet, appended.record);
      if (appended.inserted && !data.enabled) stopLocalMonitor(owner);
      return monitorOutput(appended.record.data);
    },

    async close() {
      if (closePromise) return closePromise;
      closing = true;
      closePromise = (async () => {
        for (const [jobId, entry] of activeReviews) {
          entry.stopped = true;
          entry.controller.abort();
          clearInterval(entry.heartbeat);
          clearTimeout(entry.timer);
          try {
            const latest = await store.latestReview(entry.owner, jobId);
            if (latest?.data.state === 'PENDING') await finishUnknownReview(entry.owner, latest, entry.plan, REVIEW_CLOSE_REASON);
          } catch {}
          activeReviews.delete(jobId);
        }
        for (const [owner, entry] of activeMonitors) {
          clearTimeout(entry.timer);
          entry.stopped = true;
          try {
            const latest = await store.latest(owner, 'monitor');
            if (latest?.data.enabled && latest.data.processId === entry.processId) {
              await store.append(owner, {
                requestId: randomUUID(), kind: 'monitor', expectedHeadId: latest.id,
                data: { ...latest.data, enabled: false, nextRunAt: null, leaseUntil: null, status: 'STOPPED' },
              });
            }
          } catch {}
        }
        activeMonitors.clear();
      })();
      return closePromise;
    },
  };
  const planCycleCall = service.planCycle.bind(service);
  return service;

  function monitorOutput(data) {
    return { enabled: data.enabled, cyclesCompleted: data.cyclesCompleted, maxCycles: data.maxCycles, nextRunAt: data.nextRunAt, status: data.status };
  }

  function stopLocalMonitor(owner) {
    const entry = activeMonitors.get(owner);
    if (!entry) return;
    entry.stopped = true;
    clearTimeout(entry.timer);
    activeMonitors.delete(owner);
  }

  function scheduleMonitor(owner, wallet, record) {
    stopLocalMonitor(owner);
    if (closing || !record.data.enabled || record.data.status !== 'RUNNING') return;
    const entry = { processId: record.data.processId, timer: null, stopped: false };
    activeMonitors.set(owner, entry);
    const delay = record.data.intervalSeconds * 1000;
    entry.timer = setTimeout(() => { void runMonitorCycle(owner, wallet, entry).catch(() => undefined); }, delay);
    entry.timer.unref?.();
  }

  async function runMonitorCycle(owner, wallet, entry) {
    if (closing || entry.stopped || activeMonitors.get(owner) !== entry) return;
    let current = await store.latest(owner, 'monitor');
    if (!current || !current.data.enabled || current.data.processId !== entry.processId) { stopLocalMonitor(owner); return; }
    const nowText = await databaseNow(owner);
    if (!current.data.leaseUntil || Date.parse(current.data.leaseUntil) <= Date.parse(nowText)) { stopLocalMonitor(owner); return; }
    if (Date.parse(nowText) < Date.parse(current.data.nextRunAt)) { scheduleMonitor(owner, wallet, current); return; }
    const cycleRequestId = randomUUID();
    const portfolioRecord = await recordPortfolio(owner, wallet, cycleRequestId, { idempotent: false });
    if (closing || entry.stopped) return;
    current = await store.latest(owner, 'monitor');
    if (!current || !current.data.enabled || current.data.processId !== entry.processId) { stopLocalMonitor(owner); return; }
    const at = await databaseNow(owner);
    const cyclesCompleted = current.data.cyclesCompleted + 1;
      const completed = cyclesCompleted >= current.data.maxCycles;
      const noData = portfolioRecord.data.status === 'NO_DATA';
      const stopped = completed || noData;
      const nextData = {
        ...current.data,
        enabled: !stopped,
        cyclesCompleted,
        nextRunAt: stopped ? null : addMilliseconds(at, current.data.intervalSeconds * 1000),
        leaseUntil: stopped ? null : addMilliseconds(at, current.data.intervalSeconds * 1000 + REVIEW_LEASE_MS),
        status: completed ? 'COMPLETE' : noData ? 'NO_DATA' : 'RUNNING',
      };
    const saved = await store.append(owner, { requestId: randomUUID(), kind: 'monitor', expectedHeadId: current.id, data: nextData });
    if (completed || !saved.record.data.enabled) stopLocalMonitor(owner);
    else scheduleMonitor(owner, wallet, saved.record);
  }

  async function createRotationEntry(owner, wallet, actionRecord, reconcileResult = actionRecord.data) {
    const sourcePortfolio = await store.get(owner, actionRecord.data.portfolioId);
    const mandateRecord = await latestMandate(owner, wallet);
    if (!sourcePortfolio || !mandateRecord) {
      return incompleteRotation(owner, actionRecord, 'Retained source portfolio or mandate evidence is unavailable.');
    }
    const refreshed = await recordPortfolio(owner, wallet, randomUUID(), { idempotent: false });
    if (refreshed.data.status !== 'OBSERVED') {
      return incompleteRotation(owner, actionRecord, 'A fresh finalized portfolio is unavailable.');
    }
    const settled = reserveSettlementUnits(reconcileResult.amounts, mandateRecord.data.reserveAssetId);
    const beforeReserve = BigInt(balanceOf(sourcePortfolio.data, mandateRecord.data.reserveAssetId));
    const afterReserve = BigInt(balanceOf(refreshed.data, mandateRecord.data.reserveAssetId));
    const observedIncrease = afterReserve > beforeReserve ? afterReserve - beforeReserve : 0n;
    if (settled === null || settled <= 0n || observedIncrease <= 0n || settled > observedIncrease) {
      return incompleteRotation(owner, actionRecord, 'Refreshed reserve units do not prove the bounded exit settlement.', { receiptPortfolioId: refreshed.id });
    }
    const targetAssetId = actionRecord.data.rotationTargetAssetId;
    if (typeof targetAssetId !== 'string') {
      return incompleteRotation(owner, actionRecord, 'The retained rotation target is missing.', { receiptPortfolioId: refreshed.id });
    }
    const requestId = uuidFrom(actionRecord.data.actionId, 'rotation-entry:' + actionRecord.id);
    const input = {
      requestId,
      action: 'reinvest',
      sourceAssetId: mandateRecord.data.reserveAssetId,
      targetAssetId,
      inputBaseUnits: settled.toString(),
    };
    let planResponse;
    try { planResponse = await planCycleCall(owner, wallet, input); }
    catch (error) {
      return incompleteRotation(owner, actionRecord, safeReason(error, 'ROTATION_ENTRY_PLAN_UNAVAILABLE'), { receiptPortfolioId: refreshed.id });
    }
    const childPlan = planResponse.plan;
    if (!childPlan?.id) {
      return incompleteRotation(owner, actionRecord, 'The fresh entry plan was not retained.', { receiptPortfolioId: refreshed.id });
    }
    if (childPlan.data.status !== 'REVIEW') {
      return incompleteRotation(owner, actionRecord, 'Fresh entry evidence failed deterministic policy.', { receiptPortfolioId: refreshed.id, nextPlanId: childPlan.id });
    }
    return appendActionTransition(owner, actionRecord, {
      ...actionRecord.data,
      status: 'AWAITING_NEXT_LEG',
      reason: childPlan.data.status === 'REVIEW'
        ? 'Exit confirmed; fresh owner-approved entry review is required.'
        : 'Exit confirmed; fresh entry evidence did not pass deterministic policy.',
      receiptPortfolioId: refreshed.id,
      nextPlanId: childPlan.data.status === 'REVIEW' ? childPlan.id : null,
    });
  }

  async function incompleteRotation(owner, action, reason, extra = {}) {
    if (action.data.action !== 'rotate' || action.data.leg !== 0
        || !['EXIT_CONFIRMED', 'AWAITING_NEXT_LEG'].includes(action.data.status)
        || !action.data.intentHash || !action.data.nearTxHashes?.length
        || !confirmedAmountsMatch(action.data.amounts, action.data)) conflict('Only an independently confirmed exit with no entry can close an incomplete rotation.');
    return appendActionTransition(owner, action, {
      ...action.data, ...extra, status: 'FAILED', rotationState: 'INCOMPLETE', preparationLeaseUntil: null,
      reason: `Exit confirmed; no entry was signed or submitted. ${reason}`.slice(0, 512),
    });
  }

  async function closeBlockedRotation(owner, wallet, action) {
    if (action.data.status === 'EXIT_CONFIRMED') {
      const at = await databaseNow(owner);
      if (Date.parse(action.createdAt) + ROTATION_PLAN_LEASE_MS > Date.parse(at)) return action;
      return incompleteRotation(owner, action, 'The entry planning lease expired before any entry payload was retained.');
    }
    if (action.data.status !== 'AWAITING_NEXT_LEG') return action;
    const child = action.data.nextPlanId ? await store.get(owner, action.data.nextPlanId) : null;
    if (!child || child.kind !== 'plan' || child.data.status !== 'REVIEW') {
      return incompleteRotation(owner, action, 'A usable entry plan is unavailable.');
    }
    const job = await checkReviewForUse(owner, child);
    const [mandate, portfolio] = await Promise.all([latestMandate(owner, wallet), latestPortfolio(owner, wallet)]);
    if (!child.data.sourceRefs.some(ref => ref.revisionId === mandate?.id && ref.sha256 === mandate.contentHash)
        || !child.data.sourceRefs.some(ref => ref.revisionId === portfolio?.id && ref.sha256 === portfolio.contentHash)) {
      return incompleteRotation(owner, action, 'The mandate or inventory changed after entry review.');
    }
    try { validateSnapshotForUse(child, mandate, portfolio, await databaseNow(owner)); }
    catch (error) {
      if (error instanceof MeshError && error.code === 'CONFLICT') return incompleteRotation(owner, action, 'Entry evidence expired before another signature.');
      throw error;
    }
    if (job?.data.state === 'PENDING' || reviewPass(job)) return action;
    return incompleteRotation(owner, action, 'Fresh entry review did not pass.');
  }

  function reserveSettlementUnits(amounts, reserveAssetId) {
    if (!isRecord(amounts) || !isRecord(amounts.credit) || amounts.credit.assetId !== reserveAssetId) return null;
    try { return units(amounts.credit.baseUnits, 'Confirmed reserve settlement', { positive: true }); }
    catch { return null; }
  }

  async function appendActionTransition(owner, current, data) {
    const latest = await store.latestAction(owner, current.data.actionId);
    if (!latest || latest.id !== current.id) return latest ?? current;
    try {
      return (await store.append(owner, { requestId: randomUUID(), kind: 'action', expectedHeadId: current.id, data })).record;
    } catch (error) {
      if (error instanceof MeshError && error.code === 'CONFLICT') return store.latestAction(owner, current.data.actionId);
      throw error;
    }
  }

  async function expireUnsignedPreparation(owner, current, at) {
    if (!current) return current;
    const data = current.data;
    if (data.signatureBase64 !== null || data.signedData !== null || data.intentHash !== null) return current;
    const isPreparing = data.status === 'PREPARING';
    const isPrepared = data.status === 'PREPARED' || data.status === 'NEXT_LEG_READY';
    if (!isPreparing && !isPrepared) return current;
    const evidenceCurrent = await actionEvidenceCurrent(owner, current, at);
    const leaseExpired = isPreparing && data.preparationLeaseUntil
      && Date.parse(data.preparationLeaseUntil) <= Date.parse(at);
    const quoteExpired = isPrepared && (quoteDeadline(data.quote) === null || quoteDeadline(data.quote) <= Date.parse(at));
    if (!leaseExpired && !quoteExpired && evidenceCurrent) return current;
    const rotationEntry = data.action === 'rotate' && data.leg === 1;
    return appendActionTransition(owner, current, {
      ...data,
      status: 'FAILED',
      preparationLeaseUntil: null,
      rotationState: data.action === 'rotate' ? 'INCOMPLETE' : data.rotationState,
      reason: rotationEntry
        ? 'Exit confirmed; stable proceeds retained; entry not prepared: the unsigned entry quote or evidence expired.'
        : 'Unsigned intent preparation expired or its mandate/portfolio evidence changed; no signature or relay was retained.',
    });
  }

  function uuidFrom(namespace, value) {
    const bytes = createHash('sha256').update('falcon_mesh:cfo:' + namespace + ':' + value, 'utf8').digest().subarray(0, 16);
    bytes[6] = (bytes[6] & 0x0f) | 0x50;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;
    const hex = bytes.toString('hex');
    return hex.slice(0, 8) + '-' + hex.slice(8, 12) + '-' + hex.slice(12, 16) + '-' + hex.slice(16, 20) + '-' + hex.slice(20);
  }
}
