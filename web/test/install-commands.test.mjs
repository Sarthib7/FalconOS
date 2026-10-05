import assert from 'node:assert/strict';
import test from 'node:test';
import {
  DEV_MCP_URL,
  DEV_SKILL_URL,
  PROD_SKILL_URL,
  UNCONFIGURED_NOTICE,
  installCommands,
  renderSkill,
  resolveInstallConfig,
} from '../bot/install-commands.mjs';

const MCP = 'https://mcp.falconos.example/mcp';
const SKILL = 'https://falconos.example/SKILLS.md';

test('https URLs are ready with no notice', () => {
  const config = resolveInstallConfig({ mcpUrl: MCP, skillUrl: SKILL, isProd: true });
  assert.deepEqual(config, { state: 'ready', mcpUrl: MCP, skillUrl: SKILL, notice: '' });
});

test('http is allowed only for loopback hosts and is a local preview', () => {
  for (const host of ['127.0.0.1:8792', 'localhost:8792', '[::1]:8792']) {
    const config = resolveInstallConfig({ mcpUrl: `http://${host}/mcp`, skillUrl: SKILL, isProd: true });
    assert.equal(config.state, 'local-preview', host);
    assert.match(config.notice, /your own machine/);
    assert.equal(config.mcpUrl, `http://${host}/mcp`);
  }
});

test('remote http is unconfigured, with no URLs and the not-deployed notice', () => {
  // This is the assertion that goes red if the loopback-only rule is removed:
  // without it http://mcp.falconos.example/mcp would resolve to local-preview or ready.
  for (const bad of ['http://mcp.falconos.example/mcp', 'http://127.0.0.2/mcp', 'http://localhost.evil.example/mcp', 'http://10.0.0.5/mcp']) {
    for (const isProd of [true, false]) {
      const config = resolveInstallConfig({ mcpUrl: bad, skillUrl: SKILL, isProd });
      assert.deepEqual(config, { state: 'unconfigured', mcpUrl: null, skillUrl: null, notice: UNCONFIGURED_NOTICE }, `${bad} prod=${isProd}`);
    }
  }
  const remoteSkill = resolveInstallConfig({ mcpUrl: MCP, skillUrl: 'http://falconos.example/SKILLS.md', isProd: false });
  assert.equal(remoteSkill.state, 'unconfigured');
});

test('unset values in a production build are unconfigured', () => {
  for (const unsetValue of [undefined, null, '']) {
    assert.equal(resolveInstallConfig({ mcpUrl: unsetValue, skillUrl: unsetValue, isProd: true }).state, 'unconfigured');
    assert.equal(resolveInstallConfig({ mcpUrl: unsetValue, skillUrl: SKILL, isProd: true }).state, 'unconfigured');
  }
  assert.equal(resolveInstallConfig({ isProd: true }).state, 'unconfigured');
  assert.equal(resolveInstallConfig({ isProd: true }).notice, 'The plugin server is not deployed yet');
});

test('production has a default skill URL but never a default MCP URL', () => {
  const config = resolveInstallConfig({ mcpUrl: MCP, skillUrl: undefined, isProd: true });
  assert.equal(config.state, 'ready');
  assert.equal(config.skillUrl, 'https://falconos.markets/SKILLS.md');
  assert.equal(PROD_SKILL_URL, config.skillUrl);
  const none = resolveInstallConfig({ isProd: true });
  assert.equal(none.state, 'unconfigured');
  assert.equal(none.mcpUrl, null);
});

test('unset values in a dev build fall back to the loopback defaults', () => {
  const config = resolveInstallConfig({ isProd: false });
  assert.equal(config.state, 'local-preview');
  assert.equal(config.mcpUrl, 'http://127.0.0.1:8792/mcp');
  assert.equal(config.skillUrl, 'http://127.0.0.1:5194/SKILLS.md');
  assert.equal(DEV_MCP_URL, config.mcpUrl);
  assert.equal(DEV_SKILL_URL, config.skillUrl);
  assert.equal(resolveInstallConfig({ mcpUrl: MCP, isProd: false }).skillUrl, DEV_SKILL_URL);
});

test('the MCP URL must be origin plus /mcp and the skill URL must end in /SKILLS.md', () => {
  for (const path of ['/', '/mcp/', '/mcp2', '/api/mcp', '/MCP', '/x/../mcp', '/mcp?x=1', '/mcp#frag']) {
    assert.equal(resolveInstallConfig({ mcpUrl: `https://mcp.falconos.example${path}`, skillUrl: SKILL, isProd: true }).state, 'unconfigured', path);
  }
  for (const path of ['/skill', '/skill.md', '/SKILLS', '/skills.md', '/SKILLS.md/', '/SKILLS.md.txt', '/a/../SKILLS.md', '//SKILLS.md', '/SKILLS.md?x=1']) {
    assert.equal(resolveInstallConfig({ mcpUrl: MCP, skillUrl: `https://falconos.example${path}`, isProd: true }).state, 'unconfigured', path);
  }
  assert.equal(resolveInstallConfig({ mcpUrl: MCP, skillUrl: 'https://falconos.example/docs/SKILLS.md', isProd: true }).state, 'ready');
  assert.equal(resolveInstallConfig({ mcpUrl: 'ftp://mcp.falconos.example/mcp', skillUrl: SKILL, isProd: true }).state, 'unconfigured');
  assert.equal(resolveInstallConfig({ mcpUrl: 'not a url', skillUrl: SKILL, isProd: true }).state, 'unconfigured');
  assert.equal(resolveInstallConfig({ mcpUrl: 42, skillUrl: SKILL, isProd: true }).state, 'unconfigured');
});

const FORBIDDEN = [
  ['credentials', 'https://user:pass@mcp.falconos.example/mcp'],
  ['username only', 'https://user@mcp.falconos.example/mcp'],
  ['space', 'https://mcp.falconos.example/mcp '],
  ['inner space', 'https://mcp.falconos.example /mcp'],
  ['tab', 'https://mcp.falconos.example/mcp\t'],
  ['newline', 'https://mcp.falconos.example/mcp\nrm -rf ~'],
  ['carriage return', 'https://mcp.falconos.example/mcp\r'],
  ['double quote', 'https://mcp.falconos.example/mcp"'],
  ['single quote', "https://mcp.falconos.example/mcp'"],
  ['backtick', 'https://mcp.falconos.example/`id`/mcp'],
  ['dollar', 'https://mcp.falconos.example/$HOME/mcp'],
  ['dollar subshell', 'https://$(id).falconos.example/mcp'],
  ['semicolon', 'https://mcp.falconos.example/mcp;id'],
  ['ampersand', 'https://mcp.falconos.example/mcp&id'],
  ['pipe', 'https://mcp.falconos.example/mcp|id'],
  ['less than', 'https://mcp.falconos.example/mcp<x'],
  ['greater than', 'https://mcp.falconos.example/mcp>x'],
  ['non-ASCII', 'https://mcp.falconos.example/mcp\u00e9'],
  ['non-ASCII host', 'https://m\u0441p.falconos.example/mcp'],
  ['backslash', 'https://mcp.falconos.example\\@evil.example/mcp'],
];

test('forbidden characters are rejected in the MCP URL and the skill URL', () => {
  for (const [name, bad] of FORBIDDEN) {
    const asMcp = resolveInstallConfig({ mcpUrl: bad, skillUrl: SKILL, isProd: true });
    assert.equal(asMcp.state, 'unconfigured', `mcp: ${name}`);
    assert.equal(asMcp.mcpUrl, null, `mcp: ${name}`);
    const badSkill = bad.replace(/mcp(?=[^/]*$)/, 'SKILLS.md');
    const asSkill = resolveInstallConfig({ mcpUrl: MCP, skillUrl: badSkill, isProd: true });
    assert.equal(asSkill.state, 'unconfigured', `skill: ${name}`);
    assert.deepEqual(installCommands(asSkill), { human: [], agent: { command: null, prompt: null } }, `skill: ${name}`);
  }
  // Control: the same shapes without the forbidden character are accepted.
  assert.equal(resolveInstallConfig({ mcpUrl: 'https://mcp.falconos.example/mcp', skillUrl: SKILL, isProd: true }).state, 'ready');
});

test('exact command strings for the Human and Agent tabs', () => {
  const config = resolveInstallConfig({ mcpUrl: MCP, skillUrl: SKILL, isProd: true });
  const { human, agent } = installCommands(config);
  assert.deepEqual(human.map(({ id, label, command }) => ({ id, label, command })), [
    { id: 'claude-code', label: 'Claude Code', command: 'claude mcp add --transport http falconos https://mcp.falconos.example/mcp' },
    { id: 'json-config', label: 'Any MCP client (JSON)', command: '{"mcpServers":{"falconos":{"type":"http","url":"https://mcp.falconos.example/mcp"}}}' },
  ]);
  for (const item of human) assert.equal(typeof item.note, 'string');
  assert.deepEqual(JSON.parse(human[1].command), { mcpServers: { falconos: { type: 'http', url: MCP } } });
  assert.equal(agent.command, 'curl -fsSL https://falconos.example/SKILLS.md');
  assert.equal(agent.prompt, 'Install the FalconOS plugin: read https://falconos.example/SKILLS.md and follow its setup steps. Use Solana Devnet only. Ask me before you sign or send anything.');
});

test('local preview produces the loopback commands', () => {
  const { human, agent } = installCommands(resolveInstallConfig({ isProd: false }));
  assert.equal(human[0].command, 'claude mcp add --transport http falconos http://127.0.0.1:8792/mcp');
  assert.equal(agent.command, 'curl -fsSL http://127.0.0.1:5194/SKILLS.md');
  assert.equal(agent.prompt, 'Install the FalconOS plugin: read http://127.0.0.1:5194/SKILLS.md and follow its setup steps. Use Solana Devnet only. Ask me before you sign or send anything.');
});

test('no command is produced when unconfigured', () => {
  const out = installCommands(resolveInstallConfig({ isProd: true }));
  assert.deepEqual(out, { human: [], agent: { command: null, prompt: null } });
  assert.deepEqual(installCommands({ state: 'unconfigured', mcpUrl: MCP, skillUrl: SKILL, notice: '' }), { human: [], agent: { command: null, prompt: null } });
  assert.deepEqual(installCommands(null), { human: [], agent: { command: null, prompt: null } });
});

test('a lowercase /skill.md URL is no longer accepted', () => {
  assert.equal(resolveInstallConfig({ mcpUrl: MCP, skillUrl: 'https://falconos.markets/skill.md', isProd: true }).state, 'unconfigured');
});

const TEMPLATE = [
  'intro {{FALCON_SKILL_URL}}',
  '<!-- if:mcp -->',
  'install {{FALCON_MCP_URL}} and {{FALCON_SKILL_URL}}',
  '<!-- else:mcp -->',
  'not deployed yet',
  '<!-- endif:mcp -->',
  'outro',
].join('\n');

test('renderSkill keeps the configured branch and substitutes both placeholders', () => {
  const out = renderSkill(TEMPLATE.replace('intro {{FALCON_SKILL_URL}}', 'intro'), { mcpUrl: MCP, skillUrl: SKILL, isProd: true });
  assert.equal(out, `intro\ninstall ${MCP} and ${SKILL}\noutro`);
  assert.match(renderSkill('<!-- if:mcp -->\n{{FALCON_MCP_URL}}\n<!-- else:mcp -->\nno\n<!-- endif:mcp -->\n', { isProd: false }), /^http:\/\/127\.0\.0\.1:8792\/mcp\n$/);
});

test('renderSkill keeps the else branch and never throws when the MCP URL is missing', () => {
  const template = TEMPLATE.replace('intro {{FALCON_SKILL_URL}}', 'intro');
  for (const mcpUrl of [undefined, '', 'http://mcp.falconos.example/mcp']) {
    const out = renderSkill(template, { mcpUrl, skillUrl: SKILL, isProd: true });
    assert.equal(out, 'intro\nnot deployed yet\noutro', String(mcpUrl));
    assert.ok(!out.includes('{{') && !out.includes('<!--'));
  }
});

test('renderSkill rejects leftovers instead of emitting them', () => {
  assert.throws(() => renderSkill('{{FALCON_OTHER}}', { mcpUrl: MCP, skillUrl: SKILL, isProd: true }), /unresolved/);
  assert.throws(() => renderSkill('<!-- if:mcp -->\nopen only', { mcpUrl: MCP, skillUrl: SKILL, isProd: true }), /unresolved/);
  assert.throws(() => renderSkill('outside {{FALCON_MCP_URL}}', { isProd: true }), /unresolved/);
});
