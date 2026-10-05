---
name: falconos
description: Use when the user wants to work with FalconOS Devnet treasury yield from an agent. Covers installing the falconos MCP server, signing in with the agent's own Solana wallet, reading USDC yield opportunities, refreshing evidence, getting a REVIEW, BLOCKED or NO_DATA reserve decision, preparing an unsigned Devnet supply or redeem transaction, registering the wallet-signed bytes, checking the receipt, and reading the activity trail. Solana Devnet only. Not for mainnet and not for custody.
---

# FalconOS plugin

<!-- if:mcp -->
FalconOS gives an agent a Devnet treasury journey through an MCP server. The agent signs with its own wallet. Falcon never holds keys and never broadcasts a transaction.

- MCP server URL: {{FALCON_MCP_URL}}
- This skill: {{FALCON_SKILL_URL}}

## What Falcon is

Falcon collects evidence about a lending market from live sources and keeps it with its provenance. A decision gate turns that evidence and the owner's own limits into a REVIEW, BLOCKED or NO_DATA answer before any transaction can be prepared. The accounts stay under the customer's control: the agent's wallet signs, and Falcon only prepares unsigned transactions and records what was signed.

## Setup

1. Check whether an MCP server named `falconos` is already connected. If its tools are listed, skip to step 4.
2. If it is not connected, add it. Claude Code:

```
claude mcp add --transport http falconos {{FALCON_MCP_URL}}
```

   Any other MCP client, as JSON. The `type` field is required. An entry with only `url` is treated as a local command and skipped:

```json
{"mcpServers":{"falconos":{"type":"http","url":"{{FALCON_MCP_URL}}"}}}
```

3. Ask the human to run the command, or ask them to confirm before you edit any config file yourself. Do not change client config without that confirmation. Restart or reload the MCP client if it needs it.
4. List the available tools to verify. These ten must appear: `falcon_connect`, `falcon_connect_verify`, `falcon_disconnect`, `falcon_yield_opportunities`, `falcon_refresh_evidence`, `falcon_reserve_decision`, `falcon_prepare_transaction`, `falcon_submit_signed`, `falcon_check_receipt`, `falcon_activity`. If any are missing, tell the human which ones and stop.

## Rules

- Solana Devnet only. Refuse any request involving mainnet.
- The human approves every signature and every broadcast. Show what you are about to sign and wait for a clear yes.
- Never print or store the session token. Never write it to a file. Never include it in a message to the human. Keep it only as a tool argument for the current conversation.
- Read the sign-in message to the human. Refuse to sign it if it names a host other than the one in the server URL above, or if it asks you to spend, transfer, approve, or sign a transaction.
- Never call `falcon_prepare_transaction` for a supply unless `falcon_reserve_decision` returned REVIEW in this same conversation, and the amount is at most the decision's proposed amount.
- A BLOCKED or NO_DATA decision stops the supply. Explain the reason from the checks. For NO_DATA, you may call `falcon_refresh_evidence` and ask for a new decision.
- Amounts are decimal USDC strings with at most 6 decimals, such as `"0.5"` or `"1"`. Never use floats, exponents or signs.
- Never claim guaranteed returns. APY is provider-indexed data, not realized return. Nothing is guaranteed.

## Wallet

You need your own wallet tool that can do two things: `signMessage` (raw UTF-8 bytes) and `signTransaction` (sign without sending).

If you have no such wallet tool, say so and ask the human how to proceed. Do not generate a key and hold it for mainnet. Never ask the human for a private key or seed phrase. Falcon never receives a key from you either.

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
- Why supply needs REVIEW and redeem does not. A supply puts funds into a market, so Falcon requires a saved, unexpired REVIEW decision for this owner that covers the amount. A redeem takes funds out. Blocking an exit would trap the human, so redeem is never gated and must not carry a `decisionId`.
- Owner caps. The limits in the decision (maximum, book floor, evidence age) come from the human. Do not pick them yourself to make a decision pass.
- Devnet cap. A supply is capped at 1 USDC (1000000 base units) on Devnet, whatever the decision says.
- What a receipt proves. `falcon_check_receipt` reads Devnet and reports `CONFIRMED`, `PENDING`, `FAILED` or `UNVERIFIED`. `CONFIRMED` means the exact signed transaction landed on Devnet and the token movements match the intent. It does not prove any yield, a future redeem, or anything about mainnet. `UNVERIFIED` after the blockhash expires does not prove the transaction did not run, so check again before you try anything else.

## Signing order (do not improvise)

1. `falcon_prepare_transaction`. It returns an unsigned transaction.
2. The human approves the action, amount and wallet.
3. Sign with the wallet's `signTransaction`. NEVER use `signAndSendTransaction` or any sign-and-send tool. Those broadcast before Falcon has the bytes and break receipt reconciliation.
4. Call `falcon_submit_signed` with the signed bytes. Falcon re-verifies the signature and records SUBMITTED. It does not broadcast.
5. Only then broadcast the SAME signed bytes to Solana Devnet yourself, with your wallet or RPC. Do not re-sign or change them.
6. Call `falcon_check_receipt`.

A prepared intent expires after about 120 seconds. Do steps 1 to 4 without long pauses. If it expires, prepare again.

## Workflow

1. `falcon_connect` with `{wallet}`. Returns `challengeId`, `message`, `expiresAt` and `next`. Show the message to the human and check it against the Rules. Sign the exact UTF-8 message bytes with `signMessage`.
2. `falcon_connect_verify` with `{challengeId, signature}`. The signature may be base64 or base58 of 64 bytes. Returns `session`, `walletAddress`, `expiresAt`. This is the only tool that returns a session token.
3. `falcon_yield_opportunities` with `{session}`. Returns provider-indexed USDC lending opportunities and a `limits` list. Repeat the limits to the human.
4. `falcon_refresh_evidence` with `{session}`. Captures the live sources and builds the analysis. Returns `analysisId`, `status`, `capturedAt`, and the reserve liquidity and slot when present.
5. `falcon_reserve_decision` with `{session, proposedUsdc, maxUsdc, minBookLiquidityUsdc, maxEvidenceAgeSeconds}`. Returns the decision id, status, summary, checks, `expiresAt` and a `next` hint.
6. `falcon_prepare_transaction` with `{session, action, amountUsdc, analysisId, decisionId}`. For `supply`, `decisionId` is required and comes from step 5. For `redeem`, leave it out. Returns `unsignedTransactionBase64`, `intentId` and `messageSha256`.
7. Follow the signing order above, using `falcon_submit_signed` with `{session, intentId, signedTransactionBase64}`, then your own broadcast.
8. `falcon_check_receipt` with `{session, intentId}`. Returns the reconciled event. Report it as it is, including a pending or failed status.
9. `falcon_activity` with `{session}`. Returns the trail of decisions, intents and latest event status. Empty arrays mean nothing exists yet.
10. `falcon_disconnect` with `{session}` when the human is done.

## Worked Devnet example

Placeholders are in angle brackets. Never write real keys or tokens into notes or messages.

1. Human: "Supply 0.5 USDC on Devnet, but only if Falcon says it is fine."
2. You call `falcon_connect` with `{"wallet":"<agent wallet address>"}`. You show the human the returned message and confirm it names the Falcon host and does not ask to spend, transfer, approve, or sign a transaction. You sign it with `signMessage` and call `falcon_connect_verify` with `{"challengeId":"<challengeId>","signature":"<64 byte signature>"}`. You keep `<session>` to yourself.
3. You call `falcon_refresh_evidence` with `{"session":"<session>"}` and get `<analysisId>`.
4. You ask the human for limits, then call `falcon_reserve_decision` with `{"session":"<session>","proposedUsdc":"0.5","maxUsdc":"1","minBookLiquidityUsdc":"100","maxEvidenceAgeSeconds":120}`. The answer is REVIEW with `<decisionId>`.
5. You tell the human: "Falcon says REVIEW. I can prepare a supply of up to 0.5 USDC on Devnet. This is a test transaction." You call `falcon_prepare_transaction` with `{"session":"<session>","action":"supply","amountUsdc":"0.5","analysisId":"<analysisId>","decisionId":"<decisionId>"}`.
6. The human approves. You sign `<unsignedTransactionBase64>` with `signTransaction` and call `falcon_submit_signed` right away.
7. You broadcast the same signed bytes to Devnet, then call `falcon_check_receipt`. If it says PENDING, wait and check again. You report the status as returned.
8. You call `falcon_activity` to show the human the trail, then `falcon_disconnect`.

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
- Session expired: a session lives 30 minutes. If a tool says the session is invalid or expired, run the connect flow again from step 1 of the Workflow. Ask the human before signing the new sign-in message.
- An expired prepared transaction cannot be signed. Prepare a new one after the human agrees.

## Limits

- These are Devnet test transactions. They do not use mainnet funds.
- Supply is capped at 1 USDC (1000000 base units) on Devnet.
- Falcon does not broadcast. You and your wallet do.
- Falcon never holds keys and offers no custody.
- Yield data is provider-indexed and may be stale. This is not financial advice.
<!-- else:mcp -->
The Falcon MCP server is not deployed yet. Do not install anything or edit any config. Tell the human the plugin is not available yet.
<!-- endif:mcp -->
