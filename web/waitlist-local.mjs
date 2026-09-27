import { DatabaseSync } from 'node:sqlite';
import { closeSync, lstatSync, openSync, readFileSync } from 'node:fs';
import { isAbsolute } from 'node:path';
import { handleWaitlist, MAX_BODY_BYTES } from './functions/api/waitlist.js';

const SCHEMAS = ['0001_waitlist.sql', '0002_waitlist_email_outbox.sql'].map(name => new URL(`./migrations/${name}`, import.meta.url));
const LOOPBACK = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1']);

function verifySchema(db, history) {
  const normalize = sql => sql.replace(/\bIF\s+NOT\s+EXISTS\b/gi, '').replace(/\s+/g, ' ').trim();
  const expected = history.flatMap(sql => sql.split(';').filter(part => part.trim()).map(part => {
    const match = part.trim().match(/^CREATE (TABLE|INDEX) (?:IF NOT EXISTS )?([a-z_]+)/);
    if (!match) throw new Error('Local waitlist migration contains an unsupported statement.');
    return { type: match[1].toLowerCase(), name: match[2], sql: normalize(part) };
  })).sort((a, b) => a.name.localeCompare(b.name));
  const actual = db.prepare("SELECT type, name, sql FROM sqlite_schema WHERE name NOT LIKE 'sqlite_%'").all()
    .map(row => ({ type: row.type, name: row.name, sql: normalize(row.sql) })).sort((a, b) => a.name.localeCompare(b.name));
  if (JSON.stringify(actual) !== JSON.stringify(expected)) throw new Error('Local waitlist database has an unknown or older schema.');
}

function readBody(request) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    const cleanup = () => {
      request.off('data', data); request.off('end', end); request.off('error', error); request.off('aborted', aborted);
    };
    const data = chunk => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) { cleanup(); request.resume(); resolve(null); }
      else chunks.push(chunk);
    };
    const end = () => { cleanup(); resolve(Buffer.concat(chunks)); };
    const error = cause => { cleanup(); reject(cause); };
    const aborted = () => error(new Error('Request was aborted.'));
    request.on('data', data); request.on('end', end); request.on('error', error); request.on('aborted', aborted);
  });
}

function sendJson(response, status, error) {
  response.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
  response.end(JSON.stringify({ error }));
}

// The caller must select a local disposable path. Existing schemas are never upgraded.
export function createLocalWaitlist({ databasePath, ipSalt, emailEnv = {}, fetchImpl, now }) {
  if (typeof databasePath !== 'string' || !isAbsolute(databasePath) || typeof ipSalt !== 'string' || !ipSalt) {
    throw new Error('An explicit local database path and IP salt are required.');
  }
  let created = false;
  try { const fd = openSync(databasePath, 'wx', 0o600); closeSync(fd); created = true; }
  catch (error) { if (error.code !== 'EEXIST') throw error; }
  const file = lstatSync(databasePath);
  if (!file.isFile() || file.isSymbolicLink() || (!created && file.size === 0)) throw new Error('Local waitlist database must be a regular file with a known schema.');
  const db = new DatabaseSync(databasePath, { timeout: 1000 });
  try {
    const history = SCHEMAS.map(path => readFileSync(path, 'utf8'));
    if (created) {
      db.exec('BEGIN IMMEDIATE');
      try { history.forEach(sql => db.exec(sql)); db.exec('COMMIT'); }
      catch (error) { db.exec('ROLLBACK'); throw error; }
    }
    verifySchema(db, history);
  } catch (error) { db.close(); throw error; }
  let closed = false;
  const env = {
    WAITLIST_IP_SALT: ipSalt,
    RESEND_API_KEY: emailEnv.RESEND_API_KEY,
    WAITLIST_FROM_EMAIL: emailEnv.WAITLIST_FROM_EMAIL,
    WAITLIST_DB: {
      prepare(sql) {
        const statement = db.prepare(sql);
        return {
          bind(...values) {
            const bindings = Object.fromEntries(values.map((value, index) => [`?${index + 1}`, value]));
            const run = () => ({ success: true, meta: { changes: statement.run(bindings).changes } });
            return {
              first: async () => statement.get(bindings) ?? null,
              run: async () => run(),
              _runLocal: run,
            };
          },
        };
      },
      async batch(statements) {
        db.exec('BEGIN IMMEDIATE');
        try { const results = statements.map(statement => statement._runLocal()); db.exec('COMMIT'); return results; }
        catch (error) { db.exec('ROLLBACK'); throw error; }
      },
    },
  };
  return {
    async middleware(request, response, next) {
      if (request.url?.split('?')[0] !== '/api/waitlist') return next();
      if (!LOOPBACK.has(request.socket.remoteAddress)) return sendJson(response, 403, 'local_only');
      if (closed) return sendJson(response, 503, 'waitlist_unavailable');
      const host = request.headers.host;
      if (typeof host !== 'string' || !/^(localhost|127\.0\.0\.1|\[::1\])(?::\d{1,5})?$/.test(host)) return sendJson(response, 403, 'origin_not_allowed');
      try {
        const headers = new Headers();
        for (const [name, value] of Object.entries(request.headers)) {
          if (value !== undefined) headers.set(name, Array.isArray(value) ? value.join(', ') : value);
        }
        // A browser cannot choose the local rate-limit identity through a proxy header.
        headers.set('cf-connecting-ip', request.socket.remoteAddress);
        const body = ['GET', 'HEAD'].includes(request.method) ? undefined : await readBody(request);
        if (body === null) return sendJson(response, 413, 'request_too_large');
        const url = `${request.socket.encrypted ? 'https' : 'http'}://${host}${request.url}`;
        const result = await handleWaitlist(new Request(url, { method: request.method, headers, body }), env, { fetchImpl, now });
        response.writeHead(result.status, Object.fromEntries(result.headers));
        response.end(Buffer.from(await result.arrayBuffer()));
      } catch {
        if (!response.headersSent) sendJson(response, 503, 'waitlist_unavailable');
        else response.end();
      }
    },
    close() { if (!closed) { closed = true; db.close(); } },
  };
}
