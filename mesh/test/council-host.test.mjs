import test from "node:test";
import assert from "node:assert/strict";
import { canonicalBytes, sha256 } from "../council/evidence.ts";
import {
  COUNCIL_MODEL,
  COUNCIL_POLICY_VERSION,
  COUNCIL_REASONING_EFFORT,
  runCouncilReview,
} from "../council/host.mjs";

const nowText = "2026-10-21T12:00:00.000Z";
const runId = "11111111-1111-4111-8111-111111111111";
const sourceRefs = [
  { revisionId: "22222222-2222-4222-8222-222222222222", sha256: "a".repeat(64) },
  { revisionId: "33333333-3333-4333-8333-333333333333", sha256: "b".repeat(64) },
];

function modelResult(overrides = {}) {
  return {
    modelVersion: "near-observed/1",
    status: "OBSERVED",
    seriesSummaries: { retainedSeries: { sampleCount: 2, current: "1.25" } },
    unknowns: [],
    counterCase: ["Publisher-reported activity does not independently verify token demand."],
    investmentAssessment: { status: "REVIEW", reasons: [], proposal: null },
    executionReady: false,
    ...overrides,
  };
}

function snapshotFor(result = modelResult(), refs = sourceRefs) {
  return {
    schemaVersion: 1,
    domain: "near-thesis",
    adapterVersion: "near-revenue/1",
    sourceUrl: "https://revenue.near.org/",
    capturedAt: nowText,
    rawBodySha256: "c".repeat(64),
    rawBodyBytes: 4096,
    sourceRefs: refs,
    modelVersion: "near-observed/1",
    modelResult: result,
  };
}

// Synthetic unit-only preflight; it is not evidence of live Codex safety or model proof.
function verifiedPreflight(overrides = {}) {
  return {
    status: "VERIFIED",
    policyVersion: COUNCIL_POLICY_VERSION,
    requestedModel: COUNCIL_MODEL,
    requestedReasoningEffort: COUNCIL_REASONING_EFFORT,
    executableVersion: "0.160.0",
    checkedAt: nowText,
    policyHash: "d".repeat(64),
    verifiedControls: {
      userConfigIsolated: true,
      webSearchDisabled: true,
      commandToolsDisabled: true,
      patchToolsDisabled: true,
      inheritedMcpDisabled: true,
      readOnlySandbox: true,
      boundedIO: true,
      controlledProbePassed: true,
    },
    reasons: [],
    ...overrides,
  };
}

function citation(ref = sourceRefs[0]) {
  return { revisionId: ref.revisionId, sha256: ref.sha256, supports: "Retained publisher row supports this bounded statement." };
}

function leadResponse(request, overrides = {}) {
  return {
    schemaVersion: 1,
    role: "lead",
    runId: request.runId,
    callId: request.callId,
    snapshotHash: request.snapshotHash,
    status: "PROPOSED",
    thesis: "Observed publisher data supports a bounded research thesis, not a token-demand claim.",
    counterCase: "The publication is not independently reconciled to native-token demand.",
    citations: [citation()],
    proposal: { summary: "Retain the case for further research only.", conditions: ["Verify native-token demand independently."] },
    missingEvidence: [],
    executionReady: false,
    ...overrides,
  };
}

function riskResponse(request, overrides = {}) {
  return {
    schemaVersion: 1,
    role: "risk",
    runId: request.runId,
    callId: request.callId,
    snapshotHash: request.snapshotHash,
    proposalHash: request.proposal.hash,
    status: "PASS",
    reason: "No cited veto applies to the bounded research proposal.",
    citations: [citation()],
    missingEvidence: [],
    executionReady: false,
    ...overrides,
  };
}

function setup({ result = modelResult(), refs = sourceRefs, preflight = verifiedPreflight(), onCall } = {}) {
  const snapshot = snapshotFor(result, refs);
  const snapshotHash = sha256(canonicalBytes(snapshot));
  const calls = [];
  const transport = {
    async preflight() { return preflight; },
    async call(request) {
      calls.push(request);
      if (onCall) return onCall(request, calls.length);
      return request.role === "lead" ? leadResponse(request) : riskResponse(request);
    },
  };
  return { snapshot, snapshotHash, result, refs, calls, transport };
}

const optionsFor = setupResult => ({
  runId,
  snapshotHash: setupResult.snapshotHash,
  snapshot: setupResult.snapshot,
  modelResult: setupResult.result,
  sourceRefs: setupResult.refs,
  transport: setupResult.transport,
  now: () => nowText,
});

test("Lead and Risk bind distinct call IDs to the same frozen retained snapshot", async () => {
  const fixture = setup();
  const result = await runCouncilReview(optionsFor(fixture));

  assert.equal(result.status, "REVIEW");
  assert.equal(result.proposal.summary, "Retain the case for further research only.");
  assert.equal(result.executionReady, false);
  assert.deepEqual(Object.keys(result).sort(), ["executionReady", "lead", "proposal", "reasons", "risk", "runId", "schemaVersion", "snapshotHash", "status"].sort());
  assert.equal(fixture.calls.length, 2);
  assert.notEqual(fixture.calls[0].callId, fixture.calls[1].callId);
  assert.equal(fixture.calls[0].role, "lead");
  assert.equal(fixture.calls[1].role, "risk");
  assert.strictEqual(fixture.calls[0].snapshot, fixture.calls[1].snapshot);
  assert.strictEqual(fixture.calls[0].modelResult, fixture.calls[1].modelResult);
  assert.strictEqual(fixture.calls[0].sourceRefs, fixture.calls[1].sourceRefs);
  assert.equal(Object.isFrozen(fixture.calls[0].snapshot.modelResult), true);
  assert.deepEqual(fixture.calls[1].proposal, {
    hash: sha256(canonicalBytes(result.lead.proposal)),
    value: result.lead.proposal,
  });
});

test("Lead NO_DATA still gets an independent Risk review but cannot be promoted by PASS", async () => {
  const fixture = setup({
    result: modelResult({
      investmentAssessment: { status: "NO_DATA", reasons: ["NATIVE_TOKEN_DEMAND_UNVERIFIED"], proposal: null },
    }),
    onCall(request) {
      if (request.role === "lead") {
        return leadResponse(request, {
          status: "NO_DATA",
          citations: [],
          proposal: null,
          missingEvidence: ["Native-token demand is not independently verified."],
        });
      }
      return riskResponse(request, { proposalHash: null, citations: [] });
    },
  });

  const result = await runCouncilReview(optionsFor(fixture));
  assert.equal(fixture.calls.length, 2);
  assert.deepEqual(fixture.calls[1].proposal, { hash: null, value: null });
  assert.equal(result.status, "NO_DATA");
  assert.equal(result.proposal, null);
  assert.equal(result.executionReady, false);
});

test("Risk veto wins over missing investment attribution and never exposes the Lead proposal", async () => {
  const fixture = setup({
    result: modelResult({
      investmentAssessment: { status: "NO_DATA", reasons: ["NET_CAPTURE_METHODOLOGY_UNVERIFIED"], proposal: null },
    }),
    onCall(request) {
      return request.role === "lead"
        ? leadResponse(request)
        : riskResponse(request, { status: "BLOCKED", reason: "The retained source cannot support the proposed inference." });
    },
  });

  const result = await runCouncilReview(optionsFor(fixture));
  assert.equal(result.status, "BLOCKED");
  assert.equal(result.proposal, null);
  assert.equal(result.executionReady, false);
});

test("Wrong call identity or an unretained citation fails closed", async t => {
  await t.test("wrong Lead call identity", async () => {
    const fixture = setup({
      onCall(request) {
        return request.role === "lead"
          ? leadResponse(request, { callId: "44444444-4444-4444-8444-444444444444" })
          : riskResponse(request, { status: "NO_DATA", reason: "No valid Lead proposal is bound.", proposalHash: null, citations: [] });
      },
    });
    const result = await runCouncilReview(optionsFor(fixture));
    assert.equal(result.status, "NO_DATA");
    assert.equal(result.proposal, null);
    assert.equal(fixture.calls.length, 2);
  });

  await t.test("citation outside retained references", async () => {
    const fixture = setup({
      onCall(request) {
        if (request.role === "lead") return leadResponse(request, { citations: [citation({ revisionId: "55555555-5555-4555-8555-555555555555", sha256: "e".repeat(64) })] });
        return riskResponse(request, { status: "NO_DATA", reason: "Lead evidence binding is invalid.", proposalHash: null, citations: [] });
      },
    });
    const result = await runCouncilReview(optionsFor(fixture));
    assert.equal(result.status, "NO_DATA");
    assert.equal(result.proposal, null);
  });
});

test("Unverified or malformed preflight prevents both reviewer calls", async () => {
  const fixture = setup({ preflight: verifiedPreflight({ status: "NO_DATA", reasons: ["patch tool is not disabled"] }) });
  const result = await runCouncilReview(optionsFor(fixture));
  assert.equal(result.status, "NO_DATA");
  assert.equal(result.proposal, null);
  assert.equal(fixture.calls.length, 0);
});

test("Missing or oversized deterministic assessment data cannot start a review", async () => {
  const fixture = setup({ result: { modelVersion: "near-observed/1", status: "OBSERVED", seriesSummaries: {}, unknowns: [], counterCase: ["Unknown"], executionReady: false } });
  const result = await runCouncilReview(optionsFor(fixture));
  assert.equal(result.status, "NO_DATA");
  assert.equal(fixture.calls.length, 0);
});
