import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtemp, mkdir, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

// CI mounts this script and the existing fixture beside each other in a fresh image.
// The fixture supplies no provider credential or model response. Native preflight
// must stop in the real SDK serializer before any Codex request is dispatched.
const casePath = process.argv[2];
const brokerPath = process.argv[3];
if (!casePath || !brokerPath) throw new Error('Provide the retained-case and local broker fixture paths.');
const { startFixtureBroker } = await import(pathToFileURL(brokerPath).href);
const root = process.env.FALCON_COUNCIL_IMAGE_ROOT || '/app';
const { runCouncilReview, COUNCIL_LIMITS } = await import(pathToFileURL(join(root, 'council/host.mjs')).href);
const { createOmpTransport } = await import(pathToFileURL(join(root, 'council/omp-host.mjs')).href);
const caseFile = await stat(casePath);
assert.ok(caseFile.size <= COUNCIL_LIMITS.ipcInputBytes, 'image-smoke input exceeds its fixture bound');
const retained = JSON.parse(await readFile(casePath, 'utf8'));

let auditRequest;
let roleCalls = 0;
const captured = await runCouncilReview({
  runId: randomUUID(),
  snapshotHash: retained.snapshotHash,
  snapshot: retained.snapshot,
  modelResult: retained.modelResult,
  sourceRefs: retained.sourceRefs,
  transport: {
    async preflight(options) {
      auditRequest = options.auditRequest;
      throw new Error('Capture-only seam; the real transport is called below.');
    },
    async call() {
      roleCalls += 1;
      throw new Error('Image smoke cannot authorize a model role.');
    },
  },
});
assert.equal(captured.status, 'NO_DATA');
assert.equal(roleCalls, 0);
assert.equal(auditRequest?.role, 'lead', 'the actual controller did not produce its frozen Lead packet');
assert.equal(Object.isFrozen(auditRequest), true);

const home = await mkdtemp(join(tmpdir(), 'falcon-council-image-'));
const agentDir = join(home, 'agent');
await mkdir(agentDir);
const broker = await startFixtureBroker();
const saved = new Map();
const settings = {
  HOME: home,
  TMPDIR: home,
  TMP: home,
  TEMP: home,
  PI_CONFIG_DIR: 'council-image-smoke',
  PI_CODING_AGENT_DIR: agentDir,
  OMP_AUTH_BROKER_URL: broker.url,
  OMP_AUTH_BROKER_TOKEN: broker.token,
  OMP_AUTH_BROKER_SNAPSHOT_TTL_MS: '0',
};
for (const [name, value] of Object.entries(settings)) {
  saved.set(name, process.env[name]);
  process.env[name] = value;
}
const transport = createOmpTransport();
try {
  const proof = await transport.preflight({
    auditRequest,
    budgetMs: COUNCIL_LIMITS.preflightMs,
  });
  assert.equal(proof.status, 'VERIFIED', 'packaged native preflight did not verify; arbitrary NO_DATA is not a successful image smoke');
  assert.equal(proof.sdkVersion, '18.12.5');
  assert.equal(proof.provider, 'openai-codex');
  assert.equal(proof.modelId, 'gpt-6-luna');
  assert.equal(proof.effort, 'max');
  assert.equal(proof.endpoint, 'https://chatgpt.com/backend-api/codex/responses');
  assert.equal(proof.transportMode, 'sse-only');
  assert.equal(proof.bodyAudit, 'PASS');
  assert.equal(proof.payloadObservationCount, 1);
  assert.equal(proof.fetchFenceCallCount, 0);
  assert.equal(proof.providerDispatchCount, 0);
  assert.deepEqual(proof.reasons, []);
  assert.ok(broker.observedPaths.includes('/v1/snapshot'));
  console.log(JSON.stringify({
    check: 'council-packaged-native-preflight',
    surface: process.env.FALCON_COUNCIL_SMOKE_SURFACE || 'container',
    status: 'PASS',
    sdkVersion: proof.sdkVersion,
    bodyAudit: proof.bodyAudit,
    payloadObservationCount: proof.payloadObservationCount,
    providerDispatchCount: proof.providerDispatchCount,
    modelRoleCalls: roleCalls,
    limitation: 'Local broker fixture and real SDK body serialization only. No live account, provider response, entitlement or billing proof.',
  }));
} finally {
  await transport.close();
  await broker.close();
  for (const [name, value] of saved) {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
  await rm(home, { recursive: true, force: true });
}
