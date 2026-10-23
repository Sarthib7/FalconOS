import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { appendFile, cp, lstat, mkdir, mkdtemp, readFile, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import test from 'node:test';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const WEB_CHECK = join(ROOT, 'web/scripts/verify-release.mjs');
const MESH_CHECK = join(ROOT, 'mesh/check-release.mjs');

const NEAR_RESEARCH_RUNTIME_INPUTS = [
  'council/evidence.ts', 'council/host.mjs', 'activity.mjs',
  'research/near-source.mjs', 'research/near-model.mjs', 'research/service.mjs',
  'research/activity.mjs', 'research/review-store.mjs', 'research/review-jobs.mjs',
];

const NATIVE_COUNCIL_RUNTIME_INPUTS = [
  'council/omp-host.mjs', 'council/runtime/worker.ts', 'council/runtime/policy.ts',
  'council/runtime/package.json', 'council/runtime/package-lock.json',
];

async function checkout(t, component, sourceRoot = ROOT) {
  const root = await mkdtemp(join(tmpdir(), 'falcon-release-test-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const source = join(sourceRoot, component);
  await cp(source, join(root, component), {
    recursive: true,
    filter: path => !relative(source, path).split('/').some(part =>
      ['node_modules', '.local', '.git', 'dist', 'dist-mvp', 'dist-agents', 'dist-bot', 'dist-mesh', 'dist-treasury', 'dist-dashboard-preview'].includes(part)
      || part.startsWith('.env') || part.endsWith('.log')),
  });
  if (component === 'web') {
    await cp(await realpath(join(source, 'node_modules')), join(root, component, 'node_modules'), { recursive: true, dereference: true });
    await mkdir(join(root, 'mesh'));
  } else {
    await symlink(join(source, 'node_modules'), join(root, component, 'node_modules'), 'dir');
  }
  return root;
}

async function publicFixture(root) {
  const config = join(root, 'web/vite.config.js');
  await writeFile(config, (await readFile(config, 'utf8')).replace('publicDir: false,', "publicDir: 'unsafe-public',"));
  const directory = join(root, 'web/unsafe-public');
  await mkdir(directory);
  return directory;
}

function check(script, root) {
  return spawnSync(process.execPath, [script, '--root', root], {
    cwd: ROOT, encoding: 'utf8', timeout: 30000, maxBuffer: 1024 * 1024,
    env: { PATH: process.env.PATH },
  });
}

function passed(result) {
  assert.equal(result.error, undefined, result.error?.message);
  assert.equal(result.status, 0, result.stderr);
  return JSON.parse(result.stdout.trim());
}

function rejected(result, diagnostic) {
  assert.equal(result.error, undefined, result.error?.message);
  assert.equal(result.status, 1, result.stdout + result.stderr);
  assert.match(result.stderr, diagnostic);
}

test('V190: website release builds only the marketing pages and owner dashboard route', async t => {
  const root = await checkout(t, 'web');
  const report = passed(check(WEB_CHECK, root));
  assert.equal(report.routes, 4);
  assert.equal(report.artifactWritten, false);
});


test('REPO-VERIFY-1: Vite graph rejects forbidden repository source even when the module resolves', async t => {
  const root = await checkout(t, 'web');
  await mkdir(join(root, 'src'));
  await writeFile(join(root, 'src/release-probe.mjs'), 'globalThis.releaseBoundaryProbe = true;\n');
  await appendFile(join(root, 'web/landing/main.jsx'), '\nimport "../../src/release-probe.mjs";\n');
  rejected(check(WEB_CHECK, root), /Browser source crosses the release boundary: src\/release-probe\.mjs/);
});


test('REPO-VERIFY-1: mesh dependencies cannot mask a missing declared website dependency', async t => {
  const root = await checkout(t, 'web');
  const originalPackage = join(ROOT, 'web/node_modules/@solana/web3.js/package.json');
  const originalContents = await readFile(originalPackage, 'utf8');
  await rm(join(root, 'web/node_modules/@solana/web3.js'), { recursive: true, force: true });
  await symlink(join(ROOT, 'mesh/node_modules'), join(root, 'mesh/node_modules'), 'dir');
  rejected(check(WEB_CHECK, root), /Website dependency is missing from web\/node_modules: @solana\/web3\.js/);
  assert.equal(await readFile(originalPackage, 'utf8'), originalContents, 'fixture mutations must not alter shared dependencies');
});
test('V189: web checkout privately copies dependencies reached through a source symlink', async t => {
  const sourceRoot = await mkdtemp(join(tmpdir(), 'falcon-release-source-'));
  t.after(() => rm(sourceRoot, { recursive: true, force: true }));
  const webSource = join(sourceRoot, 'web');
  const sharedModules = join(sourceRoot, 'shared/node_modules');
  const packageTarget = join(sourceRoot, 'shared/packages/web3');
  const sourcePackage = join(packageTarget, 'package.json');
  const packageContents = JSON.stringify({ name: '@solana/web3.js', version: '1.0.0' });
  await mkdir(webSource, { recursive: true });
  await mkdir(join(sharedModules, '@solana'), { recursive: true });
  await mkdir(packageTarget, { recursive: true });
  await writeFile(sourcePackage, packageContents);
  await symlink(packageTarget, join(sharedModules, '@solana/web3.js'), 'dir');
  const sourceNodeModules = join(webSource, 'node_modules');
  await symlink(sharedModules, sourceNodeModules, 'dir');
  assert.equal((await lstat(sourceNodeModules)).isSymbolicLink(), true);

  const root = await checkout(t, 'web', sourceRoot);
  const fixturePackage = join(root, 'web/node_modules/@solana/web3.js/package.json');
  assert.notEqual(await realpath(fixturePackage), await realpath(sourcePackage),
    'checkout dependencies must not resolve back into the shared source tree');
  await rm(join(root, 'web/node_modules/@solana/web3.js'), { recursive: true, force: true });
  assert.equal(await readFile(sourcePackage, 'utf8'), packageContents,
    'deleting a fixture package must preserve the shared dependency');
});

test('V190: release rejects raw technical HTML routes added to production', async t => {
  const root = await checkout(t, 'web');
  const config = join(root, 'web/vite.config.js');
  await writeFile(config, (await readFile(config, 'utf8')).replace("main: entry('./index.html'),",
    "main: entry('./index.html'), dash: entry('./dash/index.html'),"));
  rejected(check(WEB_CHECK, root), /Retired technical route entered the production build: dash\/index\.html/);
});
test('V190: release rejects a retired technical module imported into a marketing bundle', async t => {
  const root = await checkout(t, 'web');
  await appendFile(join(root, 'web/landing/main.jsx'),
    '\nimport { decide } from "../treasury/domain.mjs"; globalThis.technicalProbe = decide;\n');
  rejected(check(WEB_CHECK, root), /Retired technical source entered the production build: treasury\/domain\.mjs/);
});

test('V194: owner auth reuse does not permit adjacent bot workspace modules', async t => {
  const root = await checkout(t, 'web');
  await writeFile(join(root, 'web/bot/release-probe.mjs'), 'globalThis.retiredWorkspaceProbe = true;');
  await appendFile(join(root, 'web/bot/auth.mjs'), '\nimport "./release-probe.mjs";\n');
  rejected(check(WEB_CHECK, root), /bot\/release-probe\.mjs/);
});


test('REPO-VERIFY-1: website rejects local routes copied through the public directory', async t => {
  const root = await checkout(t, 'web');
  const directory = await publicFixture(root);
  await mkdir(join(directory, 'copilot'));
  await writeFile(join(directory, 'copilot/index.html'), '<h1>Local copilot</h1>');
  rejected(check(WEB_CHECK, root), /\bcopilot\b/);
});

test('V185: release rejects an unauthenticated simulator entry beside the owner dashboard', async t => {
  const root = await checkout(t, 'web');
  // Isolate the entry guard from the legacy simulator's forbidden dependencies.
  await writeFile(join(root, 'web/dashboard/main.jsx'), 'globalThis.unauthenticatedSimulatorProbe = true;');
  await appendFile(join(root, 'web/dashboard/index.html'), '\n<script type="module" src="./main.jsx"></script>\n');
  rejected(check(WEB_CHECK, root), /Simulator source entered the production build: dashboard\/(main\.jsx|App\.jsx|data\.json)/);
});

test('V185: release rejects simulator fixtures imported into another public chunk', async t => {
  const root = await checkout(t, 'web');
  await appendFile(join(root, 'web/landing/main.jsx'), '\nimport privateSamples from "../dashboard/data.json"; globalThis.dashboardProbe = privateSamples;\n');
  rejected(check(WEB_CHECK, root), /Simulator source entered the production build: dashboard\/data\.json/);
});

test('V185: release rejects executable inline code in the public dashboard', async t => {
  const root = await checkout(t, 'web');
  await appendFile(join(root, 'web/dashboard/index.html'), '\n<script>globalThis.dashboardProbe = true;</script>\n');
  rejected(check(WEB_CHECK, root), /Dashboard entry must load its owner module without inline code or unsafe markup/);
});

test('V185: release rejects inline event handlers in the public dashboard', async t => {
  const root = await checkout(t, 'web');
  const page = join(root, 'web/dashboard/index.html');
  const html = await readFile(page, 'utf8');
  await writeFile(page, html.replace('</body>', '<button onclick="globalThis.dashboardProbe = true">Run</button>\n</body>'));
  rejected(check(WEB_CHECK, root), /Dashboard entry must load its owner module without inline code or unsafe markup/);
});

test('V185: release rejects javascript URLs in the public dashboard', async t => {
  const root = await checkout(t, 'web');
  const page = join(root, 'web/dashboard/index.html');
  const html = await readFile(page, 'utf8');
  await writeFile(page, html.replace('</body>', '<a href="javascript:globalThis.dashboardProbe = true">Run</a>\n</body>'));
  rejected(check(WEB_CHECK, root), /Dashboard entry must load its owner module without inline code or unsafe markup/);
});

test('V185: release rejects a local dashboard page added as a production input', async t => {
  const root = await checkout(t, 'web');
  await writeFile(join(root, 'web/local-dashboard/index.html'), '<h1>Local dashboard preview</h1>');
  const config = join(root, 'web/vite.config.js');
  await writeFile(config, (await readFile(config, 'utf8')).replace("main: entry('./index.html'),",
    "main: entry('./index.html'), localDashboard: entry('./local-dashboard/index.html'),"));
  rejected(check(WEB_CHECK, root), /Local route entered the production build: local-dashboard\/index\.html/);
});

test('V185: release rejects dashboard source copied through the public directory', async t => {
  const root = await checkout(t, 'web');
  const directory = await publicFixture(root);
  await mkdir(join(directory, 'dashboard'));
  await cp(join(root, 'web/dashboard/data.json'), join(directory, 'dashboard/data.json'));
  rejected(check(WEB_CHECK, root), /\bdashboard\b/);
});
test('V190: release rejects technical HTML copied through the public directory', async t => {
  const root = await checkout(t, 'web');
  const directory = await publicFixture(root);
  await mkdir(join(directory, 'mesh'));
  await writeFile(join(directory, 'mesh/index.html'), '<h1>Technical mesh</h1>');
  rejected(check(WEB_CHECK, root), /Technical or local route entered the production public directory: mesh/);
});

test('V196: release rejects copied design workspaces and sample snapshot data', async t => {
  const root = await checkout(t, 'web');
  const directory = await publicFixture(root);
  const reference = join(directory, 'design-reference');
  await mkdir(reference);
  await writeFile(join(reference, 'workspace.html'), '<main>Local design specimen</main>');
  rejected(check(WEB_CHECK, root), /design-reference/);
  await rm(reference, { recursive: true });
  await writeFile(join(directory, 'dash-snapshot.json'), '{"fixtureOnly":true}');
  rejected(check(WEB_CHECK, root), /dash-snapshot\.json/);
});



test('REPO-VERIFY-1: complete API checkout links in isolation without database configuration', async t => {
  const root = await checkout(t, 'mesh');
  const report = passed(check(MESH_CHECK, root));
  assert.equal(report.isolatedLinkage, true);
  assert.equal(report.databaseChecked, false);
});

test('REPO-VERIFY-1: API rejects an omitted transitive runtime file', async t => {
  const root = await checkout(t, 'mesh');
  await rm(join(root, 'mesh/live.mjs'));
  rejected(check(MESH_CHECK, root), /missing.*mesh\/live\.mjs/);
});

test('NEAR-RESEARCH-1: API rejects each omitted research runtime dependency', async t => {
  const root = await checkout(t, 'mesh');
  for (const input of NEAR_RESEARCH_RUNTIME_INPUTS) {
    const target = join(root, 'mesh', input);
    await rm(target);
    rejected(check(MESH_CHECK, root), new RegExp('missing.*mesh/' + input));
    await cp(join(ROOT, 'mesh', input), target);
  }
});

test('REPO-VERIFY-1: API rejects an omitted lending migration', async t => {
  const root = await checkout(t, 'mesh');
  await rm(join(root, 'mesh/migrations/0002_lending.sql'));
  rejected(check(MESH_CHECK, root), /missing.*mesh\/migrations\/0002_lending\.sql/);
});

test('REPO-VERIFY-1: website-only mesh slice cannot pass the API release check', async t => {
  const root = await checkout(t, 'web');
  rejected(check(MESH_CHECK, root), /missing.*mesh\/package\.json/);
});

test('REPO-VERIFY-1: isolated native linkage rejects a cross-component API import', async t => {
  const root = await checkout(t, 'mesh');
  const outside = join(root, 'web/release-probe.mjs');
  await mkdir(dirname(outside), { recursive: true });
  await writeFile(outside, 'export const probe = true;\n');
  await appendFile(join(root, 'mesh/server.mjs'), '\nimport "../web/release-probe.mjs";\n');
  rejected(check(MESH_CHECK, root), /expected DATABASE_URL guard.*Cannot find module/s);
});

test('REPO-VERIFY-1: isolated API linkage rejects an absolute import outside the release', async t => {
  const root = await checkout(t, 'mesh');
  const outside = join(root, 'web/release-probe.mjs');
  await mkdir(dirname(outside), { recursive: true });
  await writeFile(outside, 'export const probe = true;\n');
  await appendFile(join(root, 'mesh/server.mjs'), `\nimport ${JSON.stringify(pathToFileURL(outside).href)};\n`);
  rejected(check(MESH_CHECK, root), /expected DATABASE_URL guard.*ERR_ACCESS_DENIED/s);
});

test('REPO-VERIFY-1: API rejects each omitted native Council runtime dependency', async t => {
  const root = await checkout(t, 'mesh');
  for (const input of NATIVE_COUNCIL_RUNTIME_INPUTS) {
    const target = join(root, 'mesh', input);
    await rm(target);
    rejected(check(MESH_CHECK, root), new RegExp('missing.*mesh/' + input));
    await cp(join(ROOT, 'mesh', input), target);
  }
});
