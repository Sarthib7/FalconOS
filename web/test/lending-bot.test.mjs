import assert from 'node:assert/strict';
import test, { after } from 'node:test';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';

const webRoot = fileURLToPath(new URL('../', import.meta.url));
const vite = await createServer({
  configFile: false,
  root: webRoot,
  appType: 'custom',
  logLevel: 'error',
  server: { middlewareMode: true, hmr: false },
});
const lending = await vite.ssrLoadModule('/dashboard/LendingBot.jsx');
const embeddedWallet = await vite.ssrLoadModule('/dashboard/EmbeddedWallet.jsx');
const {
  buildMandateFromForm,
  canPerformLendingOperation,
  createLendingMeshRequest,
  createLendingRequestScope,
  formatBaseUnits,
  parseTokenAmount,
  performIdentityBoundOwnerSdkAction,
} = lending;
const { matchesFalconWalletSession, performSelectedWalletAction } = embeddedWallet;
after(() => vite.close());

test('V226 embedded wallet matching uses the verified session walletAddress', () => {
  const walletAddress = 'Wallet11111111111111111111111111111111';
  const session = {
    token: 'verified-falcon-session',
    walletAddress,
    ownerId: 'owner-1',
    expiresAt: '2026-11-10T00:00:00.000Z',
  };
  assert.equal(matchesFalconWalletSession(session, walletAddress), true);
  assert.equal(matchesFalconWalletSession(session, 'Wallet22222222222222222222222222222222'), false);
  assert.equal(matchesFalconWalletSession({ token: session.token }, walletAddress), false);
});

const form = () => ({
  capitalCap: '9007199254740993.000001',
  reserveFloor: '0',
  maxAction: '10.000001',
  maxPositionBps: '10000',
  maxFeeLamports: '0',
  maxEvidenceAgeSeconds: '1',
  minHoldingSeconds: '60',
  minNetBenefit: '0.000001',
  cooldownSeconds: '1',
  expiresAt: '2026-12-01T10:00:00.000Z',
  monitorIntervalSeconds: '60',
  maxReviewCalls: '1',
});

const configuration = () => ({
  feeRecipient: 'TrustedRecipient1111111111111111111111111111',
  feeBps: 250,
  availableReserves: [
    { reserveAddress: 'Reserve11111111111111111111111111111111' },
    { reserveAddress: 'Reserve22222222222222222222222222222222' },
  ],
});

test('exact token amount parsing preserves large values and precision boundaries', () => {
  assert.equal(parseTokenAmount('0', 6), '0');
  assert.equal(parseTokenAmount('0000001.20', 6), '1200000');
  assert.equal(parseTokenAmount('9007199254740993.000001', 6), '9007199254740993000001');
  assert.equal(parseTokenAmount('1.000000', 6), '1000000');
  assert.equal(parseTokenAmount('1.0000001', 6), null);
  assert.equal(parseTokenAmount('1.', 6), null);
  assert.equal(parseTokenAmount('.1', 6), null);
  assert.equal(parseTokenAmount('-1', 6), null);
  assert.equal(parseTokenAmount('1e6', 6), null);
  assert.equal(parseTokenAmount(' 1', 6), null);
  assert.equal(parseTokenAmount('1.0', 0), null);
  assert.equal(parseTokenAmount('1', 256), null);
  assert.equal(formatBaseUnits('9007199254740993000001', 6), '9,007,199,254,740,993.000001');
  assert.equal(formatBaseUnits(null, 6), null);
});

test('mandate builder sends exact base-unit strings and accepts money only within entered precision', () => {
  const result = buildMandateFromForm(form(), configuration(), Date.parse('2026-11-01T00:00:00.000Z'));
  assert.deepEqual(result.errors, {});
  assert.deepEqual(result.mandate, {
    schemaVersion: 1,
    capitalCapBaseUnits: '9007199254740993000001',
    reserveFloorBaseUnits: '0',
    maxActionBaseUnits: '10000001',
    maxPositionBps: 10000,
    maxFeeLamports: '0',
    maxEvidenceAgeSeconds: 1,
    minHoldingSeconds: 60,
    minNetBenefitBaseUnits: '1',
    cooldownSeconds: 1,
    feeBps: 250,
    feeRecipient: 'TrustedRecipient1111111111111111111111111111',
    reserves: ['Reserve11111111111111111111111111111111', 'Reserve22222222222222222222222222222222'],
    expiresAt: '2026-12-01T10:00:00.000Z',
    monitorIntervalSeconds: 60,
    maxReviewCalls: 1,
  });
  const zeroLimits = buildMandateFromForm({ ...form(), capitalCap: '0', maxAction: '0' }, configuration(), Date.parse('2026-11-01T00:00:00.000Z'));
  assert.equal(zeroLimits.mandate?.capitalCapBaseUnits, '0');
  assert.equal(zeroLimits.mandate?.maxActionBaseUnits, '0');

  const invalid = buildMandateFromForm({ ...form(), capitalCap: '1.0000001' }, configuration(), Date.parse('2026-11-01T00:00:00.000Z'));
  assert.equal(invalid.mandate, null);
  assert.match(invalid.errors.capitalCap, /six decimal places/);
  assert.equal(buildMandateFromForm({}, configuration()).mandate, null);
});

test('late replies are rejected after the selected account changes', async () => {
  const scope = createLendingRequestScope();
  const session = { token: 'session-a' };
  const firstIdentity = { session, sessionWallet: 'Wallet11111111111111111111111111111111', walletAddress: 'Wallet11111111111111111111111111111111', walletUserId: 'privy-user-a' };
  scope.setIdentity(firstIdentity);
  const ticket = scope.capture();
  let resolveReply;
  const reply = new Promise(resolve => { resolveReply = resolve; });
  const acceptedReply = reply.then(value => scope.accepts(ticket, currentIdentity) ? value : null);
  let currentIdentity = firstIdentity;
  currentIdentity = { ...firstIdentity, walletAddress: 'Wallet22222222222222222222222222222222' };
  scope.setIdentity(currentIdentity);
  resolveReply({ walletAddress: firstIdentity.walletAddress, status: 'ACTIVE' });
  assert.equal(await acceptedReply, null);
  assert.equal(scope.accepts(ticket, currentIdentity), false);
});

test('V226 selected owner SDK actions reject stale Privy identities before and after asynchronous work', async () => {
  const selected = {
    authenticated: true,
    userId: 'privy-user-a',
    walletAddress: 'Wallet11111111111111111111111111111111',
    wallet: { address: 'Wallet11111111111111111111111111111111' },
  };

  for (const changed of [
    { ...selected, walletAddress: 'Wallet22222222222222222222222222222222', wallet: { address: 'Wallet22222222222222222222222222222222' } },
    { ...selected, userId: 'privy-user-b' },
  ]) {
    const identityRef = { current: selected };
    let resolveAction;
    let calls = 0;
    const action = performSelectedWalletAction(identityRef, selected, () => {
      calls += 1;
      return new Promise(resolve => { resolveAction = resolve; });
    });
    assert.equal(calls, 1);
    identityRef.current = changed;
    resolveAction('owner-sdk-result');
    await assert.rejects(action, /Privy user or selected Solana wallet changed/);
  }

  const staleRef = { current: { ...selected, walletAddress: 'Wallet22222222222222222222222222222222' } };
  let called = false;
  await assert.rejects(
    performSelectedWalletAction(staleRef, selected, () => { called = true; }),
    /Privy user or selected Solana wallet changed/,
  );
  assert.equal(called, false);
});

test('V226 owner SDK outcomes are discarded after Falcon session or selected-wallet changes', async () => {
  const walletAddress = 'Wallet11111111111111111111111111111111';
  const original = {
    session: { token: 'falcon-session-a', walletAddress },
    sessionWallet: walletAddress,
    walletAddress,
    walletUserId: 'privy-user-a',
  };

  for (const changed of [
    { ...original, session: { ...original.session } },
    { ...original, walletAddress: 'Wallet22222222222222222222222222222222' },
  ]) {
    const requestScope = createLendingRequestScope();
    requestScope.setIdentity(original);
    const ticket = requestScope.capture();
    const identityRef = { current: original };
    let resolveAction;
    let calls = 0;
    const action = performIdentityBoundOwnerSdkAction(requestScope, ticket, identityRef, () => {
      calls += 1;
      return new Promise(resolve => { resolveAction = resolve; });
    });
    assert.equal(calls, 1);
    identityRef.current = changed;
    requestScope.setIdentity(changed);
    resolveAction('owner-sdk-result');
    assert.deepEqual(await action, { accepted: false });
  }
});

test('V226 an owner credential cannot reach the Mesh request transport', () => {
  const calls = [];
  const request = createLendingMeshRequest((...args) => { calls.push(args); });
  assert.throws(() => request('verified-falcon-session', '/wallet-link', {
    requestId: '11111111-1111-4111-8111-111111111111',
    accessToken: 'owner-token-private-marker',
  }), Error);
  assert.equal(calls.length, 0);
});

test('V226 owner capability gates require wallet actions, not an owner credential', () => {
  const walletAddress = 'Wallet11111111111111111111111111111111';
  const base = {
    sessionToken: 'verified-falcon-session',
    sessionWallet: walletAddress,
    walletAddress,
    walletReady: true,
    walletAuthenticated: true,
    removeAllDelegatedSigners() {},
  };
  const unlinkedOverview = {
    configuration: { walletProviderConfigured: true },
    walletLink: null,
    delegation: { status: 'ACTIVE' },
  };
  const linkedOverview = {
    ...unlinkedOverview,
    walletLink: { walletAddress },
  };

  assert.equal(canPerformLendingOperation('link-wallet', { ...base, overview: unlinkedOverview }), true);
  assert.equal(canPerformLendingOperation('link-wallet', { ...base, overview: unlinkedOverview, walletReady: false }), false);
  assert.equal(canPerformLendingOperation('link-wallet', { ...base, overview: unlinkedOverview, walletAuthenticated: false }), false);
  assert.equal(canPerformLendingOperation('link-wallet', { ...base, overview: unlinkedOverview, walletAddress: 'Wallet22222222222222222222222222222222' }), false);
  assert.equal(canPerformLendingOperation('prepare-revocation', { ...base, overview: linkedOverview }), true);
  assert.equal(canPerformLendingOperation('prepare-revocation', { ...base, overview: linkedOverview, removeAllDelegatedSigners: null }), false);
});

test('lending operation gates bind actions to the linked wallet and keep owner withdrawals independent', () => {
  const now = Date.parse('2026-11-08T00:30:00.000Z');
  const overview = {
    status: 'READY',
    configuration: { walletProviderConfigured: true, executionEnabled: true, feeRecipient: configuration().feeRecipient, feeBps: 250 },
    walletLink: { providerWalletId: 'provider-wallet-id', walletAddress: 'Wallet11111111111111111111111111111111' },
    mandate: { id: 'mandate-1', data: { expiresAt: '2026-11-09T00:00:00.000Z', maxEvidenceAgeSeconds: 3600 } },
    delegation: { status: 'ACTIVE', signerId: 'falcon-signer', expiresAt: '2026-11-09T00:00:00.000Z' },
    portfolio: { status: 'OBSERVED', capturedAt: '2026-11-08T00:00:00.000Z', positions: [{ reserveAddress: 'Reserve11111111111111111111111111111111', redeemableBaseUnits: '1000', receiptDecimals: 6 }] },
    runner: { state: 'PAUSED' },
    accounting: { earnedFeeBaseUnits: '0' },
  };
  const context = {
    overview,
    now,
    sessionToken: 'session-token',
    sessionWallet: 'Wallet11111111111111111111111111111111',
    walletAddress: 'Wallet11111111111111111111111111111111',
    walletAuthenticated: true,
    walletReady: true,
    addSigners() {},
    removeAllDelegatedSigners() {},
    signTransaction() {},
  };

  assert.equal(canPerformLendingOperation('start', context), true);
  assert.equal(canPerformLendingOperation('start', { ...context, overview: { ...overview, delegation: { status: 'UNAVAILABLE' } } }), false);
  assert.equal(canPerformLendingOperation('start', { ...context, walletAddress: 'Wallet22222222222222222222222222222222' }), false);
  assert.equal(canPerformLendingOperation('start', { ...context, overview: { ...overview, mandate: { id: 'mandate-1', data: { expiresAt: '2026-11-08T00:00:00.000Z', maxEvidenceAgeSeconds: 3600 } } } }), false);
  assert.equal(canPerformLendingOperation('start', { ...context, overview: { ...overview, portfolio: { ...overview.portfolio, capturedAt: '2026-11-07T00:00:00.000Z' } } }), false);
  assert.equal(canPerformLendingOperation('pause', { ...context, overview: { ...overview, runner: { state: 'PAUSED' } } }), false);
  assert.equal(canPerformLendingOperation('pause', { ...context, overview: { ...overview, runner: { state: 'RUNNING' } } }), true);
  const running = { ...context, overview: { ...overview, runner: { state: 'RUNNING' } } };
  assert.equal(canPerformLendingOperation('pause', { ...running, uncertain: { operation: 'owner-signatures' } }), true);
  assert.equal(canPerformLendingOperation('pause', { ...running, uncertain: { operation: 'pause' } }), false);
  assert.equal(canPerformLendingOperation('pause', { ...running, uncertain: { operation: 'pause', refreshed: true } }), true);
  const unresolvedOverview = { ...overview, actions: [{ actionId: 'action-1', status: 'SUBMISSION_UNKNOWN' }] };
  assert.equal(canPerformLendingOperation('start', { ...context, overview: unresolvedOverview }), false);

  const withdrawalContext = {
    ...context,
    overview: { ...overview, configuration: { ...overview.configuration, executionEnabled: false }, delegation: { status: 'REVOKED' }, accounting: { earnedFeeBaseUnits: null }, runner: { state: 'STOPPED' } },
    selectedPosition: 'Reserve11111111111111111111111111111111',
    withdrawAmountBaseUnits: '1000',
  };
  assert.equal(canPerformLendingOperation('withdraw', withdrawalContext), true);
  assert.equal(canPerformLendingOperation('withdraw', { ...withdrawalContext, withdrawAmountBaseUnits: '1001' }), false);
  assert.equal(canPerformLendingOperation('fee-claim', withdrawalContext), false);
  const unresolvedWithdrawal = { ...withdrawalContext, overview: { ...withdrawalContext.overview, actions: [{ actionId: 'action-1', status: 'PENDING' }] } };
  assert.equal(canPerformLendingOperation('withdraw', unresolvedWithdrawal), false);
  assert.equal(canPerformLendingOperation('fee-claim', { ...context, overview: { ...overview, actions: [{ actionId: 'action-1', status: 'UNVERIFIED' }], accounting: { earnedFeeBaseUnits: '1' } } }), false);
  assert.equal(canPerformLendingOperation('fee-claim', { ...context, overview: { ...overview, accounting: { earnedFeeBaseUnits: '1' } } }), true);
});

test('all-signer revocation requires the reviewed dedicated-wallet scope and explicit confirmation', () => {
  const overview = {
    delegation: { status: 'ACTIVE', signerId: 'falcon-signer' },
    walletLink: { walletAddress: 'Wallet11111111111111111111111111111111' },
  };
  const base = {
    overview,
    sessionWallet: 'Wallet11111111111111111111111111111111',
    walletAddress: 'Wallet11111111111111111111111111111111',
    walletAuthenticated: true,
    walletReady: true,
    revocationPreview: {
      walletAddress: 'Wallet11111111111111111111111111111111',
      signerIds: ['falcon-signer', 'other-delegated-signer'],
      scope: 'ALL_DELEGATED_SIGNERS',
      warning: 'Every additional signer on this dedicated wallet will be removed.',
    },
    removeAllDelegatedSigners() {},
  };
  assert.equal(canPerformLendingOperation('remove-all-signers', { ...base, revocationConfirmed: false }), false);
  assert.equal(canPerformLendingOperation('remove-all-signers', { ...base, revocationConfirmed: true }), true);
  assert.equal(canPerformLendingOperation('remove-all-signers', {
    ...base,
    revocationConfirmed: true,
    revocationPreview: { ...base.revocationPreview, walletAddress: 'Wallet22222222222222222222222222222222' },
  }), false);
});
