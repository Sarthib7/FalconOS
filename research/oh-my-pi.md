# Research: oh-my-pi (OMP) patterns for FalconOS

- URL: https://github.com/can1357/oh-my-pi
- Date: 2026-09-10
- Author: FalconOS root research agent (dedicated Fable 5 session for Sarthi)
- Model: anthropic/claude-fable-5
- Provenance: REPORTED. Distilled from the source; applicability to FalconOS is marked INFERRED.
- Source snapshot: [VERIFIED] Cloned to `/tmp/falconos-source/oh-my-pi` at commit `13a38b12afbe62bb05d30b7edd59a2ded738483a` (merge dated 2026-09-10). All paths below are relative to that commit.
- Method: [VERIFIED] I read README.md, AGENTS.md, LICENSE, plan-mode prompts, prewalk docs, and one bundled skill directly. Five read-only scout subagents read the session, tool, task, skill, and provider subsystems and returned cited reports. Scout-sourced claims are [REPORTED]. I ran no OMP build or test.

## TLDR

OMP is a coding-agent harness: a Bun/TypeScript monorepo with a Rust core, 7111 tracked files [VERIFIED, `git ls-files | wc -l`]. Its strongest transferable patterns for FalconOS are: append-only session journals with immutable entries and branch-by-leaf, content-addressed evidence blobs split from human summaries, schema-validated subagent results with an explicit `valid | invalid | unavailable` status, tiered approval that re-resolves after argument rewriting and fails closed, secret redaction with self-minted reversible placeholders at the provider boundary, bounded tool output that spills full bytes to artifacts, plans as decision-complete execution specs with a required verification section, and provider policy kept in data tables that fail loudly on ties. FalconOS already implements several of these in miniature (canonical JSON plus SHA-256, exit-code contract, bounded agent bundles). The main adoptable deltas sit in `src/codex.ts`, `src/agent.ts`, and `docs/agent-contract.md`.

## Major concepts

### 1. Harness architecture

[REPORTED] The monorepo splits concerns into `packages/ai` (provider client), `packages/catalog` (model database and compat rules), `packages/agent` (core loop, state, tools), and `packages/coding-agent` (the CLI harness) (`AGENTS.md:9-23`, `README.md:634-653`). Four entry points share one engine: interactive TUI, one-shot `-p`, NDJSON RPC over stdio, and ACP for editors (`README.md:494-559`). RPC startup advertises protocol versions and frame limits; `prompt` returns acceptance only, and completion arrives as an `agent_end` event (`packages/coding-agent/src/modes/rpc/rpc-types.ts:28-75`, `docs/rpc.md:90-113`).

### 2. Durable session state

[REPORTED] A session file is a fixed 256-byte JSON title slot, then a version-3 header, then one JSON object per line per entry (`packages/coding-agent/src/session/session-title-slot.ts:112-121`, `session-entries.ts:13-63`, `session-manager.ts:817-833`). Every entry has `{ type, id, parentId, timestamp }` (`session-entries.ts:66-71`). Branching moves only a leaf pointer; the code states "Existing entries are never modified or deleted" (`session-manager.ts:2666-2728`). Model context is a projection of the active branch, not the journal itself (`session-context.ts:314-341, 411-458`). Compaction is a first-class entry that keeps a `firstKeptEntryId` anchor back into the originals, so summaries stay auditable (`session-entries.ts:118-142`, `packages/agent/src/compaction/compaction.ts:1374-1414`).

### 3. Blob and artifact split

[REPORTED] Binary evidence uses content addressing: `blob:sha256:<64 hex>` with malformed refs rejected before path join (`packages/coding-agent/src/session/blob-store.ts:18-32, 183-203`). Text spill lives beside the session as numbered `<id>.<tool>.log` files; `artifact://<id>` resolves them and refuses inline reads above 8 MiB (`session/artifacts.ts:65-143`, `internal-urls/artifact-protocol.ts:18-110`). Garbage collection scans live references, honors a five-minute write grace, and defaults to dry run (`cli/gc-cli.ts:270-359`).

### 4. Subagent lifecycle

[REPORTED] Agents are Markdown files: frontmatter carries `name`, `description`, `tools`, `spawns`, `model` selectors, and an `output` schema; the body becomes the system prompt (`packages/coding-agent/src/task/types.ts:370-397`, `task/agents.ts:101-120`). Discovery is first-wins by exact name across project, user, plugin, then bundled sources (`task/discovery.ts:71-168`). Spawn preflight enforces recursion depth, allowlists, and schema/model/isolation policy before any process starts (`task/structured-subagent.ts:226-355`). One resizable per-session semaphore caps concurrency (default 32); a separate job manager caps running background jobs at 15 (`task/index.ts:576-640`, `config/settings-schema.ts:5143-5161`, `async/job-manager.ts:28-31`). Finished agents go idle, park after a 420-second TTL, and revive from the persisted session on demand (`task/executor.ts:2710-2805`, `registry/agent-lifecycle.ts:231-349`).

### 5. Structured results and exactly-once delivery

[REPORTED] A settled result carries raw output plus `structuredOutput` with `source`, enforcement `mode`, and `status: valid | invalid | unavailable` (`task/types.ts:9-39, 500-571`). Finalization writes authoritative Markdown to `<artifactsDir>/<id>.md` and, when structured data exists, a JSON sidecar; republishing deletes any stale sidecar so field reads cannot return superseded data (`task/executor.ts:2317-2380`). Parents get a preview capped at 5000 characters with an `agent://<id>` pointer for the rest (`task/result-summary.ts:40-83`). Job results deliver exactly once: a settled `jobs`/`wait` snapshot consumes the pending auto-delivery (`tools/hub/jobs.ts:228-258`, `async/job-manager.ts:451-478`).

### 6. Peer messaging (hub)

[REPORTED] `send` is fire-and-forget with immediate receipts; an awaited send installs the reply-wait before dispatch to avoid a fast-reply race (`tools/hub/messaging.ts:241-299`). Bare `wait` races first job settlement against first message, timeout, or abort. It is not wait-for-all (`tools/hub/index.ts:339-535`). Broadcasts skip parked peers so one message cannot revive a whole roster (`messaging.ts:231-339`).

### 7. Tool contract and validation

[REPORTED] The core tool interface is `execute(toolCallId, params, signal?, onUpdate?, context?) -> AgentToolResult` with typed content blocks, `details`, and `isError` (`packages/agent/src/types.ts:680-695, 754-780`). Schemas are callable validators (omptype) that also emit the provider wire JSON Schema from the same source, so local validation and the advertised contract cannot drift (`packages/omptype/src/type.ts:117-163`, `packages/ai/src/utils/schema/wire.ts:14-27, 575-605`). Before failing, validation applies conservative, bounded repairs to model output (double-encoded keys, flattened paths) and then throws a diagnostic (`packages/ai/src/utils/validation.ts:1929-2064`). The loop revalidates any hook-revised arguments (`packages/agent/src/agent-loop.ts:2362-2416`).

### 8. Approval tiers and the non-sandbox caveat

[REPORTED] Every tool call resolves to a tier (`read | write | exec`) under a mode ceiling (`always-ask -> read`, `write -> write`, `yolo -> exec`) (`packages/coding-agent/src/tools/approval.ts:28-40, 120-219`). The wrapper resolves approval once on original input, lets hooks revise it, then resolves again on the effective arguments, closing an approve-one-run-another gap (`extensibility/extensions/wrapper.ts:179-253`). Prompts fail closed without an interactive UI (`wrapper.ts:254-349`). Bash adds pattern rules for destructive commands (`tools/bash.ts:169-224`), and the docs state plainly that approval is policy, not OS containment: approved bash keeps ambient filesystem and network access (`docs/approval-mode.md:66-80`).

### 9. Secret redaction

[REPORTED] Secrets come from files, secret-shaped env vars of eight or more characters, and a token regex (`secrets/index.ts:161-198`). The obfuscator swaps them for keyed placeholders at the provider boundary and restores only placeholders it minted itself, per install key. A prompt-injected model cannot fabricate a token that expands into a secret (`secrets/obfuscator.ts:66-127`, quoted invariant at `obfuscator.ts:76-81`; transform wiring at `secrets/message-transform.ts:245-287`).

### 10. Bounded output with artifact spill

[REPORTED] Tool output has a 50 KiB inline budget with head-plus-tail retention and per-line caps; on overflow the full raw stream mirrors to an artifact and the inline dump marks the elision explicitly (`session/streaming-output.ts:9-91, 883-1061, 1304-1377`). Timeouts and cancellations return structured states rather than empty output (`exec/bash-executor.ts:612-743`).

### 11. Edit anchoring by content hash

[REPORTED] Reads record normalized content hashes and exactly which lines were shown; edits must present the snapshot tag and may touch only seen lines. Stale tags are rejected before any write, and snapshots above 4 MiB are refused (`crates/pi-edit/src/store.rs:139-229`, `crates/pi-edit/src/modes/hashline/patcher.rs:130-229, 313-412`). [REPORTED, drift] `docs/tools/edit.md:5-13` still cites removed TypeScript paths; the live implementation is the Rust crate. Even a disciplined repo drifts.

### 12. Skills, hooks, context files, prompt assembly

[REPORTED] A skill is `<root>/<name>/SKILL.md` with YAML `name`/`description`; the model sees only the description list and lazily reads `skill://<name>` on match (`docs/skills.md:23-79, 127-140`). Hooks veto tools by returning `{ block: true, reason }`; thrown handlers fail closed (`docs/skills/authoring-hooks.md:80-103`, `extensibility/hooks/tool-wrapper.ts:36-75`). Context files inject farthest ancestor first so nearer instructions read as more specific (`docs/context-files.md:76-106`). [VERIFIED, direct read] Prompts never live in code; they are static `.md` files with Handlebars (`AGENTS.md:51`). The bundled `system-prompts` skill codifies RFC 2119 keywords, edge positioning, and density rules for prompt authoring (`.omp/skills/system-prompts/SKILL.md:26-100`).

### 13. Plan mode and verification loops

[VERIFIED, direct read] Plan mode makes the working tree read-only and defines a plan as "execution spec, not design doc": a competent implementer unfamiliar with the conversation must execute it with zero design decisions (`packages/coding-agent/src/prompts/system/plan-mode-active.md:3, 14-16`). Required sections include Verification with at least one new-behavior check, concrete input to expected observable output, plus exact commands (`plan-mode-active.md:93`). Approval happens only through a `xd://propose` write, never prose (`plan-mode-active.md:9, 122`). The approved plan is inlined with a durable file copy for subagent handoff and recovery, and each step updates a todo before the next (`plan-mode-approved.md:6-14, 21-24`). [REPORTED] Plan-mode subagents get a read-only tool subset (`read`, `grep`, `glob`, `web_search`) and no spawns (`docs/task-agent-discovery.md:260-269`). [VERIFIED, direct read] Prewalk hands off from a planning model to a cheaper execution model after the first completed write (`docs/prewalk.md:40-46`).

### 14. Advisor watchdog

[REPORTED] A second model on its own context reviews transcript deltas and injects `nit | concern | blocker` notes wrapped in `guidance="weigh, don't blindly obey"` (`advisor/advise-tool.ts:10-24, 45-68`). Nits queue as asides; concerns and blockers can steer a live turn, with a cooldown that demotes concerns but never blockers (`advise-tool.ts:79-134`). Advisors are observers, not peers: excluded from hub messaging (`tools/hub/messaging.ts:43-45`).

### 15. Model configuration and provider policy

[REPORTED] Models are `provider/modelId`; nine roles (`default`, `smol`, `slow`, `vision`, `plan`, `commit`, `tiny`, `task`, `advisor`) route work by intent, with `@role` aliases (`docs/models.md:439-463`, `config/model-roles.ts:21-53`). [VERIFIED, direct read] Repo law: never hard-code model or provider conditionals in TypeScript; all policy lives in a KDL rule tree compiled to data, with structured classification the only allowed branch point (`AGENTS.md:183-200`). [REPORTED] Rule ranking is a lexicographic tuple; equal-rank overlaps throw `AmbiguousOverlapError` rather than silently picking one (`packages/catalog/src/compat/cascade.ts:134-165`). Stream dispatch keys on `model.api`, not the provider name, so many providers share one wire adapter (`docs/adding-a-provider.md:16-21`, `packages/ai/src/stream.ts:898-973`). Credential precedence is explicit and ordered; broker snapshots replace refresh tokens with a `"__remote__"` sentinel (`packages/ai/src/auth-storage.ts:5949-5997, 338-342, 7029-7044`).

### 16. Retry versus resize

[REPORTED] Context-overflow errors are excluded from ordinary transient retry and flow into promotion or compaction instead. A structurally oversized input never burns transport retry budget (`docs/non-compaction-retry-policy.md:17-29`, `session/session-maintenance.ts:2261-2302`).

### 17. Coding-agent handoff discipline

[VERIFIED, direct read] The repo's own `AGENTS.md` is a handoff contract: it names the primary package, defines "agent" to mean the product not the assistant, records rejected build options with measurements "so nobody re-litigates them", and requires reading back published PR descriptions (`AGENTS.md:5-7, 40, 280`). Its test filter demands every test name an externally observable failure mode and bans source-grep tests, static echoes, and bare not-throw assertions (`AGENTS.md:284-313`). [REPORTED] Handoff documents are generated by a side request that reuses the live prompt-cache key under a distinct session id, then commit as an ordinary compaction entry (`session/session-handoff.ts:125-170`).

## Do / Don't guidance

Do:
- Append records; branch by pointer; project context from the branch. Never rewrite history.
- Hash exact bytes before parse; treat a reserialized object as different bytes (FalconOS already states this in `docs/agent-contract.md:64`).
- Validate with the same schema object you advertise to the external agent.
- Resolve approval on the arguments that will actually run, and again after any rewrite.
- Spill full output to a file and label the inline elision; never silently truncate.
- Keep provider quirks in data with loud tie failures.
- Write plans an uninformed implementer can execute; require a new-behavior verification step.
- Record rejected decisions with the measurement that killed them.

Don't:
- Don't call an approval policy a sandbox. OMP documents its own gap (`docs/approval-mode.md:66-80`).
- Don't let a summary replace its sources without an anchor back to the kept originals.
- Don't treat `completed` as `accepted`; OMP separates yield success from artifact validity.
- Don't let two agents deliver one result twice; make consumption explicit.
- Don't build prompts by string concatenation in code.
- Don't wait-for-all when first-of semantics answer the question.

## FalconOS mapping and decisions

FalconOS context reviewed first: `CONTEXT.md`, `README.md`, `status.md`, `package.json`, `src/` (8 files), `docs/interfaces.md`, `docs/agent-contract.md`, `plans/roadmap.md` [VERIFIED, direct reads this session]. FalconOS conventions (provenance tags, invariants F1-F6, minimal no-dependency Node package) outrank OMP conventions where they conflict. All mappings below are [INFERRED].

| OMP pattern | FalconOS target | Decision | Reason |
| --- | --- | --- | --- |
| Retry vs resize split (16) | `src/codex.ts` | Adopt | The adapter already caps bundles at 8 MiB. Classify oversize as resize-the-bundle, never transport retry. |
| `valid \| invalid \| unavailable` result status (5) | `src/agent.ts`, `docs/agent-contract.md` | Adopt | Sharper than accept/reject. Keeps invalid-but-parseable theses inspectable without granting them authority. |
| Canonical file plus sidecar coherence (5) | `src/vault.ts` | Adopt | On republish, delete or supersede stale derived notes so no field read returns superseded data. |
| Bounded inline output with artifact spill (10) | `src/cli.ts`, `src/codex.ts` | Adopt | CLI JSON lines stay small; full raw bytes already land in `data/runs`. Add explicit elision labels where output is cut. |
| Approval re-resolution and fail closed (8) | `src/codex.ts` launch path | Adopt | Before process launch, re-check the exact argv and env against the allowlist; headless ambiguity fails closed. Extends invariant F1. |
| Reversible secret placeholders (9) | `src/codex.ts` boundary | Adopt principle | First slice sends no secrets by design. When notes may embed credentials, redact before the child process and restore only self-minted placeholders. |
| Plans as execution specs with verification (13) | `plans/` docs practice | Adopt | Roadmap checkpoints already demand evidence paths. Add the rule: every task plan names one new-behavior check with exact command and expected output. |
| Test contract filter (17) | `test/` guidance in `CONTEXT.md` or plans | Adopt | Matches the existing regression-experiment habit (`status.md:128`). Ban static-echo and source-grep tests explicitly. |
| Rejected-with-measurements records (17) | `status.md` practice | Adopt | FalconOS corrections already do this; make it a standing rule for build decisions too. |
| Append-only journal with branch-by-leaf (2) | `src/vault.ts`, run records | Defer | F4 already forbids overwrites. A branch model earns its place only when competing theses over one evidence set exist (P1B+). |
| Role-based model selection (15) | `src/codex.ts` config | Defer | One adapter, one pinned model (`gpt-5.6-luna`, max reasoning). Roles pay off at two-plus adapters. Keep `provider/modelId` naming now. |
| Hub messaging and park/revive (4, 6) | none | Defer | FalconOS orchestrates via files and exit codes. Peer messaging is P2+ scope at the earliest. |
| Advisor watchdog (14) | none | Defer | A second-model reviewer of theses is attractive for CHK-11-style checks, but it needs its own cost and access approval. |
| Hashline content-hash editing (11) | none | Reject | FalconOS never edits human notes (F4 forbids it) and writes whole files atomically. No partial-edit surface exists. |
| KDL compat rule compiler (15) | none | Reject mechanism, keep principle | A rule compiler is heavy for two providers. Keep the principle: provider quirks as data tables in one module, loud failure on ambiguity. |
| TTSR stream interruption, magic keywords, skills runtime | none | Reject | Requires owning the model stream. FalconOS drives external agents as child processes and cannot intercept their tokens. |
| RPC/SDK embedding of OMP | none | Reject for now | D1 selected Codex CLI. OMP RPC is a credible alternative adapter if Codex controls stay unverifiable, but that is a D1 revision, not a default. |

## Risks

- [INFERRED] Scale mismatch. OMP is 7111 files with a Rust core; FalconOS is eight source files with zero runtime dependencies. Copying mechanisms instead of invariants would destroy FalconOS's main property, auditability.
- [REPORTED] Docs drift exists even here: `docs/tools/edit.md:5-13` cites deleted paths. Treat OMP docs as claims, not ground truth, when porting details.
- [REPORTED] README performance figures (`README.md:115-121`) are the project's own benchmarks. Nothing here verifies them; do not cite them as independent evidence.
- [INFERRED] Bun-specific idioms (`AGENTS.md:72-160`) do not transfer to FalconOS's Node-native TypeScript runtime. Port contracts, not API calls.
- [INFERRED] The repo moves fast (PR #11558 merged the day of this snapshot). Line ranges cited here will rot; the commit hash pins them.

## License notes

[VERIFIED, direct read] MIT, three copyright holders: Mario Zechner (2025), Can Bölük (2025-2026), Stencil Labs, Inc. (2026) (`LICENSE:1-23`). OMP is a fork of Mario Zechner's pi-mono. Vendored code (`crates/vendor/brush-core`, parts of `pi-builtins`) stays under upstream licenses; `THIRD-PARTY-NOTICES.txt` (about 1 MB) carries attributions (`README.md:678-689`). Adopting patterns or small code fragments into FalconOS is compatible with MIT attribution requirements; copying vendored third-party portions would need their own license review.

## Not fetched

- [VERIFIED, scope statement] No OMP build, test suite, or binary ran in this session. All behavior claims come from reading source and docs.
- [REPORTED, scout gaps] Not read: the full 433 KB `agent-session.ts`, full `session-manager.ts` / `session-maintenance.ts` / `streaming-output.ts` / `bash.ts` (cited sections only), provider adapters other than `google.ts`, generated `models.json` and `rules.json`, the KDL rule bodies, provider-native compaction internals, snapcompact internals, IrcBus internals, and the RPC Python client.
- [VERIFIED, my gaps] Not read: `packages/tui`, `packages/metaharness`, `packages/collab-web`, `packages/mnemopi` internals beyond config/state citations, Rust crates other than the cited `pi-edit` sections, `python/robomp`, `infra/`, `nix/`, Bazel files, most of the 32 `docs/tools/*.md` guides, media assets, and all test directories (about 1500 test files). Video captures linked from the README were not fetched.

## Rules to adopt

Numbered, actionable, and supported by the citations above. Applicability is [INFERRED] throughout.

1. Append evidence records; never mutate or delete a published record. Supersede with a new record that names what it replaces.
2. Hash exact bytes before parsing; a reserialized object is not the bytes the manifest names.
3. Keep one authoritative machine record per result; on republish, remove or supersede derived sidecars so stale fields cannot be read.
4. Give every summary an anchor to the first kept original record so it stays auditable.
5. Separate a result's completion from its acceptance: track `valid | invalid | unavailable` explicitly.
6. Validate adapter input and output with the exact schema object advertised to the external agent.
7. When validation repairs malformed output, log the repair; never rewrite inputs silently.
8. Classify oversized requests as resize work, never transport retry; retry only transient transport failures.
9. Assign every external action a tier (read, write, exec) and check policy against the final arguments that will run.
10. Re-resolve approval after any argument rewriting between check and execution.
11. Fail closed when no approver is reachable; an unanswerable prompt is a denial.
12. Never describe an allowlist or approval policy as a sandbox; state ambient capability plainly in docs.
13. Redact secrets before any external-agent boundary; restore only placeholders your own process minted.
14. Record the credential source (env, config, broker) in provenance; never the credential.
15. Cap inline output; spill full bytes to a durable file and label the elision at the cut point.
16. Return structured timeout and cancellation states; never present an empty result as a clean run.
17. Name every model as `provider/modelId` in evidence, even when selection used an alias or role.
18. Keep provider and model quirks in data tables in one module; make ambiguous rule overlaps fail loudly.
19. Restrict research and planning subprocesses to read-only tool sets; grant writes only to the executing role.
20. Write plans as execution specs: every step is a concrete edit with its target, and open decisions block approval.
21. Require each plan's verification section to name one new-behavior check with the exact command and expected observable output.
22. Ban tests that assert source text, echo fixtures, or prove only that code ran; every test names the failure a consumer would observe.
23. Record rejected designs with the measurement that killed them, in the repo, so decisions are not relitigated.
24. Keep prompts and instruction text in static files under version control, not string concatenation in code.
25. Deliver each asynchronous result exactly once; the first consumer of a settled result suppresses duplicate delivery.
