# First research slice interfaces

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

[VERIFIED, source read: `web/copilot/execution.mjs`] Jupiter supplies quote and unsigned swap data. The browser uses the Surfpool RPC at `http://127.0.0.1:8899` for blockhash, simulation, and send calls. The local copilot accepts no devnet or public mainnet RPC target.

[VERIFIED, source read: `web/copilot/index.html` and `web/vite.config.js`] The connected wallet signs after a successful Surfpool simulation and an explicit user click. The page checks the signed message before sending. Vite does not include `/copilot/` in production build entries.

[VERIFIED, official Surfpool docs] Surfnet is a local Solana simulator with mainnet fork support. See the [Surfpool RPC overview](https://docs.surfpool.run/rpc/overview). This interface does not send a transaction to public mainnet.
