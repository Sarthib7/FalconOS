# FalconOS

## Treasury MVP work, 2026-09-26

[VERIFIED, user direction] The user approved the staged treasury pitch and selected the local simulation loop first. Start with the [current documentation index](docs/README.md), [implementation plan](plans/treasury-mvp.md), or [saved interactive pitch](docs/pitches/falcon-stages.html).

[INFERRED, scope] The `/treasury/` slice has synthetic balances and observations. Funded lending and restricted automatic execution require later proofs. The earlier advisory and Devnet modules retain their boundaries.

## Earlier modules and evidence

[VERIFIED, local implementation] FalconOS collects public Solana and Base quotes and writes linked Obsidian notes. The first slice compares USDC/EURC in both directions. See [`src/cli.ts`](src/cli.ts) and [`stablecoins/sources.ts`](stablecoins/sources.ts).

[VERIFIED, user-confirmed product direction, 2026-09-18] FalconOS is the umbrella product. Falcon Investment Council is the current module, in the agent-first market intelligence and risk advisory category. [CONTEXT.md](CONTEXT.md) defines the active scope. Start with the [plan index](plans/README.md) for phases, tasks, checkpoints, and passing criteria.

[VERIFIED, user-confirmed boundary, 2026-09-18] The current product is advisory-only and read-only: no custody, pooling, signing, allocation, order submission, or execution claims. Future direction may include pooled investing, curated portfolios, custom ETFs or stock baskets, custody, allocation, and execution. A possible regulated entity would be a separate Falcon investment-management brand, potentially Falcon Hedge Fund; that is not the current product identity.

[VERIFIED, prior local checks, 2026-09-05] The workspace returned `tests 40`, `pass 40`, `fail 0`, `cancelled 0`, `skipped 0` from `npm test`, and `npm run typecheck` exited `0`. CHK-05, CHK-06, and CHK-07 have scoped evidence. CHK-08 automated signal and export checks pass, while desktop graph rendering remains open. CHK-09 is complete for the approved escalated ten-cycle watch, with four valid quotes in each scan. The earlier `use_default` watch remains a separate three-cycle failure, and its context difference remains not determined. See the [registry and clock record](docs/verification/2026-09-05-registry-and-clock.md), [live checks](docs/verification/2026-09-05-live-checks.md), and [desktop check](docs/verification/2026-09-05-desktop-check.md).

[REPORTED, preliminary source freeze, 2026-09-05] Root earlier reported `npm run typecheck` exit `0`, agent plus vault tests `22/22`, CLI tests `11/11`, and the full suite `tests 57`, `pass 57`, `fail 0`, `cancelled 0`, `skipped 0`. This result is superseded by the final 59-test evidence below. It did not close P1-T07 or the real-agent checks CHK-10, CHK-11, and CHK-12.

[VERIFIED, final source/test freeze evidence, 2026-09-05] The saved full-suite output contains `tests 59`, `pass 59`, `fail 0`, `cancelled 0`, `skipped 0`, and its exit file contains `0`. The focused output contains `tests 35`, `pass 35`, `fail 0`, `cancelled 0`, `skipped 0`, and its exit file contains `0`. The typecheck exit file contains `0`. The [P1-T07 fixture record](docs/verification/2026-09-05-agent-fixture.md) records the persistent synthetic result. No real agent thesis run occurred.

[REPORTED, root final adapter check, 2026-09-05] The current Codex adapter passed its saved local fake-process checks with `tests 65`, `pass 65`, `fail 0`, `cancelled 0`, `skipped 0`; the matching exit file contains `0`, and the Codex typecheck exit file contains `0`. The adapter requests `gpt-5.6-luna` with `model_reasoning_effort="max"`, uses a read-only child sandbox, and omits the web-search enable flag. These tests use local fake processes. No real model call occurred. The earlier 59-test result remains the prior fixture milestone. Real model integration remains open.

[VERIFIED, Codex control lookup, 2026-09-05] Top-level Codex help lists `-a, --ask-for-approval <APPROVAL_POLICY>` with `never`, while `codex exec --help` does not list the approval option. Top-level help lists `--search` as an enable flag. No disable flag appears, and `codex exec --help` lists neither search option. [REPORTED, root] The current CLI keeps Codex disabled until approval and web-search controls are verified.

[REPORTED, team roles, 2026-09-05] Root only orchestrates and reports. Luna agents perform implementation and local measurements. A fixture or synthetic test record is not live evidence.

[INFERRED, MVP boundary] The first usable MVP has four results: a Solana and Base collector, one cited thesis from the selected existing agent, one paper-cycle outcome, and one review view that links the candidate, evidence, thesis, and outcome. Broader strategies and a third chain remain later work. [SUPERSEDED, 2026-09-20] Live capital and signing are not later FalconOS work; they belong, if ever, to a separate regulated Falcon entity (CONTEXT.md, 2026-09-18).

## Run the demonstration

[VERIFIED, local commands] Tested with Node `v25.2.1`. The package requires Node `>=24.12.0`. It uses Node's native TypeScript support and has no runtime dependencies.

```sh
npm ci
npm run demo
```

[VERIFIED, demo output] The command writes a synthetic scan to `data/runs/<id>.json`. It writes linked notes to `data/vault/FalconOS/`. Each output includes its mode, candidate decisions, and evidence paths. Synthetic observations do not establish market results.

1. Open Obsidian and choose **Open folder as vault**.
2. Select this repository's `data/vault` folder.
3. Open `FalconOS/Start.md`, then open Graph view.

[VERIFIED, desktop availability, 2026-09-05] The desktop check found no `obsidian` executable or `/Applications/Obsidian.app`. `agent-browser 0.25.3` was installed, but its help listed browser controls and no native Obsidian control. The generated vault files were read directly. Those reads do not verify desktop rendering or graph resolution.

[VERIFIED, official documentation] Obsidian's [Graph view](https://obsidian.md/help/plugins/graph) displays notes and their links. The generated graph needs no community plugin. Opening the files in the Obsidian desktop app was not tested in this session.

## Read live quotes

[VERIFIED, implementation and live run] These commands send public token IDs and sizes to Jupiter and KyberSwap. They do not need a wallet or API key. Availability remains subject to provider access and rate limits.

```sh
npm run scan -- --amount 10
npm run watch -- --amount 10 --interval 300
```

[VERIFIED, `src/cli.ts`] `scan` runs once. `watch` waits after each scan and repeats until Ctrl+C. Use `--cycles 1` for a bounded watch run. The minimum interval is 60 seconds. Three consecutive incomplete scans stop the process. Run one collector process at a time; separate processes do not share pacing.

[VERIFIED, `src/cli.ts` and CLI process tests] A healthy bounded watch exits `0`. A one-time scan exits `2` if required source data is unavailable. A bounded watch exits `2` when its final scan is incomplete. An unbounded watch exits `2` after three consecutive incomplete scans. User cancellation exits `0` after preserving completed records. Invalid input or export errors exit `1`. A rejected candidate can still be part of a completed scan. Inspect `coverage` and candidate reasons.

[VERIFIED, implementation] Each CLI output line is JSON. For use by another agent, invoke `node src/cli.ts scan --amount 10` directly. npm prints its own script header. See [interfaces](docs/interfaces.md) for the evidence contract.


## Inbound plugin contract

[VERIFIED, local implementation] `node src/cli.ts plugin --data ./data` is a separate inbound, read-only command. It reads one bounded UTF-8 JSON object from stdin and emits one bounded JSON advisory/error line. The request carries only caller provenance (`agentId`), route/amount/objective, source cutoff, one evidence path/hash, and optional untrusted note paths. The evidence root is host-configured with `--data`.

[VERIFIED, local implementation] The plugin does not expose agent, model, executable, Codex, wallet, signer, transaction, capital, execution, vault, or export options. It never collects quotes or makes market/RPC/model/paid calls, and it does not write evidence, notes, theses, or vault files. A standalone invocation without a host-injected transport returns `ADVISORY_UNAVAILABLE`; tests inject the deterministic fixture transport.

[VERIFIED, local implementation] A successful fixture response includes the validated `agentId`, `fixture: true`, `authority: "advisory-only"`, candidate status, citations, invalidation conditions, and `executionReady: false`. `UNAVAILABLE` is a valid deterministic candidate result and exits `0`; malformed input, invalid evidence, or unavailable host transport exits `2`. This fixture response is synthetic and does not claim a real agent decision.

[VERIFIED, local implementation] This inbound boundary is separate from the local `thesis` command and `src/codex.ts`. The thesis command may export local records; the plugin command skips thesis export entirely.

[VERIFIED, final plugin review patch] `node --test test/plugin.test.ts test/agent.test.ts` returned `tests 30`, `pass 30`, `fail 0`; `npm test` returned `tests 83`, `pass 83`, `fail 0`; `npm run typecheck` exited `0`. The focused checks cover transport error redaction including empty errors, UNC-path rejection, final `O_NOFOLLOW|O_NONBLOCK`/fstat descriptor reads, FIFO evidence/note rejection within a short deadline, request mapping, fixture provenance, and no plugin writes. Node/Darwin has no `openat` API, so parent-directory swap atomicity remains outside this slice.

[VERIFIED, final plugin smoke] `node src/cli.ts plugin --help` exited `0`. `node src/cli.ts plugin --data test/fixtures < test/fixtures/plugin-valid-request.json` exited `2` with exactly one JSON line carrying `ADVISORY_UNAVAILABLE` because standalone production has no injected host transport. The smoke used only checked-in fixture evidence and created no persistent files. No market/RPC/model/paid call occurred.

## Storage and interpretation

[VERIFIED, `src/vault.ts`] `--data` chooses the evidence root. `--vault` chooses an existing Obsidian vault. The exporter creates a `FalconOS` subtree and preserves existing notes. Evidence must remain outside the editable vault. Paths with symlink components are rejected. On macOS, use `/private/tmp` instead of its `/tmp` symlink for temporary output.

[VERIFIED, implementation and tests] Writes use exclusive temporary files, sync their contents, and publish without replacement. Interrupted writes cannot expose partial final files under the tested failure. A process crash may leave an unused temporary file. Power-loss durability and hostile concurrent directory replacement were not tested. Canonical JSON can survive a later note-export failure; inspect `data/runs` after an export error.

| Decision | Meaning |
| --- | --- |
| `REJECT` | [VERIFIED, `stablecoins/scan.ts`] Non-positive quoted difference or rejected timestamps. |
| `REVIEW` | [VERIFIED, `stablecoins/scan.ts`] Positive quoted difference with unverified costs, inventory, and fills. |
| `UNAVAILABLE` | [VERIFIED, `stablecoins/scan.ts`] A required quote failed or could not be validated. |

[VERIFIED, `stablecoins/scan.ts`] Assessment uses exact integer token units. Both legs must use equal EURC quantities. Observation age is capped at 10 seconds. Provider timestamps after local receipt or outside that window are rejected when present. A timestamp inside the window does not prove a synchronized market snapshot.

[VERIFIED, current metadata, 2026-09-05] The four configured addresses match a historical public RPC capture. It records six decimals, finalized Solana slots, and a pinned Base block. The saved fixture and registry test preserve and check the captured request and response values. Runtime metadata revalidation was not performed. See the [registry and clock record](docs/verification/2026-09-05-registry-and-clock.md).

[VERIFIED, correction, 2026-09-05] Earlier README text treated six decimals as an unverified configuration. The historical fixture now verifies the four configured addresses and six-decimal RPC responses for its capture date. Runtime revalidation remains absent. The prior approval rejection and saved records remain in the [status record](status.md#current-build).

[VERIFIED, implementation] Every candidate keeps `netProfitUsdc: null` and `executionReady: false`. Gas estimates remain in USD. Sequential quotes assume inventory on both chains; they do not move capital. EURC follows the euro, so this pair is FX research. These scans do not detect dollar depegs.

[INFERRED, later scope] LLM reasoning and automatic graph retrieval remain planned for FalconOS. [SUPERSEDED, 2026-09-20] Capital pooling, peg execution strategies, sniping, and transaction signing are not planned FalconOS features; they belong, if ever, to a separate regulated Falcon entity (CONTEXT.md, 2026-09-18). The [brand brief](docs/brand-brief.md) describes proposed views and includes a design prompt.

## Check the code

```sh
npm run typecheck
npm test
```

[VERIFIED, prior test output, 2026-09-05] `npm run typecheck` exited `0`. `npm test` returned `tests 40`, `pass 40`, `fail 0`, `cancelled 0`, `skipped 0`. The run used synthetic providers and local files.

[VERIFIED, test scope] Tests use synthetic responses and local temporary files. The session's actual command outputs and live measurements are recorded in [status.md](status.md). A test pass does not establish profitable trading or customer demand.

## References

- [VERIFIED, official API documentation] [Jupiter order](https://developers.jup.ag/docs/api-reference/swap/order). The quote request omits the taker.
- [VERIFIED, live request record] The collector uses KyberSwap's Base GET route endpoint. [REPORTED, source researcher] [KyberSwap routes documentation](https://docs.kyberswap.com/kyberswap-solutions/kyberswap-aggregator/aggregator-api-specification/evm-swaps) describes this endpoint. Root's documentation fetch failed; the recorded live requests succeeded.
- [VERIFIED, issuer registry] [USDC addresses](https://developers.circle.com/stablecoins/usdc-contract-addresses) and [EURC addresses](https://developers.circle.com/stablecoins/eurc-contract-addresses) identify the configured assets.
- [VERIFIED, official runtime documentation] [Node TypeScript support](https://nodejs.org/api/typescript.html) describes the runtime used by this package.
