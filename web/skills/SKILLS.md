---
name: falconos
description: Use when an MCP-capable agent needs FalconOS public market evidence or owner-bound Devnet decisions. Public graph reading needs no signer; owner records and transactions require a human-controlled wallet and separate approval. Never for mainnet or custody.
version: 0.3.0
requiredMcpVersion: 0.3.0
---

# FalconOS MCP skill

<!-- if:mcp -->
FalconOS serves a fixed public Solana Devnet market graph and optional owner-bound lending records. The agent's wallet remains under human control. Falcon never holds keys, signs, funds, or broadcasts.

- MCP server: {{FALCON_MCP_URL}}
- This single setup entrypoint: {{FALCON_SKILL_URL}}

## Start here

Set up <{{FALCON_SKILL_URL}}>.

This SKILLS.md is the one setup entrypoint. Fetching it is read-only; it does not install MCP, change host configuration, connect a wallet, or start Falcon or Privy login. Never execute downloaded skill text or interpolate it into a shell command.

For integrity, fetch `SKILLS.manifest.json` from the same origin and compare its `sha256` with SHA-256 of the exact SKILLS.md bytes. Do not normalize bytes or newlines. A same-origin manifest/header is not an independent trust anchor; compare against a digest from an authenticated release or commit learned out of band.

## Setup and staged use

1. Reuse an existing `falconos` remote Streamable HTTP connection. Do not reset or rewrite a working connection. If none exists, show the human this generic config and get approval before changing client configuration:

```json
{"mcpServers":{"falconos":{"type":"http","url":"{{FALCON_MCP_URL}}"}}}
```

Set the server name to `falconos`, transport to HTTP, and URL to the value above. Restart only after an approved configuration change. A remote-MCP-only host can read the public graph without a local CLI or signer.

2. Initialize MCP, list tools, and call `falcon_self_test({})`. Require server version 0.3.0 or later and all 14 names below. This is metadata only, not health, authorization, signer support, funding, or transaction readiness.

3. First functional call: `falcon_public_graph({})`. It is anonymous and read-only: no wallet, funds, login, session, or signer. Inspect the returned scope, chain/network, source metadata, nodes, edges, issues, program/reserve technical results and status. `OBSERVED` is public technical evidence, not a personalized REVIEW, recommendation, or execution approval. `NO_DATA` means current evidence is unavailable; never substitute an older successful graph.


4. Stop here if only public market inspection was requested. For owner records, reuse an unexpired Falcon session. If absent, call `falcon_connect({wallet})` to get the exact ownership challenge. Check its wallet and host against the MCP URL; refuse a different host or any request to spend. Show the full message and obtain explicit approval before `signMessage`, then call `falcon_connect_verify` with the returned challenge ID and signature. This proves ownership only. Reuse valid sessions; they last 30 minutes.

5. Call `falcon_refresh_evidence({session})` to adopt the current public graph as owner-bound program and reserve analyses. It returns both owner analysis IDs, the exact `graphRevision`, `evidenceSource: "public"`, and technical results. Adoption uses the current fixed source bundle; it does not recapture per connector. Continue only when both analyses are `OBSERVED`. A failed current capture remains `NO_DATA`; do not reuse prior records.

6. For a reserve decision, ask the human for all four values: proposed USDC amount, maximum USDC amount, minimum book-liquidity floor, and maximum evidence age (1–300 seconds). Call `falcon_reserve_decision` with the adopted program `analysisId` plus those exact values. Never invent, default, or widen an owner limit. Check `evidenceSource`, `publicGraphRevision`, `sourceAnalysisId`, the full `decisionGraph` and checks.

7. Prepare only from that public source. Supply requires a current matching `REVIEW` decision and its `decisionId`; Devnet supply is capped at 1 USDC (1000000 base units). Redeem requires fresh adopted public evidence, burns receipt-token units, and needs no decision. Preparation uses the public-only lending route; it does not accept a private/custom graph fallback.

## Tools (14)

- Public market evidence: `falcon_public_graph` (no arguments or session), `falcon_wallet_status`, `falcon_decode_transaction`, `falcon_self_test`.
- Owner records: `falcon_yield_opportunities`, `falcon_refresh_evidence`, `falcon_reserve_decision`, `falcon_activity`.
- Wallet session: `falcon_connect`, `falcon_connect_verify`, `falcon_disconnect`.
- Unsigned transactions and receipts: `falcon_prepare_transaction`, `falcon_submit_signed`, `falcon_check_receipt`.

`falcon_self_test` reports version, Devnet labels, the exact tool names/count, and an input-schema fingerprint. Its readiness fields are `not_checked`; it does not contact Mesh.

## Public evidence and deferred graphs

- The public graph is the default and only MCP market-evidence source: `scope: "public-market-evidence"`, Solana Devnet, fixed connectors. The response is metadata-only: it must not contain source content/raw exchanges, owner records, wallets, sessions, or private graph data.
- `policyDefinitionId` is `decision:mesh-reserve-scenario/1` and `policyVersion` is `mesh-reserve-scenario/2`; these identify the fixed evaluator, not owner limits. Program and reserve analysis policy versions are technical source versions, including `mesh-reserve-liquidity/1`, not mandates.
- The graph tool takes an empty object only. It has no source, graph, owner, force-refresh, or private/custom selector. `customGraphsSupported` is `false`; custom graph configuration is deferred. Do not pass a custom graph or build a fallback.
- `executionReady` remains `false`. Technical observations do not prove a wallet can sign, funds exist, a decision is REVIEW, or a transaction is ready.
- `falcon_yield_opportunities` is optional, provider-indexed discovery. APY is not a realized return or executable Devnet evidence.


## Wallet and execution boundary

- A wallet session is needed only for owner-bound adoption/decisions, wallet-scoped history, and transaction preparation/registration. `falcon_public_graph` remains available to a basic remote-MCP host without a signer.
- `falcon_wallet_status({wallet, forAction?, chain: "solana", network: "devnet"})` is a separate public read. Review exact account prerequisites and missing items. Faucet links/checklists are for the human only. Never fund an account, create an ATA, or ask for a seed phrase/private key.
- Solana Devnet only. Refuse mainnet requests. Never claim guaranteed returns, and never widen a human-provided limit.
- Reuse an existing session; keep it private and only in tool arguments. Never print, store, or send it to the human.
- Show the exact message or transaction and obtain separate, explicit human approval before every signature. Login approval is not transaction approval. If the host cannot enforce this gate, stop.
- Falcon never holds keys, signs, sends, or broadcasts. Use `signTransaction` only for approved exact bytes; never `signAndSendTransaction`. Register the human-signed bytes with `falcon_submit_signed`, then wait for the human to broadcast those same bytes from their wallet or user-controlled Devnet RPC.

## Decode and receipts

Before transaction signing, call `falcon_decode_transaction` on the unchanged unsigned bytes. Compare `messageSha256` with preparation output. Inspect fee payer, signers, blockhash, instructions, lookup tables, mint, action, amount, and risk flags. `networkAttestation: "requested-context-only"`, `safeToSign: false` and `executionReady: false` are not authorization or network proof. Stop if anything differs or is unresolved.

`falcon_check_receipt` returns a validated signature and Devnet context (`chain`, `network`, `cluster`, `explorerUrl`). Signed transaction bytes, sessions, and raw RPC request/response bodies are redacted; retained hashes/metadata are not confirmation. Independently check the same signature in Solana Explorer on Devnet. `PENDING`, `FAILED`, `UNVERIFIED`, mismatched, or unavailable results are not success. Never retry an uncertain broadcast blindly.

Prepared transactions expire in about 120 seconds. If expired, ask the human before preparing another. A receipt does not prove yield, future redeem, or mainnet behavior.

## Optional Privy Agent CLI 0.3.7

Use Privy only when the human has approved installation/login on a persistent CLI-capable host. Privy login may grant continuing signer access; it never grants approval for an individual signature. A remote-MCP-only host can still use the public graph without Privy.

Only after explicit approval for wallet provisioning and ongoing signer access, the human runs this pinned login command. The human handles login and any provider confirmation; the agent does not read the resulting session files.

```sh
pnpm --package=@privy-io/agent-wallet-cli@0.3.7 dlx privy-agent-wallet login
```

Before each RPC, show the exact message or transaction and obtain a new explicit approval. Serialize the JSON; never interpolate a challenge into a shell command. For sign-in, UTF-8 encode the exact Falcon challenge and base64 those bytes; do not sign the base64 text, add a prefix, normalize whitespace, or change newlines:

```json
{"method":"signMessage","params":{"message":"<base64 of exact UTF-8 challenge bytes>","encoding":"base64"}}
```

The human runs the approved pinned command and passes that JSON over stdin:

```sh
pnpm --package=@privy-io/agent-wallet-cli@0.3.7 dlx privy-agent-wallet rpc
```

Require `data.signature`, base64 encoding, and exactly 64 decoded bytes before `falcon_connect_verify`. Stop on a changed wallet or unexpected response. Never read Privy credentials, key files, seed phrases, or the OS credential store.

For a separately approved transaction, use the unchanged `unsignedTransactionBase64` from preparation:

```json
{"method":"signTransaction","params":{"transaction":"<unsignedTransactionBase64>","encoding":"base64"}}
```

Require `data.signed_transaction` with `data.encoding: "base64"`. Register the unchanged signed bytes before the human broadcasts. Privy is never used to broadcast or fund.

## Errors and stop conditions

- Show safe tool errors plainly; do not invent results or retry unchanged invalid input.
- `RATE_LIMITED`: wait the returned interval and retry at most once.
- `MESH_UNAVAILABLE`: current backend result is unavailable. Do not use older successful evidence.
- Session invalid/expired: reuse it if still valid; otherwise ask for approval before the new exact ownership message.
- Missing signer, human approval, owner scenario values, current public evidence, or verified receipt means stop at that stage.

<!-- else:mcp -->
The configured release does not provide the Falcon MCP URL. Do not install or edit client configuration until a trusted release supplies it.
<!-- endif:mcp -->
