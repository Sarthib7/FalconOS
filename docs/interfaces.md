# First research slice interfaces

[VERIFIED, prior implementation check, 2026-09-05] The local suite returned `tests 40`, `pass 40`, `fail 0`, `cancelled 0`, `skipped 0`, and typecheck exited `0`. The registry fixture checks all four configured assets against the saved historical capture. The live CLI records assessment time after collection.

[REPORTED, preliminary source freeze, 2026-09-05] Root earlier reported `npm run typecheck` exit `0`, agent plus vault tests `22/22`, CLI tests `11/11`, and the full suite `tests 57`, `pass 57`, `fail 0`, `cancelled 0`, `skipped 0`. This result is superseded by the final 59-test evidence below. It did not establish a real agent thesis.

[VERIFIED, final source/test freeze evidence, 2026-09-05] The saved full-suite output contains `tests 59`, `pass 59`, `fail 0`, `cancelled 0`, `skipped 0`, and its exit file contains `0`. The focused output contains `tests 35`, `pass 35`, `fail 0`, `cancelled 0`, `skipped 0`, and its exit file contains `0`. The typecheck exit file contains `0`. The [P1-T07 fixture record](verification/2026-09-05-agent-fixture.md) records the persistent synthetic result.

[REPORTED, current team roles, 2026-09-05] Root only orchestrates and reports. Luna agents implement and measure. This interface record does not claim a live agent thesis, a current RPC revalidation, or a desktop rendering result.

[VERIFIED, current live evidence, 2026-09-05] The approved escalated watch completed 10 scans. Every scan had four valid quotes and `complete: true`; all 40 observations had HTTP 200, raw data, and `error: null`. See the [live checks](verification/2026-09-05-live-checks.md). The earlier `use_default` failure remains separate, and its context difference remains not determined.

[INFERRED, MVP boundary] The first usable MVP has four results: a Solana and Base collector, one cited thesis from the selected existing agent, one paper-cycle outcome, and one review view that links the candidate, evidence, thesis, and outcome. Broader strategies, a third chain, live capital, and signing remain later work.

[VERIFIED, root baseline] Owner: architect. Status: implemented for the first prototype. Contract date: 2026-09-05. Source types live in `src/types.ts`. The root baseline test run returned `tests 28`, `pass 28`, `fail 0`. Later parallel test results are recorded below and are not final integration evidence.

## Quote observation

[INFERRED, contract Q1] Provider: `sources.ts`. Consumer: `scan.ts`. Input: allowlisted chain, asset pair, integer input units, cancellation signal. Output: a `Cycle[]`, each containing one or two observations. Each observation stores its request, local start and receipt time, HTTP status, raw JSON, normalized quote, and validation error.

[INFERRED, compatibility] The only chains in this slice are Solana and Base. The only assets are USDC and EURC. Both directions start with USDC. The second leg receives exactly the first leg's EURC output. Failed first legs prevent dependent requests. A failed second leg preserves the first observation.

[INFERRED, failure rule] A provider error, unexpected asset, amount mismatch, transaction-bearing response, malformed amount, or timeout cannot produce a valid quote. All returned cycles remain observable. No automatic retries in one scan; later polling records a separate scan.

## Assessment and evidence

[INFERRED, contract E1] Provider: `scan.ts`. Consumers: CLI and vault exporter. Input: normalized cycles and assessment time. Output: a versioned scan with `REJECT`, `REVIEW`, or `UNAVAILABLE` candidates. Every candidate has `executionReady: false` and `netProfitUsdc: null`.

[INFERRED, failure rule] Stale, future, expired, or mismatched observations cannot produce a usable candidate. Gas USD is not silently converted to USDC. Platform fees already included in a quote are not subtracted again.

[VERIFIED, current metadata, 2026-09-05] `test/fixtures/public-metadata.json` preserves the complete historical request and response capture. The registry test matches the four exact addresses, six decimals, finalized Solana slots, pinned Base block, and capture window. The metadata is historical and does not provide runtime revalidation.

[VERIFIED, `src/types.ts` and `src/scan.ts`] New scans include `amountScale.decimals: 6` with `verification: "configured; EURC mainnet precision unverified"`. Earlier session captures predate this annotation and use the same configuration. Exact integer arithmetic does not prove a correct token registry.

[VERIFIED, correction, 2026-09-05] The scale statement above is a prior baseline. Current scans label six decimals as historically verified by the 2026-09-05 RPC capture and state that runtime metadata revalidation was not performed. The earlier saved captures remain unchanged.

## Vault export

[INFERRED, contract V1] Provider: `vault.ts`. Consumer: CLI. Input: scan, data directory, vault directory. Output: immutable JSON evidence and Markdown paths. Filenames derive from local run IDs and fixed entity IDs. Source text never chooses a path or enters YAML. Existing files are never overwritten. Symlink components are rejected.

[VERIFIED, root tests] Tests cover the F1-F6 invariants in `CONTEXT.md`. They use local files and synthetic provider responses. Separate live scan and watch measurements appear in `status.md`.

## CLI run and stop

[VERIFIED, current signal checks, 2026-09-05] The process tests cover SIGINT and SIGTERM during a source request, and SIGINT and SIGTERM during polling. They assert that no later request starts, completed evidence remains readable, and a stop does not publish an incomplete scan. The prior full suite returned `tests 40`, `pass 40`, `fail 0`, `cancelled 0`, `skipped 0`.

[INFERRED, desktop limit] Text inspection of the generated vault does not verify Obsidian graph rendering. The desktop app and suitable native automation were unavailable in the recorded check.

[VERIFIED, cli_luna implementation] Owner: cli_luna. Provider: `cli.ts`. Consumer: the local process and its test harness. Input: `demo`, `scan`, or `watch` arguments, a bounded cycle count, and an optional cancellation signal. Output: one JSON summary per exported scan plus evidence and note paths. A healthy bounded watch returns exit `0`; an incomplete bounded watch, an incomplete one-shot scan, or a watch stopped after three consecutive incomplete scans returns exit `2`. Invalid input or export failure returns exit `1`.

[VERIFIED, cli_luna tests] A cancellation during collection or polling stops before the next collection. Completed summaries and saved synthetic test records remain readable. `node --test test/cli.test.ts` returned `tests 4`, `pass 4`, `fail 0`, `cancelled 0`, `skipped 0`. The test exporter marks records with `syntheticTestDouble: true`; those records are test evidence and do not represent live quotes.

[VERIFIED, correction, 2026-09-05] The four-test result above is an earlier CLI baseline. The prior suite included the four production signal and path combinations listed above and returned `tests 40`, `pass 40`, `fail 0`, `cancelled 0`, `skipped 0`. The saved final source/test evidence is recorded above.

[VERIFIED, P1-T07 fixture state, 2026-09-05] The synthetic evidence-to-thesis exchange is recorded in the [agent fixture evidence](verification/2026-09-05-agent-fixture.md). It validates the local shape and persistence path only. No real agent run exists, so CHK-10, CHK-11, CHK-12, and CP1B remain open.

## Stocks Client Agent surface

[VERIFIED, repository, 2026-09-18] Provider: `stocks/cli.ts` (`advice`). Consumer: external Client Agent. Input: one `stocks.agent-request` JSON object on stdin (≤8 MiB). Output: one `stocks.agent-response` or `stocks.agent-error` JSON line on stdout (≤64 KiB).

[VERIFIED, contract] Fixture mode cases are `healthy`, `low-liquidity`, and `stale`. Snapshot mode accepts a frozen canonical basket snapshot. Host transport is injected inside FalconOS; the request cannot select models, wallets, signers, or execution tools. Forbidden authority fields are rejected.

[VERIFIED, boundary] The agent path performs no live market GET/RPC. Live PreStocks evidence remains on `npm run stocks` via `dash/`. Full field notes: [stocks/agent.md](../stocks/agent.md). Related human demos: [stocks/stocklana-demo.md](../stocks/stocklana-demo.md).

## Least confident decisions

1. [INFERRED] The historical capture verifies six decimals only at its captured slots and block. Runtime metadata revalidation remains open.
2. [INFERRED] A ten-second observation window is useful for research. It does not establish execution freshness.
3. [INFERRED] Stocks fixture advice is sufficient for Stocklana judges and Client Agent smoke. Live agent operators still need an approved evidence feed before production claims.