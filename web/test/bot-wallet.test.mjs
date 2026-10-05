import test from 'node:test';
import assert from 'node:assert/strict';
import {
  connectPhantomWallet,
  disconnectPhantomWallet,
  findPhantomWallet,
  subscribePhantomAccountChanges,
} from '../bot/wallet.mjs';

const address = '11111111111111111111111111111111';
const solanaAccount = { address, chains: ['solana:devnet'], features: [] };

function phantomWallet(features = {}) {
  return { name: 'Phantom', features: { ...features } };
}

test('V141: discovery selects Phantom only when it supports standard connect', () => {
  const phantom = phantomWallet({ 'standard:connect': { connect: async () => ({ accounts: [solanaAccount] }) } });
  const other = { ...phantom, name: 'Other Wallet' };
  assert.equal(findPhantomWallet([other, phantom]), phantom);
  assert.equal(findPhantomWallet([other]), null);
  assert.equal(findPhantomWallet([phantomWallet()]), null);
});

test('V141: connect exposes a Solana address without invoking signing features', async () => {
  const calls = [];
  const wallet = phantomWallet({
    'standard:connect': { connect: async () => { calls.push('connect'); return { accounts: [{ address: '0x123', chains: ['eip155:1'] }, solanaAccount] }; } },
    'solana:signTransaction': { signTransaction: async () => { calls.push('sign'); } },
  });
  assert.equal((await connectPhantomWallet(wallet)).address, address);
  assert.deepEqual(calls, ['connect']);
});

test('V141: connection fails when Phantom returns no Solana account', async () => {
  const wallet = phantomWallet({ 'standard:connect': { connect: async () => ({ accounts: [] }) } });
  await assert.rejects(connectPhantomWallet(wallet), { message: 'PHANTOM_ACCOUNT_UNAVAILABLE' });
});
test('V142: malformed Base58 strings are not Solana public keys', async () => {
  const wallet = phantomWallet({ 'standard:connect': { connect: async () => ({ accounts: [{ address: 'z'.repeat(32), chains: ['solana:devnet'] }] }) } });
  await assert.rejects(connectPhantomWallet(wallet), { message: 'PHANTOM_ACCOUNT_UNAVAILABLE' });
});

test('V141: account changes and wallet disconnect clear the displayed account', () => {
  let listener, removed = false, addressShown;
  const wallet = phantomWallet({ 'standard:events': { on: (event, callback) => { assert.equal(event, 'change'); listener = callback; return () => { removed = true; }; } } });
  const unsubscribe = subscribePhantomAccountChanges(wallet, account => { addressShown = account?.address ?? null; });
  listener({ accounts: [solanaAccount] });
  assert.equal(addressShown, address);
  listener({ accounts: [] });
  assert.equal(addressShown, null);
  unsubscribe();
  assert.equal(removed, true);
});

test('V141: disconnect uses only the Wallet Standard disconnect feature', async () => {
  let disconnected = 0;
  const wallet = phantomWallet({ 'standard:disconnect': { disconnect: async () => { disconnected += 1; } } });
  assert.equal(await disconnectPhantomWallet(wallet), true);
  assert.equal(disconnected, 1);
  assert.equal(await disconnectPhantomWallet(phantomWallet()), false);
});
