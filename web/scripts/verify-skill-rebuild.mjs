#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const REPO_ROOT = fileURLToPath(new URL('../../', import.meta.url));
const USAGE = 'Usage: node web/scripts/verify-skill-rebuild.mjs --ref FULL_IMMUTABLE_COMMIT_SHA (--expected-sha256 HEX64 | --expected-record JSON_PATH)';
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');

export function verifySkillArtifacts(guideBytes, manifestBytes, expected) {
  if (!Buffer.isBuffer(guideBytes)) guideBytes = Buffer.from(guideBytes);
  const actualSha256 = sha256(guideBytes);
  if (actualSha256 !== expected.sha256) throw new Error('Rendered SKILLS.md SHA-256 mismatch');
  let manifest;
  try { manifest = JSON.parse(Buffer.isBuffer(manifestBytes) ? manifestBytes.toString('utf8') : manifestBytes); }
  catch { throw new Error('Rendered SKILLS.manifest.json is invalid JSON'); }
  for (const key of ['version', 'requiredMcpVersion', 'canonicalSkillUrl', 'sha256']) {
    if (manifest[key] !== expected[key]) throw new Error('Manifest ' + key + ' mismatch');
  }
  const frontmatter = guideBytes.toString('utf8').match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n/);
  if (!frontmatter) throw new Error('Rendered SKILLS.md has no frontmatter');
  for (const [key, value] of [['version', expected.version], ['requiredMcpVersion', expected.requiredMcpVersion]]) {
    const match = frontmatter[1].match(new RegExp('^' + key + ': (.+)$', 'm'));
    if (!match || match[1] !== value) throw new Error('Frontmatter ' + key + ' mismatch');
  }
  return { status: 'PASS', check: 'skill-rebuild', sha256: actualSha256, version: expected.version };
}

function parseArgs(args) {
  let ref;
  let expectedSha256;
  let expectedRecord;
  for (let i = 0; i < args.length; i += 1) {
    const option = args[i];
    if (option === '--ref' && ref === undefined) ref = args[++i];
    else if (option === '--expected-sha256' && expectedSha256 === undefined) expectedSha256 = args[++i];
    else if (option === '--expected-record' && expectedRecord === undefined) expectedRecord = args[++i];
    else throw new Error('Invalid or duplicate argument: ' + option);
  }
  if (!ref || !/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/i.test(ref)) throw new Error('--ref must be a full 40- or 64-hex commit SHA');
  if ((expectedSha256 === undefined) === (expectedRecord === undefined)) throw new Error('Provide exactly one of --expected-sha256 or --expected-record');
  if (expectedSha256 !== undefined && !/^[a-f0-9]{64}$/i.test(expectedSha256)) throw new Error('--expected-sha256 must be 64 hexadecimal characters');
  return { ref, expectedSha256: expectedSha256?.toLowerCase(), expectedRecord };
}

function run(command, args, cwd, label) {
  const result = spawnSync(command, args, { cwd, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 });
  if (result.error) throw new Error(label + ': ' + result.error.message);
  if (result.status !== 0) throw new Error(label + ' failed (exit ' + result.status + '): ' + (result.stderr || result.stdout).trim());
  return result.stdout.trim();
}

async function readExpected(args) {
  if (args.expectedSha256) return { version: null, requiredMcpVersion: null, canonicalSkillUrl: null, sha256: args.expectedSha256 };
  let record;
  try { record = JSON.parse(await readFile(resolve(args.expectedRecord), 'utf8')); }
  catch (error) { throw new Error('Cannot read expected release record: ' + error.message); }
  if (!record || typeof record !== 'object' || Array.isArray(record)) throw new Error('Expected release record must be a JSON object');
  for (const key of ['version', 'requiredMcpVersion', 'canonicalSkillUrl']) {
    if (typeof record[key] !== 'string' || record[key].length === 0) throw new Error('Expected release record has invalid ' + key);
  }
  if (typeof record.sha256 !== 'string' || !/^[a-f0-9]{64}$/i.test(record.sha256)) throw new Error('Expected release record has invalid sha256');
  return { version: record.version, requiredMcpVersion: record.requiredMcpVersion,
    canonicalSkillUrl: record.canonicalSkillUrl, sha256: record.sha256.toLowerCase() };
}

async function main(argv) {
  const args = parseArgs(argv);
  const expected = await readExpected(args);
  const git = ['-C', REPO_ROOT];
  const commit = run('git', [...git, 'rev-parse', '--verify', args.ref + '^{commit}'], REPO_ROOT, 'Commit lookup');
  if (commit.toLowerCase() !== args.ref.toLowerCase()) throw new Error('--ref does not identify the supplied full commit SHA');
  const tempRoot = await mkdtemp(join(tmpdir(), 'falcon-skill-rebuild-'));
  const worktree = join(tempRoot, 'worktree');
  let worktreeAttempted = false;
  let failure;
  let result;
  try {
    worktreeAttempted = true;
    run('git', [...git, 'worktree', 'add', '--detach', worktree, commit], REPO_ROOT, 'Temporary worktree creation');
    run('npm', ['ci', '--prefix', 'web', '--include=dev', '--ignore-scripts'], worktree, 'Locked npm install');
    run('npm', ['--prefix', 'web', 'run', 'build:agents'], worktree, 'Agents production build');
    const dist = join(worktree, 'web', 'dist-agents');
    const [guide, manifestBytes] = await Promise.all([
      readFile(join(dist, 'SKILLS.md')).catch(() => { throw new Error('Build output is missing SKILLS.md'); }),
      readFile(join(dist, 'SKILLS.manifest.json')).catch(() => { throw new Error('Build output is missing SKILLS.manifest.json'); }),
    ]);
    if (!expected.version) {
      let manifest;
      try { manifest = JSON.parse(manifestBytes.toString('utf8')); }
      catch { throw new Error('Rendered SKILLS.manifest.json is invalid JSON'); }
      expected.version = manifest.version;
      expected.requiredMcpVersion = manifest.requiredMcpVersion;
      expected.canonicalSkillUrl = manifest.canonicalSkillUrl;
      if (typeof expected.version !== 'string' || typeof expected.requiredMcpVersion !== 'string' || typeof expected.canonicalSkillUrl !== 'string') {
        throw new Error('Rendered manifest has incomplete release metadata');
      }
    }
    result = verifySkillArtifacts(guide, manifestBytes, expected);
    result.metadataSource = args.expectedRecord ? 'expected-record' : 'rebuilt-manifest';
    result.canonicalUrlCheckedAgainstExpectedRecord = Boolean(args.expectedRecord);
  } catch (error) {
    failure = error;
  } finally {
    if (worktreeAttempted) {
      const cleanup = spawnSync('git', [...git, 'worktree', 'remove', '--force', worktree], { cwd: REPO_ROOT, encoding: 'utf8', maxBuffer: 1024 * 1024 });
      await rm(tempRoot, { recursive: true, force: true });
      if (cleanup.error || cleanup.status !== 0) {
        const detail = 'Temporary worktree cleanup failed: ' + (cleanup.error?.message || cleanup.stderr.trim());
        failure = failure ? new Error(failure.message + '; ' + detail) : new Error(detail);
      }
    } else await rm(tempRoot, { recursive: true, force: true });
  }
  if (failure) throw failure;
  if (!result) throw new Error('Verifier ended without a result');
  return result;
}

if (process.argv[1] && await realpath(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const result = await main(process.argv.slice(2));
    process.stdout.write(JSON.stringify(result) + '\n');
  } catch (error) {
    console.error(JSON.stringify({ status: 'FAIL', check: 'skill-rebuild', error: error instanceof Error ? error.message : String(error), usage: USAGE }));
    process.exitCode = 1;
  }
}
