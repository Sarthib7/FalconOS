import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { Keypair } from '@solana/web3.js';
import { Pool } from 'pg';
import { createApi } from '../http.mjs';
import { createStore } from '../store.mjs';
import { createWalletAuth, deriveWalletOwnerId } from '../wallet-auth.mjs';
import { createCfoStore } from '../cfo/store.mjs';
import { createCfoService } from '../cfo/service.mjs';
import { createIntentsAdapter } from '../cfo/intents.mjs';

const databaseUrl = process.env.FALCON_MESH_TEST_DATABASE_URL;
const digest = value => createHash('sha256').update(value).digest('hex');

test('V197: CFO requires real wallet identity and isolates populated retained records', { skip: !databaseUrl }, async t => {
  const pool = new Pool({ connectionString: databaseUrl, max: 4, connectionTimeoutMillis: 5000 });
  const origin = 'http://127.0.0.1:4183';
  const allowedOrigins = new Set([origin]);
  const walletAuth = createWalletAuth(pool, { allowedOrigins });
  const store = createStore(pool);
  const cfoStore = createCfoStore(pool);
  const cfo = createCfoService({ store: cfoStore, adapter: createIntentsAdapter({ enabled: false }) });
  const operator = randomBytes(32).toString('hex');
  const wallets = [Keypair.generate(), Keypair.generate()];
  const credentials = [];
  for (const key of wallets) {
    const address = key.publicKey.toBase58();
    const token = 'wsi1_' + randomBytes(32).toString('base64url');
    await pool.query(`INSERT INTO falcon_mesh.wallet_auth_sessions
      (token_hash,wallet_address,owner_id,created_at,expires_at)
      VALUES ($1,$2,$3,clock_timestamp(),clock_timestamp()+interval '20 minutes')`,
    [digest(token), address, deriveWalletOwnerId(address)]);
    credentials.push(token);
  }
  const address = wallets[0].publicKey.toBase58();
  const owner = deriveWalletOwnerId(address);
  const { record: retained } = await cfoStore.append(owner, { requestId: randomUUID(), kind: 'portfolio', data: {
    schemaVersion: 1, chain: 'near', network: 'mainnet', wallet: address,
    signerId: Buffer.from(wallets[0].publicKey.toBytes()).toString('hex'),
    capturedAt: new Date().toISOString(), blockHash: null, blockHeight: null,
    assets: [], balances: [], status: 'NO_DATA', reasons: ['Test-owned unavailable source record.'],
  } });
  const api = createApi({ store, walletAuth, cfo, allowedOrigins,
    tokenHashes: new Map([[digest(operator), owner]]) });
  await new Promise((resolve, reject) => { api.once('error', reject); api.listen(0, '127.0.0.1', resolve); });
  t.after(async () => {
    await cfo.close(); api.closeAllConnections(); await new Promise(resolve => api.close(resolve));
    await pool.query('DELETE FROM falcon_mesh.wallet_auth_sessions WHERE token_hash=ANY($1::text[])', [credentials.map(digest)]);
    await pool.query('DELETE FROM falcon_mesh.analyses WHERE owner_id=ANY($1::text[])', [wallets.map(key => deriveWalletOwnerId(key.publicKey.toBase58()))]);
    await pool.end();
  });
  const base = `http://127.0.0.1:${api.address().port}`;
  async function request(path, credential, body) {
    const response = await fetch(base + path, { method: body === undefined ? 'GET' : 'POST',
      headers: { origin, authorization: `Bearer ${credential}`, ...(body === undefined ? {} : { 'content-type': 'application/json' }) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    return { status: response.status, payload: await response.json() };
  }
  const own = await request('/v1/cfo/records/' + retained.id, credentials[0]);
  assert.equal(own.status, 200);
  assert.equal(own.payload.record.data.wallet, address);
  const foreign = await request('/v1/cfo/records/' + retained.id, credentials[1]);
  assert.equal(foreign.status, 404);
  assert.equal(JSON.stringify(foreign.payload).includes(address), false);
  const operatorRead = await request('/v1/cfo/records/' + retained.id, operator);
  assert.equal(operatorRead.status, 401, 'a static token mapped to the same owner still cannot replace a wallet session');
  const injectedOwner = await request('/v1/cfo/capture', credentials[0], { requestId: randomUUID(), owner });
  assert.equal(injectedOwner.status, 400);
  const mismatchedWallet = await request('/v1/cfo/mandate', credentials[0], { requestId: randomUUID(), mandate: { wallet: wallets[1].publicKey.toBase58() } });
  assert.equal(mismatchedWallet.status, 401);
  await walletAuth.revokeSession(credentials[0]);
  const revoked = await request('/v1/cfo', credentials[0]);
  assert.equal(revoked.status, 401);
});
