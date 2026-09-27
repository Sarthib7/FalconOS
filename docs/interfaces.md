# First research slice interfaces

[VERIFIED, I15 hosting approval, 2026-09-27] Owner: coordinator. Status: In Progress. Supabase project `mcmxfwkhdzzsfpvldgdw` is the approved PostgreSQL target. The [reviewed setup](supabase-setup.md) retains the existing tables and API contract. The browser still calls the Node API. Application login and hosted API connectivity remain pending.

[INFERRED, I16, 2026-09-27] Owner: coordinator. Provider: canonical treasury domain/store plus retained OpenDesign samples. Consumer: React `/dashboard/`. Status: Verified locally. Root browser returned `passed:95`, `total:95`; see [verification](verification/2026-09-27-dashboard.md). [Control Centre contract](control-centre.md) fixes its storage namespace, four view routes, evidence/export semantics and verification. The treasury store gains an optional internal key with its existing default preserved. Backend APIs and existing wallet interfaces remain unchanged.

[INFERRED, I15, 2026-09-27] Owner: coordinator. Provider: mesh service and Postgres. Consumer: mesh viewer and Devnet lending terminal. Status: local integration. [Knowledge mesh contract](knowledge-mesh.md) defines source revisions, owner scope, graph traversal, immutable analyses, HTTP errors and verification. A confirmed user-wallet round trip remains unverified.

[VERIFIED, source: `web/landing/`, `web/functions/api/waitlist.js`] React owns the treasury landing. `POST /api/waitlist` persists registrations before success. Optional confirmation delivery records provider acceptance separately. The [email contract](landing-email.md) defines local SQLite, hosted D1 and outbox boundaries.

[INFERRED, I14 amendment, 2026-09-27] Owner: coordinator. Provider: treasury domain and store. Consumer: treasury UI. Status: Completed. [Decision graph contract](decision-graph.md) defines version 2 runs, saved records, rule checks, compatibility, errors, and verification. Existing commands remain unchanged.

[VERIFIED, prior implementation check, 2026-09-05] The local suite returned `tests 40`, `pass 40`, `fail 0`, `cancelled 0`, `skipped 0`, and typecheck exited `0`. The registry fixture checks all four configured assets against the saved historical capture. The live CLI records assessment time after collection.

[REPORTED, preliminary source freeze, 2026-09-05] Root earlier reported `npm run typecheck` exit `0`, agent plus vault tests `22/22`, CLI tests `11/11`, and the full suite `tests 57`, `pass 57`, `fail 0`, `cancelled 0`, `skipped 0`. This result is superseded by the final 59-test evidence below. It did not establish a real agent thesis.

[VERIFIED, final source/test freeze evidence, 2026-09-05] The saved full-suite output contains `tests 59`, `pass 59`, `fail 0`, `cancelled 0`, `skipped 0`, and its exit file contains `0`. The focused output contains `tests 35`, `pass 35`, `fail 0`, `cancelled 0`, `skipped 0`, and its exit file contains `0`. The typecheck exit file contains `0`. The [P1-T07 fixture record](verification/2026-09-05-agent-fixture.md) records the persistent synthetic result.

[REPORTED, current team roles, 2026-09-05] Root only orchestrates and reports. Luna agents implement and measure. This interface record does not claim a live agent thesis, a current RPC revalidation, or a desktop rendering result.

[VERIFIED, current live evidence, 2026-09-05] The approved escalated watch completed 10 scans. Every scan had four valid quotes and `complete: true`; all 40 observations had HTTP 200, raw data, and `error: null`. See the [live checks](verification/2026-09-05-live-checks.md). The earlier `use_default` failure remains separate, and its context difference remains not determined.

[INFERRED, MVP boundary] The first usable MVP has four results: a Solana and Base collector, one cited thesis from the selected existing agent, one paper-cycle outcome, and one review view that links the candidate, evidence, thesis, and outcome. Broader strategies, a third chain, live capital, and signing remain later work.

[VERIFIED, root baseline] Owner: architect. Status: implemented for the first prototype. Contract date: 2026-09-05. Source types live in `src/types.ts`. The root baseline test run returned `tests 28`, `pass 28`, `fail 0`. Later parallel test results are recorded below and are not final integration evidence.


## Inbound plugin

[VERIFIED, local implementation] `node src/cli.ts plugin --data ./data` is separate from local `thesis` and `src/codex.ts`. It reads one UTF-8 JSON object from stdin (raw input ≤8 MiB) and emits exactly one JSON advisory/error line (serialized envelope ≤64 KiB). `--data` is host-configured; plugin has no vault or export path.

[VERIFIED, local implementation] `PluginRequest` exact keys are `schemaVersion`, `requestId`, `agentId`, `intent`, `sourceCutoff`, `evidence`, and `notes`. `intent` contains route, decimal USDC amount, and bounded objective. `evidence` contains one relative path plus lowercase SHA-256. Notes are relative paths captured as `untrusted-note`. Unknown or authority-bearing fields fail before transport.

[VERIFIED, local implementation] `PluginAdvisory` exact keys include `schemaVersion: 1`, `kind: "advisory"`, request ID, validated `agentId` provenance, route, deterministic candidate status, required `fixture: true`, thesis, evidence citations, invalidation conditions, expiry, missing evidence, `authority: "advisory-only"`, and `executionReady: false`. Fixture output is synthetic and not a real agent decision.

[VERIFIED, local implementation] The host maps the request through `buildAgentRequest`, calls `createAgentRun` with a host-injected fixture `AgentTransport`, then maps the validated thesis without calling `exportThesis`. Standalone production invocation has no default transport and returns `ADVISORY_UNAVAILABLE`; no caller field selects transport, Codex, model, executable, wallet, signer, transaction, capital, or execution. Candidate `UNAVAILABLE` remains a valid exit-`0` advisory; transport and validation errors exit `2`.


[VERIFIED, final plugin review patch] `node --test test/plugin.test.ts test/agent.test.ts` returned `tests 30`, `pass 30`, `fail 0`, `cancelled 0`, `skipped 0`. The focused suite covers transport secret/empty-error redaction, UNC path rejection, final `O_NOFOLLOW|O_NONBLOCK`/fstat descriptor reads, FIFO evidence/note rejection within a short deadline, request-to-AgentRequest mapping, fixture status, and no export/persistent write. Node/Darwin has no `openat` API, so parent-directory swap atomicity remains outside this slice.

[VERIFIED, final plugin review patch] `npm test` returned `tests 83`, `pass 83`, `fail 0`, `cancelled 0`, `skipped 0`; `npm run typecheck` exited `0`. `node src/cli.ts plugin --help` exited `0`. `node src/cli.ts plugin --data test/fixtures < test/fixtures/plugin-valid-request.json` exited `2` and emitted exactly one JSON line with `code: "ADVISORY_UNAVAILABLE"` because no production host transport is injected. Smoke used checked-in fixture evidence only, created no persistent files, and made no market/RPC/model/paid call.

## Quote observation

[INFERRED, contract Q1] Provider: `sources.ts`. Consumer: `scan.ts`. Input: allowlisted chain, asset pair, integer input units, cancellation signal. Output: a `Cycle[]`, each containing one or two observations. Each observation stores its request, local start and receipt time, HTTP status, raw JSON, normalized quote, human-readable validation error, and (on schema-version-2 scans) a closed `failure` record with `kind`, descriptive `retryable`, and `retryAfterMs` metadata.

[INFERRED, compatibility] The only chains in this slice are Solana and Base. The only assets are USDC and EURC. Both directions start with USDC. The second leg receives exactly the first leg's EURC output. Failed first legs prevent dependent requests. A failed second leg preserves the first observation.

[INFERRED, failure rule] A provider error, unexpected asset, amount mismatch, transaction-bearing response, malformed amount, or timeout cannot produce a valid quote. All returned cycles remain observable with machine-readable failure kinds where an observation is returned. Retry metadata is descriptive only: no automatic retries in one scan; later polling records a separate scan.

## Assessment and evidence

[INFERRED, contract E1] Provider: `scan.ts`. Consumers: CLI and vault exporter. Input: normalized cycles and assessment time. Output: a versioned scan with `REJECT`, `REVIEW`, or `UNAVAILABLE` candidates. Every candidate has `executionReady: false` and `netProfitUsdc: null`.

[INFERRED, failure rule] Stale, future, expired, provider-after-receipt, or mismatched observations cannot produce a usable candidate. Gas USD is not silently converted to USDC. Platform fees already included in a quote are not subtracted again.

[VERIFIED, current metadata, 2026-09-05] `test/fixtures/public-metadata.json` preserves the complete historical request and response capture. The registry test matches the four exact addresses, six decimals, finalized Solana slots, pinned Base block, and capture window. The metadata is historical and does not provide runtime revalidation.

[VERIFIED, `src/types.ts` and `stablecoins/scan.ts`] New scans include `amountScale.decimals: 6` with `verification: "configured; EURC mainnet precision unverified"`. Earlier session captures predate this annotation and use the same configuration. Exact integer arithmetic does not prove a correct token registry.

[VERIFIED, correction, 2026-09-05] The scale statement above is a prior baseline. Current scans label six decimals as historically verified by the 2026-09-05 RPC capture and state that runtime metadata revalidation was not performed. The earlier saved captures remain unchanged.

## Vault export

[INFERRED, contract V1] Provider: `vault.ts`. Consumer: CLI. Input: scan, data directory, vault directory. Output: immutable JSON evidence and Markdown paths. Filenames derive from local run IDs and fixed entity IDs. Source text never chooses a path or enters YAML. Existing files are never overwritten. Symlink components are rejected.

[VERIFIED, root tests] Tests cover the F1-F6 invariants in `CONTEXT.md`. They use local files and synthetic provider responses. Separate live scan and watch measurements appear in `status.md`.

## CLI run and stop

[VERIFIED, current signal checks, 2026-09-05] The process tests cover SIGINT and SIGTERM during a source request, and SIGINT and SIGTERM during polling. They assert that no later request starts, completed evidence remains readable, and a stop does not publish an incomplete scan. The prior full suite returned `tests 40`, `pass 40`, `fail 0`, `cancelled 0`, `skipped 0`.

[INFERRED, desktop limit] Text inspection of the generated vault does not verify Obsidian graph rendering. The desktop app and suitable native automation were unavailable in the recorded check.

[VERIFIED, cli_luna implementation] Owner: cli_luna. Provider: `cli.ts`. Consumer: the local process and its test harness. Input: `demo`, `scan`, or `watch` arguments, a bounded cycle count, and an optional cancellation signal. Output: one JSON summary per exported scan plus evidence and note paths. A healthy bounded watch returns exit `0`; an incomplete bounded watch, an incomplete one-shot scan, or a watch stopped after three consecutive incomplete scans returns exit `2`. Invalid input or export failure returns exit `1`.

[VERIFIED, cli_luna tests] A cancellation during collection or polling stops before the next collection. Completed summaries and saved synthetic test records remain readable. `node --test test/cli.test.ts` returned `tests 4`, `pass 4`, `fail 0`, `cancelled 0`, `skipped 0`. The test exporter marks records with `syntheticTestDouble: true`; those records are test evidence and do not represent live quotes.

[VERIFIED, correction, 2026-09-05] The four-test result above is an earlier CLI baseline. The prior suite included the four production signal and path combinations listed above and returned `tests 40`, `pass 40`, `fail 0`, `cancelled 0`, `skipped 0`. The saved final source/test evidence is recorded above.

[VERIFIED, P1-T07 fixture state, 2026-09-05] The synthetic evidence-to-thesis exchange is recorded in the [agent fixture evidence](verification/2026-09-05-agent-fixture.md). It validates the local shape and persistence path only. No real agent run exists, so CHK-10, CHK-11, CHK-12, and CP1B remain open.

## Least confident decisions

1. [INFERRED] The historical capture verifies six decimals only at its captured slots and block. Runtime metadata revalidation remains open.
2. [INFERRED] A ten-second observation window is useful for research. It does not establish execution freshness.

## Falcon Investment perps council (first local vertical slice)

[VERIFIED, local synthetic contract, 2026-09-11] `perps/perps.ts` (folder renamed from `preps/` on 2026-09-20) defines separate perps contracts. It does not alter `src/plugin.ts` or the legacy stablecoin `plugin` command.

[VERIFIED, host boundary] `ContractRegistryEntry` is versioned and host-owned. It requires one exact native SOL-perpetual definition per venue (`phoenix` or `hyperliquid`) with native market identity, collateral/settlement, multiplier, precision, limits, fees, market-data sources, margin semantics, capabilities, capture/effective provenance, raw hash, and adapter version. Missing or conflicting registry entries resolve to `NO_DATA`; no alias or invented native ID is supplied.

[VERIFIED, host boundary] `createCanonicalSnapshotBundle` accepts both Phoenix + Hyperliquid registries, both source-precedence policies, both venue capture sets, one capture time/coherence cap, and provenance (`live`, `synthetic`, or `historical`). It binds both validated registries + policies to one content-addressed bundle; retains exact raw bytes for both venues in one manifest, one normalized two-market projection, per-venue source decisions and policy versions, freshness/coherence outcomes, immutable canonical bytes, and one content hash. Venue-local `createCanonicalSnapshot` assembly is not the council request contract. Secondary failover requires typed primary `outage` plus prevalidated semantic equivalence; disagreement is critical `NO_DATA`.

[VERIFIED, local synthetic contract] `TradeProposal` is non-binding, perps-specialist, policy/account-referenced, snapshot-evidence-backed, expiring, and always `executionReady: false`. Missing policy or account state forces suggested size, leverage, risk bounds, and confidence numeric fields to `null`; missing snapshot data yields explicit `NO_DATA`.

[VERIFIED, local synthetic contract] `RiskReview` is independent and `veto-only`. A reviewer `BLOCK`, `NO_DATA`, hash mismatch, or transport failure suppresses council publication as `BLOCKED` or `NO_DATA`; it never controls Client Agent decisions or execution. `council.advice` and `council.copilot` have distinct exact keys. Copilot responses are explanation-only and cannot create a fresh Trade Proposal.

[VERIFIED, focused synthetic verification, 2026-09-11] `node --test preps/test/perps.test.ts` returned `tests 12`, `pass 12`, `fail 0`, `cancelled 0`, `skipped 0`; the full repository suite returned `tests 95`, `pass 95`, `fail 0`. Tests cover exact keys, registry conflict, raw/normalized snapshot hash and freeze, cross-venue hard coherence, TTL/age/sequence-gap bounds, typed failover, source identity/duplicates, signed funding/raw manifest evidence and reconstruction, proposal primitive fields/policy/account/provenance/expiry/status binding, immutable audit records, two-advisor byte/hash/request/run bindings, reviewer veto/failure/critical gating, malformed direct requests, Copilot full-evidence/native identity binding, immutable safe fallbacks, and host transport failures. Fixtures are deterministic and do not claim Phoenix/Hyperliquid live support.

[VERIFIED, local hardening contract, 2026-09-11] Council advice now has two host-controlled calls per normal run: exactly one Lead Specialist proposal call and exactly one independent Risk Review call. Both receive same `requestId`, `runId`, frozen bundle bytes/hash, policy, and account. Risk review identity is fixed by FalconOS; caller-supplied reviewer identity is not accepted. Risk review binds request/run, snapshot hash, and lead proposal hash. Any missing, duplicate, malformed, failed, or mismatched call yields `NO_DATA`; reviewer remains veto-only and Client Agent owns publication decision/execution.

[VERIFIED, local hardening contract, 2026-09-11] Bundle readiness requires selected capture timestamps across both venues to fit one hard coherence cap; venue-local readiness cannot bypass cross-venue staleness. Host ingress rejects wrong venue map keys, registry/native ID/version or source-policy mismatches, envelope provenance/capture/coherence mismatches, mutable or serialized bundles, and projection/hash tampering. Deep-freeze is required at every bundle/market node.

[VERIFIED, local hardening contract, 2026-09-11] Capture identity includes source ID, adapter version, and semantic version; duplicate source-role/ID captures fail closed. Secondary data is admissible only for typed primary outage plus policy-matching adapter/semantic versions and equivalence validation. `fundingRate` preserves signed decimal strings. Raw manifest entries retain raw bytes/hash, adapter version, semantic version, and equivalence result.
[VERIFIED, local hardening contract, 2026-09-11] Every retained raw manifest entry is base64-decoded and hash-checked at ingress; deterministic reconstruction binds raw bytes, normalized values, selected source/role/value/time, missing fields, and conflicts, so recomputing outer bundle hashes cannot forge a projection. Each capture carries explicit sequence and `continuous`/`gap` continuity; any gap, selected age beyond coherence cap, or TTL above the cap yields `NO_DATA`.

[VERIFIED, local hardening contract, 2026-09-11] Trade Proposal publication binds full policy/account state, native venue identity, all snapshot evidence components, request/run, snapshot provenance, and readiness/status consistency with the bound bundle and selected market. Copilot retains the complete snapshot evidence (raw/normalized/source-decision/selected hashes, capture time, venue-native IDs) and applies the same full proposal binding, including primitive expiry, horizon, invalidations, and provenance validation; it rejects altered components even when the snapshot hash is unchanged. Direct malformed council requests fail closed with safe `NO_DATA`.

[VERIFIED, local hardening contract, 2026-09-11] Published `council.advice` includes a deeply frozen `CouncilAuditRecord` preserving the full lead proposal/status and independent Risk Review identity/status/reasons plus policy/account/evidence bindings. This is an immutable in-memory response record; durable append-only storage remains external.
[VERIFIED, local hardening contract, 2026-09-11] Response ingress reconstructs the canonical bundle from retained evidence bytes, including nested market bytes/hash/frozen markers, and requires published status/proposal/selected market readiness to match the parsed bundle. Full proposal binding rechecks venue/native ID, complete evidence, provenance, policy/account, expiry, and status; risk snapshot and lead-proposal hashes must match the bundle/audit.
[VERIFIED, local hardening contract, 2026-09-11] Advice status is a strict matrix: a risk `BLOCK`/blocking veto requires top-level `BLOCKED`; risk `NO_DATA` remains visible `NO_DATA`, while `NO_DATA` with a valid lead `NO_DATA` and risk `PASS` remains a valid no-endorsement result. Direct publication with no lead proposal uses `NOT_CALLED`/`FAILED` audit defaults: risk `PASS` yields `NO_DATA`, risk `BLOCK` yields `BLOCKED`. A forged `NO_DATA` response carrying a `BLOCK` review is rejected.
[VERIFIED, local hardening contract, 2026-09-11] The audit record is request-scoped: audit `requestId` and `runId` must equal the top-level response identity, including failure-bearing risk responses.

[BOUNDARY, local adapter contract, 2026-09-11] Registry source IDs, adapter versions, semantic versions, raw bytes, and normalized values are retained and checked for consistency. Raw bytes alone do not prove provider-specific semantic meaning; that normalization remains a host-owned adapter attestation boundary. Official live adapters and native metadata remain external prerequisites.

[VERIFIED, local audit contract, 2026-09-11] Direct publication with no lead proposal uses explicit `NOT_CALLED`/`FAILED` lead audit fields; an accepted lead proposal remains in the immutable audit when the independent risk transport later fails. Validated policy/account state is preserved on valid-request safe fallback. Malformed advice/Copilot fallbacks with no valid snapshot use explicit `snapshotEvidence: null`, remain visibly `NO_DATA`, are deeply frozen, and pass their own response validators.

[BOUNDARY, local pure module, 2026-09-11] Perps canonicalization emits in-memory raw bytes/manifests, normalized projections, and content hashes only. It performs no durable append-only journal/persistence; durable audit storage is an external host prerequisite and is not claimed by this slice.

## Falcon Investment stocks dashboard

[VERIFIED, local command, 2026-09-23] `CARGO_NET_OFFLINE=true npm run dash -- demo` ran twice. Both commands exited `0`, and captured outputs matched (`identical_output=true`). The output begins `FalconOS Stocklana council demo [SYNTHETIC FIXTURE DATA]`, then reports `snapshot=READY  advice=PUBLISHED`, `snapshot=READY  advice=BLOCKED`, and `snapshot=NO_DATA  advice=NO_DATA`. It prints fixture source versions, snapshot hash prefixes, and graph counts. The header says `No market or RPC requests, wallet access, signing, or transactions.`

[VERIFIED, source read: `engine/src/serve.rs`] The Rust engine owns the local HTTP API. The browser copilot consumes it. The engine binds to `127.0.0.1:8787` and serves `GET /advice` and `GET /graph`.

`GET /advice` returns:

```ts
type AdviceResponse = {
  status: 'PUBLISHED' | 'BLOCKED' | 'NO_DATA';
  snapshot_sha256: string;
  created_at: string;
  execution_ready: false;
  reasons: string[];
  evidence: Array<{
    asset_id: string;
    underlying: string;
    token_price: string | null;
    liquidity: string | null;
    underlying_price: string | null;
    premium_bps: number | null;
  }>;
  citations: Array<{
    asset_id: string;
    field: 'price' | 'liquidity' | 'reference';
    source_id: string;
    source_version: string;
    observed_at: string;
    value: string;
    raw_excerpt_sha256: string;
  }>;
  latency_ms: number;
};
```

[VERIFIED, source read: `engine/src/serve.rs`] Published advice returns citations for all three fields per asset. `BLOCKED` and `NO_DATA` return an empty citation array. The snapshot hash covers each reference capture and its failure details.

`GET /graph` returns `{ nodes: GraphNode[], edges: GraphEdge[] }`. Each node has `id`, `kind`, `label`, and `detail`. Each edge has `from`, `to`, and `kind`. **[VERIFIED, source read: `engine/src/graph.rs`]**

## Local copilot transaction path

[INFERRED, approved interface contract] The local client has two explicit targets. Surfpool quote/build uses Jupiter mainnet data. Its blockhash, simulation, send, and status calls use only `http://127.0.0.1:18488`. Devnet quote/build uses Raydium's Devnet swap API. Its pool checks, blockhash, simulation, send, and status calls use only `https://api.devnet.solana.com`.

[VERIFIED, official Raydium SDK demo source, read 2026-09-23] The Devnet API host is `https://transaction-v1-devnet.raydium.io`. Its sample calls `/compute/swap-base-in`, reads `data.routePlan[].poolId`, and posts the quote response to `/transaction/swap-base-in`. The demo pool reader uses direct RPC for Devnet CPMM pools. See [Raydium Devnet API sample](https://github.com/raydium-io/raydium-sdk-V2-demo/blob/master/src/api/swap.ts) and [CPMM SDK sample](https://github.com/raydium-io/raydium-sdk-V2-demo/blob/master/src/cpmm/swap.ts).

[INFERRED, Devnet safety contract] A Devnet quote is usable only when the selected RPC confirms a Raydium CPMM pool account, its on-chain mint pair matches the requested mints, and the quote names that pool as its sole route with the requested amount and direction. The transaction builder must return exactly one unsigned transaction. Missing pool state, route mismatch, or a multi-transaction response stops before wallet signing.

[INFERRED, signer contract] The page gets a fresh blockhash from the selected RPC, simulates those exact message bytes, then requests wallet signing after the explicit **Sign & send** click. It verifies the signed message and connected signer before sending. Before send, it checks block height against the blockhash expiry. The page gets confirmation status from the same RPC.

[VERIFIED, local implementation tests, 2026-09-23] `npm --prefix web test` returned `tests 40`, `pass 40`, `fail 0`, `cancelled 0`, `skipped 0`. Fetch calls use test doubles. This verifies the client checks against fixtures, not the live Jupiter, Raydium, Surfpool, or Devnet services.

[VERIFIED, source read: `web/vite.config.js`] Vite does not include `/copilot/` in production build entries. The dev-only route does not change engine or plugin execution boundaries.

## Trading terminal graphs

[VERIFIED, source read: `engine/src/graph.rs:7-27,160-202`] The engine graph response has `nodes` and `edges`. Nodes carry `id`, `kind`, `label`, and `detail`. Edges carry `from`, `to`, and `kind`. The builder emits intent, verdict, snapshot, asset, source, and evidence records.

[VERIFIED, source read: `web/copilot/index.html:101-103,434-440,476-479`] The local page has one SVG graph. It fetches `/graph` from the council service. It places nodes with fixed two-column coordinates. The page has a separate trade ticket. It has no trade-history graph or graph tabs.

[VERIFIED, source read: `web/dash/index.html:24-31` and `web/vite.config.js:4-19`] `/dash/` remains a private-preview gate. Vite serves `/copilot/` only in development and omits it from the production build.

[VERIFIED, user direction, 2026-09-23] The user asked for a terminal-style local trading view with trade, intent, and knowledge/decision graphs, animated behavior, and live values instead of hardcoded sample values.

[INFERRED, pending interface work] Trade history needs a read-only transaction source and a UI view. The current graph builder does not emit wallet transactions. The user identified the trade graph but has not confirmed whether it should show recent wallet swaps or this session's ticket steps. No live RPC query occurred in this documentation update.

## Local stocks dashboard response

[VERIFIED, source read, 2026-09-24] `Evaluation` keeps one advice response, proposal verdict, canonical snapshot, references, and evidence graph. `/advice` omits proposal legs and per-capture provenance when the council status is `BLOCKED` or `NO_DATA` (`engine/src/serve.rs:38-58,190-215`).

[VERIFIED, implemented interface, 2026-09-24] Provider: Rust engine `127.0.0.1:8787`. Consumers: Vite development views at `/dash/` and `/research/`. Input: `GET /dashboard`, with no request body. The response is derived from the engine's current cached evaluation. It makes no additional provider calls.

```ts
type DashboardResponse = {
  advice: AdviceResponse;
  proposal: Proposal | null;
  policy: {
    max_dislocation_bps: number;
    coherence_cap_ms: number;
    assets: Array<{
      asset_id: string;
      underlying: string;
      target_weight_bps: number;
      max_weight_bps: number;
      min_liquidity_units: string;
      price_scale: number;
      quantity_scale: number;
    }>;
  };
  captures: Array<{
    asset_id: string;
    field: 'price' | 'liquidity' | 'reference';
    source_id: string;
    source_version: string;
    observed_at: string;
    available: boolean;
    value: string | null;
    raw_excerpt_sha256: string;
  }>;
  graph: {
    nodes: Array<{ id: string; kind: string; label: string }>;
    edges: Array<{ from: string; to: string; kind: string }>;
  };
};
```

Compatibility: `/advice` and `/graph` keep their current shapes. `proposal` is populated only for `PUBLISHED`. Policy values describe configured limits and target weights, not live holdings. Capture metadata omits raw excerpts. The graph projection omits node details, which may contain raw source failures. `BLOCKED` and `NO_DATA` keep their failures visible through advice reasons and capture availability. Historical backtests remain unavailable because the engine has no history route.

[INFERRED, local route boundary] Vite development middleware serves the dashboard and research views. The production `/dash/` HTML remains the private-preview gate. The public landing page remains unchanged. No browser page sends a wallet transaction through this endpoint.

[VERIFIED, local endpoint read, 2026-09-24] `curl -sS -D - http://127.0.0.1:8787/dashboard | head -c 2600` returned `HTTP/1.1 200 OK` and `Content-Length: 9226`. The response reported `"status":"BLOCKED"`, `"execution_ready":false`, and reasons `OPENAI token dislocated 2990bps from underlying` and `SPACEX token dislocated 2098bps from underlying`. The capture records were observed at `2026-09-24T10:11:55.000Z` and `2026-09-24T10:11:56.000Z`.

## Local stock strategy research view

[VERIFIED, source read: `engine/src/council.rs:28-45,105-174,611-665` and `engine/src/serve.rs:96-104,165-170,525-544`, 2026-09-24] The engine adds `checks` to `GET /dashboard`. It records rule status, observed value, threshold, unit, evidence capture keys, and reason. The same evaluator returns both the council verdict and checks. `PASS` means the rule ran and passed. `BLOCK` means the rule vetoed the proposal. `NO_DATA` means a required input failed or the rule did not run after an earlier failure. A skipped check includes the stop reason.

```ts
type CouncilCheck = {
  id: string;
  scope: 'snapshot' | 'portfolio' | 'asset';
  asset_id: string | null;
  status: 'PASS' | 'BLOCK' | 'NO_DATA';
  observed: string | null;
  threshold: string | null;
  unit: string | null;
  evidence_capture_keys: string[];
  reason: string | null;
};

type DashboardResponseExtension = {
  checks: CouncilCheck[];
};
```

[VERIFIED, source read: `web/local-terminal.html:147-169`, 2026-09-24] `/research/` separates the live Falcon allocation policy from a static stock strategy library. The library labels its templates `NOT IMPLEMENTED` and `NOT BACKTESTED`. It links to [OpenTerminalUI](https://github.com/Hitheshkaranth/OpenTerminalUI), [ticker](https://github.com/achannarasappa/ticker), and [stocksTUI](https://github.com/andriy-git/stocksTUI). The page states that historical backtests need a history source and route.

## Production Devnet app browser boundary

[VERIFIED, official SIWS specification read, 2026-09-24] [Sign In With Solana](https://github.com/phantom/sign-in-with-solana) defines domain, address, URI, version, chain ID, nonce, issue time, and expiry fields. Its Devnet chain ID may be `solana:devnet`. The wallet signs a message, not a blockchain transaction.

[VERIFIED, implementation contract, source read 2026-09-24] Provider: browser-injected Solana wallet. Consumer: production `/app/`. Input: wallet public key and a fresh SIWS-formatted message bound to the current origin. The sign-in message omits `chainId`; the separate trade path is fixed to Devnet. Output: an Ed25519-verified local session proof. The page stores the signed proof in this browser and rechecks its origin, nonce shape, issue time, expiry, and signature after reload. This matches `SPEC.md` I13 and `web/app/app.mjs:269`.

[VERIFIED, Phantom SIWS specification, read 2026-09-24] The specification says: “If not provided, the wallet must not include Chain ID in the message.” Source: [Phantom Sign In With Solana specification](https://github.com/phantom/sign-in-with-solana).

[INFERRED, storage boundary, 2026-09-24] Provider and consumer: browser local storage. Keys include the wallet address and Devnet network. Records contain only public wallet addresses, saved mint addresses, order fields, transaction signatures, and status labels. No private key or signed transaction is stored. This persistence is local to one browser profile. It is not server authentication or cross-device sync. No production API may trust this browser-only proof.

[INFERRED, Devnet data boundary, 2026-09-24] Provider: `https://api.devnet.solana.com`. Consumer: `/app/`. Read methods: `getBalance`, `getTokenAccountsByOwner` for legacy SPL Token and Token-2022 accounts, `getSignaturesForAddress`, and `getTokenSupply`. The app uses this exact RPC for portfolio, recent transaction, token-decimal, simulation, send, and confirmation calls.

[INFERRED, Devnet order boundary, 2026-09-24] Provider: the existing `web/copilot/execution.mjs` Devnet quote and transaction builder. Input: configured Raydium CPMM pool, input mint, output mint, base-unit amount, and connected wallet. Output: one unsigned transaction after on-chain pool owner, discriminator, mint-pair, quote-route, and response-count checks. The browser then simulates the exact message, requests wallet signing after an explicit user action, verifies the returned message and signer, checks blockhash expiry, sends to Devnet, and records the signature and confirmation state.

[BOUNDARY, strategy status, 2026-09-24] The production app has no connection to the localhost-only council API. The research templates remain reference-only, and the current council is advisory-only. A Devnet swap quote is not a stock strategy signal. The app must show those states as unavailable until a production data and strategy API exists.

[VERIFIED, correction, source read 2026-09-24] The preceding provider assignment is superseded. Production `/app/` imports `web/app/devnet-execution.mjs`, which fixes RPC calls to `DEVNET_RPC` from `web/app/data.mjs`. The local `/copilot/` page continues to use `web/copilot/execution.mjs`. The production build check must confirm that Surfpool and Jupiter endpoint strings are absent from the app bundle.
## Treasury simulation addition, 2026-09-26

[INFERRED, current interface index] Interface `I14` is defined in [the treasury simulation contract](treasury-contract.md). Owner: architect. Provider: `web/treasury/`. Consumers: the local treasury UI and tests. Version 1 is simulation-only and does not change the earlier plugin, stocks engine, or Devnet interfaces.
