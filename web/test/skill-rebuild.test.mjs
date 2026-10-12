import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { mkdtemp, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { verifySkillArtifacts } from '../scripts/verify-skill-rebuild.mjs';

const guide = Buffer.from('---\nversion: 0.3.2\nrequiredMcpVersion: 0.3.0\n---\nGuide body\n');
const sha256 = createHash('sha256').update(guide).digest('hex');
const expected = { version: '0.3.2', requiredMcpVersion: '0.3.0', canonicalSkillUrl: 'https://agents.falconos.markets/SKILLS.md', sha256 };
const manifestBytes = (record = expected) => Buffer.from(JSON.stringify(record));

test('verifies exact rendered bytes and matching manifest/frontmatter metadata', () => {
  assert.deepEqual(verifySkillArtifacts(guide, manifestBytes(), expected), {
    status: 'PASS', check: 'skill-rebuild', sha256, version: expected.version,
  });
});

test('rejects changed guide bytes even when the expected record stays pinned', () => {
  assert.throws(() => verifySkillArtifacts(Buffer.from(guide.toString() + 'changed'), manifestBytes(), expected), /SHA-256 mismatch/);
});

test('rejects manifest compatibility drift and frontmatter mismatch', () => {
  assert.throws(() => verifySkillArtifacts(guide, manifestBytes({ ...expected, requiredMcpVersion: '0.3.1' }), expected), /Manifest requiredMcpVersion mismatch/);
  const wrongGuide = Buffer.from(guide.toString().replace('requiredMcpVersion: 0.3.0', 'requiredMcpVersion: 0.3.1'));
  const wrongHash = createHash('sha256').update(wrongGuide).digest('hex');
  const wrongExpected = { ...expected, sha256: wrongHash };
  assert.throws(() => verifySkillArtifacts(wrongGuide, manifestBytes({ ...wrongExpected, requiredMcpVersion: expected.requiredMcpVersion }), wrongExpected), /Frontmatter requiredMcpVersion mismatch/);
});

test('invalid CLI arguments return structured nonzero failure and usage', () => {
  const script = fileURLToPath(new URL('../scripts/verify-skill-rebuild.mjs', import.meta.url));
  const result = spawnSync(process.execPath, [script, '--ref', 'main', '--expected-sha256', 'not-a-digest'], { encoding: 'utf8' });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /"status":"FAIL"/);
  assert.match(result.stderr, /Usage: node web\/scripts\/verify-skill-rebuild\.mjs/);
});

test('V170: symlink CLI invocation rejects a moving ref with structured failure', async () => {
  const scratch = await mkdtemp(join(tmpdir(), 'falcon-skill-cli-link-'));
  try {
    const script = fileURLToPath(new URL('../scripts/verify-skill-rebuild.mjs', import.meta.url));
    const link = join(scratch, 'verify-skill.mjs');
    await symlink(script, link);
    const result = spawnSync(process.execPath, [link, '--ref', 'main', '--expected-sha256', sha256], { encoding: 'utf8' });
    assert.equal(result.status, 1);
    const failure = JSON.parse(result.stderr);
    assert.equal(failure.status, 'FAIL');
    assert.match(failure.error, /full 40- or 64-hex commit SHA/);
  } finally {
    await rm(scratch, { recursive: true, force: true });
  }
});
