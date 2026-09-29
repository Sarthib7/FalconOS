import React, { useEffect, useRef, useState } from 'react';
import { Badge } from './ui.jsx';
import { connectorObservation, meshReady } from './api.mjs';

const HEALTH = { ready: ['READY', 'ok'], unavailable: ['UNAVAILABLE', 'warn'], unreachable: ['UNREACHABLE', 'warn'] };
const settle = promise => promise.then(value => ({ value }), error => ({ error: error.message }));
const number = value => String(value).padStart(2, '0');

function ConnectorRow({ index, connector, live }) {
  const status = live.graph ? connectorObservation(live.graph, connector.id) : null, reason = status?.reasonCode;
  return <div className="connection-row" data-connector={connector.id}><div className="connection-symbol mono">{number(3 + index)}</div><div><h3>{connector.label}</h3><p>{connector.network ? `A registered source connector for the ${connector.network} network.` : 'A registered document source connector.'}</p><details><summary>Inspect the connector boundary</summary><p>Connector evidence can support an OBSERVED result for its own source. It does not establish lending liquidity, wallet ownership or authorize a transaction.</p><dl className="facts"><div><dt>Connector</dt><dd>{connector.id}</dd></div><div><dt>Network</dt><dd>{connector.network ?? 'None (document source)'}</dd></div>{reason && <div><dt>Reason</dt><dd>{reason}</dd></div>}</dl>{/^https:\/\//.test(connector.sourceUrl) && <a className="btn" href={connector.sourceUrl} target="_blank" rel="noopener noreferrer" style={{ marginTop: 16 }}>Source ↗</a>}</details></div><Badge kind={status?.kind ?? 'warn'}>{status?.label ?? 'UNKNOWN'}</Badge></div>;
}

export default function Connections({ saved, canPersist, storageMessage, api, connection }) {
  const connected = Boolean(connection?.connected), apiRef = useRef(api);
  apiRef.current = api;
  const [health, setHealth] = useState(null), [live, setLive] = useState({ phase: 'idle' });
  useEffect(() => {
    let current = true; setHealth(null);
    meshReady().then(result => { if (current) setHealth(result); });
    return () => { current = false; };
  }, [connected]);
  useEffect(() => {
    if (!connected) { setLive({ phase: 'idle' }); return undefined; }
    let current = true; setLive({ phase: 'loading' });
    Promise.all([settle(apiRef.current('/v1/connectors')), settle(apiRef.current('/v1/graph/live'))]).then(([connectors, graph]) => {
      if (current) setLive(connectors.error ? { phase: 'error', error: connectors.error } : { phase: 'ready', connectors: connectors.value.connectors ?? [], graph: graph.value?.graph, graphError: graph.error });
    });
    return () => { current = false; };
  }, [connected]);
  const [healthLabel, healthKind] = health ? HEALTH[health.status] ?? HEALTH.unavailable : ['CHECKING', ''];
  const loading = connected && live.phase !== 'ready' && live.phase !== 'error', connectors = connected && live.phase === 'ready' ? live.connectors : null;
  return <><section className="panel"><header className="panel-head"><div><p className="eyebrow">Connection register</p><h2>Know the source of each state.</h2></div><Badge kind="info">PREVIEW</Badge></header>
    <div className="connection-row"><div className="connection-symbol mono">01</div><div><h3>Browser treasury simulation</h3><p>Runs the fixed treasury rules on synthetic USDC. Your own simulation is saved only in this browser.</p><details><summary>Storage and authority</summary><p>The preview uses its own record. Existing treasury and advisory records are untouched. The simulation can neither sign nor submit transactions.</p><p>{canPersist ? 'Safe browser persistence is available in this environment.' : storageMessage || 'Web Locks or secure browser APIs are unavailable. Sample inspection remains available.'}</p></details></div><Badge kind={canPersist ? 'ok' : 'warn'}>{saved ? 'LOCAL RECORD' : canPersist ? 'AVAILABLE' : 'READ ONLY'}</Badge></div>
    <div className="connection-row"><div className="connection-symbol mono">02</div><div><h3>Persistent knowledge mesh</h3><p>The product service retains source revisions and analyses. The Knowledge view reads them once you connect with an access token.</p><p>Service health: <span id="mesh-health"><Badge kind={healthKind}>{healthLabel}</Badge></span></p><details><summary>What a connection would provide</summary><ul><li>Authenticated access to an owner’s source records.</li><li>Current graph snapshots and retained analysis history.</li><li>Source capture status and failure details.</li></ul><p>Nothing is requested until you connect in the Knowledge view. The token stays in this tab’s memory and is discarded on reload.</p><a className="btn" href="/mesh/" style={{ marginTop: 16 }}>Open knowledge mesh ↗</a></details></div><Badge kind={connected ? 'ok' : ''}>{connected ? 'CONNECTED' : 'DISCONNECTED'}</Badge></div>
    {!connected && <><div className="connection-row"><div className="connection-symbol mono">03</div><div><h3>Kamino deployment documentation</h3><p>A registered source connector for the official program deployment README.</p><details><summary>Inspect the connector boundary</summary><p>Document evidence can establish a stated deployment reference. It does not establish lending liquidity or authorize a transaction.</p><a className="btn" href="https://github.com/Kamino-Finance/klend/blob/master/README.md" target="_blank" rel="noopener noreferrer" style={{ marginTop: 16 }}>Official source ↗</a></details></div><Badge>CONNECT TO VIEW</Badge></div>
    <div className="connection-row"><div className="connection-symbol mono">04</div><div><h3>Solana Devnet program account</h3><p>A registered source connector checks the Devnet network identity and the Kamino program account.</p><details><summary>Inspect the connector boundary</summary><p>Account and document evidence can support an OBSERVED result. Lending usability and wallet ownership are not assessed.</p><dl className="facts"><div><dt>Network</dt><dd>Solana Devnet</dd></div><div><dt>Program</dt><dd>KLend2g3cP87fffoy8q1mQqGKjrxjC8boSyAYavgmjD</dd></div></dl></details></div><Badge>CONNECT TO VIEW</Badge></div></>}
    {loading && <div className="connection-row" id="connectors-loading"><div className="connection-symbol mono">03</div><div><h3>Source connectors</h3><p>Reading the connector registry and live capture status.</p></div><Badge>LOADING</Badge></div>}
    {connected && live.phase === 'error' && <div className="connection-row" id="connectors-error" role="alert"><div className="connection-symbol mono">03</div><div><h3>Source connectors</h3><p>The connector registry could not be read. {live.error}</p></div><Badge kind="warn">ERROR</Badge></div>}
    {connectors?.length === 0 && <div className="connection-row" id="connectors-empty"><div className="connection-symbol mono">03</div><div><h3>Source connectors</h3><p>The service has no registered source connectors.</p></div><Badge>NONE</Badge></div>}
    {connectors?.map((connector, index) => <ConnectorRow key={connector.id} index={index} connector={connector} live={live} />)}
    {connectors?.length > 0 && live.graphError && <div className="connection-row" id="graph-error" role="alert"><div className="connection-symbol mono">!</div><div><h3>Live capture status unavailable</h3><p>{live.graphError}</p></div><Badge kind="warn">ERROR</Badge></div>}
    <div className="connection-row"><div className="connection-symbol mono">{number(3 + (!connected ? 2 : connectors ? Math.max(connectors.length, 1) : 1))}</div><div><h3>Wallet and execution terminal</h3><p>The repository has a separate wallet-owned Devnet terminal. This preview has no wallet or signing authority.</p><details><summary>Execution status</summary><p>Existing swap research does not prove treasury lending supply or redemption. No lending execution has been verified by this prototype.</p><a className="btn" href="/mesh/#lending-title" style={{ marginTop: 16 }}>Open Devnet lending terminal ↗</a></details></div><Badge>NOT CONNECTED</Badge></div></section>
    <div className="connections-map"><div><p className="eyebrow">Local</p><h3>Treasury record</h3><p>Synthetic commands and outcomes stay in a separate browser record.</p></div><div><p className="eyebrow">Service</p><h3>Knowledge records</h3><p>The product stores source revisions and analyses in its mesh service.</p></div><div><p className="eyebrow">Wallet</p><h3>Devnet records</h3><p>The existing terminal keeps wallet-scoped records. They are not merged here.</p></div></div></>;
}
