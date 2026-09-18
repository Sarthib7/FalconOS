import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import test from 'node:test';
import {
  handleStocksAgentRequest,
  newStocksAgentIds,
  parseStocksAgentRequest,
  serializeStocksAgentResult,
  stocksAgentError,
} from '../agent.ts';

function fixtureRequest(fixtureCase: 'healthy' | 'low-liquidity' | 'stale', ids = newStocksAgentIds()) {
  return {
    schemaVersion: 1 as const,
    kind: 'stocks.agent-request' as const,
    requestId: ids.requestId,
    runId: ids.runId,
    agentId: 'client-agent-demo',
    mode: 'fixture' as const,
    case: fixtureCase,
  };
}

function runAdviceCli(input: string): Promise<{ stdout: string; stderr: string; code: number | null }> {
  return new Promise((resolve, reject) => {
    const child = spawn('node', ['stocks/cli.ts', 'advice'], { cwd: process.cwd() });
    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => {
      child.kill('SIGTERM');
      reject(new Error('stocks advice CLI timed out'));
    }, 10000);
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', chunk => { stdout += chunk; });
    child.stderr.on('data', chunk => { stderr += chunk; });
    child.on('error', error => {
      clearTimeout(timer);
      reject(error);
    });
    child.on('close', code => {
      clearTimeout(timer);
      resolve({ stdout, stderr, code });
    });
    child.stdin.end(input, 'utf8');
  });
}

test('V72: stocks agent healthy fixture publishes advisory JSON for Client Agents', async () => {
  const request = fixtureRequest('healthy');
  const response = await handleStocksAgentRequest(request);
  assert.equal(response.kind, 'stocks.agent-response');
  assert.equal(response.agentId, 'client-agent-demo');
  assert.equal(response.authority, 'advisory-only');
  assert.equal(response.executionReady, false);
  assert.equal(response.advice.status, 'PUBLISHED');
  assert.equal(response.integrity?.status, 'VERIFIED');
  assert.ok((response.advice.proposal?.legs.length ?? 0) >= 2);
  const line = serializeStocksAgentResult(response);
  assert.equal(line.endsWith('\n'), true);
  assert.equal(JSON.parse(line).kind, 'stocks.agent-response');
});

test('V72: stocks agent low-liquidity fixture blocks publication', async () => {
  const response = await handleStocksAgentRequest(fixtureRequest('low-liquidity'));
  assert.equal(response.advice.status, 'BLOCKED');
  assert.equal(response.advice.proposal, null);
  assert.equal(response.advice.citations.length, 0);
});

test('V72: stocks agent stale fixture returns NO_DATA', async () => {
  const response = await handleStocksAgentRequest(fixtureRequest('stale'));
  assert.equal(response.advice.status, 'NO_DATA');
  assert.equal(response.integrity?.status, 'STALE');
});

test('V72: stocks agent rejects forbidden authority fields', () => {
  const ids = newStocksAgentIds();
  assert.throws(
    () => parseStocksAgentRequest(JSON.stringify({ ...fixtureRequest('healthy', ids), wallet: 'abc' })),
    /forbidden field/,
  );
});

test('V72: stocks agent rejects unknown fixture keys and bad JSON', () => {
  assert.throws(() => parseStocksAgentRequest('{'), /not valid JSON/);
  const ids = newStocksAgentIds();
  assert.throws(
    () => parseStocksAgentRequest(JSON.stringify({ ...fixtureRequest('healthy', ids), extra: true })),
    /unexpected keys/,
  );
});

test('V72: stocks agent CLI emits one JSON line for healthy fixture', async () => {
  const { stdout, stderr, code } = await runAdviceCli(JSON.stringify(fixtureRequest('healthy')));
  assert.equal(stderr, '');
  assert.equal(code, 0);
  const lines = stdout.trim().split('\n');
  assert.equal(lines.length, 1);
  const parsed = JSON.parse(lines[0] ?? '{}');
  assert.equal(parsed.kind, 'stocks.agent-response');
  assert.equal(parsed.advice.status, 'PUBLISHED');
  assert.equal(parsed.executionReady, false);
});

test('V72: stocks agent CLI returns error envelope for invalid JSON', async () => {
  const { stdout, code } = await runAdviceCli('{');
  assert.equal(code, 2);
  const parsed = JSON.parse(stdout.trim());
  assert.equal(parsed.kind, 'stocks.agent-error');
  assert.equal(parsed.code, 'INVALID_JSON');
  assert.equal(parsed.authority, 'advisory-only');
});

test('V72: stocks agent error helper stays advisory-only', () => {
  const error = stocksAgentError('ADVISORY_UNAVAILABLE', 'host transport missing');
  assert.equal(error.executionReady, false);
  assert.equal(error.authority, 'advisory-only');
});
