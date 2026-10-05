# ADR 0008: Deliver FalconOS through plugins and organization workspaces

**Status:** Accepted as product direction, 2026-10-05. Implementation and market validation remain open.

## Context

Individuals need a low-cost entry path through agent tools they already use. Companies, startups, teams, and institutions need a hosted environment with persistent data, a dedicated financial agent, and shared operating workflows.

[REPORTED, Kuro repository README, fetched 2026-10-05] Kuro describes a Personal AI CFO with agent plugins, self-hosted use, and managed runners. Its README also describes a separate embedded wallet per hosted runner. This is a reference, not independent validation of adoption or performance.

## Decision

Offer two delivery paths over one Falcon Decision Engine: individual access through lower-cost plugins, and an organization cloud workspace with a dedicated Falcon Agent. The organization agent supports CFO, treasury, budget, compliance-workflow, stock, and hedging tasks. Keep organization data, agent state, and mandates isolated. Do not build a separate reasoning engine per customer.

## Consequences

Pricing, first buyer, cloud provider, tenant boundaries, plugin contract, and launch sequence remain open. Falcon's positioning advantage over AI CFO tools is a hypothesis until customers validate it.
