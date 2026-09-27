# Keep local state out of development responses

[VERIFIED, `docs/verification/2026-09-27-mvp/private-state-before.txt`] All three Vite configurations served a dummy operator-token file through an allowed `@fs` path. Git exclusion did not affect HTTP serving.

[INFERRED, lesson] Deny private state directories in each development configuration. Preserve the server's default secret-file rules. Test direct paths and filesystem routes with disposable markers. Never use a real token to measure exposure.
