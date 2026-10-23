# FalconOS

[VERIFIED, approved direction, 2026-10-13] FalconOS is the decision and execution backend for agents. The selected scope is Solana execution and cross-market advice, with owner approval for every action. Falcon Investment Council supplies non-binding market intelligence and risk assessment. The [active plan](plans/roadmap.md#active-mcp-plan-2026-10-13) is specified in SPEC I21 and T81-T85; broader execution and a shared Council backend are not shipped capabilities.

[VERIFIED, current source boundary: mcp-rust/src/lib.rs, mesh/limits.mjs] The MCP workflow exposes public evidence and owner-scoped Solana Devnet lending preparation. Supply is capped at 1 Devnet USDC. Falcon holds no keys and never signs or broadcasts. Humans approve each signature and broadcast through their own wallet/provider. A complete owner-wallet supply/redemption round trip remains unverified; see SPEC T82. Mainnet, custody and delegated execution are outside this release.

## Human dashboard and agent interfaces

[VERIFIED LOCAL, D4] `/dashboard/` is the only human application workspace. It uses server-verified wallet sign-in and retained backend activity. Login does not authorize model work, signing or spending. Signup and organization workspaces remain unavailable. No sample portfolio or PnL is loaded. See the [owner dashboard contract](docs/interfaces.md#owner-dashboard-d4-contract-2026-10-23).

[VERIFIED SOURCE] Retired app, mesh, treasury and NEAR research workspace URLs redirect to the dashboard. Structured MCP/HTTP research, evidence and execution interfaces remain available under their existing authorization rules. Marketing and agent installation remain separate. Local system/simulator builds are not human deployment artifacts. Hosted routing and environment readiness remain unverified.

[VERIFIED LOCAL] The final web suite reported `tests321, pass321, fail0`. The production-built owner browser reported `passed14, total14`, including forged/revoked/expired sessions, retained data rendering and failed logout. These results do not prove hosted deployment. Current model and container limits are in [status](status.md).

## Try it

**Agent install route in current source:** [https://agents.falconos.markets/install/](https://agents.falconos.markets/install/). Hosted cutover is not verified.

**Download the skill (any agent):**
```sh
curl -fsSL https://agents.falconos.markets/SKILLS.md
```

**Claude Code:**
```sh
claude mcp add --transport http falconos https://mcp.falconos.markets/mcp
```

**Codex:** add the remote server to `~/.codex/config.toml`:
```toml
 [mcp_servers.falconos]
url = "https://mcp.falconos.markets/mcp"
```

Or register it with the Codex CLI:
```sh
codex mcp add falconos --url https://mcp.falconos.markets/mcp
```

[VERIFIED SOURCE; hosted 0.5.0 not verified] Restart the client, list tools and call `falcon_self_test({})`. Current source 0.5.0 exposes 19 tools and per-domain capability scope. Check supported actions, chain/network, unavailable reasons and approval rules before owner work. Metadata does not verify the owner wallet session, signer or funding state, separate operator review grant, or native model-host controls. `codex mcp list` confirms registration only. See the [current capability contract](mcp-rust/README.md#capability-discovery-050), the dated [hosted 0.4.0 cutover record](status.md#rust-mcp-cutover-2026-10-15), and the [2026-10-23 local evidence and blockers](status.md#source-050-publication-evidence-2026-10-23).

**JSON config** (any MCP client that supports Streamable HTTP):
```json
{
  "mcpServers": {
    "falconos": {
      "type": "http",
      "url": "https://mcp.falconos.markets/mcp"
    }
  }
}
```

## How it works

```mermaid
graph LR
    A[Agent] -->|tool call + session| B[MCP server<br/>Railway]
    B -->|HTTPS| C[Mesh API<br/>Railway]
    C -->|Devnet RPC| D[Kamino KLend<br/>Solana Devnet]
    D -->|reserve data| C
    C -->|evidence + hashes| C
    C -->|REVIEW / BLOCKED / NO_DATA| B
    B -->|unsigned tx bytes| A
    A -->|wallet signs locally| E[Wallet]
    E -->|broadcasts| D
```

Wallet sign-in is an Ed25519 message signature in SIWS style. It does not create a transaction and has no fee. The MCP server is stateless. Sessions live in the Mesh database: Supabase Postgres, schema v3. Mesh and the MCP server run on Railway.

## Solana integration

Falcon has no custom on-chain program. It uses Kamino's existing KLend program on Devnet.

| Name | Address |
| ---- | ------- |
| KLend program | `KLend2g3cP87fffoy8q1mQqGKjrxjC8boSyAYavgmjD` |
| Devnet USDC mint | `4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU` |
| Reserve | `HRwMj8uuoGVWCanKzKvpTWN5ZvXjtjKGxcFbn2qTPKMW` |
| Market | `6aaNTBEmwdN19AAdTwbNrWyUo6iEyiLguxCTePEzSqoH` |

[VERIFIED, source: mcp-rust/src/lib.rs, mesh/lending-store.mjs; authority: SPEC V147] Mesh evaluates explicit owner limits and returns REVIEW, BLOCKED or NO_DATA. Supply preparation requires a fresh REVIEW decisionId and caps input at 1 Devnet USDC. Redemption forbids decisionId and uses receipt-token units. Both require separate human review and signing. The human broadcasts the exact registered bytes. Falcon holds no private key and never broadcasts.

## MCP tools

[VERIFIED, source: mcp-rust/src/lib.rs] Selected lending tools appear below. Use `falcon_self_test` for the complete inventory, including public evidence and inspection. Authenticated tools require a session argument.

| Tool | What it does |
| ---- | ------------ |
| `falcon_connect` | Starts wallet sign-in. Returns a message to sign. |
| `falcon_connect_verify` | Takes the signature (64 bytes, base64 or base58). Returns a 30-minute `session`. |
| `falcon_disconnect` | Revokes the session. |
| `falcon_yield_opportunities` | Reads yield opportunities. Read-only. |
| `falcon_refresh_evidence` | Captures the three Devnet connectors and creates the live analysis. Returns `analysisId`. |
| `falcon_reserve_decision` | Returns REVIEW, BLOCKED or NO_DATA for a proposed supply. REVIEW is not approval. |
| `falcon_prepare_transaction` | Prepares an unsigned Devnet supply using `amountUsdc` (and a REVIEW `decisionId`) or redeem using `amountReceiptTokens` (no decision). Redeem previews the tokens burned and estimated USDC output. |
| `falcon_submit_signed` | Registers wallet-signed bytes. Falcon never broadcasts. |
| `falcon_check_receipt` | Reconciles the transaction against Devnet. |
| `falcon_activity` | Joins recent decisions and prepared transactions into one trail. Read-only. |

Supply amounts are decimal USDC strings in `amountUsdc`; redeem amounts are decimal receipt-token strings in `amountReceiptTokens`, not USDC. Both use at most 6 decimals and convert to base units with BigInt, not floats. Activity likewise labels redeemed inputs as receipt tokens; the USDC output is an adapter estimate at prepare time, not a guaranteed redemption amount.

## Status and limits

- **Devnet only.** No mainnet deployment. No real funds.
- **No custody.** [VERIFIED, SPEC V147] Falcon holds no keys. The human approves each signature and broadcast through their own wallet/provider.
- **Sessions expire after 30 minutes.** Call `falcon_disconnect` to revoke early.
- **Evidence is short-lived.** Captured evidence is usable for about 300 seconds. A prepared transaction expires in about 120 seconds.
- **Supply cap.** Mesh caps Devnet supply at 1 USDC.
- **No OAuth on the MCP endpoint.** Data access and tool writes require a valid wallet session obtained by signing the sign-in message. Captures, decisions, and transaction preparation do not require a transaction signature; only the transaction bytes registered with Falcon must be signed by the wallet. Falcon does not broadcast.

## Run locally

Rust builds MCP. Node 24.12 or later remains required for Mesh and the web app.

```sh
# Install packages
npm --prefix mesh ci
npm --prefix web ci

# Set up Postgres for Mesh
createdb falcon_mesh
export DATABASE_URL='postgresql://localhost/falcon_mesh'
FALCON_MESH_ALLOW_SCHEMA_SETUP=1 npm --prefix mesh run init-db

# Terminal 1: Mesh API
npm --prefix mesh run dev:local           # 127.0.0.1:8791

# Terminal 2: MCP server
FALCON_MESH_API_URL=http://127.0.0.1:8791 \
FALCON_MCP_ORIGIN=http://127.0.0.1:5173 \
sh scripts/run-mcp-rust.sh                # 127.0.0.1:8792

# Terminal 3: bot page
npm --prefix web run dev:bot              # 127.0.0.1:5194
```

Add the local MCP server to Claude Code:

```sh
claude mcp add --transport http falconos http://127.0.0.1:8792/mcp
```

See [mesh/README.md](mesh/README.md) and [mcp-rust/README.md](mcp-rust/README.md) for configuration and database prerequisites.

## Repository layout

| Path | Purpose |
| ---- | ------- |
| `mcp-rust/` | Rust MCP server (Streamable HTTP, stateless, Railway) |
| `mesh/` | Mesh API and Kamino adapter (Railway, Supabase Postgres schema v3) |
| `web/` | Owner dashboard, marketing, agent install/skill files, separate local system and simulator sources |
| `engine/` | Rust stocks dashboard |
| `src/` | Advisory plugin CLI |
| `docs/` | Architecture, interfaces, verification records |
| `SPEC.md` | Product specification |
| `status.md` | Current work and decisions |

## Verification

Run `npm run verify:mcp` for the maintained Rust MCP checks. CI builds and smokes the Mesh and Rust MCP containers [VERIFIED, verification entrypoints].

The [Rust cutover record](status.md#rust-mcp-cutover-2026-10-15) retains exact deployment and test evidence. Hosted reads proved 14 tools and an OBSERVED public graph. Local real-Mesh/PostgreSQL integration prepared unsigned supply and redeem transactions using external RPC fixtures [VERIFIED, retained smoke evidence].

No owner-funded Devnet transaction round trip has been completed by these checks. T82 still requires separately approved signing, broadcast, confirmed receipts and Explorer proof. Historical Node results remain in the [pre-retirement README](https://github.com/Sarthib7/FalconOS/blob/7ff245cb7849deea327474a65f14d2b7e398c1a8/README.md#verification).

---

[SPEC.md](SPEC.md) | [status.md](status.md) | [docs/README.md](docs/README.md) | [mcp-rust/README.md](mcp-rust/README.md)
