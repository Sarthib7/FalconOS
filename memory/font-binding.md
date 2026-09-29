# Verify font use in the browser

[VERIFIED, `web/dashboard/style.css`; root report `docs/verification/2026-09-27-dashboard/browser.json`] Four asset hashes matched the source, but the first CSS port still referenced `[EMBEDDED_ASSET]` placeholders. The initial visual check did not catch the fallback fonts. After correction, the final browser run returned `passed:95`, `total:95` and checked actual font bindings.

[INFERRED, lesson] An asset hash proves the file's identity. It does not prove CSS references that file or that text uses it. Check FontFace load status and rendered font bindings before recording visual preservation.
