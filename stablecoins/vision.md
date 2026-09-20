# Stablecoins Vision

## Purpose

[VERIFIED, repository read] The stablecoin domain collects and assesses USDC and EURC quote evidence across Solana and Base without granting execution authority.

## Current scope

[VERIFIED, repository read] The implementation lives in `stablecoins/sources.ts`, `stablecoins/scan.ts`, and the stablecoin portions of `src/types.ts`.

[VERIFIED, repository read] Quote requests and results use integer token amounts represented as strings. `stablecoins/scan.ts` converts bounded decimal input to six-decimal integer units and performs amount comparisons with `bigint`.

[VERIFIED, repository read] Each observation retains its request, timing, raw response, normalized quote or error, and a typed failure record with retry information.

[REPORTED, vision-cross-reference, 2026-09-15] The current roster treats Stablecoin Specialist as an advisory role; only the Perps Specialist is built first. The existing quote-cycle/plugin remains a legacy stablecoin evidence contract and must not be treated as the Falcon Investment perps contract. Source: `CONTEXT.md:38-44,107`.
Evidence quote: "Falcon Investment is a council of specialist advisory agents, not an autonomous trader." "only the Perps Specialist is built first." "The current quote-cycle/plugin implementation is a legacy stablecoin evidence contract. It must not be silently treated as the Falcon Investment perps contract." Source: `CONTEXT.md:38,107`

## Boundaries

[VERIFIED, repository read] Stablecoin implementation and tests now live in `stablecoins/` while shared types remain in `src/types.ts`.

[BOUNDARY] Execution and custody remain outside this domain. Its candidates are advisory records and are not execution-ready.

[REPORTED, vision-cross-reference, 2026-09-15] The separate Arc working vision describes an execution-oriented stablecoin desk, but that plan is not the current FalconOS boundary. Current context keeps custody, signing, and order submission out of scope. Source: `/Volumes/Sarthi MAC/falconOS_idea/VISION(2).md:16-31`; `CONTEXT.md:44`.
Evidence quote: "Falcon is an **Arc-native autonomous liquidity and risk desk for stablecoins**." "Base, other EVM networks, and Solana act as **execution satellites**." "FalconOS and Falcon Investment provide no custody, pooled capital, signing, or order submission." Source: `/Volumes/Sarthi MAC/falconOS_idea/VISION(2).md:16,29`; `CONTEXT.md:44`

## Next proof

[VERIFIED, completed 2026-09-20] The stablecoin move is done: `stablecoins/scan.ts`, `stablecoins/sources.ts`, and their tests live in this folder, and the full suite passes 132/132. Next proof: keep the legacy plugin contract fenced from the Council contract when the shared type boundary is decided.

## Open decisions

[INFERRED] Decide the shared type boundary for quote evidence and whether source collection should remain owned by the stablecoin domain.
