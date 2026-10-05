import assert from 'node:assert/strict';
import test from 'node:test';
import bs58 from 'bs58';
import { SignatureError, normalizeSignature } from '../src/signature.mjs';

const bytes = Buffer.from(Array.from({ length: 64 }, (_, i) => (i * 7 + 3) % 256));
const canonical = bytes.toString('base64');

test('base58 and base64 signatures normalize to the same canonical base64', () => {
  assert.equal(normalizeSignature(canonical), canonical);
  assert.equal(normalizeSignature(bs58.encode(bytes)), canonical);
});

test('base58 with leading zero bytes keeps its length', () => {
  const zeros = Buffer.concat([Buffer.alloc(3), Buffer.from(Array.from({ length: 61 }, (_, i) => i + 1))]);
  assert.equal(normalizeSignature(bs58.encode(zeros)), zeros.toString('base64'));
});

test('wrong lengths and bad encodings are rejected without echoing the input', () => {
  const bad = [
    Buffer.alloc(63, 9).toString('base64'), Buffer.alloc(65, 9).toString('base64'), Buffer.alloc(32, 9).toString('base64'),
    bs58.encode(Buffer.alloc(63, 9)), bs58.encode(Buffer.alloc(65, 9)), bs58.encode(Buffer.alloc(32, 9)),
    '', 'not a signature', `${canonical.slice(0, -2)}A=`, canonical.replace('=', ''), 'O'.repeat(88), 'l'.repeat(88), canonical + canonical,
  ];
  for (const input of bad) {
    assert.throws(() => normalizeSignature(input), error => error instanceof SignatureError && !error.message.includes(input.slice(0, 20) || '\u0000'), `input ${input.slice(0, 12)}`);
  }
  assert.throws(() => normalizeSignature(null), SignatureError);
});
