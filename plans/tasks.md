# FalconOS task board

[INFERRED, workflow] This file owns task status. The roadmap owns checkpoint rules. The check register owns pass criteria. Update evidence and status together. Do not mark a task complete from an agent report alone.

[INFERRED, ownership] Root assigns each implementation task to one builder agent and verifies its result. A research agent can collect independent evidence. Sarthi decides product scope and approves actions that require approval. Future agent assignments are proposals until work starts.

## Current work

[VERIFIED, current status, 2026-09-05] P1-T01 and P1-T02 have scoped acceptance evidence. P1-T03 passes its bounded-watch and CLI stop checks. P1-T04 automated checks pass, but desktop inspection remains open. P1-T05 completed its ten-scan operating check under the approved escalated context. The historical `use_default` watch remains separate. P1-T06 preparation is complete for the selected Codex CLI adapter. P1-T07 fixture validation is complete for its local subset; the real process remains. CP1A gates live acceptance only. CP1A and CP1B remain open.

[REPORTED, preliminary source freeze, 2026-09-05] Root earlier reported `tests 57`, `pass 57`, `fail 0`, `cancelled 0`, `skipped 0`. This result is superseded by the final 59-test evidence below. [VERIFIED, final source/test freeze evidence] The saved full-suite output contains `tests 59`, `pass 59`, `fail 0`, `cancelled 0`, `skipped 0`, and its exit file contains `0`. The fixture path remains separate from real-agent acceptance.

[REPORTED, team roles, 2026-09-05] Root only orchestrates and reports. GPT-5.6 Luna agents implement and measure. The executing agent owns each command's provenance.

[VERIFIED, prior baseline] The first local prototype was implemented. The initial queue listed P1-T02 live diagnosis and P1-T01 metadata approval. This is historical queue evidence. See the [current build record](../status.md#current-build).

[VERIFIED, correction, 2026-09-05] The queue paragraph above is a prior baseline. P1-T05's ten-scan result is recorded under the approved escalated context. Current work is the real P1-T07 process, the P1-T04 desktop check, and the selected Alpine asset checks. CP1A gates live acceptance only. P1-T01, P1-T02, P1-T03, and P1-T06 have the scoped results shown in the task rows below.

| Priority | ID | Next bounded action |
| --- | --- | --- |
| 1 | P1-T07 | [INFERRED] Verify the Codex approval and web-search controls, prepare the exact synthetic model check, then review access for that call. Keep real-agent checks open. |
| 2 | P1-T04 | [INFERRED] Complete the remaining Obsidian desktop graph and rendering check. |
| 3 | P5-T01 | [INFERRED] Verify the selected Alpine assets at 24px, in one color, inside an avatar, and in platform crops. |

## P0: Existing prototype

[VERIFIED, P0 baseline] The table below preserves the original prototype task evidence. The prior 40-test run is recorded in the current-work section and [status.md](../status.md#current-build). The final source/test freeze evidence is recorded in the P1-T07 fixture record.

| Done | ID | Owner | Task and baseline evidence | Checks |
| --- | --- | --- | --- | --- |
| [x] | P0-T01 | Root | [VERIFIED] Clone the repo, preserve the four original documents, and record current scope. Evidence: [current build](../status.md#current-build), [CONTEXT](../CONTEXT.md). | CHK-00 |
| [x] | P0-T02 | Builder, root | [VERIFIED] Quote collection through assessment and evidence export is implemented. `demo`, `scan`, and `watch` exist in `src/cli.ts`. | CHK-01, CHK-02, CHK-03 |
| [x] | P0-T03 | Root | [VERIFIED] Test, typecheck, demo, one successful live scan, and regression experiments are recorded in [current build](../status.md#current-build). | CHK-01, CHK-03, CHK-04 |

<a id="p1a"></a>
## P1A: Accept the evidence collector

| Done | ID | State and owner | Task | Depends on | Checks |
| --- | --- | --- | --- | --- | --- |
| [x] | P1-T01 | Completed, collector_luna + cli_luna | [REPORTED, collector_luna capture] The four configured addresses, six-decimal responses, finalized Solana slots, pinned Base block, methods, and capture window are recorded. [VERIFIED, cli_luna] The saved fixture test matches the registry and capture hash. Runtime metadata revalidation remains unproven. | Metadata-read approval | CHK-05 |
| [x] | P1-T02 | Completed, collector_luna | [REPORTED, collector_luna] Timeout and structured transport tests pass, and the DNS failure layer was measured. The reason for differing default-context results remains not determined. | P0 | CHK-06 |
| [x] | P1-T03 | Completed, cli_luna | [VERIFIED, cli_luna] Healthy bounded watches exit `0`; incomplete bounded and one-shot runs exit `2`; three incomplete scans stop; a healthy scan resets the count. The post-collection clock regression passes. [REPORTED, collector_luna] The four production signal and path combinations pass in the final integration report. | P0 | CHK-07 |
| [ ] | P1-T04 | In Progress, collector_luna | [REPORTED, collector_luna] Export termination and restart tests report `7/7`. [VERIFIED, cli_luna] SIGINT and SIGTERM during requests and polling preserve the tested records and start no later request. [INFERRED] Obsidian desktop inspection remains open. | P0 | CHK-08 |
| [x] | P1-T05 | Completed, collector_luna | [VERIFIED, collector_luna, 2026-09-05] The approved escalated watch completed 10 unique scans with exit code `0`. Each scan had `validQuotes: 4`, `expectedQuotes: 4`, and `complete: true`; all 40 observations had HTTP status `200`, raw data, and `error: null`. Assessment times increased strictly. [REPORTED, cli_luna independent review, 2026-09-05] The review stated "20/20 cycles and 9/9 scan boundaries non-overlapping." Copied raw and exporter-note hashes match. Before and after source/test manifests are byte-identical. The historical `use_default` watch remains a separate three-cycle exit `2` record, and its context difference remains not determined. The saved PTY text is reconstructed consistency evidence, not independent emitted-hash evidence. See the [live checks](../docs/verification/2026-09-05-live-checks.md) and [watch manifest](../data/verification/2026-09-05-ten-scan-escalated.json). | P1-T01 through P1-T03; P1-T04 automated portions; live access | CHK-09 |

<a id="p1b"></a>
## P1B: One existing agent uses graph evidence

| Done | ID | State and owner | Task | Depends on | Checks |
| --- | --- | --- | --- | --- | --- |
| [x] | P1-T06 | Completed, cli_luna + root review | [VERIFIED, root review] D1 selects the local Codex CLI adapter. `docs/agent-contract.md` defines bounded bundle input, manifest and hash checks, source cutoff, expiry, invalidation, untrusted-note boundaries, and strict cited JSON. The [fixture record](../docs/verification/2026-09-05-agent-fixture.md) records the structural check. No model run occurred. | D1 | CHK-26 |
| [ ] | P1-T07 | In Progress, cli_luna + root review | [REPORTED, root final adapter check] The current Codex adapter passed saved local fake-process checks with `tests 65`, `pass 65`, `fail 0`, `cancelled 0`, `skipped 0`, and exit `0`. It requests `gpt-5.6-luna` with `model_reasoning_effort="max"` and uses a read-only child sandbox. No real model call occurred. Real model response and decision validation remain open. CP1A is required for live acceptance only. | P1-T06; CP1A before live acceptance only | CHK-10, CHK-11 |
| [ ] | P1-T08 | Planned, root | [INFERRED] Run fixed valid and hostile cases. Compare the same agent with and without graph context. Record failures, token cost, and latency. | P1-T07 | CHK-11, CHK-12 |

## P2: Capital-aware paper cycle

[SUPERSEDED, 2026-09-20] This phase design is historical. Paper/simulation remains a confirmed later advisory mode, but capital reservation and inventory ownership are not FalconOS work. Do not start these tasks.

| Done | ID | State and owner | Task | Depends on | Checks |
| --- | --- | --- | --- | --- | --- |
| [ ] | P2-T01 | Waiting, Sarthi + root | [INFERRED] Choose capital ownership and the first route model. Document inventory on each chain and restoration rules. Use synthetic balances until reads are authorized. | D2, CP1B | CHK-13 |
| [ ] | P2-T02 | Planned, builder | [INFERRED] Complete one paper path from thesis through reservations, simulated legs, fees, restoration, and an outcome note. Persist each state change. | P2-T01 | CHK-14 |
| [ ] | P2-T03 | Planned, builder | [INFERRED] Replay failed second legs, partial fills, duplicate input, restart, and unknown submission state. Show unresolved exposure. | P2-T02 | CHK-15 |
| [ ] | P2-T04 | Planned, root | [INFERRED] Reconcile the case set and review estimates against outcomes. Report unknown costs as unknown net results. | P2-T03 | CHK-14, CHK-15 |

## P3: One approved live cycle

[SUPERSEDED, 2026-09-20] Live execution is not a FalconOS phase. It belongs, if ever, to a separate regulated Falcon entity (CONTEXT.md, 2026-09-18). Do not start these tasks.

| Done | ID | State and owner | Task | Depends on | Checks |
| --- | --- | --- | --- | --- | --- |
| [ ] | P3-T01 | Planned, researcher + builder | [INFERRED] Verify current tool contracts for the chosen existing executor. Build a dry-run route with simulation, scoped authority, and a stop control. | CP2, D1, D2 | CHK-16 |
| [ ] | P3-T02 | Waiting, Sarthi | [INFERRED] Review the exact capital source, asset sizes, route, limits, fees, and recovery plan. Approve the specific live action. | P3-T01 | CHK-17 |
| [ ] | P3-T03 | Planned, builder + root | [INFERRED] Run the approved cycle. Store each transaction identifier and confirmed fill. Block blind retries when submission state is unknown. | P3-T02 | CHK-17, CHK-18 |
| [ ] | P3-T04 | Planned, root | [INFERRED] Reconcile balances, fills, costs, exposure, and restored capital. Export the actual outcome to the graph. | P3-T03 | CHK-18 |

## P4: A third chain and wider strategies

| Done | ID | State and owner | Task | Depends on | Checks |
| --- | --- | --- | --- | --- | --- |
| [ ] | P4-T01 | Planned, researcher | [INFERRED] Assess one Robinhood Chain route at the asset level. Verify network, asset, quote access, inventory, and exit path. Record a no-go if evidence fails. | CP1A; D3 before integration | CHK-27 |
| [ ] | P4-T02 | Planned, builder | [INFERRED] Add one selected third-chain route through quotes, agent evidence, and a paper cycle. Reuse the same gates. | P4-T01 with a go verdict, CP2 | CHK-19, CHK-14, CHK-15 |
| [ ] | P4-T03 | Planned, builder | [INFERRED] Add one peg-monitoring path with issuer evidence, reference currency, deviation, expiry, and a cited review decision. | CP1B; selected user case | CHK-20 |
| [ ] | P4-T04 | Planned, researcher + root | [INFERRED] Select one next use case: new-token detection, investment research, or shared liquidity. Write its complete path and specific failure checks before code. | V-T02, D2 | CHK-30 |

[INFERRED, scope rule] P4 research can run beside P2. Trading on a new route still requires P3 controls and action approval. Pooled investor funds require a separate plan after ownership is settled.

## P5: Product design and hackathon package

| Done | ID | State and owner | Task | Depends on | Checks |
| --- | --- | --- | --- | --- | --- |
| [ ] | P5-T01 | Ready, Sarthi + designer agent | [INFERRED] Verify the selected Alpine Vector direction at 24px, in one color, inside an avatar, and in platform crops. Produce the mark, wordmark, avatar, and banner from the [brand brief](../docs/brand-brief.md). | D4 | CHK-21 |
| [ ] | P5-T02 | Planned, builder | [INFERRED] Build one review screen: candidate to evidence, graph context, thesis, and paper outcome. Show source health and explicit modes. | CP1B, P5-T01; CP2 for paper results | CHK-22 |
| [ ] | P5-T03 | Planned, root | [INFERRED] Reproduce the demo from a clean checkout. Include a rejected candidate and a failed paper leg. Prepare a concise recording and README. | CP2, P5-T02 | CHK-23 |
| [ ] | P5-T04 | Planned, Sarthi + root | [INFERRED] Prepare separate event submissions, prior-work disclosures, and current eligibility evidence. Request approval only when each package is reviewable. | P5-T03, H-T01 | CHK-24 |

## Parallel validation and event work

| Done | ID | State and owner | Task | Checks |
| --- | --- | --- | --- | --- |
| [ ] | V-T01 | Ready, Sarthi + researcher | [INFERRED] Conduct five operator interviews and record two concrete decision or execution failures. Outreach needs authorization before messages are sent. | CHK-29 |
| [ ] | V-T02 | Planned, Sarthi | [INFERRED] Obtain one accepted priced pilot tied to a measured workflow. Record scope, proposed price, and exact responses. A rejection stays evidence and leaves this outcome open. | CHK-25 |
| [ ] | H-T01 | Ready, researcher + root | [INFERRED] Recheck current rules for both events. Record concurrent entry, prior work, token requirements, dates, and required accounts. List unresolved items and the evidence needed to resolve them. | CHK-28 |

## Least confident decisions

1. [INFERRED] The current collector is the best first input for the selected existing agent. D1 may change the interface.
2. [INFERRED] The first capital model will use inventory already held on both chains. D2 remains open.
3. [INFERRED] Customers need the graph context enough to support a priced pilot. V-T02 remains unstarted.
