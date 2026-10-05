export const DECIMAL_USDC = /^(0|[1-9]\d*)(\.\d{1,6})?$/;
const U64_MAX = 18446744073709551615n;

export class AmountError extends Error {}

// Decimal USDC string -> base-unit integer string (6 decimals). BigInt only, never floats.
export function usdcToBaseUnits(value, { positive = false } = {}) {
  if (typeof value !== 'string' || value.length > 40 || !DECIMAL_USDC.test(value)) {
    throw new AmountError('Amount must be a decimal USDC string with at most 6 decimals, for example "1.5".');
  }
  const [whole, fraction = ''] = value.split('.');
  const units = BigInt(whole) * 1_000_000n + BigInt(fraction.padEnd(6, '0'));
  if (units > U64_MAX) throw new AmountError('Amount exceeds the maximum representable value.');
  if (positive && units === 0n) throw new AmountError('Amount must be greater than zero.');
  return units.toString();
}

// Base-unit integer string -> decimal USDC string without trailing zeros.
export function baseUnitsToUsdc(units) {
  if (typeof units !== 'string' || !/^(0|[1-9]\d{0,19})$/.test(units)) return null;
  const padded = units.padStart(7, '0');
  const whole = padded.slice(0, -6);
  const fraction = padded.slice(-6).replace(/0+$/, '');
  return fraction ? `${whole}.${fraction}` : whole;
}

export function isUsdcAmount(value) {
  try { usdcToBaseUnits(value); return true; } catch { return false; }
}
