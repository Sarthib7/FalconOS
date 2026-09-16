import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const html = await readFile(new URL('../index.html', import.meta.url), 'utf8');
const visibleText = html
  .replace(/<style[\s\S]*?<\/style>/gi, ' ')
  .replace(/<script[\s\S]*?<\/script>/gi, ' ')
  .replace(/<svg[\s\S]*?<\/svg>/gi, ' ')
  .replace(/<[^>]+>/g, ' ')
  .replace(/\s+/g, ' ')
  .trim();

test('V48: capability labels match verified state', () => {
  assert.match(visibleText, /Perps Tested local preview/);
  assert.match(visibleText, /Stablecoins Working local CLI/);
  assert.match(visibleText, /Stocks In development/);
  assert.match(visibleText, /Connected agents and live execution are planned\./);
});

test('V51 V53: advisory and risk copy preserves authority', () => {
  assert.match(visibleText, /The Client Agent decides what happens next\./);
  assert.match(visibleText, /FalconOS never signs or submits an order\./);
  assert.match(visibleText, /It returns PASS, BLOCK, or NO_DATA/);
  assert.doesNotMatch(visibleText, /request review/i);
});

test('V55: production links resolve within deployed page', () => {
  assert.equal(
    (html.match(/rel="canonical" href="https:\/\/falconos\.markets\/"/g) ?? []).length,
    1,
  );
  assert.match(html, /rel="icon"[^>]+href="\/falcon-symbol\.png"/);

  const hrefs = [...html.matchAll(/href\s*=\s*["']([^"']+)["']/gi)].map(
    (match) => match[1],
  );
  assert.deepEqual(
    hrefs.filter((href) => /\.html(?:[?#]|$)/i.test(href)),
    [],
  );

  const ids = new Set(
    [...html.matchAll(/(?:^|[\s<])id="([^"]+)"/gm)].map((match) => match[1]),
  );
  const missingTargets = hrefs
    .filter((href) => href.startsWith('#'))
    .map((href) => href.slice(1))
    .filter((id) => !ids.has(id));
  assert.deepEqual(missingTargets, []);
});
