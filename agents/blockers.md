# FalconOS launch blockers

Internal owner-action register · as of 2026-11-04

These records track the owner decisions and work that remain open for a consumer launch or funded financial acceptance. A prior production smoke supports only a narrow public fixed-graph read. The current server is reported to advertise 30 tools [REPORTED], and its OMP entry is not a read-only allowlist. No account, provider terms, deployment, publication, paid call, signature, or transfer was changed for this register.

Evidence-history note: `status.md#unfunded-production-trace-accepted-2026-10-28` records the accepted unfunded trace and supersedes the earlier "no CFO records" wording in `status.md#backend-only-production-rollout-2026-10-28`. Treat the latter section as historical for guide-version and dependency notes, not as a current runtime check.


## BL-01: R5 consumer integration and acceptance

Status: Closed for local R5/source acceptance. Consumer deployment and funded launch remain Blocked.

Owners: `ProductDesign` (dashboard view and CSS), `SeniorEngineer` (CFO consumer), `JuniorChecks` (owner-browser smoke), `RedTeamChecks` (behavior/security cases), `Orchestrator` (backend metadata, integration, all gates).

Evidence: [VERIFIED, parent] Helpers14/14 and production-built owner browser32/32 passed. A private enabled-sign mutation failed its intended V216 check24/25. Native keyboard copy, mobile width and scoped axe checks passed in the observed states. All workflows passed exact consumer head3c01355. Full commands, links and limitations: [`status.md#r5-consumer-acceptance-2026-11-04`; `SPEC.md T99, V214-V216`].

Next owner action: Review drafts127 and128. Separately approve the backend-template/origin rollout and user-managed UI release if desired. Keep provider/model/financial gates closed until their own exit evidence is accepted.

Exit evidence: [VERIFIED, parent] Local/source acceptance is recorded in `status.md#r5-consumer-acceptance-2026-11-04`. Controlled financial fixtures prove consumer transitions, not funded/provider/model acceptance. This closes BL-01 only.

## BL-02: Provider retention, terms, account, and keys

Status: Blocked

Owner: `Coordinator / project owner` (provider relationship and account holder).

Evidence: The approved R1 contract records the 1Click Terms §4.1(e) 24-hour API-data retention limit, except static end-user transaction history, while R1 retains unused quote snapshots indefinitely. A written exception or approved retention revision is required before provider access. The last recorded production configuration (2026-10-28) had provider requests disabled and partner/sender keys absent; this is historical, not a current configuration readback. [`docs/interfaces.md#owner-approved-near-ai-cfo-r1-2026-10-26`; `status.md#backend-only-production-rollout-2026-10-28`]

Next owner action: Review the applicable provider terms and data-use/retention requirements; obtain a written exception or approve a compatible retention design; resolve provider inference permission; then, only with owner authorization, create/configure the required provider account and keys.

Exit evidence: Owner-approved terms/retention decision plus verified provider account/configuration state. Do not store credentials or private account details in this register.

## BL-03: Actual bound Lead/Risk pair and call budget

Status: Blocked

Owners: `Coordinator / project owner` (provider and finite budget approval); `Orchestrator` (bound-run evidence).

Evidence: The last recorded production configuration had providers disabled and zero review owners [VERIFIED at the 2026-10-28 boundary; historical only]. The approved contract distinguishes native SDK/preflight proof from an actual bound Lead/Risk pair, keeps provider activation and the model budget separate, and leaves production financial, model, and provider grants default-closed. [`status.md#backend-only-production-rollout-2026-10-28`; `docs/interfaces.md#owner-approved-near-ai-cfo-r1-2026-10-26`; `SPEC.md I22, V199, T96`]

Next owner action: Obtain fresh explicit owner approval for a finite model-call budget and any provider activation. After provider terms/keys are resolved, the Orchestrator must retain one completed job with accepted Lead and independent Risk results bound to the same request/run and snapshot hash. Do not treat separate diagnostic outputs, native preflight, or a Risk `NO_DATA` diagnostic as the required pair.

Exit evidence: Owner approval and the exact retained result proving both roles accepted against the same snapshot, with the job and relevant hashes recorded. No model call is authorized by this blocker record.

## BL-04: T82 and capped funded NEAR acceptance

Status: Blocked

Owners: `Coordinator / project owner` (financial approval and any funded account); `Orchestrator` (acceptance evidence).

Evidence: T82 remains Planned pending separately owner-approved Devnet supply and receipt-token redemption, exact signatures, confirmed receipts, and independent Explorer proof. NEAR Intents has no testnet, and funded acceptance remains a separate owner gate. The R1 CFO launch gate separately requires T82 and an exact capped NEAR trial. [`SPEC.md T82, V180, T96, I22`]

Next owner action: Keep the proofs distinct. First request and obtain explicit approval for T82's capped Devnet supply/redemption round trip and record exact signatures, token changes, confirmed receipts, and Explorer evidence. Separately, only after all prerequisites, request an explicit exact-cap NEAR mainnet trial approval and perform its defined acceptance. No funds, keys, signatures, broadcasts, or trial grants are authorized here.

Exit evidence: T82 evidence and the separately approved capped NEAR trial record, each independently reconciled and accepted by the Orchestrator. Do not label T82 itself as NEAR acceptance.

## BL-05: Public guide and human UI publication

Status: Blocked

Owners: `Coordinator / project owner` (publication decision and Cloudflare); `ProductDesign` (local UI artifact).

Evidence: The coordinator reports that the current production dashboard still returns Soon [REPORTED, current read-only production observation]. R5 code approval does not authorize frontend deployment. [`SPEC.md T86`; `docs/interfaces.md#cfo-consumer-r5-contract`] A separate current read-only SSH report says `FALCON_MESH_ORIGINS` includes `https://agents.falconos.markets`, `https://falcon-agents.pages.dev`, `https://mcp.falconos.markets`, and the Railway MCP hostname, but excludes `https://falconos.markets`. [REPORTED, coordinator, current read-only production SSH]

Next owner action: Keep the dashboard gated. Separately approve and verify the backend candidate that supplies R5 template metadata. For a main-host UI build, use the verified HTTPS API base `VITE_MESH_API_URL=https://api.falconos.markets` and approve adding `https://falconos.markets` to `FALCON_MESH_ORIGINS` while preserving every current origin. Verify the production readback. Separately approve frontend/guide publication; Cloudflare remains owner-managed. R5 code approval alone does not authorize configuration changes or deployment.

Exit evidence: Explicit owner decision, identified published artifact/version, and owner-observed live route/guide result. A local build or draft is not publication proof.

## BL-06: Mesh dependency reachability and major-upgrade risk

Status: Blocked

Owners: `SeniorEngineer` (dependency and compatibility assessment); `Orchestrator` (release decision).

Evidence: The parent reports a current locked Mesh npm audit with 4 moderate, 0 high, and 0 critical findings. Reported ancestry is `@solana/web3.js` 1.98.4 through `jayson` to `stream-json` and `uuid`. Reported advisory identities are GHSA-528h-pc64-c93x (`stream-json` nested-filter quadratic behavior through 3.4.0), GHSA-hqr4-qq8f-hg3x (JSONC chunk/comment rescans through 3.5.0), GHSA-mjw6-4jj6-33hc (Assembler prototype pollution before 3.6.0), and GHSA-w5hq-g745-h8pq (`uuid` optional output-buffer bounds in v3, v5, and v6 before 11.1.1). `@solana/web3.js` 3.1.1 is a reported major-upgrade candidate; no upgrade is authorized. [REPORTED, parent current locked Mesh audit. Static package/source paths can be verified separately; exploitability remains INFERRED unless established.]

Next owner action: Trace the reported advisories through the locked Mesh dependency graph and shipped runtime paths; document reachability and impact. Separately assess the compatibility cost of the major `@solana/web3.js` candidate. Recommend no change or a narrowly scoped, reviewed fix; do not upgrade or change the lockfile as part of this documentation task.

Exit evidence: A reviewed, source-linked reachability/impact assessment and an explicit release decision. Any proposed dependency change needs its own approved implementation and verification.

## BL-07: Native MCP client connection

Status: Blocked

Owner: `Coordinator / client owner`.

Evidence: The selected client is OMP 18.12.5, and the current native command has not been run. OMP source `#handleWizardComplete` writes the active-profile user MCP entry, then performs a global MCP reload and activates discovered tools; reload can briefly reconnect Cloudflare, Vercel, and REA. Export active REA evidence first. The endpoint is reported to advertise all 30 tools [REPORTED]; its OMP entry is not a read-only allowlist. A helper SDK call does not prove that native OMP tools are mounted. Codex and other clients are optional examples, not blockers for this session. [OMP 18.12.5 source `#handleWizardComplete`; OMP MCP configuration docs, "Profiles"; OMP runtime lifecycle docs, "Interactive reload and live-change paths"; `mcp-rust/README.md#install`]

Next owner action: Export any active REA evidence before making the change. In this OMP session, run `/mcp add falconos --scope user --url https://mcp.falconos.markets/mcp --transport http`. This writes the server entry at the active profile's user scope and triggers a global MCP reload; it can briefly reconnect Cloudflare, Vercel, and REA. No client restart is required. Then use `/mcp list` and invoke `falcon_self_test({})` and `falcon_public_graph({})` through OMP's mounted native tools. Use the graph call for the public read. These initial public-research calls grant no wallet, model, or funds authority. The advertised 30-tool server is not restricted by this configuration to read-only tools.

Exit evidence: Owner-observed `/mcp list` output showing the active-profile server and its tools, plus a `falcon_public_graph({})` response produced through a mounted native OMP tool. Record the version and returned status; do not infer that every advertised tool is usable or read-only. `falcon_self_test` is metadata-only and does not probe Mesh or wallets. No restart, provider/model readiness, wallet readiness, or funds authority is claimed. [`mcp-rust/README.md#public-graph-contract`; `mcp-rust/README.md`, "Capability discovery (0.7.0 source)"]

## BLK-2026-11-09-01: Web verification fixture job bound

Date: 2026-11-09. Owner: release. Severity: Medium. Status: Resolved at recorded backend4f8d312/UI6593e49 code heads; retain future runtime monitoring.

[VERIFIED] At head9017d24, main CI run42560507646 passed. Verify web run42560507535 was cancelled during release-boundary cases after web tests reported `tests340,pass340,fail0`. The workflow declares `timeout-minutes:20`; its log reaches cancellation at04:32:42 after setup at04:12:31. The completed website fixture cases each took about72-78seconds. `scripts/test/release-boundaries.test.mjs:24-40` privately copies the full web dependency tree for each website fixture. The expanded SDK tree therefore increases repeated fixture work; exact copy-versus-build attribution is not yet measured.

[VERIFIED CORRECTION, 2026-11-09] The earlier cancellation remains real, but it is not a current all-green blocker. At exact owner-proof head ad1b40db387ab5eba64ab6741a9307a25bb8ba4e, PR CI run42565008706, push CI run42564856794 and Verify web run42565008689 all returned `SUCCESS`; all five reported checks passed. No test, guard, dependency isolation rule or workflow timeout was weakened. This does not prove stable timing under every runner load. A fixture-cost change still needs measurement and separate review.

Evidence: https://github.com/Sarthib7/FalconOS/actions/runs/42560507535 ; https://github.com/Sarthib7/FalconOS/actions/runs/42560507646 ; `.github/workflows/verify-web.yml:19,44-45`; `scripts/test/release-boundaries.test.mjs:24-40`.

Current-head evidence: https://github.com/Sarthib7/FalconOS/pull/138 ; https://github.com/Sarthib7/FalconOS/actions/runs/42565008706 ; https://github.com/Sarthib7/FalconOS/actions/runs/42564856794 ; https://github.com/Sarthib7/FalconOS/actions/runs/42565008689 .

[VERIFIED NEW-HEAD CORRECTION] The earlier resolution applied only to ad1b40d, not a permanent fixture-cost fix. At backend head96db98eaf5a0c3e2addc6456dbbe1fba9f74c64e, PR CI42583292766 passed both jobs. Separate Verify web42583292652 passed345 web cases, then cancelled at its20-minute bound after repeated private website fixtures took about71-76seconds each. The final completed fixture logged08:24:03 and cancellation08:24:16. Preserve every guard and private copy. A fixture-cost change or job-budget change needs separate approval; no limit was raised.

Evidence: https://github.com/Sarthib7/FalconOS/actions/runs/42583292766 ; https://github.com/Sarthib7/FalconOS/actions/runs/42583292652/job/129046949320 .

[VERIFIED APPROVAL AND REMEDIATION] Backend attempt two also reached the original bound after345 web cases passed. UI code head0658400 completed all five checks, including the unchanged web job in14m12s, so timing varies by inspected surface/run. The user selected `Approve 35-minute job budget`. Only the outer Verify web limit changes to35; private copy semantics, assertions, runtime pins and per-operation deadlines remain. This is not a copy-speed claim or a pass guarantee. Fresh checks must complete at both affected draft heads. The earlier cancellations remain part of the record.

[VERIFIED RESOLUTION] With the approved35-minute outer limit, backend Verify web42595022920 and UI Verify web42595917010 completed SUCCESS at4f8d31230fd3c062a05458e241fa62017a124aa4 and6593e49724872f378dd9e1a816d3eaf9172e9f05. All five checks passed on each code head. No private copy, assertion, runtime pin or per-operation deadline changed. This resolves the inspected CI gate, not a measured copy bottleneck or a worst-case runtime guarantee. Any later record-only PR head must pass its own checks before merge.

Evidence: https://github.com/Sarthib7/FalconOS/actions/runs/42595022920 ; https://github.com/Sarthib7/FalconOS/actions/runs/42595917010 ; draft PRs139 and140.

## BLK-2026-11-09-02: Signed-action liveness before a funded pilot

Date: 2026-11-09. Owner: architect/release. Severity: Medium. Status: Blocked pending an approved recovery policy.

[VERIFIED SOURCE] `mesh/cfo/lending-bot.mjs:438-453` retains exact signed bytes and SUBMISSION_UNKNOWN before adapter submit, including typed refusals before RPC send. Signed records cannot use unsigned expiry retirement (`:290-297`). The SDK leaves absent finalized receipts UNVERIFIED after expiry. These guards prevent an unproved replacement but can keep the Falcon action slot reserved.

[REPORTED INDEPENDENT REVIEW] A pre-send account/height refusal can therefore strand a signed action when no complete finality/history proof becomes available. This is an operational liveness finding, not observed loss of custody or live funds. The owner already held signed bytes; Falcon not sending is not proof of chain non-execution.

Required decision: define an exact-byte retry/history policy before funded acceptance. Any retry must preserve action identity, signature and bytes. Do not release a signed reservation from expiry plus a null receipt. No new retry, replacement authority or live financial action is implemented by this record.
