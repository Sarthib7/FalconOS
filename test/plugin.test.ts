import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { once } from 'node:events';
import { execFile, spawn } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';
import { copyFile, mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises';
import { promisify } from 'node:util';
import { join } from 'node:path';
import { createScan } from '../stablecoins/scan.ts';
import { demoCycles as makeDemoCycles } from '../src/demo.ts';
import { fixtureAgent, type AgentRequest } from '../src/agent.ts';
import { runCli } from '../src/cli.ts';
import {
  MAX_PLUGIN_OUTPUT_BYTES,
  runPlugin,
  type PluginRunResult,
} from '../src/plugin.ts';
import type { PluginError, PluginRequest, Scan } from '../src/types.ts';
import { exportThesis } from '../src/vault.ts';

const evidenceFixture = new URL('./fixtures/agent-evidence.json', import.meta.url);
const requestFixture = new URL('./fixtures/plugin-valid-request.json', import.meta.url);
const evidenceBytes = await readFile(evidenceFixture);
const fixtureRequest = JSON.parse(await readFile(requestFixture, 'utf8')) as PluginRequest;
const fixedNow = new Date('2026-09-05T13:59:00.000Z');
const execute = promisify(execFile);

async function* input(value: string): AsyncIterable<string> {
  yield value;
}

interface PluginProcessResult {
  exitCode: number | null;
  signal: NodeJS.Signals | null;
  stdout: string;
  stderr: string;
  elapsedMs: number;
  timedOut: boolean;
}

async function runPluginProcess(dataDirectory: string, value: unknown, timeoutMs = 1_000): Promise<PluginProcessResult> {
  const child = spawn(process.execPath, ['src/cli.ts', 'plugin', '--data', dataDirectory], {
    cwd: process.cwd(),
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  const startedAt = Date.now();
  let stdout = '';
  let stderr = '';
  child.stdout?.on('data', chunk => { stdout += String(chunk); });
  child.stderr?.on('data', chunk => { stderr += String(chunk); });
  child.stdin?.end(JSON.stringify(value));
  const close = once(child, 'close').then(([exitCode, signal]) => ({
    exitCode: exitCode as number | null,
    signal: signal as NodeJS.Signals | null,
    stdout,
    stderr,
    elapsedMs: Date.now() - startedAt,
    timedOut: false,
  }));
  const timeout = sleep(timeoutMs).then(() => {
    // This is an integration timeout for a child process that intentionally opens a FIFO.
    child.kill('SIGKILL');
    return {
      exitCode: null,
      signal: 'SIGKILL' as NodeJS.Signals,
      stdout,
      stderr,
      elapsedMs: Date.now() - startedAt,
      timedOut: true,
    };
  });
  return Promise.race([close, timeout]);
}

async function makeData(t: {after: (callback: () => void | Promise<void>) => void}): Promise<string> {
  const data = await mkdtemp('/private/tmp/falconos-plugin-test-');
  t.after(() => rm(data, {recursive: true, force: true}));
  await mkdir(join(data, 'runs'), {recursive: true});
  await copyFile(evidenceFixture, join(data, 'runs', 'agent-evidence.json'));
  await copyFile(evidenceFixture, join(data, 'agent-evidence.json'));
  return data;
}

function request(overrides: Partial<PluginRequest> = {}): PluginRequest {
  return {...fixtureRequest, ...overrides};
}

function withEvidence(base: PluginRequest, path: string, bytes: Buffer): PluginRequest {
  return {...base, evidence: {...base.evidence, path, sha256: createHash('sha256').update(bytes).digest('hex')}};
}

function fixtureTransport(captured?: {request?: AgentRequest}, calls?: {count: number}) {
  return async (agentRequest: AgentRequest) => {
    if (captured) captured.request = agentRequest;
    if (calls) calls.count++;
    return fixtureAgent(agentRequest);
  };
}

async function runRequest(value: unknown, dataDirectory: string, withTransport = true) {
  return runPlugin(input(JSON.stringify(value)), {
    dataDirectory,
    agentTransport: withTransport ? fixtureTransport() : undefined,
    now: () => fixedNow,
  });
}

function errorResponseOf(result: PluginRunResult): PluginError {
  if (result.response.kind !== 'error') throw new Error('Expected plugin error response');
  return result.response;
}

test('V1/V2: plugin framing accepts one object and rejects concatenated JSON', async t => {
  const data = await makeData(t);
  const valid = await runRequest(request(), data);
  assert.equal(valid.exitCode, 0);
  assert.equal(valid.response.kind, 'advisory');

  const framed = await runPlugin(input(`${JSON.stringify(request())}\n${JSON.stringify(request())}`), {
    dataDirectory: data,
    agentTransport: fixtureTransport(),
    now: () => fixedNow,
  });
  assert.equal(framed.exitCode, 2);
  assert.equal(framed.response.kind, 'error');
  assert.equal(errorResponseOf(framed).code, 'INVALID_JSON');
});

test('V1: plugin input has an independent bounded frame', async t => {
  const data = await makeData(t);
  const oversized = await runPlugin(input('x'.repeat(8 * 1024 * 1024 + 1)), {
    dataDirectory: data,
    agentTransport: fixtureTransport(),
    now: () => fixedNow,
  });
  assert.equal(oversized.exitCode, 2);
  assert.equal(oversized.response.kind, 'error');
  assert.equal(errorResponseOf(oversized).code, 'INVALID_JSON');
});

test('V9/V10/V15: injected fixture transport returns synthetic advisory provenance', async t => {
  const data = await makeData(t);
  const captured: {request?: AgentRequest} = {};
  const result = await runPlugin(input(JSON.stringify(request())), {
    dataDirectory: data,
    agentTransport: fixtureTransport(captured),
    now: () => fixedNow,
  });
  assert.equal(result.exitCode, 0);
  assert.equal(result.response.kind, 'advisory');
  if (result.response.kind !== 'advisory') return;
  assert.equal(result.response.requestId, fixtureRequest.requestId);
  assert.equal(result.response.agentId, 'external-agent-fixture');
  assert.equal(result.response.route, 'base-solana');
  assert.equal(result.response.status, 'REVIEW');
  assert.equal(result.response.fixture, true);
  assert.equal(result.response.authority, 'advisory-only');
  assert.equal(result.response.executionReady, false);
  assert.match(result.response.thesis, /not a real agent decision/);
  assert.equal('agentId' in (captured.request ?? {}), false);
  assert.ok(Buffer.byteLength(JSON.stringify(result.response), 'utf8') <= MAX_PLUGIN_OUTPUT_BYTES);
});

test('V13: missing production transport returns stable unavailable error', async t => {
  const data = await makeData(t);
  const result = await runRequest(request(), data, false);
  assert.equal(result.exitCode, 2);
  assert.deepEqual(result.response, {
    schemaVersion: 1,
    kind: 'error',
    requestId: fixtureRequest.requestId,
    code: 'ADVISORY_UNAVAILABLE',
    message: 'Host transport is unavailable',
    authority: 'advisory-only',
    executionReady: false,
  });
});

test('V13: transport failures expose only stable safe messages', async t => {
  const data = await makeData(t);
  for (const transport of [
    async () => { throw new Error('SECRET wallet=abc raw prompt'); },
    async () => { throw new Error(''); },
  ]) {
    const lines: string[] = [];
    const originalLog = console.log;
    console.log = (...args: unknown[]) => { lines.push(args.map(String).join(' ')); };
    let code: number;
    try {
      code = await runCli(['plugin', '--data', data], {
        pluginStdin: input(JSON.stringify(request())),
        pluginTransport: transport,
        now: () => fixedNow,
      });
    } finally {
      console.log = originalLog;
    }
    assert.equal(code, 2);
    assert.equal(lines.length, 1);
    const response = JSON.parse(lines[0]!) as Record<string, unknown>;
    assert.equal(response.code, 'ADVISORY_UNAVAILABLE');
    assert.equal(response.message, 'Host transport failed');
    assert.doesNotMatch(lines[0]!, /SECRET|wallet|raw prompt/);
    assert.doesNotMatch(String(response.message), /SECRET|wallet|raw prompt/);
  }
});

test('V2/V11: malformed, unknown, and authority-bearing requests are rejected before transport', async t => {
  const data = await makeData(t);
  const calls = {count: 0};
  const cases = [
    '{bad json',
    {...request(), unexpected: true},
    {...request(), wallet: {sign: true}},
    {...request(), intent: {...request().intent, model: 'gpt-5.6-luna'}},
  ];
  const malformed = await runPlugin(input(cases[0] as string), {
    dataDirectory: data,
    agentTransport: fixtureTransport(undefined, calls),
    now: () => fixedNow,
  });
  assert.equal(errorResponseOf(malformed).code, 'INVALID_JSON');
  for (const value of cases.slice(1)) {
    const result = await runPlugin(input(JSON.stringify(value)), {
      dataDirectory: data,
      agentTransport: fixtureTransport(undefined, calls),
      now: () => fixedNow,
    });
    assert.equal(result.exitCode, 2);
    assert.equal(result.response.kind, 'error');
    assert.equal(errorResponseOf(result).code, 'INVALID_REQUEST');
  }
  assert.equal(calls.count, 0);
});

test('V3/V4: path, hash, cutoff, and route validation fail safely', async t => {
  const data = await makeData(t);
  const pathResult = await runRequest({...request(), evidence: {...request().evidence, path: '../agent-evidence.json'}}, data);
  assert.equal(errorResponseOf(pathResult).code, 'EVIDENCE_INVALID');

  const uncResult = await runRequest({...request(), evidence: {...request().evidence, path: String.raw`\\server\share\agent-evidence.json`}}, data);
  assert.equal(errorResponseOf(uncResult).code, 'EVIDENCE_INVALID');
  assert.match(errorResponseOf(uncResult).message, /relative path/);
  const hashResult = await runRequest({...request(), evidence: {...request().evidence, sha256: '0'.repeat(64)}}, data);
  assert.equal(errorResponseOf(hashResult).code, 'EVIDENCE_INVALID');

  const futureCutoff = await runRequest({...request(), sourceCutoff: '2026-09-05T14:00:00.000Z'}, data);
  assert.equal(errorResponseOf(futureCutoff).code, 'INVALID_REQUEST');

  const staleCutoff = await runRequest({...request(), sourceCutoff: '2026-09-05T13:57:00.000Z'}, data);
  assert.equal(errorResponseOf(staleCutoff).code, 'EVIDENCE_INVALID');

  const unsupportedRoute = await runRequest({...request(), intent: {...request().intent, route: 'ethereum-base' as 'base-solana'}}, data);
  assert.equal(errorResponseOf(unsupportedRoute).code, 'INVALID_REQUEST');
});

test('V4: symlinked evidence cannot enter plugin bundle', async t => {
  const data = await makeData(t);
  await symlink(join(data, 'agent-evidence.json'), join(data, 'link.json'));
  const result = await runRequest({...request(), evidence: {...request().evidence, path: 'link.json'}}, data);
  assert.equal(result.exitCode, 2);
  assert.equal(errorResponseOf(result).code, 'EVIDENCE_INVALID');
  await symlink(join(data, 'runs'), join(data, 'linked-runs'));
  const linkedParentResult = await runRequest({...request(), evidence: {...request().evidence, path: 'linked-runs/agent-evidence.json'}}, data);
  assert.equal(errorResponseOf(linkedParentResult).code, 'EVIDENCE_INVALID');
  assert.match(errorResponseOf(linkedParentResult).message, /cannot use symlinks/);
});

test('V4/V7: FIFO evidence and notes fail promptly with stable errors', async t => {
  const data = await makeData(t);
  const evidenceFifo = join(data, 'evidence.fifo');
  await execute('mkfifo', [evidenceFifo]);
  const evidenceResult = await runPluginProcess(data, {
    ...request(),
    evidence: {...request().evidence, path: 'evidence.fifo'},
  }, 3_000);
  assert.equal(evidenceResult.timedOut, false);
  assert.ok(evidenceResult.elapsedMs < 2_500, `FIFO evidence took ${evidenceResult.elapsedMs}ms`);
  assert.equal(evidenceResult.exitCode, 2);
  assert.equal(evidenceResult.stderr, '');
  assert.equal(evidenceResult.stdout.trim().split(/\r?\n/).length, 1);
  const evidenceResponse = JSON.parse(evidenceResult.stdout) as Record<string, unknown>;
  assert.equal(evidenceResponse.code, 'EVIDENCE_INVALID');
  assert.equal(evidenceResponse.message, 'Evidence path must be a regular file');

  const notesDirectory = join(data, 'notes');
  await mkdir(notesDirectory);
  const noteFifo = join(notesDirectory, 'pending.fifo');
  await execute('mkfifo', [noteFifo]);
  const noteResult = await runPluginProcess(data, {
    ...request(),
    notes: [{path: 'notes/pending.fifo'}],
  }, 3_000);
  assert.equal(noteResult.timedOut, false);
  assert.ok(noteResult.elapsedMs < 2_500, `FIFO note took ${noteResult.elapsedMs}ms`);
  assert.equal(noteResult.exitCode, 2);
  assert.equal(noteResult.stderr, '');
  assert.equal(noteResult.stdout.trim().split(/\r?\n/).length, 1);
  const noteResponse = JSON.parse(noteResult.stdout) as Record<string, unknown>;
  assert.equal(noteResponse.code, 'EVIDENCE_INVALID');
  assert.equal(noteResponse.message, 'Note path must be a regular file');
});