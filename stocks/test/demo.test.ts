import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import test from 'node:test';

const execFileAsync = promisify(execFile);

test('Stocklana demo prints healthy, blocked, and stale cases offline', async () => {
  const { stdout, stderr } = await execFileAsync('node', ['dash/cli.ts', 'stocks-demo'], { cwd: process.cwd(), timeout: 10000 });
  assert.equal(stderr, '');
  assert.match(stdout, /STOCKS DEMO \/ HEALTHY/);
  assert.match(stdout, /status=VERIFIED/);
  assert.match(stdout, /STOCKS DEMO \/ LOW-LIQUIDITY/);
  assert.match(stdout, /Risk review: BLOCK/);
  assert.match(stdout, /STOCKS DEMO \/ STALE-REPLAY/);
  assert.match(stdout, /status=STALE/);
});
