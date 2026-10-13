import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import bs58 from 'bs58';
import { projectVerifiedPreflight } from '../src/preflight.mjs';

const WALLET = '9xQeWvG816bUx9EPjHmaT23yvVM2ZWbrrpZb9PusVFin';
const OTHER = '11111111111111111111111111111111';
const GENESIS = 'EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG';
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const NOW = Date.parse('2026-10-13T12:00:00.000Z');
const at = offset => new Date(NOW + offset).toISOString();
function fixture() {
  // Canonical legacy transaction framing. The instruction decoder is a separate interface.
  const message = Buffer.concat([Buffer.from([1, 0, 0, 1]), Buffer.from(bs58.decode(WALLET)), Buffer.alloc(32), Buffer.from([0])]);
  const bytes = Buffer.concat([Buffer.from([1]), Buffer.alloc(64), message]);
  const preflight = {
    schemaVersion: 1, status: 'VERIFIED', verification: 'falcon-rpc', messageSha256: hash(message), checkedAt: at(-20),
    network: { chain: 'solana', network: 'devnet', genesisHash: GENESIS, rpcHost: 'api.devnet.solana.com', snapshotSlot: 100 },
    simulation: { slot: 101, err: null, unitsConsumed: 1000, liquidityDeltaBaseUnits: '-500000', receiptDeltaBaseUnits: '450000', vaultLiquidityDeltaBaseUnits: '500000' },
    costs: { feeLamports: '5000', feeQuoteSlot: 101, rentLamports: '0', totalSolLamports: '5000', walletSolBalanceLamports: '10000000', destinationAta: OTHER, createsDestinationAta: false, accountSize: 165 },
    validity: { blockhash: OTHER, lastValidBlockHeight: 200, observedBlockHeight: 199, oraclePublishTime: at(-1000), oracleExpiresAt: at(119000), intentExpiresAt: at(120000), decisionExpiresAt: at(80000), expiresAt: at(80000) },
  };
  const intent = { action: 'supply', wallet: WALLET, inputBaseUnits: '500000', transactionBase64: bytes.toString('base64'), messageSha256: hash(message), preflight };
  const context = { now: NOW + 10, createdAt: at(0), action: 'supply', wallet: WALLET, amountBaseUnits: '500000', decisionId: 'decision', storedDecisionId: 'decision' };
  return { intent, context, bytes };
}

test('V173: commit-time intent ceiling does not reject a quote completed before persistence', () => {
  const { intent, context } = fixture();
  const result = projectVerifiedPreflight(intent, context);
  assert.ok(result, 'a 20ms quote-to-commit interval must not invalidate a real 120-second intent ceiling');
  assert.equal(result.validity.intentExpiresAt, at(120000));
});

test('V171,V172: malformed, signed or noncanonical transaction framing cannot claim verified unsigned preflight', () => {
  const malformed = fixture();
  const message = Buffer.from([1, 0, 0, 0]);
  malformed.intent.transactionBase64 = Buffer.concat([Buffer.from([1]), Buffer.alloc(64), message]).toString('base64');
  malformed.intent.messageSha256 = malformed.intent.preflight.messageSha256 = hash(message);
  assert.equal(projectVerifiedPreflight(malformed.intent, malformed.context), null);
  const signed = fixture(); signed.bytes[1] = 1; signed.intent.transactionBase64 = signed.bytes.toString('base64');
  assert.equal(projectVerifiedPreflight(signed.intent, signed.context), null);
  const noncanonical = fixture(); noncanonical.intent.transactionBase64 = Buffer.concat([Buffer.from([0x81, 0]), noncanonical.bytes.subarray(1)]).toString('base64');
  assert.equal(projectVerifiedPreflight(noncanonical.intent, noncanonical.context), null);
});

test('V171,V172: preflight signer, blockhash and token effects must match the requested transaction context', () => {
  const wrongSigner = fixture(); wrongSigner.intent.wallet = wrongSigner.context.wallet = OTHER;
  assert.equal(projectVerifiedPreflight(wrongSigner.intent, wrongSigner.context), null);
  const wrongBlockhash = fixture(); wrongBlockhash.intent.preflight.validity.blockhash = WALLET;
  assert.equal(projectVerifiedPreflight(wrongBlockhash.intent, wrongBlockhash.context), null);
  for (const effects of [
    { liquidityDeltaBaseUnits: '0', receiptDeltaBaseUnits: '0', vaultLiquidityDeltaBaseUnits: '0' },
    { liquidityDeltaBaseUnits: '-500001', receiptDeltaBaseUnits: '450000', vaultLiquidityDeltaBaseUnits: '500001' },
    { liquidityDeltaBaseUnits: '-500000', receiptDeltaBaseUnits: '450000', vaultLiquidityDeltaBaseUnits: '1' },
  ]) {
    const f = fixture(); Object.assign(f.intent.preflight.simulation, effects);
    assert.equal(projectVerifiedPreflight(f.intent, f.context), null);
  }
});
