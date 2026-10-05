import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { renderSkill } from '../bot/install-commands.mjs';

// Publishes web/skills/SKILLS.md at /SKILLS.md for the site, bot and MVP builds and dev servers.
// The text is read and emitted as an asset, never imported as a module. A missing
// VITE_FALCON_MCP_URL does not fail the build: the file then carries its "not deployed yet" branch.
const source = fileURLToPath(new URL('../skills/SKILLS.md', import.meta.url));

export function falconSkills() {
  let resolved;
  const render = async () => renderSkill(await readFile(source, 'utf8'), {
    mcpUrl: resolved.env.VITE_FALCON_MCP_URL,
    skillUrl: resolved.env.VITE_FALCON_SKILL_URL,
    isProd: resolved.isProduction,
  });
  const serve = (server) => {
    server.middlewares.use('/SKILLS.md', async (request, response, next) => {
      if (request.method !== 'GET' && request.method !== 'HEAD') return next();
      try {
        const body = await render();
        response.writeHead(200, { 'content-type': 'text/markdown; charset=utf-8', 'cache-control': 'no-store' });
        response.end(request.method === 'HEAD' ? undefined : body);
      } catch (error) {
        next(error);
      }
    });
  };
  return {
    name: 'falcon-skills',
    configResolved(config) { resolved = config; },
    async generateBundle() { this.emitFile({ type: 'asset', fileName: 'SKILLS.md', source: await render() }); },
    configureServer: serve,
    configurePreviewServer: serve,
  };
}
