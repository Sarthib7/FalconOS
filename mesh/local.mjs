import { createHash, randomBytes } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL must name an initialized local mesh database.');
const state = new URL('./.local/', import.meta.url);
await mkdir(state, { recursive: true, mode: 0o700 });
const tokenFile = new URL('operator-token', state);
try { await writeFile(tokenFile, `${randomBytes(32).toString('hex')}\n`, { flag: 'wx', mode: 0o600 }); }
catch (error) { if (error.code !== 'EEXIST') throw error; }
const token = (await readFile(tokenFile, 'utf8')).trim();
if (!/^[a-f0-9]{64}$/.test(token)) throw new Error('Local operator token is invalid.');
const hash = createHash('sha256').update(token).digest('hex');
const serviceTokenFile = new URL('oauth-service-token', state);
try { await writeFile(serviceTokenFile, randomBytes(32).toString('base64url') + '\n', { flag: 'wx', mode: 0o600 }); }
catch (error) { if (error.code !== 'EEXIST') throw error; }
const serviceSecret = (await readFile(serviceTokenFile, 'utf8')).trim();
if (!/^[A-Za-z0-9_-]{43}$/.test(serviceSecret)) throw new Error('Local MCP OAuth service token is invalid.');
process.stdout.write('Local access token is saved in mesh/.local/operator-token. Paste it into the mesh connection form.\n');
const child = spawn(process.execPath, [fileURLToPath(new URL('./server.mjs', import.meta.url))], {
  stdio: 'inherit', env: { ...process.env, FALCON_MESH_HOST: '127.0.0.1',
    FALCON_MESH_TOKEN_HASHES: JSON.stringify({ [hash]: 'local' }),
    FALCON_MCP_OAUTH_ISSUER: 'http://127.0.0.1:8791', FALCON_MCP_OAUTH_RESOURCE: 'http://127.0.0.1:8792/mcp',
    FALCON_MCP_OAUTH_APPROVAL_URL: 'http://127.0.0.1:5194/oauth/approve', FALCON_MCP_OAUTH_SERVICE_SECRET: serviceSecret,
    FALCON_MESH_ORIGINS: 'http://127.0.0.1:4183,http://localhost:4183,http://127.0.0.1:5173,http://localhost:5173,http://127.0.0.1:5194,http://localhost:5194' },
});
for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => child.kill(signal));
child.once('error', () => { process.stderr.write('Local mesh process could not start.\n'); process.exitCode = 1; });
child.once('exit', code => { process.exitCode = code ?? 0; });
