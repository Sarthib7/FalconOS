import { lstat, readFile, realpath } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { isAbsolute, relative, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { applicationGateRules, OWNER_AUTH_MODULE_PATHS } from './application-gate.mjs';

const DEFAULT_ROOT = fileURLToPath(new URL('../../', import.meta.url));
const REQUIRED_INPUTS = [
  'web/package.json', 'web/package-lock.json', 'web/vite.config.js', 'web/waitlist-local.mjs',
  'web/scripts/application-gate.mjs', 'web/scripts/skills-plugin.mjs', 'web/scripts/skills-release.mjs',
  'web/skills/SKILLS.md', 'web/functions/api/waitlist.js', 'web/functions/_waitlist-email.js',
  'web/migrations/0001_waitlist.sql', 'web/migrations/0002_waitlist_email_outbox.sql',
];
const ROUTES = ['index.html', 'product/index.html', 'research/index.html', 'dashboard/index.html'];
const RETIRED_ROUTE_PREFIXES = ['app/', 'dash/', 'mesh/', 'treasury/', 'research/near/', 'bot/'];
const RETIRED_SOURCE_PREFIXES = ['dash/', 'mesh/', 'treasury/', 'research/near/', 'bot/'];
const SIMULATOR_MODULES = [
  'dashboard/main.jsx', 'dashboard/App.jsx', 'dashboard/data.json', 'dashboard/Agent.jsx',
  'dashboard/Connections.jsx', 'dashboard/Decisions.jsx', 'dashboard/Dialogs.jsx',
  'dashboard/Knowledge.jsx', 'dashboard/Operate.jsx', 'dashboard/Overview.jsx',
  'dashboard/agent-intent.mjs', 'dashboard/agent-store.mjs', 'dashboard/selection.mjs',
  'dashboard/store.mjs', 'dashboard/ui.jsx',
];
const EXPECTED_REDIRECTS = applicationGateRules();

function contains(directory, path) {
  const child = relative(directory, path);
  return child === '' || (!isAbsolute(child) && child !== '..' && !child.startsWith(`..${sep}`));
}

export async function verifyWebRelease(root = DEFAULT_ROOT) {
  root = await realpath(resolve(root));
  const web = await realpath(resolve(root, 'web'));
  for (const input of REQUIRED_INPUTS) {
    const stat = await lstat(resolve(root, input)).catch(() => null);
    if (!stat?.isFile()) throw new Error(`Website release input is missing or not a regular file: ${input}`);
  }
  const simulatorModules = new Set(await Promise.all(
    SIMULATOR_MODULES.map(path => realpath(resolve(web, path))),
  ));
  const manifest = JSON.parse(await readFile(resolve(web, 'package.json'), 'utf8'));
  for (const dependency of Object.keys(manifest.dependencies || {})) {
    const installed = await lstat(resolve(web, 'node_modules', dependency, 'package.json')).catch(() => null);
    if (!installed?.isFile()) {
      throw new Error(`Website dependency is missing from web/node_modules: ${dependency}. Run npm --prefix web ci.`);
    }
  }
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
        for (const id of this.getModuleIds()) {
          if (id.startsWith('\0')) continue;
          const path = id.split('?')[0];
          if (!isAbsolute(path)) continue;
          const actual = await realpath(path);
          const source = relative(web, actual).split(sep).join('/');
          if (!source.endsWith('.html') && !OWNER_AUTH_MODULE_PATHS.has('/' + source) && (
            RETIRED_SOURCE_PREFIXES.some(prefix => source.startsWith(prefix))
            || source.startsWith('app/')
          )) {
            throw new Error(`Retired technical source entered the production build: ${source}`);
          }
          if (simulatorModules.has(actual) || source === 'public/dash-snapshot.json' || source.startsWith('public/design-reference/')) {
            throw new Error('Simulator source entered the production build: ' + relative(web, actual));
          }
          if (!contains(web, actual) && !contains(dependencies, actual)) {
            throw new Error(`Browser source crosses the release boundary: ${relative(root, actual)}`);
          }
          sourceCount += 1;
        }
        for (const route of ROUTES) {
          if (!Object.hasOwn(bundle, route)) throw new Error(`Production route was not built: ${route}`);
        }
        const redirects = bundle['_redirects'];
        const redirectLines = String(redirects?.source ?? '').trim().split(/\r?\n/);
        if (redirects?.type !== 'asset' || redirectLines.length !== EXPECTED_REDIRECTS.length
            || EXPECTED_REDIRECTS.some((rule, index) => redirectLines[index] !== rule)) {
          throw new Error('Production redirect manifest does not match the dashboard gate routes.');
        }
        const dashboard = bundle['dashboard/index.html'];
        const dashboardHtml = String(dashboard.source);
        const hasExternalModule = /<script\b(?=[^>]*\btype=["']?module["']?)(?=[^>]*\bsrc\s*=)[^>]*>/i.test(dashboardHtml);
        const hasUnsafeCode = /<script\b(?![^>]*\bsrc\s*=)/i.test(dashboardHtml)
          || /<[^>]+(?:\s|\/)on[a-z][\w:-]*\s*=/i.test(dashboardHtml)
          || /<[^>]+\b(?:href|xlink:href|src|action|formaction)\s*=\s*(?:["']\s*|)\s*javascript:/i.test(dashboardHtml);
        if (dashboard.type !== 'asset' || !hasExternalModule || hasUnsafeCode) {
          throw new Error('Dashboard entry must load its owner module without inline code or unsafe markup.');
        }
        for (const output of Object.keys(bundle)) {
          if (RETIRED_ROUTE_PREFIXES.some(prefix => output.startsWith(prefix))) {
            throw new Error(`Retired technical route entered the production build: ${output}`);
          }
          if (output.startsWith('copilot/') || output.startsWith('local-dashboard/') || output === 'local-terminal.html') {
            throw new Error(`Local route entered the production build: ${output}`);
          }
        }
        if (publicDirectory) {
          for (const output of ['app', 'dash', 'mesh', 'treasury', 'research/near', 'bot',
            'copilot', 'local-terminal.html', 'local-dashboard', 'dashboard', 'design-reference', 'dash-snapshot.json']) {
            if (await lstat(resolve(publicDirectory, output)).catch(() => null)) {
              throw new Error(`Technical or local route entered the production public directory: ${output}`);
            }
          }
        }
        checked = true;
      },
    }],
  });
  if (!checked) throw new Error('Vite did not run the release boundary check.');
  return { status: 'PASS', check: 'website-release-inputs', routes: ROUTES.length,
    resolvedFiles: sourceCount, artifactWritten: false };
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
