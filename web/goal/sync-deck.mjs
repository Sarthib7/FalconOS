import { copyFile, mkdir, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const source = path.join(root, 'docs/pitches/falcon-investor-deck.html');
const sourceAssets = path.join(root, 'docs/pitches/assets');
const publicDir = path.join(root, 'web/goal/public');
const html = await readFile(source, 'utf8');
const refs = new Set();

for (const match of html.matchAll(/(?:src|href)="assets\/([^"]+)"|url\("assets\/([^"]+)"\)/g)) {
  refs.add(match[1] ?? match[2]);
}

await mkdir(path.join(publicDir, 'assets'), { recursive: true });
for (const name of refs) {
  await copyFile(path.join(sourceAssets, name), path.join(publicDir, 'assets', name));
}
await copyFile(source, path.join(publicDir, 'index.html'));

console.log(`Synced investor deck and ${refs.size} local assets to web/goal/public`);
