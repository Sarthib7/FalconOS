# FalconOS

[VERIFIED, user direction, 2026-09-05] FalconOS is a multichain research and trading layer above existing agents. The user requested liquidity pooling, arbitrage, stablecoin peg strategies, sniping, investing, and execution. The user also selected Obsidian for a knowledge graph and continuous discovery.

[VERIFIED, user authorization] The user requested: "ok document and update the plan" and "lets start building". This authorizes the local build. The previous validation verdict remains go validate. Starting the prototype does not establish customer demand.

## Current direction

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

## Confirmed domain decisions

[VERIFIED, user-confirmed domain decision, 2026-09-18] FalconOS is the umbrella product. Falcon Investment Council is the current module, and the current category is agent-first market intelligence and risk advisory. Future direction may include pooled investing, firm-curated portfolios, custom ETFs or stock baskets, custody, allocation, and execution; a possible regulated entity would be a separate Falcon investment-management brand, potentially Falcon Hedge Fund.

[VERIFIED, user-confirmed boundary, 2026-09-18] The current product remains advisory-only and read-only. FalconOS and Falcon Investment Council do not claim custody, pooling, signing, allocation, order submission, or execution. Future investment operations are directional only and are not current capabilities or promises.

[VERIFIED, user-confirmed domain decision, 2026-09-11] FalconOS is the umbrella product. Falcon Skills is an installable CLI/skill that existing Client Agents add. The FalconOS plugin lets a Client Agent request Falcon Investment advice or copilot help.

[VERIFIED, user-confirmed domain/API decision, 2026-09-11] FalconOS exposes separate `council.advice` and `council.copilot` operations with exact, non-interchangeable schemas. `council.advice` returns canonical-snapshot/evidence-backed, non-binding Trade Proposals with risk-veto outcomes `BLOCKED`/`NO_DATA`. `council.copilot` explains an existing proposal, snapshot, or result and cannot create or alter stance, size, leverage, risk bounds, policy, veto, expiry, or execution. Provider, model, and tool selection stays host-controlled. The existing stablecoin `plugin` contract remains unchanged.

[VERIFIED, repository implementation boundary, 2026-09-11] The first local slice fixes exact schemas and host transport for both operations in `preps/perps.ts`: advice executes Lead Specialist then independent Risk Review; Copilot retains full snapshot evidence and is explanation-only. Durable host transport/adapters remain outside this module.

[VERIFIED, user-confirmed domain decision, 2026-09-11] Falcon Investment is a council of specialist advisory agents, not an autonomous trader. The council's specialist domains are perps, stocks, stablecoins, arbitrage, memecoins, liquidity pools, and AMMs. All of these specialists are defined in the domain model; only the Perps Specialist is built first.

[VERIFIED, user-confirmed domain decision, 2026-09-11] The council shape is one lead specialist plus an independent risk reviewer. The existing Client Agent remains the final decision and execution owner.

[VERIFIED, user-confirmed domain decision, 2026-09-11] The independent risk reviewer is a veto-only gate on Falcon Investment's published council advisory. A critical-risk `BLOCK` or reviewer `NO_DATA`/failure suppresses an endorsed Trade Proposal and yields visible `BLOCKED`/`NO_DATA`. The reviewer never controls the Client Agent's independent decision or execution. Full lead/review records are preserved for audit; reviewer `PASS` is not approval.

[VERIFIED, user-confirmed domain decision, 2026-09-11] FalconOS and Falcon Investment provide no custody, pooled capital, signing, or order submission. Advice does not itself move funds or place orders.

[VERIFIED, user-confirmed domain decision, 2026-09-11] The first perps scope includes Phoenix on Solana and Hyperliquid. This names the venues only; no exact instruments or markets are assumed until separately confirmed.

[VERIFIED, user-confirmed domain decision, 2026-09-11] The first Perps Specialist covers one SOL perpetual on Phoenix and one SOL perpetual on Hyperliquid. Exact venue-native market IDs, contract specifications, collateral and settlement details, and data requirements remain unresolved.

[VERIFIED, user-confirmed domain/API decision, 2026-09-11] FalconOS pins one exact native SOL-perpetual contract definition per Phoenix and Hyperliquid in a versioned, host-owned registry. The registry includes native identity, collateral/settlement, contract type/multiplier, precision/tick/lot, limits, fees, oracle/index/mark/funding, margin/liquidation semantics, capabilities, capture/effective provenance, raw hash, and adapter version. Critical missing or conflicting metadata yields `NO_DATA`; there is no generic alias fallback.

[INFERRED, unresolved] Exact native IDs and values, effective intervals, and the final registry schema remain unresolved.

[VERIFIED, user-confirmed domain decision, 2026-09-11] FalconOS owns each canonical market snapshot. FalconOS acquires, normalizes, hashes, and freezes one immutable snapshot before council analysis; the lead specialist and independent risk reviewer consume the same snapshot bytes and hash. Client Agent evidence is not canonical unless FalconOS accepts it.

[VERIFIED, user-confirmed domain/API decision, 2026-09-11] FalconOS uses a deterministic federated canonical snapshot. The Q7 registry is authoritative for static contract identity. Each dynamic field uses a host-owned versioned primary source with an optional secondary cross-check; exact raw bytes and one normalized projection are retained. Critical missing, conflicting, or unparseable fields yield `NO_DATA`; per-field freshness stays under a hard coherence cap. The snapshot is an append-only content-addressed manifest plus immutable raw bundle, and both advisors consume the same canonical bytes and hash. Client Agent evidence and notes remain non-canonical unless accepted.

[VERIFIED, user-confirmed domain/API decision, 2026-09-11] Dynamic snapshot fields use fixed host-owned versioned primary sources with optional predeclared secondary cross-check/failover. A secondary may replace its primary only on typed primary-unavailable status and prevalidated semantic equivalence; disagreement never triggers replacement. FalconOS records the source used and policy version. Critical missing, conflicting, unparseable, sequence-gap, or stale data yields `NO_DATA`; per-field TTLs stay under the hard coherence cap.

[VERIFIED, repository implementation boundary, 2026-09-11] The local perps contract fixes schema `1`; venues `phoenix` and `hyperliquid`; one native SOL perpetual registry entry per venue; dynamic fields `indexPrice`, `markPrice`, `fundingRate`, and `openInterest`; per-venue versioned source policy with typed primary/secondary identities, semantic versions, policy version, and `freshnessTtlMs`; one two-venue capture/coherence envelope; raw manifest, normalized projection, source decisions, deterministic bytes/hash, and deeply frozen in-memory output.
[VERIFIED, repository implementation boundary, 2026-09-11] Canonical ingress decodes and hashes every retained raw capture, reconstructs source/selected/normalized/missing/conflict projections, and rejects altered components even when outer hashes are recomputed. Captures carry sequence plus continuity (`continuous`/`gap`); TTL and selected age cannot exceed coherence cap. Trade Proposal ingress validates primitive expiry, horizon, invalidations, provenance, and full policy/account/evidence bindings; bound proposals must match bundle and selected-market readiness/status. Advice returns a frozen audit record containing full lead/risk/policy/account/evidence records, including typed risk `critical`/`veto` fields; durable append-only persistence remains external.
[BOUNDARY, repository adapter contract, 2026-09-11] Registry source IDs, adapter/semantic versions, raw bytes, and normalized values are checked for internal consistency. Raw bytes do not independently establish provider-specific semantic meaning; normalization remains a host-owned adapter attestation boundary. Official live adapters/native metadata remain unresolved external prerequisites.
[VERIFIED, repository implementation boundary, 2026-09-11] Direct publish with no proposal records explicit lead `NOT_CALLED`/`FAILED`; risk `PASS` yields top-level `NO_DATA` and risk `BLOCK` yields `BLOCKED`. A validated lead proposal is retained in audit when later risk transport fails. Valid-request safe fallback preserves policy/account state and returns immutable `NO_DATA`; malformed advice/Copilot fallbacks with no valid snapshot use `snapshotEvidence: null`, remain visible `NO_DATA`, deeply frozen, and self-validate.
[INFERRED, unresolved] Official Phoenix/Hyperliquid native metadata and live adapters, durable host persistence for append-only audit, deployed source-policy values, and final storage details remain unresolved. The model-knowledge boundary for backtests remains unresolved as recorded under Advisory modes.


[VERIFIED, user-confirmed domain decision, 2026-09-11] The Perps Specialist may return a structured, non-binding Trade Proposal containing policy-referenced suggested size, leverage, and estimated risk bounds; stance; scenarios; calibrated confidence; holding horizon; machine-readable invalidations; snapshot evidence; expiry; and explicit `NO_DATA`.

[VERIFIED, user-confirmed domain boundary, 2026-09-11] Numeric values in a Trade Proposal are estimates only, remain subject to Client Agent policy and deterministic verification, and never authorize orders, transactions, signing, approval, or execution.

[VERIFIED, user-confirmed domain boundary, 2026-09-11] If policy or account state is missing, numeric Trade Proposal suggestions for size, leverage, and risk bounds MUST remain null/unknown. FalconOS must not invent defaults.

[INFERRED, unresolved] The exact Trade Proposal schema, enum names, units, and other conditions for non-null numeric values remain unresolved.

[VERIFIED, user-confirmed domain decision, 2026-09-11] The first live mode is live market data and advisory. Paper/simulation follows, with live execution later. [INFERRED, unresolved] The ordering and release relationship of backtest are not confirmed.

## Specialist roster

| Specialist | Domain boundary |
| --- | --- |
| Perps Specialist | Advises on perpetuals; this is the first specialist built. |
| Stocks Specialist | Advises on stocks. |
| Stablecoin Specialist | Advises on stablecoins. |
| Arbitrage Specialist | Advises on arbitrage opportunities. |
| Memecoin Specialist | Advises on memecoins. |
| Liquidity Pool Specialist | Advises on liquidity pools. |
| AMM Specialist | Advises on automated market makers (AMMs). |

## Advisory modes

[VERIFIED, user-confirmed terminology, 2026-09-11] **Live advisory** means using live market data to provide advice without executing trades.

[VERIFIED, user-confirmed terminology, 2026-09-11] **Paper/simulation** means evaluating hypothetical trades without real capital or orders.

[VERIFIED, user-confirmed terminology, 2026-09-11] **Backtest** means evaluating a strategy against historical market data without real capital or orders.

[VERIFIED, user-confirmed terminology, 2026-09-11] **Live execution** means real trading activity; the confirmed sequence is live advisory, then paper/simulation, then later live execution. **Backtest** is the separate track defined in the following decision. The Client Agent remains the execution owner.

[VERIFIED, user-confirmed domain decision, 2026-09-11] **Backtest** is a separate parallel or post-observation historical-replay validation track. It does not block initial live advisory or explicitly provisional paper/simulation, but it is required before FalconOS permits later live execution and before performance or alpha claims. Backtest remains distinct from live advisory, paper/simulation, and live execution, and binds the historical dataset, strategy/model release, replay assumptions, metrics, and known blind spots. This supersedes the prior unresolved ordering note.

[INFERRED, unresolved safety condition] Backtest must bind the model-knowledge boundary in addition to the historical dataset and strategy/model release. If exclusion of post-period LLM/model knowledge cannot be verified, historical replay is unsuitable for alpha or performance claims; forward paper evaluation is required for performance evidence.

[INFERRED, unresolved] Backtest tolerance requirements and the exact live-execution/performance-claim release gate remain unresolved.

## Domain boundary

[VERIFIED, user-confirmed domain boundary, 2026-09-11] The current quote-cycle/plugin implementation is a legacy stablecoin evidence contract. It must not be silently treated as the Falcon Investment perps contract.

## Canonical glossary

| Term | Meaning |
| --- | --- |
| FalconOS | The umbrella product that encompasses Falcon Skills, the FalconOS plugin, and Falcon Investment advisory. |
| Falcon Skills | An installable CLI/skill that an existing Client Agent adds. |
| Client Agent | The existing client agent that can add Falcon Skills, request Falcon Investment advice, and retain final decision and execution ownership. |
| Falcon Investment Council | The council of specialist advisory agents known as Falcon Investment; it provides advice and is not an autonomous trader. |
| Specialist Advisor | A specialist advisory agent that contributes domain-specific analysis to the Falcon Investment Council. |
| Perps Specialist | The Specialist Advisor for perpetuals; the first specialist built, with initial venue scope limited to Phoenix on Solana and Hyperliquid. |
| Specialist Advisory | Non-executing analysis or advice provided by a Specialist Advisor or the Falcon Investment Council. |
| Trade Proposal | A non-binding recommendation describing a possible trade for the Client Agent to evaluate; it is not an order or an execution outcome. |
| Execution Outcome | The result of a Client Agent-owned execution decision, including when no execution occurs; it is distinct from a Trade Proposal. |


## Language

| Term | Meaning |
| --- | --- |
| Observation | [INFERRED, definition] One provider response, its request, local times, validation result, and raw evidence. |
| Candidate | [INFERRED, definition] Two sequential quotes for equal intermediate asset quantities on different chains. |
| REJECT | [INFERRED, definition] The quoted cycle has no positive difference, or its evidence fails freshness checks. |
| REVIEW | [INFERRED, definition] A positive quoted difference exists, but costs, inventory, and fills remain unproven. |
| UNAVAILABLE | [INFERRED, definition] Required quotes failed or could not be validated. |

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
5. [INFERRED, unresolved] Whether FalconOS or Falcon Investment may publicly or legally use the phrase “investment firm” is unconfirmed. Treat that phrase as unresolved until the relevant public and legal use is reviewed.
6. [INFERRED, unresolved] The underlying is confirmed as one SOL perpetual on Phoenix and one SOL perpetual on Hyperliquid. Exact native IDs and values, effective intervals, and the final versioned registry schema remain unresolved.

## Session update: 2026-09-16

[VERIFIED, user direction, 2026-09-16] Work paused after landing deployment and PreStocks dash investigation. User requested documentation and progress update only.

### Public surface

[VERIFIED, live fetch, 2026-09-16] **`https://falconos.markets/`** serves the approved **dark Liquid Metal** landing page (SPEC V55, task T22 complete). Hero copy: *Built for agents. Visible to you.* Site remains advisory-only; no wallet, signing, custody, or live execution claims (V48, V51).

[VERIFIED, repository read, 2026-09-16] `web/` is an isolated **Vite static** package: self-contained `index.html`, optional `/dash` snapshot page, Cloudflare Pages settings in `web/README.md`. Local verification: build exit `0`; `npm --prefix web test` → 8/8 pass.

### Dash / Stocklana track

[REPORTED, dash, 2026-09-16] `dash/` is an isolated read-only terminal dashboard (T27 in progress). PreStocks pre-IPO basket (OPENAI + SPACEX mints) uses DEX Screener pool evidence + PreStocks issuer marks. **Scaled-UI normalization shipped locally** (T28, V66): token-2022 multipliers must be applied before comparing pool vs issuer prices; disagreement fails closed to `NO_DATA`.

[REPORTED, hackathon, 2026-09-16] **Stocklana** (Solana hackathon) lists **$100K** pre-IPO prize pool; submissions close **2026-09-25**. PreStocks API and mints align with this track; dash smoke is a live keyless proof path, not a submission artifact.

### Git boundary

[BOUNDARY, 2026-09-16] Local `main` and `origin/main` **diverged** after an unprompted push of dash-only commit `ea2c053`. Local HEAD `42e87d8` adds SPEC V66 backprop. **No further remote writes** until the user approves a reconciliation plan.
