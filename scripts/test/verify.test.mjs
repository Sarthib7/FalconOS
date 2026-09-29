import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { verify } from '../verify.mjs';

function output() {
  const lines = [];
  return { lines, write: line => lines.push(line) };
}

test('REPO-VERIFY-1: missing test database blocks mesh without using DATABASE_URL', async () => {
  const log = output();
  let calls = 0;
  const code = await verify(['mesh'], {
    ...log, env: { DATABASE_URL: 'postgresql://private:secret@production.invalid/database' },
    run: async () => { calls++; return 0; },
  });
  assert.equal(code, 1);
  assert.equal(calls, 0);
  assert.ok(log.lines.includes('mesh: BLOCKED'));
  assert.equal(log.lines.join('\n').includes('secret'), false);
  assert.equal(log.lines.join('\n').includes('production.invalid'), false);
});

test('REPO-VERIFY-1: failed command stops its scope while other scopes continue', async () => {
  const log = output();
  const calls = [];
  const code = await verify([], {
    ...log, env: {},
    run: async command => { calls.push(command); return command.includes('typecheck') ? 7 : 0; },
  });
  assert.equal(code, 1);
  assert.equal(calls.some(command => command.length === 2 && command[1] === 'test'), false);
  assert.equal(calls.at(-1)[0], 'cargo');
  assert.deepEqual(log.lines.filter(line => /: (PASS|FAIL|BLOCKED)$/.test(line)), [
    'repository: PASS', 'advisory: FAIL', 'web: PASS', 'mesh: BLOCKED', 'engine: PASS',
  ]);
  assert.ok(log.lines.some(line => line.includes('exit code 7')));
});

test('REPO-VERIFY-1: an unavailable child fails verification', async () => {
  const log = output();
  const code = await verify(['engine'], {
    ...log, env: {}, run: async () => { throw Object.assign(new Error('private details'), { code: 'ENOENT' }); },
  });
  assert.equal(code, 1);
  assert.ok(log.lines.includes('engine: FAIL'));
  assert.ok(log.lines.some(line => line.includes('ENOENT')));
  assert.equal(log.lines.join('\n').includes('private details'), false);
});

test('REPO-VERIFY-1: successful local scopes accept Unix socket database URLs without logging them', async () => {
  const log = output();
  const url = 'postgresql://test_admin@localhost:55483/postgres?host=%2Fprivate%2Ftmp%2Ftest-socket&options=-c+role%3Dfalcon_mesh_app';
  const env = { FALCON_MESH_TEST_DATABASE_URL: url };
  const calls = [];
  const code = await verify([], {
    ...log, env, run: async (command, receivedEnv) => {
      assert.equal(receivedEnv, env);
      calls.push(command);
      return 0;
    },
  });
  assert.equal(code, 0);
  assert.equal(calls.length, 8);
  assert.ok(log.lines.includes('mesh: PASS'));
  assert.equal(log.lines.join('\n').includes(url), false);
  assert.ok(log.lines.some(line => line.includes('Browser checks') && line.includes('were not verified')));
  assert.equal(calls.some(command => command.some(arg => arg.includes('verify:swap'))), false);
});

test('REPO-VERIFY-1: unknown or multiple scopes are rejected before a command starts', async () => {
  for (const args of [['unknown'], ['constructor'], ['web', 'mesh']]) {
    const log = output();
    let calls = 0;
    assert.equal(await verify(args, { ...log, env: {}, run: async () => { calls++; return 0; } }), 2);
    assert.equal(calls, 0);
    assert.match(log.lines[0], /^Usage:/);
  }
});

test('REPO-VERIFY-1: CLI preserves blocked and invalid-scope exit codes', () => {
  const script = fileURLToPath(new URL('../verify.mjs', import.meta.url));
  const env = { ...process.env };
  delete env.FALCON_MESH_TEST_DATABASE_URL;
  for (const [scope, expected] of [['mesh', 1], ['unknown', 2]]) {
    const result = spawnSync(process.execPath, [script, scope], { env, encoding: 'utf8', timeout: 5000 });
    assert.equal(result.error, undefined);
    assert.equal(result.status, expected);
    assert.match(result.stdout, scope === 'mesh' ? /mesh: BLOCKED/ : /Usage:/);
  }
});
