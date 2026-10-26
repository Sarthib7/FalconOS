import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { Keypair } from '@solana/web3.js';
import { parseCfoConfig, createDevnetProofVerifier } from '../cfo/config.mjs';

const wallet = Keypair.generate().publicKey.toBase58();
const owner = 'wallet_' + 'a'.repeat(56);
const expiresAt = '2026-11-14T12:00:00.000Z';
const grant = () => ({ ownerId: owner, wallet, maxReserveBaseUnits: '1000000', expiresAt, devnetProofId: randomUUID() });

test('V200: an exact trial cannot change its owner, proof or expiry beyond the grant', () => {
  const approved = grant();
  const trial = { ownerId: owner, wallet, actionId: randomUUID(), quoteHash: 'a'.repeat(64), sourceAssetId: 'nep141:reserve.near', targetAssetId: 'nep141:receipt.near', inputBaseUnits: '1000', expiresAt, devnetProofId: approved.devnetProofId };
  const env = { FALCON_CFO_EXECUTION_GRANTS: JSON.stringify([approved]), FALCON_CFO_EXECUTION_TRIALS: JSON.stringify([trial]) };
  assert.equal(parseCfoConfig(env).executionTrials[0].actionId, trial.actionId);
  for (const change of [{ ownerId: 'wallet_' + 'b'.repeat(56) }, { devnetProofId: randomUUID() }, { expiresAt: '2026-11-15T12:00:00.000Z' }, { inputBaseUnits: '1.5' }, { arbitraryUrl: 'https://invalid.example' }]) {
    assert.throws(() => parseCfoConfig({ ...env, FALCON_CFO_EXECUTION_TRIALS: JSON.stringify([{ ...trial, ...change }]) }));
  }
  assert.throws(() => parseCfoConfig({ FALCON_CFO_EXECUTION_GRANTS: JSON.stringify([{ ...approved, maxReserveBaseUnits: '-1' }]) }));
  assert.throws(() => parseCfoConfig({ FALCON_CFO_PARTNER_API_KEY: 'key\r\nInjected: value' }));
});

test('V200: a proof UUID alone cannot authorize mainnet relay', async () => {
  const verify = createDevnetProofVerifier({ cfoStore: { get: async () => null }, lending: { get: async () => { throw Error('Must not read absent proof'); } } });
  assert.equal(await verify({ owner, wallet, proofId: randomUUID() }), false);
});

test('V200: Devnet proof binds two confirmed owner actions and exact independent Explorer observations', async () => {
  const supplyId = randomUUID(), redeemId = randomUUID(), proofId = randomUUID();
  const signatures = ['2'.repeat(88), '3'.repeat(88)];
  const evidence = signatures.map((signature, index) => ({ signature, url: `https://explorer.solana.com/tx/${signature}?cluster=devnet`, capturedAt: '2026-10-26T12:00:00.000Z', slot: 100 + index, status: 'confirmed', contentSha256: String(index + 1).repeat(64) }));
  const proof = { kind: 'devnet-proof', data: { wallet, supplyIntentId: supplyId, redeemIntentId: redeemId, explorerEvidence: evidence } };
  const records = new Map([supplyId, redeemId].map((id, index) => [id, { record: { intent: { wallet, network: 'devnet', action: index === 0 ? 'supply' : 'redeem' } }, events: [{ kind: 'SUBMITTED', data: { signature: signatures[index] } }, { kind: 'RECEIPT', data: { status: 'CONFIRMED', signature: signatures[index], slot: 100 + index, amounts: { liquidityBaseUnits: '500000', receiptBaseUnits: '450000' } } }] }]));
  const verify = createDevnetProofVerifier({ cfoStore: { get: async (requestedOwner, id) => requestedOwner === owner && id === proofId ? proof : null }, lending: { get: async (requestedOwner, id) => requestedOwner === owner ? records.get(id) : null } });
  assert.equal(await verify({ owner, wallet, proofId }), true);
  assert.equal(await verify({ owner: 'wallet_' + 'b'.repeat(56), wallet, proofId }), false);
  evidence[1].slot = 500;
  assert.equal(await verify({ owner, wallet, proofId }), false);
  evidence[1].slot = 101;
  records.get(redeemId).events[1].data.status = 'PENDING';
  assert.equal(await verify({ owner, wallet, proofId }), false);
  records.get(redeemId).events[1].data.status = 'CONFIRMED';
  evidence[1].url = `https://explorer.solana.com/tx/${signatures[1]}?cluster=mainnet-beta`;
  assert.equal(await verify({ owner, wallet, proofId }), false);
});
