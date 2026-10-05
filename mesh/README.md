# Local knowledge mesh

[VERIFIED, source: `server.mjs`, `http.mjs`, `auth.mjs`, `wallet-auth.mjs`] This Node service retains sources, analyses, and wallet sessions in PostgreSQL. Existing clients can use hashed static tokens or Supabase sessions. The bot owner comes from a server-verified wallet session.

[VERIFIED, source: `package.json`, `schema.sql`, `migrations/0002_lending.sql`, `migrations/0003_wallet_auth.sql`] Use Node 24.12 or later and PostgreSQL. The schema is version 3. Startup checks it without changing it. Migration 0003 adds wallet challenges and sessions.

## Run

[INFERRED, fresh local setup] Run these commands from the repository root. Use a new local database. Review `schema.sql` and migrations `0002_lending.sql` and `0003_wallet_auth.sql` before explicit initialization.

```bash
npm --prefix mesh ci
npm --prefix web ci
createdb falcon_mesh
export DATABASE_URL='postgresql://localhost/falcon_mesh'
FALCON_MESH_ALLOW_SCHEMA_SETUP=1 npm --prefix mesh run init-db
npm --prefix mesh run dev:local
```

[VERIFIED, source: `local.mjs`] The local launcher binds the API to `127.0.0.1:8791`. It saves a generated token in `mesh/.local/operator-token`. The file is excluded from Git. The browser keeps this token in memory. Reloading requires another connection.

[INFERRED, second terminal] Start the React site, then open `http://127.0.0.1:4183/mesh/`.

```bash
npm --prefix web run dev:local
pbcopy < mesh/.local/operator-token
```

[INFERRED, browser steps] Paste the token into the connection form. Load synthetic evidence to inspect the graph. For live evidence, select live mode, capture both connectors, and run analysis. Connect a Wallet Standard wallet that supports Devnet and versioned transaction signing. Preparation requires the wallet's input token account and enough Devnet SOL. The terminal supports one fixed Kamino reserve and caps supply input at one Devnet USDC.

[VERIFIED, scope: `kamino.mjs`, `web/mesh/wallet.mjs`] Wallet discovery uses capabilities rather than a wallet brand list. A wallet with missing capabilities is rejected. A real wallet supply and redemption round trip remains unverified. The server has no wallet key. Signing and broadcasting require explicit browser actions.

## Bot wallet authentication

[VERIFIED, source: `mesh/http.mjs`, `mesh/wallet-auth.mjs`, `migrations/0003_wallet_auth.sql`] The bot signs an origin-bound server challenge with `solana:signMessage`. The server derives the owner from the wallet address and stores one-time challenges and hashed 30-minute sessions in PostgreSQL. Sign-in does not authorize transactions or move funds.

[VERIFIED, source: `mesh/http.mjs`] The API exposes `POST /v1/auth/wallet/challenge`, `POST /v1/auth/wallet/verify`, `GET /v1/auth/wallet/session`, and `POST /v1/auth/wallet/logout`. Add the bot origin to `FALCON_MESH_ORIGINS`. Static mesh tokens and Supabase session verification remain available for existing clients.

## Preview and verification

[INFERRED, commands] Build and preview the complete site with the local signup API:

```bash
npm --prefix web run build:site
npm --prefix web run preview:local
```

[INFERRED, tests] Set `FALCON_MESH_TEST_DATABASE_URL` to an initialized disposable database, then run `npm run verify:mesh` from the repository root. It checks the API source and runs the complete mesh suite. Tests deliberately write fixtures. Missing test configuration fails visibly and never falls back to `DATABASE_URL`. See [repository verification](../docs/README.md) for the full command. Browser checks require a free port 8791, so stop the preview mesh API first.

[INFERRED, source release check] `npm run verify:release:mesh -- --root <checkout>` checks another source candidate without database credentials. The declared API files are copied into a disposable directory for native module linkage. The expected missing-configuration guard must run before database or listener creation. This does not build a Docker image or verify a hosted service. An actual image build uses `docker build -f mesh/Dockerfile mesh` from the repository root; its package installation needs registry access or a prepared build cache.

[VERIFIED, user preference, 2026-09-27] Use Brave for browser checks. The existing harnesses accept executable overrides. The local executable returned `Brave Browser 154.1.96.59`.

```bash
export FALCON_MESH_TEST_DATABASE_URL='postgresql://localhost/falcon_mesh_test'
export CHROME_BIN='/Applications/Brave Browser.app/Contents/MacOS/Brave Browser'
export FALCON_CHROME_BIN="$CHROME_BIN"
npm --prefix mesh test
npm --prefix web test
npm --prefix web run build:mesh
node web/test/mesh-browser.mjs
node web/test/landing-browser.mjs
```

[VERIFIED, source: `live.mjs`, `kamino.mjs`] Live capture reads official Kamino documents and Solana Devnet RPC. Browser regression tests inject network and wallet responses. Those checks cannot prove actual wallet compatibility or a confirmed chain transaction.

## Hosting

[VERIFIED, user choice and retained setup evidence, 2026-09-27] Supabase is the PostgreSQL target. Its reviewed schema is applied, with the application role still `NOLOGIN`. The personal Railway workspace is the selected API host; hosted API connectivity remains unverified. Cloudflare Pages serves the browser. See [the current Supabase setup](../docs/supabase-setup.md) and [mesh contract](../docs/knowledge-mesh.md).

[VERIFIED, correction] The earlier plan placed both API and PostgreSQL on Railway. The user's Supabase choice replaced only the database target. A successful schema setup does not establish runtime credentials, TLS, or an API deployment.
