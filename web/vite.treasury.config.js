import { defineConfig } from 'vite';
import { fileURLToPath } from 'node:url';

// A separate static preview artifact keeps unrelated site work out of the release.
export default defineConfig({
  appType: 'mpa',
  server: { fs: { deny: ['.env', '.env.*', '*.{crt,pem,key,p12,pfx,cer,der}', '.npmrc', '.yarnrc.yml', '**/.git/**', '**/.local/**'] } },
  publicDir: false,
  build: {
    outDir: 'dist-treasury',
    rolldownOptions: {
      input: fileURLToPath(new URL('./treasury/index.html', import.meta.url)),
    },
  },
});
