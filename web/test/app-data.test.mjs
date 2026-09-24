import assert from 'node:assert/strict';
import test from 'node:test';
import { DEVNET_RPC, TOKEN_PROGRAMS, formatTokenAmount, getDevnetBalance, getDevnetSignatures, getDevnetTokenAccounts, getDevnetTokenDecimals } from '../app/data.mjs';

const WALLET = '11111111111111111111111111111111';
const TOKEN_A = 'So11111111111111111111111111111111111111112';
const TOKEN_B = 'PreweJYECqtQwBtpxHL171nL2K6umo692gTm7Q3rpgF';

async function withFetch(handler, run) {
  const original = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url, init) => {
    calls.push({ url: String(url), init, body: JSON.parse(init.body) });
    return Response.json(handler(calls.at(-1)));
  };
  try { return await run(calls); }
  finally { globalThis.fetch = original; }
}

test('Devnet account reads use only the fixed RPC and validate balance', async () => {
  await withFetch(() => ({ result: { value: 1234567890 } }), async (calls) => {
    assert.equal(await getDevnetBalance(WALLET), '1234567890');
    assert.equal(calls[0].url, DEVNET_RPC);
    assert.equal(calls[0].body.method, 'getBalance');
  });
  await withFetch(() => ({ result: { value: -1 } }), async () => {
    await assert.rejects(getDevnetBalance(WALLET), /balance response is invalid/);
  });
});

test('Devnet SPL and Token-2022 balances are parsed and combined by mint', async () => {
  await withFetch(({ body }) => {
    const tokenMint = body.params[1].programId === TOKEN_PROGRAMS[0] ? TOKEN_A : TOKEN_B;
    return { result: { value: [{ account: { data: { parsed: { info: {
      mint: tokenMint,
      tokenAmount: { amount: tokenMint === TOKEN_A ? '1200000' : '4500', decimals: tokenMint === TOKEN_A ? 9 : 6 },
    } } } } }] } };
  }, async (calls) => {
    const balances = await getDevnetTokenAccounts(WALLET);
    assert.equal(calls.length, 2);
    assert.ok(calls.every((call) => call.url === DEVNET_RPC && call.body.method === 'getTokenAccountsByOwner'));
    assert.deepEqual(balances, [
      { mint: TOKEN_B, amount: '4500', decimals: 6 },
      { mint: TOKEN_A, amount: '1200000', decimals: 9 },
    ].sort((a, b) => a.mint.localeCompare(b.mint)));
  });
});

test('Devnet recent signatures validate limits and keep failed status visible', async () => {
  await withFetch(() => ({ result: [
    { signature: '4Nd1mQkwGxY9', slot: 44, blockTime: 1_800_000_000, confirmationStatus: 'confirmed', err: null },
    { signature: 'invalid-slot', slot: '45' },
  ] }), async (calls) => {
    assert.deepEqual(await getDevnetSignatures(WALLET, 1), [
      { signature: '4Nd1mQkwGxY9', slot: 44, blockTime: 1_800_000_000, confirmationStatus: 'confirmed', err: null },
    ]);
    assert.equal(calls[0].url, DEVNET_RPC);
    assert.equal(calls[0].body.method, 'getSignaturesForAddress');
    assert.equal(calls[0].body.params[1].limit, 1);
  });
  await assert.rejects(getDevnetSignatures(WALLET, 0), /limit is invalid/);
});

test('Devnet token decimals use the live mint supply response', async () => {
  await withFetch(() => ({ result: { value: { amount: '100000000', decimals: 8 } } }), async (calls) => {
    assert.equal(await getDevnetTokenDecimals(TOKEN_A), 8);
    assert.equal(calls[0].url, DEVNET_RPC);
    assert.equal(calls[0].body.method, 'getTokenSupply');
  });
});

test('token display formatting keeps integer precision', () => {
  assert.equal(formatTokenAmount('1234567890123', 6, 4), '1,234,567.8901');
  assert.equal(formatTokenAmount('1', 9, 6), '<0.000001');
  assert.equal(formatTokenAmount('not-units', 6), '—');
});

test('invalid wallet addresses fail before RPC access', async () => {
  let requests = 0;
  const original = globalThis.fetch;
  globalThis.fetch = async () => { requests += 1; return Response.json({ result: { value: 0 } }); };
  try { await assert.rejects(getDevnetBalance('bad-address'), /wallet address is invalid/); }
  finally { globalThis.fetch = original; }
  assert.equal(requests, 0);
});
