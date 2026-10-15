import assert from 'node:assert/strict';
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';
import { TOOL_NAMES } from '../../src/tools.mjs';

const url = new URL(process.argv[2]);
assert.ok(['127.0.0.1', 'localhost'].includes(url.hostname), 'container smoke requires loopback');
const client = new Client({ name: 'falcon-runtime-smoke', version: '1.0.0' });
try {
  await client.connect(new StreamableHTTPClientTransport(url));
  const { tools } = await client.listTools();
  assert.deepEqual(tools.map(tool => tool.name), [...TOOL_NAMES]);
  const result = await client.callTool({ name: 'falcon_self_test', arguments: {} });
  assert.notEqual(result.isError, true);
  const metadata = JSON.parse(result.content[0].text);
  assert.equal(metadata.serverVersion, '0.4.0');
  assert.deepEqual(metadata.readiness, { signer: 'not_checked', funding: 'not_checked', transaction: 'not_checked' });
  const rejected = await client.callTool({ name: 'falcon_public_graph', arguments: { source: 'private' } });
  assert.equal(rejected.isError, true);
  const unavailable = await client.callTool({ name: 'falcon_public_graph', arguments: {} });
  assert.equal(unavailable.isError, true);
  assert.equal(JSON.parse(unavailable.content[0].text).code, 'MESH_UNAVAILABLE');
  console.log('RUST_CONTAINER_MCP_OK: 14 tools; metadata-only readiness; invalid selector rejected; unavailable Mesh fails closed.');
} finally {
  await client.close();
}
