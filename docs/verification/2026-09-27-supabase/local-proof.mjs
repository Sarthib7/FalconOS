import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { appendFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import pg from '/Volumes/Sarthi MAC/FalconOS/mesh/node_modules/pg/lib/index.js';
import { createStore } from '/Volumes/Sarthi MAC/FalconOS/mesh/store.mjs';
import { makeDemoDocuments } from '/Volumes/Sarthi MAC/FalconOS/mesh/fixtures.mjs';

const { Pool } = pg;
const root = '/Volumes/Sarthi MAC/FalconOS';
const directory = fileURLToPath(new URL('.', import.meta.url)).replace(/\/$/, '');
const bin = '/opt/homebrew/opt/postgresql@17/bin';
const socket = `${directory}/socket`;
const port = 55483;
const report = { checks: [], commands: [], blindSpots: ['Local PostgreSQL 17 is not the hosted PostgreSQL 17.6 service. No hosted connection, TLS, pooler, or password was tested.', 'Runtime uses SET ROLE from a local admin connection. This proves effective SQL privileges, not independent login or protection from a compromised admin connection.', 'Other-schema denial covers unrelated.sentinel. Public rights can still apply to other objects; public.public_readable remains readable.'] };
const sha = value => createHash('sha256').update(value).digest('hex');
function command(executable, args, name, env = process.env) {
  const run = spawnSync(executable, args, { encoding: 'utf8', timeout: 30000, env });
  const output = `${run.stdout ?? ''}${run.stderr ?? ''}`;
  report.commands.push({ executable, args, name, status: run.status });
  return { ...run, output };
}
function check(name, evidence) { report.checks.push({ name, passed: true, evidence }); }
function url(database = 'postgres', role = false) {
  const target = new URL(`postgresql://falcon_proof_admin@localhost:${port}/${database}`);
  target.searchParams.set('host', socket);
  if (role) target.searchParams.set('options', '-c role=falcon_mesh_app');
  return target.href;
}
async function rows(pool, sql, values = []) { return (await pool.query(sql, values)).rows; }
async function catalog(pool) {
  return {
    namespace: await rows(pool, "SELECT nspname, obj_description(oid, 'pg_namespace') AS comment FROM pg_namespace WHERE nspname = 'falcon_mesh'"),
    tables: await rows(pool, "SELECT relname, relkind, relrowsecurity, relforcerowsecurity FROM pg_class WHERE relnamespace = 'falcon_mesh'::regnamespace AND relkind IN ('r','p') ORDER BY relname"),
    columns: await rows(pool, "SELECT c.relname, a.attname, format_type(a.atttypid, a.atttypmod) AS type, a.attnotnull, pg_get_expr(d.adbin, d.adrelid) AS default_expression FROM pg_attribute a JOIN pg_class c ON c.oid = a.attrelid LEFT JOIN pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum WHERE c.relnamespace = 'falcon_mesh'::regnamespace AND c.relkind = 'r' AND a.attnum > 0 AND NOT a.attisdropped ORDER BY c.relname, a.attnum"),
    constraints: await rows(pool, "SELECT c.relname, con.conname, con.contype, pg_get_constraintdef(con.oid) AS definition, con.convalidated FROM pg_constraint con JOIN pg_class c ON c.oid = con.conrelid WHERE con.connamespace = 'falcon_mesh'::regnamespace ORDER BY c.relname, con.conname"),
    indexes: await rows(pool, "SELECT tablename, indexname, indexdef FROM pg_indexes WHERE schemaname = 'falcon_mesh' ORDER BY tablename, indexname"),
  };
}
async function fingerprint(pool) {
  const snapshot = {};
  for (const table of ['source_revisions', 'source_heads', 'analyses']) {
    const data = await rows(pool, `SELECT to_jsonb(t) AS record FROM falcon_mesh.${table} t ORDER BY to_jsonb(t)::text`);
    snapshot[table] = { rows: data.length, sha256: sha(JSON.stringify(data)) };
  }
  return snapshot;
}
async function rejected(pool, sql, expected, name) {
  let failure;
  try { await pool.query(sql); } catch (error) { failure = error; }
  assert.equal(failure?.code, expected, name);
  check(name, { sql, code: failure.code, message: failure.message });
}

await mkdir(socket, { mode: 0o700, recursive: true });
const init = command(`${bin}/initdb`, ['-D', `${directory}/data`, '-U', 'falcon_proof_admin', '--auth=trust', '--encoding=UTF8', '--locale=C'], 'initdb');
await writeFile(`${directory}/initdb.log`, init.output);
assert.equal(init.status, 0, init.output);
await appendFile(`${directory}/data/postgresql.conf`, `\nlisten_addresses = ''\nport = ${port}\nunix_socket_directories = '${socket}'\nunix_socket_permissions = 0700\n`);
await writeFile(`${directory}/data/pg_hba.conf`, 'local all all trust\n');
const startup = command(`${bin}/pg_ctl`, ['-D', `${directory}/data`, '-l', `${directory}/postgres.log`, '-w', 'start'], 'pg_ctl start');
await writeFile(`${directory}/startup.log`, startup.output);
assert.equal(startup.status, 0, startup.output);
const admin = new Pool({ connectionString: url(), max: 1 });
const upgrade = new Pool({ connectionString: url('upgrade_proof'), max: 1 });
const app = new Pool({ connectionString: url('postgres', true), max: 3 });
try {
  const settings = (await rows(admin, "SELECT version(), current_database(), current_user, current_setting('listen_addresses') AS listen_addresses, current_setting('unix_socket_directories') AS unix_socket_directories"))[0];
  assert.equal(settings.listen_addresses, '');
  assert.match(settings.version, /PostgreSQL 17\./);
  check('isolated PostgreSQL17 Unix socket only', settings);

  await admin.query('CREATE ROLE anon NOLOGIN; CREATE ROLE authenticated NOLOGIN; CREATE ROLE service_role NOLOGIN BYPASSRLS;');
  await admin.query("CREATE SCHEMA unrelated; CREATE TABLE unrelated.sentinel (id integer PRIMARY KEY, value text NOT NULL); INSERT INTO unrelated.sentinel VALUES (1, 'keep this existing row'); CREATE TABLE public.public_readable (id integer PRIMARY KEY); INSERT INTO public.public_readable VALUES (1); GRANT SELECT ON public.public_readable TO PUBLIC;");
  const sentinelBefore = await rows(admin, 'SELECT * FROM unrelated.sentinel ORDER BY id');
  await admin.query('ALTER DEFAULT PRIVILEGES FOR ROLE falcon_proof_admin GRANT ALL ON TABLES TO PUBLIC, anon, authenticated, service_role;');
  const aclBefore = await rows(admin, 'SELECT defaclrole::regrole::text AS owner, defaclnamespace, defaclobjtype, defaclacl::text FROM pg_default_acl ORDER BY 1,2,3');

  const setup = command(process.execPath, [`${root}/mesh/init-db.mjs`], 'unmodified init-db', { ...process.env, DATABASE_URL: url(), FALCON_MESH_ALLOW_SCHEMA_SETUP: '1' });
  await writeFile(`${directory}/init-db.log`, setup.output);
  assert.equal(setup.status, 0, setup.output);
  check('unmodified init-db applies the complete local history', setup.output.trim());
  const expectedCatalog = await catalog(admin);
  assert.equal(expectedCatalog.tables.length, 5);
  assert.equal(expectedCatalog.columns.length, 33);
  assert.equal(expectedCatalog.constraints.length, 26);
  assert.equal(expectedCatalog.indexes.length, 13);
  assert.equal(expectedCatalog.namespace[0].comment, 'falcon_mesh_schema_version=2');
  check('full-history schema inventory', { tables: 5, columns: 33, constraints: 26, indexes: 13, schemaVersion: 2 });
  await writeFile(`${directory}/catalog.json`, JSON.stringify(expectedCatalog, null, 2));

  await admin.query('CREATE DATABASE upgrade_proof');
  const schema = await readFile(`${root}/mesh/schema.sql`, 'utf8');
  const lending = await readFile(`${root}/mesh/migrations/0002_lending.sql`, 'utf8');
  const permissions = await readFile(`${root}/mesh/deploy/supabase-permissions.sql`, 'utf8');
  report.files = [ ['mesh/schema.sql', schema], ['mesh/migrations/0002_lending.sql', lending], ['mesh/deploy/supabase-permissions.sql', permissions] ].map(([path, content]) => ({ path, sha256: sha(content) }));
  await upgrade.query(schema);
  await upgrade.query("CREATE SCHEMA unrelated; CREATE TABLE unrelated.sentinel (id integer PRIMARY KEY, value text NOT NULL); INSERT INTO unrelated.sentinel VALUES (1, 'existing upgrade sentinel');");
  const upgradeSentinel = await rows(upgrade, 'SELECT * FROM unrelated.sentinel ORDER BY id');
  const at = '2026-09-27T12:00:00.000Z';
  const seed = createStore(upgrade);
  const revisions = makeDemoDocuments(at).map(document => ({ revisionId: randomUUID(), expectedRevisionId: null, content: JSON.stringify(document) }));
  await seed.ingestSources('upgrade_owner', revisions, at);
  const saved = await seed.createAnalysis('upgrade_owner', { requestId: randomUUID(), observationId: 'observation:shared', maxHops: 3 }, at);
  assert.equal(saved.analysis.status, 'READY');
  const before = await fingerprint(upgrade);
  await upgrade.query('BEGIN');
  await upgrade.query(lending);
  await createStore(upgrade).ready();
  await upgrade.query('COMMIT');
  const after = await fingerprint(upgrade);
  assert.deepEqual(after, before);
  assert.deepEqual(await rows(upgrade, 'SELECT * FROM unrelated.sentinel ORDER BY id'), upgradeSentinel);
  assert.deepEqual(await catalog(upgrade), expectedCatalog);
  check('0002 preserves every seeded v1 table row and unrelated sentinel', { before, after, unrelatedSentinel: upgradeSentinel });
  check('upgraded catalog equals fresh full-history catalog', { sha256: sha(JSON.stringify(expectedCatalog)) });

  await admin.query('GRANT ALL ON SCHEMA falcon_mesh TO PUBLIC, anon, authenticated, service_role');
  const beforeApiGrants = await rows(admin, "SELECT role, has_schema_privilege(role, 'falcon_mesh', 'USAGE') AS schema_usage, has_table_privilege(role, 'falcon_mesh.source_revisions', 'SELECT') AS select_sources FROM unnest(ARRAY['anon','authenticated','service_role']) AS role");
  assert.ok(beforeApiGrants.every(item => item.schema_usage && item.select_sources));
  report.beforeApiGrants = beforeApiGrants;
  await admin.query('BEGIN');
  await admin.query(permissions);
  await admin.query('COMMIT');
  assert.deepEqual(await rows(admin, 'SELECT * FROM unrelated.sentinel ORDER BY id'), sentinelBefore);
  assert.deepEqual(await rows(admin, 'SELECT defaclrole::regrole::text AS owner, defaclnamespace, defaclobjtype, defaclacl::text FROM pg_default_acl ORDER BY 1,2,3'), aclBefore);
  assert.deepEqual(await catalog(admin), expectedCatalog);
  check('permissions preserve catalog, unrelated row and global default ACLs', { sentinel: sentinelBefore, defaultACLs: aclBefore });
  const role = (await rows(admin, "SELECT rolname, rolcanlogin, rolsuper, rolcreatedb, rolcreaterole, rolreplication, rolbypassrls, rolinherit FROM pg_roles WHERE rolname = 'falcon_mesh_app'"))[0];
  assert.ok(Object.entries(role).every(([key, value]) => key === 'rolname' || value === false));
  assert.equal((await rows(admin, "SELECT count(*)::integer AS count FROM pg_auth_members WHERE member = 'falcon_mesh_app'::regrole OR roleid = 'falcon_mesh_app'::regrole"))[0].count, 0);
  check('app role is NOLOGIN with no elevated attributes or memberships', role);
  const duplicateClient = await admin.connect();
  try {
    await duplicateClient.query('BEGIN');
    await rejected(duplicateClient, permissions, '42710', 'candidate rejects an existing app role');
    await duplicateClient.query('ROLLBACK');
  } finally { duplicateClient.release(); }

  const identity = (await rows(app, 'SELECT current_user, session_user'))[0];
  assert.equal(identity.current_user, 'falcon_mesh_app');
  assert.equal(await createStore(app).ready(), true);
  check('runtime SET ROLE identity and readiness', identity);
  const store = createStore(app);
  const input = makeDemoDocuments(at).map(document => ({ revisionId: randomUUID(), expectedRevisionId: null, content: JSON.stringify(document) }));
  await store.ingestSources('runtime_owner', input, at);
  const graph = await store.getGraph('runtime_owner', at);
  assert.equal(graph.sources.length, 2);
  const result = await store.createAnalysis('runtime_owner', { requestId: randomUUID(), observationId: 'observation:shared', maxHops: 3 }, at);
  assert.equal(result.analysis.status, 'READY');
  const at2 = '2026-09-27T12:00:01.000Z';
  await store.ingestSources('runtime_owner', [{ revisionId: randomUUID(), expectedRevisionId: input[1].revisionId, content: JSON.stringify(makeDemoDocuments(at2, 'illiquid')[1]) }], at2);
  const current = await store.createAnalysis('runtime_owner', { requestId: randomUUID(), observationId: 'observation:shared', maxHops: 3 }, at2);
  assert.equal(current.analysis.status, 'BLOCKED');
  assert.deepEqual(await store.getAnalysis('runtime_owner', result.id), result);
  assert.equal((await store.listAnalyses('runtime_owner')).length, 2);
  assert.equal(await store.getAnalysis('other_owner', result.id), null);
  check('app role source -> graph -> analysis -> head update -> retained history', { first: result.analysis.status, updated: current.analysis.status, retainedHistory: 2, otherOwnerResult: null });

  for (const table of ['source_revisions', 'source_heads', 'analyses', 'lending_intents', 'lending_events']) {
    await rejected(app, `DELETE FROM falcon_mesh.${table}`, '42501', `app DELETE denied: ${table}`);
    await rejected(app, `TRUNCATE falcon_mesh.${table} CASCADE`, '42501', `app TRUNCATE denied: ${table}`);
  }
  await rejected(app, "UPDATE falcon_mesh.source_revisions SET content = 'changed'", '42501', 'app immutable-source UPDATE denied');
  await rejected(app, "UPDATE falcon_mesh.source_heads SET owner_id = 'changed'", '42501', 'app head owner UPDATE denied');
  await rejected(app, 'CREATE TABLE falcon_mesh.bad (id int)', '42501', 'app schema CREATE TABLE denied');
  await rejected(app, 'CREATE SCHEMA app_bad', '42501', 'app CREATE SCHEMA denied');
  await rejected(app, 'SELECT * FROM unrelated.sentinel', '42501', 'app protected other-schema read denied');
  assert.deepEqual(await rows(app, 'SELECT * FROM public.public_readable'), [{ id: 1 }]);
  check('NOINHERIT does not remove PUBLIC rights outside falcon_mesh', { publicReadable: [{ id: 1 }] });
  for (const roleName of ['anon', 'authenticated', 'service_role']) {
    const roleClient = await admin.connect();
    await roleClient.query(`SET ROLE ${roleName}`);
    try {
      for (const table of ['source_revisions', 'source_heads', 'analyses', 'lending_intents', 'lending_events']) {
        await rejected(roleClient, `SELECT * FROM falcon_mesh.${table}`, '42501', `${roleName} read denied: ${table}`);
      }
    } finally { await roleClient.query('RESET ROLE'); roleClient.release(); }
  }
  report.effectivePrivileges = await rows(admin, "SELECT role, c.relname AS table_name, has_schema_privilege(role, 'falcon_mesh', 'USAGE') AS schema_usage, has_table_privilege(role, c.oid, 'SELECT') AS can_select, has_table_privilege(role, c.oid, 'INSERT') AS can_insert, has_table_privilege(role, c.oid, 'UPDATE') AS can_update_table, has_table_privilege(role, c.oid, 'DELETE') AS can_delete, has_table_privilege(role, c.oid, 'TRUNCATE') AS can_truncate FROM unnest(ARRAY['falcon_mesh_app','anon','authenticated','service_role']) AS role CROSS JOIN pg_class c WHERE c.relnamespace = 'falcon_mesh'::regnamespace AND c.relkind = 'r' ORDER BY role, c.relname");
  report.connection = { adminURL: url(), appRoleURL: url('postgres', true), socket, port, data: `${directory}/data`, bin, database: 'postgres', roleCanLogin: false };
  report.status = 'passed';
} catch (error) {
  report.status = 'failed';
  report.failure = { name: error.name, code: error.code, message: error.message, stack: error.stack };
  process.exitCode = 1;
} finally {
  await Promise.all([admin.end(), upgrade.end(), app.end()]);
  await writeFile(`${directory}/report.json`, JSON.stringify(report, null, 2));
  process.stdout.write(`${JSON.stringify({ status: report.status, checks: report.checks.length, failure: report.failure, connection: report.connection, report: `${directory}/report.json` }, null, 2)}\n`);
}
