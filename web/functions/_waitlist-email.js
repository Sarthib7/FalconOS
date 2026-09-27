const RESEND_URL = 'https://api.resend.com/emails';
const DEADLINE_MS = 10000;
const RESPONSE_LIMIT = 16 * 1024;
const LEASE_MS = 30000;
const RETRY_WINDOW_MS = 24 * 60 * 60 * 1000 - DEADLINE_MS;
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const FROM_EMAIL = /^[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9-]*[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]*[a-zA-Z0-9])?)+$/;
const INSERT_ENTRY = 'INSERT INTO waitlist_entries (email, source, ip_hash) VALUES (?1, ?2, ?3) ON CONFLICT(email) DO NOTHING';
const UPDATE_ENTRY = "UPDATE waitlist_entries SET source = ?2, updated_at = datetime('now') WHERE email = ?1";

function providerConfig(env) {
  const key = env.RESEND_API_KEY;
  const from = env.WAITLIST_FROM_EMAIL;
  if (typeof key !== 'string' || !/^[\x21-\x7e]{1,512}$/.test(key)
    || typeof from !== 'string' || from.length > 254 || !FROM_EMAIL.test(from)) return null;
  const [local, domain] = from.split('@');
  if (local.length > 64 || local.startsWith('.') || local.endsWith('.') || local.includes('..')
    || domain.split('.').some(label => label.length > 63)) return null;
  return { key, from };
}

function validWrite(result) {
  if (result?.success === false || !Number.isSafeInteger(result?.meta?.changes) || result.meta.changes < 0) throw new Error('Waitlist write was not confirmed.');
  return result;
}

async function sendConfirmation(config, job, fetchImpl) {
  const controller = new AbortController();
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => { controller.abort(); reject(new Error('timeout')); }, DEADLINE_MS);
  });
  try {
    return await Promise.race([timeout, (async () => {
      const response = await fetchImpl(RESEND_URL, {
        method: 'POST', redirect: 'error', signal: controller.signal,
        headers: { authorization: `Bearer ${config.key}`, 'content-type': 'application/json', 'idempotency-key': `waitlist/${job.id}` },
        body: job.request_body,
      });
      if (response.redirected || !response.body?.getReader) throw new Error('invalid_response');
      const reader = response.body.getReader();
      const chunks = [];
      let size = 0;
      for (;;) {
        const { done, value } = await reader.read();
        if (controller.signal.aborted) throw new Error('timeout');
        if (done) break;
        size += value.byteLength;
        if (size > RESPONSE_LIMIT) { await reader.cancel(); throw new Error('large_response'); }
        chunks.push(value);
      }
      const bytes = new Uint8Array(size); let offset = 0;
      for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
      if (response.status < 200 || response.status >= 300) {
        return { status: response.status >= 500 ? 'unknown' : 'failed', providerId: null, errorCode: `http_${response.status}` };
      }
      const body = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
      if (!body || typeof body.id !== 'string' || !UUID.test(body.id)) throw new Error('invalid_receipt');
      return { status: 'accepted', providerId: body.id, errorCode: null };
    })()]);
  } catch {
    return { status: 'unknown', providerId: null, errorCode: 'delivery_unconfirmed' };
  } finally { clearTimeout(timer); }
}

async function attemptOne(env, config, email, fetchImpl, now) {
  const db = env.WAITLIST_DB;
  const job = await db.prepare('SELECT * FROM waitlist_email_outbox WHERE email = ?1').bind(email).first();
  if (!job || !UUID.test(job.id)) return 'unknown';
  if (job.status === 'accepted') return UUID.test(job.provider_email_id || '') ? 'accepted' : 'unknown';
  const time = now();
  if (!Number.isSafeInteger(time) || time < 0) throw new Error('Invalid delivery clock.');
  if (job.retry_until !== null && time >= job.retry_until) {
    validWrite(await db.prepare("UPDATE waitlist_email_outbox SET status = 'unknown', last_error_code = 'idempotency_window_expired', updated_at = datetime('now') WHERE id = ?1 AND status != 'accepted'").bind(job.id).run());
    return 'unknown';
  }
  if (job.lease_until !== null && job.lease_until > time) return 'pending';
  if (job.attempts >= 3) return job.status === 'failed' ? 'failed' : 'unknown';
  const claim = crypto.randomUUID();
  const claimed = await db.prepare(`UPDATE waitlist_email_outbox SET status = 'inflight', claim_id = ?1,
    attempts = attempts + 1, first_attempt_at = COALESCE(first_attempt_at, ?2), retry_until = COALESCE(retry_until, ?3),
    lease_until = ?4, updated_at = datetime('now') WHERE id = ?5 AND status != 'accepted' AND attempts < 3
    AND (lease_until IS NULL OR lease_until <= ?2) AND (retry_until IS NULL OR retry_until > ?2) RETURNING *`)
    .bind(claim, time, time + RETRY_WINDOW_MS, time + LEASE_MS, job.id).first();
  if (!claimed) return 'pending';
  const outcome = await sendConfirmation(config, claimed, fetchImpl);
  const saved = validWrite(await db.prepare(`UPDATE waitlist_email_outbox SET status = ?1, provider_email_id = ?2,
    last_error_code = ?3, lease_until = NULL, claim_id = NULL, updated_at = datetime('now') WHERE id = ?4 AND claim_id = ?5`)
    .bind(outcome.status, outcome.providerId, outcome.errorCode, job.id, claim).run());
  return saved.meta.changes === 1 ? outcome.status : 'unknown';
}

export async function captureWaitlist(env, { email, source, ipHash }, { fetchImpl = globalThis.fetch, now = Date.now } = {}) {
  const entry = env.WAITLIST_DB.prepare(INSERT_ENTRY).bind(email, source, ipHash);
  const statements = [entry, env.WAITLIST_DB.prepare(UPDATE_ENTRY).bind(email, source)];
  const config = providerConfig(env);
  if (config) {
    const id = crypto.randomUUID();
    const body = JSON.stringify({ from: config.from, to: [email], subject: 'FalconOS waitlist confirmation',
      text: 'Your email address is on the FalconOS waitlist. We will email you when access is available.' });
    statements.push(env.WAITLIST_DB.prepare('INSERT INTO waitlist_email_outbox (id, email, request_body) VALUES (?1, ?2, ?3) ON CONFLICT(email) DO NOTHING').bind(id, email, body));
  }
  // D1 batch is transactional. No confirmation request precedes durable capture and enqueue.
  const batch = await env.WAITLIST_DB.batch(statements);
  if (!Array.isArray(batch) || batch.length !== statements.length) throw new Error('Waitlist enqueue was not confirmed.');
  batch.forEach(validWrite);
  if (!config) return { result: batch[0], emailStatus: 'not_configured' };
  let emailStatus;
  try { emailStatus = await attemptOne(env, config, email, fetchImpl, now); }
  catch { emailStatus = 'unknown'; }
  return { result: batch[0], emailStatus };
}
