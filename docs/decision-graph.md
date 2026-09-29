# Decision graph prototype

[VERIFIED, user direction, 2026-09-27] The user approved graph work before Devnet execution: "Yes, I approve this flow, so start working on it."

## First slice

[INFERRED, implementation contract] Owner: coordinator. Status: Completed. Keep one synthetic lending position. Build a review screen around the existing graph evaluator. Preserve exact amounts, mandate checks, and visible failures. This slice uses fixed rules and synthetic observations.

[VERIFIED, local result] Web tests returned `110/110`; the final browser returned `43/43`. The [verification record](verification/2026-09-27-graphs.md) covers the local prototype. Public access remains a separate release step.

[INFERRED, hosting decision] Prepare `/treasury/` for Cloudflare Pages. Each browser owns its saved run. Closing the page stops its loop. Pages plus a service and Postgres remains later scope if cross-device history or background work is needed. Cloud account and production settings need verification before publication. See [ADR 0004](adrs/0004-cloud-deployment.md).

[VERIFIED, release candidate] `npm --prefix web run build:treasury` produced `web/dist-treasury/` with exactly three files. Use a separate Pages preview project because the normal site build contains unrelated pending work. This artifact has only `/treasury/` and its assets. [Build instructions](../web/README.md#separate-graph-preview).

## Frozen interface amendment to I14

[INFERRED, record contract] New runs use `schemaVersion: 2`, `policyVersion: "treasury-rules/1"`, `legacyEventCount: 0`, and `records: []` in addition to existing run keys. Save one complete Entry per event. Each Entry retains the pre-action graph, decision, outcome, and resulting balances. Replay verifies saved records against the declared policy. Unsupported versions and mismatched records fail visibly without replacing storage.

[INFERRED, compatibility] Schema 1 remains readable under the original rule policy. On the next successful append, preserve all old commands and write schema 2. Set `legacyEventCount` to the original event count. Those records are reconstructed legacy history, not original saved snapshots. Later appends preserve that count. Export carries the policy and records. Storage keeps its existing key and lock, with a limit of 2,097,152 UTF-16 code units (`string.length`). Failed writes preserve the old record.

[INFERRED, decision contract] Decisions retain existing fields and add `policyVersion` and `checks`. Each check contains `id`, `label`, `status`, `detail`, and `evidenceNodeIds`. Status is `PASS`, `BLOCKED`, `NO_DATA`, or `SKIPPED`. Checks follow actual evaluation order. A skipped check cannot imply approval. Evidence IDs belong to the input graph. Missing relationships, revoked authority, missing/stale/future evidence, liquidity, position, and cap checks explain the action. `decide(graph)` remains graph-only.

[INFERRED, view contract] Replay returns existing `state`, `graph`, and `entries`, plus `policyVersion` and `legacyEventCount`. The six-node input graph remains the decision input. The UI may add presentation nodes for the selected decision and outcome. Those nodes cannot become decision inputs. UI-generated links identify their source and destination.

[INFERRED, export compatibility] Export preserves the saved schema. Before a legacy run receives a new command, its export contains commands only. The confirmation states that it has no saved policy or snapshots. Schema 2 exports include the complete records.

## Screen and flow

[INFERRED, interface design] Keep dark green and mint. Rules and balances establish owner limits. Show the graph beside a decision inspector. List source, observation time, age at decision, amounts, and checks. Raw JSON stays optional. History stays below.

[INFERRED, selection behavior] Selecting a decision shows its original graph and outcome. Selecting a rule highlights its evidence and relationships. Labels accompany color. Distinguish current and historical state. Historical evidence age uses decision time. Latest-decision links select that decision's input before highlighting evidence.

[INFERRED, evidence control] Keep preset scenarios and add a validated custom synthetic liquidity input. Changing the observation, then running a cycle, changes the decision through the graph. Never imply a provider was contacted.

## Acceptance

1. [INFERRED] A tester can trace each decision to source data and the rule that allowed or blocked it.
2. [INFERRED] Missing or stale evidence stays visible. Failed exits preserve the simulated position.
3. [INFERRED] Reload and export preserve inputs, policy, checks, and outcome. Unsupported or altered records fail visibly.
4. [INFERRED] Legacy history stays readable and receives an explicit reconstruction label after upgrade.
5. [INFERRED] Desktop, narrow-screen, keyboard, and isolated-browser checks pass on the built artifact.

## Ownership

[INFERRED, task contract] Domain implementer owns `web/treasury/domain.mjs` and treasury domain tests. UI implementer owns `web/treasury/app.mjs`, `index.html`, and `style.css`. Coordinator owns store changes, browser checks, integration, documentation, and final verification. No new runtime dependency is needed.

## Least confident decisions

1. [INFERRED] Synthetic observations may be insufficient for the next review. Live read-only evidence needs a source contract.
2. [INFERRED] Browser-local history may restrict testers. Shared history would need the backend option.
3. [INFERRED] A usable Devnet lending reserve remains unverified. Resolve that before execution work.
