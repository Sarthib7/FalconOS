import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { installCommands, resolveInstallConfig } from './install-commands.mjs';

const TABS = [
  { id: 'agent', label: 'Agent' },
  { id: 'human', label: 'Human' },
];

async function copyText(text) {
  if (navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch { /* fall through to the textarea fallback */ }
  }
  const area = document.createElement('textarea');
  area.value = text;
  area.setAttribute('readonly', '');
  area.setAttribute('aria-hidden', 'true');
  area.style.position = 'fixed';
  area.style.top = '0';
  area.style.opacity = '0';
  document.body.appendChild(area);
  area.select();
  area.setSelectionRange(0, text.length);
  let ok = false;
  try { ok = document.execCommand('copy'); } catch { ok = false; }
  area.remove();
  return ok;
}

function CommandBlock({ label, copyLabel, command, note, wrap = false }) {
  const [status, setStatus] = useState('');
  const timer = useRef(0);
  useEffect(() => () => window.clearTimeout(timer.current), []);
  async function copy() {
    const ok = await copyText(command);
    setStatus(ok ? 'Copied' : 'Copy failed, select the text');
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setStatus(''), 4000);
  }
  return <div className="bot-install-block">
    <div className="bot-install-block-head">
      <h3>{label}</h3>
      <button className="btn subtle bot-install-copy" type="button" onClick={() => void copy()} aria-label={copyLabel}>Copy</button>
    </div>
    <pre className={`bot-install-code${wrap ? ' bot-install-code-wrap' : ''}`} tabIndex={0}><code>{command}</code></pre>
    {note && <p className="bot-install-note">{note}</p>}
    <p className="bot-install-status" role="status" aria-live="polite">{status}</p>
  </div>;
}

export default function InstallPanel({ mcpUrl, skillUrl, isProd }) {
  const config = useMemo(() => resolveInstallConfig({ mcpUrl, skillUrl, isProd }), [mcpUrl, skillUrl, isProd]);
  const commands = useMemo(() => installCommands(config), [config]);
  const [tab, setTab] = useState('agent');
  const tabRefs = useRef({});
  const base = useId();
  const ids = (id) => ({ tab: `${base}-tab-${id}`, panel: `${base}-panel-${id}` });

  function onKeyDown(event) {
    const index = TABS.findIndex((item) => item.id === tab);
    let next = -1;
    if (event.key === 'ArrowRight') next = (index + 1) % TABS.length;
    else if (event.key === 'ArrowLeft') next = (index - 1 + TABS.length) % TABS.length;
    else if (event.key === 'Home') next = 0;
    else if (event.key === 'End') next = TABS.length - 1;
    if (next < 0) return;
    event.preventDefault();
    setTab(TABS[next].id);
    tabRefs.current[TABS[next].id]?.focus();
  }

  const unconfigured = config.state === 'unconfigured';
  const notice = config.notice && <p className={`bot-install-notice${unconfigured ? ' bot-install-notice-off' : ''}`}>{config.notice}</p>;

  return <section id="install" className="bot-install" aria-labelledby="bot-install-title">
    <p className="bot-section-kicker">Bring your own agent</p>
    <h2 id="bot-install-title">Add Falcon to your agent</h2>
    <div className="bot-install-tabs" role="tablist" aria-label="Install method" onKeyDown={onKeyDown}>
      {TABS.map((item) => <button
        key={item.id}
        ref={(node) => { tabRefs.current[item.id] = node; }}
        id={ids(item.id).tab}
        className="bot-install-tab"
        type="button"
        role="tab"
        aria-selected={tab === item.id}
        aria-controls={ids(item.id).panel}
        tabIndex={tab === item.id ? 0 : -1}
        onClick={() => setTab(item.id)}
      >{item.label}</button>)}
    </div>

    <div id={ids('agent').panel} className="bot-install-panel" role="tabpanel" aria-labelledby={ids('agent').tab} tabIndex={0} hidden={tab !== 'agent'}>
      {notice}
      {commands.agent.command && <CommandBlock label="Run this in your agent" copyLabel="Copy agent command" command={commands.agent.command} note="Run this in your agent. It prints the Falcon skill; follow it to install the Falcon MCP plugin." />}
      {commands.agent.prompt && <CommandBlock label="Or paste this instead" copyLabel="Copy agent prompt" command={commands.agent.prompt} wrap />}
      <p className="bot-install-honest">Your agent signs with its own wallet. FalconOS never holds your keys and never sends your transaction.</p>
    </div>

    <div id={ids('human').panel} className="bot-install-panel" role="tabpanel" aria-labelledby={ids('human').tab} tabIndex={0} hidden={tab !== 'human'}>
      <p className="bot-install-lead">Add the Falcon MCP server yourself. Devnet only.</p>
      {notice}
      {commands.human.map((item) => <CommandBlock key={item.id} label={item.label} copyLabel={`Copy ${item.label} command`} command={item.command} note={item.note} />)}
    </div>
  </section>;
}
