# Funded lending R1.1 implementation contract

[VERIFIED] User selected `Approve R1 implementation`, then `Approve dedicated bot wallet` for proposal-r1-1.html. This file fixes interfaces between independent implementation slices. Approval covers local implementation only. It does not authorize live account/policy creation, signing grants, funding, broadcasts, paid calls, pushes or deployments.

[VERIFIED later user direction] User requested product structuring, complete user journeys and visual review before more feature implementation. The current code is an unready technical prototype. Publication as small draft PRs is authorized by the later request to commit and push. No merge, deployment, provider activation or funds movement is authorized.

[VERIFIED source and primary documentation] The current R1.1 JWT handoff does not establish a strictly scoped backend credential boundary. The current mainnet path also lacks first-run wallet token-account setup. A client-only owner-credential flow and explicit owner-signed setup remain proposed changes, not implemented or approved product behavior.

## Ownership

- Main session owns SPEC, common CFO lifecycle/store, HTTP/server/runner, Rust MCP, CI, backend package/lock, integration and all executed verification.
- Wallet worker owns `mesh/cfo/wallet-provider.mjs` and `mesh/test/bot-wallet-provider.test.mjs` only.
- Solana worker owns `mesh/cfo/solana-lending.mjs` and `mesh/test/bot-solana-lending.test.mjs` only.
- Frontend worker owns new `web/dashboard/LendingBot.jsx`, `web/dashboard/lending-bot.css`, `web/dashboard/EmbeddedWallet.jsx`, `web/test/lending-bot.test.mjs`, modifications to `web/dashboard/OwnerDashboard.jsx`, and web package/lock only. Preserve the NEAR Cfo component and existing wallet gate.
- Workers MUST use the verified luna-builder model/maximum-effort configuration. No substitute, nested agents, tests/build/lint/format runs, signing, funding, paid requests, commits or external writes. Write behavior checks but parent runs them after integration. No speculative SDK fallbacks or no-op implementations.

## Product scope

[APPROVED] Private pilot, customer controls wallet and policy-resource administration; backend has only scoped signer authority. Native USDC, Solana mainnet-beta, exactly two operator-reviewed Kamino floating-rate reserves. No borrowing, collateralized leverage, swaps, bridging, reward sale or shared Falcon vault. Config default denies financial execution. Real signing requires explicit provider configuration and customer delegation. HOLD and unavailable states are valid, not fake success. Financial defaults must not be invented.

[PROPOSED concrete identities for read-only verification, not an investment endorsement] Native USDC mint `EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v`; candidate reserves `D6q6wuQSrifJKZYpR1M8R4YawnLDtDsMmWM1NbBmgJ59` in market `7u3HeHxYDLhnCoErrtycNokbQYbWGzLs6JSDqGAv5PfF`, and `Ga4rZytCpq1unD4DbEJ5bkHeUz9g3oh9AAFEi6vSauXp` in market `DxXdAyU3kCjnyggvHmY5nAwg5cRbbmdyX3npfDMjjMek`. Verify current account/program/mint/state/receipt/price data. Do not equate indexed APY or book liquidity with executable withdrawal.

## Dependencies

[VERIFIED registry lookup] Privy Node 0.38.0 requires optional Kit 5 peers, while Kamino 13.0.6 declares Kit 2 and program packages with Kit 3 peers. Parent is resolving that dependency graph without force flags. Use native Privy REST with `jose` 6.2.15, not the conflicting Node SDK runtime. Direct token builder 0.5.0 supports Kit 2. Frontend may pin `@privy-io/react-auth` 3.51.3 and its compatible peers. Web and backend have separate dependency roots.

## Adapter contract (Solana worker)

Export `USDC_MINT`, `DEFAULT_LENDING_RESERVES` (two reviewed identities), and `createSolanaLendingAdapter({rpcUrl, reserves = DEFAULT_LENDING_RESERVES, fetchImpl = globalThis.fetch, now = () => new Date().toISOString()})`.

Returned methods:
- `capture({wallet})` -> `Portfolio` below. Real read-only RPC/state path, exact identities/units/receipt rates and source slots. No user key needed.
- `prepare({wallet, action, reserveAddress, amountBaseUnits, maxFeeLamports, maxEvidenceAgeSeconds})` -> `PreparedAction`. `action` is `supply` or `redeem`; supply amount is USDC base units; redeem amount is receipt-token base units. No borrowing-obligation path.
- `prepareFeeTransfer({wallet, recipient, amountBaseUnits, maxFeeLamports})` -> PreparedAction with action `fee`, exact native USDC transfer, owner-signature only. Never delegate fee payment.
- `verifySigned({prepared, signedTransactionBase64})` -> `{signature, signedTransactionBase64, messageSha256}` after exact message, instruction/signature and wallet checks; not a broadcast.
- `submit({prepared, signedTransactionBase64})` -> `{signature}`. Use sign-only provider separately; parent persists exact signed bytes/SUBMISSION_UNKNOWN before calling. No automatic replacement signatures or unbounded retry.
- `reconcile({prepared, signature})` -> `{status:'PENDING'|'CONFIRMED'|'FAILED'|'UNVERIFIED', signature, slot:null|number, amounts:null|{usdcDebitBaseUnits,usdcCreditBaseUnits,receiptDebitBaseUnits,receiptCreditBaseUnits,feeLamports}, reason:null|string}`. Confirm exact finalized transaction identity and owner-local token effects. An absent result is not proof of failure.
- `policyRules({wallet, mandate})` -> exact Privy `signTransaction` rule definitions for supported instructions only, pin program + IDL instruction arguments/accounts, user's receipt/USDC destinations, amounts and bounded compute/native costs. No wildcard program-only allow; explicitly reject unsupported policy encodings. Fee transfer is excluded from worker policy. Coordinate structural policy requirements directly with wallet worker.

`Portfolio` = `{schemaVersion:1, chain:'solana', network:'mainnet-beta', wallet, status:'OBSERVED'|'NO_DATA', capturedAt, observedAt:null|string, slot:null|number, nativeLamports:string|null, cashBaseUnits:string|null, positions:[{reserveAddress,marketAddress,receiptMint,receiptDecimals:number,receiptBaseUnits:string,usdcValueBaseUnits:string,redeemableBaseUnits:string,supplyApyBps:number,observedAt,slot}], issues:string[]}`. All money uses canonical integer strings. Missing evidence is unavailable, not zero. A rate is an observed estimate, not guaranteed return.

`PreparedAction` = `{schemaVersion:1, chain:'solana', network:'mainnet-beta', wallet, action:'supply'|'redeem'|'fee', reserveAddress:null|string, amountBaseUnits:string, amountUnit:'usdc-base-units'|'receipt-base-units', recipient:string, transactionBase64:string, messageSha256:string, signature:null|string, blockhash:string,lastValidBlockHeight:number,observedAt:string,expiresAt:string,feeLamports:string,rentLamports:string,expectedEffects:{usdcDebitBaseUnits:string,usdcCreditBaseUnits:string,receiptDebitBaseUnits:string,receiptCreditBaseUnits:string},source:{slot:number,programId:string,adapterVersion:string}}`. Extra explicit evidence fields are allowed if JSON-safe and safe to retain; worker must report additions. SDK/parser failures surface typed errors, never placeholder transactions.

## Wallet-provider contract (wallet worker)

Export `createWalletProvider({appId, appSecret, authorizationKeyId, authorizationPrivateKey, fetchImpl=globalThis.fetch, now=()=>new Date().toISOString(), client})`. `client` is an optional fetch-compatible transport for deterministic consumer tests. The provider retains the same fixed origin, paths and authentication checks. Runtime without required config returns explicit unavailable state or throws before protected calls.

Methods:
- `configuration()` -> `{configured:boolean, appId:string|null, signerId:string|null, issues:string[]}`; no secrets.
- `verifyWalletLink({accessToken, walletAddress})` -> internal `{providerWalletId,walletAddress,userId,ownerId}` after independently verifying JWT/app/user/address ownership and resolving the actual provider wallet ID server-side. Public responses omit userId/ownerId. Never persist accessToken or require a client-supplied provider ID.
- `prepareDelegation({accessToken, link, mandate, rules})` -> `{policyIds:string[], policyHash:string, signerId:string,expiresAt:string,summary:string[]}`. Explicit user control action only. Policies must have customer resource owner, not backend admin. This method does not update existing policies. That alone does not prove a strictly scoped credential boundary while owner JWTs reach Mesh.
- `verifyDelegation({link, mandate, delegation, rules})` -> current `{status:'ACTIVE'|'REVOKED'|'EXPIRED'|'UNAVAILABLE',policyHash,reason}` by checking actual wallet signer and owned-policy resources/digests. No trusting just local flags or caller policy IDs. This is also called before signing.
- `signTransaction({link, mandate, delegation, rules, transactionBase64})` -> `{signedTransactionBase64}` using the scoped backend authorization key in sign-only mode. Never signAndSend, broadcast, charge fee, change policy, or use owner credentials here.
- `prepareRevocation({accessToken,link})` -> `{walletAddress,signerIds,scope:'ALL_DELEGATED_SIGNERS',warning}` from fresh authoritative resources and verified customer ownership. Parent commits pause before this call.
- `revokeDelegation({accessToken,link,delegation})` -> verified state AFTER the customer explicitly confirms removing ALL delegated signers on the dedicated Falcon wallet and the frontend calls the supported SDK. Backend verifies ownership and actual absence of all delegated signers. Never claim selective removal or success from a local flag.

Only the frontend explicit customer action installs the additional signer (Privy addSigners) after policy preparation; backend verifies installation through `/delegation`. Parent owns persistence, locking and RPC submission.

## HTTP and UI contract (parent + frontend worker)

All resources under `/v1/lending-bot`, with existing verified Falcon wallet session deriving owner/address. No caller owner/wallet fields. Backend also verifies embedded provider ownership when linking. All POST bodies include UUID requestId; exact schemas below. GET never captures, starts, retries, pays models, signs, or sends.

- GET root -> Overview below.
- POST `/wallet-link` `{requestId,accessToken}` -> `{walletLink}` sanitized; server resolves providerWalletId. No accessToken retention.
- POST `/mandate` `{requestId,mandate}` -> `{mandate:{id,data}}`.
- POST `/delegation/prepare` `{requestId,accessToken}` -> `{delegation}` above. Explicit confirmation before any provider mutation.
- POST `/delegation` `{requestId}` -> `{delegation:{status,policyHash,expiresAt,reason}}`; verifies actual installed signer/policy, no caller scope selection.
- POST `/capture` `{requestId}` -> `{portfolio}` current real observation (explicit read action).
- POST `/start`, `/pause` each `{requestId}` -> `{runner}`.
- POST `/revoke/prepare` `{requestId,accessToken}` -> `{revocation:{walletAddress,signerIds,scope:'ALL_DELEGATED_SIGNERS',warning}}`; commit pause before reading authoritative inventory. Preview is not revocation.
- POST `/revoke` `{requestId,accessToken}` -> `{runner,delegation}`. Verify the customer-performed SDK removal. Report remaining signers or provider failure without claiming revoked. Already-submitted actions stay reconcilable.
- POST `/withdraw` `{requestId,reserveAddress,receiptBaseUnits}` -> `{ownerAction:{actionId,prepared}}`, unsigned exact owner action independent of worker delegation. Cannot block withdrawal for unpaid fees.
- POST `/fee-claim` `{requestId}` -> `{ownerAction:{actionId,prepared}}`, based only on reconciled positive owed fee, allowlisted configured recipient and actual cash. No arbitrary caller recipient/amount.
- POST `/owner-signatures` `{requestId,actionId,signedTransactionBase64}` -> `{action}` after exact verification, durable signed bytes/SUBMISSION_UNKNOWN, bounded broadcast. UI separately approves exact fee or withdraw bytes before owner signing.
- POST `/reconcile` `{requestId,actionId}` -> `{action}`; current receipt proof, no new spend.

Mandate object = `{schemaVersion:1,capitalCapBaseUnits,reserveFloorBaseUnits,maxActionBaseUnits,maxPositionBps,maxFeeLamports,maxEvidenceAgeSeconds,minHoldingSeconds,minNetBenefitBaseUnits,cooldownSeconds,feeBps,feeRecipient,reserves:[reserveAddress,reserveAddress],expiresAt,monitorIntervalSeconds,maxReviewCalls}`. Money unsigned canonical strings. BPS and positive seconds are integers. feeRecipient must equal trusted operator configuration, not an arbitrary fee destination. Target registry identities are fixed supported configuration, not request discovery. Customer enters financial values; no hidden monetary defaults. Existing legacy policies are unaffected.

Overview = `{schemaVersion:1,domain:'solana-lending-bot',chain:'solana',network:'mainnet-beta',status:'READY'|'SETUP_REQUIRED'|'NO_DATA',configuration:{walletProviderConfigured:boolean,executionEnabled:boolean,appId:string|null,signerId:string|null,feeRecipient:string|null,feeBps:number|null,availableReserves:[{reserveAddress,marketAddress,mint,symbol,decimals}],issues:string[]},walletLink:null|{providerWalletId,walletAddress},mandate:null|{id,data},delegation:null|{status,policyIds,policyHash,signerId,expiresAt,summary,reason},portfolio:null|Portfolio,runner:{state:'STOPPED'|'RUNNING'|'PAUSED'|'REVOKED'|'BLOCKED',nextRunAt:null|string,reason:null|string},actions:[{actionId,status,action,reserveAddress,amountBaseUnits,amountUnit,signature,createdAt,reason}],accounting:{depositsBaseUnits,withdrawalsBaseUnits,netGainBaseUnits,earnedFeeBaseUnits,paidFeeBaseUnits,highWaterMarkBaseUnits},issues:string[]}`. Missing actual money fields in unavailable states remain null rather than invented values.

Frontend starts with current verified session's wallet. Explicit embedded-wallet create/login must be user-initiated. If that wallet differs, establish the existing Falcon ownership challenge/session for the embedded wallet; never link one wallet using another wallet's session. Add isolated provider integration, not a replacement of existing external-wallet sign-in. No funding transfer by app; show exact address/network and observe explicit capture. Grant installation, owner signing, pause/revoke and fee payment each have separate clear human actions. Preserve private/gated dashboard and no fictitious organization tenancy.

[APPROVED R1.1] A focused funded treasury experience is the primary customer surface. Keep NEAR CFO as an explicit separate network/workflow in the same multi-chain product. Never combine balances or imply bridging, automated NEAR signing, or shared cross-chain authority. Only the dedicated customer-owned Falcon embedded wallet receives the revoke-all flow. Show the actual wallet and all signer IDs before confirmation.

## Executed checks and limits

[VERIFIED] From `mesh/`, Node 24.19.0 ran `node --test --test-concurrency=2 test/bot-service.test.mjs test/bot-accounting.test.mjs` with `FALCON_MESH_TEST_DATABASE_URL` set to a disposable PostgreSQL 17 cluster. Result: `tests 21`, `pass 21`, `fail 0`, `skipped 0`.

[VERIFIED] The same-signature case first failed in a collected eight-case service run: `pass 7`, `fail 1`, `Missing expected rejection`. The fee-after-drawdown counterexample first returned `10` instead of `0`. Both pass with the guards in this checkpoint.

[VERIFIED] A separate local Node/PostgreSQL smoke observed `SUBMISSION_UNKNOWN` then `CONFIRMED`, followed by `PAUSED`; one signer request, one broadcast attempt, and signed bytes durable at send. Provider, chain and Council transports were fixtures. No live wallet or chain readiness follows.

[VERIFIED] Five explicit Kit 2-compatible program pins and `buffer-layout` materialized with `npm ci --strict-peer-deps --ignore-scripts --no-audit --no-fund`; `npm ls --all --parseable` completed. SDK/adapter import timed out at 60 seconds. The exposed receipt path remains runtime-unproved.

## Primary source pointers

- Privy policies/owners docs read in this session: controls/policies/overview, controls/policies/example-policies/solana-idls, controls/authorization-keys/using-owners/overview, recipes/wallets/conditional-signer-policies.
- Kamino current docs: build/developers/borrow/operations/deposit.md (use buildDepositReserveLiquidityTxns, NOT collateral/borrow path); build/tutorials/borrow/redeem-ctokens.md; SDK 13.0.6 actual installed exports are authoritative.
- Parent verifies complete merged behavior and meaningful broken guards. Agent success reports alone are not verification.

## Least confident decisions

1. [INFERRED] The current Kamino SDK dependency graph may require a different compatible pinned release. Parent must prove the installed graph and real adapter behavior.
2. [INFERRED] Native-fee pricing and withdrawal liquidity may be unavailable at observation time. Strategy must HOLD rather than assume zero costs or executable liquidity.
