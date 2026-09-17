import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const landing = await readFile(new URL('../index.html', import.meta.url), 'utf8');
const dashboard = await readFile(new URL('../dash/index.html', import.meta.url), 'utf8');

test('V57: landing keeps snapshot access while dashboard stays gated', () => {
  assert.match(landing, /id="market-snap"/);
  assert.match(landing, /id="waitlist-form"/);
  assert.equal((landing.match(/href="\/dash\//g) ?? []).length, 0);
  assert.match(dashboard, /Dashboard access is gated\./);
  assert.match(dashboard, /Login \(Soon\)/);
  assert.match(dashboard, /Connect wallet \(Soon\)/);
  assert.match(dashboard, /Sign up \(Soon\)/);
  assert.doesNotMatch(dashboard, /Market stats/);
});
