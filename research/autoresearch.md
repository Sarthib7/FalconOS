# Karpathy autoresearch: source-backed patterns for FalconOS

- URL: https://github.com/karpathy/autoresearch
- Date: 2026-09-20
- Author: delegated FalconOS research agent
- Provenance: VERIFIED for repository/file observations; INFERRED for FalconOS design mappings; REPORTED for issue titles and implications.
- Repository status: `karpathy/autoresearch` exists, is public, non-archived, and is a Python project. No substitution was needed. [VERIFIED, GitHub repository metadata: https://github.com/karpathy/autoresearch]
- Studied surface: `README.md`, `program.md`, `prepare.py`, `train.py`, `analysis.ipynb`, `pyproject.toml`, and GitHub issue search results. No code was executed. [VERIFIED, https://github.com/karpathy/autoresearch/tree/master]
- License: MIT. [VERIFIED, `README.md:90-93`, https://github.com/karpathy/autoresearch/blob/master/README.md#L90-L93]

## TLDR

`autoresearch` is an autonomous **experiment optimizer**, not a web-research or knowledge-graph system. A human-authored `program.md` gives an agent a narrow experiment protocol: create a branch, establish a baseline, edit only `train.py`, run a fixed five-minute training job, parse a deterministic validation metric, keep improvements, reset regressions, and append a row to `results.tsv`. [VERIFIED, `README.md:7-17`, `program.md:7-37,66-114`, https://github.com/karpathy/autoresearch/blob/master/README.md#L7-L17, https://github.com/karpathy/autoresearch/blob/master/program.md#L7-L37]

The useful FalconOS transfer is the **bounded, evidence-linked iteration envelope**: immutable run identity, fixed evaluation inputs, explicit outcomes, and a durable experiment history. The dangerous non-transfer is its availability-first autonomy: `LOOP FOREVER`, code mutation, retry/fix judgment, and “keep or reset” based on one scalar score do not satisfy FalconOS's advisory-only, read-only, fail-closed, canonical-evidence contract. [INFERRED, grounded in `program.md:90-114`, `prepare.py:30-44`, and FalconOS `perps/perps.ts:900-1007`; https://github.com/karpathy/autoresearch/blob/master/program.md#L90-L114]

It does **not** implement the requested question -> search -> synthesize -> cite -> iterate research loop. “Question” is an experimental idea; “search” is left to the agent's reading and coding behavior; synthesis is a scalar metric comparison; citation is absent from the experiment record; iteration is git-and-metric driven. A FalconOS market-intelligence loop therefore needs a separate source-retrieval, claim/evidence, citation, and conflict-resolution layer rather than copying this repository literally. [VERIFIED for the first four repository behaviors; INFERRED for the FalconOS consequence, `program.md:33,90-106`, `analysis.ipynb:10-30,77-116`, FalconOS `stocks/stocks.ts:702-724`; https://github.com/karpathy/autoresearch/blob/master/program.md#L33-L106]

## Repository shape

- `program.md` is the operating protocol and the only file the human is expected to edit for agent context. [VERIFIED, `README.md:7-13,42-47`, https://github.com/karpathy/autoresearch/blob/master/README.md#L7-L13]
- `prepare.py` owns fixed constants, data preparation, tokenizer, dataloader, and evaluation; `train.py` contains the model, optimizer, and training loop; `pyproject.toml` pins the Python package/dependency surface. [VERIFIED, `README.md:9-15,53-59`, `pyproject.toml:1-23`, https://github.com/karpathy/autoresearch/blob/master/README.md#L9-L15]
- `analysis.ipynb` is an offline reader of `results.tsv`; it computes outcome counts, kept experiments, running-best curves, summary statistics, and deltas. It is analysis over the log, not a memory service or retrieval layer. [VERIFIED, `analysis.ipynb:10-30,58-116,160-216`, https://github.com/karpathy/autoresearch/blob/master/analysis.ipynb]
- The default objective is single-GPU language-model pretraining; the README explicitly says platform-specific results are not comparable across different hardware. [VERIFIED, `README.md:17,61-68`, https://github.com/karpathy/autoresearch/blob/master/README.md#L17-L68]

## Major concepts

### 1. Human-authored protocol as the agent's control plane

`program.md` first requires a fresh date-like run tag and branch, reading the in-scope files, checking the local cache, creating a `results.tsv` header, and getting setup confirmation. This gives an agent an explicit state transition from setup to experimentation. [VERIFIED, `program.md:7-19`, https://github.com/karpathy/autoresearch/blob/master/program.md#L7-L19]

The protocol constrains the edit surface: `train.py` is mutable, while `prepare.py`, its evaluator, and dependencies are not. The objective and simplicity criterion are explicit, so a tiny improvement with avoidable complexity can be rejected. [VERIFIED, `program.md:21-37`, https://github.com/karpathy/autoresearch/blob/master/program.md#L21-L37]

[INFERRED] For FalconOS, the analogous control plane should be a typed research-run policy: asset/universe, question, freshness window, allowed source classes, maximum iteration budget, and terminal states. It should constrain *evidence and synthesis inputs*, never grant a research agent permission to sign, custody, route, or execute. [INFERRED, FalconOS advisory boundary in `dash/render.ts:13-17`; `perps/perps.ts:1330-1519`, https://github.com/karpathy/autoresearch/blob/master/program.md#L21-L37]

### 2. Fixed-budget, fixed-evaluator experiment loop

The training budget is a fixed 300 seconds, the context length is fixed at 2048, evaluation consumes a fixed token budget, and validation is pinned to a dedicated shard. The evaluator computes vocabulary-size-independent validation bits per byte (`val_bpb`). [VERIFIED, `prepare.py:30-44,344-360`, https://github.com/karpathy/autoresearch/blob/master/prepare.py#L30-L44]

The fixed evaluator makes changes comparable **within the same machine/run setup**, while the README warns that results from different platforms are not comparable. [VERIFIED, `README.md:61-68`, https://github.com/karpathy/autoresearch/blob/master/README.md#L61-L68]

[INFERRED] FalconOS can borrow the equivalent of a fixed evaluator as a canonical evidence boundary: every synthesis should bind to one snapshot hash, capture time, source policy, and point-in-time cutoff. It must compare like-for-like snapshots, not silently combine live and historical observations. Existing perps canonical snapshots already carry provenance, source decisions, and hashes. [INFERRED, FalconOS `perps/perps.ts:6-9,254-367,401-579,902-910`; `stocks/stocks.ts:6-10,247-322,349-528`, https://github.com/karpathy/autoresearch/blob/master/prepare.py#L30-L44]

### 3. Branch/commit history as lightweight experiment memory

Each iteration inspects git state, edits `train.py`, commits the candidate, runs `uv run train.py`, extracts `val_bpb` and peak memory from the log, records the result, keeps the commit if the score improves, and resets if it does not. [VERIFIED, `program.md:90-106`, https://github.com/karpathy/autoresearch/blob/master/program.md#L90-L106]

The durable record is split: code/config history lives in git commits and branch progression; the tab-separated result ledger is explicitly left untracked. The row stores short commit hash, score, peak memory, status (`keep`, `discard`, `crash`), and a free-text description. [VERIFIED, `program.md:66-88,102-104`, https://github.com/karpathy/autoresearch/blob/master/program.md#L66-L104]

`analysis.ipynb` treats the ledger as a sequence: it identifies kept improvements, plots a running minimum, and computes each kept change's delta from the previous kept state. [VERIFIED, `analysis.ipynb:58-116,160-216`, https://github.com/karpathy/autoresearch/blob/master/analysis.ipynb]

[INFERRED] This is a useful shape for a FalconOS research ledger, but `results.tsv` is not sufficient as a knowledge base: it has no source URL, retrieved bytes/hash, claim span, freshness, conflicting observation, reviewer decision, or uncertainty. A FalconOS ledger should be immutable/versioned and bound to canonical snapshots; it should not rely on an untracked local file as the only memory. [INFERRED, comparison of `program.md:66-88` with FalconOS `stocks/stocks.ts:702-724,765-822` and `perps/perps.ts:342-367,1303-1328`; https://github.com/karpathy/autoresearch/blob/master/program.md#L66-L88]

### 4. Deterministic output parsing and failure classification

The loop greps for `val_bpb` and `peak_vram_mb`; if the output is empty, it treats the run as a crash and tails the log for a traceback. Crashes are logged with zero score and zero memory, and a timeout over ten minutes is treated as failure and reverted. [VERIFIED, `program.md:47-64,74-76,96-110`, https://github.com/karpathy/autoresearch/blob/master/program.md#L47-L110]

The evaluator itself is deterministic in its data boundary, but the loop still uses a single scalar outcome and agent judgment to decide whether a bug is easy to fix or an idea should be skipped. [VERIFIED, `prepare.py:344-360`, `program.md:108-110`, https://github.com/karpathy/autoresearch/blob/master/prepare.py#L344-L360]

[INFERRED] FalconOS should preserve the explicit distinction between READY, NO_DATA, BLOCKED, and FAILED rather than converting parse failure or missing evidence into a neutral recommendation. Existing FalconOS contracts already expose `SnapshotStatus`/`AdviceStatus`, typed risk-review failures, and `NO_DATA` outcomes. [INFERRED, FalconOS `perps/perps.ts:6-9,1297-1301,1340-1346,1433-1514`; `stocks/stocks.ts:536-553,648-779,824-894`, https://github.com/karpathy/autoresearch/blob/master/program.md#L96-L110]

### 5. No web-search, citation, or knowledge-graph discipline

The repository's source record is experiment metadata, not literature evidence. `program.md` asks the agent to read local source files and optionally read papers referenced in code when it is stuck, but it defines no search provider, query log, source ranking, citation format, quote/span capture, or claim-to-source validation. [VERIFIED, `program.md:11-15,112-114`, https://github.com/karpathy/autoresearch/blob/master/program.md#L11-L15]

The experiment ledger's `description` is free text and has no citation column; the analysis notebook reads only the five TSV columns and never resolves source links. [VERIFIED, `program.md:66-88`, `analysis.ipynb:10-30`, https://github.com/karpathy/autoresearch/blob/master/program.md#L66-L88]

[INFERRED] Therefore, the requested question -> search -> synthesize -> cite -> iterate loop must be treated as an absent capability, not an implicit feature. FalconOS needs a retrieval manifest and evidence objects before a Council agent can synthesize market intelligence. A candidate claim without a verified source capture should produce `NO_DATA` or `BLOCKED`, not a prose caveat followed by advice. [INFERRED, FalconOS `stocks/stocks.ts:702-724,765-822`; `dash/render.ts:19-40,59-65`, https://github.com/karpathy/autoresearch/blob/master/program.md#L66-L88]

### 6. Failure modes exposed by the issue history

The issue index contains a report titled “Training results lost if evaluation crashes (no pre-eval checkpoint),” showing that the current loop can lose useful work when evaluation fails at the wrong point. [REPORTED, GitHub issue #7: https://github.com/karpathy/autoresearch/issues/7]

The issue index contains “Is there a plan to reduce hallucinations?”, which is a direct signal that plausible but unsupported agent output is a recognized concern for this design. The repository itself does not add a citation validator in response to that concern. [REPORTED for issue title; VERIFIED that no citation field/validator exists in the studied `program.md`/`analysis.ipynb`, GitHub issue #200: https://github.com/karpathy/autoresearch/issues/200; `program.md:66-88`, `analysis.ipynb:10-30`]

The issue index contains “Primary Agent Context window,” indicating context-window pressure as an operational concern for a long-running autonomous agent. The baseline protocol only says to redirect logs and grep summaries; it does not define a durable context compaction or evidence-retrieval protocol. [REPORTED for issue title; VERIFIED for baseline logging protocol, GitHub issue #298: https://github.com/karpathy/autoresearch/issues/298; `program.md:59-64,96-102`]

The protocol also permits the agent to repair crashes, retry, and continue indefinitely; broad code mutation, OOMs, dependency/runtime failures, stale data, and single-run noise can all produce misleading “progress” if the scalar metric is not independently checked. [VERIFIED for prescribed repair/continuation behavior, `program.md:96-114`; INFERRED for the listed consequences, https://github.com/karpathy/autoresearch/blob/master/program.md#L96-L114]

[INFERRED] FalconOS should make every one of these failure classes visible in the artifact: missing/failed source retrieval, stale or conflicting evidence, failed schema validation, synthesis failure, reviewer veto, and incomplete run. A research run may stop or retry within a bounded policy, but it must never loop indefinitely or silently promote an unverified result. [INFERRED, FalconOS `stocks/stocks.ts:648-779,824-894`; `perps/perps.ts:1273-1301,1433-1514`]

### 7. Continuous discovery without autonomous execution

The README's intended operating mode is an unattended overnight sequence of roughly twelve five-minute experiments per hour, with the human returning to inspect the log and resulting model. [VERIFIED, `README.md:7,61-68`, `program.md:112-114`, https://github.com/karpathy/autoresearch/blob/master/README.md#L61-L68]

[INFERRED] FalconOS can use the same cadence idea for continuous market discovery: schedule bounded research jobs that propose questions, retrieve allowed sources, normalize claims, compare against the prior canonical knowledge snapshot, and emit a new immutable research artifact. The artifact can feed the lead specialist and the veto-only risk reviewer, but it must stop at advisory output. [INFERRED, FalconOS `perps/perps.ts:1066-1139,1330-1519`; `stocks/stocks.ts:702-779,801-860`]

[INFERRED] A Client Agent may consume a published advisory artifact under FalconOS's existing boundary, but the Council research loop itself must not sign, route, custody, place, or recommend an execution mechanism. The dashboard should expose evidence status, hash, citations, and reviewer state, not imply that a research improvement is an executable trade. [INFERRED, FalconOS `dash/render.ts:13-17,42-65`; `dash/council.ts:61-123`]

## FalconOS mapping

### Shared Council kernel concepts

- **Run identity and immutable evidence:** model each continuous-research run like an autoresearch branch/commit, but with a `requestId`, `runId`, point-in-time cutoff, source policy, canonical snapshot hash, and evidence-manifest hash. The existing perps envelope/bundle and stocks snapshot already provide the right seam for snapshot identity and validation. [INFERRED, FalconOS `perps/perps.ts:342-367,580-873,1146-1203`; `stocks/stocks.ts:296-528`]
- **Knowledge-base persistence:** persist research claims as versioned records keyed by canonical source/content hashes, with supersession and conflict links. Do not use an untracked TSV or mutable prompt as the authoritative KB; autoresearch demonstrates why a ledger needs a stable run identity, but not the evidence fields FalconOS requires. [INFERRED, autoresearch `program.md:66-104`; FalconOS `stocks/stocks.ts:702-724`, `perps/perps.ts:902-910`]
- **Evidence discipline:** each claim should carry source ID/URL, adapter and semantic versions, event/retrieval timestamps, raw-content hash, normalized claim, and citation span. Existing FalconOS capture/source-decision structures and stock citations are the adapter seam; a research KB should extend the shared kernel rather than duplicate per-domain provenance. [INFERRED, FalconOS `perps/perps.ts:254-340,397-499`; `stocks/stocks.ts:179-205,247-294,702-724,809-822`]
- **Fail-closed synthesis:** if required evidence is missing, stale, conflicting, unparseable, or outside the cutoff, publish `NO_DATA`/`BLOCKED` and a machine-readable reason. Never replace a failed source with an unapproved source or an agent estimate merely to keep the loop moving. [INFERRED, FalconOS `perps/perps.ts:133-135,1204-1232,1297-1301,1433-1514`; `stocks/stocks.ts:536-553,648-779,824-894`]
- **Role separation:** the lead specialist may synthesize only the evidence-bound request; the independent risk reviewer may veto, not rewrite evidence or execute; the Client Agent remains outside the Council's advisory boundary. This is the safe adaptation of autoresearch's “agent proposes, evaluator scores” pattern. [INFERRED, FalconOS `perps/perps.ts:1066-1139,1251-1301`; `stocks/stocks.ts:726-763,648-700`]

### `perps/`

`perps/perps.ts` already defines provenance values, `READY`/`NO_DATA`, fixed field names, source precedence, captures, canonical snapshot bundles, source-decision hashes, proposal hashes, lead-specialist and risk-review contracts, and a veto-only failure authority. [VERIFIED, FalconOS `perps/perps.ts:6-9,254-367,580-873,900-935,1066-1139,1297-1328`]

[INFERRED] Continuous research should consume a perps canonical bundle as its market-state input and add separately hashed research evidence; it must not mutate the bundle or fill a missing funding/open-interest field with narrative. A synthesis may discuss a hypothesis, but the published artifact must retain the original snapshot hash and stay advisory-only. [INFERRED, FalconOS `perps/perps.ts:401-579,902-910,1146-1182,1516-1590`]

### `stocks/`

`stocks/stocks.ts` has explicit `Citation` records, `PUBLISHED`/`BLOCKED`/`NO_DATA` advice states, basket snapshots, source precedence, lead/risk request-response types, and deterministic citation creation from snapshot evidence. [VERIFIED, FalconOS `stocks/stocks.ts:179-205,247-322,648-779,801-860`]

[INFERRED] This is the closest existing seam for a market-intelligence KB: preserve the stock snapshot and generated citations, then attach research claims to the same snapshot and source hashes. The Council should not publish a basket advisory if the research layer's required claim evidence is unavailable or conflicts with the canonical snapshot. [INFERRED, FalconOS `stocks/stocks.ts:809-894`]

### `dash/`

`dash/council.ts` builds live/central canonical snapshots and invokes the stocks advice boundary; its comments describe deterministic host-council behavior and explicit Pyth/DEX source precedence. [VERIFIED, FalconOS `dash/council.ts:37-63,133-196`]

`dash/render.ts` visibly emits advisory-only/executionReady=false, provenance, snapshot status, hash, missing/conflict fields, risk-review state, and citations. [VERIFIED, FalconOS `dash/render.ts:13-17,19-40,51-65`]

[INFERRED] The dashboard is the right read-only surface for a research-run card: question, cutoff, source coverage, evidence hash, synthesis status, lead result, risk veto, and citations. It should show “none (advice not published)” or `NO_DATA` when the evidence gate fails, not a best-effort answer. [INFERRED, FalconOS `dash/render.ts:39-65`]

### What does **not** transfer

1. **No `LOOP FOREVER`.** Continuous discovery must be bounded by schedule, budget, freshness, and stop conditions; indefinite autonomy is incompatible with fail-closed operations and reviewability. [INFERRED, autoresearch `program.md:106-114`, https://github.com/karpathy/autoresearch/blob/master/program.md#L106-L114]
2. **No autonomous source-code mutation.** FalconOS research agents may generate claims and questions, not edit production adapters, evaluator rules, Council policy, or execution-related code as part of a live run. [INFERRED, autoresearch `program.md:21-37`; FalconOS `perps/perps.ts:1680-1723`]
3. **No scalar-only promotion.** A lower metric is not evidence that a market claim is true; promotion needs source provenance, temporal validity, conflict handling, and reviewer status. [INFERRED, autoresearch `program.md:33,74-78`; FalconOS `stocks/stocks.ts:702-724,824-894`]
4. **No untracked memory.** `results.tsv` and transient logs are useful run artifacts, but they cannot be the canonical FalconOS knowledge base. [INFERRED, autoresearch `program.md:66-104`; FalconOS `perps/perps.ts:580-873`]
5. **No citation-free synthesis.** The target repo has no citation validator; FalconOS must reject unsupported claims rather than copy that omission. [VERIFIED for autoresearch omission; INFERRED for FalconOS gate, `program.md:66-88`, `analysis.ipynb:10-30`; FalconOS `stocks/stocks.ts:702-724`]
6. **No execution or custody path.** Autoresearch is about training code, but its autonomous agent pattern must not be extended into trading execution. FalconOS remains advisory-only/read-only and leaves execution to the Client Agent boundary. [INFERRED, FalconOS `dash/render.ts:13-17`; `perps/perps.ts:1674-1723`]

## Lessons

1. [VERIFIED] A fixed evaluator plus immutable run identity makes iteration inspectable; FalconOS should bind every synthesis to a canonical snapshot hash and cutoff, not just a timestamp. (`prepare.py:30-44,344-360`; `perps/perps.ts:342-367,902-910`; https://github.com/karpathy/autoresearch/blob/master/prepare.py#L30-L44)
2. [VERIFIED] A small explicit outcome ledger is valuable, but autoresearch's free-text, untracked TSV lacks the provenance needed for a market KB. (`program.md:66-88`; `stocks/stocks.ts:702-724`; https://github.com/karpathy/autoresearch/blob/master/program.md#L66-L88)
3. [INFERRED] FalconOS should turn every missing, stale, conflicting, or unparseable research input into `NO_DATA`/`BLOCKED`, never a neutral or estimated claim. (`program.md:96-110`; `perps/perps.ts:1297-1301`; `stocks/stocks.ts:765-779`)
4. [INFERRED] Lead synthesis and veto-only review can reuse the “proposal then evaluator” shape only when both are bound to the same evidence snapshot and neither can execute. (`perps/perps.ts:1066-1139,1251-1301`; `dash/render.ts:13-17`)
5. [REPORTED] Result-loss, hallucination, and context-window issues are already visible in autoresearch's issue history; FalconOS should make recovery, citation, and context compaction explicit rather than relying on agent judgment. (GitHub issues #7, #200, #298: https://github.com/karpathy/autoresearch/issues/7, https://github.com/karpathy/autoresearch/issues/200, https://github.com/karpathy/autoresearch/issues/298)
6. [INFERRED] The reusable unit for continuous market intelligence is an immutable evidence-bound research artifact, not a mutable prompt or a forever-running code-edit loop. (`program.md:90-114`; `dash/render.ts:15-17,39-65`)

## Least confident

1. [INFERRED] The issue titles are evidence of reported operational concerns, not a complete severity ranking or proof that each failure remains unfixed; the study did not inspect full issue discussions. (GitHub issues #7, #200, #298: https://github.com/karpathy/autoresearch/issues/7, https://github.com/karpathy/autoresearch/issues/200, https://github.com/karpathy/autoresearch/issues/298)
2. [INFERRED] The exact future FalconOS shared-kernel schema for research claims is intentionally unspecified here; the mapping relies on existing perps/stocks capture, snapshot, citation, and review seams rather than proposing a migration. (`perps/perps.ts:254-367,1146-1203`; `stocks/stocks.ts:247-322,702-724`)
3. [INFERRED] A bounded continuous-discovery scheduler could preserve autoresearch's useful cadence without importing its autonomy hazards; this is a design judgment, not behavior implemented by either repository. (`program.md:106-114`; `dash/council.ts:37-63`)
