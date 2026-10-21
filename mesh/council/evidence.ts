import { createHash } from 'node:crypto';

type RecordValue = Record<string, unknown>;

const utf8Encoder = new TextEncoder();

export function stableStringify(value: unknown): string {
  if (value === null || typeof value === 'string' || typeof value === 'boolean' || typeof value === 'number') {
    return JSON.stringify(value) as string;
  }
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  const object = value as RecordValue;
  return `{${Object.keys(object).sort().map(key => `${JSON.stringify(key)}:${stableStringify(object[key])}`).join(',')}}`;
}

export function sha256(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

export function sha256Utf8(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex');
}

export function freezeDeep<T>(value: T): T {
  if (typeof value !== 'object' || value === null) return value;
  for (const child of Object.values(value as RecordValue)) freezeDeep(child);
  return Object.freeze(value);
}

export function isDeepFrozen(value: unknown, seen = new WeakSet<object>()): boolean {
  if (typeof value !== 'object' || value === null) return true;
  if (seen.has(value)) return true;
  seen.add(value);
  if (!Object.isFrozen(value)) return false;
  return Object.values(value as RecordValue).every(child => isDeepFrozen(child, seen));
}

export function canonicalBytes(value: unknown): Uint8Array {
  return utf8Encoder.encode(stableStringify(value));
}
