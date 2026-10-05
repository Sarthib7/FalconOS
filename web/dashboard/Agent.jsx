import { useEffect, useMemo, useRef, useState } from 'react';
import { ConnectGate } from './Knowledge.jsx';
import { createYieldAgentStore, parseBpsInput, parseUsdcInput } from './agent-store.mjs';
import { parseAgentIntent } from './agent-intent.mjs';
import { formatUsdc } from '../treasury/domain.mjs';
import { Badge } from './ui.jsx';

const INITIAL = { total: '1000', reserve: '100', cap: '900', concentration: '50', venues: '2' };
const usd = units => '$' + formatUsdc(String(units));
const percent = bps => (bps / 100).toFixed(2) + '%';
const moneyCents = value => { const amount = BigInt(value); return '$' + (amount / 100n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',') + '.' + (amount % 100n).toString().padStart(2, '0'); };
const when = value => value ? new Date(value).toISOString().slice(0, 19).replace('T', ' ') + ' UTC' : 'Unavailable';
const uuid = () => crypto.randomUUID();

function Message({ item }) {
  return <article className={`agent-message agent-message-${item.role}`}><span className="agent-message-role">{item.role === 'user' ? 'YOU' : 'FALCON AGENT'}</span><p>{item.text}</p></article>;
}

export default function Agent({ api, connection, ownerId = null, chatOnly = false }) {
  const store = useMemo(() => createYieldAgentStore(ownerId ? { key: `falconos.yield.agent.simulation.v1:${ownerId}` } : undefined), [ownerId]);
  const apiRef = useRef(api);
  apiRef.current = api;
  const [simulation, setSimulation] = useState(null), [storeError, setStoreError] = useState('');
  const [catalog, setCatalog] = useState(null), [catalogError, setCatalogError] = useState(''), [loadingCatalog, setLoadingCatalog] = useState(false);
  const [busy, setBusy] = useState(false), [command, setCommand] = useState(''), [setup, setSetup] = useState(INITIAL);
  const [policyForm, setPolicyForm] = useState(null), [messages, setMessages] = useState([{ id: 'welcome', role: 'agent', text: chatOnly ? "Hey, I'm Falcon. What do you want me to invest in? Set your simulated limits, then ask me to find yields or plan an allocation. Nothing moves here." : 'I manage a local USDC yield simulation. Ask me to find yields, simulate an allocation, explain the last plan, or show commands.' }]);
  const [lastPlan, setLastPlan] = useState(null);
  function speak(text, role = 'agent') { setMessages(current => [...current, { id: uuid(), role, text }]); }
  function loadState() {
    try {
      const value = store.load(); setSimulation(value); setStoreError('');
      setPolicyForm(value ? { cap: formatUsdc(value.policy.investmentCapUnits), concentration: (value.policy.maxVenueConcentrationBps / 100).toString(), venues: String(value.policy.maxVenues) } : null);
      if (value?.receipts?.length) setLastPlan(value.receipts.at(-1));
    } catch (error) { setStoreError(error.message); }
  }
  useEffect(() => { loadState(); }, [store]);
  async function refreshCatalog() {
    if (!connection.connected) return null;
    setLoadingCatalog(true); setCatalogError('');
    try {
      const result = await apiRef.current('/v1/yield/opportunities');
      setCatalog(result); return result;
    } catch (error) { setCatalogError(error.message); throw error; }
    finally { setLoadingCatalog(false); }
  }
  useEffect(() => { if (connection.connected && !chatOnly) void refreshCatalog().catch(() => {}); }, [connection.connected, chatOnly]);
  function updateSetup(key, value) { setSetup(current => ({ ...current, [key]: value })); }
  async function createSimulation(event) {
    event.preventDefault(); setStoreError('');
    try {
      const total = BigInt(parseUsdcInput(setup.total)), reserve = BigInt(parseUsdcInput(setup.reserve)), cap = BigInt(parseUsdcInput(setup.cap));
      if (total <= 0n || reserve > total || cap <= 0n || cap > total - reserve) throw new Error('Set a positive total, keep the reserve within the total, and keep the investment cap within idle USDC.');
      const initialPortfolio = { totalUnits: total.toString(), reserveUnits: reserve.toString(), undelegatedUnits: '0', idleUnits: (total - reserve).toString(), positions: [] };
      const initialPolicy = { investmentCapUnits: cap.toString(), maxVenueConcentrationBps: parseBpsInput(setup.concentration), maxVenues: Number(setup.venues) };
      if (!Number.isInteger(initialPolicy.maxVenues) || initialPolicy.maxVenues < 1 || initialPolicy.maxVenues > 5) throw new Error('Choose between 1 and 5 protocols.');
      const saved = await store.initialize(initialPortfolio, initialPolicy); setSimulation(saved); setPolicyForm({ cap: formatUsdc(saved.policy.investmentCapUnits), concentration: (saved.policy.maxVenueConcentrationBps / 100).toString(), venues: String(saved.policy.maxVenues) });
      speak('Local simulation created. No wallet was connected and no funds moved.');
    } catch (error) { setStoreError(error.message); }
  }
  async function savePolicy(event) {
    event.preventDefault(); if (!simulation) return;
    setStoreError('');
    try {
      const nextPolicy = { investmentCapUnits: parseUsdcInput(policyForm.cap), maxVenueConcentrationBps: parseBpsInput(policyForm.concentration), maxVenues: Number(policyForm.venues) };
      if (!Number.isInteger(nextPolicy.maxVenues) || nextPolicy.maxVenues < 1 || nextPolicy.maxVenues > 5) throw new Error('Choose between 1 and 5 protocols.');
      const saved = await store.updatePolicy(nextPolicy, simulation.revision); setSimulation(saved); setLastPlan(null); speak('Simulation rules saved. Earlier plans remain in the local receipt history.');
    } catch (error) { setStoreError(error.message); loadState(); }
  }
  async function runCommand(text) {
    const intent = parseAgentIntent(text);
    speak(text, 'user'); setCommand('');
    if (intent.type === 'help') { speak('Supported requests: “find Solana USDC yields”, “simulate allocation”, and “explain last plan”. Other instructions do not run.'); return; }
    if (intent.type === 'unsupported') { speak('I did not run that request. Ask for yields, a simulation, an explanation, or “help”.'); return; }
    if (!connection.connected) { speak('Connect to the mesh service before requesting live yield data.'); return; }
    if (intent.type === 'discover') {
      try { const result = await refreshCatalog(); speak(`Yield catalog refreshed: ${result.coverage?.eligibleOpportunities ?? result.opportunities?.length ?? 0} eligible opportunities. Data is provider-indexed, not a complete venue list.`); }
      catch (error) { speak(`Yield discovery failed: ${error.message}`); }
      return;
    }
    if (intent.type === 'explain') {
      const plan = lastPlan ?? simulation?.receipts?.at(-1);
      if (!plan) { speak('No saved plan exists. Create a local simulation and ask me to simulate allocation.'); return; }
      speak(`Last plan: ${plan.status}. ${plan.reason ?? (plan.flows?.length ? plan.flows.map(flow => `${flow.type} ${usd(flow.amountUnits)} ${flow.type === 'SUPPLY' ? 'to' : 'from'} ${flow.type === 'SUPPLY' ? flow.to.poolId : flow.from.poolId}`).join('; ') : 'No portfolio movement was proposed.') } Costs remain unknown. No funds moved.`);
      return;
    }
    if (intent.type === 'simulate') {
      if (!simulation) { speak('Create a local simulation before asking for an allocation.'); return; }
      setBusy(true);
      try {
        const result = await apiRef.current('/v1/yield/simulations', { requestId: uuid(), simulatedAt: new Date().toISOString(), portfolio: simulation.portfolio, policy: simulation.policy });
        const plan = result.plan; setLastPlan(plan);
        if (plan?.mode === 'simulation' && plan.executionReady === false && ['SIMULATED', 'HOLD'].includes(plan.status)) {
          const saved = await store.applyPlan(plan, simulation.revision); setSimulation(saved); setLastPlan(plan);
          speak(`${plan.status}: local portfolio updated from the provider snapshot. ${plan.allocations.length} protocol target(s), ${plan.flows.length} simulated movement(s). Route and transfer costs are unknown. No funds moved.`);
        } else speak(`${plan?.status ?? 'REVIEW'}: ${plan?.reason ?? 'The service did not return an applicable simulation.'} The local portfolio was not changed.`);
      } catch (error) { speak(`Simulation failed. The local portfolio was not changed: ${error.message}`); }
      finally { setBusy(false); loadState(); }
    }
  }
  function submit(event) { event.preventDefault(); if (busy || !command.trim()) return; void runCommand(command.trim()); }
  const holdings = simulation?.portfolio.positions ?? [];
  const reserve = simulation ? BigInt(simulation.portfolio.reserveUnits) : 0n;
  const invested = holdings.reduce((sum, position) => sum + BigInt(position.units), 0n);
  const idle = simulation ? BigInt(simulation.portfolio.idleUnits) : 0n;
  const latestReceipt = lastPlan ?? simulation?.receipts?.at(-1) ?? null;
  const opportunities = catalog?.opportunities ?? [];
  if (chatOnly) return <main className="agent-page bot-chat-shell">
    <div className="bot-chat-heading"><div><h1>Falcon</h1><p>Solana USDC · read-only data · simulation only</p></div><button className="bot-chat-signout" type="button" onClick={() => void connection.disconnect()}>Sign out</button></div>
    <section className="bot-chat-window" aria-label="Chat with Falcon">
      <div className="bot-chat-thread" aria-live="polite">
        {messages.slice(-30).map(item => <Message key={item.id} item={item} />)}
        {!simulation && <form className="bot-chat-setup" onSubmit={createSimulation}><h2>Set your simulation limits</h2><p>These are paper values, not wallet balances.</p><div className="bot-chat-setup-grid"><label className="field"><span>Simulated total USDC</span><input inputMode="decimal" value={setup.total} onChange={e => updateSetup('total', e.target.value)} required /></label><label className="field"><span>Protected reserve</span><input inputMode="decimal" value={setup.reserve} onChange={e => updateSetup('reserve', e.target.value)} required /></label><label className="field"><span>Investment cap</span><input inputMode="decimal" value={setup.cap} onChange={e => updateSetup('cap', e.target.value)} required /></label><label className="field"><span>Max protocol share (%)</span><input inputMode="decimal" value={setup.concentration} onChange={e => updateSetup('concentration', e.target.value)} required /></label><label className="field"><span>Max protocols</span><input type="number" min="1" max="5" step="1" value={setup.venues} onChange={e => updateSetup('venues', e.target.value)} required /></label></div><button className="btn primary" type="submit" disabled={busy}>Create simulation</button>{storeError && <p className="field-error" role="alert">{storeError}</p>}</form>}
        {simulation && <div className="bot-chat-summary"><strong>Local simulation</strong><br />Reserve {usd(reserve.toString())} · Invested {usd(invested.toString())} · Idle {usd(idle.toString())}</div>}
        {storeError && simulation && <p className="field-error" role="alert">{storeError}</p>}
        {catalogError && <p className="field-error" role="alert">{catalogError}</p>}
        {catalog && <div className="bot-chat-results"><h2>{catalog.status === 'READY' ? `${opportunities.length} provider-indexed opportunities` : 'Yield data unavailable'}</h2><p className="agent-data-stamp">Source: {catalog.provider} · Retrieved {when(catalog.retrievedAt)} · Market time {when(catalog.providerAsOf)}</p>{opportunities.slice(0, 6).map(item => <article className="bot-chat-result" key={item.poolId}><strong>{item.project} · {item.symbol}</strong><p>Base APY {percent(item.baseApyBps)} · Solana native USDC</p><code>{item.poolId}</code></article>)}</div>}
        {latestReceipt && <div className="bot-chat-summary"><strong>Latest plan · {latestReceipt.status}</strong><br /><span>{latestReceipt.reason ?? `${latestReceipt.flows?.length ?? 0} simulated flow(s).`}</span><br /><span>Costs {latestReceipt.costs?.status ?? 'UNKNOWN'} · Execution disabled</span></div>}
      </div>
      <div className="bot-chat-controls"><div className="agent-quick-actions"><button className="btn subtle" type="button" disabled={busy || loadingCatalog} onClick={() => void runCommand('find Solana USDC yields')}>{loadingCatalog ? 'Finding…' : 'Find yields'}</button><button className="btn subtle" type="button" disabled={busy || !simulation} onClick={() => void runCommand('simulate allocation')}>Simulate allocation</button><button className="btn subtle" type="button" disabled={busy} onClick={() => void runCommand('explain last plan')}>Explain last plan</button></div><form className="agent-chat-form" onSubmit={submit}><label className="field"><span>Message Falcon</span><input id="agent-request" value={command} onChange={e => setCommand(e.target.value)} maxLength="280" placeholder="Try “find Solana USDC yields”" aria-label="Message Falcon" /></label><button id="agent-send" className="btn primary" type="submit" disabled={busy || !command.trim()}>{busy ? 'Working…' : 'Send'}</button></form><p className="bot-chat-footnote">Supported requests: find yields, simulate allocation, explain last plan. Other text cannot change the simulation. No funds move.</p></div>
    </section>
  </main>;
  return <div className="agent-page">
    {!connection.connected ? <><section className="panel agent-intro"><div className="panel-body"><p className="eyebrow">Yield Agent / Access</p><h2>One owner-controlled USDC simulation.</h2><p className="detail-copy">Connect to the mesh service to read current provider-indexed Solana lending data. The agent never signs, submits transactions, or moves funds.</p></div></section><ConnectGate connection={connection} purpose="agent" /></> : <>
      <section className="panel agent-warning"><div><p className="eyebrow">Simulation only</p><strong>No wallet signing. No live deposits. No withdrawals.</strong><p className="detail-copy">The local portfolio and its receipts stay in this browser. Provider APY is not guaranteed. Costs and source market time can be unknown.</p></div><div className="agent-connect-actions"><Badge>{busy ? 'SIMULATING' : 'READ-ONLY DATA'}</Badge><button className="btn subtle" type="button" onClick={connection.disconnect}>Disconnect</button></div></section>
      <div className="agent-layout">
        <div className="od-stack">
          <section className="panel"><header className="panel-head"><div><p className="eyebrow">01 / Local portfolio</p><h2>Capital limits</h2></div><button className="btn subtle" type="button" onClick={() => { loadState(); }}>Reload local state</button></header><div className="panel-body">
            {!simulation ? <form className="agent-form" onSubmit={createSimulation}><p className="detail-copy">These values create a browser-local simulation. They do not describe a wallet or an actual balance.</p><label className="field"><span>Simulated total USDC</span><input inputMode="decimal" value={setup.total} onChange={e => updateSetup('total', e.target.value)} required /></label><label className="field"><span>Protected reserve USDC</span><input inputMode="decimal" value={setup.reserve} onChange={e => updateSetup('reserve', e.target.value)} required /></label><label className="field"><span>Maximum investment USDC</span><input inputMode="decimal" value={setup.cap} onChange={e => updateSetup('cap', e.target.value)} required /></label><label className="field"><span>Maximum protocol share (%)</span><input inputMode="decimal" value={setup.concentration} onChange={e => updateSetup('concentration', e.target.value)} required /></label><label className="field"><span>Maximum protocols</span><input type="number" min="1" max="5" step="1" value={setup.venues} onChange={e => updateSetup('venues', e.target.value)} required /></label><button id="agent-create" className="btn primary" type="submit" disabled={busy}>Create local simulation</button></form> : <>
              <div className="agent-stats"><div><span className="label">Simulated total</span><strong>{usd(simulation.portfolio.totalUnits)}</strong></div><div><span className="label">Protected reserve</span><strong>{usd(reserve.toString())}</strong></div><div><span className="label">Invested</span><strong>{usd(invested.toString())}</strong></div><div><span className="label">Idle</span><strong>{usd(idle.toString())}</strong></div></div>
              <form className="agent-policy" onSubmit={savePolicy}><h3>Allocation rules</h3><label className="field"><span>Investment cap (USDC)</span><input inputMode="decimal" value={policyForm?.cap ?? ''} onChange={e => setPolicyForm(current => ({ ...current, cap: e.target.value }))} required /></label><label className="field"><span>Maximum protocol share (%)</span><input inputMode="decimal" value={policyForm?.concentration ?? ''} onChange={e => setPolicyForm(current => ({ ...current, concentration: e.target.value }))} required /></label><label className="field"><span>Maximum protocols</span><input type="number" min="1" max="5" step="1" value={policyForm?.venues ?? ''} onChange={e => setPolicyForm(current => ({ ...current, venues: e.target.value }))} required /></label><button className="btn" type="submit" disabled={busy}>Save rules</button></form>
              <p className="agent-footnote">Policy is enforced in the simulation. A policy change invalidates pending plans.</p>
            </>}
            {storeError && <p className="field-error" role="alert">{storeError}</p>}
          </div></section>
          <section className="panel"><header className="panel-head"><div><p className="eyebrow">02 / Opportunities</p><h2>Solana USDC lending</h2></div><button className="btn subtle" type="button" onClick={() => void refreshCatalog().catch(() => {})} disabled={loadingCatalog}>{loadingCatalog ? 'Refreshing…' : 'Refresh data'}</button></header><div className="panel-body"><p className="detail-copy">Provider-indexed data only. Ranked by base APY, then TVL. TVL is not withdrawable liquidity. This is not a complete list of venues.</p>{catalogError && <p className="field-error" role="alert">{catalogError}</p>}{catalog && <p className="agent-data-stamp">{catalog.coverage?.eligibleOpportunities ?? opportunities.length} eligible · Retrieved {when(catalog.retrievedAt)} · Market time {when(catalog.providerAsOf)}</p>}{opportunities.length ? <div className="agent-opportunities" role="list">{opportunities.slice(0, 8).map(item => <article className="agent-opportunity" role="listitem" key={item.poolId}><div><strong>{item.protocolName ?? item.project}</strong><span className="small muted">{item.project} · {item.poolId}</span></div><div className="agent-opportunity-metric"><strong>{percent(item.baseApyBps)}</strong><span className="small muted">base APY</span></div><div className="agent-opportunity-metric"><strong>{moneyCents(item.tvlUsdCents)}</strong><span className="small muted">TVL</span></div></article>)}</div> : <p className="agent-empty">{loadingCatalog ? 'Loading provider data…' : catalog ? 'No eligible opportunities were returned.' : 'Connect to load provider data.'}</p>}</div></section>
        </div>
        <div className="od-stack">
          <section className="panel"><header className="panel-head"><div><p className="eyebrow">03 / Agent desk</p><h2>Ask for a bounded action</h2></div><Badge>SIMULATION ONLY</Badge></header><div className="agent-chat">
            <div className="agent-messages" aria-live="polite">{messages.slice(-30).map(item => <Message key={item.id} item={item} />)}</div>
            <div className="agent-quick-actions"><button className="btn subtle" type="button" disabled={busy || !connection.connected} onClick={() => void runCommand('find Solana USDC yields')}>Find yields</button><button className="btn subtle" type="button" disabled={busy || !simulation} onClick={() => void runCommand('simulate allocation')}>Simulate allocation</button><button className="btn subtle" type="button" disabled={busy} onClick={() => void runCommand('explain last plan')}>Explain last plan</button></div>
            <form className="agent-chat-form" onSubmit={submit}><label className="field"><span>Request</span><input id="agent-request" value={command} onChange={e => setCommand(e.target.value)} maxLength="280" placeholder="Try: find Solana USDC yields" aria-label="Agent request" /></label><button id="agent-send" className="btn primary" type="submit" disabled={busy || !command.trim()}>{busy ? 'Working…' : 'Send'}</button></form>
            <p className="agent-footnote">Only fixed discovery, simulation, explanation, and help requests run. Unknown requests do not change state.</p>
          </div></section>
          <section className="panel"><header className="panel-head"><div><p className="eyebrow">04 / Latest receipt</p><h2>Cash Trace</h2></div><Badge>{latestReceipt?.status ?? 'NO PLAN'}</Badge></header><div className="panel-body">{latestReceipt ? <><p className="detail-copy">{latestReceipt.reason ?? 'Simulation plan saved to this browser.'}</p><p className="agent-data-stamp">Retrieved {when(latestReceipt.sourceSnapshot?.retrievedAt)} · Costs {latestReceipt.costs?.status ?? 'UNKNOWN'} · Execution {latestReceipt.executionReady ? 'available' : 'disabled'}</p>{latestReceipt.flows?.length ? <div className="agent-flow-list">{latestReceipt.flows.map((flow, index) => { const poolId = flow.type === 'SUPPLY' ? flow.to.poolId : flow.from.poolId; const allocation = latestReceipt.allocations?.find(item => item.poolId === poolId); const from = flow.type === 'SUPPLY' ? 'Idle USDC' : poolId; const to = flow.type === 'SUPPLY' ? poolId : 'Idle USDC'; const policyBps = latestReceipt.policy?.maxVenueConcentrationBps; return <div className="agent-flow" key={index}><strong>{flow.type}</strong><span>{from} → {to}</span><span>{usd(flow.amountUnits)} USDC · Solana</span><span>{allocation ? percent(allocation.baseApyBps) + ' base APY' : 'Rate unavailable'} · Retrieved {when(latestReceipt.sourceSnapshot?.retrievedAt)}</span><span>Costs {latestReceipt.costs?.status ?? 'UNKNOWN'}</span><span>Policy: {policyBps == null ? 'Unavailable' : percent(policyBps)} maximum venue share</span></div>; })}</div> : <p className="agent-empty">No movement was proposed.</p>}{latestReceipt.warnings?.map(warning => <p className="agent-footnote" key={warning}>{warning}</p>)}</> : <p className="agent-empty">No plan yet. A simulation will show its source snapshot, constraints, and proposed movements here.</p>}</div></section>
        </div>
      </div>
    </>}
  </div>;
}
