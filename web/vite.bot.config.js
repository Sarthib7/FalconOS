import { defineConfig } from 'vite';
import { fileURLToPath } from 'node:url';
import { falconSkills } from './scripts/skills-plugin.mjs';

const root = fileURLToPath(new URL('./bot/', import.meta.url));
const projectRoot = fileURLToPath(new URL('./', import.meta.url));

export default defineConfig({
  root,
  base: '/',
  envDir: projectRoot,
  publicDir: false,
  resolve: { dedupe: ['react', 'react-dom'] },
  plugins: [falconSkills()],
  server: {
    fs: {
      allow: [projectRoot],
      deny: ['.env', '.env.*', '*.{crt,pem,key,p12,pfx,cer,der}', '.npmrc', '.yarnrc.yml', '**/.git/**', '**/.local/**'],
    },
  },
  build: {
    outDir: fileURLToPath(new URL('./dist-bot/', import.meta.url)),
    emptyOutDir: true,
  },
});
