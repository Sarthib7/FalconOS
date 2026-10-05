# ADR 0010: Deliver the plugin as a stateless remote MCP adapter over Mesh

**Status:** Accepted for the MVP build, 2026-10-05. Not deployed. Not validated with real agents.

## Context

[VERIFIED, user direction, 2026-10-05] The first product to ship is a plugin. An agent installs it from one copied command and then works with FalconOS. The agent signs with its own wallet. The server runs on Railway. See ADR 0008 (two delivery paths) and ADR 0009 (customer-controlled accounts) in PR #25.

[VERIFIED, official docs read 2026-10-05] The MCP TypeScript SDK v2 is the stable line. Its HTTP handler runs the server factory once per request and holds nothing between requests. It validates no Host, Origin, or token. Sources: https://ts.sdk.modelcontextprotocol.io/v2/serving/http.md.

[VERIFIED, source] Mesh already provides wallet-signature sessions, the reserve decision, the REVIEW gate for supply, and the lending intent, submit, and receipt routes. Mesh does not broadcast.

## Decision

Build `mcp/` as a thin, stateless MCP server that adapts the Mesh API. It owns no financial logic.

1. **Agent holds the keys.** The server returns a sign-in challenge and unsigned transactions. The agent's wallet signs. Falcon never holds a key and never broadcasts. The agent broadcasts to Devnet itself.
2. **Session as a tool argument.** The agent proves wallet control once (`falcon_connect`, then `falcon_connect_verify`). Mesh returns a 30 minute session. The agent passes it as `session` to later tools. The MCP server stores nothing, so restarts and scaling lose no state.
3. **Server-to-server Origin.** Mesh requires an allowed Origin on wallet auth. The MCP server sends its own configured origin. That origin must be in Mesh `FALCON_MESH_ORIGINS`. The sign-in message names the MCP host.
4. **Gate stays in Mesh.** Supply still needs a fresh REVIEW decision. The MCP server enforces input shape only and never replaces Mesh checks.
5. **Install path.** A Human/Agent toggle on the bot page copies either a client command or one instruction that points the agent at a hosted skill file. The skill file tells the agent how to add the MCP server and the rules it must follow.

## Alternatives rejected

- **Stateful MCP sessions keyed to the MCP session id.** The v2 SDK is stateless by design. State would need sticky routing or a shared store.
- **Bearer token in the client config.** Better hygiene, but a wallet session lasts 30 minutes, and a long-lived token needs a new table and a migration. Deferred.
- **MCP server signs for the agent.** Custodial. Contradicts ADR 0009.
- **Local stdio server.** Simpler, but the user chose a hosted server for installation.

## Consequences

- [INFERRED] The session token passes through the model context. It can appear in transcripts. The skill tells the agent never to print or store it. Sessions expire after 30 minutes.
- [INFERRED] Mesh rate-limits wallet auth by remote IP. Behind this server every agent shares one bucket. The MCP server adds its own per-caller limiter, per instance. Mesh needs trusted-proxy keying before real traffic.
- [INFERRED] There is no OAuth on the MCP endpoint yet. Anyone can call the unauthenticated tools. Authenticated tools still need a valid wallet session.
- [NOT DETERMINED] Whether real agent hosts handle a tool argument session cleanly across long conversations.
- [VERIFIED, source: `src/plugin.ts`, SPEC.md I-lines for the plugin] A different plugin already exists: a stdin/stdout advisory CLI for the USDC/EURC cross-chain route, advisory-only, with `ADVISORY_UNAVAILABLE` when no transport is injected. The MCP server does NOT wrap it and does not replace it. It is a separate surface over the Mesh API for the Devnet treasury journey. Two surfaces now carry the word "plugin". Name the new one "Falcon MCP" in code and copy, and decide in a later ADR whether the advisory CLI is retired or exposed as one more MCP tool.

## Least confident decisions

1. Session as a tool argument. It leaks a short-lived credential into model context. An OAuth or header-based session is the likely replacement.
2. Letting the agent broadcast. It keeps Falcon non-custodial, but it relies on every agent wallet tool to send a signed transaction correctly and to report the signature.
3. One shared Origin for all agent sign-ins. It is simple, but it makes the challenge message say "mcp host wants you to sign in", which a wallet UI may present as a website login.
4. A single stateless instance on Railway Hobby. Per-instance limits and no shared state are fine for one instance and wrong for several.
