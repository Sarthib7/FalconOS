import { spawn } from 'node:child_process';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const scopes = {
  repository: [[process.execPath, '--test', 'scripts/test/*.test.mjs']],
  advisory: [['npm', 'run', 'typecheck'], ['npm', 'test']],
  web: [['npm', '--prefix', 'web', 'test'], [process.execPath, 'web/scripts/verify-release.mjs']],
  mesh: [[process.execPath, 'mesh/check-release.mjs'], ['npm', '--prefix', 'mesh', 'test']],
  mcp: [['npm', '--prefix', 'mcp', 'test']],
  engine: [['cargo', 'test', '--offline', '--locked', '--manifest-path', 'engine/Cargo.toml']],
};

function runCommand(command, env) {
  return new Promise((resolve, reject) => {
    const child = spawn(command[0], command.slice(1), { cwd: root, env, stdio: 'inherit' });
    child.once('error', reject);
    child.once('exit', code => resolve(code ?? 1));
  });
}

// Injection keeps runner tests local without invoking every component suite.
export async function verify(args, { env = process.env, run = runCommand, write = console.log } = {}) {
  if (args.length > 1 || (args.length === 1 && !Object.hasOwn(scopes, args[0]))) {
    write(`Usage: node scripts/verify.mjs [${Object.keys(scopes).join('|')}]`);
    return 2;
  }
  const requested = args.length ? args : Object.keys(scopes);
  const results = [];
  for (const scope of requested) {
    write(`\nChecking ${scope}`);
    if (scope === 'mesh' && !env.FALCON_MESH_TEST_DATABASE_URL?.trim()) {
      write('Set FALCON_MESH_TEST_DATABASE_URL to an initialized disposable PostgreSQL database. DATABASE_URL is not used.');
      results.push({ scope, status: 'BLOCKED' });
      continue;
    }
    let status = 'PASS';
    for (const command of scopes[scope]) {
      write(`> ${command[0] === process.execPath ? 'node' : command[0]} ${command.slice(1).join(' ')}`);
      try {
        const code = await run(command, env);
        if (code === 0) continue;
        write(`Command failed with exit code ${code}.`);
      } catch (error) {
        write(`Command could not start (${error.code ?? 'unknown error'}).`);
      }
      status = 'FAIL';
      break;
    }
    results.push({ scope, status });
  }
  write('\nVerification summary');
  for (const { scope, status } of results) write(`${scope}: ${status}`);
  write('Browser checks, hosted access, live providers, migrations, and real wallet transactions were not verified.');
  return results.some(result => result.status !== 'PASS') ? 1 : 0;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = await verify(process.argv.slice(2));
}
