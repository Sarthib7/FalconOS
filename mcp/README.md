# Falcon MCP server

A remote [MCP](https://modelcontextprotocol.io) server (Streamable HTTP) that lets any agent with its own signing wallet work with FalconOS on Solana **Devnet**. It is a thin, stateless adapter over the Mesh API: it adds no database, no custody and no key handling.

The agent signs in with its wallet, reads yield opportunities, refreshes evidence, gets a REVIEW, BLOCKED or NO_DATA reserve decision, prepares a Devnet supply or redeem as an **unsigned** transaction, signs it with its own wallet, registers the signed bytes, broadcasts them itself, and checks the receipt.

## Install (agent)

Claude Code:

```sh
claude mcp add --transport http falconos https://YOUR-MCP-HOST/mcp
```

Or as JSON. The `"type": "http"` field is required; an entry with only `url` is treated as stdio and skipped.

```json
{ "mcpServers": { "falconos": { "type": "http", "url": "https://YOUR-MCP-HOST/mcp" } } }
```

Replace `YOUR-MCP-HOST` with the host of your deployment. Any MCP client that speaks Streamable HTTP can use the same URL.

## Tools

| Tool | What it does |
| --- | --- |
| `falcon_connect` | Starts wallet sign-in. Returns a message to sign. |
| `falcon_connect_verify` | Takes the signature (64 bytes, base64 or base58). Returns a 30 minute `session`. The only tool whose output contains a session. |
| `falcon_disconnect` | Revokes the session. |
| `falcon_yield_opportunities` | Reads yield opportunities. Read-only. |
| `falcon_refresh_evidence` | Captures the three Devnet connectors and creates the live analysis. Returns `analysisId`. |
| `falcon_reserve_decision` | Returns REVIEW, BLOCKED or NO_DATA for a proposed supply. REVIEW is not approval. |
| `falcon_prepare_transaction` | Prepares an unsigned Devnet supply or redeem. Supply needs `decisionId`; redeem forbids it. The wallet is always the session wallet. |
| `falcon_submit_signed` | Registers wallet-signed bytes. Falcon never broadcasts. |
| `falcon_check_receipt` | Reconciles the transaction against Devnet. |
| `falcon_activity` | Joins recent decisions and prepared transactions into one trail. Read-only. |

Every authenticated tool takes `session` and rejects unknown keys. Amounts are decimal USDC strings with at most 6 decimals (`"0.5"`), converted to base units with BigInt, never floats. Supply is capped at 1 USDC on Devnet by Mesh.

## Configuration

| Variable | Required | Default | Meaning |
| --- | --- | --- | --- |
| `FALCON_MESH_API_URL` | yes | none | Base URL of the Mesh API. Must be `https` unless the host is loopback. |
| `FALCON_MCP_ORIGIN` | yes | none | The exact Origin this server sends to Mesh for wallet auth, for example `https://mcp.example.com`. It must be listed in Mesh `FALCON_MESH_ORIGINS`. The sign-in message names this origin's host. |
| `FALCON_MCP_ALLOWED_HOSTS` | when host is not loopback | none | Comma-separated bare hostnames accepted in the `Host` header of `/mcp` (DNS rebinding protection). The server refuses to start without it on a non-loopback host. |
| `FALCON_MCP_HOST` | no | `127.0.0.1` | Bind address. The Docker image sets `0.0.0.0`. |
| `PORT` | no | `8792` | Listen port. Railway sets it. |
| `FALCON_MCP_RATE_WINDOW_MS` | no | `60000` | Rate limit window. |
| `FALCON_MCP_RATE_MAX_PER_SESSION` | no | `60` | Authenticated tool calls per session per window. |
| `FALCON_MCP_RATE_MAX_CONNECT` | no | `10` | `falcon_connect` calls per wallet, and `falcon_connect_verify` calls per challenge, per window. |
| `FALCON_MCP_RATE_MAX_GLOBAL` | no | `300` | Tool calls per window across all callers. |

Endpoints: `POST|GET|DELETE /mcp`, `GET /healthz` (`{"status":"alive"}`), `GET /readyz` (calls Mesh `/readyz`; `{"status":"ready"}` or 503). `/healthz` and `/readyz` skip the Host check so platform probes work. `/mcp` checks `Host` against the allowed hosts and rejects a browser `Origin` that is not the MCP host or the configured origin.

The server logs one short line at startup and a code-only line for unexpected failures. It never logs tool arguments, sessions, signatures or transactions.

## Run locally against a local Mesh

1. Start Mesh with a database (see `../mesh/README.md`), for example `npm --prefix ../mesh run dev:local`. It listens on `127.0.0.1:8791` and already allows the origin `http://127.0.0.1:5173`.
2. Install and start this server:

```sh
npm ci
FALCON_MESH_API_URL=http://127.0.0.1:8791 \
FALCON_MCP_ORIGIN=http://127.0.0.1:5173 \
npm start
```

3. Point the agent at `http://127.0.0.1:8792/mcp`: `claude mcp add --transport http falconos http://127.0.0.1:8792/mcp`. The sign-in message will name `127.0.0.1:5173`, because that is the origin sent to Mesh.

Tests need no database: `npm test` runs against fake Mesh servers.

## Deploy on Railway

1. Create a service from this directory. `railway.toml` selects the Dockerfile and the `/healthz` health check.
2. Set `FALCON_MESH_API_URL`. Railway private networking gives Mesh an internal address of the form `http://<mesh-service>.railway.internal:<port>`. That URL is plain `http`, and this server refuses a non-https Mesh URL unless the host is loopback, so the private address is rejected at startup. Use Mesh's public `https` URL instead. The rule is deliberate: wallet sessions travel on this hop.
3. Set `FALCON_MCP_ORIGIN` to the public origin of this service, and `FALCON_MCP_ALLOWED_HOSTS` to its public hostname.
4. **Add that same origin to Mesh `FALCON_MESH_ORIGINS`.** Without it Mesh answers `ORIGIN_DENIED` to every sign-in.
5. The image sets `FALCON_MCP_HOST=0.0.0.0`. With no `FALCON_MCP_ALLOWED_HOSTS` the container exits at startup.

## Limits

- **Stateless.** Each HTTP request builds a fresh server. Nothing persists here. Sessions live in Mesh.
- **The session is a tool argument.** The agent passes it on each call, so it is visible in the model context and in any transcript the client keeps. Treat it like a short-lived password. It works for 30 minutes and only for Devnet actions on that wallet. `falcon_disconnect` revokes it.
- **Per-instance rate limits.** Limits are in memory. Running N instances multiplies them by N. Authenticated tools are keyed by a SHA-256 of the session (60 per minute by default), `falcon_connect` by wallet (10 per minute), plus a global ceiling (300 per minute). Exceeding returns a tool error with `RATE_LIMITED` and `retryAfterSeconds`.
- **Shared Mesh wallet-auth bucket.** Mesh rate-limits wallet sign-in by remote IP. Behind this server every agent shares one IP, so every agent shares one bucket. Heavy sign-in traffic from one agent can delay others.
- **Devnet only.** No mainnet, no custody, no key handling by Falcon, no server-side broadcast. Falcon never sees a private key; the agent broadcasts its own signed bytes.
- **No OAuth on the MCP endpoint yet.** `/mcp` is reachable by anyone who can reach the host. All data access still requires a valid wallet session, and all write actions require the wallet's own signature.
- **Evidence is short-lived.** Captured evidence is only usable for about 300 seconds, and a prepared transaction expires in about 120 seconds.
- **Data is not advice.** Yield data is provider-indexed, APY is not a realized return, and nothing is guaranteed.
