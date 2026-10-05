import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { installCommands, resolveSkillConfig } from './install-commands.mjs';

const TABS = [
  { id: 'human', label: 'Human' },
  { id: 'agent', label: 'Agent' },
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

function AgentCommand({ command }) {
  const [status, setStatus] = useState('');
  const timer = useRef(0);
  useEffect(() => () => window.clearTimeout(timer.current), []);
  async function copy() {
    const ok = await copyText(command);
    setStatus(ok ? 'Copied' : 'Copy failed, select the text');
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setStatus(''), 4000);
  }
  return (
    <div className="bot-install-block bot-install-block-compact">
      <div className="bot-install-block-head">
        <pre className="bot-install-code" tabIndex={0}><code>{command}</code></pre>
        <button className="btn subtle bot-install-copy" type="button" onClick={() => void copy()} aria-label="Copy agent command">Copy</button>
      </div>
      <p className="bot-install-status" role="status" aria-live="polite">{status}</p>
    </div>
  );
}

// tab and onTabChange are controlled by the parent so the nav Log-in link can
// force-switch to Human from outside without touching internal state.
export default function InstallPanel({ skillUrl, isProd, children, tab, onTabChange }) {
  const config = useMemo(() => resolveSkillConfig({ skillUrl, isProd }), [skillUrl, isProd]);
  const commands = useMemo(() => installCommands(config), [config]);
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
    onTabChange(TABS[next].id);
    tabRefs.current[TABS[next].id]?.focus();
  }

  const isAgent = tab === 'agent';

  return (
    <section id="install" className={`bot-install${isAgent ? ' bot-install--agent' : ''}`} aria-labelledby="bot-install-title">
      <div className="bot-install-header">
        <h2 id="bot-install-title">Get started</h2>
        <div className="bot-install-tabs" role="tablist" aria-label="Access method" onKeyDown={onKeyDown}>
          {TABS.map((item) => (
            <button
              key={item.id}
              ref={(node) => { tabRefs.current[item.id] = node; }}
              id={ids(item.id).tab}
              className="bot-install-tab"
              type="button"
              role="tab"
              aria-selected={tab === item.id}
              aria-controls={ids(item.id).panel}
              tabIndex={tab === item.id ? 0 : -1}
              onClick={() => onTabChange(item.id)}
            >{item.label}</button>
          ))}
        </div>
      </div>

      <div
        id={ids('human').panel}
        className="bot-install-panel"
        role="tabpanel"
        aria-labelledby={ids('human').tab}
        tabIndex={0}
        hidden={tab !== 'human'}
      >
        {children}
      </div>

      <div
        id={ids('agent').panel}
        className="bot-install-panel bot-install-panel--agent"
        role="tabpanel"
        aria-labelledby={ids('agent').tab}
        tabIndex={0}
        hidden={tab !== 'agent'}
      >
        {commands.agent.command
          ? <AgentCommand command={commands.agent.command} />
          : <p className="bot-install-notice bot-install-notice-off">Skill endpoint not available.</p>}
      </div>
    </section>
  );
}
