import assert from 'node:assert/strict';
import test from 'node:test';
import { AmountError, baseUnitsToUsdc, usdcToBaseUnits } from '../src/amounts.mjs';

test('usdcToBaseUnits converts decimal strings exactly', () => {
  const table = [
    ['0', '0'], ['0.000001', '1'], ['0.1', '100000'], ['1', '1000000'], ['1.5', '1500000'], ['1.000001', '1000001'],
    ['10', '10000000'], ['0.5', '500000'], ['123456.123456', '123456123456'],
    ['18446744073709.551615', '18446744073709551615'],
  ];
  for (const [input, expected] of table) assert.equal(usdcToBaseUnits(input), expected, `input ${input}`);
});

test('usdcToBaseUnits rejects malformed, signed, exponent, over-precise and overflowing input', () => {
  for (const input of ['1e3', '1E3', '-1', '+1', '1.1234567', '', '01', '00.5', '.5', '1.', ' 1', '1 ', '1,5', '0x10', 'NaN', 'Infinity', '1_000', '18446744073709.551616', '99999999999999999999', 1, 1.5, null, undefined, {}]) {
    assert.throws(() => usdcToBaseUnits(input), AmountError, `input ${String(input)}`);
  }
});

test('usdcToBaseUnits can require a positive amount', () => {
  assert.throws(() => usdcToBaseUnits('0', { positive: true }), AmountError);
  assert.throws(() => usdcToBaseUnits('0.000000', { positive: true }), AmountError);
  assert.equal(usdcToBaseUnits('0.000001', { positive: true }), '1');
});

test('baseUnitsToUsdc formats without floats', () => {
  assert.equal(baseUnitsToUsdc('0'), '0');
  assert.equal(baseUnitsToUsdc('1'), '0.000001');
  assert.equal(baseUnitsToUsdc('1000000'), '1');
  assert.equal(baseUnitsToUsdc('1500000'), '1.5');
  assert.equal(baseUnitsToUsdc('18446744073709551615'), '18446744073709.551615');
  assert.equal(baseUnitsToUsdc('01'), null);
  assert.equal(baseUnitsToUsdc(5), null);
});
