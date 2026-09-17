import { defineConfig } from 'vite';
import { fileURLToPath } from 'node:url';

// Multi-page static build. The landing page and the private-preview gate are
// served at / and /dash. The full dashboard is not a public build entry.
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
