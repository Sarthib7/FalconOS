import { randomUUID } from 'node:crypto';

const CODE = /^[A-Z][A-Z0-9_]{1,39}$/;
const MAX_RESPONSE_CHARS = 8 * 1024 * 1024;

// A failure that maps directly to a tool error result. Never include request headers in errors.
export class ToolError extends Error {
  constructor(code, message, retryAfterSeconds) {
    super(message); this.code = code;
    if (retryAfterSeconds !== undefined) this.retryAfterSeconds = retryAfterSeconds;
  }
}

const unavailable = () => new ToolError('MESH_UNAVAILABLE', 'The Falcon Mesh API did not respond. Retry shortly.');

function retryAfter(header) {
  if (typeof header !== 'string' || !/^\d{1,6}$/.test(header)) return undefined;
  return Number(header);
}

// The bearer identifies the wallet. The separate service secret proves this is the MCP server.
export function createMeshClient({ baseUrl, serviceSecret, fetchImpl = globalThis.fetch, timeoutMs = 15_000, captureTimeoutMs = 45_000 }) {
  async function request(method, path, { accessToken, body, timeout = timeoutMs } = {}) {
    const headers = { Accept: 'application/json' };
    if (path.startsWith('/v1/')) headers['X-Falcon-MCP-Service-Token'] = serviceSecret;
    if (accessToken) headers.Authorization = 'Bearer ' + accessToken;
    const init = { method, headers, redirect: 'error', signal: AbortSignal.timeout(timeout) };
    if (body !== undefined) { headers['Content-Type'] = 'application/json'; init.body = JSON.stringify(body); }
    let response; let text;
    try { response = await fetchImpl(baseUrl + path, init); text = await response.text(); }
    catch { throw unavailable(); }
    if (text.length > MAX_RESPONSE_CHARS) throw unavailable();
    let payload = null;
    try { payload = text ? JSON.parse(text) : null; } catch { payload = null; }
    if (response.ok) {
      if (!payload || typeof payload !== 'object' || Array.isArray(payload)) throw unavailable();
      return payload;
    }
    const error = payload?.error;
    if (error && typeof error.code === 'string' && CODE.test(error.code) && typeof error.message === 'string' && error.message.length <= 500) {
      throw new ToolError(error.code, error.message, retryAfter(response.headers.get('retry-after')));
    }
    throw unavailable();
  }
  return {
    request,
    get: (path, accessToken) => request('GET', path, { accessToken }),
    post: (path, body, accessToken, timeout) => request('POST', path, { accessToken, body, timeout }),
    introspect: accessToken => request('POST', '/v1/oauth/introspect', { accessToken }),
    captureTimeoutMs,
    newRequestId: () => randomUUID(),
    async ready() {
      try {
        const response = await fetchImpl(baseUrl + '/readyz', { method: 'GET', redirect: 'error', signal: AbortSignal.timeout(5000) });
        await response.arrayBuffer(); return response.ok;
      } catch { return false; }
    },
  };
}
