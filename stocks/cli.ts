#!/usr/bin/env node
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import {
  handleStocksAgentRequest,
  parseStocksAgentRequest,
  serializeStocksAgentResult,
  stocksAgentError,
  STOCKS_AGENT_MAX_REQUEST_BYTES,
} from './agent.ts';
import type { StocksAgentErrorCode } from './agent.ts';

const HELP = `FalconOS Stocks agent surface

Read one stocks.agent-request JSON object from stdin.
Write one stocks.agent-response or stocks.agent-error JSON line to stdout.

node stocks/cli.ts advice < request.json
node stocks/cli.ts advice --help

Fixture smoke (offline, no network):
  {"schemaVersion":1,"kind":"stocks.agent-request","requestId":"<uuid-v4>","runId":"run-1","agentId":"client-agent","mode":"fixture","case":"healthy"}

Cases: healthy | low-liquidity | stale

Boundaries:
  advisory-only, executionReady=false
  no wallet, signer, custody, or live market calls on this path
`;

async function readStdin(maxBytes: number): Promise<string> {
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of process.stdin) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    total += buffer.length;
    if (total > maxBytes) throw Object.assign(new Error('stdin exceeds 8 MiB'), { code: 'INVALID_REQUEST' as const });
    chunks.push(buffer);
  }
  return Buffer.concat(chunks).toString('utf8');
}

function mapErrorCode(code: unknown): StocksAgentErrorCode {
  if (code === 'INVALID_JSON' || code === 'INVALID_REQUEST' || code === 'FORBIDDEN_FIELD' || code === 'SNAPSHOT_INVALID' || code === 'RESPONSE_TOO_LARGE' || code === 'ADVISORY_UNAVAILABLE') {
    return code;
  }
  return 'ADVISORY_UNAVAILABLE';
}

export async function runStocksCli(argv: readonly string[] = process.argv.slice(2)): Promise<number> {
  const { values, positionals } = parseArgs({
    args: [...argv],
    allowPositionals: true,
    strict: true,
    options: { help: { type: 'boolean', default: false } },
  });
  if (values.help || positionals.length === 0) {
    process.stdout.write(`${HELP}\n`);
    return 0;
  }
  if (positionals.length !== 1 || positionals[0] !== 'advice') {
    process.stderr.write('Use: node stocks/cli.ts advice\n');
    return 1;
  }

  let requestId: string | null = null;
  try {
    const raw = await readStdin(STOCKS_AGENT_MAX_REQUEST_BYTES);
    const request = parseStocksAgentRequest(raw);
    requestId = request.requestId;
    const response = await handleStocksAgentRequest(request);
    process.stdout.write(serializeStocksAgentResult(response));
    return 0;
  } catch (error) {
    const mapped = mapErrorCode(typeof error === 'object' && error !== null && 'code' in error ? (error as { code: unknown }).code : undefined);
    const message = error instanceof Error ? error.message.slice(0, 500) : 'advisory unavailable';
    process.stdout.write(serializeStocksAgentResult(stocksAgentError(mapped, message, requestId)));
    return 2;
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  runStocksCli().then(code => {
    process.exitCode = code;
  }).catch((error: unknown) => {
    process.stderr.write(`stocks agent error: ${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
