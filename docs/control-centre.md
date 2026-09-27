# React Control Centre

[VERIFIED, user request, 2026-09-27] Port the dashboard designs from OpenDesign project `886c2e41-d9d4-45e0-a67d-148f20cfca61` into runnable React. Preserve the current design, interactions and assets. Its current `index.html` redirects to `falconos-workspace.html`, titled `Control Centre`. This differs from the landing entry read during the preceding task.

[VERIFIED, inspected source] The active dashboard has Overview, Decisions, Knowledge and Connections hash views. It starts on the Hold sample. It embeds five treasury runs, four knowledge graphs and three traversal results per graph. Its treasury domain matches `web/treasury/domain.mjs`. Four embedded fonts match the landing assets. The source directory has no package manifest, `DESIGN.md` or README. `brand-spec.md` records the selected visual direction.

[INFERRED, scope] Add `/dashboard/` in the existing React/Vite package. Preserve the four hash routes, default sample, fonts, mark, palette, charts, accessible inspectors and dialogs. Keep the landing and existing `/app/`, `/mesh/`, `/treasury/` and research routes. The older advisory dashboards remain separately labelled references unless the user requests their React port. The original OpenDesign files remain unchanged.

[VERIFIED, route integration] Three earlier HTML pages are copied verbatim under `web/public/design-reference/`. A local hash manifest records them. Their workspace and landing links redirect to `/dashboard/` and `/`. This preserves the existing reference navigation without merging the earlier advisory state into the new dashboard.

## Shared interfaces

[INFERRED, data interface] `web/dashboard/data.json` retains the exact parsed `cc-data` payload. Treasury runs replay through the canonical treasury domain. Knowledge views select the retained graph and analysis at their recorded cutoff. A test verifies source hashes, graph projection and all twelve analyses. No browser-created sample can claim live capture or financial approval.

[INFERRED, store interface] `web/dashboard/store.mjs` exports `STORE_KEY = 'falconos-control-centre-preview-v1'` and `createStore({storage,locks}={})`. Its result provides the existing `load`, `create`, `dispatch` and `exportRun` methods. Add an optional internal `key` argument to the treasury store, with its default unchanged. Use the same selected key for storage and Web Locks. The dashboard wrapper fixes its key. Existing treasury and advisory records stay unchanged. Records do not transfer across browser origins merely because their keys match.

[INFERRED, React behavior] App state owns view navigation, sample/saved selection, selected event, busy state, dialog state and the bounded loop. Preserve history pagination, chart selection, node/rule/source inspection, presets, custom observations, revocation and owner redemption. Capture form data before disabling inputs. Stop the loop on hidden pages, unmount, storage changes, errors, revocation or its ten-cycle limit. Reload never restarts it. Refresh the current decision when evidence ages; historical results retain their original cutoff.

[INFERRED, stop boundary] Stop stays available while a cycle waits for storage. The loop passes an optional `AbortSignal` through `dispatch(event, revision, {signal})`. Stopping cancels a queued lock request. A synchronous commit already entered remains recorded. [VERIFIED, primary reference] The [Web Locks specification](https://w3c.github.io/web-locks/#api-lockmanager-request) permits cancellation before a lock is granted and ignores the signal after grant.

[VERIFIED, correction: `web/dashboard/style.css:16,23,30,37`] The first CSS extraction retained placeholder font URLs from a sanitized reading copy. Correct font hashes did not prove browser use. The four declarations now reference the retained TTF assets. Browser font status and new screenshots must verify this correction.

[VERIFIED, primary reference checked 2026-09-27] React runs effect cleanup when dependencies change and when a component unmounts. See [React useEffect](https://react.dev/reference/react/useEffect). Vite accepts multiple HTML build entries; see [Vite build guide](https://vite.dev/guide/build.html#multi-page-app). [INFERRED, correction] Dashboard cleanup is a requirement pending browser verification, not a result established by reading React documentation.

[INFERRED, evidence and export] Render retained source content verbatim. Treasury exports describe commands, graphs, checks and outcomes only when present in the exported schema. Knowledge exports describe graph, analysis and sources. React owns modal close state and restores focus after native closure. A delayed clipboard result applies only to the export that requested it. Failed persistence leaves the saved bytes and displayed committed state intact.

[INFERRED, service boundary] Dashboard knowledge remains a labelled sample. Connections states remain disconnected until a service is actually connected. Add explicit navigation to `/mesh/` and its lending panel for existing service and wallet work. Dashboard sample actions neither request tokens nor sign or broadcast transactions. This port adds no backend or database schema.

## Ownership and verification

| Task | Owner | Files and verification |
| --- | --- | --- |
| CC-UI | UI implementer | [INFERRED] Dashboard React entry, components and CSS. Preserve source selectors for browser checks. |
| CC-DATA | domain implementer | [INFERRED] `data.json`, dashboard store, optional treasury store key, focused fixture/storage tests. |
| CC-BROWSER | browser verifier | [INFERRED] `web/test/dashboard-browser.mjs`. Compare source/React views; test saved flow, keyboard, mobile, reduced motion and storage failures. |
| CC-INTEGRATE | coordinator | [INFERRED] Vite entry, navigation, references, docs, final build and tests. |

[INFERRED, acceptance] Build actual React components. Verify all four views in Chrome at desktop and 320px. Test supply, blocked exit, stale evidence, revocation, owner redemption, reload and export with a disposable browser profile. Test source-byte display, historical cutoff, separate storage keys and two-tab coordination. Block external HTTP in the harness. Save observed output and limitations before claiming completion.

[VERIFIED, local acceptance] The final root web suite returned `tests 161`, `pass 161`, `fail 0`. The root Chrome run returned `passed:95`, `total:95`, `exceptions:[]`. Font load and rendered-font checks pass. [Verification](verification/2026-09-27-dashboard.md) retains screenshots, negative controls and code hashes. The user subsequently requested publication on the existing website.

## Least confident decisions

1. [INFERRED] `/dashboard/` is the clearest additive route. Existing `/dash/` has a separate research purpose.
2. [INFERRED] Earlier advisory pages should remain labelled references. Their React port depends on the user's pending scope answer.
