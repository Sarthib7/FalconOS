# ADR 0003: Persist a replayable local command log

[INFERRED, amendment, 2026-09-27] [The graph contract](../decision-graph.md) adds policy versioning and saved event records. New records allow 2,097,152 UTF-16 code units (`string.length`). The smaller command-only bound below is historical. Legacy history is preserved and explicitly labeled when reconstructed.

[INFERRED, architecture decision] Date: 2026-09-26. Owner: architect. Status: Completed for the local contract.

## Context and alternatives

[INFERRED, requirement] Reload must recover the simulation. A save failure must not appear as a completed action. Multiple tabs must not overwrite each other.

[INFERRED, alternatives] Memory-only state loses history. Reusing a forgiving local store can hide corrupt records. A hosted database needs user identity and server operations. IndexedDB adds a transaction model that is unnecessary for one bounded record.

## Decision

[INFERRED, decision] Keep one versioned command log in browser storage. Validate it and replay it under a named Web Lock before a mutation. Check its revision, apply the command, and persist once before returning success. Repeated identical IDs are idempotent. Conflicting reuse fails.

[INFERRED, limits] A run has at most 200 events. The stored text has a 262,144-character limit. Reject excess; never discard old events. Export the validated JSON. No reset or delete command is included in this slice.

[VERIFIED, browser API documentation] The [Web Locks API](https://developer.mozilla.org/en-US/docs/Web/API/Web_Locks_API) coordinates contexts within the same origin and requires a secure context. [Storage.setItem](https://developer.mozilla.org/en-US/docs/Web/API/Storage/setItem) documents storage quota failure. These APIs do not turn browser data into authoritative financial records.

[INFERRED, consequences] This is browser-local replayable history. The browser owner can change or delete storage. Other devices and testers have separate state. A future server must revalidate commands and own canonical financial observations.

## Least confident decisions

1. [INFERRED] The record limit is sufficient for a bounded demonstration. Continuous operation requires a different persistence design.
2. [INFERRED] Export is enough recovery support for the first tester release. Cross-device restore needs its own trust model.
