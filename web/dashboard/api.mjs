// Shared client for the falcon-mesh API. The token is supplied per call and is never stored here.
export const API_BASE = (import.meta.env?.VITE_MESH_API_URL || 'http://127.0.0.1:8791').replace(/\/$/, '');
export const TOKEN_PATTERN = /^[A-Za-z0-9._~-]{32,256}$/;

export async function meshRequest(token, path, body) {
  let response;
  try {
    response = await fetch(`${API_BASE}${path}`, {
      method: body === undefined ? 'GET' : 'POST', credentials: 'omit', redirect: 'error',
      headers: { accept: 'application/json', authorization: `Bearer ${token}`, ...(body === undefined ? {} : { 'content-type': 'application/json' }) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(path === '/v1/captures' || path.startsWith('/v1/lending/') ? 45000 : 15000),
    });
  } catch { throw new Error('The mesh service did not respond. Check the service and its allowed viewer origin, then try again.'); }
  let payload;
  try { payload = await response.json(); } catch { throw new Error(`The mesh service returned an unreadable response (HTTP ${response.status}).`); }
  if (!response.ok) throw new Error(`${payload?.error?.code ?? `HTTP ${response.status}`}: ${payload?.error?.message ?? 'The request failed.'}`);
  return payload;
}
