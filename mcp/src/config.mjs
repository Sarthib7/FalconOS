const LOOPBACK = new Set(['localhost', '127.0.0.1', '[::1]', '::1']);
const HOSTNAME = /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)*$|^\[[0-9a-f:]+\]$/;

export class ConfigError extends Error {}

export function isLoopbackHost(host) {
  return LOOPBACK.has(String(host).toLowerCase());
}

function integer(env, name, fallback, { min = 1, max = Number.MAX_SAFE_INTEGER } = {}) {
  const raw = env[name];
  if (raw === undefined || raw === '') return fallback;
  const value = Number(raw);
  if (!/^\d+$/.test(raw) || !Number.isSafeInteger(value) || value < min || value > max) {
    throw new ConfigError(`${name} must be an integer between ${min} and ${max}.`);
  }
  return value;
}

function meshUrl(raw) {
  if (!raw) throw new ConfigError('FALCON_MESH_API_URL is required.');
  let url;
  try { url = new URL(raw); } catch { throw new ConfigError('FALCON_MESH_API_URL must be a valid URL.'); }
  if (!['http:', 'https:'].includes(url.protocol)) throw new ConfigError('FALCON_MESH_API_URL must use http or https.');
  if (url.username || url.password) throw new ConfigError('FALCON_MESH_API_URL must not contain credentials.');
  if (url.search || url.hash) throw new ConfigError('FALCON_MESH_API_URL must not contain a query or fragment.');
  if (url.protocol !== 'https:' && !isLoopbackHost(url.hostname)) {
    throw new ConfigError('FALCON_MESH_API_URL must use https unless it points at a loopback host.');
  }
  return url.href.replace(/\/+$/, '');
}

function mcpOrigin(raw) {
  if (!raw) throw new ConfigError('FALCON_MCP_ORIGIN is required.');
  let url;
  try { url = new URL(raw); } catch { throw new ConfigError('FALCON_MCP_ORIGIN must be a valid origin.'); }
  if (!['http:', 'https:'].includes(url.protocol) || url.origin !== raw) {
    throw new ConfigError('FALCON_MCP_ORIGIN must be an exact http(s) origin with no path, such as https://mcp.example.com.');
  }
  return raw;
}

function allowedHosts(raw) {
  const hosts = String(raw ?? '').split(',').map(item => item.trim().toLowerCase()).filter(Boolean);
  for (const host of hosts) {
    if (!HOSTNAME.test(host)) throw new ConfigError('FALCON_MCP_ALLOWED_HOSTS must list bare hostnames without scheme, port or wildcard.');
  }
  return [...new Set(hosts)];
}

export function parseConfig(env = process.env) {
  const host = (env.FALCON_MCP_HOST || '127.0.0.1').toLowerCase();
  const hosts = allowedHosts(env.FALCON_MCP_ALLOWED_HOSTS);
  if (!isLoopbackHost(host) && !hosts.length) {
    throw new ConfigError('FALCON_MCP_ALLOWED_HOSTS is required when FALCON_MCP_HOST is not a loopback address.');
  }
  const origin = mcpOrigin(env.FALCON_MCP_ORIGIN);
  return {
    port: integer(env, 'PORT', 8792, { min: 0, max: 65535 }),
    host,
    allowedHosts: hosts,
    meshUrl: meshUrl(env.FALCON_MESH_API_URL),
    origin,
    rate: {
      windowMs: integer(env, 'FALCON_MCP_RATE_WINDOW_MS', 60_000),
      perSession: integer(env, 'FALCON_MCP_RATE_MAX_PER_SESSION', 60),
      perWallet: integer(env, 'FALCON_MCP_RATE_MAX_CONNECT', 10),
      global: integer(env, 'FALCON_MCP_RATE_MAX_GLOBAL', 300),
    },
  };
}
