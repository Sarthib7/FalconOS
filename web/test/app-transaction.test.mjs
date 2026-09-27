import assert from 'node:assert/strict';
import { webcrypto } from 'node:crypto';
import test from 'node:test';
import { encodeSignatureBase58, verifySignedTransaction } from '../app/transaction.mjs';

function encodeBase58(bytes) {
  const alphabet = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
  let value = 0n;
  for (const byte of bytes) value = value * 256n + BigInt(byte);
  let encoded = '';
  while (value > 0n) { encoded = alphabet[Number(value % 58n)] + encoded; value /= 58n; }
  let zeroes = 0;
  while (zeroes < bytes.length && bytes[zeroes] === 0) zeroes += 1;
  return '1'.repeat(zeroes) + encoded;
}

async function identity() {
  const keys = await webcrypto.subtle.generateKey({ name: 'Ed25519' }, true, ['sign', 'verify']);
  const address = encodeBase58(new Uint8Array(await webcrypto.subtle.exportKey('raw', keys.publicKey)));
  return { ...keys, address };
}

test('signed Devnet transaction keeps the simulated message and verifies every signer', async () => {
  const first = await identity();
  const second = await identity();
  const message = new TextEncoder().encode('serialized versioned transaction');
  const signatures = await Promise.all([first, second].map(async (item) => new Uint8Array(
    await webcrypto.subtle.sign('Ed25519', item.privateKey, message),
  )));
  const result = await verifySignedTransaction({
    unsignedMessage: message,
    signedMessage: message.slice(),
    signer: first.address,
    requiredSignerKeys: [first.address, second.address],
    signatures,
    cryptoProvider: webcrypto,
  });
  assert.equal(result.signerIndex, 0);
  assert.deepEqual(result.signature, signatures[0]);
  assert.equal(encodeSignatureBase58(result.signature).length >= 87, true);
});

test('transaction signer check rejects changed messages, missing signatures, and unrelated wallets', async () => {
  const wallet = await identity();
  const message = new TextEncoder().encode('signed devnet message');
  const signature = new Uint8Array(await webcrypto.subtle.sign('Ed25519', wallet.privateKey, message));
  const base = {
    unsignedMessage: message,
    signedMessage: message,
    signer: wallet.address,
    requiredSignerKeys: [wallet.address],
    signatures: [signature],
    cryptoProvider: webcrypto,
  };
  await assert.rejects(verifySignedTransaction({ ...base, signedMessage: new TextEncoder().encode('changed') }), /changed the simulated transaction/);
  await assert.rejects(verifySignedTransaction({ ...base, signatures: [new Uint8Array(64)] }), /did not sign/);
  await assert.rejects(verifySignedTransaction({ ...base, signer: '11111111111111111111111111111111' }), /not a required signer/);
});
