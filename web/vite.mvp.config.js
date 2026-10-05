import { defineConfig } from 'vite';
import { fileURLToPath } from 'node:url';
import { copyFile } from 'node:fs/promises';
import { join } from 'node:path';
import { falconSkills } from './scripts/skills-plugin.mjs';

// MVP build: wallet-gated bot at `/` and mesh graph/DevNet terminal at `/mesh/`
// Preserves main site routes; no DNS or deployment in this slice.
const entry = (path) => fileURLToPath(new URL(path, import.meta.url));
const distDir = fileURLToPath(new URL('./dist-mvp/', import.meta.url));
const rootBotIndex = {
  name: 'falcon-mvp-root-bot-index',
  apply: 'build',
  async writeBundle() {
    await copyFile(join(distDir, 'bot/index.html'), join(distDir, 'index.html'));
  },
};

export default defineConfig({
  appType: 'mpa',
  publicDir: false,
  resolve: { dedupe: ['react', 'react-dom', '@solana/web3.js'] },
  plugins: [rootBotIndex, falconSkills()],
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
        bot: entry('./bot/index.html'),
        mesh: entry('./mesh/index.html'),
      },
    },
  },
});
