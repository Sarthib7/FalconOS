# Citadel as a FalconOS memory and agent-state candidate

- Source: https://github.com/masumi-network/Citadel
- Date fetched: 2026-08-28
- Author: [REPORTED] masumi-network organization
- Provenance: REPORTED. Distilled from the source; claims are the author's, not independently verified.

## TLDR

[REPORTED] Citadel presents a self-hosted, source-linked memory service for engineering teams and coding agents. It separates private seat Nodes, shared Central knowledge, and voluntarily shared Session Traces. Hooks and scheduled connectors capture material, while policy gates, secret scanning, promotion, scoped tokens, audit events, and retrieval metadata control how it becomes searchable. The design treats canonical knowledge, retrieval indexes, graph projections, and retained evidence as different layers. It also states important limits: most current hits are unattested, body-derived labels can be steered, the live retrieval path has had large coverage and latency gaps, and several durable-evidence and backend decisions remain unimplemented.

## Purpose and boundary

**Core rule:** [REPORTED] Use Citadel as a source-linked context router and institutional memory, not as an authority that makes mutable facts true.

[REPORTED] The README targets self-hosted team memory for humans and agents. It captures commits, pull requests, tickets, coding sessions, repository content, and approved files behind CLI, HTTP, web, and MCP interfaces. It says retrieved text is untrusted context and should link back to its source.

[REPORTED] The repository explicitly says it is in testing, not open for general use. Its own benchmark section reports a 25 second search median on 2026-08-17, about one third of stored documents unreachable by search, and head-only embedding that leaves later text unreachable. It says the recall figure does not describe the whole corpus.

Do:

- [REPORTED] Keep citations and source links beside retrieved answers.
- [REPORTED] Verify API, specification, and payment asset claims against live canonical sources.
- [REPORTED] State when the vault was unavailable or returned no authoritative hit.

Do not:

- [REPORTED] Claim that Citadel confirms a fact without a successful hit with title and snippet.
- [REPORTED] Treat `content_hint`, `doc_type`, or a Central hit as proof of correctness.
- [REPORTED] Treat a green health check or nonzero vector count as proof that search works.

Workflow and code shape: [REPORTED] Search first, then use the citation to verify. Keep the vault as a context source, not the final policy or execution authority.

## Memory layers and ownership

**Core rule:** [REPORTED] Separate private working memory, shared prior work, curated organization knowledge, rebuildable projections, and retained evidence.

[REPORTED] A Seat represents one human principal. A Node named `seat:{slug}` is that seat's private working memory. Central, named `masumi-network`, is shared organization knowledge. `session-traces` is a third dataset for traces that a member explicitly volunteers. Central is curated, while Node captures are light-tier material and shared traces are reference-only.

[REPORTED] Structured Knowledge is intended to be durable source-linked knowledge owned by Citadel. The Knowledge Index and Knowledge Mesh are rebuildable projections. A Vault Backup Mirror is secondary recovery storage, not a runtime store. The later ADR-0022 design adds retained Source Snapshots with capture-time fingerprints and a signed chain, but the ADR index marks it not yet implemented.

Do:

- [REPORTED] Keep a seat's raw captures in its Node by default.
- [REPORTED] Keep shared traces separate from canonical Central knowledge.
- [REPORTED] Make indexes and graph data rebuildable from durable records.
- [REPORTED] Use dual-write for promotion so the private original remains available.

Do not:

- [REPORTED] Mirror every private note into Central.
- [REPORTED] Read another seat's Node through a token, dataset name, or session id.
- [REPORTED] Use a backup mirror as the live retrieval store.
- [REPORTED] Synthesize shared episodic traces into canonical pages.

Workflow and code shape: [REPORTED] Route writes by storage scope, not only by principal identity. Give each dataset explicit read and write rules. Preserve source pointers now; add retained evidence when the evidence store exists.

## Tiered capture, learning, and promotion

**Core rule:** [REPORTED] Apply processing and disclosure proportional to the claim a piece of content makes.

[REPORTED] Light ingestion stores raw Node agent memory with indexing and no generative enrichment. Shared Session Traces may be distilled and indexed but never synthesized. Full processing applies to organization syncs and promotion, with security review, enrichment, and structuring on the Central path. The source glossary says canonical synthesis belongs only to the full tier.

[REPORTED] Approved Capture Roots allow automatic capture to a Node after setup. Git pre-push and manual `citadel capture` are v1 triggers. SessionEnd capture is optional. There is no file watcher or local schedule in v1. Root tags mark `personal`, `org-work`, or custom roots. Only `org-work` roots may auto-promote, and only after other checks pass. Personal and custom roots do not auto-promote.

[REPORTED] The Promotion Agent runs on a six-hour schedule and on demand. It scans secrets, checks capture tags where applicable, compares repository hints with the masumi GitHub organization list and Central, then always runs LLM relevance and sensitivity classification. Known org work may auto-promote. A New Org Project enters an approval queue. A note without a repository hint requires a strong Central match or remains in the Node.

[REPORTED] The source contains a direct contradiction. Earlier ADR-0003 text describes seat org-tag writes reaching Central, while its correction and ADR-0007 remove that path. ADR-0007 says all seat-scoped writes are Node-only. It also first described members approving their own queue items, then amended the decision on 2026-07-31 so only admins can approve or reject. The report keeps both statements because the repository itself records the walk-back.

Do:

- [REPORTED] Run one security gate before enrichment and chunking on every write path.
- [REPORTED] Make promotion a copy with origin, actor, timestamp, and decision metadata.
- [REPORTED] Require explicit approval for writes outside approved roots.
- [REPORTED] Keep rejection sticky until note content changes.
- [REPORTED] Treat LLM classification as a safety check, not as proof of organizational truth.

Do not:

- [REPORTED] Let capture tags route a seat write directly to Central.
- [REPORTED] Auto-share raw sessions or entire chats.
- [REPORTED] Use the approval queue as a replacement for private-by-default capture.
- [REPORTED] Enrich private Node memory when privacy requires local-only handling.

Workflow and code shape: [REPORTED] capture to Node, scan, classify, resolve organization references, then auto-promote, queue, or retain privately. Keep org sync and Promotion as the only governed Central paths for seat content.

## Identity, access, and agent boundaries

**Core rule:** [REPORTED] Give every human and agent process a distinct, scoped, revocable identity, and enforce scope at query and write time.

[REPORTED] Citadel defines Seats as one-human principals and Agent Identities as separate service-account principals. Tokens carry role, scopes, default dataset, default session, allowed datasets, expiry, and last-used time. Persistent tokens are shown once and stored as hashes. Reader, writer, and admin roles have increasing permissions. Admin is provisioned directly, not as a seat.

[REPORTED] A non-bypass caller can read its own Node plus Central, but not another seat's Node. Session-scoped recall is a second isolation axis because it can ignore dataset allowlists, so non-bypass callers may name only their own default session. Admin and environment bootstrap callers bypass some scope checks, with audit records for overrides.

[REPORTED] Agent-to-agent communication belongs to Masumi Agent Messenger. Citadel is shared memory and access control. Messenger messages do not become durable vault contributions unless an authorized actor writes them.

Do:

- [REPORTED] Use a reader token for normal search and a writer token only when ingest is needed.
- [REPORTED] Use one token per agent process and one intentional dataset scope per service.
- [REPORTED] Keep tokens in environment variables, never in tracked config or command arguments.
- [REPORTED] Require approval for sync, improve, delete, reindex, token, seat, and conflict actions.
- [REPORTED] Audit actor, role, tool, dataset, success or failure, and request id.

Do not:

- [REPORTED] Share a token across users or agent processes.
- [REPORTED] Assume an empty dataset allowlist grants access to another seat Node.
- [REPORTED] let retrieved text override system or developer instructions.
- [REPORTED] use a broad admin token for routine agent search.

Workflow and code shape: [REPORTED] Put one MCP server behind the access model. Keep skills as guidance and MCP as the capability boundary. Resolve token fields before principal defaults and server defaults. Reject an invalid or unreadable expiry rather than silently treating it as permanent.

## Provenance, trust, auditability, and conflicts

**Core rule:** [REPORTED] Distinguish what the server attests from what text merely resembles, and preserve disagreements instead of silently overwriting.

[REPORTED] ADR-0012 separates `trust_tier` from `content_hint`. Trust must come from server-attested provenance. Content hint describes body shape and may be steered by the writer. Current attestation is weak: shared traces may be `reference-only`, while most other content is `unattested`. Dataset labels are not reliable provenance. ADR-0017 says structural repository and source headers outrank inherited trace labels, but only a full structural header qualifies.

[REPORTED] Search envelopes include citation, dataset, result id, content hash, retrieval metadata, document type, content hint, and trust tier. The system marks retrieved content as untrusted context and requires citation. Implicit search telemetry records query, filters, top hits, scores, trust labels, latency, and empty or low-score flags. The source warns that this does not make forgery impossible.

[REPORTED] Knowledge Conflicts remain visible when source-linked knowledge disagrees. Obsidian stale-base conflicts and title or hash conflicts are surfaced and auditable. ADR-0010 proposes per-topic canonical pages updated in place, with contradiction detection and recoverable prior versions.

[REPORTED] ADR-0016 requires byte-identical rendering for unchanged sources. It removes retrieval timestamps from document bodies because timestamps defeated content deduplication. ADR-0022 proposes capture-time SHA-256, a hash chain, scheduled signed chain heads, and W3C PROV vocabulary. It explicitly says signatures prove captured bytes and order, not that the content is correct. The repository marks this ADR not yet implemented.

Do:

- [REPORTED] Store source identity, version, locator, and capture time as structured fields.
- [REPORTED] Hash retained bytes at capture and distinguish that from a read-time transit digest.
- [REPORTED] Keep old and new claims visible during a conflict.
- [REPORTED] Name counters for their scope and exact population.

Do not:

- [REPORTED] infer authority from keywords, labels, or a document body.
- [REPORTED] treat a signed capture as proof that the captured claim is true.
- [REPORTED] report process-uptime counters as corpus totals.
- [REPORTED] render an unknown count as zero. Citadel's later rule is to show an explicit unavailable state.

Workflow and code shape: [REPORTED] attach provenance at the ingest and retrieval boundaries. Keep source evidence append-only and let the Learning Process update derived knowledge without rewriting the evidence layer.

## Retrieval, indexing, concurrency, and offline behavior

**Core rule:** [REPORTED] Make the retrieval contract independent from any engine, and report projection state separately from source retention.

[REPORTED] Citadel currently uses Cognee for embeddings and graph operations. ADR-0010 and ADR-0021 propose a narrow Citadel-owned retrieval interface with ingest, query, provenance, and scores. The interface must not expose engine-native objects. The rationale includes missing or unreliable upstream scores and heavy dependence on private Cognee internals.

[REPORTED] Accepted writes may become source-searchable before vector projection and graph work complete. ADR-0025 adds a durable dataset-level cognify retry queue with atomic replacement, fsync, leases, bounded backoff, startup drain, and fail-closed corruption handling. The queue stores dataset and retry metadata, not document bodies.

[REPORTED] The source records a major concurrency constraint. Cognee's embedded graph uses a single-writer file lock, so one process must own the graph. A second worker or separate evolve service is unsafe until the graph store moves. ADR-0020 accepts PostgreSQL graph storage and per-dataset graph contexts as a future migration, followed by a full re-cognify.

[REPORTED] A local stdio MCP wrapper is available for offline or development use, but it forwards to an HTTP API and does not make the hosted vault locally available. The reviewed docs describe deterministic lexical fallback in newer lifecycle paths, but also say the deployed route had not proven this and that live MCP search returned 504. Offline use therefore means local client transport or self-hosted operation, not guaranteed offline access to the hosted corpus.

Do:

- [REPORTED] Keep source retention, vector projection, graph projection, and retrieval status as separate states.
- [REPORTED] Persist deferred work and recover leases after process restart.
- [REPORTED] Cache graph reads and serialize graph writes when using a single-writer engine.
- [REPORTED] Benchmark alternate retrievers against frozen fixtures before replacing the engine.

Do not:

- [REPORTED] infer searchable coverage from accepted ingest alone.
- [REPORTED] run multiple workers against the embedded graph store.
- [REPORTED] hide a failed projection as an empty queue or empty vault.
- [REPORTED] call a local stdio wrapper offline if the source data still lives on the hosted service.

Workflow and code shape: [REPORTED] define a retrieval adapter with stable result fields and capability declarations. Use source or lexical lookup as a deterministic baseline, then add vectors and graph projections with receipts and retries.

## Security and privacy

**Core rule:** [REPORTED] Fail closed on high-risk content, minimize disclosure, and assume retrieved context can contain injection or false claims.

[REPORTED] The security scanner covers access tokens, database URLs, GitHub tokens, LLM keys, cloud keys, private key markers, credential assignments, risky URLs, corruption markers, and bidirectional controls. It returns redacted finding summaries and blocks at configured severity. Citadel says the same service-layer gate should protect HTTP, MCP, hooks, autosync, and promotion.

[REPORTED] The README qualifies self-hosting. Storage runs where the operator chooses, but document text is sent to an external model provider for enrichment and digests when enabled. The sample environment enables enrichment, while the code default is off. Operators must inspect deployment configuration instead of assuming either setting.

[REPORTED] Shared traces accept a known risk: cross-seat prompt injection is contained by typed fields, split result classes, reference-only demotion, and attribution, but not prevented. Public source material can also enter organization digests, so public issue text can influence body-derived labels unless structural provenance controls it.

Do:

- [REPORTED] Scan before enrichment, chunking, and promotion.
- [REPORTED] Redact secrets from errors, logs, and audit details.
- [REPORTED] Keep personal and shared trace content out of external models when the tier promises that boundary.
- [REPORTED] Keep external model, hosting, and region choices explicit in deployment records.

Do not:

- [REPORTED] claim self-hosting means document text never leaves the deployment.
- [REPORTED] expose secret values in update digests or communication surfaces.
- [REPORTED] treat prompt-injection containment as prevention.
- [REPORTED] allow raw private keys or wallet credentials into agent memory.

Workflow and code shape: [REPORTED] use a single centralized policy gate and redaction path. Return safe metadata for blocked writes, not the matched secret or original body.

## Deployment and migration

**Core rule:** [REPORTED] Keep each organization's vault isolated, reproducible, observable, and independently recoverable.

[REPORTED] ADR-0023 proposes one dedicated deployment per organization, with a separate control plane for signup, provisioning, billing, lifecycle, domains, secrets, regions, and fleet telemetry. Citadel must not learn about other instances. The design rejects in-code multitenancy as harder to prove to buyers and accepts a fixed per-organization cost floor.

[REPORTED] The operations guide describes a current Railway Lite web profile using SQLite, Qdrant, and Ladybug, while older self-host instructions use PostgreSQL, pgvector, and Ladybug with a volume. It warns against starting the published web image with the older `scripts.run_railway` command. Version and commit identity must remain separate: a release version or deployment id cannot substitute for an exact commit.

[REPORTED] The backup mirror currently exports a manifest with paths, sizes, timestamps, and SHA-256 values. It does not copy source bodies, token stores, embeddings, vector indexes, or graph indexes. ADR-0022 proposes replacing this manifest-only approach with retained evidence, but the repository marks that decision unimplemented.

[REPORTED] Deployment state is not always readiness. The docs distinguish liveness `/healthz`, dependency readiness `/health/ready`, and authenticated `/readyz`. They record production cases where deployment and Qdrant health were green while lifecycle readiness and MCP search were not proven. They require known-answer CLI and MCP searches with citations before accepting a deployment.

Do:

- [REPORTED] Pin dependencies and checksum critical external tools.
- [REPORTED] Keep persistent state, retry queues, and connector cursors on durable storage.
- [REPORTED] Run dry-run inventory and reconcile discovered, skipped, blocked, and searchable counts.
- [REPORTED] Test backup restore and post-repair corpus census before claiming recovery.
- [REPORTED] Treat fleet upgrades as versioned migration campaigns.

Do not:

- [REPORTED] use one shared credential across instances.
- [REPORTED] scale workers before the graph backend supports concurrent openers.
- [REPORTED] call a manifest-only mirror a backup of the corpus.
- [REPORTED] accept deployment green status as evidence that retrieval works.

Workflow and code shape: [REPORTED] provision instance artifacts from a versioned contract. Run a bounded known-answer canary through the same CLI and MCP paths that agents use.

## What Citadel does not guarantee

[REPORTED] The source does not guarantee that retrieved content is correct, current, complete, or authoritative. It says the vault is untrusted context and that most current trust is `unattested`.

[REPORTED] It does not guarantee complete search coverage, low latency, or graph readiness after ingest. Its own benchmark reports unreachable documents, head-only embedding limits, ranking problems, and a 25 second median. The operations record includes live 504 search responses and unresolved production readiness mismatches.

[REPORTED] It does not guarantee tamper-proof history under an operator-held signing key. ADR-0022 says a signed chain does not prove that the operator did not rewrite and re-sign it. It also does not guarantee that a signed document is true.

[REPORTED] It does not guarantee that self-hosting keeps all document text inside the customer's infrastructure when external LLM enrichment is enabled.

[REPORTED] It does not prevent prompt injection. The shared-trace ADR calls containment an accepted risk. It does not provide an agent payment rail, wallet authority boundary, transaction verifier, or financial outcome guarantee in the reviewed material. Its payment-related agent guidance says Mainnet token units and asset IDs require official verification, not vault authority.

[REPORTED] It does not guarantee offline access to the hosted corpus. Its local stdio wrapper is a transport adapter, while source data remains on the configured HTTP service unless a separate self-hosted deployment is used.

## FalconOS fit

[INFERRED] **Strong fit for later Brain and Cloud memory substrate:** Citadel's Node, Central, source-linked retrieval, policy-gated promotion, scoped agent tokens, audit metadata, retry queue, and conflict handling map well to Brain context and Cloud operational state. The separation between raw strategy memory, shared traces, canonical knowledge, projections, and evidence matches FalconOS's need to keep strategy memory, user policy, protocol facts, model parameters, and decision outcomes separate.

[INFERRED] **Useful Phase 0 pattern, not a drop-in dependency:** Phase 0 needs a small local and verifiable control path. Citadel's source-linked citations, byte stability, deterministic lexical fallback, append-only conflict model, explicit approvals, and fail-closed secret scan are useful patterns. Its current scale, external LLM dependency, hosted retrieval latency, incomplete source coverage, and Python service footprint are too large for the minimum founder loop unless reduced to a local evidence and context component.

[INFERRED] **Authoritative control state must remain outside Citadel's advisory memory:** FalconOS policy versions, typed intents, state snapshot hashes, signed decision receipts, transaction bindings, signer authority, account locks, and reconciliation records should be authoritative control state. Citadel can index and retrieve these records, but a Citadel hit must never authorize an action. A signed Citadel capture attests bytes and provenance only; it cannot replace FalconOS receipt signatures or deterministic verifier output.

[INFERRED] **Signed replay evidence needs a separate contract:** Citadel's proposed capture-time hash chain and PROV vocabulary could support source evidence. FalconOS still needs an append-only outcome ledger that binds intent, policy, model and graph versions, exact transaction, simulation, signature scope, confirmation, and post-action reconciliation. The Citadel evidence ADR is marked unimplemented, so FalconOS cannot depend on it without an independent implementation and verification plan.

[INFERRED] **Concurrency and offline gaps matter:** The embedded graph's single-writer design conflicts with Cloud workers, supervisors, and concurrent Brain requests. PostgreSQL graph storage is proposed but not yet a stable dependency. FalconOS should start with a local durable store plus deterministic lookup and add semantic retrieval behind an adapter after measurement. Hosted Citadel cannot satisfy offline replay by itself.

[INFERRED] **Privacy and payment gaps remain:** FalconOS must keep wallet identity, risk preferences, transaction material, and service payment state under its own boundaries. Citadel's external enrichment path requires explicit data classification and opt-out or local model operation for sensitive records. Citadel does not provide x402 payment settlement, Solana signer constraints, or separation of trading collateral from service money.

[INFERRED] **Migration risk is moderate to high:** Citadel has a moving architecture, two documented storage profiles, a pinned upstream dependency, proposed retrieval and evidence seams, and a substantial Python service surface. A clean integration should consume stable HTTP or MCP contracts, export source ids and hashes, and avoid coupling FalconOS to Cognee objects, Kuzu or Ladybug files, or Citadel's internal dataset implementation.

## Rules to adopt

1. [INFERRED] Keep authoritative policy, receipts, signatures, transaction bindings, and reconciliation outside advisory memory.
2. [INFERRED] Store every memory item with owner, dataset, source locator, version, capture time, and content hash.
3. [INFERRED] Separate private working memory, voluntarily shared traces, canonical knowledge, indexes, graphs, and replay evidence.
4. [INFERRED] Default agent writes to private scope, and require a governed promotion path for shared truth.
5. [INFERRED] Give each agent process a distinct, least-privilege, revocable identity.
6. [INFERRED] Enforce dataset and session isolation at the server boundary, not in prompts or client conventions.
7. [INFERRED] Scan and redact before enrichment, indexing, logging, or external delivery.
8. [INFERRED] Treat retrieved text as untrusted context and require source citations before use.
9. [INFERRED] Keep body-derived labels as ranking hints, never as authority or approval evidence.
10. [INFERRED] Preserve conflicting claims and require an explicit resolution record.
11. [INFERRED] Make unchanged source rendering byte-identical so deduplication and replay remain stable.
12. [INFERRED] Record source retention, vector indexing, graph projection, and retrieval readiness as separate states.
13. [INFERRED] Persist deferred work with atomic writes, leases, bounded retries, and startup recovery.
14. [INFERRED] Use deterministic lookup as a baseline when embeddings or LLM services fail.
15. [INFERRED] Keep evidence append-only and fingerprint it at capture, not only at read.
16. [INFERRED] Treat signed evidence as proof of captured bytes and sequence, not proof of truth.
17. [INFERRED] Require known-answer searches through real agent paths before declaring deployment ready.
18. [INFERRED] Keep backup artifacts distinct from the runtime store, and test restore before relying on them.
19. [INFERRED] Keep agent communication separate from durable shared memory unless an authorized actor records it.
20. [INFERRED] Make organization, region, dependency, and schema changes versioned migration events.

## Source tree coverage and unresolved fetches

[VERIFIED] The GitHub API recursive tree for `main` was enumerated and returned `truncated: false`. I read the principal argument and implementation files listed below:

- `README.md`, `CONTEXT.md`, `AGENTS.md`
- `docs/architecture.md`, `docs/concepts.md`, `docs/agent-access-model.md`, `docs/operations.md`, `docs/mcp/README.md`
- `docs/adr/README.md`, ADRs `0003`, `0005`, `0007`, `0010`, `0011`, `0012`, `0015`, `0016`, `0017`, `0018`, `0019`, both `0020` files, `0021`, `0022`, `0023`, and `0025`
- `kb/access.py`, `kb/security_scan.py`
- FalconOS comparison source: local `VISION.md`, sections 9 to 21

[REPORTED] The recursive tree also contains many implementation modules, tests, generated web exports, lockfiles, branding assets, and deployment helpers. I did not individually fetch every one of those files. They are not silently treated as read. In particular, unresolved repository files include the remaining `kb/*.py`, `scripts/*.py`, `tests/*.py`, `web/src/**`, `plugins/**`, `skills/**`, `.github/workflows/**`, and root deployment/configuration files not listed above.

[REPORTED] Central linked material not fetched: the Cognee repository and release sources, the private `Vault-Backup-Mirror` repository, Citadel hosted `/skills/*` pages and discovery manifest, Railway live state, GitHub issues and pull requests cited by ADRs, and external OpenRouter, W3C PROV, MCP, Linear, and Google Chat documentation. These links were listed as external or not fetched rather than treated as verified source content.
