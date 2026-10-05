# FalconOS synthesis: nine-source implementation plan

- Date: 2026-09-10
- Author: Fable 5 synthesis agent (FalconOS session for sarthi)
- Model: anthropic/claude-fable-5
- Provenance: This report synthesizes nine research reports under `docs/research/`. Every upstream source claim is [REPORTED] with the report path that carries it. Every applicability judgment is [INFERRED]. [VERIFIED] applies only to commands and file reads this agent performed in this session. No upstream repository was re-read for this synthesis.

## Method and reading scope

[VERIFIED] Read in full this session: `docs/research/nautilus-trader.md`, `docs/research/tensortrade.md`, `docs/research/vectorbt.md`, `docs/research/tradingagents.md`, `docs/research/hftbacktest.md`, `docs/research/llm-council.md`, `docs/research/oh-my-pi.md`, `docs/research/12-factor-agents.md`, `docs/research/outreachr.md`, `CONTEXT.md`, `README.md`, `package.json`, `docs/interfaces.md`, `docs/agent-contract.md`, `plans/roadmap.md`, `src/types.ts`, and `status.md` (all 351 lines).

[VERIFIED] Read structurally with selected bodies: `src/scan.ts` (exported functions, lines 1-26 and 91-96 in full), `src/sources.ts` (constants and function inventory), `src/vault.ts` (`writeNew`, `exportScan`), `src/cli.ts` (help text and interface), `src/agent.ts` (types, limits, function inventory), `src/codex.ts` (constants, `processEnvironment`, `promptFor`, `runCodex` bodies).

Not independently re-read: the nine studied upstream repositories (all upstream claims rest on the reports and their pinned commits); FalconOS `test/` bodies; `docs/verification/*`; `docs/brand-brief.md`; `plans/README.md`; `src/demo.ts`; elided function bodies in `src/scan.ts:27-90`, `src/sources.ts`, `src/agent.ts`, `src/cli.ts`, and `src/codex.ts:106-201`.

## 1. Executive decision

[INFERRED] Adopt contracts, not mechanisms. All nine reports converge on the same epistemics FalconOS already practices: exact integers, raw evidence beside normalized data, visible failures, append-only records, and a hard wall between claims and execution. The genuinely missing work is small and concentrated.

Decision, in order:

1. Build one small slice now: a typed provider-failure classification on `Observation`, plus a provider-versus-receipt time ordering check. It serves the documented open item "live provider failure diagnosis remains open" (`status.md:126,140`) and needs no external authorization.
2. Add the prompt-wrapper contract test named open at `docs/agent-contract.md:384`, then pursue the authorized real Codex run for CP1B. The Codex adapter hardening the reports prescribe already exists in `src/codex.ts`; the missing parts are the test and the authorized run.
3. Treat the P2 paper ledger as the largest convergence target (six of nine reports) and write its design from this synthesis, but implement it only after CP1B per the roadmap dependency rule (`plans/roadmap.md:32`).
4. Reject all code copying, all domain-mismatched machinery (order books, RL, debates, buses, sweeps, CRM), and every availability-over-integrity pattern the reports flagged.

Invariants F1-F6, zero runtime dependencies, provenance tags, `executionReady: false`, and the P1/P2/P3 gates are constraints on every item below. Nothing in this plan changes them.

## 2. Cross-report matrix

All rows [REPORTED] from the named report's header block.

| Report path | Source | Studied commit | License | Strongest transfer |
| --- | --- | --- | --- | --- |
| `docs/research/nautilus-trader.md` | nautechsystems/nautilus_trader | `96f52ab366932303625f24d4bcbd209bc2e62e6d` | LGPL-3.0 | Evidence classes, dual timestamps, fail-closed risk gate, simulated venue at the executor seam |
| `docs/research/tensortrade.md` | tensortrade-org/tensortrade | `d58afba23deb1fded39793203b7997c3990bb032` | Apache-2.0 | Conservation-checked transfers, ledger journal, path_id release |
| `docs/research/vectorbt.md` | polakowo/vectorbt | `34b6d5935e3ea3eccd549e2592bc0f455b8045f5` | Apache-2.0 + Commons Clause | Typed rejection reasons, attempt log split from accepted events |
| `docs/research/tradingagents.md` | TauricResearch/TradingAgents | `be952b8eccb49720509af544c6675233bc1f10d0` | Apache-2.0 | REVIEW sentinel, typed vendor errors, point-in-time cutoffs, resolvedAt |
| `docs/research/hftbacktest.md` | nkaz001/hftbacktest | `5f3ec40b2afb764e0fea112f941ed85523ef4e88` | MIT | Two-timestamp invariant, quote-is-not-a-fill, one accounting choke point |
| `docs/research/llm-council.md` | karpathy/llm-council | `92e1fcc` | none | Fan-out shape, raw-plus-parsed display, host-side aggregation |
| `docs/research/oh-my-pi.md` | can1357/oh-my-pi | `13a38b12afbe62bb05d30b7edd59a2ded738483a` | MIT | valid/invalid/unavailable result status, approval re-resolution, artifact spill |
| `docs/research/12-factor-agents.md` | humanlayer/12-factor-agents | `d20c728368bf9c189d6d7aab704744decb6ec0cc` | Apache-2.0 code, CC BY-SA 4.0 content | Event-log state, durable pause before execution, bounded retries |
| `docs/research/outreachr.md` | lalalune/outreachr | `23b7dcc5f731e3abc47c66dd6c09e69df4427d99` | Apache-2.0 (investor data excluded) | Ambiguity taxonomy, claim-before-dispatch, content-hash approval, hash chain |

Convergence count per pattern (reports naming it as a rule or adopt row):

| Pattern | Reports | FalconOS state |
| --- | --- | --- |
| Quote or simulation is never a fill; label model assumptions | nautilus, hftbacktest, vectorbt, tensortrade | Held (F6, `SEQUENTIAL_QUOTES_NOT_FILLS`, `netProfitUsdc: null`) |
| Two timestamps per observation; local order governs replay | nautilus, hftbacktest, tensortrade | Partial: fields exist; ordering invariant between provider time and receipt not confirmed as checked |
| Typed failure reasons from a closed union | vectorbt, tradingagents, outreachr, nautilus | Partial: `Candidate.reasons` uses stable codes; `Observation.error` is free text |
| Append-only records; supersede, never overwrite | nautilus, omp, tensortrade, vectorbt, outreachr | Held (F4, `writeNew` with `O_EXCL`) |
| No unvalidated fallback; parse failure yields a sentinel, not a default | tradingagents, llm-council, 12-factor, omp | Held (`docs/agent-contract.md:31`) |
| One cycle ID plus one accounting choke point plus a ledger | tensortrade, hftbacktest, vectorbt, outreachr, 12-factor, tradingagents | Missing; P2 scope |
| Ambiguous external writes are terminal for automation; reconcile from the authoritative record | outreachr, nautilus, hftbacktest | Missing; P3 scope, already anticipated at `plans/roadmap.md:42` |
| Approval bound to exact content, durable pause before execution | outreachr, 12-factor, omp | Missing; P3 scope |
| No retry of non-idempotent writes; classify, do not loop | nautilus, outreachr, 12-factor, tradingagents | Held for reads (no in-scan retries, `docs/interfaces.md:23`); classification fields missing |
| Raw bytes preserved beside the parsed projection | nautilus, llm-council, vectorbt | Held (`Observation.raw`) |
| Bounded agent context, pre-fetched, no tools | 12-factor, omp, outreachr | Held (8 MiB cap, no tools, `docs/agent-contract.md:60-62`) |
| Durable pacing and single-writer enforcement | outreachr | Missing (`README.md:49` documents the gap) |
| Hash-chained evidence records | outreachr | Missing |
| Per-venue capability and limits record as data | nautilus, tensortrade, omp | Missing; P2 scope |

## 3. Patterns FalconOS already holds

Each row names the report that prescribes the pattern and the FalconOS evidence. Do not rebuild these.

- Exact integer money, no floats in core. [REPORTED] nautilus (`docs/research/nautilus-trader.md:48`), vectorbt rule 7, tensortrade rule 6. [VERIFIED] `src/scan.ts:7-24` uses `bigint` with a fixed six-decimal unit.
- Raw provider payload kept verbatim. [REPORTED] nautilus rule 5. [VERIFIED] `src/types.ts:26` (`raw: unknown` on `Observation`).
- Failures stay visible; no silent drop. [REPORTED] llm-council rule 3 ("FalconOS `Observation` already does this, keep it"). [VERIFIED] `Observation.error`, F2/F5 in `CONTEXT.md:44,50`.
- No default action on parse failure. [REPORTED] tradingagents mapping row: "Adopt (already held)" for the REVIEW sentinel (`docs/research/tradingagents.md:125`). [VERIFIED] `docs/agent-contract.md:31`.
- Claims separated from execution. [REPORTED] tradingagents concept 5, vectorbt concept 16, hftbacktest mapping row 12. [VERIFIED] `executionReady: false` is a literal type in `src/types.ts:48` and `docs/agent-contract.md:87`.
- Hash exact bytes before parse. [REPORTED] omp rule 2 notes FalconOS already states this. [VERIFIED] `docs/agent-contract.md:64`.
- Strict closed schema with exact keys and byte caps. [REPORTED] 12-factor mapping rows 1-4, llm-council rule 21. [VERIFIED] `src/agent.ts:15-18` (`MAX_NOTES`, `MAX_NOTE_BYTES`, `MAX_REQUEST_BYTES`, `MAX_THESIS_BYTES`), `exactKeys` and `responseKeys`.
- Append-only atomic writes, no overwrite, symlink rejection. [REPORTED] llm-council rule 20 contrasts its own storage with `src/vault.ts` as "strictly stronger". [VERIFIED] `src/vault.ts:23-42` (`O_CREAT | O_EXCL | O_NOFOLLOW`), `safeDirectory`.
- Evidence and vault separation. [VERIFIED] `src/vault.ts:59-61` rejects nesting either root inside the other.
- Deterministic identity resolved once. [REPORTED] tradingagents mapping: token registry "already plays this role" (`docs/research/tradingagents.md:129`). [VERIFIED] `src/sources.ts:4-15` pinned addresses with the capture caveat.
- Host-side arithmetic, never model arithmetic. [REPORTED] llm-council concept 5. [VERIFIED] `assess` in `src/scan.ts` computes all deltas.
- Synthetic data labeled. [REPORTED] outreachr section "What is absent": FalconOS labeling called an advantage to keep. [VERIFIED] `mode: 'demo'`, `fixture: boolean`, `syntheticTestDouble` in `docs/interfaces.md:51`.
- Bounded stop and bounded failure runs. [REPORTED] 12-factor mapping row for factor 9. [VERIFIED] three-consecutive-incomplete stop, exit code contract in `README.md:49-51`.
- Prompt wrapper owned in code, agent granted no tools. [REPORTED] 12-factor factors 2 and 13. [VERIFIED] `promptFor` in `src/codex.ts:76-92`; allowlisted child env in `processEnvironment` (`src/codex.ts:67-74`); fixed argv in `runCodex` (`src/codex.ts:224-229`); empty working directory; bounded response read. The contract test for the wrapper is the remaining gap (`docs/agent-contract.md:384`).
- Provenance classes on every claim. [REPORTED] nautilus rule 12 mirrors the repo-wide VERIFIED/REPORTED/INFERRED practice.
- Negative results published. [REPORTED] tensortrade rule 20. [VERIFIED] REJECT records and corrections throughout `status.md`.

## 4. Conflicts and rejected imports

Conflicts between sources, resolved:

1. Availability versus integrity. tradingagents retries a failed structured call as free text (`docs/research/tradingagents.md:43`); omp, 12-factor, and the FalconOS contract reject any unvalidated fallback. Resolution: fail closed. The tradingagents report itself lists the fallback under Reject.
2. Error visibility. 12-factor factor 3 suggests hiding resolved errors from the model context (`docs/research/12-factor-agents.md:29`); F5 requires visible failures. Resolution: the durable record never hides anything; a future model-context projection may compact, the evidence may not.
3. Retry loops. outreachr retries idempotent reads with backoff (`docs/research/outreachr.md:43`); FalconOS forbids in-scan retries (`docs/interfaces.md:23`). Resolution per the outreachr report's own mapping: adopt the classification fields, keep the no-retry policy.
4. Tolerance in accounting. tensortrade balances with `np.isclose` (`docs/research/tensortrade.md:59`); vectorbt documents float roundoff that prevents positions from closing. Resolution: exact bigint equality only, as both reports recommend.
5. Lenient parsing. llm-council falls back to prose-order label extraction (`docs/research/llm-council.md:37`). Resolution: strict rejection for anything execution-adjacent; lenient views only for labeled display.
6. Model trust. tradingagents warns and continues on unknown models (`docs/research/tradingagents.md:76`); FalconOS gates Codex until controls verify (`status.md:53`). Resolution: fail closed, reject unknown model IDs.

Rejected imports (domain or scale mismatch; the naming report agrees in each case):

- Message bus, actor registries, component lifecycle FSM, Redis/Postgres/Parquet backing (nautilus report, Reject list).
- CLOB queue position, book reconstruction, latency interpolation models (hftbacktest report: AMM quotes have no queue priority).
- RL agents, reward schemes, gym environments, metaclass config injection, string registries, NaN masking, disabled TLS (tensortrade report, Reject rows).
- Wide-matrix sweeps, `call_seq='auto'`, auto initial cash, float money, fill-labeled simulations (vectorbt report, Reject list).
- Debate prompts with equity vocabulary, stop-phrase magic strings, string-prefix routing, permissive capability defaults (tradingagents report).
- Council voting as a trade decision; model output never flips a deterministic candidate status (llm-council report, Reject row).
- Harness mechanisms: hashline editing, KDL rule compiler, TTSR, RPC embedding (oh-my-pi report, Reject rows).
- HumanLayer SDK, A2H service, BAML, any framework for the loop; each violates the zero-dependency rule (12-factor report, Reject rows).
- Email, CRM, OAuth, calendar, billing, Electron, task queues, browser automation (outreachr report, Domain mismatch section).
- Copied code from any source. llm-council has no license at all; nautilus is LGPL; vectorbt carries the Commons Clause. Clean-room TypeScript only, with the source commit recorded on adoption (12-factor rule 20).

## 5. Candidate ranking and implementation approaches

Candidate work items, ranked. Fit is product fit against the current roadmap position (CP1A desktop item and CP1B open). Evidence quality counts independent reports converging.

| Candidate | Fit | Safety impact | Size | Evidence quality |
| --- | --- | --- | --- | --- |
| C1 Typed failure classification + time-order check | High (serves open CHK-06 diagnosis item) | Medium | Small (1-2 days) | High (4 reports) |
| C2 Prompt-wrapper contract test + thesis token scan | High (CP1B path) | High | Small (under 1 day) | High (3 reports) |
| C3 Real Codex run controls and authorized call | High (closes CP1B) | High | Small code, gated by approval | Medium (2 reports) |
| C4 Data-root single-writer lock + durable pacing | Medium (closes `README.md:49` gap) | Medium | Small | Medium (1 report, documented gap) |
| C5 Hash-chained run records in vault | Medium | Medium | Small | Low (1 report) |
| C6 P2 paper ledger (cycle ID, conservation, attempt log) | High later, gated on CP1B | High | Medium (3-4 days, matches roadmap estimate) | High (6 reports) |
| C7 Per-venue capability and limits record | Medium (P2 input) | Medium | Small | Medium (3 reports) |
| C8 Approval hash + durable pause (P3) | Later | High | Medium | High (3 reports) |
| C9 Multi-adapter council fan-out | Low until a second adapter exists | Low | Medium | Medium (1 report, self-gated) |

Approaches:

- Approach A, evidence-first (recommended). Ship C1 now, then C2, then C3 when the model call is authorized. Rationale: C1 needs no approval, touches the existing pipeline end to end, serves a documented open item, and lays the error-classification base that C6 and P3 ambiguity handling reuse. Tradeoff: it does not directly advance CP1B, which the roadmap lists first.
- Approach B, agent-first. Ship C2, then C3, defer C1. Rationale: CP1B is the named next checkpoint. Tradeoff: C3's real run needs explicit user authorization (a confirmation-gated external call), so the sequence can stall on approval while C1 work sits idle. Most adapter hardening the reports prescribe already exists in `src/codex.ts`, so the code delta is small either way.
- Approach C, design-first for P2. Write the paper-ledger spec from the six-report convergence now, implement after CP1B. Rationale: highest total value. Tradeoff: code written now would carry no load, and the roadmap dependency rule places P2 after P1 (`plans/roadmap.md:32`).

Chosen: Approach A for the next code change, with the C6 design captured in section 7 so no re-research is needed at P2.

## 6. Recommended minimal vertical slice: typed provider-failure classification

Goal: every failed observation carries a machine-readable failure record, and provider timestamps that postdate local receipt are rejected. [REPORTED] backing: outreachr mapping "record `retryable`, `retryAfterMs` ... on each failed observation so the next scan cycle can pace itself honestly" (`docs/research/outreachr.md:45`); tradingagents rule 7 (typed by required reaction); vectorbt rules 2-3 (closed reason unions, no-action distinct from error); hftbacktest rules 1-3 (venue time at or before local receipt; fail loudly on violations); nautilus rule 12 (evidence classes).

Files and symbols (all [INFERRED] design; symbol names below are proposals except where marked existing):

1. `src/types.ts`
   - Add `export type FailureKind = 'dns' | 'connection' | 'tls' | 'timeout' | 'cancelled' | 'rate_limit' | 'http_server' | 'http_client' | 'invalid_body' | 'invalid_quote'`.
   - Add `export interface ObservationFailure { kind: FailureKind; retryable: boolean; retryAfterMs: number | null }`.
   - Add `failure: ObservationFailure | null` to `Observation` (existing interface, `src/types.ts:20-29`).
   - Bump `Scan.schemaVersion` to `2` (see least-confident decision 1 for the alternative).
   - Constraint: the kinds must be derived one-to-one from the branches that already exist in `src/sources.ts` (`DNS_ERROR_CODES`, `CONNECTION_ERROR_CODES`, `TLS_ERROR_CODES`, `transportKind`, timeout, cancellation, `readBody` failures, `normalizeQuote` failures, non-200 status). No new failure class is invented. The only additive capture is `Retry-After` on 429/503 responses, backed by the outreachr report.
2. `src/sources.ts`
   - Add `classifyFailure(error, httpStatus, headers): ObservationFailure` beside the existing `errorDetails` and `transportKind` helpers. Populate `failure` at every site in `collectCycles` that currently sets `error`. Keep `error` as the human-readable string; the two fields describe one event.
   - Retryable mapping, descriptive only, no retry executed: dns, connection, timeout, rate_limit, http_server are `retryable: true`; tls, cancelled, http_client, invalid_body, invalid_quote are `retryable: false`. [REPORTED] basis: outreachr read policy retries network errors and 5xx and honors server-directed delays (`docs/research/outreachr.md:37,43`).
3. `src/scan.ts`
   - In the per-leg loop of `assess` (existing, `src/scan.ts:67-90`), reject a leg whose `providerTimestamp` is later than its `receivedAt`. Reuse the existing rejection vocabulary; prefer the existing `STALE_OR_INVALID_OBSERVATION_TIME` code over a new one unless tests show the distinction matters. [REPORTED] basis: hftbacktest rule 2. The implementer must first read the elided loop body; the check may partially exist.
4. `src/agent.ts`
   - `validateScan` (existing) accepts `schemaVersion` 1 or 2. `validateObservation` (existing) requires `failure` with exact keys on version 2 scans and forbids it on version 1. All other checks unchanged.
5. `src/vault.ts`, `src/cli.ts`: no code change. The scan serializes whole, so evidence and notes carry the new field automatically.
6. Docs updated in the same change (edit during implementation, not by this synthesis): `docs/interfaces.md` failure rule paragraph, `docs/agent-contract.md` schemaVersion wording, `README.md` interpretation table if reason text changes.

State transitions: none. `Observation` stays a record, not a state machine. The classification is a pure decision table applied once at the provider boundary, matching the nautilus one-boundary conversion rule (`docs/research/nautilus-trader.md:171`).

Interfaces: the `Cycle[]` contract between `sources.ts` and `scan.ts` (`docs/interfaces.md:19`) gains one field. The agent request contract gains version 2 acceptance. No consumer loses a field.

Tests (extend existing suites; no new test file unless size forces it):

- `test/sources.test.ts`: one case per `FailureKind` using the existing injected-fetch harness (the suite already covers injected timeout, cancellation, and transport causes per `status.md:126`). Assert kind, retryable, and `retryAfterMs` for a 429 response with a `Retry-After` header, and `retryAfterMs: null` when absent.
- `test/scan.test.ts`: a leg with `providerTimestamp` one second after `receivedAt` yields a rejected candidate with the chosen reason code; the same leg with equal timestamps passes the ordering check.
- `test/agent.test.ts`: a version 1 fixture scan without `failure` validates; a version 2 scan with `failure` validates; a version 2 scan missing `failure` on a failed observation is rejected.
- Regression: full suite and typecheck pass; the demo path still exports and hashes.

Acceptance: `npm run typecheck` exits 0; `npm test` passes with the new cases; one live `npm run scan` under an induced failure (for example an unreachable host via the existing injected transport) shows a populated `failure` object in the exported evidence JSON. Per repo rules, quote the recorded counts in `status.md` when done; "tests pass" alone is not evidence.

Explicitly out of scope for this slice: provider request-id capture (header availability for Jupiter and KyberSwap is unverified; adding it would invent a requirement), any retry loop, any pacing change, any new reason code beyond the ordering check.

## 7. Later slices

In order, each gated as noted:

1. Prompt-wrapper contract test (C2). Fixture-test the exact `promptFor` output and the fixed argv for a canned `AgentRequest`; add the outreachr forbidden-token scan over thesis payload values (`send`, `execute`, `dispatch`, `schedule`, `publish`, `delete`) in `validateAgentThesis` (`docs/research/outreachr.md:181`, `docs/research/12-factor-agents.md:141-142`). No approval needed.
2. Real Codex run (C3). Verify the network boundary with an OS control or local process test (`docs/agent-contract.md:386`), record the live control inventory before the prompt (outreachr rule 21), then run the authorized model call for CHK-10 to CHK-12. Requires explicit user approval for the external call.
3. Data-root lock and durable pacing (C4). An exclusive lock directory with stale recovery, plus a durable request counter, closing the `README.md:49` gap (`docs/research/outreachr.md:79-82,173-174`).
4. Hash-chained run records (C5). Each new evidence record names the previous record's SHA-256; verify the chain on startup and before export (`docs/research/outreachr.md:57`).
5. P2 paper ledger (C6), after CP1B and D2. Design fixed by convergence: one cycle ID stamped on every reservation, simulated fill, ledger row, and outcome (tensortrade rules 1-2); one pure accounting transition booking position, balance, and fees (hftbacktest rule 9; vectorbt rule 8); attempt log separate from accepted events (vectorbt rule 4); append-only cycle event log as the only resume state (12-factor rules 7-8); reserve-before-act with ambiguity terminal for automation (outreachr rules 2, 8); fill and cost assumptions stored beside every simulated outcome, which never upgrades a candidate past REVIEW (nautilus rule 18; tensortrade rule 15); `resolvedAt` on outcomes with as-of filtering for any later lesson injection (tradingagents rules 15-16).
6. Per-venue options record (C7), with P2: fee basis, min and max size, decimals per venue, checked before any simulated fill (tensortrade rule 9; nautilus rule 8).
7. P3 approval binding (C8): versioned content hash over route, exact amounts, venue, quote evidence hashes, and signer identity; revoke on any policy change; durable pause between proposal and execution; approval as a structured event with approver, decision, comment, timestamp (outreachr rules 4-5; 12-factor rules 9-10; omp rules 9-11).
8. Council fan-out (C9): only when a second real adapter exists, with shuffled labels, self-review exclusion, persisted label maps, and a fixed call budget (llm-council rules 13-14, 18).

## 8. Licensing and provenance constraints

- [REPORTED] nautilus is LGPL-3.0 (`docs/research/nautilus-trader.md:9`). Patterns are free; vendoring code or substantial doc text creates LGPL obligations. Never copy.
- [REPORTED] vectorbt is Apache-2.0 with the Commons Clause (`docs/research/vectorbt.md:160`). Independent TypeScript implementations of concepts are outside copyright scope. Before any P4 embedding of vectorbt itself in a paid product path, complete a license review and record the verdict (vectorbt rule 22).
- [REPORTED] llm-council has no license file (`docs/research/llm-council.md:116`). Default copyright applies. No code or prompt text may be ported; clean-room reimplementation only.
- [REPORTED] 12-factor-agents content is CC BY-SA 4.0 (`docs/research/12-factor-agents.md:127`). Copying its prose into FalconOS docs would carry attribution and share-alike duties. Adopt ideas, write our own words.
- [REPORTED] tensortrade, tradingagents, and outreachr are Apache-2.0; hftbacktest and oh-my-pi are MIT. Idea reuse carries no obligation. Close translation of code would require attribution; avoid it by re-implementing. outreachr's `resources/` investor data sits outside its Apache grant; never touch it.
- [INFERRED] Standing rule for every adoption: record the source repo, commit, and report path beside the adopted pattern (12-factor rule 20). This synthesis's matrix in section 2 is that record for the current batch.

## 9. Risks and open decisions

1. Relay risk. Every upstream claim in this synthesis passed through one research report, and most reports drew on subagent reads with spot checks, not exhaustive re-reads (each report's own risk section says so). Before implementing any single mechanism, re-read the cited upstream lines at the pinned commit.
2. Pattern overweight. Three reports warn that copying framework structure into an eight-file CLI destroys its auditability (nautilus risk 1, oh-my-pi risk 1, tensortrade risk 3). Mitigation: every slice above edits existing files or adds at most one module.
3. Retryable-flag drift. A descriptive `retryable` field invites a future silent retry loop. Guard: the no-retry invariant stays in `docs/interfaces.md`, and any retry proposal must pass its own review (12-factor rule 12 caps it at 3 with visible escalation if ever added).
4. Schema evolution. The version bump touches `validateScan` and the agent contract. A missed consumer would reject valid new evidence. Guard: the version 1 and version 2 acceptance tests in the slice.
5. Open decision D2 (capital ownership) still gates the P2 ledger design details; the convergence design in section 7 is ownership-agnostic but reservation semantics depend on D2.
6. Open decision: whether the ordering check emits a new reason code or reuses `STALE_OR_INVALID_OBSERVATION_TIME`. Decide after reading the elided `assess` loop body.
7. The real Codex call remains confirmation-gated. Nothing in this plan authorizes it.

## 10. Rules to adopt

Deduplicated across the nine reports. Each cites its carrying reports. Applicability is [INFERRED] throughout; the practices are [REPORTED] at the cited paths.

1. Never label a quote, simulation, or reconstruction as a fill; only an external acknowledgement earns outcome words (`docs/research/vectorbt.md:172`; `docs/research/hftbacktest.md:151`; `docs/research/nautilus-trader.md:183`).
2. Classify every provider failure in a closed union with explicit fields; free-text error strings are for humans only (`docs/research/tradingagents.md:168`; `docs/research/outreachr.md:167`; `docs/research/vectorbt.md:173`).
3. Require source event time at or before local receipt time; treat violations as clock skew and reject or correct explicitly (`docs/research/hftbacktest.md:147-148`; `docs/research/nautilus-trader.md:168`).
4. Records are immutable after creation; corrections are new records that name what they supersede (`docs/research/nautilus-trader.md:176`; `docs/research/oh-my-pi.md:151`; `docs/research/vectorbt.md:183`).
5. A schema, transport, or process failure produces no accepted output; there is no unvalidated fallback path (`docs/research/tradingagents.md:167`; `docs/research/llm-council.md:142`).
6. Never retry a non-idempotent external write; resolve ambiguity only from the authoritative external record matched on an embedded operation id (`docs/research/outreachr.md:168-170`; `docs/research/nautilus-trader.md:174`).
7. Cap any automatic retry of one operation at 3, reset on success, then stop and surface (`docs/research/12-factor-agents.md:150`).
8. Give every multi-leg cycle one ID stamped on every reservation, fill, ledger row, and note, with one release routine for aborts (`docs/research/tensortrade.md:155-156`).
9. Book every simulated or real economic effect through one accounting function; audit one code path (`docs/research/hftbacktest.md:155`; `docs/research/vectorbt.md:179`).
10. Accounting equality is exact integer comparison; no epsilon (`docs/research/tensortrade.md:160`).
11. Store fees signed, with explicit basis and role, in the same rows as principal; a missing cost line keeps net results null (`docs/research/hftbacktest.md:156-157`; `docs/research/tensortrade.md:162`).
12. Store fill, cost, and latency assumptions beside every simulated outcome; simulations never upgrade a candidate past REVIEW (`docs/research/nautilus-trader.md:183`; `docs/research/tensortrade.md:169`).
13. Bind approvals to a versioned hash of exact content and context; revoke on any policy change; a mismatch is an error, not a warning (`docs/research/outreachr.md:165-166`).
14. Insert a durable break between action selection and execution; resume only from persisted state (`docs/research/12-factor-agents.md:147-148`; `docs/research/oh-my-pi.md:160`).
15. Fail closed on unknown models, invalid config, or an unreachable approver (`docs/research/tradingagents.md:182-183`; `docs/research/oh-my-pi.md:161`).
16. Keep per-venue capabilities and limits as data, validated before use, never inferred from an endpoint existing (`docs/research/nautilus-trader.md:173`; `docs/research/tensortrade.md:163`).
17. Record outcome-knowable dates and filter any injected lesson by that date on historical runs (`docs/research/tradingagents.md:176-177`).
18. Every dispatch on external output handles the unknown branch explicitly; routers map all returns exhaustively (`docs/research/12-factor-agents.md:156`; `docs/research/tradingagents.md:180`).
19. Enforce pacing, caps, and single-writer access in durable state, not process memory (`docs/research/outreachr.md:173,183`).
20. Port patterns, never code; record repo, commit, and report path at each adoption (`docs/research/12-factor-agents.md:157` rule 20; section 2 matrix here).
21. Completion claims quote recorded output; keep counterexamples as permanent fixtures; ban tests that only prove code ran (`docs/research/tensortrade.md:175`; `docs/research/nautilus-trader.md:189`; `docs/research/oh-my-pi.md:172`).

## 11. Least confident decisions

1. [INFERRED] Bumping `Scan.schemaVersion` to 2 instead of adding `failure` as an optional field under version 1. The bump is the explicit-migration choice (nautilus rule pattern) but costs contract edits; the optional field is smaller and reversible. Challenge this before implementation.
2. [INFERRED] Sequencing C1 before the CP1B agent work. The roadmap's immediate sequence lists the real agent path first; C1 was chosen because it needs no authorization and C3 does. If authorization arrives quickly, invert the order.
3. [INFERRED] The retryable mapping for `tls` and non-429 4xx (both marked not retryable) rests on outreachr's read policy plus judgment, not on measurements of Jupiter or KyberSwap behavior.
4. [INFERRED] Deferring the hash chain (C5) and lock (C4) behind C1 and C2 because they carry single-report evidence. Both are cheap; a different weighting of "documented FalconOS gap" versus "report convergence" would promote C4.
5. [INFERRED] The claim that the provider-versus-receipt ordering check is missing from `assess` rests on the hftbacktest report's mapping row and on elided code; the implementer must confirm against `src/scan.ts:67-90` before writing it.
