---
name: falconos
description: Use when an MCP-capable agent needs FalconOS public market evidence or owner-bound Devnet decisions. Public graph reading needs no signer; owner records and transactions require a human-controlled wallet and separate approval. Never for mainnet or custody.
version: 0.3.3
requiredMcpVersion: 0.3.1
---

# FalconOS MCP skill

<!-- if:mcp -->
FalconOS exposes a fixed public Solana Devnet market graph and optional owner-bound lending records. The human controls the wallet. Falcon does not hold keys, sign, fund, or broadcast.

- MCP server: {{FALCON_MCP_URL}}
- Setup entrypoint: {{FALCON_SKILL_URL}}

## Start here

Fetch <{{FALCON_SKILL_URL}}> and `SKILLS.manifest.json` from the same origin. Compare the manifest SHA-256 with the digest of the exact SKILLS.md bytes; do not normalize bytes or newlines. Same-origin headers and manifests are not independent trust anchors. This version’s digest-record discovery URL is <https://github.com/Sarthib7/FalconOS/blob/main/web/skills/releases/0.3.3.json>; it is a discovery URL on moving `main`, not a final pin or trust anchor. Independently authenticate the known FalconOS repository, learn a full immutable commit ID through that trusted channel, then obtain and check the release record at that exact commit. Pin the full commit ID and compare the rendered-guide SHA-256 with the independently learned expected digest. Never take the candidate checkout’s own unverified record or digest as the expected value.
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

Initialize MCP, list tools, and call `falcon_self_test({})`. Require server version 0.3.1 or later and all 14 names below. This is metadata only, not health, authorization, signer support, funds, or transaction readiness. First functional call is `falcon_public_graph({})`, with no arguments. Inspect scope, chain/network, source metadata, nodes, edges, issues, and program/reserve technical status. `OBSERVED` is technical public evidence, not a personalized REVIEW, recommendation, or approval. `NO_DATA` means current evidence is unavailable; never substitute an older graph or blindly repeat the unchanged graph/head. The public graph may return its 60-second cached capture; no MCP `forceRefresh` exists, so a repeat is not guaranteed fresh. This initial read is market context only; it does not adopt owner evidence or authorize execution.

2. **Collect owner inputs and execution prerequisites before adoption.** For a supply decision, ask the human for all four exact values: `proposedUsdc`, `maxUsdc`, `minBookLiquidityUsdc`, and `maxEvidenceAgeSeconds` (1-300). Do not default, infer, or widen them. Redeem needs `amountReceiptTokens` and no supply decision; never invent a value. Owner-only advisory/history needs neither funds nor a transaction signer. For a requested full execution, call `falcon_wallet_status` with the chosen `wallet`, explicit `forAction`, `chain: "solana"` and `network: "devnet"` before owner adoption or preparation. Show its action-specific `missing` items, exact returned token mint and human-only faucet/checklist guidance. Missing funds or required accounts stop that execution before prepare. Do not infer readiness from incomplete status. This is a Falcon MCP check; clients do not need their own RPC connection. Additional client-RPC checks are optional when Falcon returns a complete verified transaction preflight.

3. **Owner session and signing capability.** Reuse a valid existing Falcon session (30 minutes); keep it private and pass only to tools. A transaction still requires a human-controlled wallet capable of Solana Devnet `signTransaction`; if unsupported, name that capability/network reason and stop signing. If a new or renewed session is needed, the owner-only challenge also requires `signMessage`. Ask before provisioning/login on a persistent CLI host. For `falcon_connect({wallet})`, verify challenge wallet and host match this MCP server. Show the exact challenge and get explicit approval for `signMessage`; verify only with its challenge ID and signature. This proves ownership, not transaction approval. Reuse a valid session; do not read its files or credentials.

4. **Adopt and decide.** After human inputs and the owner session, call `falcon_refresh_evidence({session})`. Require both program and reserve analyses `OBSERVED`; preserve `graphRevision`, `evidenceSource: "public"`, IDs, and original source timestamps. Set the decision and preparation input `analysisId` to the returned `programAnalysisId` (the same value as the returned `analysisId` alias). Never use `reserveAnalysisId` or `policyDefinitionId` as that input. For a supply decision, pass the four human values unchanged and check `sourceAnalysisId`, `publicGraphRevision`, the full `decisionGraph`, and checks. If the public revision changes, re-adopt it and obtain a new matching supply decision before preparation. Redeem uses fresh adopted program evidence but no supply decision. The initial public read does not start a new owner evidence lifetime; global captures may already be aged.

   Evidence age runs from the oldest source `observedAt`, not decision time. Check the returned `expiresAt` and remaining time against the human maximum; adoption does not reset age. If evidence expires or an approval pause leaves too little time, refresh/adopt with unchanged human limits. Require a newer `graphRevision` and later source observations before replacing expired evidence; if unchanged, stop. There is no `forceRefresh` input or guaranteed immediate recapture. `executionReady: false` does not authorize execution and is not a state to wait to change. Account checks permit only the next guarded step, not a claim that the wallet is ready to supply.

5. **Prepare, compare Falcon preflight, approve, register.** Supply only with a current matching `REVIEW` decision and its `decisionId`; cap Devnet supply at 1 USDC (1,000,000 base units). Redeem requires adopted public evidence and `amountReceiptTokens`, but no supply decision. Call `falcon_prepare_transaction` using the existing supported input fields. Decode the exact unchanged `unsignedTransactionBase64` with `falcon_decode_transaction`; bind the decoder `messageSha256` and preparation message hash to `preflight.messageSha256`, and the preflight blockhash to the unchanged transaction’s blockhash. Any mismatch means stop. Offline decoder context remains `NETWORK_NOT_ATTESTED`, `safeToSign: false`, and `executionReady: false`; do not relabel it as Falcon verification or claim `safeToSign: true`.

   Standard pre-sign review requires the complete `preflight` object returned by `falcon_prepare_transaction` for those exact unchanged message bytes. Require `schemaVersion: 1`, `status: "VERIFIED"`, `verification: "falcon-rpc"`, `messageSha256` (64-hex SHA-256 bound to the unchanged message), and `checkedAt`; `network: {chain, network, genesisHash, rpcHost, snapshotSlot}`; `simulation: {slot, err, unitsConsumed, liquidityDeltaBaseUnits, receiptDeltaBaseUnits, vaultLiquidityDeltaBaseUnits}`; `costs: {feeLamports, feeQuoteSlot, rentLamports, totalSolLamports, walletSolBalanceLamports, destinationAta, createsDestinationAta, accountSize}`; and `validity: {blockhash, lastValidBlockHeight, observedBlockHeight, oraclePublishTime, oracleExpiresAt, intentExpiresAt, decisionExpiresAt, expiresAt}`. Check `chain: "solana"`, `network: "devnet"`, genesis `EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG`, RPC host `api.devnet.solana.com`, safe snapshot/simulation/fee slots and block heights, and `simulation.err: null`. Validate all time values and bounds, compare the simulation’s signed token deltas with the intended liquidity/receipt/vault effects, and stop for any malformed, missing, stale, or incoherent value. Cost and token-delta quantities are decimal strings; require `feeLamports + rentLamports = totalSolLamports` (rent only for actual destination-ATA creation), total cost covered by `walletSolBalanceLamports`, exact base58 `destinationAta`, boolean `createsDestinationAta`, and `accountSize: 165`. Do not invent fees or rent. Check `oracleExpiresAt` and every applicable validity bound before review. Only the allowlisted preflight fields are model-facing; never expose raw RPC traces/bodies, secret provider URLs, or keys. This is Falcon-RPC verification, not independent verification, human approval, permission to sign, or proof of future execution. A complete preflight needs no client-owned RPC account, API key, or client RPC call; additional wallet/RPC checks are optional and cannot replace the exact-message review. If preflight is absent or invalid, stop and diagnose without signing.
   Registration is subject to a 120-second intent lifetime ceiling, not a guaranteed 120 seconds: store-bound `intentExpiresAt` is the intent ceiling; the applicable decision or oracle expiry can make `expiresAt` earlier. `decisionExpiresAt` is null when no decision applies, and `expiresAt` is the earliest active time bound. Check `observedBlockHeight <= lastValidBlockHeight`; an elapsed oracle/intent/decision time bound or expired blockhash invalidates the intent even inside 120 seconds. Never reuse approval for new message bytes: any replacement preparation/hash requires a new decode, complete matching preflight, and fresh explicit approval. Show the exact unchanged transaction to the human and obtain separate explicit `signTransaction` approval; do not require a client RPC or extra wallet fee/rent quote when the complete Falcon preflight is valid. Login approval never counts. Require the exact signed-byte response and register those same signed bytes with `falcon_submit_signed`. The human alone broadcasts those exact registered bytes through their own wallet or RPC. The Client Agent must not broadcast automatically; Falcon never signs or broadcasts.
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

Separate immediate safety stops from technical diagnosis. Missing funds, declined human approval, `BLOCKED`, `NO_DATA`, `MESH_UNAVAILABLE`, network/cluster mismatch, hash/signature mismatch, or evidence mismatch/expiry are immediate stops: do not retry, hop to another step, or treat a different tool call as a reset. Oracle or RPC failures permit read-only diagnosis, not signing or unchanged-request retries. Continue only with newer valid data and a newly reviewed message. Only an explicitly retryable technical failure may be retried at the same step with unchanged inputs and evidence; stop after the third failed attempt total. `RATE_LIMITED` permits at most one retry after the returned delay, within that same bound. Waiting for human approval is not a failed attempt. An uncertain broadcast is never blindly retried or rebroadcast. Any new message bytes require a new decode, matching Falcon preflight and explicit human approval. Show safe tool errors plainly.

| Result / condition | Action |
| --- | --- |
| Missing funding, source ATA, zero/frozen required token account, or zero SOL (`SOL_FOR_FEES`) | Show actual wallet-status missing-item/faucet checklist for the human; stop the requested execution before prepare. A remedy does not resume or count as a retry of this flow. |
| Missing, malformed, stale, or mismatched Falcon preflight | Stop; do not sign or bypass Falcon’s verification. Diagnose the error using read-only evidence, wait for valid current data, then prepare and review a new exact message. Do not blindly retry or reuse prior approval. |
| Status unknown/incomplete | Stop; do not infer account readiness. |
| Session invalid/expired | Reuse only if still valid; otherwise new explicit approval for exact ownership challenge. |
| `NO_DATA` / `MESH_UNAVAILABLE` | Stop current flow; no older evidence fallback. |
| Expired decision | Stop preparation. Check source age against the unchanged human maximum and obtain newer evidence before a new decision if the bound expired. Never restart an old observation clock by making another decision. |
| Expired evidence, new head, or inadequate remaining `expiresAt` time | Refresh/adopt with unchanged limits. Replace expired evidence only with a newer revision and later observations, then decide; if unchanged, stop. Never widen age or send force-refresh. |
| Invalid `analysisId` / analysis mismatch | Stop; use adopted program analysis ID as `analysisId`; re-adopt and decide only if current evidence requires it. |
| `BLOCKED`, `REVIEW` absent, changed transaction/hash/network, missing signer or approval | Stop at that gate; never bypass or retry unchanged. |
| Expired prepared intent, earlier time bound, or expired blockhash | The intent has a 120-second ceiling, not a guaranteed 120 seconds of validity. Respect `intentExpiresAt`, applicable `decisionExpiresAt`, earliest `expiresAt`, and `lastValidBlockHeight`; stop if any bound has expired. Prepare new message bytes, compare a new preflight, decode, and obtain fresh explicit approval. Never reuse approval for changed bytes. |
| Oracle / RPC transport failure during preflight | Stop and diagnose read-only. Do not bypass preflight, blindly retry, reuse stale output, or sign. Continue only after current valid data is available and a newly prepared exact message has a complete matching preflight. |

<!-- else:mcp -->
This release has no Falcon MCP URL. Wait for an authenticated trusted release before setup or configuration changes.
<!-- endif:mcp -->
