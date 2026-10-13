# FalconOS Vision: Agent Platform for Capital Operations

**Status:** Product destination, not current capability
**Updated:** 2026-10-05
**Authority:** User direction and repository evidence. Not legal advice or an operating offer.

## Current Product Direction (2026-10-05)

Source: VERIFIED, user direction, 2026-10-05. FalconOS has two delivery paths. Individuals can use lower-cost Falcon plugins through their existing agent environment. Companies, startups, teams, and institutions can use a Falcon-hosted account with a dedicated Falcon Agent.

Source: VERIFIED, user direction, 2026-10-05. The organization service manages agent infrastructure and decision graphs. Its intended work includes treasury, budgets, compliance workflows, CFO tasks, stocks, and hedging. Exact packages and prices remain NOT DETERMINED.

Source: VERIFIED, user direction, 2026-10-05. Customer funds stay in customer-controlled wallets or financial accounts connected to FalconOS. FalconOS does not take custody or pool customer capital in this product model.

Source: INFERRED, architecture direction. Each customer gets a distinct agent identity and isolated mandate and account state. Agents use one shared Decision Engine, specialist capabilities, and decision-graph infrastructure. Do not create a separate reasoning engine per customer.

Source: NOT DETERMINED. Wallet connection does not define transaction authority. Signing, delegated permissions, automation limits, revocation, recovery, and incident controls need a separate design. The current implementation remains limited to capabilities recorded in SPEC.md and component documentation.

Source: INFERRED, future scope. Agents may assess stocks, ETFs, tokenized assets, AMMs, liquidity pools, staking, perpetuals, and other markets when evidence, access, and controls support them. Listing a market here does not mean FalconOS currently supports it.

Source: NOT DETERMINED. Non-custodial operation does not settle licensing, advisory, execution, or compliance requirements. Review the exact service model in each target jurisdiction before launch.

Source: INFERRED, product positioning. The organization cloud tier is the higher-value operating service. The individual plugin tier is a lower-cost entry path. This is a positioning hypothesis, not validated demand or pricing evidence.

## Historical baseline

The earlier vision below is retained as history. It does not define the current two-tier product direction. See ADRs 0008 and 0009.


> [VERIFIED, user direction, 2026-09-05] Historical vision. The user changed the scope to multichain trading with Obsidian research and continuous discovery. [Current context](CONTEXT.md) and [build plan](plans/roadmap.md) now govern implementation. The original text below is preserved as a reference.

> **The Solana-native operating system for verifiable capital agents.**

| Field | Value |
|---|---|
| Document ID | FALCON-VISION-001 |
| Version | 1.0 |
| Status | Finalized product-vision baseline |
| Updated | 28 August 2026 |
| Owner | Founder / FalconOS project |
| Working name | FalconOS / Falcon — codename pending brand, domain, and trademark clearance |
| Initial product wedge | Phoenix perpetuals on Solana |
| Time horizon | Founder proof of concept through the long-term Solana capital operating system |

This document defines what FalconOS exists to achieve, what the product is, the principles that cannot be compromised, and the sequence by which the vision becomes real. It is the source of truth for product direction. Detailed implementation requirements may evolve, but they must remain consistent with this vision.

---

<a id="index"></a>
## Index

1. [Executive vision](#1-executive-vision)
2. [The future we believe in](#2-the-future-we-believe-in)
3. [The problem](#3-the-problem)
4. [Mission, ambition, and product promise](#4-mission-ambition-and-product-promise)
5. [What FalconOS is](#5-what-falconos-is)
6. [Who FalconOS serves](#6-who-falconos-serves)
7. [Product thesis and differentiation](#7-product-thesis-and-differentiation)
8. [The complete product system](#8-the-complete-product-system)
9. [The operating loop](#9-the-operating-loop)
10. [Trust and safety constitution](#10-trust-and-safety-constitution)
11. [Autonomy model](#11-autonomy-model)
12. [The Falcon Brain](#12-the-falcon-brain)
13. [Open-source and proprietary boundary](#13-open-source-and-proprietary-boundary)
14. [Business and revenue model](#14-business-and-revenue-model)
15. [Go-to-market strategy](#15-go-to-market-strategy)
16. [Product roadmap](#16-product-roadmap)
17. [Phase 0: Phoenix perpetuals MVP](#17-phase-0-phoenix-perpetuals-mvp)
18. [Measures of success](#18-measures-of-success)
19. [Defensibility flywheel](#19-defensibility-flywheel)
20. [Non-goals](#20-non-goals)
21. [Risks and release gates](#21-risks-and-release-gates)
22. [Locked decisions](#22-locked-decisions)
23. [Open decisions](#23-open-decisions)
24. [The long-term end state](#24-the-long-term-end-state)
25. [Glossary](#25-glossary)
26. [Research foundation](#26-research-foundation)

---

<a id="1-executive-vision"></a>
## 1. Executive vision

FalconOS will make Solana the safest and most economically useful place for autonomous agents to deploy capital.

Today, an AI agent can read markets, call tools, and submit transactions. That does not make it a trustworthy capital operator. Models hallucinate, state becomes stale, fees erase apparent opportunities, services fail, permissions are overbroad, and a trading delegate that cannot withdraw can still lose all allocated collateral.

FalconOS fills the missing layer between **reasoning** and **money movement**.

It converts a human or agent goal into a typed intent, joins that intent with current Solana state, obtains optional proprietary intelligence, applies deterministic policy and quantitative checks, binds the approved result to an exact transaction, executes with least authority, and reconciles the onchain outcome into permanent evidence.

The initial product is a verifiable agent control plane for Phoenix perpetuals. The long-term product is a Solana-native capital operating system spanning perpetuals, lending, borrowing, swaps, liquidity provision, arbitrage, payments, stablecoins, real-world assets, and agent-to-agent commerce.

**One-sentence pitch**

> FalconOS is the open, verifiable control plane that lets agents use Phoenix—and eventually all of Solana finance—while users keep ownership, deterministic code enforces risk, and a proprietary outcome-calibrated Brain supplies paid intelligence.

**Operating motto**

> **The model proposes. Math decides. Code executes. Solana verifies.**

In literal system terms, the Brain proposes, Falcon’s public verifier authorizes, the restricted signer enforces, and Solana settles the transaction and preserves its history. “Solana verifies” does not mean the chain proves that a recommendation was wise or profitable.

FalconOS does not promise profit. It promises something more fundamental and defensible: every autonomous capital action can be bounded, inspected, attributed, interrupted, and replayed against reality.

[Back to index](#index)

---

<a id="2-the-future-we-believe-in"></a>
## 2. The future we believe in

Autonomous software will become an economic actor. Agents will hold budgets, purchase services, manage treasury, hedge exposure, provide liquidity, borrow, lend, rebalance, and coordinate with other agents continuously.

That future needs more than wallets and tool calls. It needs a capital operating system with four properties:

1. **Live understanding.** The agent understands current protocols, assets, risk relationships, fees, liquidity, and failure conditions—not a static memory of Solana.
2. **Deterministic control.** A model cannot persuade the system to exceed the user’s authority, budget, or risk policy.
3. **Portable proof.** Every recommendation and action produces evidence that another person, agent, protocol, or auditor can verify.
4. **Continuous calibration.** Predicted fills, costs, funding, health, and outcomes are compared with what actually happened, improving future decisions without silent or uncontrolled learning.

In the desired future, a user can express a capital goal such as:

> “Preserve this treasury, seek bounded yield, hedge SOL downside, and never risk more than the limits I approve.”

FalconOS will translate that goal into a portfolio of typed, protocol-specific actions while preserving one coherent policy, one exposure graph, one evidence trail, and one owner-controlled kill path.

[Back to index](#index)

---

<a id="3-the-problem"></a>
## 3. The problem

Solana already has fast settlement, deep financial protocols, wallets, SDKs, order-routing infrastructure, and agent tooling. Phoenix already provides a perpetual venue, account model, margin logic, SDKs, and Vulcan, an experimental agent-oriented CLI.

The missing product is not another order book. It is the control and evidence layer that makes existing infrastructure safe and economically intelligible for autonomous use.

### 3.1 The five gaps

| Gap | What happens without FalconOS |
|---|---|
| Reasoning–execution gap | A persuasive but incorrect model output can become a financial action. |
| Authority gap | “Non-custodial” delegation is mistaken for safety even though a trading key can destroy allocated collateral. |
| State gap | Decisions use stale prices, positions, funding, liquidity, health, or protocol assumptions. |
| Evidence gap | A transaction exists, but the intent, policy, forecast, approval, and actual result cannot be reconstructed. |
| Economic gap | Apparent edge is evaluated before exchange fees, funding, slippage, priority fees, service spend, failure probability, and Falcon fees. |

### 3.2 Why existing categories are incomplete

- A **wallet** signs but does not decide whether the action is economically or operationally safe.
- A **perpetual protocol** executes but does not enforce the user’s complete cross-protocol policy.
- A **CLI or SDK** exposes capabilities but is not a non-bypassable authorization boundary.
- A **trading bot framework** schedules strategies but does not necessarily provide Solana-native state, least-authority execution, signed decision receipts, or outcome calibration.
- An **AI copilot** can explain and suggest, but explanation is not enforcement.
- A **quant signal service** may score an opportunity, but it does not own the full intent-to-reconciliation contract.

FalconOS connects these pieces without unnecessarily rebuilding them.

[Back to index](#index)

---

<a id="4-mission-ambition-and-product-promise"></a>
## 4. Mission, ambition, and product promise

### 4.1 Mission

Enable humans and agents to discover, evaluate, and execute capital opportunities on Solana under user-defined risk, with every decision and action independently verifiable.

### 4.2 Long-term ambition

Become the default operating system and trust standard for autonomous capital on Solana.

### 4.3 Product promise

No live capital action occurs without:

1. a typed and bounded intent;
2. fresh, reconciled state;
3. a versioned user policy;
4. fee-inclusive deterministic evaluation;
5. an unexpired decision receipt;
6. an exact transaction bound to that receipt;
7. a least-authority signer;
8. confirmation and post-action reconciliation.

### 4.4 What the product optimizes for

FalconOS optimizes first for:

1. user ownership;
2. safety and containment;
3. correctness and deterministic replay;
4. resilience and recoverability;
5. transparent net economics;
6. useful autonomy;
7. risk-adjusted outcomes.

Raw PnL is an outcome to measure, not the product’s primary claim or MVP north star.

[Back to index](#index)

---

<a id="5-what-falconos-is"></a>
## 5. What FalconOS is

FalconOS is a **Solana-native autonomous capital stack** with three reinforcing products.

### 5.1 Falcon Runtime — the open body

The Runtime is the installable CLI, skill, SDK, policy gateway, verifier, executor, supervisor, and replay tooling. It gives Codex, OpenClaw, Hermes, custom cloud agents, and terminal users one safe contract for capital actions.

Its job is to make the path from intent to transaction inspectable and difficult to bypass.

### 5.2 Falcon Brain — the proprietary intelligence

The Brain is a hosted, read-only decision service backed by a current Solana knowledge graph, quantitative models, market and protocol context, scenario analysis, and a growing decision–outcome dataset.

Its job is to improve the quality and calibration of bounded decisions. It advises; it never signs a Solana transaction.

### 5.3 Falcon Cloud — the managed operating layer

Falcon Cloud will run user-owned agents continuously in isolated workers, with durable state, monitoring, spend controls, alerting, and external restricted signing. It is a convenience and reliability layer, not ownership of the user’s assets.

The user retains the root wallet, can withdraw and revoke independently, and defines the authority granted to the agent.

### 5.4 Product identity

FalconOS is:

- **Solana-first**, not a generic multichain abstraction with a Solana adapter;
- **an execution control plane**, not a new exchange;
- **a capital operating system**, not a signal chatbot;
- **open at the trust boundary**, proprietary where live knowledge and calibration create value;
- **progressively autonomous**, not unrestricted from day one;
- **an evidence system**, not a profitability promise.

[Back to index](#index)

---

<a id="6-who-falconos-serves"></a>
## 6. Who FalconOS serves

| User | Immediate job | Value delivered |
|---|---|---|
| Founder/operator | Test a small autonomous Phoenix account without unsafe improvisation. | A bounded, observable, recoverable loop with complete evidence. |
| Agent and wallet developer | Add Solana capital actions without rebuilding protocol integrations and risk controls. | An installable skill/CLI, typed intents, verifier, receipts, and adapters. |
| Solana protocol team | Enable safe agent usage and measurable onchain activity. | An integration framework, reproducible tests, transparent economics, and sponsored adapter path. |
| Active trader | Delegate narrow monitoring and execution while retaining ownership. | Explicit policy, approval modes, revocation, alerts, and replayable actions. |
| Market maker or quant team | Add governed agent intelligence to existing infrastructure. | Deterministic pre-trade gates, paid context, execution evidence, and calibrated outcomes. |
| Future treasury or institution | Coordinate capital across Solana under one policy and audit trail. | Portfolio-level exposure graph, tenant isolation, controls, reporting, and service guarantees. |

The initial buyer is more likely to be a developer or protocol team than a mass-market retail trader. This keeps the first product technically focused and creates a clearer legal, support, and distribution path.

[Back to index](#index)

---

<a id="7-product-thesis-and-differentiation"></a>
## 7. Product thesis and differentiation

### 7.1 The thesis

Execution infrastructure will commoditize. Trustworthy capital intelligence will not.

The lasting asset is not a secret order-submission function. It is a living graph that knows:

- what capital the user controls and under which authorities;
- what each Solana protocol permits and how it can fail;
- how positions, collateral, oracles, funding, liquidity, and fees interact;
- what the system predicted before an action;
- what actually occurred onchain and economically;
- where the model and cost assumptions were wrong;
- which policy and model versions produced the result.

### 7.2 Why FalconOS can win

FalconOS combines properties that are usually separated:

1. deep Phoenix and Solana integration;
2. typed semantic intents instead of unrestricted commands;
3. deterministic **ALLOW / RESIZE / BLOCK** enforcement;
4. signed, versioned, expiring decision receipts;
5. user-owned root authority and a restricted execution signer;
6. an independent always-on supervisor;
7. a proprietary outcome-calibrated Solana capital graph;
8. machine-native payments for intelligence;
9. an adapter proof standard for safe expansion.

### 7.3 Competitive position

Condor and Hummingbot validate an open agent harness over deterministic trading infrastructure. Almanak validates intent-based DeFi automation. Giza validates autonomous capital and verifiable execution. Hive validates open tooling paired with proprietary managed intelligence.

FalconOS does not need to deny these categories. It must be the best answer to a narrower and more defensible question:

> **How should an autonomous agent safely, verifiably, and economically use Solana capital?**

Phoenix depth is the wedge. Deterministic receipts, least-authority custody, and the outcome-calibrated capital graph are the differentiation. Solana-wide capital coordination is the end state.

[Back to index](#index)

---

<a id="8-the-complete-product-system"></a>
## 8. The complete product system

~~~mermaid
flowchart TB
    U["User and root owner"] --> R["Falcon Runtime"]
    A["Strategy agent"] --> R
    R --> I["Typed intent"]
    I --> B["Falcon Brain"]
    S["Canonical Solana state"] --> B
    I --> V["Deterministic verifier"]
    S --> V
    B --> V
    V --> D["Allow, resize, or block"]
    D --> C["Signed decision receipt"]
    C --> G["Approval and capability gate"]
    G --> Q["Durable queue and account lock"]
    Q --> E["Exact transaction executor"]
    E --> K["Restricted signer"]
    K --> P["Phoenix and Solana"]
    P --> X["Confirm and reconcile"]
    X --> O["Outcome ledger"]
    O --> B
    W["Independent supervisor"] --> R
    W --> E
    W --> X
~~~

### 8.1 System layers

| Layer | Responsibility | Trust position |
|---|---|---|
| Entry layer | CLI, agent skill, SDK, API, and future dashboard. | Convenient interface; never the final financial authority. |
| Intent layer | Converts requests into typed, bounded capital intents. | Rejects ambiguous or unsupported actions. |
| State layer | Normalizes HTTP, stream, RPC, account, market, and protocol state. | Authoritative only when fresh and reconciled. |
| Brain layer | Supplies scenarios, context, confidence, bounds, and evidence references. | Advisory, read-only, and replaceable. |
| Control layer | Recomputes exposure, health, costs, permissions, budgets, and freshness. | Open, local, deterministic, and final. |
| Evidence layer | Signs decision receipts and binds them to exact actions and versions. | Tamper-evident and exportable. |
| Execution layer | Builds, simulates, submits, confirms, deduplicates, and reconciles. | No economic discretion. |
| Signing layer | Signs only exact, policy-approved transactions under narrow authority. | No root key; independent allowlist. |
| Supervision layer | Monitors process health, state freshness, positions, limits, and emergency paths. | Operates without the model or paid Brain. |
| Learning layer | Joins forecasts to actual fills, costs, health, incidents, and outcomes. | Versioned releases; no silent online learning. |
| Commercial layer | x402 payments, prepaid cloud fuel, sponsorship, referral, and later service plans. | Separate from trading collateral and opportunity ranking. |

### 8.2 Separation of planes

FalconOS separates five planes so failure or compromise in one does not imply unrestricted power elsewhere:

- **Reasoning plane:** proposes intents and explanations.
- **Control plane:** enforces policy and deterministic math.
- **Data plane:** supplies live market, account, protocol, and graph state.
- **Signing plane:** authorizes only the exact permitted transaction.
- **Payment plane:** pays for Brain and cloud services from a separate capped wallet.

[Back to index](#index)

---

<a id="9-the-operating-loop"></a>
## 9. The operating loop

Every capital action follows the same contract:

1. **Observe.** Read canonical market, account, protocol, and service state.
2. **Propose.** The strategy agent creates a typed intent; it cannot call a dangerous trading command directly.
3. **Advise.** The Brain optionally evaluates context, scenarios, confidence, and recommended bounds.
4. **Verify.** Deterministic code independently recomputes risk, permissions, health, all costs, freshness, and budgets.
5. **Decide.** Return **ALLOW**, **RESIZE**, or **BLOCK** with machine-readable reason codes.
6. **Receipt.** Sign a versioned, expiring decision receipt containing the intent hash, snapshot hash, policy, model, bounds, costs, and verdict.
7. **Approve.** Apply the current autonomy mode and any required human confirmation.
8. **Serialize.** Enter a durable queue and lock the relevant account to prevent conflicting risk actions.
9. **Simulate.** Build and simulate the exact transaction where supported.
10. **Revalidate.** Confirm that state, policy, receipt, accounts, instructions, programs, quantity, and price limits still match.
11. **Sign and submit.** Use a restricted delegated signer; never expose the root wallet to the agent or cloud worker.
12. **Confirm and reconcile.** Resolve the actual onchain state before retrying or accepting new risk.
13. **Supervise.** Monitor health, limits, funding, freshness, process state, and deterministic exit conditions.
14. **Learn.** Join the forecast and decision to actual cost, fill, health, PnL, exit, and incident data.

If any required input is missing or stale, FalconOS blocks new exposure. Safety actions such as cancellation, reduction, or closure remain available through an independently tested path.

[Back to index](#index)

---

<a id="10-trust-and-safety-constitution"></a>
## 10. Trust and safety constitution

These rules are product invariants, not optional settings.

1. **The user owns the root.** FalconOS infrastructure never stores or receives the root wallet authority.
2. **Authority is minimal and revocable.** A position authority may trade the delegated Phoenix account but cannot withdraw, deposit, or re-delegate. Because it can still lose collateral, the account remains isolated and capped.
3. **The Brain never signs.** It returns a signed advisory receipt, not a Solana transaction signature.
4. **Typed intents are mandatory.** The reasoning model never receives unrestricted wallet, shell, withdrawal, transfer, delegation, or raw transaction tools.
5. **Deterministic code has final authority.** The verifier may allow, resize, or block. It cannot be overridden by a model explanation.
6. **Every live action has a receipt.** No valid, unexpired, transaction-bound receipt means no new-risk signature.
7. **State must be current and reconciled.** Stream gaps, inconsistent providers, ambiguous confirmation, or restart state block new exposure.
8. **New risk fails closed; safety exits stay available.** Brain failure, depleted service credit, or stale enrichment cannot strand an existing position.
9. **Trading capital and service money are separate.** x402 calls, cloud fuel, and Falcon charges never silently consume margin collateral.
10. **Economics include every cost.** Exchange fees, funding, spread, slippage, priority fees, failure probability, Brain spend, and Falcon fees are visible before action.
11. **Commercial incentives do not influence ranking.** Sponsorship, referral, and builder revenue are disclosed, excluded from opportunity scores, and included in net-cost math.
12. **No silent learning.** Models and graph releases are versioned, signed, evaluated, observable, and reversible.
13. **Reconcile before retry or resume.** The system never assumes failure from a timeout and never duplicates risk because a process restarted.
14. **Allocated collateral is fully at risk.** “Non-custodial” is not described as loss protection.
15. **Autonomy is earned with evidence.** Capital, authority, protocols, and unattended operation expand only after explicit release gates.

[Back to index](#index)

---

<a id="11-autonomy-model"></a>
## 11. Autonomy model

Autonomy is not a binary feature. FalconOS treats it as a progression of evidence-backed capabilities.

| Mode | Capital effect | Human role | Promotion evidence |
|---|---|---|---|
| Paper | None | Reviews simulated decisions. | Seven continuous days or at least 100 evaluations, no policy violations, stable replay and reconciliation. |
| Dry run | None | Reviews the exact action that would be submitted. | Transaction simulation, failure drills, expiry and binding checks pass. |
| Approval-live | Tiny founder-owned capital | Approves every increase in risk; may revoke at any time. | At least 10 fully reconciled live actions, zero severe incidents, calibrated costs, tested emergency path. |
| Limited auto | Strictly capped and allowlisted | Approves policy and capability window in advance. | Independent supervisor, onchain or deterministic protection, signer hardening, explicit founder sign-off. |
| Managed external | User-owned delegated accounts | Chooses policy, funding, authority, and revocation. | Tenant isolation, security review, incident response, privacy controls, and a permitted legal launch path. |
| Multi-protocol | Portfolio-level bounded capital | Sets portfolio objectives and protocol permissions. | Each adapter passes state, math, signer, recovery, and economic proof requirements. |

An autonomy level is a signed capability, not a prompt preference. It has a scope, budget, protocol allowlist, expiry, and revocation path.

[Back to index](#index)

---

<a id="12-the-falcon-brain"></a>
## 12. The Falcon Brain

### 12.1 Purpose

The Brain answers a bounded question:

> Given this typed intent, current Solana state, user policy, and available capital, what scenarios and limits should the deterministic control plane evaluate?

It does not answer “What token will make me rich?” and it does not receive authority to move funds.

### 12.2 Core assets

The Brain compounds five proprietary assets:

1. **Solana knowledge graph:** protocols, accounts, assets, markets, oracles, permissions, fees, liquidity, dependencies, and risk relationships.
2. **Live data-quality layer:** source provenance, freshness, sequence integrity, conflicts, missing data, and confidence.
3. **Quantitative model ensemble:** costs, health, funding, slippage, liquidity, regime, stress, execution probability, and risk-adjusted opportunity.
4. **Decision–outcome ledger:** predicted versus actual fills, fees, funding, health, PnL, exits, failures, and incidents.
5. **Release governance:** signed model and graph versions, evaluation sets, change logs, canaries, rollback, and replay.

### 12.3 Verifiability boundary

FalconOS cannot honestly prove that every proprietary model inference is correct. It can prove:

- which inputs and model version produced the recommendation;
- which policy and arithmetic constraints were applied;
- that the verifier’s result is reproducible;
- that the transaction matched the permitted semantic intent;
- what happened onchain;
- how the forecast compared with reality.

That is the defensible meaning of **verifiable decision-making**.

### 12.4 Learning policy

Outcomes may inform future releases, but a live agent never rewrites its own enforcement policy or promotes a new model without evaluation and explicit release controls. Strategy memory, user policy, protocol facts, and model parameters remain separate data classes.

[Back to index](#index)

---

<a id="13-open-source-and-proprietary-boundary"></a>
## 13. Open-source and proprietary boundary

The code that asks users to trust financial enforcement should be inspectable. The continuously maintained intelligence that becomes better from network usage is the commercial moat.

| Open-source trust surface | Proprietary or hosted intelligence |
|---|---|
| CLI, agent skill, and local runtime | Live Solana knowledge graph |
| Protocol adapter interfaces and reference Phoenix adapter | Data acquisition, freshness, quality, and provenance system |
| Typed intent and policy schemas | Calibrated quantitative models |
| Risk-math wrappers and deterministic verifier | Scenario generation and opportunity ranking |
| Decision receipt schema and public verifier | Decision–outcome dataset |
| Replay tooling and golden test vectors | Advanced simulations and calibration infrastructure |
| Paper and dry-run harness | Managed monitoring, reliability, and support services |
| Transaction allowlist and signer contract | Enterprise controls, service levels, and private integrations |

The open runtime creates trust and distribution. The proprietary Brain converts current knowledge, calibration, reliability, and support into revenue.

[Back to index](#index)

---

<a id="14-business-and-revenue-model"></a>
## 14. Business and revenue model

FalconOS begins with open-source distribution and monetizes intelligence, integration, and reliable operation.

### 14.1 Revenue sequence

| Priority | Revenue stream | When | Customer value |
|---|---|---|---|
| 1 | Sponsored protocol integration, grant, or design partnership | Earliest | A protocol receives a safe agent adapter, measurable usage, tests, and distribution. |
| 2 | Fixed-price x402 Brain endpoints paid in Solana USDC | POC to beta | Any agent purchases one bounded, signed evaluation without a subscription. |
| 3 | Prepaid managed-cloud fuel | Beta | Users fund continuous compute, monitoring, data, and alerts without mixing service spend with collateral. |
| 4 | Phoenix referral share | After eligibility and real volume | Aligned distribution revenue, fully disclosed and excluded from ranking. |
| 5 | Phoenix Flight builder fees | Only at material volume | A small flow fee on eligible liquidity-removing activity, included in pre-trade costs. |
| 6 | Subscription and enterprise plans | After stable repeated use | Bundled calls, higher limits, private graph connectors, audit exports, support, and service guarantees. |

### 14.2 Initial paid product

The first paid endpoint should sell one clear artifact, not an open-ended conversation:

**Input**

- typed intent;
- normalized state and snapshot references;
- user policy;
- requested analysis profile.

**Output**

- signed recommendation receipt;
- scenario bounds and confidence;
- fee-inclusive economic breakdown;
- machine-readable risks and evidence references;
- expiry and model version.

The price begins as a small fixed experiment—potentially USD 0.05 to USD 0.25 in Solana USDC—and changes only after measuring compute, data, facilitator, support, and buyer value.

### 14.3 Economic rules

- No performance fee or assets-under-management fee in the MVP.
- No hidden spread or deduction from trading collateral.
- No revenue share may improve an opportunity’s score.
- Protocol sponsorship buys integration work, not favorable recommendations.
- A builder fee is initially zero and remains unattractive until volume is material: one basis point produces only USD 1,000 per USD 10 million of eligible taker volume.
- PnL reporting always separates gross result, exchange fees, funding, slippage, priority fees, Falcon charges, Brain spend, cloud spend, and net result.

[Back to index](#index)

---

<a id="15-go-to-market-strategy"></a>
## 15. Go-to-market strategy

### 15.1 Beachhead

Start with technical Solana users who already understand wallets and DeFi:

- agent and wallet developers;
- Phoenix and other Solana protocol teams;
- active perpetual traders;
- market makers and quantitative teams.

### 15.2 Sequence

1. **Prove it personally.** Run the full paper, dry-run, and tiny-capital founder loop.
2. **Publish the contract.** Open the schemas, verifier, receipts, replay tools, tests, and Phoenix reference adapter.
3. **Interview and observe.** Conduct at least 10 technical interviews and watch at least five developers reproduce paper setup.
4. **Win a protocol partner.** Sell or obtain sponsorship for measurable integration, safety evidence, and developer activation.
5. **Validate machine-paid intelligence.** Obtain at least three external paid endpoint users or one paid design partner.
6. **Harden managed operation.** Add isolated cloud workers and external delegated signing only after security and legal gates.
7. **Expand adapter by adapter.** Let protocol depth and evidence—not breadth marketing—drive the roadmap.

### 15.3 Distribution surfaces

- open-source repository and documentation;
- installable agent skill and CLI;
- Phoenix and Solana ecosystem partnerships;
- protocol grants and hackathon or builder programs;
- x402 and agent-service catalogs;
- examples for Codex, OpenClaw, Hermes, and custom runtimes;
- verifiable public replay bundles and safety benchmarks.

The best early demonstration is not a screenshot of profit. It is a complete, replayable case showing what the agent knew, what it proposed, why code allowed or resized it, what was signed, what happened, and how the model was wrong or right.

[Back to index](#index)

---

<a id="16-product-roadmap"></a>
## 16. Product roadmap

FalconOS expands by verified financial primitive, not by adding names to a prompt.

| Stage | Scope | New proof required |
|---|---|---|
| 0 — Phoenix perps | SOL-PERP, isolated collateral, receipts, monitoring, and founder-only live execution. | Complete Phase 0 evidence and safety gates. |
| 1 — Perps breadth | More Phoenix markets; later routing or aggregation if strategically justified. | Market-specific liquidity, oracle, funding, calendar, and fee validation. |
| 2 — Lending and borrowing | Kamino and other Solana money markets. | Collateral and liquidation graph, oracle risk, interest model, authority scope, and legal review. |
| 3 — LP and swaps | Orca, Raydium, Meteora, and Jupiter. | Impermanent-loss, tick and liquidity math, route cost, MEV, slippage, and position recovery. |
| 4 — Arbitrage | Cross-venue or cross-protocol atomic and bounded execution. | Net edge after fees, latency, failure probability, inventory, and partial-execution risk. |
| 5 — Solana capital graph | Unified policy and opportunity state across DeFi, payments, stablecoins, and RWA. | Cross-protocol exposure, provenance, conflict neutrality, and portfolio-level calibration. |
| 6 — Agent economy | Agent identity, reputation, x402 marketplace, and third-party verification. | Independent validation, privacy-preserving evidence, service guarantees, and regulatory design. |

Borrowed capital and flash loans are not an early shortcut. They introduce correlated liquidation, execution, and legal risk and require a separate loss model and release decision.

[Back to index](#index)

---

<a id="17-phase-0-phoenix-perpetuals-mvp"></a>
## 17. Phase 0: Phoenix perpetuals MVP

### 17.1 Objective

In four to eight weeks, prove that one founder-controlled agent can evaluate, constrain, execute, monitor, and replay tiny Phoenix perpetual actions without bypassing policy.

This is an operational and trust experiment—not evidence of repeatable alpha.

### 17.2 Scope

| Included | Excluded |
|---|---|
| Local CLI and agent skill | Public retail autonomous execution |
| Guided multiple-choice risk interview with recommended defaults | Customer funds or pooled capital |
| Dedicated USD 50–100 founder account | Multiple active positions or portfolio optimization |
| SOL-PERP only | Borrowing, flash loans, LP, swaps, or arbitrage |
| One isolated position/account | Cross margin |
| Policy cap around 1.5× leverage | High-frequency or latency arbitrage |
| Paper, dry-run, and approval-live modes | Fully autonomous live launch |
| Manual approval for every increase in risk | Performance fees or public profit claims |
| Typed intent, verifier, signed receipt, and replay | Falcon token, DAO, or new perpetual venue |
| Independent supervisor, kill path, and outcome ledger | Unrestricted shell or wallet tools |
| One fixed-price x402 evaluation endpoint | Subscription requirement |

### 17.3 Build boundary

- Use a pinned and checksummed Phoenix Vulcan CLI for the founder proof of concept.
- Wrap Vulcan; do not expose its dangerous commands directly to the model.
- Use Vulcan for reads, paper mode, dry runs, confirmation, diagnostics, and carefully approved tiny live actions.
- Prove the managed path with Phoenix Rise SDK and native position-authority delegation.
- Move managed execution toward a thin Rise executor, per-user restricted signing, durable state, and an independent watchdog.
- Do not rebuild Phoenix’s venue, order book, matching, margin, or wallet primitives.

### 17.4 MVP outputs

1. installable CLI and agent skill;
2. risk-interview-generated human and machine policy;
3. versioned typed intent schema;
4. canonical Phoenix state snapshot;
5. deterministic fee, exposure, leverage, margin, and freshness verifier;
6. **ALLOW / RESIZE / BLOCK** verdicts with reason codes;
7. signed decision and execution receipts;
8. exact transaction binding and simulation;
9. durable execution queue, idempotency, and account lock;
10. independent heartbeat and supervisor;
11. emergency close, revoke, and restart-recovery drills;
12. append-only outcome ledger and replay bundle;
13. one x402-paid Brain evaluation endpoint;
14. Rise position-authority integration spike.

### 17.5 Founder go/no-go

Continue only if:

- no policy bypass or uncontrolled action occurs;
- every live action has complete decision, transaction, confirmation, and reconciliation evidence;
- restart and network fault tests create no duplicate order;
- developers can reproduce paper setup and value the contract beyond a thin Vulcan wrapper;
- at least one credible paid-intelligence or protocol-integration path appears;
- an external launch can follow a viable legal and security path.

Change or stop if the value reduces to trading signals, profit screenshots, or a wrapper that Phoenix can trivially absorb.

[Back to index](#index)

---

<a id="18-measures-of-success"></a>
## 18. Measures of success

### 18.1 North star

**Verified Action Rate**

> The percentage of live capital actions that have a valid intent, policy verdict, unexpired transaction-bound receipt, scoped signature, onchain confirmation, and reconciled outcome—with zero policy violation.

The target is **100%**. Growth that lowers this rate is failure.

### 18.2 Founder MVP scorecard

| Category | Metric | Target |
|---|---|---|
| Safety | Successful unauthorized withdrawal, delegation, transfer, or arbitrary transaction | 0 |
| Safety | Policy violations among executed actions | 0 |
| Evidence | Live actions with complete receipt, transaction, and reconciliation | 100% |
| Reliability | Duplicate orders during fault tests | 0 |
| Reliability | Restart cases reconciled before accepting new risk | 100% |
| Calibration | Predicted exchange fee versus actual | Exact within protocol rounding |
| Calibration | Slippage and funding forecast error | Recorded by market regime; no claim until sample size is meaningful |
| Usage | Paper evaluations | At least 100 or seven continuous days |
| Live proof | Founder-owned manually approved actions | At least 10 |
| Discovery | Technical interviews | At least 10 |
| Activation | Developers reproducing paper setup | At least 5 |
| Business | Paid validation | At least 3 developer buyers or 1 paid protocol partner |

### 18.3 Long-term scorecard

- value and capital governed through Falcon policies;
- verified actions across protocols;
- percentage of decisions independently replayable;
- forecast calibration by protocol and regime;
- prevented policy violations and safely recovered incidents;
- active agent and protocol integrations;
- paid Brain calls and retained managed runtimes;
- revenue per supported adapter versus ongoing integration cost;
- user-controlled revocations completed without Falcon cooperation;
- net economic value after every disclosed cost.

[Back to index](#index)

---

<a id="19-defensibility-flywheel"></a>
## 19. Defensibility flywheel

~~~mermaid
flowchart TB
    O["Open runtime and adapters"] --> D["Developer and protocol adoption"]
    D --> A["More verified actions"]
    A --> E["Reconciled outcome evidence"]
    E --> G["Better graph and calibration"]
    G --> B["More useful paid Brain"]
    B --> P["More integrations and capital"]
    P --> A
~~~

The flywheel compounds because:

1. open enforcement code lowers adoption friction and creates trust;
2. each action generates a versioned decision and execution record;
3. reconciliation reveals where cost, fill, health, and risk forecasts failed;
4. the proprietary graph and models improve from that evidence;
5. better-calibrated intelligence creates paid value and attracts integrations;
6. more integrations produce a broader capital graph and more varied evidence;
7. public verification makes trust portable while the outcome dataset remains proprietary.

The moat is therefore **current knowledge plus measured outcomes plus trusted execution**, not closed-source transaction submission.

[Back to index](#index)

---

<a id="20-non-goals"></a>
## 20. Non-goals

FalconOS will not:

- build a new perpetual exchange, order book, matching engine, oracle, wallet, or generic Solana SDK;
- become a generic multichain framework before earning deep Solana trust;
- market guaranteed returns, effortless passive income, or “AI alpha” based on tiny tests;
- let a language model hold root keys or call arbitrary financial tools;
- treat non-custodial delegation as protection from trading loss;
- sell public personalized autonomous execution before the security and legal path is resolved;
- accept third-party pooled capital or launch copy-trading and performance fees in the MVP;
- pursue high-frequency or latency arbitrage in the founder phase;
- use borrowed capital, flash loans, or cross-margin complexity as an early growth mechanism;
- create a Falcon token, DAO, or fundraising mechanism as a substitute for product value;
- place raw identity, portfolio, or risk-preference data onchain;
- claim a formal proof that proprietary model reasoning is correct;
- expand to a protocol whose state, math, permissions, transaction parsing, and failure recovery are not deterministic.

[Back to index](#index)

---

<a id="21-risks-and-release-gates"></a>
## 21. Risks and release gates

### 21.1 Principal risks

| Risk | Consequence | Product response |
|---|---|---|
| Agent bypasses policy | Catastrophic loss within allocated capital. | No direct dangerous tools; independent verifier, signer allowlist, adversarial tests, and collateral caps. |
| Delegate trades maliciously | Entire isolated account may be lost even without withdrawal power. | Tiny funding, leverage/notional/loss caps, position authority, revocation, and one-position MVP. |
| Vulcan changes or fails | Execution semantics drift. | Version pinning, checksum, wrapper tests, compatibility matrix, and Rise migration path. |
| Stale or inconsistent state | Wrong size, health, cost, or duplicate action. | Freshness scoring, sequence-gap recovery, multiple-source reconciliation, expiry, locking, and idempotency. |
| Brain hallucination or drift | Bad proposal or unstable behavior. | Advisory-only Brain, deterministic verifier, signed versions, evaluation sets, canary, rollback, and outcomes. |
| Cloud outage with open risk | Position becomes unmanaged. | Independent supervisor, durable state, safety reserve, deterministic exit, alerts, and root-owner emergency path. |
| Paid-call incentives cause overuse | User cost and distrust. | Free local checks, caching, spend caps, one quote per intent, idempotent payment, and transparent receipts. |
| Referral or builder incentives distort action | Overtrading, conflicts, and regulatory exposure. | Revenue excluded from ranking, costs included before approval, disclosure, and zero builder fee in beta. |
| Legal classification differs from marketing | Unlicensed activity or restricted distribution. | Founder-only live testing, product-specific counsel, BaFin inquiry, and analytics or licensed-partner path. |
| Brand collision | Rework and legal cost. | FalconOS remains a codename until name, domain, and trademark clearance. |

### 21.2 External-live gate

Founder research and personal testing may proceed. Public portfolio-specific recommendations or autonomous cloud execution for EU users remain blocked until product-specific counsel and the relevant German/EU classification establish a permitted path.

Calling the product “not financial advice,” “quantitative consultation,” “non-custodial,” or “open source” does not determine its legal classification. The economic substance of recommendation, order transmission, execution, custody, conflicts, and target market matters.

Before external live use, FalconOS requires:

- hardened position authority and external signing;
- tenant isolation, privacy controls, incident response, and security review;
- geography and eligibility controls;
- custody and delegated-control analysis;
- conflict and compensation disclosure;
- data-retention, export, deletion, and contestability rules;
- one explicit route: analytics-only scope, licensed partnership, or Falcon authorization.

[Back to index](#index)

---

<a id="22-locked-decisions"></a>
## 22. Locked decisions

The following decisions define the product. Changing one requires an explicit vision revision.

| Decision | Baseline |
|---|---|
| Ecosystem | Solana-first and Solana-native. |
| Initial wedge | Phoenix perpetuals, starting with SOL-PERP. |
| Product category | Verifiable autonomous capital operating system and control plane. |
| Build strategy | Build above existing protocol infrastructure; do not recreate Phoenix or Vulcan primitives. |
| Architecture | Open Runtime and verifier; proprietary hosted Brain and outcome-calibrated graph. |
| Enforcement | The model proposes; deterministic code returns allow, resize, or block. |
| Brain authority | Read-only advisory; never holds keys or signs/submits Solana transactions. |
| Ownership | User retains root wallet, funding, withdrawal, delegation, and revocation. |
| Managed signing | Narrow Phoenix position authority with independent transaction restrictions. |
| Money separation | Trading collateral, service-payment wallet, and company treasury are separate. |
| Evidence | Every paid or live decision is signed, versioned, expiring, transaction-bound, and reconciled. |
| Reliability | Reconcile before retry or accepting new risk; supervisor operates independently of the model. |
| Autonomy | Paper to dry-run to approval-live to limited auto; every promotion is evidence-gated. |
| MVP capital | Dedicated founder-owned USD 50–100 account with one isolated position and low leverage. |
| Expansion | One protocol or financial primitive at a time, after deterministic proof requirements pass. |
| Early leverage | No borrowed capital or flash loans. |
| Initial monetization | Protocol sponsorship/grants, then fixed-price x402 intelligence and prepaid cloud operation. |
| Incentives | Revenue and sponsorship never influence opportunity ranking. |
| Primary success claim | Verifiable policy compliance, execution, recovery, and calibration—not guaranteed profit. |

[Back to index](#index)

---

<a id="23-open-decisions"></a>
## 23. Open decisions

These choices remain intentionally open and must be resolved with evidence.

| Decision | Current default | Evidence required |
|---|---|---|
| Public brand | FalconOS / Falcon codename | Domain, trademark, package, and product-name clearance. |
| First external surface | Developer and protocol tooling before consumer trading | Interviews, legal classification, and reproducible onboarding. |
| Managed signer | Privy first candidate; provider interface remains abstract | Transaction-corpus spike, policy expressiveness, revocation, availability, cost, and security review. |
| Cloud host | Always-on isolated worker; Fly is the first candidate | Restart recovery, latency, regional availability, durable state, observability, and real monthly cost. |
| Brain implementation | Python quantitative service behind a TypeScript x402 gateway | Prototype latency, model tooling, deployment, signing, and operational simplicity. |
| Paid evaluation price | Fixed USD 0.05–0.25 experiment in Solana USDC | Compute, data, facilitator, support cost, buyer willingness, and achieved value. |
| External launch route | Analytics-first while execution remains gated | Counsel, BaFin inquiry, geography, partner options, and unit economics. |
| First protocol after Phoenix | Lending/borrowing is the strategic default | User pull, sponsor demand, adapter complexity, capital risk, and legal impact. |
| Builder/referral fees | Zero builder fee in beta; referral only if eligible | Material volume, disclosure, conflict review, and net user economics. |
| Long-term interface mix | Skill + CLI + API first; dashboard later | Which surface users repeatedly operate and pay for. |
| Brain ontology and releases | Protocol graph plus reviewed signed model releases | Data coverage, provenance, evaluation sets, update cadence, canary results, and rollback tests. |
| Receipt disclosure | Public policy and arithmetic proof with proprietary features protected | Independent reproducibility, privacy, buyer trust, and intellectual-property leakage tests. |
| Public verifier governance | Falcon-signed releases first; independent governance later | Adoption, contributor quality, key-rotation design, and incident history. |
| Onchain evidence anchors | Keep full receipts offchain; evaluate opaque commitments later | Cost, privacy, independent verification value, and Agent Registry compatibility. |
| Open-source license | Permissive core is preferred | Contributor incentives, protocol adoption, hosted-service defensibility, and legal review. |

[Back to index](#index)

---

<a id="24-the-long-term-end-state"></a>
## 24. The long-term end state

FalconOS succeeds when a human, organization, or autonomous agent can assign capital to a goal—not to an unrestricted bot—and receive continuous, verifiable execution across Solana.

The mature system will:

- maintain a live graph of capital, permissions, protocols, liquidity, obligations, and risk;
- compare opportunities across perps, lending, LP, swaps, arbitrage, payments, stablecoins, and RWA;
- express every action through a portable typed intent and policy;
- select among protocol adapters without weakening user authority;
- pay for external intelligence and services through bounded agentic payments;
- coordinate specialist agents while one deterministic control plane remains final;
- establish identity, reputation, and service evidence through Solana-native registries;
- allow third parties to verify policy compliance and execution without exposing proprietary models or private portfolio data;
- improve from reconciled outcomes through explicit, governed releases;
- let the owner revoke the system and recover control without Falcon’s cooperation.

The final product is not merely an agent that trades.

It is a **capital operating system**: the trusted substrate through which autonomous software can understand opportunity, exercise bounded authority, prove what it did, and become more useful without becoming less controllable.

[Back to index](#index)

---

<a id="25-glossary"></a>
## 25. Glossary

| Term | Meaning |
|---|---|
| FalconOS | Working name for the complete Solana-native capital operating system. |
| Falcon Runtime | Open-source local or managed control, execution, supervision, and evidence software. |
| Falcon Brain | Proprietary hosted intelligence and graph service; advisory only. |
| Falcon Cloud | Future managed runtime for isolated always-on agent workers. |
| Capital intent | A typed semantic request containing action, market or protocol, bounds, mode, and identifiers. |
| Policy | User-approved, versioned limits on capital, leverage, loss, actions, protocols, spend, autonomy, and time. |
| Canonical state | Fresh, normalized, gap-checked, and reconciled account, market, protocol, and chain state. |
| Verifier | Open deterministic code that independently returns allow, resize, or block. |
| Decision receipt | Signed record binding an intent, snapshot, policy, model, costs, verdict, bounds, and expiry. |
| Execution receipt | Record binding the permitted decision to the built transaction, signature, confirmation, and result. |
| Position authority | Phoenix delegated trading authority that can manage positions but cannot withdraw, deposit, or re-delegate. |
| Root owner | The user-controlled wallet authority that funds, withdraws, delegates, revokes, and recovers. |
| Supervisor | Independent process that monitors safety, freshness, positions, services, and recovery without relying on model reasoning. |
| Outcome ledger | Append-only record joining prediction and decision to actual onchain and economic outcomes. |
| x402 | Machine-payment protocol used to sell fixed-price intelligence and potentially fund agent services. |
| Verified action | A capital action with complete typed intent, valid policy decision, bounded signature, onchain confirmation, and reconciliation evidence. |

[Back to index](#index)

---

<a id="26-research-foundation"></a>
## 26. Research foundation

This vision synthesizes product decisions from the FalconOS research PRD. The research base is current through 27 August 2026. Protocol capabilities, incentives, software, prices, and laws can change and must be reverified before implementation or launch.

### 26.1 Solana and Phoenix

- [Solana Foundation — Build Fully Onchain Perps on Solana](https://solana.com/news/build-onchain-perps)
- [Phoenix — Vulcan CLI](https://docs.phoenix.trade/cli)
- [Phoenix — Vulcan commands](https://docs.phoenix.trade/cli/commands)
- [Phoenix — Vulcan strategies and autonomy modes](https://docs.phoenix.trade/cli/strategies)
- [Ellipsis Labs — Vulcan CLI repository](https://github.com/Ellipsis-Labs/vulcan-cli)
- [Phoenix — Rise SDK](https://docs.phoenix.trade/sdk/rise)
- [Phoenix — accounts and position authority](https://docs.phoenix.trade/phoenix/collateral-and-accounts/accounts)
- [Phoenix — Rise account delegation](https://docs.phoenix.trade/sdk/accounts)
- [Phoenix — margin math](https://docs.phoenix.trade/phoenix/margin-and-risk/margin-math)
- [Phoenix — Flight builder codes](https://docs.phoenix.trade/builder-codes)

### 26.2 Agent infrastructure and market validation

- [Hummingbot — Condor](https://hummingbot.org/condor/)
- [Almanak SDK](https://github.com/almanak-co/sdk)
- [Giza](https://www.gizatech.xyz/)
- [Hive Intelligence](https://www.hiveintelligence.xyz/pricing)
- [Solana — Agent Skills](https://solana.com/skills)
- [Solana — Agent Registry](https://solana.com/agent-registry/what-is-agent-registry)
- [Solana — agentic payments](https://solana.com/docs/payments/agentic-payments)
- [x402 — MCP server with x402](https://docs.x402.org/guides/mcp-server-with-x402)
- [Privy — policy controls](https://docs.privy.io/controls/overview)
- [Turnkey — delegated agent signing](https://docs.turnkey.com/features/policies/delegated-access/agentic-wallets)

### 26.3 Legal and regulatory boundary

- [ESMA — perpetual futures and CFD product-intervention measures](https://www.esma.europa.eu/press-news/esma-news/esma-reminds-firms-their-obligations-under-cfd-product-intervention-measures)
- [Germany WpIG §2 — definitions](https://www.gesetze-im-internet.de/wpig/__2.html)
- [Germany WpIG §15 — authorization requirement](https://www.gesetze-im-internet.de/wpig/__15.html)
- [BaFin — automated and signal-based systems](https://www.bafin.de/DE/unternehmen-maerkte/erlaubnis-registrierung/fintech/beratungs-handelssysteme/beratungs-handelssysteme.html)

This document is a product vision, not legal, tax, or investment advice.

[Back to index](#index)

---

## Closing conviction

Solana does not need another agent with more permissions and a better prompt. It needs a standard for turning machine intelligence into bounded, accountable capital action.

FalconOS will be that standard.

> **User-owned capital. Model-assisted intelligence. Deterministic control. Verifiable execution.**
