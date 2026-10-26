import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { Keypair } from '@solana/web3.js';
import { createStore } from '../store.mjs';
import { createApi } from '../http.mjs';
import { deriveWalletOwnerId } from '../wallet-auth.mjs';

const url = process.env.FALCON_MESH_TEST_DATABASE_URL;

test('V206: generic analysis reads cannot expose CFO records from the shared table', { skip: !url }, async t => {
  const pool = new Pool({ connectionString: url, max: 2, connectionTimeoutMillis: 5000 });
  const wallet = Keypair.generate().publicKey.toBase58();
  const owner = deriveWalletOwnerId(wallet);
  let server;
  t.after(async () => {
    if (server?.listening) { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
    await pool.query('DELETE FROM falcon_mesh.analyses WHERE owner_id=$1', [owner]);
    await pool.end();
  });
  const privateId = randomUUID(), legacyId = randomUUID();
  const marker = 'private-signed-cfo-test-bytes';
  for (const [id, graph, analysis] of [
    [privateId, { domain: 'cfo', schemaVersion: 1 }, { recordKind: 'cfo/action/1', data: { wallet, signedData: { signature: marker } } }],
    [legacyId, { mode: 'live', revision: 'legacy-retained-revision' }, { status: 'OBSERVED' }],
  ]) {
    await pool.query(`INSERT INTO falcon_mesh.analyses
      (owner_id,id,request_id,created_at,observation_id,max_hops,graph,analysis)
      VALUES ($1,$2,$3,clock_timestamp(),$4,1,$5::jsonb,$6::jsonb)`,
    [owner, id, randomUUID(), id === privateId ? 'cfo:action' : 'observation:legacy', JSON.stringify(graph), JSON.stringify(analysis)]);
  }
  const token = randomBytes(32).toString('hex');
  const hash = createHash('sha256').update(token).digest('hex');
  server = createApi({ store: createStore(pool), tokenHashes: new Map([[hash, owner]]) });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  const base = `http://127.0.0.1:${server.address().port}`;
  const headers = { authorization: `Bearer ${token}` };
  const privateRead = await fetch(`${base}/v1/analyses/${privateId}`, { headers });
  const privateBody = await privateRead.text();
  assert.equal(privateRead.status, 404, 'a same-owner operator token must not bypass the CFO record surface');
  assert.equal(privateBody.includes(marker), false);
  const list = await fetch(base + '/v1/analyses', { headers });
  assert.equal(list.status, 200);
  const body = await list.json();
  assert.equal(JSON.stringify(body).includes(marker), false);
  assert.deepEqual(body.records.map(record => record.id), [legacyId], 'the legacy reader stays usable for its own records');
});
