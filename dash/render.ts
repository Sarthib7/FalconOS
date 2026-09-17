import type { CanonicalBasketSnapshot, StocksAdviceResponse } from '../stocks/stocks.ts';
import { scaleDecimalToInteger } from '../stocks/live.ts';
import type { DashConfig } from './adapters.ts';
import type { UnderlyingReference } from '../stocks/live.ts';

function fromIntegerUnits(value: string, scale: number): string {
  if (scale === 0) return value;
  const digits = value.padStart(scale + 1, '0');
  const cut = digits.length - scale;
  return `${digits.slice(0, cut)}.${digits.slice(cut)}`;
}

export function renderAdvice(snapshot: CanonicalBasketSnapshot, advice: StocksAdviceResponse, config: DashConfig, underlyingRefs?: ReadonlyMap<string, UnderlyingReference | null>): string {
  const lines: string[] = [];
  lines.push('FalconOS · Stocks live dashboard   [advisory-only · executionReady=false]');
  lines.push(`provenance=${snapshot.envelope.provenance}  snapshot=${snapshot.envelope.status}  advice=${advice.status}`);
  lines.push(`capturedAt=${snapshot.envelope.capturedAt}  hash=${snapshot.hash.slice(0, 12)}`);
  lines.push('');
  lines.push('Evidence');
  for (const asset of config.assets) {
    const projection = snapshot.projections[asset.assetId];
    const price = projection?.fields.price ?? null;
    const liquidity = projection?.fields.liquidity ?? null;
    const priceText = price === null ? 'NO_DATA' : `$${fromIntegerUnits(price, asset.priceScale)}`;
    const liquidityText = liquidity === null ? 'NO_DATA' : `$${fromIntegerUnits(liquidity, asset.quantityScale)}`;
    let extra = '';
    const reference = underlyingRefs?.get(asset.assetId) ?? null;
    if (reference !== null && price !== null) {
      const underlyingUnits = BigInt(scaleDecimalToInteger(reference.spot, asset.priceScale));
      if (underlyingUnits > 0n) {
        const signedGap = BigInt(price) - underlyingUnits;
        const gap = signedGap < 0n ? -signedGap : signedGap;
        const bps = (gap * 10000n) / underlyingUnits;
        extra = `  underlying=$${fromIntegerUnits(underlyingUnits.toString(), asset.priceScale)}  premium=${signedGap < 0n ? '-' : '+'}${bps}bps`;
      }
    }
    lines.push(`  ${asset.underlying.padEnd(10)} token=${priceText.padEnd(16)} liquidity=${liquidityText}${extra}`);
  }
  if (snapshot.missing.length > 0) lines.push(`  missing: ${snapshot.missing.join(', ')}`);
  if (snapshot.conflicts.length > 0) lines.push(`  conflicts: ${snapshot.conflicts.join(', ')}`);
  lines.push('');
  lines.push('Proposal');
  if (advice.proposal === null) {
    lines.push('  none published');
  } else {
    for (const leg of advice.proposal.legs) {
      lines.push(`  ${leg.underlying.padEnd(10)} ${(leg.targetWeightBps / 100).toFixed(2)}%`);
    }
  }
  lines.push('');
  const review = advice.riskReview;
  if (review.kind === 'risk-review') {
    lines.push(`Risk review: ${review.status}${review.critical ? ' (critical)' : ''}${review.veto ? ' [veto]' : ''}`);
    for (const reason of review.reasons) lines.push(`  - ${reason}`);
  } else {
    lines.push(`Risk review: unavailable (${review.code})`);
  }
  lines.push('');
  lines.push('Citations');
  if (advice.citations.length === 0) {
    lines.push('  none (advice not published)');
  } else {
    for (const citation of advice.citations) {
      lines.push(`  ${citation.underlying.padEnd(10)} ${citation.field.padEnd(10)} ${citation.sourceId}  sha256=${citation.rawSha256.slice(0, 12)}`);
    }
  }
  return lines.join('\n');
}
