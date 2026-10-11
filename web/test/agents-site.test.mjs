import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { extname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createServer as createViteServer } from 'vite';
import { MCP_CLI_COMMAND, MCP_CODEX_CLI_COMMAND, MCP_JSON_CONFIG, SKILL_FETCH_COMMAND } from '../agents/install.mjs';

const root = resolve(fileURLToPath(new URL('../dist-agents/', import.meta.url)));
const contentTypes = new Map([
  ['.css', 'text/css'],
  ['.html', 'text/html'],
  ['.js', 'text/javascript'],
  ['.md', 'text/markdown'],
  ['.svg', 'image/svg+xml'],
  ['.ttf', 'font/ttf'],
]);

function staticServer() {
  return createServer(async (request, response) => {
    const pathname = new URL(request.url ?? '/', 'http://localhost').pathname;
    const relative = pathname === '/' ? 'index.html' : decodeURIComponent(pathname.slice(1));
    const path = resolve(root, relative);
    if (path !== root && !path.startsWith(root + sep)) {
      response.writeHead(403).end();
      return;
    }
    try {
      const body = await readFile(path);
      response.writeHead(200, { 'content-type': contentTypes.get(extname(path)) ?? 'application/octet-stream' });
      response.end(body);
    } catch {
      response.writeHead(404).end();
    }
  });
}

function listen(server) {
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
}

test('agent setup commands target the public MCP and skill', () => {
  assert.equal(MCP_CLI_COMMAND, 'claude mcp add --transport http falconos https://mcp.falconos.markets/mcp');
  assert.equal(MCP_CODEX_CLI_COMMAND, 'codex mcp add falconos --url https://mcp.falconos.markets/mcp');
  assert.deepEqual(JSON.parse(MCP_JSON_CONFIG), { mcpServers: { falconos: { type: 'http', url: 'https://mcp.falconos.markets/mcp' } } });
  assert.equal(SKILL_FETCH_COMMAND, 'curl -fsSL https://agents.falconos.markets/SKILLS.md');
});

test('the public skill fetch is the first step before MCP setup', async t => {
  const vite = await createViteServer({
    configFile: resolve(fileURLToPath(new URL('../vite.agents.config.js', import.meta.url))),
    server: { middlewareMode: true },
    appType: 'custom',
  });
  t.after(() => vite.close());

  const { default: App } = await vite.ssrLoadModule('/App.jsx');
  const markup = renderToStaticMarkup(createElement(App));
  const skillLink = markup.indexOf('<a class="agents-primary" href="/SKILLS.md">Read the skill');
  const skillCommand = markup.indexOf(SKILL_FETCH_COMMAND);
  const mcpSetup = markup.indexOf('Add Falcon to your agent');
  const skillNav = markup.indexOf('>SKILLS.md</a>');
  const mcpNav = markup.indexOf('>MCP setup</a>');

  assert.ok(skillLink >= 0, 'page must link to the skill entry point');
  assert.ok(skillCommand >= 0, 'page must show the curl entry command');
  assert.ok(mcpSetup >= 0, 'page must show MCP setup after the skill');
  assert.ok(skillLink < skillCommand && skillCommand < mcpSetup, 'skill link and curl command must appear before MCP setup');
  assert.ok(skillNav >= 0 && mcpNav >= 0 && skillNav < mcpNav, 'navigation must lead with the skill before MCP setup');
});

test('public agent install serves the page, assets, and the MCP skill', async t => {
  const server = staticServer();
  await listen(server);
  t.after(() => new Promise(resolve => server.close(resolve)));
  const base = 'http://127.0.0.1:' + server.address().port;

  const page = await fetch(base);
  assert.equal(page.status, 200);
  const html = await page.text();
  assert.match(html, /<title>Falcon for agents<\/title>/);
  const script = html.match(/<script[^>]+src="([^"]+\.js)"/)?.[1];
  assert.ok(script, 'install page must load its app bundle');
  assert.equal((await fetch(new URL(script, base))).status, 200);

  const skill = await fetch(base + '/SKILLS.md');
  assert.equal(skill.status, 200);
  assert.match(skill.headers.get('content-type') ?? '', /text\/markdown/);
  const markdown = await skill.text();
  assert.match(markdown, /https:\/\/mcp\.falconos\.markets\/mcp/);
  assert.match(markdown, /falcon_prepare_transaction/);
  assert.match(markdown, /falcon_check_receipt/);
});
