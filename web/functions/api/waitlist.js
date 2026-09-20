const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MAX_BODY_BYTES = 4096;
const MAX_SUBMISSIONS_PER_HOUR = 5;
const WINDOW_MS = 60 * 60 * 1000;

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8' }
  });
}

function normalizeEmail(value) {
  if (typeof value !== 'string') return null;
  const email = value.trim().toLowerCase();
  return email.length <= 320 && EMAIL_PATTERN.test(email) ? email : null;
}

async function readBoundedBody(request) {
  if (!request.body) return '';
  const reader = request.body.getReader();
  const chunks = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_BODY_BYTES) {
        await reader.cancel();
        return null;
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(bytes);
}

async function digest(value) {
  const bytes = new TextEncoder().encode(value);
  const hash = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(hash)].map(byte => byte.toString(16).padStart(2, '0')).join('');
}

export async function handleWaitlist(request, env) {
  if (request.method !== 'POST') return json({ error: 'method_not_allowed' }, 405);
  if (!env?.WAITLIST_DB || !env?.WAITLIST_IP_SALT) return json({ error: 'waitlist_unavailable' }, 503);

  const contentType = request.headers.get('content-type') || '';
  if (!contentType.toLowerCase().startsWith('application/json')) return json({ error: 'content_type_required' }, 415);

  const origin = request.headers.get('origin');
  if (origin && origin !== new URL(request.url).origin) return json({ error: 'origin_not_allowed' }, 403);

  let body;
  try {
    body = await readBoundedBody(request);
  } catch {
    return json({ error: 'invalid_body' }, 400);
  }
  if (body === null) return json({ error: 'request_too_large' }, 413);

  let payload;
  try {
    payload = JSON.parse(body);
  } catch {
    return json({ error: 'invalid_json' }, 400);
  }

  const email = normalizeEmail(payload?.email);
  if (!email) return json({ error: 'invalid_email' }, 400);

  const source = typeof payload?.source === 'string' && payload.source.length <= 64
    ? payload.source.trim() || 'landing'
    : 'landing';
  const clientIp = request.headers.get('cf-connecting-ip') || 'unknown';
  const ipHash = await digest(env.WAITLIST_IP_SALT + ':' + clientIp);
  const windowStart = Math.floor(Date.now() / WINDOW_MS);

  const rate = await env.WAITLIST_DB
    .prepare(`
      INSERT INTO waitlist_rate_limits (ip_hash, window_start, attempts)
      VALUES (?1, ?2, 1)
      ON CONFLICT(ip_hash) DO UPDATE SET
        window_start = CASE
          WHEN waitlist_rate_limits.window_start = excluded.window_start
          THEN waitlist_rate_limits.window_start
          ELSE excluded.window_start
        END,
        attempts = CASE
          WHEN waitlist_rate_limits.window_start = excluded.window_start
          THEN waitlist_rate_limits.attempts + 1
          ELSE 1
        END
      RETURNING attempts
    `)
    .bind(ipHash, windowStart)
    .first();
  if (!rate) return json({ error: 'waitlist_unavailable' }, 503);
  if (Number(rate.attempts) > MAX_SUBMISSIONS_PER_HOUR) return json({ error: 'rate_limited' }, 429);

  const result = await env.WAITLIST_DB
    .prepare("INSERT INTO waitlist_entries (email, source, ip_hash) VALUES (?1, ?2, ?3) ON CONFLICT(email) DO UPDATE SET source = excluded.source, updated_at = datetime('now')")
    .bind(email, source, ipHash)
    .run();

  return json({ status: result.meta?.changes === 0 ? 'already_registered' : 'registered' }, result.meta?.changes === 0 ? 200 : 201);
}

export async function onRequestPost(context) {
  return handleWaitlist(context.request, context.env);
}
