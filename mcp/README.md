# Falcon MCP server

[VERIFIED, source: mcp/src/http.mjs, mcp/src/tools.mjs, mesh/oauth.mjs] This stateless Streamable HTTP server exposes FalconOS yield, evidence, decision and lending tools for Solana Devnet. Mesh stores OAuth requests and token hashes. The MCP server stores no database records and handles no wallet keys.

[VERIFIED, source: mesh/oauth.mjs, web/bot/OAuthApproval.jsx] MCP clients use OAuth authorization code with PKCE. A human reviews the client and resource, connects Phantom, and signs a non-transaction message. The MCP client sends its access token in the HTTP Authorization header. The agent signs and broadcasts each transaction itself.

## Install (agent)

Claude Code:

~~~sh
claude mcp add --transport http falconos https://YOUR-MCP-HOST/mcp
~~~

Or use JSON. The type field must be http. An entry with only a URL is treated as stdio and skipped.

~~~json
{ "mcpServers": { "falconos": { "type": "http", "url": "https://YOUR-MCP-HOST/mcp" } } }
~~~

Replace YOUR-MCP-HOST with the host of your deployment. Any MCP client that supports Streamable HTTP can use the same URL.

## Tools

| Tool | What it does |
| --- | --- |
| falcon_yield_opportunities | Reads yield opportunities. Read-only. |
| falcon_refresh_evidence | Captures three Devnet connectors and returns analysisId. |
| falcon_reserve_decision | Returns REVIEW, BLOCKED or NO_DATA for a proposed supply. REVIEW is not approval. |
| falcon_prepare_transaction | Prepares an unsigned Devnet supply or redeem. Supply needs decisionId; redeem forbids it. Wallet comes from the verified OAuth identity. |
| falcon_submit_signed | Registers wallet-signed bytes. Falcon never broadcasts. |
| falcon_check_receipt | Reconciles a registered transaction against Devnet. |
| falcon_activity | Joins recent decisions and prepared transactions. Read-only. |

[VERIFIED, source: mcp/src/tools.mjs] Tool schemas reject session and wallet fields. The MCP server reads the bearer from the HTTP Authorization header and gets wallet identity from Mesh introspection. Amounts are decimal USDC strings with at most six decimals, converted to base units with BigInt. Mesh caps supply at 1 USDC on Devnet.

## Configuration

| Variable | Required | Default | Meaning |
| --- | --- | --- | --- |
| FALCON_MESH_API_URL | yes | none | Mesh API base URL. Use HTTPS except for loopback development. |
| FALCON_MCP_ORIGIN | yes | none | Exact origin of this MCP server. Used for browser Origin checks. |
| FALCON_MCP_OAUTH_ISSUER | yes | none | Mesh OAuth issuer URL. |
| FALCON_MCP_OAUTH_RESOURCE | yes | none | Exact protected MCP URL, including /mcp. |
| FALCON_MCP_OAUTH_SERVICE_SECRET | yes | none | Shared 32-byte base64url secret. Set the same value on Mesh. |
| FALCON_MCP_ALLOWED_HOSTS | when host is not loopback | none | Comma-separated bare hostnames accepted in the Host header. The server refuses to start without this setting on a non-loopback host. |
| FALCON_MCP_HOST | no | 127.0.0.1 | Bind address. The Docker image sets 0.0.0.0. |
| PORT | no | 8792 | Listen port. Railway sets it. |
| FALCON_MCP_RATE_WINDOW_MS | no | 60000 | Rate limit window. |
| FALCON_MCP_RATE_MAX_PER_TOKEN | no | 60 | Authenticated tool calls per access token per window. |
| FALCON_MCP_RATE_MAX_GLOBAL | no | 300 | Tool calls per window across all callers. |

[VERIFIED, source: mcp/src/http.mjs] Endpoints include /mcp, /healthz, /readyz, and RFC 9728 metadata at /.well-known/oauth-protected-resource/mcp. Missing or invalid bearer tokens receive a 401 challenge. The server validates Host and browser Origin before tool requests. Health and readiness checks skip the Host check for platform probes.

[VERIFIED, source: mcp/src/tools.mjs; test: mcp/test/secrets.test.mjs] Unexpected tool failures return a generic INTERNAL_ERROR. Logs omit access tokens, service secrets, arguments, signed bytes and stack traces.

## Run locally against a local Mesh

1. Start Mesh and the approval page in separate terminals. Mesh needs an initialized schema v4 database. Run npm --prefix mesh run dev:local and npm --prefix web run dev:bot. Mesh writes a private service secret to mesh/.local/oauth-service-token.
2. Install the MCP server dependencies and start it from the repository root:

~~~sh
npm --prefix mcp ci
FALCON_MESH_API_URL=http://127.0.0.1:8791 FALCON_MCP_ORIGIN=http://127.0.0.1:8792 FALCON_MCP_OAUTH_ISSUER=http://127.0.0.1:8791 FALCON_MCP_OAUTH_RESOURCE=http://127.0.0.1:8792/mcp FALCON_MCP_OAUTH_SERVICE_SECRET="$(cat mesh/.local/oauth-service-token)" PORT=8792 npm --prefix mcp start
~~~

3. Point the MCP client at http://127.0.0.1:8792/mcp. Its browser approval opens http://127.0.0.1:5194/oauth/approve.

[VERIFIED, source: mcp/test] npm --prefix mcp test uses a fake Mesh server and needs no database.

## Deploy on Railway

1. Create a service from this directory. railway.toml selects the Dockerfile and the /healthz health check.
2. Set FALCON_MESH_API_URL to Mesh's public HTTPS URL. The MCP service rejects plain HTTP except on loopback.
3. Set FALCON_MCP_ORIGIN=https://mcp.falconos.markets, FALCON_MCP_ALLOWED_HOSTS=mcp.falconos.markets, FALCON_MCP_OAUTH_ISSUER=https://api.falconos.markets, and FALCON_MCP_OAUTH_RESOURCE=https://mcp.falconos.markets/mcp.
4. Set the same FALCON_MCP_OAUTH_SERVICE_SECRET on MCP and Mesh. On Mesh, set issuer, resource, and approval URL to https://api.falconos.markets, https://mcp.falconos.markets/mcp, and https://agents.falconos.markets/oauth/approve. Add https://agents.falconos.markets to Mesh FALCON_MESH_ORIGINS.
5. The image sets FALCON_MCP_HOST=0.0.0.0. Set FALCON_MCP_ALLOWED_HOSTS or the container exits at startup.

## Limits

- Mesh stores OAuth requests, one-time codes and token hashes. Access tokens expire after 30 minutes and can be revoked. No refresh token is issued.
- Clients send access tokens in the HTTP Authorization header. Tool schemas accept no session or wallet argument.
- Per-instance limits use a SHA-256 key for each access token and a global ceiling. Limits reset when a process restarts and do not span instances.
- Devnet only. Falcon receives no private key and does not broadcast. The agent broadcasts its own signed bytes.
- Captured evidence is usable for about 300 seconds. A prepared transaction expires after about 120 seconds.
- Yield data is provider-indexed. APY is not a realized return.
