import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createHash, generateKeyPairSync, sign } from 'node:crypto';
import test from 'node:test';
import { Pool } from 'pg';
import { PublicKey } from '@solana/web3.js';
import { createApi } from '../http.mjs';
import { createStore } from '../store.mjs';
import { createOAuthAuth, fetchClientMetadata, OAuthProtocolError } from '../oauth.mjs';
import { createWalletAuth, deriveWalletOwnerId } from '../wallet-auth.mjs';

const databaseUrl = process.env.FALCON_MESH_TEST_DATABASE_URL;
const issuer = 'https://api.falcon.test';
const resource = 'https://mcp.falcon.test/mcp';
const approvalOrigin = 'https://agents.falcon.test';
const approvalUrl = approvalOrigin + '/oauth/approve';
const clientId = 'https://client.example/metadata.json';
const redirectUri = 'https://client.example/oauth/callback';
const walletKey = generateKeyPairSync('ed25519');
const walletAddress = new PublicKey(walletKey.publicKey.export({ format: 'der', type: 'spki' }).subarray(-32)).toBase58();
const ownerId = deriveWalletOwnerId(walletAddress);
const serviceSecret = 'B'.repeat(43);
const hash = value => createHash('sha256').update(value, 'utf8').digest('hex');
const verifier = 'v'.repeat(43);
const challenge = createHash('sha256').update(verifier, 'ascii').digest('base64url');

function authorizationParams(state = 'state-value') {
  return new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: 'code',
    state,
    code_challenge: challenge,
    code_challenge_method: 'S256',
    resource,
    scope: 'falcon',
  });
}

async function postJson(url, origin, body) {
  return fetch(url, { method: 'POST', headers: { origin, 'content-type': 'application/json' }, body: JSON.stringify(body) });
}

async function postForm(url, body) {
  return fetch(url, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(body) });
}

test('V146: CIMD rejects private DNS results before fetching metadata', async () => {
  let requested = false;
  await assert.rejects(fetchClientMetadata(clientId, {
    lookupImpl: async () => [{ address: '10.20.30.40', family: 4 }],
    requestImpl: async () => { requested = true; return { redirect_uris: [redirectUri] }; },
  }), error => error instanceof OAuthProtocolError && error.code === 'invalid_client');
  assert.equal(requested, false);
});
test('V154: loopback redirect matching follows RFC 8252 port rules', async () => {
  let connections = 0;
  const pool = {
    async query() { return { rows: [], rowCount: 0 }; },
    async connect() {
      connections += 1;
      return { async query() { return { rows: [], rowCount: 0 }; }, release() {} };
    },
  };
  const allowedOrigins = new Set([approvalOrigin]);
  const walletAuth = { async createChallenge() {}, async verifyChallengeIdentity() {} };
  async function authorize(registered, requested) {
    const auth = createOAuthAuth(pool, {
      walletAuth,
      allowedOrigins,
      issuer,
      resource,
      approvalUrl,
      serviceSecret,
      clientMetadata: async id => ({ clientId: id, clientName: 'Loopback client', redirectUris: [registered] }),
    });
    const params = authorizationParams();
    params.set('redirect_uri', requested);
    return auth.beginAuthorization(params);
  }

  const registered = 'http://127.0.0.1:9876/callback?client=1';
  assert.match((await authorize(registered, 'http://127.0.0.1:1234/callback?client=1')).handle, /^far1_/);
  assert.equal(connections, 1);
  await assert.rejects(authorize(registered, 'http://127.0.0.1:1234/other?client=1'),
    error => error instanceof OAuthProtocolError && error.code === 'invalid_request');
  await assert.rejects(authorize(registered, 'http://127.0.0.1:1234/callback?client=2'),
    error => error instanceof OAuthProtocolError && error.code === 'invalid_request');
  await assert.rejects(authorize(registered, 'http://localhost:1234/callback?client=1'),
    error => error instanceof OAuthProtocolError && error.code === 'invalid_request');
  await assert.rejects(authorize('https://client.example/callback', 'https://client.example/callback?client=1'),
    error => error instanceof OAuthProtocolError && error.code === 'invalid_request');
  assert.equal(connections, 1, 'host, path, query and non-loopback mismatches fail before storage');
  assert.match((await authorize('http://127.0.0.1/callback', 'http://127.0.0.1:4321/callback')).handle, /^far1_/);
  assert.match((await authorize('http://127.0.0.1:0/callback', 'http://127.0.0.1:5555/callback')).handle, /^far1_/);
  assert.equal(connections, 3);
});
test('V146-V149,V152: OAuth approval uses a real wallet proof without creating a wallet session', {
  skip: !databaseUrl && 'FALCON_MESH_TEST_DATABASE_URL is not configured',
}, async t => {
  const pool = new Pool({ connectionString: databaseUrl, max: 4 });
  let time = Date.parse('2026-10-06T12:00:00.000Z');
  const createdHandles = [];
  const createdTokenHashes = [];
  const createdChallengeIds = [];
  const allowedOrigins = new Set([approvalOrigin]);
  const walletAuth = createWalletAuth(pool, { allowedOrigins, clock: () => time });
  const oauthAuth = createOAuthAuth(pool, {
    walletAuth,
    allowedOrigins,
    issuer,
    resource,
    approvalUrl,
    serviceSecret,
    clock: () => time,
    clientMetadata: async id => ({ clientId: id, clientName: 'Test MCP Client', redirectUris: [redirectUri] }),
  });
  const server = createApi({
    store: createStore(pool),
    walletAuth,
    oauthAuth,
    tokenHashes: new Map([[hash('mesh-test-token'), 'test_owner']]),
    allowedOrigins,
    clock: () => time,
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const base = 'http://127.0.0.1:' + server.address().port;
  t.after(async () => {
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
    for (const challengeId of createdChallengeIds) await pool.query('DELETE FROM falcon_mesh.wallet_auth_challenges WHERE challenge_id = $1', [challengeId]);
    for (const requestHash of createdHandles) await pool.query('DELETE FROM falcon_mesh.oauth_authorization_requests WHERE request_hash = $1', [requestHash]);
    for (const tokenHash of createdTokenHashes) await pool.query('DELETE FROM falcon_mesh.oauth_access_tokens WHERE token_hash = $1', [tokenHash]);
    await pool.end();
  });

  assert.equal((await fetch(base + '/readyz')).status, 200);
  const params = authorizationParams();
  const authorizeResponse = await fetch(base + '/oauth/authorize?' + params.toString(), { redirect: 'manual' });
  assert.equal(authorizeResponse.status, 302);
  assert.equal(authorizeResponse.headers.get('cache-control'), 'no-store');
  const approval = new URL(authorizeResponse.headers.get('location'));
  assert.equal(approval.href.startsWith(approvalUrl + '#'), true);
  const handle = new URLSearchParams(approval.hash.slice(1)).get('request');
  assert.match(handle, /^far1_[A-Za-z0-9_-]{43}$/);
  createdHandles.push(hash(handle));

  const deniedOrigin = await postJson(base + '/v1/oauth/approval/context', 'https://evil.example', { request: handle });
  assert.equal(deniedOrigin.status, 403);
  const contextResponse = await postJson(base + '/v1/oauth/approval/context', approvalOrigin, { request: handle });
  assert.equal(contextResponse.status, 200);
  const context = await contextResponse.json();
  assert.deepEqual(context, {
    clientName: 'Test MCP Client',
    redirectHost: 'client.example',
    resource,
    scope: 'falcon',
    expiresAt: new Date(time + 300_000).toISOString(),
  });

  const challengeResponse = await postJson(base + '/v1/oauth/approval/challenge', approvalOrigin, { request: handle, address: walletAddress });
  assert.equal(challengeResponse.status, 200);
  const walletChallenge = await challengeResponse.json();
  createdChallengeIds.push(walletChallenge.challengeId);
  assert.match(walletChallenge.challengeId, /^[0-9a-f-]{36}$/i);
  assert.match(walletChallenge.message, /will not trigger a blockchain transaction or spend any fees/i);
  const signature = sign(null, Buffer.from(walletChallenge.message, 'utf8'), walletKey.privateKey).toString('base64');
  const approvalResponse = await postJson(base + '/v1/oauth/approval/approve', approvalOrigin, {
    request: handle,
    challengeId: walletChallenge.challengeId,
    signature,
  });
  assert.equal(approvalResponse.status, 200);
  const walletSessions = await pool.query('SELECT token_hash FROM falcon_mesh.wallet_auth_sessions WHERE wallet_address = $1', [walletAddress]);
  assert.equal(walletSessions.rowCount, 0);
  const callback = new URL((await approvalResponse.json()).redirectUrl);
  const code = callback.searchParams.get('code');
  assert.match(code, /^fac1_[A-Za-z0-9_-]{43}$/);
  assert.equal(callback.searchParams.get('state'), 'state-value');
  assert.equal(callback.searchParams.get('iss'), issuer);
  const codeHash = hash(code);
  const storedCode = await pool.query('SELECT code_hash FROM falcon_mesh.oauth_authorization_codes WHERE code_hash = $1', [codeHash]);
  assert.equal(storedCode.rowCount, 1);
  assert.equal(storedCode.rows[0].code_hash, codeHash);

  const tokenRequest = {
    grant_type: 'authorization_code',
    code,
    client_id: clientId,
    redirect_uri: redirectUri,
    code_verifier: verifier,
    resource,
  };
  const wrongVerifier = await postForm(base + '/oauth/token', { ...tokenRequest, code_verifier: 'x'.repeat(43) });
  assert.equal(wrongVerifier.status, 400);
  assert.equal((await wrongVerifier.json()).error, 'invalid_grant');
  const tokenResponse = await postForm(base + '/oauth/token', tokenRequest);
  assert.equal(tokenResponse.status, 200);
  const tokenPayload = await tokenResponse.json();
  assert.equal(tokenPayload.token_type, 'Bearer');
  assert.equal(tokenPayload.expires_in, 1800);
  const accessToken = tokenPayload.access_token;
  assert.match(accessToken, /^fao1_[A-Za-z0-9_-]{43}$/);
  const tokenHash = hash(accessToken);
  createdTokenHashes.push(tokenHash);
  const storedToken = await pool.query('SELECT token_hash, owner_id, wallet_address, resource FROM falcon_mesh.oauth_access_tokens WHERE token_hash = $1', [tokenHash]);
  assert.equal(storedToken.rowCount, 1);
  assert.deepEqual(storedToken.rows[0], { token_hash: tokenHash, owner_id: ownerId, wallet_address: walletAddress, resource });

  const missingServiceSecret = await fetch(base + '/v1/oauth/introspect', { method: 'POST', headers: { authorization: 'Bearer ' + accessToken } });
  assert.equal(missingServiceSecret.status, 401);
  const introspectionResponse = await fetch(base + '/v1/oauth/introspect', {
    method: 'POST',
    headers: { authorization: 'Bearer ' + accessToken, 'x-falcon-mcp-service-token': serviceSecret },
  });
  assert.equal(introspectionResponse.status, 200);
  const introspection = await introspectionResponse.json();
  assert.equal(introspection.active, true);
  assert.equal(introspection.resource, resource);
  assert.equal(introspection.ownerId, ownerId);
  assert.equal(introspection.walletAddress, walletAddress);

  const replay = await postForm(base + '/oauth/token', tokenRequest);
  assert.equal(replay.status, 400);
  assert.equal((await replay.json()).error, 'invalid_grant');
  const revoke = await postForm(base + '/oauth/revoke', { token: accessToken, token_type_hint: 'access_token' });
  assert.equal(revoke.status, 200);
  const revoked = await oauthAuth.introspect(accessToken);
  assert.equal(revoked.active, false);

  const denyParams = authorizationParams('deny-state');
  const secondAuthorize = await fetch(base + '/oauth/authorize?' + denyParams.toString(), { redirect: 'manual' });
  assert.equal(secondAuthorize.status, 302);
  const secondApproval = new URL(secondAuthorize.headers.get('location'));
  const secondHandle = new URLSearchParams(secondApproval.hash.slice(1)).get('request');
  createdHandles.push(hash(secondHandle));
  const denyResponse = await postJson(base + '/v1/oauth/approval/deny', approvalOrigin, { request: secondHandle });
  assert.equal(denyResponse.status, 200);
  const deniedCallback = new URL((await denyResponse.json()).redirectUrl);
  assert.equal(deniedCallback.searchParams.get('error'), 'access_denied');
  assert.equal(deniedCallback.searchParams.get('state'), 'deny-state');
  assert.equal(deniedCallback.searchParams.has('code'), false);
});
