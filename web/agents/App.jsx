import { useState } from 'react';
import falconMark from '../landing/assets/falcon.svg';
import { MCP_CLI_COMMAND, MCP_JSON_CONFIG, SKILL_FETCH_COMMAND } from './install.mjs';
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
    <div className="copy-control">
      <button type="button" onClick={copy} aria-label={label}>Copy</button>
      <span aria-live="polite">{status}</span>
    </div>
  );
}

function InstallCard({ title, description, value, label }) {
  return (
    <article className="install-card">
      <div className="install-card-heading">
        <div><h3>{title}</h3><p>{description}</p></div>
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
          <a href="#install">Install</a>
          <a href="/SKILLS.md">SKILLS.md</a>
        </nav>
      </header>

      <main>
        <section className="agents-hero" aria-labelledby="page-title">
          <p className="agents-eyebrow">FALCON · PERSONAL PLUGIN</p>
          <h1 id="page-title">Falcon, in your agent.</h1>
          <p className="agents-lede">Add Falcon's MCP server to your agent environment, then load the skill guide.</p>
          <a className="agents-primary" href="#install">Set up Falcon <span aria-hidden="true">↓</span></a>
        </section>

        <section id="install" className="agents-install" aria-labelledby="install-title">
          <div className="section-heading">
            <p className="agents-eyebrow">SETUP</p>
            <h2 id="install-title">Connect your MCP client</h2>
            <p>Use one command in Claude Code, or add the HTTP server entry to another MCP client.</p>
          </div>
          <div className="install-grid">
            <InstallCard title="Claude Code" description="Add Falcon's hosted HTTP MCP server." value={MCP_CLI_COMMAND} label="Copy Claude Code command" />
            <InstallCard title="Other MCP clients" description="Add this entry to your client's MCP server configuration." value={MCP_JSON_CONFIG} label="Copy MCP configuration" />
          </div>
          <div className="agents-skill-card">
            <div><p className="agents-eyebrow">AGENT GUIDE</p><h3>Load SKILLS.md</h3><p>Read the tool list, Devnet limits, wallet rules, and signing order before use.</p></div>
            <a href="/SKILLS.md">Open SKILLS.md <span aria-hidden="true">↗</span></a>
          </div>
        </section>

        <section className="agents-boundary" aria-labelledby="boundary-title">
          <div className="boundary-mark" aria-hidden="true">F</div>
          <div>
            <p className="agents-eyebrow">WALLET BOUNDARY</p>
            <h2 id="boundary-title">This page never connects a wallet.</h2>
            <p>The MCP tools support Solana Devnet actions. Your agent uses its own wallet, and you approve each signature and broadcast. Falcon does not hold keys or broadcast transactions. Mainnet is not supported.</p>
          </div>
        </section>

        <section className="agents-skill-link" aria-label="Download the agent skill">
          <div><h2>Read or fetch the skill</h2><p>Give your agent the public Falcon setup and safety guide.</p></div>
          <pre><code>{SKILL_COMMAND}</code><CopyControl value={SKILL_FETCH_COMMAND} label="Copy skill fetch command" /></pre>
        </section>
      </main>

      <footer className="agents-footer">
        <a className="agents-brand" href="/" aria-label="FalconOS home"><img src={falconMark} alt="" /><span><b>FALCON</b><strong>OS</strong></span></a>
        <p>Agent install only. No wallet connection on this site.</p>
      </footer>
    </div>
  );
}
