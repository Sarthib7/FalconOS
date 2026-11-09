import React, { useCallback, useEffect, useRef, useState } from 'react';
import { bytesToBase64 } from '../app/auth.mjs';
import { meshRequest } from './api.mjs';
import './lending-bot.css';

const ROOT = '/v1/lending-bot';
const INTEGER_TEXT = /^(?:0|[1-9][0-9]*)$/;
const UUID_TEXT = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const EMPTY_FORM = Object.freeze({
  capitalCap: '', reserveFloor: '', maxAction: '', maxPositionBps: '', maxFeeLamports: '',
  maxEvidenceAgeSeconds: '', minHoldingSeconds: '', minNetBenefit: '', cooldownSeconds: '',
  expiresAt: '', monitorIntervalSeconds: '', maxReviewCalls: '',
});
const EMPTY_STORE = Object.freeze({
  identity: null,
  overview: null,
  load: { status: 'idle', error: null },
  busy: null,
  error: null,
  notice: null,
  uncertain: null,
  allowAfterReview: false,
  mandateForm: EMPTY_FORM,
  mandateDirty: false,
  mandateErrors: {},
  delegationPreview: null,
  delegationConfirmed: false,
  delegationCheckRequired: false,
  revocationPreview: null,
  revocationConfirmed: false,
  revocationRemoved: false,
  revocationVerifyRequired: false,
  selectedPosition: '',
  withdrawAmount: '',
  ownerAction: null,
  ownerApproval: false,
  signedActionUnknown: null,
  actionRecords: [],
});
const isRecord = value => Boolean(value) && typeof value === 'object' && !Array.isArray(value);
const isUnsignedText = value => typeof value === 'string' && INTEGER_TEXT.test(value);
const text = value => typeof value === 'string' ? value : '';

const REQUEST_FIELDS_BY_PATH = new Map([
  ['/wallet-link', ['requestId']],
  ['/delegation/prepare', ['requestId']],
  ['/delegation', ['requestId']],
  ['/revoke/prepare', ['requestId']],
  ['/revoke', ['requestId']],
  ['/accounts/quote', ['requestId']],
  ['/accounts/prepare', ['requestId', 'quoteId']],
]);

export function createLendingMeshRequest(request = meshRequest) {
  return (token, path, body) => {
    const expectedFields = REQUEST_FIELDS_BY_PATH.get(path);
    if (expectedFields && (!isRecord(body) || Object.keys(body).length !== expectedFields.length
      || expectedFields.some(field => !Object.prototype.hasOwnProperty.call(body, field) || typeof body[field] !== 'string'))) {
      throw new Error(`The ${path} lending request has an invalid owner-control body.`);
    }
    return request(token, `${ROOT}${path}`, body);
  };
}

const lendingMeshRequest = createLendingMeshRequest();

function sameIdentity(left, right) {
  return Boolean(left && right)
    && left.session === right.session
    && left.sessionWallet === right.sessionWallet
    && left.walletAddress === right.walletAddress
    && left.walletUserId === right.walletUserId;
}

/** Binds every async reply to the exact session and selected embedded wallet that started it. */
export function createLendingRequestScope() {
  let identity = null;
  let generation = 0;
  return {
    setIdentity(next) {
      if (sameIdentity(identity, next)) return false;
      identity = next;
      generation += 1;
      return true;
    },
    capture() { return { generation, identity }; },
    accepts(ticket, current) {
      return Boolean(ticket)
        && ticket.generation === generation
        && sameIdentity(ticket.identity, identity)
        && sameIdentity(identity, current);
    },
    invalidate() { generation += 1; },
  };
}

/** Keeps owner SDK effects bound to the exact Falcon session and selected wallet across awaits. */
export async function performIdentityBoundOwnerSdkAction(requestScope, ticket, identityRef, action) {
  if (!requestScope.accepts(ticket, identityRef.current)) return { accepted: false };
  const result = await action();
  if (!requestScope.accepts(ticket, identityRef.current)) return { accepted: false };
  return { accepted: true, result };
}

/** Prevents a delayed setup response from crossing either the session or retained quote boundary. */
export async function performIdentityBoundSetupRequest(requestScope, ticket, identityRef, quoteIdRef, expectedQuoteId, request) {
  if (!requestScope.accepts(ticket, identityRef.current) || quoteIdRef.current !== expectedQuoteId) {
    return { accepted: false, sent: false };
  }
  const response = await request();
  if (!requestScope.accepts(ticket, identityRef.current) || quoteIdRef.current !== expectedQuoteId) {
    return { accepted: false, sent: true, response };
  }
  return { accepted: true, sent: true, response };
}

/** Converts ordinary decimal text to exact canonical base units without floating-point math. */
export function parseTokenAmount(value, decimals) {
  if (typeof value !== 'string' || !Number.isSafeInteger(decimals) || decimals < 0 || decimals > 255) return null;
  const match = /^([0-9]+)(?:\.([0-9]+))?$/.exec(value);
  if (!match) return null;
  const fraction = match[2] ?? '';
  if (fraction.length > decimals) return null;
  const units = `${match[1]}${fraction.padEnd(decimals, '0')}`.replace(/^0+(?=\d)/, '');
  return units || '0';
}

export function parseUnsignedInteger(value, { positive = false, max = Number.MAX_SAFE_INTEGER } = {}) {
  if (typeof value !== 'string' || !INTEGER_TEXT.test(value)) return null;
  let parsed;
  try { parsed = BigInt(value); } catch { return null; }
  if (positive && parsed === 0n) return null;
  if (parsed > BigInt(max)) return null;
  return Number(parsed);
}

/** Exact base-unit formatter. Invalid or missing observations are unavailable, never zero. */
export function formatBaseUnits(value, decimals, { grouping = true } = {}) {
  if (!isUnsignedText(value) || !Number.isSafeInteger(decimals) || decimals < 0 || decimals > 255) return null;
  const normalized = value.replace(/^0+(?=\d)/, '');
  const padded = normalized.padStart(decimals + 1, '0');
  const whole = decimals ? padded.slice(0, -decimals) : padded;
  const fraction = decimals ? padded.slice(-decimals) : '';
  const visibleWhole = grouping ? whole.replace(/\B(?=(\d{3})+(?!\d))/g, ',') : whole;
  return decimals ? `${visibleWhole}.${fraction}` : visibleWhole;
}

function baseUnitsInputText(value, decimals) {
  const exact = formatBaseUnits(value, decimals, { grouping: false });
  if (exact === null || decimals === 0) return exact ?? '';
  const [whole, fraction] = exact.split('.');
  const trimmed = fraction.replace(/0+$/, '');
  return trimmed ? `${whole}.${trimmed}` : whole;
}

function parseBaseUnitAmount(value, decimals, { positive = false } = {}) {
  const units = parseTokenAmount(value, decimals);
  if (units === null || (positive && BigInt(units) === 0n)) return null;
  return units;
}

function parseBps(value) {
  return parseUnsignedInteger(value, { max: 10_000 });
}

function validOperatorTerms(configuration) {
  return typeof configuration?.feeRecipient === 'string'
    && configuration.feeRecipient.length > 0
    && configuration.feeRecipient === configuration.feeRecipient.trim()
    && Number.isSafeInteger(configuration.feeBps)
    && configuration.feeBps >= 0 && configuration.feeBps <= 10_000;
}

/** Build the exact R1 mandate body from customer-entered values and trusted read-only fee terms. */
export function buildMandateFromForm(form, configuration, now = Date.now()) {
  const errors = {};
  const values = form ?? {};
  const money = {
    capitalCapBaseUnits: parseBaseUnitAmount(text(values.capitalCap), 6),
    reserveFloorBaseUnits: parseBaseUnitAmount(text(values.reserveFloor), 6),
    maxActionBaseUnits: parseBaseUnitAmount(text(values.maxAction), 6),
    minNetBenefitBaseUnits: parseBaseUnitAmount(text(values.minNetBenefit), 6),
  };
  const amountFields = [
    ['capitalCap', money.capitalCapBaseUnits, 'Enter an exact USDC amount with no more than six decimal places.'],
    ['reserveFloor', money.reserveFloorBaseUnits, 'Enter an exact USDC amount with no more than six decimal places.'],
    ['maxAction', money.maxActionBaseUnits, 'Enter an exact USDC amount with no more than six decimal places.'],
    ['minNetBenefit', money.minNetBenefitBaseUnits, 'Enter an exact USDC amount with no more than six decimal places.'],
  ];
  for (const [field, amount, message] of amountFields) if (amount === null) errors[field] = message;

  const maxFeeLamports = text(values.maxFeeLamports);
  if (!isUnsignedText(maxFeeLamports)) errors.maxFeeLamports = 'Enter an exact whole number of lamports.';
  const bounded = {
    maxPositionBps: parseBps(text(values.maxPositionBps)),
    maxEvidenceAgeSeconds: parseUnsignedInteger(text(values.maxEvidenceAgeSeconds), { positive: true }),
    minHoldingSeconds: parseUnsignedInteger(text(values.minHoldingSeconds), { positive: true }),
    cooldownSeconds: parseUnsignedInteger(text(values.cooldownSeconds), { positive: true }),
    monitorIntervalSeconds: parseUnsignedInteger(text(values.monitorIntervalSeconds), { positive: true }),
    maxReviewCalls: parseUnsignedInteger(text(values.maxReviewCalls), { positive: true }),
  };
  for (const field of ['maxPositionBps', 'maxEvidenceAgeSeconds', 'minHoldingSeconds', 'cooldownSeconds', 'monitorIntervalSeconds', 'maxReviewCalls']) {
    if (bounded[field] === null) errors[field] = field === 'maxPositionBps'
      ? 'Enter a whole number from 0 to 10,000 basis points.'
      : 'Enter a positive whole number within the safe integer range.';
  }

  const expiry = typeof values.expiresAt === 'string' && values.expiresAt ? Date.parse(values.expiresAt) : NaN;
  if (!Number.isFinite(expiry) || expiry <= now) errors.expiresAt = 'Choose an expiry time in the future.';
  if (!validOperatorTerms(configuration)) errors.feeTerms = 'Trusted fee terms are not configured. Contact the service operator; do not enter a different recipient.';

  const reserves = Array.isArray(configuration?.availableReserves)
    ? configuration.availableReserves.map(item => item?.reserveAddress).filter(value => typeof value === 'string' && value.length > 0)
    : [];
  if (reserves.length !== 2 || reserves[0] === reserves[1]) errors.reserves = 'The service must provide exactly two distinct supported reserve identities.';
  if (Object.keys(errors).length) return { mandate: null, errors };

  return {
    mandate: {
      schemaVersion: 1,
      capitalCapBaseUnits: money.capitalCapBaseUnits,
      reserveFloorBaseUnits: money.reserveFloorBaseUnits,
      maxActionBaseUnits: money.maxActionBaseUnits,
      maxPositionBps: bounded.maxPositionBps,
      maxFeeLamports,
      maxEvidenceAgeSeconds: bounded.maxEvidenceAgeSeconds,
      minHoldingSeconds: bounded.minHoldingSeconds,
      minNetBenefitBaseUnits: money.minNetBenefitBaseUnits,
      cooldownSeconds: bounded.cooldownSeconds,
      feeBps: configuration.feeBps,
      feeRecipient: configuration.feeRecipient,
      reserves,
      expiresAt: new Date(expiry).toISOString(),
      monitorIntervalSeconds: bounded.monitorIntervalSeconds,
      maxReviewCalls: bounded.maxReviewCalls,
    },
    errors: {},
  };
}

function validPortfolio(portfolio) {
  return portfolio === null || (isRecord(portfolio)
    && portfolio.schemaVersion === 1
    && portfolio.chain === 'solana'
    && portfolio.network === 'mainnet-beta'
    && ['OBSERVED', 'NO_DATA'].includes(portfolio.status)
    && Array.isArray(portfolio.positions)
    && Array.isArray(portfolio.issues)
    && (portfolio.warnings === undefined || (Array.isArray(portfolio.warnings)
      && portfolio.warnings.every(warning => typeof warning === 'string'))));
}

function validWalletLink(value) {
  return value === null || (isRecord(value)
    && typeof value.walletAddress === 'string'
    && typeof value.providerWalletId === 'string'
    && value.providerWalletId.length > 0);
}

function validSetupAccount(account, wallet) {
  return isRecord(account)
    && typeof account.address === 'string' && account.address.length > 0
    && typeof account.mint === 'string' && account.mint.length > 0
    && account.owner === wallet
    && typeof account.tokenProgram === 'string' && account.tokenProgram.length > 0
    && typeof account.exists === 'boolean'
    && isUnsignedText(account.balanceBaseUnits)
    && (account.exists || account.balanceBaseUnits === '0');
}

function validSetupQuote(value) {
  if (value === null) return true;
  if (!isRecord(value) || value.schemaVersion !== 1
    || !['QUOTED', 'READY', 'NO_DATA'].includes(value.status)
    || typeof value.wallet !== 'string' || !value.wallet
    || value.chain !== 'solana' || value.network !== 'mainnet-beta') return false;
  if (value.status === 'NO_DATA') {
    return (value.quoteId == null || UUID_TEXT.test(value.quoteId))
      && value.observedAt === null && value.slot === null && value.expiresAt === null
      && value.nativeBalanceLamports === null && Array.isArray(value.accounts) && value.accounts.length === 0
      && value.feeLamports === null && value.rentLamports === null && value.maxFeeLamports === null
      && value.maxTotalCostUsdcBaseUnits === null && value.costEvidence === null
      && Array.isArray(value.reasons) && value.reasons.length > 0
      && value.reasons.every(reason => typeof reason === 'string' && reason.length > 0);
  }
  if (!UUID_TEXT.test(value.quoteId)
    || typeof value.observedAt !== 'string' || !Number.isFinite(Date.parse(value.observedAt))
    || !Number.isSafeInteger(value.slot) || value.slot <= 0
    || !Array.isArray(value.accounts) || value.accounts.length !== 3
    || !value.accounts.every(account => validSetupAccount(account, value.wallet))
    || new Set(value.accounts.map(account => account.address)).size !== 3
    || new Set(value.accounts.map(account => account.mint)).size !== 3
    || !Array.isArray(value.reasons) || value.reasons.length !== 0) return false;

  const missing = value.accounts.filter(account => account.exists === false).length;
  if (value.status === 'READY') {
    const expiryValid = value.expiresAt === null
      || (typeof value.expiresAt === 'string' && Number.isFinite(Date.parse(value.expiresAt))
        && Date.parse(value.expiresAt) > Date.parse(value.observedAt));
    if (!expiryValid || (value.nativeBalanceLamports !== null && !isUnsignedText(value.nativeBalanceLamports))
      || missing !== 0 || !value.accounts.every(account => account.exists)
      || value.feeLamports !== '0' || value.rentLamports !== '0' || value.maxFeeLamports !== '0'
      || (value.maxTotalCostUsdcBaseUnits !== null && value.maxTotalCostUsdcBaseUnits !== '0')) return false;
    if (value.costEvidence === null) return true;
    const cost = value.costEvidence;
    return isRecord(cost)
      && cost.maxFeeLamports === '0'
      && cost.associatedAccountRentLamports === '0'
      && cost.actualQuotedFeeLamports === '0'
      && cost.walletLamports === value.nativeBalanceLamports
      && cost.sourceSlot === value.slot
      && cost.feeQuoteSlot === null
      && cost.rentPerAccountLamports === '0'
      && cost.missingAccountCount === 0
      && cost.nativePriceUsdMicros === null && cost.usdcPriceUsdMicros === null
      && cost.nativePriceObservedAt === null && cost.usdcPriceObservedAt === null
      && cost.priceMaxAgeSeconds === null;
  }

  if (typeof value.expiresAt !== 'string' || !Number.isFinite(Date.parse(value.expiresAt))
    || Date.parse(value.expiresAt) <= Date.parse(value.observedAt)
    || !isUnsignedText(value.nativeBalanceLamports)
    || !isUnsignedText(value.feeLamports) || !isUnsignedText(value.rentLamports)
    || !isUnsignedText(value.maxFeeLamports)
    || (value.maxTotalCostUsdcBaseUnits !== null && !isUnsignedText(value.maxTotalCostUsdcBaseUnits))
    || !isRecord(value.costEvidence)) return false;

  const cost = value.costEvidence;
  if (![cost.maxFeeLamports, cost.associatedAccountRentLamports, cost.actualQuotedFeeLamports,
    cost.walletLamports, cost.rentPerAccountLamports].every(isUnsignedText)
    || cost.maxFeeLamports !== value.maxFeeLamports
    || cost.associatedAccountRentLamports !== value.rentLamports
    || cost.actualQuotedFeeLamports !== value.feeLamports
    || cost.walletLamports !== value.nativeBalanceLamports
    || cost.sourceSlot !== value.slot
    || cost.missingAccountCount !== missing
    || (cost.feeQuoteSlot !== null && (!Number.isSafeInteger(cost.feeQuoteSlot) || cost.feeQuoteSlot < value.slot))
    || (cost.nativePriceUsdMicros !== null && !isUnsignedText(cost.nativePriceUsdMicros))
    || (cost.usdcPriceUsdMicros !== null && !isUnsignedText(cost.usdcPriceUsdMicros))
    || (cost.nativePriceObservedAt !== null && (typeof cost.nativePriceObservedAt !== 'string' || !Number.isFinite(Date.parse(cost.nativePriceObservedAt))))
    || (cost.usdcPriceObservedAt !== null && (typeof cost.usdcPriceObservedAt !== 'string' || !Number.isFinite(Date.parse(cost.usdcPriceObservedAt))))
    || (cost.priceMaxAgeSeconds !== null && (!Number.isSafeInteger(cost.priceMaxAgeSeconds) || cost.priceMaxAgeSeconds <= 0))) return false;

  const rentPerAccount = BigInt(cost.rentPerAccountLamports);
  const rent = BigInt(value.rentLamports);
  return value.status === 'QUOTED' && missing > 0 && rentPerAccount > 0n
    && rent === rentPerAccount * BigInt(missing)
    && cost.feeQuoteSlot !== null;
}

export function setupNativeDeficitLamports(quote) {
  if (!isRecord(quote) || !['QUOTED', 'READY'].includes(quote.status)
    || !isUnsignedText(quote.nativeBalanceLamports)
    || !isUnsignedText(quote.feeLamports) || !isUnsignedText(quote.rentLamports)) return null;
  const required = BigInt(quote.feeLamports) + BigInt(quote.rentLamports);
  const available = BigInt(quote.nativeBalanceLamports);
  return required > available ? (required - available).toString() : '0';
}

function isSetupReady(overview, walletAddress, now = Date.now(), retainedActions = []) {
  const quote = overview?.setupQuote;
  return overview?.setupStatus === 'READY'
    && typeof walletAddress === 'string'
    && validSetupQuote(quote)
    && quote?.status === 'READY'
    && quote.wallet === walletAddress
    && quote.accounts.every(account => account.exists && account.owner === walletAddress)
    && overview.setupObservedAt === quote.observedAt
    && Number.isFinite(Date.parse(overview.setupObservedAt))
    && Number.isFinite(now) && (quote.expiresAt === null || Date.parse(quote.expiresAt) > now)
    && !hasUnresolvedSetupAction(overview, retainedActions);
}



function validSetupCosts(value) {
  return value == null || (isRecord(value)
    && (value.knownCostUsdcBaseUnits === null || isUnsignedText(value.knownCostUsdcBaseUnits))
    && typeof value.hasUnpricedCost === 'boolean'
    && isUnsignedText(value.feeLamports)
    && isUnsignedText(value.rentLamports));
}

function validOverview(value) {
  return isRecord(value)
    && value.schemaVersion === 1
    && value.domain === 'solana-lending-bot'
    && value.chain === 'solana'
    && value.network === 'mainnet-beta'
    && ['READY', 'SETUP_REQUIRED', 'NO_DATA'].includes(value.status)
    && isRecord(value.configuration)
    && typeof value.configuration.walletProviderConfigured === 'boolean'
    && typeof value.configuration.executionEnabled === 'boolean'
    && (value.configuration.feeRecipient == null || typeof value.configuration.feeRecipient === 'string')
    && (value.configuration.feeBps == null || (Number.isSafeInteger(value.configuration.feeBps) && value.configuration.feeBps >= 0 && value.configuration.feeBps <= 10_000))
    && Array.isArray(value.configuration.availableReserves)
    && Array.isArray(value.configuration.issues)
    && validWalletLink(value.walletLink)
    && validSetupQuote(value.setupQuote)
    && validSetupCosts(value.setupCosts)
    && (value.mandate === null || (isRecord(value.mandate) && typeof value.mandate.id === 'string' && isRecord(value.mandate.data)))
    && (value.delegation === null || (isRecord(value.delegation) && typeof value.delegation.status === 'string'))
    && validPortfolio(value.portfolio)
    && isRecord(value.runner)
    && ['STOPPED', 'RUNNING', 'PAUSED', 'REVOKED', 'BLOCKED'].includes(value.runner.state)
    && Array.isArray(value.actions)
    && isRecord(value.accounting)
    && Array.isArray(value.issues)
    && ['NOT_OBSERVED', 'REQUIRED', 'READY', 'UNAVAILABLE'].includes(value.setupStatus)
    && (value.setupObservedAt === null || (typeof value.setupObservedAt === 'string' && Number.isFinite(Date.parse(value.setupObservedAt))))
    && Array.isArray(value.setupIssues)
    && value.setupIssues.every(issue => typeof issue === 'string');
}

function actionStatusNeedsReconcile(status) {
  return ['SUBMISSION_UNKNOWN', 'SUBMITTED', 'PENDING', 'UNVERIFIED'].includes(status);
}

function hasUnresolvedActions(overview, retainedActions = []) {
  const actions = [...(Array.isArray(overview?.actions) ? overview.actions : []), ...(Array.isArray(retainedActions) ? retainedActions : [])];
  return actions.some(action => actionStatusNeedsReconcile(action?.status));
}

function hasUnresolvedSetupAction(overview, retainedActions = []) {
  const actions = [...(Array.isArray(overview?.actions) ? overview.actions : []), ...(Array.isArray(retainedActions) ? retainedActions : [])];
  return actions.some(action => action?.action === 'setup' && actionStatusNeedsReconcile(action?.status));
}

function isActiveDelegation(overview, now = Date.now()) {
  const expiry = Date.parse(overview?.delegation?.expiresAt ?? '');
  return overview?.delegation?.status === 'ACTIVE' && Number.isFinite(expiry) && expiry > now;
}

function hasCurrentMandate(overview, now = Date.now()) {
  const expiry = Date.parse(overview?.mandate?.data?.expiresAt ?? '');
  return Boolean(overview?.mandate?.id) && Number.isFinite(expiry) && expiry > now;
}

function hasFreshPortfolio(overview, now = Date.now()) {
  const capturedAt = Date.parse(overview?.portfolio?.capturedAt ?? '');
  const maxAge = overview?.mandate?.data?.maxEvidenceAgeSeconds;
  if (overview?.portfolio?.status !== 'OBSERVED' || !Number.isSafeInteger(capturedAt)
    || !Number.isSafeInteger(maxAge) || maxAge <= 0 || !Number.isSafeInteger(now)) return false;
  const age = BigInt(now) - BigInt(capturedAt);
  return age >= 0n && age <= BigInt(maxAge) * 1000n;
}

function matchesLinkedWallet(overview, context) {
  return Boolean(context.sessionWallet && context.walletAddress
    && context.sessionWallet === context.walletAddress
    && context.walletAuthenticated === true
    && context.walletReady === true
    && overview?.walletLink?.walletAddress === context.sessionWallet);
}

function positiveBaseUnits(value) {
  if (!isUnsignedText(value)) return false;
  try { return BigInt(value) > 0n; } catch { return false; }
}

function validRevocationPreview(preview, overview, walletAddress) {
  return isRecord(preview)
    && preview.scope === 'ALL_DELEGATED_SIGNERS'
    && preview.walletAddress === walletAddress
    && typeof preview.warning === 'string' && preview.warning.length > 0
    && Array.isArray(preview.signerIds)
    && preview.signerIds.every(id => typeof id === 'string' && id.length > 0)
    && typeof overview?.delegation?.signerId === 'string'
    && preview.signerIds.includes(overview.delegation.signerId);
}

function setupOwnerActionMatches(prepared, effects, context) {
  const overview = context.overview;
  const quote = overview?.setupQuote;
  const setup = prepared.accountSetup;
  const cost = prepared.costEvidence;
  const now = context.now ?? Date.now();
  if (overview?.setupStatus !== 'REQUIRED' || !isRecord(quote) || !validSetupQuote(quote) || quote.status !== 'QUOTED'
    || context.setupQuoteId !== quote.quoteId || overview.setupObservedAt !== quote.observedAt
    || quote.wallet !== context.sessionWallet || Date.parse(quote.expiresAt) <= now
    || prepared.amountBaseUnits !== '0' || prepared.amountUnit !== 'usdc-base-units'
    || prepared.reserveAddress !== null || prepared.recipient !== context.sessionWallet
    || !['usdcDebitBaseUnits', 'usdcCreditBaseUnits', 'receiptDebitBaseUnits', 'receiptCreditBaseUnits']
      .every(field => effects[field] === '0')
    || prepared.sourceTokenAccount !== null || prepared.destinationTokenAccount !== null
    || prepared.receiptMint !== null || prepared.feeRecipient !== null
    || prepared.source.slot < quote.slot
    || Date.parse(prepared.observedAt) < Date.parse(quote.observedAt)
    || Date.parse(prepared.expiresAt) <= now || Date.parse(prepared.expiresAt) > Date.parse(quote.expiresAt)
    || prepared.feeLamports !== quote.feeLamports || prepared.rentLamports !== quote.rentLamports
    || prepared.associatedAccountRentLamports !== quote.rentLamports
    || prepared.maxTotalCostUsdcBaseUnits !== null || quote.maxTotalCostUsdcBaseUnits !== null
    || prepared.nativePriceUsdMicros !== null || prepared.usdcPriceUsdMicros !== null
    || !isRecord(cost)
    || !isUnsignedText(cost.walletLamports)
    || BigInt(cost.walletLamports) < BigInt(prepared.feeLamports) + BigInt(prepared.rentLamports)
    || cost.maxFeeLamports !== quote.maxFeeLamports
    || cost.associatedAccountRentLamports !== quote.rentLamports
    || cost.actualQuotedFeeLamports !== quote.feeLamports
    || cost.rentPerAccountLamports !== quote.costEvidence.rentPerAccountLamports
    || cost.sourceSlot !== prepared.source.slot
    || !Number.isSafeInteger(cost.feeQuoteSlot) || cost.feeQuoteSlot < prepared.source.slot
    || cost.nativePriceUsdMicros !== null || cost.usdcPriceUsdMicros !== null
    || cost.nativePriceObservedAt !== null || cost.usdcPriceObservedAt !== null || cost.priceMaxAgeSeconds !== null
    || !isRecord(setup) || Object.keys(setup).length !== 2 || setup.quoteId !== quote.quoteId
    || !Array.isArray(setup.accounts) || setup.accounts.length !== quote.accounts.length) return false;
  return setup.accounts.every((account, index) => {
    const expected = quote.accounts[index];
    return isRecord(account) && Object.keys(account).length === 5
      && account.address === expected.address
      && account.mint === expected.mint
      && account.owner === expected.owner
      && account.tokenProgram === expected.tokenProgram
      && account.wasMissing === !expected.exists;
  });
}

function ownerActionMatches(action, context) {
  const prepared = action?.prepared;
  const effects = prepared?.expectedEffects;
  const source = prepared?.source;
  if (!isRecord(action) || typeof action.actionId !== 'string' || !isRecord(prepared)
    || prepared.schemaVersion !== 1 || prepared.chain !== 'solana' || prepared.network !== 'mainnet-beta'
    || prepared.wallet !== context.sessionWallet || !['redeem', 'fee', 'setup'].includes(prepared.action)
    || !isUnsignedText(prepared.amountBaseUnits)
    || (prepared.action !== 'setup' && !positiveBaseUnits(prepared.amountBaseUnits))
    || !isUnsignedText(prepared.feeLamports) || !isUnsignedText(prepared.rentLamports)
    || typeof prepared.transactionBase64 !== 'string' || !prepared.transactionBase64.length
    || !/^[a-f0-9]{64}$/i.test(prepared.messageSha256 ?? '')
    || typeof prepared.blockhash !== 'string' || !prepared.blockhash
    || !Number.isSafeInteger(prepared.lastValidBlockHeight) || prepared.lastValidBlockHeight < 0
    || typeof prepared.observedAt !== 'string' || !Number.isFinite(Date.parse(prepared.observedAt))
    || typeof prepared.expiresAt !== 'string' || !Number.isFinite(Date.parse(prepared.expiresAt))
    || !isRecord(effects)
    || !['usdcDebitBaseUnits', 'usdcCreditBaseUnits', 'receiptDebitBaseUnits', 'receiptCreditBaseUnits']
      .every(field => isUnsignedText(effects[field]))
    || !isRecord(source) || !Number.isSafeInteger(source.slot) || source.slot < 0
    || typeof source.programId !== 'string' || !source.programId
    || typeof source.adapterVersion !== 'string' || !source.adapterVersion
    || typeof prepared.recipient !== 'string' || !prepared.recipient) return false;
  if (prepared.action === 'setup') return setupOwnerActionMatches(prepared, effects, context);
  if (prepared.action === 'redeem') {
    const position = context.overview?.portfolio?.positions?.find(item => item.reserveAddress === prepared.reserveAddress);
    return prepared.amountUnit === 'receipt-base-units'
      && typeof prepared.reserveAddress === 'string' && prepared.reserveAddress.length > 0
      && prepared.recipient === context.sessionWallet
      && Number.isSafeInteger(position?.receiptDecimals)
      && position.receiptDecimals >= 0 && position.receiptDecimals <= 255;
  }
  return prepared.amountUnit === 'usdc-base-units'
    && prepared.reserveAddress === null
    && prepared.recipient === context.overview?.configuration?.feeRecipient;
}

/** UI-side financial and authority gates; all handlers repeat these checks before making a request. */
export function canPerformLendingOperation(operation, context = {}) {
  const { overview, sessionWallet, walletAddress } = context;
  const config = overview?.configuration;
  const linked = matchesLinkedWallet(overview, context);
  const now = context.now ?? Date.now();
  const feesConfigured = validOperatorTerms(config);
  const setupReady = isSetupReady(overview, sessionWallet, now, context.actionRecords);
  const executionReady = overview?.status === 'READY'
    && setupReady
    && config?.walletProviderConfigured === true
    && config?.executionEnabled === true
    && feesConfigured
    && linked;
  if (context.loadBusy && !['refresh', 'reconcile', 'verify-delegation', 'verify-revocation', 'pause'].includes(operation)) return false;
  if (context.loadError && !['refresh', 'reconcile', 'verify-delegation', 'verify-revocation', 'pause'].includes(operation)) return false;
  const unresolvedAction = hasUnresolvedActions(overview, context.actionRecords);
  const uncertain = Boolean(context.uncertain);
  if (context.busy && operation !== 'refresh' && operation !== 'reconcile' && operation !== 'verify-delegation' && operation !== 'verify-revocation') return false;
  if (uncertain && !['refresh', 'reconcile', 'verify-delegation', 'verify-revocation', 'allow-after-review', 'pause'].includes(operation)) return false;
  if (uncertain && operation === 'pause' && context.uncertain?.operation === 'pause' && context.uncertain?.refreshed !== true) return false;

  switch (operation) {
    case 'refresh': return Boolean(context.sessionToken);
    case 'link-wallet': return Boolean(sessionWallet && walletAddress === sessionWallet
      && context.walletReady && context.walletAuthenticated
      && config?.walletProviderConfigured === true
      && overview?.walletLink?.walletAddress !== sessionWallet);
    case 'quote-account-setup': return Boolean(context.sessionToken && linked
      && config?.walletProviderConfigured === true
      && !hasUnresolvedSetupAction(overview, context.actionRecords)
      && context.ownerAction?.prepared?.action !== 'setup');
    case 'prepare-account-setup': {
      const quote = overview?.setupQuote;
      return Boolean(context.sessionToken && linked
        && config?.walletProviderConfigured === true && Boolean(context.signTransaction)
        && !unresolvedAction && !context.ownerAction
        && overview?.setupStatus === 'REQUIRED'
        && isRecord(quote) && validSetupQuote(quote) && quote.status === 'QUOTED'
        && quote.wallet === sessionWallet
        && context.setupQuoteId === quote.quoteId
        && overview.setupObservedAt === quote.observedAt
        && Date.parse(quote.expiresAt) > now
        && setupNativeDeficitLamports(quote) === '0');
    }
    case 'save-mandate': return setupReady && linked && config?.walletProviderConfigured === true && feesConfigured && context.mandateValid === true;
    case 'prepare-delegation': return executionReady && hasCurrentMandate(overview, now)
      && overview?.delegation?.status !== 'ACTIVE' && !context.delegationPreview;
    case 'install-delegation': return executionReady && overview?.delegation?.status !== 'ACTIVE'
      && isRecord(context.delegationPreview)
      && Array.isArray(context.delegationPreview.policyIds) && context.delegationPreview.policyIds.length > 0
      && context.delegationPreview.policyIds.every(id => typeof id === 'string' && id.length > 0)
      && Array.isArray(context.delegationPreview.summary) && context.delegationPreview.summary.length > 0
      && context.delegationPreview.summary.every(item => typeof item === 'string' && item.length > 0)
      && typeof context.delegationPreview.policyHash === 'string' && context.delegationPreview.policyHash.length > 0
      && typeof context.delegationPreview.signerId === 'string' && context.delegationPreview.signerId.length > 0
      && Number.isFinite(Date.parse(context.delegationPreview.expiresAt))
      && Date.parse(context.delegationPreview.expiresAt) > Date.now()
      && context.delegationConfirmed === true && Boolean(context.addSigners);
    case 'verify-delegation': return Boolean(context.sessionToken && linked && (overview?.delegation || context.delegationCheckRequired));
    case 'capture': return setupReady && linked && config?.walletProviderConfigured === true;
    case 'start': return executionReady && hasCurrentMandate(overview, now)
      && isActiveDelegation(overview, now)
      && hasFreshPortfolio(overview, now)
      && !unresolvedAction && !context.ownerAction
      && ['STOPPED', 'PAUSED'].includes(overview?.runner?.state);
    case 'pause': return Boolean(sessionWallet && overview?.runner?.state === 'RUNNING');
    case 'prepare-revocation': return linked && ['ACTIVE', 'EXPIRED'].includes(overview?.delegation?.status)
      && Boolean(context.removeAllDelegatedSigners)
      && !context.revocationPreview;
    case 'remove-all-signers': return linked && context.revocationConfirmed === true
      && validRevocationPreview(context.revocationPreview, overview, walletAddress)
      && Boolean(context.removeAllDelegatedSigners);
    case 'verify-revocation': return Boolean(sessionWallet && context.revocationPreview && context.revocationVerifyRequired);
    case 'withdraw': {
      if (!linked || overview?.portfolio?.status !== 'OBSERVED' || !context.withdrawAmountBaseUnits
        || unresolvedAction || context.ownerAction) return false;
      const position = overview.portfolio.positions.find(item => item.reserveAddress === context.selectedPosition);
      return Boolean(position && isUnsignedText(position.redeemableBaseUnits)
        && positiveBaseUnits(context.withdrawAmountBaseUnits)
        && BigInt(context.withdrawAmountBaseUnits) <= BigInt(position.redeemableBaseUnits));
    }
    case 'fee-claim': return linked && feesConfigured && !unresolvedAction && !context.ownerAction
      && positiveBaseUnits(overview?.accounting?.earnedFeeBaseUnits);
    case 'sign-owner-action': return linked && context.ownerApproval === true
      && ownerActionMatches(context.ownerAction, context)
      && context.signedActionUnknown !== context.ownerAction.actionId
      && Date.parse(context.ownerAction.prepared.expiresAt) > now
      && Boolean(context.signTransaction);
    case 'reconcile': return Boolean(context.sessionToken && typeof context.actionId === 'string' && context.actionId.length > 0);
    case 'allow-after-review': return uncertain && context.uncertain?.refreshed === true && context.allowAfterReview === true;
    default: return false;
  }
}

function createRequestId() {
  const cryptoProvider = globalThis.crypto;
  if (typeof cryptoProvider?.randomUUID !== 'function') throw new Error('Secure UUID generation is unavailable in this browser. No request was sent.');
  const id = cryptoProvider.randomUUID();
  if (!UUID_TEXT.test(id)) throw new Error('Secure UUID generation returned an invalid request ID. No request was sent.');
  return id;
}

function decodeBase64(value) {
  if (typeof value !== 'string' || !value.length || value.length % 4 !== 0 || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value)) return null;
  try {
    const binary = atob(value);
    return Uint8Array.from(binary, character => character.charCodeAt(0));
  } catch { return null; }
}

function errorMessage(error) {
  return typeof error?.message === 'string' && error.message
    ? error.message
    : 'The lending service request failed. Refresh retained state before deciding what to do next.';
}

function displayMoney(value, decimals = 6, symbol = 'USDC') {
  const amount = formatBaseUnits(value, decimals);
  return amount === null ? 'Unavailable' : `${amount} ${symbol}`;
}

function displayRate(value) {
  if (!Number.isSafeInteger(value) || value < 0) return 'Unavailable';
  const bps = BigInt(value);
  return `${bps / 100n}.${(bps % 100n).toString().padStart(2, '0')}%`;
}

function displayTime(value) {
  if (typeof value !== 'string' || !Number.isFinite(Date.parse(value))) return 'Time unavailable';
  return `${new Intl.DateTimeFormat('en-GB', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'UTC' }).format(new Date(value))} UTC`;
}

function formFromMandate(data) {
  if (!isRecord(data)) return EMPTY_FORM;
  return {
    capitalCap: baseUnitsInputText(data.capitalCapBaseUnits, 6),
    reserveFloor: baseUnitsInputText(data.reserveFloorBaseUnits, 6),
    maxAction: baseUnitsInputText(data.maxActionBaseUnits, 6),
    maxPositionBps: isUnsignedText(String(data.maxPositionBps ?? '')) ? String(data.maxPositionBps) : '',
    maxFeeLamports: isUnsignedText(data.maxFeeLamports) ? data.maxFeeLamports : '',
    maxEvidenceAgeSeconds: isUnsignedText(String(data.maxEvidenceAgeSeconds ?? '')) ? String(data.maxEvidenceAgeSeconds) : '',
    minHoldingSeconds: isUnsignedText(String(data.minHoldingSeconds ?? '')) ? String(data.minHoldingSeconds) : '',
    minNetBenefit: baseUnitsInputText(data.minNetBenefitBaseUnits, 6),
    cooldownSeconds: isUnsignedText(String(data.cooldownSeconds ?? '')) ? String(data.cooldownSeconds) : '',
    expiresAt: typeof data.expiresAt === 'string' && Number.isFinite(Date.parse(data.expiresAt))
      ? new Date(Date.parse(data.expiresAt) - new Date(data.expiresAt).getTimezoneOffset() * 60_000).toISOString().slice(0, 16)
      : '',
    monitorIntervalSeconds: isUnsignedText(String(data.monitorIntervalSeconds ?? '')) ? String(data.monitorIntervalSeconds) : '',
    maxReviewCalls: isUnsignedText(String(data.maxReviewCalls ?? '')) ? String(data.maxReviewCalls) : '',
  };
}

function actionAmountText(action, overview) {
  if (action?.action === 'setup') return 'Account setup · no USDC or receipt principal';
  if (!isUnsignedText(action?.amountBaseUnits)) return 'Unavailable';
  if (action.amountUnit === 'usdc-base-units') return displayMoney(action.amountBaseUnits);
  if (action.amountUnit === 'receipt-base-units') {
    const position = overview?.portfolio?.positions?.find(item => item.reserveAddress === action.reserveAddress);
    return position ? displayMoney(action.amountBaseUnits, position.receiptDecimals, 'receipt units') : 'Unavailable';
  }
  return 'Unavailable';
}

function updateActionRecords(records, action) {
  if (!isRecord(action) || typeof action.actionId !== 'string') return records;
  const next = Array.isArray(records) ? records.filter(record => record?.actionId !== action.actionId) : [];
  return [{ ...action }, ...next];
}


export default function LendingBot({ session, wallet }) {
  const identity = {
    session,
    sessionWallet: typeof session?.walletAddress === 'string' ? session.walletAddress : null,
    walletAddress: typeof wallet?.walletAddress === 'string' ? wallet.walletAddress : null,
    walletUserId: typeof wallet?.userId === 'string' ? wallet.userId : null,
  };
  const identityRef = useRef(identity);
  identityRef.current = identity;
  const scopeRef = useRef(null);
  if (!scopeRef.current) scopeRef.current = createLendingRequestScope();
  const requestScope = scopeRef.current;
  const identityChanged = requestScope.setIdentity(identity);
  const overviewVersion = useRef(0);
  const overviewReadGeneration = useRef(0);
  const operationRef = useRef({ identity: null, name: null });
  if (identityChanged) {
    overviewVersion.current += 1;
    overviewReadGeneration.current += 1;
    operationRef.current = { identity: null, name: null };
  }

  const [store, setStore] = useState(EMPTY_STORE);
  const storeMatches = sameIdentity(store.identity, identity);
  const state = storeMatches ? store : { ...EMPTY_STORE, identity };
  const retainedSetupQuoteIdRef = useRef(null);
  retainedSetupQuoteIdRef.current = state.overview?.setupQuote?.quoteId ?? null;

  const updateStore = useCallback(update => {
    setStore(previous => {
      const currentIdentity = identityRef.current;
      const base = sameIdentity(previous.identity, currentIdentity)
        ? previous
        : { ...EMPTY_STORE, identity: currentIdentity };
      const next = typeof update === 'function' ? update(base) : { ...base, ...update };
      return { ...next, identity: currentIdentity };
    });
  }, []);

  useEffect(() => () => requestScope.invalidate(), [requestScope]);

  const refreshOverview = useCallback(async () => {
    const current = identityRef.current;
    if (!current.session?.token) return null;
    const ticket = requestScope.capture();
    const readGeneration = ++overviewReadGeneration.current;
    const version = overviewVersion.current;
    updateStore(previous => ({ ...previous, load: { status: previous.overview ? 'refreshing' : 'loading', error: null } }));
    try {
      const response = await lendingMeshRequest(current.session.token, '', undefined);
      if (!requestScope.accepts(ticket, identityRef.current) || overviewVersion.current !== version
        || overviewReadGeneration.current !== readGeneration) return null;
      if (!validOverview(response)) throw new Error('The lending service returned an invalid overview. No balances or readiness are shown.');
      retainedSetupQuoteIdRef.current = response.setupQuote?.quoteId ?? null;
      updateStore(previous => ({
        ...previous,
        overview: response,
        actionRecords: response.actions,
        load: { status: 'ready', error: null },
        mandateForm: previous.mandateDirty || !response.mandate ? previous.mandateForm : formFromMandate(response.mandate.data),
        uncertain: previous.uncertain ? { ...previous.uncertain, refreshed: true } : null,
      }));
      return response;
    } catch (error) {
      if (!requestScope.accepts(ticket, identityRef.current) || overviewVersion.current !== version
        || overviewReadGeneration.current !== readGeneration) return null;
      updateStore(previous => ({ ...previous, load: { status: previous.overview ? 'ready' : 'error', error: errorMessage(error) } }));
      return null;
    }
  }, [requestScope, updateStore]);

  useEffect(() => {
    if (!session?.token) return undefined;
    void refreshOverview();
    return () => { requestScope.invalidate(); };
  }, [session?.token, session?.walletAddress, wallet?.walletAddress, wallet?.userId, refreshOverview, requestScope]);

  const currentContext = useCallback((overrides = {}) => {
    const current = identityRef.current;
    const active = sameIdentity(store.identity, current) ? store : { ...EMPTY_STORE, identity: current };
    const overview = active.overview;
    const built = buildMandateFromForm(active.mandateForm, overview?.configuration);
    return {
      overview,
      setupQuoteId: active.overview?.setupQuote?.quoteId ?? null,
      sessionToken: current.session?.token,
      sessionWallet: current.sessionWallet,
      walletAddress: current.walletAddress,
      walletAuthenticated: wallet?.authenticated === true,
      walletReady: wallet?.ready === true,
      addSigners: wallet?.addSigners,
      removeAllDelegatedSigners: wallet?.removeAllDelegatedSigners,
      signTransaction: wallet?.signTransaction,
      mandateValid: built.mandate !== null,
      delegationPreview: active.delegationPreview,
      delegationConfirmed: active.delegationConfirmed,
      revocationPreview: active.revocationPreview,
      revocationConfirmed: active.revocationConfirmed,
      revocationRemoved: active.revocationRemoved,
      revocationVerifyRequired: active.revocationVerifyRequired,
      selectedPosition: active.selectedPosition,
      withdrawAmountBaseUnits: active.selectedPosition
        ? parseBaseUnitAmount(active.withdrawAmount, overview?.portfolio?.positions?.find(item => item.reserveAddress === active.selectedPosition)?.receiptDecimals ?? -1, { positive: true })
        : null,
      ownerAction: active.ownerAction,
      ownerApproval: active.ownerApproval,
      signedActionUnknown: active.signedActionUnknown,
      actionRecords: active.actionRecords.length ? active.actionRecords : (Array.isArray(overview?.actions) ? overview.actions : []),
      uncertain: active.uncertain,
      loadBusy: ['loading', 'refreshing'].includes(active.load.status),
      loadError: Boolean(active.load.error),
      allowAfterReview: active.allowAfterReview,
      busy: Boolean(active.busy),
      ...overrides,
    };
  }, [store, wallet]);

  const beginOperation = useCallback((name, allowedOperation = name, overrides = {}) => {
    const current = identityRef.current;
    const activeOperation = operationRef.current;
    if (sameIdentity(activeOperation.identity, current) && activeOperation.name) return null;
    const activeStore = sameIdentity(store.identity, current) ? store : { ...EMPTY_STORE, identity: current };
    if (!canPerformLendingOperation(allowedOperation, currentContext({ ...overrides, busy: false }))) return null;
    let requestId;
    try { requestId = createRequestId(); } catch (error) {
      updateStore(previous => ({ ...previous, error: errorMessage(error) }));
      return null;
    }
    const ticket = requestScope.capture();
    operationRef.current = { identity: current, name };
    updateStore(previous => ({ ...previous, busy: name, error: null, notice: null }));
    return { current, ticket, requestId, activeStore };
  }, [currentContext, requestScope, store, updateStore]);

  const finishOperation = useCallback((operation, update) => {
    if (!operation || !requestScope.accepts(operation.ticket, identityRef.current)) return;
    if (sameIdentity(operationRef.current.identity, operation.current) && operationRef.current.name) {
      operationRef.current = { identity: null, name: null };
    }
    updateStore(previous => ({ ...previous, busy: null, ...(update ?? {}) }));
  }, [requestScope, updateStore]);

  const post = useCallback(async (operationName, path, body, onSuccess, {
    allowedOperation = operationName,
    actionId = null,
    retainedSetupQuoteId = undefined,
  } = {}) => {
    const operation = beginOperation(operationName, allowedOperation, { actionId });
    if (!operation) return null;
    let requestSent = false;
    try {
      let response;
      if (retainedSetupQuoteId !== undefined) {
        const outcome = await performIdentityBoundSetupRequest(
          requestScope,
          operation.ticket,
          identityRef,
          retainedSetupQuoteIdRef,
          retainedSetupQuoteId,
          () => {
            const pendingRequest = lendingMeshRequest(operation.current.session.token, path, {
              requestId: operation.requestId,
              ...body,
            });
            requestSent = true;
            return pendingRequest;
          },
        );
        if (!outcome.accepted) {
          if (!requestScope.accepts(operation.ticket, identityRef.current)) return null;
          const preparedActionId = typeof outcome.response?.ownerAction?.actionId === 'string'
            ? outcome.response.ownerAction.actionId : null;
          finishOperation(operation, {
            error: outcome.sent
              ? 'The retained setup quote changed while the request was in flight. Refresh retained state and reconcile any prepared action before continuing.'
              : 'The retained setup quote changed before the request was sent. Read a current account setup quote before continuing.',
            uncertain: outcome.sent && operationName === 'prepare-account-setup'
              ? { operation: operationName, requestId: operation.requestId, actionId: preparedActionId ?? actionId }
              : null,
            allowAfterReview: false,
          });
          return null;
        }
        response = outcome.response;
      } else {
        if (!requestScope.accepts(operation.ticket, identityRef.current)) return null;
        const pendingRequest = lendingMeshRequest(operation.current.session.token, path, {
          requestId: operation.requestId,
          ...body,
        });
        requestSent = true;
        response = await pendingRequest;
      }
      if (!requestScope.accepts(operation.ticket, identityRef.current)) return null;
      const patch = onSuccess(response);
      if (!patch) throw new Error('The lending service response did not match the required operation contract. Do not repeat this request; refresh retained state first.');
      overviewVersion.current += 1;
      finishOperation(operation, patch);
      return response;
    } catch (error) {
      if (!requestScope.accepts(operation.ticket, identityRef.current)) return null;
      finishOperation(operation, {
        error: errorMessage(error),
        uncertain: requestSent ? { operation: operationName, requestId: operation.requestId, actionId } : null,
        allowAfterReview: false,
      });
      return null;
    } finally {
      if (requestScope.accepts(operation.ticket, identityRef.current)
        && sameIdentity(operationRef.current.identity, operation.current)
        && operationRef.current.name === operationName) {
        operationRef.current = { identity: null, name: null };
        updateStore(previous => previous.busy === operationName ? { ...previous, busy: null } : previous);
      }
    }
  }, [beginOperation, finishOperation, requestScope, updateStore]);

  const overview = state.overview;
  const configuration = overview?.configuration;
  const operatorTermsReady = validOperatorTerms(configuration);
  const context = currentContext();
  const can = operation => canPerformLendingOperation(operation, context);

  function setMandateField(field, value) {
    updateStore(previous => ({
      ...previous,
      mandateForm: { ...previous.mandateForm, [field]: value },
      mandateDirty: true,
      mandateErrors: { ...previous.mandateErrors, [field]: undefined },
    }));
  }

  function saveMandate(event) {
    event.preventDefault();
    const built = buildMandateFromForm(state.mandateForm, configuration);
    if (!built.mandate) {
      updateStore(previous => ({ ...previous, mandateErrors: built.errors, error: 'Review the highlighted mandate fields. No mandate was sent.' }));
      return;
    }
    void post('save-mandate', '/mandate', { mandate: built.mandate }, response => {
      if (!isRecord(response?.mandate) || typeof response.mandate.id !== 'string' || !isRecord(response.mandate.data)) return null;
      return {
        overview: { ...overview, mandate: response.mandate },
        mandateForm: formFromMandate(response.mandate.data),
        mandateDirty: false,
        mandateErrors: {},
        notice: 'Mandate saved. It does not start the runner or authorize a transaction.',
      };
    });
  }

  function linkWallet() {
    void post('link-wallet', '/wallet-link', {}, response => {
      if (!isRecord(response?.walletLink) || response.walletLink.walletAddress !== identityRef.current.sessionWallet
        || typeof response.walletLink.providerWalletId !== 'string' || !response.walletLink.providerWalletId) return null;
      return {
        overview: { ...overview, walletLink: response.walletLink },
        notice: `Privy wallet linked to the verified Falcon session for ${response.walletLink.walletAddress}.`,
      };
    });
  }

  function quoteAccountSetup() {
    const retainedSetupQuoteId = retainedSetupQuoteIdRef.current;
    void post('quote-account-setup', '/accounts/quote', {}, response => {
      const quote = response?.setupQuote;
      if (!isRecord(quote) || !validSetupQuote(quote)
        || quote.wallet !== identityRef.current.sessionWallet) return null;
      const setupStatus = quote.status === 'READY' ? 'READY' : quote.status === 'QUOTED' ? 'REQUIRED' : 'UNAVAILABLE';
      retainedSetupQuoteIdRef.current = quote.quoteId ?? null;
      return {
        overview: {
          ...overview,
          setupQuote: quote,
          setupStatus,
          setupObservedAt: quote.observedAt,
          setupIssues: quote.reasons,
        },
        notice: quote.status === 'QUOTED'
          ? 'A current setup quote is retained. This read moved no funds.'
          : quote.status === 'READY'
            ? 'A current account read confirms that no setup transaction is needed.'
            : `The account read is unavailable: ${quote.reasons.join(', ')}`,
      };
    }, { allowedOperation: 'quote-account-setup', retainedSetupQuoteId });
  }

  function prepareAccountSetup() {
    const quote = overview?.setupQuote;
    const freshContext = currentContext();
    if (!canPerformLendingOperation('prepare-account-setup', freshContext)) return;
    const quoteId = quote.quoteId;
    void post('prepare-account-setup', '/accounts/prepare', { quoteId }, response => {
      const ownerAction = response?.ownerAction;
      if (!isRecord(ownerAction) || !ownerActionMatches(ownerAction, { ...freshContext, overview })) return null;
      return {
        ownerAction,
        ownerApproval: false,
        signedActionUnknown: null,
        notice: 'Unsigned owner setup prepared. Review the exact wallet, accounts, native costs, expiry, and zero-principal effects before signing.',
      };
    }, { allowedOperation: 'prepare-account-setup', retainedSetupQuoteId: quoteId });
  }

  function prepareDelegation() {
    void post('prepare-delegation', '/delegation/prepare', {}, response => {
      const delegation = response?.delegation;
      if (!isRecord(delegation) || !Array.isArray(delegation.policyIds) || delegation.policyIds.length === 0
        || !delegation.policyIds.every(id => typeof id === 'string' && id.length > 0)
        || typeof delegation.policyHash !== 'string' || !delegation.policyHash
        || typeof delegation.signerId !== 'string' || !delegation.signerId
        || typeof delegation.expiresAt !== 'string' || !Number.isFinite(Date.parse(delegation.expiresAt))
        || Date.parse(delegation.expiresAt) <= Date.now()
        || !Array.isArray(delegation.summary) || delegation.summary.length === 0
        || !delegation.summary.every(item => typeof item === 'string' && item.length > 0)) return null;
      return {
        delegationPreview: delegation,
        delegationConfirmed: false,
        delegationCheckRequired: false,
        notice: 'Policy preview prepared. No signer was installed and no financial action was authorized.',
      };
    });
  }

  function verifyDelegation() {
    void post('verify-delegation', '/delegation', {}, response => {
      const delegation = response?.delegation;
      if (!isRecord(delegation) || !['ACTIVE', 'REVOKED', 'EXPIRED', 'UNAVAILABLE'].includes(delegation.status)) return null;
      const active = delegation.status === 'ACTIVE';
      const verifiedTerminal = ['REVOKED', 'EXPIRED'].includes(delegation.status);
      const preview = state.delegationPreview;
      return {
        overview: {
          ...overview,
          delegation: {
            ...overview.delegation,
            ...delegation,
            ...(active && preview ? {
              policyIds: preview.policyIds,
              policyHash: preview.policyHash,
              signerId: preview.signerId,
              expiresAt: preview.expiresAt,
              summary: preview.summary,
            } : {}),
          },
        },
        delegationPreview: active || verifiedTerminal ? null : preview,
        delegationConfirmed: false,
        delegationCheckRequired: delegation.status === 'UNAVAILABLE',
        uncertain: null,
        notice: `Provider delegation verification: ${delegation.status}${delegation.reason ? ` · ${delegation.reason}` : ''}`,
      };
    }, { allowedOperation: 'verify-delegation' });
  }

  async function installDelegation() {
    const current = currentContext();
    if (!canPerformLendingOperation('install-delegation', current)) return;
    const operation = beginOperation('install-delegation', 'install-delegation');
    if (!operation) return;
    let signerRequestAttempted = false;
    try {
      const preview = operation.activeStore.delegationPreview;
      signerRequestAttempted = true;
      const signerChange = await performIdentityBoundOwnerSdkAction(
        requestScope,
        operation.ticket,
        identityRef,
        () => wallet.addSigners([{ signerId: preview.signerId, policyIds: [...preview.policyIds] }]),
      );
      if (!signerChange.accepted) return;
      const response = await lendingMeshRequest(operation.current.session.token, '/delegation', { requestId: operation.requestId });
      if (!requestScope.accepts(operation.ticket, identityRef.current)) return;
      const delegation = response?.delegation;
      if (!isRecord(delegation) || !['ACTIVE', 'REVOKED', 'EXPIRED', 'UNAVAILABLE'].includes(delegation.status)) {
        throw new Error('Privy accepted the signer change, but Falcon could not verify its current status. Do not add another signer; use Verify delegation.');
      }
      const active = delegation.status === 'ACTIVE';
      const mergedDelegation = {
        ...overview.delegation,
        ...delegation,
        ...(active ? {
          policyIds: preview.policyIds,
          policyHash: preview.policyHash,
          signerId: preview.signerId,
          expiresAt: preview.expiresAt,
          summary: preview.summary,
        } : {}),
      };
      overviewVersion.current += 1;
      finishOperation(operation, {
        overview: { ...overview, delegation: mergedDelegation },
        delegationPreview: active ? null : preview,
        delegationConfirmed: false,
        delegationCheckRequired: !active,
        uncertain: null,
        notice: active
          ? 'Falcon verified the installed provider signer as active.'
          : `The customer signer update returned, but Falcon did not verify an active delegation (${delegation.status}). Do not install it again; use Verify current signer state.`,
      });
    } catch (error) {
      if (!requestScope.accepts(operation.ticket, identityRef.current)) return;
      finishOperation(operation, {
        error: errorMessage(error),
        delegationCheckRequired: signerRequestAttempted,
        uncertain: signerRequestAttempted ? { operation: 'delegation-verify', requestId: operation.requestId, actionId: null } : null,
        notice: signerRequestAttempted ? 'The customer signer update may have succeeded. Do not install it again; verify current provider state first.' : null,
      });
    } finally {
      if (requestScope.accepts(operation.ticket, identityRef.current)
        && sameIdentity(operationRef.current.identity, operation.current)) {
        operationRef.current = { identity: null, name: null };
        updateStore(previous => previous.busy === 'install-delegation' ? { ...previous, busy: null } : previous);
      }
    }
  }

  function capturePortfolio() {
    void post('capture', '/capture', {}, response => {
      if (!isRecord(response?.portfolio) || !validPortfolio(response.portfolio)) return null;
      return { overview: { ...overview, portfolio: response.portfolio }, notice: 'A real owner portfolio observation was captured. Missing data remains unavailable.' };
    });
  }

  function startRunner() {
    void post('start', '/start', {}, response => {
      if (!isRecord(response?.runner) || !['STOPPED', 'RUNNING', 'PAUSED', 'REVOKED', 'BLOCKED'].includes(response.runner.state)) return null;
      return { overview: { ...overview, runner: response.runner }, notice: `Runner state: ${response.runner.state}.` };
    });
  }

  function pauseRunner() {
    void post('pause', '/pause', {}, response => {
      if (!isRecord(response?.runner) || !['STOPPED', 'RUNNING', 'PAUSED', 'REVOKED', 'BLOCKED'].includes(response.runner.state)) return null;
      return { overview: { ...overview, runner: response.runner }, notice: `Runner state: ${response.runner.state}.` };
    });
  }

  function prepareRevocation() {
    void post('prepare-revocation', '/revoke/prepare', {}, response => {
      const preview = response?.revocation;
      if (!validRevocationPreview(preview, overview, identityRef.current.sessionWallet)) return null;
      return {
        overview: { ...overview, runner: { ...overview.runner, state: 'PAUSED', nextRunAt: null } },
        revocationPreview: preview,
        revocationConfirmed: false,
        revocationRemoved: false,
        revocationVerifyRequired: false,
        notice: 'The worker is paused. This preview lists every additional signer that will be removed from this dedicated Falcon wallet.',
      };
    }, { allowedOperation: 'prepare-revocation' });
  }

  async function removeAllDelegatedSigners() {
    const current = currentContext();
    if (!canPerformLendingOperation('remove-all-signers', current)) return;
    const operation = beginOperation('remove-all-signers', 'remove-all-signers');
    if (!operation) return;
    let removalAttempted = false;
    let removalReturned = false;
    try {
      removalAttempted = true;
      const signerRemoval = await performIdentityBoundOwnerSdkAction(
        requestScope,
        operation.ticket,
        identityRef,
        () => wallet.removeAllDelegatedSigners(),
      );
      if (!signerRemoval.accepted) return;
      removalReturned = true;
      const response = await lendingMeshRequest(operation.current.session.token, '/revoke', {
        requestId: operation.requestId,
      });
      if (!requestScope.accepts(operation.ticket, identityRef.current)) return;
      if (!isRecord(response?.runner) || !isRecord(response?.delegation)
        || !['STOPPED', 'RUNNING', 'PAUSED', 'REVOKED', 'BLOCKED'].includes(response.runner.state)
        || typeof response.delegation.status !== 'string') {
        throw new Error('The provider signer change completed, but Falcon did not return a valid revocation verification. Keep the worker paused and verify again.');
      }
      const verified = response.delegation.status === 'REVOKED';
      const remaining = response.delegation.status === 'ACTIVE';
      overviewVersion.current += 1;
      finishOperation(operation, {
        overview: { ...overview, runner: response.runner, delegation: { ...overview.delegation, ...response.delegation } },
        revocationRemoved: verified,
        revocationVerifyRequired: !verified && !remaining,
        revocationPreview: verified || remaining ? null : operation.activeStore.revocationPreview,
        revocationConfirmed: false,
        uncertain: null,
        notice: verified
          ? 'Falcon verified that all additional signers are revoked. The customer owner remains unchanged.'
          : remaining
            ? 'The server still observes an active delegation. The worker remains paused; prepare a fresh authoritative revocation preview before any further signer change.'
            : `Falcon could not verify revocation (${response.delegation.status}). The worker remains paused; verify again without repeating the Privy removal.`,
      });
    } catch (error) {
      if (!requestScope.accepts(operation.ticket, identityRef.current)) return;
      finishOperation(operation, {
        error: errorMessage(error),
        revocationRemoved: removalReturned,
        revocationVerifyRequired: removalAttempted,
        revocationConfirmed: removalAttempted ? false : operation.activeStore.revocationConfirmed,
        uncertain: removalAttempted ? { operation: 'revoke-verify', requestId: operation.requestId, actionId: null } : null,
        notice: removalAttempted
          ? 'Privy removal was attempted but its final state is unconfirmed. The worker remains paused; verify with Falcon before any retry.'
          : 'The signer removal action did not start. The worker remains paused and no revoked state is claimed.',
      });
    } finally {
      if (requestScope.accepts(operation.ticket, identityRef.current)
        && sameIdentity(operationRef.current.identity, operation.current)) {
        operationRef.current = { identity: null, name: null };
        updateStore(previous => previous.busy === 'remove-all-signers' ? { ...previous, busy: null } : previous);
      }
    }
  }

  function verifyRevocation() {
    void post('verify-revocation', '/revoke', {}, response => {
      if (!isRecord(response?.runner) || !isRecord(response?.delegation)
        || !['STOPPED', 'RUNNING', 'PAUSED', 'REVOKED', 'BLOCKED'].includes(response.runner.state)
        || typeof response.delegation.status !== 'string') return null;
      const verified = response.delegation.status === 'REVOKED';
      const remaining = response.delegation.status === 'ACTIVE';
      return {
        overview: { ...overview, runner: response.runner, delegation: { ...overview.delegation, ...response.delegation } },
        revocationRemoved: verified,
        revocationVerifyRequired: !verified && !remaining,
        revocationPreview: verified || remaining ? null : state.revocationPreview,
        revocationConfirmed: false,
        uncertain: null,
        notice: verified
          ? 'Falcon verified that all additional signers are revoked. The customer owner remains unchanged.'
          : remaining
            ? 'Falcon still observes an active delegation. The worker remains paused; prepare a fresh authoritative revocation preview before any further signer change.'
            : `Falcon could not verify revocation (${response.delegation.status}). Keep the worker paused and retry only this verification.`,
      };
    }, { allowedOperation: 'verify-revocation' });
  }


  function selectedPosition() {
    return overview?.portfolio?.positions?.find(item => item.reserveAddress === state.selectedPosition) ?? null;
  }

  function prepareWithdrawal() {
    const position = selectedPosition();
    const amountBaseUnits = parseBaseUnitAmount(state.withdrawAmount, position?.receiptDecimals ?? -1, { positive: true });
    const freshContext = currentContext({ selectedPosition: state.selectedPosition, withdrawAmountBaseUnits: amountBaseUnits });
    if (!canPerformLendingOperation('withdraw', freshContext)) return;
    void post('withdraw', '/withdraw', {
      reserveAddress: position.reserveAddress,
      receiptBaseUnits: amountBaseUnits,
    }, response => {
      const ownerAction = response?.ownerAction;
      if (!isRecord(ownerAction) || !ownerActionMatches(ownerAction, { ...freshContext, overview })
        || ownerAction.prepared.action !== 'redeem'
        || ownerAction.prepared.reserveAddress !== position.reserveAddress
        || ownerAction.prepared.amountBaseUnits !== amountBaseUnits) return null;
      return {
        ownerAction: response.ownerAction,
        ownerApproval: false,
        signedActionUnknown: null,
        notice: 'Unsigned owner withdrawal prepared. Review the exact receipt amount, recipient, costs, expiry, and transaction bytes before signing.',
      };
    }, { allowedOperation: 'withdraw' });
  }

  function prepareFeeClaim() {
    void post('fee-claim', '/fee-claim', {}, response => {
      const ownerAction = response?.ownerAction;
      if (!isRecord(ownerAction) || !ownerActionMatches(ownerAction, { ...context, overview })
        || ownerAction.prepared.action !== 'fee') return null;
      return {
        ownerAction: response.ownerAction,
        ownerApproval: false,
        signedActionUnknown: null,
        notice: 'Unsigned fee transfer prepared. Review the exact USDC amount and trusted recipient before signing.',
      };
    });
  }

  async function signOwnerAction() {
    const freshContext = currentContext();
    if (!canPerformLendingOperation('sign-owner-action', freshContext)) return;
    const action = state.ownerAction;
    const bytes = decodeBase64(action?.prepared?.transactionBase64);
    if (!bytes || bytes.length <= 64) {
      updateStore(previous => ({ ...previous, error: 'The exact prepared transaction bytes are invalid. No signature was requested.' }));
      return;
    }
    const operation = beginOperation('sign-owner-action', 'sign-owner-action', { ownerAction: action });
    if (!operation) return;
    let signatureObtained = false;
    try {
      const signedResult = await performIdentityBoundOwnerSdkAction(
        requestScope,
        operation.ticket,
        identityRef,
        () => wallet.signTransaction(bytes),
      );
      if (!signedResult.accepted) return;
      const signed = signedResult.result;
      if (!(signed instanceof Uint8Array) || signed.length <= 64) throw new Error('The wallet did not return complete signed transaction bytes. No submission was registered.');
      signatureObtained = true;
      const response = await lendingMeshRequest(operation.current.session.token, '/owner-signatures', {
        requestId: operation.requestId,
        actionId: action.actionId,
        signedTransactionBase64: bytesToBase64(signed),
      });
      if (!requestScope.accepts(operation.ticket, identityRef.current)) return;
      if (!isRecord(response?.action) || response.action.actionId !== action.actionId || typeof response.action.status !== 'string') {
        throw new Error('The service returned an invalid owner-action registration. Reconcile this action; do not sign it again.');
      }
      overviewVersion.current += 1;
      finishOperation(operation, {
        overview: { ...overview, actions: updateActionRecords(overview?.actions, response.action) },
        actionRecords: updateActionRecords(state.actionRecords.length ? state.actionRecords : overview?.actions, response.action),
        ownerAction: null,
        ownerApproval: false,
        signedActionUnknown: null,
        uncertain: null,
        notice: `Owner signature registered. Current action state: ${response.action.status}. Any broadcast is handled by Falcon only after exact verification and persistence.`,
      });
      if (action.prepared.action === 'setup' && response.action.status === 'CONFIRMED') void refreshOverview();
    } catch (error) {
      if (!requestScope.accepts(operation.ticket, identityRef.current)) return;
      finishOperation(operation, {
        error: errorMessage(error),
        signedActionUnknown: signatureObtained ? action.actionId : null,
        uncertain: signatureObtained ? { operation: 'owner-signatures', requestId: operation.requestId, actionId: action.actionId } : null,
        notice: signatureObtained
          ? 'A signature was produced, but registration outcome is unknown. Do not sign again; reconcile this exact action.'
          : 'The wallet did not return an accepted signature. No signature registration was sent.',
      });
    } finally {
      if (requestScope.accepts(operation.ticket, identityRef.current)
        && sameIdentity(operationRef.current.identity, operation.current)) {
        operationRef.current = { identity: null, name: null };
        updateStore(previous => previous.busy === 'sign-owner-action' ? { ...previous, busy: null } : previous);
      }
    }
  }

  async function reconcileAction(actionId) {
    const ownerAction = state.ownerAction?.actionId === actionId ? state.ownerAction : null;
    const retainedActions = state.actionRecords.length ? state.actionRecords : overview?.actions;
    const retainedAction = Array.isArray(retainedActions)
      ? retainedActions.find(action => action?.actionId === actionId)
      : null;
    const isSetup = ownerAction?.prepared?.action === 'setup' || retainedAction?.action === 'setup';
    const response = await post('reconcile', '/reconcile', { actionId }, result => {
      if (!isRecord(result?.action) || result.action.actionId !== actionId || typeof result.action.status !== 'string') return null;
      const terminal = ['CONFIRMED', 'FAILED'].includes(result.action.status);
      return {
        overview: { ...overview, actions: updateActionRecords(overview?.actions, result.action) },
        actionRecords: updateActionRecords(state.actionRecords.length ? state.actionRecords : overview?.actions, result.action),
        ownerAction: state.ownerAction?.actionId === actionId ? null : state.ownerAction,
        ownerApproval: state.ownerAction?.actionId === actionId ? false : state.ownerApproval,
        uncertain: terminal ? null : state.uncertain,
        signedActionUnknown: terminal && state.signedActionUnknown === actionId ? null : state.signedActionUnknown,
        notice: `Action ${actionId} reconciliation: ${result.action.status}${result.action.reason ? ` · ${result.action.reason}` : ''}`,
      };
    }, { allowedOperation: 'reconcile', actionId });
    if (isSetup && response?.action?.status === 'CONFIRMED') await refreshOverview();
  }

  function clearUncertaintyAfterReview() {
    if (!state.allowAfterReview || !state.uncertain?.refreshed) return;
    const refreshRevocationScope = ['remove-all-signers', 'revoke-verify'].includes(state.uncertain.operation);
    updateStore(previous => ({
      ...previous,
      uncertain: null,
      allowAfterReview: false,
      error: null,
      ...(refreshRevocationScope ? {
        revocationPreview: null,
        revocationConfirmed: false,
        revocationRemoved: false,
        revocationVerifyRequired: false,
      } : {}),
      notice: 'You confirmed you reviewed the refreshed server state. Any new operation will use a fresh request ID and require a separate action.',
    }));
  }

  function changePosition(reserveAddress) {
    updateStore(previous => ({ ...previous, selectedPosition: reserveAddress, withdrawAmount: '' }));
  }

  const availableReserves = Array.isArray(configuration?.availableReserves) ? configuration.availableReserves : [];
  const positions = overview?.portfolio?.status === 'OBSERVED' && Array.isArray(overview.portfolio.positions)
    ? overview.portfolio.positions : [];
  const chosenPosition = selectedPosition();
  const withdrawalBaseUnits = chosenPosition
    ? parseBaseUnitAmount(state.withdrawAmount, chosenPosition.receiptDecimals, { positive: true })
    : null;
  const receiptMax = chosenPosition && isUnsignedText(chosenPosition.redeemableBaseUnits)
    ? formatBaseUnits(chosenPosition.redeemableBaseUnits, chosenPosition.receiptDecimals)
    : null;
  const actionRecords = state.actionRecords.length ? state.actionRecords : (Array.isArray(overview?.actions) ? overview.actions : []);
  const feeAmount = overview?.accounting?.earnedFeeBaseUnits;
  const feeClaimRecipient = configuration?.feeRecipient;
  const unresolvedActions = actionRecords.filter(action => actionStatusNeedsReconcile(action?.status));
  const activePrepared = state.ownerAction;
  const prepared = activePrepared?.prepared;
  const currentActionCanSign = Boolean(activePrepared && canPerformLendingOperation('sign-owner-action', context));
  const operatorFeeText = Number.isSafeInteger(configuration?.feeBps)
    ? `${displayRate(configuration.feeBps)} of eligible net yield` : 'Unavailable';
  const mandateCurrent = hasCurrentMandate(overview);
  const delegationCurrent = isActiveDelegation(overview);
  const portfolioEvidenceFresh = hasFreshPortfolio(overview);
  const setupQuote = overview?.setupQuote;
  const setupQuoteHasFacts = isRecord(setupQuote) && ['QUOTED', 'READY'].includes(setupQuote.status);
  const setupQuoteForWallet = setupQuoteHasFacts
    && setupQuote.wallet === identityRef.current.sessionWallet
    && setupQuote.wallet === identityRef.current.walletAddress;
  const setupQuoteExpired = setupQuoteForWallet && Date.parse(setupQuote.expiresAt) <= Date.now();
  const setupDeficitLamports = setupQuoteForWallet ? setupNativeDeficitLamports(setupQuote) : null;
  const setupReady = isSetupReady(overview, identityRef.current.sessionWallet, Date.now(), actionRecords)
    && matchesLinkedWallet(overview, context);
  const setupCosts = overview?.setupCosts ?? null;
  const setupReasons = Array.from(new Set([
    ...(Array.isArray(overview?.setupIssues) ? overview.setupIssues : []),
    ...(Array.isArray(setupQuote?.reasons) ? setupQuote.reasons : []),
  ]));
  const nativeUsdcMint = availableReserves.find(item => typeof item?.mint === 'string')?.mint ?? null;

  return <section className="lending-bot" aria-labelledby="lending-bot-title">
    <header className="lending-bot-header">
      <div>
        <p className="lending-bot-eyebrow">Customer-controlled · Solana mainnet-beta</p>
        <h2 id="lending-bot-title">Stablecoin lending</h2>
        <p>Fund and manage your own wallet. Falcon may operate only within the saved policy and verified additional signer; every withdrawal or fee transfer still needs your exact transaction signature.</p>
      </div>
      <button className="owner-button owner-button--quiet" type="button" disabled={!can('refresh') || Boolean(state.busy) || ['loading', 'refreshing'].includes(state.load.status)} onClick={() => void refreshOverview()} aria-busy={state.load.status === 'loading' || state.load.status === 'refreshing'}>
        {state.load.status === 'refreshing' ? 'Refreshing…' : 'Refresh retained state'}
      </button>
    </header>

    {(state.load.status === 'loading' || state.load.status === 'idle') && <p className="owner-auth-status" role="status" aria-live="polite">Loading owner-bound lending status. No capture, policy, signer, or financial action is started by this read.</p>}
    {state.load.status === 'error' && <div className="owner-auth-error" role="alert">
      <strong>Lending status is unavailable.</strong><p>{state.load.error}</p>
      <button className="owner-button owner-button--quiet" type="button" disabled={Boolean(state.busy) || ['loading', 'refreshing'].includes(state.load.status)} onClick={() => void refreshOverview()}>Retry status read</button>
    </div>}
    {state.load.status === 'ready' && state.load.error && <p className="lending-bot-alert" role="status">The latest status refresh failed. Displayed balances retain their previous observation time, and new owner actions are paused. {state.load.error}</p>}
    {overview && <>
      <div className="lending-bot-state-strip" aria-label="Lending account state">
        <div><span>Service</span><strong>{overview.status}</strong></div>
        <div><span>Runner</span><strong>{overview.runner.state}</strong></div>
        <div><span>Delegation</span><strong>{overview.delegation?.status ?? 'NOT INSTALLED'}</strong></div>
        <div><span>Next run</span><strong>{overview.runner.nextRunAt ? displayTime(overview.runner.nextRunAt) : 'Not scheduled'}</strong></div>
      </div>

      <section className="lending-bot-panel" aria-labelledby="lending-account-title">
        <div className="lending-panel-heading">
          <div><p className="lending-bot-eyebrow">Account and funding</p><h3 id="lending-account-title">Your wallet, your funds</h3></div>
          <span className={`owner-status-tag${matchesLinkedWallet(overview, context) ? '' : ' owner-status-tag--caution'}`}>
            {matchesLinkedWallet(overview, context) ? 'Wallet linked' : 'Wallet not linked'}
          </span>
        </div>
        <dl className="lending-account-grid">
          <div><dt>Verified customer wallet</dt><dd><code>{session?.walletAddress ?? 'Unavailable'}</code></dd></div>
          <div><dt>Funding network</dt><dd>Solana mainnet-beta</dd></div>
          <div><dt>Native USDC mint</dt><dd><code>{nativeUsdcMint ?? 'Unavailable'}</code></dd></div>
          <div><dt>Observed USDC cash</dt><dd>{displayMoney(overview.portfolio?.cashBaseUnits)}</dd></div>
          <div><dt>Observed SOL for network fees</dt><dd>{displayMoney(overview.portfolio?.nativeLamports, 9, 'SOL')}</dd></div>
          <div><dt>Last capture</dt><dd>{overview.portfolio?.capturedAt ? displayTime(overview.portfolio.capturedAt) : 'Not captured'}</dd></div>
        </dl>
        <p className="lending-bot-note">No funding is initiated here. USDC funding and capture guidance appear only after current canonical accounts are verified READY.</p>
        {!matchesLinkedWallet(overview, context) && overview.walletLink?.walletAddress !== session?.walletAddress && <button className="owner-button owner-button--primary" type="button" disabled={!can('link-wallet') || Boolean(state.busy)} onClick={linkWallet} aria-busy={state.busy === 'link-wallet'}>
          {state.busy === 'link-wallet' ? 'Verifying Privy ownership…' : 'Link this verified embedded wallet'}
        </button>}
        {overview.walletLink?.walletAddress && overview.walletLink.walletAddress !== session?.walletAddress && <p className="lending-bot-alert" role="alert">The service link belongs to a different wallet. No action is available until the exact embedded wallet signs in to FalconOS.</p>}
      </section>

      <section className="lending-bot-panel lending-setup-panel" aria-labelledby="lending-setup-title">
        <div className="lending-panel-heading">
          <h3 id="lending-setup-title">Canonical account setup</h3>
          <span className={`owner-status-tag${setupReady ? '' : ' owner-status-tag--caution'}`}>{overview.setupStatus.replace(/_/g, ' ')}</span>
        </div>
        <p className="lending-bot-note">The setup quote covers only the exact fee and rent for missing canonical accounts, not future lending-worker transactions. After setup and any USDC transfer, capture again for a fresh SOL balance; review the runner’s current HOLD or refusal reason before starting. Falcon will not top up SOL automatically.</p>
        {!matchesLinkedWallet(overview, context) && <p className="lending-bot-alert" role="status">Select and link this exact embedded wallet to the verified Falcon session before requesting a setup quote.</p>}
        {configuration?.walletProviderConfigured !== true && <div className="lending-bot-alert" role="alert">
          <strong>Provider account reads are not configured.</strong>
          {configuration?.issues?.filter(issue => typeof issue === 'string').length > 0
            ? <ul className="lending-issues">{configuration.issues.filter(issue => typeof issue === 'string').map((issue, index) => <li key={`${issue}-${index}`}>{issue}</li>)}</ul>
            : <p>Fix the provider read configuration before observing setup accounts.</p>}
        </div>}
        {wallet?.ready && typeof wallet.signTransaction !== 'function' && <p className="lending-bot-alert" role="status">The selected owner wallet does not expose Solana transaction signing in this SDK session. Account setup preparation is unavailable.</p>}
        {setupCosts && <div className="lending-setup-costs">
          <h4>Finalized setup costs to date</h4>
          <dl className="lending-setup-metrics">
            <div><dt>Network fees paid</dt><dd>{displayMoney(setupCosts.feeLamports, 9, 'SOL')}</dd></div>
            <div><dt>Account rent paid</dt><dd>{displayMoney(setupCosts.rentLamports, 9, 'SOL')}</dd></div>
            <div><dt>Known USDC-valued cost</dt><dd>{setupCosts.knownCostUsdcBaseUnits === null ? 'Unknown' : displayMoney(setupCosts.knownCostUsdcBaseUnits)}</dd></div>
          </dl>
          <p className="lending-bot-note">{setupCosts.hasUnpricedCost
            ? 'At least one finalized setup cost has no trusted USD valuation. The known USDC figure is a subtotal, not the complete cost.'
            : setupCosts.knownCostUsdcBaseUnits === null
              ? 'No trusted USD valuation is available for retained setup costs.'
              : 'The known USDC value covers all retained finalized setup costs.'}</p>
        </div>}
        <div className="lending-actions">
          <button className="owner-button owner-button--quiet" type="button" disabled={!can('quote-account-setup') || Boolean(state.busy) || Boolean(state.uncertain)} onClick={quoteAccountSetup} aria-busy={state.busy === 'quote-account-setup'}>
            {state.busy === 'quote-account-setup' ? 'Reading canonical accounts…' : setupQuoteHasFacts ? 'Re-read account setup' : overview.setupStatus === 'UNAVAILABLE' ? 'Retry account setup read' : 'Read account setup'}
          </button>
          {setupQuote?.status === 'QUOTED' && <button className="owner-button owner-button--primary" type="button" disabled={!can('prepare-account-setup') || Boolean(state.busy) || Boolean(state.uncertain)} onClick={prepareAccountSetup} aria-busy={state.busy === 'prepare-account-setup'}>
            {state.busy === 'prepare-account-setup' ? 'Preparing exact owner setup…' : 'Prepare owner setup'}
          </button>}
        </div>
        {overview.setupStatus === 'NOT_OBSERVED' && !setupQuote && <p className="lending-empty" role="status">No setup observation is retained. Read the canonical accounts and exact costs before sending SOL.</p>}
        {overview.setupStatus === 'REQUIRED' && !setupQuote && <p className="lending-bot-alert" role="status">Setup is required, but no current account quote is retained. Read setup accounts before funding or preparing a transaction.</p>}
        {setupQuote?.status === 'NO_DATA' && <div className="lending-bot-alert" role="alert">
          <strong>Canonical account setup is unavailable.</strong>
          <p>No account balance or setup readiness is inferred from this observation.</p>
        </div>}
        {setupQuoteHasFacts && !setupQuoteForWallet && <p className="lending-bot-alert" role="alert">The retained setup quote belongs to a different wallet. No quoted amounts or account addresses are shown as current; re-read for the verified wallet.</p>}
        {setupQuoteHasFacts && setupQuoteForWallet && <>
          {setupQuoteExpired && <p className="lending-bot-alert" role="status">This account quote has expired. Its amounts are historical only; re-read before preparing setup or using its balance.</p>}
          <dl className="lending-setup-metrics">
            <div><dt>Quote status</dt><dd>{setupQuote.status}</dd></div>
            <div><dt>Owner wallet</dt><dd><code>{setupQuote.wallet}</code></dd></div>
            <div><dt>Native SOL observed</dt><dd>{displayMoney(setupQuote.nativeBalanceLamports, 9, 'SOL')}</dd></div>
            <div><dt>Observed</dt><dd>{displayTime(setupQuote.observedAt)} · slot {setupQuote.slot}</dd></div>
            {setupQuote.status === 'QUOTED' ? <>
              <div><dt>Quoted network fee</dt><dd>{displayMoney(setupQuote.feeLamports, 9, 'SOL')}<small>Fee cap: {displayMoney(setupQuote.maxFeeLamports, 9, 'SOL')}</small></dd></div>
              <div><dt>Quoted account rent</dt><dd>{displayMoney(setupQuote.rentLamports, 9, 'SOL')}</dd></div>
              <div><dt>Exact SOL shortfall at quote</dt><dd>{setupDeficitLamports === null ? 'Unavailable' : displayMoney(setupDeficitLamports, 9, 'SOL')}</dd></div>
              <div><dt>Cost valuation (USDC)</dt><dd>{setupQuote.maxTotalCostUsdcBaseUnits === null ? 'Unknown' : displayMoney(setupQuote.maxTotalCostUsdcBaseUnits)}</dd></div>
              <div><dt>Quote expiry</dt><dd>{displayTime(setupQuote.expiresAt)}</dd></div>
            </> : <>
              <div><dt>Additional setup fee/rent</dt><dd>Not required for READY accounts</dd></div>
              <div><dt>Historical setup costs</dt><dd>{setupCosts ? 'See finalized cost summary above' : 'Not summarized; no zero is inferred'}</dd></div>
              <div><dt>Observation validity</dt><dd>{setupQuote.expiresAt === null ? 'No quote expiry' : displayTime(setupQuote.expiresAt)}</dd></div>
            </>}
          </dl>
          {setupQuote.status === 'QUOTED' && setupQuote.maxTotalCostUsdcBaseUnits === null && <p className="lending-bot-note">No trusted USD valuation was available for this quote; native SOL fee and rent remain separate known amounts.</p>}
          {setupQuote.status === 'READY' && <p className="lending-bot-note">READY means no new setup transaction is needed. A null native balance or USD valuation remains unknown; historical expenses are shown separately.</p>}
          <h4>Canonical token-account observations</h4>
          <p className="lending-bot-note">The wallet address is the owner. Each address below is a distinct token account controlled by that wallet.</p>
          <ul className="lending-setup-account-list" aria-label="Canonical token-account observations">
            {setupQuote.accounts.map(account => <li key={account.address}>
              <div className="lending-setup-account-heading">
                <strong>{nativeUsdcMint && account.mint === nativeUsdcMint ? 'Native USDC token account' : nativeUsdcMint ? 'Reserve receipt token account' : 'Token account'}</strong>
                <span>{account.exists ? 'Present at observation' : 'Missing · verified absent'}</span>
              </div>
              <dl className="lending-setup-account-details">
                <div><dt>Token-account address</dt><dd><code>{account.address}</code></dd></div>
                <div><dt>Mint</dt><dd><code>{account.mint}</code></dd></div>
                <div><dt>Owner wallet</dt><dd><code>{account.owner}</code></dd></div>
                <div><dt>Token program</dt><dd><code>{account.tokenProgram}</code></dd></div>
                <div><dt>Observed balance</dt><dd>{nativeUsdcMint && account.mint === nativeUsdcMint
                  ? displayMoney(account.balanceBaseUnits, 6, 'USDC')
                  : `${account.balanceBaseUnits} token base units`}</dd></div>
              </dl>
            </li>)}
          </ul>
          {setupQuote.status === 'QUOTED' && isRecord(setupQuote.costEvidence) && <details className="lending-technical-details"><summary>Quote cost evidence</summary>
            <dl className="lending-setup-account-details">
              <div><dt>Cost source slot</dt><dd>{setupQuote.costEvidence.sourceSlot}</dd></div>
              <div><dt>Fee quote slot</dt><dd>{setupQuote.costEvidence.feeQuoteSlot}</dd></div>
              <div><dt>Rent per account</dt><dd>{displayMoney(setupQuote.costEvidence.rentPerAccountLamports, 9, 'SOL')}</dd></div>
              <div><dt>Accounts missing</dt><dd>{setupQuote.costEvidence.missingAccountCount}</dd></div>
            </dl>
          </details>}
        </>}
        {setupQuoteHasFacts && setupQuoteForWallet && setupQuote.status === 'QUOTED'
          && !setupQuoteExpired && setupDeficitLamports !== null && BigInt(setupDeficitLamports) > 0n
          && <p className="lending-bot-alert" role="status">At this quote, the exact shortfall is {displayMoney(setupDeficitLamports, 9, 'SOL')}. If you choose to fund SOL, do so externally to {setupQuote.wallet}, then re-read the quote. This is fee plus rent with no added buffer; the amount may change on re-observation.</p>}
        {setupQuoteHasFacts && setupQuoteForWallet && setupQuote.status === 'QUOTED'
          && !setupQuoteExpired && setupDeficitLamports === '0'
          && <p className="lending-bot-note">At this observation the wallet covers the quoted fee and rent. Prepare is available only for this unexpired retained quote and its missing canonical accounts.</p>}
        {setupReady && <p className="lending-bot-status" role="status">All three canonical accounts are verified READY at {displayTime(overview.setupObservedAt)}. You may now send native USDC externally to the displayed owner wallet after confirming Solana mainnet-beta and the native USDC mint. Falcon does not fund the wallet. After the transfer settles, use Capture current portfolio for a fresh read.</p>}
        {(overview.setupStatus === 'READY' || setupQuote?.status === 'READY') && !setupReady && <p className="lending-bot-alert" role="status">
          {overview.setupStatus === 'READY' && setupQuote?.status !== 'READY'
            ? 'Service status is READY but the retained quote is not a matching READY account observation. A later capture may have changed setup status; explicitly re-read setup accounts before funding USDC.'
            : 'The READY account observation does not match service status, the selected linked wallet, or current action history. Do not fund USDC; re-read setup accounts or reconcile the exact setup action first.'}
        </p>}
        {setupReasons.length > 0 && <ul className="lending-issues" aria-label="Account setup issues">{setupReasons.map((issue, index) => <li key={`${issue}-${index}`}><code>{issue}</code></li>)}</ul>}
        {activePrepared?.prepared?.action === 'setup' && <div className="lending-review-card" aria-labelledby="lending-setup-review-title">
          <h4 id="lending-setup-review-title">Review exact owner setup transaction</h4>
          <p>This transaction creates only the missing canonical token accounts below. Your wallet pays the quoted SOL fee and rent. It transfers no USDC or receipt principal and does not fund the wallet.</p>
          <dl className="lending-review-data">
            <div><dt>Action ID</dt><dd><code>{activePrepared.actionId}</code></dd></div>
            <div><dt>Quote ID</dt><dd><code>{prepared.accountSetup.quoteId}</code></dd></div>
            <div><dt>Network</dt><dd>Solana mainnet-beta</dd></div>
            <div><dt>Wallet owner</dt><dd><code>{prepared.wallet}</code></dd></div>
            <div><dt>Recipient</dt><dd><code>{prepared.recipient}</code></dd></div>
            <div><dt>Token principal</dt><dd>0 USDC / 0 receipt units</dd></div>
            <div><dt>Network fee</dt><dd>{displayMoney(prepared.feeLamports, 9, 'SOL')}</dd></div>
            <div><dt>Rent</dt><dd>{displayMoney(prepared.rentLamports, 9, 'SOL')}</dd></div>
            <div><dt>SOL balance at preparation</dt><dd>{displayMoney(prepared.costEvidence.walletLamports, 9, 'SOL')}</dd></div>
            <div><dt>Observed</dt><dd>{displayTime(prepared.observedAt)} · slot {prepared.source.slot}</dd></div>
            <div><dt>Expiry</dt><dd>{displayTime(prepared.expiresAt)}</dd></div>
            <div><dt>Blockhash</dt><dd><code>{prepared.blockhash}</code></dd></div>
            <div><dt>Last valid block height</dt><dd>{prepared.lastValidBlockHeight}</dd></div>
            <div><dt>Program</dt><dd><code>{prepared.source.programId}</code></dd></div>
            <div><dt>Adapter version</dt><dd>{prepared.source.adapterVersion}</dd></div>
            <div><dt>Message SHA-256</dt><dd><code>{prepared.messageSha256}</code></dd></div>
          </dl>
          <ul className="lending-setup-account-list" aria-label="Accounts in the exact setup action">
            {prepared.accountSetup.accounts.map(account => <li key={account.address}>
              <div className="lending-setup-account-heading">
                <strong>{account.wasMissing ? 'Will create' : 'Already present · unchanged'}</strong>
              </div>
              <dl className="lending-setup-account-details">
                <div><dt>Token-account address</dt><dd><code>{account.address}</code></dd></div>
                <div><dt>Mint</dt><dd><code>{account.mint}</code></dd></div>
                <div><dt>Owner wallet</dt><dd><code>{account.owner}</code></dd></div>
                <div><dt>Token program</dt><dd><code>{account.tokenProgram}</code></dd></div>
              </dl>
            </li>)}
          </ul>
          <details className="lending-technical-details" open><summary>Exact unsigned bytes and expected effects</summary>
            <code className="lending-transaction-bytes">{prepared.transactionBase64}</code>
            <pre>{JSON.stringify(prepared.expectedEffects, null, 2)}</pre>
          </details>
          {state.signedActionUnknown === activePrepared.actionId && <p className="lending-bot-alert" role="alert">A signature may already be registered. Do not sign again; reconcile this exact setup action.</p>}
          {state.uncertain?.actionId === activePrepared.actionId && <button className="owner-button owner-button--quiet" type="button" disabled={!canPerformLendingOperation('reconcile', { sessionToken: session?.token, actionId: activePrepared.actionId }) || Boolean(state.busy)} onClick={() => void reconcileAction(activePrepared.actionId)} aria-busy={state.busy === 'reconcile'}>Reconcile exact setup action</button>}
          {!state.signedActionUnknown && <label className="lending-confirmation"><input type="checkbox" checked={state.ownerApproval} onChange={event => updateStore(previous => ({ ...previous, ownerApproval: event.target.checked }))} />
            <span>I reviewed the exact wallet, canonical accounts, SOL costs, expiry, and transaction bytes. I authorize this owner signature only; it moves no USDC or receipt principal.</span>
          </label>}
          <button className="owner-button owner-button--primary" type="button" disabled={!currentActionCanSign || Boolean(state.busy) || Boolean(state.uncertain)} onClick={() => void signOwnerAction()} aria-busy={state.busy === 'sign-owner-action'}>
            {state.busy === 'sign-owner-action' ? 'Waiting for owner signature and registration…' : 'Sign exact owner setup'}
          </button>
          <button className="owner-button owner-button--quiet" type="button" disabled={Boolean(state.busy)} onClick={() => updateStore(previous => ({ ...previous, ownerAction: null, ownerApproval: false }))}>Close unsigned review</button>
        </div>}
      </section>

      <section className="lending-bot-panel" aria-labelledby="lending-positions-title">
        <div className="lending-panel-heading">
          <div><p className="lending-bot-eyebrow">Live observation</p><h3 id="lending-positions-title">Positions and fees</h3></div>
          <button className="owner-button owner-button--primary" type="button" disabled={!can('capture') || Boolean(state.busy)} onClick={capturePortfolio} aria-busy={state.busy === 'capture'}>
            {state.busy === 'capture' ? 'Capturing…' : 'Capture current portfolio'}
          </button>
        </div>
        {overview.portfolio?.status === 'OBSERVED' && positions.length > 0 ? <div className="lending-position-grid">
          {positions.map(position => <article className="lending-position" key={position.reserveAddress}>
            <div className="lending-position-heading"><strong>Kamino reserve position</strong><span>{displayRate(position.supplyApyBps)} observed APY</span></div>
            <dl>
              <div><dt>Receipt units</dt><dd>{displayMoney(position.receiptBaseUnits, position.receiptDecimals, 'receipt units')}</dd></div>
              <div><dt>Observed USDC value</dt><dd>{displayMoney(position.usdcValueBaseUnits)}</dd></div>
              <div><dt>Currently redeemable</dt><dd>{displayMoney(position.redeemableBaseUnits, position.receiptDecimals, 'receipt units')}</dd></div>
              <div><dt>Evidence cutoff</dt><dd>{displayTime(position.observedAt)}</dd></div>
            </dl>
            <details className="lending-technical-details"><summary>Reserve identity</summary><code>{position.reserveAddress}</code><code>{position.marketAddress}</code><code>{position.receiptMint}</code></details>
          </article>)}
        </div> : <div className="lending-empty" role="status">
          <strong>{overview.portfolio?.status === 'NO_DATA' ? 'Portfolio data is unavailable' : overview.portfolio?.status === 'OBSERVED' ? 'No supported reserve position is present in this observation' : 'No portfolio snapshot has been captured'}</strong>
          <p>{overview.portfolio?.issues?.filter(item => typeof item === 'string').join(' ') || (setupReady ? 'Use Capture current portfolio to request a real read-only observation. Missing data is not shown as zero.' : 'Portfolio capture is unavailable until current canonical account setup is verified READY.')}</p>
        </div>}
        <dl className="lending-fee-grid">
          <div><dt>Deposits recorded</dt><dd>{displayMoney(overview.accounting?.depositsBaseUnits)}</dd></div>
          <div><dt>Withdrawals recorded</dt><dd>{displayMoney(overview.accounting?.withdrawalsBaseUnits)}</dd></div>
          <div><dt>Net gain recorded</dt><dd>{displayMoney(overview.accounting?.netGainBaseUnits)}</dd></div>
          <div><dt>Accrued operator fee</dt><dd>{displayMoney(overview.accounting?.earnedFeeBaseUnits)}</dd></div>
          <div><dt>Paid operator fee</dt><dd>{displayMoney(overview.accounting?.paidFeeBaseUnits)}</dd></div>
          <div><dt>High-water mark</dt><dd>{displayMoney(overview.accounting?.highWaterMarkBaseUnits)}</dd></div>
          <div><dt>Trusted recipient</dt><dd><code>{typeof feeClaimRecipient === 'string' && feeClaimRecipient ? feeClaimRecipient : 'Unavailable'}</code></dd></div>
        </dl>
        <p className="lending-bot-note">APY is an observed estimate, not a promised return. Receipt units are not cash equivalents; redemption and usable liquidity are confirmed only by the service's current account evidence.</p>
        {overview.portfolio?.issues?.length > 0 && <ul className="lending-issues">{overview.portfolio.issues.map((issue, index) => typeof issue === 'string' && <li key={`${issue}-${index}`}>{issue}</li>)}</ul>}
        {overview.portfolio?.warnings?.length > 0 && <ul className="lending-issues">{overview.portfolio.warnings.map((warning, index) => <li key={`${warning}-${index}`}>{warning}</li>)}</ul>}
      </section>

      <section className="lending-bot-panel" aria-labelledby="lending-mandate-title">
        <div className="lending-panel-heading">
          <div><p className="lending-bot-eyebrow">Owner-defined limits</p><h3 id="lending-mandate-title">Lending mandate</h3></div>
          {overview.mandate && <span className="owner-status-tag">Saved mandate</span>}
        </div>
        <p className="lending-bot-note">Every money value is entered as an exact decimal and sent as integer base units. No financial limit is prefilled unless it came from your saved mandate. Reserves are fixed to the two service-reviewed identities.</p>
        <div className="lending-trusted-terms" role="group" aria-label="Trusted operator fee terms">
          <div><span>Operator fee</span><strong>{operatorFeeText}</strong></div>
          <div><span>Recipient (read-only)</span><code>{typeof configuration.feeRecipient === 'string' && configuration.feeRecipient ? configuration.feeRecipient : 'Not configured'}</code></div>
        </div>
        {!setupReady && <p className="lending-bot-alert" role="status">Save a mandate and prepare a delegated permit only after current canonical account setup is verified READY.</p>}
        {!operatorTermsReady && <p className="lending-bot-alert" role="alert">Trusted fee terms are not configured. Saving a new mandate and starting the runner are disabled; withdrawals and status recovery remain available.</p>}
        <form className="lending-form" noValidate onSubmit={saveMandate} aria-busy={state.busy === 'save-mandate'}>
          <label className="lending-field"><span>Capital cap (USDC)</span><input type="text" inputMode="decimal" autoComplete="off" value={state.mandateForm.capitalCap} onChange={event => setMandateField('capitalCap', event.target.value)} aria-invalid={Boolean(state.mandateErrors.capitalCap)} aria-describedby="lb-capital-hint lb-capital-error" /><small id="lb-capital-hint">Exact USDC amount; maximum capital subject to the policy.</small><small id="lb-capital-error" className="lending-field-error">{state.mandateErrors.capitalCap ?? ''}</small></label>
          <label className="lending-field"><span>Reserve floor (USDC)</span><input type="text" inputMode="decimal" autoComplete="off" value={state.mandateForm.reserveFloor} onChange={event => setMandateField('reserveFloor', event.target.value)} aria-invalid={Boolean(state.mandateErrors.reserveFloor)} aria-describedby="lb-floor-hint lb-floor-error" /><small id="lb-floor-hint">Exact amount to retain outside supported lending positions.</small><small id="lb-floor-error" className="lending-field-error">{state.mandateErrors.reserveFloor ?? ''}</small></label>
          <label className="lending-field"><span>Maximum action (USDC)</span><input type="text" inputMode="decimal" autoComplete="off" value={state.mandateForm.maxAction} onChange={event => setMandateField('maxAction', event.target.value)} aria-invalid={Boolean(state.mandateErrors.maxAction)} aria-describedby="lb-action-hint lb-action-error" /><small id="lb-action-hint">Per-action upper bound in exact USDC.</small><small id="lb-action-error" className="lending-field-error">{state.mandateErrors.maxAction ?? ''}</small></label>
          <label className="lending-field"><span>Maximum position (basis points)</span><input type="text" inputMode="numeric" autoComplete="off" value={state.mandateForm.maxPositionBps} onChange={event => setMandateField('maxPositionBps', event.target.value)} aria-invalid={Boolean(state.mandateErrors.maxPositionBps)} aria-describedby="lb-position-bps-hint lb-position-bps-error" /><small id="lb-position-bps-hint">0 to 10,000; 10,000 equals 100%.</small><small id="lb-position-bps-error" className="lending-field-error">{state.mandateErrors.maxPositionBps ?? ''}</small></label>
          <label className="lending-field"><span>Maximum network fee (lamports)</span><input type="text" inputMode="numeric" autoComplete="off" value={state.mandateForm.maxFeeLamports} onChange={event => setMandateField('maxFeeLamports', event.target.value)} aria-invalid={Boolean(state.mandateErrors.maxFeeLamports)} aria-describedby="lb-max-fee-hint lb-max-fee-error" /><small id="lb-max-fee-hint">Exact whole lamport limit; no SOL conversion or rounding.</small><small id="lb-max-fee-error" className="lending-field-error">{state.mandateErrors.maxFeeLamports ?? ''}</small></label>
          <label className="lending-field"><span>Maximum evidence age (seconds)</span><input type="text" inputMode="numeric" autoComplete="off" value={state.mandateForm.maxEvidenceAgeSeconds} onChange={event => setMandateField('maxEvidenceAgeSeconds', event.target.value)} aria-invalid={Boolean(state.mandateErrors.maxEvidenceAgeSeconds)} /><small className="lending-field-error">{state.mandateErrors.maxEvidenceAgeSeconds ?? ''}</small></label>
          <label className="lending-field"><span>Minimum holding time (seconds)</span><input type="text" inputMode="numeric" autoComplete="off" value={state.mandateForm.minHoldingSeconds} onChange={event => setMandateField('minHoldingSeconds', event.target.value)} aria-invalid={Boolean(state.mandateErrors.minHoldingSeconds)} /><small className="lending-field-error">{state.mandateErrors.minHoldingSeconds ?? ''}</small></label>
          <label className="lending-field"><span>Minimum net benefit (USDC)</span><input type="text" inputMode="decimal" autoComplete="off" value={state.mandateForm.minNetBenefit} onChange={event => setMandateField('minNetBenefit', event.target.value)} aria-invalid={Boolean(state.mandateErrors.minNetBenefit)} /><small className="lending-field-error">{state.mandateErrors.minNetBenefit ?? ''}</small></label>
          <label className="lending-field"><span>Cooldown (seconds)</span><input type="text" inputMode="numeric" autoComplete="off" value={state.mandateForm.cooldownSeconds} onChange={event => setMandateField('cooldownSeconds', event.target.value)} aria-invalid={Boolean(state.mandateErrors.cooldownSeconds)} /><small className="lending-field-error">{state.mandateErrors.cooldownSeconds ?? ''}</small></label>
          <label className="lending-field"><span>Mandate expiry (local time)</span><input type="datetime-local" value={state.mandateForm.expiresAt} onChange={event => setMandateField('expiresAt', event.target.value)} aria-invalid={Boolean(state.mandateErrors.expiresAt)} /><small className="lending-field-error">{state.mandateErrors.expiresAt ?? ''}</small></label>
          <label className="lending-field"><span>Monitor interval (seconds)</span><input type="text" inputMode="numeric" autoComplete="off" value={state.mandateForm.monitorIntervalSeconds} onChange={event => setMandateField('monitorIntervalSeconds', event.target.value)} aria-invalid={Boolean(state.mandateErrors.monitorIntervalSeconds)} /><small className="lending-field-error">{state.mandateErrors.monitorIntervalSeconds ?? ''}</small></label>
          <label className="lending-field"><span>Maximum review calls</span><input type="text" inputMode="numeric" autoComplete="off" value={state.mandateForm.maxReviewCalls} onChange={event => setMandateField('maxReviewCalls', event.target.value)} aria-invalid={Boolean(state.mandateErrors.maxReviewCalls)} /><small className="lending-field-error">{state.mandateErrors.maxReviewCalls ?? ''}</small></label>
          <div className="lending-field lending-reserve-list"><span>Supported reserves (service-reviewed)</span>
            {availableReserves.length === 2 ? <ul>{availableReserves.map(item => <li key={item.reserveAddress}><strong>{item.symbol || 'Reserve'}</strong><code>{item.reserveAddress}</code><small>Market {item.marketAddress || 'Unavailable'}</small></li>)}</ul> : <p>Exactly two supported reserve identities are required before a mandate can be saved.</p>}
            {state.mandateErrors.reserves && <small className="lending-field-error">{state.mandateErrors.reserves}</small>}
          </div>
          {state.mandateErrors.feeTerms && <p className="lending-field-error lending-form-wide" role="alert">{state.mandateErrors.feeTerms}</p>}
          <button className="owner-button owner-button--primary lending-form-wide" type="submit" disabled={!can('save-mandate') || Boolean(state.busy) || Boolean(state.uncertain)} aria-busy={state.busy === 'save-mandate'}>
            {state.busy === 'save-mandate' ? 'Saving mandate…' : 'Save owner mandate'}
          </button>
        </form>
        {overview.mandate && <details className="lending-technical-details"><summary>Saved mandate evidence</summary><pre>{JSON.stringify(overview.mandate, null, 2)}</pre></details>}
      </section>

      <section className="lending-bot-panel" aria-labelledby="lending-delegation-title">
        <div className="lending-panel-heading"><div><p className="lending-bot-eyebrow">Scoped additional signer</p><h3 id="lending-delegation-title">Review and manage delegation</h3></div></div>
        <p className="lending-bot-note">Preparing a policy does not install a signer. Falcon cannot widen a policy after approval. Installation is a separate customer-authorized Privy action.</p>
        {overview.delegation?.summary?.length > 0 && <ul className="lending-permission-list">{overview.delegation.summary.map((item, index) => <li key={`${item}-${index}`}>{item}</li>)}</ul>}
        {overview.delegation?.reason && <p className="lending-bot-alert" role="status">{overview.delegation.reason}</p>}
        <div className="lending-actions">
          <button className="owner-button owner-button--quiet" type="button" disabled={!can('prepare-delegation') || Boolean(state.busy) || Boolean(state.uncertain)} onClick={prepareDelegation} aria-busy={state.busy === 'prepare-delegation'}>
            {state.busy === 'prepare-delegation' ? 'Preparing exact policy…' : 'Prepare delegation policy'}
          </button>
          {(overview.delegation || state.delegationCheckRequired) && <button className="owner-button owner-button--quiet" type="button" disabled={!can('verify-delegation') || Boolean(state.busy)} onClick={verifyDelegation} aria-busy={state.busy === 'verify-delegation'}>Verify current signer state</button>}
          {['ACTIVE', 'EXPIRED'].includes(overview.delegation?.status) && <button className="owner-button owner-button--danger" type="button" disabled={!can('prepare-revocation') || Boolean(state.busy) || Boolean(state.uncertain)} onClick={prepareRevocation} aria-busy={state.busy === 'prepare-revocation'}>
            {state.busy === 'prepare-revocation' ? 'Pausing and reading signers…' : 'Prepare revoke preview · pauses worker'}
          </button>}
        </div>
        {state.delegationPreview && <div className="lending-review-card" aria-labelledby="lending-delegation-review-title">
          <h4 id="lending-delegation-review-title">Exact permission preview</h4>
          <p>This policy preview does not authorize signing until you install its additional signer. Review every listed rule before continuing.</p>
          <dl className="lending-review-data">
            <div><dt>Signer ID</dt><dd><code>{state.delegationPreview.signerId}</code></dd></div>
            <div><dt>Policy IDs</dt><dd>{state.delegationPreview.policyIds.map(id => <code key={id}>{id}</code>)}</dd></div>
            <div><dt>Policy hash</dt><dd><code>{state.delegationPreview.policyHash}</code></dd></div>
            <div><dt>Expires</dt><dd>{displayTime(state.delegationPreview.expiresAt)}</dd></div>
          </dl>
          {state.delegationPreview.summary.length > 0
            ? <ul className="lending-permission-list">{state.delegationPreview.summary.map((item, index) => <li key={`${item}-${index}`}>{item}</li>)}</ul>
            : <p className="lending-bot-alert" role="alert">No permission summary was returned. Signer installation is blocked.</p>}
          <details className="lending-technical-details"><summary>Exact policy IDs and evidence</summary><pre>{JSON.stringify(state.delegationPreview, null, 2)}</pre></details>
          <label className="lending-confirmation"><input type="checkbox" checked={state.delegationConfirmed} onChange={event => updateStore(previous => ({ ...previous, delegationConfirmed: event.target.checked }))} />
            <span>I reviewed the exact permission scope above and authorize adding this Falcon signer to the dedicated wallet.</span>
          </label>
          <button className="owner-button owner-button--primary" type="button" disabled={!can('install-delegation') || Boolean(state.busy) || Boolean(state.uncertain)} onClick={() => void installDelegation()} aria-busy={state.busy === 'install-delegation'}>
            {state.busy === 'install-delegation' ? 'Waiting for Privy and server verification…' : 'Confirm and install additional signer'}
          </button>
        </div>}
        {state.revocationPreview && <div className="lending-review-card lending-review-card--danger" aria-labelledby="lending-revocation-review-title">
          <h4 id="lending-revocation-review-title">Revoke all additional signers on this dedicated wallet</h4>
          <p>{state.revocationPreview.warning}</p>
          <p>The preview above is the latest observed signer inventory, not an atomic list. At the moment of your action, the Privy SDK removes ALL additional signers then on this dedicated wallet, including any added after the preview. The customer owner is not removed or replaced. Do not continue if this wallet is shared.</p>
          <p>The worker is paused before preview. This action does not remove or replace the customer wallet owner. If this wallet is shared with another signer use case, do not continue.</p>
          <ul className="lending-signer-list">{state.revocationPreview.signerIds.map(id => <li key={id}><code>{id}</code></li>)}</ul>
          <label className="lending-confirmation"><input type="checkbox" checked={state.revocationConfirmed} onChange={event => updateStore(previous => ({ ...previous, revocationConfirmed: event.target.checked }))} />
            <span>I confirm that ALL additional signers present on this dedicated wallet at action time may be removed, including any added after this preview. The displayed list is only the last-read inventory, not a closed signer set. The customer remains the wallet owner.</span>
          </label>
          <button className="owner-button owner-button--danger" type="button" disabled={!can('remove-all-signers') || Boolean(state.busy) || Boolean(state.uncertain)} onClick={() => void removeAllDelegatedSigners()} aria-busy={state.busy === 'remove-all-signers'}>
            {state.busy === 'remove-all-signers' ? 'Revoking and verifying…' : 'Confirm revoke all additional signers'}
          </button>
          {state.revocationVerifyRequired && <button className="owner-button owner-button--quiet" type="button" disabled={!can('verify-revocation') || Boolean(state.busy)} onClick={verifyRevocation} aria-busy={state.busy === 'verify-revocation'}>Verify signer removal with Falcon</button>}
        </div>}
      </section>

      <section className="lending-bot-panel" aria-labelledby="lending-controls-title">
        <div className="lending-panel-heading"><div><p className="lending-bot-eyebrow">Owner controls</p><h3 id="lending-controls-title">Run, pause, or exit</h3></div><span className={`owner-status-tag${overview.runner.state === 'RUNNING' ? '' : ' owner-status-tag--caution'}`}>{overview.runner.state}</span></div>
        {overview.runner.reason && <p className="lending-bot-alert" role="status">{overview.runner.reason}</p>}
        {overview.mandate && !mandateCurrent && <p className="lending-bot-alert" role="status">The saved mandate is expired or has no valid future expiry. Review and save a current owner mandate before starting.</p>}
        {overview.delegation?.status === 'ACTIVE' && !delegationCurrent && <p className="lending-bot-alert" role="status">The delegated signer is expired or has no valid future expiry. Verify or renew it before starting.</p>}
        {overview.portfolio?.status === 'OBSERVED' && !portfolioEvidenceFresh && <p className="lending-bot-alert" role="status">The retained portfolio evidence is older than the mandate permits or has no valid capture time. Capture a fresh observation before starting.</p>}
        <div className="lending-actions">
          <button className="owner-button owner-button--primary" type="button" disabled={!can('start') || Boolean(state.busy) || Boolean(state.uncertain)} onClick={startRunner} aria-busy={state.busy === 'start'}>{state.busy === 'start' ? 'Starting…' : 'Start lending runner'}</button>
          <button className="owner-button owner-button--quiet" type="button" disabled={!can('pause') || Boolean(state.busy)} onClick={pauseRunner} aria-busy={state.busy === 'pause'}>{state.busy === 'pause' ? 'Pausing…' : 'Pause runner'}</button>
        </div>
        {configuration?.issues?.length > 0 && <ul className="lending-issues">{configuration.issues.map((issue, index) => typeof issue === 'string' && <li key={`${issue}-${index}`}>{issue}</li>)}</ul>}
      </section>

      <section className="lending-bot-panel" aria-labelledby="lending-owner-actions-title">
        <div className="lending-panel-heading"><div><p className="lending-bot-eyebrow">Separate owner signatures</p><h3 id="lending-owner-actions-title">Withdraw receipts or settle an earned fee</h3></div></div>
        <p className="lending-bot-note">These wallet actions are never delegated. Each is prepared unsigned, reviewed here, signed once by your embedded wallet, registered with Falcon, and reconciled from retained state. Unpaid fees do not block a receipt withdrawal.</p>
        <div className="lending-owner-action-grid">
          <div className="lending-owner-action-card">
            <h4>Receipt-unit withdrawal</h4>
            {positions.length > 0 ? <>
              <label className="lending-field"><span>Position</span><select value={state.selectedPosition} onChange={event => changePosition(event.target.value)}><option value="">Choose an observed position</option>{positions.map(position => <option value={position.reserveAddress} key={position.reserveAddress}>{position.reserveAddress}</option>)}</select></label>
              <label className="lending-field"><span>Exact receipt amount</span><input type="text" inputMode="decimal" autoComplete="off" value={state.withdrawAmount} onChange={event => updateStore(previous => ({ ...previous, withdrawAmount: event.target.value }))} aria-describedby="lb-withdraw-hint" /><small id="lb-withdraw-hint">{chosenPosition ? `Redeemable: ${receiptMax ?? 'Unavailable'} receipt units · ${chosenPosition.receiptDecimals} decimals. No amount is prefilled.` : 'Select a position with verified receipt-token decimals.'}</small>
                {state.selectedPosition && withdrawalBaseUnits === null && <small className="lending-field-error">Enter a positive amount with no more than the observed receipt precision.</small>}
                {chosenPosition && withdrawalBaseUnits && BigInt(withdrawalBaseUnits) > BigInt(chosenPosition.redeemableBaseUnits) && <small className="lending-field-error">The amount exceeds the currently observed redeemable receipt units.</small>}
              </label>
            </> : <div className="lending-empty"><strong>Withdrawal unavailable</strong><p>A real observed position with receipt decimals is required. Capture portfolio data first.</p></div>}
            <button className="owner-button owner-button--quiet" type="button" disabled={!can('withdraw') || Boolean(state.busy) || Boolean(state.uncertain)} onClick={prepareWithdrawal} aria-busy={state.busy === 'withdraw'}>{state.busy === 'withdraw' ? 'Preparing exact withdrawal…' : 'Prepare owner withdrawal'}</button>
          </div>
          <div className="lending-owner-action-card">
            <h4>Accrued fee transfer</h4>
            <p>Observed accrued amount: <strong>{displayMoney(feeAmount)}</strong></p>
            <p>Trusted recipient: <code>{typeof feeClaimRecipient === 'string' && feeClaimRecipient ? feeClaimRecipient : 'Unavailable'}</code></p>
            <p>This action can only use the service-configured recipient and reconciled positive fee; you cannot enter a recipient or amount.</p>
            <button className="owner-button owner-button--quiet" type="button" disabled={!can('fee-claim') || Boolean(state.busy) || Boolean(state.uncertain)} onClick={prepareFeeClaim} aria-busy={state.busy === 'fee-claim'}>{state.busy === 'fee-claim' ? 'Preparing exact fee transfer…' : 'Prepare earned-fee transfer'}</button>
          </div>
        </div>

        {activePrepared && prepared?.action !== 'setup' && <div className="lending-review-card" aria-labelledby="lending-owner-review-title">
          <h4 id="lending-owner-review-title">Review exact unsigned transaction</h4>
          <p>{prepared.action === 'fee'
            ? 'This is an owner-only USDC transfer to the trusted operator fee recipient. It is not a delegated action.'
            : 'This is an owner-only receipt redemption. It does not require an active worker or payment of outstanding fees.'}</p>
          <dl className="lending-review-data">
            <div><dt>Action ID</dt><dd><code>{activePrepared.actionId}</code></dd></div>
            <div><dt>Action</dt><dd>{prepared.action === 'fee' ? 'Accrued fee transfer' : 'Receipt redemption'}</dd></div>
            <div><dt>Network</dt><dd>Solana mainnet-beta</dd></div>
            <div><dt>Wallet</dt><dd><code>{prepared.wallet}</code></dd></div>
            <div><dt>Recipient</dt><dd><code>{prepared.recipient}</code></dd></div>
            {prepared.reserveAddress && <div><dt>Reserve</dt><dd><code>{prepared.reserveAddress}</code></dd></div>}
            <div><dt>Exact amount</dt><dd>{prepared.action === 'fee'
              ? displayMoney(prepared.amountBaseUnits)
              : actionAmountText({ amountBaseUnits: prepared.amountBaseUnits, amountUnit: prepared.amountUnit, reserveAddress: prepared.reserveAddress }, overview)}</dd></div>
            <div><dt>Network fee</dt><dd>{displayMoney(prepared.feeLamports, 9, 'SOL')}</dd></div>
            <div><dt>Rent</dt><dd>{displayMoney(prepared.rentLamports, 9, 'SOL')}</dd></div>
            <div><dt>Observed at</dt><dd>{displayTime(prepared.observedAt)}</dd></div>
            <div><dt>Blockhash</dt><dd><code>{prepared.blockhash}</code></dd></div>
            <div><dt>Last valid block height</dt><dd>{prepared.lastValidBlockHeight}</dd></div>
            <div><dt>Expiry</dt><dd>{displayTime(prepared.expiresAt)}</dd></div>
            <div><dt>Program</dt><dd><code>{prepared.source.programId}</code></dd></div>
            <div><dt>Source slot</dt><dd>{prepared.source.slot}</dd></div>
            <div><dt>Adapter version</dt><dd>{prepared.source.adapterVersion}</dd></div>
            <div><dt>Message SHA-256</dt><dd><code>{prepared.messageSha256}</code></dd></div>
          </dl>
          <details className="lending-technical-details" open><summary>Exact unsigned transaction bytes and expected effects</summary>
            <code className="lending-transaction-bytes">{prepared.transactionBase64}</code>
            <pre>{JSON.stringify(prepared.expectedEffects ?? null, null, 2)}</pre>
          </details>
          {state.signedActionUnknown === activePrepared.actionId && <p className="lending-bot-alert" role="alert">A signature may already have been registered. Do not sign again; reconcile this exact action.</p>}
          {state.uncertain?.actionId === activePrepared.actionId && <button className="owner-button owner-button--quiet" type="button" disabled={!canPerformLendingOperation('reconcile', { sessionToken: session?.token, actionId: activePrepared.actionId }) || Boolean(state.busy)} onClick={() => reconcileAction(activePrepared.actionId)} aria-busy={state.busy === 'reconcile'}>Reconcile exact action</button>}
          {!state.signedActionUnknown && <label className="lending-confirmation"><input type="checkbox" checked={state.ownerApproval} onChange={event => updateStore(previous => ({ ...previous, ownerApproval: event.target.checked }))} />
            <span>I reviewed the exact recipient, amount, network costs, expiry, and transaction bytes. I authorize my wallet to sign only this action; signing is not reused from Falcon login.</span>
          </label>}
          <button className="owner-button owner-button--primary" type="button" disabled={!currentActionCanSign || Boolean(state.busy) || Boolean(state.uncertain)} onClick={() => void signOwnerAction()} aria-busy={state.busy === 'sign-owner-action'}>
            {state.busy === 'sign-owner-action' ? 'Waiting for owner signature and registration…' : 'Sign exact owner action'}
          </button>
          <button className="owner-button owner-button--quiet" type="button" disabled={Boolean(state.busy)} onClick={() => updateStore(previous => ({ ...previous, ownerAction: null, ownerApproval: false }))}>Close unsigned review</button>
        </div>}

        <div className="lending-retained-actions">
          <div className="lending-panel-heading"><h4>Retained action history</h4></div>
          {actionRecords.length ? <ul className="lending-action-list">{actionRecords.map((action, index) => <li key={action?.actionId ?? index}>
            <div><strong>{action?.action ?? 'Action'} · {action?.status ?? 'UNKNOWN'}</strong><code>{action?.actionId ?? 'Action ID unavailable'}</code></div>
            <p>{actionAmountText(action, overview)}{action?.reserveAddress ? ` · reserve ${action.reserveAddress}` : ''}</p>
            {action?.reason && <p>{action.reason}</p>}
            {action?.signature && <details className="lending-technical-details"><summary>Transaction signature</summary><code>{action.signature}</code></details>}
            {actionStatusNeedsReconcile(action?.status) && <button className="owner-button owner-button--quiet" type="button" disabled={!canPerformLendingOperation('reconcile', { sessionToken: session?.token, actionId: action.actionId }) || Boolean(state.busy)} onClick={() => reconcileAction(action.actionId)} aria-busy={state.busy === 'reconcile'}>Reconcile this action</button>}
          </li>)}</ul> : <p className="lending-empty">No retained action records are available.</p>}
          {unresolvedActions.length > 0 && <p className="lending-bot-note">An unresolved submission remains visible above. Reconcile it before preparing a dependent movement. Unknown is not the same as failed.</p>}
        </div>
      </section>

      {state.uncertain && <div className="lending-bot-alert" role="alert">
        <strong>Request outcome is uncertain: {state.uncertain.operation}.</strong>
        <p>Request ID: <code>{state.uncertain.requestId ?? 'Unavailable'}</code>. Do not repeat, re-sign, or submit this operation. Refresh retained state and reconcile its exact action if an action ID is available.</p>
        {state.uncertain.actionId && <button className="owner-button owner-button--quiet" type="button" disabled={!canPerformLendingOperation('reconcile', { sessionToken: session?.token, actionId: state.uncertain.actionId }) || Boolean(state.busy)} onClick={() => reconcileAction(state.uncertain.actionId)}>Reconcile uncertain action</button>}
        {!state.uncertain.actionId && state.uncertain.refreshed === true && <>
          <label className="lending-confirmation"><input type="checkbox" checked={state.allowAfterReview} onChange={event => updateStore(previous => ({ ...previous, allowAfterReview: event.target.checked }))} />
            <span>I refreshed and reviewed the retained service state. I understand this does not prove the request failed; I will make any new action separately.</span>
          </label>
          <button className="owner-button owner-button--quiet" type="button" disabled={!canPerformLendingOperation('allow-after-review', context)} onClick={clearUncertaintyAfterReview}>Allow a new explicit request after review</button>
        </>}
      </div>}
    </>}
    {state.error && <p className="lending-bot-alert" role="alert">{state.error}</p>}
    {state.notice && <p className="lending-bot-status" role="status" aria-live="polite">{state.notice}</p>}
  </section>;
}
