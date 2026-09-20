# Stocks Vision

## Purpose

[VERIFIED, repository read, 2026-09-20] `stocks/` holds the Stocks specialist contract: `stocks/stocks.ts` (canonical basket snapshot, proposals, lead-plus-risk advice) with contract tests in `stocks/test/stocks.test.ts`. The dash module consumes it.

## Current scope

[VERIFIED, repository read, 2026-09-20] The Stocks contract and its tests exist and pass in the 132-test suite. `npm run dash -- preipo` exercises it live, read-only. [SUPERSEDED, 2026-09-20] Earlier text said no implementation existed; that described the tree before 2026-09-14.

[REPORTED, vision-cross-reference, 2026-09-15] The current roster keeps Stocks as an advisory specialist, with only Perps built first. Falcon Investment advice is non-binding; the existing Client Agent retains final decision and execution ownership. Source: `CONTEXT.md:38-44,77-87`.
Evidence quote: "Falcon Investment is a council of specialist advisory agents, not an autonomous trader." "| Stocks Specialist | Advises on stocks. |" "The existing Client Agent remains the final decision and execution owner." Source: `CONTEXT.md:38,40,82`

## Boundaries

[BOUNDARY] This vision does not select venues, assets, APIs, data sources, or a launch date.

[BOUNDARY] It claims no advisory, trading, execution, custody, or deployment capability for Stocks today.

## Next proof

[INFERRED] Define the first advisory-only input and output contract, then add a contract test that returns an unavailable result when required evidence is missing or invalid.

## Open decisions

[INFERRED] Decide the supported market definition, required evidence, and integration sources before implementation begins.
