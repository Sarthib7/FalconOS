import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { transformWithOxc } from 'vite';
import { scenarios, buckets, inspectScenario, traceData, usdc } from '../landing/model.mjs';
import { decide } from '../treasury/domain.mjs';

// Compile only the landing components. Browser behavior is checked by the separate browser harness.
async function componentModule(url) {
  const source = await readFile(url, 'utf8');
  const transformed = await transformWithOxc(source, url.pathname, { jsx: { runtime: 'classic' } });
  let code = transformed.code.replace(/import (\w+) from ['"]([^'"]+\?url)['"];?/g, (_, name, path) => `const ${name} = ${JSON.stringify('/landing/' + path.replace(/^\.\//, '').replace(/\?url$/, ''))};`);
  const specifiers = [...new Set([...code.matchAll(/from ['"]([^'"]+)['"]/g)].map(match => match[1]))];
  for (const specifier of specifiers) {
    const target = specifier.startsWith('.') ? new URL(specifier, url) : null;
    const replacement = target?.pathname.endsWith('.jsx') ? await componentModule(target) : target?.href ?? import.meta.resolve(specifier);
    code = code.replaceAll(JSON.stringify(specifier), JSON.stringify(replacement));
  }
  return `data:text/javascript;base64,${Buffer.from(code).toString('base64')}`;
}
const { default: Landing } = await import(await componentModule(new URL('../landing/App.jsx', import.meta.url)));
const rendered = renderToStaticMarkup(React.createElement(Landing));
const entry = await readFile(new URL('../index.html', import.meta.url), 'utf8');
const css = await readFile(new URL('../landing/style.css', import.meta.url), 'utf8');
const appSource = await readFile(new URL('../landing/App.jsx', import.meta.url), 'utf8');
const visible = rendered.replace(/<svg[\s\S]*?<\/svg>/g, '').replace(/<textarea[\s\S]*?<\/textarea>/g, '').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ');

test('V104: actual React rendering retains the treasury story and labels prototype limits', () => {
  assert.match(entry, /type="module" src="\/landing\/main\.jsx"/);
  assert.match(visible, /Your rules\. Every move explained\./);
  assert.match(visible, /Current prototype: synthetic USDC and simulated actions\./);
  assert.match(visible, /The complete decision graph/);
  assert.match(visible, /In progress/);
  assert.match(visible, /Devnet, then a funded test/);
  assert.match(visible, /restricted authority must be proved first/);
  assert.match(visible, /Earlier advisory previews/);
  assert.doesNotMatch(appSource, /dangerouslySetInnerHTML|<iframe|signAndSend|localStorage/);
  assert.doesNotMatch(visible, /An investment firm built around agents|earned yield|guaranteed liquidity/i);
});

test('V104: rendered links preserve route boundaries and resolve local anchors', () => {
  assert.equal((entry.match(/rel="canonical" href="https:\/\/falconos\.markets\/"/g) ?? []).length, 1);
  const hrefs = [...rendered.matchAll(/href="([^"]+)"/g)].map(match => match[1]);
  const ids = [...rendered.matchAll(/\sid="([^"]+)"/g)].map(match => match[1]);
  assert.equal(new Set(ids).size, ids.length, 'Every rendered ID is unique');
  for (const href of hrefs.filter(href => href.startsWith('#'))) assert.ok(ids.includes(href.slice(1)), href);
  for (const route of ['/product/', '/research/', '/mesh/', '/treasury/', '/dashboard/']) assert.ok(hrefs.includes(route));
  assert.ok(!hrefs.includes('/copilot/'));
  assert.equal(hrefs.filter(href => /\.html(?:[?#]|$)|\/dash\//i.test(href)).length, 0);
});

test('V104: all five retained scenarios still match the treasury rule policy', () => {
  assert.deepEqual(scenarios.map(scenario => scenario.id), ['supply', 'hold', 'redeem', 'blocked', 'stale']);
  for (const scenario of scenarios) {
    assert.deepEqual(decide(scenario.entry.graph), scenario.entry.decision, scenario.id);
    for (const balances of [scenario.before, scenario.entry.balances]) {
      assert.equal(buckets.reduce((sum, [key]) => sum + BigInt(balances[key]), 0n).toString(), balances.totalUnits);
    }
    assert.equal(scenario.before.reserveUnits, scenario.entry.balances.reserveUnits);
    assert.equal(scenario.before.undelegatedUnits, scenario.entry.balances.undelegatedUnits);
  }
  for (const name of ['blocked', 'stale']) {
    const scenario = scenarios.find(item => item.id === name);
    assert.equal(scenario.entry.outcome.amountUnits, '0');
    assert.equal(scenario.entry.balances.positionUnits, '500000000');
  }
});

test('V104: rule inspection and exports bind the selected exact source record', () => {
  for (const scenario of scenarios) {
    for (const check of scenario.entry.decision.checks) {
      const detail = inspectScenario(scenario, null, check.id);
      assert.equal(detail.copy, check.detail);
      assert.deepEqual(detail.evidence, check.evidenceNodeIds);
      assert.ok(detail.rows.some(([name, value]) => name === 'Rule policy' && value === scenario.entry.decision.policyVersion));
    }
    const trace = traceData(scenario);
    assert.equal(trace.schema, 'falcon.landing-scenario/v1');
    assert.equal(trace.mode, 'simulation');
    assert.equal(trace.source, 'synthetic');
    assert.equal(trace.record, scenario.entry);
    assert.equal(trace.before, scenario.before);
    assert.match(trace.notice, /not a persisted treasury run/);
  }
  const stale = scenarios.find(item => item.id === 'stale');
  assert.ok(inspectScenario(stale, 'observation').rows.some(([label, value]) => label === 'Age at decision' && value === '120 seconds'));
  assert.equal(usdc('18446744073709551615'), '18,446,744,073,709.551615 USDC');
});

test('V104: source palette, Alpine mark, Geist bytes and full license remain present', async () => {
  for (const color of ['#101512', '#18201b', '#edf0e7', '#adb6aa', '#465348', '#9cdaa1', '#f0c98e']) assert.ok(css.includes(color));
  assert.match(rendered, /M30 194L171 39L129 151Z/);
  assert.match(rendered, /M138 195L218 70L190 195Z/);
  assert.match(rendered, /class="wordmark-os">OS/);
  assert.match(css, /Geist Mono/);
  assert.match(css, /prefers-reduced-motion:reduce/);
  assert.match(css, /@media\(max-width:480px\)/);
  const manifest = JSON.parse(await readFile(new URL('../landing/assets/manifest.json', import.meta.url), 'utf8'));
  assert.equal(manifest.files.length, 4);
  for (const asset of manifest.files) {
    const bytes = await readFile(new URL(`../landing/assets/${asset.file}`, import.meta.url));
    assert.equal(bytes.length, asset.bytes);
    assert.equal(createHash('sha256').update(bytes).digest('hex'), asset.sha256);
  }
  const license = await readFile(new URL('../landing/assets/FONT-LICENSE.txt', import.meta.url), 'utf8');
  assert.match(license, /SIL OPEN FONT LICENSE Version 1\.1/);
  assert.match(license, /DISCLAIMER/);
  assert.ok(rendered.includes('/landing/assets/FONT-LICENSE.txt'));
  assert.ok(rendered.includes('/landing/assets/CREDITS.md'));
});

test('V104 V105: rendered controls retain keyboard labels and the real email form', () => {
  assert.equal((rendered.match(/class="scenario-button"/g) ?? []).length, 5);
  assert.equal((rendered.match(/data-node="/g) ?? []).length, 8);
  assert.equal((rendered.match(/data-check="/g) ?? []).length, 9);
  for (const id of ['tour-toggle', 'menu-toggle', 'json-dialog', 'json-text', 'copy-json', 'export-json', 'view-json', 'waitlist-form', 'waitlist-email', 'waitlist-submit', 'waitlist-status']) assert.ok(rendered.includes(`id="${id}"`), id);
  assert.match(rendered, /for="waitlist-email"/);
  assert.match(rendered, /id="waitlist-email"[^>]*type="email"/);
  assert.match(rendered, /aria-controls="site-nav"/);
  assert.match(rendered, /id="scenario-announcement" role="status"/);
});
