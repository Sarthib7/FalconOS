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

function amountLabel(baseUnits, assetId, portfolio) {
  if (typeof baseUnits !== 'string') return 'Amount unavailable';
  const asset = assetFor(portfolio, assetId);
  const formatted = asset && Number.isSafeInteger(asset.decimals) ? formatBaseUnits(baseUnits, asset.decimals) : null;
  if (formatted === null) return `${baseUnits} base units · token decimals unavailable`;
  return asset.symbol ? `${formatted} ${asset.symbol}` : `${formatted} ${assetId}`;
}

function recordIdentifier(record) {
  return typeof record?.data?.actionId === 'string' ? record.data.actionId : record?.id;
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

function mandateFormFrom(value, portfolio) {
  const saved = mandateFromRecord(value?.mandate);
  const reserveAssetId = saved?.reserveAssetId
    ?? portfolio?.assets?.find(asset => asset?.kind === 'reserve')?.assetId
    ?? '';
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
  const [targets, setTargets] = useState([]);
  const [mandateErrors, setMandateErrors] = useState({});
  const [planForm, setPlanForm] = useState(EMPTY_PLAN);
  const [planErrors, setPlanErrors] = useState({});
  const [latestPlan, setLatestPlan] = useState(null);
  const [prepared, setPrepared] = useState(null);
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
      setMandateForm(EMPTY_MANDATE);
      setTargets([]);
      setMandateErrors({});
      setPlanForm(EMPTY_PLAN);
      setPlanErrors({});
      setLatestPlan(null);
      setPrepared(null);
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
        setMandateForm(mandateFormFrom(value, portfolio));
        const saved = mandateFromRecord(value.mandate);
        if (saved?.targets?.length) {
          setTargets(saved.targets.map(target => ({ assetId: text(target.assetId), weightBps: String(target.weightBps ?? '') })));
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
    return contextGeneration.current === generation
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
    const record = value.actions.find(item => recordIdentifier(item) === actionId);
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

  async function refreshOverview({ quiet = false } = {}) {
    const generation = contextGeneration.current;
    if (!generationIsCurrent(generation)) return null;
    const queryGeneration = ++overviewGeneration.current;
    if (!quiet) setLoad({ status: 'refreshing', error: '' });
    try {
      const value = await requestRef.current(session.token, ROOT);
      if (!generationIsCurrent(generation) || overviewGeneration.current !== queryGeneration) return null;
      if (!validOverview(value)) throw new Error('The CFO service returned an invalid overview. No balances or readiness are shown.');
      setOverview(value);
      if (prepared?.actionId) syncActionFromOverview(value, prepared.actionId);
      const refreshedPlan = latestPlan?.plan?.id && value.plans.find(plan => plan.id === latestPlan.plan.id);
      if (refreshedPlan) setLatestPlan({ plan: refreshedPlan, review: refreshedPlan.review ?? null });
      setLoad({ status: 'ready', error: '' });
      if (!mandateDirty.current) {
        const portfolio = portfolioFromRecord(value.portfolio);
        setMandateForm(mandateFormFrom(value, portfolio));
        const saved = mandateFromRecord(value.mandate);
        setTargets(saved?.targets?.length
          ? saved.targets.map(target => ({ assetId: text(target.assetId), weightBps: String(target.weightBps ?? '') }))
          : []);
      }
      return value;
    } catch (error) {
      if (generationIsCurrent(generation) && overviewGeneration.current === queryGeneration) {
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
    setMandateForm(current => ({ ...current, [name]: value }));
    setMandateErrors(current => ({ ...current, [name]: undefined, targets: undefined }));
  }

  function setTargetField(index, name, value) {
    mandateDirty.current = true;
    setTargets(current => current.map((target, targetIndex) => targetIndex === index ? { ...target, [name]: value } : target));
    setMandateErrors(current => ({ ...current, [`target-${index}-${name}`]: undefined, targets: undefined }));
  }

  function setPlanField(name, value) {
    setPlanForm(current => ({ ...current, [name]: value }));
    setPlanErrors(current => name === 'action'
      ? { ...current, action: undefined, targetAssetId: undefined }
      : { ...current, [name]: undefined });
  }

  async function saveMandate(event) {
    event.preventDefault();
    const built = buildMandateFromForm(mandateForm, targets, session?.walletAddress);
    setMandateErrors(built.errors);
    if (!built.mandate) {
      const first = Object.keys(built.errors)[0];
      if (first) document.getElementById(first === 'targets' ? 'cfo-target-0-assetId' : `cfo-${first}`)?.focus();
      return;
    }
    const result = await post('/mandate', { mandate: built.mandate });
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
    const built = buildPlanFields(planForm);
    setPlanErrors(built.errors);
    if (!built.fields) {
      const first = Object.keys(built.errors)[0];
      if (first) document.getElementById(`cfo-plan-${first}`)?.focus();
      return;
    }
    const result = await post('/plans', built.fields);
    if (!result) return;
    setLatestPlan(result);
    setPrepared(null);
    setSignatureState(null);
    setOperation({ busy: '', error: '', notice: 'The plan and its retained Lead/Risk review status came from the service.' });
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
    const continuation = actionRecords.find(action => action.data?.status === 'AWAITING_NEXT_LEG' && action.data.nextPlanId === record?.id);
    const planId = continuation?.data.planId ?? record?.id;
    if (typeof planId !== 'string') return;
    const result = await post('/prepare', { planId });
    if (!result) return;
    if (typeof result.actionId !== 'string' || result.standard !== 'raw_ed25519'
      || typeof result.payload !== 'string' || result.payload.length === 0
      || typeof result.expiresAt !== 'string' || !Number.isFinite(Date.parse(result.expiresAt))) {
      setOperation({ busy: '', error: 'The service returned an invalid unsigned action. It was not offered for signing.', notice: '' });
      await refreshOverview({ quiet: true });
      return;
    }
    setPrepared({ ...result, planId, signed: false });
    setSignatureState(null);
    setConfirmRelayActionId(null);
    setRelayUnknown(null);
    setOperation({ busy: '', error: '', notice: 'Review the exact service-generated payload below. It has not been signed or relayed.' });
    setRelayResult(null);
  }

  async function signPreparedAction() {
    if (!prepared || prepared.signed || Date.parse(prepared.expiresAt) <= Date.now()) {
      setOperation({ busy: '', error: 'This unsigned action is missing, already signed, or expired. Prepare a fresh action from the retained plan.', notice: '' });
      return;
    }
    if (busyRef.current) return;
    if (currentAddress(walletSession) !== session?.walletAddress) {
      setOperation({ busy: '', error: 'The signing wallet no longer matches the verified session. The payload was not signed.', notice: '' });
      return;
    }
    if (typeof walletSession?.signMessage !== 'function') {
      setOperation({ busy: '', error: 'The connected wallet does not expose message signing. No action was signed.', notice: '' });
      return;
    }
    const generation = contextGeneration.current;
    busyRef.current = true;
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
    const storedRecord = actionRecords.find(record => recordIdentifier(record) === actionId);
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
  const monitor = overview?.monitor;
  const actionRecords = Array.isArray(overview?.actions) ? overview.actions : [];
  const planRecords = Array.isArray(overview?.plans) ? overview.plans : [];
  const busy = Boolean(operation.busy);
  const activeActionId = prepared?.actionId;
  const preparedRecord = actionRecords.find(record => recordIdentifier(record) === activeActionId) ?? null;
  const preparedSummary = recordData(preparedRecord);
  const latestPlanData = recordData(latestPlan?.plan);
  const latestProposal = latestPlanData.proposal ?? latestPlanData.snapshot?.proposal;
  const actionAmount = preparedSummary.inputBaseUnits ?? preparedSummary.proposal?.inputBaseUnits ?? latestProposal?.inputBaseUnits;
  const actionSource = preparedSummary.sourceAssetId ?? preparedSummary.proposal?.sourceAssetId ?? latestProposal?.sourceAssetId;
  const actionTarget = preparedSummary.targetAssetId ?? preparedSummary.proposal?.targetAssetId ?? latestProposal?.targetAssetId;
  const actionQuoteHash = typeof preparedSummary.quote?.sha256 === 'string' ? preparedSummary.quote.sha256 : null;
  const quoteRaw = preparedSummary.quote?.raw;
  const quote = isRecord(quoteRaw?.quote) ? quoteRaw.quote : {};
  const quoteRequest = isRecord(quoteRaw?.quoteRequest) ? quoteRaw.quoteRequest : {};
  const quoteSourceAssetId = quoteRequest.originAsset ?? actionSource;
  const quoteTargetAssetId = quoteRequest.destinationAsset ?? actionTarget;
  const quoteAmountIn = quote.amountIn ?? quoteRequest.amount;
  const quoteMinimumOut = quote.minAmountOut;
  const quoteEstimatedOut = quote.amountOut;
  const quoteDepositAddress = quote.depositAddress;
  const nowExpired = prepared && Number.isFinite(Date.parse(prepared.expiresAt)) && Date.parse(prepared.expiresAt) <= Date.now();
  const readinessStatus = overview?.readiness?.status ?? 'UNKNOWN';
  const canManageMonitor = Boolean(mandate) && !busy;

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

    <div className="cfo-readiness" aria-label="Provider and execution readiness">
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
                <div><p className="cfo-label">{isReserve ? 'Stable reserve' : asset?.kind === 'receipt' ? 'Receipt position' : 'Asset'}</p><h4>{asset?.symbol ?? 'Unknown asset'}</h4><code>{balance?.assetId ?? 'Asset ID unavailable'}</code></div>
                <strong className="cfo-amount">{balanceText}</strong>
              </article>;
            })}
          </div> : <p className="cfo-empty">The service returned an observed snapshot with no supported account balances.</p>}
          <p className="cfo-footnote">This snapshot covers only supported account inventory. It is not a complete wealth statement or live balance. No PnL or APY is inferred.</p>
          {Array.isArray(portfolio.reasons) && portfolio.reasons.length > 0 && <ul className="cfo-reasons">{portfolio.reasons.map((reason, index) => <li key={`${index}-${reason}`}>{reason}</li>)}</ul>}
        </> : <div className="cfo-empty"><h4>{portfolio?.status === 'NO_DATA' ? 'Portfolio data is unavailable' : 'No finalized portfolio snapshot yet'}</h4><p>{portfolio?.reasons?.join(' ') || 'Choose Capture finalized portfolio to request real owner balances from the service. No missing balance is shown as zero.'}</p></div>}
      </section>

      <section className="cfo-panel" aria-labelledby="cfo-mandate-title">
        <div className="cfo-panel-heading"><div><p className="cfo-eyebrow">Owner entered / required limits</p><h3 id="cfo-mandate-title">Investment mandate</h3></div>
          {mandate && <span className="cfo-state cfo-state--ready">Saved mandate · {mandate.schemaVersion === 1 ? 'version 1' : 'version unknown'}</span>}
        </div>
        <p className="cfo-description">Every limit is required. Money limits stay exact base-unit strings; the service validates asset listings and quotes. Target weights may leave an unallocated remainder in reserve.</p>
        <form className="cfo-form" noValidate onSubmit={saveMandate} aria-busy={operation.busy === '/mandate'}>
          <label className="cfo-field" htmlFor="cfo-reserveAssetId"><span>Reserve asset ID <em>(required)</em></span>
            <input id="cfo-reserveAssetId" name="reserveAssetId" type="text" autoComplete="off" spellCheck="false" value={mandateForm.reserveAssetId} onChange={event => setMandateField('reserveAssetId', event.target.value)} aria-invalid={Boolean(mandateErrors.reserveAssetId)} aria-describedby="cfo-reserveAssetId-hint cfo-reserveAssetId-error" required disabled={busy} />
            <small id="cfo-reserveAssetId-hint">Must resolve to the supported Solana mainnet USDC asset. Use an ID from actual service data; the server checks the mapping.</small>
            <small className="cfo-field-error" id="cfo-reserveAssetId-error">{mandateErrors.reserveAssetId ?? ''}</small>
          </label>
          {LIMIT_FIELDS.map(([name, label, hint]) => <label className="cfo-field" htmlFor={`cfo-${name}`} key={name}>
            <span>{label} <em>(required)</em></span>
            <input id={`cfo-${name}`} name={name} type="text" inputMode="numeric" autoComplete="off" spellCheck="false" value={mandateForm[name]} onChange={event => setMandateField(name, event.target.value)} aria-invalid={Boolean(mandateErrors[name])} aria-describedby={`cfo-${name}-hint cfo-${name}-error`} required disabled={busy} />
            <small id={`cfo-${name}-hint`}>{hint}</small>
            <small className="cfo-field-error" id={`cfo-${name}-error`}>{mandateErrors[name] ?? ''}</small>
          </label>)}
          <fieldset className="cfo-targets" aria-describedby="cfo-targets-error">
            <legend>Receipt targets and weights <em>(optional)</em></legend>
            <p className="cfo-description">A mandate may keep the full reserve unallocated. Add up to two exact receipt asset IDs and weights when desired. The service checks the current listing and entry/exit quotes; this form does not infer support from candidate IDs.</p>
            {targets.map((target, index) => <div className="cfo-target-row" key={index}>
              <label className="cfo-field" htmlFor={`cfo-target-${index}-assetId`}><span>Target {index + 1} asset ID <em>(required for this target)</em></span>
                <input id={`cfo-target-${index}-assetId`} type="text" autoComplete="off" spellCheck={false} value={target.assetId} onChange={event => setTargetField(index, 'assetId', event.target.value)} aria-invalid={Boolean(mandateErrors[`target-${index}-assetId`])} aria-describedby={`cfo-target-${index}-assetId-error`} required disabled={busy} />
                <small className="cfo-field-error" id={`cfo-target-${index}-assetId-error`}>{mandateErrors[`target-${index}-assetId`] ?? ''}</small>
              </label>
              <label className="cfo-field" htmlFor={`cfo-target-${index}-weightBps`}><span>Target {index + 1} weight (basis points) <em>(required for this target)</em></span>
                <input id={`cfo-target-${index}-weightBps`} type="text" inputMode="numeric" autoComplete="off" value={target.weightBps} onChange={event => setTargetField(index, 'weightBps', event.target.value)} aria-invalid={Boolean(mandateErrors[`target-${index}-weightBps`])} aria-describedby={`cfo-target-${index}-weightBps-error`} required disabled={busy} />
                <small className="cfo-field-error" id={`cfo-target-${index}-weightBps-error`}>{mandateErrors[`target-${index}-weightBps`] ?? ''}</small>
              </label>
            </div>)}
            {targets.length < 2 && <button className="cfo-button cfo-button--quiet" type="button" disabled={busy} onClick={() => { mandateDirty.current = true; setTargets(current => [...current, { assetId: '', weightBps: '' }]); }}>{targets.length ? 'Add another receipt target' : 'Add receipt target'}</button>}
            {targets.length > 0 && <button className="cfo-button cfo-button--quiet" type="button" disabled={busy} onClick={() => { mandateDirty.current = true; setTargets(current => current.slice(0, -1)); setMandateErrors(current => ({ ...current, targets: undefined })); }}>Remove last target</button>}
            <small className="cfo-field-error" id="cfo-targets-error" role="alert">{mandateErrors.targets ?? ''}</small>
          </fieldset>
          <p className="cfo-field-error" id="cfo-wallet-error">{mandateErrors.wallet ?? ''}</p>
          <button className="cfo-button cfo-button--primary" type="submit" disabled={busy} aria-busy={operation.busy === '/mandate'}>{operation.busy === '/mandate' ? 'Saving mandate…' : 'Save owner mandate'}</button>
        </form>
      </section>

      <section className="cfo-panel" aria-labelledby="cfo-plan-title">
        <div className="cfo-panel-heading"><div><p className="cfo-eyebrow">Explicit action request</p><h3 id="cfo-plan-title">Plan an investment or movement</h3></div></div>
        <p className="cfo-description">Enter exact base units for explicit amounts. For invest/reinvest, an omitted amount lets the service derive a mandate-weighted proposal from refreshed valuation and settled reserve. Lead/Risk review for new exposure remains backend-gated; this dashboard does not authorize paid model calls. Rotation is two sequential legs through reserve, not atomic; no expected proceeds are reused.</p>
        <form className="cfo-form cfo-form--plan" noValidate onSubmit={createPlan} aria-busy={operation.busy === '/plans'}>
          <label className="cfo-field" htmlFor="cfo-plan-action"><span>Action <em>(required)</em></span>
            <select id="cfo-plan-action" value={planForm.action} onChange={event => setPlanField('action', event.target.value)} aria-invalid={Boolean(planErrors.action)} aria-describedby="cfo-plan-action-error" required disabled={busy}>
              <option value="">Choose an action</option><option value="invest">Invest</option><option value="redeem">Redeem to reserve</option><option value="rotate">Rotate through reserve</option><option value="reinvest">Reinvest settled funds</option>
            </select>
            <small className="cfo-field-error" id="cfo-plan-action-error">{planErrors.action ?? ''}</small>
          </label>
          <label className="cfo-field" htmlFor="cfo-plan-sourceAssetId"><span>Source asset ID <em>(required)</em></span>
            <input id="cfo-plan-sourceAssetId" type="text" autoComplete="off" spellCheck={false} value={planForm.sourceAssetId} onChange={event => setPlanField('sourceAssetId', event.target.value)} aria-invalid={Boolean(planErrors.sourceAssetId)} aria-describedby="cfo-plan-sourceAssetId-hint cfo-plan-sourceAssetId-error" required disabled={busy} />
            <small id="cfo-plan-sourceAssetId-hint">Use the exact asset ID from the latest captured inventory or the saved mandate.</small>
            <small className="cfo-field-error" id="cfo-plan-sourceAssetId-error">{planErrors.sourceAssetId ?? ''}</small>
          </label>
          <label className="cfo-field" htmlFor="cfo-plan-targetAssetId"><span>Target asset ID {planTargetRequired(planForm.action) ? '(required)' : '(optional: mandate weights)'}</span>
            <input id="cfo-plan-targetAssetId" type="text" autoComplete="off" spellCheck={false} value={planForm.targetAssetId} onChange={event => setPlanField('targetAssetId', event.target.value)} aria-invalid={Boolean(planErrors.targetAssetId)} aria-describedby="cfo-plan-targetAssetId-hint cfo-plan-targetAssetId-error" required={planTargetRequired(planForm.action)} disabled={busy} />
            <small id="cfo-plan-targetAssetId-hint">The service confirms the current provider listing and exact quote. Invest/reinvest may leave this blank to use mandate weights.</small>
            <small className="cfo-field-error" id="cfo-plan-targetAssetId-error">{planErrors.targetAssetId ?? ''}</small>
          </label>
          <label className="cfo-field" htmlFor="cfo-plan-inputBaseUnits"><span>Exact input amount (base units) {planTargetRequired(planForm.action) ? '(required)' : '(optional: service-weighted invest/reinvest)'}</span>
            <input id="cfo-plan-inputBaseUnits" type="text" inputMode="numeric" autoComplete="off" spellCheck={false} value={planForm.inputBaseUnits} onChange={event => setPlanField('inputBaseUnits', event.target.value)} aria-invalid={Boolean(planErrors.inputBaseUnits)} aria-describedby="cfo-plan-inputBaseUnits-hint cfo-plan-inputBaseUnits-error" required={planTargetRequired(planForm.action)} disabled={busy} />
            <small id="cfo-plan-inputBaseUnits-hint">Money stays an exact string. Blank is allowed only for invest/reinvest; the service derives that proposal from mandate weights and settled reserve.</small>
            <small className="cfo-field-error" id="cfo-plan-inputBaseUnits-error">{planErrors.inputBaseUnits ?? ''}</small>
          </label>
          <button className="cfo-button cfo-button--primary" type="submit" disabled={busy || !mandate} aria-busy={operation.busy === '/plans'}>{operation.busy === '/plans' ? 'Requesting plan…' : ['redeem', 'rotate'].includes(planForm.action) ? 'Check deterministic exit plan' : 'Request Lead / Risk plan'}</button>
          {!mandate && <p className="cfo-footnote">Save a complete owner mandate before requesting a plan.</p>}
        </form>
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
          {actionSource && <div><dt>Source asset</dt><dd><code>{actionSource}</code></dd></div>}
          {actionTarget && <div><dt>Target asset</dt><dd><code>{actionTarget}</code></dd></div>}
          {typeof quoteAmountIn === 'string' && <div><dt>Quoted debit</dt><dd>{amountLabel(quoteAmountIn, quoteSourceAssetId, portfolio)}</dd></div>}
          {typeof quoteMinimumOut === 'string' && <div><dt>Minimum quoted output</dt><dd>{amountLabel(quoteMinimumOut, quoteTargetAssetId, portfolio)}</dd></div>}
          {typeof quoteEstimatedOut === 'string' && <div><dt>Quoted output estimate</dt><dd>{amountLabel(quoteEstimatedOut, quoteTargetAssetId, portfolio)}</dd></div>}
          {typeof quoteDepositAddress === 'string' && <div><dt>Deposit address</dt><dd><code>{quoteDepositAddress}</code></dd></div>}
        </dl>
        {typeof quoteEstimatedOut === 'string' && <p className="cfo-footnote">Quoted output is not guaranteed. Minimum output is the bound in the verified quote.</p>}
        {Object.keys(preparedSummary).length > 0 && <details className="cfo-record-details"><summary>Retained quote and action details from the service</summary><pre>{JSON.stringify(safeDetails(preparedSummary), null, 2)}</pre></details>}
        <pre className="cfo-payload" aria-label="Exact unsigned payload">{prepared.payload}</pre>
        {nowExpired && <p className="cfo-field-error" role="alert">This payload has expired and cannot be signed. Prepare a fresh action.</p>}
        {signatureState?.actionId === prepared.actionId && <p className={signatureState.status === 'SIGNED' ? 'cfo-status' : 'cfo-field-error'} role={signatureState.status === 'SIGNED' ? 'status' : 'alert'}>Signature registration: {signatureState.status}. No signature bytes are displayed.</p>}
        {relayUnknown === prepared.actionId && <p className="cfo-field-error" role="alert">Relay outcome unknown. Reconcile this action before any further movement.</p>}
        {relayResult?.actionId === prepared.actionId && <p className="cfo-status" role="status">Relay state: {relayResult.status}. Settlement remains a separate receipt-reconciliation result.</p>}
        {!actionQuoteHash && <p className="cfo-footnote">The exact quote hash is unavailable from retained action data. Refresh service state before signing or relaying.</p>}
        {!prepared.signed
          ? <button className="cfo-button cfo-button--primary" type="button" disabled={busy || nowExpired || !actionQuoteHash || signatureState?.status === 'UNKNOWN'} onClick={() => void signPreparedAction()} aria-busy={operation.busy === '/wallet-signing' || operation.busy === '/signatures'}>{operation.busy === '/wallet-signing' || operation.busy === '/signatures' ? 'Waiting for wallet…' : 'Sign this exact action'}</button>
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
        <div className="cfo-panel-heading"><div><p className="cfo-eyebrow">Owner-bound retained records</p><h3 id="cfo-history-title">Plans and actions</h3></div><span className="cfo-state">{planRecords.length} plans · {actionRecords.length} actions</span></div>
        {planRecords.length === 0 && actionRecords.length === 0 && <p className="cfo-empty">No plan or action records are available yet. Capture a real portfolio, save a mandate, then request a plan.</p>}
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
        {actionRecords.length > 0 && <div className="cfo-history-group"><h4>Actions</h4>
          {actionRecords.map(record => {
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
            return <article className="cfo-record" key={record.id}>
              <div className="cfo-record-heading"><div><strong>{record.kind || 'Action'} · {status}</strong><time dateTime={record.createdAt}>{record.createdAt || 'Time unknown'}</time></div><code>{actionId ?? record.id}</code></div>
              {inputBaseUnits && <p className="cfo-record-summary">Input: {amountLabel(inputBaseUnits, sourceAssetId, portfolio)}</p>}
              {sourceAssetId && <p className="cfo-record-summary">Source: <code>{sourceAssetId}</code></p>}
              {targetAssetId && <p className="cfo-record-summary">Target: <code>{targetAssetId}</code></p>}
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
              {Object.keys(safeActionData).length > 0 && <details className="cfo-record-details"><summary>Retained safe quote and action details</summary><pre>{JSON.stringify(safeActionData, null, 2)}</pre></details>}
            </article>;
          })}
        </div>}
        <p className="cfo-footnote">PENDING, SUBMISSION_UNKNOWN, REFUNDED, FAILED, and UNVERIFIED remain distinct. Provider success alone is not confirmed settlement.</p>
      </section>
    </>}
  </section>;
}
