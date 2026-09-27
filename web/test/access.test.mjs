import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const landing = await readFile(new URL('../index.html', import.meta.url), 'utf8');
const dashboard = await readFile(new URL('../dash/index.html', import.meta.url), 'utf8');

test('V104: React landing stays separate while the dashboard opens its manual Devnet app', () => {
  assert.match(landing, /type="module" src="\/landing\/main\.jsx"/);
  assert.match(landing, /id="root"/);
  assert.equal((landing.match(/href="\/dash\//g) ?? []).length, 0);
  assert.match(dashboard, /href="\/app\/"/);
  assert.match(dashboard, /Open Devnet terminal/);
  assert.match(dashboard, /Solana Devnet/);
  assert.match(dashboard, /Manual approval/);
});
