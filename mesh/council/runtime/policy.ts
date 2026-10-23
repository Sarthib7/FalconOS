export type WorkerErrorCode =
  | "INVALID_REQUEST"
  | "UNAVAILABLE"
  | "POLICY_DENIED"
  | "TIMED_OUT"
  | "ABORTED"
  | "TOO_LARGE"
  | "INVALID_RESPONSE";

export type Operation = "preflight" | "call";

export interface DispatchCounters {
  fetchFenceCallCount: number;
  providerDispatchCount: number;
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const HASH_PATTERN = /^[0-9a-f]{64}$/;
const COMMON_REQUEST_KEYS = [
  "schemaVersion", "role", "runId", "callId", "snapshotHash", "snapshot", "modelResult", "sourceRefs",
] as const;
const RISK_REQUEST_KEYS = [...COMMON_REQUEST_KEYS, "proposal"] as const;
const LEAD_RESULT_KEYS = [
  "schemaVersion", "role", "runId", "callId", "snapshotHash", "status", "thesis", "counterCase",
  "citations", "proposal", "missingEvidence", "executionReady",
] as const;
const RISK_RESULT_KEYS = [
  "schemaVersion", "role", "runId", "callId", "snapshotHash", "proposalHash", "status", "reason",
  "citations", "missingEvidence", "executionReady",
] as const;
const FORBIDDEN_ROUTING_KEYS: Record<string, true> = {
  provider: true,
  api: true,
  baseUrl: true,
  base_url: true,
  url: true,
  endpoint: true,
  headers: true,
  authorization: true,
  api_key: true,
  credential: true,
  account_id: true,
  session_id: true,
  transport: true,
};

export interface SourceReference {
  revisionId: string;
  sha256: string;
}

export interface ReviewRequest {
  schemaVersion: 1;
  role: "lead" | "risk";
  runId: string;
  callId: string;
  snapshotHash: string;
  snapshot: Record<string, unknown>;
  modelResult: Record<string, unknown>;
  sourceRefs: SourceReference[];
  proposal?: { hash: string | null; value: Record<string, unknown> | null };
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

export function hasExactKeys(value: unknown, expected: readonly string[]): value is Record<string, unknown> {
  if (!isRecord(value)) return false;
  const own = Reflect.ownKeys(value);
  return own.length === expected.length
    && own.every(key => typeof key === "string")
    && expected.every(key => Object.hasOwn(value, key));
}

function validSourceRefs(value: unknown): value is SourceReference[] {
  if (!Array.isArray(value) || value.length < 1 || value.length > 4) return false;
  const seen = new Set<string>();
  for (const entry of value) {
    if (!hasExactKeys(entry, ["revisionId", "sha256"])
        || typeof entry.revisionId !== "string"
        || !UUID_PATTERN.test(entry.revisionId)
        || typeof entry.sha256 !== "string"
        || !HASH_PATTERN.test(entry.sha256)
        || seen.has(entry.revisionId)) return false;
    seen.add(entry.revisionId);
  }
  return true;
}

export function requestError(
  request: unknown,
  operation: Operation,
  maxBytes: number,
): WorkerErrorCode | null {
  if (!isRecord(request)) return "INVALID_REQUEST";
  const role = request.role;
  if (role !== "lead" && role !== "risk") return "INVALID_REQUEST";
  const expected = role === "risk" ? RISK_REQUEST_KEYS : COMMON_REQUEST_KEYS;
  if (!hasExactKeys(request, expected)
      || request.schemaVersion !== 1
      || (operation === "preflight" && role !== "lead")
      || typeof request.runId !== "string" || !UUID_PATTERN.test(request.runId)
      || typeof request.callId !== "string" || !UUID_PATTERN.test(request.callId)
      || typeof request.snapshotHash !== "string" || !HASH_PATTERN.test(request.snapshotHash)
      || !isRecord(request.snapshot)
      || !isRecord(request.modelResult)
      || !validSourceRefs(request.sourceRefs)) {
    return "INVALID_REQUEST";
  }
  if (role === "risk") {
    const proposal = request.proposal;
    if (!hasExactKeys(proposal, ["hash", "value"])
        || !(proposal.hash === null || (typeof proposal.hash === "string" && HASH_PATTERN.test(proposal.hash)))
        || !(proposal.value === null || isRecord(proposal.value))) {
      return "INVALID_REQUEST";
    }
  }
  try {
    const serialized = JSON.stringify(request);
    if (typeof serialized !== "string") return "INVALID_REQUEST";
    return Buffer.byteLength(serialized, "utf8") <= maxBytes ? null : "TOO_LARGE";
  } catch {
    return "INVALID_REQUEST";
  }
}

export function isExactCouncilModel(
  model: unknown,
  expected: { provider: string; modelId: string; api: string; baseUrl: string; effort: string },
): boolean {
  if (!model || typeof model !== "object") return false;
  const candidate = model as Record<string, unknown>;
  if (!isRecord(candidate.thinking)) return false;
  const efforts = candidate.thinking.efforts;
  return candidate.provider === expected.provider
    && candidate.id === expected.modelId
    && candidate.api === expected.api
    && candidate.baseUrl === expected.baseUrl
    && (candidate.requestModelId === undefined || candidate.requestModelId === expected.modelId)
    && Array.isArray(efforts)
    && efforts.some(effort => effort === expected.effort);
}

export function payloadViolation(
  payload: unknown,
  model: unknown,
  request: ReviewRequest,
  expected: {
    provider: string;
    modelId: string;
    api: string;
    baseUrl: string;
    endpoint: string;
    effort: string;
    instructions: string;
    userTexts: readonly string[];
  },
): string | null {
  if (!isExactCouncilModel(model, expected) || !isRecord(payload)) return "model-route";
  if (payload.model !== expected.modelId || payload.stream !== true || payload.store !== false) return "payload-shape";
  if (payload.instructions !== expected.instructions) return "payload-context";
  if (!isRecord(payload.reasoning) || payload.reasoning.effort !== expected.effort) return "reasoning-effort";
  if (payload.reasoning.context === "all_turns") return "responses-lite";
  if (!Array.isArray(payload.input) || payload.input.length !== 1) return "payload-input";
  if (["tools", "tool_choice", "additional_tools", "access_programs", "parallel_tool_calls", "responses_lite"]
    .some(key => Object.hasOwn(payload, key))) return "tool-or-lite-field";
  if (Reflect.ownKeys(payload).some(key => typeof key === "string" && Object.hasOwn(FORBIDDEN_ROUTING_KEYS, key))) {
    return "unexpected-routing-field";
  }

  const item = payload.input[0];
  if (!isRecord(item)
      || (item.type !== undefined && item.type !== "message")
      || item.role !== "user"
      || !Array.isArray(item.content)
      || item.content.length !== 1) return "payload-input";
  if (item.type === "additional_tools" || Object.hasOwn(item, "tools")) return "responses-lite";
  const part = item.content[0];
  if (!isRecord(part) || part.type !== "input_text" || typeof part.text !== "string") return "payload-input";
  if (!expected.userTexts.includes(part.text)) return "payload-context";
  return request.role === "lead" || request.role === "risk" ? null : "invalid-role";
}


function incrementBounded(value: number): number {
  return Math.min(8, value + 1);
}

export function createFencedFetch({
  operation,
  endpoint,
  maxResponseBytes,
  fetchImpl,
  counters,
  authorizeDispatch,
  onFailure,
  makeError,
}: {
  operation: Operation;
  endpoint: string;
  maxResponseBytes: number;
  fetchImpl: typeof fetch;
  counters: DispatchCounters;
  authorizeDispatch: () => boolean;
  onFailure: (code: WorkerErrorCode) => void;
  makeError: (code: WorkerErrorCode) => Error;
}): typeof fetch {
  const fail = (code: WorkerErrorCode): never => {
    onFailure(code);
    throw makeError(code);
  };

  return async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    counters.fetchFenceCallCount = incrementBounded(counters.fetchFenceCallCount);
    if (operation === "preflight") fail("POLICY_DENIED");
    if (counters.providerDispatchCount !== 0) fail("POLICY_DENIED");

    const request = typeof Request !== "undefined" && input instanceof Request ? input : undefined;
    const url = typeof input === "string" ? input : request?.url ?? (input instanceof URL ? input.href : "");
    const methodValue = init?.method ?? request?.method ?? "GET";
    if (url !== endpoint) fail("POLICY_DENIED");
    if (typeof methodValue !== "string" || methodValue.toUpperCase() !== "POST") fail("POLICY_DENIED");
    if (!authorizeDispatch()) fail("POLICY_DENIED");

    counters.providerDispatchCount = incrementBounded(counters.providerDispatchCount);
    const upstreamSignal = init?.signal ?? request?.signal;
    const controller = new AbortController();
    const relayAbort = (): void => controller.abort(upstreamSignal?.reason);
    if (upstreamSignal?.aborted) relayAbort();
    else upstreamSignal?.addEventListener("abort", relayAbort, { once: true });

    let response: Response;
    try {
      response = await fetchImpl(input, {
        ...init,
        method: methodValue,
        redirect: "error",
        signal: controller.signal,
      });
    } catch (error) {
      upstreamSignal?.removeEventListener("abort", relayAbort);
      throw error;
    }

    if (!response.body) {
      upstreamSignal?.removeEventListener("abort", relayAbort);
      return response;
    }
    if (response.body.locked) {
      upstreamSignal?.removeEventListener("abort", relayAbort);
      controller.abort();
      fail("POLICY_DENIED");
    }

    const reader = response.body.getReader();
    let receivedBytes = 0;
    let released = false;
    const release = (): void => {
      if (released) return;
      released = true;
      upstreamSignal?.removeEventListener("abort", relayAbort);
      try { reader.releaseLock(); } catch {}
    };
    const limitedBody = new ReadableStream<Uint8Array>({
      async pull(streamController) {
        let chunk: ReadableStreamReadResult<Uint8Array>;
        try {
          chunk = await reader.read();
        } catch (error) {
          release();
          streamController.error(error);
          return;
        }
        if (chunk.done) {
          release();
          streamController.close();
          return;
        }
        const value = chunk.value;
        if (!value) {
          release();
          streamController.error(makeError("INVALID_RESPONSE"));
          return;
        }
        if (value.byteLength > maxResponseBytes - receivedBytes) {
          onFailure("TOO_LARGE");
          controller.abort();
          try { await reader.cancel(); } catch {}
          release();
          streamController.error(makeError("TOO_LARGE"));
          return;
        }
        receivedBytes += value.byteLength;
        streamController.enqueue(value);
      },
      async cancel(reason) {
        controller.abort(reason);
        try { await reader.cancel(reason); } finally { release(); }
      },
    });
    const headers = new Headers(response.headers);
    headers.delete("content-length");
    headers.delete("content-encoding");
    return new Response(limitedBody, {
      status: response.status,
      statusText: response.statusText,
      headers,
    });
  };
}

function validText(value: unknown, maxBytes: number): value is string {
  if (typeof value !== "string" || value.trim().length === 0 || Buffer.byteLength(value, "utf8") > maxBytes) {
    return false;
  }
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code === 0) return false;
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (!(next >= 0xdc00 && next <= 0xdfff)) return false;
      index += 1;
    } else if (code >= 0xdc00 && code <= 0xdfff) {
      return false;
    }
  }
  return true;
}

function validTextArray(value: unknown, minItems: number, maxItems: number, maxStringBytes: number): value is string[] {
  return Array.isArray(value)
    && value.length >= minItems
    && value.length <= maxItems
    && value.every(item => validText(item, maxStringBytes));
}

function validCitationList(value: unknown, sourceRefs: readonly SourceReference[]): value is Record<string, unknown>[] {
  if (!Array.isArray(value) || value.length > 16) return false;
  const seen = new Set<string>();
  for (const citation of value) {
    if (!hasExactKeys(citation, ["revisionId", "sha256", "supports"])) return false;
    const revisionId = citation.revisionId;
    const sha256 = citation.sha256;
    if (typeof revisionId !== "string"
        || !UUID_PATTERN.test(revisionId)
        || typeof sha256 !== "string"
        || !HASH_PATTERN.test(sha256)
        || !validText(citation.supports, 512)
        || seen.has(revisionId)) return false;
    const source = sourceRefs.find(reference => reference.revisionId === revisionId);
    if (!source || source.sha256 !== sha256) return false;
    seen.add(revisionId);
  }
  return true;
}

function validProposal(value: unknown): boolean {
  return hasExactKeys(value, ["summary", "conditions"])
    && validText(value.summary, 4096)
    && validTextArray(value.conditions, 1, 16, 512);
}

export function parseRoleJson(
  text: string,
  request: ReviewRequest,
  maxBytes: number,
): Record<string, unknown> | null {
  if (Buffer.byteLength(text, "utf8") > maxBytes) return null;
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return null;
  }
  const expected = request.role === "lead" ? LEAD_RESULT_KEYS : RISK_RESULT_KEYS;
  if (!hasExactKeys(value, expected)
      || value.schemaVersion !== 1
      || value.role !== request.role
      || value.runId !== request.runId
      || value.callId !== request.callId
      || value.snapshotHash !== request.snapshotHash
      || value.executionReady !== false) return null;
  const citations = value.citations;
  const missingEvidence = value.missingEvidence;
  if (!validCitationList(citations, request.sourceRefs)
      || !validTextArray(missingEvidence, 0, 32, 512)) return null;

  if (request.role === "lead") {
    if (typeof value.status !== "string"
        || !["PROPOSED", "NO_DATA"].includes(value.status)
        || !validText(value.thesis, 8192)
        || !validText(value.counterCase, 8192)) return null;
    if (value.status === "NO_DATA") return value.proposal === null ? value : null;
    if (value.proposal === null || !validProposal(value.proposal) || citations.length < 1) return null;
  } else {
    const proposal = request.proposal;
    if (!proposal
        || typeof value.status !== "string"
        || !["PASS", "BLOCKED", "NO_DATA"].includes(value.status)
        || value.proposalHash !== proposal.hash
        || !validText(value.reason, 4096)) return null;
    if (value.status === "PASS") {
      const assessment = request.modelResult.investmentAssessment;
      if (proposal.value === null
          || missingEvidence.length !== 0
          || citations.length < 1
          || request.modelResult.status !== "OBSERVED"
          || !isRecord(assessment)
          || assessment.status !== "REVIEW") return null;
    }
  }

  try {
    const serialized = JSON.stringify(value);
    if (typeof serialized !== "string" || Buffer.byteLength(serialized, "utf8") > maxBytes) return null;
  } catch {
    return null;
  }
  return value;
}
