# hftbacktest: source study for FalconOS

- URL: https://github.com/nkaz001/hftbacktest
- Date: 2026-09-10
- Author: FalconOS research agent (Fable 5), delegated by root
- Model: anthropic/claude-fable-5
- Provenance: REPORTED. Distilled from the source; applicability to FalconOS is marked INFERRED.
- Source snapshot: [VERIFIED] commit `5f3ec40b2afb764e0fea112f941ed85523ef4e88` (2025-12-23), full clone at `/tmp/falconos-source/hftbacktest`, `git status` clean, matches `origin/master`.

## TLDR

hftbacktest is a Rust and Python backtesting framework for high frequency and market making strategies. Its core claim: a backtest is only evidence when it models feed latency, order latency, queue position, and fills from full order book and trade data, and when its results reproduce live results for the same period. [REPORTED] The parts FalconOS can use now are the two-timestamp event model, data validation rules, the explicit fill conditions that separate a quote from a fill, signed fee accounting, and the documented limits of replay evidence. [INFERRED] The queue models, book reconstruction, and live connectors solve an order book problem FalconOS does not have in its current quote-level slice; defer them. Nothing in the source supports live execution from quote observations alone.

## Major concepts

### 1. Two timestamps per event, and replay order

Every event carries `exch_ts` (when it happened at the venue) and `local_ts` (when the local process received it). [REPORTED] `hftbacktest/src/types.rs:311-331` defines the `Event` struct; `docs/data.rst:13-20` documents the eight fields. Feed latency is the difference between the two timestamps.

Events can arrive out of order: an event with an earlier exchange timestamp can arrive locally after a later one. The framework splits each such event into an `EXCH_EVENT` view and a `LOCAL_EVENT` view so each processor replays in its own correct order. [REPORTED] `hftbacktest/src/types.rs:184-189` defines the flags; `docs/data.rst:204-248` shows the reordering example and the corrected stream.

Validation rules stated in `docs/data.rst:204-223`: [REPORTED]
- All timestamps must be in chronological order per view.
- The exchange timestamp must be earlier than the local timestamp; feed latency must be positive.
- Negative latency signals clock skew between sites; fix it with better time sync or a base latency offset, and keep the correction explicit.

`py-hftbacktest/hftbacktest/data/validation.py:16-50` implements `correct_local_timestamp` (shifts all local timestamps by the worst observed negative latency plus a base latency), `:53-136` implements `correct_event_order`, and `:139-152` implements `validate_event_order`, which raises on out-of-order events rather than silently fixing them. [REPORTED]

### 2. Three latencies, modeled separately

`docs/latency_models.rst:12-26` names three latencies: feed latency, order entry latency (send to matching engine), and order response latency (matching engine to local receipt). [REPORTED]

Models in `hftbacktest/src/backtest/models/latency.rs`: [REPORTED]
- `ConstantLatency` (`:22-55`): fixed values.
- `IntpOrderLatency` (`:73-274`): interpolates between rows of real measured latency data (`req_ts`, `exch_ts`, `resp_ts` per probe order). The docs call this the most accurate provided model and say you can collect the data by regularly submitting unexecutable orders (`docs/latency_models.rst:43-47`).
- Negative latency encodes rejection: a zero exchange timestamp in the latency data marks a venue-side failure window, and the model returns a negative value meaning "the order never reached the matching engine; here is when you learn of the rejection" (`latency.rs:79-86, 195-215`). `hftbacktest/src/backtest/order.rs:135-156` turns that into a rejection response on the local bus.

The order bus assumes in-order delivery and documents that this is a simplification: real REST paths can reorder requests (`order.rs:25-33`). [REPORTED] The roadmap keeps "different latencies for place, modify, cancel, response, fill" as open work (`ROADMAP.md:22`). [REPORTED]

### 3. Queue position models

When a venue provides only Market-By-Price (L2), your resting order's queue position must be estimated. [REPORTED] `docs/order_fill.rst:94-170` and `hftbacktest/src/backtest/models/queue.rs`:
- `RiskAdverseQueueModel` (`queue.rs:42-96`): most conservative. Cancellations are assumed to happen behind you; only trades at your price advance you.
- `ProbQueueModel` (`queue.rs:130-217`): splits observed quantity decreases between ahead-of-you and behind-you using a probability `f(back) / (f(back) + f(front))`, with power and log variants (`queue.rs:219-330`). Trade quantity is subtracted from book-change quantity to avoid double counting (`queue.rs:134-138, 181-205`).
- Boundary conditions the probability function must satisfy: probability 0 at the queue head, 1 at the tail (`docs/order_fill.rst:163-168`).
- `L3FIFOQueueModel` (`queue.rs:473-489`): with Market-By-Order data the queue is explicit, but the docstring warns that venues with pro-rata or exotic matching still need a different model (`queue.rs:473-479`).

A fill of a resting order at the touch requires the front queue to be consumed; `is_filled` returns quantity only when the estimated front quantity has gone negative in lot units (`queue.rs:86-95, 207-216`). [REPORTED]

### 4. Fill models and the no-market-impact assumption

`docs/order_fill.rst:8-18` states the base assumption plainly: replay cannot be changed by your orders, so no market impact exists, and your order must be small enough for that to hold. The final arbiter is live comparison. [REPORTED]

Two exchange models (`docs/order_fill.rst:20-92`): [REPORTED]
- `NoPartialFillExchange` (`hftbacktest/src/backtest/proc/nopartialfillexchange.rs:39-63`): a resting buy fills only when your price is above the trade price, or you are at the front of the queue and price equals the trade price, or your price crosses the best ask. Taking liquidity fills fully at the best regardless of displayed quantity, which the docs flag as unrealistic for size.
- `PartialFillExchange` (`hftbacktest/src/backtest/proc/partialfillexchange.rs:39-77`): fills a resting order by remaining trade quantity at your level; supports GTC, GTX, FOK, IOC. Its docstring repeats the rule of thumb: make backtest results match live results.

Fill triggers are event-driven: each replayed trade event checks resting orders via `check_if_buy_filled` / `check_if_sell_filled` (`nopartialfillexchange.rs:114-162`). Post-only (GTX) orders that would cross expire instead of filling (`nopartialfillexchange.rs:323-329`); FOK and IOC that cannot execute expire (`:361-365`). Order statuses are a closed enum: New, Expired, Filled, Canceled, PartiallyFilled, Rejected, Replaced (`hftbacktest/src/types.rs:395-407`). [REPORTED]

### 5. Fees, asset types, and accounting

`hftbacktest/src/backtest/models/fee.rs`: [REPORTED]
- `CommonFees { maker_fee, taker_fee }` (`:5-21`); fee models per trading value, per trading quantity, and flat per trade (`:52-153`); `DirectionalFees` for charges like stamp duty that depend on side (`:23-44`).
- Fee selection depends on whether the fill was maker or taker, recorded on the order (`types.rs:515-516`).

`hftbacktest/src/backtest/assettype.rs:1-54` separates linear and inverse contract accounting behind one `AssetType` trait. `hftbacktest/src/backtest/state.rs:37-56` books every fill into position, balance, fee, trade count, volume, and value in one place (`apply_fill`), and computes equity from mid price. [REPORTED]

### 6. Market depth structures and data fusion

Four interchangeable book implementations behind one `MarketDepth` trait (`hftbacktest/src/depth/mod.rs:3-6, 26-61`): HashMap, BTree, an ROI vector limited to a price range of interest for speed (`roivectormarketdepth.rs:10-14`), and `FusedHashMapMarketDepth` (`fuse.rs:23-35`), which merges streams of different update frequency and depth range by stamping every level with the timestamp of its last update and discarding stale conflicting updates (`fuse.rs:75-93`). [REPORTED] The roadmap lists fusion as done, for "the most frequent and granular data using different streams" (`ROADMAP.md:15`). [REPORTED]

### 7. Collect your own data

The `collector/` crate records raw exchange websocket feeds (trades, book ticker, full depth) to files with local receipt timestamps, per venue, with reconnect logic (`collector/src/main.rs:1-60`, modules per exchange). [REPORTED] The discrepancy guide says to collect data yourself so feed latency reflects your own path, and to measure order latency from your own logs or probe orders (`docs/debugging_backtesting_and_live_discrepancies.rst:13-19`). [REPORTED]

### 8. Metrics for review

`py-hftbacktest/hftbacktest/stats/metrics.py` provides Sharpe (`:78-102`), Sortino (`:105-130`), ReturnOverMDD (`:133-149`), ReturnOverTrade (return divided by traded volume, a fee-sensitivity view, `:152-167`), MaxDrawdown (`:170-193`), trade counts, trading value, position value, and MaxLeverage (`:196-368`). [REPORTED]

### 9. Stated limits of backtest evidence

README (`README.rst:36-52`): backtesting must be accurate rather than merely conservative, because a pessimistic simulation hides small real edges and an optimistic one invents them. The stated validation bar: run live in a period, then backtest that same period and require close agreement, before any deeper research or optimization. [REPORTED]

The discrepancy guide (`docs/debugging_backtesting_and_live_discrepancies.rst:26-36`) names the two main causes of live divergence, latency and queue model, and prescribes: plot live against backtest, start with small size, align results, then scale gradually. [REPORTED]

## Do / don't guidance from the source

Do: [REPORTED, paraphrased from the files cited above]
- Record both venue and local timestamps on every observation; keep both replay orders.
- Validate timestamp ordering and positive latency before using data; make corrections explicit and reversible.
- Model rejection as a first-class outcome with its own notification latency.
- Treat maker and taker fees as different signed numbers; book fees at fill time.
- Keep the queue and latency models swappable; tune them until backtest matches live, per period.
- Prefer conservative queue assumptions when you cannot measure (RiskAdverse exists for this reason).
- Start live comparison at small size; scale only while live and simulated results stay aligned.

Don't: [REPORTED, same sources]
- Don't treat a replayed fill of large size as real; replay has no market impact.
- Don't assume displayed top-of-book quantity is yours to take at size.
- Don't trust external data without checking its feed latency resembles yours.
- Don't skip the live-reproduction check before optimizing a strategy.

## FalconOS mapping

FalconOS today records HTTP quote observations (`src/types.ts:20-29`: request, `startedAt`, `receivedAt`, `httpStatus`, raw, quote, error) and assesses candidate cycles with a 10 second freshness window and integer arithmetic (`src/scan.ts:4, 26-94`). It already refuses to call a quoted difference a profit (`REVIEW` keeps `netProfitUsdc: null`, `executionReady: false`). The mapping below names candidate targets; no FalconOS file was modified.

| # | hftbacktest concept | FalconOS surface (candidate) | Decision |
|---|---|---|---|
| 1 | Two-timestamp events, positive-latency invariant | `src/types.ts` Observation already has `startedAt`/`receivedAt`; add a derived provider-vs-local latency check beside the existing stale and future checks in `src/scan.ts` | Adopt [INFERRED] |
| 2 | `validate_event_order`: fail loudly, correct explicitly | `src/scan.ts` timestamp validation; keep rejection reasons in the record, as F5 already requires | Adopt [INFERRED] |
| 3 | Quote is not a fill; fill needs price crossing or queue consumption | `docs/interfaces.md` REVIEW wording; the P2 paper-cycle design in `plans/roadmap.md` (future `src/paper.ts`) must define paper fill conditions, not assume quote equals fill | Adopt [INFERRED] |
| 4 | Rejection as an outcome with its own latency | P2 paper cycle: model provider failure and partial-leg outcomes as recorded results, matching the existing UNAVAILABLE state | Adopt [INFERRED] |
| 5 | Signed maker/taker and directional fee models | P2 cost model: per-venue fee entries with explicit sign and basis (value, quantity, flat), kept separate from gas, extending the `gasUsd`/`l1FeeUsd` split in `src/types.ts:14-15` | Adopt [INFERRED] |
| 6 | One accounting choke point (`State::apply_fill`) | P2: a single function that books every simulated leg into position, balance, and fees, so reconciliation (CHK-13 to CHK-15) audits one code path | Adopt [INFERRED] |
| 7 | Collect your own latency; probe measurements | Extend the watch loop in `src/cli.ts` to persist per-provider response-time series from data it already records | Adopt, small [INFERRED] |
| 8 | Review metrics: ReturnOverTrade, MaxDrawdown, ReturnOverMDD | P2/P5 review view: report paper outcomes with fee-sensitivity and drawdown, never a bare return | Adopt [INFERRED] |
| 9 | Live-reproduction bar before scaling | CP2 to CP3 gate in `plans/roadmap.md`: require paper predictions to be compared against observed market outcomes for the same window before any live checkpoint | Adopt [INFERRED] |
| 10 | Queue position models (Prob, RiskAdverse, L3 FIFO) | No FalconOS surface: no resting orders exist in the quote slice | Defer [INFERRED] |
| 11 | Order book reconstruction, depth fusion, ROI books | No order book feed in scope; aggregator quotes embed routing | Defer [INFERRED] |
| 12 | Live bot, connectors, IPC | Out of slice; CONTEXT.md F1 forbids transaction requests | Reject for now [INFERRED] |
| 13 | Numba/Rust performance machinery | FalconOS volume is 4 quotes per scan; no need | Reject [INFERRED] |

Boundary note: hftbacktest's evidence domain is central-limit-order-book venues (Binance, Bybit, Hyperliquid perps). FalconOS quotes come from AMM aggregators (Jupiter, KyberSwap), where execution price is set by pool state and MEV, not queue priority. The transferable material is the epistemics (timestamps, validation, fills versus quotes, fee sign, live reproduction), not the microstructure models themselves. [INFERRED]

## Risks

1. [INFERRED] Misapplied analogy: importing CLOB queue or fill models into an AMM quote pipeline would create false precision. Only the evidence discipline transfers.
2. [REPORTED] The framework itself warns that partial fills and liquidity taking are unrealistic at size (`docs/order_fill.rst:16-18, 43-45, 82-87`); any FalconOS paper fill at quoted size inherits the same unproven-impact caveat.
3. [REPORTED] Order bus assumes in-order request delivery (`order.rs:30-33`); real paths reorder. FalconOS sequential two-leg cycles have the same unmodeled interleaving risk.
4. [INFERRED] Latency and queue parameters are tuned to match live results per venue and period; they drift. Any adopted threshold (like the 10 second window) needs periodic re-measurement.
5. [REPORTED] Roadmap items still open include per-action latencies and more queue models (`ROADMAP.md:17, 22`); the framework is active and its abstractions may change.

## License notes

[VERIFIED] `LICENSE:1-21` is the MIT License, copyright 2022 nkaz001@protonmail.com. Copying substantial code requires keeping the copyright and permission notice. This report copies concepts and cites paths only; no source code was copied into FalconOS. `py-hftbacktest/LICENSE` is an empty file (0 bytes) in this snapshot; the root LICENSE governs the repository.

## Read and not fetched

Read in full or in cited ranges: [VERIFIED, local reads at commit `5f3ec40`] `README.rst`, `ROADMAP.md`, `LICENSE`, `docs/index.rst:1-123`, `docs/data.rst:1-300`, `docs/latency_models.rst`, `docs/order_fill.rst`, `docs/debugging_backtesting_and_live_discrepancies.rst`, `hftbacktest/src/types.rs` (structure plus `:150-300, 391-436, 487-563`), `backtest/mod.rs` (structure), `backtest/order.rs` (structure plus `:119-175`), `backtest/state.rs`, `backtest/assettype.rs`, `backtest/models/{latency,queue,fee}.rs` (structures plus cited ranges), `backtest/proc/local.rs` (structure), `backtest/proc/nopartialfillexchange.rs` (`:39-166, 313-383`), `backtest/proc/partialfillexchange.rs` (`:38-103`), `depth/mod.rs` (structure), `depth/fuse.rs:1-83`, `depth/roivectormarketdepth.rs:1-63`, `py-hftbacktest/hftbacktest/data/validation.py` (structure), `py-hftbacktest/hftbacktest/stats/metrics.py` (structure), `collector/src/main.rs:1-60`.

Not fetched: the Jupyter notebooks under `examples/` and `docs/tutorials/` (binary-heavy; titles and README summaries were read instead), `hftbacktest/src/live/` internals, `connector/src/` internals beyond the file list, `hftbacktest/src/backtest/proc/l3_*.rs` bodies, `queue.rs:592-1366` (L3 FIFO body and tests), depth implementation bodies beyond cited headers, `docs/data.rst:301-519`, the hosted readthedocs site, and the sample data host. Claims about those areas rely on in-repo docstrings and the roadmap. FalconOS `status.md:301-351` and `docs/agent-contract.md:301-404` tails were also not read; the read portions cover the contract shape used here.

## Rules to adopt

Each rule is [INFERRED] application of [REPORTED] source practice, cited above.

1. Record a venue timestamp and a local receipt timestamp on every observation; never collapse them into one.
2. Require venue timestamp <= local receipt time; treat violations as clock skew, record the correction, and keep the raw value.
3. Validate event ordering before assessment; fail loudly on out-of-order data instead of silently sorting.
4. Keep every correction explicit in the evidence record; a corrected record must say what changed and why.
5. Treat a quote as an observation of displayed state, never as a fill; only a defined fill condition converts one into an outcome.
6. Define paper fill conditions in writing before P2: what must cross, what must be consumed, and at what timestamp the fill books.
7. Model rejection and partial completion as first-class recorded outcomes with their own notification timing.
8. Assume sequential requests can complete out of order; design two-leg accounting to survive interleaving.
9. Book every simulated fill through one accounting function covering position, balance, and fees, so reconciliation audits one path.
10. Store fees as signed values with an explicit basis (per value, per quantity, or flat) and an explicit maker or taker role; never fold fees into prices.
11. Keep gas, venue fees, and price impact as separate cost lines; a missing cost line means the net result stays null.
12. Measure your own request latency from your own records; do not borrow another site's latency numbers without checking they match.
13. Re-measure any freshness threshold (like the 10 second window) periodically instead of trusting an old calibration.
14. When you cannot measure a parameter, choose the conservative model and label it as the conservative choice.
15. Before any live checkpoint, require that paper predictions for a window were compared against observed outcomes for that same window and agreed within a stated tolerance.
16. Start any live comparison at the smallest viable size; scale only while live and simulated results stay aligned.
17. Never claim a result at a size larger than the size actually evidenced; displayed liquidity does not guarantee execution at size.
18. Report paper outcomes with drawdown and fee-sensitivity metrics (return over traded value), never a bare return number.
19. Keep cost, latency, and fill assumptions swappable behind narrow interfaces so a wrong model is a config change, not a rewrite.
20. Keep an explicit list of what the simulation cannot see (market impact, MEV, inventory, interleaving) attached to every paper result.
21. When merging data from sources with different frequencies, stamp each fragment with its update time and drop stale conflicting updates instead of averaging them.
