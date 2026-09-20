export type Chain = 'solana' | 'base';
export type Asset = 'USDC' | 'EURC';

export interface QuoteRequest {
  chain: Chain;
  inputAsset: Asset;
  outputAsset: Asset;
  amount: string;
}

export interface Quote {
  inAmount: string;
  outAmount: string;
  gasUsd: string | null;
  l1FeeUsd: string | null;
  providerTimestamp: string | null;
  expiresAt: string | null;
}

export type FailureKind = 'dns' | 'connection' | 'tls' | 'timeout' | 'cancelled' | 'rate_limit' | 'http_server' | 'http_client' | 'invalid_body' | 'invalid_quote';

export interface ObservationFailure {
  kind: FailureKind;
  retryable: boolean;
  retryAfterMs: number | null;
}

export interface Observation {
  request: QuoteRequest;
  requestUrl: string;
  startedAt: string;
  receivedAt: string;
  httpStatus: number | null;
  raw: unknown;
  quote: Quote | null;
  error: string | null;
  failure: ObservationFailure | null;
}

export interface Cycle {
  sourceChain: Chain;
  destinationChain: Chain;
  legs: Observation[];
}

export interface Candidate {
  sourceChain: Chain;
  destinationChain: Chain;
  status: 'REJECT' | 'REVIEW' | 'UNAVAILABLE';
  reasons: string[];
  inputUsdc: string | null;
  intermediateEurc: string | null;
  outputUsdc: string | null;
  quotedDeltaUsdc: string | null;
  gasEstimatesUsd: { chain: Chain; gas: string | null; l1Fee: string | null }[];
  netProfitUsdc: null;
  executionReady: false;
}

export interface Scan {
  schemaVersion: 1 | 2;
  id: string;
  mode: 'live' | 'demo';
  assessedAt: string;
  amountScale: { decimals: 6; verification: 'historically verified by RPC capture on 2026-09-05; runtime metadata revalidation not performed' };
  cycles: Cycle[];
  candidates: Candidate[];
}

export interface PluginRequest {
  schemaVersion: 1;
  requestId: string;
  agentId: string;
  intent: {
    route: 'solana-base' | 'base-solana';
    amountUsdc: string;
    objective: string;
  };
  sourceCutoff: string | 'now';
  evidence: {
    path: string;
    sha256: string;
  };
  notes: Array<{path: string}>;
}

export interface PluginAdvisory {
  schemaVersion: 1;
  kind: 'advisory';
  requestId: string;
  agentId: string;
  route: 'solana-base' | 'base-solana';
  status: Candidate['status'];
  fixture: boolean;
  thesis: string;
  citations: Array<{
    evidenceId: string;
    path: string;
    sha256: string;
    assessedAt: string;
    supports: string;
  }>;
  invalidationConditions: string[];
  expiresAt: string;
  missingEvidence: string[];
  authority: 'advisory-only';
  executionReady: false;
}

export type PluginErrorCode =
  | 'INVALID_JSON'
  | 'INVALID_REQUEST'
  | 'EVIDENCE_INVALID'
  | 'ADVISORY_UNAVAILABLE'
  | 'INTERNAL_ERROR';

export interface PluginError {
  schemaVersion: 1;
  kind: 'error';
  requestId: string | null;
  code: PluginErrorCode;
  message: string;
  authority: 'advisory-only';
  executionReady: false;
}
