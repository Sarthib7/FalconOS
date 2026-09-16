import { createBasketProposal, createCanonicalBasketSnapshot, createHostTransportBoundary, createStocksAdviceRequest, invokeStocksAdvice, STOCKS_SCHEMA_VERSION } from '../stocks/stocks.ts';
import type { AssetCaptureInput, AssetSourcePrecedence, BasketLeg, CanonicalBasketSnapshot, CanonicalBasketSnapshotInput, HostTransportBoundary, LeadResponse, RiskResponse, StockRegistryEntry, StocksAdviceResponse, StocksHostTransport } from '../stocks/stocks.ts';
import type { DashAssetConfig, DashConfig, LiveEvidenceAdapter } from './adapters.ts';

function registryOf(asset: DashAssetConfig): StockRegistryEntry {
  return {
    schemaVersion: STOCKS_SCHEMA_VERSION,
    registryVersion: 'dash-live-1',
    venue: 'solana',
    assetId: asset.assetId,
    underlying: asset.underlying,
    instrumentType: 'tokenized-equity',
    priceScale: asset.priceScale,
    quantityScale: asset.quantityScale,
    limits: { minLiquidity: asset.minLiquidity, maxWeightBps: asset.maxWeightBps },
    fees: { takerBps: 0, makerBps: 0 },
    capabilities: { tradable: true, redeemable: true },
    corporateAction: { lastEventId: null, asOf: null },
    provenance: 'live',
  };
}

function precedenceOf(adapter: LiveEvidenceAdapter): AssetSourcePrecedence {
  const spec = { sourceId: adapter.sourceId, adapterVersion: adapter.adapterVersion, semanticVersion: adapter.semanticVersion };
  return {
    schemaVersion: STOCKS_SCHEMA_VERSION,
    policyVersion: 'dash-live-1',
    fields: [
      { field: 'price', primary: spec, secondary: null },
      { field: 'liquidity', primary: spec, secondary: null },
    ],
  };
}

export async function buildLiveBasketSnapshot(config: DashConfig, adapter: LiveEvidenceAdapter): Promise<CanonicalBasketSnapshot> {
  const assets: Record<string, AssetCaptureInput> = {};
  const assetIds: string[] = [];
  let maxCapturedMs = 0;
  for (const asset of config.assets) {
    assetIds.push(asset.assetId);
    const captures = await adapter.fetchAsset(asset);
    assets[asset.assetId] = { registry: registryOf(asset), precedence: precedenceOf(adapter), captures: [captures.price, captures.liquidity] };
    for (const capture of [captures.price, captures.liquidity]) {
      const ms = Date.parse(capture.capturedAt);
      if (Number.isFinite(ms) && ms > maxCapturedMs) maxCapturedMs = ms;
    }
  }
  if (maxCapturedMs === 0) maxCapturedMs = Date.now();
  const input: CanonicalBasketSnapshotInput = {
    assetIds,
    assets,
    capturedAt: new Date(maxCapturedMs).toISOString(),
    coherenceCapMs: config.coherenceCapMs,
    provenance: 'live',
  };
  return createCanonicalBasketSnapshot(input);
}

// Deterministic host council over live evidence: the lead proposes the configured target
// weights bound to the snapshot; the independent reviewer vetoes on a pool-liquidity floor.
export function dashBoundary(config: DashConfig): HostTransportBoundary {
  const legs: BasketLeg[] = config.assets.map(asset => ({ assetId: asset.assetId, underlying: asset.underlying, targetWeightBps: asset.targetWeightBps }));
  const transport: StocksHostTransport = {
    async lead(request): Promise<LeadResponse> {
      let status: LeadResponse['status'] = 'NO_DATA';
      let proposal: LeadResponse['proposal'] = null;
      try {
        const built = createBasketProposal({
          proposalId: `dash-${request.runId}`,
          snapshot: request.snapshot,
          legs,
          invalidations: ['live evidence stale, pool delisted, or source disagreement'],
          confidence: null,
          horizon: null,
          expiresAt: new Date(Date.parse(request.snapshot.envelope.capturedAt) + 60_000).toISOString(),
        });
        proposal = built;
        status = built.status;
      } catch {
        proposal = null;
        status = 'NO_DATA';
      }
      return { schemaVersion: STOCKS_SCHEMA_VERSION, kind: 'stocks.lead-response', role: 'lead-specialist', requestId: request.requestId, runId: request.runId, snapshotHash: request.snapshotHash, status, proposal };
    },
    async riskReview(request): Promise<RiskResponse> {
      const reasons: string[] = [];
      let status: RiskResponse['status'] = 'PASS';
      if (request.snapshot.envelope.status !== 'READY' || request.leadProposal === null || request.leadProposal.status !== 'PROPOSED') {
        status = 'NO_DATA';
      } else {
        for (const asset of config.assets) {
          const liquidity = request.snapshot.projections[asset.assetId]?.fields.liquidity;
          if (liquidity === null || liquidity === undefined) {
            status = 'NO_DATA';
            break;
          }
          if (BigInt(liquidity) < BigInt(asset.minLiquidity)) {
            reasons.push(`${asset.underlying} pool liquidity below floor`);
            status = 'BLOCK';
          }
        }
      }
      return { schemaVersion: STOCKS_SCHEMA_VERSION, kind: 'stocks.risk-response', role: 'independent-risk-reviewer', requestId: request.requestId, runId: request.runId, reviewId: `dash-risk-${request.runId}`, status, critical: false, reasons, snapshotHash: request.snapshotHash, leadProposalHash: request.leadProposalHash };
    },
  };
  return createHostTransportBoundary(transport);
}

export async function runLiveAdvice(config: DashConfig, adapter: LiveEvidenceAdapter): Promise<{ snapshot: CanonicalBasketSnapshot; advice: StocksAdviceResponse }> {
  const snapshot = await buildLiveBasketSnapshot(config, adapter);
  const stamp = `${Date.now()}`;
  const request = createStocksAdviceRequest({ requestId: `dash-${stamp}`, runId: `run-${stamp}`, snapshot });
  const advice = await invokeStocksAdvice(dashBoundary(config), request);
  return { snapshot, advice };
}
