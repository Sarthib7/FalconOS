import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const product = await readFile(new URL('../product/index.html', import.meta.url), 'utf8');
const research = await readFile(new URL('../research/index.html', import.meta.url), 'utf8');

test('V58: product and research pages carry the deeper context', () => {
  assert.match(product, /A firm view for agent decisions\./);
  assert.match(product, /Advisory pipeline/);
  assert.match(product, /executionReady=false/);
  assert.match(product, /FALCON<i class="wm-os">OS<\/i>/);
  assert.match(product, /href="\/research\/"/);

  assert.match(research, /Evidence before allocation\./);
  assert.match(research, /Record format/);
  assert.match(research, /Planned research program/);
  assert.match(research, /01 \/ Capture/);
  assert.match(research, /05 \/ Keep outcome/);
  assert.match(research, /Execution.*Disabled/s);
  assert.match(research, /FALCON<i class="wm-os">OS<\/i>/);
  assert.match(research, /href="\/#market-view"/);
});
