# FalconOS plan index

[VERIFIED, current direction, 2026-09-26] The active plan is [Treasury MVP](treasury-mvp.md), following the user's accepted pitch and local-loop-first choice. The [documentation index](../docs/README.md) links the spec, contract, and ADRs. The earlier plans and results below retain their historical scope.

[VERIFIED, user request, 2026-09-05] This index answers: "make a proper plan and toodos with checkpoints , checks, test, passing ctritial, phases, and index them."

## Start here

1. Read the [phase map and checkpoints](roadmap.md#phase-map).
2. Use the [task board](tasks.md#current-work) for current work and owners.
3. Open the [check register](checks.md) before marking a task complete.

| Record | Purpose |
| --- | --- |
| [Roadmap](roadmap.md) | [INFERRED, plan] Phase scope, dependencies, checkpoint rules, estimates, and open decisions. |
| [Tasks](tasks.md) | [INFERRED, workflow] The single record of task completion. Each task has an ID, owner, dependency, and check IDs. |
| [Checks](checks.md) | [INFERRED, workflow] Commands, test cases, pass criteria, evidence requirements, and current verification limits. |
| [Build evidence](../status.md#current-build) | [VERIFIED, session record] Actual command output, live captures, failures, and approval blocks. |
| [Brand brief](../docs/brand-brief.md) | [VERIFIED, file contents] Alpine Vector is selected. The brief retains earlier directions and records the open 24px, crop, browser, and UI checks. |

## Current position

[VERIFIED, user-confirmed product direction, 2026-09-18] FalconOS is the umbrella product; Falcon Investment Council is the current module; the current category is agent-first market intelligence and risk advisory. The current plan remains advisory-only/read-only with no custody, pooling, signing, allocation, or execution claims. Pooled investing, curated portfolios, custom ETFs or stock baskets, custody, allocation, and execution are future direction only. A possible regulated entity would be a separate Falcon investment-management brand, potentially Falcon Hedge Fund.

[VERIFIED, user direction, 2026-09-30] Read the older [roadmap](roadmap.md) as broad FalconOS research scope, not a stocks-only mandate. The [active treasury MVP](treasury-mvp.md) is another product path. The stocks engine is one specialist. Council advice remains advisory-only; the local Devnet terminal still needs an owner-signed proof before any execution claim.

[VERIFIED, prior local result, 2026-09-05] `npm run typecheck` exited `0`. `npm test` returned `tests 40`, `pass 40`, `fail 0`, `cancelled 0`, `skipped 0`. CHK-05, CHK-06, and CHK-07 have scoped evidence. CHK-08 automated signal and export checks cover both signals during requests and polling; desktop graph rendering remains open. CHK-09 is complete for the approved escalated ten-cycle watch. The earlier `use_default` watch remains a separate three-cycle failure. See the [live checks](../docs/verification/2026-09-05-live-checks.md). CP1A remains open.

[VERIFIED, final source/test freeze evidence, 2026-09-05] The saved full-suite output contains `tests 59`, `pass 59`, `fail 0`, `cancelled 0`, `skipped 0`, and its exit file contains `0`. The focused output contains `tests 35`, `pass 35`, `fail 0`, `cancelled 0`, `skipped 0`, and its exit file contains `0`. The typecheck exit file contains `0`. The [P1-T07 fixture record](../docs/verification/2026-09-05-agent-fixture.md) records the persistent synthetic result. Real-agent acceptance remains open.

[VERIFIED, current registry and clock result, 2026-09-05] The registry fixture preserves the historical four-asset RPC capture. Live assessment time is captured after collection. See the [registry and clock record](../docs/verification/2026-09-05-registry-and-clock.md).

[VERIFIED, current agent preparation, 2026-09-05] D1 selects the Codex CLI adapter for CHK-26 preparation. The contract and [fixture record](../docs/verification/2026-09-05-agent-fixture.md) contain structural outputs, but no real agent run. Root only orchestrates and reports. Luna agents implement and measure.

[VERIFIED, root baseline] P0 is implemented. The baseline test result is `tests 28`, `pass 28`, `fail 0`. Typecheck exited `0`. One live scan captured four valid quotes. Later watch probes recorded source failures. See [build evidence](../status.md#current-build).

[VERIFIED, parallel implementation result] P1-T02 collector tests and P1-T03 CLI tests ran locally. The intermediate combined result is `tests 32`, `pass 32`, `fail 0`; it predates the vault-agent changes and is historical evidence. P1-T03 is complete with its CHK-07 evidence. P1-T02 has scoped evidence, while the default-context cause remains not determined. P1-T04 remains open for the Obsidian desktop check.

[REPORTED, collector_luna final integration report, 2026-09-05] After source and vault writes stopped, the report states that typecheck exited `0`, the full suite returned `tests 36`, `pass 36`, `fail 0`, `cancelled 0`, `skipped 0`, and the targeted CLI run returned `tests 6`, `pass 6`, `fail 0`, `cancelled 0`, `skipped 0`. Root has not independently rerun this final report. The report also records a synthetic demo record and no live API call.

[REPORTED, root indexed review] The plan inventory contains 30 task IDs, 31 check IDs, 45 valid local links, and no undefined IDs. This inventory is a coordination result, not a phase-pass claim.

[VERIFIED, correction, 2026-09-05] The earlier position paragraphs preserve intermediate 32-test and reported 36-test baselines. The prior local suite is 40/40. The saved final source/test evidence is 59/59 with exit `0`. CHK-05 and CHK-06 have bounded acceptance evidence. CHK-08 still has an open desktop item. The approved escalated ten-cycle watch completes CHK-09; the historical `use_default` failure remains separate. CP1A is not closed while the desktop item remains open.

[INFERRED, MVP boundary] The first usable MVP ends with a Solana and Base collector, one cited thesis from the selected existing agent, one paper-cycle outcome, and one review view that links the candidate, evidence, thesis, and outcome. Broader strategies and a third chain remain later work. [SUPERSEDED, 2026-09-20; further superseded 2026-10-04] Owner-signed Devnet wallet actions are now on the MVP path (SPEC §C:16, §C:45). Pooled client capital and mainnet trading remain out of scope.

## Phase index

[INFERRED, navigation] Each row links a phase to its tasks and acceptance checks.

| Phase | Tasks | Checks |
| --- | --- | --- |
| P0: Prototype baseline | [Completed tasks](tasks.md#p0-existing-prototype) | [Current checks](checks.md#current-checks) |
| P1: Collector and agent | [Collector](tasks.md#p1a-accept-the-evidence-collector), [agent](tasks.md#p1b-one-existing-agent-uses-graph-evidence) | [Collector acceptance](checks.md#p1a-collector-acceptance), [agent acceptance](checks.md#p1b-agent-and-graph-acceptance) |
| P2: Paper cycle | [SUPERSEDED, 2026-09-20; historical links] [Paper tasks](tasks.md#p2-capital-aware-paper-cycle) | [Paper acceptance](checks.md#p2-paper-acceptance) Replaced by I18 yield simulation (plans/roadmap.md treasury sections). |
| P3: Approved live cycle | [SUPERSEDED, 2026-09-20; not a FalconOS phase] [Live tasks](tasks.md#p3-one-approved-live-cycle) | [Live acceptance](checks.md#p3-live-acceptance) Devnet execution path is now in SPEC §C:16 and I13/I19. |
| P4: Third chain and strategies | [Extension tasks](tasks.md#p4-a-third-chain-and-wider-strategies) | [Breadth acceptance](checks.md#p4-breadth-acceptance) |
| P5: Product and submission | [Design and demo](tasks.md#p5-product-design-and-hackathon-package) | [Demo acceptance](checks.md#p5-design-and-demonstration-acceptance) |

[INFERRED, navigation] Parallel work: [customer and event tasks](tasks.md#parallel-validation-and-event-work), [customer acceptance](checks.md#customer-evidence), and [preparation checks](checks.md#preparation-checks).

## Status rules

[INFERRED, workflow] `Done` requires a completed task and linked evidence. `Ready` means its dependencies allow work. `Waiting` means a decision, approval, or earlier check is missing. `Planned` means it belongs to a later phase. A checked box records only that task's result.

[INFERRED, workflow] Each checkpoint has an explicit pass condition in the roadmap. Missing, skipped, or unrecorded checks keep the checkpoint open. Passing software tests cannot substitute for a market result or customer commitment.

## Least confident decisions

1. [INFERRED] The first useful customer path is a cited agent thesis followed by a paper cycle.
2. [INFERRED] The proposed case counts and operating checks are enough for a hackathon prototype. They do not establish production reliability.
