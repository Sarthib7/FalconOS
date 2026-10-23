# Falcon MCP server

Falcon's Rust server is a stateless Streamable HTTP adapter to Mesh. Current source0.5.0 adds retained publisher-reported NEAR research to the existing public Solana Devnet evidence and owner-bound lending tools. Mesh owns models, decisions and transaction policy. Falcon holds no wallet keys, signs no transactions, funds no accounts and never broadcasts [VERIFIED SOURCE; hosted0.5.0 not verified].

The hosted endpoint is `https://mcp.falconos.markets/mcp`. Railway deployment `6697d4d3-6cab-47da-b2bd-841c0344975c` replaced the Node runtime with Rust. See the [cutover record](../status.md#rust-mcp-cutover-2026-10-15) for evidence and limits [VERIFIED, Railway readback].

The dated deployment record above does not prove a hosted0.5.0 rollout. Check the actual server version before using the new research tools. This source change does not authorize production activation [VERIFIED, scope boundary].

## Install

Use an MCP client with Streamable HTTP support:

```sh
claude mcp add --transport http falconos https://mcp.falconos.markets/mcp
codex mcp add falconos --url https://mcp.falconos.markets/mcp
```

Generic client configuration:

```json
{"mcpServers":{"falconos":{"type":"http","url":"https://mcp.falconos.markets/mcp"}}}
```

Restart the client after changing its configuration. List tools and call `falcon_self_test({})`. Use `falcon_research_case({})` for the public NEAR case, or `falcon_public_graph({})` for fixed Devnet evidence. Both public reads need no wallet or session. Registration and metadata do not prove backend, signer, funding, transaction or model-host readiness [VERIFIED SOURCE].

## Tools (0.5.0 source:19)

| Tool | Contract |
| --- | --- |
| `falcon_public_graph` | Anonymous fixed public graph and technical program/reserve results. Accepts `{}` only. |
| `falcon_connect` | Starts wallet sign-in. The human reviews and signs the exact ownership message. |
| `falcon_connect_verify` | Verifies the ownership signature and returns a 30-minute session. |
| `falcon_disconnect` | Revokes the session. |
| `falcon_yield_opportunities` | Authenticated mainnet lending discovery, not Devnet execution evidence. |
| `falcon_refresh_evidence` | Adopts one public graph revision into owner-bound program/reserve records. |
| `falcon_reserve_decision` | Evaluates explicit human scenario inputs and returns REVIEW, BLOCKED, or NO_DATA with a decision graph. |
| `falcon_prepare_transaction` | Prepares unsigned Devnet supply/redeem from current adopted evidence. |
| `falcon_submit_signed` | Registers exact human-signed bytes. Does not broadcast or return signed bytes. |
| `falcon_check_receipt` | Reconciles a registered transaction against Devnet. |
| `falcon_activity` | Reads canonical owner decision/intent history and retained research summaries without starting work. |
| `falcon_wallet_status` | Public Devnet account snapshot and human-only faucet guidance. |
| `falcon_decode_transaction` | Public bounded Devnet transaction inspection. No signing, simulation, or broadcast. |
| `falcon_self_test` | Version, schema fingerprint, and capability metadata. No backend or wallet probe. |
| `falcon_research_case` | Public latest or immutable case. Optional `caseId`; no owner/session fields. |
| `falcon_replay_research_case` | Replays saved raw evidence and the pinned deterministic model for `caseId`. No inference. |
| `falcon_research_source` | Public immutable raw-source envelope for `revisionId`, limited to the research family. |
| `falcon_adopt_research_case` | Owner-bound adoption with supplied `session`, `requestId` and `publicCaseId`. |
| `falcon_review_research_case` | Operator-granted, fail-closed review job using supplied `session`, `requestId` and `analysisId`. |

### Public graph contract

The anonymous graph calls Mesh `GET /v1/public/graph/live` without a session, Bearer token, Origin, custom selector, query, or body. It reports fixed Solana Devnet public evidence, source revision metadata, program/reserve technical results, policy metadata, the 1-USDC supply cap, `customGraphsSupported: false`, and `executionReady: false` [VERIFIED, source and hosted HTTP].

`OBSERVED` is technical evidence, not a personalized REVIEW, recommendation, owner mandate, or approval. Current `NO_DATA` never substitutes an older successful graph. Public output excludes source content, raw exchanges, wallets, sessions, and owner records. Mesh may reuse a complete graph head for 60 seconds; repeated calls do not force a new capture [VERIFIED, Mesh source and tests].

### Capability discovery (0.5.0)

Self-test accepts `{}` and returns 19 tool names, capability schema version 1, `verification: "metadata-only"` and `defaultSupport: "unsupported"`. It makes no Mesh request and does not verify the owner wallet session, separate operator review grant, or native model-host controls. Signer, funding, transaction and `researchReviewGrant` readiness remain `not_checked`; HTTP readiness cannot verify those prerequisites [VERIFIED SOURCE].

Match each capability's domain, chain and network. Existing public-market-evidence, lending-execution and yield-discovery identifiers retain their scope. NEAR research is publisher-reported mainnet context, with executionSupported false. Review requires both owner authentication and an operator grant plus a verified host. Unsupported stocks/perps advice, swaps, mainnet execution, EVM and brokerage actions keep specific unavailable reasons. No top-level chain/network default applies to every tool [VERIFIED SOURCE].

Current tool schemas are in `fixtures/node-0.5.0.json`. Self-test derives the package version, inventory and schema fingerprint from current source; it does not return a copied historical self-test snapshot [VERIFIED SOURCE].

### Retained NEAR research contract

Public case, source and replay calls are read-only and accept no credentials. The latest-case call can reuse a capture for 24 hours. Saved case IDs bind immutable source references and a deterministic model version. Replay uses those saved inputs rather than a new publisher fetch. Publisher data status OBSERVED is separate from investmentAssessment NO_DATA; neither volume nor fees proves native-token demand or reconciled net capture [VERIFIED, Mesh source and local live HTTP smoke].

Adoption requires an owner session and an explicit request ID. It retains the same snapshot without adding research source heads to the owner's legacy lending graph. Review requires owner authentication, a separately configured operator-principal grant, and verified native model-host controls. It returns a retained job envelope with state PENDING, COMPLETE or UNKNOWN, phase and result. Repeating the same request ID reads that job. Conflicting reuse stops; a lost reply, process failure or UNKNOWN never starts another model run automatically [VERIFIED SOURCE; review runtime checks pending].

[VERIFIED SOURCE, D4] `falcon_activity` delegates to the canonical private Mesh `GET /v1/activity`. It adds bounded retained research without duplicating financial logic. Reading activity cannot create or resume a review. PENDING reports the last recorded phase, not a live process; UNKNOWN remains unconfirmed. No source bodies, signed bytes or hidden reasoning are returned. Existing input schemas and approval rules are unchanged.

[CORRECTION, D4] The earlier public NEAR React workspace and Soon-only dashboard are superseded as human targets. Production human navigation leads to the owner dashboard. Agent/system MCP and HTTP research interfaces remain. The [earlier 0.5.0 browser record](../status.md#source-050-publication-evidence-2026-10-23) remains historical evidence, not the current human surface.

## Decision and execution boundaries

Owner-bound operations need a valid wallet session. Authentication proves ownership only. Supply needs explicit `proposedUsdc`, `maxUsdc`, `minBookLiquidityUsdc`, and `maxEvidenceAgeSeconds`; never infer these limits. A fresh REVIEW decision and current adopted public evidence are prerequisites for supply preparation. Mesh caps supply at 1 Devnet USDC. Redeem uses receipt-token units and forbids a supply decision ID [VERIFIED, Mesh and MCP contracts].

For every transaction, the human reviews the exact unsigned bytes and Falcon-verified preflight, separately approves signing, signs locally, and broadcasts the exact registered bytes. Changed message, amount, route, wallet, or expiry requires another review. REVIEW, preflight, login, and model text cannot approve spending. Registration does not prove broadcast or confirmation [VERIFIED, SPEC V147 and current interfaces].

Treat sessions as short-lived passwords visible in the tool argument context. Reuse an unexpired session and call `falcon_disconnect` to revoke it. Public reads need no session. Wallet and transaction inspection cannot establish signing capability or grant spending authority [VERIFIED, interface contract].

## Configuration

| Variable | Required | Default | Meaning |
| --- | --- | --- | --- |
| `FALCON_MESH_API_URL` | yes | none | Mesh HTTPS base URL. Plain HTTP is allowed only for loopback. Credentials, query, and fragment are rejected. |
| `FALCON_MCP_ORIGIN` | yes | none | Exact HTTP(S) origin used for wallet authentication; Mesh must list it in `FALCON_MESH_ORIGINS`. |
| `FALCON_MCP_ALLOWED_HOSTS` | for public bind | none | Comma-separated bare allowed Host names, without scheme, port, or wildcard. Origin never expands this list. |
| `FALCON_MCP_HOST` | no | `127.0.0.1` | Bind address. The container sets `0.0.0.0`. |
| `PORT` | no | `8792` | Listen port; Railway provides it. |
| `FALCON_MCP_RATE_WINDOW_MS` | no | `60000` | Per-process rate window. |
| `FALCON_MCP_RATE_MAX_PER_SESSION` | no | `60` | Authenticated session/public tool bucket limit. |
| `FALCON_MCP_RATE_MAX_CONNECT` | no | `10` | Wallet/challenge bucket limit. |
| `FALCON_MCP_RATE_MAX_GLOBAL` | no | `300` | Global tool-call limit per process. |

The service routes `/mcp`, `/healthz`, and `/readyz`. Health reports process availability. Readiness probes Mesh, not wallets or funds. MCP requests enforce Host and configured Origin checks, an 8-KiB header cap, a 256-KiB body cap, and a bounded request read. Limit failures remain errors, not successful data [VERIFIED, source and HTTP tests].
Current source rounds rate hints up to positive whole seconds. Expiry clears global and caller quotas together [VERIFIED, V183 tests and local image]. Hosted deployment `6697d4d3-6cab-47da-b2bd-841c0344975c` predates the rounding fix. This cleanup does not deploy that correction [VERIFIED, Railway readback].

## Run locally

Rust builds the MCP server. Node 24.12 or later is still required for Mesh and the web app, not for the Rust runtime [VERIFIED, package entrypoints].

Start an initialized local Mesh database and API using [Mesh setup](../mesh/README.md). From the repository root:

```sh
FALCON_MESH_API_URL=http://127.0.0.1:8791 \
FALCON_MCP_ORIGIN=http://127.0.0.1:5173 \
sh scripts/run-mcp-rust.sh
```

The local Mesh launcher already permits that origin. Register `http://127.0.0.1:8792/mcp` in the client [VERIFIED, launcher configuration].

## Verify

```sh
npm run verify:mcp
cargo run --locked --manifest-path mcp-rust/Cargo.toml --example smoke_http -- https://mcp.falconos.markets/mcp
```

The Rust smoke uses the official RMCP client for public reads. CI supplies `--mesh-unavailable` only for a local container whose Mesh is deliberately unavailable. It checks fail-closed behavior as well as discovery. It never signs or broadcasts [VERIFIED, smoke implementation and local/hosted runs].

The full real-Mesh integration used actual Mesh HTTP/store/lending code and disposable PostgreSQL, with external chain/provider fixtures. It reached REVIEW/BLOCKED and prepared unsigned supply/redeem transactions. That fixture proof is not funded Devnet execution. T82 still needs separate owner-approved signatures, broadcasts, receipts, and Explorer proof [VERIFIED, retained cutover evidence].

## Container and Railway

```sh
docker build --file mcp-rust/Dockerfile --tag falcon-mcp-rust mcp-rust
```

Upload only `mcp-rust/` as the service root. `railway.toml` selects its Dockerfile and `/healthz`; the image runs `/usr/local/bin/falcon-mcp-rust` as UID 65532. Keep the existing public hostname, HTTPS Mesh URL, exact Origin, Host allowlist, and injected port. Mesh must allow that Origin. Do not upload the repository root as the Rust service [VERIFIED, release configuration].

Production changes require explicit owner approval. The service has no persistent local database. Previous Node code remains in Git history; it is not a second maintained runtime. Historical Node test counts and releases belong to the [pre-retirement guide](https://github.com/Sarthib7/FalconOS/blob/7ff245cb7849deea327474a65f14d2b7e398c1a8/mcp/README.md) and [status history](../status.md), not the current Rust test count [VERIFIED, retirement scope].
