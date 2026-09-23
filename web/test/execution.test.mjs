import assert from 'node:assert/strict';
import test from 'node:test';
import {
  CLUSTERS,
  JUPITER_QUOTE,
  JUPITER_SWAP,
  OPENAI_MINT,
  USDC_MINT,
  buildUnsignedSwap,
  getLatestBlockhash,
  getSignatureStatus,
  getQuote,
  isAllowedRpc,
  sendEncoded,
  simulateEncoded,
  waitForConfirmation,
} from '../copilot/execution.mjs';

async function withFetch(handler, run) {
  const original = globalThis.fetch;
  globalThis.fetch = handler;
  try {
    await run();
  } finally {
    globalThis.fetch = original;
  }
}

test('only the local Surfpool RPC is an allowed send target', () => {
  // V71: no public RPC target may reach a send call.
  assert.deepEqual(CLUSTERS, { surfpool: 'http://127.0.0.1:8899' });
  assert.equal(isAllowedRpc(CLUSTERS.surfpool), true);
  assert.equal(isAllowedRpc('https://api.mainnet-beta.solana.com'), false);
  assert.equal(isAllowedRpc('https://api.devnet.solana.com'), false);
  assert.equal(isAllowedRpc('http://localhost:8899'), false);
});

test('send rejects devnet before making an RPC request', async () => {
  let called = false;
  await withFetch(async () => {
    called = true;
    return Response.json({ result: 'signature' });
  }, async () => {
    await assert.rejects(sendEncoded('https://api.devnet.solana.com', 'signed'), /RPC is not Surfpool/);
  });
  assert.equal(called, false);
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
    assert.equal(body.userPublicKey, 'wallet-key');
    return Response.json({ swapTransaction: 'unsigned-transaction' });
  }, async () => {
    const quoteResponse = await getQuote({ inputMint: USDC_MINT, outputMint: OPENAI_MINT, amount: '10000000' });
    assert.equal(quoteResponse.outAmount, '900');
    assert.equal(await buildUnsignedSwap({ quoteResponse, userPublicKey: 'wallet-key' }), 'unsigned-transaction');
  });
  assert.equal(call, 2);
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
