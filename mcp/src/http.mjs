import { createServer } from 'node:http';
import { hostHeaderValidation, originValidation, toNodeHandler } from '@modelcontextprotocol/node';
import { buildOAuthProtectedResourceMetadata, getOAuthProtectedResourceMetadataUrl, McpServer, createMcpHandler, localhostAllowedHostnames } from '@modelcontextprotocol/server';
import pkg from '../package.json' with { type: 'json' };
import { isLoopbackHost } from './config.mjs';
import { createLimiter } from './limiter.mjs';
import { createMeshClient, ToolError } from './mesh-client.mjs';
import { INSTRUCTIONS, registerFalconTools } from './tools.mjs';

const BODY_LIMIT = 256 * 1024;
const TOKEN = /^fao1_[A-Za-z0-9_-]{43}$/;
const OWNER = /^wallet_[a-f0-9]{56}$/;
const WALLET = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

function json(response, status, payload, headers = {}) {
  response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', ...headers });
  response.end(JSON.stringify(payload));
}

function bearerChallenge(response, invalid = false, metadataUrl) {
  const parts = [ ...(invalid ? ['error="invalid_token"'] : []), 'resource_metadata="' + metadataUrl + '"', 'scope="falcon"' ];
  const message = invalid ? 'Falcon rejected the access token.' : 'A Falcon MCP access token is required.';
  json(response, 401, { error: { code: 'UNAUTHORIZED', message } }, { 'WWW-Authenticate': 'Bearer ' + parts.join(', ') });
}

export function createApp({ config, fetchImpl, clock, meshTimeouts } = {}) {
  const mesh = createMeshClient({ baseUrl: config.meshUrl, serviceSecret: config.oauthServiceSecret, fetchImpl, ...meshTimeouts });
  const limiter = createLimiter({ windowMs: config.rate.windowMs, perToken: config.rate.perToken, global: config.rate.global, ...(clock && { clock }) });
  const resourceUrl = new URL(config.oauthResource);
  const metadataUrl = getOAuthProtectedResourceMetadataUrl(resourceUrl);
  const metadataPath = new URL(metadataUrl).pathname;
  const metadataPaths = new Set([metadataPath, '/.well-known/oauth-protected-resource']);
  const protectedResource = buildOAuthProtectedResourceMetadata({
    oauthMetadata: { issuer: config.oauthIssuer }, resourceServerUrl: resourceUrl, scopesSupported: ['falcon'], resourceName: 'FalconOS MCP',
  });
  const loopbackBind = isLoopbackHost(config.host);
  const hostnames = [...new Set([...(loopbackBind ? localhostAllowedHostnames() : []), ...config.allowedHosts])];
  const originHostnames = [...new Set([...hostnames, new URL(config.origin).hostname])];
  const validateHost = hostHeaderValidation(hostnames);
  const validateOrigin = originValidation(originHostnames);

  const handler = createMcpHandler(() => {
    const server = new McpServer({ name: pkg.name, version: pkg.version }, { instructions: INSTRUCTIONS });
    registerFalconTools(server, { mesh, limiter });
    return server;
  }, { maxRequestBodySize: BODY_LIMIT, onerror: error => process.stderr.write('falcon-mcp: transport ' + (error?.name || 'error') + '\n') });
  const nodeHandler = toNodeHandler(handler, { maxRequestBodySize: BODY_LIMIT, onerror: error => process.stderr.write('falcon-mcp: adapter ' + (error?.name || 'error') + '\n') });

  async function authenticate(request, response) {
    const match = /^Bearer (.+)$/.exec(request.headers.authorization || '');
    if (!match || !TOKEN.test(match[1])) { bearerChallenge(response, false, metadataUrl); return false; }
    let tokenInfo;
    try { tokenInfo = await mesh.introspect(match[1]); }
    catch (error) {
      if (error instanceof ToolError) { json(response, 503, { error: { code: 'AUTH_UNAVAILABLE', message: 'Falcon token verification is unavailable.' } }); return false; }
      throw error;
    }
    const expiresAt = typeof tokenInfo?.expiresAt === 'string' ? Date.parse(tokenInfo.expiresAt) : NaN;
    if (!tokenInfo?.active || tokenInfo.resource !== config.oauthResource || !Array.isArray(tokenInfo.scopes)
      || !tokenInfo.scopes.includes('falcon') || !Number.isFinite(expiresAt) || expiresAt <= (clock ? clock() : Date.now())
      || typeof tokenInfo.clientId !== 'string' || !OWNER.test(tokenInfo.ownerId) || typeof tokenInfo.walletAddress !== 'string' || !WALLET.test(tokenInfo.walletAddress)) {
      bearerChallenge(response, true, metadataUrl); return false;
    }
    request.auth = {
      token: match[1], clientId: tokenInfo.clientId, scopes: tokenInfo.scopes, expiresAt: Math.floor(expiresAt / 1000),
      resource: resourceUrl, resourceMetadataUrl: metadataUrl, extra: { ownerId: tokenInfo.ownerId, walletAddress: tokenInfo.walletAddress },
    };
    return true;
  }

  const server = createServer({ maxHeaderSize: 8192, requestTimeout: 30_000, headersTimeout: 10_000, keepAliveTimeout: 65_000 }, async (request, response) => {
    try {
      const path = new URL(request.url, 'http://falcon-mcp.invalid').pathname;
      if (path === '/healthz' && request.method === 'GET') { json(response, 200, { status: 'alive' }); return; }
      if (path === '/readyz' && request.method === 'GET') {
        if (await mesh.ready()) json(response, 200, { status: 'ready' });
        else json(response, 503, { status: 'not_ready' });
        return;
      }
      if (metadataPaths.has(path) && request.method === 'GET') {
        if (!validateHost(request, response) || !validateOrigin(request, response)) return;
        json(response, 200, protectedResource); return;
      }
      if (path === '/mcp') {
        if (!validateHost(request, response) || !validateOrigin(request, response)) return;
        if (!await authenticate(request, response)) return;
        await nodeHandler(request, response); return;
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
