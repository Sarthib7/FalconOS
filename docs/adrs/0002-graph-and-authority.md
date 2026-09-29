# ADR 0002: Make the graph decision input

[INFERRED, architecture decision] Date: 2026-09-26. Owner: architect. Status: Completed for the simulation contract. Real delegation remains Planned.

## Context

[VERIFIED, source inspection] At published base `4f8e78c`, `engine/src/serve.rs:213` evaluates the stocks council. Line 231 then calls `build_graph` with the verdict. The original local worktree has the same order at lines 529 and 534. Both flows explain a completed verdict. Treasury requires the graph before the decision.

## Options and decision

[INFERRED, alternatives] Reusing the current council would couple treasury policy to stock evidence. Calling a model before policy would add an unverified dependency. A pure graph evaluator makes the first decision path reproducible.

[INFERRED, decision] `decide(graph)` consumes typed graph nodes and required relationships. It has no separate balance or policy argument. Missing required links block action. Retain the pre-action graph and evidence references in the replay view.

[INFERRED, authority boundary] Only the owner sets the mandate. The agent must keep the reserve and budget fixed, even when it proposes a different action. Revocation blocks agent movement. The owner can still request redemption through a separate command, subject to liquidity and evidence checks. Settlement enforces the balance rules again.

[INFERRED, next protocol boundary] A future model may propose an action. Before signing, an executor must validate fresh account state, instructions, amounts, destinations, and receipt ownership. Wallet permission primitives need adversarial tests against the exact lending integration.

## Least confident decisions

1. [INFERRED] The six-node simulation graph is sufficient to prove the first path. Live collateral and issuer dependencies will need more evidence.
2. [INFERRED] Swig may provide the required authority limits. Its complete policy against the selected Kamino route remains unverified.
