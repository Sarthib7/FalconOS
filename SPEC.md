# SPEC

## §G GOAL
Build inbound read-only FalconOS plugin CLI + truthful local council website → external Client Agent gets validated advice while retaining decision/execution authority.

## §C CONSTRAINTS
- FalconOS role: investment firm intake, research, deterministic policy, advisory result. External agents remain callers.
- First slice read-only. ⊥ wallet, signer, transaction, capital reservation, pooled custody, execution.
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
- T1-T8 plugin slice frozen. Website work remains isolated under `web/`; production deploy remains a static Cloudflare Pages artifact, with the approved waitlist Pages Function and D1 binding as the only networked web write; ⊥ wallet, signer, transaction, analytics, or plugin contract expansion.
- Pooled ETF product (FalconOS pools capital + issues ETF via Raydium/Meteora) ⊥ current scope; prerequisite: reverse advisory-only boundary (V11), add custody/execution/issuance, integrate AMM, complete securities/fund-law review before code.
- `dash/` isolated Node/TS terminal dashboard (own deps; ⊥ root plugin zero-dep graph): performs read-only live GET/RPC fetches from configured providers, builds a `live`-provenance basket snapshot, runs the stocks council, renders advisory to terminal; ⊥ execution, custody, wallet, signer, order submission, persistent external writes; secrets via env only, never committed.

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
- CTAs: explain system + explore Falcon Skills navigate within page. Waitlist sends a validated email and source to `POST /api/waitlist`; the Pages Function stores normalized email and hashed-IP rate-limit state in D1. Login, wallet connect, and signup remain gated Soon.
- Static Cloudflare Pages deployment at `falconos.markets` allowed; the waitlist Pages Function + D1 path is allowed for access requests; ⊥ wallet, signer, transaction construction/submission, custody, pooled capital, ETF issuance, and analytics.

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

- `dash/` remains the terminal orchestration and rendering package; command `npm run stocks` runs the Stocks live evidence path through the dashboard renderer.
- `/stocks` owns the read-only live adapters. They fetch per-asset `price`/`liquidity` evidence via HTTP GET or public Solana RPC; each adapter yields a stocks `FieldCapture` with `provenance: live`, real `sourceId`/adapter/semantic version, provider-event + local-receipt time, and typed failure on error.
- Host builds a `live` canonical basket snapshot from adapter captures, runs the stocks council (Lead + veto-only Risk), and renders basket/weights/risk/citations to the terminal; advisory-only, `executionReady: false`.
- Provider/network/parse failure → typed capture failure → snapshot `NO_DATA`; the dashboard surfaces the failure and never fabricates evidence.
- ⊥ order submission, custody, signing, capital movement; read-only display of live evidence + advisory. Secrets via env only.

### I12. Falcon Investment Stocks Market Integrity Desk

- `stocks/integrity.ts` evaluates canonical Stocks snapshots and bound Basket Proposals into `MarketIntegrityReport` statuses `VERIFIED`, `STALE`, `DIVERGENT`, or `NO_DATA`; output includes snapshot/proposal hashes, freshness state, warnings, refusal codes, and `executionReady: false`.
- Integrity checks reuse canonical snapshot `status`, `missing`, `conflicts`, `sourceDecisions`, and `capturedAt`; issuer-reference freshness remains `UNKNOWN` when only local receipt time is available.
- The Desk is advisory-only; it may gate publication and render refusal evidence, but it cannot custody funds, sign, submit orders, pool capital, or issue an ETF.

### I13. Falcon Investment Stocks Client Agent surface

- `stocks/agent.ts` + `stocks/cli.ts` expose `npm run stocks:advice`: one `stocks.agent-request` on stdin → one `stocks.agent-response` or `stocks.agent-error` JSON line on stdout.
- Fixture mode (`healthy` | `low-liquidity` | `stale`) is offline and synthetic. Snapshot mode accepts a frozen canonical basket snapshot. Host Lead/Risk transport is FalconOS-owned (`stocks/host.ts`).
- Response embeds validated `stocks.advice` plus optional `MarketIntegrityReport`; `authority=advisory-only`; `executionReady=false`; `agentId` is provenance only.
- ⊥ live market GET/RPC on the agent path; ⊥ wallet, signer, custody, pool creation, model selection, or tool authority fields (exact-key reject).
- Human demos remain `npm run stocks:demo` / `npm run stocks:dbc`. Live PreStocks remains `npm run stocks` via `dash/`.

### I14. Falcon Investment Stocks Meteora DBC equity launch desk

- `stocks/dbc.ts` emits advisory DBC launch prescriptions for equity-like sleeves: USDC quote, Token-2022, DAMM v2, stock-token keeper floor ≥750 USDC units, equity fee band.
- Evaluation statuses `READY` | `REVIEW` | `REJECT` with fit labels `equity-grade` | `meme-grade` | `unsuitable`. Offline demo: `npm run stocks:dbc`.
- ⊥ on-chain config creation, pool creation, swaps, migration, custody, or signing in this slice.

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

V49: ∀ website waitlist submission → request uses `POST /api/waitlist`; invalid JSON/email/origin/size → typed failure; valid normalized email persists through the approved Pages Function + D1 binding; missing binding → visible unavailable state; ⊥ success claim before persistence

V50: ∀ website viewport/interaction → usable at 320px and desktop widths; semantic landmarks, keyboard-visible focus, labeled controls, reduced-motion support, and no horizontal overflow

V51: ∀ website authority copy/decision trace → FalconOS advisory only; Client Agent owns final decision/execution; human approval required before any later Solana transaction
V52: [superseded by V54 on 2026-09-14] prior Alpine treatment required approved snow-mountain photography; user replaced that direction with full light fintech treatment

V53: ∀ website risk-review outcome copy → only `PASS`, `BLOCK`, or `NO_DATA` semantics; ⊥ `REVIEW`/request-review outcome

V54: [superseded by V55 on 2026-09-16] prior professional light-fintech system required white/neutral surfaces + blue/lime accents + Lausanne typography

V55: ∀ local website visual system → approved dark Liquid Metal treatment + embedded Geist typography + responsive navigation + keyboard-accessible interactive demos + reduced-motion fallback; FalconOS identity only; broken routes ⊥

V56: ∀ stocks basket proposal → specialist=`stocks`, authority=`non-binding-advisory`, executionReady=`false`; leg targetWeightBps integer ≥ 1, sum = 10000; missing/invalid leg evidence → basket `NO_DATA`; wallet/custody/pool/allocation/execution field ∉ schema

V57: ∀ stocks canonical basket snapshot → per-asset evidence bytes/hash frozen; Lead & Risk consume identical bytes/hash; provenance ∈ {`synthetic`,`historical`,`live`}; `live` only via a `stocks/` read-only adapter carrying real source identity + dual-time; `dash/` may orchestrate and render it; root plugin emits no live call; missing/invalid/stale/incoherent → `NO_DATA`

V58: ∀ stocks advice run → exactly one Lead call + one independent Risk Review; Risk authority=`veto-only`; `BLOCK`/critical/failure → published `BLOCKED`/`NO_DATA` + proposal `null`; Client Agent owns decision/execution

V59: ∀ stocks advisory response → citations + invalidations + expiry + full basket proposal + risk record; executionReady=`false`; ⊥ pooled custody, capital pooling, ETF issuance, order submission

V60: ∀ stocks capture selection → per-field source precedence selects primary; secondary replaces primary only on typed primary outage + prevalidated semantic equivalence + policy-matching source identity; duplicate source-role/ID, primary/secondary disagreement, or critical missing/invalid → `NO_DATA`

V61: ∀ stocks capture time → provider-event time ≤ local-receipt capture time ≤ basket capture time; selected capture spread ≤ coherence cap; violation → `NO_DATA`

V62: ∀ stocks non-ok capture → carries typed failure metadata (`retryable`, `retryAfterMs` nullable, `reason`); host preserves it; a failing capture never yields a normalized value

V63: ∀ stocks registry → exact-key validated identity + scales + limits + fees + capabilities + corporate-action reference + provenance; per-leg `targetWeightBps` ≤ registry per-asset max-weight cap; invalid/missing critical metadata → `NO_DATA`

V64: ∀ dash live fetch → read-only HTTP GET or public RPC read; ⊥ write/execution/custody/signing/order; secrets from env only, never committed; provider/network/parse failure → typed capture failure → snapshot `NO_DATA`

V65: ∀ dash rendered output → advisory-only, `executionReady: false`; shows council basket/risk/citations + `live` provenance; ⊥ trade/order action or capital instruction

V66: ∀ stocks/prestocks token-2022 scaled-UI mint price evidence → derive live multiplier from extension time-gate (`newMultiplier` when `now ≥ newMultiplierEffectiveTimestamp`, else current `multiplier`); cross-check extension vs `getTokenSupply` uiAmount/raw within 5bps; divide raw pool price by multiplier; corroborate normalized price vs issuer `tokenPrice` within 500bps; zero/malformed/missing multiplier, extension/supply disagreement, or issuer disagreement → typed price capture failure → `NO_DATA`
V67: ∀ MarketIntegrityReport → snapshotHash matches canonical snapshot hash; bound proposal validates against same snapshot; proposal expiry ≤ checkedAt → status `STALE` + refusal `proposal-expired`; hash mismatch → reject.

V68: ∀ integrity evaluation → canonical snapshot `missing` or incomplete source selection → `NO_DATA`; canonical `conflicts` → `DIVERGENT`; snapshot age beyond configured max → `STALE`.

V69: ∀ live Stocks reference without provider source timestamp → freshness=`UNKNOWN`; report never upgrades unknown reference age to fresh evidence.

V70: ∀ Stocklana offline demo → fixture provenance=`synthetic`; healthy, blocked, and stale cases use the same advisory-only path; stale replay publishes no proposal.

V71: ∀ DBC equity launch prescription → program id pinned to Meteora `dynamic_bonding_curve`; equity-grade path requires USDC quote, migration threshold ≥ stock keeper floor, Token-2022 preference, DAMM v2, and equity fee band; meme-grade / below-floor configs fail closed; `executionReady=false`.

V72: ∀ stocks agent process → one bounded stdin JSON request, one stdout JSON line; fixture cases map to `PUBLISHED` / `BLOCKED` / `NO_DATA`; forbidden authority fields reject; no live market call on the agent path; `authority=advisory-only`; `executionReady=false`.

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
T27|~|scaffold isolated `dash/` terminal orchestration over `stocks/` read-only live adapter(s): `live` basket snapshot → stocks council → terminal render; typed failure → `NO_DATA`; verify against synthetic + one real keyless provider|V57,V64,V65,I11
T28|x|add PreStocks scaled-UI multiplier normalization + issuer corroboration in `stocks/prestocks.ts`; fail-closed multiplier parse tests|V66,I10,I11
T29|x|move live Stocks providers and shared evidence contracts from `dash/` to `stocks/`; update callers/tests and preserve terminal rendering|V57,V64,V65,V66,I10,I11
T30|x|add Market Integrity Desk report, proposal binding, expiry gate, refusal statuses, and terminal output|V67,V68,V69,I12
T31|x|add offline Stocklana demo with synthetic healthy/blocked/stale scenarios and judge walkthrough|V70,V67,I12
T32|x|add Meteora DBC equity launch prescription + evaluation desk and offline `stocks:dbc` demo|V71,I14
T33|x|add Stocks Client Agent stdin/stdout surface (`stocks:advice`) with fixture/snapshot modes and contract docs|V72,I13
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
B43|2026-09-16|stocks PreStocks scaled-UI fix cited V66 before spec backprop; `parseScaledUiAccountState` accepted multiplier `0` & silently dropped invalid pending multiplier|V66
B44|2026-09-17|integrity fixture captured fields after basket capture, making every case `NO_DATA` and hiding the intended `DIVERGENT` and `STALE` states|V68
B45|2026-09-17|integrity report accepted expired or cross-snapshot proposal binding before validator and expiry refusal were added|V67
B46|2026-09-17|offline demo labeled synthetic fixtures live and reused published advice during stale replay|V70
