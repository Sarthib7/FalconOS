# FalconOS vision

## Approved build direction, 2026-10-13

[VERIFIED, user choices] FalconOS should give agents Solana execution and cross-market advice. The owner approves every action. The [active roadmap](../plans/roadmap.md#active-mcp-plan-2026-10-13) and SPEC I21 define the work; Falcon Investment Council remains advisory-only within that backend.

[VERIFIED, scope correction] The broader company-treasury and AI-CFO ideas below remain hypotheses. They do not authorize autonomy, brokerage/EVM execution, private tenant launches, custody or pooled investing. The current build sequence is capability discovery, complete Devnet lending proof, shared stocks/perps advice, then approved Solana swaps. Human signing/broadcast and the Devnet release cap remain unchanged.


## Purpose

[VERIFIED, user direction] “FalconOS was like an investment operating system for agents and humans.” FalconOS should help a company see its full treasury, find where liquidity can work, allocate it toward company goals, and manage it over time.

[INFERRED, positioning] FalconOS is an AI treasury operating system. It combines market coverage, company balances, opportunity research, allocation, monitoring, and action. Decision graphs and policy checks make the management process explainable. They support the product. They are not the whole product.

## The first customer and problem

[VERIFIED, user choice] The first buyer is stablecoin holding startups.

[INFERRED, customer problem] These companies need to know how much stablecoin liquidity to keep, what counts as surplus, and which available options fit their policies. Their decision must account for payroll and operating needs, asset and venue risk, liquidity, and changing market conditions. This problem is a product hypothesis until customer interviews and a pilot confirm it.

[VERIFIED, user direction] The user said, “Stablecoins is the thing which we are going for.” The first graph should monitor stablecoin conditions, including depeg signals, issuer and reserve information, liquidity, market news, and relevant compliance changes.

[VERIFIED, user direction] The user described an end vision across chains, stocks, lending, borrowing, yield, and Zcash, and said, “the vision is way bigger.” These are target markets and connector candidates. They are not current Falcon integrations. Robinhood stock access is an example to evaluate, not a committed partnership or supported integration.

## Product

[INFERRED, product definition] FalconOS builds a decision graph for a treasury mandate. Each decision links its source evidence, policy version, inputs, checks, proposed action, approval, transaction receipt, and observed outcome. A graph is executable policy and an audit trail. A graph picture alone is not the product.

[INFERRED, design boundary] Shared market evidence can feed multiple customers. Each customer’s balances, policies, decisions, and records stay in a private workspace. The system must keep public evidence separate from private company data.

[INFERRED, user experience] A company connects treasury data and selects its goals. FalconOS estimates operating needs and available liquidity. It finds and compares eligible opportunities across supported markets. It proposes an allocation, monitors positions, and reports changes and outcomes. The company mandate shapes this work. Policy checks and approval scopes limit authority.

[INFERRED, decision states] The first product should return clear states such as `REVIEW`, `BLOCKED`, and `NO_DATA`. Missing or stale evidence must not look like approval. A simulation must label assumptions and distinguish modeled results from realized returns.

## Product sequence

1. Stablecoin treasury wedge: [INFERRED] Monitor sourced stablecoin, issuer, liquidity, and market conditions. Estimate the company liquidity floor and identify possible surplus.
2. Decision and simulation engine: [INFERRED] Discover eligible opportunities, compare expected return against risk, cost, and liquidity, then test allocation choices against named baselines. Track modeled results separately from realized outcomes.
3. Falcon Cloud and plugin: [VERIFIED, user direction] The user said, “Falcon Cloud is where we’ll do this,” and described a private workspace for each company. [INFERRED] Offer a graph builder and private workspace through Cloud. Let compatible agents connect through MCP and API.
4. Cross-market coverage: [VERIFIED, user direction] The user named multiple chains, stocks, lending, borrowing, yield, and Zcash. [INFERRED] Add connectors based on customer demand, available data, legal review, and integration quality. Robinhood stock access is one candidate to assess. No chain, broker, or asset should be described as supported until its integration is built and verified.
5. Historical AI CFO proposal: [SUPERSEDED for the active build queue, 2026-10-13] The earlier goal to "manage funds highly autonomously" remains a future hypothesis. The selected execution model requires owner approval for every action. Limited automatic actions require a new product and authority decision.
6. Separate financial services: [VERIFIED, user direction] The user described a later service that could pool funds, invest them, and issue a token backed by treasury assets. [INFERRED] Treat this as a separate later product and regulatory workstream. Do not present pooled funds, a treasury-backed token, custody, or portfolio management as current FalconOS capabilities.

## Architecture and authority

```text
Markets and company treasury
              │
              ▼
       Falcon AI CFO
Discover → assess → allocate → manage
              │
       Falcon decision graph
              │
        Action connectors
              │
Accounts, wallets, and services
              │
       Results return to graph
```

[INFERRED, architecture] Shared market sources inform each company’s private treasury view. The decision engine discovers and evaluates opportunities, then proposes or manages an allocation. Company policy determines eligible assets, limits, and approval scope. Connected accounts enforce the granted authority. The decision graph records evidence, versions, actions, and outcomes.

[VERIFIED, current implementation] The repository README says the current live MVP is an MCP plugin and a Solana Devnet USDC yield agent. It reads Kamino reserve data, records hashed evidence, checks user-defined limits, and can prepare an unsigned transaction. The README also says Falcon has no mainnet deployment or custody, supply is capped at 1 Devnet USDC, and no signed Devnet supply has been confirmed.

[INFERRED, current product boundary] The current Devnet path is a test surface. It does not prove production execution, investment performance, customer demand, legal eligibility, or safe autonomy.

## Why this can matter

[INFERRED, value hypothesis] FalconOS aims to turn scattered treasury inputs into a managed portfolio view. A company can see liquidity needs, compare opportunities, and monitor positions in one workflow. A prospective pilot must test whether this saves time or improves a chosen risk-adjusted outcome.

[INFERRED, investor claim boundary] Falcon should not promise “best returns.” The investable claim is that Falcon can find and manage treasury opportunities through one measurable, policy-aware workflow. A pilot must test whether allocations improve outcomes after costs. Returns, safety, compliance, and customer control each need separate evidence.

## Competitive frame

[VERIFIED, cited product documentation] [Safe](https://docs.safe.global/home/ai-agent-quickstarts/introduction) documents AI-agent spending limits and human approval paths. [Fireblocks](https://www.fireblocks.com/platforms/governance-and-policies) documents transaction policies and approvals. [Allium](https://www.allium.so/use-case/product-engineering) documents onchain data APIs and analytics. These products cover important adjacent functions.

[INFERRED, differentiation hypothesis] Falcon’s proposed difference is the link from current evidence, through company-specific policy, to a decision and its measured outcome. This is a hypothesis, not a proven moat. Falcon must show that customers need this joined workflow and that existing treasury, wallet, and analytics products do not already solve it well enough.

## Business model hypothesis

[INFERRED] Begin with paid workspace subscriptions for stablecoin holding startups. Test a usage-based component only when measured data and compute costs support it. Possible later fees for execution or financial services need separate customer, legal, and unit-economics validation.

[NOT DETERMINED] Pricing, sales cycle, market size, paid conversion, and gross margin are not established. Stablecoin market capitalization is market context, not Falcon’s addressable market.

## Proof required before stronger claims

1. [INFERRED] A named customer problem and a prospective startup pilot.
2. [INFERRED] A reproducible decision replay with a named benchmark and disclosed assumptions.
3. [INFERRED] Results after fees and slippage, with drawdown, liquidity, and exposure reported.
4. [INFERRED] Tests for stale or missing data, policy changes, wallet permissions, revocation, and failed transactions.
5. [INFERRED] Counsel review for each launch market and product authority. This document is not legal advice.

## Evidence and limits

- [VERIFIED, repository source] Current implementation and limits: [`README.md`](../README.md), [`docs/decision-graph.md`](decision-graph.md), [`docs/treasury-mvp.md`](treasury-mvp.md), and [`SPEC.md`](../SPEC.md).
- [VERIFIED, user direction in this conversation] The proposed direction includes stablecoin treasury management, cross-chain and multi-market opportunity coverage, private company workspaces, decision graphs, simulation, an AI CFO, bounded execution, and later separate financial services.
- [INFERRED] Product sequence and architecture above are recommendations based on that direction and the checked repository state. They are not commitments about completed work.
- [VERIFIED, user choice, 2026-10-11] Initial workflow order: stablecoin risk monitoring, yield comparison, then company liquidity-floor planning. See [ADR 0011](adrs/0011-stablecoin-risk-monitoring.md).
- [VERIFIED, legal source] MiCA text lists custody and administration and portfolio management among crypto-asset services. The SEC’s 2026 custody proposal is a proposal, not an enacted rule. Product-specific obligations depend on jurisdiction, structure, asset, and authority. Sources: [MiCA Regulation (EU) 2023/1114](https://eur-lex.europa.eu/eli/reg/2023/1114/oj/eng) and [SEC proposed custody rule, Release No. IA-7032](https://www.sec.gov/rules-regulations/2026/10/s7-2026-35).

## Least confident decisions

1. [INFERRED] Stablecoin holding startups may have a strong, urgent need, but willingness to pay remains untested.
2. [INFERRED] The sequence and pace for cross-chain and traditional-market connectors may be wrong. Customer demand and data rights should set priority.
3. [INFERRED] A private Falcon Cloud workspace may be the right deployment model. Security needs, integration burden, and customer demand could favor a different model.
4. [INFERRED] Bounded customer-account execution may be viable in the selected markets. Counsel and permission tests must determine the product boundary.
