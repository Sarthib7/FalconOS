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
| `falcon_self_test` | Metadata-only version, tool inventory/schema fingerprint and capability schema v1; supported scopes, unavailable reasons, authority and contextual checks. Not health/readiness. |

### Public graph contract

`falcon_public_graph` accepts `{}` only and calls `GET /v1/public/graph/live` without query, body, Origin, or Bearer token. It returns the frozen public-market-evidence scope, Solana Devnet graph metadata, program/reserve technical analyses, status, fixed policy metadata, the 1 USDC base-unit cap, `customGraphsSupported: false`, and `executionReady: false`. It never accepts a source or graph selector.

The public graph response must not expose source content/raw exchanges, owner records, wallets, sessions, or private/custom graph data. `OBSERVED` is technical evidence, not a personalized `REVIEW`, owner mandate, recommendation, or approval. A current `NO_DATA` result never falls back to older successful evidence.

Policy metadata is fixed: `policyDefinitionId` = `decision:mesh-reserve-scenario/1`, `policyVersion` = `mesh-reserve-scenario/2`. Program analysis uses technical `mesh-public-evidence/1`; reserve analysis uses technical `mesh-reserve-liquidity/1`. These identifiers and versions are not owner limits or mandates.

### Capability discovery (0.4.0)

[VERIFIED, source and local HTTP smoke] `falcon_self_test({})` returns `capabilities.schemaVersion: 1` and `verification: "metadata-only"`. The input remains empty and the tool inventory stays at 14. The input-schema fingerprint is unchanged. Metadata makes no Mesh or provider request; successful discovery can coexist with HTTP 503 from `/readyz`.

[VERIFIED, response contract] `supported` entries name their ID, domain, chain/network, actions and tool references. Current support is fixed Kamino Devnet evidence, Devnet supply/redeem preparation/registration/reconciliation, and optional Solana mainnet yield discovery. The discovery entry has `executionSupported: false`. The lending entry reports the existing 1-USDC supply cap; Mesh still enforces policy and limits.

[VERIFIED, response contract] `unavailable` entries name unsupported scopes with machine-readable `code` and human-readable `reason`. They cover Solana swaps, stocks/perps advice, Solana mainnet execution, EVM execution and brokerage orders. `defaultSupport: "unsupported"` means absent scopes are unsupported too. Null chain/network fields in unavailable entries do not grant support for any network. Existing strict tool schemas still reject unsupported inputs before Mesh.

[VERIFIED, authority contract] `authority` requires human approval for each signature and broadcast, a human-controlled wallet and human-only broadcast. Custody and delegated execution remain false. `contextualChecks` names wallet-status, decode, preflight and receipt tools; each keeps its own input and trust boundary. Signer, funding and transaction readiness stay `not_checked`. A manifest is neither human consent nor transaction verification.

[VERIFIED, local evidence] `npm run verify:mcp` returned `tests 65, pass 65, fail 0`. Removing the capabilities response made the new regression return `tests 1, pass 0, fail 1`; restoration returned the full suite to passing. `T81_REAL_HTTP_MCP_AND_SKILL_OK` exercised the actual HTTP MCP server with the official SDK while Mesh readiness returned 503, rejected a swap request, and verified the served guide/manifest digest. No wallet, live provider, signing, broadcast or deployment was exercised.

[VERIFIED, review delivery] Capability discovery is in [PR #76](https://github.com/Sarthib7/FalconOS/pull/76), open and unmerged at this update. Implementation commit `7c18c6249d51ed73e18caa980f62e9e7d6650de3` passed exact-head CI and its pinned skill rebuild. The [T81 delivery record](../status.md#t81-capability-discovery-2026-10-13) links those results and states their limits. This is not a hosted 0.4.0 release claim.


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

[REPORTED, builder local SDK fixtures, 2026-10-12] `node --test test/tools.test.mjs` reported 33 tests, 33 passed, 0 failed. The suite uses the official MCP client over Streamable HTTP on loopback with fake Mesh responses. It covers anonymous/no-auth public graph reads and redaction, current NO_DATA without stale reuse, two-ID public adoption and graphRevision binding, required human scenario inputs, the full decisionGraph, and public-only prepare.

[REPORTED, builder local secret-boundary fixture, 2026-10-12] `node --test test/secrets.test.mjs` reported 1 test, 1 passed, 0 failed.

[NOT DETERMINED] The full `npm test` run did not complete within its 240-second deadline; `test/http.mjs` remained pending. No full-package pass, production parity, live RPC, signing, funding, broadcast, or deployment is claimed.

Correction (2026-10-12): the two local 0.3.0 fixture paragraphs previously claimed VERIFIED results. Those counts came from builder reports. The lead did not confirm that local full run. The observed CI and hosted evidence below supersede the release-readiness uncertainty, not the test history.

## Hosted 0.3.0 release (2026-10-12)

[VERIFIED] Backend PR #69 and client PR #70 merged sequentially. Exact-head CI runs `38291447461` (head `7cf843c65a583f00df15da598fd4af22522eae12`) and `38292172173` (head `ba0deb9be3b7f25757221570d4dca1f7fb16b62b`) completed successfully, including the repository verification, browser journey and container checks. Runtime source was published from merged commits `7ffbfe9c69bb09a3c2c5a176ea6bdb20d2ea84f4` (Mesh) and `f2d4b8ca2bef97947b86de3682a17d36900085cb` (MCP).

[VERIFIED, Railway API readback] Mesh deployment `5d6ee043-6824-4191-a34e-dd8cd572b83a` and MCP deployment `3552088e-ecd8-4f07-a9ef-0c45a52ef4e4` returned `SUCCESS`. Mesh uses `/readyz`; MCP uses `/healthz`. Both health-check timeouts are 60 seconds. Live probes returned `200 {"status":"ready"}` and `200 {"status":"alive"}`.

[VERIFIED, official SDK over hosted Streamable HTTP] The final check returned:

```json
{"marker":"FINAL_HOSTED_RELEASE_E2E_OK","serverVersion":"0.3.0","toolCount":14,"actionSchemaParity":true,"schemaFingerprint":"sha256:8a5230bd2cd9cf373b9a84706759723742a1c9cdf94f482f3752cb427674c09c","status":"OBSERVED","programStatus":"OBSERVED","reserveStatus":"OBSERVED","sourceCount":3,"executionReady":false}
```

[VERIFIED, hosted negative checks] A custom graph argument and missing session were rejected. Malformed transaction bytes returned `INVALID_INPUT`. An unapproved HTTP Origin returned `403`. These checks do not attest a funded wallet or an executed transaction.

[VERIFIED, HTTPS byte comparison] Approved Pages deployment `31b1f779` serves the guide and manifest on `agents.falconos.markets`. Both return `200`, version `0.3.0`; the manifest requires MCP `0.3.0`. The 10888-byte guide SHA-256 is `1e036bc96d7014fb701a2bffb20bbd56bb9f53eb64de3c5c297c7335bb8fb8d7`, matching the built artifact. Pin this value through an independently trusted channel; a digest fetched beside the guide does not establish trust.

[NOT DETERMINED] No funded supply/redeem or independent Explorer receipt was exercised. This release check used no wallet, signing, funding or broadcast. Custom graph configuration and the separate swap/send/receive/quote expansion are not part of these 14 tools.


## Falcon-verified preflight release 0.3.1 (2026-10-13)

[VERIFIED, source and local producer/HTTP SDK smoke] Existing `falcon_prepare_transaction` returns a complete `preflight` bound to the unchanged `messageSha256`. It includes pinned Devnet genesis and RPC provenance, successful exact-byte simulation and token effects, fee plus conditional destination-ATA rent, affordability and observed block-height/time limits. Inputs and the 14-tool inventory stay unchanged. No generic RPC proxy, user key handling or automatic broadcast was added.

[VERIFIED, trust contract] `verification: "falcon-rpc"` means Falcon checked the data through its fixed Devnet RPC. It is not independent verification, human approval or future execution proof. Standard review no longer requires a client-owned RPC account. Clients still decode exact bytes, inspect complete proof and obtain each human signature approval. Offline decode retains requested-context-only network metadata and false signing/readiness flags. The human alone broadcasts; final CONFIRMED must match the registered signature and independent Devnet Explorer evidence.

[VERIFIED, failure boundaries] Incomplete/malformed/hash-mismatched or already-signed upstream packets return `PREFLIGHT_UNAVAILABLE` without an unsigned transaction. Scalar cost overflow, inconsistent token effects and signer/blockhash mismatches fail closed. The store retains original proof and earliest expiry. First registration checks live validity separately from historical receipt-safe cryptographic verification. A 120-second ceiling is not a guaranteed blockhash lifetime.

[VERIFIED, local gate] `npm run verify:mcp`: `tests 63`, `pass 63`, `fail 0`. `REAL_PRODUCER_PG_HTTP_MCP_PREFLIGHT_SMOKE_OK` crossed actual producer, owned PostgreSQL, Mesh HTTP and MCP HTTP using the official SDK. Missing and altered upstream proof returned `PREFLIGHT_UNAVAILABLE`. RPC/account data and authentication in that smoke were controlled fixtures; no live wallet, external RPC, signature or broadcast was exercised.
