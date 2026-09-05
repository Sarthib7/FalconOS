import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdir, mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const execute = promisify(execFile);
const cli = fileURLToPath(new URL('../src/cli.ts', import.meta.url));
const cliModule = new URL('../src/cli.ts', import.meta.url).href;
const demoModule = new URL('../src/demo.ts', import.meta.url).href;

const realSignalPreloadScript = `
const mode = process.env.FALCONOS_PROCESS_MODE;

function responseFor(input) {
  const url = new URL(input);
  const solana = url.hostname === 'api.jup.ag';
  const inputAmount = url.searchParams.get(solana ? 'amount' : 'amountIn');
  const inputAsset = url.searchParams.get(solana ? 'inputMint' : 'tokenIn');
  const outputAsset = url.searchParams.get(solana ? 'outputMint' : 'tokenOut');
  const outputAmount = (BigInt(inputAmount) * 9n / 10n).toString();
  return solana ? Response.json({
    inputMint: inputAsset, outputMint: outputAsset, inAmount: inputAmount, outAmount: outputAmount,
    transaction: null, taker: null, swapMode: 'ExactIn', requestId: 'process-synthetic-jupiter',
  }) : Response.json({
    code: 0, requestId: 'process-synthetic-kyber', data: {routeSummary: {
      tokenIn: inputAsset.toLowerCase(), tokenOut: outputAsset.toLowerCase(),
      amountIn: inputAmount, amountOut: outputAmount, gasUsd: '0.004', l1FeeUsd: '0.00001',
      timestamp: Math.floor(Date.now() / 1000),
    }},
  });
}

if (mode === 'request') {
  globalThis.fetch = async (_input, init) => {
    process.send?.({type: 'request-start'});
    const signal = init?.signal;
    await new Promise((_resolve, reject) => {
      const keepAlive = setInterval(() => {}, 1_000);
      if (!signal) {
        clearInterval(keepAlive);
        reject(new Error('request signal missing'));
        return;
      }
      if (signal.aborted) {
        clearInterval(keepAlive);
        reject(signal.reason);
        return;
      }
      signal.addEventListener('abort', () => {
        clearInterval(keepAlive);
        reject(signal.reason);
      }, {once: true});
    });
    throw new Error('request did not cancel');
  };
} else {
  globalThis.fetch = async input => {
    process.send?.({type: 'fetch'});
    return responseFor(input);
  };
}

`;

const harnessScript = `
import { join } from 'node:path';
import { mkdir, writeFile } from 'node:fs/promises';
import { runCli } from ${JSON.stringify(cliModule)};
import { demoCycles } from ${JSON.stringify(demoModule)};

const mode = process.env.FALCONOS_TEST_MODE;
const dataDirectory = process.env.FALCONOS_TEST_DATA;
const fixedNow = new Date('2026-09-05T12:00:00.000Z');
let clockMs = fixedNow.getTime();
const abortController = mode === 'cancel-request' || mode === 'cancel-sleep' ? new AbortController() : undefined;
let collectionCalls = 0;
await mkdir(join(dataDirectory, 'records'), {recursive: true});

function scheduleAbort() {
  if (abortController) setTimeout(() => abortController.abort(new Error('synthetic user stop')), 10);
}

function complete(amount, at = fixedNow) {
  return demoCycles(amount, at);
}

function incomplete(amount) {
  const cycles = complete(amount);
  const observation = cycles[0].legs[0];
  observation.quote = null;
  observation.error = 'synthetic test double: source unavailable';
  observation.raw = {syntheticTestDouble: true, result: 'unavailable'};
  return cycles;
}

async function collect(amount, options) {
  collectionCalls += 1;
  await writeFile(join(dataDirectory, 'requests.txt'), String(collectionCalls));
  options.signal.throwIfAborted();
  if (mode === 'cancel-request') {
    scheduleAbort();
    await new Promise((resolve, reject) => {
      if (options.signal.aborted) {
        reject(options.signal.reason ?? new Error('aborted'));
        return;
      }
      const abort = () => reject(options.signal.reason ?? new Error('aborted'));
      options.signal.addEventListener('abort', abort, {once: true});
    });
    throw new Error('request did not cancel');
  }
  if (mode === 'advancing-clock') {
    clockMs += 1_000;
    return complete(amount, new Date(clockMs));
  }
  if (mode === 'healthy' || mode === 'cancel-sleep') return complete(amount);
  if (mode === 'failure' || mode === 'stop' || mode === 'one-shot-failure') return incomplete(amount);
  if (mode === 'reset') return [true, true, false, true, true, false][collectionCalls - 1] ? incomplete(amount) : complete(amount);
  throw new Error('Unknown test mode');
}

async function exportEvidence(scan, dataDirectory) {
  const evidencePath = join(dataDirectory, 'records', scan.id + '.json');
  const notePath = join(dataDirectory, 'records', scan.id + '.md');
  await writeFile(evidencePath, JSON.stringify({syntheticTestDouble: true, scan}, null, 2) + '\\n');
  await writeFile(notePath, 'Synthetic CLI test double.\\n');
  return {evidencePath, notePath, evidenceSha256: 'synthetic-test-double'};
}

async function pause(_milliseconds, signal) {
  if (mode !== 'cancel-sleep') return;
  scheduleAbort();
  await new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(signal.reason ?? new Error('aborted'));
      return;
    }
    const abort = () => reject(signal.reason ?? new Error('aborted'));
    signal.addEventListener('abort', abort, {once: true});
  });
}

const args = JSON.parse(process.env.FALCONOS_TEST_ARGS);
process.exitCode = await runCli(args, {
  collectCycles: collect, exportScan: exportEvidence, pause,
  now: mode === 'advancing-clock' ? () => new Date(clockMs) : () => fixedNow,
  signal: abortController?.signal,
});
`;

interface ChildResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

async function runHarness(args: string[], mode: string, dataDirectory: string): Promise<ChildResult> {
  try {
    const result = await execute(process.execPath, ['--input-type=module', '-e', harnessScript], {
      env: {
        ...process.env,
        FALCONOS_TEST_ARGS: JSON.stringify([...args, '--data', dataDirectory]),
        FALCONOS_TEST_DATA: dataDirectory,
        FALCONOS_TEST_MODE: mode,
      },
    });
    return {exitCode: 0, stdout: result.stdout, stderr: result.stderr};
  } catch (error) {
    const failure = error as {code?: number; stdout?: string; stderr?: string};
    return {exitCode: failure.code ?? -1, stdout: failure.stdout ?? '', stderr: failure.stderr ?? ''};
  }
}

function outputRecords(stdout: string): Record<string, unknown>[] {
  if (stdout.trim() === '') return [];
  return stdout.trim().split(/\r?\n/).map(line => JSON.parse(line) as Record<string, unknown>);
}

async function savedRecords(dataDirectory: string): Promise<Record<string, unknown>[]> {
  const names = (await readdir(join(dataDirectory, 'records'))).filter(name => name.endsWith('.json')).sort();
  return Promise.all(names.map(async name => JSON.parse(await readFile(join(dataDirectory, 'records', name), 'utf8')) as Record<string, unknown>));
}

interface ProcessSignalResult {
  exitCode: number | null;
  signal: NodeJS.Signals | null;
  stdout: string;
  stderr: string;
  messages: unknown[];
}

async function runRealSignalProcess(mode: 'request' | 'polling', stopSignal: NodeJS.Signals, dataDirectory: string): Promise<ProcessSignalResult> {
  const preload = `data:text/javascript,${encodeURIComponent(realSignalPreloadScript)}`;
  const args = mode === 'request'
    ? ['scan', '--amount', '10', '--data', dataDirectory]
    : ['watch', '--amount', '10', '--interval', '60', '--cycles', '2', '--data', dataDirectory];
  const child = spawn(process.execPath, ['--import', preload, cli, ...args], {
    cwd: process.cwd(),
    env: {...process.env, FALCONOS_PROCESS_MODE: mode, FALCONOS_PROCESS_DATA: dataDirectory},
    stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
  });
  let stdout = '';
  let stderr = '';
  const messages: unknown[] = [];
  child.stderr?.on('data', chunk => { stderr += String(chunk); });
  let sent = false;
  const sendStop = (signal: NodeJS.Signals) => {
    if (!sent) {
      sent = true;
      child.kill(signal);
    }
  };
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => {
      sendStop('SIGKILL');
      reject(new Error(`Process did not reach ${mode} stop point`));
    }, 10_000);
    child.stdout?.on('data', chunk => {
      stdout += String(chunk);
      if (mode === 'polling' && stdout.split(/\r?\n/).some(line => line.startsWith('{'))) {
        clearTimeout(timer);
        sendStop(stopSignal);
        resolve();
      }
    });
    child.once('error', error => {
      clearTimeout(timer);
      reject(error);
    });
    child.once('exit', (code, signal) => {
      clearTimeout(timer);
      reject(new Error(`Process exited before stop: code=${code}, signal=${signal}`));
    });
    child.on('message', message => {
      messages.push(message);
      if (mode === 'request' && typeof message === 'object' && message !== null
        && 'type' in message && message.type === 'request-start') {
        clearTimeout(timer);
        sendStop(stopSignal);
        resolve();
      }
    });
  });
  const result = await new Promise<{code: number | null; signal: NodeJS.Signals | null}>((resolve, reject) => {
    child.once('error', reject);
    child.once('exit', (code, signal) => resolve({code, signal}));
  });
  return {exitCode: result.code, signal: result.signal, stdout, stderr, messages};
}

test('F4/F6: one command produces inspectable evidence and an Obsidian run note', async t => {
  const directory = await mkdtemp('/private/tmp/falconos-cli-test-');
  t.after(() => rm(directory, {recursive: true, force: true}));
  const {stdout, stderr} = await execute(process.execPath, [cli, 'demo', '--amount', '10', '--data', directory]);
  assert.equal(stderr, '');
  const summary = JSON.parse(stdout);
  assert.equal(summary.mode, 'demo');
  assert.equal(summary.coverage.validQuotes, 4);
  assert.equal(summary.candidates.length, 2);
  assert.match(await readFile(summary.notePath, 'utf8'), /Synthetic demonstration/);
  assert.equal(JSON.parse(await readFile(summary.evidencePath, 'utf8')).mode, 'demo');
});

test('F1: reject unsupported commands and unsafe numeric arguments before network access', async () => {
  for (const args of [['trade'], ['scan', '--amount', '1000'], ['watch', '--interval', '1'], ['demo', '--cycles', '2']]) {
    await assert.rejects(execute(process.execPath, [cli, ...args]));
  }
  const {stdout} = await execute(process.execPath, [cli, '--help']);
  assert.match(stdout, /No wallet, taker/);
});

test('CHK-07: bounded exit codes, consecutive incomplete scans, and reset are visible in process output', async t => {
  const cases = [
    {name: 'healthy bounded watch', mode: 'healthy', args: ['watch', '--amount', '10', '--interval', '60', '--cycles', '2'], exitCode: 0, complete: [true, true], saved: 2, requests: 2},
    {name: 'bounded watch ending incomplete', mode: 'failure', args: ['watch', '--amount', '10', '--interval', '60', '--cycles', '1'], exitCode: 2, complete: [false], saved: 1, requests: 1},
    {name: 'one-shot scan failure', mode: 'one-shot-failure', args: ['scan', '--amount', '10'], exitCode: 2, complete: [false], saved: 1, requests: 1},
    {name: 'three consecutive incomplete scans stop', mode: 'stop', args: ['watch', '--amount', '10', '--interval', '60', '--cycles', '10'], exitCode: 2, complete: [false, false, false], saved: 3, requests: 3},
    {name: 'healthy scan resets failure count', mode: 'reset', args: ['watch', '--amount', '10', '--interval', '60', '--cycles', '6'], exitCode: 0, complete: [false, false, true, false, false, true], saved: 6, requests: 6},
  ];
  for (const expected of cases) {
    const directory = await mkdtemp('/private/tmp/falconos-cli-contract-');
    t.after(() => rm(directory, {recursive: true, force: true}));
    const result = await runHarness(expected.args, expected.mode, directory);
    assert.equal(result.exitCode, expected.exitCode, `${expected.name}: ${result.stderr}`);
    const outputs = outputRecords(result.stdout);
    assert.equal(outputs.length, expected.complete.length, expected.name);
    assert.equal((await savedRecords(directory)).length, expected.saved, expected.name);
    assert.equal(Number(await readFile(join(directory, 'requests.txt'), 'utf8')), expected.requests, expected.name);
    for (const [index, output] of outputs.entries()) {
      assert.equal((output.mode), 'live', expected.name);
      assert.equal((output.coverage as Record<string, unknown>).complete, expected.complete[index], expected.name);
    }
    for (const record of await savedRecords(directory)) {
      assert.equal(record.syntheticTestDouble, true, expected.name);
      assert.equal((record.scan as Record<string, unknown>).mode, 'live', expected.name);
    }
    if (expected.mode === 'stop') assert.match(result.stderr, /three consecutive incomplete scans/);
    else assert.equal(result.stderr, '', expected.name);
  }
});

test('F2: live assessment starts after collection completes', async t => {
  const directory = await mkdtemp('/private/tmp/falconos-cli-clock-');
  t.after(() => rm(directory, {recursive: true, force: true}));
  const result = await runHarness(['scan', '--amount', '10'], 'advancing-clock', directory);
  assert.equal(result.exitCode, 0, result.stderr);
  assert.equal(result.stderr, '');
  const output = outputRecords(result.stdout);
  assert.equal(output.length, 1);
  assert.equal(Number(await readFile(join(directory, 'requests.txt'), 'utf8')), 1);
  const candidates = output[0]!.candidates as Record<string, unknown>[];
  assert.equal(candidates[1]!.status, 'REVIEW');
  assert.equal((candidates[1]!.reasons as string[]).includes('STALE_OR_INVALID_OBSERVATION_TIME'), false);
  const saved = await savedRecords(directory);
  assert.equal(saved.length, 1);
  const scan = saved[0]!.scan as Record<string, unknown>;
  const assessedAt = Date.parse(scan.assessedAt as string);
  for (const cycle of scan.cycles as Record<string, unknown>[]) {
    for (const leg of (cycle.legs as Record<string, unknown>[])) {
      assert.ok(Date.parse(leg.receivedAt as string) <= assessedAt);
    }
  }
});

test('CHK-08: cancellation during request or polling sleep preserves records and starts no next request', async t => {
  const cases = [
    {name: 'request cancellation', mode: 'cancel-request', args: ['watch', '--amount', '10', '--interval', '60', '--cycles', '2'], outputs: 0, saved: 0},
    {name: 'polling cancellation', mode: 'cancel-sleep', args: ['watch', '--amount', '10', '--interval', '60', '--cycles', '2'], outputs: 1, saved: 1},
  ];
  for (const expected of cases) {
    const directory = await mkdtemp('/private/tmp/falconos-cli-cancel-');
    t.after(() => rm(directory, {recursive: true, force: true}));
    const result = await runHarness(expected.args, expected.mode, directory);
    assert.equal(result.exitCode, 0, expected.name);
    assert.equal(outputRecords(result.stdout).length, expected.outputs, expected.name);
    assert.equal((await savedRecords(directory)).length, expected.saved, expected.name);
    assert.equal(Number(await readFile(join(directory, 'requests.txt'), 'utf8')), 1, expected.name);
    assert.match(result.stderr, /Completed evidence records remain on disk/);
  }
});

test('CHK-08: production SIGTERM during a real source request stops before export', async t => {
  const directory = await mkdtemp('/private/tmp/falconos-cli-sigterm-');
  t.after(() => rm(directory, {recursive: true, force: true}));
  const result = await runRealSignalProcess('request', 'SIGTERM', directory);
  assert.equal(result.exitCode, 0);
  assert.equal(result.signal, null);
  assert.equal(result.stdout, '');
  assert.match(result.stderr, /Completed evidence records remain on disk/);
  assert.deepEqual(result.messages, [{type: 'request-start'}]);
  assert.deepEqual(await readdir(directory), []);
});

test('CHK-08: production SIGINT during a real source request stops before export', async t => {
  const directory = await mkdtemp('/private/tmp/falconos-cli-sigint-request-');
  t.after(() => rm(directory, {recursive: true, force: true}));
  const result = await runRealSignalProcess('request', 'SIGINT', directory);
  assert.equal(result.exitCode, 0);
  assert.equal(result.signal, null);
  assert.equal(result.stdout, '');
  assert.match(result.stderr, /Completed evidence records remain on disk/);
  assert.deepEqual(result.messages, [{type: 'request-start'}]);
  assert.deepEqual(await readdir(directory), []);
});

test('CHK-08: production SIGINT during polling stops after one completed scan', async t => {
  const directory = await mkdtemp('/private/tmp/falconos-cli-sigint-');
  t.after(() => rm(directory, {recursive: true, force: true}));
  const result = await runRealSignalProcess('polling', 'SIGINT', directory);
  assert.equal(result.exitCode, 0);
  assert.equal(result.signal, null);
  assert.equal(outputRecords(result.stdout).length, 1);
  assert.equal(result.messages.filter(message => typeof message === 'object' && message !== null
    && 'type' in message && message.type === 'fetch').length, 4);
  assert.match(result.stderr, /Completed evidence records remain on disk/);
  assert.deepEqual((await readdir(join(directory, 'runs'))).filter(name => name.endsWith('.json')).length, 1);
});

test('CHK-08: production SIGTERM during polling stops after one completed scan', async t => {
  const directory = await mkdtemp('/private/tmp/falconos-cli-sigterm-polling-');
  t.after(() => rm(directory, {recursive: true, force: true}));
  const result = await runRealSignalProcess('polling', 'SIGTERM', directory);
  assert.equal(result.exitCode, 0);
  assert.equal(result.signal, null);
  assert.equal(outputRecords(result.stdout).length, 1);
  assert.equal(result.messages.filter(message => typeof message === 'object' && message !== null
    && 'type' in message && message.type === 'fetch').length, 4);
  assert.match(result.stderr, /Completed evidence records remain on disk/);
  const runNames = (await readdir(join(directory, 'runs'))).filter(name => name.endsWith('.json'));
  assert.equal(runNames.length, 1);
  const record = JSON.parse(await readFile(join(directory, 'runs', runNames[0]!), 'utf8')) as Record<string, unknown>;
  assert.equal(record.mode, 'live');
  assert.equal((record.candidates as unknown[]).length, 2);
});
