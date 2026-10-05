# SPEC

## §G GOAL
Build FalconOS as a chat-first, Solana-first USDC yield agent and plug-in: discover provider-indexed opportunities, apply a deterministic user policy, and show replayable simulated fund flows; no live fund movement in MVP.

[VERIFIED, user direction, 2026-09-26] Add accepted Stage 01 treasury MVP through local simulation first. [INFERRED, active slice] Owner mandate → decision graph → checked simulated settlement → browser-local replay. Existing modules retain their current boundaries.

[VERIFIED, user direction, 2026-09-27] Finish graph product, hosting design, and review flow before Devnet execution. [INFERRED, active slice] Versioned synthetic decision records and evidence inspection. Define the later real-fund test after Devnet.

[VERIFIED, user choices, 2026-10-01] One-week internal paper peg pilot plus one separate owner-signed Devnet test swap. [INFERRED] Solana USDC/USDT is a research candidate, not a user-selected pair or proven venue. Stocks and perps follow the pilot. A hedge fund remains a proposed business destination, not current capital authority.
[VERIFIED, user choice, 2026-10-02] Pause prior one-week peg pilot. I17 and T49-T54 describe a retained proposal, not the current build queue. Investment-service options remain research; none replaces the MVP yet.

## §C CONSTRAINTS
- [VERIFIED, user choice, 2026-10-03] Pause peg I17 and T49-T54. This choice supersedes the 2026-10-02 statement that no replacement MVP was authorized.
- [SUPERSEDED, user choice, 2026-10-03] New MVP is a simulation-only Solana USDC yield agent; no wallet action, real funds, or live signing.
- [VERIFIED, user choice, 2026-10-04] MVP keeps deterministic simulation and permits one manual, owner-signed Kamino USDC supply/redemption test path on Solana Devnet, capped at 1 Devnet USDC. Each transaction needs an explicit wallet signature and confirmed receipt reconciliation. No mainnet, real funds, pooled client capital, automatic signing, or live rebalancing.
- [VERIFIED, user choices, 2026-10-01] Internal paper peg loop plus one separately owner-approved Devnet test swap through existing I13 terminal. No outside deposits, fund offering, pooled money, client mandate, borrowed principal, flash loan, mainnet trading, or automatic signing. Council, plugin, mesh peg decision, and treasury simulation keep their current authority.
- [INFERRED, scoped route] Start with one Solana USDC/USDT route, subject to verified token identity and usable live quote plus independent USD reference sources. USDC/EURC remains EUR/USD FX research, never a USD depeg signal. A quoted round trip is not issuer redemption or executed arbitrage.
- [INFERRED, safety] Model protected USDC treasury and separate paper strategy budget. Neither is spendable by the desk. Stablecoin denomination does not guarantee stable value; issuer, redemption, liquidity, and depeg risks remain visible.
- [VERIFIED, user direction, 2026-09-27] Build connected MVP locally before hosting: connectors -> knowledge mesh -> terminal analysis -> Devnet execution and recorded outcome. Personal Railway workspace selected for later hosting. [INFERRED, first foundation] I15 durable mesh; synthetic fixtures prove storage and traversal before live connectors. Existing I14 remains separate.
- [INFERRED, 2026-09-26 addition] `web/treasury/` isolated simulation under I14; no wallet, signing, chain/model/provider requests, real funds, yield claims, or hidden background operation. Public static hosting is a later release action; each browser retains separate history.
- FalconOS role: investment firm intake, research, deterministic policy, advisory result. External agents remain callers.
- The plugin and Rust engine remain read-only. `web/copilot/` has a separate local, dev-only execution demo; the connected wallet signs, and the page sends only to the configured Surfpool fork or Solana Devnet.
- External agent has no model authority. ⊥ caller-selected model, executable, adapter, reasoning setting, tool, policy override.
- `src/codex.ts` remains internal FalconOS→Codex research adapter. ⊥ plugin surface.
- Existing evidence/hash/cutoff validation stays authoritative: `buildAgentRequest`, `validateScan`, `validateAgentThesis`.
- Preserve exact integer amount math, raw evidence, visible failures, `REJECT`/`REVIEW`/`UNAVAILABLE`, `executionReady: false`.
- Root plugin: one local TypeScript package, Node native TypeScript, zero runtime dependencies. Website: isolated `web/` static HTML + Vite build package; web dependencies ⊥ root plugin.
- Plugin reads stdin + configured evidence root. Plugin writes stdout only; ⊥ evidence, vault, notes, ledger, account, transaction, or other persistent writes.
- Plugin performs no quote collection or live network request. Internal research transport remains host-controlled and read-only.
- Caller-provided `agentId` identifies provenance only; it ≠ authentication, trust, capital authority, or approval.
- One request per process. One JSON response line per process. Diagnostics never stdout.
- Request and response exact-key validation: unknown fields → reject.
- First evidence bundle: exactly one scan, at most 8 note paths, max 32 KiB/note, max 8 MiB serialized internal request, max 64 KiB advisory response.
- Amount: decimal USDC string, `0.01` through `500`, ≤6 fractional digits; canonical integer units via existing `inputAmount`.
- Supported route: `solana-base` or `base-solana`; current evidence remains USDC/EURC over Solana/Base.
- T1-T8 plugin slice frozen. Website work remains isolated under `web/` and deploys as a static Cloudflare Pages artifact. Production `/app/` is a browser-only, wallet-owned Solana Devnet terminal; Vite excludes local `web/copilot/`. ⊥ server-side keys, mainnet trading, wallet data collection, or plugin contract expansion.
- Pooled ETF product (FalconOS pools capital + issues ETF via Raydium/Meteora) ⊥ current scope; prerequisite: reverse advisory-only boundary (V11), add custody/execution/issuance, integrate AMM, complete securities/fund-law review before code.
- `engine/` Rust crate is the stocks live dashboard (⊥ root plugin zero-dep graph): read-only live GET/RPC from configured providers, basket snapshot, stocks council, terminal render, and local `127.0.0.1` `/advice` plus `/graph`. ⊥ execution, custody, wallet, signer, order submission. `graph --out` writes one operator-named local JSON file. Secrets via env only, never committed. Deleted `dash/` Node package ⊥ current surface.
- `web/copilot/` is a local DEV-only client action demo. Surfpool uses Jupiter V1 mainnet routes and the user-hosted local RPC at `http://127.0.0.1:18488`. Devnet uses Raydium's Devnet quote/build API and accepts only a single route through the configured CPMM pool. Each route refreshes its selected cluster's blockhash, simulates, and sends only to that cluster after an explicit wallet click. This does not change the engine, plugin, or production boundary.

- [VERIFIED, user direction, 2026-10-03] Solana first. Multi-chain remains the product direction; EVM adapters follow the Solana-first slice.
- [SUPERSEDED, user choice, 2026-10-03] Earlier MVP boundary forbade all wallet signing, including login messages.
- [SUPERSEDED, user choice, 2026-10-03] Bot may request one SIWS-style Phantom message signature for login only. No transaction signature, real balance mutation, deposits, or live rebalancing.
- [VERIFIED, user choice, 2026-10-04] Bot message signing proves wallet ownership for login only; it does not authorize a transaction. The separate Mesh terminal may request explicit wallet transaction signatures only for the manual DevNet test path above.
- [INFERRED, MVP boundary] Chat and external agent clients send typed discover, simulate, or explain intents. Deterministic policy is the only authority for allocation plans. Free text alone cannot mutate state.
- [INFERRED, source integrity] Display provider source, retrieval time, reported APY, and eligibility reasons. No guaranteed-yield or executable-liquidity claim from an APY catalog. Unknown data remains unknown; no synthetic yield values in the dashboard.
- [VERIFIED, user choice, 2026-10-03] Yield concentration groups by provider project/protocol slug, not individual pool ID. `maxVenues` counts distinct project slugs.
- [SUPERSEDED, user direction, 2026-10-03] The bot was first gated by Supabase Auth. The later wallet-signature choice replaces that bot login; Supabase remains the database and legacy session provider. Cloudflare remains user-managed.
- [VERIFIED, user choice, 2026-10-03] Falcon bot uses Phantom signature login. The signature proves wallet ownership only; it does not authorize transactions or fund movement.
## §I INTERFACES

### I1. Inbound command

```text
node src/cli.ts plugin --data ./data
```

- Read exactly one UTF-8 JSON object from stdin until EOF; raw input ≤8 MiB.
- `--data` selects evidence root; default `./data`.
- `--help` describes command; no `--agent`, `--model`, `--executable`, `--reasoning`, `--wallet`, `--signer`, or execution option.
- stdout: exactly one compact JSON response + newline; serialized advisory/error envelope ≤64 KiB.
- stderr: human diagnostics only.
- exit `0`: valid request handled; response may carry `REJECT`, `REVIEW`, or candidate `UNAVAILABLE`
- exit `2`: invalid JSON/request/evidence or host transport/advisory unavailable; JSON error response still emitted
- exit `1`: unexpected host failure; JSON error response emitted when possible

### I2. Inbound `PluginRequest` JSON

```json
{
  "schemaVersion": 1,
  "requestId": "11111111-1111-4111-8111-111111111111",
  "agentId": "external-agent-example",
  "intent": {
    "route": "base-solana",
    "amountUsdc": "10.000000",
    "objective": "Assess whether supplied evidence merits bounded REVIEW."
  },
  "sourceCutoff": "now",
  "evidence": {
    "path": "runs/scan-id.json",
    "sha256": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
  },
  "notes": [
    {"path": "vault/FalconOS/context.md"}
  ]
}
```

Exact keys:

```ts
type PluginRequest = {
  schemaVersion: 1;
  requestId: string; // UUID v4
  agentId: string; // non-empty, ≤256 UTF-8 bytes; provenance only
  intent: {
    route: 'solana-base' | 'base-solana';
    amountUsdc: string; // `inputAmount` grammar/range
    objective: string; // non-empty, ≤16 KiB UTF-8
  };
  sourceCutoff: string | 'now'; // UTC ISO time or `now`
  evidence: {
    path: string; // relative to --data
    sha256: string; // lowercase SHA-256 of exact bytes
  };
  notes: Array<{path: string}>; // 0..8, relative to --data
};
```

### I3. Valid advisory response

```ts
type PluginAdvisory = {
  schemaVersion: 1;
  kind: 'advisory';
  requestId: string;
  agentId: string; // validated caller provenance; never model control
  route: 'solana-base' | 'base-solana';
  status: 'REJECT' | 'REVIEW' | 'UNAVAILABLE';
  fixture: boolean; // required; true marks deterministic synthetic provenance
  thesis: string;
  citations: Array<{
    evidenceId: string;
    path: string;
    sha256: string;
    assessedAt: string;
    supports: string;
  }>;
  invalidationConditions: string[];
  expiresAt: string;
  missingEvidence: string[];
  authority: 'advisory-only';
  executionReady: false;
};
```

- Response fields derive from validated internal `AgentThesis`; validated `agentId` echoes as provenance; no caller text becomes authority.
- `status` cannot override deterministic candidate status.
- `REVIEW` ≠ approval, reservation, fill, profit, or execution.
- `fixture` required; `true` marks deterministic synthetic fixture transport. Do not expose internal Codex execution metadata.

### I4. Invalid/error response

```ts
type PluginError = {
  schemaVersion: 1;
  kind: 'error';
  requestId: string | null;
  code:
    | 'INVALID_JSON'
    | 'INVALID_REQUEST'
    | 'EVIDENCE_INVALID'
    | 'ADVISORY_UNAVAILABLE'
    | 'INTERNAL_ERROR';
  message: string;
  authority: 'advisory-only';
  executionReady: false;
};
```

- Error response exact keys. `message` carries safe diagnostic text; no secrets, wallet data, raw transaction, or model prompt.
- Invalid request never reaches internal transport.

### I5. Internal boundary

- Plugin parses `PluginRequest` → host maps request to existing `AgentRequest`.
- Host calls `buildAgentRequest` with `evidence.path`, caller hash, notes, route, objective, cutoff.
- Host invokes host-selected `AgentTransport`; caller cannot select transport.
- First slice injects deterministic fixture transport only in tests. Standalone plugin has no default transport; missing host transport → `ADVISORY_UNAVAILABLE`.
- Host calls `createAgentRun`/`validateAgentThesis`; plugin maps validated thesis → `PluginAdvisory`.
- `src/codex.ts` remains internal transport implementation. No plugin import or CLI option exposes Codex executable/model/config.

### I6. Verification commands

```sh
npm run typecheck
node --test test/plugin.test.ts test/agent.test.ts
npm test
node src/cli.ts plugin --help
node src/cli.ts plugin --data test/fixtures < test/fixtures/plugin-valid-request.json
```

Smoke command must print one advisory/error JSON line, create no persistent file, and use only fixture evidence. Standalone production path without injected transport emits stable `ADVISORY_UNAVAILABLE`; valid advisory coverage injects fixture transport through `runCli` tests. No market/RPC quote, model, wallet, signer, transaction, or paid call allowed.

### I7. Falcon Investment perps council contracts

- `perps/perps.ts` owns distinct perps-only types/validators; legacy `src/plugin.ts` contract unchanged. [VERIFIED, correction, 2026-10-05] Folder renamed `preps/` → `perps/` on 2026-09-20.
- Host-owned versioned registry accepts one exact native SOL-perpetual contract definition per `phoenix` or `hyperliquid`; exact native IDs/values remain injected inputs, not defaults or aliases. Invalid/missing/conflicting critical metadata → `NO_DATA`.
- `createCanonicalSnapshotBundle` accepts both Phoenix + Hyperliquid registries, both versioned field-precedence policies, both venue capture sets, one capture time/coherence cap, and one provenance; bundle emits immutable combined raw manifest, normalized two-market projection, source decisions, deterministic bytes, and one SHA-256 hash. `createCanonicalSnapshot` remains venue-local assembly only.
- Secondary field source may replace primary only on typed primary `outage` + prevalidated semantic equivalence; disagreement, critical missing/invalid, stale, future, or coherence breach → `NO_DATA`.
- `TradeProposal` is Perps Specialist, non-binding, policy/account-referenced, scenario/invalidations/confidence/horizon/evidence/expiry carrying, and always `executionReady: false`; missing policy/account → all numeric suggestions `null`.
- `RiskReview` independent + `veto-only`; critical block/reviewer failure suppresses publication as `BLOCKED`/`NO_DATA`; Client Agent decision/execution remains external.
- `council.advice` and `council.copilot` exact schemas remain non-interchangeable. Copilot explains existing proposal/snapshot/result only; ⊥ fresh Trade Proposal.
- `HostTransportBoundary` permits injected host transport only; first slice makes no network/model/paid/wallet/signer/order call. Synthetic fixtures only; no live venue claim.
- Council ingress contract: `council.advice` request carries `requestId` + `runId` + one frozen two-venue bundle; host executes distinct Lead Specialist then independent Risk Review calls. Risk Review identity is FalconOS-owned; caller reviewer string cannot authorize or identify review.
- Bundle ingress binds venue map keys, registry/native ID/version, source-policy version, provenance, capture time, coherence cap, projection, bytes, and hashes; mutable, serialized, wrong-key, tampered, or mismatched content → `NO_DATA`.
- Perps module emits in-memory raw manifests/bytes/hashes only; no durable append-only persistence. Durable audit storage remains external host prerequisite.
- Perps ingress preserves a frozen immutable `CouncilAuditRecord` with request/run, full lead proposal/status, full Risk Review/status/reasons, policy/account state, and complete snapshot evidence; durable storage remains an external host boundary.

### I8. Perps verification commands

```sh
npm run typecheck
node --test perps/test/perps.test.ts
node --test test/plugin.test.ts test/agent.test.ts
npm test
```

Focused perps tests use deterministic checked-in synthetic captures and injected transport. Exact official Phoenix/Hyperliquid registry metadata and live adapters remain external prerequisites.
### I9. Local FalconOS council website

- Source root: `web/`; static HTML built by Vite; dependencies and scripts remain inside `web/`.
- Local commands: `npm --prefix web run build`; `npm --prefix web run dev -- --host 127.0.0.1`.
- One responsive dark Liquid Metal landing page from approved Open Design source with FalconOS identity: agent-first hero + interactive Research/Strategy/Risk/Capital tour → system proof → final CTA.
- Hero: `Built for agents. Visible to you.`; audience: Client Agent builders/operators.
- Current capability labels: Stablecoins = working local CLI; Perps = tested local preview; Stocks = in development.
- CTAs: explain system + explore Falcon Skills navigate within page. Waitlist fields preview email + use case + explicit consent; local preview sends/stores nothing and states that no signup occurred.
- Static Cloudflare Pages deployment at `falconos.markets` allowed; ⊥ production email, D1, Resend, analytics, wallet, signer, transaction construction/submission.
- [VERIFIED, correction, 2026-10-05] Bullets above predate the live site. Site is React built by Vite. Production signup persists to Cloudflare D1 (V105, V106); Resend delivery optional. ⊥ wallet, signer, transaction construction/submission still holds for this site.

### I10. Falcon Investment stocks basket council contract

- `stocks/stocks.ts` owns distinct stocks-only types/validators; mirrors perps council shape; perps + legacy plugin contracts unchanged.
- Scope: tokenized equities on Solana. Host-owned registry pins one exact tokenized-equity definition per asset: `assetId` mint, `underlying` symbol, `instrumentType`, price/quantity scales, limits (min liquidity, per-asset max weight bps), fees, capabilities, corporate-action reference, provenance; invalid/missing/conflicting critical metadata → `NO_DATA`.
- One frozen canonical basket snapshot: per-asset `price`/`liquidity` captures carry source identity + adapter/semantic version, provider-event and local-receipt times, sequence/continuity, raw bytes/hashes, and typed failure metadata; per-field source precedence selects primary unless typed primary outage + equivalence-validated secondary + policy-matching identity; disagreement/critical missing/invalid/stale/future → `NO_DATA`; synthetic-only first, ⊥ live venue claim.
- `BasketProposal`: specialist=`stocks`, non-binding, `legs`=`{assetId, underlying, targetWeightBps}[]`; weights integer bps, each ≥ 1, sum = 10000; per-leg evidence bound; invalidations/confidence/horizon/expiry carried; always `executionReady: false`; missing/invalid leg evidence → basket `NO_DATA`.
- `RiskReview` independent + `veto-only`; `PASS`/`BLOCK`/`NO_DATA` over concentration/liquidity/coherence; `BLOCK`/critical/failure → published `BLOCKED`/`NO_DATA` + proposal `null`.
- Ingress `stocks.advice`: request carries `requestId` + `runId` + one frozen basket snapshot; host runs one Lead call then one independent Risk Review; both consume identical bytes/hash; kind names distinct from perps.
- Response returns citations, invalidations, expiry, full basket proposal + risk record; authority=`advisory-only`; `executionReady: false`; Client Agent owns decision/execution.
- ⊥ wallet, signer, transaction, pooled custody, capital, allocation, execution, ETF issuance; exact-key validation rejects them.
### I11. Falcon Investment stocks live dashboard

- `engine/` Rust crate. Root plugin stays zero-dependency and performs no live call. `dash/` Node package is deleted.
- Commands: `npm run dash -- preipo` prints one terminal advisory. `npm run serve` binds `127.0.0.1:8787` and serves GET `/advice` and GET `/graph`. `falcon-engine graph --out PATH` writes one local graph JSON file.
- Read-only adapters: DexScreener HTTP GET, PreStocks HTTP GET, public Solana RPC `getTokenSupply` plus the mint account. Optional Pyth Hermes only when `PYTH_<UNDERLYING>_TOKENIZED_FEED_ID` or `PYTH_<UNDERLYING>_UNDERLYING_FEED_ID` is set. Unconfigured Pyth is not an error. A configured feed that fails → `NO_DATA`.
- Pool price: deepest USDC-quoted Solana pair for the mint when one has parseable liquidity (V67). Else the deepest pair. Then V66 scaled-UI normalize and issuer corroboration. The raw capture records pair and quote-token identity. Every asset also has a hash-bound issuer/Pyth `reference` capture. The engine snapshot is its own `FieldCapture` (`source_id`, `source_version`, `observed_at`, `raw_excerpt`, `value`). It does not emit the TypeScript `stocks/stocks.ts` snapshot.
- Council on that snapshot: missing, invalid, or issuer disagreement → `NO_DATA` and no proposal. Ready prices with liquidity below the floor, or a token-vs-underlying gap above configured `max_dislocation_bps` (500), → `BLOCKED` and no proposal. Otherwise `PUBLISHED`, `executionReady: false`.
- `GET /advice` returns `execution_ready: false` and source citations for published advice; `BLOCKED`/`NO_DATA` return no citations.
- ⊥ headline fetch, order submission, custody, signing, capital movement. Secrets via env only.

### I12. Local execution copilot

- Owner/provider: `web/copilot/`; consumer: the local user and connected browser wallet.
- Scope: DEV-only local demo, excluded from the production Vite build. Surfpool uses Jupiter V1 mainnet quote/build and only `http://127.0.0.1:18488` for blockhash, simulation, send, and status. Devnet uses Raydium's Devnet quote/build API, validates one route through a configured Devnet CPMM pool, and only `https://api.devnet.solana.com` for token account lookup, blockhash, simulation, send, and status.
- Devnet quote input/output mints and amount must match the request. Its sole route must name the configured CPMM pool with matching mint direction. Raydium builds one unsigned transaction from that quote.
- Before signing, the page replaces the transaction blockhash with a current blockhash from the selected cluster and simulates those exact serialized message bytes with signature checks disabled. Missing or malformed simulation data, or `err !== null`, stops before the wallet opens.
- The wallet signs only after the explicit **Sign & send** click. Before send, the page checks that the wallet preserved the simulated message and signed the connected account. Only the signed bytes go to the selected cluster. Confirmation status comes from the same cluster.
- ⊥ public mainnet RPC, mixing route data or transactions across clusters, engine signing, automatic signing, server-side key, or transaction submission from the engine.

### I13. Production Devnet terminal

- Owner/provider: `web/app/`; consumer: signed-in user and connected Solana wallet.
- Scope: static production client. Wallet sign-in proves account ownership with a chain-neutral message; Devnet transactions remain separate explicit wallet approvals. Portfolio and transaction reads use only `https://api.devnet.solana.com`. Account labels, watchlist, and order journal stay in browser storage.
- Trade ticket: BUY or SELL Devnet token using Raydium Devnet quote/build APIs. Accept 1-4 route legs. Each leg must match its ordered input/output mints and a live, allowlisted Raydium Devnet pool state. The complete route must connect requested input to requested output without gaps or repeated pools. Build one unsigned transaction from the validated quote.
- Before signing, refresh blockhash from Devnet and simulate the exact transaction message. Require a present `err: null`. The connected wallet signs only after explicit user action. Verify signed message bytes and connected signer before sending; confirmation reads use Devnet.
- ⊥ production mainnet trades, user-key custody, automatic signing, server-side transaction submission, or treating advisory strategies as trade authorization.

### I14. Treasury simulation

- [INFERRED, 2026-09-27 amendment] [Decision graph contract](docs/decision-graph.md) governs schema 2 records, rule checks, legacy compatibility, and UI evidence links. Schema 1 remains readable. Pin `treasury-rules/1`; no live provider or execution integration.

- [INFERRED, contract] [Treasury contract](docs/treasury-contract.md) fixes version 1 Run, Event, View, Graph, Decision, Entry, and store exports. Coordinator owns interface changes.
- [INFERRED, surface] `web/treasury/` static Vite entry. Pure `domain.mjs`, guarded browser-local `store.mjs`, UI `app.mjs`. `createRun`, `appendEvent`, `replayRun`, `buildGraph`, `decide`, `formatUsdc` exported by domain.
- [INFERRED, data] Six-decimal USDC inputs persist in the command journal; replay returns integer-unit strings; BigInt arithmetic. Initial balances split reserve, undelegated cash, delegated idle, and position. Zero simulated fees/interest.
- [INFERRED, authority] Owner creates fixed mandate and investment budget. Agent cycle may supply, hold, or redeem only delegated balances. Owner may permanently revoke or request explicit redemption. Real account authority is outside this simulation.
- [INFERRED, persistence] One versioned `localStorage` record under Web Lock `falcon.treasury.simulation.v1`. Reload, validate, replay, revision-check, apply, persist, then render success. No silent reset or truncation.
- [INFERRED, verification] `node --test web/test/treasury-*.test.mjs`; `npm --prefix web test`; Vite build; browser setup → supply → blocked exit → owner redemption → reload/export. Negative checks must demonstrate graph/authority guards reject unsafe actions.
- [VERIFIED, scope separation, 2026-10-03] I14 remains the schema-2 single-position local simulator and replay path. I18 defines the new multi-venue agentic simulation; prior I14 records remain readable.

### I15. Persistent knowledge mesh

- [INFERRED, contract] [Knowledge mesh](docs/knowledge-mesh.md) owns source revision, graph, analysis, HTTP and store schemas. Isolated `mesh/` Node service plus Postgres; new viewer under `web/mesh/`. Current foundation is synthetic and deterministic. Live connector and terminal integration follow before MVP completion.
- [INFERRED, verification] `npm --prefix mesh test`; real disposable Postgres integration tests; authenticated HTTP checks; standalone viewer build and browser checks. No hosted schema change or deployment in this local build.
- [VERIFIED, user-confirmed, 2026-09-30] `POST /v1/decisions/reserve` accepts an owner-entered proposed position and mandate. Server binds a read-only policy decision to the current validated Devnet reserve graph and saves it under the authenticated owner. `GET /v1/decisions` and `GET /v1/decisions/:id` expose only that owner's immutable decisions. No new schema, wallet holding claim, or trade authority.

### I16. React Control Centre

- [INFERRED, contract] [Control Centre](docs/control-centre.md) defines `/dashboard/`, four hash views, retained samples, isolated browser persistence, canonical treasury rules and explicit links to live tools. Original OpenDesign files and existing application routes remain available.
- [VERIFIED, user-confirmed, 2026-09-30] Add `/dashboard/#operate` as a fifth React view. Keep four OpenDesign views and their synthetic treasury graph unchanged. Operate reads live mesh evidence and saved decisions, accepts explicit owner-entered scenario fields, and shows one provenance-labelled evidence-to-check-to-decision graph. Token stays in memory; wallet signing remains in the separate terminal.
- [INFERRED, verification] Focused fixture/storage tests, complete web suite, Vite site build, source/React browser comparison, saved workflow and failure checks. No hosted schema, wallet transaction or deployment in this design port.
- [VERIFIED, user direction, 2026-10-03] Add /dashboard/#agent as the primary view. Chat occupies the main workspace; a compact rail shows the simulated portfolio, policy, provider status, and pending flow. Preserve existing evidence/detail views.

### I17. Internal peg strategy pilot

- [VERIFIED, user choices, 2026-10-01] Internal operator-only paper capture and one separate owner-signed Devnet mechanics proof. Existing USDC/EURC scanner remains FX research.
- [INFERRED, candidate route] Solana USDC/USDT for paper research only, pending source, mint, and venue verification. This pair and chain were not selected by the user.
- [INFERRED, execution owner] Existing web/app/ Devnet terminal builds, simulates, and requests explicit wallet approval for one test swap. It cannot accept peg REVIEW as signing authority.
- [INFERRED, input] Owner-entered paper notional and protected USDC reserve; bounded live quote for USDC → USDT and exact first-leg output → USDC; independent timestamped USD reference for peg status; venue fees, network/priority costs, route impact, and restoration or redemption cost when applicable. Unknown costs stay unknown, never zero by default.
- [INFERRED, output] Retained source IDs, raw response bytes/hashes, chain and mint IDs, quote times, integer-unit amounts, cost breakdown, reference and route type, protected reserve, paper balance transitions, invalidations, and NO_DATA/BLOCKED/REVIEW. REVIEW is a paper estimate only; executionReady: false always. Existing gated React review path renders server-derived decisions, not client price math. Historical replay bears historical labels.
- [INFERRED, scope] Peg assessment stays read-only and never authorizes a trade. The required single owner-signed Devnet test swap uses the existing web/app/ terminal only after separate exact approval; it cannot claim peg profit, spend the protected treasury, or handle client funds. No flash loan, lending borrow, redemption API, mint/burn, bridge, mainnet trade, or fund accounting. Later atomic loan proof needs its own loss model and release decision. Later fund needs jurisdiction, entity, custody, and legal review.

### I18. Solana yield agent simulation

- [VERIFIED, user direction, 2026-10-03] Lulo-like USDC yield manager with one Customer Agent, Solana-first discovery, deterministic allocation, and visible simulated fund flows. Lulo is a product reference, not an MVP dependency.
- [VERIFIED, direct GET, 2026-10-03] GET https://yields.llama.fi/pools and GET https://api.llama.fi/protocols each returned HTTP 200. Snapshot output: 16,978 yield rows, 31 Solana protocols with category Lending, 48 Solana Lending rows matching native-USDC mint and valid APY/TVL, 42 with stablecoin=true, exposure=single, ilRisk=no, and outlier=false. This is a DeFiLlama-indexed snapshot, not all Solana venues or executable capacity. Per-pool source measurement time was not present in returned fields; retrievedAt is not providerAsOf.
- [INFERRED, provider boundary] Mesh fetches these read-only endpoints only on user request. Normalize provider, project, pool ID, Solana chain, native USDC mint, base APY, reward APY, TVL, exposure, IL/outlier flags, retrievedAt, and optional providerAsOf. Missing or invalid fields make an item ineligible or REVIEW.
- [INFERRED, API] GET /v1/yield/opportunities returns the normalized catalog and coverage summary. POST /v1/yield/simulations accepts requestId, user-entered simulated portfolio, reserve, maxVenueConcentrationBps, and a typed action. It returns PlanReceipt with status, candidate IDs, before/after positions, simulated flows, source evidence, reasons, and executionReady=false. The React dashboard and external agent clients use this same service.
- [INFERRED, allocator] Rank eligible Solana USDC lending pools by baseApyBps descending, then TVL descending, then poolId ascending. Select the highest-ranked pool per project slug; `maxVenues` counts distinct project slugs, and each project's target is capped by floor(budget * maxVenueConcentrationBps / 10000). Use exact integer USDC units. Never treat TVL as withdrawable liquidity. Unknown route costs stay unknown; simulation does not claim net yield.
- [INFERRED, chat] MVP chat maps supported user messages to typed discover, simulate, and explain intents. Responses come from the deterministic engine and include source evidence. No external model provider is configured or called in this slice. External model agents may call the same typed API.
- [INFERRED, UI] Show a compact portfolio rail and a source-to-destination Cash Trace. Each step names source, destination, chain, asset, amount, observed rate, retrievedAt, unknown costs, and policy status. Distinguish simulated balances from real wallet balances.
- [INFERRED, persistence] Store simulation snapshots and receipts locally with versioned replay. Provider reads happen only on user request; no background polling.
### I19. Falcon agent page (`agents.falconos.markets`)

- [VERIFIED, user direction, 2026-10-03] Separate landing page and app at `bot.falconos.markets`; existing FalconOS site and `/dashboard/` remain separate.
- [SUPERSEDED, user choice, 2026-10-03] Earlier bot Supabase login requirement was replaced by Phantom signature login; the bot no longer uses magic links.
- [VERIFIED, user choice, 2026-10-04] The bot subdomain serves the bot at `/` and the graph/DevNet terminal at same-origin `/mesh/`; the existing `falconos.markets` site and `/dashboard/` remain separate.
- [VERIFIED, user choice, 2026-10-05] Agent page domain = `agents.falconos.markets` (Cloudflare Pages project `falcon-agents`); supersedes `bot.falconos.markets` above. Mesh allows origin `https://agents.falconos.markets`.
- [SUPERSEDED, user choice, 2026-10-03] Bot users sign a non-transaction Phantom Wallet Standard message. Mesh verifies the proof and derives owner from the wallet address. No balance reads or transaction signing.
- [VERIFIED, user choice, 2026-10-04] Bot message signing proves wallet ownership for login only. The same-origin Mesh terminal may read DevNet account data and request a separate explicit transaction signature only for the manual DevNet test path above.
- [VERIFIED, user direction, 2026-10-03] Falcon greets users with an investment-planning prompt and accepts requests through a chat composer.
- [INFERRED, MVP contract] Reuse I18 typed discover, simulate, and explain actions; unsupported or ambiguous text cannot change state. No model provider or free-form investment authority added.
- [INFERRED, auth contract] POST /v1/auth/wallet/challenge stores a one-time challenge in falcon_mesh.wallet_auth_sessions, bound to candidate address and configured origin. POST /v1/auth/wallet/verify consumes it after Ed25519 verification, stores only a hashed opaque session token, and returns the verified wallet owner. Yield routes accept this wallet session or legacy Supabase tokens; no caller-supplied owner.
- [VERIFIED, official Supabase docs](https://supabase.com/docs/reference/javascript/auth-getclaims) state getClaims() verifies JWT through JWKS; symmetric signing keys or missing WebCrypto use Auth-server verification. Current project signing-key mode remains unverified.
- [VERIFIED, source: mesh/auth.mjs] Mesh caches verified subject by token hash until JWT exp; uncached checks default to 30 per 300 seconds per process; Auth 429 maps to RATE_LIMITED.
- [SUPERSEDED, user choice, 2026-10-03] Simulation records remain browser-local and user-scoped by wallet owner; wallet message signatures authorize identity only. No live funds or transaction actions.
- [VERIFIED, user choice, 2026-10-04] Bot chat simulation records remain browser-local and owner-scoped. The same-origin Mesh terminal uses the wallet session for owner-scoped evidence and permits only the manual DevNet test path above; it does not authorize real funds or automatic execution.
- [VERIFIED, operational boundary] Code and local verification only; domain binding, Cloudflare configuration, and deployment remain user-managed.
## §V INVARIANTS

V1: ∀ plugin process → read exactly one bounded (≤8 MiB) JSON object from stdin, emit exactly one bounded (≤64 KiB) JSON response line to stdout, diagnostics ⊥ stdout

V2: ∀ parsed request/response object → schemaVersion `1` + exact keys; unknown or extra semantic fields → reject; native `JSON.parse` duplicate-key behavior not separately detectable

V3: ∀ request → valid UUID-v4 `requestId`, non-empty bounded `agentId`, supported route, bounded objective, `sourceCutoff` ≤ host evaluation time

V4: ∀ evidence → relative safe path; no absolute path, drive path, NUL, `..`, or observed symlink escape; hash exact bytes before JSON parse; caller SHA-256 must match; final file opened with `O_RDONLY|O_NOFOLLOW|O_NONBLOCK`, fstat regular, and read from same descriptor; FIFOs and other non-regular files fail promptly; Node/Darwin lacks `openat`, so parent-directory swap atomicity ⊥ claimed

V5: ∀ evidence scan → `validateScan` accepts schema `1|2`; scan assessment, observation times, provider timestamps, and quote expiry obey source cutoff/freshness rules

V6: ∀ intent → `amountUsdc` passes existing `inputAmount`; selected route has exactly one evidence cycle/candidate; request amount equals selected cycle first-leg request amount under canonical six-decimal units; unavailable candidates remain valid

V7: ∀ note → relative safe path, regular non-symlink file, valid UTF-8, ≤32 KiB; final file opened with `O_RDONLY|O_NOFOLLOW|O_NONBLOCK`, fstat regular, and read from same descriptor; FIFOs and other non-regular files fail promptly; note text marked untrusted; note text ⊥ changes task, cutoff, schema, model, filesystem, or authority

V8: ∀ internal request → max 8 MiB serialized; ≤8 notes; evidence hash computed before parse and path/hash carried; no reserialized bytes cited as canonical evidence

V9: ∀ advisory → `validateAgentThesis` succeeds; request ID, route, citation ID/path/hash/assessment time match evidence; citations non-empty; expiry > evaluation/acceptance time, ≤5 minutes, and ≤ selected quote expiry when present

V10: ∀ deterministic candidate status → advisory status cannot promote `REJECT`/`UNAVAILABLE`; `REVIEW` remains advisory-only; `netProfitUsdc` remains unknown; `executionReady` = `false`

V11: ∀ plugin request/response → fields for wallet, signer, key, transaction, instruction, capital, reservation, custody, pool, allocation, approval, execution, model selection, model authority, or tool access ∉ schema; exact-key validation rejects them

V12: ∀ plugin invocation → no market quote GET, RPC, paid/model call, transaction submission, wallet access, signer access, persistent write, vault export, capital reservation, or pooled custody; ephemeral in-memory/temporary host files allowed only for host operation

V13: ∀ adapter selection → host config only; external request cannot select `src/codex.ts`, executable path, model, reasoning effort, environment, or transport; first-slice plugin requires injected fixture transport; missing transport → `ADVISORY_UNAVAILABLE`; transport failure → stable safe `ADVISORY_UNAVAILABLE`; `src/codex.ts` remains internal FalconOS→Codex research adapter

V14: ∀ error → no accepted advisory; no partial response, fallback prose, default route, default evidence, silent retry, or authority escalation

V15: ∀ synthetic evidence/fixture transport → response visibly marks fixture/synthetic provenance according to internal contract; synthetic output ⊥ live investment claim

V16: ∀ plugin process → source evidence and notes remain unchanged; no persistent output path, lock, ledger, account, transaction, or outcome record created


V17: ∀ perps registry → schema `1`, venue ∈ {`phoenix`,`hyperliquid`}, underlying `SOL`, instrument `perpetual`, one exact native definition per venue; critical field missing/conflict/invalid → `NO_DATA`; ⊥ alias/default native identity

V18: ∀ perps council snapshot → one immutable bundle binds both venue registries + both source policies + both dynamic capture sets + provenance; exact raw bytes retained in manifest, one normalized two-market projection retained; bundle bytes immutable/content-addressed; `hash = SHA-256(bytes)`; `frozen = true`

V19: ∀ dynamic field → fixed versioned primary + optional secondary recorded; secondary replacement iff primary status typed `outage` & prevalidated semantic equivalence; disagreement or semantic mismatch → critical `NO_DATA`; selected source + policy version recorded

V20: ∀ canonical snapshot → selected field timestamps ≤ capture time, each age ≤ field TTL, timestamp spread ≤ hard coherence cap; failure → `NO_DATA`; both advisors receive same bytes/hash

V21: ∀ Trade Proposal → specialist=`perps`, authority=`non-binding-advisory`, evidence hash matches snapshot, expiry > capture, executionReady=`false`; policy/account absence → suggested size/leverage/risk bounds/confidence numeric fields `null`

V22: ∀ reviewer publication → reviewer authority=`veto-only`; `BLOCK`/critical failure → published status `BLOCKED`/`NO_DATA` + proposal `null`; reviewer never controls Client Agent

V23: ∀ council operation → `council.advice` ≠ `council.copilot` exact keys; copilot authority=`explanation-only`, `canCreateTradeProposal=false`, executionReady=`false`; copilot ⊥ fresh guidance

V24: ∀ perps transport → host-controlled injected boundary; caller cannot select provider/model/tool/transport; first slice ⊥ network/model/paid/wallet/signer/order calls; synthetic/historical provenance never live claim
V25: ∀ normal council advice run → exactly one Lead Specialist call & exactly one independent Risk Review call; both receive identical requestId, runId, bundle bytes/hash, policy, account; missing/duplicate/malformed/failure/mismatch → `NO_DATA`; Risk Review identity host-owned, authority=`veto-only`; Client Agent owns decision/execution

V26: ∀ two-venue bundle → selected capture timestamps across Phoenix + Hyperliquid spread ≤ one hard coherence cap; local venue readiness cannot bypass cross-venue stale/incoherent data; violation → bundle `NO_DATA`

V27: ∀ canonical bundle ingress → exact venue map keys + nested registry venue/native ID/version + source-policy venue/version + market/bundle provenance/capturedAt/coherenceCap bindings; raw/normalized/source-decision/missing/conflict projections match markets; deep Object.freeze at every node; mutable, serialized, wrong-key, tampered, or projection/hash mismatch → reject

V28: ∀ published advice/copilot operation → requestId/runId, bundle bytes/hash, proposal venue/native ID/evidence, Risk Review request/run/snapshot/lead-proposal binding, and Copilot subject evidence all match expected request; mismatch → `NO_DATA`; reviewer cannot execute

V29: ∀ capture → source ID + adapter version + semantic version match configured source identity; duplicate source-role/ID → `NO_DATA`; secondary selection iff typed primary outage + policy-matching identity + equivalence validation; source mismatch/disagreement → fail closed

V30: ∀ fundingRate → signed decimal preserved; ∀ raw manifest entry → raw bytes/hash + adapter/semantic/equivalence evidence retained; perps module ⊥ durable append-only persistence, emits in-memory evidence only
V31: ∀ RiskReview → status `NO_DATA`/failure yields council advice `NO_DATA`; only explicit `BLOCK` or veto yields `BLOCKED`; veto flag cannot upgrade `NO_DATA`

V32: ∀ canonical raw manifest entry → base64 decode is canonical and SHA-256 equals retained raw bytes; deterministic reconstruction binds raw, normalized, selected source/value/time/role, missing, and conflicts; altered retained evidence or recomputed outer hashes → reject

V33: ∀ source policy → each `freshnessTtlMs` ≤ bundle coherence cap; ∀ selected capture → age ≤ coherence cap in addition to TTL; sequence continuity gap → field `NO_DATA`

V34: ∀ Trade Proposal publication → policy/account full state, native venue identity, snapshot evidence components, provenance, request/run, and snapshot state match; synthetic snapshot ⊥ live proposal

V35: ∀ malformed direct council advice/copilot request → validate before host transport and return safe immutable `NO_DATA`; when no complete valid snapshot can be validated, `snapshotEvidence=null` rather than fabricated evidence; returned fallback passes its response validator; missing request IDs/snapshot never trigger fallback dereference

V36: ∀ Copilot request/response → full raw/normalized/source-decision/selected evidence, capturedAt, venue/native IDs, and proposal/result identity match the retained snapshot; same snapshot hash with altered component → reject

V37: ∀ council advice response → immutable `CouncilAuditRecord` preserves complete lead/risk records and policy/account/evidence bindings; durable append-only persistence remains external
V38: ∀ TradeProposal → nullable liquidationDistance, marginAtRisk, confidence, horizon, scenarios, hashes, expiry, status/stance, invalidations (array of non-empty strings), provenance (`live|synthetic|historical`), and full policy/account binding are primitive-validated; expiresAt is a valid ISO timestamp; dependent numeric fields are null unless both policy + account exist; malformed proposal → reject

V39: ∀ council lead audit → explicit status/outcome/proposal relation; direct publish null proposal defaults to `NOT_CALLED`/`FAILED`; direct null proposal with risk `PASS` yields `NO_DATA` and with risk `BLOCK` yields `BLOCKED`; a called lead with no proposal must use `NO_DATA`; valid lead proposal survives risk transport/validation failure; policy/account/evidence remain bound

V40: ∀ risk review → policyVersion is null iff policy absent, otherwise equals bound policy; critical=true implies veto/blocking and cannot pass; risk records require status-matching reviewId/critical/veto/reasons/snapshot/lead hash, failure records use null failure fields

V41: ∀ council advice response → snapshot evidence bytes reconstruct the full canonical bundle including nested market bytes/hash/frozen markers; response status/proposal must match parsed bundle envelope and selected market readiness; published proposal uses full validateProposalBinding

V42: ∀ advice response risk review → snapshotHash equals parsed bundle hash and leadProposalHash equals audited lead proposal hash; response/audit/evidence are deeply frozen; forged alternate hashes or mutable records → reject

V43: ∀ registry source policy → precedence primary source IDs equal registry market-data declarations; raw bytes verify retention/hash only, while provider-specific normalized semantics remain host-owned adapter attestation and live adapters remain external
V44: ∀ advice response → risk status `BLOCK` (the blocking veto state) requires top-level status `BLOCKED`; risk `NO_DATA` remains `NO_DATA`, and valid lead `NO_DATA` + risk `PASS` remains allowed; forged `NO_DATA` + `BLOCK` → reject
V45: ∀ council advice response → audit requestId/runId equal top-level response requestId/runId; failure-bearing risk responses cannot carry audit records from another run
V46: ∀ bound TradeProposal → proposal status=`NO_DATA` iff bundle or selected market envelope is `NO_DATA`; proposal status=`PROPOSED` iff bundle and selected market envelopes=`READY`; mismatch → reject
V47: ∀ website dependency/build artifact → contained under `web/`; root plugin dependency graph/commands/contracts unchanged

V48: ∀ website capability claim → matches verified state: Stablecoins working local CLI; Perps tested local preview; Stocks in development; concept/later work visibly labeled; ⊥ live/production/autonomous-execution claim

V49: ∀ local waitlist interaction → no network request, storage, or success claim; UI states local preview and no signup occurred

V50: ∀ website viewport/interaction → usable at 320px and desktop widths; semantic landmarks, keyboard-visible focus, labeled controls, reduced-motion support, and no horizontal overflow

V51: ∀ website authority copy/decision trace → FalconOS advisory only; Client Agent owns final decision/execution; human approval required before any later Solana transaction
V52: [superseded by V54 on 2026-09-14] prior Alpine treatment required approved snow-mountain photography; user replaced that direction with full light fintech treatment

V53: ∀ website risk-review outcome copy → only `PASS`, `BLOCK`, or `NO_DATA` semantics; ⊥ `REVIEW`/request-review outcome

V54: [superseded by V55 on 2026-09-16] prior professional light-fintech system required white/neutral surfaces + blue/lime accents + Lausanne typography

V55: ∀ local website visual system → approved dark Liquid Metal treatment + embedded Geist typography + responsive navigation + keyboard-accessible interactive demos + reduced-motion fallback; FalconOS identity only; broken routes ⊥

V56: ∀ stocks basket proposal → specialist=`stocks`, authority=`non-binding-advisory`, executionReady=`false`; leg targetWeightBps integer ≥ 1, sum = 10000; missing/invalid leg evidence → basket `NO_DATA`; wallet/custody/pool/allocation/execution field ∉ schema

V57: ∀ `stocks/stocks.ts` canonical basket snapshot → per-asset evidence bytes/hash frozen; Lead & Risk consume identical bytes/hash; provenance ∈ {`synthetic`,`historical`,`live`}; `live` only from a read-only host outside the root plugin; current live host is `engine/`, which keeps its own snapshot (`observed_at` only, no TS provenance enum) and does not emit the TS snapshot; root plugin emits no live call; missing/invalid/stale/incoherent → `NO_DATA`

V58: ∀ stocks advice run → exactly one Lead call + one independent Risk Review; Risk authority=`veto-only`; `BLOCK`/critical/failure → published `BLOCKED`/`NO_DATA` + proposal `null`; Client Agent owns decision/execution

V59: ∀ stocks advisory response → citations + invalidations + expiry + full basket proposal + risk record; executionReady=`false`; ⊥ pooled custody, capital pooling, ETF issuance, order submission

V60: ∀ stocks capture selection → per-field source precedence selects primary; secondary replaces primary only on typed primary outage + prevalidated semantic equivalence + policy-matching source identity; duplicate source-role/ID, primary/secondary disagreement, or critical missing/invalid → `NO_DATA`

V61: ∀ stocks capture time → provider-event time ≤ local-receipt capture time ≤ basket capture time; selected capture spread ≤ coherence cap; violation → `NO_DATA`

V62: ∀ stocks non-ok capture → carries typed failure metadata (`retryable`, `retryAfterMs` nullable, `reason`); host preserves it; a failing capture never yields a normalized value

V63: ∀ stocks registry → exact-key validated identity + scales + limits + fees + capabilities + corporate-action reference + provenance; per-leg `targetWeightBps` ≤ registry per-asset max-weight cap; invalid/missing critical metadata → `NO_DATA`

V64: ∀ engine live fetch → read-only HTTP GET or public RPC read; ⊥ write/execution/custody/signing/order; secrets from env only, never committed; provider/network/parse failure → typed capture failure → snapshot `NO_DATA`

V65: ∀ engine rendered output → advisory-only, `executionReady: false`; shows basket evidence, risk verdict, and citations when published; a non-published verdict shows the failure reason and no citations; ⊥ trade/order action or capital instruction

V66: ∀ engine PreStocks/token-2022 scaled-UI mint price evidence in `engine/src/prestocks.rs` → derive live multiplier from extension time-gate (`newMultiplier` when `now ≥ newMultiplierEffectiveTimestamp`, else current `multiplier`); cross-check extension vs `getTokenSupply` uiAmount/raw within 5bps; divide raw pool price by multiplier; corroborate normalized price vs issuer `tokenPrice` within 500bps; zero/malformed/missing multiplier, extension/supply disagreement, or issuer disagreement → typed price capture failure → `NO_DATA`

V67: ∀ engine DexScreener mint price → if ∃ Solana pair with base = mint, quote = USDC mint `EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v`, and parseable liquidity → select the deepest such pair; else select the deepest pair; ⊥ select a deeper non-USDC pair while a liquid USDC pair exists; the selected pair still passes V66 before a price value is admitted

V68: ∀ engine pool ranking → compare parseable decimal liquidity exactly without truncation or fixed-width overflow; selected pair evidence records pair address and quote token address/symbol

V69: ∀ engine per-asset reference → `reference` `FieldCapture` is part of the canonical snapshot and hash; capture source, observed time, raw feed ID/spot/publish time, and value bind to the council reference; missing, malformed, zero, mismatched, or configured-but-failed reference → snapshot `NO_DATA`

V70: ∀ engine `/advice` → `execution_ready: false`; `citations` bind each published `price`, `liquidity`, and `reference` capture to source ID/version, observed time, value, and raw-excerpt hash; unpublished verdict → empty citations

V71: ∀ local copilot transaction → target exactly selected Surfpool `http://127.0.0.1:18488` or Solana Devnet `https://api.devnet.solana.com`; Surfpool uses Jupiter mainnet route/build, Devnet uses Raydium Devnet quote/build API; Devnet quote and route must match configured pool, mints, and amount; RPC/status use selected target; refresh blockhash, simulate same message, require present `err: null` before wallet signing; after explicit signing, message bytes and connected signer must match before send; copilot absent from production build

V72: ∀ PreStocks API rows for a configured mint → duplicate rows agree on symbol, mark, and token price; the accepted symbol equals the configured underlying; conflict or mismatch → failed reference capture and snapshot `NO_DATA`

V73: ∀ engine fixed-point gap calculation → multiply by 10,000 with checked arithmetic; overflow → typed failure or `NO_DATA`, never panic or wrap

V74: ∀ Solana `getTokenSupply.decimals` → validate its integer range before narrowing; an out-of-range value → failed capture and snapshot `NO_DATA`

V75: ∀ Devnet copilot swap → configured pool exists on Devnet and is Raydium CPMM; Raydium quote route has exactly one leg through that pool; quote input/output mints, direction, and amount match the request; transaction build returns exactly one unsigned transaction from that quote; mismatch, missing route, or multiple transactions → stop before wallet signing

V76: ∀ production `/app/` Devnet swap → route has 1-4 legs; every ordered Raydium leg matches adjacent mints and its live pool account owner, state layout, and mint pair; route starts/ends at requested mints, contains no repeated pool, and quote amount matches request; build exactly one unsigned transaction from that quote; any mismatch → stop before wallet signing
V77: [INFERRED] ∀ treasury record/view/outcome → explicit `mode: simulation`; synthetic observations; zero simulated interest/fees; no wallet/provider/model/chain call or real capital claim. Existing V11,V51,V64,V65 advisory boundaries remain unchanged outside I14.
V78: [INFERRED] ∀ treasury money → exact decimal ingress ≤6 fractional digits, integer units ≤u64; `reserve + investmentCap ≤ total`; conservation holds across every event; agent cannot debit reserve or undelegated cash.
V79: [INFERRED] ∀ treasury agent decision → `decide(graph)` reads only validated typed graph nodes and required edges; missing dependency → blocked action; pre-action graph, decision, and outcome reproducible from journal.
V80: [INFERRED] ∀ treasury supply → fresh available evidence, permitted mandate, liquid venue, positive delegated idle, position after action ≤cap; revoked mandate blocks every agent movement; owner redemption is explicit separate command.
V81: [INFERRED] ∀ missing/unavailable/future/stale observation → `NO_DATA`; insufficient full-redemption liquidity → `BLOCKED`, prior position preserved; successful redemption credits delegated idle only.
V82: [INFERRED] ∀ treasury mutation → exclusive Web Lock, fresh validated replay, expected revision match, one successful storage write before success; corrupt/unavailable/full storage or unsupported locks → visible error, no false success or replacement.
V83: [INFERRED] ∀ treasury event → exact schema, UUID, monotonic UTC time, at most 200 retained events; duplicate identical ID is idempotent; conflicting ID reuse rejected; reload reproduces state/decisions; no silent journal truncation.
V84: [INFERRED] ∀ treasury UI → clear simulation labels, visible evidence age/errors/outcomes, keyboard controls and responsive layout; agent loop starts only on user action, stops on error/revocation/page close, stays stopped after reload; export contains validated replayable history.
V85: [INFERRED] ∀ treasury setup submission → capture form values before disabling inputs; a valid visible mandate creates the same persisted mandate; rejected submission preserves the form for correction.
V86: [INFERRED] ∀ treasury graph → node details and required relationships are available to assistive technology at desktop and mobile widths; graphical arrows alone do not carry relationship meaning.
V87: [INFERRED] ∀ schema 2 run → supported pinned policy, complete saved records, and replay agreement; unknown policy or altered snapshot → visible rejection without storage replacement. Schema 1 upgrade preserves commands and labels reconstruction.
V88: [INFERRED] ∀ decision check → actual evaluation order, explicit pass/block/no-data/skip, valid evidence IDs; selecting check opens matching input graph; skipped check cannot claim approval.
V89: [INFERRED] ∀ historical graph inspection → original decision time, evidence age, policy, and outcome; current state distinct; evidence highlighting available through text and keyboard.
V90: [INFERRED] ∀ treasury export confirmation → describe the exported schema; legacy command-only export cannot claim saved policy or input snapshots.
V91: [INFERRED] ∀ mesh source → retain exact content bytes, SHA-256, source identity, observation/capture times, immutable revision; source batch and compare-and-swap heads commit atomically; identical retry never restores old head.
V92: [INFERRED] ∀ mesh read/write/traversal → owner derived from verified server credential before access; request owner override forbidden; hidden owner cannot leak through source, node, edge, history, or error.
V93: [INFERRED] ∀ mesh analysis → typed relationship traversal before calculation; recorded ordered paths and supporting revisions; missing/conflicting/stale/future/unavailable evidence or reached traversal bound → NO_DATA; combined position exit uses exact integer sums.
V94: [INFERRED] ∀ saved mesh analysis → one consistent current-head snapshot plus exact graph, policy and result; immutable across later source changes; repeated request returns original result, conflicting reuse rejected.
V95: [INFERRED] ∀ mesh HTTP mutation → validated bounded body, authenticated owner, commit before success; failures visible; secrets and SQL details absent from errors/logs; no automatic schema change at startup.
V96: [INFERRED] ∀ mesh viewer → server-derived analysis, source and path inspection, historical cutoff, explicit coverage and fixture labels; keyboard/mobile controls; a manually entered operator token is retained only in memory; the same-origin bot wallet session may be read from the tab-scoped sessionStorage key in V144, never copied into a URL or localStorage; failed fetch cannot show a previous result as current; responses from an earlier credential generation cannot enter the current session.
V97: [INFERRED] ∀ mesh MVP completion claim → distinguish fixture foundation, live connectors, terminal integration, Devnet lending proof, and hosting; existing Raydium swap does not prove treasury lending supply/redemption.
V98: [INFERRED] ∀ source label or URL → well-formed Unicode without control characters before persistence; accepted source text must round-trip through Postgres text and JSONB snapshots.
V99: [INFERRED] ∀ live capture → server-owned fixed connector, retained complete response bytes and verified hashes, explicit network/genesis/slot; caller-authored live evidence and synthetic replacement of live heads rejected; failed current capture cannot reuse old success.
V100: [VERIFIED, user-confirmed, 2026-09-30] ∀ `mesh-public-evidence/1` live analysis → validated live partition, linked official document + Devnet program account, fresh complete paths; optional reserve source leaves 2-source result unchanged; synthetic/live mixing ⊥; `OBSERVED` ≠ lending approval; idempotency includes mode.
V101: [INFERRED] ∀ Devnet lending intent → current live analysis plus coherent verified-network account capture and exact-message simulation; first submission rechecks original analysis freshness and source heads under the owner lock; fixed reserve/mints/ABI, sole wallet signer, no extra instructions or lookup tables; estimates distinguish maximum supply input from observed transfer and provide no claimed minimum-output guarantee; prepared facts identify their retained analysis.
V102: [INFERRED] ∀ lending submission → valid wallet signature over exact retained intent before durable registration; register signature and signed bytes before broadcast; one owner cannot register one signature under two intents; explicit retries broadcast only identical validated bytes while the blockhash remains valid; uncertain sends remain pending, or unverified when expired and absent; confirmed receipt requires exact transaction and reconciled transaction-local token deltas; events and owner scope survive reload.
V103: [INFERRED] ∀ browser wallet → Wallet Standard capability discovery, explicit selected account on Devnet, account/capability change invalidates pending signing; token/key storage absent; unsupported signing capability shown without silent broadcast fallback.
V104: [INFERRED] ∀ React landing port → preserve the active OpenDesign falconos-landing.html design, assets, synthetic scenarios, graph inspection, export and reduced motion; existing preview routes remain available; product readiness claims reflect measured progress.
V105: [INFERRED] ∀ landing email submission → bounded validated request, durable address capture before success, visible backend errors, input retained for retry; email delivery claims require provider evidence and must distinguish registration from sending; development servers cannot serve local databases, salts or operator tokens.
V106: [INFERRED] ∀ confirmation email → validated sender address, durable outbox enqueued atomically with registration, one stable provider idempotency key, bounded fixed-provider request, retained acceptance ID before accepted claim; retry ambiguity outside provider idempotency window requires review; missing delivery configuration never becomes a sent claim.
V107: [VERIFIED, user-confirmed, 2026-09-30] ∀ dashboard view → preserve four original OpenDesign hashes, layout, assets, keyboard/mobile controls, reduced motion and four font faces; additive `#operate` renders live evidence-to-decision trace without relabelling synthetic Decisions or disclosing token; source originals unchanged.
V108: [INFERRED] ∀ dashboard persistence → fixed preview namespace for both storage and locks; treasury default key unchanged; corrupt state, failed writes or stale revisions cannot replace saved history; samples cause no writes; reload leaves loop stopped.
V109: [INFERRED] ∀ dashboard decision → canonical treasury rules and exact integer balances; retained source samples and knowledge analyses match canonical replay/projection at saved cutoff; source display preserves exact retained text.
V110: [INFERRED] ∀ current dashboard preview → evidence age refreshes decision validity; historical selection stays pinned to its original graph and cutoff; bounded loop stops on hidden page, unmount, storage change, error, revocation or ten saved cycles; Stop stays available during a pending cycle and cancels its queued storage lock; a synchronous commit already entered remains recorded.
V111: [INFERRED] ∀ dashboard export or connection claim → describes actual record fields and connection state; sample analysis cannot claim service capture or execution authority; source content treated as data; dialogs close and restore focus without stale event races; delayed clipboard results apply only to their original open export.
V112: [INFERRED] ∀ rejected mesh POST while client remains connected → complete typed HTTP error; drain unread input without retaining it; oversized fixed-length or chunked body never reaches storage; existing request timeout remains bounded.
V113: [VERIFIED, user-confirmed, 2026-09-30] ∀ `mesh-reserve-liquidity/1` → fixed Devnet reserve + USDC vault; verified genesis, one confirmed `getMultipleAccounts` slot, retained exact bytes + hashes, pinned owner/layout/mint/authority/state checks, reserve `total_available_amount` = vault amount; missing/mismatch/stale/future/failed evidence → `NO_DATA` + null amount, ⊥ old-success fallback; `OBSERVED` records exact unborrowed book units + source/slot/path, ≠ freely withdrawable funds, exit estimate, or transaction approval; lending terminal accepts only `mesh-public-evidence/1`.
V114: [VERIFIED, user-confirmed, 2026-09-30] ∀ `mesh-reserve-scenario/1` → exact owner-entered proposed/max/floor/age inputs, canonical u64 + age 1..300; server rechecks current reserve graph and source age under owner lock; missing/stale/future → saved `NO_DATA`, owner cap or book floor breached → `BLOCKED`, else `REVIEW` only; graph nodes and ordered checks bind observed source IDs, owner input and result origins; retry same request preserves original record, changed input conflicts; decision records owner-scoped and hidden from program analysis/lending reads; ⊥ wallet holding, withdrawability, automatic signing or execution authority.
V115: [INFERRED] ∀ peg capture → Solana cluster, canonical mint/decimals, source identity, raw bytes/hash, provider and local receipt times retained; missing, future, stale, mismatched, or failed source → NO_DATA, never prior success. USDC/EURC FX evidence ⊥ USD peg signal.
V116: [INFERRED] ∀ peg status → independent USD reference with known time and method; missing or conflicting reference → NO_DATA for depeg signal; unknown issuer redemption access → no executable peg-arbitrage claim. Same-asset quote cycle alone ≠ peg restoration or riskless arbitrage.
V117: [INFERRED] ∀ paper route → exact integer first-leg output feeds second-leg input; quote gross = final USDC units minus initial USDC units. Disclose venue fee/price impact already embedded in quote; subtract only extra network/priority, setup, and applicable restoration costs with verified currency conversion, never count a cost twice. Unknown required cost → NO_DATA; estimated net ≤0 → BLOCKED; positive estimate → REVIEW only, never fill/profit claim.
V118: [INFERRED] ∀ quote pair → label sequential, never synchronized fill; both source ages ≤10 seconds at assessment and within selected quote validity; later confirmation expiry → NO_DATA. Paper outcome and historical replay identify their source and cutoff.
V119: [INFERRED] ∀ paper transition → protected treasury remains unchanged, paper budget and positions reconcile in integer units, rejected/unknown decisions cause no debit; failed save never shows success; no wallet, signer, swap, loan, or outside capital access.
V120: [INFERRED] ∀ peg review display/export → retained evidence, cost components, risk reason, no-trade state, and executionReady false visible; absence of verified route/reference prevents profitable-arbitrage claim; existing gated dashboard remains inaccessible to visitors.
V121: [INFERRED] ∀ minimum Devnet proof → one owner-entered test amount, verified Devnet mints/pool and wallet account, existing I13 quote/build guards, exact-message simulation with err null, then separate explicit wallet approval. Peg REVIEW never triggers signing or changes test order. No flash loan, automatic send, or mainnet RPC.
V122: [INFERRED] ∀ Devnet proof outcome → retained signature, confirmed or finalized status, and reconciled before/after token balances for same signer and cluster; unknown, failed, or unreconciled send cannot show success or be blindly retried. Devnet test token result ≠ USD peg profit or live strategy fill.
V123: ∀ yield API response → exact schema validation; unknown fields ignored only when safe, missing required fields → ineligible or NO_DATA
V124: ∀ opportunity eligible → Solana chain, native USDC mint, Lending category, stablecoin=true, exposure=single, ilRisk=no, outlier=false, positive TVL, finite base APY
V125: ∀ ranked candidate → baseApyBps normalized deterministically; stable ordering by base APY desc, TVL desc, poolId asc
V126: ∀ simulated portfolio → totalUnits = reserveUnits + undelegatedUnits + idleUnits + sum(positionUnits); exact integer-unit arithmetic
V127: ∀ allocation plan → user reserve and maxVenueConcentrationBps hold per provider project; missing limits or infeasible plan → REVIEW; remainder stays idle
V128: ∀ PlanReceipt → policy snapshot, source and destination, amount, before/after balances, source IDs, retrieval time, reported rates, unknown costs, and executionReady=false
V129: ∀ chat/external-agent request → typed discover/simulate/explain intent; invalid or ambiguous text causes no state change
V130: ∀ provider failure, invalid schema, or missing required opportunity data → NO_DATA or REVIEW; prior simulation remains intact
V131: ∀ yield provider call → user-triggered read-only request; no hidden background polling
V132: ∀ MVP operation → wallet may sign a non-transaction login message only; transaction signatures, submission, orders, and real-fund mutation ⊥ allowed
V133: ∀ PlanReceipt allocation → units is a canonical unsigned base-unit string; before/after positions and Cash Trace read the same allocation units, while flows use amountUnits
V134: ∀ unauthenticated bot session → landing and Phantom login only; composer and agent data require server-verified wallet session
V135: ∀ yield request → server verifies wallet session or legacy Supabase JWT; owner derives from verified wallet address or verified sub; caller-supplied owner and user metadata ⊥ authorization
V136: ∀ user-scoped local simulation → one server-verified identity cannot load another identity's records; bot key uses wallet-derived owner; logout clears active session state
V137: ∀ chat input → only I18 typed intents mutate simulation; unsupported or ambiguous text causes no state change
V138: ∀ bot login → Phantom may sign only the non-transaction authentication message; transaction signing, balance reads, submission, orders, and real-fund mutation ⊥ allowed
V139: ∀ Supabase yield token → verified issuer, signature, audience, role, subject, and expiry; owner derives from sub, never metadata; verified token cache expires no later than JWT exp; uncached verification is bounded before Auth lookup; Auth 429 remains RATE_LIMITED
V140: ∀ yield allocation → maxVenues counts distinct provider project slugs; select at most the highest-ranked pool per project; each project's target ≤ floor(budget × maxVenueConcentrationBps / 10000)
V141: ∀ bot wallet login → require a registered Wallet Standard Solana account with solana:signMessage; bot allows any Solana chain; wallet connect alone ⊥ authentication; changed account clears pending sign-in
V142: ∀ Phantom Wallet Standard account shown → address Base58-decodes to exactly 32 bytes and account.chains contains solana:*; otherwise reject
V143: ∀ bot wallet challenge → server binds one challenge to candidate address and configured origin; challenge expiry ≤5 minutes; valid Ed25519 proof consumes it once; invalid, expired, wrong-origin, or replayed proof → no session
V144: ∀ bot wallet session → opaque random token maps server-side to wallet-derived owner; store only token hash in Postgres and token in sessionStorage; session expires ≤30 minutes; logout revokes token; caller-supplied owner ⊥ authority
V145: [INFERRED] ∀ wallet-session DevNet lending request → derive owner from current server-verified session; requested wallet equals session's verified wallet address; prepared intent, transaction signer and receipt stay bound to that wallet and owner; mismatch, revocation or expiry rejects before mutation or broadcast.


## §T TASKS

id|status|task|cites
T1|x|add `PluginRequest`, `PluginAdvisory`, `PluginError` types + exact-key validators in existing TypeScript style|V1,V2,V3,I2,I3,I4
T2|x|add inbound `plugin` command: stdin JSON, bounded UTF-8 read, one stdout JSON line, exit `0/1/2`, `--data` only|V1,V2,V12,I1
T3|x|map plugin request to existing `buildAgentRequest`; preserve hash-before-parse, cutoff, route, note, size, and path checks|V4,V5,V7,V8,I5
T4|x|invoke host-selected internal transport + existing thesis validation; map validated thesis to advisory; keep Codex internal|V9,V10,V13,I5
T5|x|enforce advisory-only schema + forbidden authority fields; no writes, network, wallet, signer, transaction, reservation, custody, or execution|V11,V12,V16,I3,I4
T6|x|add `test/plugin.test.ts`: valid advisory; malformed JSON; unknown fields; bounds; path traversal/symlink; hash mismatch; future/stale cutoff; route/amount mismatch; tampered/future evidence; untrusted notes; deterministic status; expiry; forbidden authority fields|V2,V4,V5,V6,V7,V9,V10,V11,V14
T7|x|add fixture request + fixture-only CLI smoke coverage; assert one JSON line, exit behavior, no persistent writes, synthetic labeling|V1,V12,V15,V16,I6
T8|x|run exact verification commands; record observed counts and limits before build handoff|I6,V1,V9,V12

T9|x|add `preps/perps.ts` two-venue canonical snapshot bundle carrying Phoenix + Hyperliquid registries/dynamic states, deterministic raw/normalized hashes/freeze, source failover/conflict/freshness/coherence, and provenance types|V17,V18,V19,V20,I7
T10|x|add typed Perps Specialist Trade Proposal, independent veto-only Risk Review, publication gate, host transport boundary, exact `council.advice`/`council.copilot` validators|V21,V22,V23,V24,I7
T11|x|add deterministic synthetic perps behavior tests + interface documentation; preserve legacy plugin files/contracts|V17,V18,V19,V20,V21,V22,V23,V24,I7,I8
T12|.|obtain authorized official Phoenix/Hyperliquid native contract metadata and implement separately approved live adapters; no live claim until registry/adapters validated|V17,V24,I7
T13|x|split council advice into one Lead Specialist call + one independent Risk Review call; bind request/run/bundle/policy/account/proposal identity; enforce veto-only publication and Copilot evidence binding|V25,V28,I7
T14|x|harden two-venue bundle coherence, venue/envelope/projection ingress, deep freeze, source identity/failover, signed funding, raw manifest evidence; add deterministic rejection tests|V26,V27,V29,V30,I7,I8
T15|.|define external host durable append-only evidence boundary; keep pure perps module in-memory only|V30,V37,I7
T16|x|enforce NO_DATA/veto status order, raw manifest reconstruction, TTL/coherence/sequence bounds, full proposal policy/account/provenance identity, malformed-request safe fallback, and Copilot component binding with adversarial tests|V31,V32,V33,V34,V35,V36
T17|x|preserve immutable complete lead/risk/policy/account/snapshot audit record in council advice responses and validate its bindings|V37
T18|x|harden proposal/risk primitive validators, canonical evidence reconstruction, response bundle/status/hash binding, typed audit status/veto/policy fields, immutable safe fallbacks, adapter semantic-attestation boundary, blocking-review status matrix, and audit request/run identity; add malformed/forged regressions|V38,V39,V40,V41,V42,V43,V44,V45,V46
T19|x|build isolated local React/Vite FalconOS landing page; verify production build + desktop/mobile browser behavior|V47,V48,V49,V50,V51,I9
T20|x|restore approved Alpine mountain photograph + credit; correct risk-review outcomes; verify responsive visual behavior|V52,V53,I9
T21|x|replace Alpine dark/photo treatment with full professional light-fintech system from `design.md`; preserve FalconOS identity/content; verify responsive behavior|V48,V50,V51,V53,V54,I9
T22|x|replace approved light React page with selected dark Liquid Metal static page; repair internal links; verify build + responsive/accessibility behavior; deploy via Cloudflare Pages Git integration|V47,V48,V49,V50,V51,V53,V55,I9
T23|x|add `stocks/stocks.ts` synthetic canonical basket snapshot for Solana tokenized equities: per-asset registry/market evidence, raw/normalized hashes/freeze, coherence checks, provenance types|V56,V57,I10
T24|x|add typed Stocks Specialist BasketProposal (integer bps weights, per-leg evidence) + independent veto-only RiskReview + publication gate + host transport boundary + exact `stocks.advice` validators|V56,V58,V59,I10
T25|x|add deterministic synthetic stocks contract tests: `NO_DATA` on missing/invalid evidence, valid basket advisory path, weight-sum + veto/status-matrix rejections|V56,V57,V58,V59,I10
T26|x|extend stocks snapshot to perps/stablecoins parity: rich registry, per-field source precedence + safe failover, provider-event vs local-receipt time, typed failure metadata; add deterministic parity tests|V60,V61,V62,V63,I10
T27|x|`engine/` Rust live dashboard replaces deleted `dash/`: read-only DexScreener + PreStocks + Solana RPC → basket snapshot → council → terminal `preipo`; `serve` on `127.0.0.1:8787` GET `/advice` and `/graph`; typed failure → `NO_DATA`|V57,V64,V65,V66,I11
T28|x|PreStocks scaled-UI multiplier normalization + issuer corroboration in `engine/src/prestocks.rs`; fail-closed multiplier parse tests|V66,I11
T29|x|DexScreener price selects the deepest USDC-quoted pool when one exists, else the deepest pool|V67,I11
T30|~|make engine pool ranking exact; bind underlying references into snapshot hash; return complete advice citations|V68,V69,V70,I11
T31|~|finish Surfpool flow on user-hosted RPC and add Devnet Raydium CPMM flow; bind quote, pool, simulation, send, and confirmation to selected cluster|V71,V75,I12
T32|.|add Meteora DBC stock-token path after Devnet swap flow passes live user test|V75,I12
T33|~|finish production `/app/` wallet-owned Devnet terminal with multi-hop Raydium quote validation and manual transaction approval|V76,I13
T34|x|save accepted pitch; index treasury product/architecture, ADRs, contract, cloud path, implementation plan, and current-state correction|I14,V77,V78,V79,V80,V81,V82,V83,V84,V85,V86
T35|x|build local treasury vertical slice: owner setup → graph-first simulated supply/hold/redeem → persisted replay → interactive UI|I14,V77,V78,V79,V80,V81,V82,V83,V84,V85,V86
T36|x|verify treasury invariants, failure preservation, negative controls, full web suite, static build, and browser workflow|I14,V77,V78,V79,V80,V81,V82,V83,V84,V85,V86
T37|~|prove one exact Kamino USDC supply/redemption path on Devnet; verify reserve settings, receipt ownership, rounding, and confirmed balances|I14,V78,V81,V101,V102,V145
T38|.|prepare shareable HTTPS simulation release; verify browser storage isolation, mobile flow, and deployment target before user-authorized publication|I14,V77,V82,V84
T39|.|specify and prove restricted agent authority, durable server reconciliation, and funded launch prerequisites before automatic real execution|I14,V78,V80,V81
T40|~|publish treasury documentation and four independently verified feature slices as small draft PRs, based on fresh remote main and excluding unrelated worktree changes|I14,V77,V82,V84,V85,V86
T41|x|finish browser graph prototype: pinned policy, saved records, evidence-linked checks, readable inspector, custom synthetic evidence, legacy replay, Pages candidate|I14,V77,V78,V81,V82,V87,V88,V89,V90
T42|x|build persistent mesh vertical slice: retained sources, typed multi-hop analysis, Postgres history, authenticated API, viewer and local verification|I15,V91,V92,V93,V94,V95,V96,V97
T43|~|connect approved live sources and terminal to mesh; prove one owner-approved Devnet lending path and persist confirmed outcomes before hosting|I15,V91,V92,V93,V94,V95,V96,V97,V99,V100,V113
T44|x|port active OpenDesign treasury landing to runnable React, preserve design and interactions, verify desktop/mobile/reduced-motion flows|V104
T45|~|connect landing signup to durable local/Pages storage and configurable idempotent confirmation email; verify registration and distinguish provider acceptance from inbox delivery|V105,V106
T46|x|port active OpenDesign Control Centre to React; preserve four views and isolated saved simulation; verify source parity, current/history semantics, storage failures and browser flows|I16,V107,V108,V109,V110,V111

T47|x|publish new landing and Control Centre on the existing Pages site from a clean scoped checkout; preserve hosted signup and verify public routes and assets|I16,V104,V107,V111

T48|x|add owner-entered live Devnet reserve scenario decision graph in React Operate, immutable mesh API history and local verification; keep synthetic treasury and wallet terminal separate|I15,I16,V113,V114
T49|.|verify one Solana USD-stable route, canonical mints, quote source, independent USD reference, source age and availability; reject FX as peg evidence|I17,V115,V116,V118
T50|.|capture exact sequential two-leg quotes and raw evidence; calculate integer-unit gross/net with explicit known costs and unknown-cost NO_DATA|I17,V115,V117,V118
T51|.|connect peg risk and paper treasury decision: protected reserve, no-trade reasons, blocked/no-data handling, retained paper outcomes and replay|I17,V116,V117,V119
T52|.|show one sourced decision and history in gated React review; display provenance, costs, paper labels and executionReady false|I17,V118,V120
T53|.|exercise live-read paper path and stale/missing/adverse cases; verify replay, no-capital boundary, browser review, and honest negative-result demo|I17,V115,V116,V117,V118,V119,V120
T54|.|verify one real Devnet pool, test mints, owner wallet and test amount; reuse I13 to simulate exact swap; request separate approval before owner signs/sends; retain signature and reconcile confirmed before/after balances; no peg-profit claim|I13,I17,V76,V121,V122
T55|x|implement read-only Solana yield catalog adapter and source validation|I18,V123,V124,V130,V131
T56|x|normalize native-USDC lending pools and expose provider coverage gaps|I18,V123,V124
T57|x|implement deterministic multi-venue allocator and replayable PlanReceipt|I18,V125-V128
T58|x|add typed discover/simulate/explain API for dashboard and external agents|I18,V129,V132
T59|x|build chat-first dashboard, compact portfolio rail, and visible Cash Trace|I16,I18,V128
T60|x|test provider failures, filtering, ranking ties, caps, conservation, and blocked intents|V123-V132
T61|x|run local dashboard browser smoke and inspect simulated source-to-destination flow|I16,I18
T62|x|build standalone bot landing and app at `bot.falconos.markets` (now `agents.falconos.markets`); keep existing `falconos.markets` routes unchanged; gate Falcon composer behind Supabase Auth [superseded by wallet-signature login]|I19,V134,V138
T63|x|verify Supabase JWT claims server-side for yield routes; derive owner from verified subject; cache only until exp, bound uncached Auth checks, preserve legacy routes|I19,V135,V139
T64|x|connect Falcon chat to I18 typed intents and user-scoped local simulation; reject unsupported text without state change|I18,I19,V136,V137
T65|x|test login gate, session expiry, owner isolation, Auth throttling, chat intent failures, simulation replay, browser flow, and standalone site build; no deployment|I19,V123-V139
T66|x|group yield concentration and venue count by provider project slug; select one highest-ranked pool per project; add regression coverage|I18,V140
T67|x|historical: add connect-only Phantom control after Supabase Auth; superseded by T68 wallet signature login|I19,V141,V142
T68|x|replace bot email gate with server-verified Phantom signature login; derive wallet owner; retain legacy Supabase mesh sessions; no transactions|I19,V134,V135,V138,V143,V144
T69|x|add Postgres-backed one-time wallet challenge/session table; extend complete local schema history and restricted role grants; do not apply remotely|I19,V143,V144
T70|x|test challenge replay/origin/expiry/signature, wallet owner isolation, legacy Supabase clients, browser sign-in, builds and docs; no real signing or deployment|I19,V134-V144
T71|~|serve the wallet-gated bot at `agents.falconos.markets/` and graph/DevNet terminal at same-origin `/mesh/`; preserve main-site routes; build and verify local routes without DNS or deployment|I15,I19,V96,V143,V144,V145
T72|~|authorize wallet sessions for owner-scoped mesh graph, capture, analysis, and lending routes; bind every lending wallet to the session wallet; preserve legacy tokens; test cross-owner, mismatch, expiry, revocation, and transaction intent boundaries|I15,I19,V92,V95,V101,V102,V103,V145

## §B BUGS

id|date|cause|fix
B1|2026-09-11|plugin implementation introduced duplicate import, non-erasable parameter property, and stale public type|manual correction
B2|2026-09-11|plugin branch treated required command with no positionals as help and skipped stdin|V1
B3|2026-09-11|plugin test accessed discriminated response code before narrowing advisory/error union|V2,V9
B4|2026-09-11|plugin transport error text exposed raw secret or empty message|V13,V14
B5|2026-09-11|backslash normalization happened after absolute-path checks, admitting UNC paths|V4
B6|2026-09-11|lstat-then-open allowed checked evidence or note inode swap|V4
B7|2026-09-11|descriptor traversal used `/dev/fd/<dirfd>/<component>` form unsupported by current Darwin runtime|V4
B8|2026-09-11|blocking `O_RDONLY` open hung indefinitely on a FIFO with no writer|V4,V7
B9|2026-09-11|official Phoenix/Hyperliquid native IDs, contract values, and live adapter facts unauthorized/unavailable; local slice could not claim live support|V17,V24
B10|2026-09-11|synthetic fixture helper dropped capture override fields during edit, masking typed outage/conflict assertions|manual correction
B11|2026-09-11|council advice request carried venue-local canonical snapshot despite Q1/Q2/Q8 two-venue scope|V18
B12|2026-09-11|council transport exposed one undifferentiated advice call; no independent lead/risk identity or request/run/proposal binding|V25,V28
B13|2026-09-11|venue-local coherence checks missed cross-venue stale spread|V26
B14|2026-09-11|bundle marker/deep freeze, venue maps, envelope bindings, and projections were not all enforced at host ingress|V27
B15|2026-09-11|capture adapter/semantic identity, duplicate-source rejection, signed funding, and raw evidence fields were incomplete|V29,V30
B16|2026-09-11|pure local canonicalizer could be mistaken for durable append-only audit persistence|V30
B17|2026-09-11|publication checked reviewer veto before reviewer `NO_DATA`, allowing an invalid status precedence|V31
B18|2026-09-11|retained raw manifest and derived source/selection projections were independently hashable without deterministic self-reconstruction|V32
B19|2026-09-11|field TTL and selected age were checked separately from one hard coherence cap; capture sequence gaps had no explicit boundary|V33
B20|2026-09-11|Trade Proposal binding retained policy/account references but not full request state and snapshot provenance|V34
B21|2026-09-11|malformed direct advice/copilot requests could dereference absent fallback IDs or snapshot evidence|V35
B22|2026-09-11|Copilot bound only snapshot hash, permitting same-hash altered evidence components or native subject identity|V36
B23|2026-09-11|advice response discarded complete lead/risk records instead of returning an immutable audit record|V37
B24|2026-09-11|sequence continuity was described as a readiness requirement without an explicit retained capture sequence/gap representation|V33
B25|2026-09-11|TradeProposal validator omitted nullable liquidationDistance/marginAtRisk, scenario primitive checks, normalized evidence hash, and expiry/status semantics|V38
B26|2026-09-11|response ingress trusted evidence hashes and top status without reconstructing canonical bundle/selected market readiness|V41,V42
B27|2026-09-11|lead/risk audit status fields inferred or lost on direct publish and transport failure; policy/account state was dropped from safe fallback|V39
B28|2026-09-11|RiskReview accepted arbitrary policyVersion and critical PASS, and audit risk fields were shape-only|V40
B29|2026-09-11|raw bytes were incorrectly treated as proof of provider semantic normalization; registry source declarations were not checked against precedence|V43
B30|2026-09-11|safe Copilot failure response was mutable instead of deeply frozen|V38,V42
B31|2026-09-11|response status matrix allowed forged `NO_DATA` with a blocking risk review|V44
B32|2026-09-11|response validator did not bind audit request/run identity to top-level response, allowing cross-run failure audit reuse|V45
B33|2026-09-11|proposal binding did not enforce proposal status against bound bundle and selected market readiness, allowing forged `PROPOSED` evidence on `NO_DATA` snapshots through publication/audit and Copilot|V46
B34|2026-09-11|TradeProposal ingress used Date.parse without primitive validation and omitted horizon, invalidations, and provenance checks, allowing malformed fields through|V38
B35|2026-09-11|response matrix rejected valid direct null-proposal outcomes or failed to distinguish an uncalled default lead from a called lead `NO_DATA` result|V39
B36|2026-09-11|malformed advice/Copilot fallback fabricated empty snapshot evidence with invalid empty bytes, so fallback responses failed their own validators|V35
B37|2026-09-14|website omitted approved Alpine mountain photograph, reducing selected brand to palette/lockup|V52
B38|2026-09-14|website invented request-review risk outcome although perps contract permits PASS/BLOCK/NO_DATA|V53
B39|2026-09-15|web shadcn setup copied removed TypeScript `baseUrl` + Vite-native-incompatible `__dirname`|one-time TS7/Vite8 config migration
B40|2026-09-16|transform cell threw after deriving checks; artifact variable rolled back to raw source while cached checks masked rollback|V55
B41|2026-09-16|browser smoke clicked evidence link after keyboard test hid its Research tab panel|one-time browser smoke correction
B42|2026-09-16|meta+og description present-tense live-use claim violated V48; landing test stripped <meta> so it went uncaught|V48
B43|2026-09-16|dash PreStocks scaled-UI fix cited V66 before spec backprop; `parseScaledUiAccountState` accepted multiplier `0` & silently dropped invalid pending multiplier|V66
B44|2026-09-22|deepest SPACEX pool quoted SPCXx; DexScreener `priceUsd` was not a USDC print; after scaled-UI /5, pool vs issuer gap was 963bps > 500 → basket `NO_DATA`|V67
B45|2026-09-23|[VERIFIED, source read: `engine/src/dexscreener.rs` used `decimal_units(next, 0)`]|liquidity fractions were truncated and values beyond `u128` ranked as zero|V68
B46|2026-09-23|[VERIFIED, source read: `engine/src/serve.rs` applied `pyth_failure` after `build_snapshot`]|configured Pyth failure changed the verdict after snapshot hashing, so failure evidence was unbound|V69
B47|2026-09-23|[VERIFIED, source read: `engine/src/graph.rs` labeled DexScreener `usdc pool`]|fallback pool source detail claimed a USDC quote without evidence|V68
B48|2026-09-23|[VERIFIED, source read: `engine/src/serve.rs` `AdviceResponse` omitted `execution_ready` and `citations`]|HTTP advice did not meet the rendered advisory contract|V70
B49|2026-09-23|[VERIFIED, source read: `web/copilot/execution.mjs` allowlisted `devnet` and `web/copilot/index.html` accepted absent simulation `err`]|send target and simulation failure checks did not enforce the selected Surfpool-only boundary|V71
B50|2026-09-23|[VERIFIED, source read: `engine/src/prestocks.rs:129` `entries.insert(...)`; `engine/src/council.rs:257` `reference.feed_id.starts_with("prestocks:")`]|conflicting mint rows overwrote each other, and PreStocks feed symbols were not matched to the configured underlying|V72
B51|2026-09-23|[VERIFIED, source read: `engine/src/prestocks.rs:243,547`; `engine/src/council.rs:224,346`] each path multiplied a fixed-point gap by 10,000 without checked multiplication|V73
B52|2026-09-23|[VERIFIED, source read: `engine/src/prestocks.rs:335`] `as_u64()? as u32` silently truncated out-of-range token decimal counts|V74
B53|2026-09-23|[VERIFIED, focused test output: expected `wallet-key`, received a valid PreStocks public key] Jupiter build test fixture used a non-Base58 wallet string|fixture now uses a valid public key; wallet validation remains enforced
B54|2026-09-24|[VERIFIED, first focused run: `3 !== 4` in multi-hop builder test `web/test/app-execution.test.mjs`] test expected fourth RPC call; builder makes one pool batch + two token-account reads|expected call count corrected to three
B55|2026-09-26|[VERIFIED, isolated browser regression: `Total USDC must be an unsigned USDC decimal string with at most six fractional digits.`] setup disabled fields before constructing FormData, so visible values were absent|V85; snapshot before disabling; `web/test/treasury-browser.mjs`
B56|2026-09-26|[VERIFIED, first browser run: accessible relationship check failed; `web/treasury/style.css` used `.graph-relations{display:none}`] desktop relationship text was absent from the accessibility tree|V86; visually hide text without removing it from accessibility; `web/test/treasury-browser.mjs`
B57|2026-09-26|[VERIFIED, browser harness: keyboard check failed with only `key` and `code`; passed after Enter virtual key code 13 was added] incomplete CDP event did not trigger native button activation|one-time test driver correction; V84
B58|2026-09-26|[VERIFIED, browser screenshot: `Agent stopped after an error.` remained after corrected setup] successful setup did not replace the prior loop status|V84,V85; set neutral stopped status after creation
B59|2026-09-27|[VERIFIED, source inspection: treasury export handler used one snapshot message while store.exportRun preserves schema 1] legacy export promised fields absent from the downloaded record|V90; inspect exported schema before confirming; treasury browser regression
B60|2026-09-27|[VERIFIED, negative browser attempt: `TypeError: Cannot read properties of null (reading 'hidden')`] reload wait assumed the new document already contained its elements|browser driver waits for element existence before checking visibility; rerun negative control
B61|2026-09-27|[REPORTED, storage review; VERIFIED, source inspection] decoded NUL and lone surrogates passed source label/URL validation but cannot round-trip through Postgres text/JSONB|V98; reject at source boundary; mesh domain regression
B62|2026-09-27|[VERIFIED, integrated tests: `Source contains a duplicate graph ID.`] fixture reserve and position both used `edge:unrelated-asset`|V91; include position identity in fixture asset-edge IDs
B63|2026-09-27|[VERIFIED, browser harness: `passed: 18, total: 19`; domain.mjs] stale-evidence check required the word `stale`, while the policy says `older than 300 seconds`|V93,V96; check the documented freshness reason and retained source age
B64|2026-09-27|[REPORTED, email review; VERIFIED, source inspection] waitlist database errors escape the handler and its TextDecoder accepts malformed UTF-8|V105; fail with bounded safe JSON and reject malformed request text before persistence
B65|2026-09-27|[REPORTED, landing review] active OpenDesign script contains `const presentation=const presentation={`|V104; preserve intended interactions in the React port and keep the source artifact unchanged
B66|2026-09-27|[VERIFIED, source review] separate prepared intents can have identical transaction messages and signatures; registration previously checked only each intent|V102; reject signature reuse across an owner's intents under the same transaction lock
B67|2026-09-27|[VERIFIED, web suite: `tests 145, pass 144, fail 1`] access test still required the old static market-snapshot landing after the user requested its React replacement|V104; test the new entry and retain the dashboard's manual Devnet boundary
B68|2026-09-27|[REPORTED, review: `web/mesh/app.mjs` API helper] delayed API responses can restore the prior workspace after a credential change|V96; bind every API result to its credential generation
B69|2026-09-27|[REPORTED, review: `web/mesh/terminal.mjs`, `mesh/lending-store.mjs`] registration retains no signed bytes and disables signing, so interrupted broadcasts cannot resume after reload; absent expired transactions stay pending|V102; retain signed bytes for explicit identical retries and report expired absent receipts as unverified
B70|2026-09-27|[REPORTED, review: `mesh/lending-store.mjs` submission path] first registration checks signature and preparation age without rechecking changed source heads|V101; recheck the retained live analysis under the owner lock and display its ID
B71|2026-09-27|[REPORTED, review: `web/functions/_waitlist-email.js`] sender validation accepts consecutive local-part dots and local parts longer than 64 bytes|V106; validate sender local-part shape and size before enqueue
B72|2026-09-27|[REPORTED, SQLite review: upsert returns `changes=1` for an existing email] handler treats an updated registration as a new registration|V105; use the insert result for duplicate status and retain the atomic outbox batch
B73|2026-09-27|[REPORTED, browser evidence: old native `close` event at 560ms follows reopening at 555.8ms] queued dialog close event clears the newly opened React dialog|V104; React state owns close, while native cancel handles Escape
B74|2026-09-27|[VERIFIED, disposable Vite tests: `tests 3`, `pass 0`, `fail 3`] local runtime stores private state beneath a development server root without a deny rule|V96,V105; deny `.local` paths in every Vite development configuration and verify HTTP rejection with dummy files
B75|2026-09-27|[VERIFIED, OpenDesign `falconos-workspace.html:698`] raw-source inspector parses and pretty-prints retained content while claiming exact text|V109; render retained source string verbatim in React
B76|2026-09-27|[VERIFIED, OpenDesign `falconos-workspace.html:765`] timer refreshes evidence age badges without refreshing the current decision|V110; refresh current decision with time and preserve saved historical cutoff
B77|2026-09-27|[VERIFIED, OpenDesign `falconos-workspace.html:97,755`] shared export description claims command history for knowledge exports containing graph, analysis and sources|V111; describe the selected export schema
B78|2026-09-27|[REPORTED, dashboard review: initial-chart expression throws `Run has missing or unknown fields.` for an accepted schema-1 run] chart adds schema-2 fields to legacy state before replay|V109; construct the initial chart state with fields allowed by that run's schema and cover legacy rendering/export
B79|2026-09-27|[REPORTED, dashboard review: delayed clipboard completion updates whichever export is open] copy result is not bound to the dialog that requested it|V111; bind clipboard success and fallback focus to export generation
B80|2026-09-27|[VERIFIED, source inspection: `App.jsx` cancels timers only; `Decisions.jsx` disables Stop during busy state] a cycle waiting for a storage lock cannot be stopped before it writes|V110; keep Stop enabled and abort a loop's queued lock request
B81|2026-09-27|[VERIFIED, web suite `tests 158`, `pass 157`, `fail 1`; isolated polling test also returned `pending` after 304ms] a success fixture required two polls within 100ms of wall time|one-time test correction: use a controlled clock for the polling outcome assertions; production deadlines stay unchanged
B82|2026-09-27|[REPORTED, UI build review: CSS retained `[EMBEDDED_ASSET]` from a sanitized reading copy] source font hashes were correct but CSS did not reference those assets|V107; bind four font faces to the retained TTF files and assert their loaded browser status
B83|2026-09-27|[VERIFIED, pre-commit mesh suite: `tests 97`, `pass 95`, `fail 2`, oversized HTTP upload returned `ECONNRESET`; REPORTED, focused probe: 4 resets in 20 uploads] forced connection close races a client still uploading rejected input|V112; drain unread input and preserve the typed error response
B84|2026-10-03|[VERIFIED, targeted V124 test] yield normalizer emitted rewardApyBps while allocation contract expects apyRewardBps, hiding the reward component|V125
B85|2026-10-03|[VERIFIED, targeted V126 test] allocation entries exposed amountUnits while portfolio consumers read units, so proposed positions were unreadable|V133; keep allocation units and flow amountUnits distinct and verify receipt conservation
B86|2026-10-03|[VERIFIED, targeted V127 test] conservation rejection text did not match the invariant wording used by the test|V127; report a clear portfolio conservation error
B87|2026-10-03|[VERIFIED, axe-core 4.13.0: 2 violations, `landmark-one-main` + `region`] bot chat root lacked `main`; heading sat outside landmark|V50
B88|2026-10-03|[VERIFIED, local browser smoke: forged future localStorage session displayed composer with zero `/auth/v1/user` requests] UI trusted session shape, not Auth-verified identity|V134; verify token via Supabase Auth before mounting chat
B89|2026-10-03|[VERIFIED, scoped security scan secscan_01a103243c5d777b902836ed86ca0e72] Supabase yield auth called remote verification before any bound; bad tokens could cause repeated Auth lookups; Auth 429 mapped to 401|V139; cache verified claims until exp, bound uncached checks, preserve 429
B90|2026-10-03|[VERIFIED, `mesh/yield-domain.mjs:91`: `candidates.slice(0, maxVenues)` counted pool rows] same project could consume multiple concentration caps and venue slots|V140; count distinct project slugs and cap each project target
B91|2026-10-03|[VERIFIED, local reproduction: connectPhantomWallet returned 'zzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzz'] character and length checks accepted a Base58 string that does not decode to a 32-byte key|V142; reject addresses unless Base58 decoding yields exactly 32 bytes
B92|2026-10-05|[VERIFIED, V103 regression] unchanged account snapshot cleared pending sign-in and rejected signature|V103; retain selection while selected account and signing capability still match
