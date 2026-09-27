import { randomBytes } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const mode = process.argv[2];
if (!['dev', 'preview'].includes(mode)) throw new Error('Choose dev or preview.');
const state = new URL('./.local/', import.meta.url);
await mkdir(state, { recursive: true, mode: 0o700 });
const saltFile = new URL('waitlist-salt', state);
try { await writeFile(saltFile, randomBytes(32).toString('hex'), { flag: 'wx', mode: 0o600 }); }
catch (error) { if (error.code !== 'EEXIST') throw error; }
const salt = (await readFile(saltFile, 'utf8')).trim();
if (!/^[a-f0-9]{64}$/.test(salt)) throw new Error('Local waitlist salt is invalid.');
const child = spawn(process.execPath, [fileURLToPath(new URL('./node_modules/vite/bin/vite.js', import.meta.url)),
  ...(mode === 'preview' ? ['preview'] : []), '--host', '127.0.0.1', '--port', '4183', '--strictPort', ...process.argv.slice(3)], {
  cwd: fileURLToPath(new URL('./', import.meta.url)), stdio: 'inherit',
  env: { ...process.env, FALCON_WAITLIST_DB_PATH: process.env.FALCON_WAITLIST_DB_PATH || fileURLToPath(new URL('waitlist.sqlite', state)), FALCON_WAITLIST_IP_SALT: process.env.FALCON_WAITLIST_IP_SALT || salt },
});
for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => child.kill(signal));
child.once('error', () => { process.stderr.write('Local web process could not start.\n'); process.exitCode = 1; });
child.once('exit', code => { process.exitCode = code ?? 0; });
