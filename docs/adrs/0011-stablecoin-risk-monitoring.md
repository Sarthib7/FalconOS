# ADR 0011: Stablecoin risk monitoring and exposure

**Status:** Accepted product direction, 2026-10-11. This record does not change the current implementation contract.

## Context

[VERIFIED, user choice, 2026-10-11] The first workflow runs in this order: monitor stablecoin risk, compare yield opportunities, then calculate the company liquidity floor. The initial customer remains stablecoin-holding startups, as recorded in [FalconOS vision](../vision.md).

[VERIFIED, source read: `web/app/data.mjs`] The current app reads SOL and SPL or Token-2022 balances for one Solana Devnet wallet. [REPORTED, repository connector scan by scout] No company-wide, cross-chain, custodian, exchange, or bank holdings connector is implemented. These choices describe future product direction, not shipped support.

## Decision

[VERIFIED, user choices, 2026-10-11] Stage B covers public stablecoin conditions and each company’s reported stablecoin exposure. The risk areas are depeg, issuer and reserve information, liquidity, market news, and compliance changes. The system includes any stablecoin-chain pair that meets the coverage gate: a verified balance reader, exact token identity, and market price and liquidity data. Missing risk categories appear as `UNKNOWN`.

[VERIFIED, user choices, 2026-10-11] Holdings enter through read-only APIs. Wallet integrations come first and should cover all chains that meet the coverage gate. A company links a wallet with a one-time message signature. The signature proves address control and cannot authorize a transaction. Company exposure includes every reported stablecoin balance. Unsupported assets remain visible with unknown risk coverage.

[VERIFIED, user choices, 2026-10-11] Stage B reports risk and alerts. It takes no action. Show the latest known state with the source timestamp and data age inline. Use source-specific freshness windows. A missing or stale category makes the score partial and marks it incomplete.

[VERIFIED, user choices, 2026-10-11] Show a `LOW`, `MEDIUM`, or `HIGH` risk band for each stablecoin-chain pair, with category details on request. Also show a company exposure score. Calculate the company score using exposure weights. A material high-risk holding can trigger an alert on its own.

[VERIFIED, user choices, 2026-10-11] Define materiality with both an absolute balance and a share of the company’s stablecoin holdings. Falcon supplies visible defaults. Defaults apply immediately and each company can change them. Alert when risk enters `HIGH`. Repeat only when the risk worsens or new evidence changes its assessment.

## Consequences

[INFERRED] Coverage can expand chain by chain. A chain or asset without the required balance, identity, price, and liquidity data must not appear as fully covered. Missing risk categories remain `UNKNOWN`; they do not count as passing checks.

[INFERRED] Market evidence can be shared. Company wallet links, balances, thresholds, and exposure scores require a private workspace boundary. This ADR does not choose storage, retention, or workspace access rules.

## Not determined

[NOT DETERMINED] Provider names and API choices for each chain, custodian, exchange, or bank.

[NOT DETERMINED] Numeric values for risk bands, customer thresholds, freshness windows, and absolute or percentage materiality defaults.

[NOT DETERMINED] The detailed calculation for each market score, the treatment of conflicting sources, alert delivery channels, workspace roles, and data retention.

[NOT DETERMINED] The detailed scope and success criteria for yield comparison and liquidity-floor planning. Customer demand, pricing, and legal review also remain untested.

## Least confident decisions

1. [INFERRED] Stablecoin-holding startups may need cross-chain monitoring enough to adopt a new workspace. Customer interviews and a pilot must test this.
2. [INFERRED] All-chain coverage may be costly or uneven because data quality varies by asset and chain.
3. [INFERRED] A company score based on exposure weights and materiality limits may represent the risk customers care about. The score needs replay tests against named scenarios before stronger claims.
