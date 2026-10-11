---
name: falconos
description: Use when any MCP-capable agent needs to set up or use FalconOS Devnet treasury tools. Covers agent-neutral Streamable HTTP setup, approval before client config changes, user-controlled wallet prerequisites, tool verification, live evidence and reserve review, and approved Devnet transaction flow. Stop if the host lacks MCP or signing support. Never for mainnet or custody.
---

# FalconOS plugin

<!-- if:mcp -->
FalconOS gives an agent a Devnet treasury journey through an MCP server. The agent uses a human-controlled wallet exposed by its host. Falcon never holds keys and never broadcasts a transaction.

- MCP server URL: {{FALCON_MCP_URL}}
- This skill: {{FALCON_SKILL_URL}}

## Start here

This file is the operating guide. When the human gives it to you, follow Setup instead of stopping at a summary. If you need to fetch the current guide, use:

```sh
curl -fsSL {{FALCON_SKILL_URL}}
```

Fetching this file reads instructions only. It does not configure MCP or connect a wallet.

## What Falcon is

Falcon collects evidence about a lending market from live sources and keeps it with its provenance. A decision gate turns that evidence and the owner's own limits into a REVIEW, BLOCKED or NO_DATA answer before any transaction can be prepared. The accounts stay under the customer's control: the agent's wallet signs, and Falcon only prepares unsigned transactions and records what was signed.

## Setup

1. Check that this agent host can connect to a remote MCP server over Streamable HTTP. If it cannot, tell the human that this host cannot use Falcon MCP and stop.
2. Check whether Falcon is already connected and the ten tool names below are available. A saved config entry alone does not prove that tools loaded. If all ten tools are present, read Rules and Wallet prerequisites before First read-only result.
3. If Falcon is not connected, show the human this generic config for clients that accept the common mcpServers format:

```json
{"mcpServers":{"falconos":{"type":"http","url":"{{FALCON_MCP_URL}}"}}}
```

The type must be http. A URL-only entry may be treated as a local command. Other host config formats must set the same server name, HTTP transport, and URL.

Known CLI examples, when the host supports them:

```sh
claude mcp add --transport http falconos {{FALCON_MCP_URL}}
codex mcp add falconos --url {{FALCON_MCP_URL}}
```

For Codex, the host may also use this block in ~/.codex/config.toml:

```toml
[mcp_servers.falconos]
url = "{{FALCON_MCP_URL}}"
```

4. Ask the human to run the setup command, or get a clear yes before editing the agent config. Make only the Falcon MCP change they approve. Restart or reload the host.
5. Initialize the connection and list tools. Confirm all ten names below appear. If any are missing, name them and stop. Do not claim setup works from a config file or health endpoint alone.

## Rules

- Solana Devnet only. Refuse any request involving mainnet.
- The human approves each wallet signature. The human alone broadcasts the registered transaction from their wallet or user-controlled Devnet RPC. The agent never broadcasts or calls a network send method.
- Never print or store the session token. Never write it to a file. Never include it in a message to the human. Keep it only as a tool argument for the current conversation.
- Read the sign-in message to the human. Refuse to sign it if it names a host other than the one in the server URL above, or if it asks you to spend, transfer, approve, or sign a transaction.
- Keep the signed transaction bytes you pass to `falcon_submit_signed` in conversation memory until the human broadcasts and receipt verification completes. Falcon registers them but does not return them.
- Never call `falcon_prepare_transaction` for a supply unless `falcon_reserve_decision` returned REVIEW in this same conversation, and the amount is at most the decision's proposed amount.
- A BLOCKED or NO_DATA decision stops the supply. Explain the reason from the checks. For NO_DATA, you may call `falcon_refresh_evidence` and ask for a new decision.
- Supply takes `amountUsdc` in decimal USDC; redeem takes `amountReceiptTokens` in decimal receipt tokens to burn, not USDC. Both use at most 6 decimals, such as `"0.5"` or `"1"`. Never use floats, exponents or signs, and never pass both fields.
- Never claim guaranteed returns. APY is provider-indexed data, not realized return. Nothing is guaranteed.

## Wallet prerequisites

Before signing in, confirm this agent host exposes a user-controlled wallet with all of these capabilities: the public address and network, `signMessage` for exact UTF-8 bytes, and `signTransaction` that returns signed bytes without broadcasting. Each signature prompt must allow the human to review and approve the exact request.

Use the host's documented wallet connection flow. Ask the human to connect their wallet through that flow. Confirm the wallet is on Solana Devnet and already has the required Devnet SOL for fees and Devnet USDC for the requested supply. If there is no user-controlled wallet, the host cannot sign, or required funds are absent, state the exact missing prerequisite and stop. Never create or fund a wallet. Never ask for, read, generate, or store a seed phrase, private key, or keypair file. Do not run a signing command as a fallback. Do not use a sign-and-send method.

If the host does not expose any required capability, state which capability is missing and stop before `falcon_connect` or any transaction. Do not treat a browser wallet, trading protocol, or local CLI as an agent wallet unless this host exposes the required signing methods to you.

## First read-only result

1. Call `falcon_connect` with the connected wallet's public address. It returns `challengeId`, `message`, `expiresAt` and `next`. Show the exact message and host to the human.
2. Check that the message names the host in `{{FALCON_MCP_URL}}` and asks only for wallet ownership. Ask for clear approval. After approval, sign the exact UTF-8 bytes with `signMessage`, then call `falcon_connect_verify`.
3. Call `falcon_yield_opportunities` with the returned `session`. Show the provider-indexed opportunities and limits. Stop here. Do not refresh evidence or prepare a transaction unless asked.

## What you are signing against

Falcon uses Kamino's KLend program on Solana Devnet. These are the live addresses verified in the mesh adapter:

| Name | Address |
| ---- | ------- |
| KLend program | `KLend2g3cP87fffoy8q1mQqGKjrxjC8boSyAYavgmjD` |
| Market | `6aaNTBEmwdN19AAdTwbNrWyUo6iEyiLguxCTePEzSqoH` |
| Reserve | `HRwMj8uuoGVWCanKzKvpTWN5ZvXjtjKGxcFbn2qTPKMW` |
| Devnet USDC mint | `4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU` |

## Concepts

- Evidence freshness. Evidence is a capture of live Devnet sources at a moment in time. Every decision names the maximum age you accept, from 1 to 300 seconds. Old evidence gives NO_DATA, not a guess. Refresh before you ask for a decision.
- Evidence capture and NO_DATA. `falcon_refresh_evidence` contacts the Devnet sources live. If a capture fails, it may return NO_DATA instead of analysisId. When that happens, wait a few seconds and call `falcon_refresh_evidence` again. Only call `falcon_reserve_decision` after the result shows both captures as observed.
- The reserve decision. `falcon_reserve_decision` runs five checks in order: `evidence` (live evidence exists and is usable), `freshness` (it is within your maximum age), `owner_cap` (the proposed amount is within the maximum the human set), `book_floor` (the observed unborrowed book is at least the floor the human set), and `proposal_vs_book` (the proposal fits inside that book). The checks are rules, not opinions.
- REVIEW means every check passed and a supply may be prepared, up to the proposed amount, before `expiresAt`. It is not approval to execute and not a prediction of return.
- BLOCKED means a limit the human set was exceeded. Do not prepare a supply. Say which check failed and why.
- NO_DATA means evidence is missing or too old. Do not prepare a supply. Refresh evidence and ask again, once.
- Why supply needs REVIEW and redeem does not. A supply puts funds into a market, so Falcon requires a saved, unexpired REVIEW decision for this owner that covers the amount. A redeem takes funds out. Blocking an exit would trap the human, so redeem never needs a decision and must not carry a `decisionId`. A redeem still needs a fresh `analysisId` from `falcon_refresh_evidence`, because Falcon builds the transaction from the observed reserve state.
- On redeem, report the receipt tokens being burned and the adapter's `estimatedUsdc` output separately. The simulated estimate is not guaranteed settlement output. Activity shows redeem input as `amountReceiptTokens`, never as USDC.
- Owner caps. The limits in the decision (maximum, book floor, evidence age) come from the human. Do not pick them yourself to make a decision pass.
- Devnet cap. A supply is capped at 1 USDC (1000000 base units) on Devnet, whatever the decision says.
- `executionReady` is always `false`. Opportunities and decisions are information, never approval to execute. It does not block anything. Only the human approves a transaction, and only `falcon_prepare_transaction` builds one.
- What a receipt proves. `falcon_check_receipt` reads Devnet and reports `CONFIRMED`, `PENDING`, `FAILED` or `UNVERIFIED`. `CONFIRMED` means Falcon found the exact transaction and matching token movements. It does not prove any yield, a future redeem, or anything about mainnet. Independently verify the same signature in Solana Explorer on Devnet. An expired blockhash with `UNVERIFIED` does not prove the transaction failed; check Explorer before any retry.

## Signing order (do not improvise)

1. Call falcon_prepare_transaction. It returns an unsigned transaction. Confirm the action, human-requested amount, connected wallet, Devnet network, and 1 USDC supply cap.
2. Show the human the transaction intent and the exact details the wallet can review. Ask for separate, explicit approval to sign this specific transaction. Approval to connect, review, or prepare is not approval to sign.
3. Sign with the wallet's signTransaction method, which must return signed bytes without broadcasting. Never use signAndSendTransaction or any combined sign-and-send method.
4. Call falcon_submit_signed with those exact bytes. Falcon re-verifies the signature and records SUBMITTED. It does not broadcast. Keep the bytes only in conversation memory; tool results strip them.
5. Wait for the human to broadcast the exact registered signed transaction from their wallet or user-controlled Devnet RPC. The agent never broadcasts. Do not call sendTransaction, sendRawTransaction, or any other network send method, even if the human asks. Ask the human to provide the transaction signature after they broadcast.
6. Verify that exact signature independently in Solana Explorer on Devnet: https://explorer.solana.com/tx/<signature>?cluster=devnet. Confirm the exact signature, Devnet cluster, success status, and expected token movements. Then call falcon_check_receipt with the same intent. Report both results. If the host cannot read Explorer, give the human the link and mark independent verification incomplete until they confirm it.
7. If Explorer and Falcon disagree, or either result is pending or failed, stop. Show both results. Never claim success or retry without checking the same signature and getting fresh approval.

A prepared intent expires after about 120 seconds. Complete preparation, review, signature, and Falcon registration without long pauses. Ask the human to broadcast promptly. If it expires before broadcast, ask before preparing a replacement.

## Workflow

1. `falcon_connect` with `{wallet}`. Returns `challengeId`, `message`, `expiresAt` and `next`. Show the message to the human and check it against the Rules. Sign the exact UTF-8 message bytes with `signMessage`.
2. `falcon_connect_verify` with `{challengeId, signature}`. The signature may be base64 or base58 of 64 bytes. Returns `session`, `walletAddress`, `expiresAt`. This is the only tool that returns a session token.
3. `falcon_yield_opportunities` with `{session}`. Returns provider-indexed USDC lending opportunities and a `limits` list. Repeat the limits to the human.
4. `falcon_refresh_evidence` with `{session}`. Captures the live sources and builds the analysis. Returns `analysisId`, `status`, `capturedAt`, and the reserve liquidity and slot when present.
5. `falcon_reserve_decision` with `{session, proposedUsdc, maxUsdc, minBookLiquidityUsdc, maxEvidenceAgeSeconds}`. Returns the decision id, status, summary, checks, `expiresAt` and a `next` hint.
6. `falcon_prepare_transaction`: supply with `{session, action: "supply", amountUsdc, analysisId, decisionId}`; redeem with `{session, action: "redeem", amountReceiptTokens, analysisId}`. Both actions need `analysisId` from step 4. Supply needs `decisionId` from step 5; redeem skips step 5 and forbids it. Returns `unsignedTransactionBase64`, `intentId`, `messageSha256`; a redeem also returns `amountReceiptTokens` burned and `estimatedUsdc` output.
7. Register the exact signed bytes with falcon_submit_signed, then wait for the human to broadcast them. Do not call any network send method.
8. After the human broadcasts and provides the signature, verify the same signature in Solana Explorer on Devnet and call falcon_check_receipt with the same intentId. Report both results, including pending, failed, or mismatched status.
9. `falcon_activity` with `{session}`. Returns the trail of decisions, intents and latest event status. Supply inputs are `amountUsdc`; redeem inputs are `amountReceiptTokens`, not USDC. Empty arrays mean nothing exists yet.
10. `falcon_disconnect` with `{session}` when the human is done.

## Worked Devnet example

Placeholders are in angle brackets. Never write real keys, seed phrases or session tokens into notes or messages.

1. Human: "Supply 0.5 USDC on Devnet only if Falcon says REVIEW. My maximum is 0.5 USDC."
2. Confirm the host exposes a user-controlled Devnet wallet with the public address, `signMessage`, and `signTransaction`. Confirm it already has Devnet SOL for fees and enough Devnet USDC. If any condition fails, stop without creating or funding a wallet.
3. Connect and verify sign-in only after showing the exact ownership message and receiving approval. Keep `<session>` private.
4. Call `falcon_refresh_evidence` and use the returned `<analysisId>`. Ask the human for their own book-liquidity floor and evidence-age limit. Call `falcon_reserve_decision` with those limits and `"proposedUsdc":"0.5"`, `"maxUsdc":"0.5"`. Continue only if the result is REVIEW; otherwise stop and report its checks.
5. Show the human the REVIEW result and ask for separate approval to prepare the 0.5 USDC supply. Call `falcon_prepare_transaction` with the returned analysis and decision IDs. Check the network, wallet and amount.
6. Show the exact transaction details. Ask for separate approval to sign. Sign without broadcasting and call `falcon_submit_signed` with those exact signed bytes.
7. Ask the human to broadcast the registered signed transaction from their wallet or user-controlled Devnet RPC. Do not broadcast it yourself. After the human provides the signature, inspect https://explorer.solana.com/tx/<signature>?cluster=devnet and call falcon_check_receipt. Report both results. If Explorer is unavailable, say independent verification is incomplete.
8. Call `falcon_activity` to show the human the trail, then `falcon_disconnect`.

## Managing funds responsibly

- The human sets the limits and approves every action. You do not widen a limit to get a REVIEW.
- No autonomous loops. Do not schedule repeat supplies or redeems. Each action needs its own human approval.
- Never retry a failed broadcast blindly. Check the receipt first. Only prepare a new transaction when the receipt and the human both agree it is needed.
- Never claim yield or returns are guaranteed. Say what Falcon returned and where the data came from.
- Falcon is not financial advice. Say so when the human asks what they should do.

## Errors

- Tool errors are JSON with `code` and `message`. Show the message to the human in plain words.
- `RATE_LIMITED`: wait for `retryAfterSeconds` or the retry hint, then try once more. Do not loop.
- `MESH_UNAVAILABLE`: the Falcon backend did not answer. Tell the human, wait, and retry later. Do not invent results.
- `INVALID_INPUT`: Falcon rejected the request, and the message says why. If the wallet lacks Devnet SOL, Devnet USDC, or receipt tokens, tell the human which asset is missing and stop. Falcon does not fund wallets. Do not generate a wallet or seek a key. For any other `INVALID_INPUT`, fix the named field. Do not retry unchanged.
- Session expired: a session lives 30 minutes. If a tool says the session is invalid or expired, run the connect flow again from step 1 of the Workflow. Ask the human before signing the new sign-in message.
- An expired prepared transaction cannot be signed. Prepare a new one after the human agrees.

## Limits

- These are Devnet test transactions. They do not use mainnet funds.
- Supply is capped at 1 USDC (1000000 base units) on Devnet.
- Falcon does not broadcast. The human alone broadcasts the registered transaction. The agent never broadcasts, even if the human asks.
- Falcon never holds keys and offers no custody.
- Yield data is provider-indexed and may be stale. This is not financial advice.
<!-- else:mcp -->
The Falcon MCP server is not deployed yet. Do not install anything or edit any config. Tell the human the plugin is not available yet.
<!-- endif:mcp -->
