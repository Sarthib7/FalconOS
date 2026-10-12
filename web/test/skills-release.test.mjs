import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { build, createServer } from 'vite';
import { falconSkills } from '../scripts/skills-plugin.mjs';
import { CANONICAL_SKILL_URL, renderSkillsRelease } from '../scripts/skills-release.mjs';

const webRoot = resolve(fileURLToPath(new URL('../', import.meta.url)));
const guidePath = new URL('../skills/SKILLS.md', import.meta.url);
const agentsConfig = resolve(webRoot, 'vite.agents.config.js');
const MCP_URL = 'https://mcp.falconos.markets/mcp';
const SKILL_URL = CANONICAL_SKILL_URL;
const sha256 = value => createHash('sha256').update(value).digest('hex');
const contentDigest = value => 'sha-256=:' + createHash('sha256').update(value).digest('base64') + ':';
const textAsset = value => typeof value === 'string' ? value : Buffer.from(value).toString('utf8');

async function sourceGuide() { return readFile(guidePath, 'utf8'); }

test('shared renderer pins exact rendered bytes and changes digest when guide content changes', async () => {
  const template = await sourceGuide();
  const options = { mcpUrl: MCP_URL, skillUrl: SKILL_URL, isProd: true };
  const rendered = renderSkillsRelease(template, options);
  const guide = rendered.skill.body;
  const frontmatter = guide.match(/^---\n([\s\S]*?)\n---\n/)?.[1];
  assert.ok(frontmatter, 'rendered guide has release metadata');
  const version = frontmatter.match(/^version: (.+)$/m)?.[1];
  const requiredMcpVersion = frontmatter.match(/^requiredMcpVersion: (.+)$/m)?.[1];
  assert.ok(version && requiredMcpVersion, 'guide declares both release compatibility values');
  const expected = sha256(Buffer.from(rendered.skill.body, 'utf8'));
  assert.equal(rendered.skill.sha256, expected);
  assert.equal(rendered.skill.headers['Content-Digest'], contentDigest(Buffer.from(rendered.skill.body, 'utf8')));
  assert.deepEqual(JSON.parse(rendered.manifest.body), {
    version,
    requiredMcpVersion,
    canonicalSkillUrl: CANONICAL_SKILL_URL,
    sha256: expected,
  });
  assert.ok(!rendered.skill.body.includes(expected), 'the guide must not contain its own digest');
  const changed = renderSkillsRelease(template + '\n<!-- release-content-change -->\n', options);
  assert.notEqual(changed.skill.sha256, rendered.skill.sha256);
  assert.equal(JSON.parse(changed.manifest.body).sha256, sha256(Buffer.from(changed.skill.body, 'utf8')));
});

test('unconfigured production build emits no MCP setup command', async () => {
  const plugin = falconSkills();
  plugin.configResolved({ env: {}, isProduction: true });
  const assets = new Map();
  await plugin.generateBundle.call({ emitFile: asset => assets.set(asset.fileName, textAsset(asset.source)) });
  const skill = assets.get('SKILLS.md');
  const manifest = JSON.parse(assets.get('SKILLS.manifest.json'));
  assert.ok(skill);
  assert.ok(manifest);
  assert.equal(manifest.sha256, sha256(Buffer.from(skill, 'utf8')));
  assert.ok(!skill.includes('claude mcp add'));
  assert.ok(!skill.includes('codex mcp add'));
  assert.ok(!skill.includes('mcpServers'));
  assert.ok(!skill.includes('{{') && !skill.includes('<!--'));
  assert.ok(assets.has('_headers'));
});

test('unsafe URL substitutions fail closed without placing input in setup output', async () => {
  const template = await sourceGuide();
  const hostileMcp = 'https://mcp.example/mcp;touch-pwned';
  const hostileSkill = 'https://agent.example/SKILLS.md?next=$(id)';
  const rendered = renderSkillsRelease(template, { mcpUrl: hostileMcp, skillUrl: hostileSkill, isProd: true });
  assert.ok(!rendered.skill.body.includes(hostileMcp));
  assert.ok(!rendered.skill.body.includes(hostileSkill));
  assert.ok(!rendered.skill.body.includes('claude mcp add'));
  assert.ok(!rendered.skill.body.includes('$(id)'));
});

test('agents Vite build emits guide, manifest, and static integrity headers from the shared render', async () => {
  const priorMcp = process.env.VITE_FALCON_MCP_URL;
  const priorSkill = process.env.VITE_FALCON_SKILL_URL;
  process.env.VITE_FALCON_MCP_URL = MCP_URL;
  process.env.VITE_FALCON_SKILL_URL = SKILL_URL;
  let emitted = new Map();
  try {
    await build({
      configFile: agentsConfig,
      logLevel: 'silent',
      build: { write: false },
      plugins: [{
        name: 'capture-skill-release-assets',
        enforce: 'post',
        generateBundle(_options, bundle) { emitted = new Map(Object.entries(bundle).map(([name, asset]) => [name, asset.type === 'asset' ? textAsset(asset.source) : null])); },
      }],
    });
  } finally {
    if (priorMcp === undefined) delete process.env.VITE_FALCON_MCP_URL; else process.env.VITE_FALCON_MCP_URL = priorMcp;
    if (priorSkill === undefined) delete process.env.VITE_FALCON_SKILL_URL; else process.env.VITE_FALCON_SKILL_URL = priorSkill;
  }
  const skill = emitted.get('SKILLS.md');
  const manifestText = emitted.get('SKILLS.manifest.json');
  const headers = emitted.get('_headers');
  assert.ok(skill && manifestText && headers);
  const digest = sha256(Buffer.from(skill, 'utf8'));
  const manifest = JSON.parse(manifestText);
  assert.equal(manifest.sha256, digest);
  assert.equal(manifest.canonicalSkillUrl, CANONICAL_SKILL_URL);
  assert.equal(headers.includes('Content-Digest: ' + contentDigest(Buffer.from(skill, 'utf8'))), true);
  assert.equal(headers.includes('X-Falcon-Skill-SHA256: ' + digest), true);
  assert.equal(headers.includes('Content-Digest: ' + contentDigest(Buffer.from(manifestText, 'utf8'))), true);
});

test('existing agents Vite server serves GET and HEAD guide and manifest with matching integrity', async t => {
  const priorMcp = process.env.VITE_FALCON_MCP_URL;
  const priorSkill = process.env.VITE_FALCON_SKILL_URL;
  process.env.VITE_FALCON_MCP_URL = MCP_URL;
  process.env.VITE_FALCON_SKILL_URL = SKILL_URL;
  let vite;
  try {
    vite = await createServer({ configFile: agentsConfig, logLevel: 'silent', server: { host: '127.0.0.1', port: 0, strictPort: false } });
    await vite.listen();
  } catch (error) {
    if (priorMcp === undefined) delete process.env.VITE_FALCON_MCP_URL; else process.env.VITE_FALCON_MCP_URL = priorMcp;
    if (priorSkill === undefined) delete process.env.VITE_FALCON_SKILL_URL; else process.env.VITE_FALCON_SKILL_URL = priorSkill;
    throw error;
  }
  t.after(async () => {
    await vite.close();
    if (priorMcp === undefined) delete process.env.VITE_FALCON_MCP_URL; else process.env.VITE_FALCON_MCP_URL = priorMcp;
    if (priorSkill === undefined) delete process.env.VITE_FALCON_SKILL_URL; else process.env.VITE_FALCON_SKILL_URL = priorSkill;
  });
  const address = vite.httpServer.address();
  const base = 'http://127.0.0.1:' + address.port;
  for (const path of ['/SKILLS.md', '/SKILLS.manifest.json']) {
    const get = await fetch(base + path);
    assert.equal(get.status, 200, path);
    assert.match(get.headers.get('content-type') || '', path.endsWith('.md') ? /text\/markdown/ : /application\/json/);
    assert.match(get.headers.get('cache-control') || '', /no-store/);
    assert.equal(get.headers.get('x-content-type-options'), 'nosniff');
    const body = Buffer.from(await get.arrayBuffer());
    const expectedDigest = contentDigest(body);
    assert.equal(get.headers.get('content-digest'), expectedDigest);
    const head = await fetch(base + path, { method: 'HEAD' });
    assert.equal(head.status, 200, path);
    assert.equal(head.headers.get('content-digest'), expectedDigest);
    assert.equal(head.headers.get('content-length'), String(body.length));
    assert.equal((await head.arrayBuffer()).byteLength, 0);
    if (path === '/SKILLS.md') {
      assert.equal(get.headers.get('x-falcon-skill-sha256'), sha256(body));
      const manifestResponse = await fetch(base + '/SKILLS.manifest.json');
      const manifest = await manifestResponse.json();
      assert.equal(manifest.sha256, sha256(body));
      assert.equal(manifest.canonicalSkillUrl, CANONICAL_SKILL_URL);
    } else {
      assert.equal(get.headers.get('x-falcon-skill-manifest-sha256'), sha256(body));
    }
  }
});