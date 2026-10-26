import { PublicKey } from '@solana/web3.js';

const OWNER = /^wallet_[a-f0-9]{56}$/;
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
const HASH = /^[a-f0-9]{64}$/;
const SIGNATURE = /^[1-9A-HJ-NP-Za-km-z]{64,88}$/;
const UNITS = /^[1-9][0-9]{0,38}$/;

function exact(value, fields, name) {
  if (!value || typeof value !== 'object' || Array.isArray(value)
      || Object.keys(value).length !== fields.length || fields.some(key => !Object.hasOwn(value, key))) {
    throw new Error(`${name} fields are invalid.`);
  }
}
function wallet(value) {
  try { return typeof value === 'string' && new PublicKey(value).toBase58() === value && PublicKey.isOnCurve(new PublicKey(value).toBytes()); }
  catch { return false; }
}
function time(value) {
  return typeof value === 'string' && Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value;
}
function list(raw, name) {
  let value;
  try { value = raw === undefined ? [] : JSON.parse(raw); } catch { throw new Error(`${name} must be a JSON array.`); }
  if (!Array.isArray(value) || value.length > 32) throw new Error(`${name} must be a bounded JSON array.`);
  return value;
}
function asset(value) { return typeof value === 'string' && /^nep141:[a-z0-9._-]{2,128}$/.test(value); }

export function parseCfoConfig(env = process.env) {
  if (env.FALCON_CFO_PROVIDER_ENABLED !== undefined && !['0', '1'].includes(env.FALCON_CFO_PROVIDER_ENABLED)) {
    throw new Error('FALCON_CFO_PROVIDER_ENABLED must be 0 or 1.');
  }
  const reviewOwners = list(env.FALCON_CFO_REVIEW_OWNERS, 'FALCON_CFO_REVIEW_OWNERS');
  if (reviewOwners.some(value => !OWNER.test(value)) || new Set(reviewOwners).size !== reviewOwners.length) {
    throw new Error('FALCON_CFO_REVIEW_OWNERS must contain unique verified-wallet owner IDs.');
  }
  const executionGrants = list(env.FALCON_CFO_EXECUTION_GRANTS, 'FALCON_CFO_EXECUTION_GRANTS');
  const grantIds = new Set();
  for (const grant of executionGrants) {
    exact(grant, ['ownerId', 'wallet', 'maxReserveBaseUnits', 'expiresAt', 'devnetProofId'], 'CFO execution grant');
    const id = `${grant.ownerId}:${grant.wallet}`;
    if (!OWNER.test(grant.ownerId) || !wallet(grant.wallet) || !UNITS.test(grant.maxReserveBaseUnits)
        || !time(grant.expiresAt) || !UUID.test(grant.devnetProofId) || grantIds.has(id)) {
      throw new Error('CFO execution grant identity, cap, expiry or proof reference is invalid.');
    }
    grantIds.add(id);
  }
  const executionTrials = list(env.FALCON_CFO_EXECUTION_TRIALS, 'FALCON_CFO_EXECUTION_TRIALS');
  const actionIds = new Set();
  for (const trial of executionTrials) {
    exact(trial, ['ownerId', 'wallet', 'actionId', 'quoteHash', 'sourceAssetId', 'targetAssetId', 'inputBaseUnits', 'expiresAt', 'devnetProofId'], 'CFO exact trial');
    const grant = executionGrants.find(item => item.ownerId === trial.ownerId && item.wallet === trial.wallet);
    if (!grant || !OWNER.test(trial.ownerId) || !wallet(trial.wallet) || !UUID.test(trial.actionId)
        || !HASH.test(trial.quoteHash) || !asset(trial.sourceAssetId) || !asset(trial.targetAssetId)
        || trial.sourceAssetId === trial.targetAssetId || !UNITS.test(trial.inputBaseUnits)
        || !time(trial.expiresAt) || Date.parse(trial.expiresAt) > Date.parse(grant.expiresAt)
        || trial.devnetProofId !== grant.devnetProofId || actionIds.has(trial.actionId)) {
      throw new Error('CFO exact trial must bind one granted owner, action, quote, assets, amount, expiry and proof.');
    }
    actionIds.add(trial.actionId);
  }
  const apiKey = env.FALCON_CFO_PARTNER_API_KEY ?? null;
  if (apiKey !== null && (typeof apiKey !== 'string' || !apiKey.length || apiKey.length > 4096 || /[\r\n]/.test(apiKey))) {
    throw new Error('FALCON_CFO_PARTNER_API_KEY is invalid.');
  }
  const nearblocksApiKey = env.FALCON_CFO_NEARBLOCKS_API_KEY ?? null;
  if (nearblocksApiKey !== null && (typeof nearblocksApiKey !== 'string' || !nearblocksApiKey.length
      || nearblocksApiKey.length > 4096 || /[\r\n]/.test(nearblocksApiKey))) {
    throw new Error('FALCON_CFO_NEARBLOCKS_API_KEY is invalid.');
  }
  return {
    enabled: env.FALCON_CFO_PROVIDER_ENABLED === '1', apiKey, nearblocksApiKey,
    reviewOwners, executionGrants, executionTrials,
  };
}

// Explorer evidence is an operator-retained observation. This verifies its binding
// to actual owner-scoped confirmed lending records, not the content of a web page.
export function createDevnetProofVerifier({ lending, cfoStore }) {
  return async ({ owner, wallet: address, proofId }) => {
    try {
      if (!OWNER.test(owner) || !wallet(address) || !UUID.test(proofId)) return false;
      const proof = await cfoStore.get(owner, proofId);
      const data = proof?.data;
      if (proof?.kind !== 'devnet-proof' || data?.wallet !== address || !UUID.test(data.supplyIntentId)
          || !UUID.test(data.redeemIntentId) || data.supplyIntentId === data.redeemIntentId
          || !Array.isArray(data.explorerEvidence) || data.explorerEvidence.length !== 2) return false;
      const records = await Promise.all([lending.get(owner, data.supplyIntentId), lending.get(owner, data.redeemIntentId)]);
      const signatures = new Set();
      for (let index = 0; index < records.length; index += 1) {
        const entry = records[index];
        const intent = entry?.record?.intent;
        if (!intent || intent.wallet !== address || intent.network !== 'devnet'
            || intent.action !== (index === 0 ? 'supply' : 'redeem')) return false;
        const submitted = entry.events?.find(event => event.kind === 'SUBMITTED');
        const receipt = entry.events?.find(event => event.kind === 'RECEIPT' && event.data?.status === 'CONFIRMED');
        const signature = submitted?.data?.signature;
        if (!SIGNATURE.test(signature) || signatures.has(signature) || receipt?.data?.signature !== signature
            || !Number.isSafeInteger(receipt.data.slot) || receipt.data.slot <= 0
            || !UNITS.test(receipt.data.amounts?.liquidityBaseUnits) || !UNITS.test(receipt.data.amounts?.receiptBaseUnits)) return false;
        if (index === 0 && BigInt(receipt.data.amounts.liquidityBaseUnits) > 1_000_000n) return false;
        signatures.add(signature);
        const evidence = data.explorerEvidence.find(item => item?.signature === signature);
        if (!evidence || !time(evidence.capturedAt) || !HASH.test(evidence.contentSha256)
            || !['confirmed', 'finalized'].includes(evidence.status) || evidence.slot !== receipt.data.slot) return false;
        const url = new URL(evidence.url);
        if (url.protocol !== 'https:' || url.hostname !== 'explorer.solana.com' || url.port
            || url.username || url.password || url.hash || url.pathname !== `/tx/${signature}`
            || url.search !== '?cluster=devnet') return false;
      }
      return true;
    } catch { return false; }
  };
}
