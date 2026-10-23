import test from "node:test";
import assert from "node:assert/strict";
import { access, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, isAbsolute, join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import {
  COUNCIL_LIMITS,
  COUNCIL_MODEL,
  COUNCIL_POLICY_VERSION,
  COUNCIL_REASONING_EFFORT,
} from "../council/host.mjs";
import { createOmpTransport } from "../council/omp-host.mjs";

const FIXTURE_BUN = fileURLToPath(new URL("./fixtures/omp-worker-fixture.mjs", import.meta.url));
const PREFLIGHT_KEYS = [
  "schemaVersion", "policyVersion", "status", "checkedAt", "sdkVersion", "provider", "modelId", "api",
  "effort", "endpoint", "transportMode", "bodyAudit", "payloadObservationCount", "fetchFenceCallCount",
  "providerDispatchCount", "reasons",
];

function fixtureRequest(fixtureMode, overrides = {}) {
  return {
    schemaVersion: 1,
    role: "lead",
    runId: "11111111-1111-4111-8111-111111111111",
    callId: "22222222-2222-4222-8222-222222222222",
    snapshotHash: "a".repeat(64),
    fixtureMode,
    ...overrides,
  };
}

function verifiedPreflight(overrides = {}) {
  return {
    schemaVersion: 2,
    policyVersion: COUNCIL_POLICY_VERSION,
    status: "VERIFIED",
    checkedAt: new Date().toISOString(),
    sdkVersion: "18.12.5",
    provider: "openai-codex",
    modelId: COUNCIL_MODEL,
    api: "openai-codex-responses",
    effort: COUNCIL_REASONING_EFFORT,
    endpoint: "https://chatgpt.com/backend-api/codex/responses",
    transportMode: "sse-only",
    bodyAudit: "PASS",
    payloadObservationCount: 1,
    fetchFenceCallCount: 0,
    providerDispatchCount: 0,
    reasons: [],
    ...overrides,
  };
}

function noDataPreflight(reason = "Fixture has no native proof.") {
  return {
    schemaVersion: 2,
    policyVersion: COUNCIL_POLICY_VERSION,
    status: "NO_DATA",
    checkedAt: new Date().toISOString(),
    sdkVersion: null,
    provider: null,
    modelId: null,
    api: null,
    effort: null,
    endpoint: null,
    transportMode: null,
    bodyAudit: "NOT_RUN",
    payloadObservationCount: 0,
    fetchFenceCallCount: 0,
    providerDispatchCount: 0,
    reasons: [reason],
  };
}

async function withEnvironment(values, callback) {
  const previous = new Map(Object.keys(values).map(key => [key, process.env[key]]));
  for (const [key, value] of Object.entries(values)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  try {
    return await callback();
  } finally {
    for (const [key, value] of previous) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

async function tempDirectory(t) {
  const directory = await mkdtemp(join(tmpdir(), "omp-host-test-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  return directory;
}

async function fileExists(path) {
  try {
    await access(path);
    return true;
  } catch (error) {
    if (error.code === "ENOENT") return false;
    throw error;
  }
}

async function waitForFile(path, timeoutMs = 5000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      return await readFile(path, "utf8");
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
      await new Promise(resolve => setTimeout(resolve, 10));
    }
  }
  throw new Error("Subprocess fixture did not reach its ready marker.");
}

async function waitForExit(pid, timeoutMs = 5000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      process.kill(pid, 0);
    } catch (error) {
      if (error.code === "ESRCH") return;
      throw error;
    }
    await new Promise(resolve => setTimeout(resolve, 10));
  }
  assert.fail(`Owned subprocess ${pid} survived shutdown.`);
}

function processIds(marker) {
  return marker.trim().split("\n").map(value => Number(value));
}

function expectedCode(code, forbiddenText) {
  return error => error.code === code && !error.message.includes(forbiddenText);
}

test("missing Bun yields exact safe NO_DATA without invented runtime or SDK evidence", async () => {
  await withEnvironment({ FALCON_MESH_COUNCIL_BUN: undefined }, async () => {
    const transport = createOmpTransport();
    const result = await transport.preflight({
      auditRequest: fixtureRequest("result", { fixtureResult: verifiedPreflight() }),
      budgetMs: COUNCIL_LIMITS.preflightMs,
    });
    assert.deepEqual(Object.keys(result).sort(), PREFLIGHT_KEYS.slice().sort());
    assert.equal(result.schemaVersion, 2);
    assert.equal(result.policyVersion, COUNCIL_POLICY_VERSION);
    assert.equal(result.status, "NO_DATA");
    assert.equal(Number.isFinite(Date.parse(result.checkedAt)), true);
    assert.equal(new Date(result.checkedAt).toISOString(), result.checkedAt);
    assert.equal(result.sdkVersion, null);
    assert.equal(result.provider, null);
    assert.equal(result.modelId, null);
    assert.equal(result.api, null);
    assert.equal(result.effort, null);
    assert.equal(result.endpoint, null);
    assert.equal(result.transportMode, null);
    assert.equal(result.bodyAudit, "NOT_RUN");
    assert.equal(result.payloadObservationCount, 0);
    assert.equal(result.fetchFenceCallCount, 0);
    assert.equal(result.providerDispatchCount, 0);
    assert.deepEqual(result.reasons, ["Pinned Council worker is unavailable."]);
    await transport.close();
  });
});

test("rejects caller-selected runtime, model, or policy controls", async t => {
  await withEnvironment({ FALCON_MESH_COUNCIL_BUN: FIXTURE_BUN }, async () => {
    const transport = createOmpTransport();
    t.after(() => transport.close());
    await assert.rejects(
      transport.call(fixtureRequest("result"), {
        budgetMs: 2000,
        model: "caller-model",
        executable: FIXTURE_BUN,
        policyVersion: "caller-policy",
      }),
      error => error.code === "INVALID_REQUEST",
    );
    const proof = await transport.preflight({
      auditRequest: fixtureRequest("result", { fixtureResult: verifiedPreflight() }),
      budgetMs: 2000,
      model: "caller-model",
      executable: FIXTURE_BUN,
      policyVersion: "caller-policy",
    });
    assert.equal(proof.status, "NO_DATA");
    assert.equal(proof.sdkVersion, null);
    assert.deepEqual(proof.reasons, ["Council worker request is invalid."]);
  });
});

test("preflight accepts only exact protocol results and caps its operation budget", async t => {
  await withEnvironment({ FALCON_MESH_COUNCIL_BUN: FIXTURE_BUN }, async () => {
    const transport = createOmpTransport();
    t.after(() => transport.close());
    const auditRequest = fixtureRequest("result", { fixtureResult: verifiedPreflight() });
    const verified = await transport.preflight({ auditRequest, budgetMs: COUNCIL_LIMITS.runMs });
    assert.deepEqual(verified, auditRequest.fixtureResult);
    assert.equal(verified.status, "VERIFIED");

    const capped = await transport.preflight({
      auditRequest: fixtureRequest("preflight-budget", { fixtureResult: noDataPreflight() }),
      budgetMs: COUNCIL_LIMITS.runMs,
    });
    assert.equal(capped.status, "NO_DATA");
    assert.equal(capped.sdkVersion, null);
    assert.deepEqual(capped.reasons, [`fixture budget ${COUNCIL_LIMITS.preflightMs}`]);
    const remaining = await transport.preflight({
      auditRequest: fixtureRequest("preflight-budget", { fixtureResult: noDataPreflight() }),
      budgetMs: 5000,
    });
    assert.deepEqual(remaining.reasons, ["fixture budget 5000"]);

    const malformed = await transport.preflight({
      auditRequest: fixtureRequest("result", { fixtureResult: verifiedPreflight({ provider: "unexpected" }) }),
      budgetMs: COUNCIL_LIMITS.preflightMs,
    });
    assert.deepEqual(Object.keys(malformed).sort(), PREFLIGHT_KEYS.slice().sort());
    assert.equal(malformed.status, "NO_DATA");
    assert.equal(malformed.sdkVersion, null);
    assert.deepEqual(malformed.reasons, ["Council worker response was invalid."]);
  });
});

test("uses the fixed worker entry, preserves only broker discovery inputs, and removes its native cache root", async t => {
  const directory = await tempDirectory(t);
  const nativePathFile = join(directory, "native-path.txt");
  const secondNativePathFile = join(directory, "native-path-second.txt");
  const environment = {
    FALCON_MESH_COUNCIL_BUN: FIXTURE_BUN,
    HOME: directory,
    PI_CONFIG_DIR: "fixture-config",
    PI_CODING_AGENT_DIR: "/tmp/pi-agent-config",
    OMP_PROFILE: "fixture-profile",
    PI_PROFILE: "legacy-fixture-profile",
    OMP_AUTH_BROKER_URL: "https://broker.example.invalid",
    OMP_AUTH_BROKER_TOKEN: "fixture-only-secret-value",
    OMP_AUTH_BROKER_ACCOUNT_POOL_FILE: "/tmp/account-pool.json",
    OMP_AUTH_BROKER_SNAPSHOT_TTL_MS: "4321",
    OMP_AUTH_BROKER_SNAPSHOT_CACHE: "/tmp/broker-snapshot",
    XDG_DATA_HOME: "/tmp/fixture-xdg-data",
    XDG_STATE_HOME: "/tmp/fixture-xdg-state",
    XDG_CACHE_HOME: "/tmp/fixture-xdg-cache",
    FIXTURE_CUSTOM_BROKER_TOKEN: "must-not-pass",
    NODE_OPTIONS: "--trace-warnings",
    NODE_PATH: "/tmp/untrusted-node-modules",
    BUN_OPTIONS: "--preload=/tmp/untrusted-preload.js",
    PI_CODEX_WEBSOCKET: "1",
    PI_CODEX_RESPONSES_LITE: "1",
    PI_NATIVES_DIR: "/parent/natives-must-not-be-used",
    XDG_CONFIG_HOME: "/tmp/unused-config-home",
  };
  await withEnvironment(environment, async () => {
    const transport = createOmpTransport();
    t.after(() => transport.close());
    const result = await transport.call(fixtureRequest("env-report", { nativesPathFile: nativePathFile, expectedHome: directory }), {
      budgetMs: COUNCIL_LIMITS.runMs,
    });
    assert.equal(result.role, "lead");
    assert.equal(result.budgetMs, COUNCIL_LIMITS.callMs);
    const remaining = await transport.call(fixtureRequest("env-report", { nativesPathFile: secondNativePathFile }), { budgetMs: 5000 });
    assert.equal(remaining.budgetMs, 5000);
    assert.equal(result.fixedWorkerEntry, true);
    assert.equal(result.fixedWorkerDirectory, true);
    assert.equal(result.bunExecutableEnvStripped, true);
    assert.equal(result.brokerUrlForwarded, true);
    assert.equal(result.brokerTokenForwarded, true);
    assert.equal(result.brokerPoolForwarded, true);
    assert.equal(result.brokerSnapshotTtlForwarded, true);
    assert.equal(result.brokerSnapshotCacheForwarded, true);
    assert.equal(result.profileForwarded, true);
    assert.equal(result.homeForwarded, true);
    assert.equal(result.legacyProfileForwarded, true);
    assert.equal(result.xdgDataHomeForwarded, true);
    assert.equal(result.xdgStateHomeForwarded, true);
    assert.equal(result.xdgCacheHomeForwarded, true);
    assert.equal(result.configDirectoryForwarded, true);
    assert.equal(result.configRootOverrideForwarded, true);
    assert.equal(result.nativesDirectoryAbsolute, true);
    assert.equal(result.tempRootMatchesNativesParent, true);
    assert.equal(result.nativesDirectoryOverrodeParent, true);
    assert.equal(result.preloadEnvironmentStripped, true);
    assert.equal(result.nodeModulePathStripped, true);
    assert.equal(result.bunOptionsStripped, true);
    assert.equal(result.websocketOverrideStripped, true);
    assert.equal(result.liteOverrideStripped, true);
    assert.equal(result.unapprovedBrokerEnvStripped, true);
    assert.equal(result.xdgConfigHomeStripped, true);
    const nativeDir = await readFile(nativePathFile, "utf8");
    const nativeRoot = dirname(nativeDir);
    assert.equal(isAbsolute(nativeDir), true);
    const relativeRoot = relative(tmpdir(), nativeRoot);
    assert.notEqual(relativeRoot, "..");
    assert.equal(relativeRoot.startsWith(`..${sep}`), false);
    assert.equal(await fileExists(nativeDir), false);
    assert.equal(await fileExists(nativeRoot), false);
    const secondNativeDir = await readFile(secondNativePathFile, "utf8");
    assert.equal(isAbsolute(secondNativeDir), true);
    assert.notEqual(secondNativeDir, nativeDir);
    assert.equal(await fileExists(secondNativeDir), false);
    assert.equal(await fileExists(dirname(secondNativeDir)), false);
  });
});

test("isolates concurrent worker results and never reuses a prior result after worker failure", async t => {
  await withEnvironment({ FALCON_MESH_COUNCIL_BUN: FIXTURE_BUN }, async () => {
    const transport = createOmpTransport();
    t.after(() => transport.close());
    const [lead, risk] = await Promise.all([
      transport.call(fixtureRequest("result", { fixtureResult: { answer: "lead result" } }), { budgetMs: 2000 }),
      transport.call(fixtureRequest("result", { role: "risk", fixtureResult: { answer: "risk result" } }), { budgetMs: 2000 }),
    ]);
    assert.deepEqual(lead, { answer: "lead result" });
    assert.deepEqual(risk, { answer: "risk result" });
    await assert.rejects(
      transport.call(fixtureRequest("error"), { budgetMs: 2000 }),
      expectedCode("UNAVAILABLE", "FIXTURE-PRIVATE-STDERR-MUST-NOT-ESCAPE"),
    );
    const afterFailure = await transport.call(
      fixtureRequest("result", { fixtureResult: { answer: "fresh after failure" } }),
      { budgetMs: 2000 },
    );
    assert.deepEqual(afterFailure, { answer: "fresh after failure" });
  });
});

test("waits for worker exit after a valid stdout line before resolving success", async t => {
  const directory = await tempDirectory(t);
  const responseMarker = join(directory, "response-written");
  await withEnvironment({ FALCON_MESH_COUNCIL_BUN: FIXTURE_BUN }, async () => {
    const transport = createOmpTransport();
    t.after(() => transport.close());
    let settled = false;
    const pending = transport.call(fixtureRequest("delay-exit", {
      fixtureResult: { completed: true },
      responseMarker,
    }), { budgetMs: 2000 }).finally(() => { settled = true; });
    const responseWritten = await waitForFile(responseMarker);
    assert.equal(responseWritten, "response written");
    assert.equal(settled, false);
    assert.deepEqual(await pending, { completed: true });
    assert.equal(settled, true);
  });
});

test("rejects malformed UTF-8, multiple output lines, and unsuccessful worker exits", async t => {
  await withEnvironment({ FALCON_MESH_COUNCIL_BUN: FIXTURE_BUN }, async () => {
    const transport = createOmpTransport();
    t.after(() => transport.close());
    for (const fixtureMode of ["invalid-utf8", "multiline", "nonzero-exit"]) {
      await t.test(fixtureMode, async () => {
        await assert.rejects(
          transport.call(fixtureRequest(fixtureMode, { fixtureResult: { ignored: true } }), { budgetMs: 2000 }),
          error => error.code === "INVALID_RESPONSE",
        );
      });
    }
  });
});

test("enforces request, stdout, stderr, and remaining-time bounds", async t => {
  const directory = await tempDirectory(t);
  await withEnvironment({ FALCON_MESH_COUNCIL_BUN: FIXTURE_BUN }, async () => {
    const transport = createOmpTransport();
    t.after(() => transport.close());
    await assert.rejects(
      transport.call(fixtureRequest("result", { oversized: "x".repeat(COUNCIL_LIMITS.requestBytes) })),
      error => error.code === "TOO_LARGE",
    );
    for (const fixtureMode of ["oversize-output", "oversize-stderr"]) {
      await t.test(fixtureMode, async () => {
        await assert.rejects(
          transport.call(fixtureRequest(fixtureMode), { budgetMs: 2000 }),
          error => error.code === "TOO_LARGE",
        );
      });
    }
    await assert.rejects(
      transport.call(fixtureRequest("hold", { markerPath: join(directory, "timeout-pids.txt") }), { budgetMs: 50 }),
      error => error.code === "TIMED_OUT",
    );
    await assert.rejects(
      transport.call(fixtureRequest("result"), { budgetMs: COUNCIL_LIMITS.runMs + 1 }),
      error => error.code === "INVALID_REQUEST",
    );
  });
});

test("per-job cancellation signal terminates and reaps its process group", async t => {
  const directory = await tempDirectory(t);
  const markerPath = join(directory, "signal-pids.txt");
  await withEnvironment({ FALCON_MESH_COUNCIL_BUN: FIXTURE_BUN }, async () => {
    const transport = createOmpTransport();
    t.after(() => transport.close());
    const controller = new AbortController();
    const pending = transport.call(fixtureRequest("hold", { markerPath }), {
      signal: controller.signal,
      budgetMs: 10000,
    });
    const rejection = assert.rejects(pending, error => error.code === "ABORTED");
    const [workerPid, descendantPid] = processIds(await waitForFile(markerPath));
    controller.abort();
    await rejection;
    await Promise.all([waitForExit(workerPid), waitForExit(descendantPid)]);
  });
});

test("abort kills and reaps the owned process group, including a SIGTERM-resistant descendant", async t => {
  const directory = await tempDirectory(t);
  const markerPath = join(directory, "owned-pids.txt");
  await withEnvironment({ FALCON_MESH_COUNCIL_BUN: FIXTURE_BUN }, async () => {
    const transport = createOmpTransport();
    t.after(() => transport.close());
    const pending = transport.call(fixtureRequest("hold", { markerPath }), { budgetMs: 10000 });
    const rejection = assert.rejects(pending, error => error.code === "ABORTED");
    const [workerPid, descendantPid] = processIds(await waitForFile(markerPath));
    assert.ok(Number.isInteger(workerPid) && workerPid > 0);
    assert.ok(Number.isInteger(descendantPid) && descendantPid > 0);
    await Promise.all([transport.abort(), transport.abort()]);
    await rejection;
    await Promise.all([waitForExit(workerPid), waitForExit(descendantPid)]);
  });
});

test("close aborts active work idempotently and seals later dispatches", async t => {
  const directory = await tempDirectory(t);
  const markerPath = join(directory, "close-pids.txt");
  const laterMarkerPath = join(directory, "must-not-start.txt");
  await withEnvironment({ FALCON_MESH_COUNCIL_BUN: FIXTURE_BUN }, async () => {
    const transport = createOmpTransport();
    t.after(() => transport.close());
    const pending = transport.call(fixtureRequest("hold", { markerPath }), { budgetMs: 10000 });
    const rejection = assert.rejects(pending, error => error.code === "ABORTED");
    const [workerPid, descendantPid] = processIds(await waitForFile(markerPath));
    const closeOne = transport.close();
    const closeTwo = transport.close();
    await Promise.all([closeOne, closeTwo]);
    await rejection;
    await Promise.all([waitForExit(workerPid), waitForExit(descendantPid)]);
    await assert.rejects(
      transport.call(fixtureRequest("hold", { markerPath: laterMarkerPath }), { budgetMs: 2000 }),
      error => error.code === "UNAVAILABLE",
    );
    assert.equal(await fileExists(laterMarkerPath), false);
  });
});
