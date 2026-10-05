# FalconOS

## About FalconOS

FalconOS is an agent-first market intelligence and risk advisory product. Falcon Investment Council is its current module. It pairs specialist research and risk review with a trading workspace where users can examine evidence and decide what to do.

The browser terminal supports wallet sign-in and manual swaps on Solana Devnet. Users approve each transaction in their wallet. Strategies do not execute automatically.

Try the [FalconOS site](https://falconos.markets/) or the [Devnet terminal](https://falconos.markets/app/).

## Repository guide

This repository contains several runtimes with separate authority. The [component map](docs/README.md#component-map) identifies their inputs, storage, financial boundaries, and review roles. [Status](status.md) records current work. [SPEC.md](SPEC.md) remains the specification; the [documentation drift list](docs/README.md#known-documentation-drift) identifies unresolved older sections.

The [website and signup release](docs/verification/2026-09-27-cloudflare-email.md#ui-completion-release) records production commit `9af809b`. Signup returned `201 registered`, then `200 already_registered`. Both responses reported `emailStatus: not_configured`. This form registers early access. It does not provide account sign-in or prove inbox delivery.

Supabase has the reviewed mesh schema, but the application role remains `NOLOGIN`. The Railway API connection is pending. See [runtime prerequisites](docs/supabase-setup.md#runtime-connection). The public mesh page therefore does not establish a hosted backend connection.

### Repository map

Folders stay where they are. Use this table to find the owner of a change, then open that folder's guide.

| Path | What it holds | Start reading |
| --- | --- | --- |
| `src/`, `test/` | TypeScript CLI (`demo`, `scan`, `watch`, `plugin`), advisory plugin, agent validation, Codex adapter, vault export. Root package. | [Interfaces](docs/interfaces.md), [`src/cli.ts`](src/cli.ts) |
| `stablecoins/`, `perps/`, `stocks/` | Council domain modules for the USDC/EURC scan, perpetuals, and stocks. Each has its own `test/` and `vision.md`. | [Interfaces](docs/interfaces.md) |
| `engine/` | Rust stocks engine and local HTTP views. | [engine/README.md](engine/README.md) |
| `mesh/` | Node knowledge-mesh API, PostgreSQL schema and migrations, Railway and Supabase deployment files. Own `package.json` and lockfile. | [mesh/README.md](mesh/README.md), [Knowledge mesh](docs/knowledge-mesh.md) |
| `web/` | Vite and React site, browser terminals, and the signup Pages Function. Own `package.json` and lockfile. | [web/README.md](web/README.md) |
| `web/goal/` | Separate static vision deck with its own Cloudflare Worker configuration. It is not a route of the Vite build. | [web/goal/README.md](web/goal/README.md) |
| `scripts/` | `npm run verify` runner and its tests. Website and mesh release checks are in `web/scripts/` and `mesh/check-release.mjs`. | [Verification commands](docs/README.md#verification-and-release-checks) |
| `docs/` | Component map, contracts, ADRs, verification records, handoffs, pitches, design specs. | [docs/README.md](docs/README.md) |
| `plans/` | Roadmap, tasks, checks, treasury MVP plan. | [plans/README.md](plans/README.md) |
| `SPEC.md`, `status.md`, `CONTEXT.md`, `VISION.md` | Specification; current work and measurements; product context; historical vision. | [Status](status.md), [Context](CONTEXT.md) |
| `research/`, `memory/`, `.superstack/` | Reference notes on external approaches, recorded lessons, and earlier validation reports. | [research/falconos-synthesis.md](research/falconos-synthesis.md) |
| `data/` | Output of `demo`, `scan`, and `watch`. The folder is listed in `.gitignore`, but 21 files under `data/graph/` and `data/verification/` are tracked as evidence. | [Verification records](docs/verification/) |

### Run locally

Node `>=24.12.0` is required for the complete local setup. Root, web, and mesh have separate lockfiles. Install each package once from the repository root:

```sh
npm ci
npm --prefix mesh ci
npm --prefix web ci
```

Start the site and local signup API, then open `http://127.0.0.1:4183/`:

```sh
npm --prefix web run dev:local
```

Current routes have different data and execution paths:

| Route | Purpose and prerequisite |
| --- | --- |
| `/` | React landing and early-access signup. Local signup uses SQLite; production uses D1. |
| `/dashboard/` | React Control Centre with retained samples and browser-local treasury simulation. |
| `/treasury/` | Synthetic decision graph, saved decisions, and replay in this browser. |
| `/mesh/` | Persistent graph and Devnet lending terminal. Requires the separately running [mesh API and PostgreSQL](mesh/README.md#run). |
| `/app/` | Separate browser wallet sign-in and manual Devnet swap terminal. Wallet approval is required for a transaction. |

`/app/` is the browser Devnet terminal (page title "FalconOS · Devnet Terminal"); its quote, simulation, send, and status calls use the Devnet RPC. The production build also includes `/product/`, `/research/`, and `/dash/`. The local development server serves `/dash/` and `/research/` from the localhost research terminal (`web/local-terminal.html`), and `web/copilot/` is not a build input.

`web/goal/` is a separate static vision deck titled "FalconOS | We find markets for your capital". Its own Worker configuration names the custom domain `goal.falconos.markets`. Its slides are illustrative, and this checkout contains no record of its deployment state.

Stop the development server before using the same port for a built preview:

```sh
npm --prefix web run build:site
npm --prefix web run preview:local
```

### Verify the checkout

Run `npm run verify` for all five scopes. It reports each scope as `PASS`, `FAIL`, or `BLOCKED`. Missing disposable PostgreSQL configuration blocks mesh verification and gives a nonzero overall result. The runner does not install packages or initialize a database. See [commands, prerequisites, and limits](docs/README.md#verification-and-release-checks) before the full run.

```sh
npm run verify
```

The component instructions and dated measurements below remain available. Their test counts describe those runs, not the current checkout. Later website and treasury decisions do not grant execution authority to the advisory plugin or Rust engine.

## Earlier local mesh milestone, 2026-09-27

The React treasury landing, retained knowledge mesh, live connectors and browser Devnet lending terminal are built. Final checks returned `97/97` mesh tests, `150/150` web tests, `79/79` mesh browser checks and `53/53` landing browser checks. See [verification and limits](docs/verification/2026-09-27-mvp.md).

Run `npm --prefix web run dev:local` for the landing and local email capture. Open `http://127.0.0.1:4183/`. The `/mesh/` route also needs PostgreSQL and the [mesh launcher](mesh/README.md). Actual inbox delivery needs sender credentials. A confirmed user-wallet lending round trip remains unverified.

## Treasury MVP work, 2026-09-26

The user approved the staged treasury pitch and selected the local simulation loop first. Start with the [current documentation index](docs/README.md), [implementation plan](plans/treasury-mvp.md), or [saved interactive pitch](docs/pitches/falcon-stages.html).

The `/treasury/` slice has synthetic balances and observations. Funded lending and restricted automatic execution require later proofs. The earlier advisory and Devnet modules retain their boundaries.

## Earlier modules and evidence

FalconOS collects public Solana and Base quotes and writes linked Obsidian notes. The first slice compares USDC/EURC in both directions. See [`src/cli.ts`](src/cli.ts) and [`stablecoins/sources.ts`](stablecoins/sources.ts).

FalconOS is the umbrella product. Falcon Investment Council is the current module, in the agent-first market intelligence and risk advisory category. [CONTEXT.md](CONTEXT.md) defines the active scope. Start with the [plan index](plans/README.md) for phases, tasks, checkpoints, and passing criteria.

FalconOS pairs market research and risk review with user-controlled trading. The browser terminal supports manual Solana Devnet swaps after simulation and explicit wallet approval. It does not execute strategies automatically. Pooled investing, custody, curated portfolios, custom ETFs or stock baskets, and allocation remain outside the current module. A separate regulated investment-management entity is only a possible future direction.

The workspace returned `tests 40`, `pass 40`, `fail 0`, `cancelled 0`, `skipped 0` from `npm test`, and `npm run typecheck` exited `0`. CHK-05, CHK-06, and CHK-07 have scoped evidence. CHK-08 automated signal and export checks pass, while desktop graph rendering remains open. CHK-09 is complete for the approved escalated ten-cycle watch, with four valid quotes in each scan. The earlier `use_default` watch remains a separate three-cycle failure, and its context difference remains not determined. See the [registry and clock record](docs/verification/2026-09-05-registry-and-clock.md), [live checks](docs/verification/2026-09-05-live-checks.md), and [desktop check](docs/verification/2026-09-05-desktop-check.md).

Root earlier reported `npm run typecheck` exit `0`, agent plus vault tests `22/22`, CLI tests `11/11`, and the full suite `tests 57`, `pass 57`, `fail 0`, `cancelled 0`, `skipped 0`. This result is superseded by the final 59-test evidence below. It did not close P1-T07 or the real-agent checks CHK-10, CHK-11, and CHK-12.

The saved full-suite output contains `tests 59`, `pass 59`, `fail 0`, `cancelled 0`, `skipped 0`, and its exit file contains `0`. The focused output contains `tests 35`, `pass 35`, `fail 0`, `cancelled 0`, `skipped 0`, and its exit file contains `0`. The typecheck exit file contains `0`. The [P1-T07 fixture record](docs/verification/2026-09-05-agent-fixture.md) records the persistent synthetic result. No real agent thesis run occurred.

The current Codex adapter passed its saved local fake-process checks with `tests 65`, `pass 65`, `fail 0`, `cancelled 0`, `skipped 0`; the matching exit file contains `0`, and the Codex typecheck exit file contains `0`. The adapter requests `gpt-5.6-luna` with `model_reasoning_effort="max"`, uses a read-only child sandbox, and omits the web-search enable flag. These tests use local fake processes. No real model call occurred. The earlier 59-test result remains the prior fixture milestone. Real model integration remains open.

Top-level Codex help lists `-a, --ask-for-approval <APPROVAL_POLICY>` with `never`, while `codex exec --help` does not list the approval option. Top-level help lists `--search` as an enable flag. No disable flag appears, and `codex exec --help` lists neither search option. The current CLI keeps Codex disabled until approval and web-search controls are verified.

Root only orchestrates and reports. Luna agents perform implementation and local measurements. A fixture or synthetic test record is not live evidence.

The first usable MVP has four results: a Solana and Base collector, one cited thesis from the selected existing agent, one paper-cycle outcome, and one review view that links the candidate, evidence, thesis, and outcome. Broader strategies and a third chain remain later work. Live capital and signing are not later FalconOS work; they belong, if ever, to a separate regulated Falcon entity (CONTEXT.md, 2026-09-18).

## Run the demonstration

Tested with Node `v25.2.1`. The package requires Node `>=24.12.0`. It uses Node's native TypeScript support and has no runtime dependencies.

```sh
npm ci
npm run demo
```

The command writes a synthetic scan to `data/runs/<id>.json`. It writes linked notes to `data/vault/FalconOS/`. Each output includes its mode, candidate decisions, and evidence paths. Synthetic observations do not establish market results.

1. Open Obsidian and choose **Open folder as vault**.
2. Select this repository's `data/vault` folder.
3. Open `FalconOS/Start.md`, then open Graph view.

The desktop check found no `obsidian` executable or `/Applications/Obsidian.app`. `agent-browser 0.25.3` was installed, but its help listed browser controls and no native Obsidian control. The generated vault files were read directly. Those reads do not verify desktop rendering or graph resolution.

Obsidian's [Graph view](https://obsidian.md/help/plugins/graph) displays notes and their links. The generated graph needs no community plugin. Opening the files in the Obsidian desktop app was not tested in this session.

## Read live quotes

These commands send public token IDs and sizes to Jupiter and KyberSwap. They do not need a wallet or API key. Availability remains subject to provider access and rate limits.

```sh
npm run scan -- --amount 10
npm run watch -- --amount 10 --interval 300
```

`scan` runs once. `watch` waits after each scan and repeats until Ctrl+C. Use `--cycles 1` for a bounded watch run. The minimum interval is 60 seconds. Three consecutive incomplete scans stop the process. Run one collector process at a time; separate processes do not share pacing.

A healthy bounded watch exits `0`. A one-time scan exits `2` if required source data is unavailable. A bounded watch exits `2` when its final scan is incomplete. An unbounded watch exits `2` after three consecutive incomplete scans. User cancellation exits `0` after preserving completed records. Invalid input or export errors exit `1`. A rejected candidate can still be part of a completed scan. Inspect `coverage` and candidate reasons.

Each CLI output line is JSON. For use by another agent, invoke `node src/cli.ts scan --amount 10` directly. npm prints its own script header. See [interfaces](docs/interfaces.md) for the evidence contract.


## Inbound plugin contract

`node src/cli.ts plugin --data ./data` is a separate inbound, read-only command. It reads one bounded UTF-8 JSON object from stdin and emits one bounded JSON advisory/error line. The request carries only caller provenance (`agentId`), route/amount/objective, source cutoff, one evidence path/hash, and optional untrusted note paths. The evidence root is host-configured with `--data`.

The plugin does not expose agent, model, executable, Codex, wallet, signer, transaction, capital, execution, vault, or export options. It never collects quotes or makes market/RPC/model/paid calls, and it does not write evidence, notes, theses, or vault files. A standalone invocation without a host-injected transport returns `ADVISORY_UNAVAILABLE`; tests inject the deterministic fixture transport.

A successful fixture response includes the validated `agentId`, `fixture: true`, `authority: "advisory-only"`, candidate status, citations, invalidation conditions, and `executionReady: false`. `UNAVAILABLE` is a valid deterministic candidate result and exits `0`; malformed input, invalid evidence, or unavailable host transport exits `2`. This fixture response is synthetic and does not claim a real agent decision.

This inbound boundary is separate from the local `thesis` command and `src/codex.ts`. The thesis command may export local records; the plugin command skips thesis export entirely.

`node --test test/plugin.test.ts test/agent.test.ts` returned `tests 30`, `pass 30`, `fail 0`; `npm test` returned `tests 83`, `pass 83`, `fail 0`; `npm run typecheck` exited `0`. The focused checks cover transport error redaction including empty errors, UNC-path rejection, final `O_NOFOLLOW|O_NONBLOCK`/fstat descriptor reads, FIFO evidence/note rejection within a short deadline, request mapping, fixture provenance, and no plugin writes. Node/Darwin has no `openat` API, so parent-directory swap atomicity remains outside this slice.

`node src/cli.ts plugin --help` exited `0`. `node src/cli.ts plugin --data test/fixtures < test/fixtures/plugin-valid-request.json` exited `2` with exactly one JSON line carrying `ADVISORY_UNAVAILABLE` because standalone production has no injected host transport. The smoke used only checked-in fixture evidence and created no persistent files. No market/RPC/model/paid call occurred.

## Storage and interpretation

`--data` chooses the evidence root. `--vault` chooses an existing Obsidian vault. The exporter creates a `FalconOS` subtree and preserves existing notes. Evidence must remain outside the editable vault. Paths with symlink components are rejected. On macOS, use `/private/tmp` instead of its `/tmp` symlink for temporary output.

Writes use exclusive temporary files, sync their contents, and publish without replacement. Interrupted writes cannot expose partial final files under the tested failure. A process crash may leave an unused temporary file. Power-loss durability and hostile concurrent directory replacement were not tested. Canonical JSON can survive a later note-export failure; inspect `data/runs` after an export error.

| Decision | Meaning |
| --- | --- |
| `REJECT` | Non-positive quoted difference or rejected timestamps. |
| `REVIEW` | Positive quoted difference with unverified costs, inventory, and fills. |
| `UNAVAILABLE` | A required quote failed or could not be validated. |

Assessment uses exact integer token units. Both legs must use equal EURC quantities. Observation age is capped at 10 seconds. Provider timestamps after local receipt or outside that window are rejected when present. A timestamp inside the window does not prove a synchronized market snapshot.

The four configured addresses match a historical public RPC capture. It records six decimals, finalized Solana slots, and a pinned Base block. The saved fixture and registry test preserve and check the captured request and response values. Runtime metadata revalidation was not performed. See the [registry and clock record](docs/verification/2026-09-05-registry-and-clock.md).

Earlier README text treated six decimals as an unverified configuration. The historical fixture now verifies the four configured addresses and six-decimal RPC responses for its capture date. Runtime revalidation remains absent. The prior approval rejection and saved records remain in the [status record](status.md#current-build).

Every candidate keeps `netProfitUsdc: null` and `executionReady: false`. Gas estimates remain in USD. Sequential quotes assume inventory on both chains; they do not move capital. EURC follows the euro, so this pair is FX research. These scans do not detect dollar depegs.

See the [brand brief](docs/brand-brief.md) for proposed views and a design prompt.

## Check the code

```sh
npm run typecheck
npm test
```

`npm run typecheck` exited `0`. `npm test` returned `tests 40`, `pass 40`, `fail 0`, `cancelled 0`, `skipped 0`. The run used synthetic providers and local files.

Tests use synthetic responses and local temporary files. The session's actual command outputs and live measurements are recorded in [status.md](status.md). A test pass does not establish profitable trading or customer demand.

## References

- [Jupiter order](https://developers.jup.ag/docs/api-reference/swap/order). The quote request omits the taker.
- The collector uses KyberSwap's Base GET route endpoint. [KyberSwap routes documentation](https://docs.kyberswap.com/kyberswap-solutions/kyberswap-aggregator/aggregator-api-specification/evm-swaps) describes this endpoint. Root's documentation fetch failed; the recorded live requests succeeded.
- [USDC addresses](https://developers.circle.com/stablecoins/usdc-contract-addresses) and [EURC addresses](https://developers.circle.com/stablecoins/eurc-contract-addresses) identify the configured assets.
- [Node TypeScript support](https://nodejs.org/api/typescript.html) describes the runtime used by this package.
