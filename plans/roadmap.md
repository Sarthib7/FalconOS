# FalconOS phased plan

[VERIFIED, user request, 2026-09-05] This plan replaces the earlier slice summary with indexed tasks, checkpoints, tests, and pass criteria. The user requested a local build and a proper execution plan. [CONTEXT.md](../CONTEXT.md) remains the product scope. No SPEC.md is created by this plan.

[VERIFIED, scope correction] The earlier roadmap marked the first slice "Completed, prototype". That described implemented code and local checks. It did not establish asset metadata, sustained source access, or an agent decision loop. This plan preserves P0 completion and leaves CP1A and CP1B open.

[VERIFIED, current position, 2026-09-05] CHK-05, CHK-06, and CHK-07 have scoped acceptance evidence. CHK-08 automated signal and export checks pass for both signals during requests and polling, while Obsidian desktop inspection remains open. CHK-09 is complete under the approved escalated ten-cycle watch; the historical `use_default` failure remains separate. CP1A remains open for the desktop item. CHK-26 preparation is accepted for D1, but CP1B remains open because no real agent thesis run exists.

[VERIFIED, final source/test freeze evidence, 2026-09-05] The saved full-suite output contains `tests 59`, `pass 59`, `fail 0`, `cancelled 0`, `skipped 0`, and its exit file contains `0`. The focused output contains `tests 35`, `pass 35`, `fail 0`, `cancelled 0`, `skipped 0`, and its exit file contains `0`. The typecheck exit file contains `0`. The fixture path passes its local checks. Real-agent acceptance remains open.

[REPORTED, team roles, 2026-09-05] Root only orchestrates and reports. GPT-5.6 Luna agents implement and measure. Their reports retain their own provenance.

## Product path

[VERIFIED, user-confirmed product direction, 2026-09-18] FalconOS is the umbrella product, with Falcon Investment Council as its current module in the agent-first market intelligence and risk advisory category. The present roadmap is advisory-only/read-only and makes no custody, pooling, signing, allocation, or execution claims. Future direction may include pooled investing, curated portfolios, custom ETFs or stock baskets, custody, allocation, and execution. A possible regulated entity would be a separate Falcon investment-management brand, potentially Falcon Hedge Fund.

[INFERRED, MVP boundary] FalconOS MVP ends with four results: a Solana and Base collector, one cited thesis from the selected existing agent using bounded Obsidian evidence, one paper-cycle outcome, and one review view that links the candidate, evidence, thesis, and outcome.

[SUPERSEDED, 2026-09-20] The former "later scope" list is void where it names live capital, signing, investor pooling, or execution. Those belong, if ever, to a separate regulated Falcon entity (CONTEXT.md, 2026-09-18). Broader strategies and a third chain remain possible FalconOS research work. An approved live cycle is not a FalconOS milestone.

[VERIFIED, user direction, historical] The 2026-09-05 wider scope named multichain liquidity, arbitrage, stablecoin pegs, new-token entries, investing, and execution. [SUPERSEDED, 2026-09-20] Execution is out of FalconOS scope; the rest survives only as advisory research categories. [INFERRED, sequence] Start with Solana and Base. Assess Robinhood Chain third. Tempo remains an alternative if asset-level evidence changes that choice.

## Phase map

| Phase | End-to-end result | Entry dependency | Checkpoint | Current position |
| --- | --- | --- | --- | --- |
| P0: Existing prototype | [VERIFIED] Quote to assessment, JSON evidence, and linked Obsidian note. | Existing repo | CP0 | [VERIFIED] Implemented. `tests 28`, `pass 28`, `fail 0`; typecheck exit `0`. |
| P1: Evidence to agent decision | [INFERRED] Accept the collector, then connect one existing agent to verified evidence and bounded graph context. | CP0; D1 for agent choice | CP1A, CP1B | [VERIFIED, current scoped checks] CHK-05, CHK-06, and CHK-07 have evidence. CHK-08 automated checks pass, with desktop inspection open. [VERIFIED, collector_luna] CHK-09 is complete under the approved escalated ten-cycle watch. The historical `use_default` failure remains separate. [INFERRED] No real agent thesis run exists. |
| P2: Capital-aware paper cycle | [SUPERSEDED, 2026-09-20] Paper/simulation remains a confirmed later advisory mode (CONTEXT.md Advisory modes), but this capital-reservation phase design is historical and awaits an advisory-only redesign. | — | — | [SUPERSEDED] Not active. |
| P3: Approved live cycle | [SUPERSEDED, 2026-09-20] Live execution is not a FalconOS phase. It belongs, if ever, to a separate regulated Falcon entity. | — | — | [SUPERSEDED] Removed from the FalconOS roadmap. |
| P4: Third chain and wider strategy | [INFERRED] One evidenced route or strategy reaches the same research and paper checks. | CP1A for research; CP2 for paper; CP3 controls for live work | CP4 | [INFERRED] Planned. Research may run beside P2. |
| P5: Product and hackathon package | [INFERRED] A reviewer can inspect one candidate, its graph evidence, thesis, and paper outcome. | CP1B for UI; CP2 for complete demo | CP5 | [VERIFIED] Brand brief drafted. [INFERRED] UI, assets, and release checks remain open. |

[INFERRED, dependency rule] Build P1, then P2. P3 and P4 extend the product after their gates pass. P5 can use P2 and must not wait for live trading or a third chain. Customer validation and event research run beside implementation.

## Checkpoints and passing criteria

| Checkpoint | Evidence required to pass | Reviewer | Failure response |
| --- | --- | --- | --- |
| CP0: Prototype recorded | [VERIFIED] CHK-00 through CHK-04 have recorded local evidence and stated limits in [status.md](../status.md#current-build). | Root | [INFERRED] Keep failures visible. Do not translate prototype completion into production readiness. |
| CP1A: Collector accepted | [INFERRED] CHK-05 through CHK-09 pass. Exact units are verified. Timeout, exit, stop, restart, and repeated-source checks have evidence. | Root | [INFERRED] Keep the research interface marked provisional. Preserve rejected and unavailable observations. |
| CP1B: Agent research accepted | [INFERRED] CP1A plus CHK-10 through CHK-12 pass. One existing agent emits valid, cited decisions. Tampered and future evidence is rejected. The graph comparison is reported. | Root; Sarthi reviews usefulness | [INFERRED] Correct the contract or narrow the claim. Do not claim graph benefit without a measured result. |
| CP2: Paper accounting accepted | [INFERRED] CHK-13 through CHK-15 pass. All case balances reconcile; duplicate input and restart do not create duplicate actions. | Root | [INFERRED] Keep live execution closed until the failing case has a test and a verified fix. |
| CP3: Live cycle accepted | [INFERRED] CHK-16 through CHK-18 pass. Exact approval and every leg's reconciled outcome are recorded. | Sarthi approves action; root checks results | [INFERRED] Stop new actions. Record unresolved exposure and reconcile unknown submissions before retrying. |
| CP4: Extension accepted | [INFERRED] CHK-19 or CHK-20 passes for the selected extension, plus its relevant earlier gates. | Root | [INFERRED] Record a no-go or retain a read-only experiment. A chain name alone is not route evidence. |
| CP5: Demo package accepted | [INFERRED] CHK-21 through CHK-23 pass. The review path works from a clean checkout. Paper results and failures are labeled. | Root; Sarthi reviews presentation | [INFERRED] Reduce the demo to the path that passes. Do not present future screens as implemented. |
| CP-H: Event submission ready | [INFERRED] CHK-24 passes separately for each event. The full submission is reviewable before external action approval. | Sarthi | [INFERRED] Keep that event's submission as a draft. Other local work can continue. |
| CP-V: Demand evidence | [INFERRED] CHK-25 records an accepted pilot scope and price, with the underlying operator case. | Sarthi | [INFERRED] Revisit the paid use case before widening product scope. Continue the authorized prototype without claiming demand. |

[INFERRED, completion rule] Every required check must have an observed result and evidence path. A skipped test, an unverified agent report, or an empty error log cannot close a checkpoint. A passing suite proves software checks, not trading returns or customer demand.

[VERIFIED, current checkpoint correction, 2026-09-05] The historical metadata capture and fixture test satisfy the scoped CHK-05 evidence. The measured DNS failure layer and local timeout and transport tests satisfy the scoped CHK-06 evidence. The approved escalated ten-cycle watch supplies the scoped CHK-09 evidence. The historical `use_default` failure remains separate. CP1A stays open for the desktop inspection.

## Immediate sequence

1. [INFERRED] Prepare the real P1-T07 agent process after the accepted local fixture validation. Keep real-agent acceptance open.
2. [INFERRED] Complete the Obsidian desktop graph and rendering check for P1-T04.
3. [INFERRED] Verify the selected Alpine Vector assets at 24px, in one color, inside an avatar, and in platform crops.
4. [INFERRED] Continue customer and event validation without claiming demand or submission readiness.

[VERIFIED, current block] Automatic approval review rejected the earlier exact-token RPC reads because it required fresh approval for the external API calls. This plan does not retry those requests. A later collector capture supplied historical metadata through its approved read-only path. The current fixture and registry test cover CHK-05 without claiming runtime revalidation.

## Open decisions

| ID | Decision | Proposed direction and alternative | Needed before |
| --- | --- | --- | --- |
| D1 | Which existing agent consumes the first evidence bundle? | [VERIFIED, current decision] Use the local Codex CLI as the first adapter. [REPORTED, root review] `docs/agent-contract.md` specifies bounded bundle input, manifest and hash checks, source cutoff, expiry, invalidation, untrusted-note boundaries, and strict cited JSON. Structural fixtures are labeled. A fixture does not pass CP1B, and no model run occurred. | P1-T06; any paid model or authenticated call needs authorized access. |
| D2 | Who owns capital, and how does it move? | [INFERRED] Prefer one operator's prefunded inventory for the first paper model. A bridge-first model needs transfer delay and restoration cases. Shared investor capital needs its own plan after ownership is decided. | P2-T01; all real balance access and live actions remain separately scoped. |
| D3 | Does Robinhood Chain have the right actual route? | [INFERRED] Assess Robinhood first. If assets or exits fail the gate, compare Tempo before adding a third adapter. | P4-T02. Solana/Base work does not depend on this choice. |
| D4 | Which abstract brand direction is selected? | [VERIFIED, current design record] Alpine Vector is selected. The [brand brief](../docs/brand-brief.md#directions) cites the external brand record at its correction entry. 24px, one-color, avatar, crop, browser, and UI checks remain open. | Visual asset verification in P5-T01. |

[INFERRED, CLI contract decision] Bounded watch should use the same failure signal as a single scan: exit `2` when its final scan is incomplete. P1-T03 implements this proposed change. The current code and README still describe the earlier behavior. Keep them unchanged until the tests and code change together.

[VERIFIED, correction, cli_luna, 2026-09-05] The earlier record above described a pending change. `src/cli.ts` now applies the contract, and `README.md` documents it. `node --test test/cli.test.ts` returned `tests 4`, `pass 4`, `fail 0`; the isolated old branch returned `regression_exit=1`, `tests 4`, `pass 3`, `fail 1` with `0 !== 2` for the incomplete bounded-watch case. Root integration remains pending.

[REPORTED, collector_luna final integration report, 2026-09-05] The final report states that typecheck exited `0`, the full suite returned `tests 36`, `pass 36`, `fail 0`, `cancelled 0`, `skipped 0`, and the targeted CLI run returned `tests 6`, `pass 6`, `fail 0`, `cancelled 0`, `skipped 0`. This report does not close CP1A. Live provider diagnosis, metadata, desktop inspection, and remaining export stop paths stay open.

[VERIFIED, correction, 2026-09-05] The 36-test report above is a prior integration baseline. The prior local suite returned `tests 40`, `pass 40`, `fail 0`, `cancelled 0`, `skipped 0`. The saved final source/test evidence is 59/59 with exit `0`. The current metadata and clock evidence is linked in [the verification record](../docs/verification/2026-09-05-registry-and-clock.md). The approved escalated ten-cycle watch provides CHK-09 evidence. Desktop inspection remains open, so CP1A remains open.

## Estimates and scope control

[INFERRED, estimates] Estimates assume one human builder with agent help, available APIs, and an already selected agent. They exclude waiting for approvals, customer replies, or missing credentials.

| Work | Proposed working time | Main uncertainty |
| --- | --- | --- |
| P1A collector acceptance | [INFERRED] One working day after access is resolved. | Provider failure cause, metadata access, and process tests. |
| P1B agent path | [INFERRED] Two to three working days. | Existing agent interface and useful graph context. |
| P2 paper cycle | [INFERRED] Three to four working days. | Ownership model, restoration, and partial failure accounting. |
| P3 live cycle | [INFERRED] Two to three working days after approval. | Executor support and reconciliation of unknown states. |
| P4 and P5 | [INFERRED] Two to four days per selected extension; two to three days for the demo UI and package. | Actual third-chain routes and design scope. |

[INFERRED, release choice] The smallest complete demo is P1, P2, and P5. Cut unverified strategy breadth first. Preserve failure handling, evidence, and accurate labels. A live trade is optional for this demo and cannot be invented for presentation.

[VERIFIED, earlier research record] The [event draft](../.superstack/falconos-dual-hackathon-draft.md) contains previously reviewed event dates and requirements. [INFERRED] H-T01 must recheck official rules before scheduling submission. This plan sets no new verified deadline and performs no registration, token launch, or publication.

## Least confident decisions

1. [INFERRED] Operators will pay for cited agent decisions and execution evidence. The pilot gate remains open.
2. [INFERRED] Stored graph context improves decisions enough to justify its cost. The paired case run must measure this.
3. [INFERRED] Solana/Base opportunities survive costs and restoring inventory. Current quote observations do not establish profitable execution.
4. [INFERRED] Robinhood is the best third chain. Exact assets, route depth, and exits remain unmeasured.
5. [INFERRED] The proposed timing fits the event plan. Access delays and official eligibility decisions may change the sequence.
