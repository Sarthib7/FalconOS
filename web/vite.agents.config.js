import { defineConfig } from 'vite';
import { fileURLToPath } from 'node:url';
import { falconSkills } from './scripts/skills-plugin.mjs';

const root = fileURLToPath(new URL('./agents/', import.meta.url));
const projectRoot = fileURLToPath(new URL('./', import.meta.url));

export default defineConfig({
  root,
  base: '/',
  envDir: projectRoot,
  // SKILLS.md comes from falconSkills() (web/skills/SKILLS.md), not a stale public copy.
  publicDir: false,
  plugins: [falconSkills()],
  resolve: { dedupe: ['react', 'react-dom'] },
  server: {
    fs: {
      allow: [projectRoot],
      deny: ['.env', '.env.*', '*.{crt,pem,key,p12,pfx,cer,der}', '.npmrc', '.yarnrc.yml', '**/.git/**', '**/.local/**'],
    },
  },
  build: {
    outDir: fileURLToPath(new URL('./dist-agents/', import.meta.url)),
    emptyOutDir: true,
  },
});
