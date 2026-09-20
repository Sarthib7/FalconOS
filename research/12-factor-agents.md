# 12-Factor Agents: patterns for FalconOS

- URL: https://github.com/humanlayer/12-factor-agents
- Date: 2026-09-10
- Source author: Dex Horthy (dexhorthy), HumanLayer, with listed contributors
- Report author: dedicated Fable 5 research agent for Sarthi
- Model: anthropic/claude-fable-5
- Provenance: REPORTED. Distilled from the source; applicability to FalconOS is marked INFERRED.
- Source commit: `d20c728368bf9c189d6d7aab704744decb6ec0cc`, dated 2025-09-21 [VERIFIED, `git log -1` after clone refresh]
- Local clone: `/tmp/falconos-source/12-factor-agents` (499 tracked files) [VERIFIED, `git ls-files | wc -l`]

## TLDR

The repo argues that reliable LLM software is mostly deterministic code with small, owned model steps [REPORTED, README.md:45-52]. Its twelve factors reduce to five moves: own the prompt and the context format, treat model output as structured data that deterministic code executes, keep one serializable event log as the only state, break the loop before any high-stakes action and wait for a recorded human decision, and keep each agent small and bounded. FalconOS already implements most of this through its agent contract, evidence rules, and checkpoint gates [INFERRED]. The main new adoptions are: an append-only event log for the P2 paper cycle, a durable pause between action selection and execution for P3, structured human approval events, and a bounded error-retry policy for the future real-agent path. The repo's demo code is illustrative, not production grade; port the patterns, not the code.

## Method

Cloned the repo, enumerated all 499 tracked files, and read: README.md, all twelve factor files, appendix 13, brief-history-of-software.md (first 60 lines), CLAUDE.md, LICENSE, drafts/a2h-spec.md (first 60 lines), and the full `packages/create-12-factor-agent/template/` source (agent.ts, state.ts, server.ts, cli.ts, a2h.ts, agent.baml) [VERIFIED, reads in this session]. Files not fetched are listed near the end.

## Major concepts

### Factor 1: Natural language to tool calls
[REPORTED, content/factor-01-natural-language-to-tool-calls.md:3-56] The atomic pattern: the model converts a phrase into one structured JSON object; deterministic code decides what to do with it. The switch on `nextStep.function` includes an explicit branch for "the model didn't call a tool we know about".

### Factor 2: Own your prompts
[REPORTED, content/factor-02-own-your-prompts.md:3-89] Do not outsource prompt text to a framework. Prompts are first-class code: versioned, tested, and inspectable. Benefits listed: full control, testing and evals, fast iteration, transparency [REPORTED, lines 76-84]. The BAML example binds one prompt to a union return type of tool objects.

### Factor 3: Own your context window
[REPORTED, content/factor-03-own-your-context-window.md:3-24,70-160,226-236] Standard chat-message format is optional. A custom serialization (the example uses XML-style event tags packed into one user message) can raise information density and token efficiency. Stated benefits include error handling ("Consider hiding errors and failed calls from context window once they are resolved" [REPORTED, line 230]) and safety filtering of sensitive data [REPORTED, line 231].

### Factor 4: Tools are just structured outputs
[REPORTED, content/factor-04-tools-are-structured-outputs.md:3-49] A "tool call" is only JSON the model emits. "The LLM decides what to do, but your code controls how it's done" [REPORTED, line 33]. Code need not map an intent to one fixed function.

### Factor 5: Unify execution state and business state
[REPORTED, content/factor-05-unify-execution-state.md:3-39] Keep one thread of events as the single source of truth. Execution state (current step, waiting status, retry counts) is metadata inferable from the event log. Benefits: trivial serialization, debugging from one place, resume from any point, forking, and human-readable rendering [REPORTED, lines 32-39].

### Factor 6: Launch, pause, resume with simple APIs
[REPORTED, content/factor-06-launch-pause-resume.md:3-25] Agents are programs: they need launch, query, pause, and resume operations. External triggers (webhooks) should resume a thread without deep orchestrator integration. Notes that many orchestrators cannot pause between tool selection and tool execution [REPORTED, line 25].

### Factor 7: Contact humans with tool calls
[REPORTED, content/factor-07-contact-humans-with-tools.md:9-17,26-45,113-121] Human contact is itself a structured intent (`request_human_input`, `done_for_now`), not plain text. The loop appends the request event, saves state, notifies the human, and breaks. A later webhook loads the thread, appends the `human_response` event, and continues. This enables outer-loop agents started by crons or events that pull a human in at the decision point.

### Factor 8: Own your control flow
[REPORTED, content/factor-08-own-your-control-flow.md:3-88] The host program owns the loop and chooses per intent: continue synchronously (fetch and append), or break and persist (clarification, high-stakes action). The author's top framework request: interruption "ESPECIALLY between the moment of tool **selection** and the moment of tool **invocation**" [REPORTED, lines 73-74]. Without it you must hold state in memory, restrict the agent to low-stakes calls, or accept unreviewed actions [REPORTED, lines 77-81].

### Factor 9: Compact errors into the context window
[REPORTED, content/factor-09-compact-errors.md:3-62,84-88] Feed a formatted error back to the model so it can correct the next call, but cap it: a `consecutive_errors` counter limited to about 3, reset on success [REPORTED, lines 31-58]. On threshold, break, restructure context, or escalate to a human via deterministic takeover [REPORTED, line 62]. Uncapped self-healing produces repeated identical failures [REPORTED, line 84].

### Factor 10: Small, focused agents
[REPORTED, content/factor-10-small-focused-agents.md:5-27] Bigger tasks mean longer context, and "As context grows, LLMs are more likely to get lost or lose focus". Keep agents to roughly 3-10, at most 20 steps [REPORTED, line 9]. Grow scope only as measured quality permits, even if models improve [REPORTED, lines 21-27].

### Factor 11: Trigger from anywhere
[REPORTED, content/factor-11-trigger-from-anywhere.md:3-17] Let users and systems start and answer agents over their own channels. Fast human reach is what makes higher-stakes tool access defensible.

### Factor 12: Stateless reducer
[REPORTED, content/factor-12-stateless-reducer.md:1-14] The file is 14 lines and mostly images: the agent as a fold over an event list. No prose argument beyond the framing.

### Appendix, Factor 13: Pre-fetch context
[REPORTED, content/appendix-13-pre-fetch.md:1-151] If a tool call is predictable, run it deterministically before the model call and put the result in the context. Remove the tool from the schema. "If you already know what tools you'll want the model to call, just call them DETERMINISTICALLY and let the model do the hard part of figuring out how to use their outputs" [REPORTED, line 147].

### Template code observations
- The canonical loop returns the thread to the caller on human-facing intents and on the high-stakes `divide` intent ("divide is scary, return it for human approval") instead of executing [REPORTED, packages/create-12-factor-agent/template/src/agent.ts:89-114].
- CLI approval: empty input approves; any text rejects with that text recorded as feedback, and the denial goes back into the thread as data [REPORTED, template/src/cli.ts:69-84,115-133].
- State store is a trivial interface (create, get, update) over JSON files, with a note to swap in any store [REPORTED, template/src/state.ts:7-27].
- Prompt-level tests assert on the parsed intent and fields for fixture threads, including a post-clarification resume case [REPORTED, template/baml_src/agent.baml:66-166].
- The webhook server is demo grade: `store.get`/`store.create` results are used without `await`, so the promise, not the thread, is consulted [REPORTED, template/src/server.ts:83-118]. Port patterns from this repo, never code.
- The repo's own CLAUDE.md is a persona-selection scaffold for its maintainers, with no agent-architecture content [REPORTED, CLAUDE.md:1-91]. The a2h draft is a protocol sketch for agent-to-human messaging with a response schema per message [REPORTED, drafts/a2h-spec.md:1-60].

## Do / don't guidance distilled from the source

Do:
- Keep the model boundary to one structured JSON object per exchange, parsed and validated by owned code.
- Keep prompt text in the repo, versioned, with fixture tests that assert on parsed output.
- Build context deterministically; pre-fetch known inputs; measure token cost of the format.
- Persist the event log before any wait; resume from the log alone.
- Break the loop before any high-stakes action; record the human decision as a structured event, including rejection feedback.
- Cap consecutive automatic retries near 3, reset on success, then escalate deterministically.
- Keep each agent task inside roughly 3-10 steps.

Don't:
- Don't hand control flow, prompts, or context assembly to a framework you cannot inspect.
- Don't give the model a fetch tool for data you can fetch yourself.
- Don't hold approval waits in process memory.
- Don't let uncapped error-retry loops run; identical context reproduces identical failures.
- Don't grow one agent into a monolith; compose small agents inside deterministic software.
- Don't treat the template code as production; it contains unawaited promises.

## FalconOS mapping

FalconOS context read before judging relevance: CONTEXT.md, README.md, status.md, package.json, src/ listing, docs/interfaces.md, docs/agent-contract.md, plans/roadmap.md [VERIFIED, reads in this session].

| Factor | FalconOS today | Candidate target files | Decision |
| --- | --- | --- | --- |
| 1, 4: structured output only | AgentThesis is strict JSON, closed schema, unknown fields rejected [REPORTED, docs/agent-contract.md:31,90] | src/agent.ts | Adopt (already held); keep for every future action proposal |
| 2: own prompts | Contract says fixed instruction wrapper to stdin; exact wrapper still needs one contract test [REPORTED, docs/agent-contract.md:384] | src/codex.ts, test/ | Adopt: version and fixture-test the wrapper |
| 3: own context window | AgentRequest is a custom bounded format: parsed scans, hashes, cutoffs, 8 MiB cap [REPORTED, docs/agent-contract.md:36-62] | src/agent.ts | Adopt (already held); measure token cost before adding fields |
| 13: pre-fetch | Evidence bundle is pre-fetched; agent gets no filesystem or tools [REPORTED, docs/agent-contract.md:33,372] | src/agent.ts | Adopt (already held) |
| 5, 12: unified event log | Scan records are canonical evidence; no cycle-level event log yet | new src/paper.ts (P2), src/vault.ts | Adopt for P2: one append-only cycle log as audit record and resume state |
| 6, 8: pause between selection and execution | Roadmap already gates P3 on exact approval [REPORTED, plans/roadmap.md:42] | src/cli.ts, future executor | Adopt: durable break between proposal and execution; no in-memory wait |
| 7: approval as structured event | Approval today is conversational (user "yes") recorded in status.md prose | new approval event type in src/types.ts | Adopt for P2/P3: approver, decision, comment, timestamp as data |
| 9: bounded errors | CLI stops after 3 consecutive incomplete scans [REPORTED, README.md:49-51]; agent contract has no automatic retry [REPORTED, docs/agent-contract.md:368] | src/codex.ts | Adopt cap-and-escalate if retries are ever added; keep failures visible |
| 10: small agents | One scan, one thesis, at most 8 notes [REPORTED, docs/agent-contract.md:62] | docs/agent-contract.md | Adopt (already held); widen only after repeated passes |
| BAML-style prompt tests | Structural fixture checks exist; no assertion tests against a real model [REPORTED, docs/agent-contract.md:345-349] | test/, CHK-10..12 | Adopt after a real model call is authorized |
| 11: trigger from anywhere | Not needed for the first slice | none | Defer |
| A2H protocol, HumanLayer SDK, webhook server | External service and dependency; FalconOS has zero runtime dependencies [VERIFIED, package.json devDependencies only] | none | Reject |
| BAML or any agent framework | Conflicts with the no-dependency rule and with the repo's own thesis | none | Reject |
| Hide resolved errors from context (factor 3, line 230) | Conflicts with invariant F5: show source errors, never present an empty list as healthy [REPORTED, CONTEXT.md:50] | none | Reject for evidence; acceptable later for the model's context window only, with the durable record untouched [INFERRED] |

## Adopt / defer / reject summary

- Adopt now (mostly reinforcement of existing contract): factors 1, 2, 3, 4, 10, 13; prompt fixture tests; error caps.
- Adopt at P2/P3: factor 5 event log for the paper cycle, factor 6/8 durable pause before execution, factor 7 structured approval events.
- Defer: factor 11 multi-channel triggers; factor 12 as an explicit refactor (assessment is already a pure function [REPORTED, docs/interfaces.md:27]).
- Reject: HumanLayer SDK, A2H service, BAML dependency, any framework for the loop, and context-hiding of errors in durable evidence.

## Risks

1. The source is experience-based opinion. Claims like the "70-80% quality bar" journey are anecdotes from founder conversations, not measurements [REPORTED, README.md:154-160]. Do not cite them as evidence in FalconOS records.
2. The repo's last commit is 2025-09-21 [VERIFIED, git log]. Model capabilities moved since; the 3-10 step bound is a heuristic, not a current measurement [INFERRED].
3. Template code contains bugs (unawaited promises in server.ts) [REPORTED, template/src/server.ts:83-118]. Copying code would import defects into a capital-adjacent system.
4. Factor 9 self-healing invites silent retries. FalconOS invariants require visible failures; any adoption must keep every failure in the durable record [INFERRED].
5. The factors assume the agent drives a tool loop. FalconOS deliberately gives the agent zero tools in the first slice; applying loop advice too literally would widen agent authority without a gate [INFERRED].

## License notes

- Code: Apache License 2.0 [REPORTED, LICENSE:1-199; README.md badge and closing section].
- Content and images: CC BY-SA 4.0 [REPORTED, README.md, License section]. Prose copied into FalconOS docs would carry attribution and share-alike duties. This report quotes short excerpts with attribution; it copies no code. Adopting the patterns (ideas) carries no license duty [INFERRED].

## Not fetched

- The three workshop trees (2025-05, 2025-05-17, 2025-07-16) beyond the 2025-05 final template equivalents; their walkthrough YAML/Markdown and notebooks.
- `packages/walkthroughgen/` internals (site tooling, not agent guidance).
- `hack/` contributor scripts, `drafts/ah2-openapi.json`, all `img/` media, and non-padded `factor-N` files (verified as one-line redirects for factor 1 only [VERIFIED, head of factor-1 file]).
- External links: the conference talks, substack posts, and the linked got-agents/mailcrew repos.
- `content/brief-history-of-software.md` lines 61-178 (the first 60 lines match the README summary).

## Rules to adopt

1. Keep the agent boundary to one structured JSON exchange; never act on agent prose.
2. Validate every agent response against a closed schema and reject unknown fields, especially fields that add authority.
3. Store the exact prompt wrapper in the repo as versioned code with a contract test.
4. Add fixture tests that assert on parsed intent and field values for the prompt, once a real model call is authorized (CHK-10..12).
5. Build the model's context deterministically: pre-fetch all evidence, grant no fetch tools, and cap bundle size.
6. Measure token cost before adding any field to the AgentRequest format.
7. Give the P2 paper cycle one append-only event log that is both the audit record and the only resume state.
8. Make every cycle resumable from its saved record alone; no state may live only in process memory.
9. Insert a durable break between action selection and action execution; execution starts from persisted state after approval.
10. Record each human approval as a structured event: approver, decision, comment, timestamp.
11. Feed a rejection comment back into the next cycle as data; a denial is information, not a dead end.
12. Cap consecutive automatic retries of any one operation at 3, reset on success, then stop and surface to a human.
13. Keep every provider and agent failure in the durable record even if a future context window compacts it.
14. When a failure repeats, change the context deterministically before retrying; identical input reproduces identical failure.
15. Keep each agent task bounded: one scan bundle, one thesis, few steps.
16. Widen agent scope only after the current scope passes its checks repeatedly.
17. Keep assessment, hashing, and gating in deterministic code; the model proposes, code disposes.
18. Handle the unknown-intent branch explicitly in every dispatch on agent output.
19. Never adopt an agent framework or SDK for the core loop; the loop stays owned, dependency-free code.
20. Port patterns from reference repos, never their code, and record the source commit when a pattern is adopted.
