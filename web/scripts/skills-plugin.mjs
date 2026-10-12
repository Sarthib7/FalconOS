import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { renderSkillsRelease } from './skills-release.mjs';

const source = fileURLToPath(new URL('../skills/SKILLS.md', import.meta.url));
const routes = new Map([['/SKILLS.md', 'skill'], ['/SKILLS.manifest.json', 'manifest']]);

export function falconSkills() {
  let resolved;
  const render = async () => renderSkillsRelease(await readFile(source, 'utf8'), {
    mcpUrl: resolved.env.VITE_FALCON_MCP_URL,
    skillUrl: resolved.env.VITE_FALCON_SKILL_URL,
    isProd: resolved.isProduction,
  });
  const serve = (server) => {
    server.middlewares.use(async (request, response, next) => {
      if (request.method !== 'GET' && request.method !== 'HEAD') return next();
      let pathname;
      try { pathname = new URL(request.url || '/', 'http://vite.local').pathname; } catch { return next(); }
      const assetName = routes.get(pathname);
      if (!assetName) return next();
      try {
        const asset = (await render())[assetName];
        response.writeHead(200, { ...asset.headers, 'Content-Length': String(Buffer.byteLength(asset.body, 'utf8')) });
        response.end(request.method === 'HEAD' ? undefined : asset.body);
      } catch (error) {
        next(error);
      }
    });
  };
  return {
    name: 'falcon-skills',
    configResolved(config) { resolved = config; },
    async generateBundle() {
      const { skill, manifest, pagesHeaders } = await render();
      this.emitFile({ type: 'asset', fileName: 'SKILLS.md', source: skill.body });
      this.emitFile({ type: 'asset', fileName: 'SKILLS.manifest.json', source: manifest.body });
      this.emitFile({ type: 'asset', fileName: '_headers', source: pagesHeaders });
    },
    configureServer: serve,
    configurePreviewServer: serve,
  };
}