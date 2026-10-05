# Meteora Skill and SendAI Skills Catalog Research

Source 1: https://github.com/sendaifun/skills/tree/72ef2aa814cca4662341bfcdc01cdc288e9bb502/skills/meteora
Source 2: https://github.com/sendaifun/skills/tree/72ef2aa814cca4662341bfcdc01cdc288e9bb502
Date fetched: 2026-09-17
Author: SendAI, distilled report by OpenAI Codex
Provenance: REPORTED. Distilled from the source; claims are the author's, not independently verified.

## TLDR

The pinned SendAI repository presents Meteora as a Solana liquidity stack, not a single AMM. It covers DLMM concentrated liquidity, DAMM v2 and legacy DAMM v1, Dynamic Bonding Curves, Dynamic Vaults, Alpha Vault launch protection, M3M3 fee staking, Zap single-token entry and exit, and farms. The source pairs SDK instructions with API references, examples, templates, fee and strategy guides, migration steps, and troubleshooting. The recurring operating model is: select the protocol for the market job, read current pool state, quote with explicit slippage, build and confirm a transaction, refresh state, and handle protocol-specific locks, fees, and failure states.

## Source scope and repository catalog

The two URLs identify one GitHub repository at commit `72ef2aa814cca4662341bfcdc01cdc288e9bb502`; the Meteora tree is the topic slice of that repository. The repository root contains `.claude-plugin`, `.gitignore`, `CONTRIBUTING.md`, `IDEAS.md`, `LICENSE`, `README.md`, `skills`, `spec`, and `template`.

The root README describes installation through Claude Code, Cursor, or `npx skills add sendaifun/skills`. It groups skills into DeFi, Infrastructure, Trading, Oracles, Data and Analytics, Cross-Chain, NFT and Tokens, Client Development, Program Development, AI Agents, Security, and DevOps. The marketplace file lists 40 plugins in 15 categories. Meteora is the `DeFi` plugin at `./skills/meteora`, described as the Meteora SDK for DLMM, DAMM pools, Dynamic Bonding Curves, Alpha Vaults, and token launches.

The repository contribution model is itself a useful rule: each skill needs frontmatter with a lowercase hyphenated name and a description that names the protocol, actions, and technologies used for automatic discovery. A skill may split deep material among `docs/`, static lookup data among `resources/`, runnable use cases among `examples/`, and copyable boilerplate among `templates/`. Contributors are told to test prompts, cover edge cases, include security guidance, account for devnet and mainnet, and add the marketplace entry in alphabetical order.

## Major concepts and rules

### 1. Choose the Meteora product by market job

**Core rule:** Select the narrowest Meteora protocol that matches the liquidity, launch, yield, or staking job before writing transaction code.

**Why:** DLMM, DAMM v2, DAMM v1, DBC, vaults, Alpha Vault, M3M3, Zap, and farms have different state models and transaction methods. DAMM v2 is the recommended choice for new constant product pools, while DAMM v1 remains supported for existing, stable, weighted, and LST integrations.

**Do:**
- Use DLMM for bin-based concentrated liquidity and volatility-sensitive fees.
- Use DAMM v2 for constant product pools, position NFTs, Token-2022, locking, vesting, and custom fees.
- Use DBC for a token launch that can graduate into a DAMM pool.
- Use Dynamic Vault for strategy-managed deposits and share accounting.
- Use Alpha Vault for launch deposits with time windows, caps, whitelist modes, and pro-rata or FCFS allocation.
- Use M3M3 for stake balances that earn trading fees and have an unstake lock.
- Use Zap when a user should enter or exit a position with one token, and provide a Jupiter API key.
- Use Pool Farms for DAMM v1 LP token deposits and reward claims.

**Do not:** Start a new pool on DAMM v1 merely because its API is familiar, or treat a DBC pool, a vault, and a liquidity position as interchangeable accounts.

**Workflow:** Identify the product, install its package and dependencies, load its program address, initialize its client against the intended cluster, then follow that product's quote, transaction, confirmation, and refresh sequence.

### 2. Keep protocol addresses, network, and numeric types explicit

**Core rule:** Configure network endpoints, program addresses, token mints, decimals, and integer amounts explicitly at the boundary of the application.

**Why:** The source uses Solana `Connection`, `PublicKey`, Anchor `BN`, and SPL token utilities throughout. Amounts are integer base units, while prices, fees, and shares often require decimal conversion helpers. The address reference lists the mainnet and devnet RPC endpoints and the Meteora program IDs, which are shown as the same IDs for the listed programs.

**Do:**
- Use a dedicated RPC provider when public RPC rate limits are likely.
- Use `BN` or the SDK's required integer type for token amounts, fee numerators, bin IDs, and durations.
- Set TypeScript to ES2020 with strict checking, and add browser `Buffer` and `process` polyfills when required.
- Keep devnet and mainnet configuration separate, including RPC URLs and test assets.
- Check SOL and token balances before sending.

**Do not:** Pass UI decimal amounts directly into transaction parameters, hardcode a secret key in source, or assume a pool address is valid without checking its token pair and cluster.

**Workflow:** Read configuration from environment or a controlled config object, construct `Connection`, load a signer, parse public keys, convert UI values to base units, and only then call SDK methods.

### 3. DLMM requires active-bin and range-aware liquidity

**Core rule:** Read the active bin and choose a strategy and bin range before quoting a DLMM swap or depositing liquidity.

**Why:** DLMM distributes liquidity across bins, and its dynamic fee responds to volatility. The SDK exposes active-bin reads, price and bin conversions, surrounding-bin queries, strategy types, swap quotes, position discovery, fee claims, and reward claims.

**Do:**
- Call `getActiveBin()` and use its bin ID and price as the current reference.
- Fetch bin arrays for the swap direction before calling `swapQuote`.
- Submit the quote's minimum output, fee, and price impact values to the transaction and UI.
- Choose SpotBalanced for simple symmetric liquidity, CurveBalanced for more concentration, BidAskBalanced for active market making, and one-sided variants for directional or range-order positions.
- Rebalance when the active bin approaches a position edge, and claim fees and rewards on a defined cadence.
- Close a position when removing all liquidity if the user no longer needs the account.

**Do not:** Guess a bin range, use a stale active bin for a sensitive trade, or claim fees without verifying which positions belong to the wallet.

**Workflow:** Create the DLMM instance, read active state, calculate or fetch bins, obtain a quote, send with `minOutAmount`, confirm, refresh state, then manage positions and claims.

### 4. DAMM v2 uses position NFTs, quotes, and explicit lock state

**Core rule:** Treat a DAMM v2 position as a separate stateful position account, and quote every deposit, withdrawal, and swap before building its transaction.

**Why:** DAMM v2 replaces the older LP token model with transferable position NFTs and adds fee scheduling, Token-2022 support, permissionless farms, and vesting or permanent locks. The SDK exposes `CpAmm`, pool state, position state, exact-in, exact-out and partial-fill swap modes, quote helpers, position splitting and merging, rewards, and lock checks.

**Do:**
- Fetch pool state and verify the token pair before creating a position.
- Use `getQuote`, `getDepositQuote`, and `getWithdrawQuote` to derive bounds.
- Pass the quote minimum output or minimum liquidity to the transaction.
- Call `build()` on transaction builders where the API returns a builder.
- Check `isLockedPosition` and refresh vesting before trying to withdraw unlocked liquidity.
- Use fee scheduler modes when a new pool needs an initial anti-snipe fee schedule.
- Treat `permanentLockPosition` as irreversible and obtain the required user approval before sending it.

**Do not:** Assume a position can be withdrawn because its owner holds the NFT, use zero minimums in production without a deliberate risk decision, or confuse a v2 position with a v1 LP token balance.

**Workflow:** Initialize `CpAmm`, fetch pool state, create or fetch a position, obtain a quote, build and sign the transaction, confirm it, then fetch pool and position state again.

### 5. DBC launches have a state transition into DAMM

**Core rule:** Model a Dynamic Bonding Curve launch as configuration, creation, trading, graduation, migration, and post-migration trading.

**Why:** Graduation is gated by a market-cap threshold and a pool can be migrated only once. DAMM v2 migration is presented as the recommended simpler path, while DAMM v1 migration needs metadata creation and separate migration steps.

**Do:**
- Configure base and quote mints, supply, metadata URI, and the partner configuration before creating the pool.
- Quote buys and sells immediately before sending and include minimum amounts.
- Read `graduated`, current market cap, and graduation threshold before migration.
- Prefer `migrateToDAMMV2` for a new migration unless a v1 integration is required.
- For v1, create metadata, migrate, and optionally lock LP tokens as separate confirmed operations.
- Find the new pool address after migration and switch to the DAMM SDK.
- Use the manual migrator when a graduated pool was not migrated or needs recovery.

**Do not:** Try to migrate before graduation, call the old SDK after migration, or assume the pool address stays unchanged.

**Workflow:** Create and monitor the curve, buy or sell with fresh quotes, calculate progress toward the threshold, migrate once, confirm the new DAMM pool, update SDK references, and test trading again.

### 6. Launch protection, vault shares, staking, and farms have different withdrawal rules

**Core rule:** Read each product's time window, share state, allocation state, or lock state before accepting deposits or promising withdrawals.

**Why:** Alpha Vault deposits can be limited by start and end windows, caps, whitelist modes, and claim timing. Vault withdrawals depend on unlocked funds and share supply. M3M3 unstaking starts a lock period, and farms have active and ended states.

**Do:**
- For Alpha Vault, display deposit window, maximum deposit, allocation, claim status, and whether withdrawal is still allowed.
- For vaults, refresh LP supply and withdrawable amounts, then use `getAmountByShare` and `getUnmintAmount` for conversions.
- For M3M3, show staked amount, claimable fees, unstake period, pending escrow, and withdrawal eligibility.
- For farms, check pending rewards and farm state before deposit, withdrawal, or claim.
- Keep affiliate IDs and fee balances visible when the integration uses referrals.

**Do not:** Promise a vault's locked amount as immediately withdrawable, allow a claim before the launch phase permits it, or skip the M3M3 unstake and escrow steps.

**Workflow:** Fetch state, validate the current phase and user eligibility, calculate the resulting shares or allocation, submit the operation, confirm it, and refresh user and protocol state.

### 7. Fees must be quoted, displayed, and matched to the product

**Core rule:** Compute total fees and their distribution from the active protocol configuration instead of treating one fee percentage as universal.

**Why:** DLMM combines base and variable fees, with a protocol share. DAMM v2 supports base fee schedulers plus protocol, partner, and referral percentages. DBC has six listed trading and migration fee tiers, while vaults, M3M3, and affiliates use their own fee models.

**Do:**
- For DLMM, read base, maximum, protocol, and current dynamic fee information.
- For DAMM v2, convert basis points and fee numerators with SDK helpers and account for protocol, partner, and referral shares.
- Select DBC fee tiers based on launch risk, and include migration cost in launch economics.
- Show traders price impact and fees before signing.
- Let LPs compare expected fees with range width and rebalancing cost.

**Do not:** Add a fee percentage to an integer amount without checking the denominator, hide protocol or partner deductions, or compare fee rates across protocols without matching their bases.

**Workflow:** Fetch configuration, calculate fee and net amount in base units, show the result, pass SDK-derived minimums and parameters, then record the confirmed transaction.

### 8. Liquidity strategy must balance range, fee capture, and impermanent loss

**Core rule:** Choose range width and strategy from expected volatility and management capacity, not from fee yield alone.

**Why:** Narrow ranges can raise capital efficiency and fee capture but increase impermanent loss and rebalancing needs. The strategy guide maps wide ranges to volatile assets, narrow ranges to stable assets, and one-sided positions to directional views.

**Do:**
- Use the source's starting ranges as estimates: 5 to 10 bins for stablecoins, 10 to 20 for major assets, 20 to 40 for mid-cap assets, and 40 to 100 for small-cap assets.
- Calculate expected range from volatility and bin step, then verify it against current pool state.
- Trigger rebalancing when the active bin nears a defined edge margin.
- Compare fee income with the dollar value of impermanent loss before compounding.
- Keep wide, low-maintenance positions for volatile markets and tighter positions for markets that can be watched.

**Do not:** Treat the example ranges as guarantees, automate rebalancing without a threshold and confirmation policy, or call a position profitable because fees are positive while total value is falling.

**Workflow:** Estimate volatility, select strategy and range, open the position, monitor active bin and fees, rebalance at a declared threshold, and compound only after accounting for balances and costs.

### 9. Transaction reliability needs fresh state and classified errors

**Core rule:** Refresh state close to execution, use bounded retries for transient failures, and turn known errors into user actions.

**Why:** The guides identify RPC rate limits, timeouts, WebSocket loss, stale quotes, expired blockhashes, missing accounts, insufficient funds, invalid ranges, and lock states. Retrying every error can repeat a bad transaction, so the error type must determine the response.

**Do:**
- Use a dedicated RPC or backoff for 429 responses and transient connection failures.
- Get a fresh blockhash immediately before sending long-running transactions.
- Requote immediately before swaps and use explicit slippage bounds.
- Check account existence, balances, pool existence, token order, and bin liquidity before building.
- Check signature status and distinguish pending, failed, and finalized states.
- Retry only bounded transient operations with increasing delay.
- Map errors such as `SlippageExceeded`, `InsufficientFunds`, `PoolNotGraduated`, `PositionLocked`, and `InvalidBinRange` to clear next steps.

**Do not:** Blindly increase slippage, retry a permanent account or lock error, suppress a failed signature, or use `skipPreflight` as the default fix for correctness problems.

**Workflow:** Validate prerequisites, fetch fresh state and quote, build, sign, send, confirm or poll status, classify failure, and either retry safely or report the required user action.

### 10. Zaps simplify user input but add Jupiter dependencies

**Core rule:** Treat a Zap operation as a composed swap and liquidity action with its own API key, route, slippage, and token-program checks.

**Why:** Zap can enter or exit DLMM and DAMM v2 positions from one token, and can route an exit through Jupiter. The reference states that Jupiter requires an API key as of January 2026.

**Do:**
- Configure the Jupiter URL and key outside source control.
- Quote the route, set slippage, identify the target position or pool, and verify the input and output mints.
- Use the helper to resolve the token program for a mint.
- Show the user the composed route and expected output before signing.

**Do not:** Ship a placeholder key, assume every mint uses the same token program, or hide the swap leg's fee and slippage inside a single "deposit" label.

**Workflow:** Initialize `Zap`, obtain a Jupiter quote if needed, validate mint and position state, create the Zap transaction, confirm it, and refresh the position.

### 11. CLI, examples, and templates are starting points, not deployed applications

**Core rule:** Adapt the source examples and templates to the target cluster, signer, state model, and safety policy before use.

**Why:** Examples use placeholder addresses and often mainnet public RPC URLs. Templates organize recurring loops for trading bots, token launches, and liquidity managers, but they still require secrets, limits, monitoring, and product-specific validation.

**Do:**
- Use the examples to learn call ordering for swaps, positions, graduation, vaults, Alpha Vault, M3M3, and zaps.
- Use templates for structure: initialization, state update, snapshot, fee collection, rebalance, launch progress, migration, shutdown, and signal handling.
- Use Meteora Invent, named in the source as Metsumi, for CLI flows such as pool creation, liquidity seeding, swaps, migration, and vault creation.
- Add environment validation, transaction limits, logging, and graceful shutdown before running automation.

**Do not:** Run a template with `YOUR_*` addresses or a hardcoded secret, treat `mainnet-beta` examples as test instructions, or assume a helper loop handles all authorization and risk checks.

**Workflow:** Copy one narrow example, replace configuration, exercise it on devnet, inspect confirmed state, add production controls, then move to mainnet.

## Workflows

### New DLMM liquidity position

1. Configure RPC, wallet, pool address, token decimals, and integer amounts.
2. Create the DLMM instance and fetch the active bin.
3. Select a strategy and range from expected volatility.
4. Build and confirm `initializePositionAndAddLiquidityByStrategy`.
5. Poll or fetch the position, collect fees and rewards, and rebalance only at the declared threshold.

### Token launch through graduation

1. Select a DBC configuration and fee tier.
2. Create the token and curve pool with metadata.
3. Quote and execute buys or sells with minimum amounts.
4. Monitor market cap and graduation status.
5. Migrate to DAMM v2 after graduation, or perform the documented v1 metadata and migration sequence.
6. Find the new pool, switch SDKs, test trading, and lock liquidity if the launch policy calls for it.

### Safe swap

1. Verify the pool exists, token order is correct, balances are sufficient, and bins or pool state have liquidity.
2. Fetch a fresh quote with an explicit slippage setting.
3. Display input, output, minimum output, price impact, and fee.
4. Build, sign, send, and confirm the transaction.
5. Report the signature or classify the failure without silently retrying a permanent error.

### Migration of a DLMM position to DAMM v2

1. Fetch positions owned by the wallet and identify the target position.
2. Remove all DLMM liquidity, claim or close as intended, and confirm.
3. Fetch the destination DAMM pool state.
4. Create a DAMM v2 position and build the add-liquidity transaction from a quote.
5. Confirm, refresh, and record the new position address and lock state.

## Rules to adopt

1. Choose the Meteora protocol from the market job before choosing an SDK method.
2. Keep cluster, RPC, program IDs, mints, decimals, and integer amounts in explicit configuration.
3. Use a dedicated RPC or bounded retry policy when public RPC limits are likely.
4. Read pool state before building any swap, deposit, withdrawal, or migration.
5. Quote immediately before execution and pass the quote's minimum or maximum bounds.
6. Display fee, price impact, slippage, and expected output before signing.
7. Treat DLMM active bins as live state, not as fixed prices.
8. Choose DLMM strategy and range from volatility and management capacity.
9. Check position ownership before claiming, removing, or closing DLMM liquidity.
10. Treat DAMM v2 positions as separate stateful position accounts, not as v1 LP balances.
11. Check DAMM v2 lock and vesting state before promising withdrawal.
12. Treat permanent liquidity locks as irreversible and require explicit approval at the point of signing.
13. Model DBC as a lifecycle that ends in a different DAMM pool and SDK.
14. Refuse DBC migration until the pool is graduated and has not already migrated.
15. Recheck the new pool address after every DBC migration.
16. Validate Alpha Vault windows, caps, whitelist requirements, allocation, and claim phase.
17. Convert vault shares with the vault helpers and report locked versus unlocked amounts.
18. Show M3M3 unstake escrow and lock duration instead of presenting unstake as an immediate withdrawal.
19. Configure and protect the Jupiter API key for every Zap integration.
20. Verify token programs and mint compatibility in composed Zap operations.
21. Separate transient connection retries from permanent protocol errors.
22. Refresh blockhashes close to send time and poll signature status when confirmation is delayed.
23. Use devnet to exercise examples and templates before mainnet execution.
24. Treat source templates and placeholder addresses as scaffolding that needs product-specific controls.
25. Keep protocol-specific fee, lock, migration, and failure rules visible in the user flow.

## Sources read

All substantive files under `skills/meteora/` at the pinned commit were fetched and read:

- `SKILL.md`.
- `docs/fee-structures.md`, `docs/migration-guide.md`, `docs/strategy-guide.md`, `docs/troubleshooting.md`.
- Examples: `examples/alpha-vault/participation.ts`; `examples/bonding-curve/create-token.ts`, `graduation.ts`, `trade.ts`; `examples/damm-v1/basic-operations.ts`; `examples/damm-v2/create-pool.ts`, `manage-position.ts`, `swap.ts`; `examples/dlmm/add-liquidity.ts`, `claim-fees.ts`, `swap.ts`; `examples/stake-for-fee/staking.ts`; `examples/vault/deposit-withdraw.ts`; `examples/zap/zap-operations.ts`.
- Resources: `alpha-vault-reference.md`, `bonding-curve-reference.md`, `damm-v1-api-reference.md`, `damm-v2-api-reference.md`, `dlmm-api-reference.md`, `github-repos.md`, `m3m3-api-reference.md`, `pool-farms-reference.md`, `program-addresses.md`, `vault-api-reference.md`, `zap-api-reference.md`.
- Templates: `templates/liquidity-manager.ts`, `templates/token-launch.ts`, `templates/trading-bot.ts`.

For the broader catalog, I also read root `README.md`, `CONTRIBUTING.md`, `IDEAS.md`, `.claude-plugin/marketplace.json`, `spec/SPECIFICATION.md`, and `template/SKILL.md`. The full recursive tree was enumerated to identify these files and the Meteora files.

## Not fetched

The directory marker entries in the Git tree were not fetched as files because they have no file content. Root `.gitignore` and `LICENSE` were enumerated but not read because they do not add catalog or Meteora guidance. External links named by the sources were not fetched, including `https://docs.meteora.ag`, `https://app.meteora.ag`, `https://migrator.meteora.ag`, Meteora Discord, Jupiter Portal, the linked Meteora SDK and program repositories, `agentskills.io`, and Anthropic's skills repository. No claim from those external links is treated as independently verified here.
