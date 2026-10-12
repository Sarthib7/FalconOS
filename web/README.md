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

## Personal Plugin public origin

[VERIFIED, user direction, 2026-10-06] The public origin for the Personal Plugin is `https://agents.falconos.markets`. That origin is an install page only: SKILLS.md and the MCP add command. This slice has no Phantom login, yield chat, or mesh terminal on this host. `bot.falconos.markets` and `agent.falconos.markets` are historical names. The host is branded Falcon. It is not called Falcon Agent. Falcon Agent stays the customer-facing agent for one person or organization. The web app of yield chat and mesh is paused, closed-beta. The active build is the Personal Plugin. This plugin slice is advisory only: discover, simulate, and explain. It has no signing and no fund movement.
[VERIFIED, user choice, 2026-10-06] Correction: the public Personal Plugin uses the remote Devnet MCP. The install page has no wallet UI; the agent uses its own wallet, and the human approves every signature and broadcast. The local JSON plugin remains advisory-only.

[VERIFIED, browser check, 2026-10-06] `https://agents.falconos.markets/` still showed title `Falcon · Solana Yield Agent` and `Install Phantom`. `GET /SKILLS.md` returned `200 text/markdown`; response headers included `server: cloudflare` and `cf-cache-status: DYNAMIC`.
[VERIFIED, Wrangler direct upload and browser check, 2026-10-07] Production deployment `658c1a01-78fc-49d0-9597-d45b09688111` for `falcon-agents` reports branch `main` and source `6972641`. Browser now reports title `Falcon | Agent install`; `GET /SKILLS.md` returned `200 text/markdown`. The `Install Phantom` result above was accurate before this deployment; it no longer describes the live site.

[VERIFIED, Railway CLI and MCP read-only checks, 2026-10-06] `falcon-mcp` and `falcon-mesh` had status `SUCCESS`; `GET https://api.falconos.markets/readyz` returned `200 {"status":"ready"}`. MCP initialization reported `falcon-mcp@0.1.0` and `2025-11-25`.

[VERIFIED, local build and browser smoke, 2026-10-06] `npm --prefix web run build:agents` creates standalone `web/dist-agents/` and serves `/SKILLS.md`. It does not change the main site, paused bot, or paused mesh build. Cloudflare remains user-managed.

[VERIFIED, 2026-10-11] `build:agents` / `dev:agents` / `preview:agents` bake `VITE_FALCON_MCP_URL=https://mcp.falconos.markets/mcp` and `VITE_FALCON_SKILL_URL=https://agents.falconos.markets/SKILLS.md`. `vite.agents.config.js` emits `/SKILLS.md` from `web/skills/SKILLS.md` through `falconSkills()`; there is no stale `agents/public/SKILLS.md`.

## Current agent skill

[VERIFIED, source: `web/skills/SKILLS.md`] Version 0.3.0 requires MCP 0.3.0 and lists all 14 tools. The anonymous `falcon_public_graph({})` call is the first functional step and needs no signer, wallet, funds, or login. Owner-bound adoption, reserve review, and public-only preparation follow only when requested. Custom graphs are deferred; owner limits are never defaulted; human approval remains separate for every signature and broadcast.

[VERIFIED, source: `web/scripts/skills-release.mjs`, `web/scripts/skills-plugin.mjs`] The shared renderer emits `/SKILLS.md`, `/SKILLS.manifest.json` (`version`, `requiredMcpVersion`, `canonicalSkillUrl` and exact rendered-byte `sha256`) plus Cloudflare Pages integrity headers. The guide includes the pinned Privy CLI 0.3.7 exact-byte sign-only examples and does not contain its own digest.

[HISTORICAL, pre-0.3.0 local source/build/HTTP tests, 2026-10-12] The earlier release suite reported 31/31 passing for guide rendering, integrity headers and loopback GET/HEAD behavior. This is evidence for that earlier guide version only.

[VERIFIED, local 0.3.0 release tests, 2026-10-12] `node --test web/test/skills-release.test.mjs web/test/install-commands.test.mjs web/test/skill-asset.test.mjs` reported 33 tests, 33 passed, 0 failed. Coverage includes the 0.3.0/14-tool guide and manifest, exact-byte integrity, the 260-line limit, Vite asset builds, and loopback GET/HEAD integrity checks; no browser was used.

[NOT TESTED] No live-site request, browser, Privy login, wallet provisioning, funding, transaction signature, supply/redeem, or broadcast was performed. Cloudflare deployment remains user-managed.

Run the install site locally:

```bash
npm --prefix web run dev:agents
npm --prefix web run build:agents
npm --prefix web run preview:agents
```

The main marketing site remains `https://falconos.markets/`.

## Falcon bot site (paused, closed-beta)

[INFERRED, local build target] `web/bot/` is a separate React landing and authenticated chat app. It builds to `web/dist-bot/`; the standard FalconOS site build and `/dashboard/` route stay unchanged. This app is paused, closed-beta. It is not the public `agents.falconos.markets` origin.
[VERIFIED, source and local tests] Local bot access uses Phantom Wallet Standard message signing. The Mesh API verifies the origin-bound challenge and derives the owner from the signed wallet address. The bot stores an opaque session token in sessionStorage. It does not read balances or submit transactions.

Run the standalone paused bot app locally:

```bash
npm --prefix web run dev:bot
```

[SUPERSEDED, deployment choice, 2026-10-04, corrected 2026-10-06] `build:bot` remains a bot-only artifact at `dist-bot/`. Do not use it, or `build:mvp`, as the public `agents.falconos.markets` site. That origin is install-only, not a yield chat plus `/mesh/` app.
[VERIFIED, official Supabase reference](https://supabase.com/docs/reference/javascript/auth-getclaims) says getClaims verifies JWTs with JWKS where available and falls back to Auth for symmetric keys. [VERIFIED, source: mesh/auth.mjs] Mesh caches a verified subject by token hash until exp and limits uncached checks to 30 per 300-second process window; verification throttling returns HTTP 429.

## Paused yield chat and mesh (local closed-beta)

[INFERRED, local paused-app commands] Run `npm --prefix web run build:mvp` to build the paused yield chat at `/` and the source graph and DevNet terminal at `/mesh/` into `web/dist-mvp/`. The standard `falconos.markets` build and routes remain unchanged. `npm --prefix web run dev:mvp` and `npm --prefix web run preview:mvp` serve those same local closed-beta routes. They do not bind DNS, deploy, or define the public install origin.

[VERIFIED, browser smoke, 2026-10-08] Local `dev:mvp` `/mesh/` shows `Sign in with wallet`; same-tab navigation opens `/` and renders `Falcon · Solana Yield Agent`; returning to `/mesh/` restores the signed-out view. [VERIFIED, source: `web/bot/auth.mjs`, `web/mesh/app.mjs`] Wallet sessions restore from this tab's `sessionStorage`; operator tokens stay in memory. The bot chat remains simulation-only. Only the separate terminal requests an explicit DevNet transaction signature. The public `agents.falconos.markets` origin does not serve this app.

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

[VERIFIED, source: `web/bot/App.jsx`, `web/bot/InstallPanel.jsx`] The install panel still presents its copyable fetch command. The skill guide itself uses one URL entry and explicitly treats retrieval as read-only; it is never downloaded for shell execution.

[VERIFIED, source: `web/scripts/skills-plugin.mjs`, `web/scripts/skills-release.mjs`] `falconSkills()` is wired into the site, bot, MVP, and agents Vite configs. Each build and dev/preview server uses the shared renderer for the guide and manifest. Production builds emit a root `_headers` file with the exact content digests. `VITE_FALCON_MCP_URL` must be a validated HTTPS `/mcp` URL and `VITE_FALCON_SKILL_URL` a validated HTTPS `/SKILLS.md` URL in production. Without a valid MCP URL the guide keeps the not-deployed branch and contains no CLI setup.

[VERIFIED, local tests only, 2026-10-12] See Current agent skill above for the focused test command and exact loopback/build provenance. These checks do not fetch or attest the live hostname.

### Historical deployment notes

[HISTORICAL, Railway record, 2026-10-05] MCP and Mesh were reported live at their Falcon origins and Mesh allowed the agents origin. This dated record is not a current deployment check.

[HISTORICAL, 2026-10-05 local configuration] A prior Pages configuration used root `web`, build `npm run build:bot`, output `dist-bot`, and the listed VITE endpoints. Current source wiring is summarized above; Cloudflare settings and deployment are user-managed.

[HISTORICAL, DNS query, 2026-10-05] `dig +short agents.falconos.markets` returned no record at that time. Current DNS/project status was not checked in this change.