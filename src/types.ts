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

export interface Observation {
  request: QuoteRequest;
  requestUrl: string;
  startedAt: string;
  receivedAt: string;
  httpStatus: number | null;
  raw: unknown;
  quote: Quote | null;
  error: string | null;
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
  schemaVersion: 1;
  id: string;
  mode: 'live' | 'demo';
  assessedAt: string;
  amountScale: { decimals: 6; verification: 'historically verified by RPC capture on 2026-09-05; runtime metadata revalidation not performed' };
  cycles: Cycle[];
  candidates: Candidate[];
}
