---
name: falconos
description: Use when an MCP-capable agent needs FalconOS public market evidence or owner-bound Devnet decisions. Public graph reading needs no signer; owner records and transactions require a human-controlled wallet and separate approval. Never for mainnet or custody.
version: 0.3.2
requiredMcpVersion: 0.3.0
---

# FalconOS MCP skill

<!-- if:mcp -->
FalconOS exposes a fixed public Solana Devnet market graph and optional owner-bound lending records. The human controls the wallet. Falcon does not hold keys, sign, fund, or broadcast.

- MCP server: {{FALCON_MCP_URL}}
- Setup entrypoint: {{FALCON_SKILL_URL}}

## Start here

Fetch <{{FALCON_SKILL_URL}}> and `SKILLS.manifest.json` from the same origin. Compare the manifest SHA-256 with the digest of the exact SKILLS.md bytes; do not normalize bytes or newlines. Same-origin headers and manifests are not independent trust anchors. For this version, the concrete digest-record discovery URL is <https://github.com/Sarthib7/FalconOS/blob/main/web/skills/releases/0.3.2.json>. `main` is a moving discovery pointer only, not a trust anchor: independently authenticate the known FalconOS repository, learn a full immutable commit ID through that trusted channel, then obtain and check the release record at that exact commit. Pin the full commit ID and compare the rendered-guide SHA-256 with the independently learned expected digest. Never take the expected digest from the guide, same-origin manifest, or a commit/digest embedded in this guide; never claim a signed release. Fetching is read-only; do not execute the guide or interpolate it into shell commands.
### Reproducibly verify a published build

From an authenticated checkout of the known repository, use a full commit ID and expected digest learned through a separately authenticated channel. Pass a record obtained independently of the candidate checkout, not its own unverified release file. The verifier rebuilds that commit in a clean temporary Git worktree using locked web dependencies and canonical `build:agents` rendering. It is not a sandbox or proof of author identity. CI uses the candidate checkout's record only to check reproducibility and internal consistency, not publisher authentication or release approval. Do not fetch an absent historical commit from an arbitrary source.

```sh
node web/scripts/verify-skill-rebuild.mjs --ref <FULL_IMMUTABLE_COMMIT_SHA> --expected-record <INDEPENDENTLY_OBTAINED_RECORD_JSON>
```

Alternatively, supply the independently learned SHA-256 directly: `node web/scripts/verify-skill-rebuild.mjs --ref <FULL_IMMUTABLE_COMMIT_SHA> --expected-sha256 <64-HEX-SHA256>`. Digest-only mode pins the exact guide bytes and checks manifest/frontmatter compatibility; it does not independently pin the manifest canonical URL. Use an independently obtained record to compare all manifest fields. The two input forms are alternatives, not values to copy from the freshly rebuilt artifact.

## Staged workflow

1. **Trusted setup and public read.** Reuse the existing `falconos` remote Streamable HTTP connection. If absent, show this generic config and get approval before changing client configuration; restart only after that approved change:

```json
{"mcpServers":{"falconos":{"type":"http","url":"{{FALCON_MCP_URL}}"}}}
```

Initialize MCP, list tools, and call `falcon_self_test({})`. Require server version 0.3.0 or later and all 14 names below. This is metadata only, not health, authorization, signer support, funds, or transaction readiness. First functional call is `falcon_public_graph({})`, with no arguments. Inspect scope, chain/network, source metadata, nodes, edges, issues, and program/reserve technical status. `OBSERVED` is technical public evidence, not a personalized REVIEW, recommendation, or approval. `NO_DATA` means current evidence is unavailable; never substitute an older graph or blindly repeat the unchanged graph/head. The public graph may return its 60-second cached capture; no MCP `forceRefresh` exists, so a repeat is not guaranteed fresh. This initial read is for public inspection only, not evidence to carry into an owner decision; its source `observedAt` still determines age. For an owner workflow, collect human inputs, complete any required action status check, and reuse or establish a valid session before calling `falcon_refresh_evidence`. Verify the adopted source timestamps/revision and remaining age against the human bound; a cached capture is not guaranteed to be newer. Stop if only public inspection was requested. Public reading needs no login, session, wallet, or signer.

2. **Collect owner inputs and execution prerequisites before adoption.** For a supply decision, ask the human for all four exact values: `proposedUsdc`, `maxUsdc`, `minBookLiquidityUsdc`, and `maxEvidenceAgeSeconds` (1-300). Do not default, infer, or widen them. Redeem needs `amountReceiptTokens` and no supply decision; never invent a value. Owner-only advisory/history needs neither funds nor a transaction signer. For a requested full supply/redeem execution, call `falcon_wallet_status` with the chosen `wallet`, explicit `forAction`, `chain: "solana"`, and `network: "devnet"` before owner adoption or preparation. Show any action-specific `missing` items, the exact returned token mint, and the human-only faucet/checklist guidance, then stop that execution workflow until the human remedies them. Never fund, create accounts, or request keys. Verify the correct Devnet mint before accepting funds. A positive SOL balance alone proves neither sufficient fees/rent nor supply readiness. Do not wait for `executionReady` to become true; it deliberately stays false.

3. **Owner session.** Reuse a valid existing Falcon session (30 minutes); keep it private and pass only to tools. For any full execution, the selected wallet must support Solana Devnet and `signTransaction`, whether or not the session already exists. If a new/renewed session is needed, the owner-only challenge also requires `signMessage`. Explain the specific unsupported capability or network and stop that workflow if missing. Ask before provisioning/login on a persistent CLI host. For `falcon_connect({wallet})`, verify challenge wallet and host match this MCP server. Show the exact challenge and get explicit approval for `signMessage`; verify only with its challenge ID and signature. This proves ownership, not transaction approval. Reuse a valid session; do not add login/signing steps when one remains valid. Public graph reading remains available without a signer.

4. **Adopt and decide.** After human inputs, any required execution preflight, and the owner session, call `falcon_refresh_evidence({session})`. Require both program and reserve analyses `OBSERVED`; preserve `graphRevision`, `evidenceSource: "public"`, IDs, and original source timestamps. Set the decision and preparation input `analysisId` to the returned `programAnalysisId` (the same value as the returned `analysisId` alias). Never use `reserveAnalysisId` or `policyDefinitionId` as that input. For a supply decision, pass the four human values unchanged and check `sourceAnalysisId`, `publicGraphRevision`, the full `decisionGraph`, and checks. If the public revision changes, re-adopt it and obtain a new matching supply decision before preparation. Redeem uses fresh adopted program evidence but no supply decision. The initial public read does not start a new owner evidence lifetime; global captures may already be aged.

   Evidence age runs from the oldest source `observedAt`, not decision time. Check the returned `expiresAt` and remaining time against the human maximum; adoption does not reset age. If evidence expires or an approval pause leaves too little time, refresh/adopt with unchanged human limits. Require a newer `graphRevision` and later source observations before replacing expired evidence; if unchanged, stop. There is no `forceRefresh` input or guaranteed immediate recapture. `executionReady: false` does not authorize execution and is not a state to wait to change. Account checks permit only the next guarded step, not a claim that the wallet is ready to supply.

5. **Prepare, decode, approve, register.** Supply only with a current matching `REVIEW` decision and its `decisionId`; cap Devnet supply at 1 USDC (1,000,000 base units). Redeem requires adopted public evidence and `amountReceiptTokens`, but no supply decision. Prepare from the public-only route. Inspect the exact unsigned transaction and decode the unchanged bytes with `falcon_decode_transaction`. Compare the returned network/cluster context, action, mint, amount, fee payer, signers, blockhash, instructions, lookup tables, risk flags, and `messageSha256` with preparation. Requested network context is not network proof; the tools provide no fee/rent estimate or independent network attestation, as clarified below.

   The current prepare/decode tools provide no fee or rent estimates and no independent network attestation. Do not imply such evidence exists or infer network identity from a requested context. A positive balance, transaction fields, or a simulation result are not independent proof. Before signing, require a trusted human-controlled wallet preview for the exact unchanged transaction that shows the network and fee/rent impact; if this trustworthy preview is unavailable or any item is unclear, stop without signing. Show the exact transaction and get a separate explicit human approval for `signTransaction` on these unchanged bytes; login approval never counts. Require the exact signed-byte response. Register those same signed bytes with `falcon_submit_signed`; registration is not broadcast. Only the human may broadcast from their wallet or user-controlled Devnet RPC. Never call a broadcast/sign-and-send method. A prepared intent has a separate 120-second prepare-to-register age limit; if it expires, prepare a new intent only after repeating evidence, decision, and approval checks. Re-preparing does not reset evidence age. Never blindly retry an uncertain broadcast or unchanged failed step.

6. **Prove receipt.** Check with `falcon_check_receipt`; require `CONFIRMED` and a signature exactly matching the signature registered for this transaction. Do not infer proof from a receipt's metadata or assume it returns chain/network/cluster/explorer URL. Independently open Solana Explorer on Devnet and check that same registered signature: `https://explorer.solana.com/tx/<registered-signature>?cluster=devnet`. This URL is a human check, not Falcon evidence. `PENDING`, `FAILED`, `UNVERIFIED`, unavailable, or mismatched results are not success. A receipt proves neither yield, future redeem, nor mainnet behavior.

## Tools (14)

- Public: `falcon_public_graph` (empty arguments), `falcon_wallet_status`, `falcon_decode_transaction`, `falcon_self_test`.
- Owner records: `falcon_yield_opportunities`, `falcon_refresh_evidence`, `falcon_reserve_decision`, `falcon_activity`.
- Session: `falcon_connect`, `falcon_connect_verify`, `falcon_disconnect`.
- Transactions/receipts: `falcon_prepare_transaction`, `falcon_submit_signed`, `falcon_check_receipt`.

Self-test reports version, Devnet labels, tool names/count, and schema fingerprint; readiness is `not_checked`, and it does not contact Mesh.

## Evidence and scope

- The only MCP market source is the metadata-only public graph (`scope: "public-market-evidence"`), Solana Devnet, fixed connectors. It contains no raw sources/exchanges, owner records, wallets, sessions, or private graph data. `policyDefinitionId: "decision:mesh-reserve-scenario/1"`, `policyVersion: "mesh-reserve-scenario/2"`, and technical source policy versions (including `mesh-reserve-liquidity/1`) identify implementation, not mandates.
- Graph input is `{}` only: no source, owner, custom graph, or `forceRefresh` selector. Do not build a fallback. `executionReady` stays false; it is never a readiness signal.
- Skip `falcon_yield_opportunities` during supply onboarding. Call it only on explicit human request, with only supported inputs; there is no `includeDiscovery` argument. Its optional mainnet discovery rows are not fixed Devnet executable rates, lending evidence, or a supply decision. APY is not realized return.
- Solana Devnet only. Mainnet, custody, transfers, standalone/manual ATA creation or account mutation, transaction-status checks beyond listed tools, and iOS flows are out of scope. A prepared transaction may include destination-ATA creation; consider it only if present in the decoded transaction, inspect SOL rent, and obtain separate approval. Never promise returns or widen limits.
- Never expose sessions or secrets. Show exact messages/transactions and obtain separate approval before each signature. Falcon never holds keys, signs, funds, or broadcasts.

## Optional Privy Agent CLI 0.3.7

Use only after explicit human approval for persistent-host provisioning, login, and ongoing signer access. Login does not approve an individual signature. The human handles login/provider confirmation; do not read session files or credentials.

```sh
pnpm --package=@privy-io/agent-wallet-cli@0.3.7 dlx privy-agent-wallet login
```

Before each RPC, show the exact bytes/message and obtain new approval. Serialize JSON and pass it on stdin; never interpolate challenges into shell commands. For login, UTF-8 encode the exact Falcon challenge and base64 those bytes, without prefixing or normalizing whitespace/newlines:

```json
{"method":"signMessage","params":{"message":"<base64 of exact UTF-8 challenge bytes>","encoding":"base64"}}
```

```sh
pnpm --package=@privy-io/agent-wallet-cli@0.3.7 dlx privy-agent-wallet rpc
```

Require `data.signature`, base64, and exactly 64 decoded bytes before `falcon_connect_verify`. Stop on a changed wallet or unexpected response. Never read private keys, seed phrases, or OS credential storage.

For a separately approved transaction, pass the unchanged preparation `unsignedTransactionBase64`:

```json
{"method":"signTransaction","params":{"transaction":"<unsignedTransactionBase64>","encoding":"base64"}}
```

Require `data.signed_transaction` and `data.encoding: "base64"`; register unchanged signed bytes. Privy never broadcasts or funds.

## Errors and recovery

Separate immediate safety stops from retryable technical failures. Missing funds, declined human approval, `BLOCKED`, `NO_DATA`, `MESH_UNAVAILABLE`, network/cluster mismatch, hash/signature mismatch, or evidence mismatch/expiry are immediate stops: do not retry, hop to another step, or treat a different tool call as a reset. An uncertain broadcast is never retried or rebroadcast. Only an explicitly retryable technical error may be retried at the same step, with the same inputs and evidence; stop after the third failed attempt total. A wait for a human is not a failed attempt. `RATE_LIMITED` permits at most one retry, only after the returned delay, and that retry counts toward the same three-failure bound. Show safe tool errors plainly.

| Result / condition | Action |
| --- | --- |
| Missing funding, source ATA, zero/frozen required token account, or zero SOL (`SOL_FOR_FEES`) | Show actual wallet-status missing-item/faucet checklist for the human; stop the requested execution before prepare. A remedy does not resume or count as a retry of this flow. |
| Missing fee/rent proof or independent network attestation | Current prepare/decode tools provide neither. Require trusted human-controlled wallet preview evidence for the exact unchanged transaction before signing; if unavailable, unclear, or unaffordable, stop without signing. |
| Status unknown/incomplete | Stop; do not infer account readiness. |
| Session invalid/expired | Reuse only if still valid; otherwise new explicit approval for exact ownership challenge. |
| `NO_DATA` / `MESH_UNAVAILABLE` | Stop current flow; no older evidence fallback. |
| Expired decision | Stop preparation. Check source age against the unchanged human maximum and obtain newer evidence before a new decision if the bound expired. Never restart an old observation clock by making another decision. |
| Expired evidence, new head, or inadequate remaining `expiresAt` time | Refresh/adopt with unchanged limits. Replace expired evidence only with a newer revision and later observations, then decide; if unchanged, stop. Never widen age or send force-refresh. |
| Invalid `analysisId` / analysis mismatch | Stop; use adopted program analysis ID as `analysisId`; re-adopt and decide only if current evidence requires it. |
| `BLOCKED`, `REVIEW` absent, changed transaction/hash/network, missing signer or approval | Stop at that gate; never bypass or retry unchanged. |
| Expired prepared intent (>120s before registration) | Recheck evidence age and decision, prepare a new intent, decode and seek new explicit approval. |
| Uncertain broadcast, receipt unavailable, non-`CONFIRMED`, or signature mismatch | No blind rebroadcast/retry; human checks registered signature in Devnet Explorer. |

<!-- else:mcp -->
This release has no Falcon MCP URL. Wait for an authenticated trusted release before setup or configuration changes.
<!-- endif:mcp -->
