import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const html = await readFile(new URL('../dash/index.html', import.meta.url), 'utf8');

test('V57: dashboard route exposes private-preview gate', () => {
  assert.match(html, /Dashboard access is gated\./);
  assert.match(html, /public landing page shows a read-only market snapshot/i);
  assert.match(html, /Login \(Soon\)/);
  assert.match(html, /Connect wallet \(Soon\)/);
  assert.match(html, /Sign up \(Soon\)/);
  assert.doesNotMatch(html, /id="dt-price"/);
  assert.doesNotMatch(html, /Market stats/);
});
