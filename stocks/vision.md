# Stocks Vision

## Purpose

[VERIFIED, repository read, 2026-09-17] `stocks/` owns the Stocks Specialist contract and its read-only evidence adapters. The domain produces non-binding basket advice for the Client Agent.

## Current scope

[VERIFIED, repository read, 2026-09-17] `stocks/stocks.ts` defines the canonical basket snapshot, source precedence, typed captures, Basket Proposal, independent Risk Review, publication gate, and `stocks.advice` response validation.

[VERIFIED, repository read, 2026-09-17] `stocks/prestocks.ts` owns the provider-specific PreStocks evidence path. It validates PreStocks rows, reads issuer marks, reads token-2022 scaled-UI multipliers, and wraps the generic DEX evidence adapter with scaled-price and issuer-price corroboration.

[VERIFIED, repository read, 2026-09-17] `dash/cli.ts` imports the PreStocks adapter from `stocks/prestocks.ts`. The dashboard remains the caller and renderer; provider-specific PreStocks logic no longer lives under `dash/`.

[VERIFIED, repository read, 2026-09-18] `stocks/dbc.ts` owns the Meteora DBC equity launch prescription and evaluation desk. It targets Stocklana's Meteora DBC bounty with USDC-quoted, Token-2022, DAMM v2 prescriptions that meet the documented stock-token keeper floor.

[VERIFIED, user direction, 2026-09-17] The web surface may show a read-only snapshot, but it does not expose the full dashboard or any execution path.

## Boundaries

[BOUNDARY] Stocks advice remains non-binding. The Client Agent retains final decision and execution ownership.

[BOUNDARY] This domain does not custody funds, reserve capital, sign transactions, submit orders, or issue an ETF.

[BOUNDARY] PreStocks and DEX evidence are read-only. Provider failures, malformed rows, multiplier disagreement, or issuer disagreement fail closed to `NO_DATA`.

[BOUNDARY] DBC prescriptions are advisory parameters only. No DBC config account, pool, swap, or migration transaction is created in this slice.

## Next proof

[INFERRED] Keep live claims limited to sources and assets that pass the existing registry, timestamp, coherence, and corroboration checks.

[INFERRED] After advisory acceptance, add an execution bridge that can create DBC configs/pools for approved sleeves using the official Meteora SDK.

[INFERRED] Add Tessera and Clawpump tracks only after the PreStocks + DBC advisory path is submission-ready.

## Open decisions

[DECIDED, user direction, 2026-09-18] First Stocks Specialist surface focuses on PreStocks, with Meteora DBC as the launch/liquidity sequel for equity-like sleeves.

[INFERRED] Decide the host transport used by a standalone Stocks CLI while preserving the existing `stocks.advice` boundary.
