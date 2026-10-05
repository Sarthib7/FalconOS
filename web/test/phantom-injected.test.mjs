import assert from 'node:assert/strict';
import test from 'node:test';
import { decodeSolanaAddress } from '../app/auth.mjs';
import { createInjectedPhantomSession, detectPhantomProvider, phantomLoginOption } from '../bot/phantom-injected.mjs';

const ADDRESS = '11111111111111111111111111111111';
const SIGNATURE = new Uint8Array(64).fill(7);

function makeProvider() {
  const key = {
    toBytes: () => decodeSolanaAddress(ADDRESS),
    toString: () => ADDRESS,
  };
  const calls = [];
  const provider = {
    isPhantom: true,
    publicKey: null,
    connect: async () => {
      calls.push(['connect']);
      provider.publicKey = key;
      return { publicKey: key };
    },
    signMessage: async (message, encoding) => {
      calls.push(['signMessage', message.slice(), encoding]);
      return { signature: SIGNATURE.slice(), publicKey: key };
    },
    on() {},
    off() {},
  };
  return { provider, calls, key };
}

test('detects Phantom injected under its documented namespace and legacy provider slot', () => {
  const documented = makeProvider().provider;
  assert.equal(detectPhantomProvider({ phantom: { solana: documented } })?.provider, documented);

  const legacy = makeProvider().provider;
  assert.equal(detectPhantomProvider({ solana: legacy })?.provider, legacy);

  assert.equal(detectPhantomProvider({ solana: { isPhantom: false } }), null);
});

test('reports missing Phantom signing capability without claiming the wallet is absent', () => {
  const provider = { isPhantom: true, connect() {} };
  assert.deepEqual(detectPhantomProvider({ phantom: { solana: provider } }), {
    provider,
    available: false,
    reason: 'Phantom does not support message signing in this browser.',
  });
});

test('connects only on request and signs the exact challenge bytes with Phantom', async () => {
  const { provider, calls } = makeProvider();
  const session = createInjectedPhantomSession(provider);
  assert.equal(session.current(), null);
  assert.deepEqual(await session.connect(), { address: ADDRESS });
  const message = Uint8Array.of(1, 2, 3, 4);
  assert.deepEqual(await session.signMessage(message), SIGNATURE);
  assert.deepEqual(calls, [
    ['connect'],
    ['signMessage', message, 'utf8'],
  ]);
});

test('rejects a signature if Phantom changes accounts while signing', async () => {
  const { provider, key } = makeProvider();
  const session = createInjectedPhantomSession(provider);
  await session.connect();
  provider.signMessage = async () => {
    provider.publicKey = { toBytes: () => decodeSolanaAddress('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA'), toString: () => 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA' };
    return { signature: SIGNATURE, publicKey: key };
  };
  await assert.rejects(session.signMessage(Uint8Array.of(9)), /account changed/i);
});
test('shows the available Phantom sign-in path before reporting unavailable or install', () => {
  const standard = { id: 'wallet-1', name: 'Phantom', available: true };
  assert.deepEqual(phantomLoginOption([standard], { available: true }), { kind: 'wallet-standard', wallet: standard });
  assert.deepEqual(phantomLoginOption([{ ...standard, available: false, reason: 'Missing message signing.' }], { available: true }), { kind: 'injected' });
  assert.deepEqual(phantomLoginOption([], { available: false, reason: 'Phantom lacks account-change events.' }), { kind: 'unavailable', reason: 'Phantom lacks account-change events.' });
  assert.deepEqual(phantomLoginOption([], null), { kind: 'install' });
});
