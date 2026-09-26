# Treasury MVP implementation plan

[VERIFIED, user direction, 2026-09-26] Build the local loop first. Preserve the accepted [visual pitch](../docs/pitches/falcon-stages.html). The user also requested a future cloud path for external testers.

## Ordered slices

| Task | Owner | Status | Deliverable and exit criterion |
| --- | --- | --- | --- |
| T34 | coordinator | Completed | Indexed product design, root spec amendment, module contract, four ADRs, and this plan. Local links resolve; current direction is explicit. |
| T35 | implementer | Planned | Complete local setup → graph → decision → settlement → saved outcome → UI. Depends on I14. All balances remain explicitly simulated. |
| T36 | reviewer | Planned | Domain and storage checks, deliberate negative controls, existing web suite, static build, browser workflow, and saved evidence. Depends on T35. |
| T37 | integration implementer | Planned | One protocol round trip with synthetic funds on a selected test environment. Verify exact reserve, receipts, redemption, and reconciliation. Depends on T36. |
| T38 | release | Planned | Shareable HTTPS simulation candidate on Pages. Verify actual deployment target, browser isolation, and replay. Publication is a separate user action. Depends on T36. |

[INFERRED, later task T39] Prove restricted authority and server reconciliation before funded automation. This task depends on the lending proof and a reviewed launch scope. Several venues, cross-chain movement, and brokerage remain later product stages.

## Current parallel work

[INFERRED, ownership] The coordinator owns documentation, `store.mjs`, storage tests, and the Vite entry. The domain implementer owns `domain.mjs` and domain tests. The UI implementer owns `index.html`, `style.css`, and `app.mjs`. Shared contracts change only through the coordinator. [Status](../status.md#active-treasury-work-2026-09-26) records live task state.

## Local verification sequence

1. [INFERRED] Run focused treasury tests. Demonstrate that a disabled guard makes a collected test fail, then restore it.
2. [INFERRED] Run the web suite and static build. Verify all existing entry routes remain in the artifact.
3. [INFERRED] In a fresh browser, create the run, supply, block an illiquid redemption, restore liquidity, and redeem as owner.
4. [INFERRED] Reload and export the run. Test another tab, malformed saved data, mobile layout, and keyboard controls.

[INFERRED, scope] Run `node --test web/test/treasury-*.test.mjs` and `npm --prefix web test`. The standalone treasury module does not import the Rust engine or root plugin. Their tests are not evidence for this new UI path.

## Protocol proof after the local loop

[REPORTED, integration research] [Kamino program addresses](https://kamino.com/docs/build/resources/program-addresses) document a Devnet program, but a usable Devnet USDC reserve was not established. [Surfpool](https://solana.com/docs/tools/surfpool) documents local forks and synthetic account state. Compatibility still requires an executed proof.

[INFERRED, next implementation gate] Inspect one exact native-USDC reserve before choosing direct cToken or supply-only obligation instructions. Reject receipt diversion, unexpected instructions, and mismatched token accounts. Record before/after balances and confirmed transaction state. Swig permission tests follow the owner-signed proof.

## Hackathon and cloud milestones

[VERIFIED, official event rules read in this session] [Crypto World's Fair §5](https://colosseum.com/legal/Crypto%20World%27s%20Fair%20Hackathon%20Rules.pdf) ends October 12, 2026, at 23:59 Pacific. [The FAQ](https://colosseum.com/hackathon) requires prior-work disclosure and judges work within the contest period.

[INFERRED, proposed schedule] Finish the local slice first. Use the next focused work period for the protocol proof. Target October 8 through 11 for user feedback, presentation, demo, and submission material. If protocol work remains incomplete, show its boundary plainly. These dates are planning targets, not delivery evidence.

[INFERRED, hosting sequence] Follow [ADR 0004](../docs/adrs/0004-cloud-deployment.md): Pages for a public simulation link; a service and Postgres only when server state or continuous execution is needed.

## Least confident decisions

1. [INFERRED] A suitable lending test environment may take longer than the local user flow.
2. [INFERRED] Restricted authority may not fit the hackathon window. Owner-signed proof remains a useful separate milestone.
3. [INFERRED] Early users may need simpler controls or a different reserve model. Record that feedback before broadening the strategy.
