import assert from 'node:assert/strict';
import test from 'node:test';
import {
  WALLET_SESSION_KEY,
  createWalletSession,
  restoreWalletSession,
  revokeWalletSession,
} from '../bot/auth.mjs';

const ADDRESS = '11111111111111111111111111111111';
const OWNER = 'wallet_' + 'a'.repeat(56);
const TOKEN = 'wsi1_' + 'A'.repeat(43);
const CHALLENGE_ID = '10000000-0000-4000-8000-000000000001';
const future = minutes => new Date(Date.now() + minutes * 60_000).toISOString();

function storageFor() {
  const values = new Map();
  return {
    values,
    getItem: key => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
    removeItem: key => values.delete(key),
  };
}

function identity(overrides = {}) {
  return { walletAddress: ADDRESS, ownerId: OWNER, expiresAt: future(20), ...overrides };
}

test('V143-V144: wallet sign-in signs the server challenge and stores only the verified session token', async () => {
  const storage = storageFor();
  const message = 'bot.example wants you to sign in. This is not a transaction and spends no fees.';
  const signature = Uint8Array.from({ length: 64 }, (_, index) => index);
  const signed = [];
  const calls = [];
  const request = async (token, path, body) => {
    calls.push({ token, path, body });
    if (path === '/v1/auth/wallet/challenge') return { challengeId: CHALLENGE_ID, message, expiresAt: future(4) };
    if (path === '/v1/auth/wallet/verify') return { sessionToken: TOKEN, ...identity() };
    throw new Error('Unexpected wallet-auth request.');
  };
  const walletSession = {
    current: () => ({ address: ADDRESS }),
    signMessage: async bytes => { signed.push(new TextDecoder().decode(bytes)); return signature; },
  };

  const session = await createWalletSession(walletSession, { storage, request });

  assert.deepEqual(signed, [message]);
  assert.equal(session.walletAddress, ADDRESS);
  assert.equal(session.ownerId, OWNER);
  assert.equal(session.token, TOKEN);
  assert.deepEqual([...storage.values], [[WALLET_SESSION_KEY, TOKEN]]);
  assert.equal(calls[0].path, '/v1/auth/wallet/challenge');
  assert.deepEqual(calls[0].body, { address: ADDRESS });
  assert.deepEqual(calls[1].body, {
    challengeId: CHALLENGE_ID,
    signature: Buffer.from(signature).toString('base64'),
  });
});

test('V144: wallet sign-in rejects a server identity that does not match the signed wallet', async () => {
  const storage = storageFor();
  const request = async (_token, path) => path === '/v1/auth/wallet/challenge'
    ? { challengeId: CHALLENGE_ID, message: 'Sign in.', expiresAt: future(4) }
    : { sessionToken: TOKEN, ...identity({ walletAddress: 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA' }) };
  const walletSession = { current: () => ({ address: ADDRESS }), signMessage: async () => new Uint8Array(64) };

  await assert.rejects(createWalletSession(walletSession, { storage, request }), /does not match the account that signed/);
  assert.equal(storage.getItem(WALLET_SESSION_KEY), null);
});

test('V144: restoration trusts the server identity and rejects malformed stored credentials locally', async () => {
  const storage = storageFor();
  storage.setItem(WALLET_SESSION_KEY, TOKEN);
  let calls = 0;
  const request = async (token, path) => {
    calls += 1;
    assert.equal(token, TOKEN);
    assert.equal(path, '/v1/auth/wallet/session');
    return identity();
  };
  const session = await restoreWalletSession({ storage, request });
  assert.equal(session.ownerId, OWNER);
  assert.equal(session.walletAddress, ADDRESS);

  storage.setItem(WALLET_SESSION_KEY, 'wsi1_invalid');
  assert.equal(await restoreWalletSession({ storage, request }), null);
  assert.equal(storage.getItem(WALLET_SESSION_KEY), null);
  assert.equal(calls, 1);
});

test('V144: logout clears local state only after the server revokes the session', async () => {
  const storage = storageFor();
  storage.setItem(WALLET_SESSION_KEY, TOKEN);
  await assert.rejects(revokeWalletSession({ token: TOKEN }, {
    storage,
    request: async () => ({ revoked: false }),
  }), /not revoked/);
  assert.equal(storage.getItem(WALLET_SESSION_KEY), TOKEN);

  await revokeWalletSession({ token: TOKEN }, {
    storage,
    request: async (token, path, body) => {
      assert.equal(token, TOKEN);
      assert.equal(path, '/v1/auth/wallet/logout');
      assert.deepEqual(body, {});
      return { revoked: true };
    },
  });
  assert.equal(storage.getItem(WALLET_SESSION_KEY), null);
});
