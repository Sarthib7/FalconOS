import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { fileURLToPath } from 'node:url';

const ENTRY = fileURLToPath(new URL('../../server.mjs', import.meta.url));

export function runServer(env) {
  const child = spawn(process.execPath, [ENTRY], { env: { PATH: process.env.PATH, ...env }, stdio: ['ignore', 'pipe', 'pipe'] });
  const output = { stdout: '', stderr: '' };
  child.stdout.on('data', chunk => { output.stdout += chunk; });
  child.stderr.on('data', chunk => { output.stderr += chunk; });
  const exited = once(child, 'exit').then(([code, signal]) => ({ code, signal }));
  async function listening() {
    for (let i = 0; i < 200; i += 1) {
      const match = /listening on port (\d+)/.exec(output.stdout);
      if (match) return Number(match[1]);
      const done = await Promise.race([exited, new Promise(resolve => setTimeout(resolve, 25))]);
      if (done) throw new Error(`server exited early: ${JSON.stringify(done)} ${output.stderr}`);
    }
    throw new Error('server did not start');
  }
  async function stop() { child.kill('SIGTERM'); return exited; }
  return { child, output, exited, listening, stop };
}
