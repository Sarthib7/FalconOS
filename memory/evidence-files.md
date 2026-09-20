# Publish evidence after the write completes

[VERIFIED, regression tests, 2026-09-05] Writing directly to the final JSON path exposed a partial record after an injected `ENOSPC`. `test/vault.test.ts` reproduced the error. Restoring the old writer in a temporary source copy returned `tests 5`, `pass 4`, `fail 1`.

[VERIFIED, current implementation] `src/vault.ts` writes and syncs an exclusive temporary file, then publishes it without replacement. The current suite returned `tests 28`, `pass 28`, `fail 0`.

[INFERRED, lesson] A failed write must not leave a file that looks like completed evidence. This test covers an injected write failure. It does not prove power-loss durability.

[VERIFIED, cli_luna, 2026-09-05] `node --test test/cli.test.ts` returned `tests 4`, `pass 4`, `fail 0`, `cancelled 0`, `skipped 0`. The process tests saved synthetic records with an explicit `syntheticTestDouble: true` marker and asserted output, saved-record, and request counts.

[VERIFIED, cli_luna regression] An isolated copy with the old bounded-watch branch returned `regression_exit=1`, `tests 4`, `pass 3`, `fail 1`. The retained test failed with `0 !== 2` for a bounded watch ending with incomplete source data. The temporary copy was removed after the run; shared source and tests were retained.

[INFERRED, lesson] A bounded watch must report incomplete final coverage through its exit code, even when it stops before the three-failure threshold. A healthy scan resets the incomplete count.

## CLI clock backprop, 2026-09-05

[VERIFIED, bug trace] `src/cli.ts` previously called `now()` before `await collect(...)`. A retained advancing-clock test against an isolated old source returned `exit_code:1`, `tests 1`, `pass 0`, `fail 1`, with `REJECT !== REVIEW`. The fake collector advanced one second and returned observations that were valid at collection completion.

[INFERRED, scoped §B] `B-CLI-CLOCK-01|2026-09-05|live assessment timestamp was captured before collection completed|V-CLI-CLOCK-01`

[INFERRED, scoped §V] `V-CLI-CLOCK-01`: Every live scan captures `assessedAt` after collection, so each observation with a valid in-window timestamp is assessed at or before its completion time. Demo scans keep one deterministic timestamp.

[VERIFIED, fixed test] `node --test --test-name-pattern='live assessment starts after collection completes' test/cli.test.ts` returned `tests 1`, `pass 1`, `fail 0`, `cancelled 0`, `skipped 0`.

[VERIFIED, correction, 2026-09-20] `SPEC.md` now exists and carries §V invariants and §B backprop records. This note predates it; the bug lesson above stands, and the spec is the enforcement home.
