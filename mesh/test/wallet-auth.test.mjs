import assert from 'node:assert/strict';
import { createHash, generateKeyPairSync, sign } from 'node:crypto';
import test from 'node:test';
import { Pool } from 'pg';
import { PublicKey } from '@solana/web3.js';
import { createApi, parseTokenHashes } from '../http.mjs';
import { createStore } from '../store.mjs';
import { createWalletAuth } from '../wallet-auth.mjs';

const databaseUrl = process.env.FALCON_MESH_TEST_DATABASE_URL;
const origin = 'https://falcon.example';
const otherOrigin = 'https://other.example';
const digest = value => createHash('sha256').update(value).digest('hex');
const SUPABASE_USER = '123e4567-e89b-42d3-a456-426614174000';
const STATIC_TOKEN = 'mesh-static-test-token-that-is-long-enough';
const SUPABASE_TOKEN = 'legacy-supabase-test-token-that-is-long-enough';

function addressFor(pair) {
  const der = pair.publicKey.export({ format: 'der', type: 'spki' });
  return new PublicKey(der.subarray(-32)).toBase58();
}

function signMessage(pair, message) {
  return sign(null, Buffer.from(message, 'utf8'), pair.privateKey).toString('base64');
}

test('V143-V144: wallet challenge is origin-bound, one-time, and authorizes yield only after verification', {
  skip: !databaseUrl && 'FALCON_MESH_TEST_DATABASE_URL is not configured',
}, async t => {
  const pool = new Pool({ connectionString: databaseUrl, max: 4 });
  let time = Date.parse('2026-10-04T12:00:00.000Z');
  const allowedOrigins = new Set([origin, otherOrigin]);
  const walletAuth = createWalletAuth(pool, { allowedOrigins, clock: () => time });
  const createdChallenges = [];
  const createdSessions = [];
  const server = createApi({
    store: createStore(pool),
    yieldService: { async getOpportunities() { return { status: 'READY', opportunities: [] }; } },
    walletAuth,
    tokenHashes: parseTokenHashes(JSON.stringify({ [digest(STATIC_TOKEN)]: 'static_owner' })),
    allowedOrigins,
    verifySupabaseToken: async token => token === SUPABASE_TOKEN ? SUPABASE_USER : null,
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  t.after(async () => {
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
    for (const challengeId of createdChallenges) {
      await pool.query('DELETE FROM falcon_mesh.wallet_auth_challenges WHERE challenge_id = $1', [challengeId]);
    }
    for (const tokenHash of createdSessions) {
      await pool.query('DELETE FROM falcon_mesh.wallet_auth_sessions WHERE token_hash = $1', [tokenHash]);
    }
    await pool.end();
  });

  await walletAuth.ready();
  assert.equal((await fetch(`${base}/readyz`)).status, 200);

  const first = generateKeyPairSync('ed25519');
  const firstAddress = addressFor(first);
  const noOrigin = await fetch(`${base}/v1/auth/wallet/challenge`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ address: firstAddress }),
  });
  assert.equal(noOrigin.status, 403);

  const challengeResponse = await fetch(`${base}/v1/auth/wallet/challenge`, {
    method: 'POST', headers: { origin, 'content-type': 'application/json' },
    body: JSON.stringify({ address: firstAddress, ownerId: 'forged_owner' }),
  });
  assert.equal(challengeResponse.status, 400);
  const issuedResponse = await fetch(`${base}/v1/auth/wallet/challenge`, {
    method: 'POST', headers: { origin, 'content-type': 'application/json' },
    body: JSON.stringify({ address: firstAddress }),
  });
  assert.equal(issuedResponse.status, 200);
  const challenge = await issuedResponse.json();
  createdChallenges.push(challenge.challengeId);
  assert.match(challenge.challengeId, /^[0-9a-f-]{36}$/i);
  assert.match(challenge.message, /Expiration Time:/);
  assert.match(challenge.message, /will not trigger a blockchain transaction or spend any fees/i);
  assert.equal(Date.parse(challenge.expiresAt), time + 5 * 60_000);

  const firstSignature = signMessage(first, challenge.message);
  const wrongOrigin = await fetch(`${base}/v1/auth/wallet/verify`, {
    method: 'POST', headers: { origin: otherOrigin, 'content-type': 'application/json' },
    body: JSON.stringify({ challengeId: challenge.challengeId, signature: firstSignature }),
  });
  assert.equal(wrongOrigin.status, 401);

  const second = generateKeyPairSync('ed25519');
  const invalidSignature = await fetch(`${base}/v1/auth/wallet/verify`, {
    method: 'POST', headers: { origin, 'content-type': 'application/json' },
    body: JSON.stringify({ challengeId: challenge.challengeId, signature: signMessage(second, challenge.message) }),
  });
  assert.equal(invalidSignature.status, 401);

  const forgedOwner = await fetch(`${base}/v1/auth/wallet/verify`, {
    method: 'POST', headers: { origin, 'content-type': 'application/json' },
    body: JSON.stringify({ challengeId: challenge.challengeId, signature: firstSignature, ownerId: 'forged_owner' }),
  });
  assert.equal(forgedOwner.status, 400);

  const verifyResponse = await fetch(`${base}/v1/auth/wallet/verify`, {
    method: 'POST', headers: { origin, 'content-type': 'application/json' },
    body: JSON.stringify({ challengeId: challenge.challengeId, signature: firstSignature }),
  });
  assert.equal(verifyResponse.status, 200);
  const session = await verifyResponse.json();
  createdSessions.push(digest(session.sessionToken));
  assert.equal(session.walletAddress, firstAddress);
  assert.match(session.ownerId, /^wallet_[a-f0-9]{56}$/);
  assert.equal(Date.parse(session.expiresAt), time + 30 * 60_000);

  const persisted = await pool.query('SELECT token_hash FROM falcon_mesh.wallet_auth_sessions WHERE token_hash = $1', [digest(session.sessionToken)]);
  assert.equal(persisted.rowCount, 1);
  assert.notEqual(persisted.rows[0].token_hash, session.sessionToken);
  const identityResponse = await fetch(`${base}/v1/auth/wallet/session`, {
    headers: { origin, authorization: `Bearer ${session.sessionToken}` },
  });
  assert.deepEqual(await identityResponse.json(), {
    walletAddress: firstAddress, ownerId: session.ownerId, expiresAt: session.expiresAt,
  });
  assert.equal((await fetch(`${base}/v1/yield/opportunities`, {
    headers: { origin, authorization: `Bearer ${session.sessionToken}` },
  })).status, 200);

  const replay = await fetch(`${base}/v1/auth/wallet/verify`, {
    method: 'POST', headers: { origin, 'content-type': 'application/json' },
    body: JSON.stringify({ challengeId: challenge.challengeId, signature: firstSignature }),
  });
  assert.equal(replay.status, 401);

  const secondChallengeResponse = await fetch(`${base}/v1/auth/wallet/challenge`, {
    method: 'POST', headers: { origin, 'content-type': 'application/json' },
    body: JSON.stringify({ address: addressFor(second) }),
  });
  assert.equal(secondChallengeResponse.status, 200);
  const secondChallenge = await secondChallengeResponse.json();
  createdChallenges.push(secondChallenge.challengeId);
  const secondVerifyResponse = await fetch(`${base}/v1/auth/wallet/verify`, {
    method: 'POST', headers: { origin, 'content-type': 'application/json' },
    body: JSON.stringify({ challengeId: secondChallenge.challengeId, signature: signMessage(second, secondChallenge.message) }),
  });
  assert.equal(secondVerifyResponse.status, 200);
  const secondSession = await secondVerifyResponse.json();
  createdSessions.push(digest(secondSession.sessionToken));
  assert.notEqual(secondSession.ownerId, session.ownerId);
  const secondIdentity = await fetch(`${base}/v1/auth/wallet/session`, {
    headers: { origin, authorization: `Bearer ${secondSession.sessionToken}` },
  });
  assert.equal((await secondIdentity.json()).ownerId, secondSession.ownerId);

  const expiringPair = generateKeyPairSync('ed25519');
  const expiringChallengeResponse = await fetch(`${base}/v1/auth/wallet/challenge`, {
    method: 'POST', headers: { origin, 'content-type': 'application/json' },
    body: JSON.stringify({ address: addressFor(expiringPair) }),
  });
  const expiringChallenge = await expiringChallengeResponse.json();
  createdChallenges.push(expiringChallenge.challengeId);
  const expiredSignature = signMessage(expiringPair, expiringChallenge.message);
  time = Date.parse(expiringChallenge.expiresAt);
  assert.equal((await fetch(`${base}/v1/auth/wallet/verify`, {
    method: 'POST', headers: { origin, 'content-type': 'application/json' },
    body: JSON.stringify({ challengeId: expiringChallenge.challengeId, signature: expiredSignature }),
  })).status, 401);
  time -= 1;

  assert.equal((await fetch(`${base}/v1/yield/opportunities`, {
    headers: { origin, authorization: `Bearer ${STATIC_TOKEN}` },
  })).status, 200);
  assert.equal((await fetch(`${base}/v1/yield/opportunities`, {
    headers: { origin, authorization: `Bearer ${SUPABASE_TOKEN}` },
  })).status, 200);

  const logout = await fetch(`${base}/v1/auth/wallet/logout`, {
    method: 'POST', headers: { origin, authorization: `Bearer ${session.sessionToken}`, 'content-type': 'application/json' }, body: '{}',
  });
  assert.deepEqual(await logout.json(), { revoked: true });
  assert.equal((await fetch(`${base}/v1/auth/wallet/session`, {
    headers: { origin, authorization: `Bearer ${session.sessionToken}` },
  })).status, 401);
  assert.equal((await fetch(`${base}/v1/yield/opportunities`, {
    headers: { origin, authorization: `Bearer ${session.sessionToken}` },
  })).status, 401);
});
