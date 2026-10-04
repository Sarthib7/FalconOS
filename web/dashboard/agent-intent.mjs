const MAX_INPUT = 280;
const clean = value => typeof value === 'string' ? value.trim().toLowerCase().replace(/[?!.,]+$/g, '').replace(/\s+/g, ' ') : '';

export function parseAgentIntent(value) {
  if (typeof value !== 'string' || value.length > MAX_INPUT) return { type: 'unsupported' };
  const text = clean(value);
  if (/^(?:help|what can you do|show commands)$/.test(text)) return { type: 'help' };
  if (/^(?:find|show|list|discover)(?: me)?(?: all)?(?: solana)?(?: usdc)?(?: yield| yields| opportunities| pools)(?: on solana)?$/.test(text)) return { type: 'discover' };
  if (/^(?:simulate|plan)(?: a)?(?: usdc)?(?: yield)?(?: allocation| rebalance| move)?$/.test(text)) return { type: 'simulate' };
  if (/^explain(?: the| my)?(?: last)?(?: plan| simulation)?$/.test(text)) return { type: 'explain' };
  return { type: 'unsupported' };
}
