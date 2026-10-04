import assert from 'node:assert/strict';
import test from 'node:test';
import { decodeSolanaAddress } from '../app/auth.mjs';
import { createSignInWalletSession } from '../app/wallet-signin.mjs';

const FIRST = '11111111111111111111111111111111';
const SECOND = 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA';
const CHAIN = 'solana:devnet';
const SIGN = 'solana:signMessage';

function account(address = FIRST, changes = {}) {
  return { address, publicKey: decodeSolanaAddress(address), chains: [CHAIN], features: [SIGN], ...changes };
}

function deferred() {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
}

function makeWallet(name = 'North browser wallet', accounts = [account()]) {
  const listeners = new Set();
  const calls = { connect: 0, disconnect: 0, signMessage: [], signTransaction: 0, broadcast: 0 };
  let connectImpl = async () => ({ accounts: wallet.accounts });
  let signImpl = async ({ message }) => [{ signedMessage: message, signature: Uint8Array.of(9, 8, 7) }];
  const wallet = {
    version: '1.0.0', name, icon: 'data:image/png;base64,AA==', chains: [CHAIN], accounts,
    features: {
      'standard:connect': { version: '1.0.0', connect: async () => { calls.connect += 1; return connectImpl(); } },
      'standard:disconnect': { version: '1.0.0', disconnect: async () => { calls.disconnect += 1; change({ accounts: [] }); } },
      'standard:events': { version: '1.0.0', on: (event, listener) => { assert.equal(event, 'change'); listeners.add(listener); return () => listeners.delete(listener); } },
      [SIGN]: { version: '1.0.0', signMessage: async (...inputs) => { calls.signMessage.push(inputs); return signImpl(...inputs); } },
      'solana:signTransaction': { version: '1.0.0', signTransaction: async () => { calls.signTransaction += 1; throw new Error('Transaction signing must never be called'); } },
      'solana:signAndSendTransaction': { version: '1.0.0', signAndSendTransaction: async () => { calls.broadcast += 1; throw new Error('Broadcast must never be called'); } },
    },
  };
  function change(properties) { Object.assign(wallet, properties); for (const listener of listeners) listener(properties); }
  return { wallet, calls, change, listeners, onSign: (fn) => { signImpl = fn; }, onConnect: (fn) => { connectImpl = fn; } };
}

function makeRegistry(...initial) {
  const installed = new Set(initial);
  const listeners = { register: new Set(), unregister: new Set() };
  return {
    get: () => [...installed],
    on: (event, listener) => { listeners[event].add(listener); return () => listeners[event].delete(listener); },
    register: (...wallets) => { wallets.forEach((wallet) => installed.add(wallet)); for (const listener of listeners.register) listener(...wallets); },
    unregister: (...wallets) => { wallets.forEach((wallet) => installed.delete(wallet)); for (const listener of listeners.unregister) listener(...wallets); },
  };
}

async function connected(fixture = makeWallet()) {
  const registry = makeRegistry(fixture.wallet);
  const session = createSignInWalletSession({ registry });
  await session.connect(session.list()[0].id);
  return { ...fixture, registry, session };
}

test('V103: registry discovery works without window.solana', async () => {
  assert.equal(globalThis.window?.solana, undefined);
  const fixture = makeWallet();
  const session = createSignInWalletSession({ registry: makeRegistry(fixture.wallet) });
  assert.deepEqual(session.list().map(({ name, available, reason }) => ({ name, available, reason })), [
    { name: 'North browser wallet', available: true, reason: null },
  ]);
  await session.connect(session.list()[0].id);
  assert.deepEqual(await session.signMessage(Uint8Array.of(1, 2, 3)), Uint8Array.of(9, 8, 7));
  assert.equal(fixture.calls.connect, 1);
  assert.equal(fixture.calls.broadcast, 0);
});
test('message-signing login does not require a disconnect feature', async () => {
  const fixture = makeWallet();
  delete fixture.wallet.features['standard:disconnect'];
  const session = createSignInWalletSession({ registry: makeRegistry(fixture.wallet), requiredChain: null });
  assert.equal(session.list()[0].available, true);
  await session.connect(session.list()[0].id);
  await session.signMessage(Uint8Array.of(4));
  await session.disconnect();
  assert.equal(session.current(), null);
  assert.equal(fixture.calls.disconnect, 0);
});

test('V103: wallet and account missing solana:signMessage are rejected clearly', async () => {
  const missingWalletFeature = makeWallet();
  delete missingWalletFeature.wallet.features[SIGN];
  const first = createSignInWalletSession({ registry: makeRegistry(missingWalletFeature.wallet) });
  assert.equal(first.list()[0].available, false);
  assert.match(first.list()[0].reason, /solana:signMessage/);
  await assert.rejects(first.connect(first.list()[0].id), /solana:signMessage/);

  const missingAccountFeature = makeWallet('Account without message signing', [account(FIRST, { features: [] })]);
  const second = createSignInWalletSession({ registry: makeRegistry(missingAccountFeature.wallet) });
  assert.equal(second.list()[0].available, false);
  assert.match(second.list()[0].reason, /solana:signMessage/);
  await assert.rejects(second.connect(second.list()[0].id), /solana:signMessage/);
});

test('V103: a non-Devnet account is rejected', async () => {
  const fixture = makeWallet('Mainnet wallet', [account(FIRST, { chains: ['solana:mainnet'] })]);
  const session = createSignInWalletSession({ registry: makeRegistry(fixture.wallet) });
  assert.equal(session.list()[0].available, false);
  assert.match(session.list()[0].reason, /solana:devnet/);
  await assert.rejects(session.connect(session.list()[0].id), /solana:devnet/);
  assert.equal(session.current(), null);
});
test('V141: bot login accepts any Solana chain when requested', async () => {
  const mainnetAccount = account(FIRST, { chains: ['solana:mainnet'] });
  const fixture = makeWallet('Phantom', [mainnetAccount]);
  fixture.wallet.chains = ['solana:mainnet'];
  const session = createSignInWalletSession({ registry: makeRegistry(fixture.wallet), requiredChain: null });
  assert.equal(session.list()[0].available, true);
  await session.connect(session.list()[0].id);
  assert.equal(session.current().address, FIRST);
  assert.deepEqual(await session.signMessage(Uint8Array.of(1)), Uint8Array.of(9, 8, 7));
  assert.equal(fixture.calls.broadcast, 0);
});

test('V103: a wallet change event invalidates the current selection and pending signing', async () => {
  const fixture = await connected();
  const pending = deferred();
  fixture.onSign(() => pending.promise);
  const result = fixture.session.signMessage(Uint8Array.of(1, 2, 3));
  fixture.change({ accounts: [account(SECOND)] });
  pending.resolve([{ signedMessage: Uint8Array.of(1, 2, 3), signature: Uint8Array.of(4) }]);
  await assert.rejects(result, /wallet account or signing capability changed/);
  assert.equal(fixture.session.current(), null);
});

test('V103: a redundant account snapshot does not cancel a valid pending sign-in', async () => {
  const fixture = await connected();
  const pending = deferred();
  const message = Uint8Array.of(1, 2, 3);
  const signature = Uint8Array.of(4, 5, 6);
  fixture.onSign(() => pending.promise);
  const result = fixture.session.signMessage(message);
  fixture.change({ accounts: [account(FIRST)] });
  pending.resolve([{ signedMessage: message, signature }]);
  assert.deepEqual(await result, signature);
  assert.equal(fixture.session.current()?.address, FIRST);
});

test('V103: sign-in exposes no broadcast path and never calls one', async () => {
  const fixture = await connected();
  assert.deepEqual(Object.keys(fixture.session).sort(), ['connect', 'current', 'disconnect', 'list', 'signMessage', 'subscribe']);
  assert.deepEqual(await fixture.session.signMessage(Uint8Array.of(4, 5)), Uint8Array.of(9, 8, 7));
  assert.equal(fixture.calls.signTransaction, 0);
  assert.equal(fixture.calls.broadcast, 0);
});

test('V103: signMessage isolates input and validates the signed message output', async () => {
  const fixture = await connected();
  fixture.onSign(async ({ message }) => { message.fill(9); return [{ signedMessage: Uint8Array.of(1, 2), signature: Uint8Array.of(3, 4) }]; });
  const input = Uint8Array.of(7, 8);
  await assert.rejects(fixture.session.signMessage(input), /invalid signed message/);
  assert.deepEqual(input, Uint8Array.of(7, 8));
  for (const output of [null, [], [{ signedMessage: input }], [{ signedMessage: Uint8Array.of(7, 8), signature: new Uint8Array() }]]) {
    fixture.onSign(async () => output);
    await assert.rejects(fixture.session.signMessage(input), /invalid signed message/);
  }
  for (const value of [null, [], new Uint8Array()]) await assert.rejects(fixture.session.signMessage(value), /non-empty sign-in message/);
});
