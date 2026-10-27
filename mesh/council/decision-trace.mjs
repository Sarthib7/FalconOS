import { MeshError } from '../domain.mjs';
import { canonicalBytes, freezeDeep, sha256 } from './evidence.ts';

export const DECISION_TRACE_LIMITS = Object.freeze({ records: 32, nodes: 64, edges: 128, bytes: 128 * 1024 });

export function projectDecisionTrace({ domain, root, nodes, edges, issues }) {
  if (nodes.length > DECISION_TRACE_LIMITS.nodes || edges.length > DECISION_TRACE_LIMITS.edges) {
    throw new MeshError('TOO_LARGE', 'The retained decision trace exceeds its limit.');
  }
  const ids = new Set(nodes.map(node => node.id));
  if (ids.size !== nodes.length || !ids.has(domain + ':' + root.id)
      || edges.some(edge => !ids.has(edge.source) || !ids.has(edge.target))) {
    throw new MeshError('STORAGE_UNAVAILABLE', 'Retained decision trace links are incomplete.');
  }
  const trace = {
    schemaVersion: 1,
    domain,
    rootRecordId: root.id,
    rootHash: root.contentHash,
    cutoffSequence: root.sequence,
    asOf: root.createdAt,
    verification: 'retained-records-only',
    status: issues.length || nodes.some(node => node.status === 'NO_DATA') ? 'NO_DATA' : 'OBSERVED',
    nodes: [...nodes].sort((left, right) => left.id.localeCompare(right.id)),
    edges: [...edges].sort((left, right) => left.source.localeCompare(right.source)
      || left.target.localeCompare(right.target) || left.relation.localeCompare(right.relation)),
    issues: [...issues].sort(),
    executionReady: false,
  };
  const bytes = canonicalBytes(trace);
  if (bytes.byteLength > DECISION_TRACE_LIMITS.bytes) {
    throw new MeshError('TOO_LARGE', 'The retained decision trace exceeds its byte limit.');
  }
  const result = { ...trace, hash: sha256(bytes) };
  if (canonicalBytes(result).byteLength > DECISION_TRACE_LIMITS.bytes) {
    throw new MeshError('TOO_LARGE', 'The retained decision trace exceeds its byte limit.');
  }
  return freezeDeep(result);
}
