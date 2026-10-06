import assert from 'node:assert/strict';
import { access, readFile } from 'node:fs/promises';
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
  assert.match(botHtml, /<title>Falcon · Solana Yield Agent<\/title>/);
  assert.match(meshHtml, /<title>Falcon \| Knowledge mesh<\/title>/);
  assert.match(meshHtml, /id="lending-terminal"/);
  assert.doesNotMatch(botHtml, /<title>Falcon \| Knowledge mesh<\/title>/);
  assert.doesNotMatch(botHtml, /FalconOS · Your rules\. Every move explained\./);

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

const hasSite = await access(resolve(siteRoot, 'index.html')).then(() => true, () => false);

test('main-site build keeps treasury landing at / and does not serve the bot', {
  skip: hasSite ? false : 'run npm --prefix web run build:site first',
}, async t => {
  const server = staticServer(siteRoot);
  await listen(server);
  t.after(() => new Promise(resolve => server.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}`;

  const [homeResponse, dashboardResponse] = await Promise.all([fetch(base), fetch(`${base}/dashboard/`)]);
  assert.equal(homeResponse.status, 200);
  assert.equal(dashboardResponse.status, 200);
  const [homeHtml, dashboardHtml] = await Promise.all([homeResponse.text(), dashboardResponse.text()]);
  assert.match(homeHtml, /<title>FalconOS · Your rules\. Every move explained\.<\/title>/);
  assert.doesNotMatch(homeHtml, /<title>Falcon · Solana Yield Agent<\/title>/);
  assert.match(dashboardHtml, /<title>Control Centre · FalconOS<\/title>/);
  assert.doesNotMatch(dashboardHtml, /<title>Falcon · Solana Yield Agent<\/title>/);

  for (const html of [homeHtml, dashboardHtml]) {
    const script = scriptSrc(html);
    assert.ok(script, 'each main-site route must load its JavaScript bundle');
    const asset = await fetch(new URL(script, base));
    assert.equal(asset.status, 200);
    assert.match(asset.headers.get('content-type') ?? '', /javascript/);
  }
});
