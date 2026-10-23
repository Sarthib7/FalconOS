#!/usr/bin/env node
import { spawn } from "node:child_process";
import { writeFile, access, rename } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, isAbsolute } from "node:path";

const workerEntry = process.argv[3];
if (process.argv[2] !== "run" || !workerEntry?.endsWith("/mesh/council/runtime/worker.ts")
    || process.cwd() !== dirname(workerEntry)) process.exit(64);

const chunks = [];
for await (const chunk of process.stdin) chunks.push(chunk);
const inputBytes = Buffer.concat(chunks);
let inputText;
try {
  inputText = new TextDecoder("utf-8", { fatal: true }).decode(inputBytes);
} catch {
  process.exit(65);
}
if (!inputText.endsWith("\n") || inputText.slice(0, -1).includes("\n")) process.exit(66);

let message;
try {
  message = JSON.parse(inputText.slice(0, -1));
} catch {
  process.exit(67);
}
const inputKeys = Object.keys(message).sort();
if (inputKeys.join(",") !== "budgetMs,operation,request,schemaVersion"
    || message.schemaVersion !== 1 || !["preflight", "call"].includes(message.operation)
    || !Number.isInteger(message.budgetMs) || message.budgetMs <= 0
    || !message.request || typeof message.request !== "object") process.exit(68);

const request = message.request;
const envelope = (result, operation = message.operation) => ({
  schemaVersion: 1,
  operation,
  ok: true,
  result,
});
const output = value => process.stdout.write(JSON.stringify(value) + "\n");

if (request.fixtureMode === "hold") {
  const markerPath = request.markerPath;
  const descendantReadyPath = markerPath + ".descendant-ready";
  const descendant = spawn(process.execPath, [
    fileURLToPath(new URL("./omp-stubborn-descendant.mjs", import.meta.url)),
    descendantReadyPath,
  ], { stdio: "ignore" });
  process.on("SIGTERM", () => {});
  const waitForDescendant = async () => {
    const deadline = Date.now() + 5000;
    while (Date.now() < deadline) {
      try {
        await access(descendantReadyPath);
        // V192: a visible ready marker must already contain both process IDs.
        const pendingMarker = markerPath + ".pending";
        await writeFile(pendingMarker, `${process.pid}\n${descendant.pid}\n`, { mode: 0o600 });
        await rename(pendingMarker, markerPath);
        setInterval(() => {}, 1000);
        return;
      } catch (error) {
        if (error.code !== "ENOENT") throw error;
        await new Promise(resolve => setTimeout(resolve, 10));
      }
    }
    process.exit(69);
  };
  await waitForDescendant();
  await new Promise(() => {});
}

if (request.fixtureMode === "error") {
  process.stderr.write("FIXTURE-PRIVATE-STDERR-MUST-NOT-ESCAPE\n");
  output({ schemaVersion: 1, operation: message.operation, ok: false, error: "UNAVAILABLE" });
} else if (request.fixtureMode === "multiline") {
  process.stdout.write(JSON.stringify(envelope({ status: "first" })) + "\nsecond-line\n");
} else if (request.fixtureMode === "invalid-utf8") {
  process.stdout.write(Buffer.from([0xc3, 0x28, 0x0a]));
} else if (request.fixtureMode === "oversize-output") {
  process.stdout.write(Buffer.alloc(65537, 0x78));
} else if (request.fixtureMode === "oversize-stderr") {
  process.stderr.write(Buffer.alloc(16385, 0x78));
  output(envelope({ status: "ignored" }));
} else if (request.fixtureMode === "env-report") {
  const result = {
    role: request.role,
    budgetMs: message.budgetMs,
    fixedWorkerEntry: workerEntry.endsWith("/mesh/council/runtime/worker.ts"),
    fixedWorkerDirectory: process.cwd() === dirname(workerEntry),
    bunExecutableEnvStripped: !Object.hasOwn(process.env, "FALCON_MESH_COUNCIL_BUN"),
    homeForwarded: process.env.HOME === request.expectedHome,
    brokerUrlForwarded: process.env.OMP_AUTH_BROKER_URL === "https://broker.example.invalid",
    brokerTokenForwarded: process.env.OMP_AUTH_BROKER_TOKEN === "fixture-only-secret-value",
    brokerPoolForwarded: process.env.OMP_AUTH_BROKER_ACCOUNT_POOL_FILE === "/tmp/account-pool.json",
    brokerSnapshotTtlForwarded: process.env.OMP_AUTH_BROKER_SNAPSHOT_TTL_MS === "4321",
    brokerSnapshotCacheForwarded: process.env.OMP_AUTH_BROKER_SNAPSHOT_CACHE === "/tmp/broker-snapshot",
    profileForwarded: process.env.OMP_PROFILE === "fixture-profile",
    legacyProfileForwarded: process.env.PI_PROFILE === "legacy-fixture-profile",
    configDirectoryForwarded: process.env.PI_CODING_AGENT_DIR === "/tmp/pi-agent-config",
    configRootOverrideForwarded: process.env.PI_CONFIG_DIR === "fixture-config",
    xdgDataHomeForwarded: process.env.XDG_DATA_HOME === "/tmp/fixture-xdg-data",
    xdgStateHomeForwarded: process.env.XDG_STATE_HOME === "/tmp/fixture-xdg-state",
    xdgCacheHomeForwarded: process.env.XDG_CACHE_HOME === "/tmp/fixture-xdg-cache",
    nativesDirectoryAbsolute: isAbsolute(process.env.PI_NATIVES_DIR || ""),
    tempRootMatchesNativesParent: process.env.TMPDIR === dirname(process.env.PI_NATIVES_DIR || ""),
    nativesDirectoryOverrodeParent: process.env.PI_NATIVES_DIR !== "/parent/natives-must-not-be-used",
    preloadEnvironmentStripped: !Object.hasOwn(process.env, "NODE_OPTIONS"),
    nodeModulePathStripped: !Object.hasOwn(process.env, "NODE_PATH"),
    bunOptionsStripped: !Object.hasOwn(process.env, "BUN_OPTIONS"),
    websocketOverrideStripped: !Object.hasOwn(process.env, "PI_CODEX_WEBSOCKET"),
    liteOverrideStripped: !Object.hasOwn(process.env, "PI_CODEX_RESPONSES_LITE"),
    unapprovedBrokerEnvStripped: !Object.hasOwn(process.env, "FIXTURE_CUSTOM_BROKER_TOKEN"),
    xdgConfigHomeStripped: !Object.hasOwn(process.env, "XDG_CONFIG_HOME"),
  };
  if (request.nativesPathFile) await writeFile(request.nativesPathFile, process.env.PI_NATIVES_DIR || "", { mode: 0o600 });
  output(envelope(result));
} else if (request.fixtureMode === "preflight-budget") {
  const result = { ...request.fixtureResult, reasons: [`fixture budget ${message.budgetMs}`] };
  output(envelope(result));
} else if (request.fixtureMode === "delay-exit") {
  await new Promise(resolve => process.stdout.write(JSON.stringify(envelope(request.fixtureResult)) + "\n", resolve));
  await writeFile(request.responseMarker, "response written");
  await new Promise(resolve => setTimeout(resolve, 300));
} else if (request.fixtureMode === "nonzero-exit") {
  output(envelope(request.fixtureResult));
  process.exitCode = 1;
} else {
  output(envelope(request.fixtureResult));
}
