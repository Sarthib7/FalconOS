import { mkdtemp, realpath } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

// Keep the test root canonical because the data-boundary checks reject symlinked ancestors.
export async function makeTempDir(prefix: string): Promise<string> {
  return mkdtemp(join(await realpath(tmpdir()), prefix));
}
