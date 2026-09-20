import { defineConfig } from 'vite';
import { fileURLToPath } from 'node:url';

// Multi-page static build. The landing page and detail pages stay public.
// The dashboard entry is a private-preview gate, not the old dashboard UI.
// The copilot is DEV-ONLY by decision: it must never ship to Cloudflare
// Pages, so it has no rollup entry. `npm run dev` still serves /copilot/.
const entry = (path) => fileURLToPath(new URL(path, import.meta.url));

export default defineConfig({
  appType: 'mpa',
  build: {
    rollupOptions: {
      input: {
        main: entry('./index.html'),
        product: entry('./product/index.html'),
        research: entry('./research/index.html'),
        dash: entry('./dash/index.html'),
      },
    },
  },
});
