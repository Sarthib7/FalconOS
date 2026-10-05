# TensorTrade research report for FalconOS

- URL: https://github.com/tensortrade-org/tensortrade
- Date: 2026-09-10
- Author: Fable 5 research agent (FalconOS session)
- Model: anthropic/claude-fable-5
- Provenance: REPORTED. Distilled from the source; applicability to FalconOS is marked INFERRED.

[VERIFIED] Clone location: `/tmp/falconos-source/tensortrade` at commit `d58afba23deb1fded39793203b7997c3990bb032`, dated 2026-02-09, version `1.0.5-dev` (`tensortrade/version.py:1`). File inventory came from `git ls-files`. All line references below are from files read in this session at that commit.

## TLDR

TensorTrade is a Python framework that composes trading simulations from six swappable environment components, a stream DAG for data, and an order management system (OMS) with exchange, broker, order, wallet, portfolio, and ledger boundaries. [REPORTED] Its strongest ideas for FalconOS are the OMS boundaries: funds locked per order path, a transfer function that raises when a conservation equation fails, a ledger that journals every balance move with a memo, and an order lifecycle with explicit states and release on cancel. These map directly to FalconOS P2 paper accounting (CHK-13 to CHK-15). [INFERRED] Its RL machinery (agents, reward schemes, gym environment) is optional for FalconOS and mostly out of scope. [REPORTED] Its own research docs concede that commission costs erased the agent's profit, which supports FalconOS's cost-complete evidence stance. Reject its global mutable state, its silent NaN masking, and its disabled TLS verification.

## Source snapshot

- [REPORTED] Python >= 3.12 (`setup.py:47`), Apache 2.0 (`setup.py:46`, `LICENSE`). Gymnasium-based environment, optional Ray/RLlib training.
- [REPORTED] Package layout: `tensortrade/env` (generic contracts plus default implementations), `tensortrade/feed` (stream DAG), `tensortrade/oms` (exchanges, instruments, orders, wallets, services), `tensortrade/agents` (bundled DQN/A2C), `tensortrade/stochastic` (synthetic price processes), `tensortrade/data` (CSV download).
- [REPORTED] CI runs `pytest tests/ -m "not rllib"` on Python 3.12 (`.github/workflows/tests.yml:30`).

## Major concepts

### 1. Six-component environment composition

[REPORTED] `TradingEnv` takes exactly six named components: action scheme, reward scheme, observer, stopper, informer, renderer (`tensortrade/env/generic/environment.py:61-96`). Each is an abstract single-method contract: `perform` (`env/generic/components/action_scheme.py:39-50`), `reward` (`reward_scheme.py:26-40`), `observe` (`observer.py:41-55`), `stop` (`stopper.py:28-42`), `info` (`informer.py:27-41`). The step loop is fixed: perform action, observe, compute reward, check stop, gather info, increment clock (`environment.py:152-166`). `components` exposes them as a dict (`environment.py:120-130`), and reset walks that dict calling each component's `reset` (`environment.py:185-190`).

[INFERRED] The lesson is the shape, not the classes: one orchestrator with a fixed step order and small single-responsibility contracts. FalconOS's scan cycle (collect, validate, assess, export) already has this shape in functions. Keep it in functions; do not add a class hierarchy.

### 2. Generic contracts versus default implementations

[REPORTED] `env/generic` holds only abstract contracts; `env/default` holds concrete schemes plus a `create()` factory that wires portfolio, feed, observer, stopper, informer, and renderer with sane defaults (`tensortrade/env/default/__init__.py:17-96`). String registries let callers pass `"bsh"` or `"pbr"` instead of instances (`env/default/actions.py:401-428`, `env/default/rewards.py:331-360`).

[INFERRED] The two-layer split (thin contract module, separate concrete module) fits FalconOS: `src/types.ts` already plays the contract role and `src/sources.ts` the concrete role. The string registry does not fit: FalconOS has two providers and a type union is safer than a name lookup.

### 3. Shared clock injection

[REPORTED] The environment owns one `Clock` (a step counter, `tensortrade/core/clock.py:24-48`) and pushes it into every component at construction (`environment.py:87-88`). The action scheme's clock setter cascades it into the portfolio, all exchanges, and the broker (`env/default/actions.py:66-73`). Orders, trades, and ledger rows all stamp `clock.step` (`oms/wallets/ledger.py:52-62`).

[INFERRED] FalconOS's live-versus-demo timestamp discipline (single `assessedAt` captured after collection) is the wall-clock analog. For P2 paper cycles, adopt the stronger idea: one logical step counter owned by the cycle runner, stamped on every reservation, simulated fill, and ledger row, so replays and reconciliation sort deterministically without trusting wall clocks.

### 4. Data feed as an explicit DAG

[REPORTED] `Stream` nodes hold `inputs`, a `forward()` transform, and a `has_next()` signal (`tensortrade/feed/core/base.py:103-193`). `DataFeed.compile()` gathers edges and topologically sorts them so each tick runs nodes in dependency order (`feed/core/base.py:355-420`, `feed/core/feed.py:26-55`). Source kinds: `IterableStream` (historical arrays), `Sensor` (watch a live object through a lambda, `base.py:269-290`), `Constant`, and `Placeholder` with a `PushFeed` for live pushed data (`feed/core/feed.py:65-120`). Net worth is itself a derived stream summed from wallet streams (`env/default/observers.py:79-85`), and the portfolio updates its performance by listening to the feed (`oms/wallets/portfolio.py:288-319`).

[REPORTED] Naming is load-bearing: streams get `exchange:/SYMBOL/free` style names through `NameSpace` (`env/default/observers.py:39-53`), and `Stream.select` throws `"No stream satisfies selector condition."` when a name lookup fails (`feed/core/base.py:315-318`). Issue #470 in `TESTING_REPORT.md:23-56` records a whole class of user-facing breakage caused by three competing naming conventions.

[INFERRED] Defer the DAG for FalconOS; two providers and one derived assessment do not need toposort. Adopt two of its sub-ideas now: derived values (net worth, deltas) computed from the same recorded inputs every consumer sees, and never selecting data by fuzzy string convention. FalconOS's typed `QuoteRequest`/`Observation` already avoids the naming trap; keep it that way.

### 5. Exchange boundary with injected execution

[REPORTED] `Exchange` is thin: price streams in, `quote_price` and `execute_order` out (`oms/exchanges/exchange.py:57-176`). Execution is an injected service function, so simulated and live execution swap without touching the exchange (`exchange.py:166-173`; simulated service at `oms/services/execution/simulated.py:12-197`). `ExchangeOptions` centralizes per-venue commission, min/max trade size, and min/max price (`exchange.py:23-54`). `quote_price` fails loudly on zero prices and on prices that quantize to zero at the instrument's precision (`exchange.py:127-136`). Slippage is a separate composable model applied to a trade after price selection (`oms/services/slippage/random_slippage_model.py:21-56`).

[INFERRED] This is the cleanest boundary in the repo and matches FalconOS's planned P2/P3 split: a venue adapter that quotes, and an injected executor (paper first, live later behind approval). Adopt `ExchangeOptions` as a per-venue config record in FalconOS: fee rate, min/max size, expected precision. Adopt the loud zero/precision guards; they are the same spirit as FalconOS invariant F2.

### 6. Wallet locks, conservation-checked transfers, and the ledger

[REPORTED] Funds committed to an order are moved into a `locked` map keyed by the order's `path_id` (`oms/wallets/wallet.py:50-133`); wallet exposes free, locked, and total balances separately (`wallet.py:57-80`). `Wallet.transfer` snapshots locked balances before and after, computes a conservation equation, and raises `"Invalid Transfer: ..."` with the full equation when the books do not balance within instrument precision (`wallet.py:314-365`). Every deposit, withdrawal, lock, and unlock commits a `Transaction` row to a `Ledger` with step, source, target, memo, and resulting balances (`oms/wallets/ledger.py:8-64`); the ledger dumps to a DataFrame for audit (`ledger.py:66-88`).

[INFERRED] This is the highest-value transplant for FalconOS P2 (paper cycle, CHK-13 to CHK-15 require all case balances to reconcile and no duplicate actions on restart). Design an append-only ledger of integer token amounts with memos, free/locked balances per (chain, asset), and a transfer function that throws on any imbalance. FalconOS's bigint arithmetic makes the check exact; do not copy tensortrade's `np.isclose` tolerance (`wallet.py:355-356`), which papers over float drift.

### 7. Order lifecycle, path_id, and release

[REPORTED] Orders have five explicit states: PENDING, OPEN, CANCELLED, PARTIALLY_FILLED, FILLED (`oms/orders/order.py:28-38`). Construction locks funds immediately (`order.py:118-126`). `is_executable` checks criteria plus start step; `is_expired` checks an end step (`order.py:170-182`). `fill` decrements remaining by quantity plus commission, so costs are explicit in the accounting (`order.py:244-252`). `complete` can spawn the next order in a multi-leg path through `OrderSpec`, reusing the same `path_id` (`order.py:254-275`, `oms/orders/order_spec.py:47-80`). `cancel` and `complete` both funnel into `release`, which walks every wallet and unlocks everything under that `path_id` (`order.py:294-311`). The `Broker` promotes executable orders, cancels expired ones each update, and routes fills, including submitting the next leg of a path (`oms/orders/broker.py:73-123`). Order criteria compose with and/or/xor/not plus Limit, Stop, and Timed (`oms/orders/criteria.py:26-218`).

[INFERRED] `path_id` is the idempotency spine: one ID ties a two-leg arbitrage's reservations, fills, and releases together. FalconOS should give each paper cycle one ID that appears on every reservation, simulated fill, ledger row, and outcome note, with a single release routine for abort paths. The expiry-cancel sweep maps to FalconOS quote-expiry rejection. The criteria algebra is more than the MVP needs; defer.

### 8. Precision-safe quantities

[REPORTED] `Quantity` couples a Decimal size to an `Instrument` with declared precision; negative sizes beyond precision raise, sub-precision negatives clamp to zero (`oms/instruments/quantity.py:53-62`). `quantize()` rounds to instrument precision (`quantity.py:117-128`); `contain()` clips to exchange limits (`quantity.py:140-169`). Instruments are declared constants with symbol, precision, and name (`oms/instruments/instrument.py:131-161`). Cross-instrument arithmetic raises typed exceptions (`quantity.py:22-27`).

[INFERRED] FalconOS already does better with bigint base units and a verified decimals registry. The transferable idea is the typed pairing: never pass a bare amount; pass amount plus asset plus chain so mixed-asset arithmetic cannot typecheck. FalconOS `src/types.ts` carries strings today; a branded type or a `{ asset, chain, units }` record in the P2 accounting layer would enforce this.

### 9. RL layer (optional for FalconOS)

[REPORTED] `BSH` maps a 2-action space to full-balance moves between a cash and an asset wallet, skipping the order when the source balance is zero (`env/default/actions.py:122-172`). `PBR` (position times price change) is built as its own two-node feed over a price sensor (`env/default/rewards.py:178-217`). The reward scheme observes actions through a listener the action scheme exposes (`actions.py:148-150`, `rewards.py:208-209`). `MaxLossStopper` ends an episode on a drawdown threshold or feed exhaustion (`env/default/stoppers.py:5-33`).

[INFERRED] FalconOS's MVP has no learning loop, so the schemes themselves are out of scope. Two ideas survive without RL: a stop policy as its own small component (FalconOS's three-consecutive-incomplete-scan stop in `src/cli.ts` is already this), and reward-style scalar evaluation of a paper cycle (net outcome per cycle) computed from ledger data rather than ad hoc.

### 10. The project's own negative results

[REPORTED] The README publishes a losing result: the agent beat buy-and-hold only at 0% commission and lost at 0.1% (`README.md:70-78`). The failures tutorial quantifies it: roughly 2,000 trades a month at 0.1% costs $2,000 on a $10,000 account, exceeding the $239 prediction profit (`docs/tutorials/02-domains/track-b-rl-for-traders/02-common-failures.md:9-15,100-118`). It also documents overfitting detection, data leakage rules (time-based splits only, never shift(-1)), non-stationary feature scaling, and walk-forward validation (`02-common-failures.md:236-302`, `docs/tutorials/05-advanced/03-walk-forward.md:42-73`). Sharpe-as-reward tested far worse than PBR (`02-common-failures.md:216-219`).

[INFERRED] This is direct support for FalconOS invariant F3 (net profit unknown until all costs are established) and for keeping `netProfitUsdc: null` until costs are complete. A quoted positive spread with unmodeled fees is the same trap as the 0%-commission agent.

### 11. Testing and repo-state cautions

[REPORTED] Unit tests mirror the package tree (`tests/tensortrade/unit/...`), with a tiny shared harness `assert_op` that compiles a feed and compares full output sequences (`tests/utils/ops.py:7-24`). Integration tests build a full env from synthetic prices and run random-action episodes asserting shapes and completion (`tests/tensortrade/integration/test_end_to_end.py:29-86`). CI excludes RLlib-marked tests (`tests.yml:30`).

[REPORTED] Cautions found in the same repo: `TESTING_REPORT.md` marks issues "RESOLVED" with checkmark tables and twice says tests were "designed to pass" (`TESTING_REPORT.md:51,153`) without pasted run output. `Wallet.ledger` is a class attribute shared across all wallets (`wallet.py:48`). `TradingContext` uses a thread-local context stack with a metaclass that injects config into every component (`core/context.py:45,81-108`, `core/component.py:10-43`). `ObservationHistory` zero-pads short windows and runs `np.nan_to_num` on observations, masking missing data (`env/default/observers.py:136-145`). `data/cdd.py:10` disables TLS certificate verification globally. The clock's `now()` returns wall time unrelated to its step counter (`core/clock.py:28-44`).

[INFERRED] For FalconOS: keep test-directory mirroring and the sequence-comparison harness idea (FalconOS's synthetic provider tests already follow it). Treat the rest as anti-patterns; each conflicts with a FalconOS invariant (F2 validation, F5 visible failure, provenance rules for test claims).

## Do / Don't guidance

Do:
- [INFERRED] Give every multi-leg cycle one path ID and one release routine that frees all reservations on any abort.
- [INFERRED] Journal every balance mutation to an append-only ledger with step, source, target, memo, and post-balances.
- [INFERRED] Make transfers self-checking: recompute the conservation equation and throw with the full equation text on mismatch.
- [INFERRED] Keep venue limits (fee, min/max size, precision) in one options record per venue, checked before any simulated fill.
- [INFERRED] Fail loudly on zero or precision-collapsed prices, as `quote_price` does.
- [INFERRED] Publish negative results in the README the way tensortrade publishes its commission losses.

Don't:
- [INFERRED] Don't add a component class hierarchy, metaclass injection, or string registries for two providers.
- [INFERRED] Don't zero-fill or NaN-mask missing observations; FalconOS F5 requires visible failure.
- [INFERRED] Don't use float tolerance (`np.isclose`) in accounting checks; FalconOS bigints allow exact equality.
- [INFERRED] Don't share mutable state through class attributes or thread-locals; pass the ledger and clock explicitly.
- [INFERRED] Don't ever disable TLS verification for data fetching.
- [INFERRED] Don't write "tests designed to pass" style completion claims without recorded run output.

## FalconOS mapping

| TensorTrade concept | Source | FalconOS target | Decision |
| --- | --- | --- | --- |
| Fixed step loop with small contracts | `env/generic/environment.py:152-166` | keep current function pipeline in `src/cli.ts` / `src/scan.ts` | Adopt shape only |
| Generic/default layering | `env/generic` vs `env/default` | `src/types.ts` (contracts) vs `src/sources.ts` (providers) | Already present; keep |
| ExchangeOptions per venue | `oms/exchanges/exchange.py:23-54` | new `src/venues.ts` (P2): fee, min/max size, decimals per chain/provider | Adopt in P2 |
| Injected execution service | `exchange.py:156-176`, `services/execution/simulated.py` | P2 paper executor module, P3 live executor behind approval | Adopt in P2 |
| Wallet lock/free/total + path_id release | `oms/wallets/wallet.py:50-133`, `order.py:294-311` | new `src/paper.ts` (P2): reservations keyed by cycle ID | Adopt in P2 |
| Conservation-checked transfer | `wallet.py:314-365` | same P2 module; exact bigint equality, throw on imbalance | Adopt, strengthened |
| Ledger journal | `oms/wallets/ledger.py:8-64` | append-only JSON ledger under `data/`, exported like scans via `src/vault.ts` | Adopt in P2 |
| Order state machine + expiry sweep | `order.py:28-38,170-182`, `broker.py:73-97` | P2 cycle states; reuse existing quote `expiresAt` checks in `src/scan.ts` | Adopt states; expiry already present |
| Typed Quantity/Instrument | `oms/instruments/quantity.py` | branded amount type `{ chain, asset, units }` in P2 accounting types | Adopt idea |
| Stream DAG + toposort | `feed/core/base.py:355-420` | none for MVP | Defer |
| PushFeed live placeholders | `feed/core/feed.py:65-120` | possible later streaming collector | Defer |
| Criteria algebra (Limit/Stop/Timed) | `oms/orders/criteria.py` | none for MVP | Defer |
| RL agents, reward schemes, gym env | `agents/`, `env/default/rewards.py` | none; FalconOS uses an external cited-thesis agent | Reject for MVP |
| TradingContext metaclass injection | `core/context.py`, `core/component.py` | none | Reject |
| String component registries | `env/default/actions.py:401-428` | none | Reject |
| NaN masking and zero padding | `env/default/observers.py:136-145` | none; violates F5 | Reject |
| Unverified TLS fetch | `data/cdd.py:10` | none | Reject |
| Stochastic price processes | `stochastic/` | possible labeled synthetic demo data later | Defer, must stay labeled synthetic per F6 |

## Risks

1. [INFERRED] Porting OMS concepts wholesale would import float/Decimal habits and global state into a codebase that is currently exact and dependency-free. Port the invariants, not the code.
2. [REPORTED] The repo's own maintenance signals are mixed: `TESTING_REPORT.md` is dated "2025-01-XX" with unfilled placeholders, and claims are checkmark-styled rather than evidence-quoted. [INFERRED] Treat its architectural ideas as proven by code reading, not its QA claims.
3. [INFERRED] The six-component pattern invites premature abstraction. FalconOS has one environment (the scan/paper cycle); abstract only when a second concrete implementation exists.
4. [INFERRED] TensorTrade simulates fills from a single mid price plus commission and optional random slippage; it has no depth model. Its paper results overstate fill quality, which is exactly FalconOS's `SEQUENTIAL_QUOTES_NOT_FILLS` caveat. Do not let a ported paper executor upgrade REVIEW candidates to anything stronger.
5. [INFERRED] RL framing leaks into vocabulary (reward, episode, agent). FalconOS's agent is an external cited-thesis process; reusing RL words would blur the authority boundary in `docs/agent-contract.md`.

## License notes

- [REPORTED] Apache License 2.0 (`LICENSE`, `setup.py:46`, README badge). Copyright headers name "The TensorTrade Authors" (2019 to 2025 across files).
- [INFERRED] Apache 2.0 is permissive and compatible with FalconOS's private repo. FalconOS plans to port concepts, not copy code; no attribution obligation attaches to independently written TypeScript. If any code is translated closely, retain the Apache 2.0 notice for that portion and note the NOTICE requirements. Apache 2.0 also grants an express patent license, which pure idea reuse does not need.

## Not fetched

- [REPORTED] Not read in full: `tensortrade/agents/*` bodies (DQN, A2C, parallel DQN), `tensortrade/stochastic/*` process bodies, `env/default/renderers.py` and `informers.py` bodies, `feed/api/*` operator implementations (rolling, ewm, expanding), `docs/EXPERIMENTS.md`, example notebooks, most unit test bodies, `contrib/`, `CHANGES.md`, `COMPATIBILITY.md`. Their structure was enumerated; their internals are summarized only where a read is cited.
- [REPORTED] No GitHub issues, pull requests, or web pages were fetched. All claims come from the pinned clone at commit `d58afba`. Issue numbers cited (#470, #382, #459) come from `TESTING_REPORT.md` inside the repo, not from GitHub.
- [VERIFIED] No FalconOS source, tests, package files, status, or existing docs were modified. This report is the only file written.

## Rules to adopt

1. One ID per multi-leg cycle; stamp it on every reservation, fill, ledger row, and note.
2. One release routine frees every reservation under a cycle ID on any abort path.
3. Every balance mutation appends a ledger row: step, source, target, memo, amount, post-balances.
4. The ledger is append-only; reconstruction and audit read it, nothing rewrites it.
5. Transfers recompute a conservation equation and throw with the full equation text on mismatch.
6. Accounting equality is exact bigint comparison; no epsilon tolerance in balance checks.
7. Free, locked, and total balances are three separate reads; never report locked funds as available.
8. Commission and fees enter the same accounting rows as principal; never net them silently.
9. Per-venue limits live in one options record: fee rate, min size, max size, decimals.
10. Reject any simulated fill outside venue limits before it touches balances.
11. Fail loudly on zero prices and on prices that collapse to zero at declared precision.
12. Amounts travel as typed records (chain, asset, units); bare numbers do not cross module boundaries.
13. Cycle state is an explicit enum; every transition is stamped with the logical step counter.
14. Expired quotes cancel pending work in a sweep; expiry never passes silently.
15. Paper fills are labeled as simulations; they never upgrade a candidate past REVIEW.
16. Missing data stays visible as errors; never zero-fill, pad, or NaN-mask observations.
17. Derived metrics (net worth, deltas) compute from recorded inputs, never from a second source.
18. Data selection uses typed identifiers, never suffix or substring matching on names.
19. Evaluation splits are time-ordered; later data never informs earlier decisions.
20. Publish negative results with the same prominence as positive ones.
21. Completion claims quote recorded run output; "designed to pass" style claims are banned.
22. Shared state (ledger, clock, config) is passed explicitly; no class-level or thread-local globals.
23. TLS verification stays on for every fetch, no exceptions.
24. Abstract a component only when a second concrete implementation exists.
