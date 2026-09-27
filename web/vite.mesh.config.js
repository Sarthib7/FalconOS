import { defineConfig } from 'vite';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  appType: 'mpa',
  server: { fs: { deny: ['.env', '.env.*', '*.{crt,pem,key,p12,pfx,cer,der}', '.npmrc', '.yarnrc.yml', '**/.git/**', '**/.local/**'] } },
  publicDir: false,
  build: {
    outDir: 'dist-mesh',
    rolldownOptions: { input: fileURLToPath(new URL('./mesh/index.html', import.meta.url)) },
  },
});
