import { decodeSolanaAddress, verifyEd25519 } from './auth.mjs';

function bytesEqual(left, right) {
  return left.length === right.length && left.every((byte, index) => byte === right[index]);
}

export function encodeSignatureBase58(bytes) {
  if (!(bytes instanceof Uint8Array) || bytes.length !== 64) throw new Error('transaction signature is invalid');
  const alphabet = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
  let value = 0n;
  for (const byte of bytes) value = value * 256n + BigInt(byte);
  let result = '';
  while (value > 0n) {
    const remainder = Number(value % 58n);
    value /= 58n;
    result = alphabet[remainder] + result;
  }
  let zeroes = 0;
  while (zeroes < bytes.length && bytes[zeroes] === 0) zeroes += 1;
  return '1'.repeat(zeroes) + result;
}

export async function verifySignedTransaction({ unsignedMessage, signedMessage, signer, requiredSignerKeys, signatures, cryptoProvider = globalThis.crypto }) {
  if (!(unsignedMessage instanceof Uint8Array) || !(signedMessage instanceof Uint8Array) || !bytesEqual(unsignedMessage, signedMessage)) {
    throw new Error('Wallet changed the simulated transaction. Nothing was sent.');
  }
  try { decodeSolanaAddress(signer); } catch { throw new Error('Connected wallet address is invalid. Nothing was sent.'); }
  if (!Array.isArray(requiredSignerKeys) || !requiredSignerKeys.length || !Array.isArray(signatures) || signatures.length !== requiredSignerKeys.length) {
    throw new Error('Signed transaction has an invalid signer list. Nothing was sent.');
  }
  const signerIndex = requiredSignerKeys.findIndex((key) => key === signer);
  if (signerIndex < 0) throw new Error('Connected wallet is not a required signer. Nothing was sent.');
  for (const key of requiredSignerKeys) {
    try { decodeSolanaAddress(key); } catch { throw new Error('Transaction contains an invalid required signer. Nothing was sent.'); }
  }
  for (const signature of signatures) {
    if (!(signature instanceof Uint8Array) || signature.length !== 64 || signature.every((byte) => byte === 0)) {
      throw new Error('A required transaction signer did not sign. Nothing was sent.');
    }
  }
  const verified = await Promise.all(requiredSignerKeys.map((key, index) => verifyEd25519(key, unsignedMessage, signatures[index], cryptoProvider)));
  if (verified.some((valid) => !valid)) throw new Error('A required transaction signature is invalid. Nothing was sent.');
  return { signerIndex, signature: signatures[signerIndex] };
}
