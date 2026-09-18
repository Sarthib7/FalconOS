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

## Client Agent path

```bash
npm run stocks:advice < test/fixtures/stocks-agent-healthy.json
```

[VERIFIED, repository and test run, 2026-09-18] Emits one `stocks.agent-response` JSON line with `advice.status=PUBLISHED`, integrity `VERIFIED`, and `executionReady=false`. See [agent.md](agent.md).

## Meteora DBC equity launch desk

```bash
npm run stocks:dbc
```

[VERIFIED, repository and test run, 2026-09-18] Offline only. Prints equity-tuned DBC prescriptions for PreStocks OPENAI and SPACEX sleeves, then a meme-style counterexample that fails closed.

1. `STOCKS DEMO / DBC EQUITY SLEEVES`
   - Program id pinned to Meteora `dynamic_bonding_curve`.
   - USDC quote, Token-2022, DAMM v2 migration, 750 USDC keeper floor.
   - Evaluation status `READY` / fit `equity-grade`.

2. `STOCKS DEMO / DBC MEME REJECT`
   - WSOL quote, sub-floor threshold, 9000→20 bps meme fee schedule.
   - Evaluation status `REJECT` / fit `unsuitable`.

[BOUNDARY] The DBC desk does not create on-chain configs or pools. It prepares the launch parameters for a later execution slice.

## Live path

The live command is:

```bash
npm run stocks
```

[BOUNDARY] This command calls external PreStocks, DEX Screener, and Solana RPC services. Run it only with approved provider access and a named target environment. The offline demo is the default judge path.

## Next integration

[DECIDED, user direction, 2026-09-17] Backpack Securities is a prospective firm partner. It is not a live data source, execution venue, or custody provider in this demo.

[DECIDED, user direction, 2026-09-18] After advisory hardens, move to execution: DBC config/pool creation for approved sleeves, then basket work. See [plans/stocklana.md](../plans/stocklana.md).
