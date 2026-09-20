import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { ASSETS, collectCycles, normalizeQuote } from '../sources.ts';
import type { Asset, Chain, FailureKind, QuoteRequest } from '../../src/types.ts';

// Synthetic provider responses exercise contracts, not market prices.
const EPOCH = Date.parse('2026-09-05T12:00:00.000Z');

interface MetadataAsset {
  chain: Chain;
  asset: Asset;
  address: string;
  endpoint: string;
  transport: string;
  method: string;
  params: unknown[];
  commitment?: string;
  blockNumberHex?: string;
  blockNumber?: string;
  startedAt: string;
  receivedAt: string;
  httpStatus: number;
  response: {jsonrpc: string; result: unknown; id: string};
  observed: {decimals: number; slot?: number};
  error: null;
}

interface MetadataFixture {
  fixtureSchemaVersion: number;
  provenance: {
    sourceCapture: string;
    captureSha256: string;
    capturedBy: string;
  };
  capture: {
    schemaVersion: number;
    provenance: string;
    purpose: string;
    captureMethod: string;
    captureWindow: {start: string; end: string; precision: string};
    baseBlockContext: {
      endpoint: string;
      transport: string;
      method: string;
      params: unknown[];
      startedAt: string;
      receivedAt: string;
      httpStatus: number;
      response: {jsonrpc: string; result: string; id: string};
      blockNumberHex: string;
      blockNumber: string;
      error: null;
    };
    assets: MetadataAsset[];
  };
}

// This fixture is self-contained. It does not read ignored data/verification files.
const metadata = JSON.parse(readFileSync(new URL('../../test/fixtures/public-metadata.json', import.meta.url), 'utf8')) as MetadataFixture;

function payload(url: URL): Record<string, unknown> {
  const solana = url.hostname === 'api.jup.ag';
  const input = url.searchParams.get(solana ? 'inputMint' : 'tokenIn')!;
  const output = url.searchParams.get(solana ? 'outputMint' : 'tokenOut')!;
  const amount = url.searchParams.get(solana ? 'amount' : 'amountIn')!;
  const outAmount = (BigInt(amount) * 9n / 10n).toString();
  return solana ? {
    inputMint: input, outputMint: output, inAmount: amount, outAmount,
    transaction: null, taker: null, swapMode: 'ExactIn', requestId: 'synthetic-jupiter',
  } : {
    code: 0, requestId: 'synthetic-kyber', data: {
      routeSummary: {
        tokenIn: input.toLowerCase(), tokenOut: output.toLowerCase(), amountIn: amount, amountOut: outAmount,
        gasUsd: '0.004', l1FeeUsd: '0.00001', timestamp: EPOCH / 1000,
      },
    },
  };
}

function harness(reply?: (url: URL, index: number) => Response) {
  let clock = EPOCH;
  const calls: { url: URL; init: RequestInit | undefined; started: number }[] = [];
  const pauses: number[] = [];
  const fetcher: typeof fetch = async (input, init) => {
    const url = new URL(input instanceof Request ? input.url : input.toString());
    calls.push({ url, init, started: clock });
    clock += 20;
    return reply?.(url, calls.length - 1) ?? Response.json(payload(url));
  };
  const options = {
    fetcher, now: () => new Date(clock),
    pause: async (ms: number, signal?: AbortSignal) => {
      signal?.throwIfAborted();
      pauses.push(ms);
      clock += ms;
    },
  };
  return { calls, pauses, options };
}

function fetchFailure(code: string, message: string): Error {
  const cause = Object.assign(new Error(message), { code });
  return Object.assign(new TypeError('fetch failed'), { cause });
}

test('P1-T01/CHK-05: registry matches the historical public metadata fixture', () => {
  const expectedAddresses: Record<Chain, Record<Asset, string>> = {
    solana: {
      USDC: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
      EURC: 'HzwqbKZw8HxMN6bF2yFZNrht3c2iXXzpKcFu7uBEDKtr',
    },
    base: {
      USDC: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
      EURC: '0x60a3E35Cc302bFA44Cb288Bc5a4F316Fdb1adb42',
    },
  };
  const expectedSolanaSlots: Record<Asset, number> = {USDC: 444532563, EURC: 444532421};
  const captureStart = Date.parse('2026-09-05T13:37:07Z');
  const captureEnd = Date.parse('2026-09-05T13:37:52Z');
  const capture = metadata.capture;

  assert.equal(metadata.fixtureSchemaVersion, 1);
  assert.equal(metadata.provenance.sourceCapture, 'data/verification/2026-09-05-public-metadata.json');
  assert.equal(metadata.provenance.capturedBy, 'collector_luna');
  assert.equal(
    createHash('sha256').update(`${JSON.stringify(capture, null, 2)}\n`).digest('hex'),
    metadata.provenance.captureSha256,
  );
  assert.equal(capture.schemaVersion, 1);
  assert.equal(capture.provenance, 'VERIFIED, collector_luna public read-only RPC capture');
  assert.equal(capture.purpose, 'P1-T01 and CHK-05 exact token metadata');
  assert.equal(capture.captureMethod, 'curl -sS through the approved escalated shell path');
  assert.deepEqual(capture.captureWindow, {
    start: '2026-09-05T13:37:07Z', end: '2026-09-05T13:37:52Z', precision: 'seconds',
  });
  assert.deepEqual(ASSETS, expectedAddresses);
  assert.deepEqual(capture.assets.map(entry => `${entry.chain}/${entry.asset}`).sort(), [
    'base/EURC', 'base/USDC', 'solana/EURC', 'solana/USDC',
  ]);

  for (const entry of capture.assets) {
    assert.equal(entry.address, expectedAddresses[entry.chain][entry.asset]);
    assert.equal(entry.httpStatus, 200);
    assert.equal(entry.error, null);
    const startedAt = Date.parse(entry.startedAt);
    const receivedAt = Date.parse(entry.receivedAt);
    assert.ok(startedAt >= captureStart && startedAt <= captureEnd);
    assert.ok(receivedAt >= startedAt && receivedAt <= captureEnd);
    assert.equal(entry.observed.decimals, 6);
    if (entry.chain === 'solana') {
      assert.equal(entry.method, 'getTokenSupply');
      assert.equal(entry.commitment, 'finalized');
      assert.equal(entry.params[0], entry.address);
      const result = entry.response.result as {context: {slot: number}; value: {decimals: number}};
      assert.equal(result.value.decimals, entry.observed.decimals);
      assert.equal(result.context.slot, expectedSolanaSlots[entry.asset]);
      assert.equal(entry.observed.slot, expectedSolanaSlots[entry.asset]);
    } else {
      assert.equal(entry.method, 'eth_call');
      assert.equal(entry.blockNumberHex, '0x308df13');
      assert.equal(entry.blockNumber, '50913043');
      const call = entry.params[0] as {to: string; data: string};
      assert.equal(call.to, entry.address);
      assert.equal(call.data, '0x313ce567');
      assert.equal(entry.params[1], '0x308df13');
      assert.equal(Number.parseInt(entry.response.result as string, 16), entry.observed.decimals);
      assert.match(entry.response.result as string, /^0x0{63}6$/);
    }
  }

  assert.equal(capture.baseBlockContext.method, 'eth_blockNumber');
  assert.equal(capture.baseBlockContext.blockNumberHex, '0x308df13');
  assert.equal(capture.baseBlockContext.blockNumber, '50913043');
  assert.deepEqual(capture.baseBlockContext.response, {
    jsonrpc: '2.0', result: '0x308df13', id: 'base-block',
  });
  assert.equal(capture.baseBlockContext.httpStatus, 200);
  assert.equal(capture.baseBlockContext.error, null);
});

test('F1/F3: keyless GETs compare exact intermediate quantities in both directions', async () => {
  const h = harness();
  const cycles = await collectCycles('10000000', h.options);
  assert.deepEqual(cycles.map(c => [c.sourceChain, c.destinationChain]), [['solana', 'base'], ['base', 'solana']]);
  assert.equal(h.calls.length, 4);
  for (const cycle of cycles) {
    assert.equal(cycle.legs.length, 2);
    const [first, second] = cycle.legs;
    assert.ok(first?.quote);
    assert.ok(second?.quote);
    assert.equal(first.quote.outAmount, second.request.amount);
    assert.equal(second.quote.inAmount, first.quote.outAmount);
    assert.equal(first.error, null);
    assert.equal(first.failure, null);
    assert.equal(first.httpStatus, 200);
    assert.equal(second.failure, null);
    assert.ok(Date.parse(first.receivedAt) >= Date.parse(first.startedAt));
  }
  for (const { url, init } of h.calls) {
    assert.equal(init?.method, 'GET');
    assert.equal(init?.redirect, 'error');
    const headers = new Headers(init?.headers);
    assert.equal(headers.has('authorization'), false);
    assert.equal(headers.has('x-api-key'), false);
    assert.equal(url.searchParams.has('taker'), false);
    assert.equal(url.searchParams.has('payer'), false);
    assert.equal([...url.searchParams].length, 3);
    if (url.hostname === 'api.jup.ag') {
      assert.equal(url.pathname, '/swap/v2/order');
      assert.equal(headers.has('x-client-id'), false);
    } else {
      assert.equal(url.origin + url.pathname, 'https://aggregator-api.kyberswap.com/base/api/v1/routes');
      assert.equal(headers.get('x-client-id'), 'falconos');
    }
  }
  const jupiter = h.calls.filter(c => c.url.hostname === 'api.jup.ag');
  assert.equal(jupiter[1]!.started - jupiter[0]!.started, 2200);
  assert.equal(h.pauses.length, 1);
  assert.equal(cycles[0]!.legs[0]!.quote!.gasUsd, null);
  assert.equal(cycles[0]!.legs[1]!.quote!.l1FeeUsd, '0.00001');
  assert.equal(cycles[0]!.legs[1]!.quote!.providerTimestamp, '2026-09-05T12:00:00.000Z');
});

test('F1: scan input bounds fail before network access', async () => {
  const h = harness();
  for (const amount of ['0', '-1', '9999', '500000001', '1e6', '01', '1.2', '']) {
    await assert.rejects(collectCycles(amount, h.options));
  }
  assert.equal(h.calls.length, 0);
});

const solanaRequest: QuoteRequest = {
  chain: 'solana', inputAsset: 'USDC', outputAsset: 'EURC', amount: '10000000',
};
const solanaRaw = {
  inputMint: ASSETS.solana.USDC, outputMint: ASSETS.solana.EURC,
  inAmount: '10000000', outAmount: '9000000', transaction: null, taker: null, swapMode: 'ExactIn',
};

test('F2: malformed, mismatched and transaction-bearing quotes fail closed', () => {
  for (const override of [
    { inAmount: '10000001' }, { inAmount: 10000000 }, { outAmount: '0' }, { outAmount: '9.1' },
    { outAmount: '-9' }, { outAmount: '1e7' }, { inputMint: ASSETS.solana.EURC },
    { outputMint: ASSETS.base.EURC }, { swapMode: 'ExactOut' }, { transaction: 'unsigned-transaction' },
    { transaction: '' }, { transaction: undefined }, { taker: 'wallet' }, { errorCode: 1 },
    { expireAt: 'not-a-date' },
  ]) {
    assert.throws(() => normalizeQuote({ ...solanaRaw, ...override }, solanaRequest));
  }
  for (const raw of [null, [], {}, 'quote']) {
    assert.throws(() => normalizeQuote(raw, solanaRequest));
  }
});

test('F2: Base addresses allow case differences; missing cost remains unknown', () => {
  const request: QuoteRequest = { ...solanaRequest, chain: 'base' };
  const summary = {
    tokenIn: ASSETS.base.USDC.toLowerCase(), tokenOut: ASSETS.base.EURC.toUpperCase(),
    amountIn: request.amount, amountOut: '9000000',
  };
  const normalized = normalizeQuote({ code: 0, data: { routeSummary: summary } }, request);
  assert.equal(normalized.gasUsd, null);
  assert.equal(normalized.l1FeeUsd, null);
  assert.equal(normalized.providerTimestamp, null);
  assert.throws(() => normalizeQuote({ code: 4008, data: { routeSummary: summary } }, request));
  for (const change of [{ gasUsd: 'NaN' }, { l1FeeUsd: '-1' }, { timestamp: 'invalid' }, { timestamp: -1 }]) {
    assert.throws(() => normalizeQuote({ code: 0, data: { routeSummary: { ...summary, ...change } } }, request));
  }
});

test('F2/F5: HTTP 429 stays visible and prevents only its dependent quote', async () => {
  const h = harness((url, index) => index === 0
    ? Response.json({ error: 'Too many requests' }, { status: 429 })
    : Response.json(payload(url)));
  const cycles = await collectCycles('10000000', h.options);
  assert.equal(h.calls.length, 3);
  assert.equal(cycles[0]!.legs.length, 1);
  assert.equal(cycles[0]!.legs[0]!.error, 'HTTP 429');
  assert.equal(cycles[0]!.legs[0]!.httpStatus, 429);
  assert.deepEqual(cycles[0]!.legs[0]!.raw, { error: 'Too many requests' });
  assert.deepEqual(cycles[0]!.legs[0]!.failure, {kind: 'rate_limit', retryable: true, retryAfterMs: null});
  assert.ok(cycles[1]!.legs[1]!.quote);
});

test('F2: server retry metadata is descriptive and parses Retry-After seconds', async () => {
  const h = harness((url, index) => index === 0
    ? Response.json({error: 'Service unavailable'}, {status: 503, headers: {'Retry-After': '3'}})
    : Response.json(payload(url)));
  const cycles = await collectCycles('10000000', h.options);
  assert.equal(cycles[0]!.legs[0]!.error, 'HTTP 503');
  assert.deepEqual(cycles[0]!.legs[0]!.failure, {kind: 'http_server', retryable: true, retryAfterMs: 3000});
  assert.equal(cycles[0]!.legs.length, 1);
});


test('F2: non-rate-limit client responses are classified without retry metadata', async () => {
  const h = harness((url, index) => index === 0
    ? Response.json({error: 'bad request'}, {status: 400})
    : Response.json(payload(url)));
  const cycles = await collectCycles('10000000', h.options);
  assert.equal(cycles[0]!.legs[0]!.error, 'HTTP 400');
  assert.deepEqual(cycles[0]!.legs[0]!.failure, {kind: 'http_client', retryable: false, retryAfterMs: null});
});
test('F2: failed second quote preserves the first quote and raw invalid response', async () => {
  const h = harness((url, index) => index === 1
    ? Response.json({ code: 0, data: { routeSummary: { amountOut: '1' } } })
    : Response.json(payload(url)));
  const cycles = await collectCycles('10000000', h.options);
  assert.ok(cycles[0]!.legs[0]!.quote);
  assert.equal(cycles[0]!.legs[1]!.quote, null);
  assert.match(cycles[0]!.legs[1]!.error!, /asset/);
  assert.deepEqual(cycles[0]!.legs[1]!.raw, { code: 0, data: { routeSummary: { amountOut: '1' } } });
  assert.deepEqual(cycles[0]!.legs[1]!.failure, {kind: 'invalid_quote', retryable: false, retryAfterMs: null});
});

test('F2: response limit counts bytes and records a bounded prefix', async () => {
  const h = harness((url, index) => index === 0
    ? new Response('é'.repeat(1024 * 1024 + 1))
    : Response.json(payload(url)));
  const cycles = await collectCycles('10000000', h.options);
  const failed = cycles[0]!.legs[0]!;
  assert.equal(failed.quote, null);
  assert.equal(failed.httpStatus, 200);
  assert.match(failed.error!, /2 MiB/);
  const raw = failed.raw as { incomplete: boolean; bodyPrefix: string };
  assert.equal(raw.incomplete, true);
  assert.ok(Buffer.byteLength(raw.bodyPrefix) <= 2 * 1024 * 1024);
  assert.deepEqual(failed.failure, {kind: 'invalid_body', retryable: false, retryAfterMs: null});
  assert.equal(h.calls.length, 3);
});

test('F2: invalid JSON retains the response text', async () => {
  const h = harness((url, index) => index === 0 ? new Response('<html>upstream failure</html>') : Response.json(payload(url)));
  const cycles = await collectCycles('10000000', h.options);
  assert.equal(cycles[0]!.legs[0]!.raw, '<html>upstream failure</html>');
  assert.match(cycles[0]!.legs[0]!.error!, /not valid JSON/);
  assert.deepEqual(cycles[0]!.legs[0]!.failure, {kind: 'invalid_body', retryable: false, retryAfterMs: null});
});

test('F2: transport failure remains an observation with no HTTP status', async () => {
  const h = harness((url, index) => {
    if (index === 0) throw new Error('network unavailable');
    return Response.json(payload(url));
  });
  const cycles = await collectCycles('10000000', h.options);
  assert.equal(cycles[0]!.legs[0]!.httpStatus, null);
  assert.equal(cycles[0]!.legs[0]!.raw, null);
  assert.equal(cycles[0]!.legs[0]!.error, 'network unavailable');
  assert.deepEqual(cycles[0]!.legs[0]!.failure, {kind: 'connection', retryable: true, retryAfterMs: null});
  assert.ok(cycles[1]!.legs[1]!.quote);
});

test('F2: nested transport causes identify DNS, connection and TLS failures safely', async () => {
  const failures: [Error, RegExp, FailureKind][] = [
    [fetchFailure('ENOTFOUND', 'getaddrinfo ENOTFOUND api.jup.ag'), /DNS lookup failed \(ENOTFOUND\)/, 'dns'],
    [fetchFailure('ECONNREFUSED', 'connect ECONNREFUSED 127.0.0.1:443'), /Connection failed \(ECONNREFUSED\)/, 'connection'],
    [fetchFailure('CERT_HAS_EXPIRED', 'certificate has expired'), /TLS handshake failed \(CERT_HAS_EXPIRED\)/, 'tls'],
  ];
  for (const [failure, expected, kind] of failures) {
    const h = harness((_url, index) => {
      if (index === 0) throw failure;
      return Response.json(payload(_url));
    });
    const cycles = await collectCycles('10000000', h.options);
    const observation = cycles[0]!.legs[0]!;
    assert.match(observation.error!, expected);
    assert.equal(observation.httpStatus, null);
    assert.equal(observation.raw, null);
    assert.equal(observation.failure?.kind, kind);
    assert.ok(observation.error!.length <= 240);
  }
  const h = harness(() => {
    throw fetchFailure('ECONNRESET', 'request https://api.jup.ag/swap?apiKey=secret-value reset');
  });
  const cycles = await collectCycles('10000000', h.options);
  assert.doesNotMatch(cycles[0]!.legs[0]!.error!, /secret-value/);
});

test('F1: an injected fetcher cannot accept a redirected response', async () => {
  const h = harness((url, index) => {
    const response = Response.json(payload(url));
    if (index === 0) Object.defineProperty(response, 'redirected', { value: true });
    return response;
  });
  const cycles = await collectCycles('10000000', h.options);
  assert.equal(cycles[0]!.legs[0]!.quote, null);
  assert.equal(cycles[0]!.legs[0]!.error, 'Redirected response rejected');
  assert.equal(cycles[0]!.legs.length, 1);
  assert.deepEqual(cycles[0]!.legs[0]!.failure, {kind: 'invalid_body', retryable: false, retryAfterMs: null});
});

test('F2: an interrupted body preserves its received prefix and HTTP status', async () => {
  let reads = 0;
  const h = harness((url, index) => index === 0
    ? new Response(new ReadableStream<Uint8Array>({
      pull(controller) {
        if (reads++ === 0) controller.enqueue(new TextEncoder().encode('{"partial":'));
        else controller.error(new Error('stream ended early'));
      },
    }))
    : Response.json(payload(url)));
  const cycles = await collectCycles('10000000', h.options);
  assert.deepEqual(cycles[0]!.legs[0]!.raw, { incomplete: true, bodyPrefix: '{"partial":' });
  assert.equal(cycles[0]!.legs[0]!.httpStatus, 200);
  assert.match(cycles[0]!.legs[0]!.error!, /stream ended early/);
});

test('F5: cancellation before collection sends no request', async () => {
  const controller = new AbortController();
  controller.abort(new Error('stop scan'));
  const h = harness();
  await assert.rejects(collectCycles('10000000', { ...h.options, signal: controller.signal }), /stop scan/);
  assert.equal(h.calls.length, 0);
});

test('F5: cancellation during a request propagates instead of becoming a provider error', async () => {
  const controller = new AbortController();
  let calls = 0;
  const fetcher: typeof fetch = async (_input, init) => {
    calls++;
    controller.abort(new Error('stop in request'));
    init!.signal!.throwIfAborted();
    throw new Error('unreachable');
  };
  await assert.rejects(collectCycles('10000000', { fetcher, signal: controller.signal }), /stop in request/);
  assert.equal(calls, 1);
});

test('F2/F5: actual request timeout expires and caller cancellation remains authoritative', async () => {
  const h = harness();
  let calls = 0;
  const fetcher: typeof fetch = async (input, init) => {
    const url = new URL(input instanceof Request ? input.url : input.toString());
    calls++;
    if (calls === 1) {
      const requestSignal = init?.signal;
      assert.ok(requestSignal);
      await new Promise<never>((_resolve, reject) => {
        if (requestSignal.aborted) {
          reject(requestSignal.reason);
          return;
        }
        requestSignal.addEventListener('abort', () => reject(requestSignal.reason), { once: true });
      });
      throw new Error('unreachable');
    }
    return Response.json(payload(url));
  };
  const cycles = await collectCycles('10000000', {
    ...h.options, fetcher, requestTimeoutMs: 20,
  });
  assert.equal(cycles[0]!.legs[0]!.error, 'Request timed out after 20 ms');
  assert.equal(cycles[0]!.legs[0]!.httpStatus, null);
  assert.equal(cycles[0]!.legs[0]!.raw, null);
  assert.deepEqual(cycles[0]!.legs[0]!.failure, {kind: 'timeout', retryable: true, retryAfterMs: null});
  assert.ok(cycles[1]!.legs[1]!.quote);

  const controller = new AbortController();
  let stopTimer: ReturnType<typeof setTimeout> | undefined;
  const cancelFetcher: typeof fetch = async (_input, init) => {
    stopTimer = setTimeout(() => controller.abort(new Error('caller stop')), 2);
    const requestSignal = init?.signal;
    assert.ok(requestSignal);
    await new Promise<never>((_resolve, reject) => {
      if (requestSignal.aborted) {
        reject(requestSignal.reason);
        return;
      }
      requestSignal.addEventListener('abort', () => reject(requestSignal.reason), { once: true });
    });
    throw new Error('unreachable');
  };
  try {
    await assert.rejects(collectCycles('10000000', {
      fetcher: cancelFetcher, signal: controller.signal, requestTimeoutMs: 50,
    }), /caller stop/);
  } finally {
    if (stopTimer) clearTimeout(stopTimer);
  }
});

test('F5: cancellation during Jupiter pacing prevents the next request', async () => {
  const controller = new AbortController();
  const h = harness();
  await assert.rejects(collectCycles('10000000', {
    ...h.options, signal: controller.signal,
    pause: async (_ms, signal) => {
      controller.abort(new Error('stop in pause'));
      signal!.throwIfAborted();
    },
  }), /stop in pause/);
  assert.equal(h.calls.length, 3);
});
