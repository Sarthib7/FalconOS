import assert from 'node:assert/strict';
import test from 'node:test';
import {
  handleResearchNear,
  handleResearchNearReplay,
  handleResearchNearSource,
} from '../functions/api/_research-mcp.mjs';

const MCP_ENDPOINT = 'https://mcp.falconos.markets/mcp';
const PROTOCOL_VERSION = '2025-03-26';
const CASE_ID = '11111111-1111-4111-8111-111111111111';
const REVISION_ID = '22222222-2222-4222-8222-222222222222';
const CASE_PAYLOAD = {
  caseId: CASE_ID,
  schemaVersion: 1,
  caseType: 'near-thesis',
  status: 'OBSERVED',
  executionReady: false,
};
const SOURCE_PAYLOAD = {
  revisionId: REVISION_ID,
  sourceUrl: 'https://example.invalid/public-source',
  contentType: 'text/html',
  content: '<!doctype html><script>window.neverRun = true</script>',
};

function jsonResponse(value, { status = 200, headers = {} } = {}) {
  return new Response(JSON.stringify(value), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', ...headers },
  });
}

function rpcResponse(id, result, options = {}) {
  const payload = options.raw ?? { jsonrpc: '2.0', id, result };
  const body = options.body ?? JSON.stringify(payload);
  return new Response(body, {
    status: options.status ?? 200,
    headers: {
      'Content-Type': options.contentType ?? 'application/json; charset=utf-8',
      ...options.headers,
    },
  });
}

function toolResult(payload, { isError } = {}) {
  const result = {
    structuredContent: payload,
    content: [{ type: 'text', text: JSON.stringify(payload, null, 2) }],
  };
  if (isError !== undefined) result.isError = isError;
  return result;
}

function fakeMcp({ payload = CASE_PAYLOAD, initResponse, notificationResponse, toolResponse, onFetch } = {}) {
  const requests = [];
  const fetchImpl = async (url, init) => {
    const rpc = JSON.parse(init.body);
    requests.push({ url, init, headers: new Headers(init.headers), rpc });
    if (onFetch) return onFetch({ url, init, rpc, requests });
    if (rpc.method === 'initialize') {
      return initResponse ?? rpcResponse(1, {
        protocolVersion: PROTOCOL_VERSION,
        capabilities: { tools: {} },
        serverInfo: { name: 'falcon-mcp-rust', version: '0.5.0' },
      });
    }
    if (rpc.method === 'notifications/initialized') {
      return notificationResponse ?? new Response(null, { status: 202 });
    }
    if (rpc.method === 'tools/call') {
      return toolResponse
        ? toolResponse({ url, init, rpc, requests })
        : rpcResponse(2, toolResult(payload));
    }
    return jsonResponse({ error: 'unexpected test method' }, { status: 400 });
  };
  return { requests, fetchImpl };
}

function request(url, { method = 'GET', headers = {}, body } = {}) {
  return new Request(url, {
    method,
    headers,
    ...(body === undefined ? {} : { body }),
  });
}

async function responseJson(response) {
  return response.json();
}

function assertHandshake(requests, toolName, args) {
  assert.equal(requests.length, 3);
  assert.deepEqual(requests.map(item => item.rpc.method), [
    'initialize',
    'notifications/initialized',
    'tools/call',
  ]);
  assert.equal(requests[0].url, MCP_ENDPOINT);
  assert.equal(requests[0].init.method, 'POST');
  assert.equal(requests[0].init.redirect, 'error');
  assert.equal(requests[0].rpc.jsonrpc, '2.0');
  assert.equal(requests[0].rpc.id, 1);
  assert.equal(requests[0].rpc.params.protocolVersion, PROTOCOL_VERSION);
  assert.deepEqual(requests[0].rpc.params.capabilities, {});
  assert.equal(requests[0].headers.get('mcp-protocol-version'), null);
  assert.equal(requests[1].rpc.id, undefined);
  assert.equal(requests[1].headers.get('mcp-protocol-version'), PROTOCOL_VERSION);
  assert.equal(requests[2].headers.get('mcp-protocol-version'), PROTOCOL_VERSION);
  assert.deepEqual(requests[2].rpc, {
    jsonrpc: '2.0',
    id: 2,
    method: 'tools/call',
    params: { name: toolName, arguments: args },
  });
  for (const item of requests) {
    assert.equal(item.url, MCP_ENDPOINT);
    assert.equal(item.init.redirect, 'error');
    assert.equal(item.headers.get('accept'), 'application/json, text/event-stream');
    assert.equal(item.headers.get('authorization'), null);
    assert.equal(item.headers.get('cookie'), null);
    assert.equal(item.headers.get('origin'), null);
    assert.equal(item.headers.get('mcp-session-id'), null);
    assert.equal(item.headers.get('x-owner'), null);
  }
}

test('NEAR case GET uses the fixed research tool with and without caseId', async () => {
  const noId = fakeMcp({ payload: CASE_PAYLOAD });
  const response = await handleResearchNear(request('https://agents.test/api/research-near'), {
    fetchImpl: noId.fetchImpl,
  });
  assert.equal(response.status, 200);
  assert.deepEqual(await responseJson(response), CASE_PAYLOAD);
  assertHandshake(noId.requests, 'falcon_research_case', {});

  const byId = fakeMcp({ payload: CASE_PAYLOAD });
  const protectedResponse = await handleResearchNear(request(
    `https://agents.test/api/research-near?caseId=${CASE_ID.toUpperCase()}`,
    {
      headers: {
        Origin: 'https://agents.test',
        Authorization: 'Bearer caller-secret',
        Cookie: 'session=caller-secret',
        'Mcp-Session-Id': 'caller-session',
        'MCP-Protocol-Version': 'caller-version',
        'X-Owner': 'caller-owner',
        'X-Tool': 'falcon_adopt_research_case',
      },
    },
  ), { fetchImpl: byId.fetchImpl });
  assert.equal(protectedResponse.status, 200);
  assertHandshake(byId.requests, 'falcon_research_case', { caseId: CASE_ID });
  assert.equal(byId.requests[0].headers.get('mcp-protocol-version'), null);
  assert.equal(byId.requests[2].headers.get('mcp-protocol-version'), PROTOCOL_VERSION);
  assert.equal(protectedResponse.headers.get('access-control-allow-origin'), null);
});

test('NEAR replay accepts only exact JSON and calls the replay tool', async () => {
  const upstream = fakeMcp({ payload: CASE_PAYLOAD });
  const response = await handleResearchNearReplay(request('https://agents.test/api/research-near-replay', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json; charset=utf-8', Origin: 'https://agents.test' },
    body: JSON.stringify({ caseId: CASE_ID }),
  }), { fetchImpl: upstream.fetchImpl });
  assert.equal(response.status, 200);
  assert.deepEqual(await responseJson(response), CASE_PAYLOAD);
  assertHandshake(upstream.requests, 'falcon_replay_research_case', { caseId: CASE_ID });
});

test('NEAR source is an attached JSON download with nosniff', async () => {
  const upstream = fakeMcp({ payload: SOURCE_PAYLOAD });
  const response = await handleResearchNearSource(request(
    `https://agents.test/api/research-near-source?revisionId=${REVISION_ID.toUpperCase()}`,
  ), { fetchImpl: upstream.fetchImpl });
  assert.equal(response.status, 200);
  assert.match(response.headers.get('content-type'), /^application\/json(?:;|$)/i);
  assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
  assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.equal(response.headers.get('content-disposition'),
    `attachment; filename="falcon-research-source-${REVISION_ID}.json"`);
  assert.equal(response.headers.get('access-control-allow-origin'), null);
  assert.deepEqual(await responseJson(response), SOURCE_PAYLOAD);
  assertHandshake(upstream.requests, 'falcon_research_source', { revisionId: REVISION_ID });
});

test('the MCP text/event-stream response path accepts one exact JSON text item', async () => {
  const payload = { result: 'retained', executionReady: false };
  const upstream = fakeMcp({
    payload,
    toolResponse: () => new Response(
      `event: message\ndata: ${JSON.stringify({ jsonrpc: '2.0', id: 2, result: { content: [{ type: 'text', text: JSON.stringify(payload) }] } })}\n\n`,
      { headers: { 'Content-Type': 'text/event-stream; charset=utf-8' } },
    ),
  });
  const response = await handleResearchNear(request('https://agents.test/api/research-near'), {
    fetchImpl: upstream.fetchImpl,
  });
  assert.equal(response.status, 200);
  assert.deepEqual(await responseJson(response), payload);
  assertHandshake(upstream.requests, 'falcon_research_case', {});
});

test('conflicting tool envelopes, isError and JSON-RPC errors are rejected', async () => {
  const conflicting = fakeMcp({
    toolResponse: () => rpcResponse(2, {
      ...toolResult(CASE_PAYLOAD),
      structuredContent: { ...CASE_PAYLOAD, status: 'CONFLICT' },
    }),
  });
  const conflictResponse = await handleResearchNear(request('https://agents.test/api/research-near'), {
    fetchImpl: conflicting.fetchImpl,
  });
  assert.equal(conflictResponse.status, 502);
  assert.equal((await responseJson(conflictResponse)).error, 'research_upstream_protocol_error');

  const isError = fakeMcp({
    toolResponse: () => rpcResponse(2, toolResult({ code: 'NOT_FOUND' }, { isError: true })),
  });
  const errorResponse = await handleResearchNear(request('https://agents.test/api/research-near'), {
    fetchImpl: isError.fetchImpl,
  });
  assert.equal(errorResponse.status, 502);
  assert.equal((await responseJson(errorResponse)).error, 'research_upstream_error');

  const rpcError = fakeMcp({
    toolResponse: () => rpcResponse(2, undefined, {
      raw: { jsonrpc: '2.0', id: 2, error: { code: -32603, message: 'internal detail' } },
    }),
  });
  const rpcErrorResponse = await handleResearchNear(request('https://agents.test/api/research-near'), {
    fetchImpl: rpcError.fetchImpl,
  });
  assert.equal(rpcErrorResponse.status, 502);
  assert.equal((await responseJson(rpcErrorResponse)).error, 'research_upstream_error');
});

test('mismatched ids and ambiguous JSON-RPC envelopes are rejected', async () => {
  const wrongId = fakeMcp({
    toolResponse: () => rpcResponse(99, toolResult(CASE_PAYLOAD)),
  });
  const wrongIdResponse = await handleResearchNear(request('https://agents.test/api/research-near'), {
    fetchImpl: wrongId.fetchImpl,
  });
  assert.equal(wrongIdResponse.status, 502);
  assert.equal((await responseJson(wrongIdResponse)).error, 'research_upstream_protocol_error');

  const both = fakeMcp({
    toolResponse: () => rpcResponse(2, undefined, {
      raw: { jsonrpc: '2.0', id: 2, result: toolResult(CASE_PAYLOAD), error: { code: -1, message: 'bad' } },
    }),
  });
  const bothResponse = await handleResearchNear(request('https://agents.test/api/research-near'), {
    fetchImpl: both.fetchImpl,
  });
  assert.equal(bothResponse.status, 502);
  assert.equal((await responseJson(bothResponse)).error, 'research_upstream_protocol_error');
});

test('upstream HTTP failures, redirects, malformed bodies and session creation fail closed', async () => {
  const httpError = fakeMcp({ toolResponse: () => new Response('unavailable', { status: 503 }) });
  const httpErrorResponse = await handleResearchNear(request('https://agents.test/api/research-near'), {
    fetchImpl: httpError.fetchImpl,
  });
  assert.equal(httpErrorResponse.status, 502);
  assert.equal((await responseJson(httpErrorResponse)).error, 'research_upstream_error');

  const redirect = fakeMcp({ toolResponse: () => new Response(null, { status: 302, headers: { Location: 'https://elsewhere.invalid/' } }) });
  const redirectResponse = await handleResearchNear(request('https://agents.test/api/research-near'), {
    fetchImpl: redirect.fetchImpl,
  });
  assert.equal(redirectResponse.status, 502);

  const malformed = fakeMcp({ toolResponse: () => new Response('{', { headers: { 'Content-Type': 'application/json' } }) });
  const malformedResponse = await handleResearchNear(request('https://agents.test/api/research-near'), {
    fetchImpl: malformed.fetchImpl,
  });
  assert.equal(malformedResponse.status, 502);
  assert.equal((await responseJson(malformedResponse)).error, 'research_upstream_protocol_error');

  const stateful = fakeMcp({
    initResponse: rpcResponse(1, {
      protocolVersion: PROTOCOL_VERSION,
      capabilities: { tools: {} },
      serverInfo: { name: 'stateful-test', version: '1' },
    }, { headers: { 'Mcp-Session-Id': 'unexpected-session' } }),
  });
  const statefulResponse = await handleResearchNear(request('https://agents.test/api/research-near'), {
    fetchImpl: stateful.fetchImpl,
  });
  assert.equal(statefulResponse.status, 502);
  assert.equal((await responseJson(statefulResponse)).error, 'research_upstream_protocol_error');
  assert.equal(stateful.requests.length, 1, 'no session-bearing follow-up request is made');
});

test('MCP response, case, replay and source byte limits reject oversized data', async () => {
  const oversizedOuter = fakeMcp({
    toolResponse: () => new Response('x'.repeat(512 * 1024 + 1), {
      headers: { 'Content-Type': 'application/json' },
    }),
  });
  const outerResponse = await handleResearchNear(request('https://agents.test/api/research-near'), {
    fetchImpl: oversizedOuter.fetchImpl,
  });
  assert.equal(outerResponse.status, 502);
  assert.equal((await responseJson(outerResponse)).error, 'research_upstream_response_too_large');

  const oversizedCase = fakeMcp({ payload: { caseId: CASE_ID, evidence: 'x'.repeat(128 * 1024) } });
  const caseResponse = await handleResearchNear(request('https://agents.test/api/research-near'), {
    fetchImpl: oversizedCase.fetchImpl,
  });
  assert.equal(caseResponse.status, 502);
  assert.equal((await responseJson(caseResponse)).error, 'research_upstream_response_too_large');

  const oversizedReplay = fakeMcp({ payload: { caseId: CASE_ID, evidence: 'x'.repeat(128 * 1024) } });
  const replayResponse = await handleResearchNearReplay(request('https://agents.test/api/research-near-replay', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ caseId: CASE_ID }),
  }), { fetchImpl: oversizedReplay.fetchImpl });
  assert.equal(replayResponse.status, 502);
  assert.equal((await responseJson(replayResponse)).error, 'research_upstream_response_too_large');

  const oversizedSource = fakeMcp({ payload: { ...SOURCE_PAYLOAD, content: 'x'.repeat(160 * 1024) } });
  const sourceResponse = await handleResearchNearSource(request(
    `https://agents.test/api/research-near-source?revisionId=${REVISION_ID}`,
  ), { fetchImpl: oversizedSource.fetchImpl });
  assert.equal(sourceResponse.status, 502);
  assert.equal((await responseJson(sourceResponse)).error, 'research_upstream_response_too_large');
});

test('network failure and deadline return transport errors rather than synthetic cases', async () => {
  const networkFailure = fakeMcp({ onFetch: async () => { throw new Error('network detail'); } });
  const unavailable = await handleResearchNear(request('https://agents.test/api/research-near'), {
    fetchImpl: networkFailure.fetchImpl,
  });
  assert.equal(unavailable.status, 503);
  assert.equal((await responseJson(unavailable)).error, 'research_upstream_unavailable');

  const delayed = fakeMcp({
    onFetch: ({ init }) => new Promise((resolve, reject) => {
      const abort = () => reject(new Error('aborted'));
      if (init.signal.aborted) abort();
      else init.signal.addEventListener('abort', abort, { once: true });
    }),
  });
  const timeout = await handleResearchNear(request('https://agents.test/api/research-near'), {
    fetchImpl: delayed.fetchImpl,
    timeoutMs: 5,
  });
  assert.equal(timeout.status, 504);
  assert.equal((await responseJson(timeout)).error, 'research_upstream_timeout');
});

test('invalid methods, fields, duplicate params, credentials, tools and URLs make no upstream calls', async () => {
  const invalidRequests = [
    [handleResearchNear, request(`https://agents.test/api/research-near?caseId=${CASE_ID}&caseId=${CASE_ID}`), 400],
    [handleResearchNear, request('https://agents.test/api/research-near?owner=alice'), 400],
    [handleResearchNear, request('https://agents.test/api/research-near?session=caller'), 400],
    [handleResearchNear, request('https://agents.test/api/research-near?tool=falcon_adopt_research_case'), 400],
    [handleResearchNear, request('https://agents.test/api/research-near?url=https%3A%2F%2Fevil.invalid%2Fmcp'), 400],
    [handleResearchNear, request('https://agents.test/api/research-near?caseId=not-a-uuid'), 400],
    [handleResearchNearSource, request('https://agents.test/api/research-near-source'), 400],
    [handleResearchNearSource, request(`https://agents.test/api/research-near-source?revisionId=${REVISION_ID}&revisionId=${REVISION_ID}`), 400],
    [handleResearchNearSource, request(`https://agents.test/api/research-near-source?revisionId=${REVISION_ID}&url=https%3A%2F%2Fevil.invalid`), 400],
    [handleResearchNearReplay, request('https://agents.test/api/research-near-replay', { method: 'GET' }), 405],
    [handleResearchNearReplay, request('https://agents.test/api/research-near-replay?url=https%3A%2F%2Fevil.invalid', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ caseId: CASE_ID }),
    }), 400],
    [handleResearchNearReplay, request('https://agents.test/api/research-near-replay', {
      method: 'POST', headers: { 'Content-Type': 'text/plain' }, body: JSON.stringify({ caseId: CASE_ID }),
    }), 415],
    [handleResearchNearReplay, request('https://agents.test/api/research-near-replay', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{',
    }), 400],
    [handleResearchNearReplay, request('https://agents.test/api/research-near-replay', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ caseId: CASE_ID, owner: 'alice' }),
    }), 400],
    [handleResearchNearReplay, request('https://agents.test/api/research-near-replay', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ caseId: CASE_ID, session: 'caller' }),
    }), 400],
    [handleResearchNearReplay, request('https://agents.test/api/research-near-replay', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ caseId: CASE_ID, tool: 'falcon_review_research_case' }),
    }), 400],
    [handleResearchNearReplay, request('https://agents.test/api/research-near-replay', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ caseId: CASE_ID, url: 'https://evil.invalid/mcp' }),
    }), 400],
    [handleResearchNearReplay, request('https://agents.test/api/research-near-replay', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: `{"caseId":"${CASE_ID}","caseId":"${CASE_ID}"}`,
    }), 400],
    [handleResearchNearReplay, request('https://agents.test/api/research-near-replay', {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'Content-Encoding': 'gzip' }, body: JSON.stringify({ caseId: CASE_ID }),
    }), 415],
    [handleResearchNearReplay, request('https://agents.test/api/research-near-replay', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: 'x'.repeat(4097),
    }), 413],
    [handleResearchNear, request('https://agents.test/api/research-near', {
      headers: { Origin: 'https://attacker.invalid' },
    }), 403],
  ];

  for (const [handler, incoming, expectedStatus] of invalidRequests) {
    let calls = 0;
    const response = await handler(incoming, { fetchImpl: async () => { calls += 1; throw new Error('must not call upstream'); } });
    assert.equal(response.status, expectedStatus);
    assert.equal(calls, 0);
    assert.equal(response.headers.get('access-control-allow-origin'), null);
  }
});
