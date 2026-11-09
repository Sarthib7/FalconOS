import assert from 'node:assert/strict';
import { createHash, generateKeyPairSync, randomUUID, sign } from 'node:crypto';
import test from 'node:test';
import { PublicKey } from '@solana/web3.js';
import { Pool } from 'pg';
import { createApi } from '../http.mjs';
import { createStore } from '../store.mjs';
import { createWalletAuth } from '../wallet-auth.mjs';
import { createLendingJournal } from '../cfo/lifecycle.mjs';
import { createLendingBotService } from '../cfo/lending-bot.mjs';
import { createWalletProvider } from '../cfo/wallet-provider.mjs';
import { createSolanaLendingAdapter, DEFAULT_LENDING_RESERVES } from '../cfo/solana-lending.mjs';

const databaseUrl = process.env.FALCON_MESH_TEST_DATABASE_URL;

// Real HTTP, wallet-message cryptography, provider validation and journal storage.
// Provider resource responses are controlled; no live wallet or financial call.
test('V226: a signed wallet proof binds resource ownership through HTTP without an owner credential', { skip: !databaseUrl }, async t => {
  const pool = new Pool({ connectionString: databaseUrl, max: 4, connectionTimeoutMillis: 5000 });
  const pair = generateKeyPairSync('ed25519');
  const address = new PublicKey(pair.publicKey.export({ format: 'der', type: 'spki' }).subarray(-32)).toBase58();
  const signer = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  const userId = 'did:privy:owner_proof_fixture';
  const walletId = 'owner_proof_fixture_wallet';
  const ownerId = 'owner_proof_fixture_quorum';
  const origin = 'http://localhost:4171';
  const allowedOrigins = new Set([origin]);
  const resource = { id: walletId, address, chain_type: 'solana', owner_id: ownerId, archived_at: null, additional_signers: [] };
  let quorumUsers = [userId];
  let providerReads = 0;
  let chainReads = 0;
  const provider = createWalletProvider({
    appId: 'owner_proof_fixture_app', appSecret: 'test-only-owner-proof-secret', authorizationKeyId: 'owner_proof_fixture_worker',
    authorizationPrivateKey: signer.privateKey.export({ format: 'der', type: 'pkcs8' }).toString('base64'),
    async fetchImpl(input, init) {
      const url = new URL(input);
      assert.equal(url.origin, 'https://api.privy.io');
      assert.equal(init.redirect, 'error');
      const body = init.body ? JSON.parse(init.body) : null;
      providerReads += 1;
      let result;
      if (url.pathname === '/v1/users/wallet/address') {
        assert.equal(body.address, address);
        result = { id: userId, linked_accounts: [{ type: 'wallet', id: walletId, address, chain_type: 'solana', connector_type: 'embedded', wallet_client: 'privy', wallet_client_type: 'privy', imported: false, user_can_sign: true }] };
      } else if (url.pathname === '/v1/wallets/address') {
        assert.equal(body.address, address);
        result = resource;
      } else if (url.pathname === `/v1/wallets/${walletId}`) result = resource;
      else if (url.pathname === `/v1/key_quorums/${ownerId}`) {
        result = { id: ownerId, user_ids: quorumUsers, key_quorum_ids: [], authorization_keys: [], authorization_threshold: 1 };
      } else throw new Error('Unexpected provider operation in owner-proof fixture.');
      const response = new Response(JSON.stringify(result), { headers: { 'content-type': 'application/json' } });
      Object.defineProperty(response, 'url', { value: url.href });
      return response;
    },
  });
  const adapter = createSolanaLendingAdapter({ rpcUrl: 'https://rpc.invalid', fetchImpl: async () => { chainReads += 1; throw new Error('Owner proof cannot read a chain.'); } });
  const service = createLendingBotService({
    journal: createLendingJournal(pool), adapter, walletProvider: provider, reserves: DEFAULT_LENDING_RESERVES,
    config: { executionEnabled: false, feeBps: null, feeRecipient: null, reviewGrants: [] },
  });
  const api = createApi({
    store: createStore(pool), lendingBot: service, walletAuth: createWalletAuth(pool, { allowedOrigins }), allowedOrigins,
    tokenHashes: new Map([[createHash('sha256').update('test-only-owner-proof-operator').digest('hex'), 'owner_proof_operator']]),
  });
  t.after(async () => { api.closeAllConnections(); await new Promise(resolve => api.close(resolve)); await service.close(); await pool.end(); });
  await new Promise((resolve, reject) => { api.once('error', reject); api.listen(0, '127.0.0.1', resolve); });
  const base = `http://127.0.0.1:${api.address().port}`;
  async function request(path, body, token) {
    const response = await fetch(`${base}${path}`, {
      method: 'POST', headers: { origin, 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
      body: JSON.stringify(body),
    });
    return { status: response.status, payload: await response.json() };
  }
  const challenge = await request('/v1/auth/wallet/challenge', { address });
  assert.equal(challenge.status, 200);
  const verification = await request('/v1/auth/wallet/verify', {
    challengeId: challenge.payload.challengeId,
    signature: sign(null, Buffer.from(challenge.payload.message), pair.privateKey).toString('base64'),
  });
  assert.equal(verification.status, 200);
  assert.equal(verification.payload.walletAddress, address);
  const token = verification.payload.sessionToken;
  const linked = await request('/v1/lending-bot/wallet-link', { requestId: randomUUID() }, token);
  assert.equal(linked.status, 200);
  assert.equal(linked.payload.walletLink.walletAddress, address);
  assert.equal(linked.payload.walletLink.providerWalletId, walletId);
  const owner = verification.payload.ownerId;
  const rows = () => pool.query(`SELECT analysis->'data'->'link' AS link FROM falcon_mesh.analyses WHERE owner_id=$1 AND analysis->>'recordKind'='cfo/lending-wallet/1'`, [owner]);
  assert.deepEqual((await rows()).rows.map(row => row.link), [{ providerWalletId: walletId, walletAddress: address, userId, ownerId }]);
  const beforeCredential = providerReads;
  const credential = await request('/v1/lending-bot/wallet-link', { requestId: randomUUID(), accessToken: 'owner-token-private-marker' }, token);
  assert.equal(credential.status, 400);
  assert.equal(credential.payload.error.code, 'INVALID_INPUT');
  assert.equal(JSON.stringify(credential.payload).includes('owner-token-private-marker'), false);
  assert.equal(providerReads, beforeCredential);
  quorumUsers = ['did:privy:another_customer'];
  const changedOwner = await request('/v1/lending-bot/wallet-link', { requestId: randomUUID() }, token);
  assert.equal(changedOwner.status, 503);
  assert.equal(changedOwner.payload.error.code, 'STORAGE_UNAVAILABLE');
  assert.equal((await rows()).rows.length, 1);
  assert.equal(chainReads, 0);
});
