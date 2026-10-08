export const MCP_URL = 'https://mcp.falconos.markets/mcp';
export const MCP_CLI_COMMAND = 'claude mcp add --transport http falconos ' + MCP_URL;
export const MCP_JSON_CONFIG = JSON.stringify({ mcpServers: { falconos: { type: 'http', url: MCP_URL } } });
export const SKILL_URL = 'https://agents.falconos.markets/SKILLS.md';
export const SKILL_FETCH_COMMAND = 'curl -fsSL ' + SKILL_URL;
