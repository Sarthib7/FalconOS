# T72: Wallet-Session Authorization Implementation

## Summary
Implemented wallet-session authorization for owner-scoped mesh HTTP endpoints while preserving existing static mesh-token and Supabase JWT authentication paths.

## Changes Made

### `mesh/http.mjs`
**Lines 147-178**: Refactored authorization logic to support three auth paths:
1. **Static mesh tokens** (unchanged): SHA-256 hash lookup in tokenHashes
2. **Wallet sessions** (new): `wsi1_*` tokens validated via `walletAuth.getSession()`
3. **Supabase JWT** (unchanged): Only for `/v1/yield/` routes

**Lines 199-206**: Added wallet validation for lending prepare:
- When using wallet-session auth, requires `input.wallet === session.walletAddress`
- Static tokens and Supabase JWTs allow any wallet (existing behavior)
- Returns 401 UNAUTHORIZED with descriptive message on mismatch

### Test Files Created

#### `mesh/test/wallet-session-auth-unit.test.mjs` (11 tests)
Unit tests covering:
- ✅ Static mesh token bypasses wallet-session auth
- ✅ Valid wsi1 token triggers wallet-session validation
- ✅ Invalid wsi1 token rejection
- ✅ Wallet-session works on connectors endpoint
- ✅ Health endpoints skip auth
- ✅ Missing authorization header rejection
- ✅ Lending prepare succeeds when wallet matches session
- ✅ Lending prepare fails when wallet mismatches session
- ✅ Static token allows any wallet for lending

#### `mesh/test/wallet-session-http.test.mjs` (2 integration test suites, requires DB)
Comprehensive integration tests covering:
- ✅ Session success on all owner-scoped routes (graph, connectors, sources, analyses)
- ✅ Cross-owner isolation (wallet2 cannot see wallet1 data)
- ✅ Legacy static token compatibility
- ✅ Invalid/expired/revoked session rejection
- ✅ Lending prepare wallet validation with sessions
- ✅ Lending list/get/submit/receipt work with wallet-session auth

## Authorization Flow

### Owner-Scoped Endpoints
Routes: `/v1/graph`, `/v1/connectors`, `/v1/captures`, `/v1/sources`, `/v1/analyses`, `/v1/decisions`, `/v1/lending/*`

1. Extract Bearer token from Authorization header
2. **If token ≤256 chars**: Check tokenHashes (static mesh token)
3. **Else if token starts with `wsi1_`**: Call `walletAuth.getSession(token)`
   - Returns `{ walletAddress, ownerId, expiresAt }` or `null`
   - Expired/revoked sessions return `null` (handled by walletAuth)
4. **Else** (for yield routes): Verify Supabase JWT
5. If no owner derived: Return 401 UNAUTHORIZED

### Lending Prepare Validation
Additional check when `POST /v1/lending/intents`:
- If authenticated via wallet-session (`walletSession !== null`)
- Validate `request.wallet === walletSession.walletAddress`
- Prevents session holder from preparing transactions for other wallets

## Security Guarantees

1. **Owner isolation**: Each session is scoped to `ownerId` derived from `walletAddress`
2. **No caller-controlled owner**: Server derives owner from verified session, never accepts caller input
3. **Session validation**: `walletAuth.getSession()` enforces expiry and revocation checks
4. **Wallet binding**: Lending prepare enforces wallet-to-session match for wallet-session auth
5. **Backward compatibility**: Existing static tokens and Supabase JWT flows unchanged

## Test Coverage

### Unit Tests (no DB required)
- 11 tests, all passing
- Covers authorization logic, endpoint access, wallet validation

### Integration Tests (requires FALCON_MESH_TEST_DATABASE_URL)
- 2 test suites with comprehensive coverage
- Tests real database interactions, cross-owner isolation, session lifecycle

## Verification

Run unit tests:
```bash
cd mesh && node --test test/wallet-session-auth-unit.test.mjs
```

Run integration tests (requires DB):
```bash
cd mesh && npm test -- wallet-session-http.test.mjs
```

Run all tests:
```bash
cd mesh && npm test
```

## Files Modified
- `mesh/http.mjs`: Authorization logic and lending validation

## Files Created
- `mesh/test/wallet-session-auth-unit.test.mjs`: Unit tests
- `mesh/test/wallet-session-http.test.mjs`: Integration tests
- `mesh/T72-IMPLEMENTATION.md`: This document

## Compliance
- ✅ No DB schema changes
- ✅ No migrations run
- ✅ No public RPC calls
- ✅ No transaction signing/sending
- ✅ No deployment
- ✅ No frontend file edits
- ✅ Preserves static mesh-token behavior
- ✅ Preserves Supabase yield-route behavior
- ✅ Owner derived only from verified session
- ✅ Lending wallet validation for wallet-sessions
- ✅ Deterministic tests for all requirements
