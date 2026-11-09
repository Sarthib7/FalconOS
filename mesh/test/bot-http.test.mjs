import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { MeshError } from '../domain.mjs';
import { createApi } from '../http.mjs';

const ORIGIN = 'http://localhost:4171';
const OWNER_A = 'bot_owner_alpha';
const OWNER_B = 'bot_owner_bravo';
const WALLET_A = '11111111111111111111111111111111';
const WALLET_B = '22222222222222222222222222222222';
const RESERVE_A = '33333333333333333333333333333333';
const RESERVE_B = '44444444444444444444444444444444';
const RECIPIENT = '55555555555555555555555555555555';
const OPERATOR_TOKEN = 'operator-token-00000000000000000000000000000000';
const digest = value => createHash('sha256').update(value).digest('hex');

async function listen(t, { lendingBot, sessions = new Map() }) {
  const api = createApi({
    store: {},
    lendingBot,
    walletAuth: { async getSession(token) { return sessions.get(token) ?? null; } },
    tokenHashes: new Map([[digest(OPERATOR_TOKEN), OWNER_A]]),
    allowedOrigins: new Set([ORIGIN]),
  });
  await new Promise((resolve, reject) => {
    api.once('error', reject);
    api.listen(0, '127.0.0.1', resolve);
  });
  t.after(async () => {
    api.closeAllConnections();
    await new Promise(resolve => api.close(resolve));
  });
  return `http://127.0.0.1:${api.address().port}`;
}

function session(ownerId, walletAddress) {
  return { ownerId, walletAddress };
}

async function fetchJson(base, token, path, body) {
  const response = await fetch(`${base}${path}`, {
    method: body === undefined ? 'GET' : 'POST',
    headers: {
      origin: ORIGIN,
      authorization: `Bearer ${token}`,
      ...(body === undefined ? {} : { 'content-type': 'application/json' }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  return { status: response.status, payload: await response.json() };
}

function rawGetWithBody(base, token) {
  const url = new URL('/v1/lending-bot', base);
  const payload = '{"scope":"other-wallet"}';
  return new Promise((resolve, reject) => {
    const request = http.request(url, {
      method: 'GET',
      headers: { origin: ORIGIN, authorization: `Bearer ${token}`, 'content-type': 'application/json', 'content-length': Buffer.byteLength(payload) },
    }, response => {
      let text = '';
      response.setEncoding('utf8');
      response.on('data', chunk => { text += chunk; });
      response.on('end', () => resolve({ status: response.statusCode, payload: JSON.parse(text) }));
    });
    request.once('error', reject);
    request.end(payload);
  });
}

function validMandate() {
  return {
    schemaVersion: 1,
    capitalCapBaseUnits: '10000000',
    reserveFloorBaseUnits: '0',
    maxActionBaseUnits: '5000000',
    maxPositionBps: 10000,
    maxFeeLamports: '5000',
    maxEvidenceAgeSeconds: 300,
    minHoldingSeconds: 60,
    minNetBenefitBaseUnits: '0',
    cooldownSeconds: 0,
    feeBps: 100,
    feeRecipient: RECIPIENT,
    reserves: [RESERVE_A, RESERVE_B],
    expiresAt: '2030-01-01T00:00:00.000Z',
    monitorIntervalSeconds: 60,
    maxReviewCalls: 1,
  };
}

function botWithRecorder() {
  const calls = [];
  const names = [
    'overview', 'linkWallet', 'saveMandate', 'prepareDelegation', 'verifyDelegation',
    'quoteAccounts', 'prepareAccounts',
    'capture', 'start', 'pause', 'prepareRevocation', 'revoke', 'prepareWithdrawal',
    'prepareFeeClaim', 'submitOwnerSignature', 'reconcile',
  ];
  const bot = Object.fromEntries(names.map(method => [method, async (owner, wallet, input) => {
    calls.push({ method, owner, wallet, input });
    return method === 'overview'
      ? { schemaVersion: 1, domain: 'solana-lending-bot', status: 'SETUP_REQUIRED', runner: { state: 'STOPPED' } }
      : { [method]: { status: 'RECORDED', requestId: input.requestId } };
  }]));
  return { bot, calls };
}


test('funded lending rejects operator/cross-owner scope, malformed DTOs, and wrong methods before dispatch', async t => {
  const tokenA = `wsi1_${randomBytes(32).toString('base64url')}`;
  const tokenB = `wsi1_${randomBytes(32).toString('base64url')}`;
  const { bot, calls } = botWithRecorder();
  bot.reconcile = async (owner, wallet, input) => {
    calls.push({ method: 'reconcile', owner, wallet, input });
    if (owner !== OWNER_A) throw new MeshError('NOT_FOUND', 'Private retained action not found.');
    return { action: { status: 'PENDING', signature: null } };
  };
  bot.linkWallet = async () => { throw new Error('Provider rejected provider-token-private-marker'); };
  const base = await listen(t, { lendingBot: bot, sessions: new Map([
    [tokenA, session(OWNER_A, WALLET_A)],
    [tokenB, session(OWNER_B, WALLET_B)],
  ]) });

  assert.equal((await fetchJson(base, OPERATOR_TOKEN, '/v1/lending-bot')).status, 401);
  const crossOwner = await fetchJson(base, tokenB, '/v1/lending-bot/reconcile', {
    requestId: randomUUID(), actionId: '12345678-1234-4234-8234-123456789012',
  });
  assert.equal(crossOwner.status, 404);
  assert.equal(crossOwner.payload.error.code, 'NOT_FOUND');
  assert.equal(JSON.stringify(crossOwner.payload).includes('Private retained action'), false);

  const badBodies = [
    ['/v1/lending-bot/capture', { requestId: randomUUID(), owner: OWNER_B, wallet: WALLET_B }],
    ['/v1/lending-bot/capture', { requestId: 'not-a-uuid' }],
    ['/v1/lending-bot/mandate', { requestId: randomUUID(), mandate: { ...validMandate(), wallet: WALLET_A } }],
    ['/v1/lending-bot/withdraw', { requestId: randomUUID(), reserveAddress: RESERVE_A, receiptBaseUnits: 2 }],
    ['/v1/lending-bot/reconcile', { requestId: randomUUID(), actionId: 'not-a-uuid' }],
    ['/v1/lending-bot/wallet-link', { requestId: randomUUID(), accessToken: 'owner-token-private-marker' }],
    ['/v1/lending-bot/delegation/prepare', { requestId: randomUUID(), accessToken: 'owner-token-private-marker' }],
    ['/v1/lending-bot/revoke/prepare', { requestId: randomUUID(), accessToken: 'owner-token-private-marker' }],
    ['/v1/lending-bot/revoke', { requestId: randomUUID(), accessToken: 'owner-token-private-marker' }],
    ['/v1/lending-bot/accounts/quote', { requestId: randomUUID(), accessToken: 'owner-token-private-marker' }],
    ['/v1/lending-bot/accounts/prepare', { requestId: randomUUID(), quoteId: 'not-a-uuid' }],
    ['/v1/lending-bot/accounts/prepare', { requestId: randomUUID(), quoteId: randomUUID(), quote: { wallet: WALLET_B } }],
    ['/v1/lending-bot/owner-signatures', {
      requestId: randomUUID(), actionId: randomUUID(), signedTransactionBase64: Buffer.alloc(1233).toString('base64'),
    }],
  ];
  for (const [path, body] of badBodies) {
    const response = await fetchJson(base, tokenA, path, body);
    assert.equal(response.status, 400, path);
    assert.equal(response.payload.error.code, 'INVALID_INPUT');
    assert.equal(JSON.stringify(response.payload).includes('owner-token-private-marker'), false);
  }
  const oversized = await fetchJson(base, tokenA, '/v1/lending-bot/wallet-link', {
    requestId: randomUUID(), accessToken: 'x'.repeat(17 * 1024),
  });
  assert.equal(oversized.status, 413);
  assert.equal(oversized.payload.error.code, 'TOO_LARGE');
  const wrongMethod = await fetchJson(base, tokenA, '/v1/lending-bot/capture');
  assert.equal(wrongMethod.status, 404);
  const injectedWallet = await fetchJson(base, tokenA, '/v1/lending-bot/capture?wallet=other');
  assert.equal(injectedWallet.status, 400);
  const providerFailure = await fetchJson(base, tokenA, '/v1/lending-bot/wallet-link', {
    requestId: randomUUID(),
  });
  assert.equal(providerFailure.status, 503);
  assert.equal(JSON.stringify(providerFailure.payload).includes('provider-token-private-marker'), false);
  assert.equal(calls.length, 1, 'only the backend ownership check may run for rejected inputs');
});

test('funded lending GET is retained-only and service absence is explicit', async t => {
  const token = `wsi1_${randomBytes(32).toString('base64url')}`;
  const { bot, calls } = botWithRecorder();
  const base = await listen(t, { lendingBot: bot, sessions: new Map([[token, session(OWNER_A, WALLET_A)]]) });
  const root = await fetchJson(base, token, '/v1/lending-bot');
  assert.equal(root.status, 200);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].method, 'overview');
  assert.equal(calls[0].input, undefined);

  const query = await fetchJson(base, token, '/v1/lending-bot?wallet=other');
  assert.equal(query.status, 400);
  const getBody = await rawGetWithBody(base, token);
  assert.equal(getBody.status, 400);
  assert.equal(calls.length, 1, 'GET scope errors must not cause capture or other service actions');

  const absentBase = await listen(t, { lendingBot: null, sessions: new Map([[token, session(OWNER_A, WALLET_A)]]) });
  const unavailable = await fetchJson(absentBase, token, '/v1/lending-bot');
  assert.equal(unavailable.status, 503);
  assert.equal(unavailable.payload.error.code, 'STORAGE_UNAVAILABLE');
});
