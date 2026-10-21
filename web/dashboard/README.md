# Control Centre

[VERIFIED, source: OpenDesign `index.html`, `falconos-workspace.html`; current React source: `App.jsx`] The original Control Centre design from project `886c2e41-d9d4-45e0-a67d-148f20cfca61` has four views: Overview, Decisions, Knowledge and Connections. The React port preserves them and adds Operate for live Devnet reserve scenario decisions. The source project remains standalone HTML; the port uses the existing React and Vite package.

## Run and preview

PR1 adds a separate local entry and output for the React Control Centre. It leaves the public /dashboard/ route unchanged; any later decision to withhold that route is a separate follow-up. The local preview output must not be uploaded as the main-site artifact.

From the FalconOS repository root, start the local simulator:

```bash
npm --prefix web run dev:dashboard -- --port 5195 --strictPort
# Open http://127.0.0.1:5195/local-dashboard/
```

Direct links preserve #decisions, #operate, #knowledge, #connections and #agent on /local-dashboard/.

To build and serve the separate preview artifact, first stop the dev server:

```bash
npm --prefix web run build:dashboard-preview
npm --prefix web run preview:dashboard -- --host 127.0.0.1 --port 4195 --strictPort
# Open http://127.0.0.1:4195/local-dashboard/
```

## Verify

Build the preview artifact before running its browser harness. The --case=agent Brave run is fixture-only and does not read FALCON_DASHBOARD_SOURCE. The default source-comparison run, --case=legacy, --case=clipboard, --case=fonts, --source-only and --source-regressions require FALCON_DASHBOARD_SOURCE to point to the original OpenDesign project data root.

```bash
npm --prefix web run test:dashboard
npm --prefix web test
CHROME_BIN="/Applications/Brave Browser.app/Contents/MacOS/Brave Browser" npm --prefix web run test:dashboard:browser -- --case=agent
```

## Data and services

[VERIFIED, source: `data.json`, `store.mjs`] The five treasury runs are synthetic. The four embedded knowledge snapshots remain in `data.json` as a pinned design fixture but the Knowledge view reads the live mesh API after you connect with an access token (kept in memory only). The saved simulation uses `falconos-control-centre-preview-v1` in browser storage. The wrapper fixes that key for storage and locking. The existing treasury store retains its original default. State stays specific to the browser origin.

[INFERRED, workflow] Inspect examples, or create one saved simulation. Record evidence before running a cycle. Inspect the resulting decision and balances. The dashboard cannot move wallet funds. Its Connections view links to the separate mesh and Devnet terminal.

[VERIFIED, source: `Operate.jsx`, `mesh/scenario.mjs`] Operate reads the current live reserve capture from the mesh service. Enter a proposed position and owner limits to save a read-only decision graph. The source node is observed; mandate and proposal nodes are owner-entered. Results never claim wallet holdings, withdrawable liquidity or execution approval. The original Decisions route remains a synthetic treasury simulation.

[VERIFIED, asset provenance] The dashboard reuses the four font files under `web/landing/assets/`. Their extracted bytes match the source fonts. Existing font licenses remain there. The Alpine mark comes from the source SVG path. Earlier advisory pages remain original HTML under `/design-reference/`; they use their own browser storage key.

[INFERRED, design contract] See [Control Centre](../../docs/control-centre.md) for persistence, history, export and verification requirements.

[REPORTED, historical records] The entries below quote earlier verification reports. They were not rerun for this local-preview change.

[HISTORICAL VERIFICATION, 2026-09-27] Web suite: tests 161, pass 161, fail 0. Final Chrome run: passed:95, total:95, exceptions:[]. See [verification and screenshots](../../docs/verification/2026-09-27-dashboard.md). This is a dated result, not a current-checkout result.

[HISTORICAL VERIFICATION, 2026-09-30] The earlier 161/95 figures describe the 2026-09-27 four-view port. The 2026-09-30 web suite returned tests 187, pass 187, fail 0. A controlled browser run returned passed:132, total:132 across original source comparison and the additive Operate route. The real local Operate view loaded one saved REVIEW record with four checks and 11 graph nodes. No wallet signature, hosted API connection or live trade was tested by that browser fixture. This is historical evidence, not a current-checkout result.

[HISTORICAL VERIFICATION, later 2026-09-30 browser check] After the graph-first return flow, the controlled dashboard browser reported passed:134, total:134. It checked that Operate opened the newest saved graph without another POST and showed every decision lane at desktop width. The earlier 132/132 run remains a dated intermediate result; this is not a current-checkout result.

[HISTORICAL VERIFICATION, final recorded local browser run] The controlled dashboard browser returned passed:136, total:136. It checked that the latest saved graph opened in view and that Knowledge labeled reserve book liquidity as not withdrawable. The earlier counts remain dated intermediate runs. This is historical evidence, not a current-checkout result.
[HISTORICAL SOURCE AND BROWSER EVIDENCE, 2026-10-03] The previous dev:local recipe in web/local-web.mjs served http://127.0.0.1:4183/dashboard/; the App.jsx local route was paired with it. Its agent browser run node web/test/dashboard-browser.mjs --case=agent reported passed: 6, total: 6. The historical source files were Agent.jsx, agent-store.mjs, and mesh/http.mjs. The gated Yield Agent read the mesh yield catalog and handled typed discovery, simulation, and explanation requests. Its Cash Trace showed proposed flows, base APY, retrieval time, unknown costs, and venue limits. It stored simulated balances and receipts in browser storage and did not sign transactions or move funds. The browser test used fixture responses and did not verify live provider data or transaction execution. This is historical evidence, not a current-checkout result.
