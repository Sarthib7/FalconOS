import { canonicalWalletAddress, deriveWalletOwnerId } from '../wallet-auth.mjs';
import { recordHash, validateOwner } from './lifecycle.mjs';
import { canonicalTime } from './lending-strategy.mjs';

export function parseLendingBotConfig(env = process.env) {
  const flag = env.FALCON_BOT_EXECUTION_ENABLED;
  if (flag !== undefined && !['true', 'false'].includes(flag)) throw new Error('FALCON_BOT_EXECUTION_ENABLED must be true or false.');
  const rawBps = env.FALCON_BOT_FEE_BPS;
  const feeBps = rawBps === undefined || rawBps === '' ? null : Number(rawBps);
  if (feeBps !== null && (!/^(0|[1-9][0-9]{0,4})$/.test(rawBps) || !Number.isSafeInteger(feeBps) || feeBps > 10000)) {
    throw new Error('FALCON_BOT_FEE_BPS must be an explicit integer from 0 through 10000.');
  }
  const feeRecipient = env.FALCON_BOT_FEE_RECIPIENT ? canonicalWalletAddress(env.FALCON_BOT_FEE_RECIPIENT) : null;
  const rpcUrl = env.FALCON_BOT_RPC_URL || 'https://api.mainnet-beta.solana.com';
  let parsed;
  try { parsed = new URL(rpcUrl); }
  catch { throw new Error('FALCON_BOT_RPC_URL is invalid.'); }
  if (parsed.username || parsed.password || parsed.hash || !['https:', 'http:'].includes(parsed.protocol)
      || (parsed.protocol === 'http:' && !['localhost', '127.0.0.1', '[::1]'].includes(parsed.hostname))) {
    throw new Error('FALCON_BOT_RPC_URL requires HTTPS or explicit loopback HTTP, without URL user credentials or fragments.');
  }
  let grants;
  try { grants = JSON.parse(env.FALCON_BOT_REVIEW_GRANTS || '[]'); }
  catch { throw new Error('FALCON_BOT_REVIEW_GRANTS must be a JSON array.'); }
  if (!Array.isArray(grants) || grants.length > 32) throw new Error('FALCON_BOT_REVIEW_GRANTS supports at most 32 pilot owners.');
  const owners = new Set();
  const reviewGrants = grants.map(grant => {
    const keys = ['ownerId', 'wallet', 'expiresAt', 'maxCalls'];
    if (!grant || typeof grant !== 'object' || Object.keys(grant).length !== keys.length || keys.some(key => !Object.hasOwn(grant, key))) {
      throw new Error('Every bot review grant requires ownerId, wallet, expiresAt and maxCalls only.');
    }
    const wallet = canonicalWalletAddress(grant.wallet);
    const ownerId = validateOwner(grant.ownerId);
    if (deriveWalletOwnerId(wallet) !== ownerId || owners.has(ownerId)) throw new Error('Bot review grants require unique, matching owner/wallet identities.');
    canonicalTime(grant.expiresAt, 'Review grant expiry');
    if (!Number.isSafeInteger(grant.maxCalls) || grant.maxCalls < 2 || grant.maxCalls > 1000) throw new Error('Bot review grants need a finite maxCalls from 2 through 1000.');
    owners.add(ownerId);
    const clean = { ownerId, wallet, expiresAt: grant.expiresAt, maxCalls: grant.maxCalls };
    return { ...clean, grantId: recordHash(clean) };
  });
  return Object.freeze({ executionEnabled: flag === 'true', feeBps, feeRecipient, rpcUrl, reviewGrants,
    appId: env.FALCON_BOT_PRIVY_APP_ID || null,
    appSecret: env.FALCON_BOT_PRIVY_APP_SECRET || null,
    authorizationKeyId: env.FALCON_BOT_SIGNER_ID || null,
    authorizationPrivateKey: env.FALCON_BOT_SIGNER_KEY || null });
}
