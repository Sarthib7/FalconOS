import assert from 'node:assert/strict';
import test from 'node:test';
import {
  canonicalBytes,
  freezeDeep,
  isDeepFrozen,
  sha256,
  sha256Utf8,
  stableStringify,
} from '../council/evidence.ts';

test('stableStringify sorts object keys recursively without reordering arrays', () => {
  const value = {
    z: { later: 2, earlier: 1 },
    a: [3, { second: 'two', first: 'one' }],
    2: 'two',
    10: 'ten',
  };

  assert.equal(
    stableStringify(value),
    '{"10":"ten","2":"two","a":[3,{"first":"one","second":"two"}],"z":{"earlier":1,"later":2}}',
  );
  assert.equal(stableStringify(['last', 'first', 'last']), '["last","first","last"]');
});

test('canonicalBytes emits UTF-8 for the canonical Unicode JSON', () => {
  assert.deepEqual(
    [...canonicalBytes({ text: 'é' })],
    [123, 34, 116, 101, 120, 116, 34, 58, 34, 195, 169, 34, 125],
  );
});

test('sha256 hashes raw bytes and sha256Utf8 hashes Unicode text as UTF-8', () => {
  assert.equal(sha256(new Uint8Array([0x61, 0x62, 0x63])), 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  assert.equal(sha256Utf8('é'), '4a99557e4033c3539de2eb65472017cad5f9557f7a0625a09f1c3f6e2ba69c4c');
  assert.equal(sha256(new Uint8Array([0xc3, 0xa9])), '4a99557e4033c3539de2eb65472017cad5f9557f7a0625a09f1c3f6e2ba69c4c');
});

test('freezeDeep freezes nested object and array values; isDeepFrozen detects shallow freezing', () => {
  const value = { nested: [{ entries: [1, { ok: true }] }] };
  const shallow = Object.freeze({ nested: { mutable: true } });

  assert.equal(isDeepFrozen(shallow), false);
  assert.strictEqual(freezeDeep(value), value);
  assert.equal(Object.isFrozen(value), true);
  assert.equal(Object.isFrozen(value.nested), true);
  assert.equal(Object.isFrozen(value.nested[0]), true);
  assert.equal(Object.isFrozen(value.nested[0].entries), true);
  assert.equal(Object.isFrozen(value.nested[0].entries[1]), true);
  assert.equal(isDeepFrozen(value), true);
});
