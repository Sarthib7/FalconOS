# SPEC

## §G GOAL
Build inbound read-only FalconOS plugin CLI + truthful local council website → external Client Agent gets validated advice while retaining decision/execution authority.

## §C CONSTRAINTS
- FalconOS role: investment firm intake, research, deterministic policy, advisory result. External agents remain callers.
- The plugin and Rust engine remain read-only. `web/copilot/` has a separate local, dev-only Surfpool demo; the connected wallet signs, and the page sends only to the local mainnet fork.
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
- T1-T8 plugin slice frozen. Website work remains isolated under `web/`; production deploy limited to static Cloudflare Pages artifact; ⊥ wallet, signer, transaction, production waitlist, analytics, or plugin contract expansion. Vite excludes the local copilot from production output.
- Pooled ETF product (FalconOS pools capital + issues ETF via Raydium/Meteora) ⊥ current scope; prerequisite: reverse advisory-only boundary (V11), add custody/execution/issuance, integrate AMM, complete securities/fund-law review before code.
- `engine/` Rust crate is the stocks live dashboard (⊥ root plugin zero-dep graph): read-only live GET/RPC from configured providers, basket snapshot, stocks council, terminal render, and local `127.0.0.1` `/advice` plus `/graph`. ⊥ execution, custody, wallet, signer, order submission. `graph --out` writes one operator-named local JSON file. Secrets via env only, never committed. Deleted `dash/` Node package ⊥ current surface.
- `web/copilot/` is a local DEV-only client action demo. Jupiter V1 builds a route from mainnet market data; the page refreshes the blockhash, simulates, and sends only through Surfpool at `http://127.0.0.1:8899`. Wallet signing follows an explicit user click. This does not change the engine, plugin, or production boundary.

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

- `preps/perps.ts` owns distinct perps-only types/validators; legacy `src/plugin.ts` contract unchanged.
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
node --test preps/test/perps.test.ts
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

### I12. Local Surfpool copilot

- Owner/provider: `web/copilot/`; consumer: the local user and connected browser wallet.
- Scope: DEV-only local demo, excluded from the production Vite build. Jupiter V1 quote/build uses mainnet market data; `getLatestBlockhash`, `simulateTransaction`, and `sendTransaction` use only `http://127.0.0.1:8899`.
- Before wallet signing, the page replaces the Jupiter blockhash with a current Surfpool blockhash and simulates those exact serialized message bytes with signature checks disabled. Missing or malformed simulation data, or `err !== null`, stops before the wallet opens.
- The wallet signs only after the explicit **Sign & send** click. Before send, the page checks that the wallet preserved the simulated message and signed the connected account. Only the signed bytes go to Surfpool.
- ⊥ public mainnet RPC, devnet RPC, engine signing, automatic signing, server-side key, or transaction submission from the engine.

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

V71: ∀ local copilot transaction → Surfpool `http://127.0.0.1:8899` is the only RPC target; refresh blockhash, simulate the same message, and require present `err: null` before wallet signing; after explicit signing, message bytes and connected signer must match before send; copilot is absent from production build

V72: ∀ PreStocks API rows for a configured mint → duplicate rows agree on symbol, mark, and token price; the accepted symbol equals the configured underlying; conflict or mismatch → failed reference capture and snapshot `NO_DATA`

V73: ∀ engine fixed-point gap calculation → multiply by 10,000 with checked arithmetic; overflow → typed failure or `NO_DATA`, never panic or wrap

V74: ∀ Solana `getTokenSupply.decimals` → validate its integer range before narrowing; an out-of-range value → failed capture and snapshot `NO_DATA`
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
T31|~|finish the local Surfpool-only wallet simulation and send path; exclude devnet and public mainnet RPC|V71,I12
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
