# Local knowledge mesh

[VERIFIED, source: `server.mjs`, `store.mjs`, `http.mjs`] This Node service retains sources and analyses in PostgreSQL. The browser at `/mesh/` shows the evidence graph and a Devnet lending terminal. The server derives the workspace from a hashed access token.

[VERIFIED, source: `package.json`, `schema.sql`, `migrations/0002_lending.sql`] Use Node 24.12 or later and PostgreSQL. The schema has five tables. Startup checks the schema without changing it.

## Run

[INFERRED, fresh local setup] Run these commands from the repository root. Use a new local database. Inspect both SQL files before the explicit initialization command.

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

## Preview and verification

[INFERRED, commands] Build and preview the complete site with the local signup API:

```bash
npm --prefix web run build:site
npm --prefix web run preview:local
```

[INFERRED, tests] Set the test URL to an initialized disposable database. Tests deliberately write fixtures. Browser checks require a free port 8791, so stop the preview mesh API first.

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

[INFERRED, hosting] The planned host is the personal Railway workspace for the API and PostgreSQL. Cloudflare Pages serves the browser. Deployment, hosted database setup and real-fund testing remain separate actions. See the [mesh contract](../docs/knowledge-mesh.md) and [email contract](../docs/landing-email.md).

[VERIFIED, hosting correction, 2026-09-27] The user selected Supabase for PostgreSQL and approved the reviewed schema setup. This replaces the preceding Railway PostgreSQL plan. Railway remains the selected API host. See [the current Supabase setup](../docs/supabase-setup.md) for permissions, connection requirements, and measured deployment state.
