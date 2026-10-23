import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { createServer as createNetServer } from 'node:net';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { Pool } from 'pg';
import { canonicalBytes, sha256 } from '../council/evidence.ts';

const databaseUrl = process.env.FALCON_MESH_TEST_DATABASE_URL;
const serverPath = fileURLToPath(new URL('../server.mjs', import.meta.url));
const meshDirectory = fileURLToPath(new URL('../', import.meta.url));

async function freePort() {
  const server = createNetServer();
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const port = server.address().port;
  await new Promise(resolve => server.close(resolve));
  return port;
}

async function seedAdoption(pool, owner, analysisId, requestId) {
  const sourceRefs = [{ revisionId: randomUUID(), sha256: 'a'.repeat(64) }];
  const modelResult = {
    modelVersion: 'near-observed/1',
    status: 'OBSERVED',
    seriesSummaries: {},
    unknowns: [],
    counterCase: ['Publisher activity does not establish native-token demand.'],
    investmentAssessment: { status: 'NO_DATA', reasons: ['Native-token demand is unverified.'], proposal: null },
    executionReady: false,
  };
  const snapshot = {
    schemaVersion: 1,
    domain: 'near-thesis',
    adapterVersion: 'near-revenue/1',
    sourceUrl: 'https://revenue.near.org/',
    capturedAt: '2026-10-21T14:00:00.000Z',
    rawBodySha256: 'b'.repeat(64),
    rawBodyBytes: 1024,
    sourceRefs,
    modelVersion: 'near-observed/1',
    modelResult,
  };
  const snapshotHash = sha256(canonicalBytes(snapshot));
  const graph = {
    schemaVersion: 1,
    domain: 'near-thesis',
    caseType: 'near-thesis',
    publicCaseId: randomUUID(),
    snapshotHash,
    snapshot,
    sourceRefs,
    executionReady: false,
  };
  const analysis = {
    recordKind: 'near-research/adopted/1',
    status: 'OBSERVED',
    publicCaseId: graph.publicCaseId,
    snapshotHash,
    snapshot,
    modelResult,
    sourceRefs,
    issues: [],
    evidenceSource: 'public',
    executionReady: false,
  };
  await pool.query(
    'INSERT INTO falcon_mesh.analyses (owner_id, id, request_id, created_at, observation_id, max_hops, graph, analysis) VALUES ($1, $2, $3, $4, $5, 1, $6::jsonb, $7::jsonb)',
    [owner, analysisId, requestId, new Date().toISOString(), 'research:near:' + graph.publicCaseId, JSON.stringify(graph), JSON.stringify(analysis)],
  );
}

test('the composed server denies new review jobs by default before creating a claim', {
  skip: !databaseUrl && 'Set FALCON_MESH_TEST_DATABASE_URL to the initialized disposable mesh database.',
}, async t => {
  const pool = new Pool({ connectionString: databaseUrl, max: 2, connectionTimeoutMillis: 5000 });
  const owner = 'review_server_' + randomUUID().replaceAll('-', '');
  const analysisId = randomUUID();
  const adoptionRequestId = randomUUID();
  const requestId = randomUUID();
  await seedAdoption(pool, owner, analysisId, adoptionRequestId);

  const token = 'test-only-review-server-token-' + randomUUID();
  const tokenHash = createHash('sha256').update(token).digest('hex');
  const port = await freePort();
  const env = { ...process.env };
  delete env.FALCON_MESH_RESEARCH_REVIEW_OWNERS;
  delete env.FALCON_MESH_COUNCIL_BUN;
  Object.assign(env, {
    DATABASE_URL: databaseUrl,
    FALCON_MESH_HOST: '127.0.0.1',
    FALCON_MESH_ORIGINS: '',
    FALCON_MESH_TOKEN_HASHES: JSON.stringify({ [tokenHash]: owner }),
    PORT: String(port),
  });

  const child = spawn(process.execPath, [serverPath], { cwd: meshDirectory, env, stdio: ['ignore', 'pipe', 'pipe'] });
  let stdout = '';
  let stderr = '';
  child.stdout.setEncoding('utf8').on('data', chunk => { stdout += chunk; });
  child.stderr.setEncoding('utf8').on('data', chunk => { stderr += chunk; });
  t.after(async () => {
    if (child.exitCode === null && child.signalCode === null) {
      const closed = new Promise(resolve => child.once('close', resolve));
      const killTimer = setTimeout(() => child.kill('SIGKILL'), 5000);
      child.kill('SIGTERM');
      await closed.finally(() => clearTimeout(killTimer));
    }
    await pool.end();
  });

  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Mesh server did not start: ' + stderr)), 10_000);
    child.once('error', error => { clearTimeout(timer); reject(error); });
    child.once('close', code => {
      clearTimeout(timer);
      reject(new Error(`Mesh server exited before listening (${code}): ${stderr}`));
    });
    const check = () => {
      if (stdout.includes('Falcon mesh listening on port ' + port + '.')) {
        clearTimeout(timer);
        resolve();
      }
    };
    child.stdout.on('data', check);
    check();
  });

  const response = await fetch(`http://127.0.0.1:${port}/v1/research/near/review`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ requestId, analysisId }),
    signal: AbortSignal.timeout(10_000),
  });
  const body = await response.json();
  assert.equal(response.status, 403);
  assert.equal(body.error.code, 'FORBIDDEN');
  const claim = await pool.query(
    "SELECT count(*)::int AS count FROM falcon_mesh.analyses WHERE owner_id = $1 AND request_id = $2 AND analysis->>'recordKind' = 'near-research/review/claim/1'",
    [owner, requestId],
  );
  assert.equal(claim.rows[0].count, 0);
});

test('malformed review-owner configuration prevents server startup', async () => {
  const child = spawn(process.execPath, [serverPath], {
    cwd: meshDirectory,
    env: { ...process.env, FALCON_MESH_RESEARCH_REVIEW_OWNERS: '{invalid json' },
    stdio: ['ignore', 'ignore', 'pipe'],
  });
  let stderr = '';
  child.stderr.setEncoding('utf8').on('data', chunk => { stderr += chunk; });
  const [code] = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => child.kill('SIGKILL'), 10_000);
    child.once('error', error => { clearTimeout(timer); reject(error); });
    child.once('close', (...result) => { clearTimeout(timer); resolve(result); });
  });
  assert.notEqual(code, 0);
  assert.match(stderr, /FALCON_MESH_RESEARCH_REVIEW_OWNERS/);
});
