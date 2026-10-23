import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { extname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const mvpRoot = resolve(fileURLToPath(new URL('../dist-mvp/', import.meta.url)));
const siteRoot = resolve(fileURLToPath(new URL('../dist/', import.meta.url)));
const types = new Map([['.css', 'text/css'], ['.html', 'text/html'], ['.js', 'text/javascript'], ['.svg', 'image/svg+xml'], ['.ttf', 'font/ttf']]);

async function staticServer(root) {
  const redirects = (await readFile(resolve(root, '_redirects'), 'utf8')).trim().split(/\r?\n/)
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
    const relative = pathname === '/' ? 'index.html' : pathname.endsWith('/') ? `${pathname.slice(1)}index.html`
      : extname(pathname) ? pathname.slice(1) : `${pathname.slice(1)}/index.html`;
    const path = resolve(root, relative);
    if (path !== root && !path.startsWith(`${root}${sep}`)) {
      response.writeHead(403).end();
      return;
    }
    try {
      const body = await readFile(path);
      response.writeHead(200, { 'content-type': types.get(extname(path)) ?? 'application/octet-stream' });
      response.end(body);
    } catch {
      response.writeHead(404).end();
    }
  });
}

async function listen(server) {
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
}

function scriptSrc(html) {
  return html.match(/<script[^>]+src="([^"]+\.js)"/)?.[1];
}

async function assertDashboardRedirect(base, path) {
  const response = await fetch(base + path, { redirect: 'manual' });
  assert.equal(response.status, 302, path);
  assert.equal(response.headers.get('location'), '/dashboard/', path);
}

test('V190: MVP root and retired application routes lead to the owner dashboard gate', async t => {
  const server = await staticServer(mvpRoot);
  await listen(server);
  t.after(() => new Promise(resolve => server.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}`;

  for (const path of ['/', '/index.html', '/app', '/app/', '/app/index.html?old=1', '/dash/', '/mesh/',
    '/treasury/', '/research/', '/research/near/', '/bot/']) await assertDashboardRedirect(base, path);

  const dashboardResponse = await fetch(base + '/dashboard/', { redirect: 'manual' });
  assert.equal(dashboardResponse.status, 200);
  assert.match(dashboardResponse.headers.get('content-type') ?? '', /text\/html/);
  const dashboardHtml = await dashboardResponse.text();
  const dashboardScript = scriptSrc(dashboardHtml);
  assert.ok(dashboardScript, 'the route must load the owner dashboard bundle');
  assert.equal((await fetch(new URL(dashboardScript, base))).status, 200);

  for (const route of ['app/index.html', 'dash/index.html', 'mesh/index.html', 'treasury/index.html',
    'research/near/index.html', 'bot/index.html']) {
    await assert.rejects(readFile(resolve(mvpRoot, route)), { code: 'ENOENT' }, route);
  }
});

test('V185: production dashboard loads the owner module without exposing simulator sources', async t => {
  const server = await staticServer(siteRoot);
  await listen(server);
  t.after(() => new Promise(resolve => server.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}`;

  for (const path of ['/dashboard', '/dashboard/', '/dashboard/index.html', '/dashboard/?preview=1&recordMode=saved']) {
    const response = await fetch(base + path, { redirect: 'manual' });
    assert.equal(response.status, 200);
    assert.match(response.headers.get('content-type') ?? '', /text\/html/);
    const script = scriptSrc(await response.text());
    assert.ok(script, 'dashboard entry must load its owner bundle');
    assert.equal((await fetch(new URL(script, base))).status, 200);
  }
  for (const path of ['/local-dashboard/', '/local-dashboard/index.html', '/dashboard/main.jsx',
    '/dashboard/App.jsx', '/dashboard/data.json', '/design-reference/falconos-capital.html', '/dash-snapshot.json']) {
    const response = await fetch(base + path, { redirect: 'manual' });
    assert.equal(response.status, 404, `local artifact must omit dashboard source: ${path}`);
  }
});

test('V190: site route manifest sends retired workspaces to the dashboard gate while retaining marketing', async t => {
  const server = await staticServer(siteRoot);
  await listen(server);
  t.after(() => new Promise(resolve => server.close(resolve)));
  const base = 'http://127.0.0.1:' + server.address().port;

  for (const path of ['/app', '/app/', '/app/index.html?legacy=1', '/dash/', '/mesh/', '/treasury/',
    '/research/near/', '/bot/']) await assertDashboardRedirect(base, path);
  assert.equal((await fetch(base + '/research/', { redirect: 'manual' })).status, 200);
});
