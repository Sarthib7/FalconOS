import assert from 'node:assert/strict';
import test from 'node:test';
import { decodeSolanaAddress } from '../app/auth.mjs';
import { createWalletSession } from '../mesh/wallet.mjs';

const FIRST = '11111111111111111111111111111111';
const SECOND = 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA';
const CHAIN = 'solana:devnet';
const SIGN = 'solana:signTransaction';

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
  const calls = { connect: 0, disconnect: 0, sign: [], broadcast: 0 };
  let connectImpl = async () => { change({ accounts: wallet.accounts }); return { accounts: wallet.accounts }; };
  let signImpl = async () => [{ signedTransaction: Uint8Array.of(9, 8, 7) }];
  const wallet = {
    version: '1.0.0', name, icon: 'data:image/png;base64,AA==', chains: [CHAIN], accounts,
    features: {
      'standard:connect': { version: '1.0.0', connect: async () => { calls.connect += 1; return connectImpl(); } },
      'standard:disconnect': { version: '1.0.0', disconnect: async () => { calls.disconnect += 1; change({ accounts: [] }); } },
      'standard:events': { version: '1.0.0', on: (event, listener) => { assert.equal(event, 'change'); listeners.add(listener); return () => listeners.delete(listener); } },
      [SIGN]: { version: '1.0.0', supportedTransactionVersions: ['legacy', 0], signTransaction: async (...inputs) => { calls.sign.push(inputs); return signImpl(...inputs); } },
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
  const session = createWalletSession({ registry });
  await session.connect(session.list()[0].id);
  return { ...fixture, registry, session };
}

test('V103: standard discovery supports different wallet brands without signMessage', async () => {
  const first = makeWallet();
  const second = makeWallet('Hardware bridge', [account(SECOND)]);
  const session = createWalletSession({ registry: makeRegistry(first.wallet, second.wallet) });
  assert.equal(session.current(), null);
  assert.deepEqual(session.list().map(({ name, available, reason }) => ({ name, available, reason })), [
    { name: 'North browser wallet', available: true, reason: null },
    { name: 'Hardware bridge', available: true, reason: null },
  ]);
  for (const [index, fixture] of [first, second].entries()) {
    const info = await session.connect(session.list()[index].id);
    assert.deepEqual(info, { walletId: session.list()[index].id, walletName: fixture.wallet.name, address: fixture.wallet.accounts[0].address });
    assert.equal(fixture.wallet.features['solana:signMessage'], undefined);
    assert.deepEqual(await session.signTransaction(Uint8Array.of(1, 2, 3)), Uint8Array.of(9, 8, 7));
    const inputs = fixture.calls.sign[0];
    assert.equal(inputs.length, 1);
    assert.equal(inputs[0].chain, CHAIN);
    assert.equal(inputs[0].account, fixture.wallet.accounts[0]);
    assert.equal(fixture.calls.broadcast, 0);
  }
});

test('V103: late registration has stable object IDs even when names match', async () => {
  const first = makeWallet('Same name');
  const second = makeWallet('Same name');
  const registry = makeRegistry(first.wallet);
  const session = createWalletSession({ registry });
  const updates = [];
  const unsubscribe = session.subscribe((value) => updates.push(value));
  const firstId = session.list()[0].id;
  registry.register(second.wallet);
  assert.equal(updates.at(-1).wallets.length, 2);
  assert.notEqual(session.list()[1].id, firstId);
  await session.connect(firstId);
  registry.unregister(first.wallet);
  assert.equal(session.current(), null);
  assert.match(updates.at(-1).reason, /no longer available/);
  assert.equal(first.listeners.size, 0);
  registry.register(first.wallet);
  assert.equal(session.list().find((item) => item.id === firstId)?.name, 'Same name');
  assert.equal(first.listeners.size, 1);
  unsubscribe();
  const count = updates.length;
  registry.unregister(second.wallet);
  assert.equal(updates.length, count);
});

test('V103: missing Devnet and required features remain visible with clear reasons', async () => {
  const cases = [
    [fixture => { fixture.wallet.chains = ['solana:mainnet']; }, /does not support Solana Devnet/],
    [fixture => { delete fixture.wallet.features['standard:events']; }, /standard:events/],
    [fixture => { delete fixture.wallet.features['standard:disconnect']; }, /standard:disconnect/],
    [fixture => { fixture.wallet.features[SIGN].version = '2.0.0'; }, /unsupported solana:signTransaction version/],
    [fixture => { delete fixture.wallet.features[SIGN]; }, /signAndSend-only/],
  ];
  for (const [alter, expected] of cases) {
    const fixture = makeWallet(); alter(fixture);
    const session = createWalletSession({ registry: makeRegistry(fixture.wallet) });
    const entry = session.list()[0];
    assert.equal(entry.available, false);
    assert.match(entry.reason, expected);
    await assert.rejects(session.connect(entry.id), expected);
    assert.equal(fixture.calls.connect, 0);
    assert.equal(fixture.calls.broadcast, 0);
  }
});

test('V103: the authorized account must support Devnet signing and match its public key', async () => {
  const cases = [
    [account(FIRST, { chains: ['solana:mainnet'] }), /account does not support Solana Devnet/],
    [account(FIRST, { features: ['solana:signAndSendTransaction'] }), /signAndSend-only account/],
    [account(FIRST, { publicKey: decodeSolanaAddress(SECOND) }), /address and public key do not match/],
    [account(FIRST, { address: 'invalid' }), /address is invalid/],
  ];
  for (const [invalid, expected] of cases) {
    const fixture = makeWallet('Account test', [invalid]);
    const session = createWalletSession({ registry: makeRegistry(fixture.wallet) });
    assert.equal(session.list()[0].available, false);
    await assert.rejects(session.connect(session.list()[0].id), expected);
    assert.equal(session.current(), null);
    assert.equal(fixture.calls.sign.length, 0);
  }
  const fixture = makeWallet('Mixed accounts', [account(FIRST, { chains: ['solana:mainnet'] }), account(SECOND)]);
  const { session } = await connected(fixture);
  assert.equal(session.current().address, SECOND);
});

test('V103: an initially locked wallet may authorize an account on explicit connect', async () => {
  const fixture = makeWallet('Locked wallet', []);
  const session = createWalletSession({ registry: makeRegistry(fixture.wallet) });
  assert.equal(session.list()[0].available, true);
  fixture.onConnect(async () => { fixture.change({ accounts: [account()] }); return { accounts: fixture.wallet.accounts }; });
  await session.connect(session.list()[0].id);
  assert.equal(session.current().address, FIRST);
});

test('V103: changed accounts invalidate pending signing even when the account changes back', async () => {
  const fixture = await connected();
  const pending = deferred();
  fixture.onSign(() => pending.promise);
  const result = fixture.session.signTransaction(Uint8Array.of(1));
  fixture.change({ accounts: [account(SECOND)] });
  fixture.change({ accounts: [account()] });
  pending.resolve([{ signedTransaction: Uint8Array.of(2) }]);
  await assert.rejects(result, /wallet account or signing capability changed/);
  assert.equal(fixture.session.current(), null);
  assert.equal(fixture.calls.broadcast, 0);
});

test('V103: account changes without events are checked before and after wallet signing', async () => {
  const before = await connected();
  before.wallet.accounts = [account(SECOND)];
  await assert.rejects(before.session.signTransaction(Uint8Array.of(1)), /changed/);
  assert.equal(before.calls.sign.length, 0);
  const after = await connected();
  after.onSign(async () => { after.wallet.accounts = [account(SECOND)]; return [{ signedTransaction: Uint8Array.of(2) }]; });
  await assert.rejects(after.session.signTransaction(Uint8Array.of(1)), /changed/);
  assert.equal(after.session.current(), null);
});

test('V103: a copied public key detects mutation of the same authorized account object', async () => {
  const fixture = await connected();
  const publicKey = fixture.wallet.accounts[0].publicKey;
  publicKey[0] = 1;
  assert.equal(fixture.session.current(), null);
  await assert.rejects(fixture.session.signTransaction(Uint8Array.of(1)), /changed/);
  assert.equal(fixture.calls.sign.length, 0);
});

test('V103: removed wallets and changed signing features invalidate pending requests', async () => {
  for (const alter of [
    fixture => fixture.registry.unregister(fixture.wallet),
    fixture => fixture.change({ chains: ['solana:mainnet'] }),
    fixture => { fixture.wallet.features[SIGN] = { ...fixture.wallet.features[SIGN], signTransaction: async () => [] }; },
  ]) {
    const fixture = await connected();
    const pending = deferred();
    fixture.onSign(() => pending.promise);
    const result = fixture.session.signTransaction(Uint8Array.of(1));
    alter(fixture);
    pending.resolve([{ signedTransaction: Uint8Array.of(2) }]);
    await assert.rejects(result, /changed/);
    assert.equal(fixture.session.current(), null);
  }
});

test('V103: disconnect clears local state before pending signing can return', async () => {
  const fixture = await connected();
  const pending = deferred();
  fixture.onSign(() => pending.promise);
  const result = fixture.session.signTransaction(Uint8Array.of(1));
  await fixture.session.disconnect();
  assert.equal(fixture.session.current(), null);
  assert.equal(fixture.calls.disconnect, 1);
  pending.resolve([{ signedTransaction: Uint8Array.of(2) }]);
  await assert.rejects(result, /changed/);
});

test('V103: a superseded connection cannot replace the later selected wallet', async () => {
  const first = makeWallet();
  const second = makeWallet('Second wallet', [account(SECOND)]);
  const registry = makeRegistry(first.wallet, second.wallet);
  const session = createWalletSession({ registry });
  const pending = deferred();
  first.onConnect(() => pending.promise);
  const stale = session.connect(session.list()[0].id);
  await session.connect(session.list()[1].id);
  pending.resolve({ accounts: first.wallet.accounts });
  await assert.rejects(stale, /changed while connecting/);
  assert.equal(session.current().address, SECOND);
});

test('V103: changed connect results and disconnect during connection fail closed', async () => {
  const first = makeWallet();
  first.onConnect(async () => ({ accounts: [account(SECOND)] }));
  const one = createWalletSession({ registry: makeRegistry(first.wallet) });
  await assert.rejects(one.connect(one.list()[0].id), /account changed while connecting/);
  const second = makeWallet();
  const pending = deferred();
  second.onConnect(() => pending.promise);
  const two = createWalletSession({ registry: makeRegistry(second.wallet) });
  const result = two.connect(two.list()[0].id);
  await two.disconnect();
  pending.resolve({ accounts: [account()] });
  await assert.rejects(result, /changed while connecting/);
  assert.equal(two.current(), null);
});

test('V103: signing isolates caller bytes and rejects empty or malformed wallet output', async () => {
  const fixture = await connected();
  const unsigned = Uint8Array.of(1, 2, 3);
  const walletOutput = Uint8Array.of(4, 5, 6);
  fixture.onSign(async ({ transaction }) => { transaction.fill(9); return [{ signedTransaction: walletOutput }]; });
  const result = await fixture.session.signTransaction(unsigned);
  assert.deepEqual(unsigned, Uint8Array.of(1, 2, 3));
  walletOutput.fill(8);
  assert.deepEqual(result, Uint8Array.of(4, 5, 6));
  for (const output of [null, [], [{ signedTransaction: [] }], [{ signedTransaction: new Uint8Array() }], [{ signedTransaction: Uint8Array.of(1) }, { signedTransaction: Uint8Array.of(2) }]]) {
    fixture.onSign(async () => output);
    await assert.rejects(fixture.session.signTransaction(unsigned), /invalid signed transaction/);
  }
  for (const input of [null, [1], new Uint8Array()]) await assert.rejects(fixture.session.signTransaction(input), /unsigned serialized transaction/);
});

test('V103: a concurrent sign request is rejected and a rejected wallet request can be retried', async () => {
  const fixture = await connected();
  const pending = deferred();
  fixture.onSign(() => pending.promise);
  const first = fixture.session.signTransaction(Uint8Array.of(1));
  await assert.rejects(fixture.session.signTransaction(Uint8Array.of(1)), /already active/);
  pending.resolve([{ signedTransaction: Uint8Array.of(2) }]);
  await first;
  fixture.onSign(async () => { throw new Error('User rejected signing.'); });
  await assert.rejects(fixture.session.signTransaction(Uint8Array.of(1)), /User rejected/);
  fixture.onSign(async () => [{ signedTransaction: Uint8Array.of(3) }]);
  assert.deepEqual(await fixture.session.signTransaction(Uint8Array.of(1)), Uint8Array.of(3));
  assert.equal(fixture.calls.broadcast, 0);
});

test('V103: discovery excludes remote icon URLs and rejects broken change-event support', async () => {
  const fixture = makeWallet();
  fixture.wallet.icon = 'https://wallet.example/icon.png';
  fixture.wallet.features['standard:events'].on = () => undefined;
  const session = createWalletSession({ registry: makeRegistry(fixture.wallet) });
  const entry = session.list()[0];
  assert.equal(entry.icon, null);
  assert.equal(entry.available, false);
  await assert.rejects(session.connect(entry.id), /account change events/);
});
