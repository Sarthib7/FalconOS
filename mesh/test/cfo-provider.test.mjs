import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, createPrivateKey, sign } from 'node:crypto';
import { Keypair } from '@solana/web3.js';
import { canonicalBytes, stableStringify } from '../council/evidence.ts';
import { MeshError } from '../domain.mjs';
import { createIntentsAdapter } from '../cfo/intents.mjs';

const NOW = '2026-10-26T12:00:00.000Z';
const DEADLINE = '2026-10-27T12:00:00Z';
const RESERVE = 'nep141:sol-USDC.omft.near';
const GTUSDC = 'nep141:base-0x0bb69b79bc829e1cfcc34a740110886d98d2bd14.omft.near';
const TLO = 'nep141:eth-0x0f38f1ce62776d4a0038bc6cac66877a5687383b.omft.near';
const MINT = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
const TARGETS = [
  { assetId: GTUSDC, symbol: 'gtUSDCp', decimals: 18, blockchain: 'base', contractAddress: '0x0bb69b79bc829e1cfcc34a740110886d98d2bd14' },
  { assetId: TLO, symbol: 'TLO', decimals: 8, blockchain: 'eth', contractAddress: '0x0f38f1ce62776d4a0038bc6cac66877a5687383b' },
];
const tokens = [
  { assetId: RESERVE, symbol: 'USDC', decimals: 6, blockchain: 'sol', contractAddress: MINT },
  ...TARGETS,
];
const ownerKey = Keypair.fromSeed(Uint8Array.from({ length: 32 }, (_, index) => index + 1));
const wrongKey = Keypair.fromSeed(Uint8Array.from({ length: 32 }, (_, index) => index + 65));
const wallet = ownerKey.publicKey.toBase58();
const signerId = ownerKey.publicKey.toBuffer().toString('hex');
const wrongSignerId = wrongKey.publicKey.toBuffer().toString('hex');
const rpcTxHash = Keypair.fromSeed(Uint8Array.from({ length: 32 }, (_, index) => index + 129)).publicKey.toBase58();
const quoteInput = {
  signerId,
  originAsset: RESERVE,
  destinationAsset: TLO,
  amount: '1000000',
  slippageBps: 100,
  dry: false,
  deadline: DEADLINE,
};

function signedDigest(response) {
  return createHash('sha256').update(stableStringify({
    quoteRequest: response.quoteRequest,
    quote: response.quote,
    timestamp: response.timestamp,
  })).digest('hex');
}

function quoteResponse(request, timestamp = NOW, depositAddress = 'intents.near') {
  const response = {
    correlationId: 'cfo-quote-test',
    timestamp,
    signature: '',
    quoteRequest: structuredClone(request),
    quote: {
      depositAddress,
      amountIn: request.amount,
      amountInFormatted: '1',
      amountInUsd: '1',
      minAmountIn: request.amount,
      amountOut: '950000',
      amountOutFormatted: '0.95',
      amountOutUsd: '0.95',
      minAmountOut: '900000',
      deadline: request.deadline,
      timeEstimate: 120,
      refundFee: '0',
      withdrawFee: '0',
    },
  };
  if (request.dry) {
    delete response.quote.depositAddress;
    delete response.quote.deadline;
  }
  response.signature = signedDigest(response);
  return response;
}

function jsonResponse(value, status = 200) {
  return new Response(JSON.stringify(value), { status, headers: { 'content-type': 'application/json' } });
}

function generatedIntent(request, quote, { extraIntent = false, owner = signerId } = {}) {
  const message = {
    signer_id: owner,
    verifying_contract: 'intents.near',
    deadline: quote.deadline,
    nonce: Buffer.alloc(32, 7).toString('base64'),
    intents: [{
      intent: 'token_diff',
      diff: {
        [request.originAsset]: `-${quote.amountIn}`,
        [request.destinationAsset]: quote.minAmountOut,
      },
    }],
  };
  if (extraIntent) message.intents.push({ intent: 'ft_withdraw', token: 'usdc.near', amount: '1' });
  return { standard: 'raw_ed25519', payload: JSON.stringify(message) };
}

function signedWalletPayload(payload, keypair = ownerKey) {
  const seed = Buffer.from(keypair.secretKey.subarray(0, 32));
  const privateKey = createPrivateKey({
    key: Buffer.concat([Buffer.from('302e020100300506032b657004220420', 'hex'), seed]),
    format: 'der',
    type: 'pkcs8',
  });
  return sign(null, Buffer.from(payload, 'utf8'), privateKey).toString('base64');
}

function makeStatus(raw, status = 'PROCESSING', intentHashes = [], nearTxHashes = []) {
  return {
    correlationId: 'cfo-status-test',
    quoteResponse: structuredClone(raw),
    status,
    updatedAt: NOW,
    swapDetails: {
      intentHashes,
      nearTxHashes,
      originChainTxHashes: [],
      destinationChainTxHashes: [],
    },
  };
}

function fixture({ status = 'PROCESSING', extraIntent = false, signedQuote = true, nearblocksApiKey = null, editIntentMessage = null, quoteTimestamp = NOW, quoteDepositAddress = 'intents.near' } = {}) {
  const calls = [];
  let currentQuote;
  let currentStatus;
  let finalizedReceipt;
  const fetchImpl = async (url, options = {}) => {
    const target = new URL(url);
    calls.push({ url: target, options, body: options.body ? JSON.parse(options.body) : null });
    if (target.pathname === '/v0/tokens') return jsonResponse(tokens);
    if (target.pathname === '/v0/quote') {
      currentQuote = quoteResponse(JSON.parse(options.body), quoteTimestamp, quoteDepositAddress);
      if (!signedQuote) currentQuote.signature = 'tampered';
      return jsonResponse(currentQuote);
    }
    if (target.pathname === '/v0/generate-intent') {
      const payload = generatedIntent(currentQuote.quoteRequest, currentQuote.quote, { extraIntent });
      if (editIntentMessage) {
        const message = JSON.parse(payload.payload);
        editIntentMessage(message);
        payload.payload = JSON.stringify(message);
      }
      return jsonResponse({ intent: payload, correlationId: 'cfo-generate-test' });
    }
    if (target.pathname === '/v0/submit-intent') return jsonResponse({
      intentHash: ownerKey.publicKey.toBase58(),
      correlationId: 'cfo-submit-test',
    });
    if (target.pathname === '/v0/status') {
      currentStatus ??= makeStatus(currentQuote, status, [], [rpcTxHash]);
      return jsonResponse(currentStatus);
    }
    if (target.origin === 'https://api.nearblocks.io') {
      if (!finalizedReceipt) throw new Error('Unexpected NearBlocks transaction lookup.');
      return jsonResponse({ data: {
        transaction_hash: target.pathname.split('/').at(-1),
        signer_account_id: finalizedReceipt.senderAccountId,
      } });
    }
    if (target.origin === 'https://rpc.mainnet.near.org') {
      const rpcRequest = JSON.parse(options.body);
      if (rpcRequest.method === 'tx_status') return jsonResponse({
        jsonrpc: '2.0', id: rpcRequest.id, result: finalizedReceipt.rpcResult,
      });
      if (rpcRequest.method === 'query') return jsonResponse({
        jsonrpc: '2.0', id: rpcRequest.id,
        result: {
          block_hash: rpcTxHash,
          block_height: 600,
          result: [...Buffer.from(JSON.stringify(finalizedReceipt.portfolioBalances), 'utf8')],
        },
      });
    }
    throw new Error(`Unexpected provider endpoint ${target.href}`);
  };
  const adapter = createIntentsAdapter({
    fetchImpl,
    apiKey: 'fixture-key',
    nearblocksApiKey,
    enabled: true,
    now: () => NOW,
    verifyQuote: response => response.signature === signedDigest(response),
  });
  const getQuote = async () => adapter.quote(quoteInput);
  const getIntent = async () => {
    const envelope = await getQuote();
    return { envelope, intent: await adapter.generateIntent(envelope, signerId) };
  };
  return {
    adapter,
    calls,
    getQuote,
    getIntent,
    setStatus(value) { currentStatus = value; },
    setFinalizedReceipt(value) { finalizedReceipt = value; },
    get currentQuote() { return currentQuote; },
  };
}

function observedPortfolio(owner = wallet) {
  const ownerSigner = owner === wallet ? signerId : wrongSignerId;
  return {
    schemaVersion: 1,
    chain: 'near',
    network: 'mainnet',
    wallet: owner,
    signerId: ownerSigner,
    capturedAt: NOW,
    blockHash: rpcTxHash,
    blockHeight: 123,
    assets: [
      { assetId: RESERVE, symbol: 'USDC', decimals: 6, blockchain: 'sol', contractAddress: MINT, kind: 'reserve', protocol: null },
      { ...TARGETS[1], kind: 'receipt', protocol: null },
    ],
    balances: [{ assetId: RESERVE, balanceBaseUnits: '2000000' }, { assetId: TLO, balanceBaseUnits: '0' }],
    status: 'OBSERVED',
    reasons: [],
  };
}

function finalizedFixture(signedData, intentHash, failure = false) {
  const senderAccountId = 'relayer.near';
  const status = failure
    ? { Failure: { ActionError: { index: 0, kind: { FunctionCallError: { ExecutionError: 'Temporary execution failure' } } } } }
    : { SuccessValue: '' };
  const event = {
    standard: 'dip4', version: '0.3.0', event: 'token_diff',
    data: [{ account_id: signerId, intent_hash: intentHash, diff: { [RESERVE]: '-1000000', [TLO]: '925000' } }],
  };
  return {
    senderAccountId,
    portfolioBalances: ['1000000', '0', '925000'],
    rpcResult: {
      final_execution_status: 'FINAL', status,
      transaction: {
        hash: rpcTxHash, signer_id: senderAccountId, receiver_id: 'intents.near',
        actions: [{ FunctionCall: { method_name: 'execute_intents',
          args: Buffer.from(JSON.stringify({ signed: [signedData] })).toString('base64'),
          gas: '30000000000000', deposit: '0' } }],
      },
      transaction_outcome: { id: rpcTxHash, block_hash: rpcTxHash,
        outcome: { executor_id: senderAccountId, logs: [], status: { SuccessReceiptId: rpcTxHash } } },
      receipts_outcome: [{ id: rpcTxHash, block_hash: rpcTxHash,
        outcome: { executor_id: 'intents.near', logs: failure ? [] : [`EVENT_JSON:${JSON.stringify(event)}`], status } }],
    },
  };
}

test('V210: quote-specific deposit accounts remain distinct from the signed verifier contract', async () => {
  const f = fixture({ quoteDepositAddress: 'quote-escrow.near' });
  const { envelope, intent } = await f.getIntent();
  assert.notEqual(envelope.raw.quote.depositAddress, JSON.parse(intent.payload).verifying_contract);
  assert.equal(JSON.parse(intent.payload).verifying_contract, 'intents.near');
});

test('V210: one finalized failed relay attempt cannot release a replayable signed intent', async () => {
  const f = fixture({ status: 'FAILED', nearblocksApiKey: 'fixture-nearblocks-key' });
  const { envelope, intent } = await f.getIntent();
  const signedData = f.adapter.validateSigned(intent, wallet, signedWalletPayload(intent.payload));
  const intentHash = ownerKey.publicKey.toBase58();
  f.setStatus(makeStatus(f.currentQuote, 'FAILED', [intentHash], [rpcTxHash]));
  f.setFinalizedReceipt(finalizedFixture(signedData, intentHash, true));
  const result = await f.adapter.reconcile({ quote: envelope, signedData, intentHash, beforePortfolio: observedPortfolio() });
  assert.equal(result.status, 'UNVERIFIED');
});

test('V210: a lost submit reply can recover only through the exact finalized signed intent', async () => {
  const f = fixture({ status: 'SUCCESS', nearblocksApiKey: 'fixture-nearblocks-key' });
  const { envelope, intent } = await f.getIntent();
  const signedData = f.adapter.validateSigned(intent, wallet, signedWalletPayload(intent.payload));
  const intentHash = ownerKey.publicKey.toBase58();
  f.setStatus(makeStatus(f.currentQuote, 'SUCCESS', [intentHash], [rpcTxHash]));
  f.setFinalizedReceipt(finalizedFixture(signedData, intentHash));
  const result = await f.adapter.reconcile({ quote: envelope, signedData, intentHash: null, beforePortfolio: observedPortfolio() });
  assert.equal(result.status, 'CONFIRMED');
  assert.equal(result.intentHash, intentHash);
});

test('disabled provider fails precisely before any network access', async () => {
  let calls = 0;
  const adapter = createIntentsAdapter({ fetchImpl: async () => { calls += 1; }, enabled: false });
  await assert.rejects(adapter.assets(), error => error instanceof MeshError && error.code === 'CONFLICT'
    && /provider is disabled/.test(error.message));
  assert.equal(calls, 0);
});

test('asset registry is resolved from live allowlisted mappings', async () => {
  const f = fixture();
  const result = await f.adapter.assets();
  assert.deepEqual(result.map(({ assetId, kind, symbol, decimals, blockchain, contractAddress }) => ({
    assetId, kind, symbol, decimals, blockchain, contractAddress,
  })), [
    { assetId: RESERVE, kind: 'reserve', symbol: 'USDC', decimals: 6, blockchain: 'sol', contractAddress: MINT },
    { ...TARGETS[0], kind: 'receipt' },
    { ...TARGETS[1], kind: 'receipt' },
  ]);
  assert.equal(f.calls.length, 1);
  assert.equal(f.calls[0].url.origin, 'https://1click.chaindefuser.com');
});

test('quote is signed, raw, exact-input, owner-bound, and hash-enveloped', async () => {
  const f = fixture();
  const envelope = await f.getQuote();
  assert.equal(envelope.schemaVersion, 1);
  assert.equal(envelope.signatureVerified, true);
  assert.equal(envelope.raw.quoteRequest.swapType, 'EXACT_INPUT');
  assert.equal(envelope.raw.quoteRequest.depositType, 'INTENTS');
  assert.equal(envelope.raw.quoteRequest.recipient, signerId);
  assert.equal(envelope.raw.quoteRequest.refundTo, signerId);
  assert.equal(envelope.raw.quoteRequest.slippageTolerance, 100);
  assert.equal(envelope.raw.quote.refundFee, '0');
  assert.equal(envelope.raw.quote.withdrawFee, '0');
  assert.equal(envelope.sha256, createHash('sha256').update(canonicalBytes(envelope.raw)).digest('hex'));
  assert.equal(f.calls.find(call => call.url.pathname === '/v0/quote').options.headers['X-API-Key'], 'fixture-key');
});

test('future provider quote timestamps are rejected against local capture time', async () => {
  const f = fixture({ quoteTimestamp: '2026-10-26T12:00:01.000Z' });
  await assert.rejects(f.getQuote(), error => error instanceof MeshError && error.code === 'STORAGE_UNAVAILABLE');
});

test('older provider quote timestamps remain raw and are not replaced with local capture time', async () => {
  const timestamp = '2026-10-26T11:59:00.000Z';
  const f = fixture({ quoteTimestamp: timestamp });
  const envelope = await f.getQuote();
  assert.equal(envelope.raw.timestamp, timestamp);
  assert.equal(envelope.capturedAt, NOW);
});

test('dry quote is not signable', async () => {
  const f = fixture();
  const envelope = await f.adapter.quote({ ...quoteInput, dry: true });
  assert.equal(envelope.raw.quoteRequest.dry, true);
  assert.equal(envelope.raw.quote.depositAddress, undefined);
  await assert.rejects(f.adapter.generateIntent(envelope, signerId), error => error instanceof MeshError
    && error.code === 'INVALID_INPUT');
  assert.equal(f.calls.filter(call => call.url.pathname === '/v0/generate-intent').length, 0);
});

test('tampered signed quote is rejected even when its envelope hash is recomputed', async () => {
  const f = fixture();
  const envelope = await f.getQuote();
  const tampered = structuredClone(envelope);
  tampered.raw.quote.amountOut = '990000';
  tampered.sha256 = createHash('sha256').update(canonicalBytes(tampered.raw)).digest('hex');
  await assert.rejects(f.adapter.generateIntent(tampered, signerId), error => error instanceof MeshError
    && error.code === 'INVALID_INPUT');
  assert.equal(f.calls.filter(call => call.url.pathname === '/v0/generate-intent').length, 0);
});

test('quote with invalid service signature is rejected', async () => {
  const f = fixture({ signedQuote: false });
  await assert.rejects(f.getQuote(), error => error instanceof MeshError && error.code === 'STORAGE_UNAVAILABLE');
});

test('generated malicious extra intent is rejected', async () => {
  const f = fixture({ extraIntent: true });
  const envelope = await f.getQuote();
  await assert.rejects(f.adapter.generateIntent(envelope, signerId), error => error instanceof MeshError
    && error.code === 'STORAGE_UNAVAILABLE');
});

test('generated intent binds signer, verifier contract, nonce, quote expiry, debit, and minimum credit', async () => {
  const edits = [
    message => { message.signer_id = wrongSignerId; },
    message => { message.verifying_contract = 'attacker.near'; },
    message => { message.nonce = 'not-base64'; },
    message => { message.deadline = '2026-10-28T12:00:00Z'; },
    message => { message.intents[0].diff[RESERVE] = '-999999'; },
    message => { message.intents[0].diff[TLO] = '899999'; },
  ];
  for (const editIntentMessage of edits) {
    const f = fixture({ editIntentMessage });
    const envelope = await f.getQuote();
    await assert.rejects(f.adapter.generateIntent(envelope, signerId), error => error instanceof MeshError
      && error.code === 'STORAGE_UNAVAILABLE');
  }
});

test('generated intent is signed by exactly the matching owner key', async () => {
  const f = fixture();
  const { envelope, intent } = await f.getIntent();
  const signatureBase64 = signedWalletPayload(intent.payload);
  const signedData = f.adapter.validateSigned(intent, wallet, signatureBase64);
  assert.equal(signedData.standard, 'raw_ed25519');
  assert.equal(signedData.payload, intent.payload);
  assert.equal(signedData.public_key, `ed25519:${ownerKey.publicKey.toBase58()}`);
  assert.match(signedData.signature, /^ed25519:/);
  assert.equal(envelope.raw.quoteRequest.recipient, signerId);
  assert.throws(() => f.adapter.validateSigned(intent, wrongKey.publicKey.toBase58(), signatureBase64), error => error instanceof MeshError
    && error.code === 'UNAUTHORIZED');
  assert.throws(() => f.adapter.validateSigned(intent, wallet, Buffer.alloc(64, 1).toString('base64')), error => error instanceof MeshError
    && error.code === 'UNAUTHORIZED');
});

test('signed submission sends the exact validated MultiPayload once', async () => {
  const f = fixture();
  const { intent } = await f.getIntent();
  const signedData = f.adapter.validateSigned(intent, wallet, signedWalletPayload(intent.payload));
  const result = await f.adapter.submitIntent(signedData);
  assert.deepEqual(result, { intentHash: ownerKey.publicKey.toBase58(), correlationId: 'cfo-submit-test' });
  const submissions = f.calls.filter(call => call.url.pathname === '/v0/submit-intent');
  assert.equal(submissions.length, 1);
  assert.equal(submissions[0].body.type, 'swap_transfer');
  assert.deepEqual(submissions[0].body.signedData, signedData);
  assert.equal(submissions[0].options.headers['X-API-Key'], 'fixture-key');
});

test('wrong portfolio owner cannot reconcile a quote for another owner', async () => {
  const f = fixture();
  const { envelope, intent } = await f.getIntent();
  const signedData = f.adapter.validateSigned(intent, wallet, signedWalletPayload(intent.payload));
  const intentHash = ownerKey.publicKey.toBase58();
  await assert.rejects(f.adapter.reconcile({
    quote: envelope, signedData, intentHash, beforePortfolio: observedPortfolio(wrongKey.publicKey.toBase58()),
  }), error => error instanceof MeshError && error.code === 'INVALID_INPUT');
  assert.equal(f.calls.filter(call => call.url.pathname === '/v0/status').length, 0);
});

test('pending provider state remains pending without implying receipt success', async () => {
  const f = fixture({ status: 'PROCESSING' });
  const { envelope, intent } = await f.getIntent();
  const signedData = f.adapter.validateSigned(intent, wallet, signedWalletPayload(intent.payload));
  const intentHash = ownerKey.publicKey.toBase58();
  const pending = makeStatus(f.currentQuote, 'PROCESSING', [intentHash], [rpcTxHash]);
  f.setStatus(pending);
  const result = await f.adapter.reconcile({ quote: envelope, signedData, intentHash, beforePortfolio: observedPortfolio() });
  assert.equal(result.status, 'PENDING');
  assert.equal(result.providerStatus.status, 'PROCESSING');
  assert.equal(result.portfolio, null);
});

test('provider SUCCESS without independently verifiable finalized receipts stays unverified', async () => {
  const f = fixture({ status: 'SUCCESS' });
  const { envelope, intent } = await f.getIntent();
  const signedData = f.adapter.validateSigned(intent, wallet, signedWalletPayload(intent.payload));
  const intentHash = ownerKey.publicKey.toBase58();
  f.setStatus(makeStatus(f.currentQuote, 'SUCCESS', [intentHash], [rpcTxHash]));
  const result = await f.adapter.reconcile({ quote: envelope, signedData, intentHash, beforePortfolio: observedPortfolio() });
  assert.equal(result.status, 'UNVERIFIED');
  assert.equal(result.providerStatus.status, 'SUCCESS');
  assert.equal(result.portfolio, null);
  assert.match(result.reason, /NearBlocks sender-discovery key is not configured/);
  assert.equal(f.calls.filter(call => call.url.origin === 'https://rpc.mainnet.near.org').length, 0);
});

test('confirmation requires the exact signed transaction and finalized intents.near owner event', async () => {
  const f = fixture({ status: 'SUCCESS', nearblocksApiKey: 'fixture-nearblocks-key' });
  const { envelope, intent } = await f.getIntent();
  const signedData = f.adapter.validateSigned(intent, wallet, signedWalletPayload(intent.payload));
  const intentHash = ownerKey.publicKey.toBase58();
  f.setStatus(makeStatus(f.currentQuote, 'SUCCESS', [intentHash], [rpcTxHash]));
  f.setFinalizedReceipt(finalizedFixture(signedData, intentHash));
  const result = await f.adapter.reconcile({ quote: envelope, signedData, intentHash, beforePortfolio: observedPortfolio() });
  assert.equal(result.status, 'CONFIRMED');
  assert.deepEqual(result.amounts, {
    debit: { assetId: RESERVE, baseUnits: '1000000' },
    credit: { assetId: TLO, baseUnits: '925000' },
  });
  assert.deepEqual(result.portfolio.balances.map(row => row.balanceBaseUnits), ['1000000', '0', '925000']);
});

test('finalized NEAR RPC balance capture decodes exact base-unit strings', async () => {
  const calls = [];
  const rpcResult = {
    jsonrpc: '2.0', id: 1,
    result: {
      block_hash: rpcTxHash,
      block_height: 555,
      result: [...Buffer.from(JSON.stringify(['1000000', '2500000000000000000', '7']), 'utf8')],
    },
  };
  const fetchImpl = async (url, options = {}) => {
    const parsed = new URL(url);
    calls.push({ parsed, options, body: options.body ? JSON.parse(options.body) : null });
    if (parsed.pathname === '/v0/tokens') return jsonResponse(tokens);
    if (parsed.href === 'https://rpc.mainnet.near.org/') return jsonResponse(rpcResult);
    throw new Error(`Unexpected provider endpoint ${parsed.href}`);
  };
  const adapter = createIntentsAdapter({ fetchImpl, enabled: true, now: () => NOW });
  const portfolio = await adapter.capturePortfolio(wallet);
  const rpc = calls.find(call => call.parsed.origin === 'https://rpc.mainnet.near.org');
  assert.equal(rpc.body.method, 'query');
  assert.equal(rpc.body.params.request_type, 'call_function');
  assert.equal(rpc.body.params.account_id, 'intents.near');
  assert.equal(rpc.body.params.method_name, 'mt_batch_balance_of');
  assert.equal(rpc.body.params.finality, 'final');
  assert.equal(JSON.parse(Buffer.from(rpc.body.params.args_base64, 'base64').toString('utf8')).account_id, signerId);
  assert.equal(portfolio.status, 'OBSERVED');
  assert.equal(portfolio.blockHeight, 555);
  assert.deepEqual(portfolio.balances.map(row => row.balanceBaseUnits), ['1000000', '2500000000000000000', '7']);
});
