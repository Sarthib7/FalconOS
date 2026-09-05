# P1-T07 synthetic agent fixture evidence

[VERIFIED, local record, 2026-09-05] This record covers the local evidence-to-thesis fixture path. It records no model call, authenticated call, paid call, provider call, or external post.

## Saved fixture result

[VERIFIED, persistent fixture command] The saved stdout file `data/verification/2026-09-05-p1-t07-persistent-thesis.stdout.txt` contains:

~~~json
{"requestId":"2aa6d631-dc49-4f73-9b19-dca6d8d45bd6","origin":"fixture","fixture":true,"route":"base-solana","status":"REVIEW","evidencePath":"runs/2db49276-f177-4a60-8983-25538a33d2c1.json","evidenceSha256":"9e8aabb5dd2bb5f2825ba26232bf31ead073a4332e41afb29f743877d6484e7b","thesisPath":"/Volumes/Sarthi MAC/FalconOS/data/theses/2aa6d631-dc49-4f73-9b19-dca6d8d45bd6.json","notePath":"/Volumes/Sarthi MAC/FalconOS/data/vault/FalconOS/Theses/2aa6d631-dc49-4f73-9b19-dca6d8d45bd6.md","thesisSha256":"79f8fabe178026bf63a1b6e5d600648d12c687abc0f5552d8b0c575ebdfb00f6"}
~~~

[VERIFIED, persistent fixture command] The matching exit file contains `0`. The saved note contains the exact text: `Fixture transport. No model call occurred. This record is not an agent decision.` It also links the canonical evidence ID `2db49276-f177-4a60-8983-25538a33d2c1` and records `execution_ready: false`.

[VERIFIED, saved evidence] The input Scan has `mode: "demo"`, route `base-solana`, `assessedAt: "2026-09-05T15:06:40.989Z"`, six-decimal scale metadata, and a `REVIEW` candidate with `quotedDeltaUsdc: "0.100000"`. All observation start and receipt times equal its assessment time. The canonical evidence SHA-256 is `9e8aabb5dd2bb5f2825ba26232bf31ead073a4332e41afb29f743877d6484e7b`.

[VERIFIED, saved thesis] The canonical thesis JSON has request ID `2aa6d631-dc49-4f73-9b19-dca6d8d45bd6`, origin `fixture`, route `base-solana`, status `REVIEW`, `fixture: true`, and `executionReady: false`. Its canonical SHA-256 is `79f8fabe178026bf63a1b6e5d600648d12c687abc0f5552d8b0c575ebdfb00f6`. Its note has SHA-256 `5ae62aac60bfad2be97d8c3f8943f61c35686caeb064cefca54d9450750f4e3a`.

## Contract check

[VERIFIED, contract source] The complete one-Scan request and cited response remain in the [synthetic CHK-26 exchange](../agent-contract.md#synthetic-chk-26-exchange). That inline example is historical. The persistent record above has the current UUID and route shape.

[VERIFIED, local structural check, 2026-09-05] The structural check returned:

~~~text
{"requestBlocks":1,"responseBlocks":1,"checks":{"oneScan":true,"assessmentCutoffOrder":true,"observationOrder":true,"observationAge":true,"timesAtCutoff":true,"hashMatches":true,"citationMatches":true,"fixtureResponse":true,"candidateEquality":true,"responseStatusMatches":true,"expiryAfterEvaluation":true,"executionDisabled":true},"result":"PASS"}
~~~

[VERIFIED, correction] The earlier inline sample placed observations after `assessedAt` and used a non-UUID request ID. The earlier check did not cover observation order, age, or candidate equality. The current persistent fixture uses generated valid times and a UUID. The current contract requires observation start and receipt times at or before assessment.

## Regression evidence

[VERIFIED, current source test] The final full-suite output includes `✔ P1-T07: unavailable observations cannot arrive after their Scan assessment`.

[VERIFIED, isolated old-source regression] The saved old-source output returned:

~~~text
ℹ tests 1
ℹ pass 0
ℹ fail 1
AssertionError [ERR_ASSERTION]: Missing expected rejection.
expected: /Observation is newer than Scan assessment/
~~~

The corresponding exit file contains `1`. This proves the retained regression test collected and failed against the old source. The working source was not reverted.

## Current boundary

[VERIFIED, final source/test freeze evidence] The saved full-suite output contains `tests 59`, `pass 59`, `fail 0`, `cancelled 0`, `skipped 0`, and exit `0`. The focused output contains `tests 35`, `pass 35`, `fail 0`, `cancelled 0`, `skipped 0`, and exit `0`. The typecheck exit file contains `0`. See the files under `data/verification/2026-09-05-p1-t07-*`.

[VERIFIED, local fixture boundary] This fixture validates bundle hashing, route binding, cutoff and observation order, response shape, citation matching, expiry, fixture authority, and thesis persistence. It does not establish a real agent decision, model transport, effective maximum reasoning, graph benefit, paper accounting, profit, or execution readiness.

[VERIFIED, open acceptance] CHK-26 preparation passes. P1-T07 remains in progress for the real delegated path. CHK-10, CHK-11, CHK-12, and CP1B remain open. The MVP still needs one real cited thesis, one paper-cycle outcome, and one review view.

## Least confident decisions

1. [INFERRED] The selected Codex CLI can produce the required thesis under the reviewed boundary. No model run has tested this.
2. [INFERRED] One synthetic exchange is enough to prepare the interface. Real agent behavior may expose new validation cases.
