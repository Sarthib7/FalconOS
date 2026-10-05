# TradingAgents: source-backed patterns for FalconOS

- URL: https://github.com/TauricResearch/TradingAgents
- Date: 2026-09-10
- Author: dedicated Fable 5 research agent for FalconOS
- Model: anthropic/claude-fable-5
- Provenance: REPORTED. Distilled from the source; applicability to FalconOS is marked INFERRED.
- Studied commit: `be952b8eccb49720509af544c6675233bc1f10d0` (merge of v0.4.2, 2026-09-07) [VERIFIED, `git log` on the clone at /tmp/falconos-source/tradingagents]
- License: Apache License 2.0 [VERIFIED, read of `LICENSE:1-3`]
- Method: this agent read the core agent, graph, schema, memory, and validator files directly. Three delegated scouts read `dataflows/`, `llm_clients/`, `cli/`, and `tests/` and returned line-cited reports. Scout-only claims are marked [REPORTED, scout]. No TradingAgents code was executed.

## TLDR

TradingAgents (v0.4.2, Python, LangGraph) runs a fixed pipeline: four analysts, a bull/bear debate, a research manager, a trader, a three-way risk debate, and a portfolio manager. Its strongest patterns are not the debate prompts. They are the correctness layers added across v0.3.x and v0.4.x: typed Pydantic outputs with deterministic markdown rendering, a REVIEW sentinel instead of a fabricated Hold, a deterministic verification snapshot that grounds numeric claims, point-in-time cutoffs on every data source and on the memory log, a vendor router keyed to a typed error taxonomy, and checkpoint identity that includes graph shape. Claims never reach execution: the final artifact is a rated markdown decision, and no order, wallet, or exchange code exists in the repo. FalconOS already matches several of these invariants and should adopt the outcome-resolution-date, path-map, and typed-error patterns while rejecting the free-text fallback and warn-only validation.

## Repository shape

[VERIFIED, `git ls-files | wc -l`] 168 tracked files, of which 63 are `tests/*.py`. [REPORTED] `tradingagents/agents/` holds one factory function per role. `tradingagents/graph/` holds LangGraph wiring, routing, checkpointing, signal extraction, and reflection. `tradingagents/dataflows/` holds vendor adapters and validation. `tradingagents/llm_clients/` holds a provider factory and per-provider adapters. `cli/` is a Rich TUI. The test suite defends the invariants listed below.

## Major concepts

### 1. Agent roles as small factory functions over shared state

[REPORTED] Every agent is a `create_X(llm)` factory returning a node function that reads a typed `AgentState` and returns a partial state update (`tradingagents/agents/researchers/bull_researcher.py:8-64`). State is three TypedDicts: `AgentState` plus nested `InvestDebateState` and `RiskDebateState` with per-speaker histories, a shared history, the latest response, and a turn count (`tradingagents/agents/utils/agent_states.py:8-76`). Reports flow between stages as plain strings on named state keys (`market_report`, `investment_plan`, `trader_investment_plan`, `final_trade_decision`). Analysts get tools; downstream agents get only prior reports in the prompt. Node wiring lives in one place (`tradingagents/graph/setup.py:94-156`) with the analyst subset expressed as a declarative execution plan (`tradingagents/graph/analyst_execution.py:20-69`).

### 2. Debate workflow: adversarial pair, then judge

[REPORTED] Bull and bear researchers alternate. The router ends the debate when `count >= 2 * max_debate_rounds`, then hands to the Research Manager; otherwise it alternates on whether the last response starts with "Bull" (`tradingagents/graph/conditional_logic.py:52-61`). The risk debate rotates three personas (aggressive, conservative, neutral) by `latest_speaker` prefix until `count >= 3 * max_risk_discuss_rounds` (`tradingagents/graph/conditional_logic.py:63-73`). Two hardening patterns matter:

- Opening marker. The first speaker would otherwise receive an empty opponent argument interpolated into a "refute the opponent" prompt, which makes the model invent the other side. `opponent_argument_or_opening` substitutes an explicit "(The X has not spoken yet ...)" marker (`tradingagents/agents/utils/agent_utils.py:68-79`; issue ref #1176 in the docstring). Tests assert every possible opener sees the marker (`tests/test_debate_opening.py:58-111`) [REPORTED, scout].
- Complete path maps. Every conditional edge maps all possible router returns, so label drift under prompt or i18n changes cannot hit a missing LangGraph path entry and crash mid-run (`tradingagents/graph/setup.py:29-42,137-152`; issue ref #1088). Tested under renamed and translated labels (`tests/test_risk_router_path_map.py:19-74`) [REPORTED, scout].

[REPORTED] Judges are told to weigh sides "independent of which side spoke first or last" and to pick Hold when evidence is balanced rather than manufacture a direction (`tradingagents/agents/managers/research_manager.py:39`, `tradingagents/agents/managers/portfolio_manager.py:65`). This is prompt-level bias control only; nothing measures order effects.

### 3. Structured outputs layered on prose, with rendering back to markdown

[REPORTED] Decision agents (Research Manager, Trader, Portfolio Manager, Sentiment Analyst) bind a Pydantic schema once at creation and render the parsed instance back to fixed markdown headers, so downstream consumers keep reading one shape (`tradingagents/agents/schemas.py:1-17,121-129,258-277`). Field descriptions carry the output instructions, which keeps the prompt body for context (`tradingagents/agents/schemas.py:212-219`). Notable schema defenses:

- Nullish coercion. LLMs write "None", "N/A", "$1,234.50", or "15%" into optional float fields. A validator maps placeholders and percentages to None and strips currency formatting, so one bad field nulls out instead of failing the whole proposal (`tradingagents/agents/schemas.py:26-50,176-179`; issue refs #1058, #1288).
- Price fields are absolute levels by contract. The Trader prompt states entry and stop must be absolute prices, never percentages, because "15%" read as 15 would put a stop at $15 on a $600 stock (`tradingagents/agents/trader/trader.py:53-59`).
- Enums for every decision: 5-tier `PortfolioRating` for managers, 3-tier `TraderAction` for the trader, 6-tier `SentimentBand` plus a bounded 0-10 score for sentiment (`tradingagents/agents/schemas.py:58-79,285-297,319-330`).

[REPORTED] The invocation helper runs the structured call and, on any exception or a None parse, logs a warning and retries once as free text so the pipeline never blocks (`tradingagents/agents/utils/structured.py:59-89`). The fallback returns raw `response.content` with no schema validation. This is a deliberate availability-over-integrity trade.

### 4. Signal extraction and the REVIEW sentinel

[REPORTED] The final decision is parsed by a deterministic two-pass regex over NFKC-normalized text: an explicit "Rating: X" label first, then the first standalone rating word (`tradingagents/agents/utils/rating.py:37-66`). No second LLM call (`tradingagents/graph/signal_processing.py:20-38`). An unparseable decision returns the non-tradeable sentinel `REVIEW` rather than a fabricated Hold, so parse failure is visible instead of masquerading as a neutral position (`tradingagents/agents/utils/rating.py:26-31`; `tradingagents/graph/signal_processing.py:29-38`; issue ref #1170). The legacy `parse_rating` keeps a silent Hold default only for the memory log (`tradingagents/agents/utils/rating.py:69-78`).

### 5. Claims separated from execution

[REPORTED] No execution code exists. The pipeline ends at `Portfolio Manager -> END` (`tradingagents/graph/setup.py:154`), and `propagate` returns `(final_state, signal)` (`tradingagents/graph/trading_graph.py:404-429`). The README's "sent to the simulated exchange" line (`README.md:91`) has no implementation behind it; the disclaimer marks the framework research-only (`README.md:61`). Outcome measurement is retrospective price lookup, not fills (`tradingagents/graph/trading_graph.py:273-324`). [INFERRED] This matches FalconOS invariant F6 and the `executionReady: false` boundary: the decision artifact is a claim with a rating, and execution is a separate, absent system.

### 6. Grounding: deterministic identity and a verification snapshot

[REPORTED] Two mechanisms stop cross-run confabulation:

- Instrument identity is resolved once at run start via a cached, fail-open yfinance lookup and injected into every prompt, with the instruction not to substitute a different company. This exists because the market analyst used to pattern-match price action to a wrong company, which cascaded through every downstream agent (`tradingagents/agents/utils/agent_utils.py:92-201`; issue ref #814; `tradingagents/graph/trading_graph.py:367-377`).
- A deterministic `get_verified_market_snapshot` tool computes the latest OHLCV row, a fixed indicator set, and recent closes with no LLM. The market analyst prompt requires calling it before exact numeric claims, treating it as the source of truth, and flagging conflicts with other tool output rather than inventing a reconciled number (`tradingagents/agents/utils/market_data_validation_tools.py:8-23`; `tradingagents/dataflows/market_data_validator.py:1-45`; `tradingagents/agents/analysts/market_analyst.py:51`).

### 7. Data boundaries: vendor router, typed errors, point-in-time cutoffs

[REPORTED, scout] The dataflow layer routes each tool through a configured vendor chain where "the configured vendor list IS the chain"; nothing routes silently to unchosen vendors (`tradingagents/dataflows/interface.py:168-193`; `tradingagents/default_config.py:134-150`). Fallback advances only on a typed, behavior-based error taxonomy: `NoMarketDataError`, `VendorRateLimitError`, `VendorNotConfiguredError` (`tradingagents/dataflows/errors.py:1-55`; `tradingagents/dataflows/interface.py:195-263`). Exhausted no-data becomes an explicit `NO_DATA_AVAILABLE` message telling the agent not to estimate (`tests/test_no_data_handling.py:51-81`).

[REPORTED, scout] Look-ahead prevention is layered per source: a shared half-open UTC window predicate for dated content, with undated items dropped on historical runs (`tradingagents/dataflows/date_window.py:19-32`); OHLCV filtered to `Date <= curr_date` before any indicator math (`tradingagents/dataflows/stockstats_utils.py:242-275`); Alpha Vantage full-series responses trimmed because "this trim is the only thing keeping bars after end_date out" (`tradingagents/dataflows/alpha_vantage_common.py:116-145`); live company profiles withheld for past dates since profile fields have no historical vintage (`tradingagents/dataflows/date_window.py:35-60`); FRED pinned to a revision vintage so a backtest cannot see later data revisions (`tradingagents/dataflows/fred.py:154-223`). A 10-calendar-day staleness guard refuses stale OHLCV instead of serving it (`tradingagents/dataflows/stockstats_utils.py:130-164`). Known gaps: Polymarket and insider-transaction tools take no analysis date and answer from "now", so a historical run can leak the present through them (`tradingagents/dataflows/polymarket.py:47-96`; `tradingagents/dataflows/interface.py:63-65,131-143`).

### 8. Memory: append-only decision log with outcome resolution dates

[REPORTED] Each run appends `[date | ticker | rating | pending]` plus the full decision to a markdown log, delimited by an HTML comment that cannot appear in LLM prose (`tradingagents/agents/utils/memory.py:12-49`). On the next same-ticker run, realized and alpha returns are fetched, a 2-4 sentence reflection is generated with the outcome in the prompt (`tradingagents/graph/reflection.py:14-57`), and the entry is resolved with an atomic temp-file replace (`tradingagents/agents/utils/memory.py:111-175`). The key correctness idea: each resolved entry stores `resolved:YYYY-MM-DD`, the date the outcome became knowable, and a historical run filters injected lessons to those resolved on or before its trade date, so a backtest cannot learn from the future (`tradingagents/agents/utils/memory.py:70-107,233-246`; `tradingagents/graph/trading_graph.py:379-388`; issue ref #1251). Outcomes settle only after the full holding window has traded; premature reruns leave the entry pending (`tradingagents/graph/trading_graph.py:300-304`; issue ref #1169). Only the Portfolio Manager receives past context (`tradingagents/agents/managers/portfolio_manager.py:36-41`).

### 9. Orchestration: checkpoint identity includes graph shape

[REPORTED] Opt-in LangGraph checkpointing uses per-ticker SQLite files, and the thread ID hashes ticker, date, and a run signature of analyst selection, debate depth, risk depth, and asset mode, so a resume under a different graph shape starts fresh instead of silently continuing the old graph (`tradingagents/graph/checkpointer.py:28-38`; `tradingagents/graph/trading_graph.py:390-402`; issue ref #1089). Resume passes `None` to LangGraph; re-passing the initial state would duplicate messages through the reducer (`tradingagents/graph/trading_graph.py:460-468`; issue ref #1249). Checkpoints clear on success. Message history is wiped between analysts and replaced by a placeholder anchored to the instrument and date, because some providers interpreted a bare "Continue" as the literal user task (`tradingagents/agents/utils/agent_utils.py:204-226`; issue ref #888).

### 10. Model failure handling

[REPORTED, scout] A provider factory dispatches native Anthropic/Google/Azure/Bedrock adapters and a declarative registry of OpenAI-compatible providers (`tradingagents/llm_clients/factory.py:29-54`; `tradingagents/llm_clients/openai_client.py:177-234`). Config coercion fails loudly at startup for invalid `llm_max_retries` and `max_tokens` (`tradingagents/graph/trading_graph.py:48-76`), then hands retry budgets to the SDK rather than running an application retry loop. Per-model capability rows gate structured-output method and tool choice, resolved exact-ID, then regex, then a permissive default (`tradingagents/llm_clients/capabilities.py:93-134`). Weaknesses: unknown models produce a RuntimeWarning ending "Continuing anyway" (`tradingagents/llm_clients/base_client.py:40-52`); adapters copy only allowlisted kwargs so misspelled parameters vanish silently; reasoning knobs are silently dropped or rewritten based on model-name matching (`tradingagents/llm_clients/openai_client.py:171-175`; `tradingagents/llm_clients/google_client.py:44-52`); the unknown-model capability default is optimistic, so stale catalog knowledge becomes remote 400s.

### 11. Run artifacts

[REPORTED] A shared writer produces a numbered tree (`1_analysts/` through `5_portfolio/decision.md`) plus `complete_report.md`, used identically by CLI and programmatic runs (`tradingagents/reporting.py:13-101`; `tradingagents/graph/trading_graph.py:494-507`). The full state also lands as JSON per date with the ticker path-traversal checked (`tradingagents/graph/trading_graph.py:576-616`). [REPORTED, scout] CI runs pytest on four Python versions plus a clean-install import check and ruff (`.github/workflows/ci.yml:11-57`); a real-provider structured-output smoke script exists but is manual (`scripts/smoke_structured_output.py:1-18`).

## Brittle or unsupported prompt patterns

- [REPORTED] Stop-phrase magic string. Analyst prompts instruct models to prefix "FINAL TRANSACTION PROPOSAL: **BUY/HOLD/SELL**" as a team stop signal (`tradingagents/agents/analysts/market_analyst.py:66-67`; same block in news, fundamentals, sentiment). The renderer preserves the line only "for backward compatibility with ... any external code that greps for it" (`tradingagents/agents/schemas.py:185-188`). Routing does not actually depend on it; it survives as vestigial prompt noise that invites premature stop text in analyst reports.
- [REPORTED] String-prefix speaker routing. Debate turns route on `current_response.startswith("Bull")` and `latest_speaker.startswith("Aggressive")` (`tradingagents/graph/conditional_logic.py:59,69-71`). Structured state fields would be sturdier; the complete path maps exist precisely because this drifted.
- [REPORTED] Regex rating fallback. Pass two of `extract_rating` accepts the first standalone rating word anywhere in prose (`tradingagents/agents/utils/rating.py:40-42,62-64`), so incidental "hold" in a sentence can become the signal when the labeled header is missing. Safe only because structured rendering normally guarantees the header.
- [REPORTED] Prompt-level tool prohibition. Schema-only agents state `NO_EXTERNAL_TOOLS` in text because schema binding exposes exactly one tool and a stray search call would void the structured attempt (`tradingagents/agents/utils/structured.py:31-39`). A prompt sentence is patching a mechanical constraint.
- [REPORTED] Unbounded debate context. Histories grow by raw string concatenation each turn with no token budget (`tradingagents/agents/researchers/bull_researcher.py:54-60`); multi-round configs inflate every subsequent prompt.
- [REPORTED] Sentiment band/score coherence is requested, not enforced: "Only the 0-10 bounds are enforced" (`tradingagents/agents/schemas.py:319-330`).
- [REPORTED] Free-text fallback abandons every schema guarantee downstream consumers rely on (`tradingagents/agents/utils/structured.py:88-89`).
- [REPORTED, scout] Adapter error strings defeat vendor fallback: several adapters catch broadly and return "Error retrieving..." strings, which the router counts as success, so the configured secondary vendor never runs (`tradingagents/dataflows/interface.py:197-220`; `tradingagents/dataflows/y_finance.py:347-349`). The Alpha Vantage indicator path even swallows its own typed rate-limit error (`tradingagents/dataflows/alpha_vantage_indicator.py:212-219`).
- [REPORTED, scout] Alpha Vantage failure classification string-matches vendor prose like "rate limit" and "premium" (`tradingagents/dataflows/alpha_vantage_common.py:91-112`).
- [REPORTED, scout] CLI content extraction runs model output through `ast.literal_eval` and drops falsey literals such as "0" or "[]" (`cli/main.py:895-933`); a human message equal to "Continue" is reclassified as an internal control message (`cli/main.py:936-959`).
- [REPORTED] Debate prompts hard-code equity vocabulary ("company's market opportunities", "market saturation") even in crypto mode, where only the label and fundamentals caption adapt (`tradingagents/agents/researchers/bull_researcher.py:22-36`).

## Do / Don't guidance

Do:
- Render structured output back to one fixed markdown shape so humans and parsers read the same artifact.
- Emit a non-tradeable sentinel on parse failure; never default an unreadable decision to a neutral action.
- Give the first debate speaker an explicit "opponent has not spoken" marker.
- Make every router edge map every possible return value.
- Ground exact numeric claims in a deterministic snapshot tool and instruct the model to flag conflicts, not reconcile them.
- Record when each outcome became knowable, and filter injected lessons by that date on historical runs.
- Put graph-shape inputs into checkpoint identity.
- Coerce optional numeric fields defensively; drop unsalvageable values (percentages where prices belong) to null rather than failing or misreading them.
- Fail loudly at startup on invalid configuration values.
- Keep the vendor chain exactly what the operator configured, and advance it only on typed errors.

Don't:
- Don't fall back to unvalidated free text when a structured call fails, if downstream code depends on the schema.
- Don't return error prose as a normal result; it reads as success to the caller and kills fallback.
- Don't route on string prefixes of model-authored text.
- Don't keep vestigial stop-phrase instructions in prompts after the mechanism they served is gone.
- Don't let unknown models or misspelled parameters pass with a warning into an unattended run.
- Don't expose date-less live tools (Polymarket-style) to historical analyses.
- Don't rely on prompt text to hold two output fields mutually consistent when a validator could.

## FalconOS mapping

[INFERRED] All mappings below are inferences about applicability; FalconOS state is from its own repo docs read this session.

| TradingAgents pattern | FalconOS target | Decision |
| --- | --- | --- |
| REVIEW sentinel for unparseable decisions (`rating.py:26-31`) | Already aligned: no accepted thesis on schema failure (`docs/agent-contract.md:31`); keep, and never add a neutral default | Adopt (already held) |
| Outcome resolution dates + as-of lesson filtering (`memory.py:70-107`) | P2 paper-cycle outcomes in `plans/roadmap.md:27`; add a `resolvedAt` field to outcome records in `src/types.ts` and filter graph context by it in `src/agent.ts` request building | Adopt |
| Typed error taxonomy keyed to router reaction (`dataflows/errors.py`) | `src/sources.ts` provider failures: classify no-data vs rate-limit vs not-configured instead of one error string, surfaced in scan coverage (`src/scan.ts`) | Adopt |
| Deterministic verification snapshot for numeric claims (`market_data_validator.py`) | FalconOS already computes candidates deterministically in `src/scan.ts`; when LLM theses arrive (P1B), require citations to canonical evidence hashes, which `docs/agent-contract.md:66-94` already does | Adopt (already held) |
| Deterministic identity resolved once, injected everywhere (`agent_utils.py:92-183`) | Token registry with pinned addresses and decimals already plays this role (`test/fixtures/public-metadata.json` per `docs/interfaces.md:31`); add runtime revalidation later | Adopt (already held) |
| Complete path maps on routers (`setup.py:29-42`) | Future multi-step agent flows in `src/agent.ts` or `src/codex.ts`; exhaustive switch on status unions with `never` checks | Adopt |
| Checkpoint identity includes run signature (`checkpointer.py:28-38`) | Future watch resume in `src/cli.ts`: if scan resume is added, key it on config shape (assets, chains, amounts) rather than run ID alone | Adopt when resume exists |
| Nullish float coercion (`schemas.py:26-50`) | `src/codex.ts` thesis parsing: map "N/A"-style strings in optional numeric fields to null before validation | Adopt |
| Opening marker for debates (`agent_utils.py:68-79`) | No debate in current scope; relevant only if a bull/bear review pass is added around theses | Defer |
| Bull/bear plus risk-persona debate structure | FalconOS P1B is one cited thesis from one agent; multi-persona review is post-MVP | Defer |
| Reflection loop over realized outcomes (`reflection.py`) | Needs P2 outcomes first; then a bounded reflection note linked in the Obsidian graph | Defer |
| Free-text fallback on structured failure (`structured.py:59-89`) | Contradicts the strict contract: a nonzero exit, non-JSON, or schema failure "produces no accepted thesis" (`docs/agent-contract.md:31`) | Reject |
| Warn-only unknown-model validation (`base_client.py:40-52`) | FalconOS gates Codex until controls are verified (`status.md:53`); keep hard gating | Reject |
| Permissive capability default for unknown models | Same reason; fail closed | Reject |
| Prompt stop-phrase magic string | Nothing in FalconOS greps output prose; never introduce one | Reject |

## Risks

- [INFERRED] Copying the debate prompts wholesale imports equity vocabulary and untested persuasion framing into a stablecoin FX context; the debate itself has no measured benefit in the repo (no eval harness exists in the tree).
- [INFERRED] The availability-over-integrity fallback pattern is contagious: one adopted silent fallback (free text, warn-only model names, error-string results) undermines FalconOS's evidence rules, which depend on failures staying visible.
- [REPORTED] Backtest integrity in TradingAgents is partial by its own admission: social and news sources "still reflect now" for live windows (`README.md:271`), and Polymarket plus insider tools are date-less. [INFERRED] Any FalconOS historical-replay feature must inventory every source for an as-of parameter before trusting replay results.
- [INFERRED] Regex extraction over rendered markdown works only while rendering is the sole producer. If FalconOS ever parses agent prose, use the schema field, never a text scan.

## License notes

[VERIFIED, file read] `LICENSE` is the Apache License 2.0 text. [INFERRED] Patterns and re-implemented ideas carry no copyleft obligation. Copying code verbatim into FalconOS would require preserving the license notice and stating changes (Apache 2.0 sections 4(a)-4(c)); re-implementation in TypeScript avoids this. The repo asks for citation of arXiv:2412.20138 as a courtesy (`README.md:291-305`), not a license term.

## Not fetched

- GitHub issues referenced in code comments (#557, #796, #814, #888, #983, #1027, #1058, #1088, #1089, #1091, #1130, #1167, #1169, #1170, #1176, #1204, #1220, #1249, #1251, #1288): cited here as in-source references only; issue bodies were not fetched.
- The arXiv paper (2412.20138) and Trading-R1 report: not fetched; all claims are from the repository at the studied commit.
- `assets/` diagrams: not inspected.
- `CHANGELOG.md`: read by scout for recent themes only, not in full.
- Runtime behavior: no TradingAgents code was executed; every code claim is a source read, not a measurement.

## Rules to adopt

1. A decision that cannot be parsed yields a named non-actionable sentinel, never a default action.
2. Every structured agent output renders to one fixed, versioned artifact shape that humans and parsers share.
3. Schema field descriptions carry output instructions; the prompt body carries only context and judgment guidance.
4. Optional numeric fields coerce placeholder strings to null before validation; unsalvageable values (a percentage where a price belongs) drop to null rather than being misread.
5. Numeric fields state their unit and form in the schema description, with one concrete example.
6. A schema, transport, or process failure produces no accepted output; there is no unvalidated fallback path.
7. Provider and source failures are typed by required reaction (no-data, rate-limit, not-configured), and fallback advances only on those types.
8. An adapter never returns error prose as a normal result; failures raise or return a typed failure the caller must handle.
9. Exhausted sources produce an explicit unavailable verdict that instructs consumers not to estimate.
10. Every dated data source takes an as-of parameter; sources that cannot be pinned to a date are excluded from historical runs.
11. Undated items are excluded from historical windows rather than guessed into them.
12. Data older than a stated staleness bound is refused, not served with a warning.
13. Instrument identity (addresses, decimals, names) is resolved deterministically once per run and injected into every agent input; agents may not substitute identity from pattern-matching.
14. Exact numeric claims in agent output must cite a deterministic snapshot; conflicts are flagged, never silently reconciled.
15. Every outcome record stores the date the outcome became knowable, and injected lessons are filtered by that date on historical runs.
16. Outcomes settle only after their full observation window; premature evaluation leaves the record pending.
17. Append-only logs use a delimiter that cannot occur in model prose, an idempotency guard on append, and atomic replace on update.
18. In any multi-speaker exchange, an absent opponent argument is replaced by an explicit "has not spoken yet" marker, never interpolated as empty text.
19. Every router or state machine maps all possible returns exhaustively; unknown labels fail compilation or tests, not production runs.
20. Resume identity includes every input that changes graph or config shape; a changed shape starts fresh.
21. Invalid configuration values fail at startup with the offending value named; unattended runs never start misconfigured.
22. Unknown model IDs and unsupported parameters are rejected, not warned past or silently dropped.
23. Recovered bugs become named invariants with a regression test citing the failure mode (the repo's issue-annotated comments and paired tests model this).
24. Prompts contain no vestigial protocol strings; when a mechanism is replaced, its prompt text is removed in the same change.
25. Debate or review context passed between turns has an explicit size budget; histories do not grow unboundedly by concatenation.
