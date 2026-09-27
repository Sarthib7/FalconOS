import assert from 'node:assert/strict';
import test from 'node:test';
import { clearSession, readOrders, readPortfolio, readSession, saveOrder, updateOrder, writePortfolio, writeSession } from '../app/state.mjs';

const WALLET = '11111111111111111111111111111111';
const MINT_A = 'So11111111111111111111111111111111111111112';
const MINT_B = 'PreweJYECqtQwBtpxHL171nL2K6umo692gTm7Q3rpgF';

class MemoryStorage {
  values = new Map();
  getItem(key) { return this.values.has(key) ? this.values.get(key) : null; }
  setItem(key, value) { this.values.set(key, String(value)); }
  removeItem(key) { this.values.delete(key); }
}

function order(overrides = {}) {
  return {
    id: 'f6d2ae5a-70e6-4d95-a624-8fd8abcf60c0',
    wallet: WALLET,
    network: 'devnet',
    side: 'BUY',
    poolId: MINT_B,
    poolIds: [MINT_B, WALLET],
    inputMint: MINT_A,
    outputMint: MINT_B,
    inputAmount: '1.25',
    inputBaseUnits: '125',
    inputDecimals: 2,
    outputBaseUnits: '50',
    outputDecimals: 2,
    priceImpact: '0.01',
    status: 'quoted',
    signature: null,
    createdAt: '2026-09-24T10:00:00.000Z',
    updatedAt: '2026-09-24T10:00:00.000Z',
    ...overrides,
  };
}

test('portfolio watchlist persists by wallet and removes invalid or duplicate mints', () => {
  const storage = new MemoryStorage();
  writePortfolio(WALLET, { watchlist: [MINT_A, MINT_A, 'invalid', MINT_B] }, storage);
  assert.deepEqual(readPortfolio(WALLET, storage).watchlist, [MINT_A, MINT_B]);
  assert.deepEqual(readPortfolio('So11111111111111111111111111111111111111112', storage).watchlist, []);
});

test('order journal persists order states and signatures by wallet', () => {
  const storage = new MemoryStorage();
  saveOrder(WALLET, order(), storage);
  updateOrder(WALLET, order().id, { status: 'confirmed', signature: '4Nd1mQkwGxY9' }, storage);
  const rows = readOrders(WALLET, storage);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].network, 'devnet');
  assert.equal(rows[0].status, 'confirmed');
  assert.equal(rows[0].signature, '4Nd1mQkwGxY9');
  assert.deepEqual(rows[0].poolIds, [MINT_B, WALLET]);
  assert.deepEqual(readOrders(MINT_A, storage), []);
});

test('order journal rejects non-Devnet, invalid mint, and malformed amounts', () => {
  const storage = new MemoryStorage();
  assert.throws(() => saveOrder(WALLET, order({ network: 'mainnet' }), storage), /order record is invalid/);
  assert.throws(() => saveOrder(WALLET, order({ inputMint: 'not-a-mint' }), storage), /order record is invalid/);
  assert.throws(() => saveOrder(WALLET, order({ inputBaseUnits: '1e8' }), storage), /order record is invalid/);
  assert.throws(() => saveOrder(WALLET, order({ poolIds: [MINT_B, MINT_B] }), storage), /order record is invalid/);
  assert.equal(readOrders(WALLET, storage).length, 0);
});

test('session proof can be stored and cleared without deleting account history', () => {
  const storage = new MemoryStorage();
  const proof = { address: WALLET, signature: 'public-proof' };
  writeSession(proof, storage);
  writePortfolio(WALLET, { watchlist: [MINT_A] }, storage);
  saveOrder(WALLET, order(), storage);
  assert.deepEqual(readSession(storage), proof);
  clearSession(storage);
  assert.equal(readSession(storage), null);
  assert.equal(readOrders(WALLET, storage).length, 1);
  assert.deepEqual(readPortfolio(WALLET, storage).watchlist, [MINT_A]);
});
