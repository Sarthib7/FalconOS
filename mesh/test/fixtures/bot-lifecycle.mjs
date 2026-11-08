import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { Keypair } from '@solana/web3.js';
import { deriveWalletOwnerId } from '../../wallet-auth.mjs';
import { createLendingJournal, recordHash } from '../../cfo/lifecycle.mjs';
import { createLendingBotService } from '../../cfo/lending-bot.mjs';
import { COUNCIL_MODEL, COUNCIL_POLICY_VERSION, COUNCIL_REASONING_EFFORT } from '../../council/host.mjs';

// This fixture exercises durable lifecycle rules, not provider or chain readiness.
export function lifecycleFixture(pool, { blockLead = null, grantMaxCalls = 8, mandateMaxCalls = 8 } = {}) {
  const wallet = Keypair.generate().publicKey.toBase58();
  const owner = deriveWalletOwnerId(wallet);
  const mint = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
  const reserves = [0, 1].map(() => ({ reserveAddress: Keypair.generate().publicKey.toBase58(),
    marketAddress: Keypair.generate().publicKey.toBase58(), receiptMint: Keypair.generate().publicKey.toBase58(), mint }));
  const recipient = Keypair.generate().publicKey.toBase58();
  const calls = { sign: 0, submit: 0, prepare: 0, capture: 0, roles: [], durableAtSend: null };
  let installed = true;
  let confirmed = false;
  let expired = false;
  let slot = 100;
  let cash = 1000000000n;
  const receipts = [0n, 0n];
  let signedPrepared = null;
  const at = () => new Date().toISOString();
  const signature = 'fixture-signature-' + randomUUID();
  const signedTransactionBase64 = Buffer.from('fixture-exact-signed-message').toString('base64');
  const grant = { ownerId: owner, wallet, expiresAt: new Date(Date.now() + 3600000).toISOString(), maxCalls: grantMaxCalls };
  const config = { executionEnabled: true, feeBps: 1000, feeRecipient: recipient,
    reviewGrants: [{ ...grant, grantId: recordHash(grant) }] };
  const journal = createLendingJournal(pool);
  const adapter = {
    async capture() {
      calls.capture += 1;
      const observedAt = at();
      return { schemaVersion: 1, chain: 'solana', network: 'mainnet-beta', wallet, status: 'OBSERVED',
        capturedAt: observedAt, observedAt, slot: ++slot, nativeLamports: '1000000000', cashBaseUnits: cash.toString(),
        associatedAccountRentLamports: '200', nativePriceUsdMicros: '150000000', usdcPriceUsdMicros: '1000000',
        nativePriceObservedAt: observedAt, usdcPriceObservedAt: observedAt,
        positions: reserves.map((reserve, index) => ({ ...reserve, receiptDecimals: 6,
          receiptBaseUnits: receipts[index].toString(), usdcValueBaseUnits: receipts[index].toString(),
          redeemableBaseUnits: receipts[index].toString(), availableLiquidityBaseUnits: '10000000000',
          supplyApyBps: index ? 1000 : 500, observedAt, slot })), issues: [] };
    },
    async prepare(input) {
      calls.prepare += 1;
      const observedAt = at();
      return { schemaVersion: 1, chain: 'solana', network: 'mainnet-beta', wallet, action: input.action,
        reserveAddress: input.reserveAddress, amountBaseUnits: input.amountBaseUnits,
        amountUnit: input.action === 'redeem' ? 'receipt-base-units' : 'usdc-base-units', recipient: wallet,
        transactionBase64: Buffer.from(JSON.stringify(input)).toString('base64'), messageSha256: recordHash(input), signature: null,
        blockhash: 'fixture-blockhash', lastValidBlockHeight: 1000, observedAt,
        expiresAt: new Date(Date.now() + 60000).toISOString(), feeLamports: '100', rentLamports: '0', maxTotalCostUsdcBaseUnits: '15',
        expectedEffects: { usdcDebitBaseUnits: input.action === 'supply' ? input.amountBaseUnits : '0',
          usdcCreditBaseUnits: input.action === 'redeem' ? input.amountBaseUnits : '0',
          receiptDebitBaseUnits: input.action === 'redeem' ? input.amountBaseUnits : '0',
          receiptCreditBaseUnits: input.action === 'supply' ? input.amountBaseUnits : '0' },
        source: { slot, programId: 'fixture-lending-program', adapterVersion: 'fixture' } };
    },
    async prepareFeeTransfer({ recipient: to, amountBaseUnits }) {
      const prepared = await adapter.prepare({ wallet, action: 'fee', reserveAddress: null, amountBaseUnits });
      return { ...prepared, amountUnit: 'usdc-base-units', recipient: to,
        expectedEffects: { usdcDebitBaseUnits: amountBaseUnits, usdcCreditBaseUnits: '0', receiptDebitBaseUnits: '0', receiptCreditBaseUnits: '0' } };
    },
    async verifySigned({ prepared, signedTransactionBase64: bytes }) {
      assert.equal(bytes, signedTransactionBase64);
      signedPrepared = prepared;
      return { signature, signedTransactionBase64: bytes, messageSha256: prepared.messageSha256 };
    },
    async submit({ prepared, signedTransactionBase64: bytes }) {
      calls.submit += 1;
      const retained = await pool.query(`SELECT analysis->'data' AS data FROM falcon_mesh.analyses
        WHERE owner_id=$1 AND analysis->>'recordKind'='cfo/lending-action/1'
        ORDER BY (analysis->>'sequence')::bigint DESC LIMIT 1`, [owner]);
      calls.durableAtSend = retained.rows[0]?.data;
      assert.equal(calls.durableAtSend.status, 'SUBMISSION_UNKNOWN');
      assert.equal(calls.durableAtSend.signature, signature);
      assert.equal(calls.durableAtSend.signedTransactionBase64, bytes);
      assert.deepEqual(calls.durableAtSend.prepared, prepared);
      if (!confirmed) {
        const index = reserves.findIndex(reserve => reserve.reserveAddress === prepared.reserveAddress);
        const amount = BigInt(prepared.amountBaseUnits);
        if (prepared.action === 'supply') { cash -= amount; receipts[index] += amount; }
        if (prepared.action === 'redeem') { cash += amount; receipts[index] -= amount; }
        if (prepared.action === 'fee') cash -= amount;
      }
      throw new Error('Fixture loses the RPC reply after delivery.');
    },
    async reconcile({ prepared }) {
      if (!confirmed) return { status: 'PENDING', signature, slot: null, amounts: null, reason: 'Fixture has no finalized evidence yet.' };
      assert.deepEqual(prepared, signedPrepared);
      return { status: 'CONFIRMED', signature, slot, amounts: { ...prepared.expectedEffects,
        feeLamports: '100', costUsdcBaseUnits: '15' }, reason: null };
    },
    async policyRules() { return [{ fixture: 'exact-scope-controlled-by-separate-provider-tests' }]; },
    async isExpired() { return expired; },
  };
  const provider = {
    configuration() { return { configured: true, appId: 'fixture-app', signerId: 'fixture-signer', issues: [] }; },
    async verifyWalletLink() { return { providerWalletId: 'fixture-wallet', walletAddress: wallet, userId: 'fixture-customer', ownerId: 'fixture-owner-quorum' }; },
    async prepareDelegation({ mandate }) { return { policyIds: ['fixture-policy'], policyHash: recordHash(mandate),
      signerId: 'fixture-signer', expiresAt: mandate.expiresAt, summary: ['Fixture signer scope.'] }; },
    async verifyDelegation({ delegation }) { return { status: installed ? 'ACTIVE' : 'REVOKED', policyHash: delegation.policyHash, reason: null }; },
    async signTransaction() { calls.sign += 1; return { signedTransactionBase64 }; },
    async prepareRevocation() { return { walletAddress: wallet, signerIds: installed ? ['fixture-signer'] : [], scope: 'ALL_DELEGATED_SIGNERS', warning: 'Remove every delegated signer from this fixture wallet.' }; },
    async revokeDelegation() {
      if (installed) { const error = new Error('Fixture signer still installed.'); error.code = 'CONFLICT'; throw error; }
      return { status: 'REVOKED', policyHash: null, reason: null };
    },
  };
  const transport = {
    async preflight() { return { schemaVersion: 2, policyVersion: COUNCIL_POLICY_VERSION, status: 'VERIFIED', checkedAt: at(),
      sdkVersion: '18.12.5', provider: 'openai-codex', modelId: COUNCIL_MODEL, api: 'openai-codex-responses',
      effort: COUNCIL_REASONING_EFFORT, endpoint: 'https://chatgpt.com/backend-api/codex/responses', transportMode: 'sse-only',
      bodyAudit: 'PASS', payloadObservationCount: 1, fetchFenceCallCount: 0, providerDispatchCount: 0, reasons: [] }; },
    async call(request) {
      calls.roles.push(request.role);
      if (request.role === 'lead' && blockLead) await blockLead(request);
      const base = { schemaVersion: 1, role: request.role, runId: request.runId, callId: request.callId,
        snapshotHash: request.snapshotHash, proposalHash: request.proposal.hash,
        citations: [{ ...request.sourceRefs[0], supports: 'Fixture source binds the owner mandate.' }], missingEvidence: [], executionReady: false };
      return request.role === 'lead' ? { ...base, status: 'PROPOSED', thesis: 'Fixture bounded allocation.', counterCase: 'Protocol and liquidity risk remain.' }
        : { ...base, status: 'PASS', reason: 'Fixture risk accepts only the frozen proposal.' };
    },
  };
  function makeService() { return createLendingBotService({ journal: createLendingJournal(pool), adapter, walletProvider: provider,
    reviewTransport: transport, config, reserves }); }
  const service = makeService();
  async function setup() {
    await service.linkWallet(owner, wallet, { requestId: randomUUID(), accessToken: 'fixture-customer-jwt' });
    await service.saveMandate(owner, wallet, { requestId: randomUUID(), mandate: { schemaVersion: 1,
      capitalCapBaseUnits: '1000000000', reserveFloorBaseUnits: '100000000', maxActionBaseUnits: '200000000',
      maxPositionBps: 5000, maxFeeLamports: '100', maxEvidenceAgeSeconds: 300, minHoldingSeconds: 31536000,
      minNetBenefitBaseUnits: '1000', cooldownSeconds: 60, feeBps: 1000, feeRecipient: recipient,
      reserves: reserves.map(reserve => reserve.reserveAddress), expiresAt: new Date(Date.now() + 3600000).toISOString(),
      monitorIntervalSeconds: 15, maxReviewCalls: mandateMaxCalls } });
    await service.prepareDelegation(owner, wallet, { requestId: randomUUID(), accessToken: 'fixture-customer-jwt' });
    await service.verifyDelegation(owner, wallet, { requestId: randomUUID() });
    await service.capture(owner, wallet, { requestId: randomUUID() });
  }
  return { pool, owner, wallet, calls, journal, adapter, provider, config, reserves, service, makeService, setup,
    confirm() { confirmed = true; }, removeSigners() { installed = false; }, expire() { expired = true; },
    setCash(value) { cash = BigInt(value); }, signedTransactionBase64 };
}
