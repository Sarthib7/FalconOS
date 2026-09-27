import React, { createContext, useContext, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Hero, Readiness, Closing, Footer } from './sections.jsx';
import { amount, buckets, graphNode, inspectScenario, presentation, scenarios, traceJson, usdc } from './model.mjs';
import { startLiquidMotion } from './motion.mjs';
import { registerEmail, registrationMessage } from './waitlist.mjs';
import fontLicense from './assets/FONT-LICENSE.txt?url';
import assetCredits from './assets/CREDITS.md?url';

const MotionPaused = createContext(false);
const arrowPath = 'M3 10h13m-5-5 5 5-5 5';

function Arrow() { return <svg className="arrow-icon" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true"><path d={arrowPath} /></svg>; }
function Mark({ className = 'brand-symbol', moving = false }) { return <svg className={className} viewBox="0 0 256 256" fill="currentColor" aria-hidden="true"><path className={moving ? 'page-vector-main' : undefined} d="M30 194L171 39L129 151Z" /><path className={moving ? 'page-vector-tip' : undefined} d="M138 195L218 70L190 195Z" /></svg>; }
function Brand() { return <a className="brand" href="#top" aria-label="FalconOS home"><Mark /><span className="falcon-wordmark" aria-hidden="true"><span>FALCON</span><span className="wordmark-os">OS</span></span></a>; }
function Signal({ stage }) { return <span className="signal-line" data-signal={stage} aria-hidden="true" />; }
function ChainLink() { return <span className="chain-link" aria-hidden="true"><svg viewBox="0 0 40 12" fill="none" stroke="currentColor"><path d="M0 6h38m-5-4 5 4-5 4" /></svg></span>; }

function useReducedMotion() {
  const [reduced, setReduced] = useState(() => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches);
  useEffect(() => {
    const query = matchMedia('(prefers-reduced-motion: reduce)');
    const change = () => setReduced(query.matches);
    change(); query.addEventListener('change', change);
    return () => query.removeEventListener('change', change);
  }, []);
  return reduced;
}

function Figure({ children, className, id, ...props }) {
  const paused = useContext(MotionPaused);
  const node = useRef(null);
  const last = useRef(children);
  const [old, setOld] = useState(null);
  useLayoutEffect(() => {
    const previous = last.current;
    last.current = children;
    if (paused || previous === children || !node.current?.animate) { setOld(null); return; }
    setOld(previous);
    const animation = node.current.animate([{ opacity: .45, transform: 'translateY(4px)' }, { opacity: 1, transform: 'translateY(0)' }], { duration: 180, easing: 'cubic-bezier(.2,.8,.2,1)' });
    const timer = setTimeout(() => setOld(null), 180);
    return () => { clearTimeout(timer); animation.cancel(); };
  }, [children, paused]);
  return <span id={id} className={className} {...props}><span className="figure-roll">{old !== null && <span className="figure-old" aria-hidden="true">{old}</span>}<span className="figure-current" ref={node}>{children}</span></span></span>;
}

function BalanceBar({ share, color, name, phase }) {
  const paused = useContext(MotionPaused);
  const node = useRef(null);
  const previous = useRef(share);
  useLayoutEffect(() => {
    const before = previous.current; previous.current = share;
    if (paused || before === share || !node.current?.animate) return;
    const animation = node.current.animate([{ transform: `scaleX(${before})` }, { transform: `scaleX(${share})` }], { duration: 240, easing: 'cubic-bezier(.2,.8,.2,1)' });
    return () => animation.cancel();
  }, [share, paused]);
  return <span className="comparison-track" aria-hidden="true"><span className="comparison-fill" ref={node} data-balance-key={`${name}:${phase}`} data-phase={phase} style={{ '--bucket-color': color, transform: `scaleX(${share})` }} /></span>;
}

function Header({ open, setOpen }) {
  return <header className="topbar" id="top"><div className="container nav-inner"><Brand />
    <nav className={`site-nav${open ? ' is-open' : ''}`} id="site-nav" aria-label="Main navigation"><a href="#capital">Your capital</a><a href="#decisions">Decision graph</a><a href="#readiness">What's ready</a><a href="#waitlist">Get updates</a></nav>
    <a className="button nav-action" href="#decisions">Explore the simulation <Arrow /></a>
    <button type="button" className="menu-toggle" id="menu-toggle" aria-expanded={open} aria-controls="site-nav" aria-label={open ? 'Close navigation' : 'Open navigation'} onClick={() => setOpen(!open)}><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true"><path d="M4 8h16M4 16h16" /></svg></button>
  </div></header>;
}

function Balances({ scenario }) {
  const decision = scenario.entry.decision;
  return <div className="balance-region">
    <div className="state-strip" aria-label="Selected synthetic scenario">
      <div className="od-stat"><span className="micro">EVIDENCE AGE / LIMIT</span><Figure className="state-value" id="desk-evidence" data-tone={scenario.id === 'stale' ? 'warn' : 'ready'}>{`${scenario.age} s / 60 s`}</Figure><Signal stage="evidence" /></div>
      <div className="od-stat"><span className="micro">RULE DECISION</span><Figure className="state-value" id="desk-decision" data-tone={decision.status === 'READY' ? 'ready' : 'warn'}>{decision.action}</Figure><Signal stage="rule" /></div>
      <div className="od-stat"><span className="micro">USDC MOVED</span><Figure className="state-value" id="desk-moved" data-tone={decision.status === 'READY' ? 'ready' : 'warn'}>{usdc(scenario.entry.outcome.amountUnits)}</Figure><Signal stage="outcome" /></div>
    </div>
    <div className="balance-topline"><span className="micro">CAPITAL / BEFORE &amp; AFTER</span><span className="micro"><span className="balance-stage" id="balance-stage">{presentation[scenario.id].balance}</span></span></div>
    <table className="balance-comparison"><caption className="sr-only">Balances before and after the selected synthetic treasury decision.</caption><thead><tr><th scope="col">BUCKET</th><th scope="col">BEFORE</th><th scope="col">AFTER</th></tr></thead><tbody id="balance-comparison-body">{buckets.map(([key, label, color, helper]) => <tr key={key}><td><div className="od-field"><span className="comparison-name">{label}</span><span className="comparison-helper">{helper}</span></div></td>{['before', 'after'].map(phase => {
      const balances = phase === 'before' ? scenario.before : scenario.entry.balances;
      const share = Number(BigInt(balances[key])) / Number(BigInt(scenario.entry.balances.totalUnits));
      return <td key={phase}><div className="comparison-cell od-stat"><Figure className="comparison-value od-nowrap" id={`balance-${key}-${phase}`}>{usdc(balances[key])}</Figure><BalanceBar share={share} color={color} name={key} phase={phase} /></div></td>;
    })}</tr>)}</tbody></table>
    <div className="comparison-scale"><span>Synthetic treasury scenario</span><span id="comparison-scale">Scale: 0 to {usdc(scenario.entry.balances.totalUnits)}</span></div>
    <p className="authority-line"><svg viewBox="0 0 16 16" fill="none" stroke="currentColor" aria-hidden="true"><rect x="3" y="7" width="10" height="7" rx="1" /><path d="M5 7V5a3 3 0 0 1 6 0v2" /></svg>Reserve and undelegated cash stay outside agent authority.</p>
  </div>;
}

function Node({ id, type, name, value, selected, evidence, onSelect, valueId, nameId, side, corner, signal, tone, valueFirst }) {
  const valueElement = <Figure className="node-value" id={valueId}>{value}</Figure>;
  const nameElement = <span className="node-name" id={nameId}>{name}</span>;
  return <button className={`node${side ? ' side-node' : ''}`} type="button" data-node={id} aria-pressed={selected === id} data-evidence={evidence.includes(id)} data-tone={tone} onClick={() => onSelect(id)}>
    <span className="node-type">{type}</span>{valueFirst ? <>{valueElement}{nameElement}</> : <>{nameElement}{valueElement}</>}{corner && <span className="node-corner" aria-hidden="true">+</span>}{signal && <Signal stage={signal} />}{evidence.includes(id) && <span className="sr-only">Selected rule evidence</span>}
  </button>;
}

function Graph({ scenario, selectedNode, selectedCheck, selectNode }) {
  const detail = inspectScenario(scenario, selectedNode, selectedCheck);
  const common = { selected: selectedNode, evidence: detail.evidence, onSelect: selectNode };
  const decision = scenario.entry.decision;
  const p = presentation[scenario.id];
  return <><div className="graph-heading"><span className="eyebrow">Inputs → rules → outcome</span><span className="micro">Select a node to inspect it</span></div><div className="graph-layout">
    <div className="graph-stage" role="group" aria-label="Treasury decision graph">
      <div className="graph-top"><Node {...common} id="reserve" type="Outside authority" name="Spending reserve" value="200 USDC" side /><Node {...common} id="mandate" type="Owner rules" name="Investment limit" value="500 USDC" corner /><Node {...common} id="undelegated" type="Outside authority" name="Undelegated cash" value="300 USDC" side /></div>
      <div className="relations" aria-hidden="true"><span>↖ excludes</span><span className="relation-authorizes">↓ authorizes</span><span>excludes ↗</span></div>
      <svg className="connector" viewBox="0 0 600 40" preserveAspectRatio="none" fill="none" aria-hidden="true"><path d="M300 0v12H100v28" stroke="currentColor" strokeWidth="1" vectorEffect="non-scaling-stroke" /><path d="m96 34 4 5 4-5" stroke="currentColor" strokeWidth="1" vectorEffect="non-scaling-stroke" /></svg>
      <div className="graph-chain"><Node {...common} id="account" type="Delegated idle" name="Investment account" value={usdc(scenario.before.idleUnits)} valueId="node-idle" /><ChainLink /><Node {...common} id="position" type="Simulated position" name="Lending position" value={usdc(scenario.before.positionUnits)} valueId="node-position" /><ChainLink /><Node {...common} id="observation" type="Synthetic evidence" name="Available liquidity" value={usdc(graphNode(scenario, 'observation').data.observation.availableLiquidityUnits)} valueId="node-liquidity" signal="evidence" /></div>
      <p className="graph-input-label">Account owns position → position depends on evidence</p>
      <div className="graph-footer"><Node {...common} id="decision" type="Rule decision" name={p.decision} value={decision.action} valueId="node-decision" nameId="node-decision-status" signal="rule" tone={decision.status === 'READY' ? 'ready' : 'warn'} valueFirst /><ChainLink /><Node {...common} id="outcome" type="Simulated outcome" name={p.outcome} value={decision.status === 'BLOCKED' ? 'BLOCKED' : decision.status === 'NO_DATA' ? 'NO DATA' : usdc(scenario.entry.outcome.amountUnits)} valueId="node-outcome" nameId="node-outcome-label" signal="outcome" tone={decision.status === 'READY' ? 'ready' : 'warn'} valueFirst /></div>
      <p className="graph-hint">Graph amounts are inputs, before the decision. Compare the resulting balances in the chart above.</p>
    </div>
    <aside className="inspector" id="inspector" aria-labelledby="inspector-title"><span className="eyebrow" id="inspector-kind">{detail.kind}</span><h4 id="inspector-title">{detail.title}</h4><p id="inspector-copy">{detail.copy}</p><dl className="inspector-data" id="inspector-data">{detail.rows.map(([name, value]) => <div key={name}><dt>{name}</dt><dd>{value}</dd></div>)}</dl><div className="inspector-links" id="inspector-links"><div><span className="micro">RELATIONSHIPS</span>{detail.links.map((link, index) => <span key={index}>{link}</span>)}</div></div></aside>
  </div></>;
}

function Rules({ scenario, selectedCheck, selectCheck }) {
  const checks = scenario.entry.decision.checks;
  const evaluated = checks.filter(check => check.status !== 'SKIPPED').length;
  return <details className="rules-disclosure" id="rules-disclosure"><summary>Inspect all rule checks <span className="muted" id="check-count">({evaluated} evaluated, {checks.length - evaluated} skipped)</span></summary><div className="rule-list" id="rule-list">{checks.map((check, index) => <button className="rule-button" type="button" key={check.id} data-check={check.id} aria-pressed={selectedCheck === check.id} onClick={() => selectCheck(check)}><span className="rule-index">{String(index + 1).padStart(2, '0')}</span><span>{check.label}</span><span className="rule-status" data-state={check.status}>{check.status.replace('_', ' ')}</span></button>)}</div></details>;
}

function Outcome({ scenario }) {
  const p = presentation[scenario.id];
  const outcome = scenario.entry.outcome;
  return <section className="container outcome-section" id="outcome" aria-labelledby="outcome-title" data-od-id="outcome-trace"><div className="outcome-header"><h3 id="outcome-title">The movement, explained.</h3><span className={`tag ${scenario.entry.decision.status === 'READY' ? 'accent' : 'amber'}`} id="outcome-badge">{scenario.title} / {outcome.status === 'SIMULATED' ? 'simulated' : outcome.status.toLowerCase().replace('_', ' ')}</span></div>
    <div className="timeline"><div className="timeline-step" data-trace-stage="evidence"><Signal stage="evidence" /><span className="step-index">01 / EVIDENCE</span><span className="step-title" id="trace-evidence-title">{scenario.id === 'stale' ? 'Stale liquidity evidence' : 'Synthetic liquidity'}</span><Figure className="step-value" id="trace-evidence-value">{usdc(graphNode(scenario, 'observation').data.observation.availableLiquidityUnits)}</Figure><p className="step-copy" id="trace-evidence-copy">{scenario.age} seconds old. {scenario.id === 'stale' ? 'Beyond' : 'Within'} the 60-second limit.</p></div>
      <div className="timeline-step" data-trace-stage="rule"><Signal stage="rule" /><span className="step-index">02 / RULE</span><span className="step-title" id="trace-rule-title">{p.rule}</span><Figure className="step-value" id="trace-rule-value">{p.ruleValue}</Figure><p className="step-copy" id="trace-rule-copy">{p.ruleCopy}</p></div>
      <div className="timeline-step" data-trace-stage="outcome"><Signal stage="outcome" /><span className="step-index">03 / OUTCOME</span><span className="step-title" id="trace-outcome-title">{p.route}</span><span className="movement-value" id="trace-moved"><Figure>{amount(outcome.amountUnits)}</Figure> <small>USDC moved</small></span><p className="step-copy" id="trace-outcome-copy">{scenario.id === 'blocked' ? 'The 500 USDC position stays intact. The spending reserve is unchanged.' : 'Spending reserve stays at 200 USDC. Undelegated cash stays at 300 USDC.'}</p></div></div>
  </section>;
}

function Waitlist() {
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState(false);
  const [confirmedEmail, setConfirmedEmail] = useState('');
  const confirmed = useRef(new Map());
  const input = useRef(null);
  const success = useRef(null);
  const request = useRef(null);
  useEffect(() => () => { request.current?.abort(); request.current = null; }, []);
  useLayoutEffect(() => {
    if (confirmedEmail) success.current?.focus({ preventScroll: true });
    else if (confirmed.current.size) input.current?.focus({ preventScroll: true });
  }, [confirmedEmail]);
  async function submit(event) {
    event.preventDefault();
    if (request.current || confirmedEmail) return;
    const normalized = email.trim().toLowerCase();
    const previous = confirmed.current.get(normalized);
    if (previous) {
      setError(false); setMessage(registrationMessage({ ...previous, status: 'already_registered' }));
      setConfirmedEmail(normalized);
      return;
    }
    const controller = new AbortController(); request.current = controller;
    const timer = setTimeout(() => controller.abort(), 15000);
    setBusy(true); setError(false); setMessage('Saving your address…');
    try {
      const result = await registerEmail(email, { signal: controller.signal });
      if (request.current === controller) {
        confirmed.current.set(normalized, result);
        setMessage(registrationMessage(result)); setConfirmedEmail(normalized);
      }
    } catch (failure) {
      if (request.current === controller) { setError(true); setMessage(controller.signal.aborted ? 'Signup timed out. Your email is still here. Try again.' : failure.message); }
    } finally {
      clearTimeout(timer);
      if (request.current === controller) { request.current = null; setBusy(false); }
    }
  }
  return <section className="container section waitlist" id="waitlist" aria-labelledby="waitlist-title" data-od-id="waitlist"><div className="section-heading"><div><span className="section-index">03 / PRODUCT UPDATES</span><h2 id="waitlist-title" tabIndex="-1">Follow the build.<br /><em>Join the early list.</em></h2></div><p>Get updates as we test the graph, Devnet lending, and the next product steps.</p></div>
    <form id="waitlist-form" className={`waitlist-form${confirmedEmail ? ' is-complete' : ''}`} onSubmit={submit}>
      {confirmedEmail ? <><div id="waitlist-success" className="waitlist-success" ref={success} tabIndex="-1" aria-describedby="waitlist-status"><svg className="waitlist-check" viewBox="0 0 48 48" fill="none" aria-hidden="true"><circle cx="24" cy="24" r="22" /><path d="m14 24 7 7 13-14" /></svg><div><strong>You're on the list.</strong><span>{confirmedEmail}</span></div></div><button id="waitlist-another" className="button" type="button" onClick={() => { setConfirmedEmail(''); setEmail(''); setMessage(''); setError(false); }}>Use another email</button></>
        : <><div className="waitlist-field"><label htmlFor="waitlist-email">Email address</label><input id="waitlist-email" ref={input} name="email" type="email" autoComplete="email" maxLength={254} required value={email} disabled={busy} aria-describedby="waitlist-status" onChange={event => { setEmail(event.target.value); setMessage(''); setError(false); }} placeholder="Your email address" /></div><button id="waitlist-submit" className="button primary" type="submit" disabled={busy}>{busy ? 'Saving…' : 'Join the list'}<Arrow /></button></>}
      <p id="waitlist-status" className={`waitlist-status${error ? ' is-error' : ''}`} role={error ? 'alert' : 'status'} aria-live="polite" aria-atomic="true">{message || 'Email signup only. No wallet connection is needed.'}</p>
    </form>
  </section>;
}

function PageTransition({ reduced }) {
  const dialog = useRef(null);
  const [destination, setDestination] = useState(null);
  const [handedOff, setHandedOff] = useState(false);
  const trigger = useRef(null);
  function reset(restore = false) { setDestination(null); setHandedOff(false); if (restore) trigger.current?.focus({ preventScroll: true }); }
  useEffect(() => {
    const pages = { '/product/': 'Portfolio preview', '/research/': 'Research preview', '/mesh/': 'Knowledge mesh', '/treasury/': 'Treasury simulation' };
    const click = event => {
      if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || reduced || destination) return;
      const link = event.target.closest?.('a[href]');
      if (!link || link.hasAttribute('download') || (link.target && link.target !== '_self') || link.closest('dialog')) return;
      const url = new URL(link.href, document.baseURI);
      if (url.origin !== location.origin || !pages[url.pathname]) return;
      event.preventDefault(); trigger.current = link; setDestination({ url: url.href, title: pages[url.pathname] });
    };
    const resetPage = () => reset();
    document.addEventListener('click', click); window.addEventListener('pagehide', resetPage); window.addEventListener('pageshow', resetPage);
    return () => { document.removeEventListener('click', click); window.removeEventListener('pagehide', resetPage); window.removeEventListener('pageshow', resetPage); };
  }, [reduced, destination]);
  useEffect(() => {
    if (!destination) { if (dialog.current?.open) dialog.current.close(); return; }
    if (reduced) { location.assign(destination.url); return; }
    if (!dialog.current.open) dialog.current.showModal();
    const navigation = setTimeout(() => { setHandedOff(true); try { location.assign(destination.url); } catch { reset(true); } }, 320);
    const recovery = setTimeout(() => reset(true), 4000);
    return () => { clearTimeout(navigation); clearTimeout(recovery); };
  }, [destination, reduced]);
  return <dialog className="page-transition" id="page-transition" ref={dialog} aria-labelledby="page-transition-status" aria-describedby="page-transition-brand" data-od-id="page-transition" onCancel={event => { event.preventDefault(); if (!handedOff) reset(true); }}><div className="page-transition-content"><Mark className="page-transition-mark" moving /><p className="page-transition-brand" id="page-transition-brand">FalconOS / Product views</p><p className="page-transition-status" id="page-transition-status" role="status">Opening {destination?.title ?? 'workspace'}</p><div className="page-transition-line" aria-hidden="true" /><button className="page-transition-cancel" id="page-transition-cancel" type="button" autoFocus disabled={handedOff} onClick={() => reset(true)}>{handedOff ? 'Opening…' : 'Cancel'}</button></div></dialog>;
}

export default function Landing() {
  const reduced = useReducedMotion();
  const [hidden, setHidden] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [selected, setSelected] = useState(0);
  const [selectedNode, setSelectedNode] = useState('mandate');
  const [selectedCheck, setSelectedCheck] = useState(null);
  const [playing, setPlaying] = useState(!reduced);
  const [inView, setInView] = useState(false);
  const [announcement, setAnnouncement] = useState('');
  const [jsonOpen, setJsonOpen] = useState(false);
  const [copyStatus, setCopyStatus] = useState('');
  const [exportStatus, setExportStatus] = useState('Read-only examples. Selecting a scenario does not run an agent.');
  const canvas = useRef(null);
  const explorer = useRef(null);
  const jsonDialog = useRef(null);
  const jsonText = useRef(null);
  const lastTrigger = useRef(null);
  const downloads = useRef(new Map());
  const scenario = scenarios[selected];
  const stopTour = () => setPlaying(false);
  useEffect(() => startLiquidMotion(canvas.current), []);
  useEffect(() => {
    const change = () => setHidden(document.hidden);
    change(); document.addEventListener('visibilitychange', change);
    return () => document.removeEventListener('visibilitychange', change);
  }, []);
  useEffect(() => {
    if (!('IntersectionObserver' in window)) { setInView(true); return; }
    const observer = new IntersectionObserver(entries => setInView(entries[0].isIntersecting), { threshold: .12 });
    observer.observe(explorer.current); return () => observer.disconnect();
  }, []);
  useEffect(() => { if (reduced) setPlaying(false); }, [reduced]);
  useEffect(() => {
    if (!playing || !inView || hidden || reduced || jsonOpen) return;
    const timer = setTimeout(() => { setSelected(index => (index + 1) % scenarios.length); setSelectedNode('decision'); setSelectedCheck(null); }, 6500);
    return () => clearTimeout(timer);
  }, [playing, inView, hidden, reduced, jsonOpen, selected]);
  useEffect(() => {
    if (reduced || hidden) return;
    const animations = [];
    ['evidence', 'rule', 'outcome'].forEach((stage, index) => document.querySelectorAll(`[data-signal="${stage}"]`).forEach(node => {
      if (node.animate) animations.push(node.animate([{ opacity: .2, transform: 'scaleX(.12)' }, { opacity: 1, transform: 'scaleX(.7)', offset: .6 }, { opacity: 0, transform: 'scaleX(1)' }], { duration: 180, delay: index * 80, easing: 'cubic-bezier(.2,.8,.2,1)' }));
    }));
    return () => animations.forEach(animation => animation.cancel());
  }, [selected, reduced, hidden]);
  useEffect(() => {
    const escape = event => { if (event.key === 'Escape' && menuOpen) { setMenuOpen(false); document.getElementById('menu-toggle').focus(); } };
    document.addEventListener('keydown', escape); return () => document.removeEventListener('keydown', escape);
  }, [menuOpen]);
  useEffect(() => {
    if (jsonOpen) { if (!jsonDialog.current.open) jsonDialog.current.showModal(); document.getElementById('close-json').focus(); }
    else if (jsonDialog.current.open) { jsonDialog.current.close(); lastTrigger.current?.focus(); }
  }, [jsonOpen]);
  useEffect(() => () => { for (const [url, timer] of downloads.current) { clearTimeout(timer); URL.revokeObjectURL(url); } }, []);
  function selectScenario(index) { stopTour(); setSelected(index); setSelectedNode('decision'); setSelectedCheck(null); setAnnouncement(`${scenarios[index].title}. ${presentation[scenarios[index].id].balance}. ${scenarios[index].caption}`); }
  function selectNode(id) { stopTour(); setSelectedNode(id); setSelectedCheck(null); const detail = inspectScenario(scenario, id); setAnnouncement(`${detail.title} ${detail.copy}`); }
  function selectCheck(check) { stopTour(); setSelectedCheck(check.id); setSelectedNode(null); setAnnouncement(`${check.label}. ${check.status.replace('_', ' ')}. ${check.detail}`); }
  function openJson(trigger) { stopTour(); lastTrigger.current = trigger; setCopyStatus(''); setJsonOpen(true); }
  function closeJson() { setJsonOpen(false); }
  function download(event) {
    stopTour(); let url;
    try {
      url = URL.createObjectURL(new Blob([traceJson(scenario)], { type: 'application/json' }));
      const link = document.createElement('a'); link.href = url; link.download = `falcon-${scenario.id}-synthetic-trace.json`; document.body.append(link); link.click(); link.remove();
      setExportStatus('Download requested. If your browser blocked it, use View JSON.');
      downloads.current.set(url, setTimeout(() => { URL.revokeObjectURL(url); downloads.current.delete(url); }, 30000));
    } catch { if (url) URL.revokeObjectURL(url); setExportStatus('Download could not start. Copy the trace from the JSON view.'); openJson(event.currentTarget); }
  }
  async function copyJson() {
    try { await navigator.clipboard.writeText(traceJson(scenario)); setCopyStatus('Copied.'); }
    catch { jsonText.current.focus(); jsonText.current.select(); setCopyStatus('Text selected. Use your device’s Copy command.'); }
  }
  function followAnchor(event) {
    if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    const link = event.target.closest?.('a[href^="#"]');
    if (!link) return;
    const target = document.getElementById(link.getAttribute('href').slice(1));
    if (!target) return;
    event.preventDefault(); setMenuOpen(false);
    const focus = target.matches('h1,h2,h3,[tabindex]') ? target : target.querySelector('h1,h2,h3') || target;
    if (!focus.hasAttribute('tabindex')) focus.setAttribute('tabindex', '-1');
    focus.focus({ preventScroll: true }); target.scrollIntoView({ behavior: reduced ? 'instant' : 'smooth', block: 'start' });
    history.replaceState(null, '', link.getAttribute('href'));
  }
  const pauseForInteraction = event => { if (!event.target.closest('#tour-toggle')) stopTour(); };
  return <MotionPaused.Provider value={reduced || hidden}><div onClick={followAnchor}>
    <link rel="license" href={fontLicense} /><link rel="author" href={assetCredits} />
    <a className="skip-link" href="#main">Skip to content</a><canvas className="liquid-metal-canvas" id="liquid-metal-canvas" ref={canvas} aria-hidden="true" /><Header open={menuOpen} setOpen={setMenuOpen} />
    <main id="main" tabIndex="-1"><Hero /><section className="container section" id="decisions" aria-labelledby="decisions-title" data-od-id="decision-explorer"><div className="section-heading"><div><span className="section-index">01 / THE DECISION GRAPH</span><h2 id="decisions-title" tabIndex="-1">See why.<br /><em>Then see what changed.</em></h2></div><p>Choose a scenario. Select any node to follow its evidence.</p></div>
      <div className="explorer" id="explorer" ref={explorer} onPointerDown={pauseForInteraction} onFocus={pauseForInteraction} onKeyDown={pauseForInteraction}>
        <div className="explorer-chrome"><div className="chrome-title"><Mark /><span className="mono">FALCON / TREASURY</span></div><div className="od-cluster chrome-actions"><span className="tag">Synthetic snapshots</span><button className="button quiet" id="tour-toggle" type="button" aria-pressed={playing && !reduced} aria-label={reduced ? 'Tour paused because reduced motion is enabled' : playing ? 'Pause scenario tour' : 'Play scenario tour'} disabled={reduced} onClick={() => setPlaying(!playing)}>{reduced ? 'Tour paused' : playing ? 'Pause tour' : 'Play tour'}</button></div></div>
        <div id="preview-error" className="preview-error" role="alert" hidden />
        <div className="scenario-area"><p className="micro scenario-label" id="scenario-label">CHANGE THE CONDITIONS</p><div className="scenario-list" role="group" aria-labelledby="scenario-label">{scenarios.map((item, index) => <button className="scenario-button" type="button" key={item.id} data-scenario={item.id} aria-pressed={index === selected} onClick={() => selectScenario(index)}><span className="number" aria-hidden="true">{String(index + 1).padStart(2, '0')}</span>{item.id === 'blocked' ? 'Blocked exit' : item.id === 'stale' ? 'Stale evidence' : item.title}</button>)}</div></div>
        <div className="preview-heading"><div><h3 id="scenario-title">{scenario.label}</h3><p id="scenario-caption">{scenario.caption}</p></div><span className="snapshot-id" id="snapshot-number">SCENARIO {String(selected + 1).padStart(2, '0')} / 05</span></div>
        <Balances scenario={scenario} /><Graph scenario={scenario} selectedNode={selectedNode} selectedCheck={selectedCheck} selectNode={selectNode} /><Rules scenario={scenario} selectedCheck={selectedCheck} selectCheck={selectCheck} />
        <div className="export-row"><p id="export-status" role="status">{exportStatus}</p><div className="od-cluster"><button className="button quiet" type="button" id="export-json" onClick={download}>Download trace <span aria-hidden="true">↓</span></button><button className="button quiet" type="button" id="view-json" onClick={event => openJson(event.currentTarget)}>View JSON</button></div></div><p className="sr-only" id="scenario-announcement" role="status">{announcement}</p>
      </div></section><Outcome scenario={scenario} /><Readiness /><Waitlist /><Closing /></main><Footer />
    <dialog className="json-dialog" id="json-dialog" ref={jsonDialog} aria-labelledby="json-title" aria-describedby="json-description" onCancel={event => { event.preventDefault(); closeJson(); }}><div className="dialog-heading"><h2 id="json-title">Decision trace</h2><button className="button quiet" type="button" id="close-json" autoFocus onClick={closeJson}>Close</button></div><p id="json-description">Synthetic example data, including the original graph, rule checks, and resulting balances.</p><label htmlFor="json-text">Complete trace JSON</label><textarea id="json-text" readOnly spellCheck="false" ref={jsonText} value={traceJson(scenario)} /><div className="dialog-actions"><button className="button quiet" id="copy-json" type="button" onClick={copyJson}>Copy JSON</button><p id="copy-status" role="status">{copyStatus}</p></div></dialog><PageTransition reduced={reduced} />
  </div></MotionPaused.Provider>;
}
