# Stocks Vision

## Purpose

[VERIFIED, repository read, 2026-09-17] `stocks/` owns the Stocks Specialist contract and its read-only evidence adapters. The domain produces non-binding basket advice for the Client Agent.

## Current scope

[VERIFIED, repository read, 2026-09-17] `stocks/stocks.ts` defines the canonical basket snapshot, source precedence, typed captures, Basket Proposal, independent Risk Review, publication gate, and `stocks.advice` response validation.

[VERIFIED, repository read, 2026-09-17] `stocks/prestocks.ts` owns the provider-specific PreStocks evidence path. It validates PreStocks rows, reads issuer marks, reads token-2022 scaled-UI multipliers, and wraps the generic DEX evidence adapter with scaled-price and issuer-price corroboration.

[VERIFIED, repository read, 2026-09-17] `dash/cli.ts` imports the PreStocks adapter from `stocks/prestocks.ts`. The dashboard remains the caller and renderer; provider-specific PreStocks logic no longer lives under `dash/`.

[VERIFIED, repository and test run, 2026-09-17] The stocks contract and dashboard integration pass the repository suite: `101` tests passed and `0` failed. TypeScript typecheck also passed.

[VERIFIED, user direction, 2026-09-17] The web surface may show a read-only snapshot, but it does not expose the full dashboard or any execution path.

## Boundaries

[BOUNDARY] Stocks advice remains non-binding. The Client Agent retains final decision and execution ownership.

[BOUNDARY] This domain does not custody funds, reserve capital, sign transactions, submit orders, or issue an ETF.

[BOUNDARY] PreStocks and DEX evidence are read-only. Provider failures, malformed rows, multiplier disagreement, or issuer disagreement fail closed to `NO_DATA`.

## Next proof

[INFERRED] Add a dedicated Stocks CLI command that runs the current live evidence path and renders the existing advisory output.

[INFERRED] Add more supported stock market definitions only after each venue, asset registry, source policy, and evidence contract is confirmed.

[INFERRED] Keep live claims limited to sources and assets that pass the existing registry, timestamp, coherence, and corroboration checks.

## Open decisions

[INFERRED] Decide whether the first Stocks Specialist surface should focus on PreStocks tokenized pre-IPO assets or include another approved stock venue.

[INFERRED] Decide the host transport used by a standalone Stocks CLI while preserving the existing `stocks.advice` boundary.
