import assert from 'node:assert/strict';
import test from 'node:test';
import {
  CLUSTERS,
  JUPITER_QUOTE,
  JUPITER_SWAP,
  RAYDIUM_DEVNET_API,
  RAYDIUM_DEVNET_FEE_API,
  OPENAI_MINT,
  USDC_MINT,
  buildUnsignedSwap,
  getBlockHeight,
  getLatestBlockhash,
  getSignatureStatus,
  getQuote,
  getTokenAccountForMint,
  isAllowedRpc,
  sendEncoded,
  simulateEncoded,
  waitForConfirmation,
} from '../copilot/execution.mjs';

const DEVNET_CPMM = 'CPMDWBwJDtYax9qW7AyRuVC19Cc4L4Vcy4n2BHAbHkCW';
const CURRENT_DEVNET_CPMM = 'DRaycpLY18LhpbydsBWbVJtxpNv9oXPgjRSfpF2bWpYb';
const DEVNET_POOL = '7JuwJuNU88gurFnyWeiyGKbFmExMWcmRZntn9imEzdny';
const TOKEN_ACCOUNT = 'G4os3uoQxQXpq5DcyC4MbEhLdQM7yQ9P3VeMvxjSgU2u';

function decodeBase58(value) {
  const alphabet = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
  let number = 0n;
  for (const char of value) number = number * 58n + BigInt(alphabet.indexOf(char));
  const bytes = [];
  while (number > 0n) {
    bytes.push(Number(number & 255n));
    number >>= 8n;
  }
  for (let index = 0; index < value.length && value[index] === '1'; index += 1) bytes.push(0);
  return Uint8Array.from(bytes.reverse());
}

function cpmmPoolAccount({ owner = DEVNET_CPMM, mintA = USDC_MINT, mintB = OPENAI_MINT } = {}) {
  const state = Buffer.alloc(637);
  Buffer.from('f7ede3f5d7c3de46', 'hex').copy(state, 0);
  Buffer.from(decodeBase58(mintA)).copy(state, 168);
  Buffer.from(decodeBase58(mintB)).copy(state, 200);
  return { owner, data: [state.toString('base64'), 'base64'] };
}

function jsonRpcResult(result) {
  return Response.json({ jsonrpc: '2.0', id: 1, result });
}

function devnetQuote(overrides = {}) {
  return {
    success: true,
    data: {
      inputMint: USDC_MINT,
      outputMint: OPENAI_MINT,
      inputAmount: '1000',
      outputAmount: '2500',
      priceImpactPct: 0.2,
      routePlan: [{ poolId: DEVNET_POOL, inputMint: USDC_MINT, outputMint: OPENAI_MINT }],
      ...overrides,
    },
  };
}

async function withFetch(handler, run) {
  const original = globalThis.fetch;
  globalThis.fetch = handler;
  try {
    await run();
  } finally {
    globalThis.fetch = original;
  }
}

test('only the selected Surfpool or Devnet RPC is an allowed send target', () => {
  // V71: each target is exact and neither can route to public mainnet RPC.
  assert.deepEqual(CLUSTERS, {
    surfpool: 'http://127.0.0.1:18488',
    devnet: 'https://api.devnet.solana.com',
  });
  assert.equal(isAllowedRpc(CLUSTERS.surfpool), true);
  assert.equal(isAllowedRpc(CLUSTERS.devnet), true);
  assert.equal(isAllowedRpc('https://api.mainnet-beta.solana.com'), false);
  assert.equal(isAllowedRpc('http://localhost:18488'), false);
});

test('send rejects public mainnet before making an RPC request', async () => {
  let called = false;
  await withFetch(async () => {
    called = true;
    return Response.json({ result: 'signature' });
  }, async () => {
    await assert.rejects(sendEncoded('https://api.mainnet-beta.solana.com', 'signed'), /RPC target is not allowed/);
  });
  assert.equal(called, false);
});

test('send uses the selected Devnet RPC when Devnet is allowed', async () => {
  await withFetch(async (url, init) => {
    assert.equal(url, CLUSTERS.devnet);
    const request = JSON.parse(init.body);
    assert.equal(request.method, 'sendTransaction');
    assert.equal(request.params[0], 'signed-transaction');
    return jsonRpcResult('devnet-signature');
  }, async () => {
    assert.equal(await sendEncoded(CLUSTERS.devnet, 'signed-transaction'), 'devnet-signature');
  });
});

test('latest blockhash comes from the Surfpool RPC', async () => {
  await withFetch(async (url, init) => {
    assert.equal(url, CLUSTERS.surfpool);
    assert.equal(init.redirect, 'error');
    const request = JSON.parse(init.body);
    assert.equal(request.method, 'getLatestBlockhash');
    assert.deepEqual(request.params, [{ commitment: 'confirmed' }]);
    return Response.json({
      jsonrpc: '2.0',
      id: 1,
      result: { context: { slot: 1 }, value: { blockhash: 'fork-hash', lastValidBlockHeight: 20 } },
    });
  }, async () => {
    assert.deepEqual(await getLatestBlockhash(CLUSTERS.surfpool), {
      blockhash: 'fork-hash',
      lastValidBlockHeight: 20,
    });
  });
});

test('Devnet blockhash and block height use only the Devnet RPC', async () => {
  let call = 0;
  await withFetch(async (url, init) => {
    assert.equal(url, CLUSTERS.devnet);
    const request = JSON.parse(init.body);
    call += 1;
    if (call === 1) {
      assert.equal(request.method, 'getLatestBlockhash');
      return jsonRpcResult({ value: { blockhash: 'devnet-hash', lastValidBlockHeight: 42 } });
    }
    assert.equal(request.method, 'getBlockHeight');
    return jsonRpcResult(41);
  }, async () => {
    assert.deepEqual(await getLatestBlockhash(CLUSTERS.devnet), { blockhash: 'devnet-hash', lastValidBlockHeight: 42 });
    assert.equal(await getBlockHeight(CLUSTERS.devnet), 41);
  });
});

test('Jupiter quote and unsigned build use the selected supported mint', async () => {
  let call = 0;
  await withFetch(async (url, init = {}) => {
    call += 1;
    if (call === 1) {
      const parsed = new URL(url);
      assert.equal(parsed.origin + parsed.pathname, JUPITER_QUOTE);
      assert.equal(parsed.searchParams.get('inputMint'), USDC_MINT);
      assert.equal(parsed.searchParams.get('outputMint'), OPENAI_MINT);
      assert.equal(parsed.searchParams.get('amount'), '10000000');
      return Response.json({ outAmount: '900', priceImpactPct: '0.2' });
    }
    assert.equal(url, JUPITER_SWAP);
    assert.equal(init.method, 'POST');
    const body = JSON.parse(init.body);
    assert.equal(body.quoteResponse.outAmount, '900');
    assert.equal(body.userPublicKey, OPENAI_MINT);
    return Response.json({ swapTransaction: 'AQID' });
  }, async () => {
    const quoteResponse = await getQuote({ inputMint: USDC_MINT, outputMint: OPENAI_MINT, amount: '10000000' });
    assert.equal(quoteResponse.outAmount, '900');
    assert.equal(await buildUnsignedSwap({ quoteResponse, userPublicKey: OPENAI_MINT }), 'AQID');
  });
  assert.equal(call, 2);
});

test('V71 rejects an invalid wallet public key before the Jupiter build call', async () => {
  // V71: the connected wallet identity must be a valid Solana public key.
  let called = false;
  await withFetch(async () => {
    called = true;
    return Response.json({ swapTransaction: 'AQID' });
  }, async () => {
    await assert.rejects(buildUnsignedSwap({ quoteResponse: { outAmount: '1' }, userPublicKey: 'wallet-key' }), /wallet address is invalid/);
  });
  assert.equal(called, false);
});

test('Devnet quote checks the live CPMM owner, pool mints, amount, and sole route', async () => {
  let call = 0;
  await withFetch(async (url, init = {}) => {
    call += 1;
    if (call === 1) {
      assert.equal(url, CLUSTERS.devnet);
      const request = JSON.parse(init.body);
      assert.equal(request.method, 'getAccountInfo');
      assert.deepEqual(request.params, [DEVNET_POOL, { encoding: 'base64' }]);
      return jsonRpcResult({ value: cpmmPoolAccount() });
    }
    const parsed = new URL(url);
    assert.equal(parsed.origin, RAYDIUM_DEVNET_API);
    assert.equal(parsed.pathname, '/compute/swap-base-in');
    assert.equal(parsed.searchParams.get('inputMint'), USDC_MINT);
    assert.equal(parsed.searchParams.get('outputMint'), OPENAI_MINT);
    assert.equal(parsed.searchParams.get('amount'), '1000');
    assert.equal(parsed.searchParams.get('slippageBps'), '50');
    assert.equal(parsed.searchParams.get('txVersion'), 'V0');
    return Response.json(devnetQuote());
  }, async () => {
    const quote = await getQuote({ target: 'devnet', poolId: DEVNET_POOL, inputMint: USDC_MINT, outputMint: OPENAI_MINT, amount: '1000' });
    assert.equal(quote.data.outputAmount, '2500');
  });
  assert.equal(call, 2);

  call = 0;
  await withFetch(async (url, init = {}) => {
    call += 1;
    return call === 1
      ? jsonRpcResult({ value: cpmmPoolAccount({ owner: CURRENT_DEVNET_CPMM }) })
      : Response.json(devnetQuote());
  }, async () => {
    const quote = await getQuote({ target: 'devnet', poolId: DEVNET_POOL, inputMint: USDC_MINT, outputMint: OPENAI_MINT, amount: '1000' });
    assert.equal(quote.data.outputAmount, '2500');
  });
});

test('Devnet quote rejects a wrong pool owner or a quote route through another pool', async () => {
  await withFetch(async () => jsonRpcResult({ value: cpmmPoolAccount({ owner: '11111111111111111111111111111111' }) }), async () => {
    await assert.rejects(getQuote({ target: 'devnet', poolId: DEVNET_POOL, inputMint: USDC_MINT, outputMint: OPENAI_MINT, amount: '1000' }), /not a Raydium CPMM pool/);
  });

  let call = 0;
  await withFetch(async (url) => {
    call += 1;
    return call === 1
      ? jsonRpcResult({ value: cpmmPoolAccount() })
      : Response.json(devnetQuote({ routePlan: [{ poolId: OPENAI_MINT, inputMint: USDC_MINT, outputMint: OPENAI_MINT }] }));
  }, async () => {
    await assert.rejects(getQuote({ target: 'devnet', poolId: DEVNET_POOL, inputMint: USDC_MINT, outputMint: OPENAI_MINT, amount: '1000' }), /route does not match/);
  });
});

test('Devnet quote rejects a pool whose on-chain mint pair does not match the request', async () => {
  let called = false;
  await withFetch(async () => {
    called = true;
    return jsonRpcResult({ value: cpmmPoolAccount({ mintB: USDC_MINT }) });
  }, async () => {
    await assert.rejects(getQuote({ target: 'devnet', poolId: DEVNET_POOL, inputMint: USDC_MINT, outputMint: OPENAI_MINT, amount: '1000' }), /do not match/);
  });
  assert.equal(called, true);
});

test('Devnet build pins one CPMM quote and returns one unsigned transaction', async () => {
  const calls = [];
  await withFetch(async (url, init = {}) => {
    calls.push({ url, init });
    if (url === CLUSTERS.devnet) {
      const request = JSON.parse(init.body);
      if (request.method === 'getAccountInfo') return jsonRpcResult({ value: cpmmPoolAccount() });
      assert.equal(request.method, 'getTokenAccountsByOwner');
      assert.equal(request.params[0], OPENAI_MINT);
      return jsonRpcResult({ value: [{ pubkey: request.params[1].mint === USDC_MINT ? TOKEN_ACCOUNT : OPENAI_MINT }] });
    }
    if (url === RAYDIUM_DEVNET_FEE_API) return Response.json({ success: true, data: { default: { h: 50000 } } });
    assert.equal(url, RAYDIUM_DEVNET_API + '/transaction/swap-base-in');
    const body = JSON.parse(init.body);
    assert.equal(body.swapResponse.data.routePlan[0].poolId, DEVNET_POOL);
    assert.equal(body.inputAccount, TOKEN_ACCOUNT);
    assert.equal(body.outputAccount, OPENAI_MINT);
    assert.equal(body.computeUnitPriceMicroLamports, '50000');
    assert.equal(body.wallet, OPENAI_MINT);
    return Response.json({ success: true, data: [{ transaction: 'AQID' }] });
  }, async () => {
    const quote = devnetQuote();
    assert.equal(await buildUnsignedSwap({
      target: 'devnet', quoteResponse: quote, userPublicKey: OPENAI_MINT,
      poolId: DEVNET_POOL, inputMint: USDC_MINT, outputMint: OPENAI_MINT, amount: '1000',
    }), 'AQID');
  });
  assert.equal(calls.filter((call) => call.url === CLUSTERS.devnet).length, 3);
});

test('Devnet build rejects missing input accounts and multiple transactions', async () => {
  let call = 0;
  await withFetch(async (url, init = {}) => {
    if (url === CLUSTERS.devnet) {
      const request = JSON.parse(init.body);
      if (request.method === 'getAccountInfo') return jsonRpcResult({ value: cpmmPoolAccount() });
      call += 1;
      return jsonRpcResult({ value: call === 1 ? [] : [{ pubkey: request.params[1].mint === USDC_MINT ? TOKEN_ACCOUNT : OPENAI_MINT }] });
    }
    return Response.json({ success: true, data: { default: { h: 1000 } } });
  }, async () => {
    await assert.rejects(buildUnsignedSwap({
      target: 'devnet', quoteResponse: devnetQuote(), userPublicKey: OPENAI_MINT,
      poolId: DEVNET_POOL, inputMint: USDC_MINT, outputMint: OPENAI_MINT, amount: '1000',
    }), /no Devnet input token account/);
  });

  call = 0;
  await withFetch(async (url, init = {}) => {
    if (url === CLUSTERS.devnet) {
      const request = JSON.parse(init.body);
      if (request.method === 'getAccountInfo') return jsonRpcResult({ value: cpmmPoolAccount() });
      call += 1;
      return jsonRpcResult({ value: [{ pubkey: request.params[1].mint === USDC_MINT ? TOKEN_ACCOUNT : OPENAI_MINT }] });
    }
    if (url === RAYDIUM_DEVNET_FEE_API) return Response.json({ success: true, data: { default: { h: 1000 } } });
    return Response.json({ success: true, data: [{ transaction: 'AQID' }, { transaction: 'BAUG' }] });
  }, async () => {
    await assert.rejects(buildUnsignedSwap({
      target: 'devnet', quoteResponse: devnetQuote(), userPublicKey: OPENAI_MINT,
      poolId: DEVNET_POOL, inputMint: USDC_MINT, outputMint: OPENAI_MINT, amount: '1000',
    }), /exactly one unsigned transaction/);
  });
});

test('token account lookup uses only the selected target RPC', async () => {
  await withFetch(async (url, init) => {
    assert.equal(url, CLUSTERS.devnet);
    const request = JSON.parse(init.body);
    assert.equal(request.method, 'getTokenAccountsByOwner');
    assert.deepEqual(request.params, [OPENAI_MINT, { mint: USDC_MINT }, { encoding: 'base64', commitment: 'confirmed' }]);
    return jsonRpcResult({ value: [{ pubkey: TOKEN_ACCOUNT }] });
  }, async () => {
    assert.equal(await getTokenAccountForMint(CLUSTERS.devnet, OPENAI_MINT, USDC_MINT), TOKEN_ACCOUNT);
  });
});

test('simulation fails closed on an error or a missing err field', async () => {
  // V71: only an explicit err: null simulation result may reach wallet signing.
  await withFetch(async () => Response.json({ result: { value: { unitsConsumed: 42 } } }), async () => {
    await assert.rejects(simulateEncoded(CLUSTERS.surfpool, 'unsigned'), /simulation response is incomplete/);
  });

  await withFetch(async () => Response.json({ result: { value: { err: { InstructionError: [0, 'Custom'] } } } }), async () => {
    await assert.rejects(simulateEncoded(CLUSTERS.surfpool, 'unsigned'), /simulation failed/);
  });

  await withFetch(async (url, init) => {
    assert.equal(url, CLUSTERS.surfpool);
    const request = JSON.parse(init.body);
    assert.equal(request.method, 'simulateTransaction');
    assert.equal(request.params[0], 'unsigned');
    assert.deepEqual(request.params[1], { encoding: 'base64', replaceRecentBlockhash: false, sigVerify: false });
    return Response.json({ result: { value: { err: null, unitsConsumed: 42 } } });
  }, async () => {
    assert.deepEqual(await simulateEncoded(CLUSTERS.surfpool, 'unsigned'), { err: null, unitsConsumed: 42 });
  });
});

test('signature status reads only Surfpool and returns confirmed status', async () => {
  await withFetch(async (url, init) => {
    assert.equal(url, CLUSTERS.surfpool);
    const request = JSON.parse(init.body);
    assert.equal(request.method, 'getSignatureStatuses');
    assert.deepEqual(request.params, [['tx-signature'], { searchTransactionHistory: true }]);
    return Response.json({ result: { value: [{ err: null, confirmationStatus: 'confirmed' }] } });
  }, async () => {
    assert.deepEqual(await getSignatureStatus(CLUSTERS.surfpool, 'tx-signature'), {
      err: null,
      confirmationStatus: 'confirmed',
    });
  });
});

test('signature status requests abort at their timeout', async () => {
  await withFetch(async (_url, init) => new Promise((_resolve, reject) => {
    init.signal.addEventListener('abort', () => reject(new Error('request aborted')), { once: true });
  }), async () => {
    await assert.rejects(getSignatureStatus(CLUSTERS.surfpool, 'tx-signature', 1), /request aborted/);
  });
});

test('confirmation wait distinguishes success, on-chain failure, and timeout', async () => {
  let call = 0;
  await withFetch(async () => {
    call += 1;
    return Response.json({
      result: {
        value: [call === 1 ? null : { err: null, confirmationStatus: 'finalized' }],
      },
    });
  }, async () => {
    assert.deepEqual(await waitForConfirmation(CLUSTERS.surfpool, 'tx-signature', {
      timeoutMs: 100,
      pollIntervalMs: 1,
    }), { status: 'confirmed', confirmationStatus: 'finalized' });
  });
  assert.equal(call, 2);

  await withFetch(async () => Response.json({
    result: { value: [{ err: { InstructionError: [0, 'Custom'] }, confirmationStatus: 'confirmed' }] },
  }), async () => {
    assert.deepEqual(await waitForConfirmation(CLUSTERS.surfpool, 'tx-signature', { timeoutMs: 0 }), {
      status: 'failed',
      err: { InstructionError: [0, 'Custom'] },
    });
  });

  await withFetch(async () => Response.json({ result: { value: [null] } }), async () => {
    assert.deepEqual(await waitForConfirmation(CLUSTERS.surfpool, 'tx-signature', { timeoutMs: 0 }), {
      status: 'pending',
    });
  });
});
