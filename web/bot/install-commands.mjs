// Pure helpers for the "Add Falcon to your agent" panel and the published skill.
// No DOM and no import.meta.env here, so node --test and vite.config files can import it.
// The URLs end up inside a command the human pastes into a shell, so they are checked
// against a strict allowlist instead of a blocklist of shell metacharacters.

export const DEV_MCP_URL = 'http://127.0.0.1:8792/mcp';
export const DEV_SKILL_URL = 'http://127.0.0.1:5194/SKILLS.md';
export const PROD_SKILL_URL = 'https://falconos.markets/SKILLS.md';
export const UNCONFIGURED_NOTICE = 'The plugin server is not deployed yet';
export const LOCAL_PREVIEW_NOTICE = 'These commands point at a server on your own machine. They only work while you run the Falcon plugin locally.';

const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '[::1]']);
const SAFE_URL = /^https?:\/\/(?:[A-Za-z0-9](?:[A-Za-z0-9.-]*[A-Za-z0-9])?|\[::1\])(?::[0-9]{1,5})?\/[A-Za-z0-9._\-/]*$/;

// Returns 'https' or 'loopback-http' for a URL safe to paste into a shell, else null.
function classify(raw, pathCheck) {
  if (typeof raw !== 'string' || !SAFE_URL.test(raw)) return null;
  let url;
  try { url = new URL(raw); } catch { return null; }
  if (url.username || url.password || url.search || url.hash) return null;
  const rawPath = raw.slice(raw.indexOf('/', raw.indexOf('//') + 2));
  if (rawPath !== url.pathname || !pathCheck(url.pathname)) return null;
  if (url.protocol === 'https:') return 'https';
  if (url.protocol === 'http:' && LOOPBACK_HOSTS.has(url.hostname)) return 'loopback-http';
  return null;
}

const mcpPath = (path) => path === '/mcp';
const skillPath = (path) => path.endsWith('/SKILLS.md') && !path.includes('//') && !path.split('/').includes('..');
const unset = (value) => value === undefined || value === null || value === '';

const unconfigured = () => ({ state: 'unconfigured', mcpUrl: null, skillUrl: null, notice: UNCONFIGURED_NOTICE });

export function resolveInstallConfig({ mcpUrl, skillUrl, isProd } = {}) {
  let mcp = mcpUrl;
  let skill = skillUrl;
  if (unset(skill)) skill = isProd ? PROD_SKILL_URL : DEV_SKILL_URL;
  if (unset(mcp) && !isProd) mcp = DEV_MCP_URL;
  const kinds = [classify(mcp, mcpPath), classify(skill, skillPath)];
  if (kinds.includes(null)) return unconfigured();
  if (kinds.every((kind) => kind === 'https')) return { state: 'ready', mcpUrl: mcp, skillUrl: skill, notice: '' };
  return { state: 'local-preview', mcpUrl: mcp, skillUrl: skill, notice: LOCAL_PREVIEW_NOTICE };
}

export function installCommands(config) {
  if (!config || config.state === 'unconfigured' || !config.mcpUrl || !config.skillUrl) {
    return { human: [], agent: { command: null, prompt: null } };
  }
  return {
    human: [
      {
        id: 'claude-code',
        label: 'Claude Code',
        command: `claude mcp add --transport http falconos ${config.mcpUrl}`,
        note: 'Run this in your terminal. Claude Code adds the server for you.',
      },
      {
        id: 'json-config',
        label: 'Any MCP client (JSON)',
        command: `{"mcpServers":{"falconos":{"type":"http","url":"${config.mcpUrl}"}}}`,
        note: 'Paste into your client\'s MCP config. The type field is required.',
      },
    ],
    agent: {
      command: `curl -fsSL ${config.skillUrl}`,
      prompt: `Install the FalconOS plugin: read ${config.skillUrl} and follow its setup steps. Use Solana Devnet only. Ask me before you sign or send anything.`,
    },
  };
}

// Renders web/skills/SKILLS.md. The template wraps the install material in
// <!-- if:mcp -->...<!-- else:mcp -->...<!-- endif:mcp -->. With a usable MCP URL the first
// branch is kept and {{FALCON_MCP_URL}} and {{FALCON_SKILL_URL}} are filled in; otherwise the
// else branch is kept. A missing URL never fails a build. Leftover markers always do.
const BLOCK = /<!-- if:mcp -->\n([\s\S]*?)<!-- else:mcp -->\n([\s\S]*?)<!-- endif:mcp -->\n?/g;

export function renderSkill(template, { mcpUrl, skillUrl, isProd }) {
  const config = resolveInstallConfig({ mcpUrl, skillUrl, isProd });
  const configured = config.state !== 'unconfigured';
  let text = template.replace(BLOCK, (_match, whenConfigured, whenNot) => (configured ? whenConfigured : whenNot));
  if (configured) text = text.replaceAll('{{FALCON_MCP_URL}}', config.mcpUrl).replaceAll('{{FALCON_SKILL_URL}}', config.skillUrl);
  if (text.includes('{{') || /<!--\s*(if|else|endif):/.test(text)) {
    throw new Error('SKILLS.md: unresolved placeholder or conditional marker after rendering');
  }
  return text;
}
