// Pure helpers for the "Add Falcon to your agent" panel and the published skill.
// No DOM and no import.meta.env here, so node --test and vite.config files can import it.
// The URLs end up inside a command the human pastes into a shell, so they are checked
// against a strict allowlist instead of a blocklist of shell metacharacters.

export const DEV_MCP_URL = 'http://127.0.0.1:8792/mcp';
export const DEV_SKILL_URL = 'http://127.0.0.1:5194/SKILLS.md';
// PROD_SKILL_URL is the hardcoded fallback only; the authoritative source is the
// VITE_FALCON_SKILL_URL build variable passed by the app at runtime.
export const PROD_SKILL_URL = 'https://agents.falconos.markets/SKILLS.md';
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

// Full config used by renderSkill (requires both MCP and skill URLs).
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

// Skill-only config used by the Agent install tab (no MCP server required).
// Falls back to DEV_SKILL_URL in dev and PROD_SKILL_URL in prod; the caller is
// expected to supply VITE_FALCON_SKILL_URL as skillUrl in production builds.
export function resolveSkillConfig({ skillUrl, isProd } = {}) {
  let skill = skillUrl;
  if (unset(skill)) skill = isProd ? PROD_SKILL_URL : DEV_SKILL_URL;
  const kind = classify(skill, skillPath);
  if (kind === null) return { state: 'unconfigured', skillUrl: null };
  return { state: kind === 'loopback-http' ? 'local-preview' : 'ready', skillUrl: skill };
}

// Returns the single curl command shown in the Agent tab.
export function installCommands(config) {
  if (!config || config.state === 'unconfigured' || !config.skillUrl) {
    return { agent: { command: null } };
  }
  return {
    agent: {
      command: `curl -fsSL ${config.skillUrl}`,
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
