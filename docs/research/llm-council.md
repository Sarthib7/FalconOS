# llm-council: orchestration pattern study

- URL: https://github.com/karpathy/llm-council
- Date: 2026-09-10
- Author: Sarthi's research agent (session root delegate)
- Model: anthropic/claude-fable-5
- Provenance: REPORTED. Distilled from the source; applicability to FalconOS is marked INFERRED.
- Studied commit: `92e1fcc` ("readme tweaks", 2025-11-22). Full history is 5 commits, all dated 2025-11-22, author karpathy: `eb0eb26` v0, `827bfd3` Label maker add, `87b4a17` progressive update and single turn, `8affe1d` vibe code warning, `92e1fcc`. [VERIFIED, `git log` after `git fetch --unshallow`]
- This is an orchestration pattern study. It is not evidence that council voting improves trading decisions.

## TLDR

[REPORTED] llm-council is a ~1,500-line local web app. It sends one user question to four models through OpenRouter, has each model rank the anonymized answers of all models, then has one chairman model write the final answer. [VERIFIED] Backend Python totals 812 lines; frontend JS/JSX totals 661 lines (`wc -l`). [REPORTED] It has no tests, no license file, no retries, no cost accounting, and non-atomic JSON storage. The transferable value is the pipeline shape: parallel fan-out, blind cross-review with a host-held identity map, deterministic aggregation in host code, one synthesizer with full context, and a UI that shows every raw output next to the parsed interpretation. The transferable warnings are just as concrete: failed providers vanish silently, review metadata is never persisted, reviewers rank their own answers, and label order is fixed, so position bias is unmeasured. [INFERRED] FalconOS should adopt the fan-out, anonymization, host-side aggregation, and raw-plus-parsed display patterns, and reject the silent-drop, ephemeral-metadata, and vote-decides-execution patterns.

## Source inventory

[VERIFIED] Cloned at `/tmp/falconos-source/llm-council`, clean tree, up to date with `origin/master`. Files read in full: `README.md`, `CLAUDE.md`, `pyproject.toml`, `start.sh`, `main.py` (root stub), `backend/config.py`, `backend/openrouter.py`, `backend/council.py`, `backend/main.py`, `backend/storage.py`, `frontend/src/api.js`, `frontend/src/App.jsx`, `frontend/src/components/Stage1.jsx`, `Stage2.jsx`, `Stage3.jsx`, `frontend/package.json`. Not read: CSS files, `ChatInterface.jsx`, `Sidebar.jsx` (UI chrome; behavior summarized in `CLAUDE.md:55-58`), Vite boilerplate, `header.jpg`, `uv.lock`.

FalconOS context read before judging relevance: `CONTEXT.md`, `README.md`, `status.md` (section map plus key sections), `package.json`, `docs/interfaces.md`, `docs/agent-contract.md`, `plans/roadmap.md`, `src/types.ts`, `src/agent.ts` (structure), `src/sources.ts` (structure).

## Major concepts

### 1. Three-stage pipeline with typed hand-offs

[REPORTED, `backend/council.py:296-335`] `run_full_council` runs three awaited stages in sequence. Stage 1 output (list of `{model, response}`) is the only input Stage 2 needs beyond the query. Stage 2 returns `(rankings, label_to_model)`. Stage 3 receives the query plus both prior stage outputs. The function returns `(stage1, stage2, stage3, metadata)` as one tuple. [REPORTED, `backend/council.py:304-310`] If Stage 1 yields zero successes, the pipeline stops and returns an explicit error result instead of running review on nothing. [INFERRED] The pattern: each stage is a pure async function over plain data. No shared mutable state crosses stages. This makes each stage testable and replaceable in isolation.

### 2. Parallel fan-out and provider isolation

[REPORTED, `backend/openrouter.py:56-79`] `query_models_parallel` builds one task per model and awaits `asyncio.gather` (line 76). Results map back to model names by `zip` order, so result identity is positional and deterministic. [REPORTED, `backend/openrouter.py:8-53`] `query_model` isolates each provider call: its own `httpx.AsyncClient`, its own 120 s timeout (line 11), one `try/except` around the whole call, and `None` on any failure (lines 51-53). One slow or broken model cannot corrupt another's result slot. [REPORTED, `backend/config.py:12-23`] All models route through one OpenRouter endpoint with one API key. Provider diversity is config data, not code. [INFERRED] Isolation here means failure isolation per call, not credential or blast-radius isolation. One leaked key exposes every model.

### 3. Anonymized peer review with a host-held identity map

[REPORTED, `backend/council.py:49-57`] Stage 2 assigns labels `Response A`, `Response B`, ... in Stage 1 result order and builds `label_to_model` on the host. Models never see real names. [REPORTED, `backend/council.py:66-97`] The ranking prompt demands a strict trailer: a `FINAL RANKING:` header, then a numbered list where each line is only a label. The prompt includes one full worked example of the expected output shape. [REPORTED, `CLAUDE.md:94-99`] De-anonymization happens client-side for display only. [INFERRED] Three gaps: (a) anonymization hides names, not style, so a model can still recognize its own text; (b) every reviewer ranks its own answer, which inflates self-scores in the aggregate; (c) labels keep one fixed order for all reviewers, so position bias is shared, not canceled.

### 4. Strict-then-lenient parsing, both results kept

[REPORTED, `backend/council.py:177-208`] `parse_ranking_from_text` first splits on `FINAL RANKING:`, then matches `\d+\.\s*Response [A-Z]`. If that fails, it falls back to any `Response [A-Z]` occurrences in order, first in the ranking section, then in the whole text. [REPORTED, `backend/council.py:99-110`] Each Stage 2 record stores both the full raw text and the `parsed_ranking` list. [INFERRED] The lenient fallback is dangerous: labels mentioned in evaluation prose can enter the ranking in prose order. Keeping raw and parsed side by side is what makes this survivable, because a human can catch the misparse.

### 5. Deterministic aggregation in host code

[REPORTED, `backend/council.py:211-255`] `calculate_aggregate_rankings` collects each model's rank position across all reviews, averages them, and sorts ascending. It counts votes per model (`rankings_count`) so partial coverage is visible. No model is asked to do arithmetic. [INFERRED] This is the right division of labor: models produce ordinal judgments, the host computes statistics. FalconOS already applies the same division in `src/scan.ts` (integer arithmetic in code, never delegated).

### 6. Chairman synthesis, not a vote

[REPORTED, `backend/council.py:115-174`] Stage 3 sends the chairman the original question, all Stage 1 responses labeled with real model names, and all Stage 2 ranking texts. The chairman writes one final answer. If the chairman call fails, a hardcoded error response is returned (lines 163-168). [REPORTED, `backend/config.py:20`] The chairman is config, and may also be a council member. [INFERRED] Notable asymmetry: Stage 2 is anonymized, Stage 3 is not. The chairman can weight by brand name. The aggregate ranking is computed but never given to the chairman; synthesis and measurement stay separate outputs.

### 7. State passing and persistence

[REPORTED, `backend/storage.py:130-156`] One assistant message persists all three stages as one JSON object per conversation file. [REPORTED, `CLAUDE.md:41`, `backend/main.py:110-123`] `label_to_model` and `aggregate_rankings` are returned in the API `metadata` field but never written to storage. Reloaded conversations cannot de-anonymize old reviews. [REPORTED, `backend/storage.py:67-78`] Writes are plain `open(path, 'w')` then `json.dump`. No temp file, no atomic rename, no locking, and every message append is a full read-modify-write of the file. [INFERRED] Any crash mid-write can truncate a conversation. FalconOS `src/vault.ts` (exclusive temp file, fsync, publish without replacement) is strictly stronger; do not import this storage pattern.

### 8. Failure and timeout handling

[REPORTED, `backend/openrouter.py:11,51-53`] One timeout knob (120 s default) per call; failures print to stdout and become `None`. [REPORTED, `backend/council.py:25-30,99-101`] Both fan-out stages filter `None` out and continue. The user is never told which model failed unless all fail. [REPORTED, `backend/main.py:176-180`] The SSE path wraps the whole generator in one `try/except` and emits a terminal `{'type': 'error'}` event. [REPORTED, `backend/main.py:141-149`] The user message is persisted before the council runs, so a mid-stream failure leaves a user message with no assistant message. [INFERRED] "Graceful degradation" here is really silent degradation. It conflicts with FalconOS invariant F2/F5 (provider failures remain visible; never present a thinner result as healthy). FalconOS `Observation` records `httpStatus`, `raw`, and `error` per call; that is the correct shape.

### 9. Cost controls

[REPORTED, `backend/config.py:12-20`] Cost control is structural only: a fixed four-model list, one chairman, no runtime model selection. [REPORTED, `backend/council.py:258-293`] The only explicit cost decision: conversation titles use `google/gemini-2.5-flash` with a 30 s timeout and a static fallback title. Cheap side task, cheap model, short timeout. [REPORTED] There is no token accounting, no spend cap, no per-run budget anywhere in the code. Each user turn costs 2N+1 model calls (N answers, N reviews, 1 synthesis) plus one title call on the first turn. [INFERRED] For FalconOS, call count per decision must be a recorded, bounded number, not an emergent one.

### 10. Evidence presentation

[REPORTED, `frontend/src/components/Stage1.jsx:12-33`] Every individual answer is inspectable in a tab, not just the winner. [REPORTED, `frontend/src/components/Stage2.jsx:52-70`] The raw evaluation text renders above an "Extracted Ranking" block, so the user can validate the parser against the source text. [REPORTED, `Stage2.jsx:5-15,28-31`] De-anonymization is a display-layer regex replace, and the UI states that the original evaluation used anonymous labels. [REPORTED, `Stage2.jsx:73-97`] Aggregate rankings show average position and vote count. [REPORTED, `CLAUDE.md:106-110`] Stated rationale: all raw outputs inspectable, parsed interpretations validatable. [INFERRED] This maps directly onto FalconOS's evidence rules: raw provider bytes stay primary, derived interpretation is labeled, and the reviewer can audit the derivation.

### 11. Progressive streaming

[REPORTED, `backend/main.py:126-190`] The stream endpoint emits typed SSE events: `stageN_start`, `stageN_complete` with payload, `title_complete`, then `complete` or `error`. Title generation runs as a parallel `asyncio.create_task` (line 146) and is awaited only at the end. [REPORTED, `frontend/src/App.jsx:71-165`] The client builds a placeholder assistant message with per-stage `loading` flags and fills it event by event; on transport error it rolls back both optimistic messages (`slice(0, -2)`). [REPORTED, `frontend/src/api.js:93-111`] The SSE reader splits each chunk on newlines and JSON-parses `data:` lines; a parse failure is logged and the event dropped. [INFERRED] The chunk parser ignores event boundaries across chunk splits, so a large event split mid-JSON is silently lost. Typed stage events are worth copying; this reader is not.

## Do / Don't

Do:
- [REPORTED, `openrouter.py:73-76`] Fan out independent generation with one gather; keep per-call isolation.
- [REPORTED, `council.py:49-57`] Anonymize before cross-review; keep the identity map host-side.
- [REPORTED, `council.py:66-97`] Demand an exact machine-parseable verdict trailer and show one worked example in the prompt.
- [REPORTED, `council.py:99-110`; `Stage2.jsx:57-70`] Store raw text and parsed result together; display both.
- [REPORTED, `council.py:211-255`] Aggregate in host code with visible vote counts.
- [REPORTED, `council.py:304-310`] Stop with an explicit error when the candidate set is empty.
- [REPORTED, `council.py:258-293`] Route cheap side tasks to a cheap model with a shorter timeout.
- [REPORTED, `main.py:126-190`] Stream typed stage events with one terminal event.

Don't:
- [REPORTED, `council.py:25-30`] Drop failed providers from results. Record them as visible failures.
- [REPORTED, `CLAUDE.md:41`] Return audit metadata without persisting it.
- [REPORTED, `storage.py:67-78`] Write shared state with non-atomic full-file rewrites.
- [INFERRED, from `council.py:49-57`] Let reviewers score their own candidate without flagging it, or keep one label order for every reviewer.
- [INFERRED, from `council.py:129-141`] Reveal candidate identities to the synthesizer if blindness was the point of Stage 2.
- [REPORTED, absence in repo] Ship a multi-model pipeline with zero cost accounting and zero tests.

## FalconOS mapping

[INFERRED] The natural insertion point is P1's agent path, after the collector. FalconOS already has the two hard parts llm-council lacks: hashed, bounded, schema-validated agent I/O (`src/agent.ts`, `docs/agent-contract.md`) and atomic evidence storage (`src/vault.ts`). llm-council contributes the multi-candidate shape on top.

| Pattern | Decision | Candidate target | Rationale |
| --- | --- | --- | --- |
| Parallel thesis fan-out over N adapters | Adopt when a second adapter exists | `src/agent.ts` (`AgentTransport` is already injectable), future `src/council.ts` | [INFERRED] `createAgentRun` per transport, `Promise.allSettled`, one `AgentRunRecord` per adapter. D1 currently selects one Codex adapter, so this waits for a second real agent. |
| Failure slot per provider, never dropped | Adopt now (already present) | `src/types.ts` `Observation`, `src/agent.ts` `AgentRunRecord` | [INFERRED] FalconOS invariants F2/F5 already forbid silent drops. Keep this stricter behavior; do not regress toward llm-council's filter. |
| Anonymized cross-review of theses | Defer to a multi-agent slice | future `src/council.ts`, contract extension in `docs/agent-contract.md` | [INFERRED] Meaningless with one adapter. When adopted: labels per reviewer shuffled, self-review excluded or flagged, map persisted in the run record. |
| Host-side aggregate ranking, persisted | Adopt with fan-out | `src/agent.ts` run record, `src/vault.ts` export | [INFERRED] Persist label map, per-reviewer parsed ranking, and averages in canonical JSON, unlike llm-council's ephemeral metadata. |
| Strict verdict format plus raw-and-parsed storage | Adopt now (already stronger) | `src/agent.ts` `validateAgentThesis` | [INFERRED] FalconOS validates exact keys, byte caps, and citations, and rejects instead of falling back. Keep rejection; add raw-transcript retention beside the validated thesis for audit. |
| Chairman synthesis of a final thesis | Defer | future `src/council.ts` | [INFERRED] Only after CP1B evidence shows multiple theses disagree in useful ways. Synthesis output must stay `executionReady: false` and cite evidence, per the contract. |
| Council vote as trade decision | Reject | n/a | [INFERRED] CONTEXT.md: live data and deterministic checks govern execution. REJECT/REVIEW/UNAVAILABLE in `src/scan.ts` stays deterministic. Model output never flips a candidate status. |
| Cheap-model side tasks | Adopt when any summary task appears | `src/cli.ts`, vault note titles | [INFERRED] Direct copy of the title pattern: cheap model, short timeout, static fallback. |
| Typed stage events on the stream | Adopt shape only | `src/cli.ts` JSON lines | [INFERRED] CLI already emits one JSON line per scan. If multi-stage agent runs land, emit `stage_start`/`stage_complete` JSON lines. Skip SSE; the CLI is the interface. |
| JSON file storage pattern | Reject | n/a | [INFERRED] `src/vault.ts` atomic publish is already stronger. |
| Raw-plus-parsed review UI | Adopt at P5 | review view planned in `docs/brand-brief.md` scope | [INFERRED] The P5 reviewer view should show raw thesis text beside validated fields, mirroring Stage2.jsx. |

## Risks

1. [INFERRED] Pattern-washing: adopting council structure without measuring whether extra theses change decisions. FalconOS roadmap already demands a paired comparison (graph vs no graph); a council needs the same gate (one adapter vs N adapters).
2. [INFERRED] Cost multiplication: 2N+1 calls per question. At N=4 that is 9 paid calls for one answer. Applied per scan cycle, this dominates spend. Any adoption needs a per-run call budget and recorded token counts.
3. [INFERRED] Silent-degradation import: copying the `None`-filter style would violate F2/F5 and could present a one-agent result as a council result.
4. [INFERRED] Self-preference and position bias are unmitigated in the source. Averaged ranks inherit both. Do not treat aggregate rank as a quality measurement without shuffled labels and self-vote exclusion.
5. [INFERRED] The source is explicitly unmaintained ("vibe coded", "I'm not going to support it", `README.md:15`, commit `8affe1d`). Treat it as a sketch, not a reference implementation. It has no tests to anchor behavior claims.
6. [INFERRED] Chairman non-blindness (Stage 3 sees model names) shows how easily an anonymity invariant erodes across stages. Any FalconOS anonymity rule needs a test that greps outbound prompts for adapter identifiers.

## License notes

- [VERIFIED, glob at commit `92e1fcc`] No `LICENSE`, `LICENSE.*`, or license file exists anywhere in the repository tree.
- [REPORTED, `pyproject.toml`] No `license` field is declared.
- [INFERRED] Under GitHub's terms, no license means default copyright: viewing and forking on GitHub is permitted, but copying code into FalconOS is not licensed. `README.md:15` says the repo is "provided here as is for other people's inspiration", which signals intent but is not a license grant.
- [INFERRED] Consequence: adopt the patterns described here as clean-room reimplementations in TypeScript. Do not port function bodies or prompt text verbatim. The Stage 2 prompt structure (strict trailer plus worked example) is an idea, not protected expression, but rewrite it in FalconOS's own words.

## Not fetched / gaps

- [VERIFIED] No code from this repo was executed. No OpenRouter call, no backend boot, no frontend build. All behavior claims come from reading source at `92e1fcc`.
- [REPORTED, `CLAUDE.md:146`] `test_openrouter.py` is referenced but absent from the tree [VERIFIED, glob]. The repo therefore contains zero tests.
- Not read: CSS files, `ChatInterface.jsx`, `Sidebar.jsx`, `vite.config.js`, `eslint.config.js`, `frontend/src/main.jsx`, `uv.lock`, `header.jpg`. [INFERRED] These are presentation and toolchain files with no orchestration content, per `CLAUDE.md:55-79`.
- OpenRouter API documentation was not fetched. Claims about the API surface are limited to what the client code sends.
- No FalconOS source files were modified. This file is the only write.

## Rules to adopt

1. Fan out independent candidate generation in one parallel batch; never serialize calls that share no state (`openrouter.py:73-76`).
2. Give every provider call its own timeout and its own error boundary, so one failure cannot poison sibling results (`openrouter.py:8-53`).
3. Record a failed provider call as a visible result with its error, never as an omitted entry; FalconOS `Observation` already does this, keep it.
4. When every candidate fails, return one explicit error result and skip review and synthesis entirely (`council.py:304-310`).
5. Anonymize candidate identity before any cross-review; hold the label map on the host and never place real identities in the review prompt (`council.py:49-57`).
6. Persist the label map, each parsed ranking, and the aggregate with the run record; metadata that only rides the API response is lost to audits (`CLAUDE.md:41`).
7. Require a machine-parseable verdict trailer with an exact header and line shape, and include one worked example in the prompt (`council.py:66-97`).
8. Store the raw model text and the parsed verdict together; never keep only the parse (`council.py:99-110`).
9. Display the parsed interpretation next to the raw text in any review surface, so a human can catch parser drift (`Stage2.jsx:52-70`).
10. Compute aggregates, averages, and orderings in host code with integer or fixed arithmetic; never ask a model to do the math (`council.py:211-255`).
11. Show vote counts beside averages so partial reviewer coverage is visible (`council.py:246-251`).
12. Prefer strict parsing with rejection over lenient fallbacks in anything execution-adjacent; keep lenient fallbacks only for display, clearly labeled (contrast `council.py:196-207` with `src/agent.ts` `validateAgentThesis`).
13. Exclude a reviewer's own candidate from its scored ranking, or flag self-votes in the aggregate; the source does neither.
14. Shuffle or rotate anonymized labels per reviewer so position bias cancels instead of compounding; the source uses one fixed order.
15. If a stage promises blindness, enforce it in every later stage too, and test outbound prompts for identity leaks; the source chairman sees real names (`council.py:129-141`).
16. Keep the synthesizer separate from the measurement: synthesis is labeled narrative, aggregate rank is labeled measurement, and neither replaces deterministic candidate status.
17. Route cheap side tasks to the cheapest adequate model with a short timeout and a static fallback value (`council.py:258-293`).
18. Fix the adapter list and call count per run in config so cost per decision is a bounded, reviewable number; add token or spend recording, which the source lacks.
19. Emit typed stage events (`start`, `complete`, terminal `complete` or `error`) so consumers render progress without guessing (`main.py:126-190`).
20. Persist a run atomically: input and full staged output publish together, never a user turn without its result (contrast `main.py:141-149` and `storage.py:67-78` with `src/vault.ts`).
21. Treat all model output as untrusted input: byte caps, schema checks, exact-key validation before acceptance; FalconOS `MAX_THESIS_BYTES` and `exactKeys` already implement this.
22. Keep each council run single-turn over a frozen evidence bundle; do not thread conversation history through review stages (commit `87b4a17`, `council.py` stages take only the query and prior stage data).
