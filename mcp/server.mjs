import { ConfigError, parseConfig } from './src/config.mjs';
import { createApp } from './src/http.mjs';

let config;
try { config = parseConfig(process.env); }
catch (error) {
  process.stderr.write(`falcon-mcp: ${error instanceof ConfigError ? error.message : 'invalid configuration.'}\n`);
  process.exit(1);
}
const { server, close } = createApp({ config });
server.on('error', () => { process.stderr.write('falcon-mcp: HTTP service failed to start.\n'); process.exitCode = 1; });
server.listen(config.port, config.host, () => process.stdout.write(`falcon-mcp listening on port ${server.address().port}.\n`));
let closing = false;
async function shutdown() {
  if (closing) return;
  closing = true;
  const timer = setTimeout(() => process.exit(1), 10_000).unref();
  await close();
  clearTimeout(timer);
}
process.once('SIGINT', () => void shutdown());
process.once('SIGTERM', () => void shutdown());
