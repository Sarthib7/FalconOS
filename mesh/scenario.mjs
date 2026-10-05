import { MeshError } from './domain.mjs';
import { analyzeLiveGraph } from './live.mjs';

export const RESERVE_DECISION_MARKER = 'decision:mesh-reserve-scenario/1';

const POLICY_VERSION = 'mesh-reserve-scenario/1';
const OBSERVATION_ID = 'observation:live:solana-devnet-reserve-liquidity';
const U64_MAX = 18446744073709551615n;
const U64 = /^(0|[1-9]\d{0,19})$/;
const FIELDS = ['proposedUnits', 'maxProposedUnits', 'minBookLiquidityUnits', 'maxObservationAgeSeconds'];
const LIMITS = Object.freeze([
  'Raw reserve book liquidity is not withdrawable liquidity and is not a guarantee of exit.',
  'The proposed position and mandate are owner-entered inputs, not verified wallet holdings.',
  'This decision never executes or approves a transaction; executionReady is always false.',
  'No wallet positions were evaluated, so affected units and position results are empty.',
  'The decision re-evaluates only the fixed Devnet reserve and vault capture and is valid only until expiresAt.',
]);

function invalid(message) { throw new MeshError('INVALID_INPUT', message); }
function u64(value, name, { positive = false } = {}) {
  if (typeof value !== 'string' || !U64.test(value) || BigInt(value) > U64_MAX) invalid(`${name} must be a canonical unsigned 64-bit integer string.`);
  if (positive && value === '0') invalid(`${name} must be greater than zero.`);
  return value;
}

export function parseScenario(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)
      || ![Object.prototype, null].includes(Object.getPrototypeOf(input))
      || Reflect.ownKeys(input).length !== FIELDS.length
      || Reflect.ownKeys(input).some(key => !FIELDS.includes(key)
        || !Object.hasOwn(Object.getOwnPropertyDescriptor(input, key), 'value'))) invalid('Scenario fields are invalid.');
  const age = input.maxObservationAgeSeconds;
  if (!Number.isInteger(age) || age < 1 || age > 300) invalid('maxObservationAgeSeconds must be an integer from 1 to 300.');
  return {
    proposedUnits: u64(input.proposedUnits, 'proposedUnits', { positive: true }),
    maxProposedUnits: u64(input.maxProposedUnits, 'maxProposedUnits', { positive: true }),
    minBookLiquidityUnits: u64(input.minBookLiquidityUnits, 'minBookLiquidityUnits'),
    maxObservationAgeSeconds: age,
  };
}

function byId(left, right) { return left.id < right.id ? -1 : left.id > right.id ? 1 : 0; }

export function evaluateReserveScenario(graph, scenario, at) {
  const owner = parseScenario(scenario);
  // The current reserve observation is the only source authority; analyzeLiveGraph validates the graph and `at`.
  const base = analyzeLiveGraph(graph, { observationId: OBSERVATION_ID, maxHops: 3 }, at);
  const now = Date.parse(at);
  const nodes = new Map(graph.nodes.map(node => [node.id, node]));
  const sources = new Map(graph.sources.map(source => [source.revisionId, source]));
  const observation = nodes.get(OBSERVATION_ID);
  const props = observation?.properties;
  const propsOk = Boolean(props) && props.status === 'ok' && props.reasonCode === null && props.slot !== null
    && props.availableLiquidityUnits !== null && props.reserveDataSha256 !== null && props.vaultDataSha256 !== null;
  const evidence = base.sourceRevisionIds.map(id => sources.get(id));
  const evidenceOk = base.coverage.status === 'complete' && propsOk && evidence.length > 0;

  let freshness = { ok: false, detail: null };
  let oldest = null;
  let ageSeconds = null;
  if (evidenceOk) {
    oldest = Math.min(...evidence.map(source => Date.parse(source.observedAt)));
    ageSeconds = Math.floor((now - oldest) / 1000);
    if (evidence.some(source => Date.parse(source.observedAt) > now || Date.parse(source.capturedAt) > now)) {
      freshness = { ok: false, detail: 'Reserve evidence is dated after the decision time.' };
    } else if (now - oldest > owner.maxObservationAgeSeconds * 1000) {
      freshness = { ok: false, detail: `Reserve evidence is ${ageSeconds} seconds old, above the owner maximum of ${owner.maxObservationAgeSeconds} seconds.` };
    } else if (base.status !== 'OBSERVED') {
      freshness = { ok: false, detail: base.summary };
    } else {
      freshness = { ok: true, detail: `Reserve evidence is ${ageSeconds} seconds old, within the owner maximum of ${owner.maxObservationAgeSeconds} seconds.` };
    }
  }
  const available = freshness.ok ? props.availableLiquidityUnits : null;

  const capFail = BigInt(owner.proposedUnits) > BigInt(owner.maxProposedUnits);
  const floorFail = freshness.ok && BigInt(available) < BigInt(owner.minBookLiquidityUnits);
  const skipped = detail => ({ status: 'SKIPPED', detail });
  const checkBodies = {
    evidence: {
      label: 'Current reserve and vault evidence',
      ...(evidenceOk
        ? { status: 'PASS', detail: `The reserve and vault capture agree on ${props.availableLiquidityUnits} unborrowed base units at Devnet slot ${props.slot}.` }
        : { status: 'NO_DATA', detail: base.summary }),
    },
    freshness: {
      label: 'Evidence freshness',
      ...(!evidenceOk ? skipped('Skipped because current reserve evidence is absent.')
        : { status: freshness.ok ? 'PASS' : 'NO_DATA', detail: freshness.detail }),
    },
    owner_cap: {
      label: 'Owner maximum position',
      status: capFail ? 'BLOCKED' : 'PASS',
      detail: capFail
        ? `Proposed ${owner.proposedUnits} base units exceeds the owner maximum of ${owner.maxProposedUnits}.`
        : `Proposed ${owner.proposedUnits} base units is within the owner maximum of ${owner.maxProposedUnits}.`,
    },
    book_floor: {
      label: 'Owner book liquidity floor',
      ...(!freshness.ok ? skipped('Skipped because fresh reserve evidence is unavailable.')
        : {
          status: floorFail ? 'BLOCKED' : 'PASS',
          detail: floorFail
            ? `Observed unborrowed book ${available} base units is below the owner floor of ${owner.minBookLiquidityUnits}.`
            : `Observed unborrowed book ${available} base units meets the owner floor of ${owner.minBookLiquidityUnits}.`,
        }),
    },
  };

  const status = !evidenceOk || !freshness.ok ? 'NO_DATA' : capFail || floorFail ? 'BLOCKED' : 'REVIEW';
  let summary;
  if (status === 'NO_DATA') {
    summary = `No decision: ${(!evidenceOk ? checkBodies.evidence : checkBodies.freshness).detail} No live reserve evidence was used.`;
  } else if (status === 'BLOCKED') {
    summary = `Blocked by owner limits: ${[capFail && checkBodies.owner_cap.detail, floorFail && checkBodies.book_floor.detail].filter(Boolean).join(' ')}`;
  } else {
    summary = `Owner-entered proposal of ${owner.proposedUnits} base units is within the owner maximum of ${owner.maxProposedUnits}, and the observed unborrowed reserve book of ${available} base units at Devnet slot ${props.slot} meets the owner floor of ${owner.minBookLiquidityUnits}. This is for review only: it is not withdrawable liquidity, a wallet holding, or execution approval.`;
  }

  // Decision graph: real source path nodes are copied from the visited live graph; nothing is invented when absent.
  const visited = new Set(base.coverage.visitedNodeIds);
  const M = RESERVE_DECISION_MARKER;
  const graphNodes = [];
  const graphEdges = [];
  const present = new Set();
  // Account roles are fixed by the retained live edges (target of each reserve path edge).
  const pathIds = { reserve: null, vault: null, program: null };
  for (const [role, edgeId] of Object.entries({ reserve: 'edge:live:reserve-observation', vault: 'edge:live:reserve-vault', program: 'edge:live:reserve-program' })) {
    const edge = graph.edges.find(item => item.id === edgeId);
    if (edge && visited.has(edge.target)) pathIds[role] = edge.target;
  }
  const observedDetail = props
    ? `Live reserve capture status ${props.status}${props.reasonCode ? ` (${props.reasonCode})` : ''}; Devnet slot ${props.slot ?? 'unavailable'}; unborrowed book ${props.availableLiquidityUnits ?? 'unavailable'} base units; reserve data sha256 ${props.reserveDataSha256 ?? 'unavailable'}; vault data sha256 ${props.vaultDataSha256 ?? 'unavailable'}; source revisions ${base.sourceRevisionIds.join(', ') || 'none'}; observed ${evidence.length ? evidence.map(source => source.observedAt).join(', ') : 'unavailable'}.`
    : '';
  const roleLabels = { reserve: 'Devnet USDC reserve account', vault: 'Devnet USDC liquidity vault account', program: 'Devnet lending program account' };
  if (visited.has(OBSERVATION_ID) && observation) {
    graphNodes.push({ id: OBSERVATION_ID, kind: 'observation', label: observation.label, origin: 'OBSERVED', detail: observedDetail });
    present.add(OBSERVATION_ID);
  }
  for (const role of ['reserve', 'vault', 'program']) {
    const id = pathIds[role];
    const node = id && nodes.get(id);
    if (!node) continue;
    graphNodes.push({ id, kind: role, label: node.label, origin: 'OBSERVED', detail: `${roleLabels[role]} ${node.properties.address} on Devnet.` });
    present.add(id);
  }
  for (const edge of graph.edges) {
    if (edge.id.startsWith('edge:live:reserve-') && present.has(edge.source) && present.has(edge.target)) {
      graphEdges.push({ id: edge.id, source: edge.source, target: edge.target, relation: edge.relation });
    }
  }

  const proposalId = `${M}:owner-proposal`;
  const mandateId = `${M}:owner-mandate`;
  const resultId = `${M}:result`;
  graphNodes.push(
    { id: proposalId, kind: 'proposal', label: 'Owner-entered proposed position', origin: 'OWNER_ENTERED', detail: `${owner.proposedUnits} base units typed by the owner. This is not a wallet holding, balance, or executed position.` },
    { id: mandateId, kind: 'mandate', label: 'Owner mandate', origin: 'OWNER_ENTERED', detail: `Owner maximum ${owner.maxProposedUnits} base units; minimum unborrowed book ${owner.minBookLiquidityUnits} base units; maximum evidence age ${owner.maxObservationAgeSeconds} seconds.` },
  );
  const sourceIds = [OBSERVATION_ID, pathIds.reserve, pathIds.vault, pathIds.program].filter(id => id && present.has(id));
  const observationIds = present.has(OBSERVATION_ID) ? [OBSERVATION_ID] : [];
  const inputs = {
    evidence: sourceIds,
    freshness: [...observationIds, mandateId],
    owner_cap: [proposalId, mandateId],
    book_floor: [...observationIds, mandateId],
  };
  const shortOf = id => id === OBSERVATION_ID ? 'observation' : id === proposalId ? 'proposal' : id === mandateId ? 'mandate'
    : Object.entries(pathIds).find(([, value]) => value === id)?.[0];
  const checks = [];
  for (const id of ['evidence', 'freshness', 'owner_cap', 'book_floor']) {
    const body = checkBodies[id];
    const nodeId = `${M}:check:${id}`;
    checks.push({ id, label: body.label, status: body.status, detail: body.detail, evidenceNodeIds: [...inputs[id]] });
    graphNodes.push({ id: nodeId, kind: 'check', label: body.label, origin: 'RULE', detail: `${body.status}: ${body.detail}` });
    for (const input of inputs[id]) {
      const relation = input === mandateId ? 'limits' : input === proposalId ? 'input_to' : 'evidence_for';
      graphEdges.push({ id: `${M}:edge:${shortOf(input)}-${id}`, source: input, target: nodeId, relation });
    }
    graphEdges.push({ id: `${M}:edge:${id}-result`, source: nodeId, target: resultId, relation: 'determines' });
  }
  graphNodes.push({ id: resultId, kind: 'decision', label: `Decision: ${status}`, origin: 'DERIVED', detail: summary });

  graphNodes.sort(byId);
  graphEdges.sort(byId);
  const nodeIds = new Set(graphNodes.map(node => node.id));
  if (nodeIds.size !== graphNodes.length || new Set(graphEdges.map(edge => edge.id)).size !== graphEdges.length
      || graphEdges.some(edge => !nodeIds.has(edge.source) || !nodeIds.has(edge.target))) {
    throw new Error('Reserve decision graph is inconsistent.');
  }

  return {
    schemaVersion: 1,
    kind: 'reserve_scenario_decision',
    mode: 'live',
    policyVersion: POLICY_VERSION,
    at,
    graphRevision: graph.revision,
    observationId: OBSERVATION_ID,
    status,
    summary,
    scenario: { ...owner, provenance: 'OWNER_ENTERED' },
    checks,
    availableLiquidityUnits: available,
    totalAffectedUnits: null,
    positionResults: [],
    sourceRevisionIds: [...base.sourceRevisionIds],
    coverage: base.coverage,
    decisionGraph: { schemaVersion: 1, nodes: graphNodes, edges: graphEdges },
    executionReady: false,
    limits: [...LIMITS],
    expiresAt: freshness.ok ? new Date(oldest + owner.maxObservationAgeSeconds * 1000).toISOString() : null,
  };
}
