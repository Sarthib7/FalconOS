import assert from 'node:assert/strict';
import { webcrypto } from 'node:crypto';
import test from 'node:test';
import { buildLegTicket, executeLeg } from '../app/leg-execution.mjs';
import { readOrders, saveOrder } from '../app/state.mjs';
import { ANALOG_MINTS, DEVNET_BASE_MINT, parseAdvice, toView } from '../app/strategy.mjs';
import { encodeSignatureBase58 } from '../app/transaction.mjs';
import { readFile } from 'node:fs/promises';
const appSource = await readFile(new URL('../app/app.mjs', import.meta.url), 'utf8');

test('executeStrategyLeg routes leg status to the defined setStrategyMessage, not an undefined setter', () => {
  assert.match(appSource, /function setStrategyMessage\(/);
  assert.match(appSource, /hooks:\s*\{\s*status:\s*\(message\)\s*=>\s*setStrategyMessage\(message\)\s*\}/);
  assert.doesNotMatch(appSource, /setLegMessage/);
});

const POOL_A = '2gCLw8XLxwYSEHHkT9QWBbJRkojwFp6T13D2Wrbzjf3p';
const POOL_B = '8US31YXHc33Lb3hRZkD8AX9mxmSd3egXmFHgQhcSU7mD';
const MIDDLE = '8X34zxzdrjUBRQXF6ji6YGP8Wr22Ccv6X3n3on2yris1';
const DWSOL = ANALOG_MINTS.OPENAI;

class MemoryStorage {
  values = new Map();
  getItem(key) { return this.values.has(key) ? this.values.get(key) : null; }
  setItem(key, value) { this.values.set(key, String(value)); }
  removeItem(key) { this.values.delete(key); }
}

function encodeBase58(bytes) {
  const alphabet = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
  let value = 0n;
  for (const byte of bytes) value = value * 256n + BigInt(byte);
  let out = '';
  while (value > 0n) { out = alphabet[Number(value % 58n)] + out; value /= 58n; }
  let zeroes = 0;
  while (zeroes < bytes.length && bytes[zeroes] === 0) zeroes += 1;
  return '1'.repeat(zeroes) + out;
}

// Real ed25519 wallet so verifySignedTransaction runs unmocked; only the network and web3 are faked.
async function wallet() {
  const keys = await webcrypto.subtle.generateKey({ name: 'Ed25519' }, true, ['sign', 'verify']);
  const address = encodeBase58(new Uint8Array(await webcrypto.subtle.exportKey('raw', keys.publicKey)));
  const message = new TextEncoder().encode('unsigned swap message');
  const signed = { signCalls: 0, lastSignature: null };
  const tx = () => ({
    signatures: [new Uint8Array(64)],
    message: { recentBlockhash: null, header: { numRequiredSignatures: 1 }, staticAccountKeys: [{ toString: () => address }], serialize: () => message },
    serialize: () => Uint8Array.from([1, 2, 3]),
  });
  const provider = {
    address,
    async signTransaction(transaction) {
      signed.signCalls += 1;
      const signature = new Uint8Array(await webcrypto.subtle.sign('Ed25519', keys.privateKey, transaction.message.serialize()));
      signed.lastSignature = encodeSignatureBase58(signature);
      return { message: transaction.message, serialize: () => Uint8Array.from([9, 9, 9]), signatures: [signature] };
    },
  };
  return { address, provider, tx, signed };
}

function quoteFor({ inputMint, outputMint, amount }) {
  return { success: true, data: {
    inputMint, outputMint, inputAmount: amount, outputAmount: '4200', priceImpactPct: 0.12,
    routePlan: [{ poolId: POOL_A, inputMint, outputMint: MIDDLE }, { poolId: POOL_B, inputMint: MIDDLE, outputMint }],
  } };
}

function mocks(w, overrides = {}) {
  const calls = [];
  const log = (name, fn) => async (...args) => { calls.push([name, ...args]); return fn(...args); };
  const deps = {
    getDevnetQuote: log('quote', async (ticket) => quoteFor(ticket)),
    buildDevnetUnsignedSwap: log('build', async () => 'AQID'),
    getDevnetBlockhash: log('blockhash', async () => ({ blockhash: 'bh', lastValidBlockHeight: 100 })),
    getDevnetBlockHeight: log('height', async () => 50),
    simulateDevnet: log('simulate', async () => ({ err: null })),
    sendDevnet: log('send', async () => w.signed.lastSignature),
    waitForDevnetConfirmation: log('confirm', async () => ({ status: 'confirmed', confirmationStatus: 'confirmed' })),
    loadWeb3: async () => ({ VersionedTransaction: { deserialize: () => w.tx() } }),
    ...Object.fromEntries(Object.entries(overrides).map(([name, fn]) => [name, log(name, fn)])),
  };
  return { calls, deps, names: () => calls.map((call) => call[0]) };
}

const LEG = Object.freeze({ assetId: 'openai-1', underlying: 'OPENAI', targetWeightBps: 6000, allocationBaseUnits: '6000000', analogMint: DWSOL, analog: true, executable: true, label: 'Devnet analog' });
const DEAD_LEG = Object.freeze({ ...LEG, assetId: 'aapl-1', underlying: 'AAPL', analogMint: null, executable: false });

async function run(w, m, storage, extra = {}) {
  return executeLeg({ leg: LEG, signer: w.address, provider: w.provider, deps: m.deps, storage, newId: () => 'leg-order-0001', now: () => '2026-09-29T10:00:00.000Z', ...extra });
}

test('buildLegTicket maps a plan leg to base mint -> analog mint at exactly its allocation', () => {
  assert.deepEqual(buildLegTicket(LEG), { assetId: 'openai-1', underlying: 'OPENAI', inputMint: DEVNET_BASE_MINT, outputMint: DWSOL, amount: '6000000' });
  assert.equal(buildLegTicket(LEG, POOL_A).inputMint, POOL_A);
});

test('buildLegTicket refuses non-executable, zero-allocation, and base-equals-analog legs', () => {
  assert.throws(() => buildLegTicket(DEAD_LEG), /cannot be executed/);
  assert.throws(() => buildLegTicket({ ...LEG, allocationBaseUnits: '0' }), /positive allocation/);
  assert.throws(() => buildLegTicket({ ...LEG, analogMint: DEVNET_BASE_MINT }), /must differ/);
});

test('plan legs produced from the default analog config yield the leg tickets', () => {
  const advice = parseAdvice({ status: 'PUBLISHED', execution_ready: false, legs: [
    { asset_id: 'openai-1', underlying: 'OPENAI', target_weight_bps: 7000 },
    { asset_id: 'spacex-1', underlying: 'SPACEX', target_weight_bps: 3000 },
  ] });
  const { plan } = toView({ advice, capitalBaseUnits: '2000000' });
  assert.deepEqual(plan.legs.map((leg) => buildLegTicket(leg)), [
    { assetId: 'openai-1', underlying: 'OPENAI', inputMint: DEVNET_BASE_MINT, outputMint: DWSOL, amount: '1400000' },
    { assetId: 'spacex-1', underlying: 'SPACEX', inputMint: DEVNET_BASE_MINT, outputMint: DWSOL, amount: '600000' },
  ]);
});

test('a confirmed leg quotes, simulates, signs once, sends, confirms, and journals exactly one tagged entry', async () => {
  const w = await wallet();
  const m = mocks(w);
  const storage = new MemoryStorage();
  const result = await run(w, m, storage);
  assert.equal(result.status, 'confirmed');
  assert.deepEqual(m.names(), ['quote', 'build', 'blockhash', 'simulate', 'height', 'send', 'confirm']);
  assert.deepEqual(m.calls[0][1], { inputMint: DEVNET_BASE_MINT, outputMint: DWSOL, amount: '6000000' });
  assert.equal(m.calls[1][1].amount, '6000000');
  assert.equal(m.calls[1][1].userPublicKey, w.address);
  assert.equal(w.signed.signCalls, 1);
  const journal = readOrders(w.address, storage);
  assert.equal(journal.length, 1);
  const [entry] = journal;
  assert.equal(entry.signature, w.signed.lastSignature);
  assert.equal(result.signature, entry.signature);
  assert.equal(entry.status, 'confirmed');
  assert.deepEqual(entry.leg, { assetId: 'openai-1', underlying: 'OPENAI' });
  assert.equal(entry.inputMint, DEVNET_BASE_MINT);
  assert.equal(entry.outputMint, DWSOL);
  assert.equal(entry.inputBaseUnits, '6000000');
  assert.equal(entry.inputAmount, '6');
  assert.equal(entry.outputBaseUnits, '4200');
  assert.deepEqual(entry.poolIds, [POOL_A, POOL_B]);
});

test('a failed send surfaces the error and leaves the prior journal untouched', async () => {
  const w = await wallet();
  const storage = new MemoryStorage();
  saveOrder(w.address, {
    id: 'prior-order-1', wallet: w.address, network: 'devnet', side: 'BUY', poolId: POOL_A, poolIds: [POOL_A],
    inputMint: DEVNET_BASE_MINT, outputMint: DWSOL, inputAmount: '1', inputBaseUnits: '1000000', inputDecimals: 6,
    outputBaseUnits: '5', outputDecimals: 9, priceImpact: null, status: 'confirmed', signature: null,
    createdAt: '2026-09-28T10:00:00.000Z', updatedAt: '2026-09-28T10:00:00.000Z',
  }, storage);
  const before = storage.getItem(`falconos:orders:devnet:v1:${w.address}`);
  const m = mocks(w, { sendDevnet: async () => { throw new Error('RPC rejected the transaction'); } });
  const result = await run(w, m, storage);
  assert.equal(result.status, 'send-unknown');
  assert.match(result.error, /RPC rejected/);
  assert.equal(result.signature, w.signed.lastSignature);
  assert.equal(storage.getItem(`falconos:orders:devnet:v1:${w.address}`), before);
});

test('on-chain failure and unconfirmed sends do not journal', async () => {
  for (const [outcome, status] of [[{ status: 'failed', err: { InstructionError: [0, 'Custom'] } }, 'failed'], [{ status: 'pending' }, 'pending']]) {
    const w = await wallet();
    const storage = new MemoryStorage();
    const result = await run(w, mocks(w, { waitForDevnetConfirmation: async () => outcome }), storage);
    assert.equal(result.status, status);
    assert.equal(result.signature, w.signed.lastSignature);
    assert.deepEqual(readOrders(w.address, storage), []);
  }
});

test('an executable:false leg is refused before any quote, signature, or journal write', async () => {
  const w = await wallet();
  const m = mocks(w);
  const storage = new MemoryStorage();
  const result = await run(w, m, storage, { leg: DEAD_LEG });
  assert.equal(result.status, 'error');
  assert.match(result.error, /cannot be executed/);
  assert.deepEqual(m.calls, []);
  assert.equal(w.signed.signCalls, 0);
  assert.equal(storage.values.size, 0);
});

test('nothing is signed or journaled when quote, simulation, or wallet-context checks fail', async () => {
  for (const [overrides, extra, pattern, signs] of [
    [{ getDevnetQuote: async () => { throw new Error('no route'); } }, {}, /no route/, 0],
    [{ simulateDevnet: async () => { throw new Error('Devnet simulation failed'); } }, {}, /simulation failed/, 0],
    [{}, { guard: (message) => { if (message.includes('during simulation')) throw new Error(message); } }, /changed during simulation/, 0],
    [{ getDevnetBlockHeight: async () => 101 }, {}, /blockhash expired/, 1],
  ]) {
    const w = await wallet();
    const m = mocks(w, overrides);
    const storage = new MemoryStorage();
    const result = await run(w, m, storage, extra);
    assert.equal(result.status, 'error');
    assert.match(result.error, pattern);
    assert.equal(w.signed.signCalls, signs);
    assert.ok(!m.names().includes('send'));
    assert.equal(storage.values.size, 0);
  }
});

test('a wallet that cannot sign is refused before any network call', async () => {
  const w = await wallet();
  const m = mocks(w);
  const result = await run(w, m, new MemoryStorage(), { provider: { address: w.address } });
  assert.equal(result.status, 'error');
  assert.match(result.error, /cannot sign transactions/);
  assert.deepEqual(m.calls, []);
});

test('a wallet that alters the simulated message is rejected before send', async () => {
  const w = await wallet();
  const evil = { ...w.provider, signTransaction: async (transaction) => {
    const signed = await w.provider.signTransaction(transaction);
    return { ...signed, message: { serialize: () => new TextEncoder().encode('different message') } };
  } };
  const m = mocks(w);
  const storage = new MemoryStorage();
  const result = await run(w, m, storage, { provider: evil });
  assert.equal(result.status, 'error');
  assert.match(result.error, /changed the simulated transaction/);
  assert.ok(!m.names().includes('send'));
  assert.equal(storage.values.size, 0);
});
