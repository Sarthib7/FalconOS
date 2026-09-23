# Stocklana Submission: Falcon Investment Council (FalconOS)

## Claim labels

- **VERIFIED**: confirmed from the cited official event page or the current repository source.
- **REPORTED**: observed or supplied by project research but not independently reproduced in this document.
- **INFERRED**: reasoned from verified facts. This is not a measured result.

## Project

**Falcon Investment Council (FalconOS)**

## Project link

[VERIFIED, local git configuration, 2026-09-23] `git remote get-url origin` returned `https://github.com/Sarthib7/FalconOS.git`. Candidate link: [FalconOS on GitHub](https://github.com/Sarthib7/FalconOS). Public access and the current working-tree changes were not checked on GitHub. Use this as the submission link only after confirming public access and publishing the reviewed source.

## Pitch

Falcon Investment Council is a tokenized-equity research copilot for Solana. Its Rust engine compares token price and liquidity captures with underlying reference captures. It emits content-addressed `PUBLISHED`, `BLOCKED`, or `NO_DATA` advice. The offline demo uses fixed synthetic evidence. The knowledge graph links assets, sources, evidence, intent, and verdicts. **[VERIFIED, repository source and offline command output]**

The browser copilot can request Jupiter market data and route transactions to a local Surfpool mainnet fork. This session did not run a successful Jupiter-to-Surfpool swap simulation or transaction. **[VERIFIED, source review and verification scope on 2026-09-23]**

## Targeted tracks

### Main Track: Trading + Infrastructure / analytics

Stocklana lists a **$100,000 Main Track**. Its build areas include **Trading** and **Infrastructure**, with analytics under Infrastructure. **[VERIFIED, official Stocklana page]**

Falcon Investment Council targets the analytics area with deterministic price comparison, risk verdicts, and an evidence graph. **[INFERRED, project fit]** This session did not establish a successful Surfpool swap. **[VERIFIED, current verification scope]**

### Best Use of PreStocks

The PreStocks bounty totals **$10,000** for projects using PreStocks tokenized pre-IPO stocks, split across three winners ($5,000 / $3,000 / $2,000). The rules state that a project integrating any non-PreStocks pre-IPO token is ineligible. **[VERIFIED: official Stocklana page]**

FalconOS complies by limiting its pre-IPO integration to the configured PreStocks OPENAI and SPACEX mints. It does not mix another issuer's pre-IPO tokens into the submission path. **[VERIFIED: repository source: `engine/src/serve.rs` and `web/copilot/index.html`]**

### Pyth track not claimed

The selected submission targets Main and Best Use of PreStocks. The offline demo uses synthetic PreStocks issuer marks. The source supports optional Pyth feeds through environment variables, but the default demo does not use Pyth and does not claim the Pyth bounty. **[VERIFIED, `engine/src/demo.rs`, `engine/src/serve.rs`, and the offline command output]**

## What judges see

The official rubric asks whether this could be a real app people will use. It evaluates a real user and problem, a working end-to-end demo, a reason the product belongs on Solana, and execution quality. **[VERIFIED: official Stocklana page]**

### 1. A real problem

Token-2022 scaled-UI multipliers can make a raw-unit comparison materially wrong. The live engine normalizes the raw DEX unit before it compares prices. **[VERIFIED, repository source: `engine/src/prestocks.rs`]**

The live engine is configured for the PreStocks OPENAI and SPACEX mints. The offline demo uses synthetic prices for those two assets. **[VERIFIED, `engine/src/serve.rs`, `engine/src/demo.rs`, and the offline command output]**

### 2. A working end-to-end demo

Run `npm run dash -- demo` from the repository root for a repeatable council run. Do not set `CARGO_NET_OFFLINE=true` before Cargo has cached its dependencies. A local empty-cache check failed with `error: no matching package named serde found`. **[VERIFIED, empty `CARGO_HOME`, 2026-09-23]** The demo passes fixed synthetic captures through the snapshot builder, council evaluator, terminal renderer, and graph builder. Its output says `No market or RPC requests, wallet access, signing, or transactions.` It prints `advice=PUBLISHED`, `advice=BLOCKED`, and `advice=NO_DATA`. **[VERIFIED, source `engine/src/demo.rs`; earlier local command `CARGO_NET_OFFLINE=true npm run dash -- demo`]** This command does not test live feeds, wallet access, or transaction execution. **[VERIFIED, source and command scope]**

The live engine separately gathers issuer, Solana RPC, DEX, and optional Pyth evidence. It serves `/advice` and `/graph` locally. The browser copilot displays council evidence beside a client-owned trade ticket and can request a Jupiter quote and unsigned transaction. Those live paths require provider access and were not checked by the offline demo. **[VERIFIED, repository source and offline command scope]**

A `BLOCKED` verdict remains visible beside the ticket as a council warning. FalconOS never signs automatically and never holds a server-side key. Because the council is advisory, the wallet owner retains the final decision. **[VERIFIED: repository source: `web/copilot/index.html`]**

### 3. Why Solana

The live engine reads Token-2022 `scaledUiAmountConfig`, checks the effective multiplier against `getTokenSupply`, normalizes raw DEX units, and evaluates the configured PreStocks mints. The browser route builder uses Jupiter. **[VERIFIED, repository source]**

### 4. Execution quality

- Exact integer/fixed-point arithmetic is used for prices and basis-point comparisons; no floating-point value decides a verdict. **[VERIFIED: repository source]**
- Missing, malformed, stale, conflicting, or uncorroborated data becomes `NO_DATA`. Refusal is a product feature: the council will not manufacture confidence from incomplete evidence. **[VERIFIED: repository source]**
- Token-2022 scaled-UI normalization accounts for effective-time changes and checks extension-derived multipliers against supply-derived values before admitting a price. **[VERIFIED: repository source]**
- Snapshot ingress re-derives readiness from raw captures, so a forged READY status or tampered conflicts list is rejected even when its hash is self-consistent. **[VERIFIED: repository source: `engine/src/domain.rs` and `engine/src/council.rs`]**
- Advice and graph responses are local, deterministic products of the same evaluation. **[VERIFIED: repository source]**

## Seven-step demo script

Run the synthetic council demo first:

```sh
npm run dash -- demo
```

It prints fixed synthetic evidence and one result for each council status. The hashes remain stable across runs. After Cargo caches its dependencies, you can set `CARGO_NET_OFFLINE=true` to require offline dependency resolution. **[VERIFIED, two local runs on 2026-09-23: exit `0`; captured outputs matched]**

The remaining steps describe a separate live-data and Surfpool walkthrough. They require Jupiter and public data-provider access. This synthetic fixture run does not establish that the live engine responds, that a Jupiter route simulates on the current Surfpool fork, or that a transaction confirms. **[VERIFIED, command scope and output on 2026-09-23]**

Start the local mainnet fork in a separate terminal:

```sh
surfpool start --network mainnet --no-tui
```

Surfpool documents `--network mainnet` and its default RPC port `8899` in the [CLI reference](https://docs.surfpool.run/toolchain/cli). **[VERIFIED: official Surfpool documentation]**

1. **Start the Rust engine.** From `engine/`, run:
   ```sh
   cargo run --release -- serve
   ```
   It listens only on `127.0.0.1:8787`, refreshes the evaluation, and serves the advice and graph contracts. The pre-IPO underlying reference is the PreStocks issuer mark; optional `PYTH_<ASSET>_<ROLE>_FEED_ID` environment variables switch an asset's reference to Pyth, and a configured-but-failing feed fails closed to `NO_DATA`. **[VERIFIED: repository source: `engine/src/serve.rs`]**

2. **Open the local copilot.** In another terminal, run `cd web && npm run dev`, then open the Vite URL ending in `/copilot/` (normally `http://127.0.0.1:5173/copilot/`). The page shows Advice, Trade ticket, and Graph side by side. **[VERIFIED: repository source: `web/package.json` and `web/copilot/index.html`]**

3. **Inspect the council response.** Show the live status, snapshot time, hash-backed evaluation, `latency_ms`, evidence rows, source citations, normalized token prices, underlying references, and signed premium/discount basis points. If a required source is unavailable or disagrees beyond bounds, point out that `NO_DATA` is the intended refusal, not a crash or fabricated fallback. **[VERIFIED: repository source]**

4. **Connect the user's wallet explicitly.** Click **Connect wallet** and approve the connection in the wallet. Explain that the Rust server has no wallet, private key, custody, or signing capability. **[VERIFIED: repository source]**

5. **Request a live quote.** Select the PreStocks OPENAI or SPACEX asset, enter a USDC amount, and click **Get quote**. Show Jupiter's output amount and price impact beside the council evidence. **[VERIFIED: repository source; live quote availability depends on Jupiter and market liquidity]**

6. **Build, inspect, and respect the warning.** Click **Build transaction** to request an unsigned serialized Jupiter transaction. Jupiter supplies a route from mainnet market data. Before the wallet opens, the page gets a fresh blockhash from Surfpool and simulates that transaction on the local mainnet fork. The wallet opens only when Surfpool returns a complete simulation result with `err: null`; the user must then click **Sign & send**. The page sends only to Surfpool at `http://127.0.0.1:8899`, then checks the signature status for up to 30 seconds. The page labels a timeout as pending and tells the user to check before retrying. A `BLOCKED` or `NO_DATA` verdict does not send by itself. This session did not verify a successful swap simulation or confirmed transaction. Do not claim a fill without a confirmed local transaction. **[VERIFIED, repository source and project verification status on 2026-09-23]**

7. **Open the evidence graph.** Move to the Graph pane and click nodes to trace the configured asset through PreStocks, Solana, source evidence, intent, and the final verdict. Close by showing that advice, evidence topology, and the user-controlled transaction path coexist without giving the advisory server signing authority. **[VERIFIED: repository source]**

## Run and verification commands

Run from the repository root unless a subshell changes directory.

### Engine tests

```sh
(cd engine && cargo test)
```

### Start the local HTTP engine

```sh
(cd engine && cargo run --release -- serve)
```

Default address: `http://127.0.0.1:8787`.

### Inspect the HTTP contracts

```sh
curl -sS http://127.0.0.1:8787/advice | python3 -m json.tool
curl -sS http://127.0.0.1:8787/graph | python3 -m json.tool
curl -i -sS http://127.0.0.1:8787/not-found
```

The first two responses include `Access-Control-Allow-Origin: *`; the final command demonstrates the JSON `404` response. **[VERIFIED: run 2026-09-20: status BLOCKED with live dislocation reasons, graph 20 nodes / 27 edges]**

### Emit the knowledge-graph artifact

```sh
(cd engine && cargo run --release -- graph --out ../data/graph/knowledge-graph.json)
```

### Run the focused copilot test

```sh
(cd web && node --test test/copilot.test.mjs)
```

### Start and open the copilot

```sh
(cd web && npm run dev)
```

Open the printed local URL at `/copilot/`.

### Verify Jupiter quote + unsigned swap build

```sh
(cd web && node scripts/verify-swap-build.mjs)
```

This verifier requests a live Jupiter quote (`lite-api.jup.ag/swap/v1`) and an unsigned base64 transaction. It does not connect a wallet, sign, or submit. **[VERIFIED: run 2026-09-20: exit 0, unsigned 453-byte transaction returned]**

## Honest boundaries

- **Advisory core:** The Rust council is read-only and advisory. It gathers public evidence and publishes verdicts; it does not place orders. **[VERIFIED: repository source]**
- **Keys and custody:** FalconOS has no server-side private keys, seed phrases, custody, or signer. The copilot never asks the user to paste key material. **[VERIFIED: repository source]**
- **User signing:** The connected wallet signs only after a successful local Surfpool simulation and the user's **Sign & send** click. The page sends signed bytes only to Surfpool at `http://127.0.0.1:8899`. The advisory server holds no signer. This session did not verify a successful swap simulation or confirmed transaction. **[VERIFIED, repository source and project verification status on 2026-09-23]**
- **Advisory versus enforcement:** `BLOCKED` is a prominent council warning, not a custodial enforcement mechanism. The wallet owner remains responsible for the final action. **[VERIFIED: repository source]**
- **Live-data behavior:** Provider outages, stale or misconfigured Pyth feeds, scaled-UI ambiguity, issuer disagreement, missing liquidity, stale or future capture timestamps, or an incoherent snapshot return `NO_DATA`. **[VERIFIED: repository source]**
- **Reference sources:** The offline demo uses synthetic PreStocks marks. A discount to a mark is evidence of dislocation risk, not proven mispricing or realizable arbitrage on an SPV-linked token. **[VERIFIED, repository source and product boundary]**
- **Perpetuals:** The perps path returns `NO_DATA` while exact registry/source data remains unresolved; FalconOS does not invent market identifiers or claim live perps support. **[VERIFIED: repository source: `engine/src/perps.rs`]**
- **PreStocks exclusivity:** Every pre-IPO asset in this submission path is a PreStocks asset. No non-PreStocks pre-IPO integration is claimed. **[VERIFIED: repository source]**
- **No investment-performance claim:** A dislocation verdict is evidence and risk context, not a guarantee of convergence, execution, liquidity, or profit. **[VERIFIED: product boundary]**

## Official Stocklana facts and rubric

**[VERIFIED, official source, accessed 2026-09-23]** Stocklana lists a September 25, 2026 submission deadline at 4:00 p.m. ET, a $100,000 Main Track, and a $10,000 Best Use of PreStocks bounty. The PreStocks rules exclude projects that integrate non-PreStocks pre-IPO tokens. The judging rubric asks whether the project could be a real app people will use and evaluates a real user and problem, a working end-to-end demo, a reason to belong on Solana, and execution quality.

Source: [Stocklana, Hackathons Solana](https://hackathons.solana.com/hackathons/stocklana)

## Internal readiness notes, exclude from submission text

[VERIFIED, correction, 2026-09-23] The earlier draft used the heading `Best use of Pyth market data` and claimed `28.8% rich for Neuralink`. The selected demo uses synthetic PreStocks marks, and the current engine roster contains only OPENAI and SPACEX. The old Neuralink capture and its track eligibility were not rechecked in this session, so the Pyth target and Neuralink example were removed. This draft targets Main and Best Use of PreStocks.

[VERIFIED, correction, 2026-09-23] The earlier draft said `Live serve ticks measured at 233 ms on the demo machine`. This session only ran the offline demo, so no live latency measurement was made. The old timing claim was removed.

[VERIFIED, command output, 2026-09-23] `cargo run --offline --quiet --manifest-path engine/Cargo.toml -- demo` ran twice, both times with exit `0`. The outputs matched. `CARGO_NET_OFFLINE=true npm run dash -- demo` also exited `0`. The commands reported `PUBLISHED`, `BLOCKED`, and `NO_DATA` from synthetic fixtures.

[VERIFIED, local git configuration, 2026-09-23] The configured origin is `https://github.com/Sarthib7/FalconOS.git`. GitHub visibility and publication of the current working-tree changes remain unchecked. Confirm both before submission.
