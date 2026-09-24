import assert from 'node:assert/strict';
import { webcrypto } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { bytesToBase64, createSignInMessage, createSignInRequest, decodeSolanaAddress, signatureBytes, verifyEd25519, verifySignInProof } from '../app/auth.mjs';

const html = await readFile(new URL('../app/index.html', import.meta.url), 'utf8');
const appSource = await readFile(new URL('../app/app.mjs', import.meta.url), 'utf8');
const dataSource = await readFile(new URL('../app/data.mjs', import.meta.url), 'utf8');
const tradeSource = await readFile(new URL('../app/devnet-execution.mjs', import.meta.url), 'utf8');
const dashHtml = await readFile(new URL('../dash/index.html', import.meta.url), 'utf8');

function encodeBase58(bytes) {
  const alphabet = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
  let value = 0n;
  for (const byte of bytes) value = value * 256n + BigInt(byte);
  let encoded = '';
  while (value > 0n) {
    encoded = alphabet[Number(value % 58n)] + encoded;
    value /= 58n;
  }
  let zeroes = 0;
  while (zeroes < bytes.length && bytes[zeroes] === 0) zeroes += 1;
  return '1'.repeat(zeroes) + encoded;
}

test('dashboard entry opens the wallet terminal', () => {
  assert.match(dashHtml, /href="\/app\/"/);
  assert.match(html, /id="connect-wallet"/);
  assert.match(html, /id="login-action"/);
  assert.match(html, /id="portfolio"/);
  assert.match(html, /id="trade"/);
  assert.match(html, /id="strategy"/);
  assert.match(html, /id="activity"/);
});

test('production trade UI has a fixed Devnet path and manual wallet sign step', () => {
  assert.match(appSource, /getDevnetQuote\(/);
  assert.match(dataSource, /https:\/\/api\.devnet\.solana\.com/);
  assert.match(appSource, /signTransaction\(transaction\)/);
  assert.match(appSource, /simulateDevnet\(/);
  assert.doesNotMatch(appSource, /127\.0\.0\.1:18488|jup\.ag|api\.mainnet-beta\.solana\.com/i);
  assert.doesNotMatch(tradeSource, /127\.0\.0\.1:18488|jup\.ag|api\.mainnet-beta\.solana\.com/i);
});

test('SIWS request binds domain, address, nonce, and expiry without a cluster chain ID', () => {
  const address = '11111111111111111111111111111111';
  const request = createSignInRequest({
    address,
    origin: 'https://falconos.markets',
    now: 1_800_000_000_000,
    nonce: 'AuthNonce1234567890',
  });
  assert.equal(request.domain, 'falconos.markets');
  assert.equal(request.chainId, undefined);
  assert.doesNotMatch(request.message, /^Chain ID:/m);
  assert.match(request.message, /Nonce: AuthNonce1234567890/);
  assert.match(request.message, /Expiration Time:/);
  assert.throws(() => createSignInRequest({ address, origin: 'http://falconos.markets', nonce: 'AuthNonce123' }), /HTTPS/);
  assert.throws(() => decodeSolanaAddress('not-a-wallet'), /wallet address is invalid/);
});

test('wallet signature parsing accepts wrapped and raw provider results', () => {
  const signature = Uint8Array.from({ length: 64 }, (_, index) => index);
  assert.equal(signatureBytes({ signature }), signature);
  assert.equal(signatureBytes(signature), signature);
  assert.deepEqual(signatureBytes(Array.from(signature)), signature);
  assert.equal(signatureBytes({ signature: 'base58-string' }), null);
});

test('SIWS proof verifies the signature and rejects changed scope or message', async () => {
  const pair = await webcrypto.subtle.generateKey({ name: 'Ed25519' }, true, ['sign', 'verify']);
  const publicKey = new Uint8Array(await webcrypto.subtle.exportKey('raw', pair.publicKey));
  const address = encodeBase58(publicKey);
  const now = 1_800_000_000_000;
  const request = createSignInRequest({ address, origin: 'https://falconos.markets', now, nonce: 'ProofNonce12345678' });
  const signature = new Uint8Array(await webcrypto.subtle.sign('Ed25519', pair.privateKey, new TextEncoder().encode(request.message)));
  const proof = { ...request, signature: bytesToBase64(signature) };

  assert.equal(await verifySignInProof(proof, 'https://falconos.markets', now + 1000, webcrypto), true);
  assert.equal(await verifySignInProof(proof, 'https://other.example', now + 1000, webcrypto), false);
  assert.equal(await verifySignInProof({ ...proof, chainId: 'solana:mainnet' }, 'https://falconos.markets', now + 1000, webcrypto), false);
  assert.equal(await verifySignInProof({ ...proof, message: `${proof.message} changed` }, 'https://falconos.markets', now + 1000, webcrypto), false);
  assert.equal(await verifySignInProof(proof, 'https://falconos.markets', now + 31 * 60 * 1000, webcrypto), false);
  assert.equal(await verifyEd25519(address, new TextEncoder().encode('different'), signature, webcrypto), false);

  const legacyRequest = { ...request, chainId: 'solana:devnet' };
  legacyRequest.message = createSignInMessage(legacyRequest);
  const legacySignature = new Uint8Array(await webcrypto.subtle.sign('Ed25519', pair.privateKey, new TextEncoder().encode(legacyRequest.message)));
  const legacyProof = { ...legacyRequest, signature: bytesToBase64(legacySignature) };
  assert.equal(await verifySignInProof(legacyProof, 'https://falconos.markets', now + 1000, webcrypto), true);
});
