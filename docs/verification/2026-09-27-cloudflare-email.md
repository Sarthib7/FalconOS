# Cloudflare setup and signup release

[VERIFIED, user direction] The user requested the official Cloudflare agent setup and a working landing email form. The user then confirmed authentication. Owner: coordinator. Hosted signup repair remains pending.

## Agent setup

[VERIFIED, installer and file inspection] The installer completed. All 14 Codex skill files exist under `/Users/sarthiborkar/.agents/skills`. The [setup report](2026-09-27-cloudflare-email/setup-report.json) records the five MCP registrations and preserved unrelated settings. Main, bindings, and public documentation servers are enabled. Builds and observability remain disabled after the user questioned repeated authentication. No further login is needed for this repair. Source: [official Cloudflare instructions](https://developers.cloudflare.com/agent-setup/prompt.md).

[VERIFIED, completed MCP responses] The main connection returned the `falconos` Pages configuration and HTTP `200` for D1 inventory. A later sandboxed `codex mcp list --json` reported `auth_status: unknown` for active servers. That command does not establish logout; the authenticated API responses are the working-access evidence.

## Production finding

[VERIFIED, Pages response] Account: `f646b35b9c52945d4a7e6d19909981d8`. Project: `falconos`. Production branch: `main`. Production returned `bindings: []` and `environment_variables: []`. Therefore `WAITLIST_DB` and `WAITLIST_IP_SALT` were absent at inspection. See the [completed Pages call](2026-09-27-cloudflare-email/pages-inspection-mcp.json).

[VERIFIED, complete inventory response] D1 returned `total_count: 0`, `metadata_rows: 0`, and `pagination_exhausted: true`. No existing database was available in this account. This measures the API inventory at inspection time. See the [completed D1 call](2026-09-27-cloudflare-email/d1-inspection-mcp.json).

[VERIFIED, source] `web/functions/api/waitlist.js` returns `503 {"error":"waitlist_unavailable"}` when either required setting is missing. The current landing form registers early-access addresses. It does not provide account authentication. No sender or provider setting appeared in production.

## Reviewed candidate

[INFERRED, proposed application] Create `falconos-waitlist` using the provider's default location. Verify its empty catalog, then apply only `web/migrations/0001_waitlist.sql`. This creates `waitlist_entries`, `waitlist_rate_limits`, and `waitlist_entries_ip_created_idx`. No existing rows need conversion. Bind the returned database ID as production `WAITLIST_DB`. Generate 32 random bytes for production secret `WAITLIST_IP_SALT`; pass the value privately through stdin.

[INFERRED, proposed release] Publish the reviewed Function pair with the current static files. Persist the same source on production `main` so a later Git deployment retains it. Preserve preview configuration and unrelated project settings. The [candidate](2026-09-27-cloudflare-email/candidate.json) records source hashes and excluded work. The optional outbox migration, email delivery, and account sign-in are outside this repair.

[VERIFIED, focused test output] `node --test web/test/waitlist.test.mjs web/test/waitlist-email.test.mjs web/test/landing-waitlist.test.mjs` returned `tests 27`, `pass 27`, `fail 0`, `skipped 0`. See the [test output](2026-09-27-cloudflare-email/focused-tests.log). These tests use local storage and provider fixtures.

[VERIFIED, local history proof] The [SQLite proof](2026-09-27-cloudflare-email/sqlite-proof.json) returned `passed: 8`, `total: 8`. Capture returned `201`, then duplicate `200`, with only migration `0001`. The unconfigured path made `providerCalls: 0`. Applying the complete two-file history preserved both registration rows and both rate-limit rows. The upgraded catalog matched a fresh full-history catalog. This adapter proof does not establish hosted D1 behavior or inbox delivery.

[VERIFIED, retained runtime output] The [local Pages proof](2026-09-27-cloudflare-email/pages-http-proof.json) returned `passed: 6`, `total: 6`. Actual HTTP responses were `201 {"status":"registered","emailStatus":"not_configured"}` and duplicate `200 {"status":"already_registered","emailStatus":"not_configured"}`. Malformed JSON and UTF-8 each returned `400`. All 39 static HTTP responses matched their expected hashes. Provider traffic was not measured in Pages. The runtime had no provider settings; local success does not prove hosted configuration.

[VERIFIED, retained D1 query output] The [local catalog record](2026-09-27-cloudflare-email/local-catalog-stdout.json) contains nine successful queries. The [comparison](2026-09-27-cloudflare-email/local-verification.json) returned `entry_count: 1`, `expected_fixture_count: 1`, `total_attempts: 2`, and `outbox_tables: 0`. Both table definitions and all eight columns match `0001`. The artifact contains `privateRuntimeFilesInArtifact: 0`.

[VERIFIED, coordinator hash comparison] The release directory is `/private/tmp/falcon-email-release-l1mn8621/artifact`. Its 39 static files match `web/dist` byte for byte. It adds only `_worker.js` and `_routes.json`. Worker SHA-256: `1be288ad5ee65977b3d65a45464f3599d3e4c1d306e9939236a88c065f6ed86d`. The [artifact manifest](2026-09-27-cloudflare-email/artifact-sha256.json) and [compiler command](2026-09-27-cloudflare-email/compiler-command.json) identify the reviewed bundle.

[VERIFIED, coordinator source hashes; REPORTED, isolated build and tests] The eight-file source slice is commit `b1a86787605b6d97bb3a9cafd706060fd641535e`, based on production `bfa82caaf5bdf2208ce057a7db6397302ebfaeae`. All eight candidate files match current source. Its [isolated release report](2026-09-27-cloudflare-email/source-release-review.json) records `27/27` focused tests and `39/39` unchanged build files. The build also matches the retained published manifest. No package or Vite configuration change is needed. The optional `0002` SQL file belongs to this source slice, but this release applies only `0001` to D1.

[INFERRED, proposed hosted verification] After application, submit `cloudflare-smoke-20260927@falconos.invalid` with source `release-verification`. Check first and duplicate responses, then inspect persistence. Remove only that exact synthetic signup with its expected source after verification. Retain normal rate-limit accounting. This needs approval with the database and release changes.

## Least confident decisions

1. [INFERRED] The existing early-access form is the requested email flow. A question distinguishing signup from sign-in remains unanswered.
2. [NOT DETERMINED] Hosted persistence remains untested until the reviewed database and production configuration exist.
