# Bind responses to the session that requested them

[VERIFIED, `web/mesh/app.mjs`; browser report `docs/verification/2026-09-27-mvp/session-before.json`] A request used the correct token but its delayed response entered the next workspace. The pre-fix browser check returned `58/59` and displayed three prior-owner records.

[INFERRED, lesson] Capture both token and session generation before each request. Check them after transport and body decoding, including error paths. Invalidate the generation on connection changes. Request authentication alone does not protect browser state after an account change.

[VERIFIED, dashboard source and root browser report `docs/verification/2026-09-27-dashboard/browser.json`] The same boundary applies to clipboard operations. Closing one export and opening another invalidates pending copy results. Both delayed success and failure checks pass in the final `95/95` browser run. [REPORTED, isolated control] Removing the generation check causes `clipboard-before.json` to fail its targeted assertion.
