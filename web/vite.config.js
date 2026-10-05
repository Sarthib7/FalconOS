import { defineConfig } from 'vite';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { createLocalWaitlist } from './waitlist-local.mjs';
import { falconSkills } from './scripts/skills-plugin.mjs';

// Multi-page build with the React landing page and separate application routes.
// `/app/` is the wallet-owned Devnet terminal. The local research terminal
// and the separate copilot page remain development routes.
const entry = (path) => fileURLToPath(new URL(path, import.meta.url));

function localWaitlist() {
  function mount(server) {
    const databasePath = process.env.FALCON_WAITLIST_DB_PATH;
    if (!databasePath) return;
    const local = createLocalWaitlist({ databasePath, ipSalt: process.env.FALCON_WAITLIST_IP_SALT,
      emailEnv: { RESEND_API_KEY: process.env.RESEND_API_KEY, WAITLIST_FROM_EMAIL: process.env.WAITLIST_FROM_EMAIL } });
    server.middlewares.use(local.middleware);
    server.httpServer?.once('close', () => local.close());
  }
  return { name: 'falcon-local-waitlist', configureServer: mount, configurePreviewServer: mount };
}

function localTerminalRoutes() {
  return {
    name: 'falcon-local-terminal-routes',
    configureServer(server) {
      server.middlewares.use(async (request, response, next) => {
        const pathname = request.url?.split('?')[0];
        if (!['/dash', '/dash/', '/research', '/research/'].includes(pathname)) return next();

        try {
          const html = await readFile(entry('./local-terminal.html'), 'utf8');
          const route = pathname.endsWith('/') ? pathname : `${pathname}/`;
          const transformed = await server.transformIndexHtml(route, html);
          response.statusCode = 200;
          response.setHeader('Content-Type', 'text/html; charset=utf-8');
          response.end(transformed);
        } catch (error) {
          next(error);
        }
      });
    },
  };
}

export default defineConfig({
  appType: 'mpa',
  resolve: { dedupe: ['@solana/web3.js'] },
  server: { fs: { deny: ['.env', '.env.*', '*.{crt,pem,key,p12,pfx,cer,der}', '.npmrc', '.yarnrc.yml', '**/.git/**', '**/.local/**'] } },
  plugins: [localWaitlist(), localTerminalRoutes(), falconSkills()],
  build: {
    rollupOptions: {
      input: {
        main: entry('./index.html'),
        product: entry('./product/index.html'),
        research: entry('./research/index.html'),
        dash: entry('./dash/index.html'),
        app: entry('./app/index.html'),
        treasury: entry('./treasury/index.html'),
        mesh: entry('./mesh/index.html'),
        dashboard: entry('./dashboard/index.html'),
      },
    },
  },
});
