import { useState } from 'react';
import falconMark from '../landing/assets/falcon.svg';
import { MCP_CLI_COMMAND, MCP_CODEX_CLI_COMMAND, MCP_JSON_CONFIG, SKILL_FETCH_COMMAND } from './install.mjs';
import './style.css';
const SKILL_COMMAND = SKILL_FETCH_COMMAND;

function CopyControl({ value, label }) {
  const [status, setStatus] = useState('');

  async function copy(event) {
    const button = event.currentTarget;
    try {
      await navigator.clipboard.writeText(value);
      setStatus('Copied');
    } catch {
      const container = button.closest('.install-card') || button.closest('pre');
      const code = container?.querySelector('pre code') || container?.querySelector('code');
      if (code) {
        const range = document.createRange();
        range.selectNodeContents(code);
        const selection = window.getSelection();
        selection?.removeAllRanges();
        selection?.addRange(range);
      }
      setStatus('Text selected. Use your copy shortcut.');
    }
  }

  return (
    <span className="copy-control">
      <button type="button" onClick={copy} aria-label={label}>Copy</button>
      <span aria-live="polite">{status}</span>
    </span>
  );
}

function InstallCard({ title, description, value, label }) {
  return (
    <article className="install-card">
      <div className="install-card-heading">
        <div><h3>{title}</h3>{description && <p>{description}</p>}</div>
        <CopyControl value={value} label={label} />
      </div>
      <pre><code>{value}</code></pre>
    </article>
  );
}

export default function App() {
  return (
    <div className="agents-page">
      <header className="agents-nav">
        <a className="agents-brand" href="/" aria-label="FalconOS">
          <img src={falconMark} alt="" />
          <span><b>FALCON</b><strong>OS</strong></span>
        </a>
        <nav aria-label="Page navigation">
          <a href="/SKILLS.md">SKILLS.md</a>
          <a href="#install">MCP setup</a>
        </nav>
      </header>

      <main>
        <section className="agents-hero" aria-labelledby="page-title">
          <h1 id="page-title">Bring Falcon to your agent.</h1>
          <p className="agents-lede">Start with the skill. It explains setup and when to ask you to approve a transaction.</p>
          <a className="agents-primary" href="/SKILLS.md">Read the skill</a>
        </section>
        <section className="agents-skill-link" aria-labelledby="skill-entry-title">
          <div>
            <h2 id="skill-entry-title">Get the skill</h2>
            <p>Run this command to read it.</p>
          </div>
          <pre><code>{SKILL_COMMAND}</code><CopyControl value={SKILL_FETCH_COMMAND} label="Copy skill fetch command" /></pre>
        </section>

        <section id="install" className="agents-install" aria-labelledby="install-title">
          <div className="section-heading">
            <h2 id="install-title">Add Falcon to your agent</h2>
            <p>Choose your client, restart it, and look for all ten Falcon tools.</p>
          </div>
          <div className="install-grid">
            <InstallCard title="Claude Code" description="" value={MCP_CLI_COMMAND} label="Copy Claude Code command" />
            <InstallCard title="Codex" description="" value={MCP_CODEX_CLI_COMMAND} label="Copy Codex command" />
            <InstallCard title="Other MCP clients" description="Paste this into your MCP settings." value={MCP_JSON_CONFIG} label="Copy MCP configuration" />
          </div>
        </section>

        <section className="agents-boundary" aria-labelledby="boundary-title">
          <div>
            <h2 id="boundary-title">Your wallet stays yours.</h2>
            <p>The site never connects to your wallet. Your agent signs in with its own wallet. That signature proves ownership. It does not approve a transaction. You approve each transaction signature and broadcast. Falcon never holds keys or broadcasts transactions. Devnet only.</p>
          </div>
        </section>

      </main>

      <footer className="agents-footer">
        <a className="agents-brand" href="/" aria-label="FalconOS home"><img src={falconMark} alt="" /><span><b>FALCON</b><strong>OS</strong></span></a>
        <p>Setup guide only. No wallet connection here.</p>
      </footer>
    </div>
  );
}
