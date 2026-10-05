# FalconOS Phase 0 Design

> [VERIFIED, user direction, 2026-09-05] Historical Phoenix-only design. The user authorized a multichain build with Obsidian research. [Current context](../../../CONTEXT.md) and [build plan](../../../plans/roadmap.md) supersede this implementation sequence. The original decisions below remain available for reference.

- Date: 2026-08-28
- Owner: Founder / FalconOS
- Status: Written design, awaiting document review
- Scope: Founder-only Phase 0 control loop for Phoenix SOL-PERP

## Provenance and evidence rules

This document separates source facts from design choices.

- `[VERIFIED]` means I read the evidence in this session.
- `[REPORTED]` means a research or review agent reported the claim. I did not independently verify the source claim.
- `[INFERRED]` means an architecture conclusion derived from verified or reported evidence.
- `[DECIDED]` means the founder selected the option in this session.

The product vision remains the product source of truth. This document adds the Phase 0 implementation boundary and records decisions made during the design discussion.

## 1. Decision summary

### 1.1 Product boundary

- `[VERIFIED]` Phase 0 targets one founder-controlled agent, tiny Phoenix perpetual actions, one isolated position, paper mode, dry-run mode, approval-live mode, typed intents, deterministic verdicts, receipts, replay, supervision, recovery drills, one Brain evaluation path, and a Rise position-authority spike. Evidence: `VISION.md:581-629`.
- `[DECIDED]` FalconOS will build the Phase 0 control loop first. Public retail execution, customer funds, multiple active positions, cross margin, borrowing, flash loans, LP, swaps, arbitrage, performance fees, a Falcon token, and unrestricted agent tools remain outside the boundary.
- `[VERIFIED]` The vision defines the objective as an operational and trust experiment, not evidence of repeatable alpha. Evidence: `VISION.md:583-587`.

### 1.2 Runtime and hosts

- `[DECIDED]` The control plane uses TypeScript.
- `[DECIDED]` The Raspberry Pi 5 runs Falcon, the Vulcan adapter, SQLite, paper and dry-run execution, monitoring, and the local supervisor.
- `[DECIDED]` The Mac runs the restricted signer helper and human approval flow.
- `[DECIDED]` The root wallet stays outside Falcon and outside the Pi.
- `[INFERRED]` The first implementation will use one local TypeScript package. It will not create a cloud service or a control-plane HTTP daemon. The Mac signer will expose only the narrow mutual-TLS RPC.

### 1.3 Phoenix boundary

- `[DECIDED]` Falcon wraps a pinned and checksummed Vulcan binary for reads, paper mode, dry runs, confirmation, and diagnostics.
- `[DECIDED]` Vulcan output is an observation, not canonical state. Canonical state requires independent Phoenix account and Solana chain checks.
- `[DECIDED]` Rise is an early Phase 0 spike. The full Rise executor remains outside the first control-loop slice until delegation and transaction evidence pass.
- `[VERIFIED]` The vision requires a pinned Vulcan CLI, a wrapper that hides dangerous commands, and a Rise position-authority proof. Evidence: `VISION.md:605-612`.

### 1.4 Storage and memory

- `[DECIDED]` SQLite on an SSD is the authoritative control store on the Pi.
- `[DECIDED]` Obsidian is the Phase 0 human advisory memory surface. Use a local vault without a Sync subscription.
- `[DECIDED]` Citadel is deferred. It may become a later Brain or Cloud retrieval adapter after a separate proof.
- `[INFERRED]` No memory system can authorize a transaction. Policy, receipts, transaction material, signer state, and reconciliation remain in Falcon's controlled store.

### 1.5 Signing and transport

- `[DECIDED]` Live signing uses a separate Mac signer helper with a dedicated Phoenix position authority.
- `[INFERRED]` The fee payer is a separate restricted Mac key. It pays Solana fees only and has no Phoenix position authority.
- `[INFERRED]` The Mac signer uses a separate attestation key for signer audit evidence. It cannot authorize or sign Solana transactions.
- `[INFERRED]` P0E through P0G use separate sandbox position-authority and fee-payer keys against a non-live execution target. Live authority keys remain unavailable until P0H passes.
- `[DECIDED]` The Pi and Mac communicate through authenticated local RPC with direct mutual TLS on the private LAN.
- `[DECIDED]` The RPC accepts receipt-bound requests only. The Mac signer validates signer semantics, and the Pi executor owns transaction checks after signature return.
- `[INFERRED]` Tailscale or NetBird may carry the same RPC later if remote access becomes necessary. Overlay membership will not replace mutual TLS or signer checks.

### 1.6 Brain and x402

- `[DECIDED]` The founder will test Brain before deciding whether it is worth keeping.
- `[DECIDED]` Initial Brain testing uses fixtures or local inference and has a total paid budget of `$0`.
- `[DECIDED]` Brain is required for each new-risk action in founder approval-live mode. Brain failure or stale Brain evidence blocks new risk. Safety exits remain available.
- `[DECIDED]` No fixed value threshold is defined now. The founder will review recorded evidence after testing.
- `[DECIDED]` x402 is added only after the founder decides that Brain is useful and the Phase 0 safety gates pass.
- `[VERIFIED]` The vision keeps Brain advisory and read-only, separates service money from trading capital, and lists one fixed-price x402 evaluation endpoint as a Phase 0 output. Evidence: `VISION.md:188-198`, `VISION.md:487-506`, `VISION.md:614-629`.

## 2. Goals and non-goals

### 2.1 Goals

- `[INFERRED]` Convert a typed capital intent into a fresh reconciled snapshot, a deterministic verdict, an expiring decision receipt, an expiring transaction authorization receipt, a canonical message, final signed wire bytes, restricted signatures, a confirmed result, and a replayable outcome.
- `[INFERRED]` Prove that new risk fails closed when required data or evidence is missing.
- `[INFERRED]` Prove that a restart, timeout, network fault, or stale local lock does not create a duplicate order.
- `[INFERRED]` Prove that the Mac signer rejects a request that does not match the approved receipt and capability.
- `[INFERRED]` Let the founder judge Brain usefulness without allowing Brain to weaken deterministic control.
- `[INFERRED]` Run the paper and dry-run system on the Raspberry Pi before provisioning live signing authority. P0E through P0G may use sandbox signatures only.

### 2.2 Non-goals

- `[VERIFIED]` FalconOS will not build a new exchange, order book, matching engine, oracle, wallet, or generic Solana SDK. Evidence: `VISION.md:723-740`.
- `[VERIFIED]` FalconOS will not accept third-party pooled capital, launch public copy-trading, use borrowed capital, pursue high-frequency arbitrage, or market guaranteed returns in the MVP. Evidence: `VISION.md:723-740`.
- `[DECIDED]` FalconOS will not use Citadel, Obsidian Sync, x402, hosted signing, or Falcon Cloud as a prerequisite for the local safety loop.
- `[DECIDED]` FalconOS will not place the root wallet, private keys, raw identity, or unrestricted financial tools in agent memory, Obsidian, or the Pi.

## 3. Trust boundaries

`[INFERRED]` The Phase 0 system applies the following boundaries. They implement the vision's reasoning, control, data, signing, and payment plane separation. Evidence: `VISION.md:322-330`.

| Plane | Phase 0 component | Authority | Failure rule |
|---|---|---|---|
| Reasoning | Agent and CLI | Proposes typed intents only | Reject raw or ambiguous commands |
| Advisory memory | Obsidian and future Brain context | Provides untrusted context | Revalidate all facts before use |
| Data | Vulcan plus independent chain reads | Provides observations | Do not promote one observation to canonical state |
| Control | TypeScript policy and verifier | Final decision authority | Return `ALLOW`, `RESIZE`, or `BLOCK` |
| Evidence | Falcon receipt and outcome writers | Attests captured inputs and transitions | Sign each lifecycle record at capture time |
| Execution | Pi queue and transaction builder | Builds only approved transactions | No economic discretion |
| Signing | Mac signer helper | Signs only checked exact bytes | Reject missing, stale, changed, or out-of-scope requests |
| Safety | Independent exit path and root-owner recovery | Cancels, reduces, closes, or revokes | Must not depend on a new-risk job or Brain |
| Payment | Future Brain and x402 wallet | Pays service costs | Keep service money separate from margin |

`[VERIFIED]` The vision states that the model proposes, deterministic code has final authority, every live action needs a receipt, new risk fails closed, and safety exits remain available. Evidence: `VISION.md:367-381`.

## 4. Deployment topology

```text
Raspberry Pi 5, 64-bit Linux, SSD, Ethernet

  Falcon CLI and agent adapter
          |
  TypeScript control plane
          |
  Vulcan observation adapter
          |
  SQLite control state and evidence index
          |
  Local supervisor and safety monitor
          |
  Paper, dry-run, and sign-request creation
          |
  Direct mutual-TLS RPC over private LAN
          v
Mac or hardware-backed operator host

  Mac signer helper
  Sandbox position-authority and fee-payer keys for P0E-P0G non-live target
  Live delegated Phoenix position authority and restricted fee-payer key provisioned at P0H
  Independent receipt and transaction checks
  Manual approval for every risk increase
  Root-owner wallet and direct recovery path
  Local Obsidian vault
```

### 4.1 Raspberry Pi compatibility

- `[VERIFIED]` Raspberry Pi documents a 64-bit Arm Cortex-A76 CPU for Raspberry Pi 5. Source: <https://www.raspberrypi.com/products/raspberry-pi-5/> accessed 2026-08-28.
- `[VERIFIED]` The Vulcan build matrix includes `aarch64-linux` and maps it to `aarch64-unknown-linux-musl`. Source: <https://raw.githubusercontent.com/Ellipsis-Labs/vulcan-cli/master/.github/workflows/cross-build.yaml> accessed 2026-08-28.
- `[VERIFIED]` Vulcan release `v0.6.3` publishes `vulcan-0.6.3-aarch64-unknown-linux-musl.tar.gz`. Source: <https://github.com/Ellipsis-Labs/vulcan-cli/releases/tag/v0.6.3> accessed 2026-08-28.
- `[VERIFIED]` Vulcan's installer maps both `Linux-aarch64` and `Linux-arm64` to `aarch64-unknown-linux-musl`. Source: <https://raw.githubusercontent.com/Ellipsis-Labs/vulcan-cli/master/scripts/install.sh> accessed 2026-08-28.
- `[INFERRED]` The Pi deployment requires a 64-bit Linux userland. A 32-bit userland cannot run the published aarch64 binary.
- `[INFERRED]` The TypeScript control plane should run as compiled JavaScript on ARM64. The selected Node runtime and SQLite driver still need an actual Pi smoke test.
- `[VERIFIED]` Raspberry Pi recommends a 5V/5A USB-C supply and says active cooling gives best performance under load. Source: <https://www.raspberrypi.com/products/raspberry-pi-5/> accessed 2026-08-28.
- `[INFERRED]` The Phase 0 deployment should use an SSD for SQLite and evidence writes. The microSD card remains boot media or a fallback only.
- `[INFERRED]` Device compatibility is not yet verified on the founder's physical Pi. The first smoke test must record OS architecture, Vulcan version, checksum, SQLite restart behavior, supervisor heartbeat, network recovery, certificate rotation, backup, and restore.

### 4.2 Key placement

- `[DECIDED]` The root wallet stays on the Mac or a hardware-backed operator device.
- `[DECIDED]` The Pi does not receive the root wallet or its recovery material.
- `[INFERRED]` The live delegated position-authority key stays on the Mac signer until a separate host-security review permits another location.
- `[INFERRED]` P0E through P0G use sandbox key IDs and a non-live execution target. Live private keys and the live Solana RPC endpoint are unavailable to those phases.
- `[INFERRED]` P0H provisions the live position authority and fee payer only after P0E through P0G exit evidence and explicit founder approval.
- `[INFERRED]` Receipt signing keys, Brain keys, mTLS certificates, position-authority keys, and fee-payer keys are distinct key classes. No key may be reused across these purposes.

## 5. Memory architecture

### 5.1 Falcon control state

`[DECIDED]` SQLite on the Pi is the authoritative store for:

- policies and capability windows;
- typed intents;
- observation and canonical snapshot metadata;
- decision, transaction authorization, and execution receipts;
- unsigned transaction message bytes, canonical message hashes, final signed wire bytes, and their hashes;
- signer requests and returned signatures;
- execution state, leases, and idempotency records;
- confirmations, reconciliations, and outcomes;
- fault-injection evidence and recovery records.

`[INFERRED]` SQLite is a storage engine, not a trust boundary. Receipt signatures, canonical message checks, final wire-byte checks, signer checks, exact message and final wire binding, and chain reconciliation provide the safety properties.

### 5.2 Obsidian

- `[VERIFIED]` Obsidian documents local Markdown files, links, properties, search, offline use, Sync, CLI, and Headless Sync. Source claims are recorded in `docs/research/obsidian.md:232-256` and are `[REPORTED]`.
- `[DECIDED]` Falcon uses an ordinary local Obsidian vault without a Sync subscription in Phase 0.
- `[INFERRED]` Falcon writes sanitized, redacted, human-readable projections into the vault.
- `[INFERRED]` Human-edited notes enter Falcon only through parsing, schema validation, provenance checks, and fresh-state verification.
- `[INFERRED]` Obsidian properties hold small indexing fields only. They do not hold signatures, private keys, canonical policy, or transaction authority.
- `[VERIFIED]` Obsidian's current Sync page lists Standard at `$4 USD` per user per month billed annually and Plus at `$8 USD` per user per month billed annually. Source: <https://obsidian.md/sync> accessed 2026-08-28.
- `[DECIDED]` No Obsidian Sync subscription is required for the initial build. The recurring memory subscription cost is therefore `$0` at the start.

### 5.3 Citadel

- `[REPORTED]` Citadel's reviewed repository presents self-hosted source-linked memory with scoped access, policy-gated promotion, provenance, conflict handling, and audit metadata. Source: `docs/research/citadel.md:239-253`.
- `[REPORTED]` The reviewed repository describes testing status, external model enrichment, multiple storage profiles, a single-writer embedded graph constraint, and unresolved deployment details. Source: `docs/research/citadel.md:176-202` and `docs/research/citadel.md:278-290`.
- `[DECIDED]` Citadel is not a Phase 0 dependency.
- `[INFERRED]` A later Citadel spike must test local operation, source-linked retrieval, data isolation, concurrency, backup and restore, external model controls, and migration without changing Falcon's authority model.
- `[INFERRED]` Falcon may adopt Citadel's provenance and promotion patterns without importing its storage or service architecture.

### 5.4 Memory invariants

- `[INFERRED]` Memory results are untrusted context.
- `[INFERRED]` Every imported context snapshot records source IDs, file hashes, parser version, capture time, and freshness.
- `[INFERRED]` Conflicting notes remain visible. Falcon does not silently select one as financial truth.
- `[INFERRED]` New risk blocks when a selected advisory file changes during context assembly.
- `[INFERRED]` No Obsidian plugin, URI action, CLI command, Headless credential, Citadel token, or Brain response can bypass the Falcon verifier or signer.

## 6. Components and interfaces

`[INFERRED]` Each component exposes Falcon concepts instead of leaking Vulcan, Obsidian, or future Citadel internals.

`[VERIFIED]` Solana defines a transaction as signatures plus a message. Each signature covers the serialized message. The first signature belongs to the fee payer and also serves as the transaction ID. Source: <https://solana.com/docs/core/transactions/transaction-structure>, accessed 2026-08-28.

| Interface | Provider | Consumer | Required content | Failure behavior |
|---|---|---|---|---|
| Intent | CLI or agent adapter | Policy and verifier | Action, market, side, quantity, bounds, mode, owner, expiry | Reject ambiguous or unsupported intent |
| Policy | Falcon policy store | Verifier and signer | Version, account, capital, notional, leverage, loss, market, action, spend, time, autonomy, revocation | Block when absent, expired, or out of scope |
| Observation | Vulcan and chain adapters | Snapshot reconciler | Raw payload, source, command, version, checksum, slot, capture time, hash | Mark stale, gapped, incomplete, or conflicting |
| Canonical snapshot | Snapshot reconciler | Brain, verifier, replay | Account, position, margin, market, fees, funding, freshness, source set, hashes | Block new risk until reconciliation succeeds |
| Brain receipt | Brain or local test provider | Verifier and evidence store | Intent, policy, snapshot hashes, scenarios, bounds, costs, confidence, evidence, model version, expiry, signature | Block Brain-required new risk |
| Decision receipt | Falcon verifier | Queue and signer | Verdict, reason codes, approved bounds, all input hashes, expiry, policy version, verifier version, signature | No receipt means no signing |
| Transaction authorization receipt | Falcon verifier | Queue and signer | Execution ID, decision receipt ID, canonical message bytes, canonical message hash, message version, address lookup tables and lifecycle metadata, resolved address list, expected signer slots, fee payer, execution target, key environment, recent blockhash, last valid block height, commitment, RPC source, context slot, expiry margin, programs, accounts, instructions, quantities, price limits, expiry, nonce, receipt signature | Reject on mismatch, replay, unsupported message version, lookup-table mismatch, near expiry, expiry, or missing approval |
| Sign request | Pi executor | Mac signer | One-time ID, decision receipt ID, transaction authorization receipt ID, canonical message bytes, canonical message hash, message version, address lookup tables and lifecycle metadata, resolved address list, expected signer slots, fee payer, execution target, key environment, blockhash metadata, capability, expiry, nonce | Reject on mismatch, replay, unsupported message version, lookup-table mismatch, expiry, or missing approval |
| Signature result | Mac signer | Pi executor | Request ID, transaction authorization receipt ID, canonical message hash, message version, address lookup tables and lifecycle metadata, resolved address list, expected signer slots, returned signatures, signer key IDs, Mac attestation key ID, `mac_attestation_signature`, execution target, key environment, audit event | Reject if the message version, lookup data, target, or key environment differs, a returned signature fails verification or does not match its expected slot, or the audit signature fails or its attestation key ID is not pinned |
| Signed wire transaction | Pi executor | Solana RPC, reconciliation, replay | Final signed wire bytes, final signed wire bytes hash, canonical message hash, message version, address lookup tables and lifecycle metadata, resolved address list, expected signer slots, signatures, fee payer, execution target, key environment, transaction ID | Reject if the canonical message, message version, lookup data, expected signer slots, fee payer, target, or key environment differ from authorization, or if signatures or derived wire artifacts fail verification |
| Execution receipt | Pi executor | Reconciliation and replay | Execution ID, decision receipt ID, transaction authorization receipt ID, canonical message hash, message version, address lookup tables and lifecycle metadata, resolved address list, expected signer slots, fee payer, execution target, key environment, signatures, final signed wire bytes hash, transaction ID, blockhash metadata, statuses, slots, confirmations, result, prior hash | Mark unknown and reconcile before retry |
| Outcome event | Reconciler | Outcome ledger and export | Forecast, actual fill, costs, health, PnL, incident, source hashes, prior event hash | Keep append-only; flag missing fields |
| Obsidian projection | Exporter | Human reviewer | Redacted summary, canonical IDs, hashes, timestamps, links, freshness | Never use projection as authority |

### 6.1 Record identity

`[INFERRED]` Every action uses these identifiers:

```text
intent_id
policy_id and policy_version
snapshot_id
brain_receipt_id, when Brain is used
decision_receipt_id
execution_id
transaction_authorization_receipt_id
sign_request_id
canonical_message_hash
message_version
address_lookup_tables
resolved_address_list
expected_signer_slots
fee_payer
execution_target
key_environment
recent_blockhash
last_valid_block_height
blockhash_commitment
blockhash_rpc_source
blockhash_context_slot
expiry_margin_blocks
signed_wire_bytes_hash
transaction_id
outcome_event_id
```

`[INFERRED]` Each signed record includes a content hash, the hash algorithm identifier, a creation timestamp, an expiry where relevant, a key ID, and the prior record hash where the record belongs to an ordered chain.

`[INFERRED]` The transaction authorization receipt is created after transaction build and revalidation. It binds the canonical message bytes and hash, message version, address lookup tables, resolved address list, expected signer slots, fee payer, execution target, key environment, recent blockhash, last valid block height, commitment, RPC source, context slot, expiry margin, capability, and expiry. It does not include final signed wire bytes, the final signed wire bytes hash, or the transaction ID, which do not exist until returned signatures are verified and assembled.
`[INFERRED]` `expected_signer_slots` is an ordered list of `{message_account_index, public_key, key_id, role}` entries. It maps every required signer account in the canonical message to the signer allowed for that slot. Slot zero is the fee payer. The signature result must contain one verified signature for each slot in this order.
`[INFERRED]` For `legacy`, `address_lookup_tables` and `resolved_address_list` are empty. For `v0`, `address_lookup_tables` is an ordered list of `{table_address, table_owner, table_account_type, table_state_hash, table_context_slot, last_extended_slot, last_extended_slot_start_index, deactivation_slot, writable_indices, readonly_indices}` entries, and `resolved_address_list` is the complete ordered account list after static keys and lookup-table entries are expanded. Each entry is `{message_account_index, address, writable, signer, source_table_address, source_index}`; `source_table_address` and `source_index` are null for static keys. Falcon resolves this list independently, and the Mac signer and Pi compare both lists with the authorization receipt before signing or assembly.

`[INFERRED]` Falcon verifies returned signatures against the canonical message and their expected signer slots. It then assembles the final serialized transaction, derives `signed_wire_bytes_hash` and `transaction_id`, and persists those derived values in the execution receipt alongside the final signed wire bytes artifact before the first Solana submission. `transaction_id` is the first signature in the ordered signature array, which belongs to the fee payer.

## 7. Data flow

`[VERIFIED]` The vision defines an observe, propose, advise, verify, decide, receipt, approval, serialize, simulate, revalidate, sign, confirm, reconcile, supervise, and learn loop. Evidence: `VISION.md:339-356`.

`[INFERRED]` Phase 0 implements this flow:

1. The agent or CLI creates a typed intent.
2. Falcon loads the current versioned policy.
3. The observation adapter collects Vulcan output and independent Phoenix and chain reads.
4. The snapshot reconciler checks source identity, freshness, sequence, completeness, conflicts, and account state.
5. Falcon stores raw observations and creates a canonical snapshot only after checks pass.
6. The Brain test provider receives the typed intent, policy, and canonical snapshot when the mode requires Brain.
7. Falcon verifies Brain receipt signatures, hashes, bounds, model version, evidence references, and expiry.
8. The deterministic verifier recomputes fees, exposure, leverage, margin, loss, permissions, budgets, freshness, and Brain-required status.
9. Falcon returns `ALLOW`, `RESIZE`, or `BLOCK` with machine-readable reason codes.
10. Falcon signs and stores the decision receipt.
11. The current autonomy mode and manual approval rule run before the executor creates a job.
12. The executor takes an account lease, locks conflicting risk actions, obtains a fresh recent blockhash from the approved RPC source, selects the execution target, key environment, and message version permitted by the current phase, builds the canonical serialized message with the exact account and instruction set, resolves any permitted lookup tables, simulates it with the same commitment used for the blockhash, and revalidates all receipt-bound inputs.
13. After revalidation, Falcon creates and signs a transaction authorization receipt containing the canonical message bytes and hash, message version, address lookup tables, resolved address list, expected signer slots, fee payer, execution target, key environment, blockhash, last valid block height, commitment, RPC source, context slot, and expiry margin. It blocks if the message is already near expiry. The Pi sends the receipt-bound request through the mutual-TLS RPC.
14. The Mac signer independently checks the decision and transaction authorization receipts, canonical message, message version, address lookup tables, resolved address list, expected signer slots, fee payer, execution target, key environment, programs, accounts, instructions, quantities, price limits, blockhash metadata, current block height, expiry, and revocation. It asks for human approval for every risk increase and returns one signature for each expected slot, in slot order, only for the exact message bytes.
15. The Pi verifies the message version, lookup data, and each returned signature against the canonical message and its expected signer slot. It assembles the final signed wire transaction from the canonical message and verified signatures, derives the signed-wire hash and transaction ID, and persists the final signed wire bytes artifact plus those derived values in the execution receipt before the first Solana submission. It rechecks current block height and expiry margin, then commits a durable `submitting` transition before invoking the Solana send RPC.
16. The Pi submits the persisted wire bytes, records the response or unknown state, confirms the chain result, and reconciles account and position state. If blockhash expiry is proven before any `submitting` transition and durable state proves that no send may have occurred, Falcon marks the execution expired and starts a new execution after a fresh snapshot, policy check, decision receipt, blockhash, message, signatures, and transaction authorization receipt. If `submitting` exists, a send may have occurred, or the result is unknown, Falcon enters `confirmation_unknown` and reconciles the chain signature, order state, account state, and position state before deciding whether a new execution is allowed. It never reuses expired wire bytes or signatures.
17. Falcon appends the outcome event and creates a redacted Obsidian projection.
18. A later founder review uses the recorded Brain evidence and outcomes to decide whether Brain is useful.

### 7.1 Safety-exit flow

`[INFERRED]` Cancel, reduce, close, and revoke use a separate path. They do not wait for a new-risk queue, a Brain response, or an editable memory file. The root owner can recover directly from the Mac or the relevant wallet interface if the Pi, database, Vulcan process, or signer RPC is unavailable.

### 7.2 Recent blockhash lifetime

`[VERIFIED]` Solana's `getLatestBlockhash` response contains `blockhash` and `lastValidBlockHeight`. Solana's confirmation guidance says a recent blockhash commonly remains usable for about 60 to 90 seconds and recommends checking block height to detect expiry. Sources: <https://solana.com/docs/rpc/http/getlatestblockhash> and <https://solana.com/developers/cookbook/transactions/confirmation>, accessed 2026-08-28.

`[INFERRED]` Falcon fetches a blockhash immediately before transaction build. It records the selected commitment, RPC source, response context slot, and an `expiry_margin_blocks` setting in the transaction authorization receipt. It uses the same commitment and RPC source for blockhash fetch, simulation, submission, and block-height checks.

`[INFERRED]` A transaction is near expiry when `last_valid_block_height - current_block_height` is less than or equal to `expiry_margin_blocks`. The verifier, Mac signer, and Pi submitter reject near-expiry requests. A transaction is expired only after current block height exceeds `last_valid_block_height`. Falcon marks that execution expired and starts a fresh execution instead of reusing its bytes or signature.

### 7.3 Message format allowlist

`[VERIFIED]` Solana supports the `legacy`, `v0`, and `v1` transaction message formats. Version `v0` can load addresses from Address Lookup Tables. Version `v1` is not active on any cluster in the cited documentation. Sources: <https://solana.com/developers/cookbook/transactions/versions> and <https://solana.com/developers/cookbook/transactions/lookup-tables>, accessed 2026-08-28.

`[DECIDED]` Phase 0 defaults to `message_version=legacy`. The Mac signer, Pi executor, and signing request validator reject `v0`, `v1`, and unknown formats by default. There is no automatic version fallback.

`[INFERRED]` P0E may prove that `v0` is required using the sandbox Rise and Phoenix transaction corpus. Enabling `v0` requires a separate written gate decision before P0F, with every lookup table and the independently resolved address list bound in the authorization receipt. Version `v1` and unknown formats remain rejected.
`[VERIFIED]` The Agave versioned-transaction proposal says newly appended lookup-table addresses require one slot to warm up. Its lookup-table metadata includes `deactivation_slot`, `last_extended_slot`, and `last_extended_slot_start_index`. A deactivated table remains usable while its deactivation slot remains recent in the `SlotHashes` sysvar. Source: <https://docs.anza.xyz/proposals/versioned-transactions>, accessed 2026-08-28.

`[INFERRED]` Before approval, Falcon fetches every v0 lookup-table account at the approved commitment and records its response context slot. It verifies the table address, configured Address Lookup Table Program owner, decodable lookup-table account type, state hash, lookup indices, and lifecycle metadata. It requires `last_extended_slot` to be older than the execution context slot, so it rejects same-slot addresses instead of using partial warmup rules. It requires an unset deactivation slot or a deactivation slot still present in the current `SlotHashes` window. A table past cooldown is rejected. The authorization receipt binds these values, and the Mac signer and Pi recompute them independently.

## 8. Signer and RPC design

### 8.1 Signer boundary

- `[INFERRED]` The Mac signer is a separate process from the Pi control plane.
- `[INFERRED]` It has sandbox position-authority and fee-payer keys for P0E through P0G. The live delegated Phoenix position authority is provisioned only at P0H. It has no root wallet.
- `[INFERRED]` It independently recomputes the canonical message hash, message version, lookup-table resolution and lifecycle validation, receipt binding, expected signer slots, fee payer, and transaction semantics. It does not trust the Pi's verdict or display text alone.
- `[INFERRED]` It rejects arbitrary programs, accounts, instruction variants, quantities, price limits, markets, signer keys, signer-slot mappings, lookup tables, fee payers, or actions outside the capability.
- `[INFERRED]` It checks the canonical message bytes, message version, address lookup tables, table owner and account type, table context slot, warmup metadata, deactivation and cooldown state, resolved address list, expected signer slots, fee payer, execution target, key environment, recent blockhash, last valid block height, commitment, RPC source, current block height, and expiry margin before approval and before returning signatures.
- `[INFERRED]` It signs the signer audit result with a separate Mac attestation key. That key signs audit evidence only. The Pi verifies its signature against a pinned public key before accepting returned signatures.
- `[INFERRED]` It rejects any execution target or key environment not permitted by the current phase, including a live target in sandbox mode or sandbox keys in live mode.
- `[INFERRED]` It requires interactive founder approval for each increase in risk.
- `[INFERRED]` It may support a separate directionally restricted safety-exit method. That method remains distinct from new-risk signing and has its own audit event.

### 8.2 Mutual-TLS RPC

`[DECIDED]` Phase 0 uses direct HTTPS with mutual TLS on the private LAN.

`[INFERRED]` The RPC is a request and response boundary. It must:

- listen only on a private interface;
- require a pinned Mac server identity and a Pi client identity;
- use a firewall rule that limits access to the Pi;
- carry request ID, nonce, expiry, receipt IDs, canonical message bytes and hash, message version, address lookup tables with lifecycle metadata, resolved address list, expected signer slots, fee payer, execution target, key environment, blockhash metadata, capability, and transaction authorization receipt;
- reject any canonical message, message version, lookup-table address, owner, account type, state hash, context slot, lifecycle field, lookup index, resolved address, expected signer slot, signer key, fee payer, or receipt field that differs from the authorization receipt;
- reject duplicate or expired request IDs;
- reject a signing request when the current block height is within the bound expiry margin;
- return a signer audit result whose signed payload includes the Mac attestation key ID and binds request ID, decision receipt ID, transaction authorization receipt ID, approval result, canonical message hash, message version, address lookup tables and lifecycle metadata, resolved address list, expected signer slots, returned signatures, signer key IDs, and audit event;
- avoid arbitrary command execution, shell arguments, and file paths;
- record certificate identity, request result, approval result, and failure reason;
- stop accepting new-risk requests when the Mac clock or certificate state is invalid.

`[INFERRED]` Tailscale or NetBird may provide a private route later. The application still requires mutual TLS, request replay protection, and independent transaction checks.

### 8.3 Pi executor contract

`[INFERRED]` The Pi executor owns transaction work after the Mac RPC returns signatures. It must:
- enforce the phase-specific key environment and execution target before any signing, assembly, simulation, or send;
- enforce the message-format allowlist; reject `v0` unless P0E has enabled it, and reject `v1` or unknown formats;
- for `v0`, independently fetch each listed lookup-table account and its response context slot; verify the table address, configured Address Lookup Table Program owner, decodable lookup-table account type, state hash, and lookup indices;
- reject a table when `last_extended_slot` is not older than the execution context slot, or when a set `deactivation_slot` is no longer recent in `SlotHashes`; then recompute the complete ordered resolved address list, including static message accounts;
- fetch the recent blockhash and current block height from the approved RPC source;
- build the canonical message with the exact account and instruction set;
- simulate and revalidate with the same commitment and RPC source used for blockhash fetch and submission;
- verify the message version, lookup data, and every returned signature against the canonical message and its expected signer slot;
- assemble the final signed wire bytes and locally derive `signed_wire_bytes_hash` and `transaction_id`;
- persist the signed wire artifact, signature result, and execution receipt with the derived values before submission;
- write post-assembly audit records from the locally derived wire hash and transaction ID;
- recheck expiry, commit `submitting`, submit only the persisted wire bytes, and record the response or unknown state;
- reject any final-wire or derived-artifact mismatch and never accept final wire bytes or derived values from the Mac RPC.

### 8.4 Key classes

| Key | Location | Purpose | Must not do |
|---|---|---|---|
| Root wallet | Mac or hardware-backed operator device | Fund, delegate, revoke, recover | Enter Pi, Brain, Obsidian, or agent memory |
| Sandbox position authority | Mac signer, P0E-P0G | Sign approved Phoenix test actions against a non-live target | Sign live-cluster messages, access live collateral, delegate, revoke, or act as root |
| Sandbox fee payer | Mac signer, P0E-P0G | Pay Solana base and priority fees for a non-live target | Pay live fees, sign live messages, move collateral, delegate, revoke, or act as root |
| Live position authority | Mac signer, provisioned at P0H | Sign approved Phoenix position actions after the live gate | Withdraw, deposit, redelegate, or bypass capability |
| Live fee payer | Mac signer, provisioned at P0H | Pay Solana base and priority fees for approved live transactions | Sign Phoenix authority, move collateral, delegate, revoke, or act as root |
| Mac attestation key | Mac signer | Sign signer audit evidence that binds request and receipt IDs, approval result, canonical message hash, message version, address lookup tables and lifecycle metadata, resolved address list, expected signer slots, returned signatures, signer key IDs, and audit event | Sign or authorize Solana transactions, sign policy, or replace the position authority or fee payer |
| Falcon receipt key | Falcon-controlled receipt component | Sign decision and execution evidence | Sign Solana transactions |
| Brain key | Brain or local test provider | Sign advisory receipt or model release | Sign transactions or policies |
| mTLS keys | Pi and Mac RPC processes | Authenticate transport peers | Authorize financial semantics by themselves |
| Service wallet | Separate service account | Pay Brain or x402 services later | Pay margin or trading collateral |

### 8.5 Non-live signing boundary

`[INFERRED]` P0E through P0G may create and sign fresh wire transactions only with sandbox keys and a non-live target. `key_environment` is `sandbox`, and `execution_target` is an allowlisted non-live cluster or an unfunded account on a non-live target. The live Solana RPC endpoint and live authority keys are unavailable to these phases. A no-send rule is not the safety boundary; key and target separation is.

`[INFERRED]` `execution_target` is an allowlisted target ID, not a caller-supplied RPC URL. The Pi and Mac reject any phase, target, key environment, or signer-key mismatch.

`[INFERRED]` P0H provisions the live position authority and live fee payer, changes `key_environment` to `live`, and permits the live target only after P0E through P0G exit evidence and explicit founder approval.

## 9. Failure handling and recovery

### 9.1 Fail-closed conditions

`[INFERRED]` Falcon blocks new risk when:

- the intent or policy is invalid, expired, or outside capability;
- observations are stale, incomplete, conflicting, or gapped;
- canonical reconciliation has not completed;
- a Brain-required receipt is missing, invalid, stale, or unknown;
- the decision receipt is missing, expired, or hash-inconsistent;
- simulation differs from the receipt-bound canonical message or instruction and account set;
- message version is unsupported, the legacy-only allowlist is bypassed, or v0 lacks P0E proof and a written gate;
- a required address lookup table is missing, its owner or account type is wrong, its state hash, context slot, lookup indices, warmup metadata, or lifecycle state differs, or the resolved address list differs from authorization;
- the transaction authorization receipt is missing, expired, hash-inconsistent, or near expiry;
- the blockhash, last valid block height, commitment, RPC source, or context slot differs from the transaction authorization receipt;
- simulation, signing, or submission cannot prove the bound commitment, source, or expiry margin;
- fail closed when returned signatures fail verification, the canonical message, expected signer slots, or fee payer differ from authorization, or the derived signed wire bytes hash or transaction ID does not match the assembled final wire bytes;
- the execution target, key environment, or signer key class does not match the current phase;
- P0E through P0G can reach a live Solana RPC endpoint or live authority key;
- signer identity, certificate, capability, or manual approval is unavailable;
- SQLite lacks required state or cannot commit a transition;
- recovery cannot determine whether submission occurred;
- clock drift invalidates expiry or certificate checks.

`[VERIFIED]` The vision requires new risk to fail closed while safety actions remain available. Evidence: `VISION.md:356`, `VISION.md:367-379`.

### 9.2 Durable execution states

`[INFERRED]` Each execution has a state transition recorded in SQLite:

```text
created
verified
receipt_signed
approved
built
simulated
revalidated
transaction_authorized
sign_requested
signed_persisted
submitting
submitted
confirmation_unknown
confirmed
reconciled
blocked
expired
cancelled
```

Required transition rules:

- `[INFERRED]` `signed_persisted` must exist before `submitting`; `submitted` must follow `submitting`.
- `[INFERRED]` The Pi commits `submitting` before invoking a Solana send RPC.
- `[INFERRED]` `submitting` is a write-ahead state. It records that a send may occur after the commit. It does not attest that Solana received the bytes.
- `[INFERRED]` Only an execution with no durable `submitting` marker may take the direct expired-rebuild path.
- `[INFERRED]` `transaction_authorized` exists only after the canonical message hash, expected signer slots, fee payer, blockhash metadata, and expiry margin pass verification.
- `[INFERRED]` A near-expiry transaction becomes `expired` before signing or submission. Recovery never submits it and never reuses its wire bytes or signatures.
- `[INFERRED]` After entering `submitting` or receiving an unknown send result, the execution enters `confirmation_unknown`. Recovery must reconcile the chain signature, order state, account state, and position state before allowing a new execution.
- `[INFERRED]` `confirmation_unknown` cannot transition directly to a new build or retry.
- `[INFERRED]` Recovery must query the chain signature, order state, account state, and position state before deciding whether the action landed.
- `[INFERRED]` A stale lease cannot block recovery forever. Leases use an owner ID, epoch, expiry, and takeover record.
- `[INFERRED]` One intent and one execution ID cannot create two active risk actions for the same account and scope.

### 9.3 Fault drills

`[INFERRED]` The recovery suite injects failure:

1. before transaction build;
2. after build;
3. after simulation;
4. after Mac approval;
5. after signature persistence;
6. after submission;
7. before confirmation;
8. after confirmation but before reconciliation;
9. during Pi restart;
10. during Mac signer loss;
11. during SQLite lock or corruption;
12. during Vulcan, RPC, or network loss;
13. during certificate expiry or rotation;
14. during clock drift;
15. during stale-lock takeover;
16. during approval until the transaction reaches the expiry margin;
17. after signature persistence when the block height reaches or passes the expiry boundary;
18. after a send timeout followed by proven blockhash expiry;
19. after the durable `submitting` marker commits but before the Solana send RPC is invoked.

Every ambiguous case must reconcile before retry. The target is zero duplicate orders and complete evidence for each executed action.

### 9.4 Emergency exits

`[INFERRED]` The supervisor monitors position, account health, limits, data freshness, process health, and certificate state. It uses a safety path separate from new-risk jobs. The root owner retains a direct revoke and recovery path that does not require SQLite, Obsidian, Citadel, Brain, or Vulcan.

## 10. Phases and gates

`[DECIDED]` Phase 0 follows a safety-first sequence. Brain testing starts early with local or fixture inputs, but founder live actions wait for the safety gates.

| Phase | Work | Exit evidence |
|---|---|---|
| P0A Trust contract | Define typed records, receipt links, message-version and lookup-table lifecycle fields, canonical message and wire-byte fields, expected signer slots, fee payer, key classes, signer checks, capability scope, revocation, and execution states. | Golden vectors, legacy-only rejection cases, and lookup-table owner, type, warmup, cooldown, and mismatch cases pass. |
| P0B Brain preparation | Run fixture or local Brain outputs. Record model version, evidence, costs, bounds, and failure behavior. | Brain output stays advisory. No paid calls. |
| P0C Canonical state | Add Vulcan observation capture plus independent Phoenix and chain reads. | Freshness, gap, completeness, conflict, and account tests pass. |
| P0D Paper loop | Run risk interview, typed intent, policy, reconciled observations, verifier, signed decision receipt, and replay. | 100 evaluations or seven continuous days with reconciled snapshots, stable replay, zero policy violations. |
| P0E Rise and signer | Run the Rise delegation and transaction-corpus spike with sandbox position-authority and fee-payer keys against a non-live target. Prove that legacy messages are sufficient or prove that v0 is required. Activate the Mac signer RPC with mutual TLS, independent checks, message-format allowlist, lookup-table lifecycle validation and resolution when permitted, expected signer-slot checks, signature verification, Mac attestation, and manual approval. | Delegation, revocation, signer, message-version, lookup-table owner/type, context-slot, warmup, deactivation/cooldown, signer-slot, signature-verification, fee-payer, Mac-attestation, replay, capability, request-binding, and expiry tests pass without live keys or a live target. |
| P0F Dry run | Using the P0E sandbox signer and non-live target, build, fetch and bind recent blockhash metadata, apply the P0E message-format decision, resolve and validate any permitted lookup tables and their lifecycle state, serialize the canonical message, simulate, revalidate, assemble and persist final signed wire material, verify returned signatures against expected signer slots, derive the wire hash and transaction ID, enforce the expiry margin, and reject drift. All submission exercises use the non-live target. | End-to-end signer response, attestation, legacy-only or explicitly gated v0 behavior, exact message and lookup lifecycle resolution, signer-slot binding, fee payer, derived wire hash and transaction ID, blockhash metadata, near-expiry, proven-expiry rebuild without a send attempt, durable `submitting` marking, send-timeout recovery, account, program, instruction, and simulation tests pass without live authority. Any send or timeout behavior stays on the non-live target. |
| P0G Recovery and Pi | Using the P0E sandbox signer and P0F artifacts against the non-live target for all send and recovery drills, run on Pi with SSD. Exercise restart, Mac loss, approval and signature persistence, network loss, stale leases, SQLite recovery, certificate rotation, backup, restore, and safety exits. | End-to-end sandbox signed transactions and attestation evidence, zero duplicate orders in fault drills, and reconciliation of every ambiguous case. |
| P0H Founder approval-live | After P0E through P0G exit evidence and explicit founder approval, provision the live position authority and live fee payer. Use the tiny founder account, one isolated position, manual risk increases, and Brain-required new risk. | At least 10 fully reconciled live actions, zero severe incidents, complete evidence. |
| P0I Founder review | Review Brain outputs, actual outcomes, cost records, safety evidence, and operational friction. | Founder decides whether Brain is useful enough to continue. No preset value threshold. |
| P0J x402 decision | Build the fixed-price Brain endpoint only after P0I approval and all safety evidence remain valid. | Explicit founder approval, payment separation, idempotent payment, rate limits, and endpoint tests. |

`[INFERRED]` P0E is a prerequisite for P0F and P0G. P0F and P0G must use sandbox keys and a non-live target with the activated Mac signer RPC, returned signatures, Mac attestation, and lookup-table lifecycle results. P0E must leave the message allowlist at legacy-only unless its sandbox transaction corpus proves v0 is required and a separate written gate enables v0. No P0E through P0G step may provision or use live authority keys, a live target, or a live Solana RPC endpoint. Fixture-only signature tests do not satisfy either gate.

`[VERIFIED]` The vision sets paper, dry-run, approval-live, and promotion evidence requirements. Evidence: `VISION.md:387-401`.

`[INFERRED]` P0I is a founder judgment gate, not a statistical claim. It records evidence for a later decision. A paid hosted Brain evaluation remains untested while the budget is `$0`.

## 11. Verification plan

### 11.1 Contract and verifier tests

- `[INFERRED]` Test canonical serialization, canonical message hashes, message-version allowlist and v0 gate, v1 and unknown-format rejection, address lookup tables, owner and account-type validation, response context slot, table-state and lookup-index mismatch rejection, warmup and deactivation/cooldown rejection, independently resolved address lists, expected signer slots, fee payer, execution target, key environment, sandbox/live key separation, returned signature verification, final signed wire bytes and derived hashes, transaction ID derivation, receipt signatures, expiry, blockhash binding, last valid block height, commitment, RPC source, prior-record links, and replay vectors.
- `[INFERRED]` Test missing policy, invalid intent, stale state, stream gaps, source conflicts, margin limits, leverage limits, fee bounds, budget limits, capability violations, Brain receipt tampering, and transaction drift.
- `[INFERRED]` Test that removing each protection causes its specific negative case to fail. A test that still passes after removing the protection does not prove the protection.

### 11.2 Adapter tests

- `[INFERRED]` Store captured Vulcan outputs with binary version, checksum, command, source, slot, timestamp, and content hash.
- `[INFERRED]` Test independent Phoenix and chain reads against known fixtures.
- `[INFERRED]` Test stale, incomplete, conflicting, and gapped observations.
- `[INFERRED]` Test Vulcan process failure, malformed output, timeout, version mismatch, and changed command behavior.

### 11.3 Signer tests

- `[INFERRED]` Test mutual-TLS identity, certificate expiry, certificate rotation, request expiry, nonce reuse, request replay, receipt mismatch, unsupported message version, legacy-only rejection, v0 enablement gate, lookup-table owner mismatch, account-type mismatch, state mismatch, context-slot mismatch, lookup-index mismatch, same-slot warmup rejection, deactivation cooldown rejection, resolved-address-list mismatch, expected signer-slot mismatch, sandbox/live target mismatch, sandbox/live key mismatch, returned signature verification failure, Mac attestation signature verification, tampered audit payload, wrong attestation key, Mac attestation-key rotation, final wire-byte recomputation failure, wrong fee payer, blockhash mismatch, commitment mismatch, RPC-source mismatch, near expiry, proven expiry, wrong program, wrong account, wrong instruction, excess quantity, excess price limit, revoked capability, and missing manual approval.
- `[INFERRED]` Test that the signer never accepts an arbitrary shell command or raw transaction request.

### 11.4 Recovery and replay tests

- `[INFERRED]` Inject crashes at every execution state boundary.
- `[INFERRED]` Prove that a timeout does not trigger a blind retry.
- `[INFERRED]` Delay approval until the blockhash reaches the expiry margin and prove that the signer rejects the request.
- `[INFERRED]` Reconcile signatures and account state before rebuilding.
- `[INFERRED]` Prove that an expired transaction cannot be submitted. Allow direct rebuild only when durable state has no `submitting` marker; after entering `submitting`, a send attempt, or an unknown result, enter `confirmation_unknown`, reconcile the chain signature, order, account, and position, and only then decide whether a new execution is allowed.
- `[INFERRED]` Export a replay bundle containing raw observations, canonical snapshot, policy, intent, Brain receipt when present, decision receipt, transaction authorization receipt, canonical message bytes and hash, message version, address lookup tables, resolved address list, expected signer slots, fee payer, execution target, key environment, returned signatures, Mac attestation key ID, `mac_attestation_signature`, final signed wire bytes and derived hash, transaction ID, blockhash metadata, confirmations, reconciliation, outcome events, and source hashes.
- `[INFERRED]` Verify that changed or missing source artifacts make replay report an explicit failure.

### 11.5 Pi smoke test

`[INFERRED]` The first device run records:

```text
uname -m
64-bit userland
Vulcan version
Vulcan checksum
market read
account read
blockhash fetch, context slot, last valid block height, commitment, RPC source, and expiry detection
message-format allowlist, lookup-table state and index checks, and independently resolved address list
ALT owner/type, context slot, warmup, and deactivation/cooldown checks
live key and live Solana RPC endpoint access denied
execution target and key environment
SQLite create, write, restart, and restore
supervisor heartbeat
network loss and reconnect
mTLS certificate rotation
SSD backup and restore
```

This smoke test proves device compatibility only. It does not authorize live capital.

### 11.6 Brain founder test

- `[DECIDED]` Use fixtures or local inference before any paid service.
- `[DECIDED]` Use Brain-required mode for each new-risk founder live action after P0G.
- `[INFERRED]` Record the same intent, policy, canonical snapshot, Brain output, decision receipt, transaction authorization receipt, canonical message and hash, message version, address lookup tables, resolved address list, expected signer slots, fee payer, execution target, key environment, returned signatures, final signed wire transaction, derived wire hash, transaction ID, blockhash metadata, costs, and outcome for every test.
- `[DECIDED]` The founder decides whether Brain is useful. The system does not invent a value threshold.
- `[INFERRED]` Record actual fees, funding, slippage, health, PnL, Brain cost, and operational friction so the founder can review evidence later.
- `[DECIDED]` x402 remains disabled during this test.

## 12. Cost controls

- `[DECIDED]` Obsidian Sync spend: `$0` initially.
- `[DECIDED]` Paid Brain spend: `$0` initially.
- `[DECIDED]` Citadel hosting and model spend: `$0` initially.
- `[DECIDED]` x402 spend and revenue: disabled until the founder review gate passes.
- `[VERIFIED]` The vision separates trading collateral, service-payment money, and company treasury. Evidence: `VISION.md:367-376`, `VISION.md:789-809`.
- `[INFERRED]` Any later Brain or x402 payment uses a capped service wallet. It cannot use the Phoenix margin account.
- `[INFERRED]` Local checks remain free of Brain calls when Brain is not required for the current mode.
- `[INFERRED]` The system records RPC, model, service, and infrastructure costs even when they are zero or supplied locally.

## 13. External-live boundary

- `[VERIFIED]` The vision blocks public portfolio-specific recommendations and autonomous cloud execution for EU users until product-specific counsel and German or EU classification establish a permitted path. Evidence: `VISION.md:764-778`.
- `[DECIDED]` Phase 0 is founder-only. It does not launch public execution or accept customer funds.
- `[INFERRED]` x402 exposure to other users requires a separate review of disclosure, eligibility, geography, custody, delegated control, privacy, incident response, and legal route.

## 14. Open decisions with concrete resolution tests

These are intentionally outside the locked Phase 0 design. Each has a required resolution test.

1. `[INFERRED]` **Node runtime and SQLite driver:** select a maintained ARM64-compatible runtime and driver after the Pi smoke test. Resolution evidence: exact version, install command, restart test, and backup restore output.
2. `[INFERRED]` **Receipt and Mac attestation key storage:** choose the receipt-key and Mac-attestation-key locations and rotation process after signer threat review. Resolution evidence: key IDs, rotation records, public-key pin updates, and replay verification.
3. `[INFERRED]` **mTLS bootstrap:** define certificate issuance, trust-store installation, revocation, and rotation. Resolution evidence: fresh install, expired certificate, revoked certificate, and rotated certificate tests.
4. `[INFERRED]` **Canonical Phoenix read set:** identify the independent account and chain reads needed beyond Vulcan. Resolution evidence: captured source set, gap test, conflict test, and deterministic reconciliation result.
5. `[INFERRED]` **Rise contract:** resolve the exact position-authority and transaction restrictions. Resolution evidence: delegation corpus, revoke path, transaction corpus, and signer rejection tests.
6. `[INFERRED]` **Brain representation:** determine whether local inference or a hosted read-only Brain best represents the product before any paid test. Resolution evidence: model version, input capture, output signature, latency, and founder review.
7. `[INFERRED]` **Remote overlay:** add Tailscale or NetBird only if remote operation is needed. Resolution evidence: private route, mTLS still enforced, failure recovery, and no public signer exposure.
8. `[INFERRED]` **Blockhash source and expiry margin:** select the approved RPC source, commitment, and minimum remaining block-height margin. Resolution evidence: captured blockhash response, context slot, current block-height checks, matching simulation and submission settings, near-expiry rejection, and proven-expiry rebuild.
9. `[INFERRED]` **Fee-payer compatibility:** verify the separate restricted fee payer in the Rise transaction corpus. Resolution evidence: fee payer at message index zero, expected signer slots, signatures in expected slot order, position-authority signature, fee-only key restrictions, derived final wire hash and transaction ID, and rejection tests.
10. `[INFERRED]` **Sandbox execution target:** select an allowlisted non-live cluster or an unfunded account on a non-live target with the required Rise and Phoenix test deployment. Resolution evidence: target ID, sandbox key IDs, absence of live key access, live Solana endpoint denial, signed-transaction drills, and reconciliation results.
11. `[INFERRED]` **Message format and lookup tables:** keep `legacy` only unless P0E proves that v0 is required. Resolution evidence: message-version corpus, v0 requirement proof when applicable, each lookup-table address, owner, account type, table-state hash, response context slot, `last_extended_slot`, `last_extended_slot_start_index`, `deactivation_slot`, writable and readonly indices, independently resolved address list, table-mismatch rejection, warmup rejection, deactivation/cooldown rejection, and v1 or unknown-format rejection.

## 15. Least confident decisions

1. `[INFERRED]` A TypeScript control plane with a Vulcan subprocess will remain simple enough while the canonical state and signer checks grow. The Pi smoke test and first fault drills may expose a need for a smaller Rust boundary.
2. `[INFERRED]` Direct mutual TLS on the private LAN may be enough for the founder's two-host workflow. Remote use may require WireGuard, Tailscale, or NetBird, but adding that now would expand the failure surface.
3. `[INFERRED]` The Mac signer can independently validate Phoenix transaction semantics with the selected Rise and Vulcan data. The Rise spike must test this before live contract freeze.
4. `[INFERRED]` SQLite on an SSD can support the local queue and evidence volume. The crash drills and restore test must prove this on the physical Pi.
5. `[INFERRED]` Local or fixture Brain testing can give the founder enough evidence to judge usefulness before any paid hosted evaluation. Paid economic value remains not determined.
6. `[INFERRED]` Obsidian will remain sufficient as a human advisory surface without Sync. A cross-device workflow may later justify the subscription, but it is not required for Phase 0.
7. `[INFERRED]` The selected blockhash source and expiry margin will give the founder enough time for Mac approval without making transactions stale. Approval latency and RPC lag may require a different commitment, source, or margin after measurement.
8. `[INFERRED]` The separate fee-payer key will satisfy Phoenix and Rise transaction requirements without weakening authority separation. The P0E transaction corpus must prove this before live action.
9. `[INFERRED]` Sandbox keys and a non-live target will let P0E through P0G exercise real signatures and recovery without exposing live capital. The exit evidence must prove that live keys, live Solana endpoints, and live target IDs were unavailable.
10. `[INFERRED]` Legacy-only messages will cover the Phase 0 transaction corpus. If P0E proves v0 is required, independent lookup-table resolution and lifecycle validation must preserve signer and program binding.

## 16. Review status

- `[VERIFIED]` The founder approved the architecture, safety, checkpoint, verification, memory, Pi role, signer host, signer transport, persistence, Brain timing, and zero-budget choices in this session.
- `[INFERRED]` This document is ready for written review. Implementation planning starts only after the founder reviews this file and requests the next step.
