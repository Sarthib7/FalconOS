import { randomUUID } from 'node:crypto';

const AUTH_PREFIX = '/v1/auth/wallet/';
const CODE = /^[A-Z][A-Z0-9_]{1,39}$/;
const MAX_RESPONSE_CHARS = 8 * 1024 * 1024;

// A failure that maps directly to a tool error result. The message is safe to show to the model.
export class ToolError extends Error {
  constructor(code, message, retryAfterSeconds) {
    super(message);
    this.code = code;
    if (retryAfterSeconds !== undefined) this.retryAfterSeconds = retryAfterSeconds;
  }
}

const unavailable = () => new ToolError('MESH_UNAVAILABLE', 'The Falcon Mesh API did not respond. Retry shortly.');

function retryAfter(header) {
  if (typeof header !== 'string' || !/^\d{1,6}$/.test(header)) return undefined;
  return Number(header);
}

// Thin fetch wrapper for the Mesh API. Origin goes only to wallet-auth routes, Bearer only when a session is given.
// Nothing here logs; error text is copied from Mesh or fixed.
export function createMeshClient({ baseUrl, origin, fetchImpl = globalThis.fetch, timeoutMs = 15_000, captureTimeoutMs = 45_000 }) {
  async function request(method, path, { session, body, timeout = timeoutMs } = {}) {
    const headers = { Accept: 'application/json' };
    if (path.startsWith(AUTH_PREFIX)) headers.Origin = origin;
    if (session) headers.Authorization = `Bearer ${session}`;
    const init = { method, headers, redirect: 'error', signal: AbortSignal.timeout(timeout) };
    if (body !== undefined) { headers['Content-Type'] = 'application/json'; init.body = JSON.stringify(body); }
    let response;
    let text;
    try {
      response = await fetchImpl(`${baseUrl}${path}`, init);
      text = await response.text();
    } catch { throw unavailable(); }
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
    origin,
    request,
    get: (path, session) => request('GET', path, { session }),
    post: (path, body, session, timeout) => request('POST', path, { session, body, timeout }),
    captureTimeoutMs,
    newRequestId: () => randomUUID(),
    async ready() {
      try {
        const response = await fetchImpl(`${baseUrl}/readyz`, { method: 'GET', redirect: 'error', signal: AbortSignal.timeout(5000) });
        await response.arrayBuffer();
        return response.ok;
      } catch { return false; }
    },
  };
}
