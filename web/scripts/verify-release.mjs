import { lstat, readFile, realpath } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { isAbsolute, relative, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const DEFAULT_ROOT = fileURLToPath(new URL('../../', import.meta.url));
const SHARED_INPUTS = ['mesh/fixtures.mjs', 'mesh/kamino-wire.mjs'];
const REQUIRED_INPUTS = [
  'web/package.json', 'web/package-lock.json', 'web/vite.config.js',
  'web/functions/api/waitlist.js', 'web/functions/_waitlist-email.js',
  'web/migrations/0001_waitlist.sql', 'web/migrations/0002_waitlist_email_outbox.sql',
  'mesh/domain.mjs', ...SHARED_INPUTS,
];
const ROUTES = ['index.html', 'product/index.html', 'research/index.html', 'dash/index.html',
  'app/index.html', 'treasury/index.html', 'mesh/index.html', 'dashboard/index.html'];

function contains(directory, path) {
  const child = relative(directory, path);
  return child === '' || (!isAbsolute(child) && child !== '..' && !child.startsWith(`..${sep}`));
}

export async function verifyWebRelease(root = DEFAULT_ROOT) {
  root = await realpath(resolve(root));
  for (const input of REQUIRED_INPUTS) {
    const stat = await lstat(resolve(root, input)).catch(() => null);
    if (!stat?.isFile()) throw new Error(`Website release input is missing or not a regular file: ${input}`);
  }
  const web = await realpath(resolve(root, 'web'));
  const manifest = JSON.parse(await readFile(resolve(web, 'package.json'), 'utf8'));
  for (const dependency of Object.keys(manifest.dependencies || {})) {
    const installed = await lstat(resolve(web, 'node_modules', dependency, 'package.json')).catch(() => null);
    if (!installed?.isFile()) {
      throw new Error(`Website dependency is missing from web/node_modules: ${dependency}. Run npm --prefix web ci.`);
    }
  }
  const shared = new Set(await Promise.all(SHARED_INPUTS.map(input => realpath(resolve(root, input)))));
  const dependencies = await realpath(resolve(web, 'node_modules'));
  const require = createRequire(resolve(web, 'package.json'));
  const { build } = await import(pathToFileURL(require.resolve('vite')).href);
  let checked = false;
  let sourceCount = 0;
  let publicDirectory;
  await build({
    root: web,
    configFile: resolve(web, 'vite.config.js'),
    logLevel: 'error',
    build: { write: false },
    plugins: [{
      name: 'falcon-release-boundaries',
      enforce: 'post',
      configResolved(config) {
        publicDirectory = config.build.copyPublicDir && config.publicDir;
      },
      async generateBundle(_options, bundle) {
        const observed = new Set();
        for (const id of this.getModuleIds()) {
          if (id.startsWith('\0')) continue;
          const path = id.split('?')[0];
          if (!isAbsolute(path)) continue;
          const actual = await realpath(path);
          if (shared.has(actual)) observed.add(actual);
          if (!contains(web, actual) && !shared.has(actual)
              && !contains(dependencies, actual)) {
            throw new Error(`Browser source crosses the release boundary: ${relative(root, actual)}`);
          }
          sourceCount += 1;
        }
        for (const input of shared) {
          if (!observed.has(input)) throw new Error(`Browser shared input was not built: ${relative(root, input)}`);
        }
        for (const route of ROUTES) {
          if (!Object.hasOwn(bundle, route)) throw new Error(`Production route was not built: ${route}`);
        }
        for (const output of Object.keys(bundle)) {
          if (output.startsWith('copilot/') || output === 'local-terminal.html') {
            throw new Error(`Local route entered the production build: ${output}`);
          }
        }
        if (publicDirectory) {
          for (const output of ['copilot', 'local-terminal.html']) {
            if (await lstat(resolve(publicDirectory, output)).catch(() => null)) {
              throw new Error(`Local route entered the production public directory: ${output}`);
            }
          }
        }
        checked = true;
      },
    }],
  });
  if (!checked) throw new Error('Vite did not run the release boundary check.');
  return { status: 'PASS', check: 'website-release-inputs', routes: ROUTES.length, resolvedFiles: sourceCount,
    sharedInputs: SHARED_INPUTS, artifactWritten: false };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const args = process.argv.slice(2);
    if (args.length && (args.length !== 2 || args[0] !== '--root' || !args[1])) {
      throw new Error('Usage: node web/scripts/verify-release.mjs [--root <checkout>]');
    }
    console.log(JSON.stringify(await verifyWebRelease(args[1])));
  } catch (error) {
    console.error(`Website release check failed: ${error.message}`);
    process.exitCode = 1;
  }
}
