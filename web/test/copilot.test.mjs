import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const html = await readFile(new URL('../copilot/index.html', import.meta.url), 'utf8');
const scripts = [...html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/gi)].map((match) => match[1]);

test('copilot surface contains wallet, advisory, trade, and PreStocks controls', () => {
  assert.match(html, /id="wallet-connect-control"/);
  assert.match(html, /Advisory only\./);
  assert.match(html, /Real mainnet trade\. You sign, you own it\./);
  assert.match(html, /PreweJYECqtQwBtpxHL171nL2K6umo692gTm7Q3rpgF/);
  assert.match(html, /PreANxuXjsy2pvisWWMNB6YaJNzr7681wJJr2rHsfTh/);
  assert.match(html, /Council does not endorse this trade right now/);
});

test('copilot page contains no private-key or seed handling strings', () => {
  assert.doesNotMatch(html, /private[- ]?key|seed phrase|mnemonic|secret key|secretKey/i);
});

test('every inline script compiles', () => {
  assert.ok(scripts.length > 0);
  for (const script of scripts) assert.doesNotThrow(() => new Function(script));
});

test('sign path deserializes before wallet handoff and copilot stays out of the production build', async () => {
  assert.match(html, /VersionedTransaction\.deserialize/);
  assert.doesNotMatch(html, /signAndSendTransaction\(unsignedTransaction\)/);
  assert.match(html, /Rebuild for the connected account/);
  const vite = await readFile(new URL('../vite.config.js', import.meta.url), 'utf8');
  assert.doesNotMatch(vite, /copilot: entry/);
});
