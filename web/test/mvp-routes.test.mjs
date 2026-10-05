import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const root = resolve(fileURLToPath(new URL('../dist-mvp/', import.meta.url)));
const types = new Map([['.css', 'text/css'], ['.html', 'text/html'], ['.js', 'text/javascript'], ['.svg', 'image/svg+xml'], ['.ttf', 'font/ttf']]);

function staticServer() {
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

test('unified MVP build serves the bot at the domain root and Mesh at /mesh/', async t => {
  const server = staticServer();
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  t.after(() => new Promise(resolve => server.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}`;

  const [botResponse, meshResponse] = await Promise.all([fetch(base), fetch(`${base}/mesh/`)]);
  assert.equal(botResponse.status, 200);
  assert.equal(meshResponse.status, 200);
  const [botHtml, meshHtml] = await Promise.all([botResponse.text(), meshResponse.text()]);
  assert.match(botHtml, /<title>Falcon · Solana Yield Agent<\/title>/);
  assert.match(meshHtml, /<title>Falcon \| Knowledge mesh<\/title>/);

  for (const html of [botHtml, meshHtml]) {
    const script = html.match(/<script[^>]+src="([^"]+\.js)"/)?.[1];
    assert.ok(script, 'each route must load its JavaScript bundle');
    const asset = await fetch(new URL(script, base));
    assert.equal(asset.status, 200);
    assert.match(asset.headers.get('content-type') ?? '', /javascript/);
  }
});
