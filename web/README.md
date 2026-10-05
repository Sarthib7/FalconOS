# FalconOS web

## Current React site

[VERIFIED, source: `landing/`, `index.html`] The current landing is a React port of OpenDesign project `886c2e41-d9d4-45e0-a67d-148f20cfca61`. It preserves the active treasury design, local fonts and synthetic scenarios. The source project stays unchanged.

[VERIFIED, source: `dashboard/`, `vite.config.js`] The same build includes the React [Control Centre](dashboard/README.md) at `/dashboard/`. It has Overview, Decisions, Knowledge and Connections views. Its saved simulation has a separate storage key. Earlier advisory pages remain labelled HTML references under `/design-reference/`.

[VERIFIED, retained release evidence, 2026-09-27] The site and signup completion are published at `https://falconos.markets/`. Release `9af809b` has `39/39` matching public assets. Signup persistence is verified separately from inbox delivery. See [the release record](../docs/verification/2026-09-27-cloudflare-email.md) and [current architecture map](../docs/README.md).

[VERIFIED, local command: `npm --prefix web run preview:local`] The local launcher returned `http://127.0.0.1:4183/`. It serves the site and the signup API. Use Node 24.12 or later for the local SQLite adapter.

```bash
npm --prefix web run dev:local
```

[INFERRED, production build preview] Stop the development server before starting preview on the same port.

```bash
npm --prefix web run build:site
npm --prefix web run preview:local
```

[VERIFIED, source: `local-web.mjs`, `waitlist-local.mjs`] Registration is stored in `web/.local/waitlist.sqlite`. The launcher generates a local salt. Both files are excluded from Git. An existing unknown database schema fails visibly. Optional `RESEND_API_KEY` and `WAITLIST_FROM_EMAIL` configure confirmation delivery. Without them, successful signup means the address was saved. Provider acceptance does not prove inbox delivery.

[INFERRED, verification commands] Run `npm run verify:web` from the repository root for web tests and the in-memory release build. `npm run verify:release:web -- --root <checkout>` checks a different source checkout. The build permits only the two declared browser-safe mesh modules outside `web/`; dashboard Node tests also need `mesh/domain.mjs`. The check does not create `dist` or compile the Pages Function. Build the artifact separately before `node web/test/landing-browser.mjs`. That browser script uses temporary SQLite and provider fixtures. The `/mesh/` route also needs the [mesh API](../mesh/README.md).

## Falcon bot site

[INFERRED, local build target] `web/bot/` is a separate React landing and authenticated chat app. It builds to `web/dist-bot/`; the standard FalconOS site build and `/dashboard/` route stay unchanged.
[VERIFIED, source and local tests] Bot access uses Phantom Wallet Standard message signing. The Mesh API verifies the origin-bound challenge and derives the owner from the signed wallet address. The bot stores an opaque session token in sessionStorage. It does not read balances or submit transactions.

Run the standalone app locally or build its Pages artifact:

```bash
npm --prefix web run dev:bot
npm --prefix web run build:bot
```

[SUPERSEDED, deployment choice, 2026-10-04] `build:bot` remains a bot-only artifact at `dist-bot/`; do not use it for the unified `bot.falconos.markets` site. Use the `build:mvp` target below for the bot root and same-origin `/mesh/` route.
[VERIFIED, official Supabase reference](https://supabase.com/docs/reference/javascript/auth-getclaims) says getClaims verifies JWTs with JWKS where available and falls back to Auth for symmetric keys. [VERIFIED, source: mesh/auth.mjs] Mesh caches a verified subject by token hash until exp and limits uncached checks to 30 per 300-second process window; verification throttling returns HTTP 429.

## Unified bot and Mesh MVP

[INFERRED, local build target] Run `npm --prefix web run build:mvp` to build the bot at `/` and the source graph and DevNet terminal at `/mesh/` into `web/dist-mvp/`. The standard `falconos.markets` build and routes remain unchanged.

[INFERRED, deployment configuration] The separate Pages project for `bot.falconos.markets` must build this artifact with `VITE_MESH_API_URL` set to the HTTPS Mesh API origin. The Mesh service must allow the exact browser origin `https://bot.falconos.markets` in `FALCON_MESH_ORIGINS`. These settings do not configure DNS or deploy the site.

[VERIFIED, source: `web/bot/auth.mjs`, `web/mesh/app.mjs`] The same-tab wallet login session is restored by `/mesh/`; operator tokens remain a manual fallback in memory. The bot chat remains simulation-only. Only the separate terminal requests an explicit DevNet transaction signature.

[VERIFIED, source: `mesh/README.md`] The Mesh API needs PostgreSQL schema version 3. Migration `0003_wallet_auth.sql` remains a local candidate until the remote database is checked and migration approval is granted.

## Cloudflare Pages settings

This is an isolated Vite static site. No Wrangler configuration is required for a Pages dashboard deployment.

- **Framework preset:** Vite
- **Root directory:** `web`
- **Build command:** `npm run build`
- **Build output directory:** `dist`
- **Package manager:** npm; keep `web/package-lock.json` committed and let Pages install dependencies before the build.
- **Node.js:** use Node `24.12.0` or newer for this repository, as declared in the root and mesh package manifests. The local signup adapter also needs `node:sqlite`. This replaces the earlier Vite-only runtime advice; it is not a claim about the provider's current default.

Because the repository is a monorepo, set the root directory to `web`; the command then runs from that directory and writes the static artifact to `web/dist`.

## Public pages

[VERIFIED, retained release and source, 2026-09-27] `/treasury/`, `/dashboard/`, and `/mesh/` are included in the published build. This supersedes the earlier pending-publication statement. Treasury and Control Centre use synthetic data and browser storage. The mesh viewer still needs a separately hosted API; a published page does not establish that connection. See [the route map](../docs/README.md) and [graph contract](../docs/decision-graph.md).

- `/`: React treasury landing, interactive synthetic graph scenarios, and waitlist.
- `/product/`: firm model, advisory pipeline, and product boundaries.
- `/research/`: evidence format, research checks, and unresolved proof.
- `/dash/`: dashboard entry with a link to the Devnet terminal.
- `/app/`: wallet sign-in, Devnet balances, a saved token list, a manual Raydium route ticket, and browser-local order history.

## Dashboard access

### Separate graph preview

[INFERRED, preview recipe] Run `npm --prefix web run build:treasury` from the repository root. It creates `web/dist-treasury/` with only the `/treasury/` page and its bundled assets. This command does not run the market snapshot hook or copy the shared public directory. Use this artifact for a separate static Pages preview project. Do not replace the existing FalconOS production site with this smaller artifact.

[INFERRED, release boundary] Upload only the reviewed artifact directory. Account, project name, and preview URL remain unverified. The prototype needs no Pages Functions or database binding. Browser history remains specific to each origin. Publication follows local verification and release approval.

[VERIFIED, official configuration reference] Vite documents [build output and entry options](https://vite.dev/config/build-options.html) and disabling the [public directory](https://vite.dev/config/shared-options.html#publicdir).

The public build includes the landing page, detail pages, the `/dash/` entry, and the `/app/` Devnet terminal. The local Vite server overrides `/dash/` and `/research/` with the localhost research terminal. `/app/` verifies wallet ownership in the browser and saves account preferences and order labels in that browser profile. It has no server session or cross-device sync. Its production trade module uses Solana Devnet and Raydium Devnet only. The stock council feed and historical strategy backtests are not connected to the production app.

## Waitlist pipeline

The landing form posts to `POST /api/waitlist`. The Pages Function is `web/functions/api/waitlist.js`.

[VERIFIED, retained production configuration] These bindings are configured for production in the [signup release record](../docs/verification/2026-09-27-cloudflare-email.md):

- `WAITLIST_DB`: D1 database with `web/migrations/0001_waitlist.sql` applied. Optional confirmation delivery also requires `0002_waitlist_email_outbox.sql`; that migration is not applied in the retained hosted proof.
- `WAITLIST_IP_SALT`: secret used to hash the client IP before rate-limit storage.

[VERIFIED, source: `functions/api/waitlist.js`] The endpoint validates JSON content, email shape, request size, and same-origin requests. An atomic counter limits each hashed client IP to five attempts per hour. It stores the normalized email, source, hashed client IP, and timestamps.

[VERIFIED, correction: `vite.config.js`, `waitlist-local.mjs` and retained release evidence] Local `dev:local` and `preview:local` mount the same handler with SQLite. The earlier requirement to apply both migrations before registration was too broad. Hosted first signup returned `201 registered`, then duplicate `200 already_registered`, using only `0001`. Both returned `emailStatus: not_configured`. This also supersedes the earlier unverified-hosted-binding statement. Inbox delivery remains unverified. Optional delivery uses the outbox and sender settings in the [email contract](../docs/landing-email.md). Signup is not account authentication.

## Custom domain (manual)

After creating the Pages project, open **Pages → the project → Custom domains → Set up a custom domain** and enter the canonical hostname `falconos.markets`. Follow the DNS and certificate instructions Cloudflare presents for the domain. The domain is live at `https://falconos.markets/` (verified 2026-09-16, HTTP 200).

## Sources

- [Cloudflare Pages: Deploy a Vite 3 project](https://developers.cloudflare.com/pages/framework-guides/deploy-a-vite3-project): dashboard build command `npm run build` and output directory `dist`.
- [Cloudflare Pages: Build configuration](https://developers.cloudflare.com/pages/configuration/build-configuration/): root directory and deployment settings.
- [Cloudflare Pages: Build image](https://developers.cloudflare.com/pages/configuration/build-image/): Node.js version defaults and overrides.
- [Cloudflare Pages: Custom domains](https://developers.cloudflare.com/pages/configuration/custom-domains/): custom-domain setup and DNS requirements.
- [Phantom: Detect the provider](https://docs.phantom.com/solana/detecting-the-provider): browser-extension detection for Solana.
- [Phantom: Sign a message](https://docs.phantom.com/solana/signing-a-message): message signing with the injected Solana provider.

## Yield Agent bot

[VERIFIED, source: `package.json`, `vite.bot.config.js`] From the repository root, run `npm --prefix web run dev:bot` to serve the bot at `/`. Run `npm --prefix web run build:bot` to write `web/dist-bot/`.

[VERIFIED, source: `web/bot/auth.mjs`, `mesh/wallet-auth.mjs`] Phantom signs an origin-bound challenge with `solana:signMessage`. The browser stores the server-issued session token in `sessionStorage`. Sign-in does not sign transactions or move funds. The Agent reads yield data and creates simulation plans only.

[VERIFIED, source: `web/bot/phantom-injected.mjs`, `web/bot/PhantomWalletConnect.jsx`, `web/bot/App.jsx`; local fake-provider browser run: `button=Continue with Phantom`, `connectCalls=0` before click, `connectCalls=1` after click] When Wallet Standard has no available Phantom entry, the bot falls back to Phantom's injected provider. It calls Phantom's `connect()` only after the user clicks `Continue with Phantom`.

## Falcon plugin install panel and SKILLS.md

[VERIFIED, source: `web/bot/InstallPanel.jsx`, `web/bot/install-commands.mjs`, `web/scripts/skills-plugin.mjs`; browser run on `vite.bot.config.js`] The signed-out bot page has an "Add Falcon to your agent" section with an Agent tab (default) and a Human tab. The Agent tab shows `curl -fsSL <skill URL>` and a paste-a-prompt alternative. The Human tab shows `claude mcp add --transport http falconos <MCP URL>` and the JSON config with `"type":"http"`.

[VERIFIED, source: `web/scripts/skills-plugin.mjs`, `web/skills/SKILLS.md`] `web/skills/SKILLS.md` is the single source of the agent skill. The site, bot and MVP builds emit it at `/SKILLS.md`, and the dev servers serve it with `Content-Type: text/markdown; charset=utf-8`. Set `VITE_FALCON_MCP_URL` (an `https://<host>/mcp` URL) and optionally `VITE_FALCON_SKILL_URL` (ends in `/SKILLS.md`; production default `https://falconos.markets/SKILLS.md`) at build time. Dev builds default to `http://127.0.0.1:8792/mcp` and `http://127.0.0.1:5194/SKILLS.md`. Only `https` URLs and loopback `http` URLs are accepted, because the URLs end up in commands people paste into a shell.

[VERIFIED, source: `web/test/skill-asset.test.mjs`] A production build without `VITE_FALCON_MCP_URL` does not fail. The emitted `SKILLS.md` then says the Falcon MCP server is not deployed yet and contains no install commands, and the panel shows "The plugin server is not deployed yet" with no commands.
