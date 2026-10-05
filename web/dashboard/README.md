# Control Centre

[VERIFIED, source: OpenDesign `index.html`, `falconos-workspace.html`; current React source: `App.jsx`] The original Control Centre design from project `886c2e41-d9d4-45e0-a67d-148f20cfca61` has four views: Overview, Decisions, Knowledge and Connections. The React port preserves them and adds Operate for live Devnet reserve scenario decisions. The source project remains standalone HTML; the port uses the existing React and Vite package.

## Run and preview

[INFERRED, commands] From the FalconOS repository root, run:

```bash
npm --prefix web run dev:local
```

[VERIFIED, 2026-10-03, source: `web/local-web.mjs`, `App.jsx`; browser check: `node web/test/dashboard-browser.mjs --case=agent`] Open `http://127.0.0.1:4183/dashboard/`. Direct links include `#decisions`, `#operate`, `#knowledge`, `#connections` and `#agent`. Use one web server on port 4183 at a time.

[INFERRED, built preview] Stop development before starting preview:

```bash
npm --prefix web run build:site
npm --prefix web run preview:local
```

## Verify

[INFERRED, commands] The browser harness uses Chrome, temporary profiles and loopback servers. It blocks external HTTP.

```bash
npm --prefix web run test:dashboard
npm --prefix web test
npm --prefix web run build:site
npm --prefix web run test:dashboard:browser
```

## Data and services

[VERIFIED, source: `data.json`, `store.mjs`] The five treasury runs are synthetic. The four embedded knowledge snapshots remain in `data.json` as a pinned design fixture but the Knowledge view reads the live mesh API after you connect with an access token (kept in memory only). The saved simulation uses `falconos-control-centre-preview-v1` in browser storage. The wrapper fixes that key for storage and locking. The existing treasury store retains its original default. State stays specific to the browser origin.

[INFERRED, workflow] Inspect examples, or create one saved simulation. Record evidence before running a cycle. Inspect the resulting decision and balances. The dashboard cannot move wallet funds. Its Connections view links to the separate mesh and Devnet terminal.

[VERIFIED, source: `Operate.jsx`, `mesh/scenario.mjs`] Operate reads the current live reserve capture from the mesh service. Enter a proposed position and owner limits to save a read-only decision graph. The source node is observed; mandate and proposal nodes are owner-entered. Results never claim wallet holdings, withdrawable liquidity or execution approval. The original Decisions route remains a synthetic treasury simulation.

[VERIFIED, asset provenance] The dashboard reuses the four font files under `web/landing/assets/`. Their extracted bytes match the source fonts. Existing font licenses remain there. The Alpine mark comes from the source SVG path. Earlier advisory pages remain original HTML under `/design-reference/`; they use their own browser storage key.

[INFERRED, design contract] See [Control Centre](../../docs/control-centre.md) for persistence, history, export and verification requirements.

[VERIFIED, local checks] Web suite: `tests 161`, `pass 161`, `fail 0`. Final Chrome run: `passed:95`, `total:95`, `exceptions:[]`. See [verification and screenshots](../../docs/verification/2026-09-27-dashboard.md).

[VERIFIED, 2026-09-30, local] The earlier `161/95` figures describe the 2026-09-27 four-view port. This checkout's web suite returned `tests 187`, `pass 187`, `fail 0`. A controlled browser run returned `passed:132`, `total:132` across original source comparison and the additive Operate route. The real local Operate view loaded one saved `REVIEW` record with four checks and 11 graph nodes. No wallet signature, hosted API connection or live trade was tested by that browser fixture.

[VERIFIED, later 2026-09-30 browser check] After the graph-first return flow, the controlled dashboard browser reported `passed:134`, `total:134`. It checks that Operate opens the newest saved graph without another POST and shows every decision lane at desktop width. The earlier `132/132` run remains a dated intermediate result.

[VERIFIED, final local browser check] The controlled dashboard browser returned `passed:136`, `total:136`. It now checks that the latest saved graph opens in view and that Knowledge labels reserve book liquidity as not withdrawable. The earlier counts remain dated intermediate runs.
[VERIFIED, 2026-10-03, source: `Agent.jsx`, `agent-store.mjs`, `mesh/http.mjs`; browser check: `node web/test/dashboard-browser.mjs --case=agent` reported `passed: 6`, `total: 6`] The gated Yield Agent reads the mesh yield catalog and handles typed discovery, simulation, and explanation requests. Its Cash Trace shows proposed flows, base APY, retrieval time, unknown costs, and venue limits. It stores simulated balances and receipts in browser storage. It does not sign transactions or move funds. The browser test uses fixture responses. It does not verify live provider data or transaction execution.
