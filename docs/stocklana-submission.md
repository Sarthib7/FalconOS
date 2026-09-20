# Stocklana Submission — Falcon Investment Council (FalconOS)

## Claim labels

- **VERIFIED** — confirmed from the cited official event page or the current repository source.
- **REPORTED** — observed or supplied by project research but not independently reproduced in this document.

## Project

**Falcon Investment Council (FalconOS)**

## Pitch

Falcon Investment Council is an agent-first tokenized-equity copilot for Solana: a deterministic Rust engine compares live token and underlying evidence, applies Token-2022 scaled-UI normalization, and fails closed with `PUBLISHED`, `BLOCKED`, or `NO_DATA` dislocation verdicts; beside that advice, a local web copilot lets the user request a Jupiter quote, build an unsigned trade, and explicitly sign it in their own wallet, while a knowledge graph makes every asset, source, evidence item, intent, and verdict inspectable. **[VERIFIED — repository source: `engine/src/serve.rs`, `engine/src/council.rs`, `engine/src/prestocks.rs`, `engine/src/pyth.rs`, and `web/copilot/index.html`]**

## Targeted tracks

### Main Track — Trading + Infrastructure / analytics

The Stocklana Main Track has a **$100,000 prize pool**. Its published build areas include **Trading** and **Infrastructure**, with analytics explicitly listed under Infrastructure. Falcon Investment Council spans both: the copilot provides a user-controlled Solana trading path, while the Rust engine provides deterministic price normalization, reference-price comparison, risk verdicts, and an evidence graph. **[VERIFIED — official Stocklana page]**

### Best Use of PreStocks

The PreStocks bounty totals **$10,000** for projects using PreStocks tokenized pre-IPO stocks, split across three winners ($5,000 / $3,000 / $2,000). The rules state that a project integrating any non-PreStocks pre-IPO token is ineligible. **[VERIFIED — official Stocklana page]**

FalconOS complies by limiting its pre-IPO integration to the configured PreStocks OPENAI and SPACEX mints. It does not mix another issuer's pre-IPO tokens into the submission path. **[VERIFIED — repository source: `engine/src/serve.rs` and `web/copilot/index.html`]**

### Best use of Pyth market data

The Pyth bounty rewards applications where live financial data does real work; judging considers how central Pyth is, technical soundness, integration quality, and whether the app continues after the hackathon. The prize is three months of Pyth Pro access. **[VERIFIED — official Stocklana page]**

Honest scope: private pre-IPO companies have no Pyth equity feed, so the pre-IPO demo uses the PreStocks issuer mark as the underlying reference. Pyth is the engine's reference layer for the tokenized public-stock expansion: when an asset's Pyth feed IDs are configured, the engine fetches Hermes prices with exact fixed-point conversion, rejects missing, malformed, or stale results, and a configured-but-failing feed fails the verdict closed to `NO_DATA` rather than publishing an unsupported number. **[VERIFIED — repository source: `engine/src/pyth.rs` and `engine/src/serve.rs`]**

## What judges see

The official rubric asks one practical question — whether this could be a real app people will use — and evaluates a real user and problem, a working end-to-end demo, a reason the product belongs on Solana, and execution quality. **[VERIFIED — official Stocklana page]**

### 1. A real problem

Tokenized pre-IPO assets can diverge sharply from their underlying reference marks, while Token-2022 scaled-UI multipliers can make a raw-unit comparison materially wrong. **[VERIFIED — repository source: `engine/src/prestocks.rs`]**

Project research captured live dislocations of approximately **11.9% rich for OPENAI, 22.4% cheap for SPACEX, and 28.8% rich for Neuralink** on 2026-09-20. **[REPORTED — project research capture using PreStocks API and Jupiter]** The current demo configuration covers the PreStocks OPENAI and SPACEX mints; the Neuralink observation demonstrates the broader market problem but is not a configured demo asset. **[VERIFIED — repository source for configured assets]**

### 2. A working end-to-end demo

The Rust engine gathers issuer, Solana RPC, DEX, and (when configured) Pyth evidence, emits a content-addressed council response, and serves `/advice` and `/graph` locally. The copilot displays the verdict beside a client-owned trade ticket, requests a Jupiter quote, builds an unsigned serialized transaction, and exposes signing only after an explicit wallet connection and button click. **[VERIFIED — repository source]**

A `BLOCKED` verdict remains visible beside the ticket as a council warning. FalconOS never signs automatically and never holds a server-side key. Because the council is advisory, the wallet owner retains the final decision. **[VERIFIED — repository source: `web/copilot/index.html`]**

### 3. Why Solana

The correctness problem exists in Solana-native state: the engine reads Token-2022 `scaledUiAmountConfig`, cross-checks the effective multiplier against `getTokenSupply`, normalizes raw DEX units, and evaluates the configured PreStocks mints. Jupiter supplies the client-side quote/build path, and the user's Solana wallet is the only signer. Removing Solana would remove the token program state, the onchain market evidence, the route, and the user-signed settlement path. **[VERIFIED — repository source]**

### 4. Execution quality

- Exact integer/fixed-point arithmetic is used for prices and basis-point comparisons; no floating-point value decides a verdict. **[VERIFIED — repository source]**
- Missing, malformed, stale, conflicting, or uncorroborated data becomes `NO_DATA`. Refusal is a product feature: the council will not manufacture confidence from incomplete evidence. **[VERIFIED — repository source]**
- Token-2022 scaled-UI normalization accounts for effective-time changes and checks extension-derived multipliers against supply-derived values before admitting a price. **[VERIFIED — repository source]**
- Snapshot ingress re-derives readiness from raw captures, so a forged READY status or tampered conflicts list is rejected even when its hash is self-consistent. **[VERIFIED — repository source: `engine/src/domain.rs` and `engine/src/council.rs`]**
- Live serve ticks measured at 233 ms on the demo machine; the response exposes `latency_ms` so judges see the current measurement rather than a static benchmark claim. **[REPORTED — 2026-09-20 local measurement; verify from the demo's live `latency_ms`]**
- Advice and graph responses are local, deterministic products of the same evaluation. **[VERIFIED — repository source]**

## Seven-step demo script

1. **Start the Rust engine.** From `engine/`, run:
   ```sh
   /opt/homebrew/bin/cargo run --release -- serve
   ```
   It listens only on `127.0.0.1:8787`, refreshes the evaluation, and serves the advice and graph contracts. The pre-IPO underlying reference is the PreStocks issuer mark; optional `PYTH_<ASSET>_<ROLE>_FEED_ID` environment variables switch an asset's reference to Pyth, and a configured-but-failing feed fails closed to `NO_DATA`. **[VERIFIED — repository source: `engine/src/serve.rs`]**

2. **Open the local copilot.** In another terminal, run `cd web && npm run dev`, then open the Vite URL ending in `/copilot/` (normally `http://127.0.0.1:5173/copilot/`). The page shows Advice, Trade ticket, and Graph side by side. **[VERIFIED — repository source: `web/package.json` and `web/copilot/index.html`]**

3. **Inspect the council response.** Show the live status, snapshot time, hash-backed evaluation, `latency_ms`, evidence rows, normalized token prices, underlying references, and signed premium/discount basis points. If a required source is unavailable or disagrees beyond bounds, point out that `NO_DATA` is the intended refusal, not a crash or fabricated fallback. **[VERIFIED — repository source]**

4. **Connect the user's wallet explicitly.** Click **Connect wallet** and approve the connection in the wallet. Explain that the Rust server has no wallet, private key, custody, or signing capability. **[VERIFIED — repository source]**

5. **Request a live quote.** Select the PreStocks OPENAI or SPACEX asset, enter a USDC amount, and click **Get quote**. Show Jupiter's output amount and price impact beside the council evidence. **[VERIFIED — repository source; live quote availability depends on Jupiter and market liquidity]**

6. **Build, inspect, and respect the warning.** Click **Build transaction** to request an unsigned serialized Jupiter transaction. With a live dislocation above policy bounds, show the council's `BLOCKED` status and "Council does not endorse this trade right now" warning. **Sign & send** remains a separate explicit user action in the wallet; do not claim a fill unless a transaction is actually approved and confirmed during the demo. **[VERIFIED — repository source for the interaction; BLOCKED depends on live evidence]**

7. **Open the evidence graph.** Move to the Graph pane and click nodes to trace the configured asset through PreStocks, Solana, source evidence, intent, and the final verdict. Close by showing that advice, evidence topology, and the user-controlled transaction path coexist without giving the advisory server signing authority. **[VERIFIED — repository source]**

## Run and verification commands

Run from the repository root unless a subshell changes directory.

### Engine tests

```sh
(cd engine && /opt/homebrew/bin/cargo test)
```

### Start the local HTTP engine

```sh
(cd engine && /opt/homebrew/bin/cargo run --release -- serve)
```

Default address: `http://127.0.0.1:8787`.

### Inspect the HTTP contracts

```sh
curl -sS http://127.0.0.1:8787/advice | python3 -m json.tool
curl -sS http://127.0.0.1:8787/graph | python3 -m json.tool
curl -i -sS http://127.0.0.1:8787/not-found
```

The first two responses include `Access-Control-Allow-Origin: *`; the final command demonstrates the JSON `404` response. **[VERIFIED — run 2026-09-20: status BLOCKED with live dislocation reasons, graph 20 nodes / 27 edges]**

### Emit the knowledge-graph artifact

```sh
(cd engine && /opt/homebrew/bin/cargo run --release -- graph --out ../data/graph/knowledge-graph.json)
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

This verifier requests a live Jupiter quote (`lite-api.jup.ag/swap/v1`) and an unsigned base64 transaction. It does not connect a wallet, sign, or submit. **[VERIFIED — run 2026-09-20: exit 0, unsigned 453-byte transaction returned]**

## Honest boundaries

- **Advisory core:** The Rust council is read-only and advisory. It gathers public evidence and publishes verdicts; it does not place orders. **[VERIFIED — repository source]**
- **Keys and custody:** FalconOS has no server-side private keys, seed phrases, custody, or signer. The copilot never asks the user to paste key material. **[VERIFIED — repository source]**
- **User signing:** A transaction can be signed and sent only through the connected browser wallet after the user explicitly clicks **Sign & send** and approves the wallet prompt. There is no auto-sign path. **[VERIFIED — repository source]**
- **Advisory versus enforcement:** `BLOCKED` is a prominent council warning, not a custodial enforcement mechanism. The wallet owner remains responsible for the final action. **[VERIFIED — repository source]**
- **Live-data behavior:** Provider outages, stale or misconfigured Pyth feeds, scaled-UI ambiguity, issuer disagreement, missing liquidity, stale or future capture timestamps, or an incoherent snapshot return `NO_DATA`. **[VERIFIED — repository source]**
- **Reference sources:** Pre-IPO underlying references are PreStocks issuer marks, because no Pyth feed exists for private companies. A discount to mark is evidence of dislocation risk, not proven mispricing or realizable arbitrage on an SPV-linked token. **[VERIFIED — repository source and product boundary]**
- **Reported market observations:** The 11.9%–28.8% dislocation examples are a dated research capture, not a promise that the same spread exists during judging and not evidence of a profitable fill. **[REPORTED — project research capture]**
- **Perpetuals:** The perps path returns `NO_DATA` while exact registry/source data remains unresolved; FalconOS does not invent market identifiers or claim live perps support. **[VERIFIED — repository source: `engine/src/perps.rs`]**
- **PreStocks exclusivity:** Every pre-IPO asset in this submission path is a PreStocks asset. No non-PreStocks pre-IPO integration is claimed. **[VERIFIED — repository source]**
- **No investment-performance claim:** A dislocation verdict is evidence and risk context, not a guarantee of convergence, execution, liquidity, or profit. **[VERIFIED — product boundary]**

## Official Stocklana facts and rubric

**[VERIFIED — official source, accessed 2026-09-20]** Stocklana lists a September 25, 2026 submission deadline at 4:00 p.m. ET; a $100,000 Main Track; a $10,000 Best Use of PreStocks bounty with the non-PreStocks pre-IPO exclusivity rule; and a Pyth bounty awarding three months of Pyth Pro access. Its judging rubric asks whether the project could be a real app people will use and calls out a real user/problem, a working end-to-end demo, a reason to belong on Solana, and execution quality.

Source: [Stocklana — Hackathons Solana](https://hackathons.solana.com/hackathons/stocklana)
