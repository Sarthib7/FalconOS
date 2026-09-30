# Falcon documentation index

[VERIFIED, repository inspection, 2026-09-27] Start with [current status](../status.md), this component map, and the contract for the component you will change. [SPEC.md](../SPEC.md) remains the specification. This map describes existing code and records known documentation drift. It does not replace product contracts or authorize a release.

## Component map

[INFERRED, review ownership] These roles identify the expertise needed for a change. The coordinator assigns a named task owner in [status](../status.md). A review role grants no access to credentials, capital, or deployment.

| Component and review role | Input and output | Authority and storage | Runtime and source evidence |
| --- | --- | --- | --- |
| Web experiences and signup. UI implementer; domain reviewer for simulation rules. | [VERIFIED] React renders retained samples and simulation commands. Signup accepts an email and returns a registration result. | [VERIFIED] Simulation records use browser storage. Signup uses local SQLite or hosted D1. It creates no account session. | [VERIFIED] Vite builds Cloudflare Pages routes. [Dashboard imports](../web/dashboard/App.jsx#L1), [separate store key](../web/dashboard/store.mjs#L3), [treasury rules](../web/treasury/domain.mjs#L1), [signup handler](../web/functions/api/waitlist.js). |
| Browser execution. Wallet implementer; finance reviewer for amounts and transaction checks. | [VERIFIED] `/mesh/` signs a prepared lending intent; `/app/` builds a separate Raydium Devnet swap. Both inspect the signed message before sending. | [VERIFIED] The connected wallet signs after user action. The browser broadcasts. Mesh registration retains signed bytes; `/app/` keeps its order journal in browser storage. | [VERIFIED] [Lending terminal](../web/mesh/terminal.mjs#L148), [Wallet Standard checks](../web/mesh/wallet.mjs#L30), [separate swap path](../web/app/app.mjs#L506), [local-only copilot routing](../web/vite.config.js#L6). |
| Knowledge mesh API. Storage and connector implementers; domain reviewer for evidence rules. | [VERIFIED] Fixed connectors or synthetic sources produce source revisions. Deterministic traversal produces retained analyses. Lending preparation produces an unsigned intent. | [VERIFIED] Hashed tokens select the owner before access. PostgreSQL retains sources, analyses, intents, and events. The API verifies and registers signed bytes; its submit endpoint does not broadcast. | [VERIFIED] Node service in [server.mjs](../mesh/server.mjs#L1), [HTTP ownership](../mesh/http.mjs#L98), [store](../mesh/store.mjs#L189), [registration](../mesh/lending-store.mjs#L199). Railway is the planned API host; see deployment state below. |
| TypeScript research and advisory. Domain implementer; AI reviewer for host transport and evidence validation. | [VERIFIED] Quote collection produces scans and vault notes. The plugin accepts evidence and returns a validated advisory or error. Perps and stocks use separate canonical snapshot contracts. | [VERIFIED] The plugin remains read-only and advisory-only. Host configuration selects transport. A model response cannot authorize execution. Council audit records are in memory; durable council storage remains outside those modules. | [VERIFIED] [CLI](../src/cli.ts), [plugin](../src/plugin.ts#L226), [thesis validation](../src/agent.ts#L518), [internal Codex adapter](../src/codex.ts#L203), [perps](../perps/perps.ts), [stocks](../stocks/stocks.ts). |
| Rust stocks engine. Engine implementer; finance reviewer for scaling, evidence, and veto rules. | [VERIFIED] Public market and RPC reads produce an engine snapshot, deterministic council result, graph, and local HTTP views. | [VERIFIED] Output remains advisory-only with `execution_ready: false`. The engine has no wallet signer. Its snapshot type is separate from the TypeScript stocks snapshot. | [VERIFIED] [Engine commands](../engine/src/main.rs#L33), [council](../engine/src/council.rs#L107), [local server](../engine/src/serve.rs#L620), [engine guide](../engine/README.md). |

[VERIFIED, source: `mesh/domain.mjs:194`, `mesh/live.mjs:388`, `mesh/live.mjs:427`] The current mesh analysis is deterministic. Its live result `OBSERVED` links a document claim to an executable Devnet program account. It does not assess lending usability or wallet ownership. General LLM research, semantic retrieval, and automatic financial authority are not established by this result.

[VERIFIED, source: `mesh/scenario.mjs`, `mesh/store.mjs`, `web/dashboard/Operate.jsx`] The additive `#operate` view binds a retained live reserve snapshot to owner-entered scenario limits. It saves `REVIEW`, `BLOCKED` or `NO_DATA` with a provenance-labelled decision graph. The older synthetic treasury Decisions view remains separate, and neither route authorizes a wallet transaction.

[VERIFIED, source: `web/dashboard/App.jsx:3`, `web/dashboard/store.mjs:3`, `web/mesh/wallet.mjs:30`, `web/app/app.mjs:247`] The Control Centre reuses treasury simulation rules with a separate storage key. Its samples are not mesh API results. Wallet Standard discovery belongs to the mesh terminal. The separate `/app/` uses an injected provider and message-signing flow. Browser fixture tests do not prove every wallet works.

## Contracts and tests by component

| Component | Contract and source of truth | Focused evidence and tests |
| --- | --- | --- |
| Web experiences and signup | [VERIFIED] [Control Centre](control-centre.md), [decision graph](decision-graph.md), [treasury](treasury-contract.md), [landing email](landing-email.md). | [VERIFIED] [Web tests](../web/test/), [dashboard proof](verification/2026-09-27-dashboard.md), [signup release](verification/2026-09-27-cloudflare-email.md). |
| Browser execution | [VERIFIED] [Mesh Devnet terminal](knowledge-mesh.md#devnet-terminal-contract); [separate production app](interfaces.md#production-devnet-app-browser-boundary); SPEC I12/I13 and V101-V103. | [VERIFIED] [Wallet tests](../web/test/mesh-wallet.test.mjs), [swap tests](../web/test/app-execution.test.mjs), [mesh browser harness](../web/test/mesh-browser.mjs). |
| Mesh API and persistence | [VERIFIED] [I15 mesh contract](knowledge-mesh.md), [schema](../mesh/schema.sql), [lending migration](../mesh/migrations/0002_lending.sql), [Supabase setup](supabase-setup.md). | [VERIFIED] [Mesh tests](../mesh/test/), [local MVP proof](verification/2026-09-27-mvp.md), [database proof](verification/2026-09-27-supabase.md). |
| TypeScript advisory | [VERIFIED] SPEC I1-I8/I10; [interface record](interfaces.md); validators in the named source modules above. | [VERIFIED] [Plugin and host tests](../test/), [stablecoin tests](../stablecoins/test/), [perps tests](../perps/test/), [stocks tests](../stocks/test/). |
| Rust engine | [VERIFIED] SPEC I11 and V64-V74; [stocks response](interfaces.md#local-stocks-dashboard-response); engine types and validators. | [VERIFIED] Unit tests live beside Rust source; [parity test](../engine/tests/parity.rs) covers cross-language fixtures. |

## Deployment state and shared source

[VERIFIED, inspected release record] Production website commit `9af809b` is recorded in the [signup UI release](verification/2026-09-27-cloudflare-email.md#ui-completion-release). Hosted signup returned `201 registered`, then `200 already_registered`. D1 has only the reviewed `0001` migration applied. Confirmation delivery is unconfigured. Signup is separate from browser wallet sign-in and mesh bearer-token access.

[VERIFIED, inspected database record] The [Supabase verification](verification/2026-09-27-supabase.md#hosted-application-after-approval) records the five-table schema and restricted `NOLOGIN` application role. Railway remains the selected API host. Exact runtime connectivity is pending in [status](../status.md#supabase-connection-2026-09-27). Database catalog checks do not prove an API login, TLS connection, or hosted service.

[VERIFIED, local Git inspection, 2026-09-27] At review, `HEAD` was `2ddd2f6` and `origin/main` was `9af809b`. `git ls-tree -r --name-only origin/main mesh` returned only `mesh/domain.mjs`, `mesh/fixtures.mjs`, and `mesh/kamino-wire.mjs`. That website release does not contain the complete API. This is a dated checkout measurement, not a live remote query.

[VERIFIED, source: `web/mesh/app.mjs:1`, `web/mesh/terminal.mjs:1`, `web/test/dashboard.test.mjs:9`] Website code imports the mesh fixtures and transaction wire module. Dashboard tests import the Node-only mesh domain. These files remain in their current folders. Website release checks must retain this source. An API release separately needs its complete runtime, package files, and schema history.

## Verification and release checks

[INFERRED, frozen command contract] [REPO-VERIFY-1](interfaces.md#repository-verification-contract-2026-09-27) defines the commands below. Install the separate root, web, and mesh dependencies first. Rust checks also require the toolchain and cached dependencies. Commands below are recipes; current execution results belong in [status](../status.md).

| Command from repository root | Scope and limit |
| --- | --- |
| `npm run verify:repository` | [INFERRED] Node tests under `scripts/test/` cover the verification runner and release checks. They do not establish application behavior. |
| `npm run verify:advisory` | [INFERRED] Root TypeScript typecheck and the advisory tests. It does not call a live model. |
| `npm run verify:web` | [INFERRED] Web tests and website source/build boundary checks. Browser harnesses remain separate. |
| `npm run verify:mesh` | [INFERRED] API source boundary checks, then mesh tests. Requires `FALCON_MESH_TEST_DATABASE_URL` for an initialized disposable database. Tests write fixtures. |
| `npm run verify:engine` | [INFERRED] Runs `cargo test --offline --locked --manifest-path engine/Cargo.toml`. Tests do not establish current provider data or market results. |

[INFERRED, aggregate command] `npm run verify` runs those five scopes sequentially. A scope failure stops that scope; other scopes continue. The final report names `PASS`, `FAIL`, or `BLOCKED` for every requested scope. A failure or block gives a nonzero exit. Missing mesh database configuration cannot count as passing coverage. The runner never falls back to `DATABASE_URL`, initializes a schema, or installs dependencies.

[INFERRED, database setup boundary] Follow [mesh setup](../mesh/README.md#run) with a new disposable local database. Review both SQL files before explicit initialization. Configure the test URL separately from the runtime URL. Verification never applies a migration. Hosted schema changes require their own review.

| Release command | What it checks and what remains separate |
| --- | --- |
| `npm run verify:release:web` | [INFERRED] Resolved imports in an in-memory Vite build, eight production routes, signup source/SQL, and required shared files. It rejects local copilot/terminal output. It writes no deployment artifact and does not compile the Pages Function. |
| `npm run verify:release:mesh` | [INFERRED] Declared runtime, package files, deployment configuration, and SQL history in an isolated copy. Native Node linkage must reach the expected missing-database guard. It does not start the listener, prove dynamic imports, build Docker, or test hosted TLS. |

[INFERRED, checkout selection] Both release commands accept `-- --root <checkout>`. Use a candidate checkout with its dependencies installed. Produce the website artifact separately with `npm --prefix web run build:site`. Source checks do not replace hosted binding checks or approval to publish.

[VERIFIED, browser harness source] Browser checks are separate: `node web/test/landing-browser.mjs`, `npm --prefix web run test:dashboard:browser`, `node web/test/treasury-browser.mjs`, and `node web/test/mesh-browser.mjs`. Configure Brave through the executable variables in [mesh verification instructions](../mesh/README.md#preview-and-verification). Build the matching site or mesh artifact first. Mesh browser checks need disposable PostgreSQL and free port 8791. Controlled wallet and provider responses do not prove a real wallet transaction or inbox delivery.

[VERIFIED, source: `web/test/landing-browser.mjs:15`, `web/test/dashboard-browser.mjs:13`] The design comparison harnesses also need the original OpenDesign files outside this repository. Set `FALCON_LANDING_SOURCE` to `falconos-landing.html` and `FALCON_DASHBOARD_SOURCE` to its project directory on another machine. Both use `CHROME_BIN`; treasury and mesh use `FALCON_CHROME_BIN`. Missing originals prevent the design comparison and are not replaced by repository fixtures.

## Known documentation drift

[VERIFIED, source comparison, 2026-09-27] Earlier sections remain accessible below. The following conflicts remain in SPEC; this task does not edit or silently reconcile them. Later cited records document the implemented state. Contract reconciliation still requires the specification workflow.

| Earlier statement | Current evidence and remaining correction |
| --- | --- |
| SPEC I9/V49 says signup sends and stores nothing; I9 excludes D1. | [VERIFIED] V105/V106 define durable signup and optional delivery. The [hosted proof](verification/2026-09-27-cloudflare-email.md#hosted-registration-and-cleanup) records actual persistence. The older section needs an explicit scope or supersession. |
| SPEC I9/V55 specifies the earlier static HTML visual treatment. | [VERIFIED] V104/V107 cover the React landing and Control Centre. [Release evidence](verification/2026-09-27-live.md) identifies the new design. The older visual scope remains unresolved in SPEC. |
| SPEC I7/I8 names `preps/`. | [VERIFIED] Current source and tests are under `perps/`; [interfaces](interfaces.md#falcon-investment-perps-council-first-local-vertical-slice) records the rename. Historical commands remain evidence of their original runs. |
| SPEC I15 describes only a synthetic foundation. | [VERIFIED] V99-V103 and the [mesh extension contract](knowledge-mesh.md#live-capture-extension) cover live captures and manual Devnet lending. The interface summary needs reconciliation. A user-wallet lending round trip remains unverified. |

## Earlier treasury entrypoint and evidence

[VERIFIED, correction to this index] The earlier opening below described local-only work. The deployment and signup records above supersede that state. The original test counts remain dated evidence; they do not describe this checkout's current test coverage.

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
| [0005: Investment manager destination](adrs/0005-investment-manager.md) | [VERIFIED, user choice, 2026-09-30] FalconOS destination is an investment manager with a deal desk. Current code stays advisory until SPEC and implementation change. |
| [0006: One agent, one engine](adrs/0006-one-agent-decision-engine.md) | [VERIFIED, user direction] One Customer Agent, one Decision Engine, plugin for other agents. |
| [0007: Global discovery and alerts](adrs/0007-global-discovery-alerts.md) | [VERIFIED, user direction] Global search, residency as eligibility, verified opt-in alerts. |


## Current state and earlier records

[VERIFIED, index correction] The earlier status link opened only the September 26 treasury entry. [Status](../status.md) opens the current work first. [Context](../CONTEXT.md) records product direction. [Interfaces](interfaces.md) indexes the treasury and earlier APIs. [Decision history](decisions.md) retains earlier choices. [Earlier plans](../plans/README.md) retain prior milestones. [Pitch review](pitches/review.md) records visual and event research checks.

[VERIFIED, local evidence] The [treasury verification record](verification/2026-09-26-treasury.md) includes exact test results and their limits. The [PR plan](../plans/treasury-prs.md) separates documentation from four working feature slices.

## Least confident decisions

1. [INFERRED] Review roles above still need task owners assigned for each change. Folder names alone cannot enforce authority.
2. [NOT DETERMINED] Hosted API login, TLS, and recovery remain unverified. Passing source checks cannot close those items.

[VERIFIED, retained earlier design questions] The original treasury index ended with these open decisions:

1. [INFERRED] The local slice may expose product changes before the protocol adapter is ready. Update the contract before those changes enter code.
2. [INFERRED] Cloud service selection should be revisited when actual workload and operational costs are measured.
