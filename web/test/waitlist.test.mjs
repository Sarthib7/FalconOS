import assert from 'node:assert/strict';
import test from 'node:test';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { handleWaitlist } from '../functions/api/waitlist.js';
import { createLocalWaitlist } from '../waitlist-local.mjs';

function makeDb({ attempts = 0, changes = 1 } = {}) {
  const calls = [];
  let nextAttempts = attempts;
  return {
    calls,
    async batch(statements) { return Promise.all(statements.map(statement => statement.run())); },
    prepare(sql) {
      calls.push(sql);
      const rateLimitQuery = sql.includes('waitlist_rate_limits');
      return {
        bind(...values) {
          calls.push(values);
          return {
            first: async () => rateLimitQuery ? { attempts: ++nextAttempts } : null,
            run: async () => ({ meta: { changes } })
          };
        }
      };
    }
  };
}

const env = (options) => ({ WAITLIST_DB: makeDb(options), WAITLIST_IP_SALT: 'test-salt' });

function request(body, headers = {}) {
  return new Request('https://falconos.markets/api/waitlist', {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify(body)
  });
}

function chunkedRequest(body, headers = {}) {
  const bytes = new TextEncoder().encode(body);
  const stream = new ReadableStream({
    start(controller) {
      controller.enqueue(bytes);
      controller.close();
    }
  });
  return new Request('https://falconos.markets/api/waitlist', {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: stream,
    duplex: 'half'
  });
}

test('waitlist accepts and normalizes a valid email', async () => {
  const testEnv = env();
  const response = await handleWaitlist(request({ email: ' User@Example.COM ', source: 'landing' }), testEnv);
  assert.equal(response.status, 201);
  assert.deepEqual(await response.json(), { status: 'registered', emailStatus: 'not_configured' });
  assert.deepEqual(testEnv.WAITLIST_DB.calls[3][0], 'user@example.com');
});

test('waitlist rejects invalid email before database writes', async () => {
  const testEnv = env();
  const response = await handleWaitlist(request({ email: 'not-an-email' }), testEnv);
  assert.equal(response.status, 400);
  assert.deepEqual(await response.json(), { error: 'invalid_email' });
  assert.equal(testEnv.WAITLIST_DB.calls.length, 0);
});

test('waitlist rejects oversized chunked bodies before database writes', async () => {
  const testEnv = env();
  const response = await handleWaitlist(chunkedRequest(JSON.stringify({ email: 'user@example.com', padding: 'x'.repeat(5000) })), testEnv);
  assert.equal(response.status, 413);
  assert.deepEqual(await response.json(), { error: 'request_too_large' });
  assert.equal(testEnv.WAITLIST_DB.calls.length, 0);
});

test('waitlist counts repeated submissions even for one email', async () => {
  const testEnv = env();
  const responses = await Promise.all(
    Array.from({ length: 6 }, () => handleWaitlist(request({ email: 'user@example.com' }), testEnv))
  );
  assert.equal(responses.filter(response => response.status === 201).length, 5);
  assert.equal(responses.filter(response => response.status === 429).length, 1);
  assert.equal(testEnv.WAITLIST_DB.calls.filter(call => typeof call === 'string' && call.includes('INSERT INTO waitlist_entries')).length, 5);
});

test('waitlist limits concurrent new emails with one atomic counter', async () => {
  const testEnv = env();
  const responses = await Promise.all(
    Array.from({ length: 6 }, (_, index) => handleWaitlist(request({ email: `user${index}@example.com` }), testEnv))
  );
  assert.equal(responses.filter(response => response.status === 201).length, 5);
  assert.equal(responses.filter(response => response.status === 429).length, 1);
});

test('waitlist rate-limits when the atomic counter reaches the limit', async () => {
  const testEnv = env({ attempts: 5 });
  const response = await handleWaitlist(request({ email: 'user@example.com' }), testEnv);
  assert.equal(response.status, 429);
  assert.deepEqual(await response.json(), { error: 'rate_limited' });
});

test('waitlist fails closed when production bindings are missing', async () => {
  const response = await handleWaitlist(request({ email: 'user@example.com' }), {});
  assert.equal(response.status, 503);
  assert.deepEqual(await response.json(), { error: 'waitlist_unavailable' });
});

test('V105: storage exceptions and malformed write results return safe 503 JSON', async () => {
  for (const stage of ['prepare', 'first', 'run', 'result']) {
    const testEnv = env();
    testEnv.WAITLIST_DB = {
      async batch(statements) { return Promise.all(statements.map(statement => statement.run())); },
      prepare() {
        if (stage === 'prepare') throw new Error('PRIVATE_SQL_SENTINEL');
        return { bind: () => ({
          first: async () => { if (stage === 'first') throw new Error('PRIVATE_SQL_SENTINEL'); return { attempts: 1 }; },
          run: async () => { if (stage === 'run') throw new Error('PRIVATE_SQL_SENTINEL'); return { success: false }; },
        }) };
      },
    };
    const response = await handleWaitlist(request({ email: 'capture@example.com' }), testEnv);
    assert.equal(response.status, 503);
    assert.deepEqual(await response.json(), { error: 'waitlist_unavailable' });
    assert.equal(response.headers.get('cache-control'), 'no-store');
  }
});

test('V105: malformed UTF-8, unknown fields and invalid source cannot reach storage', async () => {
  const invalidUtf8 = new Request('https://falconos.markets/api/waitlist', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: Uint8Array.from([...new TextEncoder().encode('{"email":"a'), 0xc3, 0x28, ...new TextEncoder().encode('@example.com"}')]),
  });
  const cases = [invalidUtf8, request([]), request(null), request({ email: 'a@example.com', admin: true }),
    request({ email: 'a@example.com', source: 3 }), request({ email: 'a@example.com', source: 'é'.repeat(33) }),
    request({ email: 'a@example.com', source: 'a\u0000b' }), request({ email: 'a\u0000b@example.com' }),
    request({ email: 'a\ud800@example.com' })];
  for (const input of cases) {
    const testEnv = env(); const response = await handleWaitlist(input, testEnv);
    assert.equal(response.status, 400); assert.equal(testEnv.WAITLIST_DB.calls.length, 0);
  }
});

test('V105: same-origin and exact JSON media type checks run before writes', async () => {
  for (const [headers, status] of [[{ origin: 'https://example.net' }, 403], [{ 'content-type': 'application/json-wrong' }, 415]]) {
    const testEnv = env();
    assert.equal((await handleWaitlist(request({ email: 'a@example.com' }, headers), testEnv)).status, status);
    assert.equal(testEnv.WAITLIST_DB.calls.length, 0);
  }
});

async function localServer(t) {
  const directory = mkdtempSync(join(tmpdir(), 'falcon-waitlist-test-'));
  const databasePath = join(directory, 'waitlist.sqlite');
  const options = { databasePath, ipSalt: 'local-test-salt' };
  const adapter = createLocalWaitlist(options);
  const server = createServer((req, res) => adapter.middleware(req, res, () => { res.writeHead(404); res.end(); }));
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  t.after(async () => {
    await new Promise(resolve => server.close(resolve)); adapter.close(); rmSync(directory, { recursive: true, force: true });
  });
  return { adapter, options, databasePath, url: `http://127.0.0.1:${server.address().port}/api/waitlist` };
}

test('V105: real local HTTP capture persists and survives a fresh database connection', async t => {
  const local = await localServer(t);
  const response = await fetch(local.url, { method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: ' Capture@Example.com ', source: 'landing' }) });
  assert.equal(response.status, 201);
  assert.deepEqual(await response.json(), { status: 'registered', emailStatus: 'not_configured' });
  local.adapter.close();
  const reopened = createLocalWaitlist(local.options);
  try {
    const db = new DatabaseSync(local.databasePath, { readOnly: true });
    try {
      const row = db.prepare('SELECT email, source, ip_hash FROM waitlist_entries').get();
      assert.equal(row.email, 'capture@example.com'); assert.equal(row.source, 'landing');
      assert.match(row.ip_hash, /^[a-f0-9]{64}$/); assert.notEqual(row.ip_hash, '127.0.0.1');
    } finally { db.close(); }
  } finally { reopened.close(); }
});

test('V105,V106: repeated and concurrent signup identifies the original durable registration', async t => {
  const local = await localServer(t);
  const post = source => fetch(local.url, { method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: 'same@example.com', source }) });
  const first = await post('first');
  assert.equal(first.status, 201); await first.json();
  const db = new DatabaseSync(local.databasePath, { readOnly: true });
  try {
    const before = db.prepare('SELECT * FROM waitlist_entries').get();
    const second = await post('repeat');
    assert.equal(second.status, 200);
    assert.deepEqual(await second.json(), { status: 'already_registered', emailStatus: 'not_configured' });
    const after = db.prepare('SELECT * FROM waitlist_entries').get();
    assert.equal(after.created_at, before.created_at); assert.equal(after.ip_hash, before.ip_hash);
    assert.equal(after.source, 'repeat');
    const results = await Promise.all(['left', 'right'].map(source => fetch(local.url, { method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: 'concurrent@example.com', source }) })));
    assert.deepEqual(results.map(response => response.status).sort(), [200, 201]);
    assert.deepEqual((await Promise.all(results.map(response => response.json()))).map(result => result.status).sort(), ['already_registered', 'registered']);
    assert.equal(db.prepare('SELECT COUNT(*) AS count FROM waitlist_entries').get().count, 2);
  } finally { db.close(); }
});

test('V105: local middleware bounds input and does not trust spoofed IP headers', async t => {
  const local = await localServer(t);
  const oversized = await fetch(local.url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: 'x'.repeat(5000) });
  assert.equal(oversized.status, 413); assert.deepEqual(await oversized.json(), { error: 'request_too_large' });
  for (let index = 0; index < 6; index += 1) {
    const response = await fetch(local.url, { method: 'POST', headers: { 'content-type': 'application/json', 'cf-connecting-ip': `198.51.100.${index}` },
      body: JSON.stringify({ email: `capture${index}@example.com` }) });
    assert.equal(response.status, index === 5 ? 429 : 201);
    await response.json();
  }
  const db = new DatabaseSync(local.databasePath, { readOnly: true });
  try { assert.equal(db.prepare('SELECT COUNT(*) AS count FROM waitlist_entries').get().count, 5); }
  finally { db.close(); }
});

test('V105: local middleware refuses unknown existing schemas without changing their rows', t => {
  const directory = mkdtempSync(join(tmpdir(), 'falcon-waitlist-unknown-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const databasePath = join(directory, 'unknown.sqlite');
  const db = new DatabaseSync(databasePath);
  db.exec("CREATE TABLE untouched (value TEXT); INSERT INTO untouched VALUES ('keep');"); db.close();
  assert.throws(() => createLocalWaitlist({ databasePath, ipSalt: 'local-test-salt' }), /unknown or older schema/);
  const check = new DatabaseSync(databasePath, { readOnly: true });
  try {
    assert.equal(check.prepare('SELECT value FROM untouched').get().value, 'keep');
    assert.equal(check.prepare("SELECT COUNT(*) AS count FROM sqlite_schema WHERE name = 'waitlist_entries'").get().count, 0);
  } finally { check.close(); }
});
