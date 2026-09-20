import {
  buildAgentRequest,
  createAgentRun,
  MAX_REQUEST_BYTES,
  selectRoute,
  type AgentRoute,
  type AgentRunRecord,
  type AgentTransport,
} from './agent.ts';
import { inputAmount } from '../stablecoins/scan.ts';
import type { PluginAdvisory, PluginError, PluginErrorCode, PluginRequest } from './types.ts';

export const MAX_PLUGIN_OUTPUT_BYTES = 64 * 1024;

const UUID_V4 = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
const SHA256 = /^[a-f0-9]{64}$/;
const MAX_AGENT_ID_BYTES = 256;
const MAX_OBJECTIVE_BYTES = 16 * 1024;
const MAX_PATH_BYTES = 4096;
export class PluginFailure extends Error {
  readonly code: PluginErrorCode;

  constructor(code: PluginErrorCode, message: string) {
    super(message);
    this.name = 'PluginFailure';
    this.code = code;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function exactKeys(value: Record<string, unknown>, keys: readonly string[], name: string): void {
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) {
    throw new Error(`${name} has unexpected fields`);
  }
}

function boundedString(value: unknown, name: string, maxBytes: number): string {
  if (typeof value !== 'string' || value.length === 0 || value.includes('\u0000')) {
    throw new Error(`${name} must be a non-empty string`);
  }
  if (Buffer.byteLength(value, 'utf8') > maxBytes) throw new Error(`${name} is too large`);
  return value;
}

function route(value: unknown, name: string): AgentRoute {
  if (value !== 'solana-base' && value !== 'base-solana') throw new Error(`${name} is invalid`);
  return value;
}

function requestId(value: unknown): string {
  if (typeof value !== 'string' || !UUID_V4.test(value)) throw new Error('requestId is invalid');
  return value;
}

function sourceCutoff(value: unknown): string | 'now' {
  if (value === 'now') return value;
  return boundedString(value, 'sourceCutoff', 128);
}

/** Validate only the public request shape; evidence semantics remain in buildAgentRequest. */
export function validatePluginRequest(value: unknown): PluginRequest {
  if (!isRecord(value)) throw new Error('Plugin request must be one JSON object');
  exactKeys(value, ['schemaVersion', 'requestId', 'agentId', 'intent', 'sourceCutoff', 'evidence', 'notes'], 'Plugin request');
  if (value.schemaVersion !== 1) throw new Error('Plugin request schemaVersion is unsupported');
  const parsedRequestId = requestId(value.requestId);
  const agentId = boundedString(value.agentId, 'agentId', MAX_AGENT_ID_BYTES);
  if (!isRecord(value.intent)) throw new Error('intent must be an object');
  exactKeys(value.intent, ['route', 'amountUsdc', 'objective'], 'intent');
  const parsedRoute = route(value.intent.route, 'intent.route');
  const amountUsdc = boundedString(value.intent.amountUsdc, 'intent.amountUsdc', 64);
  try {
    inputAmount(amountUsdc);
  } catch {
    throw new Error('intent.amountUsdc is invalid');
  }
  const objective = boundedString(value.intent.objective, 'intent.objective', MAX_OBJECTIVE_BYTES);
  const parsedCutoff = sourceCutoff(value.sourceCutoff);
  if (!isRecord(value.evidence)) throw new Error('evidence must be an object');
  exactKeys(value.evidence, ['path', 'sha256'], 'evidence');
  const evidencePath = boundedString(value.evidence.path, 'evidence.path', MAX_PATH_BYTES);
  const evidenceSha256 = value.evidence.sha256;
  if (typeof evidenceSha256 !== 'string' || !SHA256.test(evidenceSha256)) throw new Error('evidence.sha256 is invalid');
  if (!Array.isArray(value.notes) || value.notes.length > 8) throw new Error('notes must contain at most 8 entries');
  const notes = value.notes.map((note, index) => {
    if (!isRecord(note)) throw new Error(`notes[${index}] must be an object`);
    exactKeys(note, ['path'], `notes[${index}]`);
    return {path: boundedString(note.path, `notes[${index}].path`, MAX_PATH_BYTES)};
  });
  return {
    schemaVersion: 1,
    requestId: parsedRequestId,
    agentId,
    intent: {route: parsedRoute, amountUsdc, objective},
    sourceCutoff: parsedCutoff,
    evidence: {path: evidencePath, sha256: evidenceSha256},
    notes,
  };
}

export function validatePluginAdvisory(value: unknown): PluginAdvisory {
  if (!isRecord(value)) throw new Error('Plugin advisory must be one JSON object');
  exactKeys(value, [
    'schemaVersion', 'kind', 'requestId', 'agentId', 'route', 'status', 'fixture',
    'thesis', 'citations', 'invalidationConditions', 'expiresAt', 'missingEvidence',
    'authority', 'executionReady',
  ], 'Plugin advisory');
  if (value.schemaVersion !== 1 || value.kind !== 'advisory') throw new Error('Plugin advisory version or kind is invalid');
  requestId(value.requestId);
  boundedString(value.agentId, 'agentId', MAX_AGENT_ID_BYTES);
  route(value.route, 'route');
  if (value.status !== 'REJECT' && value.status !== 'REVIEW' && value.status !== 'UNAVAILABLE') {
    throw new Error('Plugin advisory status is invalid');
  }
  if (value.fixture !== true) throw new Error('Plugin advisory fixture must be true');
  boundedString(value.thesis, 'thesis', MAX_REQUEST_BYTES);
  if (!Array.isArray(value.citations) || value.citations.length === 0 || value.citations.length > 8) {
    throw new Error('Plugin advisory citations are invalid');
  }
  for (const [index, citation] of value.citations.entries()) {
    if (!isRecord(citation)) throw new Error(`Plugin citation ${index + 1} is invalid`);
    exactKeys(citation, ['evidenceId', 'path', 'sha256', 'assessedAt', 'supports'], `Plugin citation ${index + 1}`);
    requestId(citation.evidenceId);
    boundedString(citation.path, `Plugin citation ${index + 1}.path`, MAX_PATH_BYTES);
    if (typeof citation.sha256 !== 'string' || !SHA256.test(citation.sha256)) throw new Error(`Plugin citation ${index + 1}.sha256 is invalid`);
    boundedString(citation.assessedAt, `Plugin citation ${index + 1}.assessedAt`, 128);
    boundedString(citation.supports, `Plugin citation ${index + 1}.supports`, MAX_OBJECTIVE_BYTES);
  }
  if (!Array.isArray(value.invalidationConditions) || value.invalidationConditions.length === 0 || value.invalidationConditions.length > 16) {
    throw new Error('Plugin advisory invalidationConditions are invalid');
  }
  for (const [index, condition] of value.invalidationConditions.entries()) {
    boundedString(condition, `Plugin advisory invalidationConditions[${index}]`, 4096);
  }
  boundedString(value.expiresAt, 'expiresAt', 128);
  if (!Array.isArray(value.missingEvidence) || value.missingEvidence.length > 32) {
    throw new Error('Plugin advisory missingEvidence is invalid');
  }
  for (const [index, item] of value.missingEvidence.entries()) {
    boundedString(item, `Plugin advisory missingEvidence[${index}]`, 4096);
  }
  if (value.authority !== 'advisory-only') throw new Error('Plugin advisory authority is invalid');
  if (value.executionReady !== false) throw new Error('Plugin advisory cannot authorize execution');
  return value as unknown as PluginAdvisory;
}

export function validatePluginError(value: unknown): PluginError {
  if (!isRecord(value)) throw new Error('Plugin error must be one JSON object');
  exactKeys(value, ['schemaVersion', 'kind', 'requestId', 'code', 'message', 'authority', 'executionReady'], 'Plugin error');
  if (value.schemaVersion !== 1 || value.kind !== 'error') throw new Error('Plugin error version or kind is invalid');
  if (value.requestId !== null) requestId(value.requestId);
  if (value.code !== 'INVALID_JSON' && value.code !== 'INVALID_REQUEST' && value.code !== 'EVIDENCE_INVALID'
    && value.code !== 'ADVISORY_UNAVAILABLE' && value.code !== 'INTERNAL_ERROR') {
    throw new Error('Plugin error code is invalid');
  }
  boundedString(value.message, 'Plugin error message', 512);
  if (value.authority !== 'advisory-only') throw new Error('Plugin error authority is invalid');
  if (value.executionReady !== false) throw new Error('Plugin error cannot authorize execution');
  return value as unknown as PluginError;
}

export async function readPluginInput(source: AsyncIterable<Uint8Array | string>): Promise<unknown> {
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of source) {
    const bytes = typeof chunk === 'string' ? Buffer.from(chunk, 'utf8') : Buffer.from(chunk);
    total += bytes.length;
    if (total > MAX_REQUEST_BYTES) throw new PluginFailure('INVALID_JSON', `Plugin input exceeds ${MAX_REQUEST_BYTES} bytes`);
    chunks.push(bytes);
  }
  let text: string;
  try {
    text = new TextDecoder('utf-8', {fatal: true}).decode(Buffer.concat(chunks, total));
  } catch {
    throw new PluginFailure('INVALID_JSON', 'Plugin input is not valid UTF-8');
  }
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new PluginFailure('INVALID_JSON', 'Plugin input is not valid JSON');
  }
}

function messageOf(error: unknown): string {
  const message = error instanceof Error ? error.message : 'Plugin request failed';
  return message.replace(/[\r\n\u0000-\u001f]/g, ' ').slice(0, 512);
}

function requestIdFrom(value: unknown): string | null {
  if (!isRecord(value) || typeof value.requestId !== 'string' || !UUID_V4.test(value.requestId)) return null;
  return value.requestId;
}

function buildFailure(error: unknown): PluginFailure {
  const message = messageOf(error);
  if (message.startsWith('Source cutoff')) return new PluginFailure('INVALID_REQUEST', message);
  return new PluginFailure('EVIDENCE_INVALID', message);
}

function advisoryFrom(record: AgentRunRecord, agentId: string): PluginAdvisory {
  const response = record.response;
  return validatePluginAdvisory({
    schemaVersion: 1,
    kind: 'advisory',
    requestId: response.requestId,
    agentId,
    route: response.route,
    status: response.status,
    fixture: response.fixture,
    thesis: response.thesis,
    citations: response.citations,
    invalidationConditions: response.invalidationConditions,
    expiresAt: response.expiresAt,
    missingEvidence: response.missingEvidence,
    authority: 'advisory-only',
    executionReady: false,
  });
}

export interface PluginDependencies {
  dataDirectory: string;
  agentTransport?: AgentTransport;
  buildAgentRequest?: typeof buildAgentRequest;
  createAgentRun?: typeof createAgentRun;
  now?: () => Date;
}

export async function handlePluginRequest(value: unknown, dependencies: PluginDependencies): Promise<PluginAdvisory> {
  let request: PluginRequest;
  try {
    request = validatePluginRequest(value);
  } catch (error) {
    throw new PluginFailure('INVALID_REQUEST', messageOf(error));
  }
  const build = dependencies.buildAgentRequest ?? buildAgentRequest;
  let bundle;
  try {
    bundle = await build({
      dataDirectory: dependencies.dataDirectory,
      evidencePath: request.evidence.path,
      expectedEvidenceSha256: request.evidence.sha256,
      notePaths: request.notes.map(note => note.path),
      route: request.intent.route,
      task: request.intent.objective,
      cutoff: request.sourceCutoff,
      requestId: request.requestId,
      now: dependencies.now,
    });
  } catch (error) {
    throw buildFailure(error);
  }
  try {
    const expectedAmount = inputAmount(request.intent.amountUsdc);
    const selected = selectRoute(bundle.request.evidence[0]!.scan, request.intent.route);
    const firstLegAmount = selected.cycle.legs[0]?.request.amount;
    if (firstLegAmount === undefined || firstLegAmount !== expectedAmount) {
      throw new Error('Request amount does not match selected evidence cycle');
    }
  } catch (error) {
    const message = messageOf(error);
    if (message === 'Request amount does not match selected evidence cycle') {
      throw new PluginFailure('INVALID_REQUEST', message);
    }
    throw new PluginFailure('EVIDENCE_INVALID', message);
  }
  if (dependencies.agentTransport === undefined) {
    throw new PluginFailure('ADVISORY_UNAVAILABLE', 'Host transport is unavailable');
  }
  const run = dependencies.createAgentRun ?? createAgentRun;
  try {
    // Fixture origin is host-selected; the caller supplies no transport or model choice.
    const record = await run(bundle, 'fixture', dependencies.agentTransport, undefined, dependencies.now);
    return advisoryFrom(record, request.agentId);
  } catch {
    throw new PluginFailure('ADVISORY_UNAVAILABLE', 'Host transport failed');
  }
}

export function errorResponse(error: unknown, requestValue: unknown): PluginError {
  const failure = error instanceof PluginFailure
    ? error
    : new PluginFailure('INTERNAL_ERROR', 'Plugin host failure');
  return validatePluginError({
    schemaVersion: 1,
    kind: 'error',
    requestId: requestIdFrom(requestValue),
    code: failure.code,
    message: messageOf(failure),
    authority: 'advisory-only',
    executionReady: false,
  });
}

export interface PluginRunResult {
  response: PluginAdvisory | PluginError;
  exitCode: 0 | 1 | 2;
}
export async function runPlugin(
  source: AsyncIterable<Uint8Array | string>,
  dependencies: PluginDependencies,
): Promise<PluginRunResult> {
  let requestValue: unknown = null;
  try {
    requestValue = await readPluginInput(source);
    const response = await handlePluginRequest(requestValue, dependencies);
    if (Buffer.byteLength(JSON.stringify(response), 'utf8') > MAX_PLUGIN_OUTPUT_BYTES) {
      throw new PluginFailure('INTERNAL_ERROR', `Plugin response exceeds ${MAX_PLUGIN_OUTPUT_BYTES} bytes`);
    }
    return {response, exitCode: 0};
  } catch (error) {
    const response = errorResponse(error, requestValue);
    return {response, exitCode: response.code === 'INTERNAL_ERROR' ? 1 : 2};
  }
}
