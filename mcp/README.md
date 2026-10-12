# Falcon MCP server

A stateless remote MCP (Streamable HTTP) adapter for FalconOS on Solana **Devnet**. It adds no database, custody, key handling, signing, funding, or transaction broadcast.

The first functional call is `falcon_public_graph({})`. It reads the fixed live public market graph without a wallet, funds, login, session, or signer. Public `OBSERVED` is technical evidence, not a personalized reserve decision or approval. Owner-bound records and preparation are optional later stages.

Only the human reviews and approves each signature, and only the human broadcasts the exact registered transaction.

## Install (agent)

Claude Code:

```sh
claude mcp add --transport http falconos https://YOUR-MCP-HOST/mcp
```

Or use the common JSON format. The `type` field must be `http`; a URL-only entry may be treated as stdio.

```json
{"mcpServers":{"falconos":{"type":"http","url":"https://YOUR-MCP-HOST/mcp"}}}
```

Replace `YOUR-MCP-HOST` with the deployment hostname. Any MCP client that speaks Streamable HTTP can use the same URL.

## Tools (14)

| Tool | What it does |
| --- | --- |
| `falcon_public_graph` | First functional call. Anonymous, read-only fixed public market graph and technical program/reserve results; no arguments or session. |
| `falcon_connect` | Starts wallet sign-in. The human reviews and signs the exact ownership message. Reuse a valid session. |
| `falcon_connect_verify` | Verifies the human's 64-byte signature and returns the 30-minute session. |
| `falcon_disconnect` | Revokes the session. |
| `falcon_yield_opportunities` | Reads authenticated, provider-indexed lending discovery. Not Devnet execution evidence. |
| `falcon_refresh_evidence` | Adopts the current public graph into owner-bound program and reserve analysis records. Returns both IDs, graphRevision and evidenceSource. No per-connector capture. |
| `falcon_reserve_decision` | Requires the adopted analysisId and all human-provided scenario inputs; returns REVIEW, BLOCKED or NO_DATA, binding fields and full decisionGraph. |
| `falcon_prepare_transaction` | Prepares unsigned Devnet supply/redeem only through the public-evidence lending route. |
| `falcon_submit_signed` | Registers exact human-signed bytes. Falcon does not broadcast or return signed bytes. |
| `falcon_check_receipt` | Reconciles a registered transaction against Devnet. |
| `falcon_activity` | Reads the owner-scoped decision/intent trail. |
| `falcon_wallet_status` | Public read-only Devnet wallet account snapshot and human-only faucet guidance. |
| `falcon_decode_transaction` | Public bounded Devnet transaction decode. No signing, simulation, or broadcast. |
| `falcon_self_test` | Metadata-only version, tool names/count and schema fingerprint; not health/readiness. |

### Public graph contract

`falcon_public_graph` accepts `{}` only and calls `GET /v1/public/graph/live` without query, body, Origin, or Bearer token. It returns the frozen public-market-evidence scope, Solana Devnet graph metadata, program/reserve technical analyses, status, fixed policy metadata, the 1 USDC base-unit cap, `customGraphsSupported: false`, and `executionReady: false`. It never accepts a source or graph selector.

The public graph response must not expose source content/raw exchanges, owner records, wallets, sessions, or private/custom graph data. `OBSERVED` is technical evidence, not a personalized `REVIEW`, owner mandate, recommendation, or approval. A current `NO_DATA` result never falls back to older successful evidence.

Policy metadata is fixed: `policyDefinitionId` = `decision:mesh-reserve-scenario/1`, `policyVersion` = `mesh-reserve-scenario/2`. Program analysis uses technical `mesh-public-evidence/1`; reserve analysis uses technical `mesh-reserve-liquidity/1`. These identifiers and versions are not owner limits or mandates.

## Configuration

| Variable | Required | Default | Meaning |
| --- | --- | --- | --- |
| `FALCON_MESH_API_URL` | yes | none | Base URL of the Mesh API. Must be `https` unless the host is loopback. |
| `FALCON_MCP_ORIGIN` | yes | none | The exact Origin this server sends to Mesh for wallet auth, for example `https://mcp.example.com`. It must be listed in Mesh `FALCON_MESH_ORIGINS`. The sign-in message names this origin's host. |
| `FALCON_MCP_ALLOWED_HOSTS` | when host is not loopback | none | Comma-separated bare hostnames accepted in the `Host` header of `/mcp` (DNS rebinding protection). The server refuses to start without it on a non-loopback host. |
| `FALCON_MCP_HOST` | no | `127.0.0.1` | Bind address. The Docker image sets `0.0.0.0`. |
| `PORT` | no | `8792` | Listen port. Railway sets it. |
| `FALCON_MCP_RATE_WINDOW_MS` | no | `60000` | Rate limit window. |
| `FALCON_MCP_RATE_MAX_PER_SESSION` | no | `60` | Authenticated calls per session per window; public decode and self-test each use a separate bounded public bucket. |
| `FALCON_MCP_RATE_MAX_CONNECT` | no | `10` | `falcon_connect` and `falcon_wallet_status` calls per wallet, and `falcon_connect_verify` calls per challenge, per window. |
| `FALCON_MCP_RATE_MAX_GLOBAL` | no | `300` | Tool calls per window across all callers. |

Endpoints: `POST|GET|DELETE /mcp`, `GET /healthz` (`{"status":"alive"}`), `GET /readyz` (calls Mesh `/readyz`; `{"status":"ready"}` or 503). `/healthz` and `/readyz` skip the Host check so platform probes work. `/mcp` checks `Host` against the allowed hosts and rejects a browser `Origin` that is not the MCP host or the configured origin. Health/readiness only describe process/Mesh availability; they do not establish wallet signing support, funds, or transaction execution readiness.

The server logs one short line at startup and a code-only line for unexpected failures. It never logs tool arguments, sessions, signatures or transactions.

## Run locally against a local Mesh

1. Start Mesh with a database (see `../mesh/README.md`), for example `npm --prefix ../mesh run dev:local`. It listens on `127.0.0.1:8791` and already allows the origin `http://127.0.0.1:5173`.
2. Install and start this server:

```sh
npm ci
FALCON_MESH_API_URL=http://127.0.0.1:8791 \
FALCON_MCP_ORIGIN=http://127.0.0.1:5173 \
npm start
```

3. Point the agent at `http://127.0.0.1:8792/mcp`: `claude mcp add --transport http falconos http://127.0.0.1:8792/mcp`. The sign-in message will name `127.0.0.1:5173`, because that is the origin sent to Mesh.

Tests need no database: `npm test` runs against fake Mesh servers.

## Deploy on Railway

1. Create a service from this directory. `railway.toml` selects the Dockerfile and the `/healthz` health check.
2. Set `FALCON_MESH_API_URL`. Railway private networking gives Mesh an internal address of the form `http://<mesh-service>.railway.internal:<port>`. That URL is plain `http`, and this server refuses a non-https Mesh URL unless the host is loopback, so the private address is rejected at startup. Use Mesh's public `https` URL instead. The rule is deliberate: wallet sessions travel on this hop.
3. Set `FALCON_MCP_ORIGIN` to the public origin of this service, and `FALCON_MCP_ALLOWED_HOSTS` to its public hostname.
4. **Add that same origin to Mesh `FALCON_MESH_ORIGINS`.** Without it Mesh answers `ORIGIN_DENIED` to every sign-in.
5. The image sets `FALCON_MCP_HOST=0.0.0.0`. With no `FALCON_MCP_ALLOWED_HOSTS` the container exits at startup.

## Limits

- **Stateless:** sessions and owner records live in Mesh; the MCP process stores nothing.
- **Session privacy:** an authenticated tool receives the session argument in model context. Treat it as a short-lived password. Reuse it; `falcon_disconnect` revokes it.
- **Per-instance limits:** authenticated calls are keyed by a session hash, sign-in/status by wallet, verification by challenge, plus the global cap. Public graph/decode/self-test use bounded public buckets; exceeding a limit returns `RATE_LIMITED` with `retryAfterSeconds`.
- **Public read tools:** the live graph, wallet status, and transaction decode are unauthenticated read-only APIs. Wallet-status faucet links/checklist are human-only; Falcon never funds or creates accounts.
- **Wallet authorization:** `/mcp` is reachable by anyone who can reach the host. The public graph needs no session. Owner-bound adoption, decisions, activity, and execution records require a valid wallet session. Preparation requires no transaction signature; the human alone signs and broadcasts afterward.
- **Devnet only:** no mainnet, custody, Falcon-held keys, funding, or server-side broadcast.
- **Self-test:** metadata only. `/readyz` probes Mesh availability, not wallet support, funds, or transaction readiness.
- **Freshness:** public source evidence is usable for about 300 seconds; an unsigned prepared transaction expires in about 120 seconds.
- **Data:** APY is provider-indexed, may be stale, is not a realized return, and nothing is guaranteed.

## Local 0.2.0 verification

[VERIFIED] The real loopback MCP SDK smoke returned `falcon-mcp` version `0.2.0`, 13 tools and `SMOKE_OK`. Its schema fingerprint was `sha256:2b280b3dbf093582fab4c33e19d11d9b54f52e6b73f58277cce380fc73c9ec5f`. A synthetic unsigned System transfer decoded to 1000 lamports with its original message hash and `safeToSign: false`. Invalid wallet input was rejected before a wallet lookup.

[VERIFIED] `npm --prefix mcp test` reported `56` tests, `56` passed, `0` failed. Fresh disposable PostgreSQL verification reported Mesh `238` tests, `238` passed, `0` failed. Regressions failed when cap enforcement or receipt redaction was absent.

[NOT DETERMINED] Production commit parity is not established. These are local results, not a production release or funded supply/redeem proof. No wallet lookup, signing, funding or broadcast occurred in the loopback smoke.

## Local 0.3.0 verification

[VERIFIED, local SDK wire/harness fixtures, 2026-10-12] `node --test test/tools.test.mjs` reported 33 tests, 33 passed, 0 failed. The suite uses the official MCP client over Streamable HTTP on loopback with fake Mesh responses. It covers anonymous/no-auth public graph reads and redaction, current NO_DATA without stale reuse, two-ID public adoption and graphRevision binding, required human scenario inputs, the full decisionGraph, and public-only prepare.

[VERIFIED, local secret-boundary fixture, 2026-10-12] `node --test test/secrets.test.mjs` reported 1 test, 1 passed, 0 failed.

[NOT DETERMINED] The full `npm test` run did not complete within its 240-second deadline; `test/http.mjs` remained pending. No full-package pass, production parity, live RPC, signing, funding, broadcast, or deployment is claimed.
