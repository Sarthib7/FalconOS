import { createServer } from 'node:http';
import { hostHeaderValidation, originValidation, toNodeHandler } from '@modelcontextprotocol/node';
import { McpServer, createMcpHandler, localhostAllowedHostnames } from '@modelcontextprotocol/server';
import pkg from '../package.json' with { type: 'json' };
import { isLoopbackHost } from './config.mjs';
import { createLimiter } from './limiter.mjs';
import { createMeshClient } from './mesh-client.mjs';
import { INSTRUCTIONS, registerFalconTools } from './tools.mjs';

const BODY_LIMIT = 256 * 1024;

function json(response, status, payload) {
  response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
  response.end(JSON.stringify(payload));
}

// Builds the HTTP server. Host and Origin checks sit in front of the stateless MCP handler, which validates neither.
export function createApp({ config, fetchImpl, clock, meshTimeouts } = {}) {
  const mesh = createMeshClient({ baseUrl: config.meshUrl, origin: config.origin, fetchImpl, ...meshTimeouts });
  const limiter = createLimiter({ ...config.rate, ...(clock && { clock }) });
  const loopbackBind = isLoopbackHost(config.host);
  const hostnames = [...new Set([...(loopbackBind ? localhostAllowedHostnames() : []), ...config.allowedHosts])];
  const originHostnames = [...new Set([...hostnames, new URL(config.origin).hostname])];
  const validateHost = hostHeaderValidation(hostnames);
  const validateOrigin = originValidation(originHostnames);

  const handler = createMcpHandler(() => {
    const server = new McpServer({ name: pkg.name, version: pkg.version }, { instructions: INSTRUCTIONS });
    registerFalconTools(server, { mesh, limiter });
    return server;
  }, { maxRequestBodySize: BODY_LIMIT, onerror: error => process.stderr.write(`falcon-mcp: transport ${error?.name || 'error'}\n`) });
  const nodeHandler = toNodeHandler(handler, { maxRequestBodySize: BODY_LIMIT, onerror: error => process.stderr.write(`falcon-mcp: adapter ${error?.name || 'error'}\n`) });

  const server = createServer({ maxHeaderSize: 8192, requestTimeout: 30_000, headersTimeout: 10_000, keepAliveTimeout: 65_000 }, async (request, response) => {
    try {
      const path = new URL(request.url, 'http://falcon-mcp.invalid').pathname;
      if (path === '/healthz' && request.method === 'GET') { json(response, 200, { status: 'alive' }); return; }
      if (path === '/readyz' && request.method === 'GET') {
        if (await mesh.ready()) json(response, 200, { status: 'ready' });
        else json(response, 503, { status: 'not_ready' });
        return;
      }
      if (path === '/mcp') {
        if (!validateHost(request, response) || !validateOrigin(request, response)) return;
        await nodeHandler(request, response);
        return;
      }
      json(response, 404, { error: { code: 'NOT_FOUND', message: 'Not found.' } });
    } catch {
      process.stderr.write('falcon-mcp: request failed\n');
      if (!response.headersSent) json(response, 500, { error: { code: 'INTERNAL_ERROR', message: 'Internal error.' } });
      else response.destroy();
    }
  });
  const close = async () => { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); await handler.close(); };
  return { server, close };
}
