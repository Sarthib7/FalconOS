import { createBasketProposal, createCanonicalBasketSnapshot, createHostTransportBoundary, createStocksAdviceRequest, invokeStocksAdvice, STOCKS_SCHEMA_VERSION } from '../stocks/stocks.ts';
import type { AssetCaptureInput, AssetSourcePrecedence, BasketLeg, CanonicalBasketSnapshot, CanonicalBasketSnapshotInput, FieldCapture, HostTransportBoundary, LeadResponse, RiskResponse, StockRegistryEntry, StocksAdviceResponse, StocksHostTransport } from '../stocks/stocks.ts';
import { scaleDecimalToInteger } from './adapters.ts';
import type { DashAssetConfig, DashConfig, LiveEvidenceAdapter } from './adapters.ts';
import type { PythPriceResult, PythUnderlyingRef } from './pyth.ts';

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
export function dashBoundary(config: DashConfig, underlyingRefs?: ReadonlyMap<string, PythUnderlyingRef | null>): HostTransportBoundary {
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
          const reference = underlyingRefs?.get(asset.assetId) ?? null;
          const price = request.snapshot.projections[asset.assetId]?.fields.price;
          if (reference !== null && price !== null && price !== undefined) {
            const underlyingUnits = BigInt(scaleDecimalToInteger(reference.spot, asset.priceScale));
            if (underlyingUnits > 0n) {
              const tokenUnits = BigInt(price);
              const gap = tokenUnits > underlyingUnits ? tokenUnits - underlyingUnits : underlyingUnits - tokenUnits;
              const dislocationBps = (gap * 10000n) / underlyingUnits;
              if (dislocationBps > BigInt(config.maxDislocationBps ?? 500)) {
                reasons.push(`${asset.underlying} token dislocated ${dislocationBps}bps from underlying`);
                status = 'BLOCK';
              }
            }
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

// Pyth-central assembly: Pyth is the primary price source. When Pyth is healthy the DEX price
// is omitted (different venues never byte-match, so presenting both would trip the exact
// disagreement rule); when Pyth fails typed, the DEX price rides as the equivalence-validated
// secondary and V60 failover selects it. DEX Screener stays the liquidity primary. Pyth results
// are injected so tests stay offline.
export async function buildCentralSnapshot(config: DashConfig, dexAdapter: LiveEvidenceAdapter, pythResults: ReadonlyMap<string, PythPriceResult>): Promise<{ snapshot: CanonicalBasketSnapshot; underlyingRefs: Map<string, PythUnderlyingRef | null> }> {
  const assets: Record<string, AssetCaptureInput> = {};
  const assetIds: string[] = [];
  const underlyingRefs = new Map<string, PythUnderlyingRef | null>();
  let maxCapturedMs = 0;
  for (const asset of config.assets) {
    assetIds.push(asset.assetId);
    const dex = await dexAdapter.fetchAsset(asset);
    const pyth = pythResults.get(asset.assetId);
    underlyingRefs.set(asset.assetId, pyth?.underlying ?? null);
    const dexSpec = { sourceId: dexAdapter.sourceId, adapterVersion: dexAdapter.adapterVersion, semanticVersion: dexAdapter.semanticVersion };
    let captures: FieldCapture[];
    let precedence: AssetSourcePrecedence;
    if (pyth === undefined) {
      captures = [dex.price, dex.liquidity];
      precedence = {
        schemaVersion: STOCKS_SCHEMA_VERSION,
        policyVersion: 'dash-live-1',
        fields: [
          { field: 'price', primary: dexSpec, secondary: null },
          { field: 'liquidity', primary: dexSpec, secondary: null },
        ],
      };
    } else {
      const dexSecondary: FieldCapture = { ...dex.price, sourceRole: 'secondary', equivalenceValidated: true };
      captures = pyth.price.status === 'ok' ? [pyth.price, dex.liquidity] : [pyth.price, dexSecondary, dex.liquidity];
      precedence = {
        schemaVersion: STOCKS_SCHEMA_VERSION,
        policyVersion: 'dash-pyth-1',
        fields: [
          { field: 'price', primary: { sourceId: 'pyth', adapterVersion: 'pyth-hermes-v2', semanticVersion: 'core' }, secondary: dexSpec },
          { field: 'liquidity', primary: dexSpec, secondary: null },
        ],
      };
    }
    assets[asset.assetId] = { registry: registryOf(asset), precedence, captures };
    for (const capture of captures) {
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
  return { snapshot: createCanonicalBasketSnapshot(input), underlyingRefs };
}

export async function runCentralAdvice(config: DashConfig, dexAdapter: LiveEvidenceAdapter, pythResults: ReadonlyMap<string, PythPriceResult>): Promise<{ snapshot: CanonicalBasketSnapshot; advice: StocksAdviceResponse; underlyingRefs: Map<string, PythUnderlyingRef | null> }> {
  const { snapshot, underlyingRefs } = await buildCentralSnapshot(config, dexAdapter, pythResults);
  const stamp = `${Date.now()}`;
  const request = createStocksAdviceRequest({ requestId: `dash-${stamp}`, runId: `run-${stamp}`, snapshot });
  const advice = await invokeStocksAdvice(dashBoundary(config, underlyingRefs), request);
  return { snapshot, advice, underlyingRefs };
}
