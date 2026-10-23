import { defineConfig } from 'vite';
import { fileURLToPath } from 'node:url';
import { falconSkills } from './scripts/skills-plugin.mjs';
import { applicationGateRedirects } from './scripts/application-gate.mjs';

const entry = (path) => fileURLToPath(new URL(path, import.meta.url));

export default defineConfig({
  appType: 'mpa',
  publicDir: false,
  resolve: { dedupe: ['react', 'react-dom', '@solana/web3.js'] },
  plugins: [applicationGateRedirects({ rootToDashboard: true, researchRootToDashboard: true }), falconSkills()],
  server: {
    fs: {
      allow: [fileURLToPath(new URL('./', import.meta.url))],
      deny: ['.env', '.env.*', '*.{crt,pem,key,p12,pfx,cer,der}', '.npmrc', '.yarnrc.yml', '**/.git/**', '**/.local/**'],
    },
  },
  build: {
    outDir: 'dist-mvp',
    emptyOutDir: true,
    rollupOptions: {
      input: {
        dashboard: entry('./dashboard/index.html'),
      },
    },
  },
});
