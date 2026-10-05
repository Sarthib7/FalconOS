import bs58 from 'bs58';

export class SignatureError extends Error {}

const SIGNATURE_BYTES = 64;
const BASE64 = /^[A-Za-z0-9+/]+={0,2}$/;

// Accepts a 64-byte Ed25519 signature as canonical base64 or as base58 and returns canonical base64.
// Messages never echo the input.
export function normalizeSignature(value) {
  if (typeof value !== 'string' || value.length < 80 || value.length > 100) {
    throw new SignatureError('Signature must be 64 bytes encoded as base64 or base58.');
  }
  let bytes = null;
  if (/[+/=]/.test(value)) {
    if (!BASE64.test(value)) throw new SignatureError('Signature must be 64 bytes encoded as base64 or base58.');
    bytes = Buffer.from(value, 'base64');
    if (bytes.toString('base64') !== value) throw new SignatureError('Signature base64 is not canonical.');
  } else {
    try { bytes = Buffer.from(bs58.decode(value)); }
    catch { bytes = null; }
  }
  if (!bytes || bytes.length !== SIGNATURE_BYTES) {
    throw new SignatureError('Signature must decode to exactly 64 bytes (base64 or base58).');
  }
  return bytes.toString('base64');
}
