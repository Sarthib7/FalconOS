export function makeDemoDocuments(at, scenario = 'liquid') {
  if (typeof at !== 'string' || !Number.isFinite(Date.parse(at)) || new Date(at).toISOString() !== at) throw new Error('Demo time must be canonical UTC time.');
  if (!['liquid', 'illiquid', 'stale', 'missing'].includes(scenario)) throw new Error('Demo scenario is invalid.');
  const node = (id, kind, label, properties = {}) => ({ id, kind, label, properties });
  const edge = (id, source, target, relation) => ({ id, source, target, relation });
  const structure = {
    schemaVersion: 1, mode: 'synthetic', sourceKey: 'demo/structure', sourceUrl: 'synthetic://falcon/demo/structure', observedAt: at,
    nodes: [
      node('position:one', 'position', 'First shared position', { amountUnits: '200000000' }),
      node('position:two', 'position', 'Second shared position', { amountUnits: '300000000' }),
      node('position:unrelated', 'position', 'Unrelated position', { amountUnits: '700000000' }),
      node('reserve:shared', 'reserve', 'Shared lending reserve'),
      node('reserve:unrelated', 'reserve', 'Other lending reserve'),
      node('protocol:demo', 'protocol', 'Synthetic lending protocol'),
      node('asset:usdc', 'asset', 'Synthetic USDC'),
    ],
    edges: [
      edge('edge:one-supply', 'position:one', 'reserve:shared', 'supplied_to'),
      edge('edge:two-supply', 'position:two', 'reserve:shared', 'supplied_to'),
      edge('edge:unrelated-supply', 'position:unrelated', 'reserve:unrelated', 'supplied_to'),
      ...['shared', 'unrelated'].flatMap((name) => [
        edge(`edge:${name}-protocol`, `reserve:${name}`, 'protocol:demo', 'operated_by'),
        edge(`edge:${name}-asset`, `reserve:${name}`, 'asset:usdc', 'denominated_in'),
      ]),
      ...['one', 'two', 'unrelated'].map((name) => edge(`edge:position-${name}-asset`, `position:${name}`, 'asset:usdc', 'denominated_in')),
    ],
  };
  const liquidity = {
    schemaVersion: 1, mode: 'synthetic', sourceKey: 'demo/liquidity', sourceUrl: 'synthetic://falcon/demo/liquidity',
    observedAt: scenario === 'stale' ? new Date(Date.parse(at) - 301000).toISOString() : at,
    nodes: [node('observation:shared', 'observation', 'Synthetic shared reserve liquidity', { status: 'ok', availableLiquidityUnits: scenario === 'illiquid' ? '400000000' : '600000000' })],
    edges: scenario === 'missing' ? [] : [edge('edge:shared-observation', 'observation:shared', 'reserve:shared', 'observes')],
  };
  return [structure, liquidity];
}
