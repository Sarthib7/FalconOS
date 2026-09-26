# Treasury PR sequence

[VERIFIED, user direction, 2026-09-26] The user requested small PRs, with documentation first and separate reviews for each implementation slice.

[VERIFIED, base inspection] The isolated checkout starts at published main `4f8e78c81dede71bc8ef0401df9184a81d05ad38`. The original worktree has unrelated dirty files and three local commits. Those changes do not enter this stack.

## Review order

| Branch | Scope | Exit evidence |
| --- | --- | --- |
| `docs/treasury-pitch` | [INFERRED] Accepted HTML pitch and capture notes. | Artifact identity and prior browser presentation checks. |
| `docs/treasury-contracts` | [INFERRED] Product, spec, contract, ADRs, roadmap, and indexes. | Relative file targets and writing audit. |
| `feat/treasury-setup` | [INFERRED] Create, save, and restore one simulated mandate. | Invalid inputs, protected balances, corrupt history, failed writes, and browser reload. |
| `feat/treasury-decisions` | [INFERRED] Synthetic evidence, manual decisions, owner exit, and revocation. | Complete supply/redemption path, policy checks, and failure preservation. |
| `feat/treasury-history` | [INFERRED] Inspect saved graphs and export the command log. | Pre-action graph, accessible relationships, keyboard use, and downloaded JSON replay. |
| `feat/treasury-loop` | [INFERRED] Explicit bounded agent controls. | Saved cycles, stop behavior, and stopped state after reload. |

[INFERRED, workflow] Each PR targets the preceding branch. Review and merge in order. Every feature includes its UI, domain/storage path, and tests. The first decision slice includes owner exit, so it demonstrates a complete round trip.

[VERIFIED, authorization boundary] The user authorized feature branch pushes and PR creation. Main merges and manual cloud publication were not requested. Each PR remains a draft until review.

[INFERRED, integration rule] Verify the exact staged tree before each commit. Commit and push sequentially. Preserve the original worktree. Report every PR's base, scope, tests, and remaining limits in its body.

## Least confident decisions

1. [INFERRED] The manual-decision PR will be the largest because movement and exit guards must arrive together.
2. [INFERRED] Repository branch automation may affect previews. No manual production deployment is part of this stack.
