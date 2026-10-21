# Control Centre

[SOURCE-VERIFIED, source: OpenDesign `index.html`, `falconos-workspace.html`; React source: `App.jsx`] The original Control Centre design from project `886c2e41-d9d4-45e0-a67d-148f20cfca61` has four views: Overview, Decisions, Knowledge and Connections. The React port preserves them and adds Operate for read-only reserve-scenario decisions. The source project remains standalone HTML; the port uses the existing React and Vite package.

## Run and preview

[SOURCE-VERIFIED, approved D1 route contract] Public `/dashboard/` is a static **Soon** page and provides no owner login or trading. The Control Centre remains a separate local preview at `/local-dashboard/`.

[REPORTED STATUS, 2026-10-21] No deployment of this D1 change occurred.

[INFERRED COMMANDS] From the FalconOS repository root, run:

```bash
npm --prefix web run dev:dashboard -- --port 5195 --strictPort
# Open http://127.0.0.1:5195/local-dashboard/
```

[SOURCE-VERIFIED, local route behavior] Direct links preserve `#decisions`, `#operate`, `#knowledge`, `#connections` and `#agent` on the `/local-dashboard/` route.

[INFERRED COMMANDS] Stop development before starting the built preview:

```bash
npm --prefix web run build:dashboard-preview
npm --prefix web run preview:dashboard -- --host 127.0.0.1 --port 4195 --strictPort
# Open http://127.0.0.1:4195/local-dashboard/
```

## Verify

[INFERRED COMMANDS] The package test command runs its pretest build before the suite. The fixture-only agent browser case uses Chrome and temporary profiles and blocks external HTTP.

```bash
npm --prefix web test
CHROME_BIN="/Applications/Brave Browser.app/Contents/MacOS/Brave Browser" npm --prefix web run test:dashboard:browser -- --case=agent
```

[SOURCE-VERIFIED, test harness inputs] The agent-only browser case uses disposable fixtures and needs no OpenDesign source root. Full source-comparison, source-only and source-regressions checks require `FALCON_DASHBOARD_SOURCE` to point at the original OpenDesign data root; do not substitute a guessed path.

## Data and services

[SOURCE-VERIFIED, source: `data.json`, `store.mjs`] The five treasury runs are synthetic. The four embedded knowledge snapshots remain in `data.json` as a pinned design fixture, while the Knowledge view requests the mesh API after you connect with an access token (kept in memory only). This describes source behavior, not current API availability. The saved simulation uses `falconos-control-centre-preview-v1` in browser storage. The wrapper fixes that key for storage and locking. The existing treasury store retains its original default. State stays specific to the browser origin.

[INFERRED, workflow] Inspect examples, or create one saved simulation. Record evidence before running a cycle. Inspect the resulting decision and balances. The dashboard cannot move wallet funds. Its Connections view links to the separate mesh and Devnet terminal.

[SOURCE-VERIFIED, source: `Operate.jsx`, `mesh/scenario.mjs`] Operate requests a reserve capture from the mesh service. Enter a proposed position and owner limits to save a read-only decision graph. The source node is observed; mandate and proposal nodes are owner-entered. Results never claim wallet holdings, withdrawable liquidity or execution approval. The original Decisions route remains a synthetic treasury simulation.

[VERIFIED, asset provenance] The dashboard reuses the four font files under `web/landing/assets/`. Their extracted bytes match the source fonts. Existing font licenses remain there. The Alpine mark comes from the source SVG path. Earlier advisory pages remain original HTML under `/design-reference/`; they use their own browser storage key.

[INFERRED, design contract] See [Control Centre](../../docs/control-centre.md) for persistence, history, export and verification requirements.

[REPORTED HISTORICAL EVIDENCE, 2026-09-27] An earlier local report recorded web suite `tests 161`, `pass 161`, `fail 0`, and a Chrome run with `passed:95`, `total:95`, `exceptions:[]`. See [verification and screenshots](../../docs/verification/2026-09-27-dashboard.md). These are not results from the current correction.

[REPORTED HISTORICAL EVIDENCE, 2026-09-30] The earlier `161/95` figures describe the 2026-09-27 four-view port. A later checkout report recorded web suite `tests 187`, `pass 187`, `fail 0`; its controlled browser run reported `passed:132`, `total:132` across original source comparison and the additive Operate route. The report says its local Operate view loaded one saved `REVIEW` record with four checks and 11 graph nodes. That browser fixture did not test a wallet signature, hosted API connection or live trade.

[REPORTED HISTORICAL EVIDENCE, 2026-09-30] A later controlled dashboard browser report recorded `passed:134`, `total:134` after the graph-first return flow. It checked that Operate opened the newest saved graph without another POST and showed every decision lane at desktop width. The earlier `132/132` run remains a dated intermediate result.

[REPORTED HISTORICAL EVIDENCE, date not recorded in source note] A controlled dashboard browser report recorded `passed:136`, `total:136` and said the check covered opening the latest saved graph in view and labeling reserve book liquidity as not withdrawable. This is an earlier report, not a current check.
[SOURCE-VERIFIED, source: `Agent.jsx`, `agent-store.mjs`, `mesh/http.mjs`] The gated Yield Agent reads the mesh yield catalog and handles typed discovery, simulation, and explanation requests. Its Cash Trace shows proposed flows, base APY, retrieval time, unknown costs, and venue limits. It stores simulated balances and receipts in browser storage. It does not sign transactions or move funds.

[REPORTED HISTORICAL EVIDENCE, 2026-10-03] The agent-only browser report for `node web/test/dashboard-browser.mjs --case=agent` recorded `passed: 6`, `total: 6`. It used fixture responses and did not verify live provider data or transaction execution.
