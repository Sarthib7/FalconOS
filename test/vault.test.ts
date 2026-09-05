import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, writeFile, mkdir, symlink, rm, readdir, open } from 'node:fs/promises';
import type { FileHandle } from 'node:fs/promises';
import { join } from 'node:path';
import { createScan } from '../src/scan.ts';
import { demoCycles } from '../src/demo.ts';
import { exportScan } from '../src/vault.ts';

async function temporary() {
  return mkdtemp('/private/tmp/falconos-test-');
}

async function stopExportAfterEvidence(scan: ReturnType<typeof createScan>, directory: string, vault: string) {
  const childSource = `
import fsPromises from 'node:fs/promises';
import { syncBuiltinESMExports } from 'node:module';
const originalLink = fsPromises.link;
fsPromises.link = async (...args) => {
  if (String(args[1]).endsWith('.md')) {
    process.send?.({ type: 'markdown-link-start' });
    await new Promise(() => {});
  }
  return originalLink(...args);
};
syncBuiltinESMExports();
const { exportScan } = await import(${JSON.stringify(new URL('../src/vault.ts', import.meta.url).href)});
await exportScan(JSON.parse(process.env.FALCONOS_SCAN), process.env.FALCONOS_DATA, process.env.FALCONOS_VAULT);
`;
  const child = spawn(process.execPath, ['--input-type=module', '-e', childSource], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      FALCONOS_SCAN: JSON.stringify(scan),
      FALCONOS_DATA: directory,
      FALCONOS_VAULT: vault,
    },
    stdio: ['ignore', 'ignore', 'pipe', 'ipc'],
  });
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      reject(new Error('Export child did not reach Markdown publication'));
    }, 5_000);
    child.once('error', error => {
      clearTimeout(timer);
      reject(error);
    });
    child.once('exit', (code, signal) => {
      clearTimeout(timer);
      reject(new Error(`Export child exited before stop: code=${code}, signal=${signal}`));
    });
    child.on('message', message => {
      if (typeof message === 'object' && message !== null && 'type' in message
        && message.type === 'markdown-link-start') {
        clearTimeout(timer);
        resolve();
      }
    });
  });
  const exit = await new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((resolve, reject) => {
    child.once('error', reject);
    child.once('exit', (code, signal) => resolve({ code, signal }));
    child.kill('SIGKILL');
  });
  assert.equal(exit.code, null);
  assert.equal(exit.signal, 'SIGKILL');
}

test('F4/F6: retain exact JSON evidence and export linked, clearly synthetic notes', async t => {
  const directory = await temporary();
  t.after(() => rm(directory, {recursive: true, force: true}));
  const now = new Date('2026-09-05T12:00:00.000Z');
  const scan = createScan(demoCycles('100000000', now), 'demo', now);
  const paths = await exportScan(scan, directory, join(directory, 'vault'));
  const evidence = await readFile(paths.evidencePath, 'utf8');
  const note = await readFile(paths.notePath, 'utf8');
  assert.deepEqual(JSON.parse(evidence), scan);
  assert.equal(createHash('sha256').update(evidence).digest('hex'), paths.evidenceSha256);
  assert.match(note, /Synthetic data/);
  assert.match(note, /\[\[FalconOS\/Strategies\/USDC-EURC\]\]/);
  assert.match(note, /execution_ready: false/);
  assert.match(note, /REVIEW/);
  assert.match(note, /Net profit/);
  assert.match(note, /six decimals were verified by a historical RPC capture on 2026-09-05/);
  assert.equal(JSON.parse(evidence).amountScale.decimals, 6);
  assert.equal(JSON.parse(evidence).candidates[1].netProfitUsdc, null);
  assert.match(note, /\| solana to base[^\n]+\n\| base to solana[^\n]+\n/);
  assert.deepEqual(await readdir(join(directory, 'runs')), [`${scan.id}.json`]);
});

test('F4: preserve human edits and reject duplicate evidence IDs', async t => {
  const directory = await temporary();
  t.after(() => rm(directory, {recursive: true, force: true}));
  const scan = createScan(demoCycles('100000000'), 'demo');
  const paths = await exportScan(scan, directory, join(directory, 'vault'));
  const note = join(directory, 'vault/FalconOS/Assets/USDC.md');
  await writeFile(note, '# My research\nKeep this.\n');
  await writeFile(paths.notePath, '# My case review\nKeep this too.\n');
  await exportScan(createScan(demoCycles('100000000'), 'demo'), directory, join(directory, 'vault'));
  assert.equal(await readFile(note, 'utf8'), '# My research\nKeep this.\n');
  assert.equal(await readFile(paths.notePath, 'utf8'), '# My case review\nKeep this too.\n');
  await assert.rejects(exportScan(scan, directory, join(directory, 'vault')), /EEXIST/);
});

test('F4: reject symlink paths and evidence inside the editable vault', async t => {
  const directory = await temporary();
  t.after(() => rm(directory, {recursive: true, force: true}));
  const external = join(directory, 'external');
  await mkdir(external);
  await symlink(external, join(directory, 'vault'));
  const scan = createScan(demoCycles('100000000'), 'demo');
  await assert.rejects(exportScan(scan, join(directory, 'data'), join(directory, 'vault')), /real directories/);
  await assert.rejects(exportScan(scan, directory, directory), /must be separate/);
  await assert.rejects(exportScan(scan, join(directory, '..evidence'), directory), /must be separate/);
  await assert.rejects(exportScan(scan, directory, join(directory, 'runs', '..notes')), /must be separate/);
});

test('F4: escape provider errors before writing Markdown', async t => {
  const directory = await temporary();
  t.after(() => rm(directory, {recursive: true, force: true}));
  const cycles = demoCycles('100000000');
  cycles[0]!.legs[0]!.error = '<script>bad</script>\n[[escape]]';
  cycles[0]!.legs[0]!.quote = null;
  const paths = await exportScan(createScan(cycles, 'demo'), directory, join(directory, 'vault'));
  const note = await readFile(paths.notePath, 'utf8');
  assert.doesNotMatch(note, /<script>|\[\[escape\]\]/);
  assert.match(note, /&#60;script&#62;/);
});

test('F4: an interrupted write cannot publish a partial evidence record', async t => {
  const directory = await temporary();
  t.after(() => rm(directory, {recursive: true, force: true}));
  const probe = await open(join(directory, 'probe'), 'wx');
  const prototype = Object.getPrototypeOf(probe) as FileHandle;
  const original = prototype.writeFile;
  await probe.close();
  t.mock.method(prototype, 'writeFile', async function(this: FileHandle) {
    await original.call(this, '{"partial":', 'utf8');
    throw Object.assign(new Error('ENOSPC: injected write failure'), {code: 'ENOSPC'});
  });
  const scan = createScan(demoCycles('100000000'), 'demo');
  await assert.rejects(exportScan(scan, directory, join(directory, 'vault')), /ENOSPC/);
  assert.deepEqual(await readdir(join(directory, 'runs')), []);
});

test('F4: abrupt export stop leaves final evidence readable and an orphan temp distinct', async t => {
  const directory = await temporary();
  t.after(() => rm(directory, {recursive: true, force: true}));
  const vault = join(directory, 'vault');
  const userNote = join(vault, 'FalconOS/Assets/USDC.md');
  await mkdir(join(vault, 'FalconOS/Assets'), {recursive: true});
  const scan = createScan(demoCycles('100000000'), 'demo', new Date('2026-09-05T12:00:00.000Z'));
  await stopExportAfterEvidence(scan, directory, vault);

  const evidencePath = join(directory, 'runs', `${scan.id}.json`);
  assert.deepEqual(JSON.parse(await readFile(evidencePath, 'utf8')), scan);
  const assets = await readdir(join(vault, 'FalconOS/Assets'));
  assert.ok(assets.some(name => /^USDC\.md\.[0-9a-f-]+\.tmp$/.test(name)));
  assert.equal(assets.includes('USDC.md'), false);
  assert.deepEqual(await readdir(join(directory, 'runs')), [`${scan.id}.json`]);

  const userText = '# User research\nKeep this note.\n';
  await writeFile(userNote, userText);
  const resumedScan = createScan(demoCycles('100000000'), 'demo', new Date('2026-09-05T12:01:00.000Z'));
  const resumedPaths = await exportScan(resumedScan, directory, vault);
  assert.equal(await readFile(userNote, 'utf8'), userText);
  assert.deepEqual(JSON.parse(await readFile(evidencePath, 'utf8')), scan);
  assert.deepEqual(JSON.parse(await readFile(resumedPaths.evidencePath, 'utf8')), resumedScan);
  assert.match(await readFile(resumedPaths.notePath, 'utf8'), /Synthetic data/);
  assert.deepEqual((await readdir(join(directory, 'runs'))).sort(), [
    `${scan.id}.json`, `${resumedScan.id}.json`,
  ].sort());
});

test('F4: completed evidence survives Markdown failure and restart preserves notes and records', async t => {
  const directory = await temporary();
  t.after(() => rm(directory, {recursive: true, force: true}));
  const vault = join(directory, 'vault');
  const blockedNote = join(vault, 'FalconOS/Assets/USDC.md');
  await mkdir(blockedNote, {recursive: true});
  const firstScan = createScan(demoCycles('100000000'), 'demo', new Date('2026-09-05T12:00:00.000Z'));
  await assert.rejects(exportScan(firstScan, directory, vault), /regular file/);
  const firstEvidence = join(directory, 'runs', `${firstScan.id}.json`);
  assert.deepEqual(JSON.parse(await readFile(firstEvidence, 'utf8')), firstScan);
  assert.deepEqual(await readdir(join(vault, 'FalconOS/Assets')), ['USDC.md']);
  assert.deepEqual(await readdir(join(directory, 'runs')), [`${firstScan.id}.json`]);

  await rm(blockedNote, {recursive: true, force: true});
  const userText = '# User research\nKeep this note.\n';
  await writeFile(blockedNote, userText);
  const secondScan = createScan(demoCycles('100000000'), 'demo', new Date('2026-09-05T12:01:00.000Z'));
  const paths = await exportScan(secondScan, directory, vault);
  assert.equal(await readFile(blockedNote, 'utf8'), userText);
  assert.deepEqual(JSON.parse(await readFile(firstEvidence, 'utf8')), firstScan);
  assert.deepEqual(JSON.parse(await readFile(paths.evidencePath, 'utf8')), secondScan);
  assert.match(await readFile(paths.notePath, 'utf8'), /Synthetic data/);
  assert.deepEqual((await readdir(join(directory, 'runs'))).sort(), [
    `${firstScan.id}.json`, `${secondScan.id}.json`,
  ].sort());
});
