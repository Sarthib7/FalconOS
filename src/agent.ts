import { createHash, randomUUID } from 'node:crypto';
import { lstat, open } from 'node:fs/promises';
import { join, normalize, parse, relative, resolve } from 'node:path';
import type { Candidate, Chain, Cycle, Observation, Scan } from './types.ts';
import { assess } from './scan.ts';

export type AgentRoute = 'solana-base' | 'base-solana';
export type AgentOrigin = 'fixture' | 'codex';

const ROUTE_CHAINS: Record<AgentRoute, readonly [Chain, Chain]> = {
  'solana-base': ['solana', 'base'],
  'base-solana': ['base', 'solana'],
};

export const MAX_NOTES = 8;
export const MAX_NOTE_BYTES = 32 * 1024;
export const MAX_REQUEST_BYTES = 8 * 1024 * 1024;
export const MAX_THESIS_BYTES = 64 * 1024;
export const THESIS_TTL_MS = 5 * 60 * 1000;

const UUID_V4 = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
const INTEGER = /^[1-9]\d{0,19}$/;
const SHA256 = /^[a-f0-9]{64}$/;
const ASSET_SCALE_VERIFICATION = 'historically verified by RPC capture on 2026-09-05; runtime metadata revalidation not performed';

export interface AgentRequest {
  schemaVersion: 1;
  requestId: string;
  evaluationAt: string;
  sourceCutoff: string;
  route: AgentRoute;
  task: string;
  evidence: Array<{
    id: string;
    path: string;
    sha256: string;
    scan: Scan;
  }>;
  notes: Array<{
    path: string;
    sha256: string;
    text: string;
    trust: 'untrusted-note';
  }>;
}

export interface AgentThesis {
  schemaVersion: 1;
  requestId: string;
  route: AgentRoute;
  fixture: boolean;
  status: Candidate['status'];
  thesis: string;
  citations: Array<{
    evidenceId: string;
    path: string;
    sha256: string;
    assessedAt: string;
    supports: string;
  }>;
  invalidationConditions: string[];
  expiresAt: string;
  missingEvidence: string[];
  executionReady: false;
}

export interface AgentExecution {
  requestedModel: 'gpt-5.6-luna';
  requestedReasoningEffort: 'max';
  exitCode: number;
  signal: null;
  durationMs: number;
  timedOut: false;
}

export interface AgentRunRecord {
  schemaVersion: 1;
  origin: AgentOrigin;
  bundleCapturedAt: string;
  request: AgentRequest;
  response: AgentThesis;
  execution?: AgentExecution;
}

export interface BuildAgentRequestOptions {
  dataDirectory: string;
  evidencePath: string;
  expectedEvidenceSha256: string;
  notePaths?: readonly string[];
  route: AgentRoute;
  task: string;
  cutoff: string | 'now';
  now?: () => Date;
  requestId?: string;
}

export interface AgentBundle {
  request: AgentRequest;
  bundleCapturedAt: string;
}

export interface AgentTransportResult {
  response: unknown;
  execution: AgentExecution;
}

export type AgentTransport = (request: AgentRequest, signal?: AbortSignal) => Promise<unknown | AgentTransportResult>;

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

function isTransportResult(value: unknown): value is AgentTransportResult {
  return isRecord(value) && 'response' in value && 'execution' in value;
}

function validateExecution(value: unknown): AgentExecution {
  if (!isRecord(value)) throw new Error('Agent execution metadata is invalid');
  exactKeys(value, ['requestedModel', 'requestedReasoningEffort', 'exitCode', 'signal', 'durationMs', 'timedOut'], 'Agent execution metadata');
  if (value.requestedModel !== 'gpt-5.6-luna' || value.requestedReasoningEffort !== 'max') throw new Error('Agent execution request metadata is invalid');
  if (value.exitCode !== 0 || value.signal !== null || value.timedOut !== false) throw new Error('Agent execution did not complete successfully');
  if (typeof value.durationMs !== 'number' || !Number.isSafeInteger(value.durationMs) || value.durationMs < 0) throw new Error('Agent execution duration is invalid');
  return {
    requestedModel: 'gpt-5.6-luna',
    requestedReasoningEffort: 'max',
    exitCode: 0,
    signal: null,
    durationMs: value.durationMs,
    timedOut: false,
  };
}

function isoTime(value: unknown, name: string): number {
  if (typeof value !== 'string') throw new Error(`${name} must be an ISO timestamp`);
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,3}))?Z$/.exec(value);
  if (!match) throw new Error(`${name} must be an ISO timestamp`);
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const hour = Number(match[4]);
  const minute = Number(match[5]);
  const second = Number(match[6]);
  const millisecond = Number((match[7] ?? '').padEnd(3, '0'));
  const date = new Date(0);
  date.setUTCFullYear(year, month - 1, day);
  date.setUTCHours(hour, minute, second, millisecond);
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day
    || date.getUTCHours() !== hour || date.getUTCMinutes() !== minute || date.getUTCSeconds() !== second
    || date.getUTCMilliseconds() !== millisecond) {
    throw new Error(`${name} must be an ISO timestamp`);
  }
  return date.getTime();
}

function nowTime(now: () => Date): {time: number; iso: string} {
  const current = now();
  const time = current.getTime();
  if (!Number.isFinite(time)) throw new Error('Clock returned an invalid date');
  return {time, iso: new Date(time).toISOString()};
}

function stringValue(value: unknown, name: string, maxBytes = MAX_THESIS_BYTES): string {
  if (typeof value !== 'string' || value.length === 0 || value.includes('\u0000')) throw new Error(`${name} must be a non-empty string`);
  if (Buffer.byteLength(value, 'utf8') > maxBytes) throw new Error(`${name} is too large`);
  return value;
}

function safeRelativePath(value: string, name: string): string {
  if (typeof value !== 'string' || value.length === 0 || value.includes('\u0000') || value.startsWith('/') || /^[a-zA-Z]:[\\/]/.test(value)) {
    throw new Error(`${name} must be a relative path`);
  }
  const slashPath = value.replaceAll('\\', '/');
  if (slashPath.split('/').some(component => component === '..')) throw new Error(`${name} cannot contain ..`);
  const normalized = normalize(slashPath).replaceAll('\\', '/');
  if (normalized === '.' || normalized.startsWith('../') || normalized.includes('/../')) throw new Error(`${name} is outside the bundle`);
  return normalized;
}

function chain(value: unknown, name: string): Chain {
  if (value !== 'solana' && value !== 'base') throw new Error(`${name} has an unsupported chain`);
  return value;
}

function asset(value: unknown, name: string): 'USDC' | 'EURC' {
  if (value !== 'USDC' && value !== 'EURC') throw new Error(`${name} has an unsupported asset`);
  return value;
}

function amount(value: unknown, name: string): string {
  if (typeof value !== 'string' || !INTEGER.test(value)) throw new Error(`${name} must be a positive integer amount`);
  return value;
}

function validateObservation(value: unknown, name: string): Observation {
  if (!isRecord(value)) throw new Error(`${name} must be an observation`);
  exactKeys(value, ['request', 'requestUrl', 'startedAt', 'receivedAt', 'httpStatus', 'raw', 'quote', 'error'], name);
  const request = value.request;
  if (!isRecord(request)) throw new Error(`${name}.request must be an object`);
  exactKeys(request, ['chain', 'inputAsset', 'outputAsset', 'amount'], `${name}.request`);
  chain(request.chain, `${name}.request.chain`);
  asset(request.inputAsset, `${name}.request.inputAsset`);
  asset(request.outputAsset, `${name}.request.outputAsset`);
  amount(request.amount, `${name}.request.amount`);
  stringValue(value.requestUrl, `${name}.requestUrl`, 4096);
  const startedAt = isoTime(value.startedAt, `${name}.startedAt`);
  const receivedAt = isoTime(value.receivedAt, `${name}.receivedAt`);
  if (receivedAt < startedAt) throw new Error(`${name}.receivedAt precedes startedAt`);
  if (value.httpStatus !== null && (typeof value.httpStatus !== 'number' || !Number.isInteger(value.httpStatus))) {
    throw new Error(`${name}.httpStatus must be a number or null`);
  }
  if (value.error !== null) stringValue(value.error, `${name}.error`, 4096);
  if (value.quote !== null) {
    if (!isRecord(value.quote)) throw new Error(`${name}.quote must be an object or null`);
    exactKeys(value.quote, ['inAmount', 'outAmount', 'gasUsd', 'l1FeeUsd', 'providerTimestamp', 'expiresAt'], `${name}.quote`);
    amount(value.quote.inAmount, `${name}.quote.inAmount`);
    amount(value.quote.outAmount, `${name}.quote.outAmount`);
    for (const key of ['gasUsd', 'l1FeeUsd'] as const) {
      if (value.quote[key] !== null) stringValue(value.quote[key], `${name}.quote.${key}`, 256);
    }
    for (const key of ['providerTimestamp', 'expiresAt'] as const) {
      if (value.quote[key] !== null) isoTime(value.quote[key], `${name}.quote.${key}`);
    }
  }
  return value as unknown as Observation;
}

function validateCycle(value: unknown, name: string): Cycle {
  if (!isRecord(value)) throw new Error(`${name} must be a cycle`);
  exactKeys(value, ['sourceChain', 'destinationChain', 'legs'], name);
  const sourceChain = chain(value.sourceChain, `${name}.sourceChain`);
  const destinationChain = chain(value.destinationChain, `${name}.destinationChain`);
  if (sourceChain === destinationChain) throw new Error(`${name} must cross chains`);
  if (!Array.isArray(value.legs) || value.legs.length < 1 || value.legs.length > 2) throw new Error(`${name}.legs must contain one or two observations`);
  const legs = value.legs.map((leg, index) => validateObservation(leg, `${name}.legs[${index}]`));
  return {sourceChain, destinationChain, legs};
}

function validateCandidate(value: unknown, name: string, expectedGasEntries?: number): Candidate {
  if (!isRecord(value)) throw new Error(`${name} must be a candidate`);
  exactKeys(value, ['sourceChain', 'destinationChain', 'status', 'reasons', 'inputUsdc', 'intermediateEurc', 'outputUsdc', 'quotedDeltaUsdc', 'gasEstimatesUsd', 'netProfitUsdc', 'executionReady'], name);
  const sourceChain = chain(value.sourceChain, `${name}.sourceChain`);
  const destinationChain = chain(value.destinationChain, `${name}.destinationChain`);
  if (value.status !== 'REJECT' && value.status !== 'REVIEW' && value.status !== 'UNAVAILABLE') throw new Error(`${name}.status is invalid`);
  if (!Array.isArray(value.reasons) || value.reasons.length === 0 || value.reasons.some(reason => typeof reason !== 'string' || reason.length === 0)) throw new Error(`${name}.reasons is invalid`);
  for (const key of ['inputUsdc', 'intermediateEurc', 'outputUsdc', 'quotedDeltaUsdc'] as const) {
    if (value[key] !== null) stringValue(value[key], `${name}.${key}`, 256);
  }
  if (!Array.isArray(value.gasEstimatesUsd) || value.gasEstimatesUsd.length < 1 || value.gasEstimatesUsd.length > 2
    || (expectedGasEntries !== undefined && value.gasEstimatesUsd.length !== expectedGasEntries)) {
    throw new Error(`${name}.gasEstimatesUsd is invalid`);
  }
  for (const [index, fee] of value.gasEstimatesUsd.entries()) {
    if (!isRecord(fee)) throw new Error(`${name}.gasEstimatesUsd[${index}] is invalid`);
    exactKeys(fee, ['chain', 'gas', 'l1Fee'], `${name}.gasEstimatesUsd[${index}]`);
    chain(fee.chain, `${name}.gasEstimatesUsd[${index}].chain`);
    if (fee.gas !== null) stringValue(fee.gas, `${name}.gasEstimatesUsd[${index}].gas`, 256);
    if (fee.l1Fee !== null) stringValue(fee.l1Fee, `${name}.gasEstimatesUsd[${index}].l1Fee`, 256);
  }
  if (value.netProfitUsdc !== null) throw new Error(`${name}.netProfitUsdc must remain unknown`);
  if (value.executionReady !== false) throw new Error(`${name}.executionReady must remain false`);
  return value as unknown as Candidate;
}

function candidateEqual(actual: Candidate, expected: Candidate): boolean {
  return actual.sourceChain === expected.sourceChain
    && actual.destinationChain === expected.destinationChain
    && actual.status === expected.status
    && JSON.stringify(actual.reasons) === JSON.stringify(expected.reasons)
    && actual.inputUsdc === expected.inputUsdc
    && actual.intermediateEurc === expected.intermediateEurc
    && actual.outputUsdc === expected.outputUsdc
    && actual.quotedDeltaUsdc === expected.quotedDeltaUsdc
    && JSON.stringify(actual.gasEstimatesUsd) === JSON.stringify(expected.gasEstimatesUsd)
    && actual.netProfitUsdc === expected.netProfitUsdc
    && actual.executionReady === expected.executionReady;
}

export function validateScan(value: unknown): Scan {
  if (!isRecord(value)) throw new Error('Evidence must contain a Scan object');
  exactKeys(value, ['schemaVersion', 'id', 'mode', 'assessedAt', 'cycles', 'amountScale', 'candidates'], 'Scan');
  if (value.schemaVersion !== 1) throw new Error('Scan schemaVersion is unsupported');
  if (typeof value.id !== 'string' || !UUID_V4.test(value.id)) throw new Error('Scan id is invalid');
  if (value.mode !== 'live' && value.mode !== 'demo') throw new Error('Scan mode is invalid');
  const assessedAt = isoTime(value.assessedAt, 'Scan.assessedAt');
  if (!Array.isArray(value.cycles) || value.cycles.length === 0) throw new Error('Scan.cycles is invalid');
  const cycles = value.cycles.map((cycle, index) => validateCycle(cycle, `Scan.cycles[${index}]`));
  for (const [cycleIndex, cycle] of cycles.entries()) {
    for (const [legIndex, leg] of cycle.legs.entries()) {
      if (isoTime(leg.startedAt, `Scan.cycles[${cycleIndex}].legs[${legIndex}].startedAt`) > assessedAt
        || isoTime(leg.receivedAt, `Scan.cycles[${cycleIndex}].legs[${legIndex}].receivedAt`) > assessedAt) {
        throw new Error('Observation is newer than Scan assessment');
      }
    }
  }
  if (!isRecord(value.amountScale)) throw new Error('Scan.amountScale is invalid');
  exactKeys(value.amountScale, ['decimals', 'verification'], 'Scan.amountScale');
  if (value.amountScale.decimals !== 6 || value.amountScale.verification !== ASSET_SCALE_VERIFICATION) throw new Error('Scan.amountScale is invalid');
  if (!Array.isArray(value.candidates) || value.candidates.length !== cycles.length) throw new Error('Scan.candidates must match cycles');
  const candidates = value.candidates.map((candidate, index) => validateCandidate(candidate, `Scan.candidates[${index}]`, cycles[index]!.legs.length));
  const expectedCandidates = cycles.map(cycle => assess(cycle, new Date(assessedAt)));
  if (candidates.some((candidate, index) => !candidateEqual(candidate, expectedCandidates[index]!))) throw new Error('Scan candidate does not match its cycle');
  return {
    schemaVersion: 1,
    id: value.id,
    mode: value.mode,
    assessedAt: new Date(assessedAt).toISOString(),
    cycles,
    amountScale: {decimals: 6, verification: ASSET_SCALE_VERIFICATION},
    candidates,
  };
}

export function routeForChains(sourceChain: Chain, destinationChain: Chain): AgentRoute {
  if (sourceChain === 'solana' && destinationChain === 'base') return 'solana-base';
  if (sourceChain === 'base' && destinationChain === 'solana') return 'base-solana';
  throw new Error('Route must cross Solana and Base');
}

export function selectRoute(scan: Scan, route: AgentRoute): {cycle: Cycle; candidate: Candidate} {
  if (route !== 'solana-base' && route !== 'base-solana') throw new Error('Route must be solana-base or base-solana');
  const [sourceChain, destinationChain] = ROUTE_CHAINS[route];
  const cycles = scan.cycles.filter(cycle => cycle.sourceChain === sourceChain && cycle.destinationChain === destinationChain);
  const candidates = scan.candidates.filter(candidate => candidate.sourceChain === sourceChain && candidate.destinationChain === destinationChain);
  if (cycles.length !== 1 || candidates.length !== 1) throw new Error(`Route ${route} must match exactly one cycle and candidate`);
  return {cycle: cycles[0]!, candidate: candidates[0]!};
}

function validateScanCutoff(scan: Scan, cutoff: number): void {
  if (isoTime(scan.assessedAt, 'Scan.assessedAt') > cutoff) throw new Error('Scan assessment is newer than source cutoff');
  for (const [cycleIndex, cycle] of scan.cycles.entries()) {
    for (const [legIndex, leg] of cycle.legs.entries()) {
      if (isoTime(leg.startedAt, `Scan.cycles[${cycleIndex}].legs[${legIndex}].startedAt`) > cutoff
        || isoTime(leg.receivedAt, `Scan.cycles[${cycleIndex}].legs[${legIndex}].receivedAt`) > cutoff) {
        throw new Error('Observation is newer than source cutoff');
      }
      if (leg.quote?.providerTimestamp && isoTime(leg.quote.providerTimestamp, 'providerTimestamp') > cutoff) {
        throw new Error('Provider timestamp is newer than source cutoff');
      }
    }
  }
}

async function realDirectory(directory: string, name: string): Promise<string> {
  const absoluteRoot = resolve(directory);
  const root = parse(absoluteRoot).root;
  let current = root;
  for (const component of absoluteRoot.slice(root.length).split('/').filter(Boolean)) {
    current = join(current, component);
    const stat = await lstat(current).catch(() => undefined);
    if (!stat || stat.isSymbolicLink() || !stat.isDirectory()) throw new Error(`${name} must be a real directory`);
  }
  return absoluteRoot;
}

async function existingFile(root: string, relativePath: string, name: string): Promise<string> {
  const safePath = safeRelativePath(relativePath, name);
  const absoluteRoot = await realDirectory(root, 'Bundle root');
  let current = absoluteRoot;
  const components = safePath.split('/');
  for (const [index, component] of components.entries()) {
    current = join(current, component);
    const stat = await lstat(current).catch(() => undefined);
    if (!stat) throw new Error(`${name} does not exist`);
    if (stat.isSymbolicLink()) throw new Error(`${name} cannot use symlinks`);
    if (index < components.length - 1 && !stat.isDirectory()) throw new Error(`${name} has a non-directory parent`);
  }
  const pathFromRoot = relative(absoluteRoot, current);
  if (pathFromRoot.startsWith('..') || !pathFromRoot || !(await lstat(current)).isFile()) throw new Error(`${name} must be a regular file`);
  return current;
}

async function readBounded(filePath: string, limit: number, name: string): Promise<Buffer> {
  const handle = await open(filePath, 'r');
  try {
    const chunks: Buffer[] = [];
    let total = 0;
    while (total <= limit) {
      const size = Math.min(64 * 1024, limit + 1 - total);
      const buffer = Buffer.alloc(size);
      const {bytesRead} = await handle.read(buffer, 0, size, null);
      if (bytesRead === 0) break;
      chunks.push(buffer.subarray(0, bytesRead));
      total += bytesRead;
      if (total > limit) throw new Error(`${name} exceeds its size limit`);
    }
    return Buffer.concat(chunks, total);
  } finally {
    await handle.close();
  }
}

function parseJson(bytes: Buffer, name: string): unknown {
  try {
    return JSON.parse(bytes.toString('utf8')) as unknown;
  } catch {
    throw new Error(`${name} is not valid JSON`);
  }
}

function sha256(bytes: Buffer): string {
  return createHash('sha256').update(bytes).digest('hex');
}

export async function buildAgentRequest(options: BuildAgentRequestOptions): Promise<AgentBundle> {
  if (options.route !== 'solana-base' && options.route !== 'base-solana') throw new Error('Route must be solana-base or base-solana');
  const task = stringValue(options.task, 'Task', 16 * 1024);
  const expectedHash = options.expectedEvidenceSha256;
  if (typeof expectedHash !== 'string' || !SHA256.test(expectedHash)) throw new Error('Expected evidence SHA-256 is invalid');
  const requestId = options.requestId ?? randomUUID();
  if (!UUID_V4.test(requestId)) throw new Error('Request ID is invalid');
  const evidencePath = safeRelativePath(options.evidencePath, 'Evidence path');
  const evidenceFile = await existingFile(options.dataDirectory, evidencePath, 'Evidence path');
  const evidenceBytes = await readBounded(evidenceFile, MAX_REQUEST_BYTES, 'Evidence file');
  const actualHash = sha256(evidenceBytes);
  if (actualHash !== expectedHash) throw new Error('Evidence SHA-256 does not match the caller-provided value');
  const scan = validateScan(parseJson(evidenceBytes, 'Evidence file'));
  const notePaths = options.notePaths ?? [];
  if (notePaths.length > MAX_NOTES) throw new Error(`At most ${MAX_NOTES} notes are allowed`);
  const notes: AgentRequest['notes'] = [];
  const seenNotes = new Set<string>();
  for (const notePathInput of notePaths) {
    const notePath = safeRelativePath(notePathInput, 'Note path');
    if (seenNotes.has(notePath)) throw new Error('Duplicate note path');
    seenNotes.add(notePath);
    const noteFile = await existingFile(options.dataDirectory, notePath, 'Note path');
    const noteBytes = await readBounded(noteFile, MAX_NOTE_BYTES, 'Note file');
    let text: string;
    try { text = new TextDecoder('utf-8', {fatal: true}).decode(noteBytes); } catch { throw new Error('Note file is not valid UTF-8'); }
    notes.push({path: notePath, sha256: sha256(noteBytes), text, trust: 'untrusted-note'});
  }
  const clock = nowTime(options.now ?? (() => new Date()));
  const cutoffTime = options.cutoff === 'now' ? clock.time : isoTime(options.cutoff, 'Source cutoff');
  if (cutoffTime > clock.time) throw new Error('Source cutoff cannot be later than evaluation time');
  if (cutoffTime < clock.time && notes.length > 0) throw new Error('Explicit source cutoff precedes the current note snapshot');
  validateScanCutoff(scan, cutoffTime);
  selectRoute(scan, options.route);
  const request: AgentRequest = {
    schemaVersion: 1,
    requestId,
    evaluationAt: clock.iso,
    sourceCutoff: new Date(cutoffTime).toISOString(),
    route: options.route,
    task,
    evidence: [{id: scan.id, path: evidencePath, sha256: expectedHash, scan}],
    notes,
  };
  if (Buffer.byteLength(JSON.stringify(request), 'utf8') > MAX_REQUEST_BYTES) throw new Error(`Agent request exceeds ${MAX_REQUEST_BYTES} bytes`);
  return {request, bundleCapturedAt: clock.iso};
}

function responseKeys(value: Record<string, unknown>): void {
  exactKeys(value, ['schemaVersion', 'requestId', 'route', 'fixture', 'status', 'thesis', 'citations', 'invalidationConditions', 'expiresAt', 'missingEvidence', 'executionReady'], 'Agent thesis');
}

function selectedQuoteExpiry(request: AgentRequest): number | undefined {
  const {cycle} = selectRoute(request.evidence[0]!.scan, request.route);
  const expiries = cycle.legs.flatMap(leg => leg.quote?.expiresAt ? [isoTime(leg.quote.expiresAt, 'Quote expiry')] : []);
  return expiries.length ? Math.min(...expiries) : undefined;
}

export function validateAgentThesis(value: unknown, request: AgentRequest, origin: AgentOrigin, completionAt?: string): AgentThesis {
  if (origin !== 'fixture' && origin !== 'codex') throw new Error('Agent origin is invalid');
  if (!isRecord(value)) throw new Error('Agent response must be one JSON object');
  let responseBytes: number;
  try {
    responseBytes = Buffer.byteLength(JSON.stringify(value), 'utf8');
  } catch {
    throw new Error('Agent response is not serializable JSON');
  }
  if (responseBytes > MAX_THESIS_BYTES) throw new Error(`Agent response exceeds ${MAX_THESIS_BYTES} bytes`);
  responseKeys(value);
  if (value.schemaVersion !== 1) throw new Error('Agent response schemaVersion is unsupported');
  if (value.requestId !== request.requestId) throw new Error('Agent response requestId does not match');
  if (value.route !== request.route) throw new Error('Agent response route does not match');
  if (typeof value.fixture !== 'boolean') throw new Error('Agent response fixture must be boolean');
  if (value.status !== 'REJECT' && value.status !== 'REVIEW' && value.status !== 'UNAVAILABLE') throw new Error('Agent response status is invalid');
  const status = value.status as Candidate['status'];
  const selected = selectRoute(request.evidence[0]!.scan, request.route);
  if (selected.candidate.status !== 'REVIEW' && status !== selected.candidate.status) {
    throw new Error('Agent response cannot override a deterministic rejection or unavailable source');
  }
  if (selected.candidate.status === 'REVIEW' && status === 'UNAVAILABLE') {
    throw new Error('Agent response cannot mark a reviewed source unavailable');
  }
  const thesis = stringValue(value.thesis, 'Agent thesis', MAX_THESIS_BYTES);
  if (!Array.isArray(value.citations) || value.citations.length === 0 || value.citations.length > 8) throw new Error('Agent response citations are invalid');
  const evidenceById = new Map(request.evidence.map(entry => [entry.id, entry]));
  const citations: AgentThesis['citations'] = [];
  for (const [index, citation] of value.citations.entries()) {
    if (!isRecord(citation)) throw new Error(`Agent citation ${index + 1} is invalid`);
    exactKeys(citation, ['evidenceId', 'path', 'sha256', 'assessedAt', 'supports'], `Agent citation ${index + 1}`);
    const evidenceId = stringValue(citation.evidenceId, `Agent citation ${index + 1}.evidenceId`, 256);
    const path = stringValue(citation.path, `Agent citation ${index + 1}.path`, 4096);
    const sha256 = stringValue(citation.sha256, `Agent citation ${index + 1}.sha256`, 256);
    const assessedAt = stringValue(citation.assessedAt, `Agent citation ${index + 1}.assessedAt`, 128);
    const supports = stringValue(citation.supports, `Agent citation ${index + 1}.supports`, 16 * 1024);
    const evidence = evidenceById.get(evidenceId);
    if (!evidence || path !== evidence.path || sha256 !== evidence.sha256 || assessedAt !== evidence.scan.assessedAt) {
      throw new Error(`Agent citation ${index + 1} does not match evidence`);
    }
    citations.push({evidenceId, path, sha256, assessedAt, supports});
  }
  if (!Array.isArray(value.invalidationConditions) || value.invalidationConditions.length === 0 || value.invalidationConditions.length > 16) throw new Error('Agent invalidation conditions are invalid');
  const invalidationConditions = value.invalidationConditions.map((condition, index) => stringValue(condition, `Agent invalidationConditions[${index}]`, 4096));
  const evaluationAt = isoTime(request.evaluationAt, 'Request evaluationAt');
  const expiresAt = isoTime(value.expiresAt, 'Agent expiresAt');
  if (expiresAt <= evaluationAt || expiresAt > evaluationAt + THESIS_TTL_MS) throw new Error('Agent thesis expiry must be within five minutes after evaluation');
  const acceptanceAt = completionAt === undefined ? evaluationAt : Math.max(evaluationAt, isoTime(completionAt, 'Agent completionAt'));
  if (expiresAt <= acceptanceAt) throw new Error('Agent thesis expired before validation');
  const quoteExpiry = selectedQuoteExpiry(request);
  if (quoteExpiry !== undefined && (quoteExpiry <= evaluationAt || expiresAt > quoteExpiry)) throw new Error('Agent thesis expiry exceeds quote validity');
  if (!Array.isArray(value.missingEvidence) || value.missingEvidence.length > 32) throw new Error('Agent missingEvidence is invalid');
  const missingEvidence = value.missingEvidence.map((item, index) => stringValue(item, `Agent missingEvidence[${index}]`, 4096));
  if (value.executionReady !== false) throw new Error('Agent response cannot authorize execution');
  const syntheticEvidence = request.evidence.some(entry => entry.scan.mode === 'demo');
  if ((origin === 'fixture' || syntheticEvidence) && value.fixture !== true) {
    throw new Error('Agent response fixture must be true for fixture transport or demo evidence');
  }
  const fixture = origin === 'fixture' || syntheticEvidence;
  return {
    schemaVersion: 1,
    requestId: request.requestId,
    route: request.route,
    fixture,
    status,
    thesis,
    citations,
    invalidationConditions,
    expiresAt: new Date(expiresAt).toISOString(),
    missingEvidence,
    executionReady: false,
  };
}

export function fixtureAgent(request: AgentRequest): AgentThesis {
  const {candidate} = selectRoute(request.evidence[0]!.scan, request.route);
  const evidence = request.evidence[0]!;
  const evaluationAt = isoTime(request.evaluationAt, 'Request evaluationAt');
  const quoteExpiry = selectedQuoteExpiry(request);
  const expiry = Math.min(evaluationAt + THESIS_TTL_MS, quoteExpiry ?? Number.POSITIVE_INFINITY);
  if (!Number.isFinite(expiry) || expiry <= evaluationAt) throw new Error('Selected quote validity does not extend beyond evaluation');
  const expiresAt = new Date(expiry).toISOString();
  return {
    schemaVersion: 1,
    requestId: request.requestId,
    route: request.route,
    fixture: true,
    status: candidate.status,
    thesis: `Fixture response for ${request.route}. The selected candidate is ${candidate.status}. This is a deterministic transport result, not a real agent decision.`,
    citations: [{
      evidenceId: evidence.id,
      path: evidence.path,
      sha256: evidence.sha256,
      assessedAt: evidence.scan.assessedAt,
      supports: `The ${request.route} candidate has status ${candidate.status}.`,
    }],
    invalidationConditions: [
      'A newer scan changes the selected candidate.',
      'The thesis reaches its five-minute expiry.',
      'Required costs, inventory, or fills remain unverified.',
    ],
    expiresAt,
    missingEvidence: ['Agent provenance', 'Complete execution costs, inventory, and fills'],
    executionReady: false,
  };
}

export async function createAgentRun(
  bundle: AgentBundle,
  origin: AgentOrigin,
  transport: AgentTransport | undefined,
  signal?: AbortSignal,
  now: () => Date = () => new Date(),
): Promise<AgentRunRecord> {
  if (origin !== 'fixture' && origin !== 'codex') throw new Error('Agent origin is invalid');
  signal?.throwIfAborted();
  const transportResult = origin === 'fixture'
    ? fixtureAgent(bundle.request)
    : transport
      ? await transport(bundle.request, signal)
      : (() => { throw new Error('Codex transport is not enabled'); })();
  signal?.throwIfAborted();
  const rawResponse = isTransportResult(transportResult) ? transportResult.response : transportResult;
  const execution = isTransportResult(transportResult) ? validateExecution(transportResult.execution) : undefined;
  if (origin === 'codex' && execution === undefined) throw new Error('Codex transport must report execution metadata');
  const response = validateAgentThesis(rawResponse, bundle.request, origin, nowTime(now).iso);
  return {
    schemaVersion: 1,
    origin,
    bundleCapturedAt: bundle.bundleCapturedAt,
    request: bundle.request,
    response,
    ...(execution === undefined ? {} : {execution}),
  };
}
