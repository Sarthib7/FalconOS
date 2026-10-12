import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { extname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createServer as createViteServer } from 'vite';
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
});

test('the skill entry point precedes MCP setup', async t => {
  const vite = await createViteServer({
    configFile: resolve(fileURLToPath(new URL('../vite.agents.config.js', import.meta.url))),
    server: { middlewareMode: true },
    appType: 'custom',
  });
  t.after(() => vite.close());

  const { default: App } = await vite.ssrLoadModule('/App.jsx');
  const markup = renderToStaticMarkup(createElement(App));
  const nav = markup.indexOf('<nav aria-label="Page navigation">');
  const skillNav = markup.indexOf('href="/SKILLS.md"', nav);
  const mcpNav = markup.indexOf('href="#install"', nav);
  const skillSection = markup.indexOf('aria-labelledby="skill-entry-title"');
  const skillCommand = markup.indexOf(SKILL_FETCH_COMMAND, skillSection);
  const installSection = markup.indexOf('<section id="install"');

  assert.ok(nav >= 0 && skillNav > nav && mcpNav > skillNav, 'navigation links to the skill before MCP setup');
  assert.ok(skillSection >= 0 && skillCommand > skillSection && installSection > skillCommand, 'skill entry precedes install section');
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
  const bytes = Buffer.from(await skill.arrayBuffer());
  const manifestResponse = await fetch(base + '/SKILLS.manifest.json');
  assert.equal(manifestResponse.status, 200);
  const manifest = await manifestResponse.json();
  assert.equal(manifest.sha256, createHash('sha256').update(bytes).digest('hex'));
  const frontmatter = bytes.toString('utf8').match(/^---\n([\s\S]*?)\n---\n/);
  assert.ok(frontmatter, 'served guide must contain release metadata');
  for (const key of ['version', 'requiredMcpVersion']) {
    const value = frontmatter[1].match(new RegExp('^' + key + ': (.+)$', 'm'))?.[1];
    assert.equal(manifest[key], value, 'served manifest must match guide ' + key);
  }
});
