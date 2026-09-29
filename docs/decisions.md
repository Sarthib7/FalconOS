# Decisions

## Supabase mesh storage, 2026-09-27

[VERIFIED, DEC-2026-09-27-02] Owner: coordinator. The user provided access to Supabase project `mcmxfwkhdzzsfpvldgdw`. The user then approved the reviewed schema and restricted role with login disabled. This replaces the earlier Railway PostgreSQL choice; the personal Railway workspace remains selected for the API.

[VERIFIED, reviewed scope] Retain the existing Node API, PostgreSQL tables, and owner filtering. Apply the exact schema, lending migration, and permission candidate. The [setup record](supabase-setup.md) links the SQL and verification evidence. The earlier option was Railway PostgreSQL. No second graph database is part of this choice.

[INFERRED, consequence] Browser and store interfaces remain unchanged. The API needs separately configured runtime credentials and a verified TLS connection before hosted use.

### Least confident decisions

1. [NOT DETERMINED] The runtime endpoint and connection mode require verification from the chosen API host.
2. [NOT DETERMINED] Hosted recovery and API operating costs are not established by the schema tests.

## Local Devnet swap builder

[VERIFIED, user instruction, 2026-09-23] The user approved finishing Surfpool and Devnet execution before starting Meteora DBC work.

[VERIFIED, official Raydium demo source, read 2026-09-23] The Raydium sample exposes a Devnet swap host at `https://transaction-v1-devnet.raydium.io`. Its compute response includes `data.routePlan[].poolId`, and its transaction builder returns serialized transactions. See [the official demo](https://github.com/raydium-io/raydium-sdk-V2-demo/blob/master/src/api/swap.ts).

[VERIFIED, official program sources, read 2026-09-23] Raydium's current CPMM program source declares Devnet ID `DRaycpLY18LhpbydsBWbVJtxpNv9oXPgjRSfpF2bWpYb`. The official Raydium CPI example also lists `CPMDWBwJDtYax9qW7AyRuVC19Cc4L4Vcy4n2BHAbHkCW` as its Devnet CPMM ID. See [current CPMM source](https://github.com/raydium-io/raydium-cp-swap/blob/master/programs/cp-swap/src/lib.rs) and [Raydium CPI example](https://github.com/raydium-io/raydium-cpi-example#cpmm). The client allowlists both owners, then checks the pool-state discriminator and mint pair.

[VERIFIED, official SDK license] The Raydium SDK repository lists `GPL-3.0`. See its [license file](https://github.com/raydium-io/raydium-sdk-V2/blob/master/LICENSE).

[INFERRED, implementation choice] Use Raydium's Devnet Trade API for quote and transaction build. Require a single route whose pool ID, input mint, and output mint match the user's configured values. Require one returned transaction. This avoids adding the GPL-3.0 SDK package to this repository. Keep signing, simulation, send, and confirmation in the browser and bind those calls to the selected cluster RPC.

[INFERRED, limitation] Raydium's quote API may choose another pool. The client will reject that response. A live trade also needs a funded Devnet CPMM pool and token mints that exist on Devnet. The repository does not yet identify those accounts.

## Terminal graph follow-up

[VERIFIED, user direction, 2026-09-23] The user chose one local terminal shared by `/copilot/` and dev `/dash/`. The public `/dash/` page stays gated. The user requested separate trade, intent, and knowledge/decision graphs, animation, and live values without sample fixtures.

[VERIFIED, source read: `web/copilot/index.html:101-103,434-440,476-479`; `engine/src/graph.rs:7-27,160-202`] Current UI renders one council graph from `/graph`. The engine graph has intent and verdict nodes, but the builder does not emit wallet transaction nodes. Node layout uses fixed coordinates.

[INFERRED, least-confident decision] The next trade graph may use recent transactions for the connected wallet on the selected cluster. The user has not confirmed that data source. The last clarification offered wallet swaps or this-session ticket activity; the reply `tradegradh` confirmed the graph request, not its data source.

### Least confident decisions

1. Whether the trade graph should show wallet transaction history or ticket steps remains unconfirmed.

## Local stocks dashboard response, 2026-09-24

[VERIFIED, prior user direction] The user selected a local terminal shared by `/copilot/` and development `/dash/`, while keeping the public `/dash/` gate. See the preceding decision entry.

[INFERRED, implementation choice] Serve the live dashboard and research views through Vite development middleware. Keep `web/dash/index.html` as the production gate and leave `web/index.html` unchanged. Add one read-only engine `GET /dashboard` response that joins advice, the published proposal when present, configured policy, and per-capture provenance from one cached evaluation. Omit raw excerpts from this response.

[INFERRED, scope addition, 2026-09-24] Include a projection of the current council evidence graph. Keep node IDs, kinds, labels, and edges. Omit node details because failure details can contain raw source text.

[VERIFIED, source read, 2026-09-24] The engine response has no historical series or backtest route. The dashboard will show current council status and reasons. It will label historical backtesting unavailable. It will not calculate pass/fail rules in browser code.

### Least confident decisions

1. The user's word “tests” may mean software test status or historical strategy backtests. The first view will show council policy outcomes and mark historical backtests unavailable.
2. The trade-history graph source remains unconfirmed. This change will not read wallet history or Surfpool transactions.

## Production Devnet app entry, 2026-09-24

[VERIFIED, new user direction] The user asked for wallet login and a full product, then set the production target to Solana Devnet by tonight. This supersedes the earlier production `/dash/` gate. The root landing page remains unchanged.

[INFERRED, first implementation slice] Add a production `/app/` route for SIWS wallet proof, Devnet wallet balances and recent signatures, saved mint watchlist, saved local order history, and explicit Devnet order review. Keep `/dash/` as a launcher to the app. Keep the existing Devnet CPMM pool and route validation. Do not create a mint or pool without explicit approval.

[BOUNDARY, local session] Verify SIWS signatures in the browser and persist the proof with local portfolio and order data. This proves wallet ownership to this browser only. It does not authenticate a user to a server. The source and prior deployment checks show no configured app database or auth API. Do not present browser state as cross-device account storage.

[BOUNDARY, current research implementation] The Rust council serves localhost only. The production app has no council endpoint. `/research/` marks stock strategy templates as not implemented and not backtested. Do not let a generic Devnet swap quote imply a stock strategy signal.

### Least confident decisions

1. [INFERRED] A browser-local signed session and storage can ship as the first usable app slice. The user's earlier request may imply cross-device server persistence, which still needs a production database and server verification.
2. [INFERRED] Users can provide a funded, verified Devnet CPMM pool and test-token pair. No production pool is configured in the repository.

## Live Devnet quote compatibility check, 2026-09-24

[VERIFIED, official Raydium API sample, read 2026-09-24] The official SDK demo defines `routePlan` as an array of pool, input-mint, and output-mint entries. Its API swap example sends the compute response to the transaction builder. The sample has no single-pool selector in its compute URL. Source: [Raydium API swap sample](https://github.com/raydium-io/raydium-sdk-V2-demo/blob/master/src/api/swap.ts).

[VERIFIED, live Devnet quote, 2026-09-24] A read-only quote for input mint `So11111111111111111111111111111111111111112`, output mint `4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU`, and input amount `1000000` returned HTTP `200`, `success:true`, output amount `16304`, price impact `2.76`, and two route entries: `2gCLw8XLxwYSEHHkT9QWBbJRkojwFp6T13D2Wrbzjf3p` routes WSOL to `8X34zxzdrjUBRQXF6ji6YGP8Wr22Ccv6X3n3on2yris1`; `6VEaA2E94TNSkWnG4iWxqDakQb2ucqFu3DyDoLFL4Mrm` routes that mint to Devnet USDC. This quote checks only this pair and amount.

[VERIFIED, live Devnet account read, 2026-09-24] `getMultipleAccounts` returned owners `DRayAUgENGQBKVaX8owNhgzkEDyoHTGVEGHVJT1E9pfH` and `DRaya7Kj3aMWQSy19kSjvmuwq9docCHofyP9kanQGaav` for those route pools. Raydium's primary source identifies the first as its Devnet CLMM program and the second as its Devnet AMM program: [CLMM program source](https://github.com/raydium-io/raydium-clmm/blob/master/programs/amm/src/lib.rs), [AMM program deployment table](https://github.com/raydium-io/raydium-amm/blob/master/README.md).

[VERIFIED, current client code] `web/app/devnet-execution.mjs` allowlists `CPMDWBwJDtYax9qW7AyRuVC19Cc4L4Vcy4n2BHAbHkCW` and `DRaycpLY18LhpbydsBWbVJtxpNv9oXPgjRSfpF2bWpYb`. `validateQuote` requires exactly one route and the configured pool ID. The live two-pool route is rejected. No quote was built into a transaction, and no wallet signed or sent it.

### Least confident decisions

1. [INFERRED] Widen the app to Raydium-routed, multi-pool swaps with explicit path display and per-hop validation. The route API selected two Raydium programs that the current CPMM-only client does not validate. The alternative is a direct CPMM builder that does not depend on the route API.
## Treasury decision index, 2026-09-26

[VERIFIED, sequence correction, 2026-09-27] The user required decision graphs, hosting, screen design, and full flow before Devnet execution. The earlier completed simulation is a starting point for that work. The user approved implementation of the revised flow.

[INFERRED, DEC-2026-09-27-01] Owner: architect. Decision: preserve the six-node input graph, add rule traces and saved versioned records, and build the inspector around that evidence. Alternatives: replace the evaluator, or add a backend before the browser flow is clear. Consequence: one browser-local synthetic path first; shared accounts and live evidence remain separate work. [Contract](decision-graph.md) defines compatibility and acceptance.

[VERIFIED, user direction] The user approved the visual treasury pitch and selected a local loop before lending integration. The new decisions are [local simulation first](adrs/0001-local-treasury-loop.md), [graph and authority](adrs/0002-graph-and-authority.md), [browser-local history](adrs/0003-browser-local-history.md), and [future cloud deployment](adrs/0004-cloud-deployment.md). These records scope the new treasury module. Earlier decisions retain their dated scope.

## Repository boundaries, 2026-09-27

[VERIFIED, user choice] ID: `DEC-2026-09-27-REPO`. Owner: coordinator. The user selected option `1` after application and finance reviews. The alternatives were a shared-module extraction and a full workspace conversion.

[VERIFIED, source evidence] `web/mesh/app.mjs:1` imports `mesh/fixtures.mjs`; `web/mesh/terminal.mjs:1` imports `mesh/kamino-wire.mjs`. Dashboard Node tests also import `mesh/domain.mjs`. Root `package.json:24` tests only the TypeScript components. At inspection, `git ls-tree -r --name-only origin/main mesh` returned those three mesh files; the complete API exists on the MVP branch. These distinct release inputs need explicit checks.

[INFERRED, decision and consequence] Retain folders and dependency boundaries. Add a current architecture map, component verification commands, and separate website/API release checks. Use real build resolution and isolated native imports to check completeness. Keep existing root test behavior. Require visible PostgreSQL coverage instead of treating skipped integration checks as a full pass. Do not move modules, change financial rules, add dependencies, or apply migrations in this slice. The [verification contract](interfaces.md#repository-verification-contract-2026-09-27) fixes command behavior before implementation.

### Least confident decisions

1. [INFERRED] The explicit API source list will need updates when its module boundary changes. Native linkage should make omissions visible.
2. [NOT DETERMINED] Source checks alone cannot establish a working Docker image or hosted service. Those proofs remain separate.
