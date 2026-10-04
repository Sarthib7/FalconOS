// Shared client for the falcon-mesh API. The token is supplied per call and is never stored here.
export const API_BASE = (import.meta.env?.VITE_MESH_API_URL || 'http://127.0.0.1:8791').replace(/\/$/, '');
export const TOKEN_PATTERN = /^[A-Za-z0-9._~-]{32,256}$/;

export async function meshRequest(token, path, body) {
  let response;
  try {
    response = await fetch(`${API_BASE}${path}`, {
      method: body === undefined ? 'GET' : 'POST', credentials: 'omit', redirect: 'error',
      headers: { accept: 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}), ...(body === undefined ? {} : { 'content-type': 'application/json' }) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(path === '/v1/captures' || path.startsWith('/v1/lending/') ? 45000 : 15000),
    });
  } catch { throw new Error('The mesh service did not respond. Check the service and its allowed viewer origin, then try again.'); }
  let payload;
  try { payload = await response.json(); } catch { throw new Error(`The mesh service returned an unreadable response (HTTP ${response.status}).`); }
  if (!response.ok) throw new Error(`${payload?.error?.code ?? `HTTP ${response.status}`}: ${payload?.error?.message ?? 'The request failed.'}`);
  return payload;
}

// Unauthenticated service health. Never throws; ok is true only for HTTP 200 with {status:'ready'}.
export async function meshReady() {
  let response;
  try { response = await fetch(`${API_BASE}/readyz`, { method: 'GET', credentials: 'omit', redirect: 'error', headers: { accept: 'application/json' }, signal: AbortSignal.timeout(8000) }); } catch { return { ok: false, status: 'unreachable' }; }
  let payload;
  try { payload = await response.json(); } catch { return { ok: false, status: 'unavailable' }; }
  return response.status === 200 && payload?.status === 'ready' ? { ok: true, status: 'ready' } : { ok: false, status: 'unavailable' };
}

// Live capture status of one connector, read from its `observation:live:<id>` node in /v1/graph/live.
const OBSERVATION = { ok: ['OBSERVED', 'ok'], unavailable: ['UNAVAILABLE', 'warn'], invalid: ['INVALID', 'warn'], too_large: ['TOO_LARGE', 'warn'] };
export function connectorObservation(graph, connectorId) {
  const node = graph?.nodes?.find(item => item.id === `observation:live:${connectorId}` && item.kind === 'observation');
  if (!node) return { label: 'NO_DATA', kind: 'warn', reasonCode: null };
  const [label, kind] = OBSERVATION[node.properties?.status] ?? ['NO_DATA', 'warn'];
  return { label, kind, reasonCode: node.properties?.reasonCode ?? null };
}
export const getYieldOpportunities = token => meshRequest(token, '/v1/yield/opportunities');
export const simulateYield = (token, input) => meshRequest(token, '/v1/yield/simulations', input);
