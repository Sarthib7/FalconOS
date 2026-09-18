import { createHash } from 'node:crypto';

// Meteora Dynamic Bonding Curve (DBC) advisory desk for Stocklana.
// Program and keeper facts verified from https://docs.meteora.ag/developer-guides/dbc (2026-09-18).
// This module emits non-binding launch prescriptions only. It does not create configs,
// sign transactions, submit swaps, or migrate pools.

export const DBC_SCHEMA_VERSION = 1 as const;
export const DBC_PROGRAM_ID = 'dbcij3LWUppWqq96dh6gJWwBifmcGfLSB5D4DuSMaqN' as const;
export const DBC_POOL_AUTHORITY = 'FhVo3mqL8PW5pH5U2CN4XE33DokiyZnUwuGpH2hmHLuM' as const;
export const USDC_MINT = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v' as const;
export const WSOL_MINT = 'So11111111111111111111111111111111111111112' as const;

// Keeper-compatible USDC migration threshold: 750 USDC with 6 decimals.
export const STOCK_USDC_MIGRATION_THRESHOLD_UNITS = '750000000' as const;

export type DbcTokenType = 'spl' | 'token2022';
export type DbcMigrationTarget = 'damm-v1' | 'damm-v2';
export type DbcFeeMode = 'fixed' | 'scheduler-linear' | 'scheduler-exponential';
export type DbcQuoteKind = 'usdc' | 'wsol' | 'other';
export type DbcLaunchStatus = 'READY' | 'REJECT' | 'REVIEW';
export type DbcFitLabel = 'equity-grade' | 'meme-grade' | 'unsuitable';

export interface DbcFeeSchedule {
  mode: DbcFeeMode;
  startingFeeBps: number;
  endingFeeBps: number;
  numberOfPeriod: number;
  totalDuration: number;
}

export interface DbcLaunchPrescription {
  schemaVersion: typeof DBC_SCHEMA_VERSION;
  kind: 'stocks.dbc-launch';
  programId: typeof DBC_PROGRAM_ID;
  poolAuthority: typeof DBC_POOL_AUTHORITY;
  label: string;
  underlying: string;
  quoteMint: string;
  quoteKind: DbcQuoteKind;
  tokenType: DbcTokenType;
  tokenDecimals: number;
  quoteDecimals: number;
  totalTokenSupply: string;
  initialMarketCapUsd: string;
  migrationMarketCapUsd: string;
  migrationQuoteThresholdUnits: string;
  migrationTarget: DbcMigrationTarget;
  migrationFeeBps: number;
  fee: DbcFeeSchedule;
  rationale: readonly string[];
  authority: 'advisory-only';
  executionReady: false;
  hash: string;
}

export interface DbcLaunchEvaluation {
  schemaVersion: typeof DBC_SCHEMA_VERSION;
  kind: 'stocks.dbc-evaluation';
  status: DbcLaunchStatus;
  fit: DbcFitLabel;
  prescriptionHash: string | null;
  scoreBps: number;
  checks: readonly { code: string; pass: boolean; detail: string }[];
  refusalCodes: readonly string[];
  warnings: readonly string[];
  authority: 'advisory-only';
  executionReady: false;
}

export interface EquityLaunchInput {
  label: string;
  underlying: string;
  quoteMint?: string;
  tokenType?: DbcTokenType;
  tokenDecimals?: number;
  quoteDecimals?: number;
  totalTokenSupply?: string;
  initialMarketCapUsd: string;
  migrationMarketCapUsd: string;
  migrationQuoteThresholdUnits?: string;
  migrationTarget?: DbcMigrationTarget;
  migrationFeeBps?: number;
  fee?: Partial<DbcFeeSchedule>;
}

const POSITIVE_DECIMAL = /^(?:0|[1-9]\d*)(?:\.\d+)?$/;
const POSITIVE_INT = /^[1-9]\d*$/;
const NON_EMPTY = /\S/;

function stableStringify(value: unknown): string {
  if (value === null || typeof value === 'string' || typeof value === 'boolean' || typeof value === 'number') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  const object = value as Record<string, unknown>;
  return `{${Object.keys(object).sort().map(key => `${JSON.stringify(key)}:${stableStringify(object[key])}`).join(',')}}`;
}

function hashObject(value: unknown): string {
  return createHash('sha256').update(stableStringify(value)).digest('hex');
}

function requirePositiveDecimal(value: string, name: string): string {
  if (!POSITIVE_DECIMAL.test(value) || Number(value) <= 0) throw new TypeError(`${name} must be a positive decimal string`);
  return value;
}

function requirePositiveIntString(value: string, name: string): string {
  if (!POSITIVE_INT.test(value)) throw new TypeError(`${name} must be a positive integer string`);
  return value;
}

function requireBps(value: number, name: string): number {
  if (!Number.isInteger(value) || value < 0 || value > 10_000) throw new TypeError(`${name} must be an integer bps from 0 to 10000`);
  return value;
}

function quoteKindFor(mint: string): DbcQuoteKind {
  if (mint === USDC_MINT) return 'usdc';
  if (mint === WSOL_MINT) return 'wsol';
  return 'other';
}

function defaultEquityFee(): DbcFeeSchedule {
  // Equity-like discovery: elevated opening fee that decays to a DAMM-v2-friendly 30 bps.
  // Contrasts with meme launches that open near 9000 bps.
  return {
    mode: 'scheduler-linear',
    startingFeeBps: 200,
    endingFeeBps: 30,
    numberOfPeriod: 24,
    totalDuration: 86_400,
  };
}

export function buildEquityDbcLaunch(input: EquityLaunchInput): DbcLaunchPrescription {
  if (!NON_EMPTY.test(input.label)) throw new TypeError('label must be non-empty');
  if (!NON_EMPTY.test(input.underlying)) throw new TypeError('underlying must be non-empty');
  const quoteMint = input.quoteMint ?? USDC_MINT;
  const fee = { ...defaultEquityFee(), ...input.fee };
  requireBps(fee.startingFeeBps, 'startingFeeBps');
  requireBps(fee.endingFeeBps, 'endingFeeBps');
  if (!Number.isInteger(fee.numberOfPeriod) || fee.numberOfPeriod < 0) throw new TypeError('numberOfPeriod must be a non-negative integer');
  if (!Number.isInteger(fee.totalDuration) || fee.totalDuration < 0) throw new TypeError('totalDuration must be a non-negative integer');
  if (fee.mode !== 'fixed' && fee.mode !== 'scheduler-linear' && fee.mode !== 'scheduler-exponential') {
    throw new TypeError('fee mode is invalid');
  }

  const tokenDecimals = input.tokenDecimals ?? 6;
  const quoteDecimals = input.quoteDecimals ?? (quoteMint === USDC_MINT ? 6 : 9);
  if (!Number.isInteger(tokenDecimals) || tokenDecimals < 0 || tokenDecimals > 9) throw new TypeError('tokenDecimals out of range');
  if (!Number.isInteger(quoteDecimals) || quoteDecimals < 0 || quoteDecimals > 9) throw new TypeError('quoteDecimals out of range');

  const migrationTarget = input.migrationTarget ?? 'damm-v2';
  if (migrationTarget !== 'damm-v1' && migrationTarget !== 'damm-v2') throw new TypeError('migrationTarget is invalid');
  const tokenType = input.tokenType ?? 'token2022';
  if (tokenType !== 'spl' && tokenType !== 'token2022') throw new TypeError('tokenType is invalid');

  const migrationQuoteThresholdUnits = requirePositiveIntString(input.migrationQuoteThresholdUnits ?? STOCK_USDC_MIGRATION_THRESHOLD_UNITS, 'migrationQuoteThresholdUnits');
  const thresholdMeetsFloor = compareUnits(migrationQuoteThresholdUnits, STOCK_USDC_MIGRATION_THRESHOLD_UNITS) >= 0;
  const selectedQuoteMint = quoteMint;
  const selectedQuoteKind = quoteKindFor(selectedQuoteMint);

  const body = {
    schemaVersion: DBC_SCHEMA_VERSION,
    kind: 'stocks.dbc-launch' as const,
    programId: DBC_PROGRAM_ID,
    poolAuthority: DBC_POOL_AUTHORITY,
    label: input.label.trim(),
    underlying: input.underlying.trim(),
    quoteMint: selectedQuoteMint,
    quoteKind: selectedQuoteKind,
    tokenType,
    tokenDecimals,
    quoteDecimals,
    totalTokenSupply: requirePositiveIntString(input.totalTokenSupply ?? '1000000000', 'totalTokenSupply'),
    initialMarketCapUsd: requirePositiveDecimal(input.initialMarketCapUsd, 'initialMarketCapUsd'),
    migrationMarketCapUsd: requirePositiveDecimal(input.migrationMarketCapUsd, 'migrationMarketCapUsd'),
    migrationQuoteThresholdUnits,
    migrationTarget,
    migrationFeeBps: requireBps(input.migrationFeeBps ?? 30, 'migrationFeeBps'),
    fee: Object.freeze({ ...fee }),
    rationale: Object.freeze([
      selectedQuoteKind === 'usdc'
        ? 'USDC quote keeps migration notional in USD terms used by Meteora stock-token keepers.'
        : `Quote kind ${selectedQuoteKind} is recorded; equity-grade stock launches prefer USDC.`,
      thresholdMeetsFloor
        ? `migrationQuoteThresholdUnits=${migrationQuoteThresholdUnits} meets the documented >=750 USD stock-token keeper floor.`
        : `migrationQuoteThresholdUnits=${migrationQuoteThresholdUnits} is below the documented >=750 USD stock-token keeper floor.`,
      tokenType === 'token2022'
        ? 'Token-2022 matches current PreStocks mint extensions (scaled UI + transfer fee).'
        : 'SPL token type is allowed by DBC but PreStocks sleeves prefer Token-2022.',
      'Fee scheduler opens elevated for thin pre-IPO discovery, then decays toward DAMM v2 spot fees.',
      migrationTarget === 'damm-v2'
        ? 'DAMM v2 graduation is the supported path for new DBC configs.'
        : 'DAMM v1 migration is legacy; new equity sleeves should target DAMM v2.',
    ]),
    authority: 'advisory-only' as const,
    executionReady: false as const,
  };

  return Object.freeze({
    ...body,
    hash: hashObject(body),
  });
}

function compareUnits(a: string, b: string): number {
  const left = BigInt(a);
  const right = BigInt(b);
  if (left === right) return 0;
  return left < right ? -1 : 1;
}

export function evaluateDbcLaunch(prescription: DbcLaunchPrescription): DbcLaunchEvaluation {
  if (prescription.schemaVersion !== DBC_SCHEMA_VERSION) throw new TypeError('dbc schemaVersion mismatch');
  if (prescription.kind !== 'stocks.dbc-launch') throw new TypeError('dbc kind mismatch');
  if (prescription.authority !== 'advisory-only' || prescription.executionReady !== false) {
    throw new TypeError('dbc prescription must remain advisory-only');
  }
  if (prescription.programId !== DBC_PROGRAM_ID) throw new TypeError('unexpected DBC program id');

  const checks: { code: string; pass: boolean; detail: string }[] = [];
  const refusalCodes: string[] = [];
  const warnings: string[] = [];
  let score = 0;

  const quoteOk = prescription.quoteKind === 'usdc';
  checks.push({ code: 'quote-usdc', pass: quoteOk, detail: quoteOk ? 'quote mint is USDC' : `quote kind is ${prescription.quoteKind}` });
  if (quoteOk) score += 2500; else refusalCodes.push('quote-not-usdc');

  const thresholdOk = compareUnits(prescription.migrationQuoteThresholdUnits, STOCK_USDC_MIGRATION_THRESHOLD_UNITS) >= 0;
  checks.push({
    code: 'migration-threshold',
    pass: thresholdOk,
    detail: thresholdOk
      ? `threshold ${prescription.migrationQuoteThresholdUnits} meets stock keeper floor ${STOCK_USDC_MIGRATION_THRESHOLD_UNITS}`
      : `threshold ${prescription.migrationQuoteThresholdUnits} is below stock keeper floor ${STOCK_USDC_MIGRATION_THRESHOLD_UNITS}`,
  });
  if (thresholdOk) score += 2500; else refusalCodes.push('migration-threshold-below-stock-floor');

  const tokenOk = prescription.tokenType === 'token2022';
  checks.push({ code: 'token-2022', pass: tokenOk, detail: tokenOk ? 'token type is Token-2022' : `token type is ${prescription.tokenType}` });
  if (tokenOk) score += 1500; else warnings.push('prefer-token-2022-for-prestocks');

  const migrationOk = prescription.migrationTarget === 'damm-v2';
  checks.push({ code: 'damm-v2', pass: migrationOk, detail: migrationOk ? 'migration target is DAMM v2' : `migration target is ${prescription.migrationTarget}` });
  if (migrationOk) score += 1500; else refusalCodes.push('migration-not-damm-v2');

  const start = prescription.fee.startingFeeBps;
  const end = prescription.fee.endingFeeBps;
  const equityFee = start <= 500 && end <= 100 && start >= end;
  const memeFee = start >= 2000;
  checks.push({
    code: 'equity-fee-band',
    pass: equityFee,
    detail: equityFee
      ? `fee schedule ${start}->${end} bps fits equity discovery`
      : `fee schedule ${start}->${end} bps looks meme-grade or inverted`,
  });
  if (equityFee) score += 2000;
  else if (memeFee) refusalCodes.push('meme-fee-schedule');
  else warnings.push('fee-schedule-outside-equity-band');

  const marketCapOk = Number(prescription.migrationMarketCapUsd) > Number(prescription.initialMarketCapUsd);
  checks.push({
    code: 'market-cap-progress',
    pass: marketCapOk,
    detail: marketCapOk
      ? `migration market cap ${prescription.migrationMarketCapUsd} exceeds initial ${prescription.initialMarketCapUsd}`
      : 'migration market cap must exceed initial market cap',
  });
  if (!marketCapOk) refusalCodes.push('market-cap-not-progressing');

  let fit: DbcFitLabel = 'equity-grade';
  if (memeFee || refusalCodes.includes('quote-not-usdc')) fit = 'meme-grade';
  if (refusalCodes.length >= 2 || refusalCodes.includes('migration-threshold-below-stock-floor')) fit = 'unsuitable';

  let status: DbcLaunchStatus = 'READY';
  if (refusalCodes.length > 0 && score >= 5000) status = 'REVIEW';
  if (refusalCodes.includes('migration-threshold-below-stock-floor') || refusalCodes.includes('migration-not-damm-v2') || refusalCodes.includes('market-cap-not-progressing')) {
    status = 'REJECT';
  }
  if (refusalCodes.includes('meme-fee-schedule') && !quoteOk) status = 'REJECT';

  return Object.freeze({
    schemaVersion: DBC_SCHEMA_VERSION,
    kind: 'stocks.dbc-evaluation' as const,
    status,
    fit,
    prescriptionHash: prescription.hash,
    scoreBps: Math.min(10_000, score),
    checks: Object.freeze(checks),
    refusalCodes: Object.freeze([...new Set(refusalCodes)]),
    warnings: Object.freeze(warnings),
    authority: 'advisory-only' as const,
    executionReady: false as const,
  });
}

export function prestocksBasketDbcPlan(): readonly DbcLaunchPrescription[] {
  // Notionals are illustrative USD market-cap targets for sleeve launches, not live marks.
  return Object.freeze([
    buildEquityDbcLaunch({
      label: 'PreStocks OPENAI sleeve',
      underlying: 'OPENAI',
      initialMarketCapUsd: '250000',
      migrationMarketCapUsd: '2500000',
    }),
    buildEquityDbcLaunch({
      label: 'PreStocks SPACEX sleeve',
      underlying: 'SPACEX',
      initialMarketCapUsd: '250000',
      migrationMarketCapUsd: '2500000',
    }),
  ]);
}
