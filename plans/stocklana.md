# Stocklana bounty plan

[VERIFIED, official page, 2026-09-18] Event: [Stocklana](https://hackathons.solana.com/hackathons/stocklana). Deadline: 25 September 2026, 4:00pm ET. Prize pool about $126k.

## Target bounties

| Bounty | Status | FalconOS wedge |
| --- | --- | --- |
| Best Use of PreStocks | Ready for demo | Live PreStocks marks, scaled-UI corroboration, pre-IPO basket advice |
| Best use of Pyth market data | Ready for demo | Pyth-central prices with dislocation veto on `dash/` |
| Best Use of Meteora DBC | Advisory desk ready | Equity-tuned DBC prescriptions + evaluation; no on-chain create yet |
| Best Use of Tessera | Later | Optional after PreStocks/DBC demo is solid |
| Stocknized Agent on Clawpump | Later | Requires token launch + Meteora pool; after advisory→execution bridge |

## Current product boundary

1. Advisory-only Stocks Specialist remains the public claim.
2. Client Agents consume advice via `npm run stocks:advice` ([stocks/agent.md](../stocks/agent.md)).
3. DBC work emits launch prescriptions and fit evaluations. No signing, custody, or pool creation yet.
4. After advisory hardens, the next slice is execution-facing: create DBC configs/pools for approved sleeves, then basket/ETF issuance only after securities review.

## Build sequence

| Step | Status | Command / artifact |
| --- | --- | --- |
| Market Integrity Desk + offline Stocklana demo | Done | `npm run stocks:demo` |
| Meteora DBC equity launch desk | Done | `npm run stocks:dbc` |
| Client Agent JSON surface | Done | `npm run stocks:advice` |
| Live PreStocks evidence | Done | `npm run stocks` |
| Submission package (repo, demos, live site) | Open | GitHub + falconos.markets |

## Docs map

| Doc | Purpose |
| --- | --- |
| [stocks/vision.md](../stocks/vision.md) | Stocks domain scope and boundaries |
| [stocks/agent.md](../stocks/agent.md) | Client Agent request/response contract |
| [stocks/stocklana-demo.md](../stocks/stocklana-demo.md) | Judge and operator walkthrough |
| [README.md](../README.md#stocks--stocklana) | Top-level Stocks commands |
| [SPEC.md](../SPEC.md) | I13/I14, V71/V72, T32/T33 |

## Execution sequel (not this PR)

- Partner/creator wallets and DBC config creation via official SDK.
- Mainnet or devnet pool for one PreStocks-correlated sleeve with USDC quote.
- Basket rebalance proposals that can later become executable routes.
- Clawpump agent token only after the DBC sleeve path is real.
