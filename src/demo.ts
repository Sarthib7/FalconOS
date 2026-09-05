import type { Chain, Cycle, Observation } from './types.ts';

// Synthetic data exercises both decisions. It is not a historical capture or a live quote.
export function demoCycles(amount: string, now = new Date()): Cycle[] {
  const timestamp = now.toISOString();
  const input = BigInt(amount);
  const intermediate = input * 86n / 100n;
  const observation = (chain: Chain, first: boolean, output: bigint): Observation => ({
    request: {chain, inputAsset: first ? 'USDC' : 'EURC', outputAsset: first ? 'EURC' : 'USDC',
      amount: first ? amount : intermediate.toString()},
    requestUrl: 'demo:synthetic-quote', startedAt: timestamp, receivedAt: timestamp,
    httpStatus: null,
    raw: {synthetic: true, purpose: 'Demonstrate evidence export and incomplete-cost decisions'},
    quote: {
      inAmount: first ? amount : intermediate.toString(), outAmount: output.toString(),
      gasUsd: chain === 'base' ? '0.004234' : null,
      l1FeeUsd: null, providerTimestamp: null, expiresAt: null,
    }, error: null,
  });
  return [
    {sourceChain: 'solana', destinationChain: 'base', legs: [
      observation('solana', true, intermediate), observation('base', false, input - input / 1000n),
    ]},
    {sourceChain: 'base', destinationChain: 'solana', legs: [
      observation('base', true, intermediate), observation('solana', false, input + input / 1000n),
    ]},
  ];
}
