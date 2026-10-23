import { writeFile } from 'node:fs/promises';

// Test preload only. The production bridge strips preloads and cannot select it.
const nativeFetch = globalThis.fetch;
const brokerOrigin = new URL(process.env.OMP_AUTH_BROKER_URL).origin;
const endpoint = 'https://chatgpt.com/backend-api/codex/responses';
let dispatches = 0;
globalThis.fetch = async (input, init) => {
  const url = typeof input === 'string' ? input : input.url ?? input.href;
  if (new URL(url).origin === brokerOrigin) return nativeFetch(input, init);
  if (url !== endpoint || ++dispatches !== 1) throw new Error('Unexpected fixture network request.');
  const headers = new Headers(init?.headers ?? (input instanceof Request ? input.headers : undefined));
  const encoding = headers.get('content-encoding');
  await writeFile(process.env.FALCON_FIXTURE_OBSERVATION, JSON.stringify({ dispatches, stage: 'received', encoding }), { mode: 0o600 });
  let bytes = new Uint8Array(await new Request(input, init).arrayBuffer());
  if (encoding === 'zstd') bytes = await Bun.zstdDecompress(bytes);
  else if (encoding === 'gzip') bytes = Bun.gunzipSync(bytes);
  else if (encoding && encoding !== 'identity') throw new Error('Unsupported fixture request encoding.');
  const body = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
  const user = body.input.find(message => message.role === 'user');
  const packet = JSON.parse(user.content.find(part => part.type === 'input_text').text);
  const source = packet.sourceRefs[0];
  const result = {
    schemaVersion: 1, role: packet.role, runId: packet.runId, callId: packet.callId,
    snapshotHash: packet.snapshotHash, status: 'NO_DATA',
    citations: [{ revisionId: source.revisionId, sha256: source.sha256, supports: 'Controlled retained-source fixture.' }],
    missingEvidence: ['Controlled fixture has no investable proposal.'], executionReady: false,
    ...(packet.role === 'lead'
      ? { thesis: 'Controlled evidence is insufficient.', counterCase: 'Activity does not prove native demand.', proposal: null }
      : { proposalHash: packet.proposal.hash, reason: 'No investable Lead proposal is available.' }),
  };
  if (process.env.FALCON_FIXTURE_RESPONSE === 'wrong-binding') result.callId = 'ffffffff-ffff-4fff-8fff-ffffffffffff';
  const text = JSON.stringify(result);
  const thought = { id: 'fixture-reasoning', type: 'reasoning', summary: [{ type: 'summary_text', text: 'fixture-private-thought' }] };
  const message = { id: 'fixture-message', type: 'message', role: 'assistant', status: 'completed', content: [{ type: 'output_text', text, annotations: [] }] };
  const events = [
    { type: 'response.created', response: { id: 'fixture-response', status: 'in_progress' } },
    { type: 'response.output_item.added', output_index: 0, item: { ...thought, summary: [] } },
    { type: 'response.reasoning_summary_part.added', item_id: thought.id, output_index: 0, summary_index: 0, part: { type: 'summary_text', text: '' } },
    { type: 'response.reasoning_summary_text.delta', item_id: thought.id, output_index: 0, summary_index: 0, delta: 'fixture-private-thought' },
    { type: 'response.output_item.done', output_index: 0, item: thought },
    { type: 'response.output_item.added', output_index: 1, item: { ...message, status: 'in_progress', content: [] } },
    { type: 'response.content_part.added', item_id: message.id, output_index: 1, content_index: 0, part: { type: 'output_text', text: '', annotations: [] } },
    { type: 'response.output_text.delta', item_id: message.id, output_index: 1, content_index: 0, delta: text },
    { type: 'response.output_item.done', output_index: 1, item: message },
    { type: 'response.completed', response: { id: 'fixture-response', status: 'completed', end_turn: true, output: [thought, message], usage: { input_tokens: 10, output_tokens: 10, total_tokens: 20 } } },
  ];
  let instructionContractPresent = false;
  try { instructionContractPresent = Boolean(JSON.parse(body.instructions).resultSchema); } catch {}
  await writeFile(process.env.FALCON_FIXTURE_OBSERVATION, JSON.stringify({ dispatches, role: packet.role, instructionContractPresent }), { mode: 0o600 });
  return new Response(events.map(event => 'data: ' + JSON.stringify(event) + '\n\n').join(''), { headers: { 'content-type': 'text/event-stream' } });
};
