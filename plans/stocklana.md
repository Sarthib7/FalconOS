# Stocklana bounty plan

[VERIFIED, official page, 2026-09-18] Event: [Stocklana](https://hackathons.solana.com/hackathons/stocklana). Deadline: 25 September 2026, 4:00pm ET. Prize pool about $126k.

## Target bounties

| Bounty | Status | FalconOS wedge |
| --- | --- | --- |
| Best Use of PreStocks | In progress on stocks path | Live PreStocks marks, scaled-UI corroboration, pre-IPO basket advice |
| Best use of Pyth market data | In progress on dash path | Pyth-central prices with dislocation veto |
| Best Use of Meteora DBC | Starting now | Equity-tuned DBC launch prescriptions + evaluation desk |
| Best Use of Tessera | Later | Optional after PreStocks/DBC demo is solid |
| Stocknized Agent on Clawpump | Later | Requires token launch + Meteora pool; after advisory→execution bridge |

## Current product boundary

1. Advisory-only Stocks Specialist remains the public claim.
2. DBC work in this slice emits launch prescriptions and fit evaluations. No signing, custody, or pool creation yet.
3. After advisory hardens, the next slice is execution-facing: create DBC configs/pools for approved sleeves, then basket/ETF issuance only after securities review.

## Immediate build sequence

1. Ship Market Integrity Desk + offline Stocklana demo (existing `feat/stocks-next` work).
2. Add Meteora DBC equity launch desk under `stocks/dbc.ts`.
3. Expose `npm run stocks:dbc` offline demo for judges.
4. Keep live `npm run stocks` for PreStocks evidence.
5. Package submission links: repo, demo command output, live site.

## Execution sequel (not this PR)

- Partner/creator wallets and DBC config creation via official SDK.
- Mainnet or devnet pool for one PreStocks-correlated sleeve with USDC quote.
- Basket rebalance proposals that can later become executable routes.
- Clawpump agent token only after the DBC sleeve path is real.
