const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MAX_BODY_BYTES = 4096;
const MAX_SUBMISSIONS_PER_HOUR = 5;

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

  const body = await request.text();
  if (new TextEncoder().encode(body).byteLength > MAX_BODY_BYTES) return json({ error: 'request_too_large' }, 413);

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

  const recent = await env.WAITLIST_DB
    .prepare("SELECT COUNT(*) AS count FROM waitlist_entries WHERE ip_hash = ?1 AND created_at > datetime('now', '-1 hour')")
    .bind(ipHash)
    .first();
  if (Number(recent?.count || 0) >= MAX_SUBMISSIONS_PER_HOUR) return json({ error: 'rate_limited' }, 429);

  const result = await env.WAITLIST_DB
    .prepare("INSERT INTO waitlist_entries (email, source, ip_hash) VALUES (?1, ?2, ?3) ON CONFLICT(email) DO UPDATE SET source = excluded.source, updated_at = datetime('now')")
    .bind(email, source, ipHash)
    .run();

  return json({ status: result.meta?.changes === 0 ? 'already_registered' : 'registered' }, result.meta?.changes === 0 ? 200 : 201);
}

export async function onRequestPost(context) {
  return handleWaitlist(context.request, context.env);
}
