import { defineConfig } from 'vite';
import { fileURLToPath } from 'node:url';

// Multi-page static build. `main` is the marketing landing; `dash` is the
// illustrative paper dashboard served at /dash. ESM-safe path resolution
// (no __dirname; see SPEC B39).
const entry = (path) => fileURLToPath(new URL(path, import.meta.url));

export default defineConfig({
  appType: 'mpa',
  build: {
    rollupOptions: {
      input: {
        main: entry('./index.html'),
        dash: entry('./dash/index.html'),
      },
    },
  },
});
