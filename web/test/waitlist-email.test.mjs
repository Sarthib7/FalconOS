import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { createLocalWaitlist } from '../waitlist-local.mjs';
import { handleWaitlist } from '../functions/api/waitlist.js';

const PROVIDER_ID = '49a3999c-0ce1-4ea6-ab68-afcd6dc2e794';
const configured = { RESEND_API_KEY: 'fixture-key-not-a-credential', WAITLIST_FROM_EMAIL: 'waitlist@example.com' };

async function local(t, fetchImpl, options = {}) {
  const directory = mkdtempSync(join(tmpdir(), 'falcon-email-test-'));
  const databasePath = join(directory, 'waitlist.sqlite');
  const adapter = createLocalWaitlist({ databasePath, ipSalt: 'test-only-salt', emailEnv: configured, fetchImpl, ...options });
  const server = createServer((req, res) => adapter.middleware(req, res, () => { res.writeHead(404); res.end(); }));
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  t.after(async () => { await new Promise(resolve => server.close(resolve)); adapter.close(); rmSync(directory, { recursive: true, force: true }); });
  const post = async (email = 'capture@example.com') => {
    const response = await fetch(`http://127.0.0.1:${server.address().port}/api/waitlist`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email, source: 'landing' }),
    });
    return { status: response.status, body: await response.json() };
  };
  const read = sql => {
    const db = new DatabaseSync(databasePath, { readOnly: true });
    try { return db.prepare(sql).all(); } finally { db.close(); }
  };
  return { post, read, databasePath };
}

test('V106: provider acceptance is retained and duplicate signup cannot send twice', async t => {
  const calls = [];
  let server;
  server = await local(t, async (url, options) => {
    assert.equal(url, 'https://api.resend.com/emails'); assert.equal(options.redirect, 'error');
    assert.equal(options.headers.authorization, `Bearer ${configured.RESEND_API_KEY}`);
    assert.equal(server.read('SELECT email FROM waitlist_entries').length, 1);
    assert.equal(server.read('SELECT status FROM waitlist_email_outbox')[0].status, 'inflight');
    calls.push(options);
    return new Response(JSON.stringify({ id: PROVIDER_ID }), { status: 200 });
  });
  assert.deepEqual((await server.post()).body, { status: 'registered', emailStatus: 'accepted' });
  assert.deepEqual((await server.post()).body, { status: 'already_registered', emailStatus: 'accepted' });
  assert.equal(calls.length, 1);
  const [job] = server.read('SELECT * FROM waitlist_email_outbox');
  assert.equal(job.status, 'accepted'); assert.equal(job.provider_email_id, PROVIDER_ID); assert.equal(job.attempts, 1);
  assert.equal(calls[0].headers['idempotency-key'], `waitlist/${job.id}`);
  assert.equal(job.request_body, calls[0].body);
  assert.deepEqual(Object.keys(JSON.parse(job.request_body)).sort(), ['from', 'subject', 'text', 'to']);
  assert.deepEqual(JSON.parse(job.request_body).to, ['capture@example.com']);
});

test('V106: overlapping signup claims one delivery and reports the second as pending', async t => {
  let release; let entered; let calls = 0;
  const started = new Promise(resolve => { entered = resolve; });
  const server = await local(t, async () => {
    calls += 1; entered();
    await new Promise(resolve => { release = resolve; });
    return new Response(JSON.stringify({ id: PROVIDER_ID }));
  });
  const first = server.post(); await started;
  assert.equal((await server.post()).body.emailStatus, 'pending');
  release(); assert.equal((await first).body.emailStatus, 'accepted'); assert.equal(calls, 1);
});

test('V106: ambiguous delivery retries the same stored body and idempotency key', async t => {
  const calls = [];
  const server = await local(t, async (_url, options) => {
    calls.push({ key: options.headers['idempotency-key'], body: options.body });
    if (calls.length === 1) throw new Error('fixture network disconnect');
    return new Response(JSON.stringify({ id: PROVIDER_ID }));
  });
  assert.equal((await server.post()).body.emailStatus, 'unknown');
  assert.equal((await server.post()).body.emailStatus, 'accepted');
  assert.deepEqual(calls[0], calls[1]);
  assert.equal(server.read('SELECT attempts FROM waitlist_email_outbox')[0].attempts, 2);
});

test('V106: unknown delivery after the idempotency window requires review and cannot resend', async t => {
  let time = Date.now(); let calls = 0;
  const server = await local(t, async () => { calls += 1; throw new Error('fixture disconnect'); }, { now: () => time });
  assert.equal((await server.post()).body.emailStatus, 'unknown');
  time += 24 * 60 * 60 * 1000;
  assert.equal((await server.post()).body.emailStatus, 'unknown'); assert.equal(calls, 1);
  assert.equal(server.read('SELECT last_error_code FROM waitlist_email_outbox')[0].last_error_code, 'idempotency_window_expired');
});

test('V106: partial, invalid and absent sender configuration capture without calling a provider', async t => {
  for (const emailEnv of [{}, { RESEND_API_KEY: 'fixture' }, { ...configured, WAITLIST_FROM_EMAIL: 'bad\r\nBcc: victim@example.com' }]) {
    const server = await local(t, async () => { assert.fail('Provider must remain unused'); }, { emailEnv });
    assert.equal((await server.post()).body.emailStatus, 'not_configured');
    assert.equal(server.read('SELECT email FROM waitlist_entries').length, 1);
    assert.equal(server.read('SELECT id FROM waitlist_email_outbox').length, 0);
  }
});

test('V106: strict sender dot-atom and length validation prevents invalid provider requests', async t => {
  for (const from of ['..@example.com', '.waitlist@example.com', 'waitlist.@example.com', 'wait..list@example.com',
    `${'a'.repeat(65)}@example.com`, `waitlist@${'a'.repeat(64)}.com`]) {
    let calls = 0;
    const server = await local(t, async () => { calls += 1; return new Response(JSON.stringify({ id: PROVIDER_ID })); },
      { emailEnv: { ...configured, WAITLIST_FROM_EMAIL: from } });
    assert.equal((await server.post()).body.emailStatus, 'not_configured', from);
    assert.equal(calls, 0);
    assert.equal(server.read('SELECT email FROM waitlist_entries').length, 1);
    assert.equal(server.read('SELECT id FROM waitlist_email_outbox').length, 0);
  }
});

test('V106: rejected, oversized and invalid provider receipts never claim acceptance', async t => {
  for (const [provider, expected] of [
    [() => new Response('{"message":"fixture failure"}', { status: 422 }), 'failed'],
    [() => new Response('{"message":"fixture failure"}', { status: 503 }), 'unknown'],
    [() => new Response('{"id":"not-a-provider-id"}'), 'unknown'],
    [() => new Response('x'.repeat(16 * 1024 + 1)), 'unknown'],
    [() => ({ redirected: true }), 'unknown'],
  ]) {
    const server = await local(t, async () => provider());
    const response = await server.post(); assert.equal(response.status, 201); assert.equal(response.body.emailStatus, expected);
    assert.equal(server.read('SELECT provider_email_id FROM waitlist_email_outbox')[0].provider_email_id, null);
    assert.equal(server.read('SELECT email FROM waitlist_entries').length, 1);
  }
});

test('V106: atomic enqueue failure cannot return capture success or call a provider', async () => {
  let providerCalls = 0;
  const db = {
    prepare() { return { bind: () => ({ first: async () => ({ attempts: 1 }) }) }; },
    async batch() { throw new Error('fixture transaction rollback'); },
  };
  const response = await handleWaitlist(new Request('https://falconos.markets/api/waitlist', {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: '{"email":"capture@example.com"}',
  }), { ...configured, WAITLIST_DB: db, WAITLIST_IP_SALT: 'fixture-salt' }, { fetchImpl: async () => { providerCalls += 1; } });
  assert.equal(response.status, 503); assert.equal(providerCalls, 0);
});

test('V105,V106: full migration history preserves captured rows and older databases are not upgraded automatically', t => {
  const directory = mkdtempSync(join(tmpdir(), 'falcon-email-migration-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const databasePath = join(directory, 'old.sqlite');
  const db = new DatabaseSync(databasePath);
  db.exec(readFileSync(new URL('../migrations/0001_waitlist.sql', import.meta.url), 'utf8'));
  db.prepare('INSERT INTO waitlist_entries (email, source, ip_hash) VALUES (?, ?, ?)').run('keep@example.com', 'landing', 'fixture');
  db.close();
  assert.throws(() => createLocalWaitlist({ databasePath, ipSalt: 'fixture' }), /unknown or older schema/);
  const migration = new DatabaseSync(databasePath);
  migration.exec(readFileSync(new URL('../migrations/0002_waitlist_email_outbox.sql', import.meta.url), 'utf8'));
  assert.equal(migration.prepare('SELECT email FROM waitlist_entries').get().email, 'keep@example.com'); migration.close();
  createLocalWaitlist({ databasePath, ipSalt: 'fixture' }).close();
});
