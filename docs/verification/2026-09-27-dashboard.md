# React Control Centre verification, 2026-09-27

[VERIFIED, `web/dashboard/`, `web/vite.config.js`] The React port is built at `/dashboard/`. It has Overview, Decisions, Knowledge and Connections views. The [contract](../control-centre.md) defines its boundaries. Earlier advisory pages remain labelled original HTML references.

## Measurements

| Check | Observed result | Evidence and limits |
| --- | --- | --- |
| Web suite | [VERIFIED] `tests 161`, `pass 161`, `fail 0`, `skipped 0` | [Output](2026-09-27-dashboard/web-tests.log). Includes dashboard fixtures, storage and existing web tests. It does not prove a wallet transaction. |
| Production build | [VERIFIED] `116 modules transformed`, `built in 1.32s`, exit `0` | [Output](2026-09-27-dashboard/build.log). Uses `build:site`, which does not run the market snapshot hook. |
| Development entry | [VERIFIED] HTML `200`, transformed React entry `200` | [Report](2026-09-27-dashboard/dev-http.json). Temporary port 4185; server stopped after checking. This checks HTTP loading only. |
| Running preview | [VERIFIED] Eight routes returned `200` | [Report](2026-09-27-dashboard/preview-http.json). Includes landing, dashboard, mesh, treasury, wallet app and three reference pages. Status codes do not prove interactions. |
| Original source | [VERIFIED] `checkedExistingFiles:132`, `changed:[]` | [Report](2026-09-27-dashboard/source-integrity.json). Compares the initial file manifest; does not enumerate later additions. |
| Existing service files | [VERIFIED] Of 58 tracked baseline files, only `web/landing/sections.jsx` changed | [Report](2026-09-27-dashboard/existing-integrity.json). This is the added dashboard link. The baseline covers backend, wallet, mesh and landing files, not the entire repository. |

[REPORTED, browser agent] The first complete interaction run returned `passed:90`, `total:90`, `exceptions:[]`, `remoteRequests:[]`. Its [report](2026-09-27-dashboard/functional-before-font-fix.json) covers sample replay, setup, supply, blocked exit, stale evidence, revocation, owner redemption, storage failure, reload, exports, two tabs, keyboard and bounded loops. That run did not check font binding. The final root run below includes font checks.

[VERIFIED, root browser run] The final [Chrome report](2026-09-27-dashboard/browser.json) returned `passed:95`, `total:95`, `exceptions:[]`, `remoteRequests:[]`, exit `0`. It checks all four views at 1440px and 320px, loaded font faces and actual rendered fonts. Root inspected the resulting screenshots against the source. These checks use synthetic browser records and blocked external requests; they do not test hosted services.

[VERIFIED, retained artifacts] [Source hashes](2026-09-27-dashboard/code-sha256.json) identify the inspected code. [Build hashes](2026-09-27-dashboard/build-sha256.json) identify the static output. Screenshots include [Overview](2026-09-27-dashboard/react-overview-1440.png), [Knowledge](2026-09-27-dashboard/react-knowledge-1440.png), and [mobile Decisions](2026-09-27-dashboard/react-decisions-320.png).

## Regressions and corrections

[VERIFIED, source inspection; REPORTED, original-source browser run] The original dashboard fails five targeted assertions across B75, B76, B77 and B80. It changes retained source text, leaves an expired current decision READY, mislabels knowledge exports, disables Stop during a queued cycle and saves that cycle after stopping. The [negative report](2026-09-27-dashboard/source-negative.json) has `passed:2`, `total:7`; the two passing checks concern exceptions and external requests.

[VERIFIED, root full suite; REPORTED, isolated negative control] Queued cancellation now preserves saved bytes. The old store with current tests produces `tests 3`, `pass 1`, `fail 2`. The fixed dashboard and treasury store tests produce `tests 23`, `pass 23`, `fail 0`. See [before](2026-09-27-dashboard/stop-before.log) and [after](2026-09-27-dashboard/stop-after.log). These focused tests use Node Web Locks. Chrome behavior is checked separately.

[VERIFIED, root source read; REPORTED, namespace control] The dashboard fixes its storage and lock key to `falconos-control-centre-preview-v1`. The [before test](2026-09-27-dashboard/namespace-before.log) fails before the treasury store accepts a selected key. The [after tests](2026-09-27-dashboard/namespace-after.log) pass. Existing treasury and advisory bytes stay separate.

[VERIFIED, correction] Font hashes alone did not establish that the browser used those fonts. The first CSS port contained placeholders from a sanitized reading copy. B82 now binds all four declarations to retained TTF assets. The [byte comparison](2026-09-27-dashboard/font-bytes.json) establishes asset identity only; the final root browser report confirms loaded and rendered fonts.

[REPORTED, isolated browser controls] Current tests against the preserved faulty expressions each collect two checks and fail the targeted check. B78 [rejects legacy Overview](2026-09-27-dashboard/legacy-before.json) with `Run has missing or unknown fields.` B79 [mislabels a newer export](2026-09-27-dashboard/clipboard-before.json) after delayed clipboard completion. B82 [rejects all four font loads](2026-09-27-dashboard/fonts-before.json). Each control changes only the named fault in a temporary copy; working source remains fixed.

[VERIFIED, correction] The first full web run returned `tests 158`, `pass 157`, `fail 1`. The existing polling success fixture allowed only 100ms of wall time. An isolated run also exceeded that limit. The test now controls `Date.now`; production timeout code is unchanged. The [initial output](2026-09-27-dashboard/web-first-failure.log) retains that failure. The development smoke check also first assumed an absolute script path; its corrected report resolves `./main.jsx` against the page URL.

## Reproduce

[VERIFIED, commands run in this session] From the repository root:

```bash
npm --prefix web test
npm --prefix web run build:site
```

[VERIFIED, final browser command] Chrome is required. The harness uses temporary profiles and synthetic records. It blocks external HTTP.

```bash
npm --prefix web run test:dashboard:browser
```

[VERIFIED, scope] This dashboard port adds no backend schema, hosted release or wallet signing. Connections links to the separate mesh and Devnet terminal. Its own knowledge analysis uses labelled retained samples. Actual wallet round-trip proof and email inbox delivery remain pending from the [MVP record](2026-09-27-mvp.md).

[VERIFIED, subsequent user direction] After local checks completed, the user requested the new website live. Publication is tracked separately. This record describes the local port before that release.
