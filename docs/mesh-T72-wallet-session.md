# T72: Wallet-Session Authorization Implementation

## Summary
Implemented wallet-session authorization for owner-scoped mesh HTTP endpoints while preserving existing static mesh-token and Supabase JWT authentication paths.

## Changes Made

### `mesh/http.mjs`
Authorization logic supports three auth paths (see the `bearer` / `walletSession` block ahead of the `/v1/yield/` and `/v1/lending/` routes):
1. **Static mesh tokens** (unchanged): SHA-256 hash lookup in tokenHashes
2. **Wallet sessions** (new): `wsi1_*` tokens validated via `walletAuth.getSession()`
3. **Supabase JWT** (unchanged): Only for `/v1/yield/` routes

Lending prepare wallet binding:
- When using wallet-session auth, requires `input.wallet === session.walletAddress`
- Static tokens and Supabase JWTs allow any wallet (existing behavior)
- Returns 401 UNAUTHORIZED with descriptive message on mismatch

## Authorization Flow

### Owner-Scoped Endpoints
Routes: `/v1/graph`, `/v1/connectors`, `/v1/captures`, `/v1/sources`, `/v1/analyses`, `/v1/decisions`, `/v1/lending/*`

1. Extract Bearer token from Authorization header
2. **If token ≤256 chars**: Check tokenHashes (static mesh token)
3. **Else if token starts with `wsi1_`**: Call `walletAuth.getSession(token)`
   - Returns `{ walletAddress, ownerId, expiresAt }` or `null`
   - Expired/revoked sessions return `null` (`revoked_at IS NULL AND expires_at > now` in `wallet-auth.mjs` `getSession`)
4. **Else** (for yield routes): Verify Supabase JWT
5. If no owner derived: Return 401 UNAUTHORIZED

### Lending Prepare Validation
Additional check when `POST /v1/lending/intents`:
- If authenticated via wallet-session (`walletSession !== null`)
- Validate `request.wallet === walletSession.walletAddress`
- Prevents session holder from preparing transactions for other wallets

## Tests

### `mesh/test/wallet-session-auth-unit.test.mjs` (no database; mocked `walletAuth`, store and lending)
2 top-level tests, 9 subtests (11 in the node:test count). They prove only the `http.mjs` wiring against mocks:
- the static token never calls `getSession`, and the store receives the static owner
- a `wsi1_` token calls `getSession` once and the store receives exactly the owner the (mocked) session returned
- a rejected session gets 401 and never reaches the store
- lending prepare: matching wallet reaches `prepare` with the session owner; a foreign wallet gets 401 and `prepare` is not called; a caller-supplied `ownerId` body field gets 400 and `prepare` is not called; the static token may use any wallet
They do NOT prove expiry, revocation, owner derivation, or database isolation (the mocked `getSession` decides all of that).

### `mesh/test/wallet-session-http.test.mjs` (real Postgres; requires `FALCON_MESH_TEST_DATABASE_URL`)
Sessions are minted through the real `createChallenge` / ed25519 signature / `verifyChallenge` flow, so owner IDs are real `wallet_<56 hex>` values. One injected clock is shared by `createWalletAuth`, the API `now`, the store and the assertions. Lending uses the real lending store with only the Kamino adapter, chain verification, receipt read and public fetch replaced by fixtures; lending cases use `redeem` because exits are not gated by a reserve decision.

Proved by assertions in this file:
- session access to graph, connectors, sources, analyses (create and list)
- cross-owner isolation for graph, analysis list, source and analysis by id (wallet2 gets empty results and 404), with positive controls showing wallet1 still sees its own data
- invalid and never-issued `wsi1_` tokens get 401
- expiry: a session valid at `expiresAt - 1ms` is rejected at `expiresAt` and later, while a control session from the same wallet stays valid in the same run and the expired row still exists with `revoked_at` null
- revocation (via `POST /v1/auth/wallet/logout`): the revoked session gets 401 while a control session from the same wallet stays valid, and the revoked row is still inside its lifetime
- lending prepare with a matching wallet succeeds; a foreign wallet gets 401, the adapter is not called and no intent is stored; the static token may use any wallet against its own live analysis
- lending list, get, submit and receipt work with a wallet session; wallet2 gets an empty list and 404 on wallet1's intent, submit and receipt, and 404 when preparing against wallet1's analysis

Not proved by this suite: Supabase JWT behavior on yield routes (covered, if at all, by other test files), the browser sign-in UI, and anything on mainnet.

## Measured Result
Run on `falcon_mesh_test_a` (PostgreSQL 17, schema v3):
- `node --test test/wallet-session-http.test.mjs`: 20 tests, 20 pass, 0 fail, 0 skipped (baseline before the repair: 17 failing, because the setup inserted `w_<base64url>` owner IDs that the `^wallet_[a-f0-9]{56}$` check rejected, and `createWalletAuth` had no injected clock).
- `node --test test/wallet-session-auth-unit.test.mjs test/wallet-session-http.test.mjs`: 32 tests, 32 pass, 0 fail, 0 skipped.

Mutation check, run on a throwaway copy of `mesh/` (the repository sources were not edited); each mutation turned exactly the named subtests red:
| Mutation in the copy | Failing subtest(s) |
| --- | --- |
| remove `revoked_at IS NULL` from `getSession` | revoked wallet-session is rejected on revocation alone |
| remove the `expires_at > now` comparison | expired wallet-session is rejected on expiry alone |
| `expires_at > now` to `>=` | expired wallet-session is rejected on expiry alone (the `expiresAt` instant probe) |
| remove the `input.wallet !== walletSession.walletAddress` check in `http.mjs` | lending prepare fails when wallet does not match session |
| drop the owner filter in lending `get` | cross-owner isolation (lending) |
| drop the owner filter in `getSource`, `getAnalysis`, `listAnalyses` | cross-owner isolation (both suites) |

## Verification

Run unit tests:
```bash
cd mesh && node --test test/wallet-session-auth-unit.test.mjs
```

Run integration tests (requires a disposable database with the full mesh migration history):
```bash
cd mesh && FALCON_MESH_TEST_DATABASE_URL=postgresql://... node --test test/wallet-session-http.test.mjs
```

## Files Modified
- `mesh/http.mjs`: Authorization logic and lending validation

## Files Created
- `mesh/test/wallet-session-auth-unit.test.mjs`: Unit tests
- `mesh/test/wallet-session-http.test.mjs`: Integration tests
- `docs/mesh-T72-wallet-session.md`: This document

## Scope
No schema changes, no migrations, no signing or sending of transactions, no deployment, and no frontend files were part of T72. The integration tests make no public RPC calls (the live-capture fetch is a fixture).
