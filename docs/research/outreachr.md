# Research: outreachr patterns for FalconOS

- URL: https://github.com/lalalune/outreachr
- Commit studied: `23b7dcc5f731e3abc47c66dd6c09e69df4427d99` (2026-09-06, v0.1.2 source) [VERIFIED, `git log -1`]
- Date: 2026-09-10
- Author: Fable 5 research agent, session for sarthi
- Model: anthropic/claude-fable-5
- Provenance: REPORTED. Distilled from the source; applicability to FalconOS is marked INFERRED.
- Method: full clone at `/tmp/falconos-source/outreachr` (349 tracked files [VERIFIED, `git ls-files | wc -l`]). Root docs and `packages/connectors/src/{errors,http,safety}.ts` read directly by this agent. The four package slices were read in full by four read-only subagents; their citations are marked [REPORTED, scout]. No build, test, or network probe of the repo was run.

## TLDR

Outreachr is a local-first Electron fundraising CRM. Its domain (email outreach, OAuth mailboxes, CRM pipeline) does not match FalconOS. Its safety architecture does. The repo treats one irreversible external action (an email send) exactly the way FalconOS must treat a live trade: exact-content approval hashes, a claim-before-dispatch idempotency ledger, a terminal "ambiguous" state that forbids automatic retry, reconciliation from an authoritative external record, durable DB-enforced rate limits, a hash-chained append-only audit log, and proposal-only agents whose output is scanned for executable intent. There is no general task queue and no browser automation in the repo; neither should be imported. Adopt the send-path invariants for FalconOS P2/P3; reject the CRM, mail, calendar, cloud billing, and UI layers.

## Major concepts

### 1. One irreversible action, one state machine

[VERIFIED read] `docs/architecture.md:24` states the email lifecycle: `draft → approved → reserved → dispatching → sent | ambiguous`. [REPORTED, scout] `packages/core/src/migrations.ts:251-278` encodes message states `draft | approved | reserved | sent | failed_safe | cancelled` and approval states `active | used | revoked | expired`, with a partial unique index allowing one `active` approval per message. `packages/core/src/repository.ts:1111-1118` makes `reserved → dispatching` an atomic conditional UPDATE that errors unless exactly one row changed. A failure can reach `failed_pre_dispatch` only from `reserved`; once `dispatching`, the safe-failure escape is gone (`packages/core/src/repository.ts:1248-1260`).

[INFERRED] This is the shape FalconOS P3 needs for a live cycle: `proposed → approved → reserved → submitting → confirmed | ambiguous`, with "safe failure" reachable only before submission.

### 2. Exact-content approval binding

[VERIFIED read] `packages/connectors/src/safety.ts:140-230` (`assertSendAllowed`): a send needs an operation key matching `^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$`, `approved=true`, a parseable approval time, an unchanged send context, and an unchanged SHA-256 content fingerprint; mismatch throws `APPROVAL_STALE`, absence throws `APPROVAL_REQUIRED`. [REPORTED, scout] The fingerprint is versioned (`version: 2`) and covers recipients, content, headers, account, message kind, and thread (`packages/connectors/src/safety.ts:65-92`). SQLite triggers re-check the approval independently at reservation time, so bypassing the repository does not bypass the gate (`packages/core/src/migrations.ts:323-354`). Any communication-policy or footer change revokes every active approval (`packages/core/src/migrations.ts:1011-1025`); editing content returns the message to `draft` (`packages/core/src/migrations.ts:315-321`).

[INFERRED] FalconOS equivalent: bind user approval of a trade to a hash over route, exact integer amounts, venue, quote evidence hashes, and signer identity. Any change to policy or inputs invalidates the approval. This extends the existing evidence-hash practice in `docs/agent-contract.md` (caller-supplied `expectedEvidenceSha256`).

### 3. Claim-before-dispatch idempotency ledger

[REPORTED, scout] `packages/connectors/src/send.ts:32-66`: the executor claims a `pending` receipt in a durable ledger before any network call; a losing claim returns the existing receipt with `replayed=true`, so duplicate invocations never reach the provider. The ledger contract is three methods, `claim` / `update` / `get`, with atomic uniqueness on `operationKey` (`packages/connectors/src/types.ts:125-138`). Core enforces lifetime dedupe with unique indexes on message, normalized recipient, canonical person, and `(provider, provider_message_id)` (`packages/core/src/migrations.ts:294-313`). Every outbound message carries the operation key in an `X-Outreachr-Operation-Key` header so the provider's own record can later prove what happened (`packages/connectors/src/mime.ts:20-40`).

[INFERRED] FalconOS P2/P3: reserve an operation id in the run ledger before quoting-for-execution or submitting a transaction, and embed that id (memo or client id where the venue allows it) so chain state can be matched back.

### 4. Ambiguity is terminal for automation

[VERIFIED read] `packages/connectors/src/http.ts:111-191`: a network drop, 408, or 5xx during a send or create becomes `AMBIGUOUS_SEND` / `AMBIGUOUS_CREATE` with `mayHaveSucceeded=true` and `retryable=false`. Only an explicit 429 is retryable for a send. Reads may retry network errors and 5xx. [REPORTED, scout] Core has zero retry counters or backoff anywhere; `markSendAmbiguous` audits `send.ambiguous_no_retry` (`packages/core/src/repository.ts:1149-1156`). An ambiguous send may become `sent` only through reconciliation against the provider's authoritative sent-mail record, matched on the operation key, within 30 days and 5 minutes of clock skew (`packages/core/src/repository.ts:1159-1239`). The comment at `packages/connectors/src/http.ts:29` claims sends retry 408; the code excludes it. Do not copy comments as contracts.

[INFERRED] Direct match to the FalconOS roadmap CP3 failure response ("reconcile unknown submissions before retrying", `plans/roadmap.md:42`). A dropped RPC connection after `sendTransaction` is exactly `mayHaveSucceeded=true`: never re-sign; look up the signature on chain.

### 5. Retry policy for reads

[VERIFIED read] `packages/connectors/src/http.ts:10-14,59-62`: default `{ maxAttempts: 3, baseDelayMs: 250, maxDelayMs: 5000 }`, exponential `base * 2^(attempt-1)` capped at `maxDelayMs`. Server-directed delay wins: `x-ms-retry-after-ms` first, then `retry-after` as seconds or HTTP date, clamped to `>=0` and capped (`http.ts:46-57`). Provider request ids are captured from `request-id` / `x-ms-request-id` headers into every receipt and error (`http.ts:102-108`).

[INFERRED] FalconOS `src/sources.ts` currently forbids retries inside one scan (`docs/interfaces.md:23`), which is correct for evidence freshness. Adopt the classification, not the loop: record `retryable`, `retryAfterMs`, and provider request id on each failed observation so the next scan cycle can pace itself honestly.

### 6. Rate limits as durable data, enforced twice

[REPORTED, scout] Defaults live in SQLite: `daily_send_limit=10`, `hourly_send_limit=3`, `recipient_domain_daily_limit=2`, `recipient_domain_cooldown_minutes=30`, `sending_paused=0` (`packages/core/src/migrations.ts:563-570`). Triggers enforce pause, daily count, rolling prior-hour window, per-domain daily quota, and cooldown at reservation time, excluding only `failed_pre_dispatch` rows from the counts (`packages/core/src/migrations.ts:572-588,1073-1113`). The IPC layer bounds the configurable ranges separately (`apps/desktop/src/main/command-service.ts:277-283`). The connectors package itself has no proactive limiter; pacing is a persistence-layer invariant.

[INFERRED] FalconOS's 60-second minimum interval lives only in `src/cli.ts` process memory; two processes do not share it (README:49). A durable request counter in the evidence root would make pacing survive restarts and multiple entry points. For P3, per-venue and per-day execution caps belong in durable state checked at reservation, not in the executor.

### 7. Hash-chained append-only audit log

[VERIFIED read] `docs/architecture.md:44-46` and `docs/privacy-and-threat-model.md:26`: every security event appends to `audit_log` plus `audit_chain` in one savepoint; each hash commits to the full canonical event and the previous hash; UPDATE/DELETE triggers make both tables append-only; the chain is verified at startup, in the UI, and at export. [REPORTED, scout] Implementation at `packages/core/src/repository.ts:203-329`; startup refuses to run on a broken chain (`apps/desktop/src/main/index.ts:220-243`). Audit actions are stable dotted names (`send.reserved`, `send.ambiguous_no_retry`, `agent.proposal_accepted`).

[INFERRED] FalconOS already writes canonical JSON evidence with SHA-256 per record. The missing piece is the chain: link each run record to the previous record's hash so deletion or reordering of evidence is detectable. Cheap to add in `src/vault.ts`.

### 8. Secrets: fail closed, reference by URI, redact by allowlist

[VERIFIED read] `SECURITY.md:9-10`: tokens are encrypted with Electron `safeStorage`; the app fails closed when secure encryption is unavailable; the vault holds no plaintext secrets. `docs/credentials.md:47-53`: Linux `basic_text` backend is refused; secret entry fields are write-only and cleared after save. [REPORTED, scout] The DB stores only a `secret_ref` with a CHECK constraint restricting schemes to `keychain://`, `credential-manager://`, `secret-service://`, `secure-store://`, `external-agent://`, `memory://` (`packages/core/src/validation.ts:253-264`). Child processes get an allowlisted environment; diagnostics redact `sk-*`, bearer tokens, and OAuth material (`packages/agents/src/process.ts:22-93`). Cloud logging is allowlist-style: `{event, path, errorType}` only (`apps/cloud/src/app.ts:112-127`).

[INFERRED] FalconOS has no secrets in slice 1 (invariant F1). Adopt these rules the day a signer or paid API key arrives (P3 / D1 authenticated calls): OS keychain or refuse to persist, secret-reference URIs in evidence rather than values, allowlisted child env for the Codex adapter, allowlist logging. FalconOS status.md already records a real incident of a credential leaking through `pgrep` process arguments; the allowlisted-child-env pattern addresses that class.

### 9. Proposal-only agents with output scanning

[VERIFIED read] `docs/agents.md:41-52`: agents get read tools plus three proposal tools; proposals are durable `pending` rows; no MCP method can send, queue, retry, or schedule; the MCP bridge binds 127.0.0.1, needs an ephemeral 256-bit bearer plus run header. Codex runs with `approvalPolicy: "never"`, read-only sandbox, inherited MCP servers disabled, and the full runtime tool inventory verified against the run allowlist before the prompt is sent. [REPORTED, scout] Output is a closed JSON schema (`additionalProperties: false`, max 100 proposals, summary max 8000 chars); the parser rejects payload keys tokenized as `send`, `dispatch`, `execute`, `schedule`, `deliver`, `publish`, `delete`, and forces `executable: false` on everything accepted (`packages/agents/src/output.ts:18-110,183-225`). MCP tool calls audit `requested` before execution and withhold the result if the `succeeded` audit write fails (`packages/mcp/src/server.ts:214-306`). The JSONL transport denies every server-initiated request with `-32000`, so an interactive provider cannot escalate (`packages/agents/src/jsonl-transport.ts:145-171`).

[INFERRED] FalconOS `docs/agent-contract.md` already has strict JSON, no unknown fields, `executionReady: false`, and hash-verified evidence. Worth adding from outreachr: the forbidden-token scan over the thesis payload, the audit-before-dispatch ordering in `src/codex.ts`, and the pre-run tool inventory check (FalconOS already found the Codex approval-flag gap in `status.md`; outreachr verifies inventory at runtime instead of trusting flags).

### 10. Durable intent lifecycle for paid actions

[REPORTED, scout] Cloud billing persists an exact review record (plan, amounts, expiry) in state `review`; only the initiating purchaser can confirm; confirm commits `pending` before any network mutation; commands carry an `idempotencyKey` and a compare-and-set `expectedSubscriptionRevision`; timeouts return `billing_result_unconfirmed` and reuse the persisted body on recovery instead of inventing a new purchase (`apps/cloud/src/billing.ts:14-79,320-466,470-610`). Usage has a unique `(org_id, request_key)` reservation taken before inference and settled idempotently (`apps/cloud/src/usage.ts:21-88`).

[INFERRED] This is the paper-cycle accounting shape for FalconOS P2: persist the exact intent, reserve inventory against it, execute against the persisted record, settle idempotently, and answer "unconfirmed" rather than guessing.

### 11. Single-writer workspace lock

[VERIFIED read] `docs/agents.md:58`: desktop and standalone MCP entry points acquire the same exclusive workspace lock before loading or migrating the vault; a second process stops with a clear error; stale ownership is recoverable after 30 seconds. [REPORTED, scout] Lock tests use separate processes and symlink aliases (`docs/testing.md:22`).

[INFERRED] FalconOS documents "run one collector process at a time" (README:49) but does not enforce it. A lock directory in the data root closes that gap.

### 12. Deterministic, digest-pinned data import and export

[REPORTED, scout] Seed import validates a pinned file SHA-256 and a logical digest over thirteen ordered tables, is idempotent by package id, and errors on same-id different-digest (`packages/core/src/seed.ts:80-116,203-273`). Contribution export orders every relation, stable-sorts keys, and emits a deterministic SHA-256 digest, with private tables excluded by allowlist (`packages/core/src/contribution.ts:41-148`).

[INFERRED] FalconOS's registry fixture (`test/fixtures/public-metadata.json` with capture SHA-256) already follows this practice. The allowlist-export pattern applies later if FalconOS ever shares evidence: export from an allowlist, never by redacting.

## What is absent (and should stay absent)

- No general task queue, worker pool, scheduler, or lease/heartbeat model exists anywhere in the repo. The only "queue" is the durable send reservation ledger [REPORTED, scout: core gaps]. FalconOS's single sequential scan loop needs no queue either.
- No browser automation. OAuth uses the system browser with a loopback callback; the connectors package has no Playwright/Puppeteer dependency [REPORTED, scout: `packages/connectors/package.json:31-40`]. Nothing to copy, and no product need in FalconOS.
- No dry-run mode in connectors; simulation lives in test injection (`fetch`, `sleep`, `now`, in-memory ledger) [REPORTED, scout]. FalconOS's explicit `mode: "demo"` labeling is stronger; keep it.
- No fixture-versus-live origin label in agent schemas [REPORTED, scout: agents gaps]. FalconOS already labels `syntheticTestDouble` and `fixture: true`; keep that advantage.
- No aggregate prompt-size cap on agent context (only intent is capped at 20,000 chars) [REPORTED, scout]. FalconOS's 8 MiB request / 32 KiB note / 64 KiB response caps are stricter; keep them.

## Domain mismatch

Outreachr's product surface is email outreach, mailbox reconciliation, calendars, CRM pipeline stages, an investor seed dataset, an Electron UI, and a cloud billing service. None of it matches FalconOS's multichain research and trading loop. Do not port connectors, OAuth flows, CRM schemas, seed data, MCP CRM tools, or any Electron/cloud code. The transferable material is the invariant design around one irreversible external action, which maps from "send an email" to "submit a transaction".

## Do / Don't

Do:
- Model each irreversible action as a durable state machine with a claim step before network I/O.
- Bind approvals to a content hash plus context; revoke on any policy or input change.
- Classify every provider failure as retryable, terminal, or ambiguous; make ambiguity terminal for automation.
- Resolve ambiguity only from an authoritative external record matched on an operation id you embedded.
- Enforce pacing and caps in durable state, checked at reservation, not in the caller.
- Chain evidence hashes; verify the chain before trusting or exporting the record.
- Log by allowlist; redact child-process output; keep secrets out of the datastore as reference URIs.

Don't:
- Don't import outreach, mailbox, calendar, CRM, billing, or UI code into FalconOS.
- Don't add a task queue or worker framework; neither repo needs one.
- Don't auto-retry any non-idempotent write, ever, on any error class.
- Don't trust comments as retry contracts; pin classification with tests (the 408 comment/code drift at `http.ts:25-32`).
- Don't let agent output carry action verbs; scan payload keys and force the non-executable flag server-side.

## FalconOS mapping and decisions

| Outreachr pattern | FalconOS target | Decision |
| --- | --- | --- |
| Ambiguity taxonomy (`mayHaveSucceeded`, no auto retry) | `src/sources.ts` error shape now; P3 executor later | Adopt |
| Claim-before-dispatch ledger + operation key echo | New `src/ledger.ts` at P2; wire into P3 executor | Adopt (P2) |
| Exact-content approval hash + revoke-on-change | P3 approval gate; extend `docs/agent-contract.md` | Adopt (P3) |
| Reconcile-from-authoritative-record | P3: signature lookup on chain before any resubmit | Adopt (P3) |
| Retry policy w/ Retry-After honor | `src/sources.ts` metadata only; keep no-retry-per-scan | Adopt partially |
| Durable pacing counters, DB/file-enforced | Data-root counters for scan pacing; P3 execution caps | Adopt |
| Hash-chained audit log | `src/vault.ts`: link run records by previous hash | Adopt |
| Secrets: keychain, fail closed, ref URIs, env allowlist | P3 signer + any paid key; `src/codex.ts` child env now | Adopt (env allowlist now, rest P3) |
| Forbidden-token scan on agent output | `src/agent.ts` thesis validation | Adopt |
| Audit-first MCP dispatch (withhold on audit failure) | `src/agent.ts` / `src/codex.ts` request logging | Adopt |
| Workspace lock, 30s stale recovery | Data-root lock in `src/cli.ts` | Adopt |
| Durable intent lifecycle (review/confirm/CAS/unconfirmed) | P2 paper-cycle accounting design | Adopt as design input |
| Deterministic digest-pinned import/export | Already present (registry fixture) | Keep, no change |
| SQLite + triggers as second enforcement layer | FalconOS is JSON-file based, zero runtime deps | Defer until P2 forces a datastore choice |
| Closed error-code union (`ConnectorErrorCode`) | `src/types.ts` observation errors | Adopt |
| Email/CRM/OAuth/calendar/seed/UI/cloud code | none | Reject |
| Task queue framework | none (absent in source too) | Reject |
| Browser automation | none (absent in source too) | Reject |

## Risks

1. [INFERRED] Trigger-level double enforcement assumes SQLite. Porting the pattern to FalconOS's JSON files gives only single-layer enforcement; a compromised or buggy writer bypasses it. Mitigation: hash chain plus startup verification detects tampering after the fact.
2. [INFERRED] Outreachr's ambiguity discipline works because email has an authoritative queryable record (provider sent mail). Chain state gives FalconOS the same property for transactions, but quote APIs have none; ambiguous quote reads must stay unusable evidence, as invariant F2 already requires.
3. [INFERRED] Adopting the intent/CAS billing shape wholesale would over-build P2. Take the states and idempotency key; skip revisions until concurrent writers exist.
4. [REPORTED, scout] The repo itself has known gaps: no aggregate agent-context cap, no MCP request-id dedupe store, comment/code drift on 408. Treat it as a pattern source, not a reference implementation.
5. [INFERRED] These patterns are distilled from subagent reads. Before implementing any single mechanism, re-read the cited lines directly; line numbers are pinned to commit `23b7dcc` only.

## License notes

[VERIFIED read] LICENSE is Apache-2.0; NOTICE names "Outreachr, Copyright 2026 Outreachr contributors" and flags source-specific rights on investor data; README:112-114 repeats that investor data is not Apache-licensed. Adopting design patterns creates no license obligation. Copying code verbatim into FalconOS requires Apache-2.0 attribution (license text plus NOTICE carry-over). Do not copy anything from `resources/` (investor data, separate rights) or `vendor/` (pinned third-party SDK). A 1.0 MB `THIRD_PARTY_NOTICES.md` exists; not read in full.

## Not fetched / not verified

- Not read: `apps/desktop` renderer pages/components (skimmed names only), `apps/cloud-web`, `scripts/*` (32 files), `.github/workflows`, `docs/user-guide.md`, `docs/release.md`, `docs/data-contributions.md`, `docs/cloud-migration/`, `docs/app-billing-and-shipping-plan.md`, `docs/cloud-implementation-plan.md`, `THIRD_PARTY_NOTICES.md`, `release-metadata/licenses.json`, the seed SQLite contents, and most of the vendor SDK tarball.
- Not run: no outreachr build, test suite, lint, or live provider call. All behavior claims are source reads, not measurements.
- The initial `git clone` failed with `fatal: destination path '/tmp/falconos-source/outreachr' already exists and is not an empty directory` [VERIFIED]; the existing clone was fetched against origin and confirmed at the same HEAD `23b7dcc` [VERIFIED, `git fetch && git rev-parse`].

## Rules to adopt

1. Model every irreversible external action as a named state machine; write the state names down before the code.
2. Reserve a durable operation id and claim the ledger row before the first byte of network I/O.
3. Embed the operation id in the outbound action wherever the venue allows, so the external record can be matched back.
4. Bind every user approval to a versioned hash of the exact content and context; a mismatch is `APPROVAL_STALE`, not a warning.
5. Revoke all active approvals whenever the governing policy changes.
6. Classify every provider error with three explicit fields: `retryable`, `retryAfterMs`, `mayHaveSucceeded`.
7. Never auto-retry a non-idempotent write on any error class; only an explicit provider 429 rejection is proof the write did not commit.
8. Treat a dropped connection, timeout, or 5xx after a write as `mayHaveSucceeded=true` and make that state terminal for automation.
9. Resolve ambiguity only by querying the authoritative external record, matched on your embedded operation id, inside explicit time and clock-skew windows.
10. Keep a pre-dispatch safe-failure state, and make it unreachable once dispatch starts.
11. Honor server-directed retry delays, clamp them to a maximum, and cap fallback backoff at a named constant.
12. Enforce pacing and caps in durable state at reservation time; exclude only provably-safe failures from the counts.
13. Give every run a durable pause switch that the reservation gate checks; process memory is not a kill switch.
14. Chain evidence records by hash to their predecessor and verify the chain at startup and before export.
15. Use stable dotted audit action names and append audit rows in the same transaction as the state change.
16. Store secret references, never secret values, in the datastore; restrict reference schemes with a validation check.
17. Fail closed when OS-backed encryption is unavailable; never downgrade to plaintext storage.
18. Spawn agent and tool child processes with an allowlisted environment and redact known credential shapes from captured output.
19. Log failures by allowlist (event, path, error type), never by serializing the error object.
20. Scan agent output payloads for action-verb keys (`send`, `execute`, `dispatch`, `schedule`, `publish`, `delete`) and reject on match; force the non-executable flag server-side.
21. Verify the agent runtime's live tool inventory against the run allowlist before sending the prompt; do not trust launch flags.
22. Write the audit record before dispatching a tool call, and withhold the result if the success audit write fails.
23. Enforce single-writer access to the data root with an exclusive lock that supports stale-owner recovery after a fixed timeout.
24. Pin imported data by content digest and make imports idempotent by package id; same id with a different digest is an error.
25. Pin retry and error-classification behavior with tests; a comment describing retry behavior is not a contract.
