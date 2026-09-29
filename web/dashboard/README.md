# Control Centre

[VERIFIED, source: OpenDesign `index.html`, `falconos-workspace.html`] This port uses the current Control Centre design from project `886c2e41-d9d4-45e0-a67d-148f20cfca61`. It has four views: Overview, Decisions, Knowledge and Connections. The current source is standalone HTML. The port uses the repository's existing React and Vite package.

## Run and preview

[INFERRED, commands] From the FalconOS repository root, run:

```bash
npm --prefix web run dev:local
```

[INFERRED, route] Open `http://127.0.0.1:4183/dashboard/`. Direct links include `#decisions`, `#knowledge` and `#connections`. Use one web server on port 4183 at a time.

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

[VERIFIED, asset provenance] The dashboard reuses the four font files under `web/landing/assets/`. Their extracted bytes match the source fonts. Existing font licenses remain there. The Alpine mark comes from the source SVG path. Earlier advisory pages remain original HTML under `/design-reference/`; they use their own browser storage key.

[INFERRED, design contract] See [Control Centre](../../docs/control-centre.md) for persistence, history, export and verification requirements.

[VERIFIED, local checks] Web suite: `tests 161`, `pass 161`, `fail 0`. Final Chrome run: `passed:95`, `total:95`, `exceptions:[]`. See [verification and screenshots](../../docs/verification/2026-09-27-dashboard.md).
