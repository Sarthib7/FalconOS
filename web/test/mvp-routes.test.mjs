import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { extname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const mvpRoot = resolve(fileURLToPath(new URL('../dist-mvp/', import.meta.url)));
const siteRoot = resolve(fileURLToPath(new URL('../dist/', import.meta.url)));
const types = new Map([['.css', 'text/css'], ['.html', 'text/html'], ['.js', 'text/javascript'], ['.svg', 'image/svg+xml'], ['.ttf', 'font/ttf']]);

function staticServer(root) {
  return createServer(async (request, response) => {
    const pathname = new URL(request.url ?? '/', 'http://localhost').pathname;
    const relative = pathname === '/' ? 'index.html' : pathname.endsWith('/') ? `${pathname.slice(1)}index.html` : pathname.slice(1);
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

test('unified MVP build serves the bot at the domain root and Mesh at /mesh/', async t => {
  const server = staticServer(mvpRoot);
  await listen(server);
  t.after(() => new Promise(resolve => server.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}`;

  const [botResponse, meshResponse] = await Promise.all([fetch(base), fetch(`${base}/mesh/`)]);
  assert.equal(botResponse.status, 200);
  assert.equal(meshResponse.status, 200);
  const [botHtml, meshHtml] = await Promise.all([botResponse.text(), meshResponse.text()]);
  assert.match(botResponse.headers.get('content-type') ?? '', /text\/html/);
  assert.match(meshResponse.headers.get('content-type') ?? '', /text\/html/);

  const botScript = scriptSrc(botHtml);
  const meshScript = scriptSrc(meshHtml);
  assert.ok(botScript, 'bot route must load its JavaScript bundle');
  assert.ok(meshScript, 'mesh route must load its JavaScript bundle');
  assert.notEqual(botScript, meshScript);

  for (const script of [botScript, meshScript]) {
    const asset = await fetch(new URL(script, base));
    assert.equal(asset.status, 200);
    assert.match(asset.headers.get('content-type') ?? '', /javascript/);
  }
});

test('V185: public dashboard stays Soon and omits local simulator from production artifact', async t => {
  const server = staticServer(siteRoot);
  await listen(server);
  t.after(() => new Promise(resolve => server.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}`;

  for (const path of ['/dashboard/', '/dashboard/index.html', '/dashboard/?preview=1&recordMode=saved']) {
    const response = await fetch(base + path);
    assert.equal(response.status, 200);
    assert.match(response.headers.get('content-type') ?? '', /text\/html/);
    const html = await response.text();
    assert.match(html, /<h1\b[^>]*>Soon<\/h1>/i, 'visitors must see the unavailable dashboard state');
    assert.doesNotMatch(html, /<script\b/i, 'public dashboard must not start any application code');
    assert.doesNotMatch(html, /<form\b|<input\b|<button\b/i, 'unavailable dashboard cannot offer active setup or trading controls');
  }
  // Local 404s prove artifact omission, not Cloudflare 404s; the coordinator observed excluded paths returning public landing HTML with HTTP 200.
  for (const path of ['/local-dashboard/', '/local-dashboard/index.html', '/dashboard/main.jsx', '/dashboard/App.jsx', '/dashboard/data.json']) {
    const response = await fetch(base + path);
    assert.equal(response.status, 404, `local artifact must omit dashboard source: ${path}`);
  }
});
