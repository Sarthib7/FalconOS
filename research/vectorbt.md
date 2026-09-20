# vectorbt: source study for FalconOS

- URL: https://github.com/polakowo/vectorbt
- Date: 2026-09-10
- Author: sarthi (via dedicated research agent)
- Model: anthropic/claude-fable-5
- Provenance: REPORTED. Distilled from the source; applicability to FalconOS is marked INFERRED.
- Studied commit: `34b6d5935e3ea3eccd549e2592bc0f455b8045f5` (2026-08-02), clean local clone at `/tmp/falconos-source/vectorbt`.

## TLDR

[REPORTED] vectorbt is a vectorized backtesting library. It packs many strategy configurations into wide 2D arrays, runs compiled kernels (Numba, optional Rust) over them, and stores events as sparse structured records. Its own code states that an accepted simulated order becomes a `Filled` record with no venue acknowledgement, and its README calls the software educational (`vectorbt/portfolio/nb.py:65-68`, `README.md:288-292`).

[INFERRED] FalconOS should adopt vectorbt's schema and provenance patterns locally in TypeScript: typed rejection reasons, an append-only attempt log separate from accepted events, sparse event records, a pure accounting state transition for the planned paper cycle, and strict label alignment. FalconOS should not adopt float money math, OHLC stop inference, or the sweep engine now. A separate Python research engine using vectorbt directly is a defer decision: justified only when FalconOS starts historical strategy sweeps (roadmap P4 and later), and only after a license review because of the Commons Clause.

## Verification scope

[VERIFIED] I read directly: `README.md` (full), `LICENSE.md:1-43`, `vectorbt/portfolio/nb.py:1-123`, enum declarations in `vectorbt/portfolio/enums.py` (grep-located), and the repository file inventory (297 tracked files). The clone at the studied commit has a clean work tree.

[REPORTED] Four read-only scout subagents read the portfolio, signals, indicators, base, records, generic, data, returns, settings, dispatch, Rust, benchmark, and CI files and returned line-cited findings. All line ranges below tagged [REPORTED] come from those reads. I spot-checked several against the files I read myself; I did not re-read every cited range.

## Major concepts

### 1. Columns as configurations

[VERIFIED] The README states the approach: "instead of looping through bars one strategy at a time, it packs thousands of configurations into NumPy arrays" (`README.md:49`). [REPORTED] The indicator pipeline allocates one wide output of shape `(rows, input_columns * parameter_values)` and labels each block with parameter index levels above asset columns (`vectorbt/indicators/factory.py:1729-1762`, `1885-2008`). Tests confirm two 2-value parameters over three assets produce 12 ordered columns (`tests/test_indicators.py:621-665`). One `pf[(10, 20, "ETH-USD")]` selection then slices every dependent object consistently (`README.md:174`).

### 2. ArrayWrapper: metadata shell around raw compute

[REPORTED] Kernels operate on bare 2D NumPy arrays. `ArrayWrapper` stores index, columns, ndim, frequency, and grouping, and rewraps raw results into labeled objects (`vectorbt/base/array_wrapper.py:108-160`, `376-496`). Indexing runs the pandas operation on synthetic position arrays to build a selection plan, then applies that plan to records, mapped values, and grouping together (`vectorbt/base/array_wrapper.py:163-244`; `vectorbt/records/base.py:536-566`).

### 3. Broadcasting with explicit label policies

[REPORTED] `broadcast` combines NumPy shape rules with named index policies: `keep`, `stack`, `strict`, `reset` (`vectorbt/base/reshape_fns.py:176-294`, `298-347`). Strict mode raises on conflicting non-singleton labels; stack mode combines them. Tests confirm strict conflicts raise (`tests/test_base.py:1579-1705`).

### 4. Records: sparse structured event logs

[REPORTED] Events (orders, trades, drawdowns, ranges) are structured NumPy arrays keyed by `id`, `col`, and usually `idx`, never dense matrices (`vectorbt/records/base.py:23-43`, `444-515`). The design preserves multiplicity: several events may share one time and column. Densification checks `is_mapped_expandable_nb` first because a dense matrix cannot represent duplicates and assignment is last-write-wins (`vectorbt/records/nb.py:419-465`). `MappedArray.reduce` runs per-column or per-group reductions over a column map without densifying (`vectorbt/records/mapped_array.py:753-809`).

### 5. Order model and execution kernel

[VERIFIED] `SizeType` is `Amount, Value, Percent, TargetAmount, TargetValue, TargetPercent`; `Direction` is `LongOnly, ShortOnly, Both`; `OrderStatus` is `Filled, Ignored, Rejected` (`vectorbt/portfolio/enums.py:384-389`, `436-439`, `460-463`). [REPORTED] The `Order` tuple carries size, price, fees, fixed fees, slippage, min and max size, granularity, a synthetic reject probability, cash locking, partial-fill policy, and a log flag (`vectorbt/portfolio/enums.py:1502-1518`). `OrderStatusInfo` enumerates typed causes: `SizeNaN`, `NoCashLong`, `MaxSizeExceeded`, `CantCoverFees`, `MinSizeNotReached`, `PartialFill`, and more (`vectorbt/portfolio/enums.py:502-550`). [VERIFIED] A buy adjusts price by `price * (1 + slippage)`, caps by available cash, then updates cash and position atomically (`vectorbt/portfolio/nb.py:72-123`). [REPORTED] `NoOrder` is an explicit skip sentinel distinct from rejection; only `Filled` results produce order records (`vectorbt/portfolio/enums.py:1630-1649`; `vectorbt/portfolio/nb.py:669-690`).

### 6. Two logs with different completeness

[REPORTED] Filled orders store only `id, col, idx, size, price, fees, side`. The optional log record stores the pre-state, the full request, the post-state, and the result status per attempt, including ignored and rejected attempts (`vectorbt/portfolio/enums.py:1773-1866`; `vectorbt/portfolio/nb.py:509-571`). Accepted events and the attempt audit trail are separate structures.

### 7. Signal model and state machines

[REPORTED] Signals are boolean matrices; the accessor rejects non-boolean input (`vectorbt/signals/accessors.py:189-257`). `generate_ex_nb` bounds each exit search to the interval after an entry with `wait`, `until_next`, and `skip_until_exit` controls (`vectorbt/signals/nb.py:91-156`). `generate_enex_nb` alternates entry and exit callbacks, forbids both waits at zero, and detects non-progressing callbacks as infinite loops (`vectorbt/signals/nb.py:158-256`). Cleaning enforces alternating entry and exit pairs and skips bars where both fire (`vectorbt/signals/nb.py:258-292`).

### 8. Stops on OHLC bars and look-ahead controls

[REPORTED] OHLC stop kernels synthesize missing open, low, and high from close, check stop loss before take profit inside one candle, and update trailing extrema only after hit checks so the current bar's future extreme cannot trigger its own stop (`vectorbt/signals/nb.py:741-889`). The portfolio path warns that non-close ordinary signal prices beside stops can look into the future, and that stops execute before user signals on a bar (`vectorbt/portfolio/enums.py:277-322`; `vectorbt/portfolio/nb.py:2028-2099`). Generic backward shift and backward fill carry an explicit "This operation looks ahead" warning (`vectorbt/generic/nb.py:255-297`, `410-438`).

### 9. Parameter sweeps, deduplication, caching

[REPORTED] `param_product=True` builds the Cartesian product; the default zips parameter lists after length broadcasting (`vectorbt/indicators/factory.py:1656-1697`). `run_unique=True` computes only unique parameter tuples and reconstructs the requested columns from raw slices (`vectorbt/indicators/factory.py:1680-1697`, `3005-3096`). `cache_func` runs once per sweep and shares expensive intermediates: BBANDS reuses MA and MSTD across alpha values (`vectorbt/indicators/factory.py:3127-3204`; `vectorbt/indicators/nb.py:100-130`). Products are eagerly materialized and can exhaust memory (`vectorbt/utils/params.py:26-95`).

### 10. Cash sharing, call sequence, auto initial cash

[REPORTED] With cash sharing, columns in a group execute serially against one mutable cash state per row. `call_seq='auto'` insertion-sorts approximate order values so sells release cash before buys; the API warns this assumes all prices are known beforehand and that reordering keeps prices unchanged (`vectorbt/portfolio/nb.py:1002-1071`; `vectorbt/portfolio/base.py:1750-1779`). `InitCashMode.Auto` simulates with infinite cash, then derives required capital post hoc (`vectorbt/portfolio/base.py:4407-4435`). These are declared research conveniences, not causal execution models.

### 11. Trade reconstruction and PnL attribution

[REPORTED] Trades and positions are rebuilt after simulation from filled order records. Entry trades receive a size-weighted share of exit price and fees; a reversing order splits its fees between the closing and opening sides; open trades are marked to the final close with zero exit fees (`vectorbt/portfolio/nb.py:5908-6067`, `6160-6302`). PnL is value difference minus attributed fees (`vectorbt/portfolio/nb.py:5711-5764`).

### 12. Data container, alignment, update semantics

[REPORTED] `Data` keys per-symbol frames, aligns indexes and columns under named policies `nan`, `drop`, `raise` (defaults: tolerate missing timestamps, reject schema drift), and canonicalizes timezones to UTC while distinguishing localization from conversion (`vectorbt/data/base.py:367-458`, `463-536`; `vectorbt/_settings.py:135-146`). `update()` refetches from the last stored timestamp, concatenates, keeps the newest duplicate, and returns a new object instead of mutating (`vectorbt/data/base.py:617-667`). The last candle can be silently revised.

### 13. Returns metrics and annualization

[REPORTED] The annualization factor is `year_freq / wrapper.freq` with a 365-day default year, and it raises when frequency is absent (`vectorbt/returns/accessors.py:259-289`; `vectorbt/_settings.py:319-331`). Total return compounds with `nanprod`, skipping NaNs, while annualized return divides by total row count including NaN rows; the two denominators disagree (`vectorbt/returns/nb.py:69-148`). Sharpe returns infinity on zero standard deviation (`vectorbt/returns/nb.py:215-265`).

### 14. Backend dispatch: Numba and Rust

[REPORTED] Dispatch wrappers check dtype, shape, and capability before selecting Rust; callbacks always run in Numba; randomized paths default to Numba to preserve random streams (`vectorbt/generic/dispatch.py:4-103`; `vectorbt/_engine.py:323-370`; `vectorbt/portfolio/dispatch.py:537-737`). The Rust crate mirrors schemas and semantics, releases the GIL, and ships as a separate optional package `vectorbt-rust==1.1.0` (`rust/src/portfolio.rs:115-206`, `2173-2236`; `pyproject.toml:49-84`). The benchmark harness pairs each Numba and Rust kernel, checks parity with `allclose(rtol=1e-6, atol=1e-12)`, and reports best-of-five wall time after warmup (`benchmarks/bench_engine.py:68-130`, `2670-2785`).

### 15. Float correctness is a documented boundary

[VERIFIED] The simulation module warns that accumulated float64 roundoff can prevent trades and positions from closing, shows worked examples, and advises closing positions with `np.inf` or `position_now` instead of many micro-transactions (`vectorbt/portfolio/nb.py:17-47`).

### 16. Simulation is not live execution, by the project's own words

[VERIFIED] The README disclaimer states the software is for educational purposes and that the authors assume no responsibility for trading results (`README.md:288-292`). [REPORTED] An accepted computation is written directly as a filled record with no external acknowledgement; cash-sharing docs concede retained same-tick prices and prior price knowledge (`vectorbt/portfolio/nb.py:574-584`; `vectorbt/portfolio/base.py:1737-1779`). Partial fills come from cash and size limits, not order books or pool reserves (`vectorbt/portfolio/nb.py:137-207`). No schema carries a fill receipt, venue acknowledgement, or execution-readiness field.

## Do and don't guidance

Do:
- Separate the attempt log from accepted events, as vectorbt separates logs from order records.
- Give every rejection a typed reason code, as `OrderStatusInfo` does.
- Keep a distinct no-action sentinel; skipping is not rejection.
- Store events as sparse append-only records with stable ids; densify only for explicitly lossy views.
- Make label alignment policy explicit and default to strict for cross-source comparisons.
- Canonicalize timestamps to UTC and record whether a provider timestamp is an instant or naive wall time.
- Version any revised observation instead of overwriting it.
- Write the accounting transition (cash, inventory, fees) as one pure function with typed inputs and outputs.
- Pair any second compute backend with parity tests before trusting it.

Don't:
- Don't call any simulated or quoted number a fill. vectorbt's `Filled` means the accounting kernel accepted an instruction.
- Don't use float64 for money in the core; vectorbt documents unclosable positions from roundoff.
- Don't infer same-tick multi-venue execution from shared-cash bookkeeping.
- Don't reuse OHLC stop inference as execution evidence; it is bar-level hypothesis labeling.
- Don't run unbounded Cartesian parameter products; vectorbt materializes them eagerly and can exhaust memory.
- Don't cache results keyed only by parameters; include data snapshot identity.
- Don't treat a chronological split as leakage-proof; vectorbt splitters have no purge or embargo arguments (`vectorbt/generic/splitters.py:18-95`).

## FalconOS mapping

All rows [INFERRED]. FalconOS files are current or roadmap targets.

| vectorbt concept | FalconOS target | Note |
| --- | --- | --- |
| `OrderStatusInfo` typed reasons | `src/types.ts` (`Candidate.reasons`) | Already aligned; formalize the reason string union. |
| Logs vs order records | `src/scan.ts`, `src/vault.ts` | Scans already keep failed observations; keep attempt and acceptance separate in P2. |
| Pure buy/sell state transition | new `src/paper.ts` (roadmap P2 paper cycle) | Port the transition shape with bigint atoms and explicit rounding. |
| `NoOrder` sentinel | `src/paper.ts` | Distinguish skip, reject, and accept in reconciliation. |
| Sparse records with `id, col, idx` | `data/runs/*.json` schema, future outcome records | Append-only event tables with stable ids and provenance fields vectorbt lacks: chain, venue, request id, raw bytes hash. |
| Strict broadcast policy | `src/scan.ts` assessment | Keep exact amount matching; never align quotes positionally. |
| UTC and localize vs convert | `src/sources.ts` | Record provider time semantics per source. |
| `update()` append plus replace-last | `src/sources.ts`, future history store | Version superseded observations. |
| Declarative metric registry | future review view (roadmap P5) | Small typed registry only; safety fields stay explicit. |
| Walk-forward splitters, sweeps, indicator caching | isolated Python engine, only at P4+ | Not needed for the current quote slice. |
| Numba/Rust dispatch with parity harness | any future native or Python sidecar | Copy the paired parity-test method, report distributions not best-of-N. |

## Adopt, defer, reject

Adopt now (local TypeScript, concepts only):
1. [INFERRED] Typed rejection reason unions and a no-action sentinel.
2. [INFERRED] Attempt log separate from accepted events for the P2 paper cycle.
3. [INFERRED] Sparse append-only event records with stable ids and provenance.
4. [INFERRED] Pure bigint accounting transition function for paper legs.
5. [INFERRED] Strict alignment defaults, UTC canonicalization, versioned observation revision.

Defer:
1. [INFERRED] Python research engine embedding vectorbt for historical sweeps and walk-forward work. Revisit at roadmap P4 when a third chain or wider strategy needs historical evaluation. Requires license review first.
2. [INFERRED] Wide matrix layout and parameter sweep machinery. No historical series workload exists in FalconOS today.
3. [INFERRED] Declarative metric registry for the P5 review view.
4. [INFERRED] Native acceleration behind a parity-tested dispatch boundary.

Reject:
1. [INFERRED] Float64 money arithmetic anywhere in the candidate or paper core. FalconOS invariant F3 already requires integer arithmetic.
2. [INFERRED] Mapping quotes or simulated results to any fill-like status. Conflicts with invariant F6 and the `SEQUENTIAL_QUOTES_NOT_FILLS` reason already emitted by `src/scan.ts`.
3. [INFERRED] `call_seq='auto'` style reordering and auto initial cash for anything cross-chain; quote timestamps and expiry must stay first-class.
4. [INFERRED] Copying vectorbt source code into FalconOS. License risk and language mismatch.

## Risks

1. [INFERRED] License: FalconOS aims to be a paid product. Building it on vectorbt code or shipping vectorbt-derived functionality could fall under the Commons Clause sell restriction. Internal research use looks permitted, but this needs a real license review before any P4 decision.
2. [REPORTED] Silent revision: vectorbt's update keeps the newest duplicate candle (`vectorbt/data/base.py:617-667`). Adopting this without versioning would erase provenance, which FalconOS forbids.
3. [REPORTED] Metric denominators: NaN-skipping compounding beside row-count annualization gives inconsistent results on gapped data (`vectorbt/returns/nb.py:69-148`). Porting formulas without a missing-observation policy imports the inconsistency.
4. [REPORTED] Leakage: splitters are chronological but have no purge or embargo; backward shift and fill read the future by design (`vectorbt/generic/splitters.py:18-95`; `vectorbt/generic/nb.py:255-297`). Research results from such pipelines need explicit leakage labeling before they enter the Obsidian graph.
5. [REPORTED] Performance headlines (grid search in seconds, one million orders in 70-100 ms) are documentation claims measured as best-of-five on specific hardware (`docs/docs/getting-started/features.md:9-49`; `benchmarks/bench_engine.py:2675-2685`). Not reproduced here; do not transfer them.
6. [INFERRED] A Python sidecar adds an operational and provenance boundary: results crossing it must carry snapshot identity and leakage labels, or FalconOS's evidence rules break silently.

## License notes

[VERIFIED] `LICENSE.md:1-13` states Apache 2.0 with Commons Clause: the grant excludes the right to sell the software, where selling means providing a product or service whose value derives entirely or substantially from the software's functionality. [VERIFIED] `README.md:270-276` frames this as fair-code, free for individuals and organizations, no selling of products that are primarily this software, and warns that optional dependencies may carry more restrictive licenses. [INFERRED] Studying concepts and writing an independent TypeScript implementation is outside copyright scope. Running vectorbt as an internal research tool appears permitted. Reselling FalconOS functionality that is substantially vectorbt requires an exception from the author.

## Not fetched

- I did not run any vectorbt code, tests, or benchmarks. All behavior claims come from reading source.
- Not read: `vectorbt/labels/`, `vectorbt/messaging/telegram.py`, `vectorbt/templates/`, `apps/candlestick-patterns/app.py`, `examples/`, `tests/notebooks/`, docs pages other than `features.md`, and the full 10,831-line `tests/test_portfolio.py` (scouts skimmed targeted sections only).
- Scout line citations were spot-checked, not exhaustively re-read.
- The `vectorbt-rust` PyPI package itself was not fetched; only the checked-in crate source was read.
- No live vectorbt.dev or vectorbt.pro pages were fetched.

## Rules to adopt

1. Never label a quoted, simulated, or reconstructed number as a fill; only a venue acknowledgement earns that word.
2. Give every rejected candidate or paper leg a typed reason code from a closed union.
3. Keep a no-action sentinel distinct from rejection and from error.
4. Log every attempt with pre-state, request, post-state, and result; store accepted events separately.
5. Store events as append-only sparse records with stable ids; never as dense grids that drop duplicates.
6. Attach chain, venue, request id, timestamps, and raw evidence hash to every event record; vectorbt omits these and FalconOS must not.
7. Use exact integer token atoms for all money in core paths; float enters only presentation and research layers.
8. Write the paper-cycle accounting transition as one pure function; test it with property checks on conservation of value.
9. When closing a paper position, close by full remaining size, not by summed increments; roundoff accumulates by increment.
10. Default cross-source alignment to strict; a mismatch is an error state, never a silent NaN.
11. Canonicalize all timestamps to UTC and record per provider whether raw times are instants or naive wall times.
12. Revise observations by versioned supersession, never by overwrite.
13. Treat any same-tick multi-leg assumption as a declared simulation parameter, visible in the output record.
14. Order paper legs by explicit recorded sequence with per-leg timestamps; never resort legs for convenience.
15. Bound every parameter sweep with a hard combination limit before expansion.
16. Key every research cache by data snapshot identity plus parameters, never parameters alone.
17. Deduplicate identical parameter tuples only for pure functions; skip deduplication when randomness or side effects exist.
18. Label every research split with its leakage controls; a chronological split without purge and embargo is not leakage-safe.
19. Mark open-position valuations as mark-to-market estimates, never realized outcomes.
20. Any second compute backend requires paired parity tests with stated tolerances before its results count as evidence.
21. Report performance as distributions from the real pipeline against a named baseline; never republish another project's best-of-N numbers.
22. Before embedding vectorbt in a paid product path, complete a Commons Clause review and record the verdict.
