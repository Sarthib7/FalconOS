import { randomUUID } from 'node:crypto';
import type { Candidate, Cycle, Scan } from '../src/types.ts';

const MAX_AGE_MS = 10_000;
const UNIT = 1_000_000n;

export function integerAmount(value: string): bigint {
  if (!/^[1-9]\d{0,19}$/.test(value)) throw new Error('Expected a positive integer token amount');
  return BigInt(value);
}

export function formatUnits(value: bigint): string {
  const sign = value < 0n ? '-' : '';
  const absolute = value < 0n ? -value : value;
  return `${sign}${absolute / UNIT}.${(absolute % UNIT).toString().padStart(6, '0')}`;
}

export function inputAmount(value: string): string {
  if (!/^\d{1,3}(\.\d{1,6})?$/.test(value)) throw new Error('Amount must be a decimal between 0.01 and 500 USDC');
  const [whole = '0', fraction = ''] = value.split('.');
  const units = BigInt(whole) * UNIT + BigInt(fraction.padEnd(6, '0'));
  if (units < 10_000n || units > 500n * UNIT) throw new Error('Amount must be between 0.01 and 500 USDC');
  return units.toString();
}

export function assess(cycle: Cycle, now: Date): Candidate {
  const candidate: Candidate = {
    sourceChain: cycle.sourceChain,
    destinationChain: cycle.destinationChain,
    status: 'UNAVAILABLE', reasons: [], inputUsdc: null, intermediateEurc: null,
    outputUsdc: null, quotedDeltaUsdc: null,
    gasEstimatesUsd: cycle.legs.map(leg => ({
      chain: leg.request.chain, gas: leg.quote?.gasUsd ?? null, l1Fee: leg.quote?.l1FeeUsd ?? null,
    })),
    netProfitUsdc: null, executionReady: false,
  };
  const [buy, sell] = cycle.legs;
  if (cycle.legs.length !== 2 || !buy?.quote || !sell?.quote || buy.error || sell.error) {
    candidate.reasons.push('SOURCE_UNAVAILABLE');
    return candidate;
  }
  if (buy.request.chain !== cycle.sourceChain || sell.request.chain !== cycle.destinationChain
    || cycle.sourceChain === cycle.destinationChain
    || buy.request.inputAsset !== 'USDC' || buy.request.outputAsset !== 'EURC'
    || sell.request.inputAsset !== 'EURC' || sell.request.outputAsset !== 'USDC'
    || buy.quote.inAmount !== buy.request.amount || sell.quote.inAmount !== sell.request.amount
    || buy.quote.outAmount !== sell.quote.inAmount) {
    candidate.reasons.push('MISMATCHED_LEGS');
    return candidate;
  }
  try {
    const input = integerAmount(buy.quote.inAmount);
    const intermediate = integerAmount(buy.quote.outAmount);
    const output = integerAmount(sell.quote.outAmount);
    integerAmount(sell.quote.inAmount);
    candidate.inputUsdc = formatUnits(input);
    candidate.intermediateEurc = formatUnits(intermediate);
    candidate.outputUsdc = formatUnits(output);
    candidate.quotedDeltaUsdc = formatUnits(output - input);
    candidate.status = output > input ? 'REVIEW' : 'REJECT';
    if (output <= input) candidate.reasons.push('NO_POSITIVE_QUOTED_DIFFERENCE');
  } catch {
    candidate.reasons.push('INVALID_AMOUNT');
    return candidate;
  }
  const assessedAt = now.getTime();
  for (const leg of cycle.legs) {
    const start = Date.parse(leg.startedAt);
    const received = Date.parse(leg.receivedAt);
    if (!Number.isFinite(start) || !Number.isFinite(received) || !Number.isFinite(assessedAt)
      || received < start || received > assessedAt || assessedAt - start > MAX_AGE_MS) {
      candidate.status = 'REJECT';
      candidate.reasons.push('STALE_OR_INVALID_OBSERVATION_TIME');
    }
    // A plausible provider time is necessary, but does not prove quote freshness.
    if (leg.quote?.providerTimestamp !== null && leg.quote?.providerTimestamp !== undefined) {
      const providerTime = Date.parse(leg.quote.providerTimestamp);
      if (!Number.isFinite(providerTime) || providerTime > assessedAt || assessedAt - providerTime > MAX_AGE_MS) {
        candidate.status = 'REJECT';
        candidate.reasons.push('PROVIDER_TIME_OUTSIDE_WINDOW');
      }
      if (Number.isFinite(providerTime) && Number.isFinite(received) && providerTime > received) {
        candidate.status = 'REJECT';
        candidate.reasons.push('STALE_OR_INVALID_OBSERVATION_TIME');
      }
    }
    if (leg.quote?.expiresAt !== null && leg.quote?.expiresAt !== undefined) {
      const expiry = Date.parse(leg.quote.expiresAt);
      if (!Number.isFinite(expiry) || expiry <= assessedAt) {
        candidate.status = 'REJECT';
        candidate.reasons.push('QUOTE_EXPIRED');
      }
    }
  }
  candidate.reasons.push('COSTS_INCOMPLETE', 'INVENTORY_UNVERIFIED', 'SEQUENTIAL_QUOTES_NOT_FILLS');
  candidate.reasons = [...new Set(candidate.reasons)];
  return candidate;
}

export function createScan(cycles: Cycle[], mode: Scan['mode'], now = new Date()): Scan {
  return {
    schemaVersion: 2, id: randomUUID(), mode, assessedAt: now.toISOString(), cycles,
    amountScale: {decimals: 6, verification: 'historically verified by RPC capture on 2026-09-05; runtime metadata revalidation not performed'},
    candidates: cycles.map(cycle => assess(cycle, now)),
  };
}
