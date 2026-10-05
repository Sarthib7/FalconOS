import React, { useEffect, useRef, useState } from 'react';
import { API_BASE, TOKEN_PATTERN } from './api.mjs';
import { Badge, Facts, money, statusKind } from './ui.jsx';

const KIND_ORDER = ['observation', 'reserve', 'position', 'document', 'account', 'protocol', 'asset'];
const UUID = /^[a-f0-9-]{36}$/i;
const stamp = value => Number.isNaN(Date.parse(value)) ? String(value) : new Date(value).toISOString().slice(0, 19).replace('T', ' ');
const words = value => String(value).replaceAll('_', ' ');
const idle = { status: 'idle', value: null, error: '' };

export function ConnectGate({ connection, purpose = 'knowledge' }) {
  const [value, setValue] = useState(''), [invalid, setInvalid] = useState('');
  function submit(event) {
    event.preventDefault();
    if (connection.connecting) return;
    if (!TOKEN_PATTERN.test(value)) { setInvalid('Enter the access token issued for your workspace: 32 to 256 letters, digits, dots, underscores, tildes, or hyphens.'); return; }
    setInvalid(''); connection.connect(value);
  }
  const message = invalid || connection.connectError;
  return <section className="panel" id="knowledge-connect"><header className="panel-head"><div><p className="eyebrow">Live mesh / Access</p><h2>{purpose === 'operate' ? 'Connect to your live decision graph.' : purpose === 'agent' ? 'Connect to read yield data.' : 'Connect to see your evidence.'}</h2></div><Badge>DISCONNECTED</Badge></header><div className="panel-body"><p className="detail-copy">{purpose === 'operate' ? 'This workspace reads live reserve evidence and your saved decisions from ' : purpose === 'agent' ? 'This agent reads provider-indexed USDC yield data from ' : 'This view reads your retained graph, analyses and source records from the mesh service at '}<span className="mono">{API_BASE}</span>. Nothing loads until you connect. The token stays in this tab’s memory only. It is not saved, placed in a URL, or sent anywhere except that service.</p>
    <form onSubmit={submit} noValidate><label className="field" style={{ marginTop: 16 }}><span>Access token</span><input id="knowledge-token" type="password" value={value} onChange={event => setValue(event.target.value)} autoComplete="off" spellCheck="false" aria-invalid={message ? 'true' : undefined} aria-describedby="connect-error" disabled={connection.connecting} /></label><p className="field-error" id="connect-error" role="alert">{message}</p><button className="btn primary" id="connect-submit" data-action="connect" type="submit" disabled={connection.connecting} style={{ marginTop: 16 }}>{connection.connecting ? 'Connecting…' : 'Connect'}</button></form></div></section>;
}
function Entity({ node, selected, source, onPath, choose }) {
  const amount = node.properties.amountUnits ?? node.properties.availableLiquidityUnits;
  const reserveBook = node.properties.observationType === 'reserve_liquidity';
  return <button className={`entity-node ${selected === node.id && !source ? 'selected' : ''}`} data-entity={node.id} data-path={onPath ? 'true' : undefined} aria-pressed={selected === node.id && !source} onClick={() => choose(node.id)}><span className="label">{node.kind}</span><strong>{node.label}</strong>{amount && <span className="number">{money(amount)} <span className="small muted">{reserveBook ? 'Book USDC · not withdrawable' : 'USDC'}</span></span>}{onPath && <span className="small green">Analysis path</span>}</button>;
}
function SourceButton({ source, choose }) {
  return <button className="source-button" data-source={source.revisionId} onClick={() => choose(source.revisionId)}><span className="mono">{source.sourceKey} <span className="green">↗</span></span><span className="small">Observed {stamp(source.observedAt)} UTC · Captured {stamp(source.capturedAt)} UTC</span></button>;
}
function Inspector({ graph, selected, sourceId, cache, chooseSource }) {
  const source = graph.sources.find(item => item.revisionId === sourceId);
  if (sourceId) {
    const loaded = cache[sourceId];
    return <><p className="eyebrow">Retained source / Live</p><h2 style={{ marginTop: 8 }}>{source?.sourceKey ?? sourceId}</h2>{source && <Facts data={{ sourceUrl: source.sourceUrl, observedAt: source.observedAt, capturedAt: source.capturedAt, revisionId: source.revisionId, sha256: source.sha256 }} />}
      {(!loaded || loaded.status === 'loading') && <p className="muted" role="status">Loading the exact source content…</p>}
      {loaded?.status === 'error' && <p className="field-error" role="alert" id="source-error">{loaded.error}</p>}
      {loaded?.status === 'ready' && <details className="disclosure" open><summary>Read the exact source content</summary><pre className="source-json">{loaded.value.content}</pre></details>}
      <p className="detail-copy">This is the retained source revision as stored by the mesh service.</p></>;
  }
  const node = graph.nodes.find(item => item.id === selected);
  if (!node) return <p className="muted">Select an entity to inspect its evidence.</p>;
  const edges = graph.edges.filter(edge => edge.source === node.id || edge.target === node.id);
  return <><p className="eyebrow">Selected entity / {node.kind}</p><h2 style={{ marginTop: 8 }}>{node.label}</h2><Facts data={{ 'Entity ID': node.id, ...node.properties }} /><details className="disclosure" open><summary>Connected relationships ({edges.length})</summary><ul className="relation-list">{edges.length ? edges.map(edge => <li key={edge.id}>{edge.source}<br /><span className="green">{words(edge.relation)} →</span><br />{edge.target}</li>) : <li>No relationship is present in this graph snapshot.</li>}</ul></details><p className="label" style={{ marginTop: 24 }}>Supporting source revisions</p>{graph.sources.filter(item => node.sourceRevisionIds.includes(item.revisionId)).map(item => <SourceButton key={item.revisionId} source={item} choose={chooseSource} />)}</>;
}
function Analysis({ state, graph }) {
  if (state.status === 'idle') return <div className="mesh-result" id="analysis-detail"><h2>Analysis result</h2><p>Select a retained analysis from the history to inspect its status, coverage and position results.</p></div>;
  if (state.status === 'loading') return <div className="mesh-result" id="analysis-detail" role="status"><h2>Analysis result</h2><div className="loading-line" aria-hidden="true" /><p>Loading the retained analysis…</p></div>;
  if (state.status === 'error') return <div className="mesh-result" id="analysis-detail"><h2>Analysis result</h2><p className="field-error" role="alert" id="analysis-error">{state.error}</p></div>;
  const { analysis, id, createdAt } = state.value;
  const reserveBook = analysis.policyVersion === 'mesh-reserve-liquidity/1';
  const label = nodeId => graph.nodes.find(item => item.id === nodeId)?.label || nodeId;
  return <div className="mesh-result" id="analysis-detail" data-analysis-id={id}><div className="od-row" style={{ justifyContent: 'space-between' }}><h2>Analysis result</h2><Badge kind={statusKind(analysis.status)}>{analysis.status}</Badge></div><p>{analysis.summary}</p>
    <div className="mini-facts" style={{ margin: '8px 0' }}><div className="od-stat"><span className="label">Connected positions</span><span className="number">{analysis.totalAffectedUnits === null ? 'N/A' : money(analysis.totalAffectedUnits)}</span><span className="small muted">Combined exit, USDC</span></div><div className="od-stat"><span className="label">{reserveBook ? 'Reserve book liquidity' : 'Available liquidity'}</span><span className="number">{analysis.availableLiquidityUnits === null ? 'N/A' : money(analysis.availableLiquidityUnits)}</span><span className="small muted">{reserveBook ? 'Observed, not withdrawable' : analysis.mode === 'live' ? 'Observed USDC' : 'Synthetic USDC'}</span></div></div>
    <p className="small mono muted" id="analysis-coverage">{words(analysis.coverage.status)} · {new Set(analysis.coverage.visitedNodeIds).size} nodes visited · {analysis.coverage.maxHops} hop limit · {analysis.mode} · saved {stamp(createdAt)} UTC</p>
    {analysis.positionResults.length > 0 && <div className="ledger">{analysis.positionResults.map(position => <div className="ledger-row" key={position.positionId} data-position={position.positionId}><span className="small">{label(position.positionId)}</span><span className="ledger-value">{position.amountUnits === null ? 'N/A' : money(position.amountUnits)}</span><Badge kind={statusKind(position.status)}>{position.status}</Badge></div>)}</div>}
    <details className="disclosure"><summary>Inspect the analysis paths</summary>{analysis.positionResults.length ? analysis.positionResults.map(position => <p key={position.positionId} className="small mono muted" style={{ overflowWrap: 'anywhere', margin: '16px 0' }}>{position.reason ? `${words(position.reason)}: ` : ''}{position.pathNodeIds.length ? position.pathNodeIds.join(' → ') : 'No complete path'}</p>) : <p className="detail-copy">No position result was returned. Inspect the coverage state and source relationships.</p>}</details></div>;
}

export default function Knowledge({ api, connection, reduced, navigate, onExport }) {
  const { connected } = connection;
  const [mode, setMode] = useState('synthetic'), [refresh, setRefresh] = useState(0), [query, setQuery] = useState('');
  const [current, setCurrent] = useState(idle), [history, setHistory] = useState({ ...idle, value: [] });
  const [analysisId, setAnalysisId] = useState(null), [record, setRecord] = useState(idle);
  const [selected, setSelected] = useState(null), [sourceId, setSourceId] = useState(null), [cache, setCache] = useState({});
  const [exporting, setExporting] = useState(false), [exportError, setExportError] = useState('');
  const recordSeq = useRef(0), mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  useEffect(() => {
    if (!connected) return;
    let live = true;
    setCurrent({ ...idle, status: 'loading' }); setAnalysisId(null); setRecord(idle); recordSeq.current += 1; setSelected(null); setSourceId(null); setExportError('');
    api(mode === 'live' ? '/v1/graph/live' : '/v1/graph').then(payload => { if (live) setCurrent({ status: 'ready', value: payload.graph, error: '' }); }, failure => { if (live) setCurrent({ ...idle, status: 'error', error: failure.message }); });
    return () => { live = false; };
  }, [connected, mode, refresh]);
  useEffect(() => {
    if (!connected) return;
    let live = true;
    setHistory(previous => ({ ...previous, status: 'loading', error: '' }));
    api('/v1/analyses').then(payload => { if (live) setHistory({ status: 'ready', value: payload.records, error: '' }); }, failure => { if (live) setHistory({ status: 'error', value: [], error: failure.message }); });
    return () => { live = false; };
  }, [connected, refresh]);
  if (!connected) return <ConnectGate connection={connection} />;

  const update = (id, next) => setCache(previous => ({ ...previous, [id]: next }));
  const fetchSource = id => api(`/v1/sources/${id}`).then(payload => { if (mounted.current) update(id, { status: 'ready', value: payload.source, error: '' }); return payload.source; }, failure => { if (mounted.current) update(id, { status: 'error', value: null, error: failure.message }); throw failure; });
  const choose = id => { setSelected(id); setSourceId(null); };
  function chooseSource(id) {
    setSourceId(id); document.getElementById('knowledge-inspector')?.scrollIntoView({ block: 'nearest', behavior: reduced ? 'instant' : 'smooth' });
    if (cache[id]?.status === 'ready' || cache[id]?.status === 'loading') return;
    if (!UUID.test(id)) { update(id, { status: 'error', value: null, error: 'INVALID_SOURCE: The source revision identifier is not valid.' }); return; }
    update(id, { status: 'loading', value: null, error: '' }); fetchSource(id).catch(() => {});
  }
  function chooseAnalysis(id) {
    if (id === analysisId) { setAnalysisId(null); setRecord(idle); recordSeq.current += 1; return; }
    const seq = ++recordSeq.current;
    setAnalysisId(id); setRecord({ ...idle, status: 'loading' }); setSelected(null); setSourceId(null);
    api(`/v1/analyses/${id}`).then(payload => { if (seq === recordSeq.current) setRecord({ status: 'ready', value: payload.record, error: '' }); }, failure => { if (seq === recordSeq.current) setRecord({ ...idle, status: 'error', error: failure.message }); });
  }
  const graph = record.status === 'ready' ? record.value.graph : current.value;
  async function exportRecord() {
    if (!graph || exporting) return;
    setExporting(true); setExportError('');
    try {
      const sources = await Promise.all(graph.sources.map(item => cache[item.revisionId]?.status === 'ready' ? cache[item.revisionId].value : fetchSource(item.revisionId)));
      if (mounted.current) onExport({ mode: graph.mode, graph, analysisId: record.status === 'ready' ? record.value.id : null, analysis: record.status === 'ready' ? record.value.analysis : null, sources });
    } catch (failure) { if (mounted.current) setExportError(failure.message); }
    finally { if (mounted.current) setExporting(false); }
  }
  const onPath = new Set(record.status === 'ready' ? record.value.analysis.positionResults.flatMap(position => position.pathNodeIds) : []);
  const kinds = graph ? [...new Set([...KIND_ORDER, ...graph.nodes.map(item => item.kind)])].filter(kind => graph.nodes.some(item => item.kind === kind)) : [];
  const relations = graph ? [...new Set(graph.edges.map(edge => edge.relation))] : [];
  const labels = new Map((graph?.nodes ?? []).map(item => [item.id, item.label]));
  const directory = (graph?.nodes ?? []).filter(item => `${item.label} ${item.id} ${item.kind}`.toLowerCase().includes(query.toLowerCase()));
  const empty = graph && graph.nodes.length === 0 && graph.edges.length === 0 && graph.sources.length === 0;
  return <><div className="banner"><p><span className="green mono small">LIVE MESH · {mode.toUpperCase()}</span><br />Showing your retained evidence from the mesh service. Analyses are read-only here.</p><div className="od-row" style={{ gap: 8 }}><button className="btn" data-action="disconnect" onClick={connection.disconnect}>Disconnect</button><button className="btn" data-route-button="connections" onClick={() => navigate('connections')}>Connection status</button></div></div>
    <div className="knowledge-toolbar"><label className="field"><span>Graph mode</span><select id="mesh-mode" value={mode} onChange={event => setMode(event.target.value)}><option value="synthetic">Synthetic evidence</option><option value="live">Live captures</option></select></label><button className="btn" data-action="refresh-mesh" id="refresh-mesh" disabled={current.status === 'loading'} onClick={() => setRefresh(value => value + 1)}>Refresh</button><button className="btn primary" data-action="export-mesh" id="export-mesh" disabled={!graph || exporting} onClick={exportRecord}>{exporting ? 'Collecting sources…' : 'Export record ↓'}</button></div>
    <div id="analysis-progress" role="status">{(current.status === 'loading' || exporting) && <><div className="loading-line" aria-hidden="true" /><p className="sr-only">{exporting ? 'Collecting retained sources.' : 'Loading the graph.'}</p></>}</div>
    {(current.error || exportError) && <div className="banner error" id="knowledge-error" role="alert"><p>{current.error || exportError}</p><button className="btn" data-action="retry-mesh" onClick={() => setRefresh(value => value + 1)}>Try again</button></div>}
    {history.status === 'error' && <div className="banner error" id="history-error" role="alert"><p>{history.error}</p></div>}
    <div className="workspace-grid"><div className="od-stack" style={{ '--od-gap': '24px', display: 'flex' }}>
      <section className="panel"><header className="panel-head"><div><p className="eyebrow">Evidence graph / {graph?.mode ?? mode}{record.status === 'ready' ? ' / analysis snapshot' : ''}</p><h2>What the mesh knows.</h2></div>{graph && <Badge kind={graph.coverage.status === 'complete' ? 'ok' : 'warn'}>{graph.coverage.status}</Badge>}</header>
        {!graph ? <div className="panel-body"><p className="muted" id="graph-status" role="status">{current.status === 'loading' ? 'Loading the graph…' : 'The graph is unavailable.'}</p></div>
          : empty ? <div className="panel-body" id="knowledge-empty"><h3>No evidence yet.</h3><p className="detail-copy">This workspace has no retained {graph.mode} evidence. Capture sources in the <a href="/mesh/">knowledge mesh</a>, then refresh.</p></div>
          : <><div className="panel-body" id="graph-nodes">{kinds.map(kind => <div className="kind-group" data-kind={kind} key={kind}><p className="label">{kind} ({graph.nodes.filter(item => item.kind === kind).length})</p><div className="kind-group-nodes">{graph.nodes.filter(item => item.kind === kind).map(item => <Entity key={item.id} node={item} selected={selected} source={sourceId} onPath={onPath.has(item.id)} choose={choose} />)}</div></div>)}</div>
            <div className="panel-body" id="graph-edges"><details className="disclosure" open><summary>Relationships ({graph.edges.length})</summary>{relations.map(relation => <div key={relation} data-relation={relation}><p className="label" style={{ marginTop: 16 }}>{words(relation)} ({graph.edges.filter(edge => edge.relation === relation).length})</p><ul className="relation-list">{graph.edges.filter(edge => edge.relation === relation).map(edge => <li key={edge.id} data-edge={edge.id}>{labels.get(edge.source) ?? edge.source} → {labels.get(edge.target) ?? edge.target}</li>)}</ul></div>)}{graph.edges.length === 0 && <p className="detail-copy">No relationship is present in this graph snapshot.</p>}</details></div>
            {graph.issues.length > 0 && <div className="panel-foot" id="graph-issues"><ul className="relation-list">{graph.issues.map(issue => <li key={issue}>{issue}</li>)}</ul></div>}
            <div className="panel-foot"><p id="graph-coverage">Snapshot {graph.revision} · as of {stamp(graph.asOf)} UTC · {graph.nodes.length}/{graph.coverage.nodeLimit} nodes · {graph.edges.length}/{graph.coverage.edgeLimit} relationships · {graph.sources.length}/{graph.coverage.sourceLimit} sources{graph.coverage.status === 'truncated' ? ' · Truncated: some evidence is not shown.' : ''}</p></div></>}
        <Analysis state={record} graph={graph ?? { nodes: [] }} /></section>
      <section className="panel"><header className="panel-head"><div><p className="eyebrow">Source history</p><h2>Original evidence, retained.</h2></div><span className="label">{graph?.sources.length ?? 0} sources</span></header><div className="panel-body" id="source-list">{graph?.sources.map(item => <SourceButton key={item.revisionId} source={item} choose={chooseSource} />)}{graph && graph.sources.length === 0 && <p className="detail-copy">No source revision is retained for this graph.</p>}</div></section></div>
      <div className="od-stack" style={{ '--od-gap': '24px' }}><section className="panel inspector-panel"><div className="panel-body" id="knowledge-inspector">{graph ? <Inspector graph={graph} selected={selected} sourceId={sourceId} cache={cache} chooseSource={chooseSource} /> : <p className="muted">Select an entity to inspect its evidence.</p>}</div></section>
        <section className="panel"><header className="panel-head"><div><p className="eyebrow">Analysis history</p><h2>Retained analyses.</h2></div><span className="label">{history.value.length} shown</span></header><div className="panel-body" id="analysis-history">{history.status === 'loading' && history.value.length === 0 && <p className="muted" role="status">Loading analyses…</p>}{history.value.map(item => <button className="source-button" key={item.id} data-analysis={item.id} aria-pressed={item.id === analysisId} onClick={() => chooseAnalysis(item.id)}><span className="mono">{stamp(item.createdAt)} UTC <Badge kind={statusKind(item.analysis.status)}>{item.analysis.status}</Badge></span><span className="small">{item.analysis.summary}</span></button>)}{history.status === 'ready' && history.value.length === 0 && <p className="detail-copy" id="analysis-empty">No analysis has been saved for this workspace.</p>}</div></section>
        <section className="panel"><header className="panel-head"><div><p className="eyebrow">Graph directory</p><h2>Find an entity.</h2></div><span className="label">{graph?.nodes.length ?? 0} nodes</span></header><div className="panel-body"><label className="field"><span className="sr-only">Search graph entities</span><input id="entity-search" type="search" value={query} onChange={event => setQuery(event.target.value)} placeholder="Name, type, or ID" autoComplete="off" /></label><div id="entity-directory" className="directory-list">{directory.length ? directory.map(item => <Entity key={item.id} node={item} selected={selected} source={sourceId} onPath={onPath.has(item.id)} choose={choose} />) : <p className="muted">{graph?.nodes.length ? 'No matching entities. Try a name, type, or ID.' : 'No entities to search.'}</p>}</div></div></section></div></div></>;
}
