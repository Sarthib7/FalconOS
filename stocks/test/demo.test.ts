import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import test from 'node:test';

const execFileAsync = promisify(execFile);

test('Stocklana demo prints honest healthy, blocked, and stale cases offline', async () => {
  const { stdout, stderr } = await execFileAsync('node', ['dash/cli.ts', 'stocks-demo'], { cwd: process.cwd(), timeout: 10000 });
  assert.equal(stderr, '');

  const healthy = stdout.slice(stdout.indexOf('STOCKS DEMO / HEALTHY'), stdout.indexOf('STOCKS DEMO / LOW-LIQUIDITY'));
  assert.match(healthy, /provenance=synthetic\s+snapshot=READY\s+advice=PUBLISHED/);
  assert.match(healthy, /status=VERIFIED/);
  assert.match(healthy, /AAPLx\s+60\.00%/);
  assert.match(healthy, /MSFTx\s+40\.00%/);

  const blocked = stdout.slice(stdout.indexOf('STOCKS DEMO / LOW-LIQUIDITY'), stdout.indexOf('STOCKS DEMO / STALE-REPLAY'));
  assert.match(blocked, /provenance=synthetic\s+snapshot=READY\s+advice=BLOCKED/);
  assert.match(blocked, /Risk review: BLOCK/);
  assert.match(blocked, /none \(advice not published\)/);

  const stale = stdout.slice(stdout.indexOf('STOCKS DEMO / STALE-REPLAY'));
  assert.match(stale, /provenance=synthetic\s+snapshot=READY\s+advice=NO_DATA/);
  assert.match(stale, /status=STALE/);
  assert.match(stale, /snapshot-stale/);
  assert.match(stale, /proposal-expired/);
});
