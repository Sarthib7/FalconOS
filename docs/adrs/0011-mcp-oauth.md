# ADR 0011: Add Mesh-backed OAuth to hosted MCP

[VERIFIED, user direction, 2026-10-06] Status: Accepted for local build. Production schema changes and deployment remain unauthorized.

## Context

[VERIFIED, source: `mcp/src/http.mjs`, `mcp/src/tools.mjs`] Falcon MCP is a stateless Streamable HTTP server. Today, wallet sessions travel as tool arguments.

[VERIFIED, source: `mesh/wallet-auth.mjs`, `mesh/http.mjs`] Mesh owns origin-bound wallet challenges, Ed25519 verification, wallet-derived owners, and hashed 30-minute sessions.

[VERIFIED, official MCP authorization spec, 2026-07-28](https://modelcontextprotocol.io/specification/2026-07-28/basic/authorization) Remote MCP authorization uses Protected Resource Metadata, OAuth Authorization Server Metadata, resource indicators, PKCE S256, and issuer validation. Client ID Metadata Documents are preferred over deprecated Dynamic Client Registration.

[VERIFIED, installed SDK source: `@modelcontextprotocol/node@2.1.1`] The Node adapter forwards request `auth` as `ctx.http.authInfo`. [VERIFIED, installed SDK source: `@modelcontextprotocol/server@2.3.1`] The server package provides bearer verification and RFC 9728 metadata helpers, but not an authorization server.

## Decision

[INFERRED, accepted design] Use OAuth authorization-code flow with PKCE S256. Keep the authorization server in Mesh because Mesh owns wallet identity and PostgreSQL state.

1. [INFERRED, accepted design] Use issuer `https://api.falconos.markets`, resource `https://mcp.falconos.markets/mcp`, and approval page `https://agents.falconos.markets/oauth/approve`. Serve path-specific PRM at `/.well-known/oauth-protected-resource/mcp` and AS metadata at `/.well-known/oauth-authorization-server`.
2. [VERIFIED, official MCP authorization spec, 2026-07-28] Require exact RFC 8707 `resource`, PKCE S256, RFC 9207 `iss`, and CIMD. Do not implement DCR.
3. [INFERRED, accepted design] Store authorization requests and one-time codes with short expiries. Store only SHA-256 hashes of authorization codes and opaque access tokens. Access tokens expire within 30 minutes. Do not issue refresh tokens.
4. [INFERRED, accepted design] Approval uses the existing one-time, origin-bound Ed25519 `signMessage` check. Add an identity-only verifier path. Do not create a `wsi1_` session during OAuth approval. Preserve the separate bot session login.
5. [INFERRED, accepted design] The MCP server validates each bearer through a Mesh service endpoint. Mesh accepts that bearer on owner-scoped routes only with a private shared service secret. Mesh derives the owner from the stored token. Never accept caller-supplied owner data.
6. [INFERRED, accepted design] Remove `falcon_connect`, `falcon_connect_verify`, `falcon_disconnect`, and all `session` tool arguments. No compatibility shim. The MCP client sends the OAuth access token in the HTTP `Authorization` header.
7. [INFERRED, security boundary] Fetch CIMD only over HTTPS. Pin requests to validated public DNS results, reject redirects, bound response bytes and time, and validate every redirect URI before issuing a code.
8. [INFERRED, rollout boundary] Add migration 0004 and update local schema initialization and database grants. Test full history on disposable PostgreSQL. Do not apply the migration remotely or deploy without separate approval.

## Alternatives rejected

- [INFERRED] Keep passing `wsi1_` as a tool argument. It exposes the bearer credential to model context and transcripts.
- [INFERRED] Trust an `X-Falcon-Owner` assertion from MCP. A shared service secret does not make an asserted user identity trustworthy.
- [VERIFIED, official MCP authorization spec, 2026-07-28] Add new Dynamic Client Registration. The spec deprecates DCR and prefers CIMD.
- [INFERRED] Store OAuth tokens only in MCP memory. Mesh runs across restarts and must validate tokens and derive owners consistently.

## Consequences

- [INFERRED] OAuth requires one additive database migration and one shared service secret on Mesh and MCP. Production setup remains blocked until the user provisions the secret and approves the migration and deployment.
- [INFERRED] OAuth tokens authorize Devnet MCP access only. Transaction signing and broadcasting remain separate user-controlled actions under V132.
- [INFERRED] A 30-minute token without refresh requires the client to repeat browser approval after expiry.

## Least confident decisions

1. [INFERRED] Rejecting CIMD redirects and non-public DNS targets may reject a valid client metadata host. Test metadata URLs used by supported MCP clients.
2. [INFERRED] A 30-minute token with no refresh may interrupt long sessions. Confirm the behavior in supported MCP clients before production.
3. [INFERRED] A shared service secret is acceptable for the current two-service deployment. Its production provisioning and rotation process remains unverified.