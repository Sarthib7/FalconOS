# Local knowledge mesh

[VERIFIED, source: `server.mjs`, `store.mjs`, `http.mjs`, `wallet-auth.mjs`] This Node service retains sources and analyses in PostgreSQL. The browser at `/mesh/` shows the evidence graph and a Devnet lending terminal. The server derives each workspace from a mesh token or verified Supabase subject. Bot yield requests also accept a verified wallet session.

[VERIFIED, source: package.json, schema.sql, migrations 0002_lending.sql, 0003_wallet_auth.sql and 0004_mcp_oauth.sql] Use Node 24.12 or later and PostgreSQL. The current application schema is version 4. Startup checks the schema and does not change it.

## Run

[INFERRED, fresh local setup] Run these commands from the repository root. Use a new local database. Review schema.sql, all migrations, and the permission candidate before explicit initialization.

```bash
npm --prefix mesh ci
npm --prefix web ci
createdb falcon_mesh
export DATABASE_URL='postgresql://localhost/falcon_mesh'
FALCON_MESH_ALLOW_SCHEMA_SETUP=1 npm --prefix mesh run init-db
npm --prefix mesh run dev:local
```

[VERIFIED, source: local.mjs] The local launcher binds the API to 127.0.0.1:8791. It saves operator-token and oauth-service-token under mesh/.local/ with mode 0600. Both files are excluded from Git. The browser keeps the operator token in memory. FALCON_MESH_ORIGINS includes the local bot origin http://127.0.0.1:5194 for Phantom message sign-in and OAuth approval.


[INFERRED, second terminal] Start the React site, then open `http://127.0.0.1:4183/mesh/`.

```bash
npm --prefix web run dev:local
pbcopy < mesh/.local/operator-token
```

[VERIFIED, source: `web/mesh/app.mjs`, `mesh/live.mjs`] Paste the token into the connection form. The graph comes first, with live evidence selected by default. A new workspace has no nodes until you explicitly capture a fixed public source. Capture the official document and Devnet program account for the program-evidence observation. Capture the separate Devnet USDC reserve connector for vault-backed book liquidity. Select its observation and run analysis to inspect the retained slot, hashes and amount. That amount is not freely withdrawable or approval to trade. Synthetic scenarios remain a separate, labelled example. The terminal uses the program-evidence analysis, a Wallet Standard signer and one fixed Kamino reserve; supply input is capped at one Devnet USDC.

[VERIFIED, scope: `kamino.mjs`, `web/mesh/wallet.mjs`] Wallet discovery uses capabilities rather than a wallet brand list. A wallet with missing capabilities is rejected. A real wallet supply and redemption round trip remains unverified. The server has no wallet key. Signing and broadcasting require explicit browser actions.
## Bot wallet authentication

[VERIFIED, source and local integration tests] The bot requests a server challenge, then asks Phantom to sign its exact origin-bound message through Wallet Standard `solana:signMessage`. This is a login proof. It does not approve a transaction, read balances, or move funds.

[VERIFIED, source and local integration tests] The Mesh API checks the configured Origin, verifies the Ed25519 signature, and deletes the challenge in the same transaction that creates the session. PostgreSQL stores the SHA-256 hash of a random session token. The bot stores the token in `sessionStorage`; it expires after 30 minutes. Logout revokes it. The owner ID comes from the verified wallet address.

[VERIFIED, source: server.mjs, init-db.mjs, wallet-auth.mjs] Bot wallet login uses the challenge and session tables introduced in schema version 3. MCP OAuth needs schema version 4 and migration 0004_mcp_oauth.sql. init-db applies the full local history. Service startup only checks the schema version. Static mesh tokens and Supabase JWTs remain available to existing clients.

## Live decision graph

[VERIFIED, source: `web/dashboard/Operate.jsx`, `mesh/scenario.mjs`] Open `http://127.0.0.1:4183/dashboard/#operate` to connect the retained Devnet reserve capture to a proposed position and your own limits. Paste the local access token directly into Operate. That in-memory connection is shared with Knowledge; the token never enters a URL or browser storage. Enter all four fields yourself. There are no preset values. The service saves a `REVIEW`, `BLOCKED` or `NO_DATA` advisory with observed, owner-entered, rule and result nodes. The newest saved decision opens when you return to Operate; select older history to inspect its original graph and cutoff. The book amount is not freely withdrawable, the proposed position is not a wallet holding, and the page cannot sign or send a transaction. Refresh the fixed reserve source in `/mesh/` before evaluating when its evidence is stale.
## Devnet execution proof

[VERIFIED, user-confirmed, 2026-09-30] The local mesh MVP needs one capable wallet to complete a signed supply and redemption with test tokens. An unsigned simulation is not a completed transaction. Test only on Devnet; no real-fund test is part of this proof.

1. [INFERRED, procedure] Capture the official document and Devnet program account, then save a current program-evidence `OBSERVED` analysis. The reserve-liquidity observation is separate and cannot prepare a transaction. Select a Devnet-capable wallet with the required token accounts and test-token balances.
2. [INFERRED, procedure] Prepare a supply of at most one Devnet USDC. Review the action and unsigned simulation, then explicitly sign and send in the browser. Check the saved submission and receipt until the exact transaction is confirmed and its token deltas reconcile. Stop on pending, failed, or unverified status.
3. [INFERRED, procedure] Prepare redemption against the resulting receipt tokens and repeat the explicit sign, send, and receipt checks. Reload the page and inspect both saved intents, events, signatures, and balance changes. One wallet proves this path only; other wallet brands remain unverified. Inbox delivery and any funded test have separate gates.

## Wallet session API routes

[VERIFIED, source: `mesh/http.mjs`, `mesh/wallet-auth.mjs`, `migrations/0003_wallet_auth.sql`] The bot signs an origin-bound server challenge with `solana:signMessage`. The server derives the owner from the wallet address and stores one-time challenges and hashed 30-minute sessions in PostgreSQL. Sign-in does not authorize transactions or move funds.

[VERIFIED, source: `mesh/http.mjs`] The API exposes `POST /v1/auth/wallet/challenge`, `POST /v1/auth/wallet/verify`, `GET /v1/auth/wallet/session`, and `POST /v1/auth/wallet/logout`. Add the bot origin to `FALCON_MESH_ORIGINS`. Static mesh tokens and Supabase session verification remain available for existing clients.

## MCP OAuth

[VERIFIED, source: oauth.mjs, http.mjs, migrations/0004_mcp_oauth.sql] Mesh is the OAuth authorization server for the MCP resource. It validates client metadata and PKCE S256, keeps authorization codes and access tokens as hashes, and issues revocable access tokens for up to 30 minutes. It issues no refresh token.
[VERIFIED, source: oauth.mjs, wallet-auth.mjs] Approval verifies wallet identity and consumes one authorization request. It does not create a wsi1 wallet session.
[VERIFIED, source: http.mjs] Public OAuth routes are GET /.well-known/oauth-authorization-server, GET /oauth/authorize, POST /oauth/token, and POST /oauth/revoke. Browser approval uses POST /v1/oauth/approval/context, /challenge, /approve, and /deny. Those routes accept only the configured approval-page Origin. POST /v1/oauth/introspect is server-to-server and requires X-Falcon-MCP-Service-Token.

[VERIFIED, source: SPEC I20, server.mjs] Production OAuth URLs: issuer https://api.falconos.markets, resource https://mcp.falconos.markets/mcp, and approval page https://agents.falconos.markets/oauth/approve. Set these with FALCON_MCP_OAUTH_ISSUER, FALCON_MCP_OAUTH_RESOURCE, and FALCON_MCP_OAUTH_APPROVAL_URL. Set FALCON_MCP_OAUTH_SERVICE_SECRET to the same 32-byte base64url secret used by the MCP server. Add https://agents.falconos.markets to FALCON_MESH_ORIGINS.

[VERIFIED, source: init-db.mjs, store.mjs] Migration 0004_mcp_oauth.sql advances the schema from version 3 to version 4. init-db applies the complete migration history only when FALCON_MESH_ALLOW_SCHEMA_SETUP=1. Service startup checks schema readiness and does not run migrations.

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

[VERIFIED, source: `http.mjs`, `server.mjs`] The API limits authenticated requests per owner and across the process in a fixed window. Defaults are 120 requests per owner and 600 globally every 60 seconds. Set positive integer `FALCON_MESH_RATE_WINDOW_MS`, `FALCON_MESH_RATE_MAX_PER_OWNER`, and `FALCON_MESH_RATE_MAX_GLOBAL` to change them. A capped request returns 429 with `Retry-After`; `/healthz` and `/readyz` are exempt. Limits reset on process restart and are not shared across instances.
