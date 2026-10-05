import test from 'node:test';
import assert from 'node:assert/strict';
import { restoreWalletSession, WALLET_SESSION_KEY } from '../bot/auth.mjs';

const token = `wsi1_${'A'.repeat(43)}`;
function sessionStorageFor() {
  const values = new Map([[WALLET_SESSION_KEY, token]]);
  return {
    getItem: key => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
    removeItem: key => values.delete(key),
  };
}

test('Mesh tab preserves the bot wallet session after a transient service failure', async () => {
  const storage = sessionStorageFor();
  await assert.rejects(restoreWalletSession({
    storage,
    request: async () => { throw new Error('The mesh service did not respond.'); },
  }), /did not respond/);
  assert.equal(storage.getItem(WALLET_SESSION_KEY), token);
});
