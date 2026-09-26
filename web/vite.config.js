import { defineConfig } from 'vite';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

// Multi-page static build. The public landing page stays unchanged.
// `/app/` is the wallet-owned Devnet terminal. The local research terminal
// and the separate copilot page remain development routes.
const entry = (path) => fileURLToPath(new URL(path, import.meta.url));

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
  plugins: [localTerminalRoutes()],
  build: {
    rollupOptions: {
      input: {
        main: entry('./index.html'),
        product: entry('./product/index.html'),
        research: entry('./research/index.html'),
        dash: entry('./dash/index.html'),
        app: entry('./app/index.html'),
        treasury: entry('./treasury/index.html'),
      },
    },
  },
});
