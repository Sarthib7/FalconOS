# FalconOS brand brief

[INFERRED, historical proposal, 2026-09-05] The earlier brief proposed an abstract flight path as the mark, paired with a restrained research interface. This proposal remains in the direction history.

[VERIFIED, correction, 2026-09-05] The external Open Design record at `/Users/sarthiborkar/Library/Application Support/Open Design/namespaces/release-stable/data/projects/886c2e41-d9d4-45e0-a67d-148f20cfca61/brand-spec.md:5` states: `The user chose Alpine Vector: “i picked the Apline vector”. Alpine Vector is the selected FalconOS brand direction.` This corrects the earlier direction status. It does not establish an implemented FalconOS UI or close CHK-21.

[VERIFIED, cli_luna read-only measurement, 2026-09-05] The external project contains `pngCount: 15`; its manifest contains `manifestCount: 15`; `allManifestEntriesMatch: true`. The inventory has three directions (`current`, `night`, and `alpine`) with five outputs each: `symbol-light`, `symbol-dark`, `lockup-light`, `avatar`, and `x-banner`. Alpine exports measure 1024 × 1024 symbols, a 1600 × 400 lockup, a 400 × 400 avatar, and a 1500 × 500 banner. 24px legibility, browser rendering, and platform crop behavior remain unverified. This record does not close CHK-21.

[VERIFIED, user message] The project X account is `https://x.com/Falcon_Agents`. [INFERRED, naming proposal] Keep FalconOS as the product name. Use Falcon Agents for the project social identity. A separate community name remains open.

## Directions

| Direction | Proposed form | Tradeoff |
| --- | --- | --- |
| Flight path, earlier recommendation | [INFERRED] Two asymmetric arcs pass around an open center. Their negative space suggests an F or a wing. | [INFERRED] Connects movement between chains with continuous observation. Needs a distinctive silhouette. |
| Folded wing | [INFERRED] A compact shape uses two offset planes and one clear cut. | [INFERRED] Easier to read as a small icon. Can resemble an aerospace brand. |
| Evidence path | [INFERRED] A bent line connects a few unequal nodes. | [INFERRED] Makes the knowledge graph visible. Can resemble a generic network product. |

[INFERRED, historical recommendation] The earlier brief recommended developing the flight path first. It proposed a one-color avatar mark with an open orbit and a clear direction, while avoiding a literal falcon head, coin, shield, or rocket.

## Official references

[VERIFIED, official page read, 2026-09-05] Linear says, “Provide plenty of space around Linear assets.” Its product page presents grouped work with visible status. [INFERRED] Borrow the clear hierarchy and readable density. Give the mark space while keeping research rows compact. Sources: [Linear brand](https://linear.app/brand), [Linear product](https://linear.app/).

[VERIFIED, official page read, 2026-09-05] Vercel specifies, “Tabular is used when conveying numbers for consistent spacing.” Its brand page documents a separate symbol and wordmark. [INFERRED] Borrow this separation and numeric discipline. Create an original mark. Sources: [Geist typography](https://vercel.com/geist/typography), [Vercel brand](https://vercel.com/geist/brands).

[VERIFIED, official page read, 2026-09-05] Obsidian states, “Circles represent notes, or nodes.” It documents links, filters, and a local graph around the active note. [INFERRED] Use a focused graph beside its evidence panel. Source: [Obsidian Graph view](https://obsidian.md/help/plugins/graph).

## Palette and type

[INFERRED, proposal] Start with graphite `#101518`, panel gray `#192125`, and pale text `#E8EEEA`. Use cyan `#65D6D1` for selected paths. Reserve amber for review states and red for errors. Color must always have a text or shape cue. Check contrast in the finished interface.

[INFERRED, proposal] Try Geist Sans for navigation and explanations. Use Geist Mono for amounts, timestamps, addresses, and identifiers. Keep small labels for secondary information. Neither font is installed by this brief.

## Utilities behind the views

| Utility | What the design should explain | Delivery boundary |
| --- | --- | --- |
| Opportunity discovery | [INFERRED] Strategy filters for arbitrage, peg deviations, new token entries, and investment research. Each candidate has a source and expiry. | [VERIFIED, `stablecoins/sources.ts` and `stablecoins/scan.ts`] The current implementation compares USDC/EURC quotes on Solana and Base. Other strategies are planned. |
| Knowledge and agent decisions | [INFERRED] A candidate opens its evidence graph. Show supporting and conflicting evidence, the assigned agent, its thesis, and invalidation conditions. | [VERIFIED, `src/vault.ts`] The exporter creates linked notes. [INFERRED] Automatic graph retrieval and agent reasoning are later work. |
| Cross-chain capital | [INFERRED] Show balances, reservations, required inventory, transfers in progress, and capital available on each chain. | [INFERRED] Pool ownership is unresolved. Deposit controls require a settled ownership model. |
| Existing agent controls | [INFERRED] Show connected agents, their task, last successful run, allowed actions, and a pause control. | [VERIFIED, `src/cli.ts`] JSON output provides a CLI integration point. [INFERRED] Agent connections and per-agent permissions are later work. |
| Execution and results | [INFERRED] Show a proposed route, limits, approvals, each trade leg, partial failure, and actual costs. | [INFERRED] All execution views are concepts. Sniping starts as detection and review, with explicit limits before any trading. |

[INFERRED, first screen] Put the candidate feed in the center. Selecting a candidate opens evidence and route details beside it. Keep scan health visible. A graph overview can be a separate view because a large graph may obscure the decision being reviewed.

[VERIFIED, repository read] `CONTEXT.md` states, “Start with Solana and Base.” It places Robinhood Chain after route assessment. [INFERRED, design rule] Label Robinhood as planned. Label capital and execution views as concepts until implemented.

## Prompt to paste into a design tool

[INFERRED, proposed prompt] The following requests a concept, not production behavior.

```text
Create an abstract identity board and desktop interface concept for FalconOS.
FalconOS is a proposed multichain research and trading layer above existing agents.
Use FalconOS as the wordmark and @Falcon_Agents as the social handle.

Design an original mark from two asymmetric flight paths around open space.
Suggest a wing or F through negative space. Keep it legible in one color.
Use graphite surfaces, pale text, restrained cyan, and clear sans-serif typography.
Use monospaced numbers and timestamps. Avoid visual clutter and decorative glow.
Study Linear hierarchy, Geist numeric typography, and Obsidian local graphs.
Borrow their principles. Do not copy their marks or page layouts.

Show Discovery, Knowledge, Capital, Execution, and Results views.
Discovery shows continuous scans, monitored coverage, source age, and failures.
Include planned filters for arbitrage, peg deviations, new token entries, and investment research.
Knowledge links evidence to assets and candidates. Show conflicting evidence.
Show the existing agent assigned to a candidate, its thesis, limits, and pause control.
Capital shows separate chain balances and inventory required for each leg.
Show reservations and transfers in progress. Keep pool deposits out until ownership is defined.
Execution shows approval, each trade leg, and unresolved or failed states.
Results separates estimates from confirmed results after all known costs.
Start with Solana and Base. Mark Robinhood Chain as planned.

Label all sample data and future screens as concepts.
Use unknown values where evidence is missing. Never invent profit or balances.
Do not imply live trading, investor deposits, complete market coverage, or atomic cross-chain execution.
Make keyboard focus visible. Pair status colors with text.
Present a mark, wordmark, avatar crop, X banner, and one candidate detail screen first.
```

## Least confident decisions

1. [INFERRED, historical option] The earlier flight path may look too generic. Compare its silhouette at small sizes if that option returns for review.
2. [INFERRED] Dark surfaces may hinder long research sessions. Compare a light reading view.
3. [INFERRED] Falcon Agents may become a community identity. The user has not accepted that naming structure.
