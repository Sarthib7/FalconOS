# NautilusTrader: source-backed patterns for FalconOS

- URL: https://github.com/nautechsystems/nautilus_trader
- Date: 2026-09-10
- Author: Fable 5 research agent (dedicated NautilusTrader study for FalconOS)
- Model: anthropic/claude-fable-5
- Provenance: REPORTED. Distilled from the source; applicability to FalconOS is marked INFERRED.
- Snapshot: shallow clone at `/tmp/falconos-source/nautilus_trader`, commit `96f52ab366932303625f24d4bcbd209bc2e62e6d` ("Fix Derive order queries without venue IDs"). [VERIFIED] `git log -1` in the clone returned this commit. All `path:lines` citations below refer to this commit.
- License of the studied source: LGPL-3.0. [VERIFIED] `head -5 LICENSE` printed "GNU LESSER GENERAL PUBLIC LICENSE / Version 3, 29 June 2007".

## TLDR

NautilusTrader is a Rust core with Python facades for backtest and live trading. Its durable ideas are not Rust ideas. They are contracts: one immutable event stream, exact integer values with explicit precision, a clock injected as a port, a risk gateway in front of execution, venue evidence as the authority during reconciliation, and a simulated venue that occupies the same seam as a real one. FalconOS already follows several of these by instinct (evidence files, integer amounts, honest failure states). This report names the patterns, cites where they live in the source, and marks which ones fit a small TypeScript research CLI now, later, or never.

## Method and coverage

[VERIFIED] I enumerated the repository tree and read `docs/concepts/architecture.md` (741 lines) and `docs/developer_guide/design_principles.md` (187 lines) in full myself. Six parallel read-only subagents studied the message bus, kernel, model types, adapters, backtest engine, risk and execution engines, reconciliation, testkit, cache, persistence, and repository hooks. Their claims below are [REPORTED] with the exact paths and line ranges they cited.
[VERIFIED] I spot-checked four load-bearing citations against the source and all four matched: `crates/model/src/orders/mod.rs:208-239` (transition allowlist), `crates/common/src/msgbus/mstr.rs:24-40` (Pattern/Topic/Endpoint markers), `crates/model/src/types/fixed.rs:83-133` (precision constants), `crates/backtest/src/data_iterator.rs:28-75` (replay key on `ts_init`).
[VERIFIED] I read FalconOS `CONTEXT.md`, `README.md`, `status.md`, `package.json`, `src/types.ts`, `docs/interfaces.md`, `docs/agent-contract.md`, and `plans/roadmap.md` before judging relevance.

## Major concepts

### 1. Event-driven core: one bus, three address kinds

- [REPORTED] `docs/concepts/architecture.md:80-91` and `docs/concepts/message_bus.md:1-16`: a `MessageBus` routes all inter-component traffic. It supports pub/sub broadcast, request/response by correlation ID, and typed point-to-point endpoints. Transport is not recovery; the cache or event store owns recovery.
- [REPORTED] `crates/common/src/msgbus/mstr.rs:24-40`: address kinds are distinct types. Subscription `Pattern` allows `*` and `?`; publish `Topic` and direct `Endpoint` forbid wildcards. The type system makes the address kinds unmixable.
- [REPORTED] `crates/common/src/msgbus/core.rs:815-831` and `crates/common/src/msgbus/api.rs:1346-1365`: request/response registers exactly one handler per correlation ID, rejects duplicates, and removes the handler before dispatch. Reply slots are one-shot.
- [REPORTED] `docs/concepts/architecture.md:460-476`: the core consumes and dispatches on a single thread. Network, logging, and persistence run on separate threads and feed the core through channels.
- [REPORTED] `docs/concepts/message_bus.md:35-53` and `docs/developer_guide/design_principles.md:92-114`: messages are immutable after creation. A transformation produces a new message. Immutability preserves replay, provenance, and audit.
- [INFERRED] FalconOS does not need a bus at its current size. It should keep the two portable rules now: immutable records, and one owner per mutation seam.

### 2. Stated design principles

- [REPORTED] `docs/developer_guide/design_principles.md:10-21`: priority order is reliability, performance, modularity, testability, maintainability, deployability.
- [REPORTED] `design_principles.md:23-60`: data integrity beats availability. Arithmetic overflow, NaN, malformed prices, and negative quantities fail fast at the boundary instead of propagating. One bad price can corrupt sizing, orders, and backtests.
- [REPORTED] `design_principles.md:116-124`: "Distinguish external reports, local observations, inferences, and policy decisions." A timeout must never turn missing evidence into a confirmed outcome. This is the same provenance rule FalconOS already uses in its docs.
- [REPORTED] `design_principles.md:126-145`: controlled nondeterminism (time, randomness, ordering made explicit at boundaries) and bounded resources (queues, retries, and history have explicit budgets and exhaustion behavior).
- [REPORTED] `docs/concepts/architecture.md:490-522`: crash-only design. Release builds abort on panic; an external supervisor restarts; startup and recovery share one code path; venue commands are never blindly retried after a crash.

### 3. Time as a port; timers as data

- [REPORTED] `crates/common/src/clock.rs:46-115` and `crates/system/src/clock_factory.rs:51-85`: every component receives a `Clock` implementation. Backtest gets `TestClock` (manual advance, deterministic), live gets `LiveClock` (monotonic real time). No component calls ambient system time.
- [REPORTED] `crates/common/src/timer.rs:48-78`: a timer firing is a data record, `TimeEvent { name, event_id, ts_event, ts_init }`, ordered deterministically. Scheduled work enters the same event stream as market data.
- [INFERRED] This is the single highest-value pattern for FalconOS backtest/live parity later: pass a clock object into `scan` and the future paper engine, and the same assessment code becomes replayable.

### 4. Data model: exact integers, dual identity, dual timestamps

- [REPORTED] `crates/model/src/types/fixed.rs:83-133` and `docs/concepts/value_types.md:162-189`: `Price`, `Quantity`, and `Money` are scaled integers with explicit precision (64-bit at precision 9, or 128-bit at precision 16). Float constructors are restricted because doubles hold about 15 to 17 significant digits (`fixed.rs:181-198`). A decoder even repairs legacy float-contaminated raw values (`fixed.rs:49-57`).
- [REPORTED] `crates/model/src/identifiers/instrument_id.rs:39-56`: `InstrumentId` is `{symbol, venue}`, serialized `symbol.venue`. `ClientOrderId` (local) and `VenueOrderId` (venue-assigned) are separate types; acceptance records the mapping (`docs/concepts/events/order_accepted.md:13-29`).
- [REPORTED] `crates/model/src/data/quote.rs:40-65` and `docs/concepts/data/index.md:414-470`: every data record carries `ts_event` (when the event occurred at the source) and `ts_init` (when the local object was created). Backtests order by `ts_init`; the delta is a latency measure only when clocks are synchronized.
- [REPORTED] `docs/concepts/data/index.md:993-1028` and `docs/concepts/value_types.md:191-199`: precision is file-level metadata in the catalog; schema changes are handled by explicit export-and-rebuild migrations, not per-record version fields.
- [INFERRED] FalconOS already stores integer amount strings and both request timestamps. The gap is formal: no `{scaledInteger, precision}` value object, and provider identity is not split from local identity in `src/types.ts`.

### 5. Instrument definitions as venue contracts

- [REPORTED] `crates/model/src/instruments/crypto_perpetual.rs:40-105` and `docs/concepts/instruments/index.md:65-122`: an instrument snapshot holds the normalized ID, the venue-native `raw_symbol`, price and size precision, increments, multiplier, lot size, maker and taker fees, limits, adapter metadata, and both timestamps. Construction rejects increment precision that disagrees with declared precision (`crypto_perpetual.rs:108-185`).
- [REPORTED] `docs/concepts/instruments/index.md:181-224`: a wrong definition can truncate values or let a backtest accept orders the live venue rejects.
- [INFERRED] FalconOS analog: the token registry entry (address, decimals, chain) is an instrument definition. Nautilus argues for storing the full executable contract per venue (fee schedule, minimum sizes, route constraints) with capture timestamps, which matches the existing `amountScale` verification annotation and extends it.

### 6. Adapter anatomy and boundary normalization

- [REPORTED] `docs/concepts/adapters.md:3-58` and `docs/developer_guide/adapters.md:131-200`: canonical parts are HttpClient, WebSocketClient, InstrumentProvider, DataClient, ExecutionClient, config, and factory. Only the crate shell is universal; a market-data-only adapter omits execution (`adapters.md:229-232`).
- [REPORTED] `docs/developer_guide/adapters.md:568-603`: wire payloads are typed structs kept separate from domain types. Conversion happens once at an auditable boundary with precision, currency, and `ts_init` passed explicitly. Values must not pass through `f64`.
- [REPORTED] `crates/adapters/hyperliquid/src/http/parse.rs:99-154,778-853`: the venue row is preserved in `raw_data` and the venue symbol in `raw_symbol` beside the normalized projection.
- [REPORTED] `docs/developer_guide/adapters.md:1353-1425`: retries need two gates: transient-error classification and operation safety. Reads may retry; state-changing calls retry only with stable idempotency. Once transmission may have happened, ambiguity is monotonic and recovery moves to query and reconciliation.
- [REPORTED] `docs/developer_guide/adapters.md:1614-1643` and `crates/adapters/kraken/src/config.rs:52-81`: reconnect restores protocol state (auth, subscription intent, sequence state) rather than the socket alone. Kraken adds application-frame idle detection because a transport can look healthy while delivering nothing.
- [REPORTED] `docs/integrations/kraken.md:284-380` and `crates/adapters/hyperliquid/src/common/consts.rs:76-102`: capability is an explicit product-scoped matrix (order types, time in force, batch sizes), declared in code and docs, never inferred from method existence.
- [INFERRED] `src/sources.ts` is already one boundary with raw preservation. The missing pieces are a per-provider capability record and an explicit retry classification (FalconOS currently does no in-scan retries, which is a valid stricter policy).

### 7. Backtest and live parity

- [REPORTED] `docs/concepts/live.md:1-5` and `docs/concepts/architecture.md:143-159`: the same strategy code runs in backtest, sandbox, and live. All three share `NautilusKernel`; environment selects the clock and the clients. Sandbox is real-time data with simulated execution.
- [REPORTED] `crates/backtest/src/engine.rs:270-319`: the simulated exchange registers through the same execution-client port a live venue adapter uses. The venue stand-in occupies the seam, not strategy-side conditionals.
- [REPORTED] `crates/backtest/src/data_iterator.rs:28-75,117-148`: replay merges all streams by a key that starts with `ts_init`, with stable tie rules. Determinism comes from ordering discipline, not luck.
- [REPORTED] `crates/execution/src/models/latency.rs:20-35` and `crates/backtest/src/exchange.rs:822-861`: fills, slippage, and latency are separate pluggable models; commands arrive at `ts_init` plus operation-specific latency.
- [REPORTED] `docs/concepts/live.md:13-27` and `docs/concepts/backtesting/fill-prices-and-matching.md:3-10,162-174`: the docs list non-parity plainly: no market impact, immutable historical books, bars hide intrabar order, transport failures have unknown outcomes only in live. Replay output is model-conditioned evidence, not truth.
- [INFERRED] For FalconOS P2, the paper engine should be a `SimulatedVenue` behind the same interface a live executor would use, fed by recorded scans ordered by observation receipt time, with an explicit fill assumption object stored beside every paper outcome.

### 8. Execution, risk, and reconciliation

- [REPORTED] `docs/concepts/execution/index.md:19-65` and `crates/risk/src/engine/mod.rs:95-112`: submit and modify commands pass Strategy, then RiskEngine, then ExecutionEngine, then the client. Risk is a fail-closed gateway that owns pre-trade validation; cancels bypass it.
- [REPORTED] `crates/risk/src/engine/mod.rs:950-1125,1573-1645,2101-2166`: concrete checks are price and size precision against the instrument, positive prices, quantity min and max, GTD expiry, notional caps per instrument, balance checks, and submit/modify rate throttles. Trading state `ACTIVE`/`REDUCING`/`HALTED` gates what may pass (`docs/concepts/execution/index.md:229-252`). A `bypass` flag exists and is explicit config (`crates/risk/src/engine/config.rs:40-60`).
- [REPORTED] `crates/model/src/orders/mod.rs:14-27,208-299`: orders are event sourced. `OrderStatus::transition` is a match allowlist over (state, event) pairs; anything else returns `InvalidStateTransition`. Replaying the event stream reconstructs the order (`crates/model/src/orders/any.rs:70-103`).
- [REPORTED] `crates/model/src/orders/mod.rs:139-154,841-848` and `docs/concepts/execution/policies.md:38-63,111-120`: idempotency is deliberately narrow. Duplicate fills are rejected by `trade_id`; stale submits are skipped; there is no global exactly-once claim. Ambiguous command outcomes are resolved by reconciliation, not retries.
- [REPORTED] `docs/concepts/execution/reconciliation.md:229-300`: at startup, adapters return order, fill, and position reports which "represent external reality." Reconciliation processes orders first, then fills, then positions, infers missing events, creates external orders for unknown venue orders, and blocks strategy start until done. Runtime reconciliation then polls open state and audits continuously (`reconciliation.md:391-463`).
- [REPORTED] `docs/concepts/execution/reconciliation.md:309-337`: with incomplete history, fills project onto order status only; economic effects require complete coherent evidence. Status recovery is cheaper to trust than money.
- [INFERRED] FalconOS P2/P3 should copy the shape: policy gate before any executor, an allowlist FSM for candidate and (later) order states, venue receipts as the only authority for outcomes, and reconciliation before any new action after a restart.

### 9. Testing and operational state

- [REPORTED] `docs/developer_guide/testing.md:35-44`: "Start at the lowest layer that proves what matters; climb only when the layer below stops detecting regressions." Taxonomy: unit, parameterized, property, integration, acceptance, deterministic simulation.
- [REPORTED] `docs/developer_guide/testing.md:272-276` and `crates/testkit/src/cache.rs:44-180`: stubs over mocks. The testkit ships a hand-written controllable double that implements the production port, with seeded state and switchable failures. The subject under test is never mocked.
- [REPORTED] `crates/model/src/types/price.rs:1699-1800` and `crates/model/proptest-regressions/types/price.txt:1-10`: property tests generate valid values plus named boundaries and assert exact round trips; shrunk counterexamples are committed and replayed forever.
- [REPORTED] `docs/concepts/cache.md:1-23,127-140,184-186`: the cache is the in-memory read API for components; the database backing is recovery only. The restart contract enumerates exactly what is restored (instruments, accounts, orders, positions) and what is not (bounded market history). `flush_on_start` makes destructive clean starts opt-in.
- [REPORTED] `docs/concepts/logging.md:1-11,93-103` and `crates/common/src/logging/logger.rs:300-326,488-525`: logs are structured records (timestamp, trader ID, level, component, message, custom fields) written by a dedicated thread, with per-component filters and JSONL output. No generic rate-limiting primitive was found in the cited sources; do not attribute one to this repo.
- [REPORTED] `.pre-commit-config.yaml:115-123,214-345` and `AGENTS.md:16-25,35-53`: project-specific invariants run as named hooks: secret scanning, banned APIs, logging conventions, deterministic-simulation path bans, workspace-to-test-inventory reconciliation. Contributor rules ban test-only production branches and test weakening; validation evidence must tie to the exact tested revision.

## Do and don't guidance

Do:

1. Fail fast on malformed numeric input at the boundary; never let a suspect value propagate (`design_principles.md:23-60`).
2. Keep raw provider payloads verbatim beside the normalized projection (`crates/adapters/hyperliquid/src/http/parse.rs:99-154`).
3. Give every record two timestamps with defined meanings, and order replay by the local one (`docs/concepts/data/index.md:414-470`).
4. Express state machines as explicit (state, event) allowlists that reject everything else (`crates/model/src/orders/mod.rs:208-299`).
5. Publish a restart contract: what survives, what rebuilds, what is gone (`docs/concepts/cache.md:127-140`).
6. Declare provider capabilities as data, per product, with limits (`docs/integrations/kraken.md:284-380`).
7. Treat missing evidence as missing; a timeout confirms nothing (`design_principles.md:116-124`).
8. Commit shrunk property-test counterexamples as permanent regressions (`crates/model/proptest-regressions/types/price.txt:1-10`).

Don't:

1. Don't route exact amounts through binary floats, even once (`docs/developer_guide/adapters.md:586-603`).
2. Don't retry a state-changing external call without stable idempotency; reconcile instead (`docs/developer_guide/adapters.md:1353-1425`).
3. Don't infer capability from an endpoint or method existing (`docs/developer_guide/adapters.md:830-831`).
4. Don't let strategy or research code branch on environment; swap implementations at the composition seam (`crates/backtest/src/engine.rs:270-319`).
5. Don't overwrite local identity with provider identity; store both and map them (`docs/concepts/events/order_accepted.md:13-29`).
6. Don't present simulation output as live-equivalent; store the model assumptions beside the result (`docs/concepts/backtesting/fill-prices-and-matching.md:162-174`).
7. Don't add test-only branches to production code, and don't weaken a failing test to pass (`AGENTS.md:16-25`).
8. Don't trust a healthy transport as a healthy feed; watch data freshness separately (`crates/adapters/kraken/src/config.rs:52-81`).

## FalconOS mapping (all INFERRED)

| Nautilus pattern | FalconOS today | Candidate target |
| --- | --- | --- |
| Fixed-point `{raw, precision}` values | Integer strings plus `amountScale` on `Scan` | `src/types.ts`: an `Amount` object `{units: string, decimals: number, asset}`; arithmetic helpers in `src/scan.ts` |
| Dual timestamps `ts_event`/`ts_init` | `startedAt`, `receivedAt`, `providerTimestamp` exist | `src/types.ts`: document semantics; keep provider time separate from local receipt in freshness checks (`src/scan.ts`) |
| Instrument definition snapshot | Registry addresses plus historical RPC capture | `src/sources.ts` registry entry: add fee, minimum size, and capture provenance fields per venue |
| Adapter boundary with raw preservation | `Observation.raw` already verbatim | Keep; add per-provider capability record in `src/sources.ts` |
| Retry classification | No in-scan retries (stricter) | Keep policy; if retries arrive, gate on idempotent GET only (`src/sources.ts`) |
| Candidate/order FSM allowlist | REJECT/REVIEW/UNAVAILABLE computed once | `src/scan.ts`: encode allowed transitions when candidates become long-lived (P2) |
| Clock as a port | `assessedAt` captured after collection | New `src/clock.ts` at P2; inject into scan and paper engine for replayable assessment |
| SimulatedVenue at the executor seam | No executor yet | New `src/paper.ts` at P2 implementing the same interface as the future live executor |
| Risk gateway before execution | `executionReady: false` everywhere | New `src/policy.ts` at P2/P3: precision, notional cap, inventory, and state checks before any executor call |
| Reconciliation before action | Not applicable yet | P3: startup step that queries venue state before any new leg; venue receipts are authority |
| Restart contract | Evidence files durable; scans immutable | `docs/interfaces.md`: one section listing restored vs rebuilt vs ephemeral state |
| Structured JSONL logs with component field | CLI emits JSON lines | `src/cli.ts`: add `component` field; keep one line per record |
| Named policy checks in CI | typecheck plus 59 tests | `package.json` scripts: evidence-schema check, banned-import check (no wallet/signing libs), vocabulary check for candidate states |
| Property tests with committed regressions | Example-based tests only | `test/`: hand-rolled generative cases for amount parsing and leg matching; store failing seeds as fixtures |

## Adopt, defer, reject (INFERRED)

- Adopt now: amount value object; timestamp semantics doc; per-provider capability record; restart contract section; component field in log lines; named policy checks; committed regression fixtures; explicit non-parity caveats stored beside any paper result.
- Defer to P2/P3: injected clock; paper venue behind the executor seam; fill and latency assumption objects; policy gateway; candidate FSM allowlist; reconciliation step; monotonic run sequence for an append-only decision log.
- Reject at current scale: message bus and actor registries; Redis or Postgres cache backing; Parquet or Arrow catalog; event-store crate; component lifecycle FSM with eleven states; crash-only supervisor setup. Each solves a volume or concurrency problem FalconOS does not have; a single-process CLI with JSON files is the proportionate design.

## Risks

1. Pattern overweight. Nautilus is a framework serving many venues and users. Copying its structure into a one-pair research CLI would add seams with no load. Adopt contracts, not crate layouts.
2. Docs versus code drift. The design principles page states the policies "do not establish that every existing path already conforms" (`design_principles.md:5-6`). Treat doc claims as intent; the cited code lines are the stronger evidence.
3. Concurrency model mismatch. Nautilus assumes a single-threaded core with channel-fed background threads. Node's event loop is close but not identical; reentrancy warnings (`docs/concepts/message_bus.md:105-113`) translate to "do not mutate scan state inside a provider callback," not to their exact mechanism.
4. Simulation trust. Every backtesting caveat in section 7 applies harder to quote-based FX research: quotes are not fills, books move, and FalconOS must keep `netProfitUsdc: null` until real costs and outcomes exist.
5. Scout relay. Most citations were gathered by subagents. I spot-checked four and all matched, but the remainder are [REPORTED], not independently verified line by line.

## License notes

- [VERIFIED] The root `LICENSE` is LGPL-3.0 (header read directly). Adopting architectural patterns, contracts, and ideas described in this report does not copy source code and does not create an LGPL obligation. Copying code, types, or substantial doc text into FalconOS would. Do not vendor Nautilus code.
- [VERIFIED] A `TRADEMARK.md` exists at the repo root (seen in the tree listing; content not read). Do not use the NautilusTrader name or marks in FalconOS branding without reading it first.

## Not fetched

Not read in this study: the `python/nautilus_trader` facade internals; adapters other than Hyperliquid and Kraken (Tardis, Polymarket, dYdX, Interactive Brokers, and others); `network`, `cryptography`, `indicators`, `analysis`, and DeFi-feature code paths; `docs/concepts/dst.md`, `networking.md`, and most integration docs; `RELEASES.md`, `SECURITY.md`, `TRADEMARK.md` content, `Makefile`, and CI workflow files; test suites at large beyond the cited files. The clone is shallow, so no claims rest on commit history. No network fetches beyond the clone itself; all reading was local.

## Rules to adopt

1. Parse exact amounts from decimal strings into scaled integers with an explicit decimals field; never construct them through a float (`crates/model/src/types/fixed.rs:181-198`).
2. Reject a value whose precision disagrees with its instrument definition at the boundary, before it enters assessment (`crates/model/src/instruments/crypto_perpetual.rs:108-185`).
3. Record two timestamps on every observation: source event time and local creation time, each with a documented meaning (`docs/concepts/data/index.md:414-435`).
4. Order any replay or comparison by local creation time with a stable tie rule (`crates/backtest/src/data_iterator.rs:28-75`).
5. Keep the raw provider payload verbatim and immutable beside the normalized projection (`docs/developer_guide/adapters.md:568-579`).
6. Convert wire data to domain data exactly once, at one named boundary per provider (`docs/developer_guide/adapters.md:568-603`).
7. Store provider identity and local identity as separate fields and record their mapping when the provider first acknowledges (`docs/concepts/events/order_accepted.md:13-29`).
8. Declare each provider's capabilities and limits as data in the adapter, and validate requests against that record (`docs/integrations/kraken.md:284-380`).
9. Retry only idempotent reads; treat an ambiguous state-changing call as unknown and resolve it by querying, never by resending (`docs/developer_guide/adapters.md:1353-1425`).
10. Watch data freshness independently of connection health, and reconnect when an open stream goes silent (`crates/adapters/kraken/src/config.rs:52-81`).
11. Treat all records as immutable after creation; corrections are new records that cite the old one (`design_principles.md:92-114`).
12. Tag every derived fact with its evidence class: external report, local observation, inference, or policy decision (`design_principles.md:116-124`).
13. Never let a timeout or retry exhaustion produce a confirmed outcome; missing stays missing (`design_principles.md:118-121`).
14. Encode long-lived state as an allowlist of (state, event) transitions and reject every unlisted pair (`crates/model/src/orders/mod.rs:208-299`).
15. Put a fail-closed policy gate in front of any future executor; checks include precision, bounds, notional caps, and an explicit operating state (`crates/risk/src/engine/mod.rs:95-112,2101-2166`).
16. Give the bypass of any safety gate its own named config flag so it can never happen implicitly (`crates/risk/src/engine/config.rs:40-60`).
17. Build the paper executor behind the same interface as the live one, and select it at composition time (`crates/backtest/src/engine.rs:270-319`).
18. Store the fill, cost, and latency assumptions beside every simulated outcome, and label the outcome as model-conditioned (`docs/concepts/backtesting/fill-models.md:3-25`; `fill-prices-and-matching.md:162-174`).
19. Before any post-restart action, reconcile against the external system and treat its receipts as the authority for outcomes (`docs/concepts/execution/reconciliation.md:229-300`).
20. Apply economic effects only on complete coherent evidence; with partial history, recover status but not money (`docs/concepts/execution/reconciliation.md:309-337`).
21. Inject a clock into every component that reads time, so tests and replays control it (`crates/system/src/clock_factory.rs:51-85`).
22. Publish a restart contract that enumerates restored, rebuilt, and ephemeral state, and make destructive clean starts opt-in (`docs/concepts/cache.md:127-186`).
23. Prefer hand-written controllable stubs that implement the production interface over mocks, and never mock the subject under test (`docs/developer_guide/testing.md:272-276`; `crates/testkit/src/cache.rs:44-180`).
24. Test at the lowest layer that proves the behavior, and climb only when that layer stops catching regressions (`docs/developer_guide/testing.md:35-36`).
25. Turn each project invariant into a small named automated check, and keep every discovered counterexample as a permanent fixture (`.pre-commit-config.yaml:214-345`; `crates/model/proptest-regressions/types/price.txt:1-10`).
