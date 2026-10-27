# Falcon MCP server

Falcon's Rust server is a stateless Streamable HTTP adapter to Mesh. Source0.7.0 adds an owner-scoped CFO decision trace to the NEAR/mainnet CFO, retained research and Solana Devnet tools. Mesh owns financial logic and storage. Falcon holds no keys and grants no signing or spending authority. Existing owner signatures and default-deny trial grants remain required [SOURCE SCOPE; hosted0.7.0 not verified].

The hosted endpoint is `https://mcp.falconos.markets/mcp`. Railway deployment `6697d4d3-6cab-47da-b2bd-841c0344975c` replaced the Node runtime with Rust. See the [cutover record](../status.md#rust-mcp-cutover-2026-10-15) for evidence and limits [VERIFIED, Railway readback].

The dated deployment record above does not prove a hosted0.7.0 rollout. Check the actual server version before using new tools. The last observed hosted server reported0.4.0; local0.7.0 behavior does not establish production recovery [VERIFIED OBSERVATION, 2026-10-27].

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

## Tools (0.7.0 source:30)

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
| `falcon_cfo_overview` | Authenticated retained NEAR/mainnet CFO state; not a live readiness probe. |
| `falcon_cfo_mandate` | Saves exact owner limits; wallet is derived from the session, never passed in the mandate body. |
| `falcon_cfo_capture` | Captures supported owner holdings from finalized NEAR evidence; NO_DATA is preserved. |
| `falcon_cfo_plan` | Submits one explicit invest, redeem, rotate, reinvest, or hold request for retained review. |
| `falcon_cfo_prepare` | Returns the unsigned exact payload for owner review; does not sign, authorize, or relay. |
| `falcon_cfo_register_signed` | Registers the owner signature for the exact prepared action; distinct from wallet login. |
| `falcon_cfo_relay` | Requests relay of only the registered signed intent; exact trial grants default to deny. |
| `falcon_cfo_reconcile` | Reads retained action state and receipt verification; unknown stays unknown. |
| `falcon_cfo_monitor` | Configures bounded read-only monitoring; it never signs or relays. |
| `falcon_cfo_record` | Reads one authenticated retained CFO record with signed bytes redacted. |
| `falcon_cfo_decision_trace` | Reads a hash-bound, owner-scoped decision graph at an immutable record cutoff, with current freshness reported separately. |

### Public graph contract

The anonymous graph calls Mesh `GET /v1/public/graph/live` without a session, Bearer token, Origin, custom selector, query, or body. It reports fixed Solana Devnet public evidence, source revision metadata, program/reserve technical results, policy metadata, the 1-USDC supply cap, `customGraphsSupported: false`, and `executionReady: false` [VERIFIED, source and hosted HTTP].

`OBSERVED` is technical evidence, not a personalized REVIEW, recommendation, owner mandate, or approval. Current `NO_DATA` never substitutes an older successful graph. Public output excludes source content, raw exchanges, wallets, sessions, and owner records. Mesh may reuse a complete graph head for 60 seconds; repeated calls do not force a new capture [VERIFIED, Mesh source and tests].

### Capability discovery (0.7.0 source)

Self-test accepts `{}` and returns 30 tool names, capability schema version1, `verification: "metadata-only"` and `defaultSupport: "unsupported"`. It makes no Mesh request. Signer, funding, transaction, research grants and CFO context/provider readiness remain `not_checked`. Signatures and exact trial grants remain separate from login or model review [SOURCE CONTRACT].

Match each capability's domain, chain and network. Existing public-market-evidence, lending-execution and yield-discovery identifiers retain their scope. NEAR research is publisher-reported mainnet context, with executionSupported false. CFO is a separate NEAR/mainnet surface. Unsupported stocks/perps advice, swaps, EVM and brokerage actions keep specific unavailable reasons. No top-level chain/network default applies to every tool [SOURCE CONTRACT].

The frozen `fixtures/node-0.5.0.json` retains the19 legacy schemas. Current discovery adds11 CFO schemas from `fixtures/cfo-tools-0.7.0.json`. Self-test fingerprints the combined inventory; Cargo supplies server version0.7.0 [VERIFIED SOURCE].

### Retained CFO decision trace

Use `falcon_cfo_decision_trace({session,recordId})`. For a completed model review, the plan or overview exposes its immutable `review.recordId`. Job identity and record identity are different [VERIFIED SOURCE].

Mesh loads owner-bound records at the selected root's append sequence. The historical graph and its hash remain unchanged when a newer capture or review arrives. The separate `freshness` envelope uses database UTC, the retained mandate's age limit, provider timestamps and quote expiry. Null source time means unknown, not the capture time. Trace reads make no capture, model, signing, relay or reconciliation request [SOURCE CONTRACT].

The graph includes retained policy checks, bound role responses and available action/receipt references. Raw provider bodies and signed bytes are excluded. `OBSERVED` attests retained records only; `executionReady` stays false. Hashes do not prove that a provider's claim is true. Stocks/perps integration, live model-pair acceptance and funded execution remain separate gates [SOURCE CONTRACT].

### Retained NEAR research contract

Public case, source and replay calls are read-only and accept no credentials. The latest-case call can reuse a capture for 24 hours. Saved case IDs bind immutable source references and a deterministic model version. Replay uses those saved inputs rather than a new publisher fetch. Publisher data status OBSERVED is separate from investmentAssessment NO_DATA; neither volume nor fees proves native-token demand or reconciled net capture [VERIFIED, Mesh source and local live HTTP smoke].

Adoption requires an owner session and an explicit request ID. It retains the same snapshot without adding research source heads to the owner's legacy lending graph. Review requires owner authentication, a separately configured operator-principal grant, and verified native model-host controls. It returns a retained job envelope with state PENDING, COMPLETE or UNKNOWN, phase and result. Repeating the same request ID reads that job. Conflicting reuse stops; a lost reply, process failure or UNKNOWN never starts another model run automatically [VERIFIED SOURCE; review runtime checks pending].

[VERIFIED SOURCE, D4] `falcon_activity` delegates to the canonical private Mesh `GET /v1/activity`. It adds bounded retained research without duplicating financial logic. Reading activity cannot create or resume a review. PENDING reports the last recorded phase, not a live process; UNKNOWN remains unconfirmed. No source bodies, signed bytes or hidden reasoning are returned. Existing input schemas and approval rules are unchanged.

[CORRECTION, D4] The earlier public NEAR React workspace and Soon-only dashboard are superseded as human targets. Production human navigation leads to the owner dashboard. Agent/system MCP and HTTP research interfaces remain. The [earlier 0.5.0 browser record](../status.md#source-050-publication-evidence-2026-10-23) remains historical evidence, not the current human surface.

### NEAR CFO request and authorization contract

Every CFO tool requires the short-lived Falcon wallet session. Rust sends it as a Bearer token; the owner and current wallet come from that authenticated session. Tool inputs accept no caller-supplied owner, wallet, model, key, execution grant, URL, or route. `falcon_cfo_mandate` intentionally omits `mandate.wallet`; Mesh binds the current wallet from the session. IDs are caller-supplied UUIDs. All `*BaseUnits` and signed values remain exact integer strings, not JSON numbers. Tool and nested mandate objects reject unknown fields.

| Tool | Fixed Mesh request |
| --- | --- |
| `falcon_cfo_overview` | `GET /v1/cfo` |
| `falcon_cfo_mandate` | `POST /v1/cfo/mandate` with `{requestId, mandate}` |
| `falcon_cfo_capture` | `POST /v1/cfo/capture` with `{requestId}` |
| `falcon_cfo_plan` | `POST /v1/cfo/plans` with `{requestId, action, sourceAssetId, targetAssetId, inputBaseUnits}` |
| `falcon_cfo_prepare` | `POST /v1/cfo/prepare` with `{requestId, planId}` |
| `falcon_cfo_register_signed` | `POST /v1/cfo/signatures` with `{requestId, actionId, signatureBase64}` |
| `falcon_cfo_relay` | `POST /v1/cfo/relay` with `{requestId, actionId}` |
| `falcon_cfo_reconcile` | `POST /v1/cfo/reconcile` with `{requestId, actionId}` |
| `falcon_cfo_monitor` | `POST /v1/cfo/monitor` with `{requestId, enabled}` |
| `falcon_cfo_record` | `GET /v1/cfo/records/:recordId` |

Responses preserve Mesh's service DTOs rather than reconstructing decisions or financial state: overview and POST responses are direct DTOs, while record reads retain Mesh's `{record}` wrapper. Status fields, including future provider statuses, are passed through without remapping.

The registered CFO signature is a financial owner approval for one exact prepared action, not a wallet-login signature; the MCP accepts only the 64-byte standard-base64 signature, never replacement signed bytes or a key. `falcon_cfo_prepare` may return the exact unsigned payload for owner review. Owner signing material (`signatureBase64`, `signedData`), signed payloads, and relay secrets are removed recursively from overview, record, registration, relay, reconciliation, and other non-prepare CFO output. Verified provider quote envelopes preserve `raw.signature` as hash-bound public verification evidence. Registration does not relay. `falcon_cfo_relay` asks Mesh to relay only the already registered exact signed intent. Relay remains default-deny until an operator grant is bound to the exact owner, wallet, actionId, quoteHash, reserve cap, expiry, retained T82 proof, and trial permission. Owner signature remains required even with an operator grant; neither a model review nor a grant is spending approval.

The surface is NEAR mainnet only. `falcon_self_test` reports current CFO context, signer, funding, and transaction readiness as unchecked; it does not claim provider readiness, available funds, execution readiness, or successful receipt reconciliation. Mesh owns all portfolio, policy, quote, signing-validation, grant, and financial logic. Existing Solana Devnet broadcast flow remains human-only and unchanged.

## Decision and execution boundaries

Owner-bound operations need a valid wallet session. Authentication proves ownership only. Supply needs explicit `proposedUsdc`, `maxUsdc`, `minBookLiquidityUsdc`, and `maxEvidenceAgeSeconds`; never infer these limits. A fresh REVIEW decision and current adopted public evidence are prerequisites for supply preparation. Mesh caps supply at 1 Devnet USDC. Redeem uses receipt-token units and forbids a supply decision ID [VERIFIED, Mesh and MCP contracts].

For each legacy Solana transaction, the human reviews the exact unsigned bytes and Falcon preflight, separately approves signing, signs locally, and broadcasts the registered bytes. CFO uses the separately granted exact signed-intent relay described above. Changed message, amount, route, wallet or expiry requires a new review. REVIEW, preflight, login and model text cannot approve spending. Registration proves neither submission nor confirmation [VERIFIED, SPEC V147/I22 and current interfaces].

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
