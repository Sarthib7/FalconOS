# Repository verification, 2026-09-27

[VERIFIED, user choice `1`] This change keeps the existing folders. It adds a current architecture map, verification commands, and release input checks.

[VERIFIED, source] [The architecture map](../README.md) records component roles, data ownership, and signing authority. [REPO-VERIFY-1](../interfaces.md) defines the verification contract. The implementation is in [`scripts/verify.mjs`](../../scripts/verify.mjs), [`web/scripts/verify-release.mjs`](../../web/scripts/verify-release.mjs), and [`mesh/check-release.mjs`](../../mesh/check-release.mjs).

## Local verification

[VERIFIED, root execution] `npm run verify` returned exit code `0` in `36.27` seconds. [The full log](2026-09-27-repository/verify.log) contains this summary:

```text
repository: PASS
advisory: PASS
web: PASS
mesh: PASS
engine: PASS
```

[VERIFIED, log inspection] The counts below describe collected tests. They do not prove browser behavior, hosted access, or real wallet execution.

| Scope | Result | Limit |
| --- | --- | --- |
| Repository | `20` tests, `20` pass, `0` fail, `0` skipped | Runner and release check fixtures. |
| Advisory | `113` tests, `113` pass, `0` fail, `0` skipped | Root typecheck also passed. Providers are controlled by tests. |
| Web | `161` tests, `161` pass, `0` fail, `0` skipped | No browser or inbox check in this run. |
| Mesh | `101` tests, `101` pass, `0` fail, `0` skipped | Disposable PostgreSQL with an effective restricted SQL role. |
| Rust engine | `34` unit tests and `4` integration tests passed | Two other targets collected `0` tests. Cargo ran offline with the lockfile. |

[VERIFIED, root execution] PostgreSQL 17 ran in a new temporary directory with Unix sockets only. The existing schema initialization and permissions SQL returned exit code `0`. [Setup results](2026-09-27-repository/setup-results.json) record each command result. The test connection selected `falcon_mesh_app` through PostgreSQL startup options. This tests the effective role's permissions. It does not test independent authentication, TLS, or a hosted connection pool.

[VERIFIED, root cleanup] The disposable PostgreSQL instance was stopped after verification. `pg_ctl -D /private/tmp/falcon-repo-verify-9n6ECd/data -m fast -w stop` returned exit code `0` and `server stopped`. Its temporary files remain available for inspection.

[VERIFIED, root execution] The website check reported `8` routes and `112` resolved files. Its output included `"artifactWritten":false`. The API check reported `17` declared files and `"isolatedLinkage":true`. It also reported `"databaseChecked":false` and `"dockerImageChecked":false`. [The result record](2026-09-27-repository/result.json) includes the exact outputs and hashes of the checked source files.

[VERIFIED, source] The website check runs Vite without writing an artifact. It checks resolved browser imports, required routes, and public files. It does not compile Cloudflare Pages Functions. The API check copies its declared sources and starts Node without a database URL. It requires the exact guard `Error: DATABASE_URL is required.`. Node file permissions restrict accidental imports outside the copied source and installed dependencies. This is not a hostile-code sandbox. Unexecuted dynamic imports and the Docker image remain outside this check.

## Failure controls and review

[REPORTED, verification agent; VERIFIED, retained log inspection] A copied runner was changed to return success after failures. The unchanged test file then collected `6` tests: `2` passed and `4` failed. [Runner control log](2026-09-27-repository/runner-negative.log).

[REPORTED, release check agent; VERIFIED, retained log inspection] Removing only the copied API checker's permission flags made the absolute-import test fail. It collected `1` test: `0` passed and `1` failed. [Absolute-import control log](2026-09-27-repository/absolute-import-negative.log). The repository checker kept its permission flags.

[VERIFIED, correction] An early website fixture used an incomplete dependency installation. Its import error did not prove a release defect. The local inspection returned `UNMET DEPENDENCY @solana/web3.js@1.98.4`. A fresh offline install using the unchanged web lockfile returned exit code `0` and `added 79 packages`. [Install log](2026-09-27-repository/web-offline-install.log). The website check then passed with the unchanged Vite configuration. The new check also rejects missing web dependencies directly.

[REPORTED, independent review agent] The final code review found no material defects. It identified two stale documentation line references. Those references now point to `package.json:24`.

[VERIFIED, root checks] `git diff --check` returned exit code `0`. Local link and source hash checks returned `{"missing_local_links":[],"source_hash_mismatches":[]}`. The prose detector reported no issues in this evidence document. Its remaining documentation flags concerned repeated technical terms and literal CLI argument separators. A targeted credential scan returned `"pattern_matches":[]`; its patterns cannot identify every secret format.

## Scope left unchanged

[VERIFIED, source and diff inspection] This task changes repository tooling and documentation. Product code, financial rules, wallet execution, dependency versions, lockfiles, schema files, and `SPEC.md` stay unchanged. Existing SPEC contradictions are listed in [the architecture map](../README.md). Financial policy versioning and rejected preparation audit records remain deferred work.

[VERIFIED, execution scope] This verification used local tests and a disposable database. It did not deploy production, migrate a hosted database, call live market providers, send email, or submit a wallet transaction. Hosted API and Docker verification require separate evidence.

## Least confident decisions

1. [INFERRED] The explicit API source list is small enough to maintain manually. New startup imports require updates to this list.
2. [INFERRED] Keeping the folders avoids an unnecessary migration now. Further shared browser code may justify a separate package later.
