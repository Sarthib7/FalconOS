import { defineConfig } from 'vite';
import { fileURLToPath } from 'node:url';
import { falconSkills } from './scripts/skills-plugin.mjs';
import { applicationGateRedirects } from './scripts/application-gate.mjs';

const root = fileURLToPath(new URL('./agents/', import.meta.url));
const projectRoot = fileURLToPath(new URL('./', import.meta.url));
const entry = (path) => fileURLToPath(new URL(path, import.meta.url));

export default defineConfig({
  root,
  base: '/',
  envDir: projectRoot,
  // SKILLS.md comes from falconSkills() (web/skills/SKILLS.md), not a stale public copy.
  publicDir: false,
  plugins: [
    applicationGateRedirects({ rootToDashboard: true, researchRootToDashboard: true }),
    falconSkills(),
  ],
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
    rollupOptions: {
      input: {
        install: entry('./agents/install/index.html'),
        dashboard: entry('./agents/dashboard/index.html'),
      },
    },
  },
});
