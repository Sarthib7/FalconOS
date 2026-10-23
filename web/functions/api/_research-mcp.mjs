const MCP_ENDPOINT = 'https://mcp.falconos.markets/mcp';
const MCP_PROTOCOL_VERSION = '2025-03-26';
const MCP_ACCEPT = 'application/json, text/event-stream';
const MAX_REQUEST_BODY_BYTES = 4096;
const MAX_MCP_RESPONSE_BYTES = 512 * 1024;
const MAX_CASE_RESPONSE_BYTES = 128 * 1024;
const MAX_SOURCE_RESPONSE_BYTES = 160 * 1024;
const REQUEST_DEADLINE_MS = 20_000;
const CASE_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const EXACT_REPLAY_BODY = /^\s*\{\s*"caseId"\s*:\s*"([^"\\]*)"\s*\}\s*$/;
const encoder = new TextEncoder();
const NO_RESPONSE = Symbol('no-json-rpc-response');

class ProxyFailure extends Error {
  constructor(code, status, message) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

function failure(code, status, message) {
  return new ProxyFailure(code, status, message);
}

function jsonResponse(body, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
      ...extraHeaders,
    },
  });
}

function failureResponse(error) {
  if (error instanceof ProxyFailure) {
    return jsonResponse({ error: error.code, message: error.message }, error.status,
      error.status === 405 ? { Allow: error.allow } : {});
  }
  return jsonResponse({ error: 'research_proxy_error', message: 'The research request could not be completed.' }, 500);
}

function requireMethod(request, method) {
  if (request.method !== method) {
    throw Object.assign(failure('method_not_allowed', 405, `Use ${method} for this endpoint.`), { allow: method });
  }
}

function requireSameOrigin(request) {
  const origin = request.headers.get('origin');
  if (origin && origin !== new URL(request.url).origin) {
    throw failure('origin_not_allowed', 403, 'The request origin is not allowed.');
  }
}

function exactQuery(request, allowedNames, requiredNames = []) {
  const params = new URL(request.url).searchParams;
  for (const name of params.keys()) {
    if (!allowedNames.includes(name)) throw failure('invalid_input', 400, 'The query contains unsupported fields.');
  }

  const result = {};
  for (const name of allowedNames) {
    const values = params.getAll(name);
    if (values.length > 1) throw failure('invalid_input', 400, `Provide ${name} at most once.`);
    if (requiredNames.includes(name) && values.length !== 1) {
      throw failure('invalid_input', 400, `${name} is required.`);
    }
    if (values.length === 1) result[name] = values[0];
  }
  return result;
}

function normalizeUuid(value, field) {
  if (typeof value !== 'string' || !CASE_UUID.test(value)) {
    throw failure('invalid_input', 400, `${field} must be a UUID.`);
  }
  return value.toLowerCase();
}

function mediaType(value) {
  return (value || '').split(';', 1)[0].trim().toLowerCase();
}

function makeDeadline(timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  return { signal: controller.signal, clear: () => clearTimeout(timer) };
}

function aborted(signal) {
  return signal?.aborted === true;
}

function timeoutFailure(upstream) {
  return upstream
    ? failure('research_upstream_timeout', 504, 'The research service did not respond before the deadline.')
    : failure('request_timeout', 408, 'The request did not complete before the deadline.');
}

async function readWithSignal(promise, signal) {
  if (!signal) return promise;
  if (signal.aborted) throw signal.reason || new Error('Aborted.');

  let onAbort;
  const abortedRead = new Promise((resolve, reject) => {
    onAbort = () => reject(signal.reason || new Error('Aborted.'));
    signal.addEventListener('abort', onAbort, { once: true });
  });
  try {
    return await Promise.race([promise, abortedRead]);
  } finally {
    signal.removeEventListener('abort', onAbort);
  }
}

async function boundedText(stream, limit, signal, tooLarge) {
  if (!stream) return '';
  const reader = stream.getReader();
  const chunks = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await readWithSignal(reader.read(), signal);
      if (done) break;
      size += value.byteLength;
      if (size > limit) throw tooLarge();
      chunks.push(value);
    }
  } catch (error) {
    try { await reader.cancel(); } catch {}
    throw error;
  } finally {
    reader.releaseLock();
  }

  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
}

async function cancelBody(response) {
  try { await response.body?.cancel(); } catch {}
}

async function assertStateless(response) {
  if (response.headers.get('mcp-session-id') !== null) {
    await cancelBody(response);
    throw failure('research_upstream_protocol_error', 502, 'The research service returned an unexpected session.');
  }
}

function assertSuccessfulStatus(response) {
  if (response.status < 200 || response.status >= 300) {
    throw failure('research_upstream_error', 502, 'The research service returned an unsuccessful HTTP response.');
  }
}

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function parseRpcResponse(message, expectedId) {
  if (!isObject(message) || message.jsonrpc !== '2.0') {
    throw failure('research_upstream_protocol_error', 502, 'The research service returned an invalid JSON-RPC message.');
  }

  if (!Object.hasOwn(message, 'id')) {
    if (typeof message.method === 'string' && !Object.hasOwn(message, 'result') && !Object.hasOwn(message, 'error')
      && Object.keys(message).every(key => ['jsonrpc', 'method', 'params'].includes(key))) {
      return NO_RESPONSE;
    }
    throw failure('research_upstream_protocol_error', 502, 'The research service returned an ambiguous JSON-RPC message.');
  }
  if (Object.keys(message).some(key => !['jsonrpc', 'id', 'result', 'error'].includes(key))) {
    throw failure('research_upstream_protocol_error', 502, 'The research service returned extra JSON-RPC fields.');
  }
  if (message.id !== expectedId) {
    throw failure('research_upstream_protocol_error', 502, 'The research service returned a mismatched JSON-RPC id.');
  }

  const hasResult = Object.hasOwn(message, 'result');
  const hasError = Object.hasOwn(message, 'error');
  if (hasResult === hasError) {
    throw failure('research_upstream_protocol_error', 502, 'The research service returned an ambiguous JSON-RPC envelope.');
  }
  if (hasError) {
    if (!isObject(message.error) || !Number.isInteger(message.error.code) || typeof message.error.message !== 'string') {
      throw failure('research_upstream_protocol_error', 502, 'The research service returned an invalid JSON-RPC error.');
    }
    throw failure('research_upstream_error', 502, 'The research service returned a JSON-RPC error.');
  }
  if (!isObject(message.result)) {
    throw failure('research_upstream_protocol_error', 502, 'The research service returned an invalid JSON-RPC result.');
  }
  return message.result;
}

function parseJson(text, description) {
  try {
    return JSON.parse(text);
  } catch {
    throw failure('research_upstream_protocol_error', 502, `The research service returned invalid ${description}.`);
  }
}

function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (isObject(value)) {
    return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function parseTextContent(content) {
  if (!Array.isArray(content) || content.length !== 1 || !isObject(content[0])
    || content[0].type !== 'text' || typeof content[0].text !== 'string') {
    throw failure('research_upstream_protocol_error', 502, 'The research tool returned ambiguous content.');
  }
  const value = parseJson(content[0].text, 'tool content');
  if (!isObject(value)) {
    throw failure('research_upstream_protocol_error', 502, 'The research tool returned a non-object payload.');
  }
  return value;
}

function extractToolPayload(result) {
  if (result.isError === true) {
    throw failure('research_upstream_error', 502, 'The research tool reported an error.');
  }
  if (result.isError !== undefined && typeof result.isError !== 'boolean') {
    throw failure('research_upstream_protocol_error', 502, 'The research tool returned an invalid error flag.');
  }

  if (Object.hasOwn(result, 'structuredContent')) {
    if (!isObject(result.structuredContent)) {
      throw failure('research_upstream_protocol_error', 502, 'The research tool returned invalid structured content.');
    }
    if (Object.hasOwn(result, 'content')) {
      const textContent = parseTextContent(result.content);
      if (canonicalJson(textContent) !== canonicalJson(result.structuredContent)) {
        throw failure('research_upstream_protocol_error', 502, 'The research tool returned conflicting payloads.');
      }
    }
    return result.structuredContent;
  }

  return parseTextContent(result.content);
}

function parseSseLine(line, dataLines) {
  if (line.endsWith('\r')) line = line.slice(0, -1);
  if (line === '') {
    if (dataLines.length === 0) return null;
    const data = dataLines.join('\n');
    dataLines.length = 0;
    return data;
  }
  if (line.startsWith(':')) return null;
  const colon = line.indexOf(':');
  const field = colon === -1 ? line : line.slice(0, colon);
  let value = colon === -1 ? '' : line.slice(colon + 1);
  if (value.startsWith(' ')) value = value.slice(1);
  if (field === 'data') dataLines.push(value);
  return null;
}

function readDeclaredLength(response) {
  const raw = response.headers.get('content-length');
  if (raw === null) return null;
  if (!/^\d+$/.test(raw)) {
    throw failure('research_upstream_protocol_error', 502, 'The research service returned an invalid content length.');
  }
  return Number(raw);
}

async function assertResponseWithinLimit(response) {
  let length;
  try {
    length = readDeclaredLength(response);
  } catch (error) {
    await cancelBody(response);
    throw error;
  }
  if (length !== null && length > MAX_MCP_RESPONSE_BYTES) {
    await cancelBody(response);
    throw failure('research_upstream_response_too_large', 502, 'The research service response exceeded its size limit.');
  }
}

async function readJsonRpcResponse(response, expectedId, signal) {
  try {
    await assertResponseWithinLimit(response);
    const type = mediaType(response.headers.get('content-type'));
    if (type === 'application/json') {
      const text = await boundedText(response.body, MAX_MCP_RESPONSE_BYTES, signal,
        () => failure('research_upstream_response_too_large', 502, 'The research service response exceeded its size limit.'));
      return parseRpcResponse(parseJson(text, 'JSON-RPC response'), expectedId);
    }
    if (type !== 'text/event-stream') {
      await cancelBody(response);
      throw failure('research_upstream_protocol_error', 502, 'The research service returned an unsupported response type.');
    }
    if (!response.body) {
      throw failure('research_upstream_protocol_error', 502, 'The research service returned an empty event stream.');
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder('utf-8', { fatal: true });
    const dataLines = [];
    let buffer = '';
    let size = 0;
    const acceptEvent = data => {
      if (data === null) return NO_RESPONSE;
      return parseRpcResponse(parseJson(data, 'event-stream message'), expectedId);
    };
    const processLine = line => acceptEvent(parseSseLine(line, dataLines));

    try {
      while (true) {
        const { done, value } = await readWithSignal(reader.read(), signal);
        if (done) {
          buffer += decoder.decode();
          if (buffer.length > 0) {
            const result = processLine(buffer);
            buffer = '';
            if (result !== NO_RESPONSE) return result;
          }
          const result = processLine('');
          if (result !== NO_RESPONSE) return result;
          break;
        }
        size += value.byteLength;
        if (size > MAX_MCP_RESPONSE_BYTES) {
          throw failure('research_upstream_response_too_large', 502, 'The research service response exceeded its size limit.');
        }
        buffer += decoder.decode(value, { stream: true });
        let newline;
        while ((newline = buffer.indexOf('\n')) !== -1) {
          const line = buffer.slice(0, newline);
          buffer = buffer.slice(newline + 1);
          const result = processLine(line);
          if (result !== NO_RESPONSE) return result;
        }
      }
    } finally {
      try { await reader.cancel(); } catch {}
      reader.releaseLock();
    }
    throw failure('research_upstream_protocol_error', 502, 'The research event stream did not contain the expected response.');
  } catch (error) {
    if (error instanceof ProxyFailure) throw error;
    if (aborted(signal)) throw timeoutFailure(true);
    throw failure('research_upstream_protocol_error', 502, 'The research service returned malformed response bytes.');
  }
}

async function postMcp(message, { fetchImpl, signal, protocolVersion = null, expectedId = null, notification = false }) {
  const headers = {
    Accept: MCP_ACCEPT,
    'Content-Type': 'application/json',
  };
  if (protocolVersion) headers['MCP-Protocol-Version'] = protocolVersion;

  let response;
  try {
    response = await fetchImpl(MCP_ENDPOINT, {
      method: 'POST',
      redirect: 'error',
      headers,
      body: JSON.stringify(message),
      signal,
    });
  } catch {
    if (aborted(signal)) throw timeoutFailure(true);
    throw failure('research_upstream_unavailable', 503, 'The research service could not be reached.');
  }

  if (!response || !response.headers || typeof response.status !== 'number') {
    await cancelBody(response);
    throw failure('research_upstream_protocol_error', 502, 'The research service returned an invalid HTTP response.');
  }
  await assertStateless(response);
  if (notification) {
    if (response.status !== 202) {
      await cancelBody(response);
      throw failure('research_upstream_protocol_error', 502, 'The research service did not accept initialization.');
    }
    await assertResponseWithinLimit(response);
    let text;
    try {
      text = await boundedText(response.body, MAX_MCP_RESPONSE_BYTES, signal,
        () => failure('research_upstream_response_too_large', 502, 'The research service response exceeded its size limit.'));
    } catch (error) {
      if (error instanceof ProxyFailure) throw error;
      if (aborted(signal)) throw timeoutFailure(true);
      throw failure('research_upstream_protocol_error', 502, 'The research service returned malformed notification bytes.');
    }
    if (text !== '') {
      throw failure('research_upstream_protocol_error', 502, 'The research service returned a body for a notification.');
    }
    return null;
  }

  if (response.status < 200 || response.status >= 300) {
    await cancelBody(response);
    assertSuccessfulStatus(response);
  }
  return readJsonRpcResponse(response, expectedId, signal);
}

async function callResearchTool(toolName, args, transport) {
  const initialize = await postMcp({
    jsonrpc: '2.0',
    id: 1,
    method: 'initialize',
    params: {
      protocolVersion: MCP_PROTOCOL_VERSION,
      capabilities: {},
      clientInfo: { name: 'falconos-research-proxy', version: '1.0.0' },
    },
  }, { ...transport, expectedId: 1 });

  if (initialize.protocolVersion !== MCP_PROTOCOL_VERSION || !isObject(initialize.capabilities)
    || !isObject(initialize.capabilities.tools) || !isObject(initialize.serverInfo)) {
    throw failure('research_upstream_protocol_error', 502, 'The research service returned an incompatible initialization result.');
  }

  await postMcp({ jsonrpc: '2.0', method: 'notifications/initialized' }, {
    ...transport,
    protocolVersion: initialize.protocolVersion,
    notification: true,
  });

  const result = await postMcp({
    jsonrpc: '2.0',
    id: 2,
    method: 'tools/call',
    params: { name: toolName, arguments: args },
  }, { ...transport, protocolVersion: initialize.protocolVersion, expectedId: 2 });

  return extractToolPayload(result);
}

async function readReplayBody(request, signal) {
  const contentEncoding = request.headers.get('content-encoding');
  if (contentEncoding && contentEncoding.trim().toLowerCase() !== 'identity') {
    throw failure('unsupported_content_encoding', 415, 'Compressed request bodies are not supported.');
  }
  if (mediaType(request.headers.get('content-type')) !== 'application/json') {
    throw failure('content_type_required', 415, 'Send an application/json request body.');
  }

  const declaredLength = request.headers.get('content-length');
  if (declaredLength !== null) {
    if (!/^\d+$/.test(declaredLength)) throw failure('invalid_body', 400, 'The request body length is invalid.');
    if (Number(declaredLength) > MAX_REQUEST_BODY_BYTES) {
      throw failure('request_too_large', 413, 'The request body exceeded its size limit.');
    }
  }

  let text;
  try {
    text = await boundedText(request.body, MAX_REQUEST_BODY_BYTES, signal,
      () => failure('request_too_large', 413, 'The request body exceeded its size limit.'));
  } catch (error) {
    if (error instanceof ProxyFailure) throw error;
    if (aborted(signal)) throw timeoutFailure(false);
    throw failure('invalid_body', 400, 'The request body is invalid.');
  }

  let payload;
  try {
    payload = JSON.parse(text);
  } catch {
    throw failure('invalid_json', 400, 'The request body is not valid JSON.');
  }
  const exactMatch = EXACT_REPLAY_BODY.exec(text);
  if (!isObject(payload) || Object.keys(payload).length !== 1 || !Object.hasOwn(payload, 'caseId') || !exactMatch) {
    throw failure('invalid_input', 400, 'The request body must contain exactly caseId.');
  }
  return normalizeUuid(payload.caseId, 'caseId');
}

async function execute(request, options, run) {
  const timeoutMs = Number.isSafeInteger(options.timeoutMs) && options.timeoutMs > 0
    ? options.timeoutMs
    : REQUEST_DEADLINE_MS;
  const fetchImpl = typeof options.fetchImpl === 'function' ? options.fetchImpl : fetch;
  const deadline = makeDeadline(timeoutMs);
  try {
    return await run({ request, fetchImpl, signal: deadline.signal });
  } catch (error) {
    if (error instanceof ProxyFailure) return failureResponse(error);
    if (deadline.signal.aborted) return failureResponse(timeoutFailure(true));
    return failureResponse(error);
  } finally {
    deadline.clear();
  }
}

export function handleResearchNear(request, options = {}) {
  return execute(request, options, async ({ request: incoming, fetchImpl, signal }) => {
    requireMethod(incoming, 'GET');
    requireSameOrigin(incoming);
    const { caseId } = exactQuery(incoming, ['caseId']);
    const args = caseId === undefined ? {} : { caseId: normalizeUuid(caseId, 'caseId') };
    const payload = await callResearchTool('falcon_research_case', args, { fetchImpl, signal });
    const serialized = JSON.stringify(payload);
    if (encoder.encode(serialized).byteLength > MAX_CASE_RESPONSE_BYTES) {
      throw failure('research_upstream_response_too_large', 502, 'The research case exceeded its size limit.');
    }
    return new Response(serialized, {
      status: 200,
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
        'Cache-Control': 'no-store',
        'X-Content-Type-Options': 'nosniff',
      },
    });
  });
}

export function handleResearchNearReplay(request, options = {}) {
  return execute(request, options, async ({ request: incoming, fetchImpl, signal }) => {
    requireMethod(incoming, 'POST');
    requireSameOrigin(incoming);
    exactQuery(incoming, []);
    const caseId = await readReplayBody(incoming, signal);
    const payload = await callResearchTool('falcon_replay_research_case', { caseId }, { fetchImpl, signal });
    const serialized = JSON.stringify(payload);
    if (encoder.encode(serialized).byteLength > MAX_CASE_RESPONSE_BYTES) {
      throw failure('research_upstream_response_too_large', 502, 'The replay result exceeded its size limit.');
    }
    return new Response(serialized, {
      status: 200,
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
        'Cache-Control': 'no-store',
        'X-Content-Type-Options': 'nosniff',
      },
    });
  });
}

export function handleResearchNearSource(request, options = {}) {
  return execute(request, options, async ({ request: incoming, fetchImpl, signal }) => {
    requireMethod(incoming, 'GET');
    requireSameOrigin(incoming);
    const { revisionId } = exactQuery(incoming, ['revisionId'], ['revisionId']);
    const normalizedRevisionId = normalizeUuid(revisionId, 'revisionId');
    const payload = await callResearchTool('falcon_research_source', { revisionId: normalizedRevisionId }, { fetchImpl, signal });
    const serialized = JSON.stringify(payload);
    if (encoder.encode(serialized).byteLength > MAX_SOURCE_RESPONSE_BYTES) {
      throw failure('research_upstream_response_too_large', 502, 'The research source exceeded its size limit.');
    }
    return new Response(serialized, {
      status: 200,
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
        'Cache-Control': 'no-store',
        'X-Content-Type-Options': 'nosniff',
        'Content-Disposition': `attachment; filename="falcon-research-source-${normalizedRevisionId}.json"`,
      },
    });
  });
}
