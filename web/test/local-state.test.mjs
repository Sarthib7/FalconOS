import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'vite';
import main from '../vite.config.js';
import mesh from '../vite.mesh.config.js';
import treasury from '../vite.treasury.config.js';

for (const [name, config] of Object.entries({ main, mesh, treasury })) {
  test(`V96/V105: ${name} dev server denies private local state and default secret paths`, async () => {
    const root = await mkdtemp(join(tmpdir(), 'falcon-dev-state-'));
    const marker = 'DISPOSABLE_MARKER_NOT_A_SECRET';
    let server;
    try {
      for (const path of ['.local', 'mesh/.local']) await mkdir(join(root, path), { recursive: true });
      for (const path of ['.local/waitlist.sqlite', '.local/waitlist-salt', 'mesh/.local/operator-token', '.env']) {
        await writeFile(join(root, path), marker);
      }
      await writeFile(join(root, 'index.html'), '<title>Public test page</title>');
      server = await createServer({ ...config, root, configFile: false, plugins: [], publicDir: false,
        logLevel: 'silent', optimizeDeps: { noDiscovery: true, include: [] },
        server: { ...config.server, host: '127.0.0.1', port: 0,
          fs: { ...config.server?.fs, allow: [root] } } });
      await server.listen();
      const origin = `http://127.0.0.1:${server.httpServer.address().port}`;
      assert.equal((await fetch(origin)).status, 200);
      for (const path of ['/.local/waitlist.sqlite', '/.local/waitlist-salt?raw',
        '/.local/waitlist.sqlite?url', `/@fs${root}/mesh/.local/operator-token`,
        '/mesh/.local/operator-token', '/%2elocal/waitlist-salt', '/.env']) {
        const response = await fetch(`${origin}${path}`);
        const body = await response.text();
        assert.equal(body.includes(marker), false, `${name} exposed dummy private state at ${path}`);
        assert.ok([403, 404].includes(response.status), `${name} accepted private path ${path}: ${response.status}`);
      }
    } finally {
      await server?.close();
      await rm(root, { recursive: true, force: true });
    }
  });
}
