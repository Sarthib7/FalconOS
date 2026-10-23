import test from "node:test";
import assert from "node:assert/strict";
import { access, chmod, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createCodexTransport } from "../council/codex-host.mjs";

const nowText = "2026-10-21T12:00:00.000Z";

async function makeFakeCodex(root, version = "0.160.0") {
  const executable = join(root, "fake-codex");
  const modelCallMarker = join(root, "unexpected-model-call");
  const script = [
    "#!" + process.execPath,
    "const args = process.argv.slice(2);",
    "if (args.includes('--version')) { process.stdout.write('codex-cli " + version + "\\n'); process.exit(0); }",
    "if (args.includes('--help')) { process.stdout.write('--ignore-user-config --strict-config --ephemeral --sandbox read-only --json --output-schema --model --config --ask-for-approval --skip-git-repo-check\\n'); process.exit(0); }",
    "require('node:fs').writeFileSync(" + JSON.stringify(modelCallMarker) + ", 'unexpected model call');",
    "process.exit(9);",
  ].join("\n");
  await writeFile(executable, script, { mode: 0o700 });
  await chmod(executable, 0o700);
  return { executablePath: executable, modelCallMarker };
}

async function makeAuthHome(root) {
  const codexHome = join(root, "auth-home");
  await mkdir(codexHome, { mode: 0o700 });
  await writeFile(join(codexHome, "auth.json"), JSON.stringify({ testCredential: "never-sent-to-a-model" }), { mode: 0o600 });
  return codexHome;
}

test("Codex preflight fails closed without a patch-tool disable control and performs no model probe", async t => {
  const root = await mkdtemp(join(tmpdir(), "council-host-test-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const fake = await makeFakeCodex(root);
  const codexHome = await makeAuthHome(root);
  const transport = createCodexTransport({ executablePath: fake.executablePath, codexHome, tempDirectory: root, now: () => nowText });

  const result = await transport.preflight();
  assert.equal(result.status, "NO_DATA");
  assert.equal(result.policyVersion, "codex-readonly/1");
  assert.equal(result.requestedModel, "gpt-6-luna");
  assert.equal(result.requestedReasoningEffort, "max");
  assert.equal(result.executableVersion, "0.160.0");
  assert.equal(result.verifiedControls.userConfigIsolated, true);
  assert.equal(result.verifiedControls.webSearchDisabled, true);
  assert.equal(result.verifiedControls.commandToolsDisabled, true);
  assert.equal(result.verifiedControls.inheritedMcpDisabled, true);
  assert.equal(result.verifiedControls.readOnlySandbox, true);
  assert.equal(result.verifiedControls.boundedIO, true);
  assert.equal(result.verifiedControls.controlledProbePassed, false);
  assert.equal(result.verifiedControls.patchToolsDisabled, false);
  assert.ok(result.reasons.some(reason => reason.includes("patch tool")));
  assert.ok(result.reasons.some(reason => reason.includes("no paid probe")));
  assert.equal(result.policyHash.length, 64);

  await assert.rejects(transport.call({}), /preflight/);
  await assert.rejects(access(fake.modelCallMarker));
});

test("an unavailable Codex release is never silently substituted", async t => {
  const root = await mkdtemp(join(tmpdir(), "council-host-test-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const fake = await makeFakeCodex(root, "0.161.0");
  const codexHome = await makeAuthHome(root);
  const transport = createCodexTransport({ executablePath: fake.executablePath, codexHome, tempDirectory: root, now: () => nowText });

  const result = await transport.preflight();
  assert.equal(result.status, "NO_DATA");
  assert.equal(result.executableVersion, "0.161.0");
  assert.ok(result.reasons.some(reason => reason.includes("verified 0.160.0")));
  await assert.rejects(access(fake.modelCallMarker));
});

test("missing isolated CLI authentication is a fail-closed prerequisite", async t => {
  const root = await mkdtemp(join(tmpdir(), "council-host-test-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const fake = await makeFakeCodex(root);
  const codexHome = join(root, "empty-auth-home");
  await mkdir(codexHome, { mode: 0o700 });
  const transport = createCodexTransport({ executablePath: fake.executablePath, codexHome, tempDirectory: root, now: () => nowText });

  const result = await transport.preflight();
  assert.equal(result.status, "NO_DATA");
  assert.equal(result.executableVersion, null);
  assert.ok(result.reasons.some(reason => reason.includes("private, bounded auth.json")));
  assert.equal(result.verifiedControls.commandToolsDisabled, false);
  await assert.rejects(access(fake.modelCallMarker));
});
