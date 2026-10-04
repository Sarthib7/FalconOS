import { copyFile, lstat, mkdir, mkdtemp, realpath, rm, symlink } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const DEFAULT_ROOT = fileURLToPath(new URL('../', import.meta.url));
// This is the source contract for the mesh-only release, not a Dockerignore parser.
const RELEASE_INPUTS = [
  'package.json', 'package-lock.json', 'Dockerfile', '.dockerignore', 'railway.toml',
  'server.mjs', 'http.mjs', 'store.mjs', 'lending-store.mjs', 'wallet-auth.mjs', 'auth.mjs', 'domain.mjs',
  'live.mjs', 'kamino.mjs', 'kamino-wire.mjs', 'init-db.mjs', 'yield-data.mjs', 'yield-domain.mjs',
  'schema.sql', 'migrations/0002_lending.sql', 'migrations/0003_wallet_auth.sql', 'deploy/supabase-permissions.sql',
];

export async function verifyMeshRelease(root = DEFAULT_ROOT) {
  const mesh = await realpath(resolve(root, 'mesh'));
  for (const input of RELEASE_INPUTS) {
    const stat = await lstat(join(mesh, input)).catch(() => null);
    if (!stat?.isFile()) throw new Error(`Mesh release input is missing or not a regular file: mesh/${input}`);
  }
  const dependencies = await realpath(join(mesh, 'node_modules')).catch(() => null);
  if (!dependencies || !(await lstat(dependencies)).isDirectory()) {
    throw new Error('Mesh dependencies are missing. Run npm --prefix mesh ci before this check.');
  }
  const temporary = await realpath(await mkdtemp(join(tmpdir(), 'falcon-mesh-release-')));
  try {
    const isolated = join(temporary, 'mesh');
    for (const input of RELEASE_INPUTS) {
      const target = join(isolated, input);
      await mkdir(dirname(target), { recursive: true });
      await copyFile(join(mesh, input), target);
    }
    await symlink(dependencies, join(isolated, 'node_modules'), 'dir');
    const result = spawnSync(process.execPath, ['--permission', `--allow-fs-read=${temporary}`,
      `--allow-fs-read=${dependencies}`, 'server.mjs'], {
      cwd: isolated,
      env: {
        NODE_ENV: 'production',
        FALCON_MESH_TOKEN_HASHES: JSON.stringify({ ['0'.repeat(64)]: 'release_check' }),
        FALCON_MESH_ORIGINS: 'http://127.0.0.1:4183',
      },
      encoding: 'utf8', timeout: 10000, maxBuffer: 1024 * 1024,
    });
    const expected = result.stderr?.split(/\r?\n/).includes('Error: DATABASE_URL is required.');
    if (result.error || result.signal || result.status !== 1 || result.stdout !== '' || !expected) {
      throw new Error(`Isolated mesh linkage did not reach the expected DATABASE_URL guard. ${
        result.error?.message || result.stderr?.trim() || `exit=${result.status}, signal=${result.signal}`}`);
    }
    return { status: 'PASS', check: 'mesh-release-inputs', declaredFiles: RELEASE_INPUTS.length,
      isolatedLinkage: true, databaseChecked: false, dockerImageChecked: false };
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const args = process.argv.slice(2);
    if (args.length && (args.length !== 2 || args[0] !== '--root' || !args[1])) {
      throw new Error('Usage: node mesh/check-release.mjs [--root <checkout>]');
    }
    console.log(JSON.stringify(await verifyMeshRelease(args[1])));
  } catch (error) {
    console.error(`Mesh release check failed: ${error.message}`);
    process.exitCode = 1;
  }
}
