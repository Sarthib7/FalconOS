const BASE58 = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
export const DEVNET_CHAIN_ID = 'solana:devnet';
export const SIGN_IN_STATEMENT = 'Sign in to FalconOS. This signature does not approve a transaction or spend fees.';
export const SESSION_TTL_MS = 30 * 60 * 1000;
const DEVNET_SIGN_IN_CHAIN_IDS = new Set([DEVNET_CHAIN_ID, 'devnet']);
const ED25519_FALLBACK = 'https://esm.sh/@noble/ed25519@2.3.0'; // version-pinned esm.sh import, same convention as the web3.js import in app.mjs

export function decodeSolanaAddress(value) {
  if (typeof value !== 'string' || value.length < 32 || value.length > 44) throw new Error('wallet address is invalid');
  let number = 0n;
  for (const character of value) {
    const digit = BASE58.indexOf(character);
    if (digit < 0) throw new Error('wallet address is invalid');
    number = number * 58n + BigInt(digit);
  }
  const bytes = [];
  while (number > 0n) {
    bytes.push(Number(number & 255n));
    number >>= 8n;
  }
  for (let index = 0; index < value.length && value[index] === '1'; index += 1) bytes.push(0);
  bytes.reverse();
  if (bytes.length !== 32) throw new Error('wallet address is invalid');
  return Uint8Array.from(bytes);
}

function validOrigin(value) {
  let url;
  try { url = new URL(value); } catch { throw new Error('app origin is invalid'); }
  const localHttp = url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  if (url.protocol !== 'https:' && !localHttp) throw new Error('wallet sign-in requires HTTPS');
  if (url.origin !== value || url.username || url.password) throw new Error('app origin is invalid');
  return url;
}

export function createNonce(cryptoProvider = globalThis.crypto) {
  if (!cryptoProvider?.getRandomValues) throw new Error('secure randomness is unavailable');
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let nonce = '';
  while (nonce.length < 24) {
    const bytes = cryptoProvider.getRandomValues(new Uint8Array(32));
    for (const byte of bytes) {
      if (byte >= 248) continue;
      nonce += alphabet[byte % alphabet.length];
      if (nonce.length === 24) break;
    }
  }
  return nonce;
}

export function createSignInRequest({ address, origin, now = Date.now(), nonce = createNonce(), chainId }) {
  decodeSolanaAddress(address);
  const url = validOrigin(origin);
  if (!Number.isSafeInteger(now) || now <= 0) throw new Error('sign-in time is invalid');
  if (typeof nonce !== 'string' || !/^[A-Za-z0-9]{8,128}$/.test(nonce)) throw new Error('sign-in nonce is invalid');
  if (chainId !== undefined && !DEVNET_SIGN_IN_CHAIN_IDS.has(chainId)) throw new Error('sign-in chain ID is invalid');
  const request = {
    domain: url.host,
    address,
    statement: SIGN_IN_STATEMENT,
    uri: url.origin,
    version: '1',
    nonce,
    issuedAt: new Date(now).toISOString(),
    expirationTime: new Date(now + SESSION_TTL_MS).toISOString(),
  };
  if (chainId !== undefined) request.chainId = chainId;
  request.message = createSignInMessage(request);
  return request;
}

export function createSignInMessage(request) {
  const fields = [
    `${request.domain} wants you to sign in with your Solana account:`,
    request.address,
    '',
    request.statement,
    '',
    `URI: ${request.uri}`,
    `Version: ${request.version}`,
  ];
  if (request.chainId !== undefined) fields.push(`Chain ID: ${request.chainId}`);
  fields.push(`Nonce: ${request.nonce}`, `Issued At: ${request.issuedAt}`, `Expiration Time: ${request.expirationTime}`);
  return fields.join('\n');
}

export function bytesToBase64(value) {
  const bytes = value instanceof Uint8Array ? value : new Uint8Array(value);
  let binary = '';
  for (let start = 0; start < bytes.length; start += 8192) {
    binary += String.fromCharCode(...bytes.subarray(start, start + 8192));
  }
  return btoa(binary);
}

export function signatureBytes(value) {
  if (value && typeof value === 'object' && Object.prototype.hasOwnProperty.call(value, 'signature')) value = value.signature;
  if (value instanceof Uint8Array) return value;
  if (value instanceof ArrayBuffer) return new Uint8Array(value);
  if (ArrayBuffer.isView(value)) return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
  if (Array.isArray(value) && value.every((byte) => Number.isInteger(byte) && byte >= 0 && byte <= 255)) return Uint8Array.from(value);
  return null;
}

function base64ToBytes(value) {
  if (typeof value !== 'string' || !/^[A-Za-z0-9+/]+={0,2}$/.test(value) || value.length % 4 !== 0) return null;
  try {
    const binary = atob(value);
    return Uint8Array.from(binary, (character) => character.charCodeAt(0));
  } catch { return null; }
}

export async function verifyEd25519(address, message, signature, cryptoProvider = globalThis.crypto, loadFallback = () => import(ED25519_FALLBACK)) {
  if (!cryptoProvider?.subtle || !(message instanceof Uint8Array) || !(signature instanceof Uint8Array) || signature.length !== 64) return false;
  let publicKey;
  try { publicKey = decodeSolanaAddress(address); } catch { return false; }
  try {
    const key = await cryptoProvider.subtle.importKey('raw', publicKey, { name: 'Ed25519' }, false, ['verify']);
    return await cryptoProvider.subtle.verify({ name: 'Ed25519' }, key, signature, message);
  } catch {
    try {
      const ed = await loadFallback();
      return await ed.verifyAsync(signature, message, publicKey) === true;
    } catch { return false; }
  }
}

export async function verifySignInProof(proof, expectedOrigin, now = Date.now(), cryptoProvider = globalThis.crypto) {
  if (!proof || typeof proof !== 'object' || !cryptoProvider?.subtle) return false;
  let url;
  try {
    url = validOrigin(expectedOrigin);
    decodeSolanaAddress(proof.address);
  } catch { return false; }

  if (proof.domain !== url.host || proof.uri !== url.origin) return false;
  if (proof.chainId !== undefined && !DEVNET_SIGN_IN_CHAIN_IDS.has(proof.chainId)) return false;
  if (proof.statement !== SIGN_IN_STATEMENT || proof.version !== '1') return false;
  if (typeof proof.nonce !== 'string' || !/^[A-Za-z0-9]{8,128}$/.test(proof.nonce)) return false;
  if (typeof proof.issuedAt !== 'string' || typeof proof.expirationTime !== 'string') return false;
  const issuedAt = Date.parse(proof.issuedAt);
  const expirationTime = Date.parse(proof.expirationTime);
  if (!Number.isFinite(issuedAt) || !Number.isFinite(expirationTime) || !Number.isSafeInteger(now)) return false;
  if (new Date(issuedAt).toISOString() !== proof.issuedAt || new Date(expirationTime).toISOString() !== proof.expirationTime) return false;
  if (issuedAt > now + 30_000 || now - issuedAt > SESSION_TTL_MS) return false;
  if (expirationTime <= now || expirationTime <= issuedAt || expirationTime > issuedAt + SESSION_TTL_MS) return false;
  if (proof.message !== createSignInMessage(proof)) return false;
  const signature = base64ToBytes(proof.signature);
  if (!signature || signature.length !== 64) return false;

  return verifyEd25519(proof.address, new TextEncoder().encode(proof.message), signature, cryptoProvider);
}
