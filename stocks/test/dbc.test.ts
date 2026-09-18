import assert from 'node:assert/strict';
import test from 'node:test';
import {
  DBC_PROGRAM_ID,
  STOCK_USDC_MIGRATION_THRESHOLD_UNITS,
  USDC_MINT,
  WSOL_MINT,
  buildEquityDbcLaunch,
  evaluateDbcLaunch,
  prestocksBasketDbcPlan,
} from '../dbc.ts';

test('V71: equity DBC launch binds program id, USDC quote, and stock keeper floor', () => {
  const prescription = buildEquityDbcLaunch({
    label: 'PreStocks OPENAI sleeve',
    underlying: 'OPENAI',
    initialMarketCapUsd: '250000',
    migrationMarketCapUsd: '2500000',
  });

  assert.equal(prescription.programId, DBC_PROGRAM_ID);
  assert.equal(prescription.quoteMint, USDC_MINT);
  assert.equal(prescription.quoteKind, 'usdc');
  assert.equal(prescription.tokenType, 'token2022');
  assert.equal(prescription.migrationTarget, 'damm-v2');
  assert.equal(prescription.migrationQuoteThresholdUnits, STOCK_USDC_MIGRATION_THRESHOLD_UNITS);
  assert.equal(prescription.authority, 'advisory-only');
  assert.equal(prescription.executionReady, false);
  assert.match(prescription.hash, /^[a-f0-9]{64}$/);
  assert.equal(Object.isFrozen(prescription), true);

  const evaluation = evaluateDbcLaunch(prescription);
  assert.equal(evaluation.status, 'READY');
  assert.equal(evaluation.fit, 'equity-grade');
  assert.equal(evaluation.prescriptionHash, prescription.hash);
  assert.equal(evaluation.refusalCodes.length, 0);
  assert.ok(evaluation.scoreBps >= 9000);
});

test('V71: meme-grade fee + non-USDC quote is rejected for stock launches', () => {
  const prescription = buildEquityDbcLaunch({
    label: 'meme stock spoof',
    underlying: 'MEME',
    quoteMint: WSOL_MINT,
    migrationQuoteThresholdUnits: '1000000',
    initialMarketCapUsd: '10',
    migrationMarketCapUsd: '100',
    fee: {
      mode: 'scheduler-exponential',
      startingFeeBps: 9000,
      endingFeeBps: 20,
      numberOfPeriod: 60,
      totalDuration: 3600,
    },
  });

  const evaluation = evaluateDbcLaunch(prescription);
  assert.equal(evaluation.status, 'REJECT');
  assert.equal(evaluation.fit, 'unsuitable');
  assert.ok(evaluation.refusalCodes.includes('quote-not-usdc'));
  assert.ok(evaluation.refusalCodes.includes('migration-threshold-below-stock-floor'));
  assert.ok(evaluation.refusalCodes.includes('meme-fee-schedule'));
});

test('V71: PreStocks basket plan returns frozen OPENAI and SPACEX sleeves', () => {
  const plan = prestocksBasketDbcPlan();
  assert.equal(plan.length, 2);
  assert.deepEqual(plan.map(item => item.underlying), ['OPENAI', 'SPACEX']);
  for (const item of plan) {
    assert.equal(evaluateDbcLaunch(item).status, 'READY');
  }
});

test('V71: inverted market caps are refused', () => {
  const prescription = buildEquityDbcLaunch({
    label: 'broken curve',
    underlying: 'OPENAI',
    initialMarketCapUsd: '5000000',
    migrationMarketCapUsd: '100000',
  });
  const evaluation = evaluateDbcLaunch(prescription);
  assert.equal(evaluation.status, 'REJECT');
  assert.ok(evaluation.refusalCodes.includes('market-cap-not-progressing'));
});
