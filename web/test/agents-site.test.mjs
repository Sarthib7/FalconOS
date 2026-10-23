import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { extname, join, resolve, sep } from 'node:path';
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

async function staticServer() {
  const redirects = (await readFile(join(root, '_redirects'), 'utf8')).trim().split(/\r?\n/)
    .map(line => {
      const [source, target, status] = line.trim().split(/\s+/);
      return { source, target, status: Number(status) };
    });
  return createServer(async (request, response) => {
    const pathname = new URL(request.url ?? '/', 'http://localhost').pathname;
    const redirect = redirects.find(({ source }) => source.endsWith('/*')
      ? pathname.startsWith(source.slice(0, -1)) : pathname === source);
    if (redirect) {
      response.writeHead(redirect.status, { location: redirect.target }).end();
      return;
    }
    const relative = pathname === '/' ? 'index.html' : pathname.endsWith('/')
      ? `${pathname.slice(1)}index.html` : extname(pathname) ? decodeURIComponent(pathname.slice(1))
        : `${decodeURIComponent(pathname.slice(1))}/index.html`;
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
  assert.ok(markup.includes('href="/install/"'), 'install branding stays on the preserved install route');
});

test('V190: agents host gates the root, preserves install and skill routes, and omits retired workspaces', async t => {
  const server = await staticServer();
  await listen(server);
  t.after(() => new Promise(resolve => server.close(resolve)));
  const base = 'http://127.0.0.1:' + server.address().port;

  for (const path of ['/', '/index.html', '/app/', '/app/index.html?legacy=1', '/dash/', '/mesh/', '/treasury/', '/research/', '/bot/']) {
    const response = await fetch(base + path, { redirect: 'manual' });
    assert.equal(response.status, 302, path);
    assert.equal(response.headers.get('location'), '/dashboard/', path);
  }

  const install = await fetch(base + '/install/', { redirect: 'manual' });
  assert.equal(install.status, 200);
  const html = await install.text();
  assert.match(html, /<title>Falcon for agents<\/title>/);
  const script = html.match(/<script[^>]+src="([^"]+\.js)"/)?.[1];
  assert.ok(script, 'install page must load its app bundle');
  assert.equal((await fetch(new URL(script, base))).status, 200);
  assert.equal((await fetch(base + '/install', { redirect: 'manual' })).status, 200);

  for (const path of ['/dashboard', '/dashboard/', '/dashboard/index.html?owner=1']) {
    const dashboard = await fetch(base + path, { redirect: 'manual' });
    assert.equal(dashboard.status, 200, path);
    const dashboardScript = (await dashboard.text()).match(/<script[^>]+src="([^"]+\.js)"/)?.[1];
    assert.ok(dashboardScript, 'dashboard route must load its owner bundle');
    assert.equal((await fetch(new URL(dashboardScript, base))).status, 200);
  }
  await assert.rejects(readFile(resolve(root, 'index.html')), { code: 'ENOENT' });
  for (const route of ['app/index.html', 'dash/index.html', 'mesh/index.html', 'treasury/index.html',
    'research/near/index.html', 'bot/index.html']) {
    await assert.rejects(readFile(resolve(root, route)), { code: 'ENOENT' }, route);
  }

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
