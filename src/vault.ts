import { constants } from 'node:fs';
import { link, lstat, mkdir, open, unlink } from 'node:fs/promises';
import { createHash, randomUUID } from 'node:crypto';
import { dirname, isAbsolute, join, parse, relative, resolve, sep } from 'node:path';
import type { Scan } from './types.ts';

async function safeDirectory(directory: string): Promise<string> {
  const absolute = resolve(directory);
  const root = parse(absolute).root;
  let current = root;
  for (const component of absolute.slice(root.length).split('/').filter(Boolean)) {
    current = join(current, component);
    try { await mkdir(current); } catch (error) {
      if (!(error instanceof Error && 'code' in error && error.code === 'EEXIST')) throw error;
    }
    const stat = await lstat(current);
    if (stat.isSymbolicLink() || !stat.isDirectory()) throw new Error(`Output path must use real directories: ${current}`);
  }
  return absolute;
}

async function writeNew(path: string, content: string, allowExisting = false): Promise<boolean> {
  await safeDirectory(dirname(path));
  const temporary = `${path}.${randomUUID()}.tmp`;
  const file = await open(temporary, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
  try {
    try { await file.writeFile(content, 'utf8'); await file.sync(); } finally { await file.close(); }
    // Publish complete contents without replacing an existing record or user note.
    try { await link(temporary, path); } catch (error) {
      if (allowExisting && error instanceof Error && 'code' in error && error.code === 'EEXIST') {
        const stat = await lstat(path);
        if (stat.isSymbolicLink() || !stat.isFile()) throw new Error(`Existing note is not a regular file: ${path}`);
        return false;
      }
      throw error;
    }
    return true;
  } finally {
    await unlink(temporary);
  }
}

function escapeText(text: string): string {
  return text.replace(/[\r\n\u0000-\u001f]/g, ' ').replace(/[<>&\[\]`|*_\\]/g, character => `&#${character.charCodeAt(0)};`);
}

function contains(parent: string, child: string): boolean {
  const path = relative(parent, child);
  return path === '' || (path !== '..' && !path.startsWith(`..${sep}`) && !isAbsolute(path));
}

export async function exportScan(scan: Scan, dataDirectory: string, vaultDirectory: string) {
  if (!/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(scan.id)) throw new Error('Invalid scan ID');
  // Do not put the canonical evidence inside a vault that plugins or humans can edit.
  const dataRoot = resolve(dataDirectory);
  const vaultRoot = resolve(vaultDirectory);
  const evidenceRoot = join(dataRoot, 'runs');
  if (contains(vaultRoot, evidenceRoot) || contains(evidenceRoot, vaultRoot)) {
    throw new Error('Evidence and vault directories must be separate');
  }
  await safeDirectory(dataRoot);
  await safeDirectory(vaultRoot);
  const record = `${JSON.stringify(scan, null, 2)}\n`;
  const hash = createHash('sha256').update(record).digest('hex');
  const evidencePath = join(evidenceRoot, `${scan.id}.json`);
  await writeNew(evidencePath, record);

  const project = join(vaultRoot, 'FalconOS');
  const notes: Record<string, string> = {
    'Assets/USDC.md': '# USDC\n\nDollar-denominated asset in the configured registry.\n\n[[FalconOS/Strategies/USDC-EURC]]\n',
    'Assets/EURC.md': '# EURC\n\nEuro-denominated asset. A USDC/EURC ratio other than one is not evidence of a dollar depeg.\n\n[[FalconOS/Strategies/USDC-EURC]]\n',
    'Chains/Solana.md': '# Solana\n\n[[FalconOS/Sources/Jupiter]]\n',
    'Chains/Base.md': '# Base\n\n[[FalconOS/Sources/KyberSwap]]\n',
    'Sources/Jupiter.md': '# Jupiter\n\n[Order documentation](https://developers.jup.ag/docs/api-reference/swap/order)\n\n[[FalconOS/Chains/Solana]]\n',
    'Sources/KyberSwap.md': '# KyberSwap\n\n[API documentation](https://docs.kyberswap.com/kyberswap-solutions/kyberswap-aggregator/aggregator-api-specification/evm-swaps)\n\n[[FalconOS/Chains/Base]]\n',
    'Strategies/USDC-EURC.md': '# Cross-chain USDC/EURC comparison\n\n[[FalconOS/Assets/USDC]] and [[FalconOS/Assets/EURC]] across [[FalconOS/Chains/Solana]] and [[FalconOS/Chains/Base]].\n\nSequential quotes assume EURC already exists on the selling chain. Gas, adverse fills, and restoration costs remain unproven. This is FX research, not peg detection or a trade instruction.\n',
    'Start.md': '# FalconOS research\n\nOpen Graph view or browse the Runs folder. Each run links its evidence to [[FalconOS/Strategies/USDC-EURC]].\n\nDemo runs use synthetic observations. Live runs record public quotes. Neither mode signs or executes trades.\n\nThese notes are advisory. Edit your notes freely; the exporter does not replace existing files.\n',
  };
  for (const [name, content] of Object.entries(notes)) await writeNew(join(project, name), content, true);

  const lines = [
    '---', `id: ${scan.id}`, `mode: ${scan.mode}`, `observed_at: ${JSON.stringify(scan.assessedAt)}`,
    'execution_ready: false', 'tags:', '  - falconos', `  - ${scan.mode}`, '---', '',
    `# ${scan.mode === 'demo' ? 'Synthetic demonstration' : 'Live quote observations'}`, '',
    `Observed: ${scan.assessedAt}`, '',
    scan.mode === 'demo' ? '**Synthetic data. No market requests or trades occurred.**' : '**Public quotes. No trades occurred.**', '',
    '[[FalconOS/Strategies/USDC-EURC]]', '',
    `Evidence ID: ${scan.id}`, '', `Evidence SHA-256: ${hash}`, '',
    'Amount scale: six decimals were verified by a historical RPC capture on 2026-09-05. Runtime metadata revalidation is not performed.', '',
    '| Direction | Decision | Quoted difference, USDC | Net profit |',
    '| --- | --- | ---: | --- |',
  ];
  for (const candidate of scan.candidates) {
    lines.push(`| ${candidate.sourceChain} to ${candidate.destinationChain} | ${candidate.status} | ${candidate.quotedDeltaUsdc ?? 'unknown'} | unknown |`);
  }
  for (const candidate of scan.candidates) {
    lines.push('', `## ${candidate.sourceChain} to ${candidate.destinationChain}`, '');
    lines.push(`Reasons: ${candidate.reasons.join(', ')}.`);
    for (const fee of candidate.gasEstimatesUsd) lines.push('', `Estimated ${fee.chain} gas in USD: ${fee.gas ?? 'unknown'}. L1 fee in USD: ${fee.l1Fee ?? 'unknown'}.`);
  }
  lines.push('', '## Source coverage', '');
  for (const cycle of scan.cycles) {
    lines.push(`### ${cycle.sourceChain} to ${cycle.destinationChain}`, '');
    for (const leg of cycle.legs) {
      lines.push(`- ${leg.request.chain}: ${leg.quote ? 'validated response' : 'unavailable'}. HTTP ${leg.httpStatus ?? 'none'}. Received ${escapeText(leg.receivedAt)}.`);
      if (leg.error) lines.push(`  Error: ${escapeText(leg.error)}`);
      if (leg.quote?.providerTimestamp) lines.push(`  Provider timestamp: ${escapeText(leg.quote.providerTimestamp)}. Its precise quote-age semantics are unverified.`);
    }
    if (cycle.legs.length < 2) lines.push('- Dependent quote was not collected.');
    lines.push('');
  }
  lines.push('## Interpretation', '', 'Quoted outputs include their route pricing. USD gas estimates are shown separately. Zero or missing fee fields do not establish free execution. Inventory, simultaneous fills, slippage, and restoration remain unverified.', '', '## Your research', '', 'Add supporting or conflicting evidence here. These edits cannot authorize a trade.', '');
  const notePath = join(project, 'Runs', `${scan.id}.md`);
  await writeNew(notePath, lines.join('\n'));
  return {evidencePath, notePath, evidenceSha256: hash};
}
