import { bytesToBase64, decodeSolanaAddress } from '../app/auth.mjs';
import { TOKEN_PATTERN, meshRequest } from '../dashboard/api.mjs';

export const WALLET_SESSION_KEY = 'falconos.bot.wallet-session.v1';
const SESSION_TOKEN = /^wsi1_[A-Za-z0-9_-]{43}$/;
const CHALLENGE_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const OWNER_ID = /^wallet_[a-f0-9]{56}$/;

function browserStorage() {
  if (!globalThis.sessionStorage) throw new Error('This browser cannot store a sign-in session for this tab.');
  return globalThis.sessionStorage;
}

function validatedSession(value, token, expectedAddress = null) {
  if (!value || typeof value !== 'object'
    || typeof value.walletAddress !== 'string'
    || typeof value.ownerId !== 'string' || !OWNER_ID.test(value.ownerId)
    || typeof value.expiresAt !== 'string' || !Number.isFinite(Date.parse(value.expiresAt))
    || Date.parse(value.expiresAt) <= Date.now()
    || typeof token !== 'string' || !SESSION_TOKEN.test(token) || !TOKEN_PATTERN.test(token)) {
    throw new Error('The mesh service returned an invalid wallet session.');
  }
  try {
    if (decodeSolanaAddress(value.walletAddress).length !== 32) throw new Error('invalid address');
  } catch {
    throw new Error('The mesh service returned an invalid wallet address.');
  }
  if (expectedAddress && value.walletAddress !== expectedAddress) {
    throw new Error('The verified wallet does not match the account that signed the message.');
  }
  return { token, walletAddress: value.walletAddress, ownerId: value.ownerId, expiresAt: value.expiresAt };
}

export async function createWalletSession(walletSession, { storage = browserStorage(), request = meshRequest } = {}) {
  const account = walletSession?.current?.();
  if (!account?.address || typeof walletSession?.signMessage !== 'function') {
    throw new Error('Connect a Phantom account with solana:signMessage before signing in.');
  }
  const challenge = await request(null, '/v1/auth/wallet/challenge', { address: account.address });
  if (!challenge || typeof challenge.challengeId !== 'string' || !CHALLENGE_ID.test(challenge.challengeId)
    || typeof challenge.message !== 'string' || !challenge.message.length || challenge.message.length > 4096
    || typeof challenge.expiresAt !== 'string' || !Number.isFinite(Date.parse(challenge.expiresAt))
    || Date.parse(challenge.expiresAt) <= Date.now()) {
    throw new Error('The mesh service returned an invalid wallet challenge.');
  }
  const message = new TextEncoder().encode(challenge.message);
  const signature = await walletSession.signMessage(message);
  if (!(signature instanceof Uint8Array) || signature.length !== 64) {
    throw new Error('Phantom returned an invalid message signature.');
  }
  const result = await request(null, '/v1/auth/wallet/verify', {
    challengeId: challenge.challengeId,
    signature: bytesToBase64(signature),
  });
  const session = validatedSession(result, result?.sessionToken, account.address);
  try {
    storage.setItem(WALLET_SESSION_KEY, session.token);
  } catch {
    try { await request(session.token, '/v1/auth/wallet/logout', {}); } catch {}
    throw new Error('This browser could not store the sign-in session. No session was saved.');
  }
  return session;
}

export async function restoreWalletSession({ storage = browserStorage(), request = meshRequest } = {}) {
  const token = storage.getItem(WALLET_SESSION_KEY);
  if (!token) return null;
  if (!SESSION_TOKEN.test(token) || !TOKEN_PATTERN.test(token)) {
    storage.removeItem(WALLET_SESSION_KEY);
    return null;
  }
  const identity = await request(token, '/v1/auth/wallet/session');
  try {
    return validatedSession(identity, token);
  } catch (error) {
    storage.removeItem(WALLET_SESSION_KEY);
    throw error;
  }
}

export async function revokeWalletSession(session, { storage = browserStorage(), request = meshRequest } = {}) {
  const token = session?.token ?? storage.getItem(WALLET_SESSION_KEY);
  if (!token || !SESSION_TOKEN.test(token)) {
    storage.removeItem(WALLET_SESSION_KEY);
    return;
  }
  const result = await request(token, '/v1/auth/wallet/logout', {});
  if (result?.revoked !== true) throw new Error('The wallet session was not revoked.');
  storage.removeItem(WALLET_SESSION_KEY);
}
export function clearWalletSession(storage = browserStorage()) {
  storage.removeItem(WALLET_SESSION_KEY);
}
