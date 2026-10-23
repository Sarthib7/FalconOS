const RETIRED_APPLICATION_PATHS = ['/app', '/dash', '/mesh', '/treasury', '/research/near', '/bot'];
export const OWNER_AUTH_MODULE_PATHS = new Set(['/app/auth.mjs', '/app/wallet-signin.mjs', '/bot/auth.mjs']);

export function applicationGateRules({ rootToDashboard = false, researchRootToDashboard = false } = {}) {
  const paths = [...RETIRED_APPLICATION_PATHS];
  if (researchRootToDashboard) paths.push('/research');

  const rules = [...new Set(paths.flatMap(path => [path, `${path}/`, `${path}/*`]))];
  if (rootToDashboard) rules.push('/', '/index.html');
  return rules.map(path => `${path} /dashboard/ 302`);
}

export function applicationGateRedirects(options = {}) {
  const rules = applicationGateRules(options);
  const retiredPrefixes = [...RETIRED_APPLICATION_PATHS,
    ...(options.researchRootToDashboard ? ['/research'] : [])];
  const rootToDashboard = options.rootToDashboard === true;

  function redirect(request, response, next, allowOwnerModules = false) {
    const pathname = new URL(request.url ?? '/', 'http://vite.local').pathname;
    if (allowOwnerModules && OWNER_AUTH_MODULE_PATHS.has(pathname)) return next();
    const retired = (rootToDashboard && (pathname === '/' || pathname === '/index.html'))
      || retiredPrefixes.some(path => pathname === path || pathname.startsWith(`${path}/`));
    if (!retired) return next();
    response.statusCode = 302;
    response.setHeader('Location', '/dashboard/');
    response.end();
  }

  return {
    name: 'falcon-application-gate-redirects',
    configureServer(server) {
      server.middlewares.use((request, response, next) => redirect(request, response, next, true));
    },
    configurePreviewServer(server) {
      server.middlewares.use(redirect);
    },
    generateBundle() {
      this.emitFile({ type: 'asset', fileName: '_redirects', source: `${rules.join('\n')}\n` });
    },
  };
}
