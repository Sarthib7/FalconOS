import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const html = await readFile(new URL('../copilot/index.html', import.meta.url), 'utf8');
const scripts = [...html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/gi)].map((match) => match[1]);

test('copilot surface contains wallet, advisory, trade, and PreStocks controls', () => {
  assert.match(html, /id="wallet-connect-control"/);
  assert.match(html, /Advisory only\./);
  assert.match(html, /A BLOCKED or NO_DATA verdict does not send by itself\./);
  assert.match(html, /class="pane graph terminal"/);
  assert.match(html, /\.pane\.graph\.terminal \{[^}]*font-family:\s*ui-monospace/);
  assert.match(html, /node\.kind \+ ' · ' \+ node\.label/);
  assert.match(html, /node\.detail \|\| node\.value \|\| node\.source \|\| node\.reason/);
  assert.match(html, /Surfpool local mainnet fork/);
  assert.match(html, /http:\/\/127\.0\.0\.1:8899/);
  assert.match(html, /Jupiter uses mainnet market data/);
  assert.match(html, /exec\.getLatestBlockhash\(rpc\)/);
  assert.match(html, /exec\.simulateEncoded\(rpc, simulationPayload\)/);
  assert.match(html, /payload\.execution_ready !== false/);
  assert.match(html, /citation-list/);
  assert.doesNotMatch(html, /api\.devnet\.solana\.com/);
  assert.doesNotMatch(html, /api\.mainnet-beta\.solana\.com/);
  assert.match(html, /exec\.sendEncoded\(rpc/);
  assert.doesNotMatch(html, /signAndSendTransaction/);
  assert.match(html, /PreweJYECqtQwBtpxHL171nL2K6umo692gTm7Q3rpgF/);
  assert.match(html, /PreANxuXjsy2pvisWWMNB6YaJNzr7681wJJr2rHsfTh/);
  assert.match(html, /Council does not endorse this trade right now/);
  assert.match(html, /row\.underlying \|\| row\.asset_id/);
  assert.match(html, /payload\.snapshot_sha256 !== adviceHash/);
  assert.ok(html.indexOf('class="pane graph terminal"') >= 0);
  assert.ok(html.indexOf('class="pane graph terminal"') < html.indexOf('id="trade-title"'));
  assert.ok(html.indexOf('class="advice-on-graph"') > html.indexOf('class="pane graph terminal"'));
  assert.ok(html.indexOf('id="advice-title"') < html.indexOf('id="trade-title"'));
  console.log('graph-before-trade advice-on-graph terminal font-family: ui-monospace node.kind node.detail value source reason 127.0.0.1:8899');
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
  assert.match(html, /Ticket changed while preparing the transaction/);
  assert.match(html, /signInFlight/);
  assert.match(html, /generation !== buildGeneration/);
  const vite = await readFile(new URL('../vite.config.js', import.meta.url), 'utf8');
  assert.doesNotMatch(vite, /copilot: entry/);
});
