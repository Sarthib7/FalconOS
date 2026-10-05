# Falcon knowledge mesh

[VERIFIED, user direction, 2026-09-27] The user requested a knowledge mesh that supports analysis, with Citadel as a reference. The user accepted a separate Falcon graph and Railway API plus Postgres: "ok lets do that". Owner: coordinator. Status: In Progress.

[VERIFIED, correction] The earlier completed graph work covers the six-node treasury trace, not this knowledge mesh. `web/treasury/domain.mjs:170` builds that fixed graph. Preserve its I14 records and policy. I15 below adds a separate persistent analysis path.

## First vertical slice

[VERIFIED, subsequent steering] The user selected the personal Railway workspace, then required the MVP before deployment, including connectors, the browser terminal, and Devnet execution. The foundation below is the first implementation slice only. It cannot close the MVP. The live capture and Devnet terminal contracts follow below. Actual wallet execution remains a separate proof.

[INFERRED, implementation contract] One question: which synthetic positions depend on this liquidity observation, and does the observed reserve cover their combined full exit? Follow observation -> reserve -> positions. Retain the source revisions and exact paths used. This is a deterministic evidence analysis, not an LLM answer or permission to execute. Live ingestion, semantic search, and general research analysis remain later work.

[INFERRED, acceptance] Two positions share a reserve. A third position uses another reserve. Changing the shared reserve's observation changes the combined exit result. The unrelated position is excluded. Missing paths, conflicting evidence, stale evidence, and traversal limits cannot produce READY. Historical analyses retain their original graph after source updates.

## I15 ownership and runtime

[INFERRED, contract] Provider: isolated `mesh/` Node service with `pg`. Consumer: new `web/mesh/` viewer. Owner: coordinator. Status: In Progress. Root plugin, Rust engine, existing treasury simulation, and Devnet execution retain their contracts. Node native HTTP serves JSON. Postgres owns source revisions, current heads, and saved analyses. The bounded graph projection is rebuilt from retained current source documents.

[INFERRED, storage decision] Start with three tables in the new `falcon_mesh` schema: immutable source revisions, current source heads, and immutable analyses. Retain source content as text and fingerprint those exact UTF-8 bytes. Typed nodes and edges live inside those versioned source documents. No second graph database or projection worker is required for this bounded slice. Limit an owner to 32 current source documents, each at most 64 nodes and 128 edges. A projected graph exceeding 256 nodes or 512 edges is explicitly truncated and cannot support a determinate analysis.

[VERIFIED, schema need] Persistent source revisions and cross-device analysis do not exist in the browser store. Repository filename inspection found only `web/migrations/0001_waitlist.sql`; that file uses SQLite `datetime('now')` and defines waitlist tables. No Prisma schema was found in the repository inventory, excluding dependency and build directories. The new schema is separate. Apply it only to a disposable local Postgres database during development. A hosted target and its existing schema remain unknown.

## Source and graph contract

[INFERRED, types] Source document exact keys: `{schemaVersion:1, mode:"synthetic", sourceKey, sourceUrl, observedAt, nodes, edges}`. Source keys and graph IDs use `[a-zA-Z0-9][a-zA-Z0-9._:/-]{0,127}`. `sourceUrl` uses `synthetic://`. Times use canonical UTC ISO strings. No future source time at ingestion. Content limit: 128 KiB UTF-8 per document. Request limit: 1 MiB.

[INFERRED, node types] Node exact keys: `{id, kind, label, properties}`. Kinds: `position`, `reserve`, `protocol`, `asset`, `observation`. Labels are nonempty and at most 120 characters. Properties are exact: position `{amountUnits}`; observation `{status:"ok"|"unavailable", availableLiquidityUnits:string|null}`; other kinds `{}`. Amounts use unsigned canonical integer strings no greater than u64. Zero is permitted. All fixture amounts denote six-decimal synthetic USDC.

[INFERRED, edges] Edge exact keys: `{id, source, target, relation}`. Allowed directed relations: position `supplied_to` reserve; reserve `operated_by` protocol; position or reserve `denominated_in` asset; observation `observes` reserve. Source documents may refer to endpoints in other source documents. Duplicate IDs within one document are invalid. Conflicting definitions across current documents remain visible as graph issues. Missing endpoints remain visible as incomplete evidence. A mention is not a dependency edge.

[INFERRED, revision] Stored source revision shape: `{revisionId, sourceKey, sourceUrl, observedAt, capturedAt, sha256, content}`. Revision ID is UUID. Ingest computes SHA-256. Current heads change only through compare-and-swap. Repeating an identical revision is idempotent and never restores an older head. Reusing its ID with different content fails. Source updates and their head changes commit atomically, including a batch of up to four documents.

[INFERRED, graph shape] `projectGraph(revisions, at)` returns `{schemaVersion:1, mode:"synthetic", revision, asOf, nodes, edges, sources, issues, coverage}`. Nodes and edges add `sourceRevisionIds:string[]`. Sources omit `content` but retain all other revision fields. `revision` is a deterministic SHA-256 over sorted source revision IDs and hashes. `issues` is a list of safe human-readable messages. Graph coverage is `{status:"complete"|"truncated", nodeLimit:256, edgeLimit:512, sourceLimit:32}`. Stable sorting precedes display caps. An incomplete projection never becomes an authoritative empty result.

## Analysis contract

[INFERRED, policy] `analyzeGraph(graph, {observationId, maxHops}, at)` returns `{schemaVersion:1, mode:"synthetic", policyVersion:"mesh-liquidity/1", at, graphRevision, observationId, status, summary, totalAffectedUnits, availableLiquidityUnits, positionResults, sourceRevisionIds, coverage}`. Status: `READY`, `BLOCKED`, or `NO_DATA`. `totalAffectedUnits` and `availableLiquidityUnits` are integer strings or null. `positionResults` entries: `{positionId, reserveId, status, amountUnits, reason, pathNodeIds, pathEdgeIds, sourceRevisionIds}`. Paths run from observation through reserve to position, with edges recorded in traversal order even when followed in reverse.

[INFERRED, traversal] Query bounds: caller may set `maxHops` from 1 to 3, default 3; at most 64 visited nodes and 128 visited edges. Keep visited IDs to handle cycles. Follow query-specific paths after owner filtering: observation -> its reserve -> that reserve's positions, protocol and asset -> each selected position's asset. Follow `supplied_to` in reverse. Stop expansion at protocol and asset nodes. Unrelated positions do not consume query limits. Required dependencies are exactly one observed reserve, its protocol and asset, all positions supplied to it, each position's matching asset, and exactly one current liquidity observation for that reserve. Empty positions, missing dependencies, conflicts, or reached limits yield NO_DATA. Check required links against the complete owner graph, not a capped canvas.

[INFERRED, coverage] Analysis coverage: `{status:"complete"|"truncated"|"missing_dependency"|"conflicting_evidence", maxHops, nodeLimit:64, edgeLimit:128, visitedNodeIds, visitedEdgeIds}`. Any graph issue conservatively yields NO_DATA. Observation age is checked at analysis time with maximum 300 seconds. Future, stale, unavailable, or multiple reserve observations yield NO_DATA. Fresh liquidity below the sum of connected positions yields BLOCKED for the combined exit and all returned position results. READY describes this synthetic combined-exit calculation only. It does not predict a live fill or authorize movement.

[INFERRED, persistence] Saved record: `{id, requestId, createdAt, graph, analysis}`. Request IDs are UUID. Load current source heads and save the analysis in one repeatable-read transaction. A repeated request ID with the same observation and bounds returns its original record. Different arguments under that ID fail. Later source changes cannot rewrite a saved graph or analysis. Owner scope applies before all graph, source, history, and analysis reads.

## HTTP and module interfaces

[INFERRED, auth] `FALCON_MESH_TOKEN_HASHES` is server-only JSON mapping SHA-256 token hashes to owner slugs. Require nonempty valid configuration. Authenticate a bearer token before all `/v1/` routes. Owner identity never comes from a request body or query. UI keeps the token in memory only. No tokens in URLs, logs, artifacts, or browser storage. Exact configured origins may use CORS; reject other supplied origins. `GET /healthz` is liveness only. `GET /readyz` checks the expected schema and database connection without exposing private counts.

[INFERRED, API] JSON responses:

| Method and path | Request | Success |
| --- | --- | --- |
| GET `/v1/graph` | none | `{graph}` |
| POST `/v1/sources` | `{revisions:[{revisionId,expectedRevisionId:null|UUID,content:string}]}` | `{sources:[stored revision metadata]}` |
| GET `/v1/sources/:revisionId` | none | `{source:stored revision}` |
| POST `/v1/analyses` | `{requestId,observationId,maxHops}` | `{record}` |
| GET `/v1/analyses` | none | `{records:[{id,createdAt,analysis}], limit:20}` newest first |
| GET `/v1/analyses/:id` | none | `{record}` |

[INFERRED, errors] JSON `{error:{code,message}}`; 400 INVALID_INPUT, 401 UNAUTHORIZED, 403 ORIGIN_DENIED, 404 NOT_FOUND, 409 CONFLICT, 413 TOO_LARGE, 429 RATE_LIMITED, 503 STORAGE_UNAVAILABLE, 500 INTERNAL_ERROR. Authenticated requests share a per-process fixed window with per-owner and global caps; 429 includes `Retry-After`. Health and readiness checks remain exempt. Errors must not reveal SQL, credentials, or other owners. No success before commit. No automatic schema setup at server startup. Unsupported methods fail visibly. Public signup is not implemented; this is a controlled tester service.

[INFERRED, rate isolation] A request rejected by the owner cap does not spend the global budget. The global cap counts requests that pass the owner cap, not every authenticated attempt.

[INFERRED, domain exports] `MeshError(code,message)`; `validateSource(content, capturedAt)` returns parsed document; `projectGraph(revisions,at)`; `analyzeGraph(graph,query,at)`. `fixtures.mjs` exports browser-compatible `makeDemoDocuments(at,scenario)` returning two source documents (`demo/structure`, `demo/liquidity`). Scenarios: `liquid`, `illiquid`, `stale`, `missing`. Fixed node IDs include `observation:shared`, `reserve:shared`, `position:one`, `position:two`, and `position:unrelated`. The missing scenario omits the shared observation's `observes` edge. Source documents are templates, not automatic initial data.

[INFERRED, store exports] `createStore(pool)` returns async `ingestSources(owner,revisions,at)`, `getGraph(owner,at)`, `getSource(owner,revisionId)`, `createAnalysis(owner,{requestId,observationId,maxHops},at)`, `getAnalysis(owner,id)`, `listAnalyses(owner)`, `ready()`. `schema.sql` is initial schema only, with no unrelated DDL. `init-db.mjs` explicitly applies this schema after operator review. Tests use a fresh disposable Postgres, never a configured production target.

## Interface and hosting

[VERIFIED, hosting correction, 2026-09-27] The user selected Supabase project `mcmxfwkhdzzsfpvldgdw` and approved the reviewed five-table schema and restricted role. This replaces the earlier Railway PostgreSQL plan below. Railway remains the selected API host. The [Supabase setup](supabase-setup.md) records permissions, connection requirements, and measured deployment state. This approval leaves application login disabled.

[INFERRED, UI] `/mesh/` has connection controls, synthetic scenario load, entity search, a selectable relationship graph, source inspector, and persisted analysis history. The viewer reads backend results. It does not calculate recommendations. Select a historical record to show its saved graph and evidence ages at that record's time. A failed refresh or analysis visibly invalidates the current-result label. Show exact highlighted paths and a text relationship list. Use a separate Vite artifact to avoid publishing unrelated work.

[INFERRED, deployment] Cloudflare Pages hosts the static viewer. A separate Railway Falcon project runs the API and Postgres. Start without a worker. Keep database access private, set exact viewer origins, and configure backups before using retained real evidence. Railway target, credentials, region, actual resource cost, and hosted recovery are not yet verified. Prepare a reviewable candidate before any deployment or persistent hosted schema change.

[VERIFIED, primary references] [Node Postgres transactions](https://node-postgres.com/features/transactions) require one client for each transaction. [Railway private networking](https://docs.railway.com/networking/private-networking) connects services inside one project environment. [Railway Postgres](https://docs.railway.com/databases/postgresql) documents connection variables and identifies its templates as unmanaged.

## Ownership and verification

[INFERRED, task assignments] KM-DOMAIN owner domain implementer: `mesh/domain.mjs`, `mesh/fixtures.mjs`, `mesh/test/domain.test.mjs`. KM-STORE owner storage implementer: `mesh/store.mjs`, `mesh/schema.sql`, `mesh/init-db.mjs`, `mesh/test/store.test.mjs`. KM-UI owner UI implementer: `web/mesh/`. KM-INTEGRATE owner coordinator: API, auth, package/deployment config, browser and HTTP tests, disposable database, docs, integration, and final verification. Agents do not run whole-project checks while others edit.

[INFERRED, required evidence] Domain tests cover relationship-driven analysis and all incomplete states. Real Postgres tests cover owner isolation, atomic rollback, concurrency, idempotency, saved history, and a fresh connection. HTTP tests cover authentication and request limits. Browser tests cover paths, source inspection, history, errors, and 320px layout. Negative controls must fail collected tests when a critical graph or owner guard is removed.

## Live capture extension

[INFERRED, selected working scope] No source preference reply arrived during foundation checks. The coordinator stated the recommended scope: onchain evidence and official protocol documents. First connectors: `kamino-program-docs` and `solana-devnet-klend`. The registry fixes each public URL, network and parser. Users cannot submit URLs or live graph facts.

[INFERRED, source v2] Server captures use `{schemaVersion:2,mode:"live",sourceKey,sourceUrl,observedAt,capture,nodes,edges}`. `sourceKey` is `live:<connectorId>`. `capture` contains `connectorId`, `connectorVersion`, `registryVersion`, `projectionVersion`, `status`, `reasonCode`, `exchanges` and `chain`. Status is `ok`, `unavailable`, `invalid`, or `too_large`. Each exchange retains start/completion times, request method and base64 body, and response status, content type, base64 body, byte length and SHA-256. Hash the response-body bytes delivered by the transport before decoding. An interrupted or oversized body is not complete evidence. All content must fit the existing 128 KiB source bound.

[INFERRED, live identity] `observedAt` is receipt time, not publication or block time. RPC captures retain the full genesis response and account response. `chain` is null for documents; RPC success records `{network:"devnet",genesisHash,commitment:"confirmed",slot}`. Verify the full Devnet genesis hash before accepting account facts. A failed capture becomes the current revision and cannot leave an earlier success labelled current.

[INFERRED, public graph] Live nodes are `document`, `protocol`, `account`, and `observation`. Document claims connect to the registered program account. The RPC observation connects to that same account. A document claim alone does not prove deployment or lending usability. Account ownership means Solana program ownership. It does not establish wallet ownership.

[INFERRED, mode separation] Public `POST /v1/sources` continues to accept synthetic v1 only. New synthetic writes cannot use the `live:` prefix. `GET /v1/graph/live` projects only validated live captures. Existing `GET /v1/graph` remains synthetic. Program-evidence live analysis uses `POST /v1/analyses/live` and policy `mesh-public-evidence/1`. Outcomes are `OBSERVED` or `NO_DATA`; it cannot grant financial approval. Existing analysis tables retain the mode within their graph and result JSON. Idempotency compares mode as well as query arguments. Historical v1 content remains unchanged.

[VERIFIED, user-confirmed, 2026-09-30; source: `mesh/live.mjs`, `mesh/kamino.mjs`] A third fixed connector, `solana-devnet-reserve-liquidity`, reads the pinned reserve and USDC vault on Devnet. It checks genesis before one confirmed `getMultipleAccounts` read. The response retains both complete account byte arrays, hashes and one RPC slot. The reserve's unborrowed book amount at offset 224 must equal the classic SPL vault amount at offset 64. Owner, discriminator, version, market, mint, vault authority, token state and reserve status must match the pinned identities. Failed, malformed or mismatched current captures return `NO_DATA`, never an older number.

[VERIFIED, source: `mesh/live.mjs`, `mesh/test/live.test.mjs`] Reserve analysis uses `mesh-reserve-liquidity/1`. Its `OBSERVED` value is vault-backed unborrowed base units, not freely withdrawable USDC or an exit estimate. It records the reserve and vault path, hashes and slot. The original `mesh-public-evidence/1` analysis still requires the document and program account only. Lending preparation continues to require that original policy; a reserve-liquidity result cannot authorize it. No schema change is needed because source bytes and saved graphs already use TEXT and JSONB. Historical two-source records keep their original policy and graph.

[INFERRED, capture API] Authenticated `GET /v1/connectors` returns `{connectors:[{id,label,sourceUrl,network}]}`. `POST /v1/captures` accepts exactly `{requestId,connectorId,expectedRevisionId}`. The server fetches outside a database transaction, then commits its capture using the existing atomic revision/head path. `requestId` is the revision ID. A retry returns the original capture without refetching or restoring its head. Reusing an ID for another connector fails. Concurrent identical requests may fetch twice, but only one retained capture wins. Response: `{source:revision metadata}`. Source reads use the existing owner-scoped endpoint.

[INFERRED, module ownership] Connector implementer owns `mesh/live.mjs` and `mesh/test/live.test.mjs`. Coordinator owns storage, HTTP, contract and integration tests. Viewer implementer owns live source controls after this contract. No persistent schema change is needed: source content is TEXT and saved graphs/results are JSONB in `mesh/schema.sql`.

## Owner-entered live decision trace

[VERIFIED, user-confirmed, 2026-09-30] `/dashboard/#operate` follows the live reserve graph into one saved advisory. The owner enters a proposed position, a maximum position, a minimum observed book amount and a maximum evidence age. These are scenario inputs, not verified wallet holdings. The original synthetic treasury graph stays separate.

[VERIFIED, source: `mesh/scenario.mjs`, `mesh/store.mjs`, `mesh/http.mjs`] `POST /v1/decisions/reserve` accepts exactly `{requestId,scenario}`. Scenario fields are `proposedUnits`, `maxProposedUnits`, `minBookLiquidityUnits` and `maxObservationAgeSeconds`. Amounts are canonical u64 strings; age is an integer from 1 to 300. The service rechecks current reserve evidence under the owner lock. Missing or stale evidence saves `NO_DATA`; a violated owner cap or book floor saves `BLOCKED`; all checks passing saves `REVIEW`, never execution approval. Source, owner-input, rule and result nodes keep distinct origins and cited edges.

[VERIFIED, source: `mesh/store.mjs`, `mesh/test/scenario-http.test.mjs`] Decisions use immutable rows in the existing analyses table under a reserved marker. `GET /v1/decisions` and `GET /v1/decisions/:id` return only the authenticated owner's decisions. Identical request retries return the original graph; changed inputs under that ID fail. Ordinary analysis and lending reads exclude decision rows. No schema change, signing or broadcast occurs on this route.

## Devnet terminal contract

[VERIFIED, user steering] The user requires browser support and Solana wallet choice: "should support brworser and any solana wallet". [INFERRED, implementation] Use Wallet Standard discovery and `solana:signTransaction`. Show unsupported capabilities. Do not require `signMessage`, retain keys, or restrict selection to one wallet brand. Browser/device coverage remains subject to actual tests.

[REPORTED, reserve research] Candidate reserve `HRwMj8uuoGVWCanKzKvpTWN5ZvXjtjKGxcFbn2qTPKMW` uses market `6aaNTBEmwdN19AAdTwbNrWyUo6iEyiLguxCTePEzSqoH` and Circle Devnet USDC `4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU`. Research captured its account bytes under the private temporary evidence directory. A readable reserve does not prove a completed lending transaction. The deployed program's exact source release remains undetermined.

[INFERRED, fixed transaction] Direct supply or receipt-token redemption uses optional destination ATA creation, reserve refresh, then one pinned KLend instruction. Wallet is the sole signer and fee payer. No address lookup table or extra instruction is allowed. Supply input is a maximum USDC debit; redemption input is an exact receipt-token debit. Neither instruction supplies an onchain minimum-output guard. The terminal must distinguish simulation estimates from verified transaction amounts. First-test supply cap: 1 Devnet USDC per prepared transaction.

[INFERRED, preparation] Require a current saved live `OBSERVED` analysis. Re-evaluate its evidence and compare its graph revision with the current live graph. Fetch coherent reserve, market, mint, vault, wallet and ATA evidence on verified Devnet. Simulate the exact unsigned message. Persist the immutable prepared intent and original source references before returning it. Preparation reads public wallet data; it does not establish wallet control. A valid signature over the exact prepared transaction establishes control at registration.

[INFERRED, durable execution records] Two additive tables retain immutable lending intents and append-only events. Existing analyses cannot represent a pending signed transaction and its later independent receipt without changing their immutable analysis semantics. `lending_intents` stores owner, intent/request IDs, analysis ID, creation time, request and intent JSON. `lending_events` stores owner, intent/event IDs, creation time, kind and data JSON. One `SUBMITTED` event per intent pins its signature and exact signed bytes before browser broadcast. `RECEIPT` events preserve pending, failed, unverified and confirmed reads. All foreign keys include owner. No automatic DDL at startup.

[INFERRED, schema scope] Review initial `mesh/schema.sql` and the additive lending migration together. The known target is the disposable local Postgres schema version 1. Apply and test the full history on a second fresh disposable database, then compare existing source and analysis rows before and after the additive migration. Hosted schema remains unknown and unchanged.

[INFERRED, HTTP] `POST /v1/lending/intents` accepts `{requestId,analysisId,wallet,action,inputBaseUnits}` and returns `{record}`. Actions are `supply` and `redeem`; amounts are positive u64 integer strings. `GET /v1/lending/intents` returns `{records,limit:20}`. `GET /v1/lending/intents/:id` returns `{record,events}`. `POST /v1/lending/intents/:id/submit` accepts `{requestId,transactionBase64}` and retains the verified signature and exact signed message before returning `{event}`. This endpoint does not broadcast. `POST /v1/lending/intents/:id/receipt` accepts `{requestId}` and returns `{event}` after an independent fixed Devnet read. Every endpoint uses the existing bearer-derived owner and rejects extra fields.

[INFERRED, execution sequence] The browser displays the complete prepared action and estimate before requesting a wallet signature. It checks the selected account before and after signing, compares the signed message and signature locally, then registers it. After successful registration it broadcasts those exact bytes to fixed Devnet RPC. An uncertain send retains the signature and shows pending. Receipt checks require the exact approved message, successful chain execution, fixed account/mint identities, and reconciled token deltas. A status response alone cannot mean confirmed lending. Historical events remain accessible after reload.

[INFERRED, retry and session rules] First registration rechecks the original analysis and current source heads under the owner lock. An explicit retry broadcasts the retained signed bytes only after local signature, message, network and expiry checks. It requests no replacement signature. An absent transaction after expiry is `UNVERIFIED`; absence does not prove it never executed. Responses from an earlier credential generation cannot enter the current workspace.

[VERIFIED, user-confirmed, 2026-09-30] The local mesh MVP is complete only after one capable Wallet Standard wallet signs a Devnet supply and redemption, both receipts are confirmed, token balances reconcile, and the saved intent and events survive reload. One wallet proves that path, not every wallet brand or device. The prior unsigned simulation and live connector reads do not close this gate. Hosting follows the local proof; actual inbox delivery and any real-fund test are separate decisions.

## Least confident decisions

1. [INFERRED] A bounded deterministic analysis proves the data path. It does not establish useful general research reasoning.
2. [INFERRED] Rebuilding this small graph from source documents avoids a second stored projection. Larger corpora may require indexed node and edge tables.
3. [INFERRED] Operator-issued bearer tokens fit controlled testing. Broader access needs a separate account and session design.
