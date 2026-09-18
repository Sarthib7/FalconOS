import { createBasketProposal, createCanonicalBasketSnapshot, createHostTransportBoundary, STOCKS_SCHEMA_VERSION } from './stocks.ts';
import type {
  AssetCaptureInput,
  AssetSourcePrecedence,
  BasketLeg,
  CanonicalBasketSnapshot,
  CanonicalBasketSnapshotInput,
  DataProvenance,
  HostTransportBoundary,
  LeadResponse,
  RiskResponse,
  StockRegistryEntry,
  StocksHostTransport,
} from './stocks.ts';
import { evaluateMarketIntegrity } from './integrity.ts';
import type { LiveEvidenceAdapter, StockAssetConfig } from './live.ts';

export interface StocksHostConfig {
  assets: readonly StockAssetConfig[];
  coherenceCapMs: number;
  integrityMaxAgeMs?: number;
  provenance?: DataProvenance;
  checkedAt?: string;
}

function registryOf(asset: StockAssetConfig, provenance: DataProvenance): StockRegistryEntry {
  return {
    schemaVersion: STOCKS_SCHEMA_VERSION,
    registryVersion: 'stocks-agent-1',
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
    provenance,
  };
}

function precedenceOf(adapter: LiveEvidenceAdapter): AssetSourcePrecedence {
  const spec = { sourceId: adapter.sourceId, adapterVersion: adapter.adapterVersion, semanticVersion: adapter.semanticVersion };
  return {
    schemaVersion: STOCKS_SCHEMA_VERSION,
    policyVersion: 'stocks-agent-1',
    fields: [
      { field: 'price', primary: spec, secondary: null },
      { field: 'liquidity', primary: spec, secondary: null },
    ],
  };
}

export async function buildStocksSnapshot(config: StocksHostConfig, adapter: LiveEvidenceAdapter): Promise<CanonicalBasketSnapshot> {
  const assets: Record<string, AssetCaptureInput> = {};
  const assetIds: string[] = [];
  let maxCapturedMs = 0;
  const provenance = config.provenance ?? 'synthetic';
  for (const asset of config.assets) {
    assetIds.push(asset.assetId);
    const captures = await adapter.fetchAsset(asset);
    assets[asset.assetId] = { registry: registryOf(asset, provenance), precedence: precedenceOf(adapter), captures: [captures.price, captures.liquidity] };
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
    provenance,
  };
  return createCanonicalBasketSnapshot(input);
}

// Deterministic host-controlled council for Client Agents. Lead proposes configured weights;
// Risk applies market-integrity and liquidity vetoes. No wallet, signer, or live fetch here.
export function createStocksHostBoundary(config: StocksHostConfig): HostTransportBoundary {
  const legs: BasketLeg[] = config.assets.map(asset => ({ assetId: asset.assetId, underlying: asset.underlying, targetWeightBps: asset.targetWeightBps }));
  const transport: StocksHostTransport = {
    async lead(request): Promise<LeadResponse> {
      let status: LeadResponse['status'] = 'NO_DATA';
      let proposal: LeadResponse['proposal'] = null;
      try {
        const built = createBasketProposal({
          proposalId: `stocks-agent-${request.runId}`,
          snapshot: request.snapshot,
          legs,
          invalidations: ['evidence stale, pool delisted, or source disagreement'],
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
      const checkedAt = config.checkedAt ?? new Date().toISOString();
      const integrity = evaluateMarketIntegrity({
        snapshot: request.snapshot,
        proposal: request.leadProposal,
        checkedAt,
        maxAgeMs: config.integrityMaxAgeMs ?? 900_000,
      });
      if (integrity.status !== 'VERIFIED') {
        reasons.push(`market integrity ${integrity.status}: ${integrity.refusalCodes.join(', ')}`);
        status = integrity.status === 'DIVERGENT' ? 'BLOCK' : 'NO_DATA';
      }
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
      return {
        schemaVersion: STOCKS_SCHEMA_VERSION,
        kind: 'stocks.risk-response',
        role: 'independent-risk-reviewer',
        requestId: request.requestId,
        runId: request.runId,
        reviewId: `stocks-risk-${request.runId}`,
        status,
        critical: false,
        reasons,
        snapshotHash: request.snapshotHash,
        leadProposalHash: request.leadProposalHash,
      };
    },
  };
  return createHostTransportBoundary(transport);
}
