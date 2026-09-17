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

test('V48: landing leads with a concise product view', () => {
  assert.match(visibleText, /An investment firm built around agents\./);
  assert.match(visibleText, /Market snapshot\./);
  assert.match(visibleText, /Get access when the firm opens\./);
  assert.match(html, /href="\/product\/"/);
  assert.match(html, /href="\/research\/"/);
});

test('V51 V53: public landing keeps advisory boundaries', () => {
  assert.match(visibleText, /Read-only snapshot across sample instruments/);
  assert.match(visibleText, /No orders, custody, or execution/);
  assert.match(visibleText, /Connected agents and live execution are planned\./);
  assert.doesNotMatch(visibleText, /submit an order/i);
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
    hrefs.filter((href) => /\.html(?:[?#]|$)|\/dash\//i.test(href)),
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

test('V56: every inline landing script compiles', () => {
  const scripts = [...html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/gi)].map((match) => match[1]);
  assert.ok(scripts.length > 0);
  for (const script of scripts) assert.doesNotThrow(() => new Function(script));
});
