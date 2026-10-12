import { createHash } from 'node:crypto';

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])]));
  }
  return value;
}

export function fingerprintInputSchemas(entries) {
  const schemas = entries.map(({ name, inputSchema }) => ({ name, inputSchema }))
    .sort((left, right) => (left.name < right.name ? -1 : left.name > right.name ? 1 : 0));
  const digest = createHash('sha256').update(JSON.stringify(canonical(schemas))).digest('hex');
  return `sha256:${digest}`;
}
