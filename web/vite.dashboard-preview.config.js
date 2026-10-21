import { defineConfig } from 'vite';
import { fileURLToPath } from 'node:url';

// Local simulator and regression artifact only. Production uses vite.config.js.
const entry = path => fileURLToPath(new URL(path, import.meta.url));

export default defineConfig({
  appType: 'mpa',
  resolve: { dedupe: ['react', 'react-dom', '@solana/web3.js'] },
  server: {
    host: '127.0.0.1',
    fs: { deny: ['.env', '.env.*', '*.{crt,pem,key,p12,pfx,cer,der}', '.npmrc', '.yarnrc.yml', '**/.git/**', '**/.local/**'] },
  },
  build: {
    outDir: 'dist-dashboard-preview',
    emptyOutDir: true,
    rollupOptions: { input: { dashboardPreview: entry('./local-dashboard/index.html') } },
  },
});
