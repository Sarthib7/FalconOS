# Treasury MVP implementation plan

[VERIFIED, user direction, 2026-09-26] Build the local loop first. Preserve the accepted [visual pitch](../docs/pitches/falcon-stages.html). The user also requested a future cloud path for external testers.

## Ordered slices

[VERIFIED, correction, 2026-09-27] The user placed decision graphs, hosting, screen design, and the full review flow before execution. Earlier T35/T36 completion covers only the local simulation. The user approved work on this revised order.

| Phase | Owner | Status | Exit criterion |
| --- | --- | --- | --- |
| Decision graph prototype, T41 | coordinator | Completed | [VERIFIED] Saved records and rule inspection. Web `110/110`, browser `43/43`, graph build exit `0`. [Evidence](../docs/verification/2026-09-27-graphs.md). |
| Public graph access, T38 | release | Planned | Verify the Cloudflare Pages target and publish the tested prototype after release approval. |
| Devnet execution, T37 | integration implementer | Planned | Verify a usable lending reserve, then prove supply and redemption with confirmed balances and failures. Depends on graph acceptance. |
| Restricted authority and later real-fund test, T39 | architect | Planned | Define permissions, test limits, reconciliation, and customer scope after Devnet evidence. |

[INFERRED, current build] Use synthetic evidence and browser-local records first. Cloudflare Pages is the static hosting candidate. Cross-device records and continuous operation need a later backend decision.

### Earlier local slice

| Task | Owner | Status | Deliverable and exit criterion |
| --- | --- | --- | --- |
| T34 | coordinator | Completed locally | Indexed product design, root spec amendment, module contract, four ADRs, and this plan. Local links resolve; current direction is explicit. |
| T35 | implementer | Completed locally | Complete local setup → graph → decision → settlement → saved outcome → UI. Depends on I14. All balances remain explicitly simulated. |
| T36 | reviewer | Completed locally | Domain and storage checks, deliberate negative controls, existing web suite, static build, browser workflow, and saved evidence. Depends on T35. |
| T37 | integration implementer | Planned | One protocol round trip with synthetic funds on a selected test environment. Verify exact reserve, receipts, redemption, and reconciliation. Depends on T36. |
| T38 | release | Planned | Shareable HTTPS simulation candidate on Pages. Verify actual deployment target, browser isolation, and replay. Publication is a separate user action. Depends on T36. |

[INFERRED, later task T39] Prove restricted authority and server reconciliation before funded automation. This task depends on the lending proof and a reviewed launch scope. Several venues, cross-chain movement, and brokerage remain later product stages.

[VERIFIED, historical pause] The user stopped work on 2026-09-26. The user resumed graph work on 2026-09-27. The [earlier handoff](../docs/handoffs/2026-09-26-treasury.md) preserves the unfinished PR stack.

## Current parallel work

[INFERRED, ownership] The coordinator owns documentation, `store.mjs`, storage tests, and the Vite entry. The domain implementer owns `domain.mjs` and domain tests. The UI implementer owns `index.html`, `style.css`, and `app.mjs`. Shared contracts change only through the coordinator. [Status](../status.md#active-treasury-work-2026-09-26) records live task state.

## Local verification sequence

1. [INFERRED] Run focused treasury tests. Demonstrate that a disabled guard makes a collected test fail, then restore it.
2. [INFERRED] Run the web suite and static build. Verify all existing entry routes remain in the artifact.
3. [INFERRED] In a fresh browser, create the run, supply, block an illiquid redemption, restore liquidity, and redeem as owner.
4. [INFERRED] Reload and export the run. Test another tab, malformed saved data, mobile layout, and keyboard controls.

[INFERRED, scope] Run `node --test web/test/treasury-*.test.mjs` and `npm --prefix web test`. The standalone treasury module does not import the Rust engine or root plugin. Their tests are not evidence for this new UI path.

## Protocol proof after graph acceptance

[REPORTED, integration research] [Kamino program addresses](https://kamino.com/docs/build/resources/program-addresses) document a Devnet program, but a usable Devnet USDC reserve was not established. [Surfpool](https://solana.com/docs/tools/surfpool) documents local forks and synthetic account state. Compatibility still requires an executed proof.

[VERIFIED, sequence correction, 2026-09-27] The user specified Devnet for the execution phase. Earlier local-fork research remains useful but does not replace that phase.

[INFERRED, later implementation gate] After graph acceptance, verify a usable Devnet lending reserve before choosing instructions. Reject receipt diversion, unexpected instructions, and mismatched token accounts. Record before/after balances and confirmed transaction state. Swig permission tests follow the owner-signed proof.

## Hackathon and cloud milestones

[VERIFIED, official event rules read in this session] [Crypto World's Fair §5](https://colosseum.com/legal/Crypto%20World%27s%20Fair%20Hackathon%20Rules.pdf) ends October 12, 2026, at 23:59 Pacific. [The FAQ](https://colosseum.com/hackathon) requires prior-work disclosure and judges work within the contest period.

[INFERRED, proposed schedule] Finish the local slice first. Use the next focused work period for the protocol proof. Target October 8 through 11 for user feedback, presentation, demo, and submission material. If protocol work remains incomplete, show its boundary plainly. These dates are planning targets, not delivery evidence.

[INFERRED, hosting sequence] Follow [ADR 0004](../docs/adrs/0004-cloud-deployment.md): Pages for a public simulation link; a service and Postgres only when server state or continuous execution is needed.

## Least confident decisions

1. [INFERRED] A suitable lending test environment may take longer than the local user flow.
2. [INFERRED] Restricted authority may not fit the hackathon window. Owner-signed proof remains a useful separate milestone.
3. [INFERRED] Early users may need simpler controls or a different reserve model. Record that feedback before broadening the strategy.
