import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import { MeshError, validateSource, projectGraph, analyzeGraph } from '../domain.mjs';
import { makeDemoDocuments } from '../fixtures.mjs';

const AT = '2026-09-27T12:00:00.000Z';
const QUERY = { observationId: 'observation:shared', maxHops: 3 };
const hash = (text) => createHash('sha256').update(text, 'utf8').digest('hex');
const uuid = (value) => `10000000-0000-4000-8000-${String(value).padStart(12, '0')}`;
function revision(document, index, capturedAt = AT) {
  const content = JSON.stringify(document);
  return { revisionId: uuid(index + 1), sourceKey: document.sourceKey, sourceUrl: document.sourceUrl, observedAt: document.observedAt, capturedAt, sha256: hash(content), content };
}
function revisions(documents = makeDemoDocuments(AT, 'liquid'), capturedAt = AT) {
  return documents.map((document, index) => revision(document, index, capturedAt));
}
function run(documents = makeDemoDocuments(AT, 'liquid'), query = QUERY, at = AT) {
  return analyzeGraph(projectGraph(revisions(documents), AT), query, at);
}
function source(sourceKey, nodes = [], edges = []) {
  return { schemaVersion: 1, mode: 'synthetic', sourceKey, sourceUrl: `synthetic://falcon/${sourceKey}`, observedAt: AT, nodes, edges };
}
function rejects(document, message) {
  assert.throws(() => validateSource(JSON.stringify(document), AT), (error) => error instanceof MeshError && error.code === 'INVALID_INPUT' && (!message || error.message.includes(message)));
}

test('V98: source labels reject text that cannot round-trip through Postgres JSONB', () => {
  for (const label of ['bad\u0000label', 'bad\ud800label', 'bad\udc00label', 'bad\nlabel']) {
    const document = source('unicode', [{ id: 'asset:test', kind: 'asset', label, properties: {} }]);
    rejects(document);
  }
  const document = source('unicode', [{ id: 'asset:test', kind: 'asset', label: 'Euro € and token 🪙', properties: {} }]);
  assert.deepEqual(validateSource(JSON.stringify(document), AT), document);
});

test('V98: source URLs reject decoded null and malformed Unicode before storage', () => {
  for (const suffix of ['bad\u0000path', 'bad\ud800path', 'bad\udc00path']) {
    rejects({ ...source('unicode'), sourceUrl: `synthetic://falcon/${suffix}` });
  }
});

test('V91: source validation preserves exact content semantics and permits cross-document references', () => {
  const documents = makeDemoDocuments(AT, 'liquid');
  for (const document of documents) assert.deepEqual(validateSource(JSON.stringify(document, null, 2), AT), document);
  const raw = JSON.stringify(documents[0], null, 2);
  const retained = { ...revision(documents[0], 0), content: raw, sha256: hash(raw) };
  assert.equal(projectGraph([retained], AT).sources[0].sha256, hash(raw));
  assert.throws(() => projectGraph([{ ...retained, content: JSON.stringify(documents[0]) }], AT), /retained content/);
});

test('V91: source trust boundary rejects unsupported modes, fields, times, amounts, and malformed JSON', () => {
  const document = makeDemoDocuments(AT, 'liquid')[0];
  rejects({ ...document, mode: 'devnet' });
  rejects({ ...document, owner: 'other' });
  rejects({ ...document, sourceUrl: 'https://example.com' });
  rejects({ ...document, observedAt: '2026-09-27T12:00:00Z' });
  rejects({ ...document, observedAt: '2026-09-27T12:00:00.001Z' }, 'future');
  rejects({ ...document, observedAt: '2026-02-30T12:00:00.000Z' });
  for (const amountUnits of ['-1', '1.1', '01', '18446744073709551616', 1]) {
    const changed = structuredClone(document);
    changed.nodes[0].properties.amountUnits = amountUnits;
    rejects(changed);
  }
  assert.throws(() => validateSource('{', AT), /valid JSON/);
  assert.throws(() => validateSource('x'.repeat(128 * 1024 + 1), AT), (error) => error.code === 'TOO_LARGE');
});

test('V91: source IDs and typed relations reject duplicates and local endpoint mismatches', () => {
  const document = makeDemoDocuments(AT, 'liquid')[0];
  rejects({ ...document, nodes: [...document.nodes, document.nodes[0]] }, 'duplicate');
  const repeatedEdge = structuredClone(document);
  repeatedEdge.edges[0].id = document.nodes[0].id;
  rejects(repeatedEdge, 'duplicate');
  const wrongType = structuredClone(document);
  wrongType.edges[0].target = 'asset:usdc';
  rejects(wrongType, 'types');
  const unknownRelation = structuredClone(document);
  unknownRelation.edges[0].relation = 'mentions';
  rejects(unknownRelation, 'relation');
  const extraProperty = structuredClone(document);
  extraProperty.nodes[0].properties.source = 'invented';
  rejects(extraProperty, 'unknown');
});

test('V91,V93: projection sorts definitions and merges matching attestations without input mutation', () => {
  const documents = makeDemoDocuments(AT, 'liquid');
  documents.push(source('demo/corroboration', [documents[0].nodes[0]]));
  const stored = revisions(documents);
  const before = structuredClone(stored);
  const graph = projectGraph(stored, AT);
  assert.deepEqual(projectGraph([...stored].reverse(), AT), graph);
  assert.deepEqual(stored, before);
  assert.deepEqual(graph.nodes.find((node) => node.id === 'position:one').sourceRevisionIds, [uuid(1), uuid(3)]);
  assert.equal(graph.issues.length, 0);
  assert.ok(graph.sources.every((item) => !Object.hasOwn(item, 'content')));
});

test('V91: projection rejects source metadata/hash mismatches and repeated current source identities', () => {
  const stored = revisions();
  assert.throws(() => projectGraph([{ ...stored[0], observedAt: '2026-09-27T11:59:59.000Z' }], AT), /retained content/);
  assert.throws(() => projectGraph([stored[0], { ...stored[0], revisionId: uuid(3) }], AT), /duplicate identity/);
  assert.throws(() => projectGraph([{ ...stored[0], revisionId: 'not-a-uuid' }], AT), /UUID/);
});

test('V93: shared liquidity covers the exact combined exit and excludes unrelated positions', () => {
  const result = run();
  assert.equal(result.status, 'READY');
  assert.equal(result.totalAffectedUnits, '500000000');
  assert.equal(result.availableLiquidityUnits, '600000000');
  assert.equal(result.coverage.status, 'complete');
  assert.deepEqual(result.positionResults.map((position) => position.positionId), ['position:one', 'position:two']);
  assert.ok(!result.coverage.visitedNodeIds.includes('position:unrelated'));
  assert.ok(!result.coverage.visitedNodeIds.includes('reserve:unrelated'));
  assert.ok(!result.coverage.visitedEdgeIds.includes('edge:unrelated-asset'));
  assert.deepEqual(result.sourceRevisionIds, [uuid(1), uuid(2)]);
  assert.deepEqual(result.positionResults[0].pathNodeIds, ['observation:shared', 'reserve:shared', 'position:one']);
  assert.deepEqual(result.positionResults[0].pathEdgeIds, ['edge:shared-observation', 'edge:one-supply']);
});

test('V93: insufficient shared liquidity blocks every connected position, not only the larger one', () => {
  const result = run(makeDemoDocuments(AT, 'illiquid'));
  assert.equal(result.status, 'BLOCKED');
  assert.equal(result.availableLiquidityUnits, '400000000');
  assert.equal(result.totalAffectedUnits, '500000000');
  assert.deepEqual(result.positionResults.map((position) => position.status), ['BLOCKED', 'BLOCKED']);
});

test('V93: changing a relationship changes the affected set before the amount is calculated', () => {
  const documents = makeDemoDocuments(AT, 'illiquid');
  documents[0].edges.find((edge) => edge.id === 'edge:two-supply').target = 'reserve:unrelated';
  const result = run(documents);
  assert.equal(result.status, 'READY');
  assert.equal(result.totalAffectedUnits, '200000000');
  assert.deepEqual(result.positionResults.map((position) => position.positionId), ['position:one']);
});

test('V93: integer arithmetic remains exact above Number.MAX_SAFE_INTEGER and when totals exceed u64', () => {
  const documents = makeDemoDocuments(AT, 'liquid');
  documents[0].nodes.find((node) => node.id === 'position:one').properties.amountUnits = '18446744073709551615';
  documents[0].nodes.find((node) => node.id === 'position:two').properties.amountUnits = '1';
  documents[1].nodes[0].properties.availableLiquidityUnits = '18446744073709551615';
  const result = run(documents);
  assert.equal(result.totalAffectedUnits, '18446744073709551616');
  assert.equal(result.status, 'BLOCKED');
});

test('V93: missing observation links, protocol links, position assets, and dangling endpoints yield NO_DATA', () => {
  assert.equal(run(makeDemoDocuments(AT, 'missing')).coverage.status, 'missing_dependency');
  for (const edgeId of ['edge:shared-protocol', 'edge:shared-asset', 'edge:position-one-asset']) {
    const documents = makeDemoDocuments(AT, 'liquid');
    documents[0].edges = documents[0].edges.filter((edge) => edge.id !== edgeId);
    const result = run(documents);
    assert.equal(result.status, 'NO_DATA', edgeId);
    assert.equal(result.coverage.status, 'missing_dependency', edgeId);
  }
  const dangling = makeDemoDocuments(AT, 'liquid');
  dangling[1].edges[0].target = 'reserve:missing';
  const graph = projectGraph(revisions(dangling), AT);
  assert.match(graph.issues.join(' '), /Missing endpoint/);
  assert.equal(analyzeGraph(graph, QUERY, AT).status, 'NO_DATA');
});

test('V93: isolated observations and reserves with no positions are incomplete, not an empty READY result', () => {
  const documents = makeDemoDocuments(AT, 'liquid');
  documents[0].edges = documents[0].edges.filter((edge) => edge.relation !== 'supplied_to');
  assert.equal(run(documents).status, 'NO_DATA');
  assert.equal(run(documents).totalAffectedUnits, null);
  assert.equal(run(undefined, { observationId: 'observation:absent', maxHops: 3 }).status, 'NO_DATA');
});

test('V93: stale, future, and unavailable liquidity never produces READY', () => {
  assert.equal(run(makeDemoDocuments(AT, 'stale')).status, 'NO_DATA');
  const fresh = projectGraph(revisions(), AT);
  assert.equal(analyzeGraph(fresh, QUERY, '2026-09-27T11:59:59.000Z').status, 'NO_DATA');
  assert.equal(analyzeGraph(fresh, QUERY, '2026-09-27T12:05:00.000Z').status, 'READY');
  assert.equal(analyzeGraph(fresh, QUERY, '2026-09-27T12:05:00.001Z').status, 'NO_DATA');
  const unavailable = makeDemoDocuments(AT, 'liquid');
  unavailable[1].nodes[0].properties = { status: 'unavailable', availableLiquidityUnits: null };
  assert.equal(run(unavailable).status, 'NO_DATA');
});

test('V93: multiple observations and contradictory node definitions are explicit conflicts', () => {
  const documents = makeDemoDocuments(AT, 'liquid');
  documents[1].nodes.push({ ...structuredClone(documents[1].nodes[0]), id: 'observation:second' });
  documents[1].edges.push({ id: 'edge:second-observation', source: 'observation:second', target: 'reserve:shared', relation: 'observes' });
  assert.equal(run(documents).coverage.status, 'conflicting_evidence');
  const conflict = makeDemoDocuments(AT, 'liquid');
  const changed = structuredClone(conflict[0].nodes[0]);
  changed.properties.amountUnits = '999';
  conflict.push(source('demo/conflict', [changed]));
  const graph = projectGraph(revisions(conflict), AT);
  assert.match(graph.issues.join(' '), /Conflicting node definitions/);
  const result = analyzeGraph(graph, QUERY, AT);
  assert.equal(result.status, 'NO_DATA');
  assert.equal(result.coverage.status, 'conflicting_evidence');
});

test('V93: a mismatched asset or multiple reserve assignments cannot support an exit calculation', () => {
  const documents = makeDemoDocuments(AT, 'liquid');
  documents[0].nodes.push({ id: 'asset:other', kind: 'asset', label: 'Other asset', properties: {} });
  documents[0].edges.find((edge) => edge.id === 'edge:position-one-asset').target = 'asset:other';
  assert.equal(run(documents).coverage.status, 'conflicting_evidence');
  const multiple = makeDemoDocuments(AT, 'liquid');
  multiple[0].edges.push({ id: 'edge:other-reserve', source: 'position:one', target: 'reserve:unrelated', relation: 'supplied_to' });
  assert.equal(run(multiple).coverage.status, 'conflicting_evidence');
});

test('V93: required paths exceeding maxHops are truncated, including an already visited asset', () => {
  for (const maxHops of [1, 2]) {
    const result = run(undefined, { ...QUERY, maxHops });
    assert.equal(result.status, 'NO_DATA');
    assert.equal(result.coverage.status, 'truncated');
  }
  assert.equal(run(undefined, { observationId: QUERY.observationId }).status, 'READY');
  for (const maxHops of [null, 0, 4, 1.5, '3']) assert.throws(() => run(undefined, { ...QUERY, maxHops }), /maxHops/);
  assert.throws(() => run(undefined, { ...QUERY, owner: 'other' }), /unknown/);
});

test('V93: traversal node and edge limits cannot be mistaken for complete evidence', () => {
  const documents = makeDemoDocuments(AT, 'liquid');
  const extraNodes = Array.from({ length: 58 }, (_, index) => ({ id: `position:extra-${index}`, kind: 'position', label: `Extra ${index}`, properties: { amountUnits: '1' } }));
  const extraEdges = extraNodes.flatMap((node, index) => [
    { id: `edge:extra-supply-${index}`, source: node.id, target: 'reserve:shared', relation: 'supplied_to' },
    { id: `edge:extra-asset-${index}`, source: node.id, target: 'asset:usdc', relation: 'denominated_in' },
  ]);
  documents.push(source('demo/many-positions', extraNodes, extraEdges));
  const result = run(documents);
  assert.equal(result.status, 'NO_DATA');
  assert.equal(result.coverage.status, 'truncated');
  assert.ok(result.coverage.visitedNodeIds.length <= 64);
  const manyEdges = makeDemoDocuments(AT, 'liquid');
  manyEdges.push(source('demo/many-edges', [], Array.from({ length: 121 }, (_, index) => ({ id: `edge:extra-protocol-${index}`, source: 'reserve:shared', target: 'protocol:demo', relation: 'operated_by' }))));
  const edgeResult = run(manyEdges);
  assert.equal(edgeResult.status, 'NO_DATA');
  assert.equal(edgeResult.coverage.status, 'truncated');
  assert.ok(edgeResult.coverage.visitedEdgeIds.length <= 128);
});

test('V93: a capped graph remains explicitly truncated even when the selected canvas looks usable', () => {
  const documents = makeDemoDocuments(AT, 'liquid');
  for (let group = 0; group < 4; group += 1) documents.push(source(`demo/group-${group}`, Array.from({ length: 64 }, (_, index) => ({ id: `protocol:extra-${group}-${index}`, kind: 'protocol', label: `Extra ${group} ${index}`, properties: {} }))));
  const graph = projectGraph(revisions(documents), AT);
  assert.equal(graph.nodes.length, 256);
  assert.equal(graph.coverage.status, 'truncated');
  assert.equal(analyzeGraph(graph, QUERY, AT).status, 'NO_DATA');
  const manySources = Array.from({ length: 33 }, (_, index) => source(`demo/source-${index}`));
  const sourceGraph = projectGraph(revisions(manySources), AT);
  assert.equal(sourceGraph.sources.length, 32);
  assert.equal(sourceGraph.coverage.status, 'truncated');
  assert.equal(analyzeGraph(sourceGraph, QUERY, AT).status, 'NO_DATA');
});

test('V93,V94: analysis validates provenance, stays deterministic, and does not alter historical inputs', () => {
  const graph = projectGraph(revisions(), AT);
  const original = structuredClone(graph);
  const prior = analyzeGraph(graph, QUERY, AT);
  assert.deepEqual(analyzeGraph(graph, QUERY, AT), prior);
  assert.deepEqual(graph, original);
  const later = projectGraph(revisions(makeDemoDocuments(AT, 'illiquid')), AT);
  assert.notEqual(later.revision, graph.revision);
  assert.equal(analyzeGraph(later, QUERY, AT).status, 'BLOCKED');
  assert.equal(prior.status, 'READY');
  const wrongEvidence = structuredClone(graph);
  wrongEvidence.nodes[0].sourceRevisionIds = [uuid(99)];
  assert.throws(() => analyzeGraph(wrongEvidence, QUERY, AT), /evidence references/);
  const wrongRevision = { ...graph, revision: '0'.repeat(64) };
  assert.throws(() => analyzeGraph(wrongRevision, QUERY, AT), /does not match/);
});
