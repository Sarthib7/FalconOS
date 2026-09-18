# FalconOS

[VERIFIED, user direction, 2026-09-05] FalconOS is a multichain research and trading layer above existing agents. The user requested liquidity pooling, arbitrage, stablecoin peg strategies, sniping, investing, and execution. The user also selected Obsidian for a knowledge graph and continuous discovery.

[VERIFIED, user authorization] The user requested: "ok document and update the plan" and "lets start building". This authorizes the local build. The previous validation verdict remains go validate. Starting the prototype does not establish customer demand.

## Current direction

[VERIFIED, Stocklana focus, 2026-09-18] Active build focus is the Stocks Specialist for [Stocklana](https://hackathons.solana.com/hackathons/stocklana): PreStocks evidence, Pyth-aware dash path, Market Integrity Desk, Meteora DBC equity launch prescriptions, and a Client Agent stdin/stdout surface (`npm run stocks:advice`). Execution, custody, and ETF issuance remain closed. See [plans/stocklana.md](plans/stocklana.md) and [stocks/vision.md](stocks/vision.md).

[VERIFIED, prior local implementation check, 2026-09-05] The first slice returned `tests 40`, `pass 40`, `fail 0`, `cancelled 0`, `skipped 0`, and typecheck exited `0`. The registry test matches four historical token metadata entries. Live assessment now starts after collection. Automated stop and export checks pass. The approved escalated ten-scan operating check completed. The historical `use_default` failure remains separate, and its context difference remains not determined. Obsidian desktop rendering remains unverified.

[REPORTED, preliminary source freeze, 2026-09-05] Root earlier reported `npm run typecheck` exit `0`, agent plus vault tests `22/22`, CLI tests `11/11`, and the full suite `tests 57`, `pass 57`, `fail 0`, `cancelled 0`, `skipped 0`. This result is superseded by the final 59-test evidence below. It did not close P1-T07, CHK-10, CHK-11, CHK-12, or CP1B. No real agent thesis run existed.

[VERIFIED, final source/test freeze evidence, 2026-09-05] The saved full-suite output contains `tests 59`, `pass 59`, `fail 0`, `cancelled 0`, `skipped 0`, and its exit file contains `0`. The focused output contains `tests 35`, `pass 35`, `fail 0`, `cancelled 0`, `skipped 0`, and its exit file contains `0`. The typecheck exit file contains `0`. See the [P1-T07 fixture record](docs/verification/2026-09-05-agent-fixture.md). This validates the local fixture path only. No real agent thesis run exists.

[REPORTED, team roles, 2026-09-05] Root only orchestrates and reports. GPT-5.6 Luna agents own implementation and measurement work. Their reports retain their own provenance. Synthetic fixtures and test doubles do not represent live provider or model runs.

- [INFERRED, implementation choice] Start with Solana and Base. Add Robinhood Chain after an asset-specific route assessment. Tempo remains a later candidate.
- [INFERRED, implementation choice] Build one local TypeScript package. Preserve the earlier Obsidian research and keep Citadel deferred.
- [INFERRED, implementation choice] First slice: public quote collection, exact candidate comparison, durable evidence, and linked Obsidian notes. Support one scan or repeated scans with a stop control.
- [INFERRED, boundary] Capital ownership is unresolved. This slice needs no wallet, funds, signing, or token launch.

## Product loop

[INFERRED, plan] Research agents collect selected sources. The Obsidian graph connects evidence, assets, venues, strategies, and outcomes. An existing agent uses that evidence to propose opportunities. Live data and deterministic checks govern later execution. Confirmed outcomes return to the graph.

[INFERRED, MVP boundary] The first usable MVP ends with four results: a Solana and Base collector, one cited thesis from the selected existing agent, one paper-cycle outcome, and one review view that links the candidate, evidence, thesis, and outcome.

[INFERRED, delivery boundary] Broader strategies, a third chain, live capital, signing, automatic note ingestion, and investor pooling belong to later slices. Coverage is explicit. A polling process cannot claim to discover every opportunity.

## Language

| Term | Meaning |
| --- | --- |
| Observation | [INFERRED, definition] One provider response, its request, local times, validation result, and raw evidence. |
| Candidate | [INFERRED, definition] Two sequential quotes for equal intermediate asset quantities on different chains. |
| REJECT | [INFERRED, definition] The quoted cycle has no positive difference, or its evidence fails freshness checks. |
| REVIEW | [INFERRED, definition] A positive quoted difference exists, but costs, inventory, and fills remain unproven. |
| UNAVAILABLE | [INFERRED, definition] Required quotes failed or could not be validated. |
| stocks.advice | [VERIFIED, definition, 2026-09-18] Non-binding Stocks Specialist basket advice for a Client Agent. Statuses: `PUBLISHED`, `BLOCKED`, `NO_DATA`. Always `executionReady: false`. |
| stocks.agent-request | [VERIFIED, definition, 2026-09-18] Bounded stdin envelope for Client Agents (`fixture` or `snapshot` mode). See [stocks/agent.md](stocks/agent.md). |

## Evidence rules

[INFERRED, invariant F1] Only allowlisted quote GET requests are permitted in the first slice. Never send wallet details or request a transaction.

[INFERRED, invariant F2] Validate token identity, exact input amounts, response shape, and timestamps. Provider failures remain visible in the recorded scan.

[INFERRED, invariant F3] Match the second leg's EURC input to the first leg's EURC output. Use integer arithmetic. USD gas estimates remain separate from USDC amounts. Net profit remains unknown until all costs and outcomes are established.

[INFERRED, invariant F4] Keep canonical JSON evidence outside editable Markdown. Generate stable links inside a dedicated vault subtree. Never overwrite human notes or follow symlinks outside the chosen output roots.

[INFERRED, invariant F5] Scan cycles do not overlap. A stop signal cancels requests and sleeps. Show source errors and stale observations instead of presenting an empty list as a healthy scan.

[INFERRED, invariant F6] Demonstration data must be visibly synthetic. Public quotes are observations, not fills or proof of account balances. EURC is euro exposure, so USDC/EURC is an FX pair.

[VERIFIED, invariant correction, 2026-09-05] Live scans capture `assessedAt` after collection completes. Demo scans keep one deterministic timestamp. The existing ten-second observation window and stale, future, provider-time, and expiry checks remain unchanged.

[VERIFIED, metadata correction, 2026-09-05] The configured addresses and six-decimal values match the saved historical RPC capture in the saved test fixture. Runtime metadata revalidation is not performed. This evidence supports registry configuration for the captured date only.

## Authority and references

[VERIFIED, repository read] The cloned repository contained four documents and no application files at commit `d818320`. `VISION.md:13` selected Phoenix perps. The old design excluded arbitrage at `docs/superpowers/specs/2026-08-28-falconos-phase-0-design.md:24` before the historical notice was added.

[INFERRED, scope correction] This context and [the current roadmap](plans/roadmap.md) govern the new build. The [plan index](plans/README.md) links task status and acceptance checks. The earlier vision and Phase 0 design remain historical references. Their Phoenix-only scope and Pi/Mac deployment are superseded for this slice. Their evidence and authority boundaries remain useful.

## Least confident decisions

1. [INFERRED] Agent operators will pay for this layer. Customer interviews and priced pilots remain necessary.
2. [INFERRED] Stored graph context improves decisions. Compare the same agent with and without it.
3. [INFERRED] Solana/Base stablecoin opportunities survive complete costs. Earlier quotes did not establish this.
4. [INFERRED] Robinhood is the best third chain. Actual route depth and exits remain unmeasured.
