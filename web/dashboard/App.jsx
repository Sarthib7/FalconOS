import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import DATA from './data.json';
import { buildGraph, decide, formatUsdc, replayRun } from '../treasury/domain.mjs';
import { createStore, STORE_KEY } from './store.mjs';
import Overview from './Overview.jsx';
import Decisions from './Decisions.jsx';
import Knowledge from './Knowledge.jsx';
import Connections from './Connections.jsx';
import { ExportDialog, MandateDialog, RevokeDialog, SetupDialog } from './Dialogs.jsx';
import { Mark, MotionPaused } from './ui.jsx';
import fontLicense from '../landing/assets/FONT-LICENSE.txt?url';

const PAGE = { overview: ['01 / Your treasury, in view', 'Control Centre', 'Your capital. Your rules. Every move in view.'], decisions: ['02 / Follow the decision', 'Decision desk', 'See the evidence, the rule, and what actually changed.'], knowledge: ['03 / Follow the evidence', 'Knowledge mesh', 'Inspect the relationships behind a liquidity decision.'], connections: ['04 / Know what is connected', 'Connections', 'A clear boundary between this preview and live services.'] };
const SAMPLE_NAMES = { supply: 'Supply', hold: 'Hold', redeem: 'Redeem', blocked: 'Blocked exit', stale: 'Stale evidence' };
const legacyHref = '/design-reference/falconos-advisory-workspace.html';
const timeAt = state => new Date(Math.max(Date.now(), Date.parse(state.at))).toISOString();
function RouteIcon({ route }) {
  return <svg className="icon" viewBox="0 0 24 24" aria-hidden="true">{route === 'overview' ? <path d="M3 3h7v7H3zM14 3h7v7h-7zM3 14h7v7H3zM14 14h7v7h-7z" /> : route === 'decisions' ? <path d="M4 4h5v5H4zM15 15h5v5h-5zM6.5 9v8.5H15M9 6.5h8.5V15" /> : route === 'knowledge' ? <><circle cx="12" cy="5" r="2" /><circle cx="5" cy="18" r="2" /><circle cx="19" cy="18" r="2" /><path d="m11 7-5 9m7-9 5 9M7 18h10" /></> : <path d="M8 3v5m8-5v5M6 8h12v4a6 6 0 0 1-12 0V8Zm6 10v3" />}</svg>;
}

export default function App() {
  const store = useMemo(() => createStore(), []);
  const [route, setRoute] = useState(() => typeof location !== 'undefined' && PAGE[location.hash.slice(1)] ? location.hash.slice(1) : 'overview');
  const [sample, setSample] = useState('hold'), [recordMode, setRecordMode] = useState('sample');
  const [saved, setSaved] = useState(null), [storageFailure, setStorageFailure] = useState('');
  const [error, setError] = useState(''), [busy, setBusy] = useState(false);
  const [selectedEvent, setSelectedEvent] = useState(null), [selectedNode, setSelectedNode] = useState('observation'), [selectedCheck, setSelectedCheck] = useState(null);
  const [chartEvent, setChartEvent] = useState(null), [historyPage, setHistoryPage] = useState(0);
  const [loop, setLoop] = useState({ running: false, remaining: 0 });
  const [dialog, setDialog] = useState(null), [toast, setToast] = useState('');
  const [clock, setClock] = useState(() => Date.now());
  const [hidden, setHidden] = useState(false), [reduced, setReduced] = useState(() => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches);
  const [knowledge, setKnowledge] = useState({ condition: 'liquid', depth: '3', selected: 'observation:shared', source: null, query: '', pendingCondition: 'liquid', pendingDepth: '3' });
  const [exportRecord, setExportRecord] = useState({ text: '', name: 'falcon-record.json', description: '' }), [exportStatus, setExportStatus] = useState('');
  const savedRef = useRef(null), modeRef = useRef(recordMode), routeRef = useRef(route), busyRef = useRef(false), mounted = useRef(true);
  const loopRef = useRef({ running: false, remaining: 0, timer: null }), toastTimer = useRef(null), commandRef = useRef(null);
  const scrollPositions = useRef({}), navigation = useRef(null), exportTextarea = useRef(null), downloads = useRef(new Map());
  const exportGeneration = useRef(0);
  modeRef.current = recordMode; routeRef.current = route;
  const own = recordMode === 'saved' && Boolean(saved);
  const shown = useMemo(() => own ? saved : { run: DATA.samples[sample], view: replayRun(DATA.samples[sample]) }, [own, saved, sample]);
  const { run, view } = shown;
  const at = own ? new Date(Math.max(clock, Date.parse(view.state.at))).toISOString() : view.state.at;
  const trace = useMemo(() => {
    const entry = selectedEvent ? view.entries.find(item => item.eventId === selectedEvent) : null;
    if (entry) return { graph: entry.graph, decision: entry.decision, entry };
    const graph = own ? buildGraph(view.state, at) : view.graph;
    return { graph, decision: decide(graph), entry: null };
  }, [view, selectedEvent, own, at]);
  const supported = Boolean(globalThis.navigator?.locks?.request && globalThis.crypto?.randomUUID);
  const canPersist = supported && !storageFailure;
  const storageMessage = storageFailure || (!supported ? 'Sample inspection is available. To save a simulation, open this page over HTTPS or localhost in a browser with Web Locks and secure browser APIs.' : '');
  const locked = !own || !canPersist || busy || run.events.length >= 200;

  function notify(message) {
    clearTimeout(toastTimer.current); setToast(message);
    toastTimer.current = setTimeout(() => { if (mounted.current) setToast(''); }, 6000);
  }
  function stopLoop(message) {
    clearTimeout(loopRef.current.timer);
    loopRef.current.controller?.abort();
    loopRef.current = { running: false, remaining: 0, timer: null };
    if (mounted.current) { setLoop({ running: false, remaining: 0 }); if (message) notify(message); }
  }
  function fail(failure) { stopLoop(); setError(failure instanceof Error ? failure.message : String(failure)); }
  function acceptSaved(value) { savedRef.current = value; setSaved(value); }
  function resetSelection() { setSelectedEvent(null); setSelectedCheck(null); setChartEvent(null); setHistoryPage(0); }
  function refreshSaved({ external = false, initial = false } = {}) {
    stopLoop();
    try {
      const current = store.load();
      if (!current && savedRef.current) throw new Error('The saved simulation is missing. Existing displayed history has not been replaced.');
      acceptSaved(current); setStorageFailure(''); setError(''); resetSelection();
      if (current && (initial || !external)) setRecordMode('saved');
      if (current && !initial) notify(external ? 'Saved state changed in another tab. The agent remains stopped.' : 'Saved record loaded. The agent remains stopped.');
    } catch (failure) { setStorageFailure(failure.message); if (!initial) fail(failure); }
  }
  function setMode(next, nextSample = sample) {
    stopLoop(); setRecordMode(next); setSample(nextSample); resetSelection(); setError('');
  }
  function navigate(next, options = {}) {
    if (!PAGE[next]) return;
    scrollPositions.current[routeRef.current] = window.scrollY;
    if (location.hash !== `#${next}`) history.pushState(null, '', `#${next}`);
    navigation.current = { next, focus: options.focus !== false, anchor: options.anchor };
    setRoute(next);
    if (next === routeRef.current) finishNavigation();
  }
  function finishNavigation() {
    const pending = navigation.current;
    if (!pending) return;
    navigation.current = null;
    window.scrollTo({ top: scrollPositions.current[pending.next] || 0, behavior: 'instant' });
    if (pending.focus) document.getElementById('page-title')?.focus({ preventScroll: true });
    if (pending.anchor) document.getElementById(pending.anchor)?.scrollIntoView({ block: 'start', behavior: reduced ? 'instant' : 'smooth' });
  }
  useLayoutEffect(finishNavigation, [route]);
  useEffect(() => {
    mounted.current = true;
    refreshSaved({ initial: true });
    const media = matchMedia('(prefers-reduced-motion: reduce)');
    const motion = () => setReduced(media.matches);
    const visibility = () => { setHidden(document.hidden); if (document.hidden) { stopLoop(); document.getAnimations().forEach(animation => animation.cancel()); } };
    const hide = () => stopLoop();
    const changed = event => { if (event.key === STORE_KEY || event.key === null) refreshSaved({ external: true }); };
    const hash = () => { const next = location.hash.slice(1); if (PAGE[next] && next !== routeRef.current) navigate(next, { focus: false }); };
    document.addEventListener('visibilitychange', visibility); window.addEventListener('pagehide', hide);
    window.addEventListener('storage', changed); window.addEventListener('popstate', hash); window.addEventListener('hashchange', hash); media.addEventListener('change', motion);
    const timer = setInterval(() => { if (!document.hidden && modeRef.current === 'saved') setClock(Date.now()); }, 1000);
    return () => {
      mounted.current = false; clearInterval(timer); clearTimeout(toastTimer.current); stopLoop();
      document.removeEventListener('visibilitychange', visibility); window.removeEventListener('pagehide', hide);
      window.removeEventListener('storage', changed); window.removeEventListener('popstate', hash); window.removeEventListener('hashchange', hash); media.removeEventListener('change', motion);
      for (const [url, timer] of downloads.current) { clearTimeout(timer); URL.revokeObjectURL(url); }
    };
  }, []);
  useEffect(() => {
    if (reduced || hidden) return;
    const node = document.getElementById('view');
    const animation = node?.animate?.([{ opacity: .65, transform: 'translateY(4px)' }, { opacity: 1, transform: 'translateY(0)' }], { duration: 180, easing: 'ease-out' });
    return () => animation?.cancel();
  }, [route, sample, recordMode, selectedNode, selectedCheck, selectedEvent, chartEvent, historyPage, saved?.view.state.revision, knowledge.condition, knowledge.depth, reduced, hidden]);

  async function command(type, payload = {}, { signal } = {}) {
    if (signal?.aborted || busyRef.current || modeRef.current !== 'saved' || !savedRef.current || !canPersist) return false;
    if (type === 'owner_redeem' || type === 'revoke') stopLoop();
    busyRef.current = true; setBusy(true); setError('');
    try {
      const current = savedRef.current;
      const event = { id: crypto.randomUUID(), at: timeAt(current.view.state), type, ...payload };
      const next = await store.dispatch(event, current.view.state.revision, { signal });
      if (!mounted.current) return false;
      acceptSaved(next); setClock(Date.now()); setSelectedEvent(event.id); setSelectedCheck(null); setSelectedNode('observation'); setChartEvent(null); setHistoryPage(Math.floor((next.view.entries.length - 1) / 40));
      if (next.view.state.revoked || next.run.events.length >= 200) stopLoop();
      notify(next.view.entries.at(-1).outcome.message);
      return true;
    } catch (failure) {
      if (signal?.aborted && failure?.name === 'AbortError') return false;
      if (mounted.current) fail(failure); return false;
    }
    finally { busyRef.current = false; if (mounted.current) setBusy(false); }
  }
  commandRef.current = command;
  async function tickLoop() {
    const active = loopRef.current;
    active.timer = null;
    if (!active.running || document.hidden) { stopLoop(); return; }
    if (busyRef.current) { active.timer = setTimeout(tickLoop, 5000); return; }
    active.controller = new AbortController();
    const success = await commandRef.current('cycle', {}, { signal: active.controller.signal });
    active.controller = null;
    if (!success || loopRef.current !== active || !active.running) return;
    active.remaining -= 1;
    if (active.remaining <= 0) { stopLoop('Agent stopped after 10 cycles.'); return; }
    setLoop({ running: true, remaining: active.remaining }); active.timer = setTimeout(tickLoop, 5000);
  }
  function toggleLoop() {
    if (loopRef.current.running) { stopLoop('Agent stopped by you.'); return; }
    if (locked || view.state.revoked) return;
    loopRef.current = { running: true, remaining: 10, timer: null }; setLoop({ running: true, remaining: 10 }); void tickLoop();
  }
  async function create(setup) {
    if (savedRef.current || busyRef.current || !canPersist) return;
    busyRef.current = true; setBusy(true);
    try {
      const next = await store.create({ id: crypto.randomUUID(), createdAt: new Date().toISOString(), ...setup });
      if (!mounted.current) return;
      acceptSaved(next); setRecordMode('saved'); resetSelection(); setClock(Date.now()); setDialog(null); navigate('decisions'); notify('Simulation saved. Record synthetic evidence to begin.');
    } finally { busyRef.current = false; if (mounted.current) setBusy(false); }
  }
  function preset(name) {
    if (!savedRef.current || modeRef.current !== 'saved' || busyRef.current) return;
    const state = savedRef.current.view.state;
    const floor = BigInt(state.mandate.minLiquidityUnits), total = BigInt(state.balances.totalUnits), position = BigInt(state.balances.positionUnits), cap = BigInt(state.mandate.investmentCapUnits);
    let liquidity = total > floor ? total : floor;
    if (name === 'low') { const exit = position > 0n ? position : cap; liquidity = floor / 2n < exit / 2n ? floor / 2n : exit / 2n; }
    void command('observe', { observation: { source: 'synthetic', status: name === 'unavailable' ? 'unavailable' : 'ok', observedAt: new Date(Date.parse(timeAt(state)) - (name === 'stale' ? (state.mandate.maxObservationAgeSeconds + 1) * 1000 : 0)).toISOString(), availableLiquidityUsdc: name === 'unavailable' ? null : formatUsdc(liquidity.toString()) } });
  }
  function observe(liquidity, age) {
    if (!savedRef.current) return;
    void command('observe', { observation: { source: 'synthetic', status: 'ok', observedAt: new Date(Date.parse(timeAt(savedRef.current.view.state)) - age * 1000).toISOString(), availableLiquidityUsdc: liquidity } });
  }
  function openEvent(id) { setSelectedEvent(id); setSelectedNode('observation'); setSelectedCheck(null); setHistoryPage(Math.floor(view.entries.findIndex(entry => entry.eventId === id) / 40)); navigate('decisions'); }
  function selectEvent(id) { setSelectedEvent(id); setSelectedCheck(null); setSelectedNode('observation'); document.querySelector('.trace-summary')?.scrollIntoView({ block: 'center', behavior: reduced ? 'instant' : 'smooth' }); }
  function startExport(text, name, description) { exportGeneration.current += 1; setExportRecord({ text, name, description }); setExportStatus('Choose Download JSON, or copy the record below.'); setDialog('export'); }
  function exportRun() {
    try {
      const text = own ? store.exportRun() : JSON.stringify(run, null, 2);
      const exported = JSON.parse(text); replayRun(exported);
      startExport(text, own ? 'falcon-simulation.json' : `falcon-sample-${sample}.json`, exported.schemaVersion === 2 ? 'This record contains the commands, saved input graphs, checks, and outcomes. You can also select and copy the text.' : 'This legacy record contains the setup and command journal. Graphs, rule checks, and outcomes are reconstructed during replay; they are not stored in this export.');
    } catch (failure) { fail(failure); }
  }
  function exportSample(condition, depth) { const pack = DATA.knowledge[condition]; startExport(JSON.stringify({ mode: 'synthetic', sample: condition, graph: pack.graph, analysis: pack.analyses[depth], sources: pack.sources }, null, 2), `falcon-knowledge-${condition}.json`, 'This synthetic sample contains its graph, retained analysis, and source records. It contains no treasury command journal. You can also select and copy the text.'); }
  async function copyExport() {
    const generation = exportGeneration.current;
    try {
      await navigator.clipboard.writeText(exportRecord.text);
      if (mounted.current && generation === exportGeneration.current) setExportStatus('JSON copied.');
    } catch {
      if (!mounted.current || generation !== exportGeneration.current) return;
      exportTextarea.current?.focus(); exportTextarea.current?.select(); setExportStatus('Clipboard access is unavailable. The JSON is selected for manual copying.');
    }
  }
  function downloadExport() {
    let url;
    try {
      url = URL.createObjectURL(new Blob([exportRecord.text], { type: 'application/json' }));
      const link = document.createElement('a'); link.href = url; link.download = exportRecord.name; document.body.append(link); link.click(); link.remove();
      downloads.current.set(url, setTimeout(() => { URL.revokeObjectURL(url); downloads.current.delete(url); }, 1000));
      setExportStatus('Download requested. If it did not open, select and copy the text.');
    } catch { if (url) URL.revokeObjectURL(url); setExportStatus('Download is unavailable. Select the JSON text and copy it.'); }
  }
  const title = PAGE[route];
  const closeDialog = () => { exportGeneration.current += 1; setDialog(null); };
  const openSetup = () => { if (saved) { setMode('saved'); navigate('decisions'); } else setDialog('setup'); };
  return <MotionPaused.Provider value={reduced || hidden}><link rel="license" href={fontLicense} /><a href="#main" className="skip" onClick={event => { event.preventDefault(); document.getElementById('main').focus(); }}>Skip to content</a><div className="app"><aside className="sidebar" aria-label="Main navigation"><div className="side-brand"><div><a className="brand" href="/" aria-label="FalconOS website"><Mark /><span className="wordmark">FALCON<span className="os">OS</span></span></a><div className="workspace-tag">PERSONAL WORKSPACE</div></div></div><div><p className="label nav-label">Control Centre</p><nav className="navigation">{Object.keys(PAGE).map((name, index) => <a className="nav-item" href={`#${name}`} data-route={name} aria-current={route === name ? 'page' : undefined} key={name} onClick={event => { if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return; event.preventDefault(); navigate(name); }}><RouteIcon route={name} />{name[0].toUpperCase() + name.slice(1)}<span className="nav-n">{String(index + 1).padStart(2, '0')}</span></a>)}</nav></div><div className="side-bottom"><div className="side-status"><p className="label">Environment</p><div className="od-row"><span className="small">Treasury</span><span className="green small mono">SIMULATION</span></div><div className="od-row"><span className="small">Live services</span><span className="muted small mono">OFFLINE</span></div></div><a className="side-link" href={legacyHref}>Earlier advisory workspace <span aria-hidden="true">↗</span></a><div className="side-owner od-row"><div className="avatar" aria-hidden="true">YOU</div><div className="od-field"><span className="small">Workspace owner</span><span className="label">Human oversight</span></div></div></div></aside>
    <div className="main-shell"><header className="topbar"><div className="breadcrumbs"><span>Workspace</span><span aria-hidden="true">/</span><strong id="crumb">{route[0].toUpperCase() + route.slice(1)}</strong></div><div className="top-links"><span className="mode-tag">SYNTHETIC USDC</span><a href="/">Website <span aria-hidden="true">↗</span></a></div></header><main id="main" className="content" tabIndex="-1"><div className="page-head"><div><p id="page-eyebrow" className="eyebrow">{title[0]}</p><h1 id="page-title" tabIndex="-1">{title[1]}</h1><p className="muted" id="page-description">{title[2]}</p></div><div className="actions"><button className="btn" data-action="mandate" onClick={() => setDialog('mandate')}>View mandate</button><button className="btn primary" id="new-run" data-action="setup" disabled={busy || (!saved && !canPersist)} onClick={openSetup}>{saved ? 'Open my simulation' : <><span aria-hidden="true">+</span> New simulation</>}</button></div></div>
      <div id="error-banner" className="banner error" role="alert" hidden={!error}><p id="error-text">{error}</p><button className="btn" data-action="reload-store" disabled={busy} onClick={() => refreshSaved()}>Reload saved state</button></div><div id="storage-banner" className="banner" hidden={!storageMessage}><p id="storage-text">{storageMessage}</p></div><div id="sample-bar" className="sample-bar" hidden={['knowledge', 'connections'].includes(route)}><div className="sample-context"><span id="sample-context" className="label">{own ? 'Your saved simulation' : `Sample run / ${SAMPLE_NAMES[sample]}`}</span><button id="switch-record" className="btn subtle" data-action="switch-record" hidden={!saved} disabled={busy} onClick={() => setMode(own ? 'sample' : 'saved')}>{own ? 'Browse examples' : 'Open my simulation'}</button></div><div id="sample-controls" className="sample-controls" aria-label="Synthetic example" hidden={own}>{['supply', 'hold', 'redeem', 'blocked', 'stale'].map(name => <button className="chip" key={name} data-sample={name} aria-pressed={sample === name} disabled={busy} onClick={() => setMode('sample', name)}>{name[0].toUpperCase() + name.slice(1)}</button>)}</div></div>
      <div id="view">{route === 'overview' ? <Overview run={run} view={view} own={own} at={at} loopRunning={loop.running} chartEvent={chartEvent} selectChart={setChartEvent} navigate={navigate} inspectLatest={() => { setSelectedEvent(view.entries.findLast(entry => entry.decision)?.eventId || null); setSelectedCheck(null); navigate('decisions'); }} openHistory={() => navigate('decisions', { anchor: 'history-panel' })} openEvent={openEvent} /> : route === 'decisions' ? <Decisions run={run} view={view} own={own} at={at} trace={trace} selectedNode={selectedNode} selectedCheck={selectedCheck} selectedEvent={selectedEvent} historyPage={historyPage} setHistoryPage={setHistoryPage} selectNode={id => { setSelectedNode(id); setSelectedCheck(null); }} selectCheck={setSelectedCheck} selectEvent={selectEvent} currentGraph={() => { setSelectedEvent(null); setSelectedCheck(null); setClock(Date.now()); }} locked={locked} loop={loop} toggleLoop={toggleLoop} command={command} preset={preset} observe={observe} revoke={() => { stopLoop(); setDialog('revoke'); }} exportRun={exportRun} /> : route === 'knowledge' ? <Knowledge data={DATA.knowledge} state={knowledge} setState={setKnowledge} reduced={reduced} navigate={navigate} notify={notify} exportSample={exportSample} /> : <Connections saved={saved} canPersist={canPersist} storageMessage={storageMessage} />}</div><footer className="view-footer"><span>FALCON OS / HUMAN CONTROL PLANE</span><span>Simulation only · No wallet or live funds</span><a href={legacyHref}>Earlier advisory workspace ↗</a></footer></main></div></div>
    <SetupDialog open={dialog === 'setup'} close={closeDialog} create={create} disabled={busy || Boolean(saved) || !canPersist} /><MandateDialog open={dialog === 'mandate'} close={closeDialog} run={run} state={view.state} own={own} /><RevokeDialog open={dialog === 'revoke'} close={closeDialog} disabled={locked} confirm={() => { closeDialog(); void command('revoke'); }} /><ExportDialog open={dialog === 'export'} close={closeDialog} record={exportRecord} status={exportStatus} copy={copyExport} download={downloadExport} textarea={exportTextarea} /><div className="toast" id="toast" role="status" aria-live="polite">{toast}</div></MotionPaused.Provider>;
}
