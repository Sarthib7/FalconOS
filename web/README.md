# FalconOS web

## Cloudflare Pages settings

This is an isolated Vite static site. No Wrangler configuration is required for a Pages dashboard deployment.

- **Framework preset:** Vite
- **Root directory:** `web`
- **Build command:** `npm run build`
- **Build output directory:** `dist`
- **Package manager:** npm; keep `web/package-lock.json` committed and let Pages install dependencies before the build.
- **Node.js:** use Node.js `22.12.0` or newer. Cloudflare Pages currently provides Node.js 22 by default; the locked Vite version also supports Node.js `20.19.0` or newer in the Node 20 line.

Because the repository is a monorepo, set the root directory to `web`; the command then runs from that directory and writes the static artifact to `web/dist`.

## Custom domain (manual)

After creating the Pages project, open **Pages → the project → Custom domains → Set up a custom domain** and enter the canonical hostname `falconos.markets`. Follow the DNS and certificate instructions Cloudflare presents for the domain. The domain is live at `https://falconos.markets/` (verified 2026-09-16, HTTP 200).

## Sources

- [Cloudflare Pages: Deploy a Vite 3 project](https://developers.cloudflare.com/pages/framework-guides/deploy-a-vite3-project) — dashboard build command `npm run build` and output directory `dist`.
- [Cloudflare Pages: Build configuration](https://developers.cloudflare.com/pages/configuration/build-configuration/) — root directory and build output configuration.
- [Cloudflare Pages: Build image](https://developers.cloudflare.com/pages/configuration/build-image/) — Node.js version defaults and overrides.
- [Cloudflare Pages: Custom domains](https://developers.cloudflare.com/pages/configuration/custom-domains/) — custom-domain setup and DNS requirements.
