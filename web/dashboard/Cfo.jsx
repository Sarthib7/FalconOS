import React, { useEffect, useRef, useState } from 'react';
import { bytesToBase64 } from '../app/auth.mjs';
import { meshRequest } from './api.mjs';
import './cfo.css';

const ROOT = '/v1/cfo';
const INTEGER_TEXT = /^(?:0|[1-9][0-9]*)$/;
const TERMINAL_ACTION_STATUSES = new Set(['CONFIRMED', 'REFUNDED', 'FAILED']);
const RECONCILABLE_ACTION_STATUSES = new Set(['SUBMISSION_UNKNOWN', 'SUBMITTED', 'PENDING', 'UNVERIFIED']);
const EMPTY_MANDATE = {
  reserveAssetId: '', reserveFloorBaseUnits: '', maxActionReserveBaseUnits: '',
  maxPositionBps: '', slippageBps: '', maxFeeBps: '', maxEvidenceAgeSeconds: '',
  monitorIntervalSeconds: '', maxMonitorCycles: '',
};
const EMPTY_PLAN = { action: '', sourceAssetId: '', targetAssetId: '', inputBaseUnits: '' };
const LIMIT_FIELDS = [
  ['reserveFloorBaseUnits', 'Reserve floor', 'Base units of the selected reserve token. Enter an exact unsigned integer.'],
  ['maxActionReserveBaseUnits', 'Maximum reserve per action', 'Base units of the selected reserve token. Enter a positive exact integer.'],
  ['maxPositionBps', 'Maximum position size (basis points)', '0 to 10,000 basis points; 10,000 is 100%.'],
  ['slippageBps', 'Maximum slippage (basis points)', '0 to 10,000 basis points.'],
  ['maxFeeBps', 'Maximum fees (basis points)', '0 to 10,000 basis points.'],
  ['maxEvidenceAgeSeconds', 'Maximum evidence age (seconds)', 'A positive whole number.'],
  ['monitorIntervalSeconds', 'Monitor interval (seconds)', 'A positive whole number for read-only monitoring.'],
  ['maxMonitorCycles', 'Maximum monitor cycles', 'A positive whole number; the monitor stops at this limit.'],
];

const isRecord = value => Boolean(value) && typeof value === 'object' && !Array.isArray(value);
const text = value => typeof value === 'string' ? value : '';

function unsignedInteger(value) {
  if (typeof value !== 'string' || !INTEGER_TEXT.test(value)) return null;
  try { return BigInt(value); } catch { return null; }
}

function boundedInteger(value, min, max) {
  const parsed = unsignedInteger(value);
  if (parsed === null || parsed < BigInt(min) || parsed > BigInt(max)) return null;
  return Number(parsed);
}

function validAssetId(value) {
  return typeof value === 'string' && value.length > 0 && value === value.trim() && !/\s/.test(value);
}

/** Exact string formatter for token base units. It never converts a balance to Number. */
export function formatBaseUnits(value, decimals) {
  if (typeof value !== 'string' || !/^\d+$/.test(value)
    || !Number.isSafeInteger(decimals) || decimals < 0 || decimals > 255) return null;
  const normalized = value.replace(/^0+(?=\d)/, '');
  const whole = decimals === 0 ? normalized : normalized.padStart(decimals + 1, '0').slice(0, -decimals);
  const fraction = decimals === 0 ? '' : normalized.padStart(decimals + 1, '0').slice(-decimals);
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return decimals === 0 ? grouped : `${grouped}.${fraction}`;
}
const TOKEN_DECIMALS = value => Number.isSafeInteger(value) && value >= 0 && value <= 255;

/** Converts plain human-unit decimal text to canonical base units without rounding. */
export function parseTokenAmount(value, decimals) {
  if (typeof value !== 'string' || !TOKEN_DECIMALS(decimals)) return null;
  const match = /^([0-9]+)(?:\.([0-9]+))?$/.exec(value);
  if (!match) return null;
  const fraction = match[2] ?? '';
  if (fraction.length > decimals) return null;
  const units = `${match[1]}${fraction.padEnd(decimals, '0')}`.replace(/^0+(?=\d)/, '');
  return units || '0';
}

/** Converts exact base units to ungrouped human-unit text suitable for editing. */
export function baseUnitsInputText(value, decimals) {
  if (typeof value !== 'string' || !/^\d+$/.test(value) || !TOKEN_DECIMALS(decimals)) return null;
  const normalized = value.replace(/^0+(?=\d)/, '');
  if (decimals === 0) return normalized;
  const padded = normalized.padStart(decimals + 1, '0');
  const whole = padded.slice(0, -decimals);
  const fraction = padded.slice(-decimals).replace(/0+$/, '');
  return fraction ? `${whole}.${fraction}` : whole;
}

const TEMPLATE_KEYS = [
  'id', 'version', 'maxPositionBps', 'slippageBps', 'maxFeeBps',
  'maxEvidenceAgeSeconds', 'monitorIntervalSeconds', 'maxMonitorCycles',
];
const TEMPLATE_COPY_FIELDS = [
  'maxPositionBps', 'slippageBps', 'maxFeeBps',
  'maxEvidenceAgeSeconds', 'monitorIntervalSeconds', 'maxMonitorCycles',
];

function validConsumerTemplate(template) {
  if (!isRecord(template) || template.id !== 'falcon-cfo-consumer' || template.version !== 1) return false;
  const keys = Object.keys(template);
  if (keys.length !== TEMPLATE_KEYS.length || keys.some(key => !TEMPLATE_KEYS.includes(key))) return false;
  return Number.isSafeInteger(template.maxPositionBps) && template.maxPositionBps >= 0 && template.maxPositionBps <= 10000
    && Number.isSafeInteger(template.slippageBps) && template.slippageBps >= 0 && template.slippageBps <= 10000
    && Number.isSafeInteger(template.maxFeeBps) && template.maxFeeBps >= 0 && template.maxFeeBps <= 10000
    && Number.isSafeInteger(template.maxEvidenceAgeSeconds) && template.maxEvidenceAgeSeconds > 0
    && Number.isSafeInteger(template.monitorIntervalSeconds) && template.monitorIntervalSeconds > 0
    && Number.isSafeInteger(template.maxMonitorCycles) && template.maxMonitorCycles > 0;
}

/** Copies only validated non-money template values into a fresh local draft. */
export function copyConsumerTemplate(form, template) {
  if (!isRecord(form) || !validConsumerTemplate(template)) return null;
  return {
    ...form,
    ...Object.fromEntries(TEMPLATE_COPY_FIELDS.map(field => [field, String(template[field])])),
  };
}

function parsePercentBps(value) {
  if (typeof value !== 'string') return null;
  const match = /^([0-9]+)(?:\.([0-9]{1,2}))?$/.exec(value);
  if (!match) return null;
  const bps = `${match[1]}${(match[2] ?? '').padEnd(2, '0')}`.replace(/^0+(?=\d)/, '');
  const parsed = unsignedInteger(bps);
  return parsed !== null && parsed <= 10000n ? parsed.toString() : null;
}

function percentInputText(value) {
  const parsed = unsignedInteger(value);
  if (parsed === null || parsed > 10000n) return '';
  const padded = parsed.toString().padStart(3, '0');
  const whole = padded.slice(0, -2);
  const fraction = padded.slice(-2).replace(/0+$/, '');
  return fraction ? `${whole}.${fraction}` : whole;
}

/** Keeps one backend-ordered head per action, placing unresolved heads before terminal history. */
export function actionHeadRecords(records) {
  if (!Array.isArray(records)) return [];
  const seen = new Set();
  const unresolved = [];
  const terminal = [];
  for (const record of records) {
    if (!isRecord(record)) continue;
    const actionId = typeof record.data?.actionId === 'string' && record.data.actionId.length
      ? record.data.actionId : null;
    if (actionId && seen.has(actionId)) continue;
    if (actionId) seen.add(actionId);
    (TERMINAL_ACTION_STATUSES.has(record.data?.status) ? terminal : unresolved).push(record);
  }
  return [...unresolved, ...terminal];
}

/** Creates the exact JSON mandate without ever converting a money amount to Number. */
export function buildMandateFromForm(form, targets, wallet) {
  const errors = {};
  const values = form ?? {};
  const reserveAssetId = text(values.reserveAssetId);
  if (!validAssetId(reserveAssetId)) errors.reserveAssetId = 'Enter the exact reserve asset ID from a real provider or portfolio result.';
  if (!validAssetId(wallet)) errors.wallet = 'A verified wallet session is required.';

  for (const key of ['reserveFloorBaseUnits', 'maxActionReserveBaseUnits']) {
    const amount = unsignedInteger(text(values[key]));
    if (amount === null || (key === 'maxActionReserveBaseUnits' && amount === 0n)) {
      errors[key] = key === 'maxActionReserveBaseUnits'
        ? 'Enter a positive exact integer in base units.'
        : 'Enter an exact unsigned integer in base units.';
    }
  }

  const bounds = {
    maxPositionBps: [0, 10000],
    slippageBps: [0, 10000],
    maxFeeBps: [0, 10000],
    maxEvidenceAgeSeconds: [1, Number.MAX_SAFE_INTEGER],
    monitorIntervalSeconds: [1, Number.MAX_SAFE_INTEGER],
    maxMonitorCycles: [1, Number.MAX_SAFE_INTEGER],
  };
  const numeric = {};
  for (const [key, [min, max]] of Object.entries(bounds)) {
    numeric[key] = boundedInteger(text(values[key]), min, max);
    if (numeric[key] === null) {
      errors[key] = key.endsWith('Bps')
        ? 'Enter a whole number from 0 to 10,000.'
        : 'Enter a positive whole number within the safe integer range.';
    }
  }

  const rows = Array.isArray(targets) ? targets : [];
  const normalizedTargets = [];
  let totalWeight = 0n;
  const seenAssets = new Set();
  rows.forEach((row, index) => {
    const assetId = text(row?.assetId);
    const weightText = text(row?.weightBps);
    if (!assetId && !weightText) return;
    if (!validAssetId(assetId)) {
      errors[`target-${index}-assetId`] = 'Enter the exact asset ID returned or accepted by the service.';
    }
    const weight = boundedInteger(weightText, 1, 10000);
    if (weight === null) errors[`target-${index}-weightBps`] = 'Enter a whole-number weight from 1 to 10,000 basis points.';
    if (validAssetId(assetId)) {
      if (assetId === reserveAssetId) errors[`target-${index}-assetId`] = 'A reserve asset cannot also be a receipt target.';
      if (seenAssets.has(assetId)) errors[`target-${index}-assetId`] = 'Each target asset may appear only once.';
      seenAssets.add(assetId);
    }
    if (weight !== null) {
      totalWeight += BigInt(weight);
      if (validAssetId(assetId)) normalizedTargets.push({ assetId, weightBps: weight });
    }
  });
  if (totalWeight > 10000n) errors.targets = 'Target weights must total no more than 10,000 basis points.';

  if (Object.keys(errors).length) return { mandate: null, errors };
  return {
    mandate: {
      schemaVersion: 1,
      wallet,
      reserveAssetId,
      reserveFloorBaseUnits: values.reserveFloorBaseUnits,
      maxActionReserveBaseUnits: values.maxActionReserveBaseUnits,
      maxPositionBps: numeric.maxPositionBps,
      slippageBps: numeric.slippageBps,
      maxFeeBps: numeric.maxFeeBps,
      maxEvidenceAgeSeconds: numeric.maxEvidenceAgeSeconds,
      targets: normalizedTargets,
      monitorIntervalSeconds: numeric.monitorIntervalSeconds,
      maxMonitorCycles: numeric.maxMonitorCycles,
    },
    errors: {},
  };
}

function currentAddress(walletSession) {
  try {
    const account = walletSession?.current?.();
    return typeof account?.address === 'string' ? account.address : null;
  } catch { return null; }
}

function errorMessage(error) {
  return typeof error?.message === 'string' && error.message
    ? error.message
    : 'The CFO request failed. Refresh the service state before trying again.';
}

function validOverview(value) {
  return isRecord(value)
    && value.schemaVersion === 1
    && (value.mandate === null || isRecord(value.mandate))
    && (value.portfolio === null || isRecord(value.portfolio))
    && Array.isArray(value.plans)
    && value.plans.every(isRecord)
    && Array.isArray(value.actions)
    && value.actions.every(isRecord)
    && isRecord(value.monitor)
    && isRecord(value.readiness)
    && ['NO_DATA', 'BLOCKED'].includes(value.readiness.status)
    && Array.isArray(value.readiness.reasons)
    && value.readiness.reasons.every(reason => typeof reason === 'string');
}

function recordData(record) {
  return isRecord(record?.data) ? record.data : {};
}

function mandateFromRecord(record) {
  const data = recordData(record);
  const value = isRecord(data.mandate) ? data.mandate : data;
  return value?.schemaVersion === 1 && Array.isArray(value.targets) ? value : null;
}

function portfolioFromRecord(record) {
  const data = recordData(record);
  const candidates = [data.portfolio, data.snapshot?.portfolio, data.capture?.portfolio, data];
  return candidates.find(value => isRecord(value) && value.schemaVersion === 1
    && value.chain === 'near' && Array.isArray(value.assets) && Array.isArray(value.balances)) ?? null;
}

function recordStatus(record) {
  const data = recordData(record);
  const choices = [data.status, data.state, data.action?.status, data.review?.status, data.result?.status];
  return choices.find(value => typeof value === 'string' && value.length) ?? 'UNKNOWN';
}

function planReview(record, loadedRecords, latestPlan) {
  const id = typeof record?.id === 'string' ? record.id : null;
  if (id && isRecord(loadedRecords[id]?.review)) return loadedRecords[id].review;
  if (id && isRecord(loadedRecords[id]?.data?.review)) return loadedRecords[id].data.review;
  if (id && latestPlan?.plan?.id === id && isRecord(latestPlan.review)) return latestPlan.review;
  if (isRecord(record?.review)) return record.review;
  const data = recordData(record);
  if (isRecord(data.review)) return data.review;
  if (isRecord(data.plan?.review)) return data.plan.review;
  return null;
}

function reviewEligibility(record, review) {
  const data = recordData(record);
  const action = data.request?.action ?? data.snapshot?.proposal?.action ?? data.proposal?.action ?? data.action;
  const planStatus = data.status ?? data.snapshot?.status;
  const result = isRecord(review) ? review.result ?? review : null;
  if (['redeem', 'rotate'].includes(action) && planStatus === 'REVIEW') {
    if (!review || (isRecord(result) && result.status === 'REVIEW' && !result.lead && !result.risk)) {
      return { allowed: true, reason: 'Deterministic reserve-exit checks passed; no buy endorsement is required for this leg.' };
    }
    return { allowed: false, reason: 'The retained exit review is incomplete or blocked.' };
  }
  if (!review || review.state === 'PENDING' || review.state === 'UNKNOWN') {
    return { allowed: false, reason: 'Lead/Risk review is not complete. Refresh the retained plan before preparing it.' };
  }
  if (review.state && review.state !== 'COMPLETE') {
    return { allowed: false, reason: `Review state is ${review.state}; preparation is unavailable.` };
  }
  if (!isRecord(result) || result.status !== 'REVIEW') {
    return { allowed: false, reason: `The retained review status is ${isRecord(result) ? result.status ?? 'UNKNOWN' : 'UNKNOWN'}; preparation is blocked.` };
  }
  if (result.lead?.status === 'PROPOSED' && result.risk?.status === 'PASS'
    && result.lead.runId === result.runId && result.risk.runId === result.runId
    && result.lead.snapshotHash === result.snapshotHash && result.risk.snapshotHash === result.snapshotHash
    && result.lead.callId !== result.risk.callId
    && typeof result.risk.proposalHash === 'string'
    && result.lead.proposalHash === result.risk.proposalHash) {
    return { allowed: true, reason: 'Lead and independent Risk passed the same retained snapshot.' };
  }
  return { allowed: false, reason: 'A valid Lead proposal and independent Risk pass are not present.' };
}

function assetFor(portfolio, assetId) {
  return portfolio?.assets?.find(asset => asset?.assetId === assetId) ?? null;
}
const ASSET_METADATA_KEYS = ['assetId', 'symbol', 'decimals', 'blockchain', 'contractAddress', 'kind', 'protocol'];

function validObservedAsset(asset) {
  if (!isRecord(asset)) return false;
  const keys = Object.keys(asset);
  return keys.length === ASSET_METADATA_KEYS.length
    && ASSET_METADATA_KEYS.every(key => Object.prototype.hasOwnProperty.call(asset, key))
    && validAssetId(asset.assetId) && asset.assetId.length <= 256
    && typeof asset.symbol === 'string' && asset.symbol.length > 0 && asset.symbol.length <= 64
    && typeof asset.blockchain === 'string' && asset.blockchain.length > 0 && asset.blockchain.length <= 64
    && typeof asset.contractAddress === 'string' && asset.contractAddress.length > 0 && asset.contractAddress.length <= 256
    && Number.isInteger(asset.decimals) && asset.decimals >= 0 && asset.decimals <= 38
    && (asset.kind === 'reserve' || asset.kind === 'receipt')
    && (asset.protocol === null || (typeof asset.protocol === 'string' && asset.protocol.length <= 128));
}

function portfolioInventory(portfolio, wallet) {
  if (!isRecord(portfolio) || portfolio.schemaVersion !== 1 || portfolio.chain !== 'near' || portfolio.network !== 'mainnet'
      || portfolio.status !== 'OBSERVED' || portfolio.wallet !== wallet
      || typeof portfolio.signerId !== 'string' || !/^[0-9a-f]{64}$/.test(portfolio.signerId)
      || typeof portfolio.capturedAt !== 'string' || !Number.isFinite(Date.parse(portfolio.capturedAt))
      || new Date(portfolio.capturedAt).toISOString() !== portfolio.capturedAt
      || !Array.isArray(portfolio.assets) || portfolio.assets.length < 1 || portfolio.assets.length > 16
      || !Array.isArray(portfolio.balances) || portfolio.balances.length !== portfolio.assets.length) return null;
  const assets = new Map();
  for (const asset of portfolio.assets) {
    if (!validObservedAsset(asset) || assets.has(asset.assetId)) return null;
    assets.set(asset.assetId, asset);
  }
  if ([...assets.values()].filter(asset => asset.kind === 'reserve').length !== 1) return null;
  const balances = new Map();
  for (const balance of portfolio.balances) {
    if (!isRecord(balance) || !validAssetId(balance.assetId) || !assets.has(balance.assetId)
        || balances.has(balance.assetId) || unsignedInteger(balance.balanceBaseUnits) === null) return null;
    balances.set(balance.assetId, balance.balanceBaseUnits);
  }
  if (balances.size !== assets.size || [...assets.keys()].some(assetId => !balances.has(assetId))) return null;
  return { assets, balances };
}

function mandateActionContext(overview, wallet) {
  const portfolio = portfolioFromRecord(overview?.portfolio);
  const mandate = mandateFromRecord(overview?.mandate);
  const inventory = portfolioInventory(portfolio, wallet);
  const mandateKeys = [
    'schemaVersion', 'wallet', 'reserveAssetId', 'reserveFloorBaseUnits', 'maxActionReserveBaseUnits',
    'maxPositionBps', 'slippageBps', 'maxFeeBps', 'maxEvidenceAgeSeconds', 'targets',
    'monitorIntervalSeconds', 'maxMonitorCycles',
  ];
  if (!inventory || !mandate || Object.keys(mandate).length !== mandateKeys.length
      || mandateKeys.some(key => !Object.prototype.hasOwnProperty.call(mandate, key))
      || mandate.wallet !== wallet || mandate.schemaVersion !== 1
      || !validAssetId(mandate.reserveAssetId)
      || unsignedInteger(mandate.reserveFloorBaseUnits) === null
      || unsignedInteger(mandate.maxActionReserveBaseUnits) === null
      || unsignedInteger(mandate.maxActionReserveBaseUnits) === 0n
      || !Number.isSafeInteger(mandate.maxPositionBps) || mandate.maxPositionBps < 0 || mandate.maxPositionBps > 10000
      || !Number.isSafeInteger(mandate.slippageBps) || mandate.slippageBps < 0 || mandate.slippageBps > 10000
      || !Number.isSafeInteger(mandate.maxFeeBps) || mandate.maxFeeBps < 0 || mandate.maxFeeBps > 10000
      || !Number.isSafeInteger(mandate.maxEvidenceAgeSeconds) || mandate.maxEvidenceAgeSeconds < 1
      || !Number.isSafeInteger(mandate.monitorIntervalSeconds) || mandate.monitorIntervalSeconds < 1
      || !Number.isSafeInteger(mandate.maxMonitorCycles) || mandate.maxMonitorCycles < 1
      || !Array.isArray(mandate.targets)) return null;
  const captureAgeMs = BigInt(Date.now()) - BigInt(Date.parse(portfolio.capturedAt));
  if (captureAgeMs < 0n || captureAgeMs > BigInt(mandate.maxEvidenceAgeSeconds) * 1000n) return null;
  const reserveAsset = inventory.assets.get(mandate.reserveAssetId);
  if (!reserveAsset || reserveAsset.kind !== 'reserve') return null;
  const targets = [];
  const seenTargets = new Set();
  let targetWeight = 0;
  for (const target of mandate.targets) {
    if (!isRecord(target) || Object.keys(target).length !== 2
        || !Object.prototype.hasOwnProperty.call(target, 'assetId')
        || !Object.prototype.hasOwnProperty.call(target, 'weightBps')
        || !validAssetId(target.assetId) || seenTargets.has(target.assetId)
        || !Number.isSafeInteger(target.weightBps) || target.weightBps < 1 || target.weightBps > 10000) return null;
    const asset = inventory.assets.get(target.assetId);
    if (!asset || asset.kind !== 'receipt') return null;
    seenTargets.add(target.assetId);
    targetWeight += target.weightBps;
    if (targetWeight > 10000) return null;
    targets.push({ ...target, asset });
  }
  return {
    portfolio, mandate, inventory, reserveAsset,
    reserveBalance: inventory.balances.get(mandate.reserveAssetId),
    targets,
  };
}

function amountLabel(baseUnits, assetId, portfolio) {
  if (typeof baseUnits !== 'string') return 'Amount unavailable';
  const asset = assetFor(portfolio, assetId);
  const formatted = asset && Number.isSafeInteger(asset.decimals) ? formatBaseUnits(baseUnits, asset.decimals) : null;
  if (formatted === null) return 'Amount unavailable · verified token decimals are required';
  return asset.symbol ? `${formatted} ${asset.symbol}` : `${formatted} ${assetId}`;
}

function recordIdentifier(record) {
  return typeof record?.data?.actionId === 'string' ? record.data.actionId : record?.id;
}

function preparedQuoteReview(overview, prepared, wallet) {
  const block = reason => ({ valid: false, signingReady: false, reason, record: null, data: null, quote: null });
  if (!prepared || typeof prepared.actionId !== 'string' || typeof prepared.planId !== 'string'
      || typeof prepared.planRecordId !== 'string' || typeof prepared.payload !== 'string') {
    return block('The prepared action context is incomplete.');
  }
  const record = actionHeadRecords(overview?.actions).find(item => item.data?.actionId === prepared.actionId);
  if (!record) return block('The current retained action head is not available. Refresh its retained quote before signing.');
  const data = record.data;
  if (!['PREPARED', 'NEXT_LEG_READY', 'SIGNED', 'SUBMITTED', 'PENDING', 'UNVERIFIED', 'SUBMISSION_UNKNOWN',
    'EXIT_CONFIRMED', 'AWAITING_NEXT_LEG', 'CONFIRMED', 'REFUNDED', 'FAILED'].includes(data.status)) {
    return block(`The current retained action state is ${typeof data.status === 'string' ? data.status : 'UNKNOWN'}; it is not a current prepared quote.`);
  }
  if (data.wallet !== wallet || data.actionId !== prepared.actionId || data.planId !== prepared.planId
      || data.standard !== prepared.standard || prepared.payload.length === 0) {
    return block('The retained action ID, plan, wallet, format, or prepare payload does not match the current context.');
  }
  if (prepared.planRecordId !== prepared.planId
      && (data.leg !== 1 || data.nextPlanId !== prepared.planRecordId)) {
    return block('The retained action does not match the selected rotation continuation.');
  }
  if (overview?.mandate?.id !== data.mandateId || overview?.portfolio?.id !== data.portfolioId) {
    return block('The prepared action is not bound to the current saved mandate and observed portfolio.');
  }
  const context = mandateActionContext(overview, wallet);
  if (!context) return block('Current owner portfolio metadata or saved mandate is incomplete; quote signing is blocked.');
  const { mandate, portfolio, inventory } = context;
  const source = inventory.assets.get(data.sourceAssetId);
  const destination = inventory.assets.get(data.targetAssetId);
  const input = unsignedInteger(data.inputBaseUnits);
  if (!source || !destination || !input || input === 0n
      || input > unsignedInteger(inventory.balances.get(data.sourceAssetId))) {
    return block('The retained action source, destination, or exact amount does not match observed owner metadata.');
  }
  const plan = overview.plans.find(item => item?.id === prepared.planRecordId);
  const planData = recordData(plan);
  const proposal = planData.proposal ?? planData.snapshot?.proposal;
  if (!plan || !isRecord(proposal)) return block('The exact retained plan proposal is unavailable.');
  const rotationExit = data.action === 'rotate' && data.leg === 0;
  if (rotationExit) {
    if (proposal.action !== 'rotate' || data.sourceAssetId !== proposal.sourceAssetId
        || data.inputBaseUnits !== proposal.inputBaseUnits || data.rotationTargetAssetId !== proposal.targetAssetId) {
      return block('The retained rotation exit does not match the selected plan proposal.');
    }
  } else if ((data.action !== 'rotate' && data.action !== proposal.action)
      || data.sourceAssetId !== proposal.sourceAssetId || data.targetAssetId !== proposal.targetAssetId
      || data.inputBaseUnits !== proposal.inputBaseUnits) {
    return block('The retained action assets and amount do not match the selected plan proposal.');
  }
  const permittedTargets = new Set(context.targets.map(target => target.assetId));
  if (['invest', 'reinvest'].includes(data.action)) {
    if (data.sourceAssetId !== mandate.reserveAssetId || !permittedTargets.has(data.targetAssetId)) {
      return block('The retained buy is not bound to the saved reserve and an allowed target.');
    }
  } else if (data.action === 'redeem') {
    if (source.kind !== 'receipt' || data.targetAssetId !== mandate.reserveAssetId) {
      return block('The retained redemption does not move a supported held position to the saved reserve.');
    }
  } else if (data.action === 'rotate') {
    if (rotationExit) {
      if (source.kind !== 'receipt' || data.targetAssetId !== mandate.reserveAssetId
          || !permittedTargets.has(data.rotationTargetAssetId)) {
        return block('The retained rotation exit does not match a held position and permitted next target.');
      }
    } else if (data.leg !== 1 || data.sourceAssetId !== mandate.reserveAssetId
        || destination.kind !== 'receipt' || !permittedTargets.has(data.targetAssetId)
        || data.rotationTargetAssetId !== data.targetAssetId) {
      return block('The retained rotation entry does not match settled reserve and a permitted target.');
    }
  } else {
    return block('The retained action type is unsupported for an owner signature.');
  }

  const envelope = data.quote;
  const expectedQuoteKeys = ['schemaVersion', 'capturedAt', 'raw', 'sha256', 'signatureVerified'];
  const quoteKeys = isRecord(envelope) ? Object.keys(envelope) : [];
  const raw = envelope?.raw;
  const request = raw?.quoteRequest;
  const quote = raw?.quote;
  const expectedRequestKeys = [
    'dry', 'swapType', 'slippageTolerance', 'originAsset', 'depositType', 'refundType',
    'destinationAsset', 'amount', 'refundTo', 'recipient', 'recipientType', 'deadline',
  ];
  if (!isRecord(envelope) || quoteKeys.length !== expectedQuoteKeys.length
      || expectedQuoteKeys.some(key => !Object.prototype.hasOwnProperty.call(envelope, key))
      || envelope.schemaVersion !== 1 || envelope.signatureVerified !== true
      || typeof envelope.sha256 !== 'string' || !/^[0-9a-f]{64}$/.test(envelope.sha256)
      || !isRecord(raw) || !isRecord(request) || Object.keys(request).length !== expectedRequestKeys.length
      || expectedRequestKeys.some(key => !Object.prototype.hasOwnProperty.call(request, key))
      || !isRecord(quote)) {
    return block('The retained quote envelope or its verified request fields are incomplete.');
  }
  const rawAmountIn = unsignedInteger(quote.amountIn);
  const minAmountIn = unsignedInteger(quote.minAmountIn);
  const amountOut = unsignedInteger(quote.amountOut);
  const minAmountOut = unsignedInteger(quote.minAmountOut);
  const refundFee = unsignedInteger(quote.refundFee);
  const withdrawFee = unsignedInteger(quote.withdrawFee);
  const now = Date.now();
  const maxAgeMs = BigInt(mandate.maxEvidenceAgeSeconds) * 1000n;
  const fresh = value => {
    if (typeof value !== 'string' || !Number.isFinite(Date.parse(value))) return false;
    const age = BigInt(now) - BigInt(Date.parse(value));
    return age >= 0n && age <= maxAgeMs;
  };
  const providerTime = typeof raw.timestamp === 'string'
    && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?Z$/.test(raw.timestamp)
    ? raw.timestamp : null;
  const deadline = typeof quote.deadline === 'string' ? Date.parse(quote.deadline) : NaN;
  const signingState = ['PREPARED', 'NEXT_LEG_READY'].includes(data.status);
  if (!fresh(portfolio.capturedAt) || !fresh(envelope.capturedAt) || !providerTime || !fresh(providerTime)
      || request.dry !== false || request.swapType !== 'EXACT_INPUT' || request.depositType !== 'INTENTS'
      || request.refundType !== 'INTENTS' || request.recipientType !== 'INTENTS'
      || request.originAsset !== data.sourceAssetId || request.destinationAsset !== data.targetAssetId
      || request.amount !== data.inputBaseUnits || request.slippageTolerance !== mandate.slippageBps
      || request.refundTo !== portfolio.signerId || request.recipient !== portfolio.signerId
      || request.deadline !== quote.deadline || quote.deadline !== prepared.expiresAt
      || !Number.isFinite(deadline) || deadline <= now
      || typeof quote.depositAddress !== 'string' || !quote.depositAddress.length
      || quote.depositAddress.length > 512 || quote.depositAddress.includes('\0')
      || rawAmountIn === null || rawAmountIn === 0n || rawAmountIn !== input
      || minAmountIn === null || minAmountIn === 0n || minAmountIn > rawAmountIn
      || amountOut === null || amountOut === 0n || minAmountOut === null || minAmountOut === 0n || minAmountOut > amountOut
      || refundFee === null || withdrawFee === null || withdrawFee > amountOut
      || formatBaseUnits(quote.amountIn, source.decimals) === null
      || formatBaseUnits(quote.minAmountIn, source.decimals) === null
      || formatBaseUnits(quote.amountOut, destination.decimals) === null
      || formatBaseUnits(quote.minAmountOut, destination.decimals) === null
      || formatBaseUnits(quote.refundFee, source.decimals) === null
      || formatBaseUnits(quote.withdrawFee, destination.decimals) === null) {
    return block('The quote is stale, expired, mismatched, or missing an exact debit, output, fee, destination, or expiry bound.');
  }
  return {
    valid: true,
    signingReady: signingState && !prepared.signed,
    reason: '',
    record,
    data,
    quote: envelope,
    source,
    destination,
    quoteFields: {
      sourceAsset: source.symbol,
      destinationAsset: destination.symbol,
      amountIn: amountLabel(quote.amountIn, source.assetId, portfolio),
      minAmountIn: amountLabel(quote.minAmountIn, source.assetId, portfolio),
      amountOut: amountLabel(quote.amountOut, destination.assetId, portfolio),
      minAmountOut: amountLabel(quote.minAmountOut, destination.assetId, portfolio),
      refundFee: amountLabel(quote.refundFee, source.assetId, portfolio),
      withdrawFee: amountLabel(quote.withdrawFee, destination.assetId, portfolio),
      reserveFloor: amountLabel(mandate.reserveFloorBaseUnits, mandate.reserveAssetId, portfolio),
      maxActionReserve: amountLabel(mandate.maxActionReserveBaseUnits, mandate.reserveAssetId, portfolio),
      maxPositionPercent: percentInputText(String(mandate.maxPositionBps)),
      maxSlippagePercent: percentInputText(String(mandate.slippageBps)),
      maxFeePercent: percentInputText(String(mandate.maxFeeBps)),
      maxEvidenceAgeSeconds: mandate.maxEvidenceAgeSeconds,
      portfolioCapturedAt: portfolio.capturedAt,
      capturedAt: envelope.capturedAt,
      providerTimestamp: raw.timestamp,
      deadline: quote.deadline,
      depositAddress: quote.depositAddress,
      quoteHash: envelope.sha256,
      signerId: portfolio.signerId,
    },
  };
}

function stableJson(value) {
  if (value === null || typeof value === 'string' || typeof value === 'boolean' || typeof value === 'number') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (!isRecord(value)) throw new TypeError('Quote data is not JSON-shaped.');
  return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(',')}}`;
}

async function quoteDigestMatches(review) {
  if (!review?.valid || !globalThis.crypto?.subtle || typeof TextEncoder !== 'function') return false;
  try {
    const bytes = new TextEncoder().encode(stableJson(review.quote.raw));
    const digest = new Uint8Array(await globalThis.crypto.subtle.digest('SHA-256', bytes));
    const actual = [...digest].map(byte => byte.toString(16).padStart(2, '0')).join('');
    return actual === review.quote.sha256;
  } catch {
    return false;
  }
}

function safeDetails(data) {
  const blocked = /(payload|signature|signing|signedData|private|api.?key|token|authorization|secret|credential)/i;
  const visit = (value, depth = 0) => {
    if (depth > 5 || value === null || typeof value === 'boolean' || typeof value === 'number') return value;
    if (typeof value === 'string') return value.length > 2048 ? `${value.slice(0, 2048)}…` : value;
    if (Array.isArray(value)) return value.slice(0, 32).map(item => visit(item, depth + 1));
    if (!isRecord(value)) return undefined;
    return Object.fromEntries(Object.entries(value)
      .filter(([key]) => !blocked.test(key) && !/token|authorization/i.test(key))
      .slice(0, 40)
      .map(([key, child]) => [key, visit(child, depth + 1)])
      .filter(([, child]) => child !== undefined));
  };
  return visit(data);
}

function mandateFormFrom(value) {
  const saved = mandateFromRecord(value?.mandate);
  const reserveAssetId = saved?.reserveAssetId ?? '';
  if (!saved) return { ...EMPTY_MANDATE, reserveAssetId };
  return {
    reserveAssetId: text(saved.reserveAssetId),
    reserveFloorBaseUnits: text(saved.reserveFloorBaseUnits),
    maxActionReserveBaseUnits: text(saved.maxActionReserveBaseUnits),
    maxPositionBps: String(saved.maxPositionBps ?? ''),
    slippageBps: String(saved.slippageBps ?? ''),
    maxFeeBps: String(saved.maxFeeBps ?? ''),
    maxEvidenceAgeSeconds: String(saved.maxEvidenceAgeSeconds ?? ''),
    monitorIntervalSeconds: String(saved.monitorIntervalSeconds ?? ''),
    maxMonitorCycles: String(saved.maxMonitorCycles ?? ''),
  };
}

function mandateAmountInputsFrom(form, portfolio) {
  const reserve = assetFor(portfolio, form.reserveAssetId);
  if (!validObservedAsset(reserve)) {
    return { reserveFloorBaseUnits: '', maxActionReserveBaseUnits: '' };
  }
  return {
    reserveFloorBaseUnits: baseUnitsInputText(form.reserveFloorBaseUnits, reserve.decimals) ?? '',
    maxActionReserveBaseUnits: baseUnitsInputText(form.maxActionReserveBaseUnits, reserve.decimals) ?? '',
  };
}


function mandatePercentInputsFrom(form) {
  return {
    maxPositionBps: percentInputText(form.maxPositionBps),
    slippageBps: percentInputText(form.slippageBps),
    maxFeeBps: percentInputText(form.maxFeeBps),
  };
}
function planTargetRequired(action) {
  return !['invest', 'reinvest'].includes(action);
}

export function buildPlanFields(form) {
  const errors = {};
  const weightedBuy = ['invest', 'reinvest'].includes(form.action);
  if (!['invest', 'redeem', 'rotate', 'reinvest'].includes(form.action)) errors.action = 'Choose an action.';
  if (!validAssetId(form.sourceAssetId)) errors.sourceAssetId = 'Enter the exact source asset ID.';
  if (planTargetRequired(form.action) && !validAssetId(form.targetAssetId)) errors.targetAssetId = 'Enter the exact target asset ID.';
  if (form.targetAssetId !== '' && !validAssetId(form.targetAssetId)) errors.targetAssetId = 'Enter an exact target asset ID without spaces.';
  const inputAmount = form.inputBaseUnits === '' && weightedBuy ? null : unsignedInteger(form.inputBaseUnits);
  if (inputAmount === null && !weightedBuy) errors.inputBaseUnits = 'Enter a positive exact amount in base units.';
  else if (inputAmount === null && form.inputBaseUnits !== '') errors.inputBaseUnits = 'Enter a positive exact amount in base units.';
  else if (inputAmount === 0n) errors.inputBaseUnits = 'The exact input amount must be positive.';
  if (Object.keys(errors).length) return { fields: null, errors };
  return {
    fields: {
      action: form.action,
      sourceAssetId: form.sourceAssetId,
      targetAssetId: form.targetAssetId || null,
      inputBaseUnits: inputAmount === null ? null : form.inputBaseUnits,
    },
    errors: {},
  };
}

function exactRecord(record) {
  return isRecord(record) && typeof record.id === 'string' && isRecord(record.data);
}

export default function Cfo({ session, walletSession, request = meshRequest }) {
  const requestRef = useRef(request);
  requestRef.current = request;
  const identityRef = useRef(null);
  identityRef.current = { token: session?.token ?? null, walletAddress: session?.walletAddress ?? null, walletSession };
  const contextGeneration = useRef(0);
  const overviewGeneration = useRef(0);
  const detailGeneration = useRef(0);
  const retryIds = useRef(new Map());
  const busyRef = useRef(false);
  const mandateDirty = useRef(false);
  const contextKey = useRef(null);
  const walletConnectingRef = useRef(false);
  const mountedRef = useRef(false);
  const [walletAddress, setWalletAddress] = useState(null);
  const [walletRevision, setWalletRevision] = useState(0);
  const [walletOptions, setWalletOptions] = useState([]);
  const [walletConnectBusy, setWalletConnectBusy] = useState(null);
  const [walletConnectError, setWalletConnectError] = useState('');
  const [overview, setOverview] = useState(null);
  const [load, setLoad] = useState({ status: 'loading', error: '' });
  const [operation, setOperation] = useState({ busy: '', error: '', notice: '' });
  const [mandateForm, setMandateForm] = useState(EMPTY_MANDATE);
  const [mandateAmountText, setMandateAmountText] = useState({ reserveFloorBaseUnits: '', maxActionReserveBaseUnits: '' });
  const [mandatePercentText, setMandatePercentText] = useState({ maxPositionBps: '', slippageBps: '', maxFeeBps: '' });
  const [targets, setTargets] = useState([]);
  const [mandateErrors, setMandateErrors] = useState({});
  const [planForm, setPlanForm] = useState(EMPTY_PLAN);
  const [actionAmountText, setActionAmountText] = useState('');
  const [savedAllocation, setSavedAllocation] = useState(false);
  const [planErrors, setPlanErrors] = useState({});
  const [latestPlan, setLatestPlan] = useState(null);
  const [prepared, setPrepared] = useState(null);
  const [quoteReadState, setQuoteReadState] = useState({ actionId: null, status: 'idle', error: '' });
  const [signatureState, setSignatureState] = useState(null);
  const [confirmRelayActionId, setConfirmRelayActionId] = useState(null);
  const [relayResult, setRelayResult] = useState(null);
  const [relayUnknown, setRelayUnknown] = useState(null);
  const [reconciliations, setReconciliations] = useState({});
  const [loadedRecords, setLoadedRecords] = useState({});
  const [detailErrors, setDetailErrors] = useState({});

  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  useEffect(() => {
    let active = true;
    let lastAddress;
    const publish = state => {
      if (!active) return;
      setWalletOptions(Array.isArray(state?.wallets) ? state.wallets : []);
      const next = typeof state?.current?.address === 'string' ? state.current.address : null;
      if (next === lastAddress) return;
      lastAddress = next;
      setWalletAddress(next);
      setWalletRevision(value => value + 1);
    };
    if (typeof walletSession?.subscribe === 'function') {
      const unsubscribe = walletSession.subscribe(publish);
      return () => { active = false; unsubscribe?.(); };
    }
    let wallets = [];
    try { wallets = typeof walletSession?.list === 'function' ? walletSession.list() : []; } catch {}
    const address = currentAddress(walletSession);
    publish({ current: address ? { address } : null, wallets });
    return () => { active = false; };
  }, [walletSession]);

  useEffect(() => {
    const generation = ++contextGeneration.current;
    overviewGeneration.current += 1;
    detailGeneration.current += 1;
    busyRef.current = false;
    retryIds.current.clear();
    const key = `${session?.token ?? ''}\u0000${session?.walletAddress ?? ''}\u0000${walletAddress ?? ''}`;
    if (contextKey.current !== key) {
      contextKey.current = key;
      mandateDirty.current = false;
      setOverview(null);
      setMandateAmountText({ reserveFloorBaseUnits: '', maxActionReserveBaseUnits: '' });
      setMandatePercentText({ maxPositionBps: '', slippageBps: '', maxFeeBps: '' });
      setMandateForm(EMPTY_MANDATE);
      setTargets([]);
      setMandateErrors({});
      setPlanForm(EMPTY_PLAN);
      setActionAmountText('');
      setSavedAllocation(false);
      setPlanErrors({});
      setLatestPlan(null);
      setPrepared(null);
      setQuoteReadState({ actionId: null, status: 'idle', error: '' });
      setSignatureState(null);
      setConfirmRelayActionId(null);
      setRelayUnknown(null);
      setRelayResult(null);
      setReconciliations({});
      setLoadedRecords({});
      setDetailErrors({});
      setOperation({ busy: '', error: '', notice: '' });
    }
    const token = typeof session?.token === 'string' ? session.token : null;
    const sessionWallet = typeof session?.walletAddress === 'string' ? session.walletAddress : null;
    const current = currentAddress(walletSession);
    if (!token || !sessionWallet) {
      setLoad({ status: 'blocked', error: 'A verified owner wallet session is required to read CFO data.' });
      return () => { if (contextGeneration.current === generation) contextGeneration.current += 1; };
    }
    if (!walletAddress || current !== walletAddress || walletAddress !== sessionWallet) {
      setLoad({ status: 'wallet-mismatch', error: 'The wallet is not reconnected or the current account does not match this verified owner session. Reconnect the matching wallet before continuing.' });
      return () => { if (contextGeneration.current === generation) contextGeneration.current += 1; };
    }
    setLoad({ status: 'loading', error: '' });
    const queryGeneration = ++overviewGeneration.current;
    void Promise.resolve().then(() => requestRef.current(token, ROOT)).then(value => {
      if (contextGeneration.current !== generation || overviewGeneration.current !== queryGeneration
        || currentAddress(walletSession) !== sessionWallet) return;
      if (!validOverview(value)) throw new Error('The CFO service returned an invalid overview. No balances or readiness are shown.');
      setOverview(value);
      setLoad({ status: 'ready', error: '' });
      if (!mandateDirty.current) {
        const portfolio = portfolioFromRecord(value.portfolio);
        const form = mandateFormFrom(value);
        setMandateForm(form);
        setMandateAmountText(mandateAmountInputsFrom(form, portfolio));
        setMandatePercentText(mandatePercentInputsFrom(form));
        const saved = mandateFromRecord(value.mandate);
        if (saved?.targets?.length) {
          setTargets(saved.targets.map(target => ({
            assetId: text(target.assetId),
            weightBps: String(target.weightBps ?? ''),
            weightText: percentInputText(String(target.weightBps ?? '')),
          })));
        } else {
          setTargets([]);
        }
      }
    }).catch(error => {
      if (contextGeneration.current !== generation || overviewGeneration.current !== queryGeneration) return;
      setLoad({ status: 'error', error: errorMessage(error) });
    });
    return () => {
      if (contextGeneration.current === generation) contextGeneration.current += 1;
      if (overviewGeneration.current === queryGeneration) overviewGeneration.current += 1;
    };
  }, [session?.token, session?.walletAddress, walletSession, walletAddress, walletRevision]);

  const generationIsCurrent = generation => {
    const key = `${session?.token ?? ''}\u0000${session?.walletAddress ?? ''}\u0000${walletAddress ?? ''}`;
    return contextGeneration.current === generation
      && contextKey.current === key
      && Boolean(session?.token && session?.walletAddress)
      && currentAddress(walletSession) === session.walletAddress
      && walletAddress === session.walletAddress;
  };
  async function reconnectWallet(wallet) {
    if (walletConnectingRef.current || !wallet?.available || typeof wallet?.id !== 'string') return;
    if (typeof walletSession?.connect !== 'function') {
      setWalletConnectError('This wallet session cannot reconnect a wallet. CFO data remains hidden.');
      return;
    }
    const identity = { token: session?.token, walletAddress: session?.walletAddress, walletSession };
    const sameIdentity = () => mountedRef.current && identityRef.current?.token === identity.token
      && identityRef.current?.walletAddress === identity.walletAddress
      && identityRef.current?.walletSession === identity.walletSession;
    walletConnectingRef.current = true;
    setWalletConnectError('');
    setWalletConnectBusy(wallet.id);
    try {
      await walletSession.connect(wallet.id);
      if (!sameIdentity()) return;
      const address = currentAddress(walletSession);
      if (address !== identity.walletAddress) {
        setWalletConnectError('The connected account does not match the verified owner session. CFO data stays hidden; choose the matching account.');
        return;
      }
      setWalletConnectError('');
      setWalletAddress(address);
      if (typeof walletSession?.subscribe !== 'function' && walletAddress === address) setWalletRevision(value => value + 1);
    } catch (error) {
      if (sameIdentity()) setWalletConnectError(errorMessage(error));
    } finally {
      walletConnectingRef.current = false;
      if (sameIdentity()) setWalletConnectBusy(null);
    }
  }

  function syncActionFromOverview(value, actionId) {
    if (typeof actionId !== 'string') return;
    const record = actionHeadRecords(value.actions).find(item => recordIdentifier(item) === actionId);
    if (!record) return;
    const status = recordStatus(record);
    if (status === 'PREPARED' || status === 'NEXT_LEG_READY') {
      setPrepared(current => current?.actionId === actionId ? { ...current, signed: false } : current);
      setSignatureState(current => current?.actionId === actionId ? null : current);
      setRelayUnknown(current => current === actionId ? null : current);
      setRelayResult(current => current?.actionId === actionId ? null : current);
      return;
    }
    if (status === 'SIGNED') {
      setPrepared(current => current?.actionId === actionId ? { ...current, signed: true } : current);
      setSignatureState(current => current?.actionId === actionId
        ? { actionId, status: 'SIGNED', expiresAt: record.data?.quote?.raw?.quote?.deadline ?? current.expiresAt }
        : current);
      setRelayUnknown(current => current === actionId ? null : current);
      setRelayResult(current => current?.actionId === actionId ? null : current);
      return;
    }
    if (RECONCILABLE_ACTION_STATUSES.has(status) || ['EXIT_CONFIRMED', 'AWAITING_NEXT_LEG'].includes(status)) {
      setPrepared(current => current?.actionId === actionId ? { ...current, signed: true } : current);
      setSignatureState(current => current?.actionId === actionId ? { ...current, status: 'SIGNED' } : current);
      setRelayUnknown(status === 'SUBMISSION_UNKNOWN' ? actionId : null);
      setRelayResult({ actionId, status });
      return;
    }
    if (TERMINAL_ACTION_STATUSES.has(status)) {
      setRelayUnknown(null);
      setRelayResult({ actionId, status });
    }
  }

  async function refreshOverview({ quiet = false, quoteAction = prepared } = {}) {
    const generation = contextGeneration.current;
    if (!generationIsCurrent(generation)) return null;
    const queryGeneration = ++overviewGeneration.current;
    if (quoteAction?.actionId) setQuoteReadState({ actionId: quoteAction.actionId, status: 'loading', error: '' });
    if (!quiet) setLoad({ status: 'refreshing', error: '' });
    try {
      const value = await requestRef.current(session.token, ROOT);
      if (!generationIsCurrent(generation) || overviewGeneration.current !== queryGeneration) return null;
      if (!validOverview(value)) throw new Error('The CFO service returned an invalid overview. No balances or readiness are shown.');
      setOverview(value);
      if (quoteAction?.actionId) {
        syncActionFromOverview(value, quoteAction.actionId);
        const quoteReview = preparedQuoteReview(value, quoteAction, session?.walletAddress);
        const hashMatches = await quoteDigestMatches(quoteReview);
        if (!generationIsCurrent(generation) || overviewGeneration.current !== queryGeneration) return null;
        setQuoteReadState({
          actionId: quoteAction.actionId,
          status: quoteReview.valid && hashMatches ? 'ready' : 'blocked',
          error: quoteReview.valid && !hashMatches ? 'The retained quote hash does not match its canonical bytes.' : quoteReview.reason,
        });
      }
      const refreshedPlan = latestPlan?.plan?.id && value.plans.find(plan => plan.id === latestPlan.plan.id);
      if (refreshedPlan) setLatestPlan({ plan: refreshedPlan, review: refreshedPlan.review ?? null });
      setLoad({ status: 'ready', error: '' });
      if (!mandateDirty.current) {
        const portfolio = portfolioFromRecord(value.portfolio);
        const form = mandateFormFrom(value);
        setMandateForm(form);
        setMandateAmountText(mandateAmountInputsFrom(form, portfolio));
        setMandatePercentText(mandatePercentInputsFrom(form));
        const saved = mandateFromRecord(value.mandate);
        setTargets(saved?.targets?.length
          ? saved.targets.map(target => ({
            assetId: text(target.assetId),
            weightBps: String(target.weightBps ?? ''),
            weightText: percentInputText(String(target.weightBps ?? '')),
          }))
          : []);
      }
      return value;
    } catch (error) {
      if (generationIsCurrent(generation) && overviewGeneration.current === queryGeneration) {
        if (quoteAction?.actionId) {
          setQuoteReadState({
            actionId: quoteAction.actionId,
            status: 'error',
            error: 'The retained action and exact quote could not be read. Retry this GET only; do not prepare another action.',
          });
        }
        setLoad({ status: 'error', error: errorMessage(error) });
      }
      return null;
    }
  }

  async function post(endpoint, fields, { safeRetry = true, onFailure } = {}) {
    if (busyRef.current) return null;
    const generation = contextGeneration.current;
    if (!generationIsCurrent(generation)) {
      setOperation({ busy: '', error: 'The verified wallet session changed. Refresh the dashboard before continuing.', notice: '' });
      return null;
    }
    let requestId;
    let retryKey = null;
    try {
      if (safeRetry) {
        retryKey = `${endpoint}\n${JSON.stringify(fields)}`;
        requestId = retryIds.current.get(retryKey);
      }
      if (!requestId) {
        if (typeof globalThis.crypto?.randomUUID !== 'function') throw new Error('Secure request IDs are unavailable. No request was sent.');
        requestId = globalThis.crypto.randomUUID();
        if (safeRetry && retryKey) retryIds.current.set(retryKey, requestId);
      }
    } catch (error) {
      setOperation({ busy: '', error: errorMessage(error), notice: '' });
      return null;
    }
    busyRef.current = true;
    setOperation({ busy: endpoint, error: '', notice: '' });
    try {
      const result = await requestRef.current(session.token, `${ROOT}${endpoint}`, { requestId, ...fields });
      if (!generationIsCurrent(generation)) return null;
      if (retryKey) retryIds.current.delete(retryKey);
      return result;
    } catch (error) {
      if (retryKey && !safeRetry) retryIds.current.delete(retryKey);
      if (generationIsCurrent(generation)) {
        onFailure?.(error);
        setOperation({ busy: '', error: errorMessage(error), notice: '' });
      }
      return null;
    } finally {
      if (generationIsCurrent(generation)) {
        busyRef.current = false;
        setOperation(current => ({ ...current, busy: '' }));
      }
    }
  }

  function setMandateField(name, value) {
    mandateDirty.current = true;
    if (name === 'reserveAssetId') {
      const portfolio = portfolioFromRecord(overview?.portfolio);
      const reserve = assetFor(portfolio, value);
      if (value && (!validObservedAsset(reserve) || reserve.kind !== 'reserve')) {
        setMandateErrors(current => ({ ...current, reserveAssetId: 'Choose a reserve asset from the observed owner portfolio.' }));
        return;
      }
      if (value !== mandateForm.reserveAssetId) {
        setMandateForm(current => ({ ...current, reserveAssetId: value, reserveFloorBaseUnits: '', maxActionReserveBaseUnits: '' }));
        setMandateAmountText({ reserveFloorBaseUnits: '', maxActionReserveBaseUnits: '' });
      } else {
        setMandateForm(current => ({ ...current, reserveAssetId: value }));
      }
      setMandateErrors(current => ({ ...current, reserveAssetId: undefined, reserveFloorBaseUnits: undefined, maxActionReserveBaseUnits: undefined, targets: undefined }));
      return;
    }
    if (name === 'reserveFloorBaseUnits' || name === 'maxActionReserveBaseUnits') {
      const portfolio = portfolioFromRecord(overview?.portfolio);
      const reserve = assetFor(portfolio, mandateForm.reserveAssetId);
      const parsed = validObservedAsset(reserve) && reserve.kind === 'reserve'
        ? parseTokenAmount(value, reserve.decimals) : null;
      setMandateAmountText(current => ({ ...current, [name]: value }));
      setMandateForm(current => ({ ...current, [name]: parsed ?? '' }));
      setMandateErrors(current => ({
        ...current,
        [name]: parsed === null ? 'Enter a plain non-negative amount within the observed reserve token precision.' : undefined,
        targets: undefined,
      }));
      return;
    }
    if (['maxPositionBps', 'slippageBps', 'maxFeeBps'].includes(name)) {
      const parsed = parsePercentBps(value);
      setMandatePercentText(current => ({ ...current, [name]: value }));
      setMandateForm(current => ({ ...current, [name]: parsed ?? '' }));
      setMandateErrors(current => ({
        ...current,
        [name]: parsed === null ? 'Enter a percentage from 0 to 100 with at most two decimal places.' : undefined,
        targets: undefined,
      }));
      return;
    }
    setMandateForm(current => ({ ...current, [name]: value }));
    setMandateErrors(current => ({ ...current, [name]: undefined, targets: undefined }));
  }

  function setTargetField(index, name, value) {
    mandateDirty.current = true;
    if (name === 'assetId' && value) {
      const asset = assetFor(portfolioFromRecord(overview?.portfolio), value);
      if (!validObservedAsset(asset) || asset.kind !== 'receipt') {
        setMandateErrors(current => ({ ...current, [`target-${index}-assetId`]: 'Choose a receipt asset from the observed owner portfolio.' }));
        return;
      }
    }
    if (name === 'weightBps') {
      const parsed = parsePercentBps(value);
      setTargets(current => current.map((target, targetIndex) => targetIndex === index
        ? { ...target, weightBps: parsed ?? '', weightText: value } : target));
      setMandateErrors(current => ({
        ...current,
        [`target-${index}-weightBps`]: parsed === null ? 'Enter a percentage from 0 to 100 with at most two decimal places.' : undefined,
        targets: undefined,
      }));
      return;
    }
    setTargets(current => current.map((target, targetIndex) => targetIndex === index ? { ...target, [name]: value } : target));
    setMandateErrors(current => ({ ...current, [`target-${index}-${name}`]: undefined, targets: undefined }));
  }

  function setPlanField(name, value) {
    if (name === 'action') {
      setPlanForm({ ...EMPTY_PLAN, action: value });
      setActionAmountText('');
      setSavedAllocation(false);
      setPlanErrors(current => ({ ...current, action: undefined, sourceAssetId: undefined, targetAssetId: undefined, inputBaseUnits: undefined }));
      return;
    }
    setPlanForm(current => ({ ...current, [name]: value }));
    setPlanErrors(current => ({ ...current, [name]: undefined }));
  }

  function copyPolicyTemplate() {
    const next = copyConsumerTemplate(mandateForm, overview?.policyTemplate);
    if (!next) {
      setOperation({ busy: '', error: 'The owner overview does not contain a valid consumer template. No policy defaults were copied.', notice: '' });
      return;
    }
    mandateDirty.current = true;
    setMandateForm(next);
    setMandatePercentText(mandatePercentInputsFrom(next));
    setMandateErrors({});
    setOperation({ busy: '', error: '', notice: 'Consumer template v1 was copied to this local draft only. Review the saved capital, assets, targets, and every limit, then save explicitly.' });
  }

  function validateMandateDraft() {
    const portfolio = portfolioFromRecord(overview?.portfolio);
    const inventory = portfolioInventory(portfolio, session?.walletAddress);
    const reserve = inventory?.assets.get(mandateForm.reserveAssetId);
    const reserveValid = Boolean(reserve && reserve.kind === 'reserve');
    const reserveFloorBaseUnits = reserveValid
      ? parseTokenAmount(mandateAmountText.reserveFloorBaseUnits, reserve.decimals) : null;
    const maxActionReserveBaseUnits = reserveValid
      ? parseTokenAmount(mandateAmountText.maxActionReserveBaseUnits, reserve.decimals) : null;
    const form = {
      ...mandateForm,
      reserveFloorBaseUnits: reserveFloorBaseUnits ?? '',
      maxActionReserveBaseUnits: maxActionReserveBaseUnits ?? '',
    };
    const built = buildMandateFromForm(form, targets, session?.walletAddress);
    const localErrors = {};
    if (!reserveValid) localErrors.reserveAssetId = 'A reserve asset with observed metadata and decimals is required before saving limits.';
    if (reserveFloorBaseUnits === null) localErrors.reserveFloorBaseUnits = 'Enter a plain reserve amount using the observed token precision.';
    if (maxActionReserveBaseUnits === null) localErrors.maxActionReserveBaseUnits = 'Enter a plain reserve amount using the observed token precision.';
    targets.forEach((target, index) => {
      if (!target?.assetId && !target?.weightBps) return;
      const asset = inventory?.assets.get(target.assetId);
      if (!asset || asset.kind !== 'receipt') {
        localErrors[`target-${index}-assetId`] = 'Select a permitted receipt asset with exact observed metadata.';
      }
    });
    const retainedErrors = Object.fromEntries(Object.entries(mandateErrors).filter(([, message]) => typeof message === 'string' && message.length));
    const errors = { ...built.errors, ...localErrors, ...retainedErrors };
    return { built, errors, valid: Boolean(built.mandate && Object.keys(errors).length === 0) };
  }

  async function saveMandate(event) {
    event.preventDefault();
    const draft = validateMandateDraft();
    setMandateErrors(draft.errors);
    if (!draft.valid) {
      const first = Object.keys(draft.errors)[0];
      const focusIds = {
        reserveFloorBaseUnits: 'cfo-reserve-floor-amount',
        maxActionReserveBaseUnits: 'cfo-action-cap-amount',
        targets: 'cfo-target-0-assetId',
      };
      if (first) document.getElementById(focusIds[first] ?? `cfo-${first}`)?.focus();
      return;
    }
    const result = await post('/mandate', { mandate: draft.built.mandate });
    if (!result) return;
    mandateDirty.current = false;
    setOperation({ busy: '', error: '', notice: 'The service accepted the mandate save. Refreshing its retained record.' });
    await refreshOverview({ quiet: true });
  }

  async function capturePortfolio() {
    const result = await post('/capture', {});
    if (!result) return;
    setOperation({ busy: '', error: '', notice: 'The portfolio capture returned from the service. Only its retained result will be shown.' });
    await refreshOverview({ quiet: true });
  }

  async function createPlan(event) {
    event.preventDefault();
    const context = mandateActionContext(overview, session?.walletAddress);
    const action = planForm.action;
    const isBuy = ['invest', 'reinvest'].includes(action);
    const isExit = ['redeem', 'rotate'].includes(action);
    const sourceAssetId = isBuy ? context?.mandate.reserveAssetId ?? '' : planForm.sourceAssetId;
    const targetAssetId = isBuy
      ? (savedAllocation ? '' : planForm.targetAssetId)
      : action === 'redeem' ? context?.mandate.reserveAssetId ?? '' : planForm.targetAssetId;
    const inputAsset = isBuy ? context?.reserveAsset : context?.inventory.assets.get(sourceAssetId);
    const parsedInputAmount = inputAsset && validObservedAsset(inputAsset)
      ? parseTokenAmount(actionAmountText, inputAsset.decimals) : null;
    const inputBaseUnits = isBuy && savedAllocation ? '' : parsedInputAmount ?? '';
    const built = buildPlanFields({ action, sourceAssetId, targetAssetId, inputBaseUnits });
    const localErrors = {};
    if (!context) localErrors.action = 'A matching observed portfolio and valid saved mandate are required.';
    if (isBuy && !savedAllocation && !context?.targets.some(target => target.assetId === targetAssetId)) {
      localErrors.targetAssetId = 'Choose an investment permitted by the saved mandate.';
    }
    if (isExit) {
      const source = context?.inventory.assets.get(sourceAssetId);
      const balance = unsignedInteger(context?.inventory.balances.get(sourceAssetId));
      if (!source || source.kind !== 'receipt' || balance === null || balance === 0n) {
        localErrors.sourceAssetId = 'Choose a held receipt position from the observed owner portfolio.';
      }
      if (action === 'rotate' && (!context?.targets.some(target => target.assetId === targetAssetId)
        || targetAssetId === sourceAssetId)) {
        localErrors.targetAssetId = 'Choose a different receipt target permitted by the saved mandate.';
      }
    }
    if (!(isBuy && savedAllocation)) {
      if (parsedInputAmount === null || parsedInputAmount === '0') {
        localErrors.inputBaseUnits = 'Enter a plain positive amount within the selected token precision.';
      } else {
        const observedBalance = unsignedInteger(context?.inventory.balances.get(sourceAssetId));
        if (observedBalance !== null && BigInt(parsedInputAmount) > observedBalance) {
          localErrors.inputBaseUnits = isExit
            ? 'The exact amount exceeds the observed held-token balance.'
            : 'The exact amount exceeds the total observed reserve balance; this is not a spendable-cash calculation.';
        }
      }
    }
    const errors = { ...built.errors, ...localErrors };
    setPlanErrors(errors);
    if (!built.fields || Object.keys(localErrors).length) {
      const first = Object.keys(errors)[0];
      const focusIds = {
        action: 'cfo-action-type',
        sourceAssetId: 'cfo-action-assets',
        targetAssetId: action === 'rotate' ? 'cfo-action-target' : 'cfo-action-assets',
        inputBaseUnits: 'cfo-action-amount',
      };
      if (first) document.getElementById(focusIds[first])?.focus();
      return;
    }
    const result = await post('/plans', built.fields);
    if (!result) return;
    setLatestPlan(result);
    setPrepared(null);
    setQuoteReadState({ actionId: null, status: 'idle', error: '' });
    setSignatureState(null);
    setOperation({ busy: '', error: '', notice: 'The plan and its retained Lead/Risk review status came from the service. No action was prepared.' });
    await refreshOverview({ quiet: true });
  }

  async function loadRecord(record) {
    if (!record?.id || !generationIsCurrent(contextGeneration.current)) return;
    const generation = contextGeneration.current;
    const serial = ++detailGeneration.current;
    const key = record.id;
    setDetailErrors(current => ({ ...current, [key]: '' }));
    try {
      const value = await requestRef.current(session.token, `${ROOT}/records/${encodeURIComponent(key)}`);
      if (!generationIsCurrent(generation) || detailGeneration.current !== serial) return;
      const loaded = isRecord(value?.record) ? value.record : value;
      if (!exactRecord(loaded) || loaded.id !== key) throw new Error('The retained record response did not match the requested record.');
      setLoadedRecords(current => ({ ...current, [key]: loaded }));
      setDetailErrors(current => ({ ...current, [key]: '' }));
      if (latestPlan?.plan?.id === key && loaded.data?.review) setLatestPlan(current => ({ ...current, review: loaded.data.review }));
    } catch (error) {
      if (generationIsCurrent(generation) && detailGeneration.current === serial) {
        setDetailErrors(current => ({ ...current, [key]: errorMessage(error) }));
      }
    }
  }

  async function preparePlan(record) {
    const review = planReview(record, loadedRecords, latestPlan);
    const eligibility = reviewEligibility(record, review);
    if (!eligibility.allowed) {
      setOperation({ busy: '', error: eligibility.reason, notice: '' });
      return;
    }
    const continuation = actionHeads.find(action => action.data?.status === 'AWAITING_NEXT_LEG' && action.data.nextPlanId === record?.id);
    const planId = continuation?.data.planId ?? record?.id;
    if (typeof planId !== 'string' || typeof record?.id !== 'string') return;
    const generation = contextGeneration.current;
    const result = await post('/prepare', { planId });
    if (!result || !generationIsCurrent(generation)) return;
    if (typeof result.actionId !== 'string' || result.standard !== 'raw_ed25519'
      || typeof result.payload !== 'string' || result.payload.length === 0
      || typeof result.expiresAt !== 'string' || !Number.isFinite(Date.parse(result.expiresAt))) {
      setOperation({ busy: '', error: 'The service returned an invalid unsigned action. It was not offered for signing.', notice: '' });
      await refreshOverview({ quiet: true });
      return;
    }
    const nextPrepared = { ...result, planId, planRecordId: record.id, signed: false };
    setPrepared(nextPrepared);
    setQuoteReadState({ actionId: result.actionId, status: 'loading', error: '' });
    setSignatureState(null);
    setConfirmRelayActionId(null);
    setRelayUnknown(null);
    setOperation({ busy: '', error: '', notice: 'Prepared once. Loading the retained action and exact quote bounds before enabling any wallet prompt.' });
    setRelayResult(null);
    const retained = await refreshOverview({ quiet: true, quoteAction: nextPrepared });
    if (!generationIsCurrent(generation)) return;
    if (!retained) {
      setQuoteReadState({
        actionId: result.actionId,
        status: 'error',
        error: 'The prepared action quote could not be read. Retry this retained-state GET; do not prepare again.',
      });
      return;
    }
    const reviewAfterRead = preparedQuoteReview(retained, nextPrepared, session?.walletAddress);
    setOperation(reviewAfterRead.valid
      ? { busy: '', error: '', notice: 'The retained action and exact current quote bounds were read. The wallet button also checks the quote hash and current state.' }
      : { busy: '', error: reviewAfterRead.reason, notice: 'Signing remains blocked. Refresh the retained quote only; no second prepare or model call is offered.' });
  }

  async function refreshPreparedQuote(actionId) {
    if (busyRef.current || prepared?.actionId !== actionId) return;
    const generation = contextGeneration.current;
    const retained = await refreshOverview({ quiet: true, quoteAction: prepared });
    if (!generationIsCurrent(generation) || prepared?.actionId !== actionId) return;
    if (!retained) {
      setQuoteReadState({
        actionId,
        status: 'error',
        error: 'The retained quote read failed. Retry this GET only; the action will not be prepared again.',
      });
      return;
    }
    const reviewAfterRead = preparedQuoteReview(retained, prepared, session?.walletAddress);
    setOperation(reviewAfterRead.valid
      ? { busy: '', error: '', notice: 'Retained action context and exact quote bounds refreshed from the service.' }
      : { busy: '', error: reviewAfterRead.reason, notice: 'Signing remains blocked until the exact retained action and quote context match.' });
  }

  async function signPreparedAction() {
    if (!prepared || prepared.signed || Date.parse(prepared.expiresAt) <= Date.now()) {
      setOperation({ busy: '', error: 'This unsigned action is missing, already signed, or expired. Prepare a fresh action from the retained plan.', notice: '' });
      return;
    }
    if (busyRef.current) return;
    const generation = contextGeneration.current;
    const review = preparedQuoteReview(overview, prepared, session?.walletAddress);
    if (!review.signingReady || quoteReadState.actionId !== prepared.actionId || quoteReadState.status !== 'ready') {
      setOperation({ busy: '', error: review.reason || quoteReadState.error || 'Read and review the exact current retained quote before signing.', notice: '' });
      return;
    }
    if (currentAddress(walletSession) !== session?.walletAddress) {
      setOperation({ busy: '', error: 'The signing wallet no longer matches the verified session. The payload was not signed.', notice: '' });
      return;
    }
    if (typeof walletSession?.signMessage !== 'function') {
      setOperation({ busy: '', error: 'The connected wallet does not expose message signing. No action was signed.', notice: '' });
      return;
    }
    busyRef.current = true;
    setOperation({ busy: '/quote-verification', error: '', notice: 'Rechecking the canonical quote hash and current action context before opening the wallet.' });
    const overviewSerial = overviewGeneration.current;
    const hashMatches = await quoteDigestMatches(review);
    if (!generationIsCurrent(generation) || currentAddress(walletSession) !== session?.walletAddress
      || overviewGeneration.current !== overviewSerial) {
      busyRef.current = false;
      if (generationIsCurrent(generation)) {
        setOperation({ busy: '', error: 'The retained action context changed during quote verification. Refresh it before signing.', notice: '' });
      }
      return;
    }
    if (!hashMatches || !preparedQuoteReview(overview, prepared, session?.walletAddress).signingReady
      || quoteReadState.actionId !== prepared.actionId || quoteReadState.status !== 'ready'
      || Date.parse(prepared.expiresAt) <= Date.now()) {
      busyRef.current = false;
      setQuoteReadState({
        actionId: prepared.actionId,
        status: 'blocked',
        error: hashMatches ? 'The prepared action is no longer current or its quote expired.' : 'The retained quote hash does not match its canonical bytes.',
      });
      setOperation({ busy: '', error: 'The current quote or action context changed. No wallet prompt was opened.', notice: '' });
      return;
    }
    setOperation({ busy: '/wallet-signing', error: '', notice: '' });
    let signature;
    try {
      signature = await walletSession.signMessage(new TextEncoder().encode(prepared.payload));
    } catch (error) {
      if (generationIsCurrent(generation)) {
        busyRef.current = false;
        setOperation({ busy: '', error: errorMessage(error), notice: '' });
      }
      return;
    }
    if (!generationIsCurrent(generation) || currentAddress(walletSession) !== session?.walletAddress) {
      if (signature instanceof Uint8Array) signature.fill(0);
      return;
    }
    if (!(signature instanceof Uint8Array) || signature.length !== 64) {
      busyRef.current = false;
      setOperation({ busy: '', error: 'The wallet returned an invalid Ed25519 message signature. It was not registered.', notice: '' });
      return;
    }
    if (Date.parse(prepared.expiresAt) <= Date.now()) {
      signature.fill(0);
      busyRef.current = false;
      setOperation({ busy: '', error: 'The action expired while the wallet was signing. Its signature was not registered.', notice: '' });
      return;
    }
    const actionId = prepared.actionId;
    let signatureBase64;
    try { signatureBase64 = bytesToBase64(signature); } catch (error) {
      signature.fill(0);
      busyRef.current = false;
      setOperation({ busy: '', error: errorMessage(error), notice: '' });
      return;
    }
    busyRef.current = false;
    setOperation({ busy: '', error: '', notice: '' });
    const result = await post('/signatures', { actionId, signatureBase64 }, { safeRetry: false });
    signature.fill(0);
    if (!generationIsCurrent(generation)) return;
    if (!result) {
      setSignatureState({ actionId, status: 'UNKNOWN' });
      setPrepared(current => current?.actionId === actionId ? { ...current, signed: true } : current);
      setOperation({ busy: '', error: 'Signature registration may have reached the service. Refresh the retained action before signing or relaying again.', notice: '' });
      await refreshOverview({ quiet: true });
      return;
    }
    if (result.actionId !== actionId || result.status !== 'SIGNED') {
      setSignatureState({ actionId, status: result.status ?? 'UNKNOWN' });
      setPrepared(current => current?.actionId === actionId ? { ...current, signed: true } : current);
      setOperation({ busy: '', error: 'The service did not confirm the signed action. Refresh its retained status before continuing.', notice: '' });
      await refreshOverview({ quiet: true });
      return;
    }
    setPrepared(current => current?.actionId === actionId ? { ...current, signed: true } : current);
    setSignatureState({ actionId, status: result.status, expiresAt: result.expiresAt });
    setRelayResult(null);
    setOperation({ busy: '', error: '', notice: 'The wallet signature was registered for this exact payload. Relay remains a separate action.' });
    await refreshOverview({ quiet: true });
  }
  async function relaySignedAction(actionId = prepared?.actionId) {
    if (busyRef.current || typeof actionId !== 'string') return;
    const storedRecord = actionHeads.find(record => recordIdentifier(record) === actionId);
    const quoteHash = storedRecord?.data?.quote?.sha256;
    if (typeof quoteHash !== 'string') {
      setOperation({ busy: '', error: 'The retained exact quote hash is unavailable. Refresh service state before relaying.', notice: '' });
      return;
    }
    const signedLocally = prepared?.actionId === actionId && prepared.signed
      && signatureState?.actionId === actionId && signatureState.status === 'SIGNED';
    if (!signedLocally && recordStatus(storedRecord) !== 'SIGNED') return;
    if (relayUnknown === actionId || relayResult?.actionId === actionId) return;
    if (confirmRelayActionId !== actionId) {
      setConfirmRelayActionId(actionId);
      return;
    }
    if (currentAddress(walletSession) !== session?.walletAddress) {
      setOperation({ busy: '', error: 'The signing wallet changed. This relay was not requested.', notice: '' });
      return;
    }
    const expiresAt = prepared?.actionId === actionId
      ? prepared.expiresAt
      : storedRecord?.data?.quote?.raw?.quote?.deadline;
    if (typeof expiresAt === 'string' && Date.parse(expiresAt) <= Date.now()) {
      setConfirmRelayActionId(null);
      setOperation({ busy: '', error: 'This signed quote has expired. The service will not relay it; reconcile or prepare a fresh action.', notice: '' });
      return;
    }
    let relayFailure = null;
    const result = await post('/relay', { actionId }, { safeRetry: false, onFailure: error => { relayFailure = error; } });
    setConfirmRelayActionId(null);
    if (!result) {
      const rejected = relayFailure && ((Number.isInteger(relayFailure.status) && relayFailure.status >= 400 && relayFailure.status < 500)
        || ['UNAUTHORIZED', 'INVALID_INPUT', 'CONFLICT', 'NOT_FOUND'].includes(relayFailure.code));
      if (rejected) {
        setRelayUnknown(null);
        setOperation({ busy: '', error: relayFailure.code === 'UNAUTHORIZED' || relayFailure.status === 401 || relayFailure.status === 403
          ? 'The service rejected relay. A separate operator grant and exact trial approval for this action and quote are required; no submission occurred.'
          : `The service rejected relay before submission. ${errorMessage(relayFailure)} The signed action remains stored.`, notice: '' });
      } else {
        setRelayUnknown(actionId);
        setOperation({ busy: '', error: 'The relay outcome is unknown. Do not submit this action again; refresh and reconcile its retained status.', notice: '' });
      }
      await refreshOverview({ quiet: true });
      return;
    }
    if (result.actionId !== actionId || !['SUBMISSION_UNKNOWN', 'SUBMITTED'].includes(result.status)) {
      setRelayUnknown(actionId);
      setRelayResult({ actionId, status: 'SUBMISSION_UNKNOWN' });
      setOperation({ busy: '', error: 'The service did not return a recognized relay state. Reconcile before any further action.', notice: '' });
      await refreshOverview({ quiet: true });
      return;
    }
    setRelayResult(result);
    setRelayUnknown(result.status === 'SUBMISSION_UNKNOWN' ? actionId : null);
    setOperation({ busy: '', error: '', notice: result.status === 'SUBMISSION_UNKNOWN'
      ? 'Submission is unknown. The action remains unresolved; reconcile before another movement.'
      : 'The service accepted the signed payload for submission. Settlement is not confirmed; reconcile its receipts.' });
    await refreshOverview({ quiet: true });
  }

  async function reconcileAction(actionId) {
    if (typeof actionId !== 'string' || !actionId) return;
    const result = await post('/reconcile', { actionId });
    if (!result) return;
    setReconciliations(current => ({ ...current, [actionId]: result }));
    if (relayUnknown === actionId && !relayResult) setRelayResult({ actionId, status: 'SUBMISSION_UNKNOWN' });
    setOperation({ busy: '', error: '', notice: `Reconciliation returned ${result.status ?? 'an unknown status'} from the service.` });
    await refreshOverview({ quiet: true });
  }

  async function setMonitoring(enabled) {
    const result = await post('/monitor', { enabled });
    if (!result) return;
    setOperation({ busy: '', error: '', notice: `The service reported monitoring ${result.enabled === true ? 'enabled' : result.enabled === false ? 'stopped' : 'in an unknown state'}.` });
    await refreshOverview({ quiet: true });
  }

  async function submitPlanFromRecord(record) {
    await preparePlan(record);
  }

  const portfolio = portfolioFromRecord(overview?.portfolio);
  const mandate = mandateFromRecord(overview?.mandate);
  const actionContext = mandateActionContext(overview, session?.walletAddress);
  const monitor = overview?.monitor;
  const actionRecords = Array.isArray(overview?.actions) ? overview.actions : [];
  const actionHeads = actionHeadRecords(actionRecords);
  const unresolvedHeads = actionHeads.filter(record => !TERMINAL_ACTION_STATUSES.has(recordStatus(record)));
  const terminalHeads = actionHeads.filter(record => TERMINAL_ACTION_STATUSES.has(recordStatus(record)));
  const planRecords = Array.isArray(overview?.plans) ? overview.plans : [];
  const busy = Boolean(operation.busy);
  const activeActionId = prepared?.actionId;
  const preparedReview = prepared ? preparedQuoteReview(overview, prepared, session?.walletAddress) : null;
  const preparedRecord = preparedReview?.record
    ?? actionHeads.find(record => recordIdentifier(record) === activeActionId) ?? null;
  const preparedSummary = recordData(preparedRecord);
  const latestPlanData = recordData(latestPlan?.plan);
  const latestProposal = latestPlanData.proposal ?? latestPlanData.snapshot?.proposal;
  const actionAmount = preparedSummary.inputBaseUnits ?? preparedSummary.proposal?.inputBaseUnits ?? latestProposal?.inputBaseUnits;
  const actionSource = preparedSummary.sourceAssetId ?? preparedSummary.proposal?.sourceAssetId ?? latestProposal?.sourceAssetId;
  const actionQuoteHash = typeof preparedSummary.quote?.sha256 === 'string' ? preparedSummary.quote.sha256 : null;
  const nowExpired = prepared && Number.isFinite(Date.parse(prepared.expiresAt)) && Date.parse(prepared.expiresAt) <= Date.now();
  const quoteState = quoteReadState.actionId === activeActionId ? quoteReadState : { actionId: activeActionId, status: 'blocked', error: 'Read the retained exact action quote before signing.' };
  const signReady = Boolean(prepared && preparedReview?.signingReady
    && quoteState.actionId === prepared.actionId && quoteState.status === 'ready'
    && !busy && !nowExpired && generationIsCurrent(contextGeneration.current)
    && signatureState?.actionId !== prepared.actionId && signatureState?.status !== 'UNKNOWN');
  const actionAmountAsset = actionContext?.inventory.assets.get(planForm.action === 'invest' || planForm.action === 'reinvest'
    ? actionContext.mandate.reserveAssetId : planForm.sourceAssetId);
  const actionBalance = actionContext?.inventory.balances.get(actionAmountAsset?.assetId);
  const actionBalanceText = actionAmountAsset && actionBalance !== undefined
    ? baseUnitsInputText(actionBalance, actionAmountAsset.decimals) : null;
  const readinessStatus = overview?.readiness?.status ?? 'UNKNOWN';
  const canManageMonitor = Boolean(mandate) && !busy;
  const isBuyAction = ['invest', 'reinvest'].includes(planForm.action);
  const isExitAction = ['redeem', 'rotate'].includes(planForm.action);
  const selectableAssets = isBuyAction
    ? savedAllocation ? [] : actionContext?.targets ?? []
    : isExitAction && actionContext
      ? [...actionContext.inventory.assets.values()]
        .filter(asset => asset.kind === 'receipt' && unsignedInteger(actionContext.inventory.balances.get(asset.assetId)) > 0n)
      : [];
  const policyInventory = portfolioInventory(portfolio, session?.walletAddress);
  const policyReserveAsset = policyInventory?.assets.get(mandate?.reserveAssetId);
  const reserveFloorText = policyReserveAsset
    ? baseUnitsInputText(mandate?.reserveFloorBaseUnits, policyReserveAsset.decimals) : null;
  const actionCapText = policyReserveAsset
    ? baseUnitsInputText(mandate?.maxActionReserveBaseUnits, policyReserveAsset.decimals) : null;
  const savedPositionLimitText = Number.isSafeInteger(mandate?.maxPositionBps) && mandate.maxPositionBps >= 0 && mandate.maxPositionBps <= 10000
    ? `${percentInputText(String(mandate.maxPositionBps))}%` : 'Unavailable';
  const template = validConsumerTemplate(overview?.policyTemplate) ? overview.policyTemplate : null;
  const mandateSaveReady = validateMandateDraft().valid;
  const renderActionRecord = record => {
    const loaded = loadedRecords[record.id] ?? record;
    const actionId = recordIdentifier(record);
    const status = recordStatus(loaded);
    const reconciliation = reconciliations[actionId];
    const needsReconcile = actionId && RECONCILABLE_ACTION_STATUSES.has(status);
    const hasPreparedAction = prepared?.actionId === actionId;
    const quoteHash = typeof loaded.data?.quote?.sha256 === 'string' ? loaded.data.quote.sha256 : null;
    const showRelayConfirmation = status === 'SIGNED' && !hasPreparedAction && Boolean(quoteHash);
    const relayConfirming = confirmRelayActionId === actionId && showRelayConfirmation;
    const sourceAssetId = loaded.data?.sourceAssetId;
    const targetAssetId = loaded.data?.targetAssetId;
    const inputBaseUnits = loaded.data?.inputBaseUnits;
    const safeActionData = safeDetails(loaded.data);
    const sourceAsset = assetFor(portfolio, sourceAssetId);
    const targetAsset = assetFor(portfolio, targetAssetId);
    return <article className="cfo-record cfo-action-status" key={record.id}>
      <div className="cfo-record-heading"><div><strong>{record.kind || 'Action'} · {status}</strong><time dateTime={record.createdAt}>{record.createdAt || 'Time unknown'}</time></div><code>{actionId ?? record.id}</code></div>
      {inputBaseUnits && <p className="cfo-record-summary">Input: {amountLabel(inputBaseUnits, sourceAssetId, portfolio)}</p>}
      {sourceAssetId && <p className="cfo-record-summary">Source: {sourceAsset?.symbol ?? 'Asset unavailable'}</p>}
      {targetAssetId && <p className="cfo-record-summary">Target: {targetAsset?.symbol ?? 'Asset unavailable'}</p>}
      {quoteHash && <p className="cfo-record-summary">Quote hash: <code>{quoteHash}</code></p>}
      {status === 'SIGNED' && !quoteHash && <p className="cfo-footnote">The exact quote hash is unavailable. Refresh the retained record before relaying.</p>}
      {loaded.data?.reason && <p className="cfo-record-summary">{loaded.data.reason}</p>}
      {loaded.data?.intentHash && <p className="cfo-record-summary">Intent hash: <code>{loaded.data.intentHash}</code></p>}
      {loaded.data?.nearTxHashes?.length > 0 && <ul className="cfo-reasons">{loaded.data.nearTxHashes.map(hash => <li key={hash}><code>{hash}</code></li>)}</ul>}
      {reconciliation && <p className="cfo-status" role="status">Latest reconciliation: {reconciliation.status ?? 'UNKNOWN'}{reconciliation.reason ? ` · ${reconciliation.reason}` : ''}</p>}
      {relayUnknown === actionId && <p className="cfo-field-error" role="alert">Submission outcome unknown; reconcile this action before any dependent movement.</p>}
      {detailErrors[record.id] && <p className="cfo-field-error" role="alert">{detailErrors[record.id]}</p>}
      <div className="cfo-actions">
        <button className="cfo-button cfo-button--quiet" type="button" disabled={busy} onClick={() => void loadRecord(record)}>Load retained record</button>
        {showRelayConfirmation && confirmRelayActionId !== actionId && <button className="cfo-button cfo-button--danger" type="button" disabled={busy || relayUnknown === actionId || relayResult?.actionId === actionId} onClick={() => void relaySignedAction(actionId)}>Review signed relay action</button>}
        {needsReconcile && <button className="cfo-button cfo-button--quiet" type="button" disabled={busy} onClick={() => void reconcileAction(actionId)} aria-busy={operation.busy === '/reconcile'}>{operation.busy === '/reconcile' ? 'Reconciling…' : 'Reconcile receipts and balances'}</button>}
      </div>
      {relayConfirming && <div className="cfo-relay-confirm" role="group" aria-labelledby={`cfo-history-relay-title-${actionId}`}>
        <h4 id={`cfo-history-relay-title-${actionId}`}>Confirm relay to NEAR Intents mainnet</h4>
        <p>This retained action already has your signature. Relay will submit only its stored signed bytes for action <code>{actionId}</code> and quote <code>{quoteHash}</code>. It will not request a new signature. The separate exact-action operator grant is still required.</p>
        {inputBaseUnits && <p>Input: {amountLabel(inputBaseUnits, sourceAssetId, portfolio)}{targetAssetId ? ` to ${targetAssetId}` : ''}</p>}
        <button className="cfo-button cfo-button--danger" type="button" disabled={busy || relayUnknown === actionId || relayResult?.actionId === actionId} onClick={() => void relaySignedAction(actionId)} aria-busy={operation.busy === '/relay'}>{operation.busy === '/relay' ? 'Submitting stored action…' : 'Confirm and submit signed action'}</button>
        <button className="cfo-button cfo-button--quiet" type="button" disabled={busy} onClick={() => setConfirmRelayActionId(null)}>Cancel relay</button>
      </div>}
      {Object.keys(safeActionData).length > 0 && <details className="cfo-evidence-details"><summary>Retained safe quote and action details</summary><pre>{JSON.stringify(safeActionData, null, 2)}</pre></details>}
    </article>;
  };

  return <section className="cfo" aria-labelledby="cfo-title">
    <header className="cfo-header">
      <div>
        <p className="cfo-eyebrow">Owner treasury / NEAR Intents mainnet</p>
        <h2 id="cfo-title">AI CFO</h2>
        <p className="cfo-intro">Owner balance capture, an explicit mandate, independent review, and your signature on each exact action.</p>
      </div>
      <div className="cfo-header-actions">
        <span className="cfo-wallet" title={session?.walletAddress ?? 'No verified wallet'}>{walletAddress === session?.walletAddress && walletAddress ? `${walletAddress.slice(0, 5)}…${walletAddress.slice(-5)}` : 'Wallet mismatch'}</span>
        <button className="cfo-button cfo-button--quiet" type="button" onClick={() => void refreshOverview()} disabled={busy || !session?.token || walletAddress !== session?.walletAddress} aria-busy={load.status === 'refreshing'}>
          {load.status === 'refreshing' ? 'Refreshing…' : 'Refresh service state'}
        </button>
      </div>
    </header>

    <aside className="cfo-warning" aria-labelledby="cfo-mainnet-warning">
      <h3 id="cfo-mainnet-warning">Mainnet funds at risk</h3>
      <p>NEAR Intents has no testnet for this flow. Receipt tokens are risky positions, not cash equivalents. This dashboard does not accept provider terms or authorize a funded trial. The owner must review every exact payload; the server still requires a separate operator grant for a specific action and quote.</p>
    </aside>

    <div className="cfo-readiness" role="group" aria-label="Provider and execution readiness">
      <article className="cfo-readiness-card">
        <p className="cfo-label">Backend readiness</p>
        <strong className={`cfo-state cfo-state--${readinessStatus.toLowerCase()}`}>{readinessStatus}</strong>
        {overview?.readiness?.reasons?.length
          ? <ul>{overview.readiness.reasons.map((reason, index) => <li key={`${index}-${reason}`}>{reason}</li>)}</ul>
          : <p>{overview ? 'The service reported no readiness reasons.' : 'No readiness result has been loaded.'}</p>}
      </article>
      <article className="cfo-readiness-card">
        <p className="cfo-label">Provider readiness</p>
        <strong className="cfo-state">UNKNOWN</strong>
        <p>The overview does not expose a separate provider status. The UI will not infer it from configuration or candidate assets.</p>
        <p className="cfo-gate-note"><strong>Provider terms:</strong> not confirmed here. This dashboard cannot accept them.</p>
      </article>
      <article className="cfo-readiness-card">
        <p className="cfo-label">Execution readiness</p>
        <strong className="cfo-state cfo-state--blocked">BLOCKED</strong>
        <p>A separate operator authorization for this exact action and quote is required. No such trial grant is supplied to this dashboard.</p>
      </article>
    </div>

    {load.status === 'loading' && <div className="cfo-loading" role="status" aria-live="polite"><span className="cfo-skeleton" /><span className="cfo-skeleton" /><span className="cfo-skeleton" /><p>Loading the owner-bound CFO overview…</p></div>}
    {(load.status === 'error' || load.status === 'wallet-mismatch' || load.status === 'blocked') && <div className="cfo-error" role="alert"><p>{load.error}</p>{load.status === 'error' && <button className="cfo-button cfo-button--quiet" type="button" onClick={() => void refreshOverview()}>Try again</button>}</div>}
    {load.status === 'wallet-mismatch' && session?.walletAddress && <section className="cfo-wallet-reconnect" aria-labelledby="cfo-wallet-reconnect-title">
      <div><p className="cfo-eyebrow">Verified owner session</p><h3 id="cfo-wallet-reconnect-title">Reconnect its signing wallet</h3></div>
      <p>The saved session belongs to {session.walletAddress.slice(0, 5)}…{session.walletAddress.slice(-5)}. Reconnection only selects the matching wallet account; it does not request a new login signature or sign a financial action.</p>
      {walletConnectError && <p className="cfo-field-error" role="alert">{walletConnectError}</p>}
      {walletOptions.length > 0
        ? <ul className="cfo-wallet-options">{walletOptions.map((wallet, index) => <li key={wallet.id}>
          <button className="cfo-button cfo-button--quiet" type="button" disabled={!wallet.available || Boolean(walletConnectBusy)} onClick={() => void reconnectWallet(wallet)} aria-describedby={!wallet.available ? `cfo-wallet-reason-${index}` : undefined} aria-busy={walletConnectBusy === wallet.id}>
            {walletConnectBusy === wallet.id ? `Connecting ${wallet.name}…` : `Connect ${wallet.name}`}
          </button>
          {!wallet.available && <small className="cfo-wallet-reason" id={`cfo-wallet-reason-${index}`}>{wallet.reason || 'This wallet does not support the required message-signing capability.'}</small>}
        </li>)}</ul>
        : <p className="cfo-empty">No wallet options are currently available. CFO data remains hidden until the matching Solana message-signing wallet is available.</p>}
    </section>}
    {load.status === 'refreshing' && <p className="cfo-status" role="status" aria-live="polite">Refreshing retained service data. Previous results remain labeled with their snapshot cutoff.</p>}
    {overview && ['ready', 'refreshing', 'error'].includes(load.status) && <>
      {load.status === 'error' && <p className="cfo-status" role="status">Showing the last successful overview. The latest refresh failed; displayed balances retain their original snapshot cutoff.</p>}
      {operation.error && <div className="cfo-error" role="alert"><p>{operation.error}</p></div>}
      {operation.notice && <p className="cfo-status" role="status" aria-live="polite">{operation.notice}</p>}

      <section className="cfo-panel" aria-labelledby="cfo-portfolio-title">
        <div className="cfo-panel-heading">
          <div><p className="cfo-eyebrow">Observed inventory</p><h3 id="cfo-portfolio-title">Balances and reserve</h3></div>
          <button className="cfo-button cfo-button--primary" type="button" onClick={() => void capturePortfolio()} disabled={busy || walletAddress !== session?.walletAddress} aria-busy={operation.busy === '/capture'}>
            {operation.busy === '/capture' ? 'Capturing…' : 'Capture finalized portfolio'}
          </button>
        </div>
        {portfolio && portfolio.status === 'OBSERVED' && Array.isArray(portfolio.assets) && Array.isArray(portfolio.balances) ? <>
          <div className="cfo-snapshot-meta">
            <span><strong>Snapshot cutoff</strong> <time dateTime={portfolio.capturedAt}>{portfolio.capturedAt || 'Unknown'}</time></span>
            <span><strong>Finalized block</strong> {portfolio.blockHeight ?? 'Unknown'}</span>
            <span><strong>Block hash</strong> <code>{portfolio.blockHash || 'Unknown'}</code></span>
          </div>
          {portfolio.balances.length ? <div className="cfo-balance-list">
            {portfolio.balances.map((balance, index) => {
              const asset = assetFor(portfolio, balance?.assetId);
              const isReserve = asset?.kind === 'reserve';
              const balanceText = amountLabel(balance?.balanceBaseUnits, balance?.assetId, portfolio);
              return <article className="cfo-balance" key={`${balance?.assetId ?? 'unknown'}-${index}`}>
                <div><p className="cfo-label">{isReserve ? 'Stable reserve' : asset?.kind === 'receipt' ? 'Receipt position' : 'Asset'}</p><h4>{asset?.symbol ?? 'Unknown asset'}</h4><details className="cfo-evidence-details"><summary>Asset identity</summary><code>{balance?.assetId ?? 'Asset ID unavailable'}</code></details></div>
                <strong className="cfo-amount">{balanceText}</strong>
              </article>;
            })}
          </div> : <p className="cfo-empty">The service returned an observed snapshot with no supported account balances.</p>}
          <p className="cfo-footnote">This snapshot covers only supported account inventory. It is not a complete wealth statement or live balance. No PnL or APY is inferred.</p>
          {Array.isArray(portfolio.reasons) && portfolio.reasons.length > 0 && <ul className="cfo-reasons">{portfolio.reasons.map((reason, index) => <li key={`${index}-${reason}`}>{reason}</li>)}</ul>}
        </> : <div className="cfo-empty"><h4>{portfolio?.status === 'NO_DATA' ? 'Portfolio data is unavailable' : 'No finalized portfolio snapshot yet'}</h4><p>{portfolio?.reasons?.join(' ') || 'Choose Capture finalized portfolio to request real owner balances from the service. No missing balance is shown as zero.'}</p></div>}
      </section>

      <section className="cfo-primary-flow" aria-labelledby="cfo-consumer-title">
        <div className="cfo-panel-heading">
          <div><p className="cfo-eyebrow">Daily owner workflow</p><h3 id="cfo-consumer-title">Choose a position. Enter an amount.</h3></div>
        </div>
        <div className="cfo-limit-summary" role="group" aria-label="Saved policy limits">
          <div><span className="cfo-label">Saved reserve floor</span><strong>{reserveFloorText === null ? 'Unavailable' : `${reserveFloorText} ${policyReserveAsset?.symbol ?? ''}`}</strong></div>
          <div><span className="cfo-label">Maximum action reserve</span><strong>{actionCapText === null ? 'Unavailable' : `${actionCapText} ${policyReserveAsset?.symbol ?? ''}`}</strong></div>
          <div><span className="cfo-label">Maximum position</span><strong>{mandate ? savedPositionLimitText : 'No saved limit'}</strong></div>
        </div>
        {!actionContext && <div className="cfo-empty" role="status">
          <h4>Consumer actions are unavailable</h4>
          <p>A valid saved mandate and matching observed owner portfolio with exact asset metadata and decimals are required. No asset IDs, balances, or spendable cash are inferred.</p>
        </div>}
        <form className="cfo-form" noValidate onSubmit={createPlan} aria-busy={operation.busy === '/plans'}>
          <label className="cfo-field" htmlFor="cfo-action-type"><span>Action</span>
            <select id="cfo-action-type" value={planForm.action} onChange={event => setPlanField('action', event.target.value)} aria-invalid={Boolean(planErrors.action)} aria-describedby="cfo-action-type-error" required disabled={busy || !actionContext}>
              <option value="">Choose an action</option>
              <option value="invest">Invest</option>
              <option value="reinvest">Reinvest settled funds</option>
              <option value="redeem">Redeem a held position</option>
              <option value="rotate">Rotate to a permitted position</option>
            </select>
            <small className="cfo-field-error" id="cfo-action-type-error">{planErrors.action ?? ''}</small>
          </label>
          <fieldset className="cfo-investment-grid" id="cfo-action-assets" tabIndex="-1" aria-describedby="cfo-action-assets-error" aria-label={isBuyAction ? 'Permitted investments' : 'Observed held positions'}>
            <legend>{isBuyAction && savedAllocation ? 'Saved allocation mode' : isBuyAction ? 'Permitted investments' : isExitAction ? 'Observed held positions' : 'Choose an action to see eligible positions'}</legend>
            {selectableAssets.map(item => {
              const asset = item.asset ?? item;
              const selected = isBuyAction ? planForm.targetAssetId === asset.assetId : planForm.sourceAssetId === asset.assetId;
              const balance = actionContext.inventory.balances.get(asset.assetId);
              const balanceText = balance === undefined ? null : baseUnitsInputText(balance, asset.decimals);
              const weight = isBuyAction ? item.weightBps : null;
              return <div className="cfo-position-option" key={asset.assetId}>
                <button
                  className={`cfo-position-card${selected ? ' cfo-position-card--selected' : ''}`}
                  type="button"
                  aria-pressed={selected}
                  aria-label={`Select ${asset.symbol}`}
                  disabled={busy}
                  onClick={() => {
                    setSavedAllocation(false);
                    setActionAmountText('');
                    setPlanErrors(current => ({ ...current, sourceAssetId: undefined, targetAssetId: undefined, inputBaseUnits: undefined }));
                    setPlanForm(current => isBuyAction
                      ? { ...current, sourceAssetId: actionContext.mandate.reserveAssetId, targetAssetId: asset.assetId, inputBaseUnits: '' }
                      : { ...current, sourceAssetId: asset.assetId, targetAssetId: current.action === 'redeem' ? actionContext.mandate.reserveAssetId : current.targetAssetId, inputBaseUnits: '' });
                  }}
                >
                  <span className="cfo-label">{isBuyAction ? 'Mandated investment' : 'Held receipt position'}</span>
                  <strong>{asset.symbol}</strong>
                  {balanceText !== null && <span>Observed balance: {balanceText} {asset.symbol}</span>}
                  {weight !== null && <span>Saved target: {percentInputText(String(weight))}%</span>}
                  <small>Observed {portfolio?.capturedAt ?? 'cutoff unavailable'}</small>
                </button>
                <details className="cfo-evidence-details"><summary>Asset identity</summary><code>{asset.assetId}</code></details>
              </div>;
            })}
            {planForm.action && selectableAssets.length === 0 && !(isBuyAction && savedAllocation) && <p className="cfo-empty">
              {isBuyAction ? 'No observed investment is currently permitted by the saved mandate.' : 'No supported held receipt position has a positive observed balance.'}
            </p>}
          </fieldset>
            <small className="cfo-field-error" id="cfo-action-assets-error" role="alert">{isBuyAction && !savedAllocation ? planErrors.targetAssetId ?? '' : isExitAction ? planErrors.sourceAssetId ?? '' : ''}</small>
          {planForm.action === 'rotate' && <label className="cfo-field" htmlFor="cfo-action-target">
            <span>Next receipt target</span>
            <select id="cfo-action-target" value={planForm.targetAssetId} onChange={event => setPlanField('targetAssetId', event.target.value)} aria-invalid={Boolean(planErrors.targetAssetId)} required disabled={busy || !actionContext}>
              <option value="">Choose a permitted target</option>
              {actionContext?.targets.filter(target => target.assetId !== planForm.sourceAssetId).map(target => <option value={target.assetId} key={target.assetId}>{target.symbol} · saved target {percentInputText(String(target.weightBps))}%</option>)}
            </select>
            <small className="cfo-field-error">{planErrors.targetAssetId ?? ''}</small>
          </label>}
          {isBuyAction && <label className="cfo-field">
            <input
              type="checkbox"
              checked={savedAllocation}
              onChange={event => {
                setSavedAllocation(event.target.checked);
                setActionAmountText('');
                setPlanForm(current => ({ ...current, targetAssetId: event.target.checked ? '' : current.targetAssetId, inputBaseUnits: '' }));
                setPlanErrors(current => ({ ...current, targetAssetId: undefined, inputBaseUnits: undefined }));
              }}
              disabled={busy || !actionContext?.targets.length}
            />
            <span>Use saved allocation instead of an explicit target and amount</span>
            <small>The service derives a mandate-weighted amount from fresh quote-valued exposure and settled reserve. This mode is explicit and does not display invented spendable cash.</small>
          </label>}
          {!(isBuyAction && savedAllocation) && <div className="cfo-amount-editor">
            <label className="cfo-field" htmlFor="cfo-action-amount">
              <span>Exact amount {actionAmountAsset?.symbol ? `(${actionAmountAsset.symbol})` : ''}</span>
              <input
                id="cfo-action-amount"
                type="text"
                inputMode="decimal"
                autoComplete="off"
                spellCheck="false"
                value={actionAmountText}
                onChange={event => {
                  setActionAmountText(event.target.value);
                  setPlanErrors(current => ({ ...current, inputBaseUnits: undefined }));
                }}
                aria-invalid={Boolean(planErrors.inputBaseUnits)}
                aria-describedby="cfo-action-amount-hint cfo-action-amount-error"
                required={Boolean(planForm.action)}
                disabled={busy || !actionAmountAsset}
              />
              <small id="cfo-action-amount-hint">
                {actionAmountAsset && actionBalanceText !== null
                  ? `Observed balance: ${actionBalanceText} ${actionAmountAsset.symbol}. Token precision: ${actionAmountAsset.decimals} decimal places. This is not a spendable-cash or NAV calculation.`
                  : 'Choose an eligible observed position with verified token decimals. No amount is prefilled.'}
              </small>
              <small className="cfo-field-error" id="cfo-action-amount-error">{planErrors.inputBaseUnits ?? ''}</small>
            </label>
          </div>}
          <button className="cfo-button cfo-button--primary" type="submit" disabled={busy || !actionContext || !planForm.action || (selectableAssets.length === 0 && !savedAllocation)} aria-busy={operation.busy === '/plans'}>
            {operation.busy === '/plans' ? 'Requesting plan…' : isExitAction ? 'Check deterministic exit plan' : 'Request Lead / Risk review'}
          </button>
        </form>
      </section>

      <section className="cfo-panel" aria-labelledby="cfo-mandate-title">
        <div className="cfo-panel-heading">
          <div><p className="cfo-eyebrow">One-time setup / owner authority</p><h3 id="cfo-mandate-title">Investment mandate</h3></div>
          {mandate && <span className="cfo-state cfo-state--ready">Saved limits · schema {mandate.schemaVersion === 1 ? 'version 1' : 'version unknown'}</span>}
        </div>
        <p className="cfo-description">Saved numeric limits remain authoritative. Editing here creates only a local draft until you explicitly save it. Target weights may leave a remainder in reserve.</p>
        {mandateDirty.current && <p className="cfo-action-status" role="status">Unsaved local policy draft. Refresh keeps these choices; wallet/session changes discard them.</p>}
        <details className="cfo-policy-sheet">
          <summary>Review or edit saved limits and permitted assets</summary>
          <details className="cfo-evidence-details">
            <summary>Consumer template {template ? `v${template.version}` : 'unavailable'} · view, copy and review</summary>
            {template ? <>
              <dl className="cfo-limit-summary">
                <div><dt>Maximum position</dt><dd>{percentInputText(String(template.maxPositionBps))}%</dd></div>
                <div><dt>Maximum slippage</dt><dd>{percentInputText(String(template.slippageBps))}%</dd></div>
                <div><dt>Maximum fees</dt><dd>{percentInputText(String(template.maxFeeBps))}%</dd></div>
                <div><dt>Evidence age</dt><dd>{template.maxEvidenceAgeSeconds} seconds</dd></div>
                <div><dt>Monitor interval</dt><dd>{template.monitorIntervalSeconds} seconds</dd></div>
                <div><dt>Monitor cycles</dt><dd>{template.maxMonitorCycles}</dd></div>
              </dl>
              <p>Template ID <code>{template.id}</code> · version {template.version}. The flat descriptor has no wallet, reserve, capital, asset, target or allocation defaults. Copy replaces only these six local non-money fields.</p>
            </> : <p>The overview does not contain the exact supported flat template descriptor. No guessed values are available to copy.</p>}
            <button className="cfo-button cfo-button--quiet" type="button" data-testid="cfo-use-template" disabled={busy || !template} onClick={copyPolicyTemplate}>Use consumer template v1</button>
            <p>Copying does not save a mandate, request a plan, prepare an action, sign, relay, or start monitoring. Review the draft and save separately if desired.</p>
          </details>
          <form className="cfo-form" noValidate onSubmit={saveMandate} aria-busy={operation.busy === '/mandate'}>
            <label className="cfo-field" htmlFor="cfo-reserveAssetId"><span>Reserve asset <em>(required)</em></span>
              <select id="cfo-reserveAssetId" name="reserveAssetId" value={mandateForm.reserveAssetId} onChange={event => setMandateField('reserveAssetId', event.target.value)} aria-invalid={Boolean(mandateErrors.reserveAssetId)} aria-describedby="cfo-reserveAssetId-hint cfo-reserveAssetId-error" required disabled={busy}>
                <option value="">Choose observed reserve</option>
                {portfolio?.assets?.filter(asset => validObservedAsset(asset) && asset.kind === 'reserve').map(asset => <option value={asset.assetId} key={asset.assetId}>{asset.symbol}</option>)}
                {mandateForm.reserveAssetId && !portfolio?.assets?.some(asset => asset.assetId === mandateForm.reserveAssetId)
                  && <option value={mandateForm.reserveAssetId}>Saved reserve unavailable in current metadata</option>}
              </select>
              <small id="cfo-reserveAssetId-hint">Select only a reserve asset returned in the observed owner portfolio. Its exact ID and decimals remain in the audit details.</small>
              <small className="cfo-field-error" id="cfo-reserveAssetId-error">{mandateErrors.reserveAssetId ?? ''}</small>
            </label>
            {LIMIT_FIELDS.map(([name, label, hint]) => {
              const money = name === 'reserveFloorBaseUnits' || name === 'maxActionReserveBaseUnits';
              const percentage = ['maxPositionBps', 'slippageBps', 'maxFeeBps'].includes(name);
              const amountValue = mandateAmountText[name];
              const value = money ? amountValue : percentage ? mandatePercentText[name] : mandateForm[name];
              const displayLabel = name === 'reserveFloorBaseUnits' ? 'Reserve floor'
                : name === 'maxActionReserveBaseUnits' ? 'Maximum reserve per action'
                  : name === 'maxPositionBps' ? 'Maximum position (%)'
                    : name === 'slippageBps' ? 'Maximum slippage (%)'
                      : name === 'maxFeeBps' ? 'Maximum fees (%)' : label;
              const displayHint = money
                ? `Enter plain ${assetFor(portfolio, mandateForm.reserveAssetId)?.symbol ?? 'reserve'} units using its observed precision; no base units are shown.`
                : percentage ? 'Enter a percentage from 0 to 100 with at most two decimal places.'
                  : hint;
              return <label className="cfo-field" htmlFor={money && name === 'reserveFloorBaseUnits' ? 'cfo-reserve-floor-amount' : money && name === 'maxActionReserveBaseUnits' ? 'cfo-action-cap-amount' : `cfo-${name}`} key={name}>
                <span>{displayLabel} <em>(required)</em></span>
                <input
                  id={money && name === 'reserveFloorBaseUnits' ? 'cfo-reserve-floor-amount' : money && name === 'maxActionReserveBaseUnits' ? 'cfo-action-cap-amount' : `cfo-${name}`}
                  name={name}
                  type="text"
                  inputMode={money || percentage ? 'decimal' : 'numeric'}
                  autoComplete="off"
                  spellCheck="false"
                  value={value}
                  onChange={event => setMandateField(name, event.target.value)}
                  aria-invalid={Boolean(mandateErrors[name])}
                  aria-describedby={`cfo-${name}-hint cfo-${name}-error`}
                  required
                  disabled={busy || (money && !policyReserveAsset)}
                />
                <small id={`cfo-${name}-hint`}>{displayHint}</small>
                <small className="cfo-field-error" id={`cfo-${name}-error`}>{mandateErrors[name] ?? ''}</small>
              </label>;
            })}
            <fieldset className="cfo-targets" aria-describedby="cfo-targets-error">
              <legend>Permitted receipt assets and target weights <em>(optional)</em></legend>
              <p className="cfo-description">Targets are selected from the observed owner portfolio. Weights are human-readable percentages; the service stores exact basis points. No target is chosen automatically.</p>
              {targets.map((target, index) => {
                const observedTargets = portfolio?.assets?.filter(asset => validObservedAsset(asset) && asset.kind === 'receipt') ?? [];
                const existingObserved = observedTargets.some(asset => asset.assetId === target.assetId);
                return <div className="cfo-target-row" key={index}>
                  <label className="cfo-field" htmlFor={`cfo-target-${index}-assetId`}><span>Target {index + 1} asset <em>(required for this target)</em></span>
                    <select id={`cfo-target-${index}-assetId`} value={target.assetId} onChange={event => setTargetField(index, 'assetId', event.target.value)} aria-invalid={Boolean(mandateErrors[`target-${index}-assetId`])} aria-describedby={`cfo-target-${index}-assetId-error`} required disabled={busy}>
                      <option value="">Choose observed receipt asset</option>
                      {observedTargets.map(asset => <option value={asset.assetId} key={asset.assetId}>{asset.symbol}</option>)}
                      {target.assetId && !existingObserved && <option value={target.assetId}>Saved target unavailable in current metadata</option>}
                    </select>
                    <small className="cfo-field-error" id={`cfo-target-${index}-assetId-error`}>{mandateErrors[`target-${index}-assetId`] ?? ''}</small>
                  </label>
                  <label className="cfo-field" htmlFor={`cfo-target-${index}-weightBps`}><span>Target {index + 1} weight (%) <em>(required for this target)</em></span>
                    <input id={`cfo-target-${index}-weightBps`} type="text" inputMode="decimal" autoComplete="off" value={target.weightText ?? percentInputText(target.weightBps ?? '')} onChange={event => setTargetField(index, 'weightBps', event.target.value)} aria-invalid={Boolean(mandateErrors[`target-${index}-weightBps`])} aria-describedby={`cfo-target-${index}-weightBps-error`} required disabled={busy} />
                    <small className="cfo-field-error" id={`cfo-target-${index}-weightBps-error`}>{mandateErrors[`target-${index}-weightBps`] ?? ''}</small>
                  </label>
                </div>;
              })}
              {targets.length < 2 && <button className="cfo-button cfo-button--quiet" type="button" disabled={busy} onClick={() => { mandateDirty.current = true; setTargets(current => [...current, { assetId: '', weightBps: '', weightText: '' }]); }}>{targets.length ? 'Add another receipt target' : 'Add receipt target'}</button>}
              {targets.length > 0 && <button className="cfo-button cfo-button--quiet" type="button" disabled={busy} onClick={() => { mandateDirty.current = true; const removedIndex = targets.length - 1; setTargets(current => current.slice(0, -1)); setMandateErrors(current => { const next = { ...current, targets: undefined }; delete next[`target-${removedIndex}-assetId`]; delete next[`target-${removedIndex}-weightBps`]; return next; }); }}>Remove last target</button>}
              <small className="cfo-field-error" id="cfo-targets-error" role="alert">{mandateErrors.targets ?? ''}</small>
            </fieldset>
            <details className="cfo-evidence-details">
              <summary>Audit details · exact saved policy IDs and base units</summary>
              <pre>{JSON.stringify(safeDetails({ savedMandate: mandate, localDraft: mandateForm, targets }), null, 2)}</pre>
            </details>
            <p className="cfo-field-error" id="cfo-wallet-error">{mandateErrors.wallet ?? ''}</p>
            <button className="cfo-button cfo-button--primary" type="submit" disabled={busy || !mandateSaveReady} aria-busy={operation.busy === '/mandate'}>{operation.busy === '/mandate' ? 'Saving mandate…' : 'Save owner mandate'}</button>
          </form>
        </details>
      </section>

      {latestPlan && isRecord(latestPlan.plan) && <section className="cfo-panel" aria-labelledby="cfo-latest-plan-title">
        <div className="cfo-panel-heading"><div><p className="cfo-eyebrow">Service result</p><h3 id="cfo-latest-plan-title">Latest plan review</h3></div><span className="cfo-state">{latestPlan.review?.state ?? latestPlan.review?.status ?? recordData(latestPlan.plan).status ?? 'UNKNOWN'}</span></div>
        <p className="cfo-description">Plan {latestPlan.plan.id ?? 'ID unavailable'} · plan status and any retained Lead/Risk review are shown as returned. A review never authorizes spending.</p>
        {latestPlan.review?.result && <div className="cfo-review-result">
          <strong>Review status: {latestPlan.review.result.status ?? 'UNKNOWN'} · executionReady: {String(latestPlan.review.result.executionReady ?? 'UNKNOWN')}</strong>
          {latestPlan.review.result.reasons?.length > 0 && <ul>{latestPlan.review.result.reasons.map((reason, index) => <li key={`${index}-${reason}`}>{reason}</li>)}</ul>}
          {latestPlan.review.result.lead && <p>Lead: {latestPlan.review.result.lead.status ?? 'UNKNOWN'} · run {latestPlan.review.result.lead.runId ?? 'unknown'} · snapshot {latestPlan.review.result.lead.snapshotHash ?? 'unknown'}</p>}
          {latestPlan.review.result.risk && <p>Risk: {latestPlan.review.result.risk.status ?? 'UNKNOWN'} · run {latestPlan.review.result.risk.runId ?? 'unknown'} · snapshot {latestPlan.review.result.risk.snapshotHash ?? 'unknown'}</p>}
        </div>}
        {latestPlan.review?.state === 'PENDING' && <p className="cfo-status">Review is still pending. Use Refresh service state or load the retained plan record; no action is prepared automatically.</p>}
        <button className="cfo-button cfo-button--quiet" type="button" disabled={busy || typeof latestPlan.plan.id !== 'string'} onClick={() => void loadRecord(latestPlan.plan)}>{detailErrors[latestPlan.plan.id] ? 'Retry loading plan record' : 'Load retained plan details'}</button>
        {detailErrors[latestPlan.plan.id] && <p className="cfo-field-error" role="alert">{detailErrors[latestPlan.plan.id]}</p>}
        {reviewEligibility(latestPlan.plan, latestPlan.review).allowed
          ? <button className="cfo-button cfo-button--primary" type="button" disabled={busy} onClick={() => void submitPlanFromRecord(latestPlan.plan)}>{operation.busy === '/prepare' ? 'Preparing exact action…' : 'Prepare exact unsigned action'}</button>
          : <p className="cfo-footnote">{reviewEligibility(latestPlan.plan, latestPlan.review).reason}</p>}
      </section>}

      {prepared && <section className="cfo-panel cfo-payload-panel" aria-labelledby="cfo-payload-title">
        <div className="cfo-panel-heading"><div><p className="cfo-eyebrow">Owner approval boundary</p><h3 id="cfo-payload-title">{prepared.signed ? 'Exact payload you signed' : 'Exact unsigned financial payload'}</h3></div><span className={`cfo-state ${prepared.signed ? 'cfo-state--ready' : 'cfo-state--blocked'}`}>{prepared.signed ? 'SIGNED / NOT RELAYED' : 'UNSIGNED'}</span></div>
        <p className="cfo-description">This is the unmodified raw message returned by the service. Signing uses these exact UTF-8 bytes; the sign-in signature is not reused. Verify the transaction details and expiry in the retained plan and payload before asking your wallet to sign.</p>
        <dl className="cfo-payload-meta">
          <div><dt>Action ID</dt><dd><code>{prepared.actionId}</code></dd></div>
          <div><dt>Quote hash</dt><dd><code>{actionQuoteHash ?? 'UNKNOWN: retained quote is not loaded'}</code></dd></div>
          <div><dt>Format</dt><dd>{prepared.standard}</dd></div>
          <div><dt>Expires at</dt><dd><time dateTime={prepared.expiresAt}>{prepared.expiresAt}</time></dd></div>
          {actionAmount && <div><dt>Input</dt><dd>{amountLabel(actionAmount, actionSource, portfolio)}</dd></div>}
        </dl>
        <div className="cfo-quote-review" role="group" aria-labelledby="cfo-quote-review-title">
          <h4 id="cfo-quote-review-title">Current retained quote bounds</h4>
          <p className="cfo-action-status" role="status" aria-live="polite">
            {quoteState.status === 'loading' ? 'Reading the retained action and quote…' : quoteState.status === 'ready' ? 'Retained action and quote are current and exact.' : 'Signing is blocked until a current retained action and quote are read.'}
          </p>
          {quoteState.error && <p className="cfo-field-error" role="alert">{quoteState.error}</p>}
          {preparedReview?.valid && preparedReview.quoteFields && <dl>
            <div><dt>Quote hash</dt><dd><code>{preparedReview.quoteFields.quoteHash}</code></dd></div>
            <div><dt>Source asset</dt><dd>{preparedReview.quoteFields.sourceAsset}</dd></div>
            <div><dt>Destination asset</dt><dd>{preparedReview.quoteFields.destinationAsset}</dd></div>
            <div><dt>Saved reserve floor</dt><dd>{preparedReview.quoteFields.reserveFloor}</dd></div>
            <div><dt>Maximum reserve per action</dt><dd>{preparedReview.quoteFields.maxActionReserve}</dd></div>
            <div><dt>Maximum position</dt><dd>{preparedReview.quoteFields.maxPositionPercent}%</dd></div>
            <div><dt>Maximum slippage</dt><dd>{preparedReview.quoteFields.maxSlippagePercent}%</dd></div>
            <div><dt>Maximum fees</dt><dd>{preparedReview.quoteFields.maxFeePercent}%</dd></div>
            <div><dt>Maximum evidence age</dt><dd>{preparedReview.quoteFields.maxEvidenceAgeSeconds} seconds</dd></div>
            <div><dt>Exact debit</dt><dd>{preparedReview.quoteFields.amountIn}</dd></div>
            <div><dt>Minimum debit bound</dt><dd>{preparedReview.quoteFields.minAmountIn}</dd></div>
            <div><dt>Estimated output</dt><dd>{preparedReview.quoteFields.amountOut}</dd></div>
            <div><dt>Minimum output bound</dt><dd>{preparedReview.quoteFields.minAmountOut}</dd></div>
            <div><dt>Origin refund fee</dt><dd>{preparedReview.quoteFields.refundFee}</dd></div>
            <div><dt>Destination withdrawal fee</dt><dd>{preparedReview.quoteFields.withdrawFee}</dd></div>
            <div><dt>Quote captured</dt><dd><time dateTime={preparedReview.quoteFields.capturedAt}>{preparedReview.quoteFields.capturedAt}</time></dd></div>
            <div><dt>Provider quote timestamp</dt><dd>{preparedReview.quoteFields.providerTimestamp}</dd></div>
            <div><dt>Portfolio cutoff</dt><dd><time dateTime={preparedReview.quoteFields.portfolioCapturedAt}>{preparedReview.quoteFields.portfolioCapturedAt}</time></dd></div>
            <div><dt>Quote expires</dt><dd><time dateTime={preparedReview.quoteFields.deadline}>{preparedReview.quoteFields.deadline}</time></dd></div>
            <div><dt>Destination</dt><dd><code>{preparedReview.quoteFields.depositAddress}</code></dd></div>
            <div><dt>Owner signer</dt><dd><code>{preparedReview.quoteFields.signerId}</code></dd></div>
          </dl>}
          {quoteState.status !== 'ready' && <button
            className="cfo-button cfo-button--quiet"
            type="button"
            data-testid="cfo-retry-quote-read"
            disabled={busy}
            onClick={() => void refreshPreparedQuote(prepared.actionId)}
            aria-busy={quoteState.status === 'loading'}
          >{quoteState.status === 'loading' ? 'Reading retained quote…' : 'Retry retained quote read'}</button>}
        </div>
        <details className="cfo-evidence-details">
          <summary>Technical audit · retained quote and action details</summary>
          <pre>{JSON.stringify(safeDetails(preparedSummary), null, 2)}</pre>
          <h4>{prepared.signed ? 'Exact payload you signed' : 'Exact unsigned financial payload'}</h4>
          <pre className="cfo-payload">{prepared.payload}</pre>
        </details>
        {nowExpired && <p className="cfo-field-error" role="alert">This payload has expired and cannot be signed. Prepare a fresh action.</p>}
        {signatureState?.actionId === prepared.actionId && <p className={signatureState.status === 'SIGNED' ? 'cfo-status' : 'cfo-field-error'} role={signatureState.status === 'SIGNED' ? 'status' : 'alert'}>Signature registration: {signatureState.status}. No signature bytes are displayed.</p>}
        {relayUnknown === prepared.actionId && <p className="cfo-field-error" role="alert">Relay outcome unknown. Reconcile this action before any further movement.</p>}
        {relayResult?.actionId === prepared.actionId && <p className="cfo-status" role="status">Relay state: {relayResult.status}. Settlement remains a separate receipt-reconciliation result.</p>}
        {!actionQuoteHash && <p className="cfo-footnote">The exact quote hash is unavailable from retained action data. Refresh service state before signing or relaying.</p>}
        {!prepared.signed
          ? <button className="cfo-button cfo-button--primary" type="button" data-testid="cfo-sign-exact-action" disabled={!signReady} onClick={() => void signPreparedAction()} aria-busy={operation.busy === '/quote-verification' || operation.busy === '/wallet-signing' || operation.busy === '/signatures'}>{operation.busy === '/quote-verification' ? 'Verifying quote…' : operation.busy === '/wallet-signing' || operation.busy === '/signatures' ? 'Waiting for wallet…' : 'Sign this exact action'}</button>
          : <div className="cfo-relay-step">
            <p className="cfo-gate-note"><strong>Separate relay approval:</strong> the wallet signature alone does not submit. Relay requires a separate operator grant bound to this action and its quote; this component cannot create that grant.</p>
            {confirmRelayActionId === prepared.actionId && <div className="cfo-relay-confirm" role="group" aria-labelledby="cfo-relay-confirm-title">
              <h4 id="cfo-relay-confirm-title">Confirm relay to NEAR Intents mainnet</h4>
              <p>Submit only the stored signed bytes for action <code>{prepared.actionId}</code> and quote <code>{actionQuoteHash}</code>. Settlement may remain pending, be refunded, or be unknown. A lost response is not a failure and must be reconciled.</p>
              <button className="cfo-button cfo-button--danger" type="button" disabled={busy || nowExpired || !actionQuoteHash || relayUnknown === prepared.actionId || Boolean(relayResult)} onClick={() => void relaySignedAction()} aria-busy={operation.busy === '/relay'}>{operation.busy === '/relay' ? 'Submitting stored action…' : 'Confirm and submit signed action'}</button>
              <button className="cfo-button cfo-button--quiet" type="button" onClick={() => setConfirmRelayActionId(null)} disabled={busy}>Cancel relay</button>
            </div>}
            {!confirmRelayActionId && <button className="cfo-button cfo-button--danger" type="button" disabled={busy || nowExpired || !actionQuoteHash || relayUnknown === prepared.actionId || Boolean(relayResult) || signatureState?.status !== 'SIGNED'} onClick={() => void relaySignedAction()}>{relayResult ? 'Relay already requested · reconcile' : 'Review relay action'}</button>}
            {(relayUnknown === prepared.actionId || relayResult?.actionId === prepared.actionId) && confirmRelayActionId !== prepared.actionId && <button className="cfo-button cfo-button--quiet" type="button" disabled={busy} onClick={() => void reconcileAction(prepared.actionId)}>Reconcile action status and receipts</button>}
          </div>}
      </section>}

      <section className="cfo-panel" aria-labelledby="cfo-monitor-title">
        <div className="cfo-panel-heading"><div><p className="cfo-eyebrow">Bounded / read-only</p><h3 id="cfo-monitor-title">Monitor</h3></div><span className="cfo-state">{monitor?.status ?? 'UNKNOWN'}</span></div>
        {monitor ? <dl className="cfo-monitor-data">
          <div><dt>Enabled</dt><dd>{monitor.enabled === true ? 'Yes' : monitor.enabled === false ? 'No' : 'Unknown'}</dd></div>
          <div><dt>Cycles completed</dt><dd>{Number.isSafeInteger(monitor.cyclesCompleted) ? monitor.cyclesCompleted : 'Unknown'}</dd></div>
          <div><dt>Maximum cycles</dt><dd>{Number.isSafeInteger(monitor.maxCycles) ? monitor.maxCycles : 'Unknown'}</dd></div>
          <div><dt>Next run</dt><dd>{typeof monitor.nextRunAt === 'string' ? <time dateTime={monitor.nextRunAt}>{monitor.nextRunAt}</time> : 'Not scheduled'}</dd></div>
        </dl> : <p className="cfo-empty">The service has not reported monitor state.</p>}
        <p className="cfo-footnote">Monitoring is bounded and read-only. It never signs, relays, or spends.</p>
        {monitor?.status === 'UNKNOWN' && <p className="cfo-status" role="status">The retained worker lease does not prove a live process. This page does not resume it.</p>}
        {Array.isArray(monitor?.alerts) && monitor.alerts.map(alert => <p className="cfo-field-error" role="alert" key={alert.code}>
          {alert.code === 'RESERVE_BELOW_FLOOR'
            ? 'The latest retained reserve is below your mandate floor. Review the snapshot before another action.'
            : 'The retained portfolio cannot support a current treasury check. Capture fresh evidence.'}
        </p>)}
        <div className="cfo-actions">
          <button className="cfo-button cfo-button--quiet" type="button" disabled={!canManageMonitor || monitor?.enabled === true} onClick={() => void setMonitoring(true)} aria-busy={operation.busy === '/monitor'}>Start monitor</button>
          <button className="cfo-button cfo-button--quiet" type="button" disabled={!canManageMonitor || monitor?.enabled !== true} onClick={() => void setMonitoring(false)} aria-busy={operation.busy === '/monitor'}>Stop monitor</button>
        </div>
      </section>

      <section className="cfo-panel cfo-history" aria-labelledby="cfo-history-title">
        <div className="cfo-panel-heading"><div><p className="cfo-eyebrow">Owner-bound retained records</p><h3 id="cfo-history-title">Plans and actions</h3></div><span className="cfo-state">{planRecords.length} plans · {actionHeads.length} current action heads</span></div>
        {planRecords.length === 0 && actionHeads.length === 0 && <p className="cfo-empty">No plan or action records are available yet. Capture a real portfolio, save a mandate, then request a plan.</p>}
        {planRecords.length > 0 && <div className="cfo-history-group"><h4>Plans</h4>
          {planRecords.map(record => {
            const loaded = loadedRecords[record.id] ?? record;
            const status = recordStatus(loaded);
            const review = planReview(record, loadedRecords, latestPlan);
            const eligibility = reviewEligibility(record, review);
            return <article className="cfo-record" key={record.id}>
              <div className="cfo-record-heading"><div><strong>{record.kind || 'Plan'} · {status}</strong><time dateTime={record.createdAt}>{record.createdAt || 'Time unknown'}</time></div><code>{record.id}</code></div>
              {loaded.data?.proposal && <p className="cfo-record-summary">{loaded.data.proposal.reason ?? loaded.data.proposal.action ?? 'Retained proposal details are available.'}</p>}
              {loaded.data?.review?.result?.reasons?.map((reason, index) => <p className="cfo-record-summary" key={`${index}-${reason}`}>{reason}</p>)}
              {detailErrors[record.id] && <p className="cfo-field-error" role="alert">{detailErrors[record.id]}</p>}
              <div className="cfo-actions">
                <button className="cfo-button cfo-button--quiet" type="button" disabled={busy} onClick={() => void loadRecord(record)}>Load retained record</button>
                {eligibility.allowed && <button className="cfo-button cfo-button--quiet" type="button" disabled={busy} onClick={() => void preparePlan(record)}>Prepare exact action</button>}
              </div>
              {loadedRecords[record.id] && <details className="cfo-record-details"><summary>Retained safe details</summary><pre>{JSON.stringify(safeDetails(loadedRecords[record.id].data), null, 2)}</pre></details>}
            </article>;
          })}
        </div>}
        {unresolvedHeads.length > 0 && <div className="cfo-history-group">
          <h4>Current unresolved action heads</h4>
          <p className="cfo-footnote">The backend's newest-first action sequence selects one current head per logical action. Unresolved movements remain visible before terminal history.</p>
          {unresolvedHeads.map(renderActionRecord)}
        </div>}
        {terminalHeads.length > 0 && <details className="cfo-evidence-details">
          <summary>Terminal action history · {terminalHeads.length} current terminal heads</summary>
          {terminalHeads.map(renderActionRecord)}
        </details>}
        <p className="cfo-footnote">PENDING, SUBMISSION_UNKNOWN, REFUNDED, FAILED, and UNVERIFIED remain distinct. Provider success alone is not confirmed settlement.</p>
      </section>
    </>}
  </section>;
}
