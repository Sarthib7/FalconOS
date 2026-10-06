# FalconOS


## Session update: 2026-10-05

[VERIFIED, user direction, 2026-10-05] FalconOS has two delivery paths: a lower-cost plugin for individuals and a Falcon-hosted organization workspace with a dedicated Falcon Agent. Organization agents support CFO, budget, compliance workflow, treasury, stocks, and hedging tasks. Customer assets remain in customer-controlled wallets or accounts. FalconOS runs agent infrastructure and decision graphs; this direction does not pool or custody customer capital.

[NOT DETERMINED] Exact pricing, cloud tenant model, transaction authority, signing and revocation path, and legal requirements. This product direction does not establish current implementation.

See [ADR 0008](docs/adrs/0008-two-tier-agent-platform.md) and [ADR 0009](docs/adrs/0009-customer-controlled-assets.md). The 2026-09-30 pooled-capital interpretation below is historical where it conflicts with this update.

## Session update: 2026-09-30

[VERIFIED, user direction, 2026-09-30] FalconOS's product destination is an investment manager with a deal desk. One Customer Agent faces the Investor. One Decision Engine runs specialists and graphs behind it. Other agents reach that engine through a plugin that first returns investor-specific guidance. Discovery is global. Investor residence is an eligibility input, not a search bound. See [ADR 0005](docs/adrs/0005-investment-manager.md), [ADR 0006](docs/adrs/0006-one-agent-decision-engine.md), and [ADR 0007](docs/adrs/0007-global-discovery-alerts.md).

[VERIFIED, supersession] This destination supersedes the 2026-09-18 statement that FalconOS stays advisory-only forever and that pooled investing, custody, allocation, and execution belong only to a later separate brand. It does not supersede current module contracts. Council, plugin, engine, dashboard, and mesh remain advisory or owner-signed Devnet proofs until SPEC and implementation change.

[VERIFIED, example only] A US Investor considering a German tokenized energy project was an illustration. No such project, return, or venue was verified in this session.

### Language added 2026-09-30

**Investor**:
A person FalconOS interviews and may later advise, deal for, or manage money for.
_Avoid_: user, customer as the glossary noun (Customer Agent is the front voice; Client Agent is an external consuming agent)

**Investor Dossier**:
The persistent structured profile of goals, residence, horizon, loss tolerance, liquidity need, currency, and constraints.
_Avoid_: KYC dump, chat log as the profile

**Customer Agent**:
The single investor-facing voice of FalconOS.
_Avoid_: exposing each Specialist Advisor as a separate chatbot

**Decision Engine**:
The shared backend that runs specialists, eligibility, graphs, receipts, and traces.
_Avoid_: a second advisory brain per client

**Lead**:
An unverified market finding.
_Avoid_: calling a scrape hit an Opportunity

**Opportunity**:
A Lead that has verified terms, ownership rights, costs or an explicit unknown, and an exit path.

**Deal Desk**:
The operating role that sources and arranges investments with issuers or venues.

**Plan Receipt**:
The pre-movement comparison of feasible routes with stamped fields or explicit unknowns.

**Cash Trace**:
The post-movement record of where funds sit and how to exit.

**Who-Acts**:
The triple of who holds funds, who executes, and who signs, shown before approval.

### Language added 2026-10-05

**Personal Plugin**:
A lower-cost Falcon capability accessed through an individual's existing compatible agent environment.
_Avoid_: personal hosted workspace

**Organization Workspace**:
A Falcon-hosted account for a company, startup, team, or institution, with its own Falcon Agent and customer-specific state.
_Avoid_: shared customer account

**Customer-Controlled Account**:
A wallet or financial account whose assets remain under the customer's control and which the customer connects to FalconOS.
_Avoid_: Falcon custody

**Falcon Agent**:
The customer-facing agent for one person or organization. Specialist capabilities and decision graphs run through the shared Decision Engine.
_Avoid_: a separate reasoning engine per customer

**Agent Mandate**:
The customer's stated financial goals, limits, and permitted agent actions. Wallet signing and delegated authority remain separate decisions.
_Avoid_: wallet connection as permission

## Least confident decisions added 2026-09-30

1. [INFERRED, unresolved] Whether FalconOS may legally manage money, arrange deals, or send opportunity alerts in any jurisdiction. No legal review was done in this session.
2. [INFERRED, unresolved] Whether pooled capital stays inside FalconOS or still needs a separate entity.
3. [NOT DETERMINED] The first real Opportunity source. None was verified here.
4. [INFERRED] Fixed fees and FX will often dominate a $100 example. That is a product constraint, not a measured fee schedule.

## Repository work: 2026-09-27

[VERIFIED, user choice] The user selected option `1`: retain folders, document current architecture and authority, expose component verification, and check website/API release inputs. The [current map](docs/README.md) is the navigation entry point. [Status](status.md) records active tasks and measured results. Dated sections below preserve prior product decisions and evidence; their old current-state labels do not supersede newer records for the same component.

## Active dashboard port: 2026-09-27

[VERIFIED, retained release evidence] The user requested the new website live. Initial React release `bfa82ca` was followed by signup backend `61fa1a9` and completion UI `9af809b` at `https://falconos.markets/`. The dashboard remains `/dashboard/`. The latest retained proof matches all 39 public asset hashes. This corrects the earlier pending-signup-repair statement. Hosted mesh connectivity and inbox delivery remain unverified. See [the signup release evidence](docs/verification/2026-09-27-cloudflare-email.md).

[VERIFIED, user direction] The user requested the dashboard designs from the same OpenDesign project as runnable React. Its current index opens Control Centre. The additive `/dashboard/` route preserves Overview, Decisions, Knowledge and Connections. See [the port contract](docs/control-centre.md). Existing mesh and wallet services retain their current boundaries.

## Active knowledge mesh MVP: 2026-09-27

[VERIFIED, user direction] The graph must connect knowledge and support analysis. The user named local Citadel as a reference, accepted a separate Falcon mesh, and approved Railway API plus Postgres. The user then selected the personal workspace and said, "before that build the mvp first", including connectors, the terminal, and Devnet execution.

[VERIFIED, correction] Earlier graph completion describes the six-node browser decision trace. It does not complete the connected knowledge layer. `web/treasury/domain.mjs:170` is the existing fixed graph. Preserve its saved history while adding the [persistent mesh](docs/knowledge-mesh.md).

[INFERRED, working order] Build local persistence and source-linked traversal. Connect approved live sources and the terminal. Verify the Devnet lending path and retained results after graph acceptance. Hosting follows local MVP evidence. Real-fund tests remain later.

[VERIFIED, expanded user direction] The landing must preserve the active OpenDesign project in runnable React. Email signup must persist addresses. Optional confirmation delivery must state its actual result. See [local run commands](mesh/README.md) and [the email contract](docs/landing-email.md).

## Active graph work: 2026-09-27

[VERIFIED, user direction] The user approved this order: finish decision graphs, hosting design, interface, and full flow; then Devnet execution; then define the final live test. The user said, "start working on it."

[INFERRED, implementation scope] Build the browser decision-graph prototype with synthetic evidence, versioned saved decisions, rule inspection, and replay. Prepare Cloudflare Pages hosting. See [graph contract](docs/decision-graph.md) and [updated plan](plans/treasury-mvp.md).

[VERIFIED, correction] The earlier local simulation completion does not mean the decision-graph product is finished. The user's correction makes graph acceptance the prerequisite for execution work.

## Active treasury direction: 2026-09-26

[VERIFIED, new user direction] The user accepted the [staged Falcon pitch](docs/pitches/falcon-stages.html), requested the spec and MVP, and confirmed: "Local loop first, let's do that." The user also requested a future cloud path so others can test it.

[INFERRED, scoped change] Falcon's new product direction is a personal stablecoin treasury agent within owner-set rules. The active slice is an isolated, explicitly simulated treasury loop. It does not expand the authority of the existing advisory engine, plugin, or Devnet terminal. The complete Stage 01 lending and delegated-execution design remains proposed until its integration gates pass.

[INFERRED, record correction] The earlier statements that exclude every future Falcon treasury execution path describe the prior direction. The new accepted pitch supersedes that product direction for the treasury work. Earlier implementation boundaries remain effective for their named modules. Start with [the new documentation index](docs/README.md), [the plan](plans/treasury-mvp.md), and SPEC I14.

## Earlier advisory direction and evidence

[VERIFIED, user-confirmed direction, 2026-09-18] FalconOS is the umbrella product. Falcon Investment Council is the current module: agent-first market intelligence and risk advisory, advisory-only and read-only. See "Confirmed domain decisions" below. [SUPERSEDED, 2026-09-20] The original 2026-09-05 framing ("a multichain research and trading layer" with liquidity pooling, arbitrage, sniping, and execution) is historical. Execution-adjacent capabilities belong, if ever, to a separate regulated Falcon entity, not to FalconOS. [SUPERSEDED IN PART, 2026-10-04] "read-only" excludes the Devnet signed transaction path added in SPEC §C:16 and §C:45. Advisory-only boundary is retained for mainnet, real funds, and automatic signing.

[VERIFIED, user authorization] The user requested: "ok document and update the plan" and "lets start building". This authorizes the local build. The previous validation verdict remains go validate. Starting the prototype does not establish customer demand.

## Direction and baseline: 2026-09-05

[HISTORICAL — current test results are in status.md#ci-automation.]

[VERIFIED, prior local implementation check, 2026-09-05] The first slice returned `tests 40`, `pass 40`, `fail 0`, `cancelled 0`, `skipped 0`, and typecheck exited `0`. The registry test matches four historical token metadata entries. Live assessment now starts after collection. Automated stop and export checks pass. The approved escalated ten-scan operating check completed. The historical `use_default` failure remains separate, and its context difference remains not determined. Obsidian desktop rendering remains unverified.

[REPORTED, preliminary source freeze, 2026-09-05] Root earlier reported `npm run typecheck` exit `0`, agent plus vault tests `22/22`, CLI tests `11/11`, and the full suite `tests 57`, `pass 57`, `fail 0`, `cancelled 0`, `skipped 0`. This result is superseded by the final 59-test evidence below. It did not close P1-T07, CHK-10, CHK-11, CHK-12, or CP1B. No real agent thesis run existed.

[VERIFIED, final source/test freeze evidence, 2026-09-05] The saved full-suite output contains `tests 59`, `pass 59`, `fail 0`, `cancelled 0`, `skipped 0`, and its exit file contains `0`. The focused output contains `tests 35`, `pass 35`, `fail 0`, `cancelled 0`, `skipped 0`, and its exit file contains `0`. The typecheck exit file contains `0`. See the [P1-T07 fixture record](docs/verification/2026-09-05-agent-fixture.md). This validates the local fixture path only. No real agent thesis run exists.

[REPORTED, team roles, 2026-09-05] Root only orchestrates and reports. GPT-5.6 Luna agents own implementation and measurement work. Their reports retain their own provenance. Synthetic fixtures and test doubles do not represent live provider or model runs.

- [INFERRED, implementation choice] Start with Solana and Base. Add Robinhood Chain after an asset-specific route assessment. Tempo remains a later candidate.
- [INFERRED, implementation choice] Build one local TypeScript package. Preserve the earlier Obsidian research and keep Citadel deferred.
- [INFERRED, implementation choice] First slice: public quote collection, exact candidate comparison, durable evidence, and linked Obsidian notes. Support one scan or repeated scans with a stop control.
- [INFERRED, boundary] Capital ownership is unresolved. This slice needs no wallet, funds, signing, or token launch.

## Product loop

[INFERRED, plan] Research agents collect selected sources. The Obsidian graph connects evidence, assets, venues, strategies, and outcomes. An existing agent uses that evidence to propose opportunities. Confirmed outcomes return to the graph. [SUPERSEDED, 2026-09-20] The former "later execution" clause is removed; execution is not on the FalconOS path. [SUPERSEDED IN PART, 2026-10-04] Devnet signing is now on the path (SPEC §C:16, §C:45). Mainnet, pooled capital, and automatic execution remain excluded.

[INFERRED, MVP boundary] The first usable MVP ends with four results: a Solana and Base collector, one cited thesis from the selected existing agent, one paper-cycle outcome, and one review view that links the candidate, evidence, thesis, and outcome.

[INFERRED, delivery boundary] Broader strategies, a third chain, and automatic note ingestion belong to later slices. Coverage is explicit. A polling process cannot claim to discover every opportunity. [SUPERSEDED, 2026-09-20] Signing is not a FalconOS slice. [RE-ADDED, 2026-10-04] Owner-signed Devnet transactions are now the MVP path (SPEC §C:16, §C:45). [SUPERSEDED, 2026-09-20] Pooled client capital and mainnet trading remain excluded; they belong, if ever, to a separate regulated Falcon entity.

## Confirmed domain decisions

[VERIFIED, user-confirmed domain decision, 2026-09-18] FalconOS is the umbrella product. Falcon Investment Council is the current module, and the current category is agent-first market intelligence and risk advisory. Future direction may include pooled investing, firm-curated portfolios, custom ETFs or stock baskets, custody, allocation, and execution; a possible regulated entity would be a separate Falcon investment-management brand, potentially Falcon Hedge Fund.

[VERIFIED, user-confirmed boundary, 2026-09-18] The current product remains advisory-only and read-only. FalconOS and Falcon Investment Council do not claim custody, pooling, signing, allocation, order submission, or execution. Future investment operations are directional only and are not current capabilities or promises.

[VERIFIED, user-confirmed domain decision, 2026-09-11] FalconOS is the umbrella product. Falcon Skills is an installable CLI/skill that existing Client Agents add. The FalconOS plugin lets a Client Agent request Falcon Investment advice or copilot help.

[VERIFIED, user-confirmed domain/API decision, 2026-09-11] FalconOS exposes separate `council.advice` and `council.copilot` operations with exact, non-interchangeable schemas. `council.advice` returns canonical-snapshot/evidence-backed, non-binding Trade Proposals with risk-veto outcomes `BLOCKED`/`NO_DATA`. `council.copilot` explains an existing proposal, snapshot, or result and cannot create or alter stance, size, leverage, risk bounds, policy, veto, expiry, or execution. Provider, model, and tool selection stays host-controlled. The existing stablecoin `plugin` contract remains unchanged.

[VERIFIED, repository implementation boundary, 2026-09-11] The first local slice fixes exact schemas and host transport for both operations in `perps/perps.ts` (folder renamed from `preps/` on 2026-09-20): advice executes Lead Specialist then independent Risk Review; Copilot retains full snapshot evidence and is explanation-only. Durable host transport/adapters remain outside this module.

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

[VERIFIED, user-confirmed, 2026-09-30] **Devnet execution proof** means a wallet-signed lending supply and redemption with test tokens on Solana Devnet, confirmed receipts, reconciled balances, and saved history. It is distinct from an unsigned simulation and from funded live execution.

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

[HISTORICAL — root dash/ Node package deleted; engine/ Rust crate is the replacement. T27 was not completed.] [REPORTED, dash, 2026-09-16] `dash/` is an isolated read-only terminal dashboard (T27 in progress). PreStocks pre-IPO basket (OPENAI + SPACEX mints) uses DEX Screener pool evidence + PreStocks issuer marks. **Scaled-UI normalization shipped locally** (T28, V66): token-2022 multipliers must be applied before comparing pool vs issuer prices; disagreement fails closed to `NO_DATA`.

[REPORTED, hackathon, 2026-09-16] **Stocklana** (Solana hackathon) lists **$100K** pre-IPO prize pool; submissions close **2026-09-25**. PreStocks API and mints align with this track; dash smoke is a live keyless proof path, not a submission artifact. [CLOSED — deadline 2026-09-25 passed; no submission outcome recorded here.]

### Git boundary

[BOUNDARY, 2026-09-16] Local `main` and `origin/main` **diverged** after an unprompted push of dash-only commit `ea2c053`. Local HEAD `42e87d8` adds SPEC V66 backprop. **No further remote writes** until the user approves a reconciliation plan.
