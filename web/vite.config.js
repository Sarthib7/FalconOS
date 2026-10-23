import { defineConfig } from 'vite';
import { fileURLToPath } from 'node:url';
import { createLocalWaitlist } from './waitlist-local.mjs';
import { falconSkills } from './scripts/skills-plugin.mjs';
import { applicationGateRedirects } from './scripts/application-gate.mjs';

// Human routes are marketing pages and the owner dashboard; retired workspaces redirect to its gate.
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


export default defineConfig({
  appType: 'mpa',
  publicDir: false,
  resolve: { dedupe: ['@solana/web3.js'] },
  server: { fs: { deny: ['.env', '.env.*', '*.{crt,pem,key,p12,pfx,cer,der}', '.npmrc', '.yarnrc.yml', '**/.git/**', '**/.local/**'] } },
  plugins: [localWaitlist(), applicationGateRedirects(), falconSkills()],
  build: {
    rollupOptions: {
      input: {
        main: entry('./index.html'),
        product: entry('./product/index.html'),
        research: entry('./research/index.html'),
        dashboard: entry('./dashboard/index.html'),
      },
    },
  },
});
