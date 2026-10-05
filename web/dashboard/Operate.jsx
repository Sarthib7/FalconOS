import React, { useEffect, useRef, useState } from 'react';
import { connectorObservation } from './api.mjs';
import { Badge, money } from './ui.jsx';
import { ConnectGate } from './Knowledge.jsx';

const OBSERVATION_ID = 'observation:live:solana-devnet-reserve-liquidity';
const STATUSES = ['REVIEW', 'BLOCKED', 'NO_DATA'], CHECK_STATUSES = ['PASS', 'BLOCKED', 'NO_DATA', 'SKIPPED'];
const ORIGINS = { OBSERVED: ['Observed', 'ok', 'Read from a retained live capture.'], OWNER_ENTERED: ['Owner entered', 'info', 'Typed by you. Not read from a wallet and not verified onchain.'], RULE: ['Rule', '', 'A fixed policy rule applied by the service.'], DERIVED: ['Derived', 'warn', 'Computed by the service from the nodes it depends on.'] };
const STATUS_KIND = { REVIEW: 'info', BLOCKED: 'bad', NO_DATA: 'warn', PASS: 'ok', SKIPPED: '' };
const MAX_U64 = 18446744073709551615n, U64 = /^(0|[1-9]\d{0,19})$/;
const FIELDS = [
  { key: 'proposedUnits', id: 'op-proposed', label: 'Proposed position (USDC)', hint: 'What you are considering. Above zero.', min: 1n },
  { key: 'maxProposedUnits', id: 'op-max', label: 'Your maximum position (USDC)', hint: 'Your own ceiling. Above zero.', min: 1n },
  { key: 'minBookLiquidityUnits', id: 'op-floor', label: 'Minimum book liquidity you require (USDC)', hint: 'Zero is allowed.', min: 0n },
  { key: 'maxObservationAgeSeconds', id: 'op-age', label: 'Oldest acceptable evidence (seconds)', hint: 'Whole seconds, 1 to 300.', age: true },
];
const isObject = value => Boolean(value) && typeof value === 'object' && !Array.isArray(value);
const stamp = value => Number.isNaN(Date.parse(value)) ? String(value) : new Date(value).toISOString().slice(0, 19).replace('T', ' ') + ' UTC';
const words = value => String(value).replaceAll('_', ' ');
const kindOf = status => STATUS_KIND[status] ?? '';

// Client-side conversion for the request only; the service validates and decides.
function parseField(field, raw) {
  const value = raw.trim();
  if (field.age) return /^[1-9]\d{0,2}$/.test(value) && Number(value) <= 300 ? { value: Number(value) } : { error: 'Enter whole seconds from 1 to 300.' };
  const match = value.length <= 30 && /^(0|[1-9]\d*)(?:\.(\d{1,6}))?$/.exec(value);
  if (!match) return { error: 'Enter a USDC amount with up to six decimals, for example 250.5.' };
  const units = BigInt(match[1]) * 1000000n + BigInt((match[2] ?? '').padEnd(6, '0'));
  if (units > MAX_U64) return { error: 'This amount exceeds the supported token limit.' };
  if (units < field.min) return { error: 'Enter an amount above zero.' };
  return { value: units.toString() };
}
const validGraph = graph => isObject(graph) && graph.schemaVersion === 2 && graph.mode === 'live' && typeof graph.revision === 'string' && [graph.nodes, graph.edges, graph.sources].every(Array.isArray)
  && graph.nodes.every(node => isObject(node) && typeof node.id === 'string') && graph.sources.every(source => isObject(source) && ['revisionId', 'sourceKey', 'observedAt', 'capturedAt', 'sha256'].every(key => typeof source[key] === 'string'));
function validScenario(scenario) {
  return isObject(scenario) && scenario.provenance === 'OWNER_ENTERED'
    && ['proposedUnits', 'maxProposedUnits', 'minBookLiquidityUnits'].every(key => typeof scenario[key] === 'string' && U64.test(scenario[key]))
    && Number.isInteger(scenario.maxObservationAgeSeconds) && scenario.maxObservationAgeSeconds >= 1 && scenario.maxObservationAgeSeconds <= 300;
}
// Fail closed: returns a reason when a record is not a live reserve-scenario decision consistent with its own snapshot.
function verifyRecord(record, expect = {}) {
  const need = (ok, why) => { if (!ok) throw why; };
  try {
    need(isObject(record) && typeof record.id === 'string' && record.id && typeof record.requestId === 'string' && !Number.isNaN(Date.parse(record.createdAt)), 'the record identity is invalid');
    need(!expect.id || record.id === expect.id, 'it is not the record that was requested');
    need(!expect.requestId || record.requestId === expect.requestId, 'it does not answer this request');
    const { graph, analysis } = record;
    need(validGraph(graph), 'its graph snapshot is not a live graph');
    need(isObject(analysis) && analysis.schemaVersion === 1 && analysis.kind === 'reserve_scenario_decision' && analysis.mode === 'live' && analysis.policyVersion === 'mesh-reserve-scenario/1' && analysis.observationId === OBSERVATION_ID, 'it is not a reserve scenario decision');
    need(STATUSES.includes(analysis.status) && typeof analysis.summary === 'string', 'its status is not recognised');
    need(analysis.graphRevision === graph.revision, 'its analysis does not belong to its snapshot');
    need(validScenario(analysis.scenario), 'its scenario is not owner-entered');
    if (expect.scenario) need(Object.keys(expect.scenario).every(key => analysis.scenario[key] === expect.scenario[key]), 'its scenario differs from what you entered');
    const revisions = new Set(graph.sources.map(source => source?.revisionId));
    need(Array.isArray(analysis.sourceRevisionIds) && analysis.sourceRevisionIds.every(id => revisions.has(id)), 'it cites a source revision missing from its snapshot');
    need(analysis.availableLiquidityUnits === null || typeof analysis.availableLiquidityUnits === 'string' && U64.test(analysis.availableLiquidityUnits), 'its book liquidity is invalid');
    need(analysis.executionReady === false && analysis.totalAffectedUnits === null && Array.isArray(analysis.positionResults) && analysis.positionResults.length === 0, 'it claims execution or holdings');
    const dg = analysis.decisionGraph;
    need(isObject(dg) && dg.schemaVersion === 1 && Array.isArray(dg.nodes) && Array.isArray(dg.edges) && dg.nodes.length > 0, 'its decision graph is missing');
    const ids = new Set(dg.nodes.map(node => node?.id));
    need(ids.size === dg.nodes.length && dg.nodes.every(node => isObject(node) && typeof node.id === 'string' && typeof node.kind === 'string' && typeof node.label === 'string' && typeof node.detail === 'string' && Object.hasOwn(ORIGINS, node.origin)), 'a decision graph node is invalid');
    need(new Set(dg.edges.map(edge => edge?.id)).size === dg.edges.length && dg.edges.every(edge => isObject(edge) && typeof edge.id === 'string' && typeof edge.relation === 'string' && ids.has(edge.source) && ids.has(edge.target)), 'a decision graph relationship is invalid');
    const known = new Set([...ids, ...graph.nodes.map(node => node?.id)]);
    need(Array.isArray(analysis.checks) && analysis.checks.every(check => isObject(check) && typeof check.id === 'string' && typeof check.label === 'string' && typeof check.detail === 'string' && CHECK_STATUSES.includes(check.status) && Array.isArray(check.evidenceNodeIds) && check.evidenceNodeIds.every(id => known.has(id))), 'a check is invalid');
    need(Array.isArray(analysis.limits) && analysis.limits.every(item => typeof item === 'string'), 'its limits are invalid');
    return '';
  } catch (why) {
    if (typeof why !== 'string') throw why;
    return `The service returned a decision that failed verification (${why}). It was not shown.`;
  }
}
function verifySummary(item) {
  return isObject(item) && typeof item.id === 'string' && !Number.isNaN(Date.parse(item.createdAt)) && isObject(item.analysis) && item.analysis.kind === 'reserve_scenario_decision'
    && item.analysis.mode === 'live' && item.analysis.policyVersion === 'mesh-reserve-scenario/1' && STATUSES.includes(item.analysis.status) && validScenario(item.analysis.scenario);
}
// The observation node, its retained sources and its amount, from a live graph or a decision snapshot.
function reserveOf(graph) {
  const node = graph.nodes.find(item => item?.id === OBSERVATION_ID && item.kind === 'observation');
  const cited = new Set(node?.sourceRevisionIds ?? []);
  const sources = graph.sources.filter(source => cited.has(source.revisionId));
  const props = node?.properties ?? {};
  const amount = props.status === 'ok' && typeof props.availableLiquidityUnits === 'string' && U64.test(props.availableLiquidityUnits) ? props.availableLiquidityUnits : null;
  return { node, sources, props, amount, observation: connectorObservation(graph, OBSERVATION_ID.replace('observation:live:', '')) };
}
function levels(nodes, edges) {
  const depth = new Map(nodes.map(node => [node.id, 0]));
  for (let pass = 0; pass < nodes.length; pass += 1) {
    let changed = false;
    for (const edge of edges) if (depth.get(edge.source) + 1 > depth.get(edge.target) && depth.get(edge.source) + 1 < nodes.length) { depth.set(edge.target, depth.get(edge.source) + 1); changed = true; }
    if (!changed) break;
  }
  const columns = [];
  for (const node of nodes) (columns[depth.get(node.id)] ??= []).push(node);
  return columns.filter(Boolean);
}
const Fact = ({ name, children, mono = true }) => <div><dt>{name}</dt><dd className={mono ? undefined : 'op-plain'}>{children}</dd></div>;
const Origin = ({ origin }) => <Badge kind={ORIGINS[origin][1]}>{ORIGINS[origin][0]}</Badge>;

function Snapshot({ graph, heading, note }) {
  const { node, sources, props, amount, observation } = reserveOf(graph);
  return <div className="op-snapshot"><div className="od-row" style={{ justifyContent: 'space-between', flexWrap: 'wrap' }}><h3>{heading}</h3><Badge kind={observation.kind}>{node ? observation.label : 'NO_DATA'}</Badge></div>
    {note && <p className="small muted">{note}</p>}
    {!node ? <p className="detail-copy">No reserve liquidity capture is retained in this graph. Nothing can be observed from it.</p> : <dl className="facts">
      <Fact name="Devnet slot">{props.slot ?? 'None'}</Fact>
      <Fact name="Unborrowed book liquidity">{amount === null ? `None${props.reasonCode ? ` (${words(props.reasonCode)})` : ''}` : `${money(amount)} USDC`}</Fact>
      <Fact name="Graph revision">{graph.revision}</Fact>
      <Fact name="Graph as of">{stamp(graph.asOf)}</Fact>
      {props.reserveDataSha256 && <Fact name="Reserve data hash">{props.reserveDataSha256}</Fact>}
      {props.vaultDataSha256 && <Fact name="Vault data hash">{props.vaultDataSha256}</Fact>}
      {sources.map(source => <Fact name={`Source ${source.sourceKey}`} key={source.revisionId}>{`observed ${stamp(source.observedAt)}\ncaptured ${stamp(source.capturedAt)}\nrevision ${source.revisionId}\nsha256 ${source.sha256}`}</Fact>)}
    </dl>}
    <p className="small muted">Book liquidity is what the reserve vault holds unborrowed. It is not withdrawable by you and not an execution approval.</p></div>;
}

function DecisionGraph({ graph, checks, selected, choose }) {
  const nodes = graph.nodes, byId = new Map(nodes.map(node => [node.id, node]));
  const out = id => graph.edges.filter(edge => edge.source === id), into = id => graph.edges.filter(edge => edge.target === id);
  const active = byId.get(selected);
  const linked = new Set(active ? graph.edges.filter(edge => edge.source === selected || edge.target === selected).flatMap(edge => [edge.source, edge.target]) : []);
  return <div className="op-graph"><div className="op-flow" role="group" aria-label="Decision graph. Relationships read from left to right, from source to target.">
    {levels(nodes, graph.edges).map((column, index) => <div className="op-column" key={index}>{column.map(node => <button key={node.id} type="button" className="op-node" data-node={node.id} data-origin={node.origin} data-linked={linked.has(node.id) && node.id !== selected ? 'true' : undefined} aria-pressed={selected === node.id} onClick={() => choose(selected === node.id ? null : node.id)}>
      <span className="label">{node.kind}</span><strong>{node.label}</strong><Origin origin={node.origin} />
      {into(node.id).map(edge => <span className="op-edge small" key={edge.id}><span aria-hidden="true">←</span> {words(edge.relation)} <span className="muted">{byId.get(edge.source).label}</span></span>)}
      {out(node.id).map(edge => <span className="op-edge small" key={edge.id}><span aria-hidden="true">→</span> {words(edge.relation)} <span className="muted">{byId.get(edge.target).label}</span></span>)}
    </button>)}</div>)}</div>
    <div className="op-detail" aria-live="polite">{active ? <><p className="eyebrow">Selected node / {active.kind}</p><h3>{active.label}</h3><Origin origin={active.origin} /><p className="detail-copy">{ORIGINS[active.origin][2]}</p><p className="detail-copy">{active.detail}</p><dl className="facts"><Fact name="Node ID">{active.id}</Fact>{checks.filter(check => check.evidenceNodeIds.includes(active.id)).map(check => <Fact name="Cited by check" key={check.id}>{`${check.label}: ${words(check.status)}`}</Fact>)}</dl></> : <p className="muted">Select a node to read its origin and detail. Every node states whether it was observed, entered by you, a rule, or derived.</p>}</div>
    <details className="disclosure"><summary>All relationships ({graph.edges.length})</summary>{graph.edges.length ? <ul className="relation-list">{graph.edges.map(edge => <li key={edge.id}>{byId.get(edge.source).label} <span className="green">{words(edge.relation)} →</span> {byId.get(edge.target).label}<br /><span className="small">{edge.id}</span></li>)}</ul> : <p className="detail-copy">This decision graph has no relationships.</p>}</details></div>;
}

function Result({ view, live, focusRef, selected, choose }) {
  if (view.status === 'idle') return <section className="panel" id="operate-result"><header className="panel-head"><div><p className="eyebrow">Decision record</p><h2>No decision selected.</h2></div><Badge>EMPTY</Badge></header><div className="panel-body"><p className="detail-copy">Record a scenario above, or select a saved decision from the history.</p></div></section>;
  if (view.status === 'loading') return <section className="panel" id="operate-result" role="status"><header className="panel-head"><div><p className="eyebrow">Decision record</p><h2>Loading the saved decision…</h2></div><Badge>LOADING</Badge></header><div className="panel-body"><div className="loading-line" aria-hidden="true" /></div></section>;
  if (view.status === 'error') return <section className="panel" id="operate-result"><header className="panel-head"><div><p className="eyebrow">Decision record</p><h2 ref={focusRef} tabIndex="-1">The decision could not be shown.</h2></div><Badge kind="warn">ERROR</Badge></header><div className="panel-body"><p className="field-error" role="alert" id="operate-result-error">{view.error}</p></div></section>;
  const { record } = view, { analysis, graph } = record, scenario = analysis.scenario;
  const same = live.status === 'ready' && live.value.revision === graph.revision;
  return <section className="panel" id="operate-result" data-decision-id={record.id}>
    <header className="panel-head"><div><p className="eyebrow">{view.fresh ? 'Saved decision / original evidence' : 'Historical snapshot'} / {analysis.policyVersion}</p><h2 ref={focusRef} tabIndex="-1">{analysis.status === 'REVIEW' ? 'Ready for your review.' : analysis.status === 'BLOCKED' ? 'Blocked by your own limits.' : 'Not enough current evidence.'}</h2></div><Badge kind={kindOf(analysis.status)}>{analysis.status}</Badge></header>
    <div className="panel-body"><p>{analysis.summary}</p>
      <p className="op-provenance small" id="operate-currency">This decision uses the evidence saved at {stamp(record.createdAt)}. {live.status !== 'ready' ? 'The latest graph has not loaded for comparison.' : same ? 'The loaded graph has the same revision. This decision remains historical.' : 'The loaded graph has changed. Evaluate a new scenario for current evidence.'}</p>
      <p className="label" style={{ marginTop: 24 }}>Decision graph</p><DecisionGraph graph={analysis.decisionGraph} checks={analysis.checks} selected={selected} choose={choose} />
      <div className="op-columns"><div><p className="label">Your scenario · owner entered</p><dl className="facts">
        <Fact name="Proposed position">{money(scenario.proposedUnits)} USDC</Fact><Fact name="Your maximum">{money(scenario.maxProposedUnits)} USDC</Fact><Fact name="Book liquidity floor">{money(scenario.minBookLiquidityUnits)} USDC</Fact><Fact name="Oldest acceptable evidence">{scenario.maxObservationAgeSeconds} s</Fact>
        <Fact name="Observed book liquidity">{analysis.availableLiquidityUnits === null ? 'None' : `${money(analysis.availableLiquidityUnits)} USDC`}</Fact><Fact name="Evaluated at">{stamp(analysis.at)}</Fact><Fact name="Review window ends">{analysis.expiresAt ? stamp(analysis.expiresAt) : 'None'}</Fact><Fact name="Decision ID">{record.id}</Fact><Fact name="Request ID">{record.requestId}</Fact></dl></div>
        <Snapshot graph={graph} heading="Evidence in this snapshot" /></div>
      <p className="label" style={{ marginTop: 24 }}>Checks</p><ul className="op-checks" id="operate-checks">{analysis.checks.length ? analysis.checks.map(check => <li key={check.id}><div className="od-row" style={{ justifyContent: 'space-between', alignItems: 'flex-start' }}><strong>{check.label}</strong><Badge kind={kindOf(check.status)}>{check.status}</Badge></div><p className="small muted">{check.detail}</p>{check.evidenceNodeIds.length > 0 && <p className="small">Evidence: {check.evidenceNodeIds.map(id => analysis.decisionGraph.nodes.some(node => node.id === id) ? <button type="button" className="op-link mono" key={id} onClick={() => choose(id)}>{id}</button> : <span className="mono" key={id}>{id} </span>)}</p>}</li>) : <li className="muted">This decision has no checks.</li>}</ul>
      {analysis.limits.length > 0 && <details className="disclosure" open><summary>What this decision does not do</summary><ul className="op-limits">{analysis.limits.map(item => <li key={item}>{item}</li>)}</ul></details>}
      <p className="small muted" style={{ marginTop: 16 }}>Not execution-ready. No wallet was read or asked to sign, and no transaction can be created from this record.</p></div></section>;
}

export default function Operate({ api, connection }) {
  const connected = Boolean(connection?.connected), apiRef = useRef(api);
  apiRef.current = api;
  const [live, setLive] = useState({ status: 'idle', value: null, error: '' }), [history, setHistory] = useState({ status: 'idle', value: [], error: '' }), [refresh, setRefresh] = useState(0);
  const [values, setValues] = useState({ proposedUnits: '', maxProposedUnits: '', minBookLiquidityUnits: '', maxObservationAgeSeconds: '' }), [errors, setErrors] = useState({});
  const [send, setSend] = useState({ status: 'idle', error: '' }), [view, setView] = useState({ status: 'idle' }), [selected, setSelected] = useState(null);
  const [capture, setCapture] = useState({ status: 'idle', message: '' });
  const pending = useRef(null), viewSeq = useRef(0), resultFocus = useRef(null), mounted = useRef(true), sending = useRef(false), firstHistory = useRef(true), capturing = useRef(false), captureGeneration = useRef(0);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  useEffect(() => {
    if (!connected) { setLive({ status: 'idle', value: null, error: '' }); setHistory({ status: 'idle', value: [], error: '' }); setView({ status: 'idle' }); setSelected(null); setSend({ status: 'idle', error: '' }); setCapture({ status: 'idle', message: '' }); pending.current = null; firstHistory.current = true; captureGeneration.current += 1; viewSeq.current += 1; return undefined; }
    let current = true;
    setLive(previous => ({ ...previous, status: 'loading', error: '' })); setHistory(previous => ({ ...previous, status: 'loading', error: '' }));
    apiRef.current('/v1/graph/live').then(payload => {
      if (!validGraph(payload?.graph)) throw new Error('The service returned a graph that is not a live graph.');
      if (current) setLive({ status: 'ready', value: payload.graph, error: '' });
    }).catch(failure => { if (current) setLive({ status: 'error', value: null, error: failure.message }); });
    apiRef.current('/v1/decisions').then(payload => {
      if (!Array.isArray(payload?.records) || !payload.records.every(verifySummary)) throw new Error('The service returned a decision history that failed verification. It was not shown.');
      if (current) {
        setHistory({ status: 'ready', value: payload.records, error: '' });
        if (firstHistory.current) { firstHistory.current = false; if (payload.records.length) open(payload.records[0].id); }
      }
    }).catch(failure => { if (current) setHistory({ status: 'error', value: [], error: failure.message }); });
    return () => { current = false; };
  }, [connected, refresh]);
  useEffect(() => { if (view.status !== 'idle' && view.status !== 'loading') resultFocus.current?.focus(); }, [view.status === 'ready' ? view.record.id : view.status]);

  if (!connected) return <ConnectGate connection={connection} purpose="operate" />;

  const setField = (key, value) => { setValues(previous => ({ ...previous, [key]: value })); setErrors(previous => ({ ...previous, [key]: '' })); };
  async function submit(event) {
    event.preventDefault();
    if (sending.current) return;
    const parsed = FIELDS.map(field => [field, parseField(field, values[field.key])]), next = Object.fromEntries(parsed.map(([field, result]) => [field.key, result.error ?? '']));
    setErrors(next);
    const bad = parsed.find(([, result]) => result.error);
    if (bad) { document.getElementById(bad[0].id)?.focus(); return; }
    const scenario = Object.fromEntries(parsed.map(([field, result]) => [field.key, result.value])), key = JSON.stringify(scenario);
    if (pending.current?.key !== key) pending.current = { key, id: crypto.randomUUID() };
    const requestId = pending.current.id;
    sending.current = true; setSend({ status: 'sending', error: '' });
    try {
      const payload = await apiRef.current('/v1/decisions/reserve', { requestId, scenario });
      const problem = verifyRecord(payload?.record, { requestId, scenario });
      if (!mounted.current) return;
      if (problem) { setSend({ status: 'error', error: problem }); return; }
      pending.current = null; viewSeq.current += 1;
      setSend({ status: 'idle', error: '' }); setSelected(null); setView({ status: 'ready', record: payload.record, fresh: true }); setRefresh(value => value + 1);
    } catch (failure) { if (mounted.current) setSend({ status: 'error', error: `${failure.message} Submitting the same values again retries this request.` }); }
    finally { sending.current = false; }
  }
  async function captureReserve() {
    if (capturing.current || live.status !== 'ready') return;
    const previous = live.value.sources.find(source => source.sourceKey === 'live:solana-devnet-reserve-liquidity')?.revisionId ?? null;
    const requestId = crypto.randomUUID(), generation = captureGeneration.current;
    capturing.current = true; setCapture({ status: 'loading', message: 'Reading the pinned Devnet reserve and USDC vault.' });
    try {
      const payload = await apiRef.current('/v1/captures', { requestId, connectorId: 'solana-devnet-reserve-liquidity', expectedRevisionId: previous });
      if (!mounted.current || generation !== captureGeneration.current) return;
      if (payload?.source?.revisionId !== requestId || payload.source.sourceKey !== 'live:solana-devnet-reserve-liquidity') throw new Error('The retained source does not match this capture. Refresh the graph before continuing.');
      setCapture({ status: 'saved', message: 'Reserve capture saved. Review its status before you evaluate a new scenario. Older decisions remain historical.' });
      setRefresh(value => value + 1);
    } catch (failure) {
      if (mounted.current && generation === captureGeneration.current) setCapture({ status: 'error', message: failure.message + ' Refresh the graph before trying again.' });
    } finally { capturing.current = false; }
  }

  function open(id) {
    const seq = viewSeq.current += 1;
    setSelected(null); setView({ status: 'loading' });
    apiRef.current(`/v1/decisions/${encodeURIComponent(id)}`).then(payload => {
      const problem = verifyRecord(payload?.record, { id });
      if (mounted.current && seq === viewSeq.current) setView(problem ? { status: 'error', error: problem } : { status: 'ready', record: payload.record, fresh: false });
    }, failure => { if (mounted.current && seq === viewSeq.current) setView({ status: 'error', error: failure.message }); });
  }
  const shown = view.status === 'ready' ? view.record.id : null, sendingNow = send.status === 'sending';

  return <>
    <div className="banner"><p><span className="green mono small">OPERATE · LIVE DEVNET RESERVE</span><br />Your proposed position and limits are entered by you. The service compares them with retained reserve evidence and saves a review-only decision. Nothing is executed and no wallet is used.</p><div className="od-row" style={{ gap: 8, flexWrap: 'wrap' }}><button className="btn" type="button" id="operate-refresh" disabled={live.status === 'loading' || history.status === 'loading'} onClick={() => setRefresh(value => value + 1)}>Refresh</button><button className="btn" type="button" data-action="disconnect" onClick={connection.disconnect}>Disconnect</button></div></div>
    <div className="op-grid">
      <section className="panel" id="operate-evidence" aria-busy={live.status === 'loading'}><header className="panel-head"><div><p className="eyebrow">Retained evidence</p><h2>Devnet USDC reserve.</h2></div><Badge kind={live.status === 'error' ? 'warn' : ''}>{live.status === 'ready' ? 'LOADED' : live.status === 'error' ? 'ERROR' : 'LOADING'}</Badge></header><div className="panel-body">
        {live.status === 'loading' && <div role="status"><div className="loading-line" aria-hidden="true" /><p className="sr-only">Loading current reserve evidence.</p></div>}
        {live.status === 'error' && <p className="field-error" role="alert" id="operate-live-error">{live.error}</p>}
        {live.status === 'ready' && <Snapshot graph={live.value} heading="Latest retained capture" note="This page reads the saved source. Capture starts only when you choose the button below." />}
        <div className="od-row" style={{ gap: 8, flexWrap: 'wrap', marginTop: 16 }}><button className="btn" type="button" id="operate-capture" disabled={live.status !== 'ready' || capture.status === 'loading'} onClick={() => void captureReserve()}>{capture.status === 'loading' ? 'Reading Devnet…' : 'Capture Devnet reserve now'}</button><span className="small muted">Reads two fixed public accounts and saves one local source revision. No wallet action.</span></div>
        {capture.status !== 'idle' && <p id="operate-capture-status" className={capture.status === 'error' ? 'field-error' : 'small muted'} role={capture.status === 'error' ? 'alert' : 'status'} style={{ marginTop: 12 }}>{capture.message}</p>}
        <p className="small muted" style={{ marginTop: 12 }}>For full raw source exchanges or the separate program evidence path, open the <a href="/mesh/">knowledge mesh</a>.</p></div></section>
      <section className="panel" id="operate-scenario"><header className="panel-head"><div><p className="eyebrow">Your scenario</p><h2>State your limits.</h2></div><Badge kind="info">OWNER ENTERED</Badge></header>
        <form className="panel-body op-form" onSubmit={submit} noValidate aria-describedby="operate-form-note"><p className="detail-copy" id="operate-form-note" style={{ marginTop: 0 }}>Every value is required and comes from you. There are no defaults, and none is read from a wallet or the chain. The service checks them and decides.</p>
          {FIELDS.map(field => <label className="field" key={field.key}><span>{field.label} <span className="muted small">· owner entered</span></span><input id={field.id} name={field.key} inputMode={field.age ? 'numeric' : 'decimal'} autoComplete="off" spellCheck="false" required aria-required="true" value={values[field.key]} disabled={sendingNow} aria-invalid={errors[field.key] ? 'true' : undefined} aria-describedby={`${field.id}-hint ${field.id}-error`} onChange={event => setField(field.key, event.target.value)} /><small id={`${field.id}-hint`}>{field.hint}</small><span className="field-error" id={`${field.id}-error`} role="alert">{errors[field.key]}</span></label>)}
          {send.status === 'error' && <div className="banner error" id="operate-submit-error" role="alert"><p>{send.error}</p></div>}
          <button className="btn primary" type="submit" id="operate-submit" disabled={sendingNow}>{sendingNow ? 'Saving decision…' : send.status === 'error' ? 'Retry decision' : 'Save review decision'}</button>
          <div role="status" className="sr-only">{sendingNow ? 'Saving the decision.' : ''}</div></form></section>
    </div>
    <div id="operate-result-slot" style={{ marginTop: 24 }}><Result view={view} live={live} focusRef={resultFocus} selected={selected} choose={setSelected} /></div>
    <section className="panel" id="operate-history" style={{ marginTop: 24 }} aria-busy={history.status === 'loading'}><header className="panel-head"><div><p className="eyebrow">Saved decisions</p><h2>History.</h2></div><Badge>{history.status === 'ready' ? `${history.value.length} SAVED` : history.status === 'error' ? 'ERROR' : 'LOADING'}</Badge></header>
      {history.status === 'loading' && history.value.length === 0 && <div className="panel-body" role="status"><div className="loading-line" aria-hidden="true" /><p className="sr-only">Loading saved decisions.</p></div>}
      {history.status === 'error' && <div className="panel-body"><p className="field-error" role="alert" id="operate-history-error">{history.error}</p></div>}
      {history.status === 'ready' && history.value.length === 0 && <div className="panel-body" id="operate-history-empty"><p className="detail-copy" style={{ marginTop: 0 }}>No decision has been saved yet. Each one keeps the exact evidence snapshot it was decided on.</p></div>}
      {history.value.map(item => <button type="button" key={item.id} className="history-item op-history" data-decision-id={item.id} aria-pressed={shown === item.id} onClick={() => open(item.id)}><Badge kind={kindOf(item.analysis.status)}>{item.analysis.status}</Badge><span><span className="history-title">Propose {money(item.analysis.scenario.proposedUnits)} USDC · max {money(item.analysis.scenario.maxProposedUnits)}</span><span className="history-time">{stamp(item.createdAt)}</span></span><span className="mono small green">{shown === item.id ? 'Open' : 'Inspect'}</span></button>)}
    </section></>;
}
