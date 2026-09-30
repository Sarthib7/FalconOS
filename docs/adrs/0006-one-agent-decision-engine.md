# ADR 0006: One customer agent over one decision engine

[VERIFIED, user direction, 2026-09-30] Status: Accepted as architecture destination. The customer talks to one agent. Specialists and graphs run in the backend. Other agents use the same engine through a plugin.

## Context

[VERIFIED, current modules] Falcon Investment Council is a roster of specialists behind `council.advice` and `council.copilot`. The Client Agent still owns execution in those contracts. The user wants one front agent that interviews an Investor, compares global choices, and can later manage money. The user also wants a plugin so any agent can request investor advisory from that same backend.

Rejected shapes:

- Separate advisory brains for the dashboard, the customer agent, and each plugin client.
- Many customer-facing specialist chatbots.
- A friendly tone that can claim or offer what the backend has not cleared.

## Decision

Build **one Decision Engine**. FalconOS's Customer Agent is the first client. External agents are additional clients of the same API.

The Customer Agent stays one voice. It asks for the Investor Dossier (residence, goals, horizon, loss tolerance, liquidity need, currency, constraints) and does not make the Investor repeat it. Specialists stay hidden by default. The advanced view shows the recorded decision graph: evidence, dates, rejected options, and specialist dissent. It does not dump private model reasoning.

Before money can move, the engine issues a Plan Receipt: feasible routes only, with stamped costs or an explicit unknown. After movement, a Cash Trace names where funds sit and how to exit. Every offer carries Who-Acts: who holds funds, who executes, who signs.

The plugin's first return type is investor-specific guidance (ADR 0005 option B). It does not grant a consuming agent FalconOS's management mandate.

## Consequences

- [INFERRED] Eligibility, suitability, venue, and capability checks must live in the engine, fail closed, and be the only way an offer is created.
- [INFERRED] Scraped or model-generated text is not an Opportunity. See [ADR 0007](0007-global-discovery-alerts.md).
- [INFERRED] Current `council.advice` / `council.copilot` schemas stay in force until SPEC changes them.
