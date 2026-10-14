import { createHash, randomUUID } from 'node:crypto';
import { MeshError } from './domain.mjs';
import { CONNECTORS, captureSource as captureLiveSource, validateLiveSource, projectLiveGraph, analyzeLiveGraph } from './live.mjs';
import { DEVNET_SUPPLY_LIMIT_UNITS } from './limits.mjs';
import { RESERVE_DECISION_MARKER, POLICY_VERSION } from './scenario.mjs';

export const PUBLIC_OWNER_ID = '__falcon_public_market_evidence__';
export const PUBLIC_GRAPH_LOCK_KEY = createHash('sha256').update('falcon_mesh:public_graph:head').digest().readBigInt64BE().toString();
export const PUBLIC_GRAPH_CACHE_MS = 60_000;
export const PUBLIC_PROGRAM_OBSERVATION = 'observation:live:solana-devnet-klend';
export const PUBLIC_RESERVE_OBSERVATION = 'observation:live:solana-devnet-reserve-liquidity';
export const PUBLIC_POLICY_DEFINITION_ID = RESERVE_DECISION_MARKER;
export const PUBLIC_POLICY_VERSION = POLICY_VERSION;

const EXPECTED_KEYS = CONNECTORS.map(connector => 'live:' + connector.id);

export async function lockPublicGraph(client, mode = 'shared') {
  const functionName = mode === 'exclusive' ? 'pg_advisory_xact_lock' : 'pg_advisory_xact_lock_shared';
  await client.query('SELECT ' + functionName + '($1::bigint)', [PUBLIC_GRAPH_LOCK_KEY]);
}

export async function lockMeshOwner(client, owner) {
  const key = createHash('sha256').update('falcon_mesh:' + owner).digest().readBigInt64BE().toString();
  await client.query('SELECT pg_advisory_xact_lock($1::bigint)', [key]);
}

export function publicGraphView(sources, at) {
  const graph = projectLiveGraph(sources, at);
  const programAnalysis = analyzeLiveGraph(graph, { observationId: PUBLIC_PROGRAM_OBSERVATION, maxHops: 3 }, at);
  const reserveAnalysis = analyzeLiveGraph(graph, { observationId: PUBLIC_RESERVE_OBSERVATION, maxHops: 3 }, at);
  const completeBundle = graph.sources.length === EXPECTED_KEYS.length
    && EXPECTED_KEYS.every(key => graph.sources.some(source => source.sourceKey === key));
  return {
    scope: 'public-market-evidence', chain: 'solana', network: 'devnet', graph,
    programAnalysis, reserveAnalysis,
    status: completeBundle && programAnalysis.status === 'OBSERVED' && reserveAnalysis.status === 'OBSERVED' ? 'OBSERVED' : 'NO_DATA',
    policyDefinitionId: PUBLIC_POLICY_DEFINITION_ID,
    policyVersion: PUBLIC_POLICY_VERSION,
    maxSupplyBaseUnits: DEVNET_SUPPLY_LIMIT_UNITS.toString(),
    customGraphsSupported: false,
    executionReady: false,
  };
}

function usableBundle(bundle, at) {
  if (!bundle || bundle.sources.length !== EXPECTED_KEYS.length
      || EXPECTED_KEYS.some(key => !bundle.sources.some(source => source.sourceKey === key))) return false;
  const latest = Math.max(...bundle.sources.map(source => Date.parse(source.capturedAt)));
  const age = Date.parse(at) - latest;
  return age >= 0 && age <= PUBLIC_GRAPH_CACHE_MS;
}

export function createPublicGraphService({ store, capture = captureLiveSource, now = () => new Date().toISOString() }) {
  let inFlight = null;

  async function refresh(expectedBundle) {
    let revisions;
    try {
      revisions = await Promise.all(CONNECTORS.map(async connector => {
        const content = await capture(connector.id, { now });
        const capturedAt = now();
        const document = validateLiveSource(content, capturedAt);
        if (document.sourceKey !== 'live:' + connector.id) throw new MeshError('INVALID_INPUT', 'Public capture did not match its fixed connector.');
        return { revisionId: randomUUID(), capturedAt, content };
      }));
    } catch (error) {
      try { await store.invalidatePublicBundle(expectedBundle?.sources ?? null); } catch {}
      throw error;
    }

    try {
      return await store.publishPublicBundle(revisions, expectedBundle?.sources ?? null);
    } catch (error) {
      if (error instanceof MeshError && error.code === 'CONFLICT') {
        const winner = await store.getPublicBundle();
        if (usableBundle(winner, now())) return winner;
        if (winner === null) {
          try {
            return await store.publishPublicBundle(revisions, null);
          } catch (retryError) {
            if (retryError instanceof MeshError && retryError.code === 'CONFLICT') {
              const retryWinner = await store.getPublicBundle();
              if (usableBundle(retryWinner, now())) return retryWinner;
            }
            throw retryError;
          }
        }
      }
      throw error;
    }
  }

  return {
    async get() {
      const at = now();
      const current = await store.getPublicBundle();
      if (usableBundle(current, at)) return publicGraphView(current.sources, at);
      if (!inFlight) inFlight = refresh(current).finally(() => { inFlight = null; });
      try {
        const bundle = await inFlight;
        const viewAt = now();
        return usableBundle(bundle, viewAt) ? publicGraphView(bundle.sources, viewAt) : publicGraphView([], viewAt);
      } catch {
        return publicGraphView([], now());
      }
    },
  };
}
