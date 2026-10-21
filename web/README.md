# FalconOS web

## Current React site

[VERIFIED, source: `landing/`, `index.html`] The current landing is a React port of OpenDesign project `886c2e41-d9d4-45e0-a67d-148f20cfca61`. It preserves the active treasury design, local fonts and synthetic scenarios. The source project stays unchanged.

[VERIFIED, local source and browser smoke, 2026-10-21] Production `/dashboard/` now builds as a static **Soon** page without application scripts. The React [Control Centre](dashboard/README.md) remains a separate local preview at `/local-dashboard/`. Correction: the earlier public simulator entry is withheld under approved design D1. This local change has not been deployed. Earlier advisory pages remain labeled HTML references under `/design-reference/`.

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

[INFERRED COMMANDS] From the repository root, `npm run verify:web` runs the integrated web test workflow. The web package's `pretest` builds the site, MVP and agents before mandatory V185 tests, so this workflow needs no separate site-build step. `npm run verify:release:web -- --root <checkout>` checks a different source checkout. Running `node web/scripts/verify-release.mjs` alone performs an in-memory release build; it does not write `web/dist/` or compile the Pages Function. For a direct `node web/test/landing-browser.mjs` run, build the artifact first with `npm --prefix web run build:site`; `npm run verify:web` already prepares it through `pretest`. That browser script uses temporary SQLite and provider fixtures. The `/mesh/` route also needs the [mesh API](../mesh/README.md).

## Personal Plugin public origin

[VERIFIED, user direction, 2026-10-06] The public origin for the Personal Plugin is `https://agents.falconos.markets`. That origin is an install page only: SKILLS.md and the MCP add command. This slice has no Phantom login, yield chat, or mesh terminal on this host. `bot.falconos.markets` and `agent.falconos.markets` are historical names. The host is branded Falcon. It is not called Falcon Agent. Falcon Agent stays the customer-facing agent for one person or organization. The web app of yield chat and mesh is paused, closed-beta. The active build is the Personal Plugin. This plugin slice is advisory only: discover, simulate, and explain. It has no signing and no fund movement.
[VERIFIED, user choice, 2026-10-06] Correction: the public Personal Plugin uses the remote Devnet MCP. The install page has no wallet UI; the agent uses its own wallet, and the human approves every signature and broadcast. The local JSON plugin remains advisory-only.

[VERIFIED, browser check, 2026-10-06] `https://agents.falconos.markets/` still showed title `Falcon · Solana Yield Agent` and `Install Phantom`. `GET /SKILLS.md` returned `200 text/markdown`; response headers included `server: cloudflare` and `cf-cache-status: DYNAMIC`.
[VERIFIED, Wrangler direct upload and browser check, 2026-10-07] Production deployment `658c1a01-78fc-49d0-9597-d45b09688111` for `falcon-agents` reports branch `main` and source `6972641`. Browser now reports title `Falcon | Agent install`; `GET /SKILLS.md` returned `200 text/markdown`. The `Install Phantom` result above was accurate before this deployment; it no longer describes the live site.

[VERIFIED, Railway CLI and MCP read-only checks, 2026-10-06] `falcon-mcp` and `falcon-mesh` had status `SUCCESS`; `GET https://api.falconos.markets/readyz` returned `200 {"status":"ready"}`. MCP initialization reported `falcon-mcp@0.1.0` and `2025-11-25`.

[VERIFIED, local build and browser smoke, 2026-10-06] `npm --prefix web run build:agents` creates standalone `web/dist-agents/` and serves `/SKILLS.md`. It does not change the main site, paused bot, or paused mesh build. Cloudflare remains user-managed.

[VERIFIED, 2026-10-11] `build:agents` / `dev:agents` / `preview:agents` bake `VITE_FALCON_MCP_URL=https://mcp.falconos.markets/mcp` and `VITE_FALCON_SKILL_URL=https://agents.falconos.markets/SKILLS.md`. `vite.agents.config.js` emits `/SKILLS.md` from `web/skills/SKILLS.md` through `falconSkills()`; there is no stale `agents/public/SKILLS.md`.

## Current agent skill

[VERIFIED, source and local HTTP] Skill 0.4.0 requires MCP 0.4.0 and retains 14 tools. It checks capability schema v1 before an owner action and explains unavailable scope instead of inferring support. Public evidence remains anonymous. Human inputs and contextual checks precede owner adoption; each signature and broadcast needs separate approval. Capability metadata does not establish readiness.

[VERIFIED, source: `web/scripts/skills-release.mjs`, `web/scripts/skills-plugin.mjs`] The shared renderer emits `/SKILLS.md`, `/SKILLS.manifest.json` (`version`, `requiredMcpVersion`, `canonicalSkillUrl` and exact rendered-byte `sha256`) plus Cloudflare Pages integrity headers. The guide includes the pinned Privy CLI 0.3.7 exact-byte sign-only examples and does not contain its own digest.

[HISTORICAL, pre-0.3.0 local source/build/HTTP tests, 2026-10-12] The earlier release suite reported 31/31 passing for guide rendering, integrity headers and loopback GET/HEAD behavior. This is evidence for that earlier guide version only.

[HISTORICAL, REPORTED builder local 0.3.0 release tests, 2026-10-12] The earlier focused command `node --test web/test/skills-release.test.mjs web/test/install-commands.test.mjs web/test/skill-asset.test.mjs` reported 33 tests, 33 passed, 0 failed. That suite included earlier wording/version and 260-line pins removed by 0.3.1. This is not verification of the new guide or agent execution.

[HISTORICAL, earlier 0.3.0 local batch] That batch did not exercise the live site, browser, Privy login, wallet provisioning, funding, transaction signatures, supply/redeem or broadcast. Current 0.3.1 evidence appears below.

Correction (2026-10-12): this current-source section previously retained version 0.3.0 and presented builder-reported fixture counts as verified. Version is now 0.3.1; the earlier counts remain historical reports. Current local command and HTTP evidence is recorded in the 0.3.1 section below.

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

[VERIFIED, retained historical release evidence, 2026-09-27] `/treasury/`, `/dashboard/`, and `/mesh/` were included in that published build. Treasury and Control Centre used synthetic data and browser storage. The 2026-10-21 D1 change replaces the public dashboard simulator with Soon in new builds; it does not establish that the hosted version changed. The mesh viewer still requires its separately hosted API.

- `/`: React treasury landing, interactive synthetic graph scenarios, and waitlist.
- `/product/`: firm model, advisory pipeline, and product boundaries.
- `/research/`: evidence format, research checks, and unresolved proof.
- `/dash/`: dashboard entry with a link to the Devnet terminal.
- `/app/`: wallet sign-in, Devnet balances, a saved token list, a manual Raydium route ticket, and browser-local order history.

## Dashboard access

[VERIFIED, approved D1 contract] In the D1 production build, `/dashboard/` is unavailable to all visitors, including owners. Its static Soon response is normally HTTP 200, not a 401/403 authentication service. Query strings, hashes, or browser storage do not unlock it. Private owner access is a separate future feature. `/dash/` and `/app/` retain their existing Devnet behavior.

Local simulator commands use a separate entry and output. Never upload `web/dist-dashboard-preview` as the main-site artifact.

```bash
npm --prefix web run dev:dashboard -- --port 5195 --strictPort
# Open http://127.0.0.1:5195/local-dashboard/

npm --prefix web run build:dashboard-preview
npm --prefix web run preview:dashboard -- --host 127.0.0.1 --port 4195 --strictPort
# Open http://127.0.0.1:4195/local-dashboard/
```

[INFERRED COMMANDS] From the repository root, run the integrated web verification workflow. Its package `pretest` builds the site, MVP and agents before mandatory V185 tests; no separate `build:site` command is needed. Running `node web/scripts/verify-release.mjs` alone performs only an in-memory build and does not write `web/dist/`. These checks do not deploy the local Soon route.

```bash
npm run verify:web
CHROME_BIN="/Applications/Brave Browser.app/Contents/MacOS/Brave Browser" npm --prefix web run test:dashboard:browser -- --case=agent
```

[SOURCE-VERIFIED, test harness inputs] The agent-only browser case uses disposable fixtures and needs no OpenDesign source root. Full source-comparison, source-only and source-regressions checks require `FALCON_DASHBOARD_SOURCE` to point at the original OpenDesign data root; do not substitute a guessed path. Neither path authorizes provider access, wallet actions, or deployment.

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

## Agent-side skill 0.3.1 (2026-10-12)

[VERIFIED, source] This guide-only revision requires MCP 0.3.0 and preserves its 14-tool contract. It puts human scenario inputs and action-specific execution prerequisites before owner adoption, uses programAnalysisId as the analysisId input, retains source-time expiry, skips default discovery and removes assumed receipt context/Explorer fields. Owner-only advisory and history remain available without funding or transaction-signing capability.

[VERIFIED, local commands] `npm run verify:web` returned `web: PASS`, `pass 304`, `fail 0`, `skipped 1`. `node --test web/test/agents-site.test.mjs` returned `tests 3`, `pass 3`, `fail 0`. These are local artifact/site checks, not a funded agent flow.

[VERIFIED, negative/positive regression] Temporarily labeling the manifest 0.3.0 while the guide declared 0.3.1 made the shared-renderer check return `tests 1`, `pass 0`, `fail 1` and exit 1. Restoring the correct version returned `tests 1`, `pass 1`, `fail 0`. The check compares consumer-visible manifest compatibility fields with rendered frontmatter, not pinned wording.

[VERIFIED, actual loopback HTTP] GET guide/manifest and HEAD guide returned 200 at the agents Vite preview. `GUIDE_031_HTTP_SMOKE_OK` reported skillVersion 0.3.1, requiredMcpVersion 0.3.0 and 14084 bytes. The built static artifact and HTTP body share SHA-256 `60176b2ba69ad97fe5877db99945f20421b11acf278658d7713a9445df0bc6fd`. This record can be pinned through its independently authenticated GitHub commit after publication; it is not a signed release/tag claim.

[REPORTED, Luna source refutation] The guide and producer/source boundaries had no remaining material findings after the integrated clarity edits. The reviewer did not run tests, query a wallet or exercise execution.

[NOT DETERMINED] Public publication of this revision is pending approval. No wallet lookup, account creation, funding, signing, broadcast or independent Explorer confirmation was performed for this patch. The withdrawn wallet-popup report was not investigated further.


## Agent-side skill 0.3.2 rebuild verification (2026-10-13)

[VERIFIED, source] Skill 0.3.2 still requires MCP 0.3.0. The 14-tool contract and MCP/Mesh services are unchanged. The guide separates safety stops from explicitly retryable same-step technical failures. It requires trusted human wallet preview evidence before signing when fee/rent or network proof is unavailable.

[VERIFIED, CLI smoke] The new command is `npm run verify:skill-rebuild -- --ref <FULL_COMMIT_SHA> --expected-record <INDEPENDENTLY_OBTAINED_RECORD_JSON>`. Use a record obtained through a separately authenticated channel, outside the unverified candidate checkout. The alternative `--expected-sha256 <SHA256>` pins guide bytes, not the manifest canonical URL. CLI output states which metadata source it checked. CI uses the candidate record to check reproducibility and internal consistency. Neither mode proves publisher identity or release approval. The build executes trusted repository code; it is not a sandbox.

[VERIFIED, clean local rebuild] The final unpublished source snapshot `486181bd3ae7bd5596d3c260bf41e39ed2bb2a31` rebuilt with locked dependencies. Record mode and direct-digest mode returned `"status":"PASS"` and exit 0. A wrong expected digest returned `"error":"Rendered SKILLS.md SHA-256 mismatch"` and exit 1. No owned verifier worktree registration remained after these runs. This snapshot is a temporary, unreferenced probe, not a branch commit or published trust pin. Abrupt process termination and cleanup-error injection were not exercised.

[VERIFIED, final artifact] The rendered guide has 17053 bytes and SHA-256 `7ce59b33fb1f3c51dc660e50f434f318fcd593973313c6a5ee71f1046ae01b47`. The record is `web/skills/releases/0.3.2.json`. `GUIDE032_VITE_HTTP_SMOKE_OK` reported guide/manifest/HEAD 200 and the same digest. The preview used the canonical build environment and rendered from source. This is local HTTP proof, not a hosted publication check.

[VERIFIED, regression checks] `npm run verify:web` returned `web: PASS`, `pass 309`, `fail 0`, `skipped 1`. Focused verifier/agents checks returned `tests 8`, `pass 8`, `fail 0`. Removing the digest guard in a scratch source copy gave `tests 5/pass 4/fail 1`; the control gave `tests 5/pass 5/fail 0`. A tampered served manifest gave `tests 1/pass 0/fail 1`; restoring it gave `tests 1/pass 1/fail 0`. The symlink entrypoint regression failed before the fix and passed after it. The user approved its SPEC.md V170/B108 entries. These checks do not prove agent compliance or a funded transaction.

[NOT DETERMINED] This patch has not been committed to its branch, pushed, merged or deployed. No signing key or Git signing setting changed. No wallet lookup, funding, account creation, transaction signing, broadcast or Explorer confirmation ran. Publication requires explicit approval for this artifact.

[VERIFIED, subsequent approval] User approved one commit/push and open PR for `fix/skill-repro-20261013`. The pending-approval statement above records the earlier local-only state. Leave the PR open; merge, deployment and wallet actions are outside this approval.


## Falcon preflight skill 0.3.3 (2026-10-13)

[VERIFIED, rendered artifact] Skill 0.3.3 requires MCP 0.3.1 and keeps 14 tools. The guide uses complete Falcon-verified preflight as standard review data, without a client RPC key. It preserves the required Falcon wallet-status check, exact human limits, separate signatures, sign-only output, human broadcast and final independent Explorer proof. The offline decoder remains unable to attest network from bytes.

[VERIFIED, local HTTP] `GUIDE033_REAL_HTTP_AND_RECORD_OK`: GET guide/manifest and HEAD guide returned 200, bytes 19027, SHA-256 `a244d5a120dd655984ac7825ee3ebdef86a8f5a477b53aba19c885cf1c3afc7f`. The versioned record is `web/skills/releases/0.3.3.json`; CI rebuilds its exact candidate commit. Same-origin delivery and candidate self-consistency are not publisher authentication.

[VERIFIED, local gate] `npm run verify:web`: `web: PASS`, `pass 309`, `fail 0`, `skipped 1`. Requested agents-site check: `tests 3/pass 3/fail 0`. The preview used canonical build environment and rendered from source. No hosted 0.3.3 publication or funded supply is proven by this check.

[VERIFIED, record correction] The interim 0.3.3 digest record became stale after guide refinement. The final canonical render replaced it and matched the actual local HTTP bytes above. This was a release-record update, not a renderer or production-drift finding.

## Capability discovery skill 0.4.0 (2026-10-13)

[VERIFIED, rendered artifact and actual HTTP] `T81_REAL_HTTP_MCP_AND_SKILL_OK` returned GET guide/manifest and HEAD guide HTTP 200. Rendered guide: 20412 bytes, SHA-256 `8e43a82b47f6e22b1a5600a04d2497da0d24c5cc016e2b06bf8c1574819c06da`. The manifest, header and versioned record `web/skills/releases/0.4.0.json` matched. CI's pinned rebuild targets that record; publisher authentication remains separate.

[VERIFIED, local suite] `npm run verify:web` returned `web: PASS` with `pass 309, fail 0, skipped 1`. The website release-input check reported eight routes. These results do not establish hosted 0.4.0 publication, provider availability or a funded transaction.

## D1 local verification: 2026-10-21

[VERIFIED, isolated local branch `fix/dashboard-gate-D1-20261021`, base `b65a38e`] `npm --prefix web test` returned `tests 311`, `pass 311`, `fail 0`, `skipped 0`. `node --test scripts/test/*.test.mjs` returned `tests 27`, `pass 27`, `fail 0`, `skipped 0`; seven cases planted executable code, private modules, fixture imports, or local output in the public release and were rejected. `node web/scripts/verify-release.mjs` returned `status: PASS`, `routes: 8`, `resolvedFiles: 109`, `artifactWritten: false`.

[VERIFIED, kept-test negative direction] Restoring the original public module entry while keeping the new V185 route test returned `tests 1`, `pass 0`, `fail 1`, `skipped 0`: `visitors must see the unavailable dashboard state`. Restoring the fix made that route contract pass.

[VERIFIED, fixture-only Brave journey] `CHROME_BIN="/Applications/Brave Browser.app/Contents/MacOS/Brave Browser" FALCON_DASHBOARD_SOURCE=/private/tmp/d1-nonexistent-opendesign-root npm --prefix web run test:dashboard:browser -- --case=agent` returned `passed: 6`, `total: 6`, `exceptions: []`, `remoteRequests: []`. The browser-test build uses only `https://dashboard-mesh.fixture.invalid`; production API configuration and its HTTPS guard remain unchanged. This proves the fixture agent case, not a live provider or full original-source comparison.

[VERIFIED, actual local production artifact in Brave] `/dashboard/?preview=1&recordMode=saved#agent` rendered `Soon`, with `scripts: 0`, `activeControls: 0`, and `activeRequests: 0`. Existing preview, treasury, and session storage sentinels were unchanged. JavaScript-disabled reload still rendered Soon. Mobile viewport and page widths were both 390. Axe-core reported `violations: 0`.

[NOT VERIFIED] Full OpenDesign source comparison was not run because its original data root was unavailable. No remote CI, deployment, live market-provider request, account configuration change, wallet signature, broadcast, or financial action occurred. The hosted dashboard is not changed by this local fix.

