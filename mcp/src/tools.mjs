import * as z from 'zod/v4';
import { AmountError, DECIMAL_USDC, baseUnitsToUsdc, isUsdcAmount, usdcToBaseUnits } from './amounts.mjs';
import { tokenKey } from './limiter.mjs';
import { ToolError } from './mesh-client.mjs';

export const TOOL_NAMES = Object.freeze([
  'falcon_yield_opportunities', 'falcon_refresh_evidence', 'falcon_reserve_decision',
  'falcon_prepare_transaction', 'falcon_submit_signed', 'falcon_check_receipt', 'falcon_activity',
]);

export const INSTRUCTIONS = [
  'FalconOS Devnet treasury tools. Falcon never holds keys, never signs and never broadcasts. You sign with your own wallet.',
  'Your MCP client handles browser sign-in with Phantom. Signing the login message proves wallet control only; it does not approve a transaction.',
  'Flow: falcon_yield_opportunities -> falcon_refresh_evidence -> falcon_reserve_decision -> falcon_prepare_transaction',
  '-> sign the transaction with your own wallet -> falcon_submit_signed -> broadcast it yourself to Solana Devnet -> falcon_check_receipt -> falcon_activity.',
  'Devnet only. Show every transaction to your human before signing.',
].join(' ');

const CONNECTORS = Object.freeze(['kamino-program-docs', 'solana-devnet-klend', 'solana-devnet-reserve-liquidity']);
const PROGRAM_OBSERVATION = 'observation:live:solana-devnet-klend';
const RESERVE_OBSERVATION = 'observation:live:solana-devnet-reserve-liquidity';
const PREPARED_TTL_SECONDS = 120;

const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;

// `from` names the tool that returns the id, so a missing id tells the agent which step it skipped.
const uuid = (label, from) => z.string({ error: issue => (issue.input === undefined && from ? `${label} is required. Get it from ${from} first.` : undefined) })
  .regex(UUID, `${label} must be a UUID.`);
const usdc = (label) => z.string().max(40)
  .regex(DECIMAL_USDC, `${label} must be a decimal USDC string with at most 6 decimals, for example "0.5".`)
  .superRefine((v, ctx) => { if (DECIMAL_USDC.test(v) && !isUsdcAmount(v)) ctx.addIssue({ code: 'custom', message: `${label} is too large.` }); })
  .describe(`${label} as a decimal USDC string, at most 6 decimals, no exponent or sign.`);

const READ = { readOnlyHint: true, openWorldHint: true };
const WRITE = { readOnlyHint: false, destructiveHint: false, openWorldHint: true };

const YIELD_LIMITS = Object.freeze([
  'Yield data is indexed by a third-party provider and may be stale, incomplete or wrong.',
  'APY is a reported rate, not a realized return.',
  'Nothing here is guaranteed. Execution through Falcon is Devnet only.',
]);
const EVIDENCE_LIMITS = Object.freeze([
  'Evidence is a Devnet capture and is only usable for about 300 seconds.',
  'Captured liquidity is the unborrowed reserve balance, not freely withdrawable liquidity or execution approval.',
  'Devnet only. Nothing here is guaranteed.',
]);

const text = body => JSON.stringify(body, null, 2);
const ok = body => ({ content: [{ type: 'text', text: text(body) }], structuredContent: body });

function failure(error) {
  let body;
  if (error instanceof ToolError) {
    body = { code: error.code, message: error.message, ...(error.retryAfterSeconds !== undefined && { retryAfterSeconds: error.retryAfterSeconds }) };
  } else if (error instanceof AmountError) {
    body = { code: 'INVALID_INPUT', message: error.message };
  } else {
    process.stderr.write('falcon-mcp: unexpected error in a tool handler\n');
    body = { code: 'INTERNAL_ERROR', message: 'The Falcon MCP server hit an unexpected error.' };
  }
  return { isError: true, content: [{ type: 'text', text: text(body) }], structuredContent: body };
}

// Event data may carry the wallet-signed transaction the caller just sent. It is redundant in the result, so it is dropped.
function publicEvent(event) {
  const { transactionBase64, ...data } = event?.data && typeof event.data === 'object' ? event.data : {};
  return { id: event?.id, requestId: event?.requestId, intentId: event?.intentId, createdAt: event?.createdAt, kind: event?.kind, data };
}

function trailRow(at, decision, intent) { return { at, decision, intent }; }

export function buildActivity(decisionsPayload, intentsPayload) {
  const decisions = Array.isArray(decisionsPayload?.records) ? decisionsPayload.records : [];
  const intents = Array.isArray(intentsPayload?.records) ? intentsPayload.records : [];
  const decisionById = new Map(decisions.map(item => [item.id, {
    id: item.id, createdAt: item.createdAt, status: item.analysis?.status ?? null, summary: item.analysis?.summary ?? null, expiresAt: item.analysis?.expiresAt ?? null,
  }]));
  const used = new Set();
  const trail = [];
  for (const item of intents) {
    const decisionId = item.request?.decisionId ?? null;
    const decision = decisionId ? decisionById.get(decisionId) ?? { id: decisionId, createdAt: null, status: null, summary: null, expiresAt: null } : null;
    if (decisionId) used.add(decisionId);
    trail.push(trailRow(item.createdAt, decision, {
      id: item.id, createdAt: item.createdAt, action: item.request?.action ?? null, amountUsdc: baseUnitsToUsdc(item.request?.inputBaseUnits),
      wallet: item.request?.wallet ?? null, status: item.status ?? null, transactionSignature: item.signature ?? null,
    }));
  }
  for (const [id, decision] of decisionById) if (!used.has(id)) trail.push(trailRow(decision.createdAt, decision, null));
  trail.sort((a, b) => String(b.at).localeCompare(String(a.at)));
  return { trail, counts: { decisions: decisions.length, intents: intents.length }, limit: 20 };
}

export function registerFalconTools(server, { mesh, limiter }) {
  function define(name, { title, description, inputSchema, annotations }, handler) {
    server.registerTool(name, { title, description, inputSchema, annotations }, async (args, context) => {
      try {
        const authInfo = context?.http?.authInfo;
        if (typeof authInfo?.token !== 'string') throw new ToolError('UNAUTHORIZED', 'A valid Falcon MCP access token is required. Sign in through your MCP client.');
        const verdict = limiter(tokenKey(authInfo.token));
        if (!verdict.ok) throw new ToolError('RATE_LIMITED', `Rate limit reached. Retry in ${verdict.retryAfterSeconds} seconds.`, verdict.retryAfterSeconds);
        return ok(await handler(args, authInfo));
      } catch (error) {
        if (error instanceof ToolError && error.code === 'UNAUTHORIZED') return failure(new ToolError('UNAUTHORIZED', 'Falcon rejected the MCP access token. Sign in again through your MCP client.'));
        return failure(error);
      }
    });
  }

  define('falcon_yield_opportunities', {
    title: 'Read yield opportunities',
    description: 'Read current Solana lending yield opportunities from Falcon. Read-only. Data is provider-indexed and APY is not a realized return.',
    inputSchema: z.strictObject({}), annotations: READ,
  }, async (_args, authInfo) => {
    const result = await mesh.get('/v1/yield/opportunities', authInfo.token);
    const earlier = Array.isArray(result.limits) ? result.limits.filter(item => typeof item === 'string') : [];
    return { ...result, limits: [...YIELD_LIMITS, ...earlier] };
  });

  define('falcon_refresh_evidence', {
    title: 'Refresh Devnet evidence',
    description: 'Capture fresh Devnet evidence for the Kamino reserve and create the live program-evidence analysis. Returns the analysisId needed by falcon_prepare_transaction. Evidence is usable for about 300 seconds.',
    inputSchema: z.strictObject({}), annotations: WRITE,
  }, async (_args, authInfo) => {
    const live = await mesh.get('/v1/graph/live', authInfo.token);
    const heads = new Map((Array.isArray(live.graph?.sources) ? live.graph.sources : []).map(source => [source.sourceKey, source.revisionId]));
    let capturedAt = null;
    for (const connectorId of CONNECTORS) {
      const { source } = await mesh.post('/v1/captures', { requestId: mesh.newRequestId(), connectorId, expectedRevisionId: heads.get(`live:${connectorId}`) ?? null }, authInfo.token, mesh.captureTimeoutMs);
      if (typeof source?.capturedAt === 'string' && (!capturedAt || source.capturedAt > capturedAt)) capturedAt = source.capturedAt;
    }
    const { record } = await mesh.post('/v1/analyses/live', { requestId: mesh.newRequestId(), observationId: PROGRAM_OBSERVATION, maxHops: 3 }, authInfo.token);
    const { record: reserveRecord } = await mesh.post('/v1/analyses/live', { requestId: mesh.newRequestId(), observationId: RESERVE_OBSERVATION, maxHops: 3 }, authInfo.token);
    const reserveNode = Array.isArray(record.graph?.nodes) ? record.graph.nodes.find(node => node.id === RESERVE_OBSERVATION) : null;
    const reserve = reserveNode?.properties;
    const reserveObserved = reserveRecord.analysis?.status === 'OBSERVED';
    const bothObserved = record.analysis?.status === 'OBSERVED' && reserveObserved;
    const issues = Array.isArray(reserveRecord.graph?.issues) ? reserveRecord.graph.issues : [];
    const failedPattern = /^Current capture ([^\s]+) failed:/;
    const failedCaptures = issues.flatMap(issue => { const match = typeof issue === 'string' ? failedPattern.exec(issue) : null; return match ? [match[1]] : []; });
    const noDataSummary = failedCaptures.length ? `Reserve evidence capture failed: ${failedCaptures.join(', ')}.` : (reserveRecord.analysis?.summary ?? record.analysis?.summary ?? null);
    return {
      analysisId: record.id, status: bothObserved ? (record.analysis?.status ?? 'OBSERVED') : 'NO_DATA',
      reserveStatus: reserveRecord.analysis?.status ?? null, summary: bothObserved ? (record.analysis?.summary ?? null) : noDataSummary, capturedAt,
      ...(reserve?.status === 'ok' && reserve.availableLiquidityUnits != null && reserve.slot != null && { reserve: { availableLiquidityUnits: reserve.availableLiquidityUnits, availableLiquidityUsdc: baseUnitsToUsdc(reserve.availableLiquidityUnits), slot: reserve.slot } }),
      limits: [...EVIDENCE_LIMITS],
      next: bothObserved ? 'Evidence is fresh. Call falcon_reserve_decision now, then falcon_prepare_transaction with this analysisId before the evidence goes stale.' : 'Wait a few seconds and call falcon_refresh_evidence again.',
    };
  });

  define('falcon_reserve_decision', {
    title: 'Get reserve decision',
    description: 'Evaluate a proposed Devnet supply against reserve evidence. Returns REVIEW, BLOCKED or NO_DATA. REVIEW is not approval; it only allows preparing a supply up to the proposed amount until it expires.',
    inputSchema: z.strictObject({
      proposedUsdc: usdc('proposedUsdc'), maxUsdc: usdc('maxUsdc'), minBookLiquidityUsdc: usdc('minBookLiquidityUsdc'),
      maxEvidenceAgeSeconds: z.number().int().min(1).max(300).describe('Oldest acceptable evidence age in seconds, 1 to 300.'),
    }), annotations: WRITE,
  }, async (args, authInfo) => {
    const { record } = await mesh.post('/v1/decisions/reserve', { requestId: mesh.newRequestId(), scenario: {
      proposedUnits: usdcToBaseUnits(args.proposedUsdc), maxProposedUnits: usdcToBaseUnits(args.maxUsdc),
      minBookLiquidityUnits: usdcToBaseUnits(args.minBookLiquidityUsdc), maxObservationAgeSeconds: args.maxEvidenceAgeSeconds,
    } }, authInfo.token);
    const analysis = record.analysis ?? {};
    const status = analysis.status ?? null;
    const next = status === 'REVIEW'
      ? `A supply of up to ${args.proposedUsdc} USDC may be prepared with falcon_prepare_transaction (action supply, decisionId ${record.id}) until ${analysis.expiresAt}. REVIEW is not approval: your human decides.`
      : status === 'BLOCKED' ? 'Do not prepare a supply. Tell your human which checks failed. A redeem is never blocked by a decision.' : 'Do not prepare a supply. There is not enough usable evidence. Call falcon_refresh_evidence and decide again.';
    return { decisionId: record.id, status, summary: analysis.summary ?? null, checks: analysis.checks ?? [], expiresAt: analysis.expiresAt ?? null, proposedUsdc: args.proposedUsdc, maxUsdc: args.maxUsdc, limits: Array.isArray(analysis.limits) ? analysis.limits : [], next };
  });

  define('falcon_prepare_transaction', {
    title: 'Prepare unsigned Devnet transaction',
    description: 'Prepare an unsigned Devnet supply or redeem for your authenticated wallet. Supply needs a decisionId from a REVIEW result. Redeem needs fresh analysis evidence but no decision. Falcon never signs or broadcasts. The prepared transaction expires in about 120 seconds.',
    inputSchema: z.strictObject({
      action: z.enum(['supply', 'redeem']), amountUsdc: usdc('amountUsdc'),
      analysisId: uuid('analysisId', 'falcon_refresh_evidence').describe('analysisId returned by falcon_refresh_evidence. Required for supply and redeem.'),
      decisionId: uuid('decisionId').optional().describe('Required for supply, forbidden for redeem.'),
    }).superRefine((value, ctx) => {
      if (value.action === 'supply' && value.decisionId === undefined) ctx.addIssue({ code: 'custom', path: ['decisionId'], message: 'Supply needs a decisionId from a REVIEW result of falcon_reserve_decision. Get one first.' });
      if (value.action === 'redeem' && value.decisionId !== undefined) ctx.addIssue({ code: 'custom', path: ['decisionId'], message: 'decisionId is not allowed for redeem.' });
    }), annotations: WRITE,
  }, async (args, authInfo) => {
    const inputBaseUnits = usdcToBaseUnits(args.amountUsdc, { positive: true });
    const walletAddress = authInfo.extra?.walletAddress;
    if (typeof walletAddress !== 'string') throw new ToolError('UNAUTHORIZED', 'The MCP token has no verified wallet. Sign in again through your MCP client.');
    const { record } = await mesh.post('/v1/lending/intents', { requestId: mesh.newRequestId(), analysisId: args.analysisId, wallet: walletAddress, action: args.action, inputBaseUnits, ...(args.decisionId !== undefined && { decisionId: args.decisionId }) }, authInfo.token);
    return {
      intentId: record.id, action: args.action, amountUsdc: args.amountUsdc, wallet: walletAddress,
      unsignedTransactionBase64: record.intent?.transactionBase64 ?? null, messageSha256: record.intent?.messageSha256 ?? null,
      expiresInSeconds: PREPARED_TTL_SECONDS, decisionId: args.decisionId ?? null,
      summary: `Unsigned Devnet ${args.action} of ${args.amountUsdc} USDC for wallet ${walletAddress}. Nothing has been signed or sent.`,
      next: `Devnet only. Show the action, amount and wallet to your human and get approval. Sign with signTransaction (not signAndSendTransaction) within ${PREPARED_TTL_SECONDS} seconds, then call falcon_submit_signed with intentId and the signed transaction as base64.`,
    };
  });

  define('falcon_submit_signed', {
    title: 'Register signed transaction',
    description: 'Register wallet-signed transaction bytes (base64) with Falcon. Falcon verifies them against the prepared intent. Falcon does not broadcast; you send them to Solana Devnet yourself.',
    inputSchema: z.strictObject({
      intentId: uuid('intentId', 'falcon_prepare_transaction').describe('intentId returned by falcon_prepare_transaction.'),
      signedTransactionBase64: z.string().max(4096).describe('The signed transaction, base64.'),
      requestId: uuid('requestId').optional().describe('Optional idempotency key. Reuse it only to retry the same submission.'),
    }), annotations: WRITE,
  }, async (args, authInfo) => {
    const { event } = await mesh.post('/v1/lending/intents/' + args.intentId.toLowerCase() + '/submit', { requestId: args.requestId ?? mesh.newRequestId(), transactionBase64: args.signedTransactionBase64 }, authInfo.token);
    return { event: publicEvent(event), next: 'Falcon registered the signed bytes but did not broadcast them. Broadcast the transaction yourself to Solana Devnet, wait for confirmation, then call falcon_check_receipt.' };
  });

  define('falcon_check_receipt', {
    title: 'Check transaction receipt',
    description: 'Ask Falcon to reconcile the registered transaction against Solana Devnet and record the result.',
    inputSchema: z.strictObject({
      intentId: uuid('intentId', 'falcon_prepare_transaction').describe('intentId returned by falcon_prepare_transaction.'),
      requestId: uuid('requestId').optional().describe('Optional idempotency key. Reuse it only to retry the same check.'),
    }), annotations: WRITE,
  }, async (args, authInfo) => {
    const { event } = await mesh.post('/v1/lending/intents/' + args.intentId.toLowerCase() + '/receipt', { requestId: args.requestId ?? mesh.newRequestId() }, authInfo.token);
    return { event: publicEvent(event) };
  });

  define('falcon_activity', {
    title: 'Read activity trail',
    description: 'Read recent decisions and prepared transactions for the authenticated wallet, joined by decision, with each transaction latest status. Read-only.',
    inputSchema: z.strictObject({}), annotations: READ,
  }, async (_args, authInfo) => {
    const [decisions, intents] = await Promise.all([mesh.get('/v1/decisions', authInfo.token), mesh.get('/v1/lending/intents', authInfo.token)]);
    return buildActivity(decisions, intents);
  });
}
