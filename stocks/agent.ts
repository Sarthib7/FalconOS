import { createHash, randomUUID } from 'node:crypto';
import { fixtureAdapter } from './adapters.ts';
import { STOCKS_DEMO_ASSETS, stocksDemoValues } from './demo.ts';
import { evaluateMarketIntegrity } from './integrity.ts';
import type { MarketIntegrityReport } from './integrity.ts';
import { buildStocksSnapshot, createStocksHostBoundary } from './host.ts';
import type { StocksHostConfig } from './host.ts';
import {
  createStocksAdviceRequest,
  invokeStocksAdvice,
  STOCKS_SCHEMA_VERSION,
  validateCanonicalBasketSnapshot,
  validateStocksAdviceResponse,
} from './stocks.ts';
import type { CanonicalBasketSnapshot, StocksAdviceResponse } from './stocks.ts';

export const STOCKS_AGENT_SCHEMA_VERSION = 1 as const;
export const STOCKS_AGENT_MAX_REQUEST_BYTES = 8 * 1024 * 1024;
export const STOCKS_AGENT_MAX_RESPONSE_BYTES = 64 * 1024;

export type StocksAgentFixtureCase = 'healthy' | 'low-liquidity' | 'stale';
export type StocksAgentErrorCode =
  | 'INVALID_JSON'
  | 'INVALID_REQUEST'
  | 'FORBIDDEN_FIELD'
  | 'SNAPSHOT_INVALID'
  | 'ADVISORY_UNAVAILABLE'
  | 'RESPONSE_TOO_LARGE';

const FORBIDDEN = /^(wallet|signer|key|privateKey|secret|transaction|instruction|capital|reservation|custody|pool|allocation|approval|execution|model|tool)$/i;
const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const NON_EMPTY = /\S/;

export interface StocksAgentFixtureRequest {
  schemaVersion: typeof STOCKS_AGENT_SCHEMA_VERSION;
  kind: 'stocks.agent-request';
  requestId: string;
  runId: string;
  agentId: string;
  mode: 'fixture';
  case: StocksAgentFixtureCase;
}

export interface StocksAgentSnapshotRequest {
  schemaVersion: typeof STOCKS_AGENT_SCHEMA_VERSION;
  kind: 'stocks.agent-request';
  requestId: string;
  runId: string;
  agentId: string;
  mode: 'snapshot';
  snapshot: CanonicalBasketSnapshot;
  assets?: StocksHostConfig['assets'];
  integrityMaxAgeMs?: number;
  checkedAt?: string;
}

export type StocksAgentRequest = StocksAgentFixtureRequest | StocksAgentSnapshotRequest;

export interface StocksAgentResponse {
  schemaVersion: typeof STOCKS_AGENT_SCHEMA_VERSION;
  kind: 'stocks.agent-response';
  requestId: string;
  runId: string;
  agentId: string;
  advice: StocksAdviceResponse;
  integrity: MarketIntegrityReport | null;
  authority: 'advisory-only';
  executionReady: false;
}

export interface StocksAgentError {
  schemaVersion: typeof STOCKS_AGENT_SCHEMA_VERSION;
  kind: 'stocks.agent-error';
  requestId: string | null;
  code: StocksAgentErrorCode;
  message: string;
  authority: 'advisory-only';
  executionReady: false;
}

export type StocksAgentResult = StocksAgentResponse | StocksAgentError;

function freezeDeep<T>(value: T): T {
  if (value === null || typeof value !== 'object') return value;
  if (Object.isFrozen(value)) return value;
  if (Array.isArray(value)) {
    for (const item of value) freezeDeep(item);
    return Object.freeze(value);
  }
  for (const child of Object.values(value as Record<string, unknown>)) freezeDeep(child);
  return Object.freeze(value);
}

function record(value: unknown, name: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new TypeError(`${name} must be an object`);
  return value as Record<string, unknown>;
}

function exactKeys(value: Record<string, unknown>, keys: readonly string[], name: string): void {
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) throw new TypeError(`${name} has unexpected keys`);
}

function rejectForbiddenKeys(value: unknown, path = 'request'): void {
  if (typeof value !== 'object' || value === null) return;
  if (Array.isArray(value)) {
    for (const [index, item] of value.entries()) rejectForbiddenKeys(item, `${path}[${index}]`);
    return;
  }
  for (const [key, child] of Object.entries(value)) {
    if (FORBIDDEN.test(key)) throw Object.assign(new TypeError(`forbidden field ${path}.${key}`), { code: 'FORBIDDEN_FIELD' as const });
    rejectForbiddenKeys(child, `${path}.${key}`);
  }
}

function stringValue(value: unknown, name: string, maxBytes = 256): string {
  if (typeof value !== 'string' || !NON_EMPTY.test(value)) throw new TypeError(`${name} must be non-empty`);
  if (Buffer.byteLength(value, 'utf8') > maxBytes) throw new TypeError(`${name} exceeds ${maxBytes} bytes`);
  return value;
}

function uuidValue(value: unknown, name: string): string {
  const result = stringValue(value, name, 36);
  if (!UUID_V4.test(result)) throw new TypeError(`${name} must be UUID v4`);
  return result;
}

export function parseStocksAgentRequest(raw: string): StocksAgentRequest {
  if (Buffer.byteLength(raw, 'utf8') > STOCKS_AGENT_MAX_REQUEST_BYTES) throw Object.assign(new TypeError('request exceeds 8 MiB'), { code: 'INVALID_REQUEST' as const });
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw Object.assign(new TypeError('request is not valid JSON'), { code: 'INVALID_JSON' as const });
  }
  rejectForbiddenKeys(parsed);
  const object = record(parsed, 'stocks agent request');
  if (object.schemaVersion !== STOCKS_AGENT_SCHEMA_VERSION || object.kind !== 'stocks.agent-request') {
    throw Object.assign(new TypeError('invalid stocks agent request envelope'), { code: 'INVALID_REQUEST' as const });
  }
  const requestId = uuidValue(object.requestId, 'requestId');
  const runId = stringValue(object.runId, 'runId', 128);
  const agentId = stringValue(object.agentId, 'agentId', 256);
  const mode = object.mode;
  if (mode === 'fixture') {
    exactKeys(object, ['schemaVersion', 'kind', 'requestId', 'runId', 'agentId', 'mode', 'case'], 'stocks agent fixture request');
    const fixtureCase = object.case;
    if (fixtureCase !== 'healthy' && fixtureCase !== 'low-liquidity' && fixtureCase !== 'stale') {
      throw Object.assign(new TypeError('fixture case is invalid'), { code: 'INVALID_REQUEST' as const });
    }
    return { schemaVersion: STOCKS_AGENT_SCHEMA_VERSION, kind: 'stocks.agent-request', requestId, runId, agentId, mode: 'fixture', case: fixtureCase };
  }
  if (mode === 'snapshot') {
    const allowed = ['schemaVersion', 'kind', 'requestId', 'runId', 'agentId', 'mode', 'snapshot', 'assets', 'integrityMaxAgeMs', 'checkedAt'];
    for (const key of Object.keys(object)) {
      if (!allowed.includes(key)) throw Object.assign(new TypeError('stocks agent snapshot request has unexpected keys'), { code: 'INVALID_REQUEST' as const });
    }
    const snapshot = validateCanonicalBasketSnapshot(freezeDeep(structuredClone(object.snapshot)));
    let assets = STOCKS_DEMO_ASSETS;
    if (object.assets !== undefined) {
      if (!Array.isArray(object.assets) || object.assets.length === 0) throw Object.assign(new TypeError('assets must be a non-empty array'), { code: 'INVALID_REQUEST' as const });
      assets = object.assets as typeof STOCKS_DEMO_ASSETS;
    }
    const integrityMaxAgeMsRaw = object.integrityMaxAgeMs;
    const integrityMaxAgeMs = integrityMaxAgeMsRaw === undefined ? 900_000 : integrityMaxAgeMsRaw;
    if (typeof integrityMaxAgeMs !== 'number' || !Number.isInteger(integrityMaxAgeMs) || integrityMaxAgeMs <= 0) {
      throw Object.assign(new TypeError('integrityMaxAgeMs must be a positive integer'), { code: 'INVALID_REQUEST' as const });
    }
    const checkedAt = object.checkedAt === undefined ? undefined : stringValue(object.checkedAt, 'checkedAt', 64);
    return {
      schemaVersion: STOCKS_AGENT_SCHEMA_VERSION,
      kind: 'stocks.agent-request',
      requestId,
      runId,
      agentId,
      mode: 'snapshot',
      snapshot,
      assets,
      integrityMaxAgeMs,
      checkedAt,
    };
  }
  throw Object.assign(new TypeError('mode must be fixture or snapshot'), { code: 'INVALID_REQUEST' as const });
}

export function stocksAgentError(code: StocksAgentErrorCode, message: string, requestId: string | null = null): StocksAgentError {
  return Object.freeze({
    schemaVersion: STOCKS_AGENT_SCHEMA_VERSION,
    kind: 'stocks.agent-error' as const,
    requestId,
    code,
    message,
    authority: 'advisory-only' as const,
    executionReady: false as const,
  });
}

function demoConfig(checkedAt?: string): StocksHostConfig {
  return {
    assets: STOCKS_DEMO_ASSETS,
    coherenceCapMs: 120_000,
    integrityMaxAgeMs: 900_000,
    provenance: 'synthetic',
    checkedAt,
  };
}

async function fixtureSnapshot(fixtureCase: StocksAgentFixtureCase): Promise<{ snapshot: CanonicalBasketSnapshot; config: StocksHostConfig }> {
  const now = new Date().toISOString();
  if (fixtureCase === 'healthy') {
    const config = demoConfig(now);
    const snapshot = await buildStocksSnapshot(config, fixtureAdapter(stocksDemoValues(now)));
    return { snapshot, config };
  }
  if (fixtureCase === 'low-liquidity') {
    const config = demoConfig(now);
    const snapshot = await buildStocksSnapshot(config, fixtureAdapter(stocksDemoValues(now, true)));
    return { snapshot, config };
  }
  const staleAt = new Date(Date.parse(now) - 3_600_000).toISOString();
  const config = demoConfig(now);
  const snapshot = await buildStocksSnapshot({ ...config, checkedAt: undefined }, fixtureAdapter(stocksDemoValues(staleAt)));
  return { snapshot, config };
}

export async function handleStocksAgentRequest(request: StocksAgentRequest): Promise<StocksAgentResponse> {
  let snapshot: CanonicalBasketSnapshot;
  let config: StocksHostConfig;
  if (request.mode === 'fixture') {
    ({ snapshot, config } = await fixtureSnapshot(request.case));
  } else {
    snapshot = request.snapshot;
    config = {
      assets: request.assets ?? STOCKS_DEMO_ASSETS,
      coherenceCapMs: 120_000,
      integrityMaxAgeMs: request.integrityMaxAgeMs ?? 900_000,
      provenance: snapshot.envelope.provenance,
      checkedAt: request.checkedAt,
    };
  }

  const adviceRequest = createStocksAdviceRequest({ requestId: request.requestId, runId: request.runId, snapshot });
  const advice = validateStocksAdviceResponse(await invokeStocksAdvice(createStocksHostBoundary(config), adviceRequest));
  const integrity = evaluateMarketIntegrity({
    snapshot,
    proposal: advice.proposal,
    checkedAt: config.checkedAt ?? new Date().toISOString(),
    maxAgeMs: config.integrityMaxAgeMs ?? 900_000,
  });

  return Object.freeze({
    schemaVersion: STOCKS_AGENT_SCHEMA_VERSION,
    kind: 'stocks.agent-response' as const,
    requestId: request.requestId,
    runId: request.runId,
    agentId: request.agentId,
    advice,
    integrity,
    authority: 'advisory-only' as const,
    executionReady: false as const,
  });
}

export function serializeStocksAgentResult(result: StocksAgentResult): string {
  const text = `${JSON.stringify(result)}\n`;
  if (Buffer.byteLength(text, 'utf8') > STOCKS_AGENT_MAX_RESPONSE_BYTES) {
    const fallback = stocksAgentError('RESPONSE_TOO_LARGE', 'advisory response exceeds 64 KiB', result.requestId);
    return `${JSON.stringify(fallback)}\n`;
  }
  return text;
}

export function newStocksAgentIds(): { requestId: string; runId: string } {
  return { requestId: randomUUID(), runId: `run-${createHash('sha256').update(randomUUID()).digest('hex').slice(0, 12)}` };
}
