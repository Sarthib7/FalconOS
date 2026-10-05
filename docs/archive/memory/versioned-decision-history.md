# Preserve the rule version with decision history

[VERIFIED, source] `web/treasury/domain.mjs:351` validates the saved policy and compares each record with replay. `appendEvent` preserves legacy commands and records the count reconstructed during upgrade.

[INFERRED, lesson] A command journal alone does not prove the originally displayed decision. Save its inputs, rule version, checks, and outcome. Reject unsupported rules before replacing storage. Label reconstructed history explicitly.

[VERIFIED, regression evidence] The source-copy check with saved-record comparison disabled returned `tests 1`, `fail 1`, exit `1`. See [verification](../docs/verification/2026-09-27-graphs.md).

[INFERRED, limit] Replay agreement detects inconsistent records. It cannot authenticate browser history against an owner who edits both commands and snapshots.
