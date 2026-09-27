# Falcon documentation index

[VERIFIED, current local result, 2026-09-27] The knowledge mesh, Devnet terminal and React landing have local verification. Start with [run commands](../mesh/README.md), [mesh contract](knowledge-mesh.md), [email contract](landing-email.md), or [final evidence](verification/2026-09-27-mvp.md). The funded wallet round trip and inbox receipt remain unverified.

[VERIFIED, user direction, 2026-09-26] The user approved the visual pitch and chose: "Local loop first, let's do that." This index points to the new treasury work. Earlier advisory and Devnet records remain available below.

[VERIFIED, resumed state, 2026-09-27] The user approved decision-graph work before execution. The [graph contract](decision-graph.md) defines this slice. The [earlier handoff](handoffs/2026-09-26-treasury.md) preserves the September 26 PR state.

[VERIFIED, graph prototype result] Web tests returned `110/110`; the final browser returned `43/43`. The [verification record](verification/2026-09-27-graphs.md) includes screenshots, negative controls, hosting limits, and the next action.

## Start here

| Record | Purpose |
| --- | --- |
| [Saved visual pitch](pitches/falcon-stages.html) | [VERIFIED, saved artifact] Four product stages, the first MVP, current progress, and the next hackathon plan. |
| [Product and architecture](treasury-mvp.md) | [INFERRED, design] User outcome, local slice, complete Stage 01 scope, boundaries, and acceptance criteria. |
| [Root specification](../SPEC.md) | [INFERRED, contract] I14, V77 through V90, and T41 govern the graph slice. |
| [Implementation plan](../plans/treasury-mvp.md) | [INFERRED, plan] Ordered slices, owners, dependencies, and exit criteria. |
| [Module contract](treasury-contract.md) | [INFERRED, contract] Exact commands, records, graph, store, and UI boundaries. |

## Architecture decision records

| ADR | Decision |
| --- | --- |
| [0001: Local simulation first](adrs/0001-local-treasury-loop.md) | [VERIFIED, user choice] Prove the loop before protocol execution. |
| [0002: Graph and authority](adrs/0002-graph-and-authority.md) | [INFERRED, design] Graph informs decisions; separate guards constrain settlement. |
| [0003: Replayable local history](adrs/0003-browser-local-history.md) | [INFERRED, design] Validated command log, exact amounts, serialized writes. |
| [0004: Cloud deployment](adrs/0004-cloud-deployment.md) | [INFERRED, recommendation] Pages for tester access; a service and Postgres for later server work. |

## Current state and earlier records

[VERIFIED, record locations] [Status](../status.md#active-treasury-work-2026-09-26) records current ownership and command evidence. [Context](../CONTEXT.md) records product direction. [Interfaces](interfaces.md) indexes the treasury and earlier APIs. [Decision history](decisions.md) retains earlier choices. [Earlier plans](../plans/README.md) retain prior milestones. [Pitch review](pitches/review.md) records visual and event research checks.

[VERIFIED, local evidence] The [treasury verification record](verification/2026-09-26-treasury.md) includes exact test results and their limits. The [PR plan](../plans/treasury-prs.md) separates documentation from four working feature slices.

## Least confident decisions

1. [INFERRED] The local slice may expose product changes before the protocol adapter is ready. Update the contract before those changes enter code.
2. [INFERRED] Cloud service selection should be revisited when actual workload and operational costs are measured.
