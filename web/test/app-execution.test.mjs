import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildDevnetUnsignedSwap,
  getDevnetBlockHeight,
  getDevnetBlockhash,
  getDevnetQuote,
  sendDevnet,
  simulateDevnet,
  waitForDevnetConfirmation,
} from '../app/devnet-execution.mjs';
import { DEVNET_RPC } from '../app/data.mjs';

const CPMM_PROGRAM = 'CPMDWBwJDtYax9qW7AyRuVC19Cc4L4Vcy4n2BHAbHkCW';
const CLMM_PROGRAM = 'DRayAUgENGQBKVaX8owNhgzkEDyoHTGVEGHVJT1E9pfH';
const AMM_PROGRAM = 'DRaya7Kj3aMWQSy19kSjvmuwq9docCHofyP9kanQGaav';
const POOL_A = '2gCLw8XLxwYSEHHkT9QWBbJRkojwFp6T13D2Wrbzjf3p';
const POOL_B = '8US31YXHc33Lb3hRZkD8AX9mxmSd3egXmFHgQhcSU7mD';
const AMM_POOL = '6VEaA2E94TNSkWnG4iWxqDakQb2ucqFu3DyDoLFL4Mrm';
const CPMM_POOL = '7JuwJuNU88gurFnyWeiyGKbFmExMWcmRZntn9imEzdny';
const WALLET = 'PreweJYECqtQwBtpxHL171nL2K6umo692gTm7Q3rpgF';
const INPUT_MINT = 'So11111111111111111111111111111111111111112';
const MIDDLE_MINT = '8X34zxzdrjUBRQXF6ji6YGP8Wr22Ccv6X3n3on2yris1';
const OUTPUT_MINT = '4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU';
const INPUT_ACCOUNT = 'G4os3uoQxQXpq5DcyC4MbEhLdQM7yQ9P3VeMvxjSgU2u';
const RAYDIUM_API = 'https://transaction-v1-devnet.raydium.io';
const FEE_API = 'https://api-v3-devnet.raydium.io/main/auto-fee';

function decodeBase58(value) {
  const alphabet = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
  let number = 0n;
  for (const character of value) number = number * 58n + BigInt(alphabet.indexOf(character));
  const bytes = [];
  while (number > 0n) { bytes.push(Number(number & 255n)); number >>= 8n; }
  for (let index = 0; index < value.length && value[index] === '1'; index += 1) bytes.push(0);
  return Uint8Array.from(bytes.reverse());
}

function poolAccount({ owner = CLMM_PROGRAM, mintA = INPUT_MINT, mintB = MIDDLE_MINT } = {}) {
  const clmm = owner === CLMM_PROGRAM;
  const ammV4 = owner === AMM_PROGRAM;
  const state = Buffer.alloc(ammV4 ? 752 : clmm ? 1544 : 637);
  if (!ammV4) Buffer.from('f7ede3f5d7c3de46', 'hex').copy(state, 0);
  const mintAOffset = ammV4 ? 400 : clmm ? 73 : 168;
  const mintBOffset = ammV4 ? 432 : clmm ? 105 : 200;
  Buffer.from(decodeBase58(mintA)).copy(state, mintAOffset);
  Buffer.from(decodeBase58(mintB)).copy(state, mintBOffset);
  return { owner, data: [state.toString('base64'), 'base64'] };
}

function quote({ routePlan = [
  { poolId: POOL_A, inputMint: INPUT_MINT, outputMint: MIDDLE_MINT },
  { poolId: POOL_B, inputMint: MIDDLE_MINT, outputMint: OUTPUT_MINT },
], inputMint = INPUT_MINT, outputMint = OUTPUT_MINT, inputAmount = '1000' } = {}) {
  return { success: true, data: {
    inputMint,
    outputMint,
    inputAmount,
    outputAmount: '2500',
    priceImpactPct: 0.2,
    routePlan,
  } };
}

function rpcResult(result) { return Response.json({ jsonrpc: '2.0', id: 1, result }); }

async function withFetch(handler, run) {
  const original = globalThis.fetch;
  globalThis.fetch = handler;
  try { await run(); }
  finally { globalThis.fetch = original; }
}

test('TestV76: production quote validates every pool and ordered mint hop in a two-leg route', async () => {
  const calls = [];
  await withFetch(async (url, init) => {
    calls.push({ url, init });
    if (url !== DEVNET_RPC) return Response.json(quote());
    const request = JSON.parse(init.body);
    assert.equal(request.method, 'getMultipleAccounts');
    assert.deepEqual(request.params[0], [POOL_A, POOL_B]);
    return rpcResult({ value: [
      poolAccount({ mintA: INPUT_MINT, mintB: MIDDLE_MINT }),
      poolAccount({ mintA: MIDDLE_MINT, mintB: OUTPUT_MINT }),
    ] });
  }, async () => {
    const result = await getDevnetQuote({ inputMint: INPUT_MINT, outputMint: OUTPUT_MINT, amount: '1000' });
    assert.equal(result.data.outputAmount, '2500');
    assert.equal(result.data.routePlan.length, 2);
  });
  assert.equal(calls.length, 2);
  const query = new URL(calls[0].url);
  assert.equal(query.origin, RAYDIUM_API);
  assert.equal(query.pathname, '/compute/swap-base-in');
  assert.equal(query.searchParams.get('amount'), '1000');

  await withFetch(async (url) => {
    if (url !== DEVNET_RPC) return Response.json(quote());
    return rpcResult({ value: [
      poolAccount({ mintA: INPUT_MINT, mintB: MIDDLE_MINT }),
      poolAccount({ owner: '11111111111111111111111111111111', mintA: MIDDLE_MINT, mintB: OUTPUT_MINT }),
    ] });
  }, async () => {
    await assert.rejects(getDevnetQuote({ inputMint: INPUT_MINT, outputMint: OUTPUT_MINT, amount: '1000' }), /unsupported Devnet pool/);
  });
});

test('TestV76: production quote validates mixed CLMM and AMM V4 state layouts', async () => {
  const mixedQuote = quote({ routePlan: [
    { poolId: POOL_A, inputMint: INPUT_MINT, outputMint: MIDDLE_MINT },
    { poolId: AMM_POOL, inputMint: MIDDLE_MINT, outputMint: OUTPUT_MINT },
  ] });
  await withFetch(async (url, init) => {
    if (url !== DEVNET_RPC) return Response.json(mixedQuote);
    assert.deepEqual(JSON.parse(init.body).params[0], [POOL_A, AMM_POOL]);
    return rpcResult({ value: [
      poolAccount({ mintA: INPUT_MINT, mintB: MIDDLE_MINT }),
      poolAccount({ owner: AMM_PROGRAM, mintA: MIDDLE_MINT, mintB: OUTPUT_MINT }),
    ] });
  }, async () => {
    const result = await getDevnetQuote({ inputMint: INPUT_MINT, outputMint: OUTPUT_MINT, amount: '1000' });
    assert.equal(result.data.routePlan[1].poolId, AMM_POOL);
  });
});

test('TestV76: production quote rejects broken mint continuity before pool lookup', async () => {
  let rpcCalled = false;
  const broken = quote({ routePlan: [
    { poolId: POOL_A, inputMint: INPUT_MINT, outputMint: MIDDLE_MINT },
    { poolId: POOL_B, inputMint: INPUT_MINT, outputMint: OUTPUT_MINT },
  ] });
  await withFetch(async (url) => {
    if (url === DEVNET_RPC) rpcCalled = true;
    return Response.json(broken);
  }, async () => {
    await assert.rejects(getDevnetQuote({ inputMint: INPUT_MINT, outputMint: OUTPUT_MINT, amount: '1000' }), /mint sequence is disconnected/);
  });
  assert.equal(rpcCalled, false);
});

test('TestV76: production quote rejects repeated pools and routes above four legs', async () => {
  const invalidQuotes = [
    quote({ routePlan: [
      { poolId: POOL_A, inputMint: INPUT_MINT, outputMint: MIDDLE_MINT },
      { poolId: POOL_A, inputMint: MIDDLE_MINT, outputMint: OUTPUT_MINT },
    ] }),
    quote({ routePlan: [
      { poolId: POOL_A, inputMint: INPUT_MINT, outputMint: MIDDLE_MINT },
      { poolId: POOL_B, inputMint: MIDDLE_MINT, outputMint: WALLET },
      { poolId: CPMM_POOL, inputMint: WALLET, outputMint: 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA' },
      { poolId: WALLET, inputMint: 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA', outputMint: '11111111111111111111111111111111' },
      { poolId: INPUT_MINT, inputMint: '11111111111111111111111111111111', outputMint: OUTPUT_MINT },
    ] }),
  ];
  const errors = [/repeats a pool/, /1 to 4 pool legs/];
  for (let index = 0; index < invalidQuotes.length; index += 1) {
    let rpcCalled = false;
    await withFetch(async (url) => {
      if (url === DEVNET_RPC) rpcCalled = true;
      return Response.json(invalidQuotes[index]);
    }, async () => {
      await assert.rejects(getDevnetQuote({ inputMint: INPUT_MINT, outputMint: OUTPUT_MINT, amount: '1000' }), errors[index]);
    });
    assert.equal(rpcCalled, false);
  }
});

test('TestV76: production quote accepts a verified single CPMM route', async () => {
  const directQuote = quote({
    routePlan: [{ poolId: CPMM_POOL, inputMint: INPUT_MINT, outputMint: OUTPUT_MINT }],
  });
  await withFetch(async (url) => url === DEVNET_RPC
    ? rpcResult({ value: [poolAccount({ owner: CPMM_PROGRAM, mintA: INPUT_MINT, mintB: OUTPUT_MINT })] })
    : Response.json(directQuote), async () => {
    const result = await getDevnetQuote({ inputMint: INPUT_MINT, outputMint: OUTPUT_MINT, amount: '1000' });
    assert.equal(result.data.routePlan[0].poolId, CPMM_POOL);
  });
});

test('TestV76: production transaction builder revalidates a multi-hop quote and returns one unsigned transaction', async () => {
  const calls = [];
  await withFetch(async (url, init = {}) => {
    calls.push({ url, init });
    if (url === DEVNET_RPC) {
      const request = JSON.parse(init.body);
      if (request.method === 'getMultipleAccounts') return rpcResult({ value: [
        poolAccount({ mintA: INPUT_MINT, mintB: MIDDLE_MINT }),
        poolAccount({ mintA: MIDDLE_MINT, mintB: OUTPUT_MINT }),
      ] });
      assert.equal(request.method, 'getTokenAccountsByOwner');
      return rpcResult({ value: [{ pubkey: request.params[1].mint === INPUT_MINT ? INPUT_ACCOUNT : OUTPUT_MINT }] });
    }
    if (url === FEE_API) return Response.json({ success: true, data: { default: { h: 50000 } } });
    assert.equal(url, `${RAYDIUM_API}/transaction/swap-base-in`);
    const body = JSON.parse(init.body);
    assert.equal(body.swapResponse.data.routePlan.length, 2);
    assert.deepEqual(body.swapResponse.data.routePlan.map((leg) => leg.poolId), [POOL_A, POOL_B]);
    assert.equal(body.inputAccount, INPUT_ACCOUNT);
    assert.equal(body.outputAccount, OUTPUT_MINT);
    return Response.json({ success: true, data: [{ transaction: 'AQID' }] });
  }, async () => {
    const transaction = await buildDevnetUnsignedSwap({
      quoteResponse: quote(), userPublicKey: WALLET,
      inputMint: INPUT_MINT, outputMint: OUTPUT_MINT, amount: '1000',
    });
    assert.equal(transaction, 'AQID');
  });
  assert.equal(calls.filter((call) => call.url === DEVNET_RPC).length, 3);
  assert.ok(calls.every((call) => call.url === DEVNET_RPC || call.url === FEE_API || call.url.startsWith(RAYDIUM_API)));
});

test('blockhash, simulation, send, and confirmation stay on Devnet', async () => {
  let count = 0;
  await withFetch(async (url, init) => {
    assert.equal(url, DEVNET_RPC);
    const request = JSON.parse(init.body);
    count += 1;
    if (request.method === 'getLatestBlockhash') return rpcResult({ value: { blockhash: 'devnet-hash', lastValidBlockHeight: 10 } });
    if (request.method === 'getBlockHeight') return rpcResult(9);
    if (request.method === 'simulateTransaction') return rpcResult({ value: { err: null, unitsConsumed: 42 } });
    if (request.method === 'sendTransaction') return rpcResult('devnet-signature');
    if (request.method === 'getSignatureStatuses') return rpcResult({ value: [{ err: null, confirmationStatus: 'confirmed' }] });
    throw new Error(`unexpected RPC method ${request.method}`);
  }, async () => {
    assert.equal((await getDevnetBlockhash()).blockhash, 'devnet-hash');
    assert.equal(await getDevnetBlockHeight(), 9);
    assert.equal((await simulateDevnet('AQID')).unitsConsumed, 42);
    assert.equal(await sendDevnet('AQID'), 'devnet-signature');
    assert.deepEqual(await waitForDevnetConfirmation('devnet-signature', { timeoutMs: 10, pollIntervalMs: 0 }), {
      status: 'confirmed', confirmationStatus: 'confirmed',
    });
  });
  assert.equal(count, 5);

  await withFetch(async () => rpcResult({ value: { unitsConsumed: 1 } }), async () => {
    await assert.rejects(simulateDevnet('AQID'), /simulation response is incomplete/);
  });
});
