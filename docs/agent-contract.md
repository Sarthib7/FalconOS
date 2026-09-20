# P1-T06 local agent contract

[INFERRED, proposed contract] This document defines the smallest local boundary for one existing agent to read a FalconOS evidence bundle and return one cited research thesis. It does not implement an adapter, run an agent, or pass CP1B.

[VERIFIED, CONTEXT.md] The first slice supplies research evidence to agents. It has no wallet, funds, signing, transaction request, or automatic note ingestion. The existing scan uses REJECT, REVIEW, and UNAVAILABLE candidate states.

## Recommended executable

[INFERRED, recommendation] Use the local Codex CLI for the first adapter. Its non-interactive exec command accepts a prompt from stdin, accepts an output schema, can write the last response to a file, and supports ephemeral sessions. The adapter should pass the request as data and grant no action authority.

[INFERRED, selected model boundary] The actual delegated run must use `gpt-5.6-luna` with maximum reasoning. The local bundled catalog lists `max` for that model. Runtime acceptance of `model_reasoning_effort=max`, authentication, and model transport remain untested.

[VERIFIED, local command] The executable and version checks returned:

~~~text
$ command -v codex
/Users/sarthiborkar/.local/bin/codex
$ codex --version
WARNING: proceeding, even though we could not create PATH aliases: Operation not permitted (os error 1)
codex-cli 0.153.4
~~~

[VERIFIED, codex exec --help] The help output contains Run Codex non-interactively, says that - reads instructions from stdin, and lists --ephemeral, --ignore-user-config, --ignore-rules, --sandbox, --output-schema <FILE>, and -o, --output-last-message <FILE>.

[VERIFIED, local command] Claude Code is also present. The PATH check returned /Users/sarthiborkar/.local/bin/claude, and claude --version returned 2.1.246 (Claude Code). Its help lists -p, --print, --output-format with json, and --json-schema. It remains an available alternative, not the selected agent.

[VERIFIED, tool scope] Help and version commands only were run. No model request, paid call, authenticated call, network call, or secret-file read was performed. The PATH check found no executable for Aider, Ollama, or Goose. A PATH check cannot find an executable outside the checked PATH.

## Boundary

[INFERRED, proposed contract] FalconOS sends one AgentRequest JSON object to the adapter. The adapter sends one bounded prompt to the selected executable and reads one AgentThesis JSON object from its final response. A nonzero process exit, timeout, empty response, non-JSON response, or schema failure produces no accepted thesis.

[INFERRED, proposed request shape] The request contains parsed scans so the agent does not need filesystem access. The adapter computes each hash from the exact evidence bytes before it builds the request.

~~~ts
type AgentRequest = {
  schemaVersion: 1;
  requestId: string;
  evaluationAt: string;       // ISO-8601 UTC
  sourceCutoff: string;       // ISO-8601 UTC, inclusive
  route: 'solana-base' | 'base-solana';
  task: string;
  evidence: Array<{
    id: string;               // Scan.id
    path: string;              // citation locator, relative to the bundle
    sha256: string;            // lowercase SHA-256 of exact file bytes
    scan: Scan;                // parsed bytes after hash verification
  }>;
  notes: Array<{
    path: string;              // citation or context locator
    sha256: string;            // lowercase SHA-256 of exact file bytes
    text: string;
    trust: 'untrusted-note';
  }>;
};
~~~

[INFERRED, proposed request rules] requestId, evaluationAt, and sourceCutoff are required. sourceCutoff must be no later than evaluationAt. Every scan must have schemaVersion 1 or 2, an ID that matches its manifest entry, and an assessedAt at or before the cutoff. Version 1 observations retain the historical shape without `failure`; version 2 observations require `failure` (null for successful observations, otherwise the closed kind/retry metadata record) alongside the human-readable `error`. Every observation start and receipt time must be at or before its scan's assessedAt, and every cited provider timestamp must be at or before both its receipt and the cutoff when present. The adapter rejects paths that are absolute, contain .., or resolve through a symlink.

[VERIFIED, current request builder] The caller supplies `expectedEvidenceSha256`. The builder compares that value with the SHA-256 of the exact evidence bytes before parsing. It captures notes once, marks them `untrusted-note`, and rejects a note snapshot when an explicit source cutoff precedes the current clock. The request limit is 8 MiB, with at most 8 notes and 32 KiB per note.

[INFERRED, bounded bundle policy] The first adapter accepts one Scan, at most eight untrusted notes, a maximum of 32 KiB per note, and a serialized AgentRequest no larger than 8 MiB. It rejects larger requests before process launch. These are first-adapter limits, not source coverage claims. A later multi-scan contract needs its own size and cutoff checks.

[VERIFIED, src/vault.ts] Canonical evidence is the JSON scan followed by a newline. The exporter hashes those exact bytes with SHA-256 and writes them under runs/<scan-id>.json. The adapter must hash bytes before parsing or reserializing them. A reserialized object is not the bytes named by the manifest.

[INFERRED, proposed output shape] The response uses the current candidate vocabulary and carries only research authority.

~~~ts
type AgentThesis = {
  schemaVersion: 1;
  requestId: string;
  route: 'solana-base' | 'base-solana';
  fixture: boolean;
  status: 'REJECT' | 'REVIEW' | 'UNAVAILABLE';
  thesis: string;
  citations: Array<{
    evidenceId: string;
    path: string;
    sha256: string;
    assessedAt: string;
    supports: string;
  }>;
  invalidationConditions: string[];
  expiresAt: string;          // ISO-8601 UTC, later than evaluationAt
  missingEvidence: string[];
  executionReady: false;
};
~~~

[INFERRED, proposed response rules] The adapter accepts exactly one JSON object with no unknown fields. requestId must match. executionReady must be false. citations must be non-empty, and every citation ID, path, hash, and assessment time must match an input evidence entry. A citation to an evidence entry with mode demo requires fixture true and cannot support a live market claim. expiresAt must parse as UTC and be later than evaluationAt. invalidationConditions must be non-empty. missingEvidence may be empty, but the agent must not hide an unresolved source or cost limit in the thesis.

[VERIFIED, current response limits] The response is capped at 64 KiB. Its expiry must be later than evaluationAt and no more than five minutes later, and it cannot exceed a selected quote expiry. The host supplies the origin value to validation. A fixture origin or demo evidence requires `fixture: true`; a response cannot change the host origin into execution authority.

[INFERRED, authority boundary] The output has no action, wallet, transaction, signer, capital, or execution field. The adapter rejects any extra field that attempts to add one. REVIEW means a positive quoted difference may exist while costs, inventory, fills, or restoration remain unproven. It does not authorize a trade.

## Synthetic CHK-26 exchange

[REPORTED, root delegation message, 2026-09-05] Root selected the installed Codex CLI as D1 for the first adapter. This records an interface choice under delegated implementation authority. It does not record a model call, model choice, authentication result, or agent decision.

[VERIFIED, historical inline sample, 2026-09-05] The following request preserves an earlier synthetic example. It contains no live quote or model output, but its request ID predates the current UUID requirement and its shape predates the required route field. Do not copy it as a runnable request. Use the [saved P1-T07 fixture record](verification/2026-09-05-agent-fixture.md) for the current UUID, route, caller hash, and persistent output. The sha256 value is the SHA-256 of the compact Scan JSON shown here, followed by one newline:

~~~json
{
  "schemaVersion": 1,
  "requestId": "fixture-agent-request-20260905",
  "evaluationAt": "2026-09-05T14:00:00.000Z",
  "sourceCutoff": "2026-09-05T13:59:00.000Z",
  "task": "Review the supplied USDC/EURC quote evidence and state whether the candidate merits REVIEW.",
  "evidence": [
    {
      "id": "22222222-2222-4222-8222-222222222222",
      "path": "runs/fixture-scan.json",
      "sha256": "d293318adffc8b4958d2fe4223b556455f7a705975a2f1b5f8729d242a55738d",
      "scan": {
        "schemaVersion": 1,
        "id": "22222222-2222-4222-8222-222222222222",
        "mode": "demo",
        "assessedAt": "2026-09-05T13:58:00.000Z",
        "cycles": [
          {
            "sourceChain": "solana",
            "destinationChain": "base",
            "legs": [
              {
                "request": {
                  "chain": "solana",
                  "inputAsset": "USDC",
                  "outputAsset": "EURC",
                  "amount": "10000000"
                },
                "requestUrl": "demo:synthetic-quote",
                "startedAt": "2026-09-05T13:58:00.000Z",
                "receivedAt": "2026-09-05T13:58:00.000Z",
                "httpStatus": null,
                "raw": {
                  "synthetic": true,
                  "purpose": "Demonstrate evidence export and incomplete-cost decisions"
                },
                "quote": {
                  "inAmount": "10000000",
                  "outAmount": "8600000",
                  "gasUsd": null,
                  "l1FeeUsd": null,
                  "providerTimestamp": null,
                  "expiresAt": null
                },
                "error": null
              },
              {
                "request": {
                  "chain": "base",
                  "inputAsset": "EURC",
                  "outputAsset": "USDC",
                  "amount": "8600000"
                },
                "requestUrl": "demo:synthetic-quote",
                "startedAt": "2026-09-05T13:58:00.000Z",
                "receivedAt": "2026-09-05T13:58:00.000Z",
                "httpStatus": null,
                "raw": {
                  "synthetic": true,
                  "purpose": "Demonstrate evidence export and incomplete-cost decisions"
                },
                "quote": {
                  "inAmount": "8600000",
                  "outAmount": "9990000",
                  "gasUsd": "0.004234",
                  "l1FeeUsd": null,
                  "providerTimestamp": null,
                  "expiresAt": null
                },
                "error": null
              }
            ]
          },
          {
            "sourceChain": "base",
            "destinationChain": "solana",
            "legs": [
              {
                "request": {
                  "chain": "base",
                  "inputAsset": "USDC",
                  "outputAsset": "EURC",
                  "amount": "10000000"
                },
                "requestUrl": "demo:synthetic-quote",
                "startedAt": "2026-09-05T13:58:00.000Z",
                "receivedAt": "2026-09-05T13:58:00.000Z",
                "httpStatus": null,
                "raw": {
                  "synthetic": true,
                  "purpose": "Demonstrate evidence export and incomplete-cost decisions"
                },
                "quote": {
                  "inAmount": "10000000",
                  "outAmount": "8600000",
                  "gasUsd": "0.004234",
                  "l1FeeUsd": null,
                  "providerTimestamp": null,
                  "expiresAt": null
                },
                "error": null
              },
              {
                "request": {
                  "chain": "solana",
                  "inputAsset": "EURC",
                  "outputAsset": "USDC",
                  "amount": "8600000"
                },
                "requestUrl": "demo:synthetic-quote",
                "startedAt": "2026-09-05T13:58:00.000Z",
                "receivedAt": "2026-09-05T13:58:00.000Z",
                "httpStatus": null,
                "raw": {
                  "synthetic": true,
                  "purpose": "Demonstrate evidence export and incomplete-cost decisions"
                },
                "quote": {
                  "inAmount": "8600000",
                  "outAmount": "10010000",
                  "gasUsd": null,
                  "l1FeeUsd": null,
                  "providerTimestamp": null,
                  "expiresAt": null
                },
                "error": null
              }
            ]
          }
        ],
        "amountScale": {
          "decimals": 6,
          "verification": "historically verified by RPC capture on 2026-09-05; runtime metadata revalidation not performed"
        },
        "candidates": [
          {
            "sourceChain": "solana",
            "destinationChain": "base",
            "status": "REJECT",
            "reasons": [
              "NO_POSITIVE_QUOTED_DIFFERENCE",
              "COSTS_INCOMPLETE",
              "INVENTORY_UNVERIFIED",
              "SEQUENTIAL_QUOTES_NOT_FILLS"
            ],
            "inputUsdc": "10.000000",
            "intermediateEurc": "8.600000",
            "outputUsdc": "9.990000",
            "quotedDeltaUsdc": "-0.010000",
            "gasEstimatesUsd": [
              {
                "chain": "solana",
                "gas": null,
                "l1Fee": null
              },
              {
                "chain": "base",
                "gas": "0.004234",
                "l1Fee": null
              }
            ],
            "netProfitUsdc": null,
            "executionReady": false
          },
          {
            "sourceChain": "base",
            "destinationChain": "solana",
            "status": "REVIEW",
            "reasons": [
              "COSTS_INCOMPLETE",
              "INVENTORY_UNVERIFIED",
              "SEQUENTIAL_QUOTES_NOT_FILLS"
            ],
            "inputUsdc": "10.000000",
            "intermediateEurc": "8.600000",
            "outputUsdc": "10.010000",
            "quotedDeltaUsdc": "0.010000",
            "gasEstimatesUsd": [
              {
                "chain": "base",
                "gas": "0.004234",
                "l1Fee": null
              },
              {
                "chain": "solana",
                "gas": null,
                "l1Fee": null
              }
            ],
            "netProfitUsdc": null,
            "executionReady": false
          }
        ]
      }
    }
  ],
  "notes": []
}
~~~

[VERIFIED, historical inline sample response, 2026-09-05] A cited sample response for that historical request is:

~~~json
{
  "schemaVersion": 1,
  "requestId": "fixture-agent-request-20260905",
  "fixture": true,
  "status": "REVIEW",
  "thesis": "The synthetic candidate has a positive quoted difference, but the fixture does not prove executable profit.",
  "citations": [
    {
      "evidenceId": "22222222-2222-4222-8222-222222222222",
      "path": "runs/fixture-scan.json",
      "sha256": "d293318adffc8b4958d2fe4223b556455f7a705975a2f1b5f8729d242a55738d",
      "assessedAt": "2026-09-05T13:58:00.000Z",
      "supports": "Candidate quotedDeltaUsdc is 0.010000 USDC."
    }
  ],
  "invalidationConditions": [
    "The quote expires.",
    "A fresh quote removes the positive difference.",
    "Required costs or inventory are unavailable."
  ],
  "expiresAt": "2026-09-05T14:05:00.000Z",
  "missingEvidence": [
    "Verified token metadata",
    "Inventory and execution costs"
  ],
  "executionReady": false
}
~~~

[VERIFIED, correction, 2026-09-05] The prior hand-written sample placed observation times after assessedAt. The earlier check omitted observation ordering, observation age, and candidate equality. Current assess returned:

~~~text
{"handWritten":[{"status":"REVIEW","reasons":["FIXTURE_POSITIVE_DIFFERENCE"]}],"deterministic":[{"status":"REJECT","reasons":["STALE_OR_INVALID_OBSERVATION_TIME","PROVIDER_TIME_OUTSIDE_WINDOW","COSTS_INCOMPLETE","INVENTORY_UNVERIFIED","SEQUENTIAL_QUOTES_NOT_FILLS"]}],"observationWindow":[{"startedAt":"2026-09-05T13:58:01.000Z","receivedAt":"2026-09-05T13:58:02.000Z","assessedAt":"2026-09-05T13:58:00.000Z"},{"startedAt":"2026-09-05T13:58:03.000Z","receivedAt":"2026-09-05T13:58:04.000Z","assessedAt":"2026-09-05T13:58:00.000Z"}]}
~~~

[VERIFIED, regenerated fixture, 2026-09-05] The replacement request comes from demoCycles and createScan with the fixed assessedAt 2026-09-05T13:58:00.000Z. Its observations start and finish at assessedAt, so their age is zero. The fixed ID is applied for this inline example after generation. The candidate array remains the createScan result.

[INFERRED, sample boundary] The example uses a demo Scan, so fixture must be true. The citation copies the input ID, relative path, hash, and assessedAt. The response status does not authorize execution.

[VERIFIED, local structural check, 2026-09-05] The two JSON blocks parse and pass the one-Scan, assessment cutoff order, observation order, observation age, source cutoff, hash, citation, fixture, candidate equality, response status, expiry, and execution checks. The check returned:

~~~text
{"requestBlocks":1,"responseBlocks":1,"checks":{"oneScan":true,"assessmentCutoffOrder":true,"observationOrder":true,"observationAge":true,"timesAtCutoff":true,"hashMatches":true,"citationMatches":true,"fixtureResponse":true,"candidateEquality":true,"responseStatusMatches":true,"expiryAfterEvaluation":true,"executionDisabled":true},"result":"PASS"}
~~~

[VERIFIED, fixture record] The exact sample request and response are preserved in this section and summarized in the [P1-T07 fixture evidence record](verification/2026-09-05-agent-fixture.md). They are synthetic and do not represent a model decision.

[INFERRED, remaining runtime controls] Before a real D1 call, the adapter must select and record the model, use reviewed authentication, sanitize inherited environment values, and use a separate empty working directory. It must capture exit code, stderr, response bytes, and timing. It must reject any response that fails the request, citation, expiry, or output checks.

[INFERRED, network boundary] Model transport needs network access when the selected model is remote. Tool or child-process network access is a separate authority. A process-wide network deny could also block model transport. The inspected Codex flags expose no documented network-deny control, so this boundary needs an OS policy or a local process test before a real call.

## Hash and cutoff checks

[INFERRED, validation order] The adapter performs these checks before sending the request:

1. Resolve the bundle root and reject unsafe paths, missing files, symlinks, and duplicate IDs.
2. Read exact bytes and compare the caller-provided SHA-256 value with the manifest and exact bytes.
3. Parse each file as a Scan, then verify schemaVersion, id, and the manifest path.
4. Reject an observation start or receipt time newer than its assessment, and reject a scan or provider timestamp newer than sourceCutoff.
5. Capture notes once, mark every note as untrusted-note, and reject an explicit cutoff before the current note snapshot.
6. Send the validated request to the selected executable.

[INFERRED, validation order] After the process exits, the adapter parses one final JSON object, checks the output schema, matches requestId, verifies all citation hashes, and checks expiry. It stores no thesis note when any check fails. The first slice has no automatic retry for a failed scan, so an agent failure should remain visible to the caller.

## Untrusted notes and fixtures

[INFERRED, security boundary] Markdown notes, raw provider fields, URLs, and agent text are data. They cannot change the task, the source cutoff, the output schema, filesystem permissions, model settings, or authority boundary. The agent receives no tool request through this contract. It must not follow instructions embedded in a note or quote.

[INFERRED, fixture rule] A deterministic local test double may return the same response shape with fixture true. Its request, response, and saved records must use an explicit fixture label. A fixture can test parsing, hash checks, citation checks, expiry, and invalidation. It cannot establish a real agent decision, pass CP1B, or support a live market claim.

## Suggested local invocation

[INFERRED, proposed adapter command] With an output schema file, an empty working directory, and a temporary response path, the first Codex adapter can use the existing executable surface. Pass the selected model and request maximum reasoning through the generic config override. Runtime acceptance of the effort value remains open:

~~~sh
codex exec --ephemeral --ignore-user-config --ignore-rules --sandbox read-only --cd <empty-dir> --skip-git-repo-check --output-schema <schema-file> --output-last-message <response-file> --model gpt-5.6-luna -c model_reasoning_effort=max -
~~~

[INFERRED, transport rule] The adapter writes a fixed instruction plus the validated AgentRequest JSON to stdin. It reads only the response file as the candidate thesis. It records process exit status and stderr for diagnosis, but it does not treat progress events or prose as a thesis. The exact prompt wrapper and executable environment need one local contract test.

[VERIFIED, codex exec --help] The installed help lists read-only sandbox mode, --ignore-user-config, --ignore-rules, --cd, --skip-git-repo-check, --output-schema, and --output-last-message. It does not document a network-deny flag or a flag that disables all built-in tools. Read-only mode therefore does not prove that the process has no network or tool access. The adapter must verify that boundary with an OS control or a local process test before any model call. No MCP config, plugin directory, or additional directory belongs in this invocation.

[VERIFIED, codex exec --help] The help says that --ignore-user-config does not load CODEX_HOME/config.toml, but auth still uses CODEX_HOME. [INFERRED, environment boundary] A future adapter must use an explicit, sanitized environment and explicit model authorization. It must not inherit unreviewed credentials or integration settings. This boundary was not tested because no model call was allowed.

[INFERRED, dependency rule] A future adapter can use the existing Node standard library for child-process control, file reads, and SHA-256. This proposal adds no package, framework, network service, or runtime dependency.

## Decision and open evidence

[REPORTED, root delegation message, 2026-09-05] Root selected the installed Codex CLI as the first existing agent. The required model target is `gpt-5.6-luna` with maximum reasoning. The selection records the interface only. Model execution, expiry policy, and authorization for any model call remain open.

[VERIFIED, repository read, 2026-09-05] No agent adapter, runtime agent response, or decision validator exists in the current repository. Live verification manifests exist under data/verification. This document now includes one synthetic request and response. The local Codex executable is present, so a missing executable does not block the proposed interface. Actual integration remains open because no model run occurred. Effective reasoning, authentication, model transport, and built-in tool controls remain untested.

[VERIFIED, CHK-26 preparation, 2026-09-05] D1 selection, one synthetic request and response, and a passing local structural check are recorded above and in the [fixture evidence record](verification/2026-09-05-agent-fixture.md). Root accepted this preparation check. CHK-10, CHK-11, and CHK-12 remain open. CP1B stays open until a real delegated run and its controls pass.

## Least confident decisions

1. [INFERRED] Codex CLI is the best first executable because its inspected help exposes stdin, an output schema, and a final-response file. The model response shape and process isolation still need a local run.
2. [INFERRED] One inline Scan with bounded notes is the smallest safe bundle boundary. A larger bundle may need streaming when raw observations grow.
3. [INFERRED] One explicit expiry value is enough for the first thesis contract. The allowed duration needs a product decision before acceptance.
