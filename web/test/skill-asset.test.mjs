import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { resolveInstallConfig } from '../bot/install-commands.mjs';

const web = fileURLToPath(new URL('../', import.meta.url));
const MCP = 'https://mcp.falconos.example/mcp';
const NOT_DEPLOYED = 'The Falcon MCP server is not deployed yet. Do not install anything or edit any config. Tell the human the plugin is not available yet.';
const read = (path) => readFile(path, 'utf8');

// Builds the bot bundle (it carries the same shared skills plugin as the MVP and site builds)
// into a temp directory, so dist-mvp stays untouched. NODE_ENV is production for `vite build`.
async function buildSkill(t, env) {
  const out = await mkdtemp(join(tmpdir(), 'falcon-skill-build-'));
  t.after(() => rm(out, { recursive: true, force: true }));
  const result = spawnSync(process.execPath, [join(web, 'node_modules/vite/bin/vite.js'), 'build', '--config', 'vite.bot.config.js', '--outDir', out, '--emptyOutDir'], {
    cwd: web, encoding: 'utf8', timeout: 120000, env: { PATH: process.env.PATH, HOME: process.env.HOME, ...env },
  });
  assert.equal(result.error, undefined, result.error?.message);
  assert.equal(result.status, 0, result.stdout + result.stderr);
  return read(join(out, 'SKILLS.md'));
}

function frontmatter(text) {
  const match = text.match(/^---\n([\s\S]*?)\n---\n/);
  assert.ok(match, 'frontmatter block');
  return match[1];
}

function assertClean(text) {
  assert.ok(!text.includes('{{'), 'no {{ remains');
  assert.ok(!text.includes('<!-- '), 'no HTML comment marker remains');
  assert.ok(!/<!--\s*(if|else|endif):/.test(text), 'no conditional marker remains');
  assert.ok(!/[\u2013\u2014]/.test(text), 'no em or en dashes');
}

const INSTALL_STRINGS = ['claude mcp add', '"mcpServers"', 'falcon_connect', 'signTransaction'];

test('built dist-mvp/SKILLS.md has frontmatter and no markers, and the old lowercase file is gone', async () => {
  const built = await read(join(web, 'dist-mvp/SKILLS.md'));
  const fm = frontmatter(built);
  assert.match(fm, /^name: falconos$/m);
  const description = fm.match(/^description: (.+)$/m)?.[1] ?? '';
  assert.ok(description.length > 80 && /Use when/.test(description), 'description says when to use the skill');
  assertClean(built);
  assert.ok(built.split('\n').length <= 260, 'at most 260 lines');
  if (process.env.VITE_FALCON_MCP_URL) assert.ok(built.includes(process.env.VITE_FALCON_MCP_URL), 'configured MCP URL appears');
  await assert.rejects(read(join(web, 'dist-mvp/skill.md')), /ENOENT/);
});

test('with an MCP URL configured the skill carries the install steps and that URL', async (t) => {
  const built = await buildSkill(t, { VITE_FALCON_MCP_URL: MCP });
  assert.match(frontmatter(built), /^name: falconos$/m);
  assertClean(built);
  assert.ok(built.includes(`claude mcp add --transport http falconos ${MCP}`), 'Claude Code command uses the MCP URL');
  assert.ok(built.includes(`{"mcpServers":{"falconos":{"type":"http","url":"${MCP}"}}}`), 'JSON entry uses the same URL with type http');
  assert.ok(built.includes(`- MCP server URL: ${MCP}`));
  const skillUrl = built.match(/^- This skill: (\S+)$/m)?.[1];
  assert.equal(skillUrl, 'https://falconos.markets/SKILLS.md', 'production default skill URL');
  assert.equal(resolveInstallConfig({ mcpUrl: MCP, skillUrl, isProd: true }).state, 'ready');
  assert.ok(!built.includes(NOT_DEPLOYED));
  for (const tool of ['connect', 'connect_verify', 'disconnect', 'yield_opportunities', 'refresh_evidence', 'reserve_decision', 'prepare_transaction', 'submit_signed', 'check_receipt', 'activity']) {
    assert.ok(built.includes(`falcon_${tool}`), `falcon_${tool}`);
  }
  const order = built.slice(built.indexOf('## Signing order (do not improvise)'));
  assert.ok(order.indexOf('falcon_prepare_transaction') < order.indexOf('signTransaction'));
  assert.ok(order.indexOf('signTransaction') < order.indexOf('falcon_submit_signed'));
  assert.ok(order.indexOf('falcon_submit_signed') < order.indexOf('Only then broadcast the SAME signed bytes'));
  assert.ok(order.indexOf('Only then broadcast the SAME signed bytes') < order.indexOf('falcon_check_receipt'));
  assert.match(order, /NEVER use `signAndSendTransaction`/);
});

test('a production build without an MCP URL succeeds and ships the not-deployed variant with no install commands', async (t) => {
  const built = await buildSkill(t, {});
  assert.match(frontmatter(built), /^name: falconos$/m);
  assertClean(built);
  assert.ok(built.includes(NOT_DEPLOYED), 'not deployed yet sentence');
  for (const text of INSTALL_STRINGS) assert.ok(!built.includes(text), `no ${text}`);
  assert.ok(!/https?:\/\/[^\s]*\/mcp/.test(built), 'no MCP URL');
});
