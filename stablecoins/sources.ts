import { setTimeout as sleep } from 'node:timers/promises';
import type { Asset, Chain, Cycle, Observation, ObservationFailure, Quote, QuoteRequest } from '../src/types.ts';

// A historical RPC capture on 2026-09-05 verified these addresses and six-decimal metadata.
// Runtime metadata is not revalidated.
export const ASSETS: Record<Chain, Record<Asset, string>> = {
  solana: {
    USDC: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
    EURC: 'HzwqbKZw8HxMN6bF2yFZNrht3c2iXXzpKcFu7uBEDKtr',
  },
  base: {
    USDC: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
    EURC: '0x60a3E35Cc302bFA44Cb288Bc5a4F316Fdb1adb42',
  },
};

const MAX_BODY_BYTES = 2 * 1024 * 1024;
const REQUEST_TIMEOUT_MS = 12_000;
const JUPITER_INTERVAL_MS = 2_200;
const MAX_TRANSPORT_ERROR_LENGTH = 240;

const DNS_ERROR_CODES = new Set([
  'EAI_AGAIN', 'EAI_FAIL', 'EAI_NODATA', 'EAI_NONAME', 'ENODATA', 'ENOTFOUND', 'ESERVFAIL',
]);
const CONNECTION_ERROR_CODES = new Set([
  'EADDRNOTAVAIL', 'ECONNABORTED', 'ECONNREFUSED', 'ECONNRESET', 'EHOSTUNREACH',
  'ENETDOWN', 'ENETUNREACH', 'ENOTCONN', 'EPIPE', 'ETIMEDOUT', 'UND_ERR_ABORTED',
  'UND_ERR_BODY_TIMEOUT', 'UND_ERR_CONNECT_TIMEOUT', 'UND_ERR_DESTROYED', 'UND_ERR_HEADERS_TIMEOUT',
  'UND_ERR_SOCKET',
]);
const TLS_ERROR_CODES = new Set([
  'CERT_HAS_EXPIRED', 'CERT_NOT_YET_VALID', 'CERT_UNTRUSTED', 'DEPTH_ZERO_SELF_SIGNED_CERT',
  'ERR_TLS_CERT_ALTNAME_INVALID', 'EPROTO', 'SELF_SIGNED_CERT_IN_CHAIN', 'UNABLE_TO_VERIFY_LEAF_SIGNATURE',
]);

function object(value: unknown, field: string): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`Invalid ${field}: expected an object`);
  }
  return value as Record<string, unknown>;
}

function units(value: unknown, field: string): string {
  if (typeof value !== 'string' || !/^[1-9]\d{0,77}$/.test(value)) {
    throw new Error(`Invalid ${field}: expected positive integer units`);
  }
  return value;
}

function decimal(value: unknown, field: string): string | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== 'string' || !/^\d{1,78}(?:\.\d{1,78})?$/.test(value)) {
    throw new Error(`Invalid ${field}: expected a nonnegative decimal string`);
  }
  return value;
}

function epochTimestamp(value: unknown): string | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== 'number' && (typeof value !== 'string' || !/^\d{1,13}$/.test(value))) {
    throw new Error('Invalid provider timestamp');
  }
  const seconds = Number(value);
  const date = new Date(seconds * 1000);
  if (!Number.isSafeInteger(seconds) || seconds <= 0 || !Number.isFinite(date.getTime())) {
    throw new Error('Invalid provider timestamp');
  }
  // Provider epoch is retained, but does not prove a synchronized market snapshot.
  return date.toISOString();
}

function expiry(value: unknown): string | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== 'string' || !/^\d{4}-\d\d-\d\dT.+(?:Z|[+-]\d\d:\d\d)$/.test(value)) {
    throw new Error('Invalid quote expiry');
  }
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) throw new Error('Invalid quote expiry');
  return date.toISOString();
}

function matchingAsset(value: unknown, expected: string, chain: Chain): boolean {
  return typeof value === 'string' && (chain === 'base'
    ? value.toLowerCase() === expected.toLowerCase()
    : value === expected);
}

function record(value: unknown): Record<string, unknown> | null {
  if (value === null || typeof value !== 'object') return null;
  return value as Record<string, unknown>;
}

function safeTransportText(value: string): string {
  const normalized = value
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/https?:\/\/\S+/gi, '[url]')
    .replace(/\b(authorization|api[-_]?key|password|secret|token)(?:\s+(?:bearer|basic))?\s*[:=]?\s*\S+/gi, '$1=[redacted]');
  if (normalized.length <= MAX_TRANSPORT_ERROR_LENGTH) return normalized;
  return `${normalized.slice(0, MAX_TRANSPORT_ERROR_LENGTH - 3)}...`;
}

function isGenericTransportMessage(value: string): boolean {
  return /^(?:fetch failed|failed to fetch|network error)$/i.test(value.trim());
}

function errorDetails(error: unknown): { code: string | null; message: string | null } {
  let current: unknown = error;
  let code: string | null = null;
  let message: string | null = null;
  const seen = new Set<object>();
  for (let depth = 0; depth < 4; depth++) {
    const value = record(current);
    if (!value || seen.has(value)) break;
    seen.add(value);
    const candidateCode = typeof value.code === 'string' ? value.code.toUpperCase() : null;
    if (!code && candidateCode && /^[A-Z][A-Z0-9_]{1,63}$/.test(candidateCode)) {
      code = candidateCode;
    }
    if (typeof value.message === 'string' && (!message || isGenericTransportMessage(message))) {
      message = value.message;
    }
    current = value.cause;
  }
  if (!message && typeof error === 'string') message = error;
  return { code, message };
}

function transportKind(code: string | null, message: string | null): 'DNS' | 'connection' | 'TLS' | null {
  const upper = `${code ?? ''} ${message ?? ''}`.toUpperCase();
  if (code && TLS_ERROR_CODES.has(code)
    || /\b(?:CERT_|ERR_TLS|ERR_SSL|UNABLE_TO_VERIFY_LEAF_SIGNATURE|SELF_SIGNED_CERT|DEPTH_ZERO_SELF_SIGNED_CERT)\b/.test(upper)
    || /\b(?:TLS|SSL|CERTIFICATE|HANDSHAKE)\b/.test(upper)) return 'TLS';
  if (code && DNS_ERROR_CODES.has(code)
    || /\b(?:EAI_[A-Z]+|ENOTFOUND|DNS)\b/.test(upper)) return 'DNS';
  if (code && CONNECTION_ERROR_CODES.has(code)
    || /\b(?:ECONN[A-Z]+|EHOSTUNREACH|ENETUNREACH|EPIPE|ETIMEDOUT|SOCKET|CONNECT(?:ION)?\s+(?:RESET|REFUSED|TIMEOUT|TIMED\s+OUT)|SOCKET\s+HANG\s+UP)\b/.test(upper)) return 'connection';
  return null;
}

function formatTransportError(error: unknown): string {
  const { code, message: rawMessage } = errorDetails(error);
  const message = rawMessage ? safeTransportText(rawMessage) : '';
  const kind = transportKind(code, rawMessage);
  const detail = message && !isGenericTransportMessage(message)
    ? message
    : '';
  if (kind === 'DNS') return `DNS lookup failed${code ? ` (${code})` : ''}${detail ? `: ${detail}` : ''}`;
  if (kind === 'connection') return `Connection failed${code ? ` (${code})` : ''}${detail ? `: ${detail}` : ''}`;
  if (kind === 'TLS') return `TLS handshake failed${code ? ` (${code})` : ''}${detail ? `: ${detail}` : ''}`;
  if (detail) return detail;
  return `Transport failure${detail ? `: ${detail}` : ': unknown cause'}`;
}

export function normalizeQuote(raw: unknown, request: QuoteRequest): Quote {
  const body = object(raw, 'response');
  let quote: Record<string, unknown>;
  if (request.chain === 'solana') {
    if (body.transaction !== null || (body.taker !== undefined && body.taker !== null)) {
      throw new Error('Unexpected transaction or taker in quote-only response');
    }
    if (body.swapMode !== 'ExactIn') throw new Error('Expected ExactIn quote');
    if (body.error || body.errorMessage || (body.errorCode != null && body.errorCode !== 0)) {
      throw new Error('Provider reported a quote error');
    }
    quote = body;
  } else {
    if (body.code !== 0) throw new Error('KyberSwap response code is not zero');
    quote = object(object(body.data, 'data').routeSummary, 'routeSummary');
  }
  const isSolana = request.chain === 'solana';
  if (!matchingAsset(quote[isSolana ? 'inputMint' : 'tokenIn'], ASSETS[request.chain][request.inputAsset], request.chain)
    || !matchingAsset(quote[isSolana ? 'outputMint' : 'tokenOut'], ASSETS[request.chain][request.outputAsset], request.chain)) {
    throw new Error('Quote asset does not match request');
  }
  const inAmount = units(quote[isSolana ? 'inAmount' : 'amountIn'], 'input amount');
  if (inAmount !== request.amount) throw new Error('Quote input amount does not match request');
  return {
    inAmount,
    outAmount: units(quote[isSolana ? 'outAmount' : 'amountOut'], 'output amount'),
    // Jupiter wallet-free lamport estimates do not establish actual execution cost.
    gasUsd: isSolana ? null : decimal(quote.gasUsd, 'gasUsd'),
    // l1FeeUsd was observed previously but is not a guaranteed GET response field.
    l1FeeUsd: isSolana ? null : decimal(quote.l1FeeUsd, 'l1FeeUsd'),
    providerTimestamp: isSolana ? null : epochTimestamp(quote.timestamp),
    expiresAt: isSolana ? expiry(quote.expireAt) : null,
  };
}

function retryAfterMilliseconds(headers: Headers | null): number | null {
  const value = headers?.get('retry-after')?.trim();
  if (!value || !/^\d+$/.test(value)) return null;
  const seconds = Number(value);
  if (!Number.isSafeInteger(seconds) || seconds > Number.MAX_SAFE_INTEGER / 1000) return null;
  return seconds * 1000;
}

function classifyFailure(error: unknown, httpStatus: number | null, headers: Headers | null): ObservationFailure {
  const {code, message} = errorDetails(error);
  const upper = `${code ?? ''} ${message ?? ''}`.toUpperCase();
  const retryAfterMs = httpStatus === 429 || httpStatus === 503 ? retryAfterMilliseconds(headers) : null;
  if (/\b(?:TIMEOUT|TIMED OUT)\b/.test(upper)) {
    return {kind: 'timeout', retryable: true, retryAfterMs};
  }
  if (/\b(?:ABORT_ERR|ABORTED|CANCELLED|CANCELED)\b/.test(upper)) {
    return {kind: 'cancelled', retryable: false, retryAfterMs};
  }
  const transport = transportKind(code, message);
  if (transport === 'DNS') return {kind: 'dns', retryable: true, retryAfterMs};
  if (transport === 'TLS') return {kind: 'tls', retryable: false, retryAfterMs};
  if (transport === 'connection' || httpStatus === null) return {kind: 'connection', retryable: true, retryAfterMs};
  if (message?.startsWith('Response body failed:')
    || message === 'Response exceeds 2 MiB limit'
    || message === 'Empty response body'
    || message?.includes('response is not valid JSON')
    || message === 'Redirected response rejected') {
    return {kind: 'invalid_body', retryable: false, retryAfterMs};
  }
  if (httpStatus === 429) return {kind: 'rate_limit', retryable: true, retryAfterMs};
  if (httpStatus >= 500 && httpStatus <= 599) return {kind: 'http_server', retryable: true, retryAfterMs};
  if (httpStatus < 200 || httpStatus >= 300) return {kind: 'http_client', retryable: false, retryAfterMs};
  return {kind: 'invalid_quote', retryable: false, retryAfterMs};
}

function requestUrl(request: QuoteRequest): URL {
  const solana = request.chain === 'solana';
  const url = new URL(solana
    ? 'https://api.jup.ag/swap/v2/order'
    : 'https://aggregator-api.kyberswap.com/base/api/v1/routes');
  url.searchParams.set(solana ? 'inputMint' : 'tokenIn', ASSETS[request.chain][request.inputAsset]);
  url.searchParams.set(solana ? 'outputMint' : 'tokenOut', ASSETS[request.chain][request.outputAsset]);
  url.searchParams.set(solana ? 'amount' : 'amountIn', request.amount);
  return url;
}

async function readBody(response: Response): Promise<{ text: string; error: string | null }> {
  const reader = response.body?.getReader();
  if (!reader) return { text: '', error: 'Empty response body' };
  const decoder = new TextDecoder();
  let text = '';
  let bytes = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) return { text: text + decoder.decode(), error: null };
      const remaining = MAX_BODY_BYTES - bytes;
      if (value.byteLength > remaining) {
        text += decoder.decode(value.subarray(0, remaining), { stream: true });
        text += decoder.decode();
        void reader.cancel().catch(() => {});
        return { text, error: 'Response exceeds 2 MiB limit' };
      }
      bytes += value.byteLength;
      text += decoder.decode(value, { stream: true });
    }
  } catch (error) {
    return { text: text + decoder.decode(), error: `Response body failed: ${error instanceof Error ? error.message : 'unknown error'}` };
  } finally {
    reader.releaseLock();
  }
}

interface CollectOptions {
  signal?: AbortSignal;
  fetcher?: typeof fetch;
  now?: () => Date;
  pause?: (milliseconds: number, signal?: AbortSignal) => Promise<void>;
  requestTimeoutMs?: number;
}

export async function collectCycles(amount: string, options: CollectOptions = {}): Promise<Cycle[]> {
  units(amount, 'scan amount');
  if (BigInt(amount) < 10_000n || BigInt(amount) > 500_000_000n) {
    throw new Error('Scan amount must be between 10000 and 500000000 units (0.01 to 500 USDC)');
  }
  const { signal, fetcher = fetch, now = () => new Date() } = options;
  const requestTimeoutMs = options.requestTimeoutMs ?? REQUEST_TIMEOUT_MS;
  if (!Number.isInteger(requestTimeoutMs) || requestTimeoutMs <= 0) {
    throw new Error('Request timeout must be a positive integer');
  }
  const pause = options.pause ?? (async (milliseconds: number, abortSignal?: AbortSignal) => {
    await sleep(milliseconds, undefined, { signal: abortSignal });
  });
  let lastJupiterStart: number | null = null;

  async function observe(request: QuoteRequest): Promise<Observation> {
    signal?.throwIfAborted();
    if (request.chain === 'solana' && lastJupiterStart !== null) {
      const delay = JUPITER_INTERVAL_MS - (now().getTime() - lastJupiterStart);
      if (delay > 0) await pause(delay, signal);
    }
    signal?.throwIfAborted();
    const url = requestUrl(request);
    const startedAt = now().toISOString();
    if (request.chain === 'solana') lastJupiterStart = Date.parse(startedAt);
    const observation: Observation = {
      request, requestUrl: url.toString(), startedAt, receivedAt: startedAt,
      httpStatus: null, raw: null, quote: null, error: null, failure: null,
    };
    const timeout = AbortSignal.timeout(requestTimeoutMs);
    const requestSignal = signal ? AbortSignal.any([signal, timeout]) : timeout;
    let responseHeaders: Headers | null = null;
    try {
      const response = await fetcher(url, {
        method: 'GET', redirect: 'error', signal: requestSignal,
        headers: request.chain === 'base'
          ? { accept: 'application/json', 'x-client-id': 'falconos' }
          : { accept: 'application/json' },
      });
      observation.httpStatus = response.status;
      responseHeaders = response.headers;

      const body = await readBody(response);
      signal?.throwIfAborted();
      if (body.error) {
        observation.raw = { incomplete: true, bodyPrefix: body.text };
        throw new Error(body.error);
      }
      observation.raw = body.text;
      try { observation.raw = JSON.parse(body.text) as unknown; } catch {
        throw new Error(`HTTP ${response.status}: response is not valid JSON`);
      }
      if (response.redirected) throw new Error('Redirected response rejected');
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      requestSignal.throwIfAborted();
      observation.quote = normalizeQuote(observation.raw, request);
    } catch (error) {
      signal?.throwIfAborted();
      const message = timeout.aborted
        ? `Request timed out after ${requestTimeoutMs} ms`
        : observation.httpStatus === null
          ? formatTransportError(error)
          : error instanceof Error ? error.message : 'Unknown provider failure';
      observation.error = message;
      observation.failure = classifyFailure(timeout.aborted ? new Error('Request timed out') : error, observation.httpStatus, responseHeaders);
    } finally {
      observation.receivedAt = now().toISOString();
    }
    return observation;
  }

  const cycles: Cycle[] = [];
  for (const sourceChain of ['solana', 'base'] as const) {
    const destinationChain = sourceChain === 'solana' ? 'base' : 'solana';
    const first = await observe({ chain: sourceChain, inputAsset: 'USDC', outputAsset: 'EURC', amount });
    const cycle: Cycle = { sourceChain, destinationChain, legs: [first] };
    if (first.quote) {
      cycle.legs.push(await observe({
        chain: destinationChain, inputAsset: 'EURC', outputAsset: 'USDC', amount: first.quote.outAmount,
      }));
    }
    cycles.push(cycle);
  }
  return cycles;
}
