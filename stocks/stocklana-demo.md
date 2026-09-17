# Stocklana demo walkthrough

## Purpose

[VERIFIED, repository read, 2026-09-17] This demo shows the Stocks Specialist as an advisory-only market integrity system. It does not custody funds, sign transactions, submit orders, pool capital, or issue an ETF.

## Run the offline demo

From the repository root:

```bash
npm run stocks:demo
```

[VERIFIED, command run, 2026-09-17] The command runs without external provider calls and prints three cases. All fixture outputs use `provenance=synthetic`.

1. `STOCKS DEMO / HEALTHY`
   - Canonical basket status: `READY`.
   - Advice status: `PUBLISHED`.
   - Integrity status: `VERIFIED`.
   - Proposal includes `AAPLx` at `60.00%` and `MSFTx` at `40.00%`.

2. `STOCKS DEMO / LOW-LIQUIDITY`
   - One fixture falls below the configured liquidity floor.
   - The independent risk review returns `BLOCK`.
   - The published proposal is withheld.

3. `STOCKS DEMO / STALE-REPLAY`
   - The command rebuilds an equivalent fixture basket with an observation time one hour old, so its snapshot hash is intentionally different.
   - Advice status is `NO_DATA`.
   - Integrity status is `STALE`.
   - Refusal codes include `snapshot-stale` and `proposal-expired`.

## What the demo proves

[VERIFIED, repository and test run, 2026-09-17] The same Stocks path handles synthetic healthy evidence, a risk veto, and stale replay. Each output includes the snapshot hash, proposal hash when present, source citations, and integrity warnings or refusal codes.

[VERIFIED, repository and test run, 2026-09-17] The suite covers canonical snapshot validation, source precedence, scaled-UI multiplier checks, issuer corroboration, proposal binding, integrity states, and the dashboard risk gate.

## Live path

The live command is:

```bash
npm run stocks
```

[BOUNDARY] This command calls external PreStocks, DEX Screener, and Solana RPC services. Run it only with approved provider access and a named target environment. The offline demo is the default judge path.

## Next integration

[DECIDED, user direction, 2026-09-17] Backpack Securities is a prospective firm partner. It is not a live data source, execution venue, or custody provider in this demo.
