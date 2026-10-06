import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { extname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { MCP_CLI_COMMAND, MCP_JSON_CONFIG, SKILL_FETCH_COMMAND } from '../agents/install.mjs';

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
  assert.deepEqual(JSON.parse(MCP_JSON_CONFIG), { mcpServers: { falconos: { type: 'http', url: 'https://mcp.falconos.markets/mcp' } } });
  assert.equal(SKILL_FETCH_COMMAND, 'curl -fsSL https://agents.falconos.markets/SKILLS.md');
});

test('public agent install serves the page, assets, and the MCP skill', async t => {
  const server = staticServer();
  await listen(server);
  t.after(() => new Promise(resolve => server.close(resolve)));
  const base = 'http://127.0.0.1:' + server.address().port;

  const page = await fetch(base);
  assert.equal(page.status, 200);
  const html = await page.text();
  assert.match(html, /<title>Falcon \| Agent install<\/title>/);
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
