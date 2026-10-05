import * as z from 'zod/v4';
import { AmountError, DECIMAL_USDC, baseUnitsToUsdc, isUsdcAmount, usdcToBaseUnits } from './amounts.mjs';
import { sessionKey } from './limiter.mjs';
import { ToolError } from './mesh-client.mjs';
import { SignatureError, normalizeSignature } from './signature.mjs';

export const TOOL_NAMES = Object.freeze([
  'falcon_connect', 'falcon_connect_verify', 'falcon_disconnect', 'falcon_yield_opportunities', 'falcon_refresh_evidence',
  'falcon_reserve_decision', 'falcon_prepare_transaction', 'falcon_submit_signed', 'falcon_check_receipt', 'falcon_activity',
]);

export const INSTRUCTIONS = [
  'FalconOS Devnet treasury tools. Falcon never holds keys, never signs and never broadcasts. You sign with your own wallet.',
  'Flow: falcon_connect -> sign the message -> falcon_connect_verify (returns a session) -> falcon_yield_opportunities -> falcon_refresh_evidence',
  '-> falcon_reserve_decision -> falcon_prepare_transaction -> sign the transaction -> falcon_submit_signed -> broadcast it yourself to Solana Devnet',
  '-> falcon_check_receipt -> falcon_activity. Devnet only. Sessions last 30 minutes. Show every message and transaction to your human before signing.',
].join(' ');

const CONNECTORS = Object.freeze(['kamino-program-docs', 'solana-devnet-klend', 'solana-devnet-reserve-liquidity']);
const PROGRAM_OBSERVATION = 'observation:live:solana-devnet-klend';
const RESERVE_OBSERVATION = 'observation:live:solana-devnet-reserve-liquidity';
const PREPARED_TTL_SECONDS = 120;

const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const SESSION = /^wsi1_[A-Za-z0-9_-]{20,}$/;
const WALLET = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

const session = z.string().max(256).regex(SESSION, 'Session must be the token returned by falcon_connect_verify.')
  .describe('Session token returned by falcon_connect_verify.');
const uuid = (label) => z.string().regex(UUID, `${label} must be a UUID.`);
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
  } else if (error instanceof AmountError || error instanceof SignatureError) {
    body = { code: 'INVALID_INPUT', message: error.message };
  } else {
    process.stderr.write(`falcon-mcp: unexpected ${error?.name || 'error'} in a tool handler\n`);
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
  function define(name, { title, description, inputSchema, annotations, rate }, handler) {
    server.registerTool(name, { title, description, inputSchema, annotations }, async args => {
      try {
        const [kind, key] = rate(args);
        const verdict = limiter(kind, key);
        if (!verdict.ok) {
          throw new ToolError('RATE_LIMITED', `Rate limit reached. Retry in ${verdict.retryAfterSeconds} seconds.`, verdict.retryAfterSeconds);
        }
        return ok(await handler(args));
      } catch (error) { return failure(error); }
    });
  }
  const bySession = args => ['session', sessionKey(args.session)];

  define('falcon_connect', {
    title: 'Start wallet sign-in',
    description: 'Step 1 of sign-in. Pass your wallet address (base58). Returns a sign-in message. Show it to your human, check it, sign the exact UTF-8 text with your wallet signMessage, then call falcon_connect_verify.',
    inputSchema: z.strictObject({ wallet: z.string().regex(WALLET, 'wallet must be a base58 Solana address.').describe('Your Solana wallet address, base58.') }),
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: true },
    rate: args => ['wallet', args.wallet],
  }, async ({ wallet }) => {
    const challenge = await mesh.post('/v1/auth/wallet/challenge', { address: wallet });
    const host = new URL(mesh.origin).host;
    return {
      challengeId: challenge.challengeId, message: challenge.message, expiresAt: challenge.expiresAt,
      next: `Show the message to your human. Check that it names ${host} and contains no transaction, transfer or spending language. Then sign the exact UTF-8 message bytes with your wallet signMessage and call falcon_connect_verify with challengeId and the signature (base64 or base58, 64 bytes). The challenge expires at ${challenge.expiresAt}.`,
    };
  });

  define('falcon_connect_verify', {
    title: 'Finish wallet sign-in',
    description: 'Step 2 of sign-in. Pass the challengeId and the Ed25519 signature of the message (64 bytes, base64 or base58). Returns a session token valid for 30 minutes. This is the only tool that returns a session.',
    inputSchema: z.strictObject({
      challengeId: uuid('challengeId').describe('challengeId returned by falcon_connect.'),
      signature: z.string().max(100).describe('Signature of the exact message, 64 bytes, base64 or base58.'),
    }),
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: true },
    rate: args => ['wallet', `challenge:${args.challengeId.toLowerCase()}`],
  }, async ({ challengeId, signature }) => {
    let verified;
    try {
      verified = await mesh.post('/v1/auth/wallet/verify', { challengeId, signature: normalizeSignature(signature) });
    } catch (err) {
      if (err instanceof ToolError && err.code === 'UNAUTHORIZED') {
        throw new ToolError('UNAUTHORIZED', `${err.message} Call falcon_connect for a new challenge and sign it again.`);
      }
      throw err;
    }
    return {
      session: verified.sessionToken, walletAddress: verified.walletAddress, expiresAt: verified.expiresAt,
      note: 'Pass this session to the other falcon_ tools. It lasts 30 minutes and anyone holding it can act as this wallet in Falcon on Devnet. Do not share it. Call falcon_disconnect when finished.',
    };
  });

  define('falcon_disconnect', {
    title: 'End session',
    description: 'Revoke the session at Falcon. The wallet key is not involved.',
    inputSchema: z.strictObject({ session }),
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: true },
    rate: bySession,
  }, async ({ session: token }) => {
    await mesh.post('/v1/auth/wallet/logout', {}, token);
    return { disconnected: true };
  });

  define('falcon_yield_opportunities', {
    title: 'Read yield opportunities',
    description: 'Read the current Solana lending yield opportunities from Falcon. Read-only. Data is provider-indexed and APY is not a realized return.',
    inputSchema: z.strictObject({ session }),
    annotations: READ,
    rate: bySession,
  }, async ({ session: token }) => {
    const result = await mesh.get('/v1/yield/opportunities', token);
    const earlier = Array.isArray(result.limits) ? result.limits.filter(item => typeof item === 'string') : [];
    return { ...result, limits: [...YIELD_LIMITS, ...earlier] };
  });

  define('falcon_refresh_evidence', {
    title: 'Refresh Devnet evidence',
    description: 'Capture fresh Devnet evidence for the Kamino reserve and create the live program-evidence analysis. Returns the analysisId needed by falcon_prepare_transaction. Evidence is usable for about 300 seconds.',
    inputSchema: z.strictObject({ session }),
    annotations: WRITE,
    rate: bySession,
  }, async ({ session: token }) => {
    const live = await mesh.get('/v1/graph/live', token);
    const heads = new Map((Array.isArray(live.graph?.sources) ? live.graph.sources : []).map(source => [source.sourceKey, source.revisionId]));
    let capturedAt = null;
    for (const connectorId of CONNECTORS) {
      const { source } = await mesh.post('/v1/captures', {
        requestId: mesh.newRequestId(), connectorId, expectedRevisionId: heads.get(`live:${connectorId}`) ?? null,
      }, token, mesh.captureTimeoutMs);
      if (typeof source?.capturedAt === 'string' && (!capturedAt || source.capturedAt > capturedAt)) capturedAt = source.capturedAt;
    }
    const { record } = await mesh.post('/v1/analyses/live', { requestId: mesh.newRequestId(), observationId: PROGRAM_OBSERVATION, maxHops: 3 }, token);
    const { record: reserveRecord } = await mesh.post('/v1/analyses/live', { requestId: mesh.newRequestId(), observationId: RESERVE_OBSERVATION }, token);
    const reserveNode = Array.isArray(record.graph?.nodes) ? record.graph.nodes.find(node => node.id === RESERVE_OBSERVATION) : null;
    const reserve = reserveNode?.properties;
    const reserveObserved = reserveRecord.analysis?.status === 'OBSERVED';
    const bothObserved = record.analysis?.status === 'OBSERVED' && reserveObserved;
    const issues = Array.isArray(reserveRecord.graph?.issues) ? reserveRecord.graph.issues : [];
    const failedPattern = /^Current capture ([^\s]+) failed:/;
    const failedCaptures = issues.flatMap(issue => { const m = typeof issue === 'string' ? failedPattern.exec(issue) : null; return m ? [m[1]] : []; });
    const noDataSummary = failedCaptures.length > 0
      ? `Reserve evidence capture failed: ${failedCaptures.join(', ')}.`
      : (reserveRecord.analysis?.summary ?? record.analysis?.summary ?? null);
    return {
      analysisId: record.id,
      status: bothObserved ? (record.analysis?.status ?? 'OBSERVED') : 'NO_DATA',
      reserveStatus: reserveRecord.analysis?.status ?? null,
      summary: bothObserved ? (record.analysis?.summary ?? null) : noDataSummary,
      capturedAt,
      ...(reserve?.status === 'ok' && reserve.availableLiquidityUnits != null && reserve.slot != null && {
        reserve: { availableLiquidityUnits: reserve.availableLiquidityUnits, availableLiquidityUsdc: baseUnitsToUsdc(reserve.availableLiquidityUnits), slot: reserve.slot },
      }),
      limits: [...EVIDENCE_LIMITS],
      next: bothObserved
        ? 'Evidence is fresh. Call falcon_reserve_decision now, then falcon_prepare_transaction with this analysisId before the evidence goes stale.'
        : 'Wait a few seconds and call falcon_refresh_evidence again.',
    };
  });

  define('falcon_reserve_decision', {
    title: 'Get reserve decision',
    description: 'Evaluate a proposed Devnet supply against the reserve evidence. Returns REVIEW, BLOCKED or NO_DATA. REVIEW is not approval; it only allows preparing a supply up to the proposed amount until it expires.',
    inputSchema: z.strictObject({
      session,
      proposedUsdc: usdc('proposedUsdc'),
      maxUsdc: usdc('maxUsdc'),
      minBookLiquidityUsdc: usdc('minBookLiquidityUsdc'),
      maxEvidenceAgeSeconds: z.number().int().min(1).max(300).describe('Oldest acceptable evidence age in seconds, 1 to 300.'),
    }),
    annotations: WRITE,
    rate: bySession,
  }, async args => {
    const { record } = await mesh.post('/v1/decisions/reserve', {
      requestId: mesh.newRequestId(),
      scenario: {
        proposedUnits: usdcToBaseUnits(args.proposedUsdc), maxProposedUnits: usdcToBaseUnits(args.maxUsdc),
        minBookLiquidityUnits: usdcToBaseUnits(args.minBookLiquidityUsdc), maxObservationAgeSeconds: args.maxEvidenceAgeSeconds,
      },
    }, args.session);
    const analysis = record.analysis ?? {};
    const status = analysis.status ?? null;
    const next = status === 'REVIEW'
      ? `A supply of up to ${args.proposedUsdc} USDC may be prepared with falcon_prepare_transaction (action supply, decisionId ${record.id}) until ${analysis.expiresAt}. REVIEW is not approval: your human decides.`
      : status === 'BLOCKED'
        ? 'Do not prepare a supply. Tell your human which checks failed. A redeem is never blocked by a decision.'
        : 'Do not prepare a supply. There is not enough usable evidence. Call falcon_refresh_evidence and decide again.';
    return {
      decisionId: record.id, status, summary: analysis.summary ?? null, checks: analysis.checks ?? [], expiresAt: analysis.expiresAt ?? null,
      proposedUsdc: args.proposedUsdc, maxUsdc: args.maxUsdc,
      limits: Array.isArray(analysis.limits) ? analysis.limits : [], next,
    };
  });

  define('falcon_prepare_transaction', {
    title: 'Prepare unsigned Devnet transaction',
    description: 'Prepare a Devnet supply or redeem as an UNSIGNED transaction for your own wallet to sign. Supply needs a decisionId from a REVIEW result of falcon_reserve_decision. Get one first. supply at most 1 USDC. redeem must not carry a decisionId. The wallet is the session wallet. The prepared transaction expires in about 120 seconds.',
    inputSchema: z.strictObject({
      session,
      action: z.enum(['supply', 'redeem']),
      amountUsdc: usdc('amountUsdc'),
      analysisId: uuid('analysisId').describe('analysisId returned by falcon_refresh_evidence.'),
      decisionId: uuid('decisionId').optional().describe('Required for supply, forbidden for redeem.'),
    }).superRefine((value, ctx) => {
      if (value.action === 'supply' && value.decisionId === undefined) ctx.addIssue({ code: 'custom', path: ['decisionId'], message: 'Supply needs a decisionId from a REVIEW result of falcon_reserve_decision. Get one first.' });
      if (value.action === 'redeem' && value.decisionId !== undefined) ctx.addIssue({ code: 'custom', path: ['decisionId'], message: 'decisionId is not allowed for redeem.' });
    }),
    annotations: WRITE,
    rate: bySession,
  }, async args => {
    const inputBaseUnits = usdcToBaseUnits(args.amountUsdc, { positive: true });
    const { walletAddress } = await mesh.get('/v1/auth/wallet/session', args.session);
    const { record } = await mesh.post('/v1/lending/intents', {
      requestId: mesh.newRequestId(), analysisId: args.analysisId, wallet: walletAddress, action: args.action, inputBaseUnits,
      ...(args.decisionId !== undefined && { decisionId: args.decisionId }),
    }, args.session);
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
    description: 'Register the wallet-signed transaction bytes (base64) with Falcon. Falcon verifies them against the prepared intent. It does NOT broadcast: you send them to Solana Devnet yourself.',
    inputSchema: z.strictObject({
      session,
      intentId: uuid('intentId').describe('intentId returned by falcon_prepare_transaction.'),
      signedTransactionBase64: z.string().max(4096).describe('The signed transaction, base64.'),
      requestId: uuid('requestId').optional().describe('Optional idempotency key. Reuse it only to retry the same submission.'),
    }),
    annotations: WRITE,
    rate: bySession,
  }, async args => {
    const { event } = await mesh.post(`/v1/lending/intents/${args.intentId.toLowerCase()}/submit`, {
      requestId: args.requestId ?? mesh.newRequestId(), transactionBase64: args.signedTransactionBase64,
    }, args.session);
    return {
      event: publicEvent(event),
      next: 'Falcon has registered the signed bytes but has not broadcast them. Broadcast the signed transaction yourself to Solana Devnet with your own wallet or RPC, wait for confirmation, then call falcon_check_receipt.',
    };
  });

  define('falcon_check_receipt', {
    title: 'Check transaction receipt',
    description: 'Ask Falcon to reconcile the registered transaction against Solana Devnet and record the result.',
    inputSchema: z.strictObject({
      session,
      intentId: uuid('intentId').describe('intentId returned by falcon_prepare_transaction.'),
      requestId: uuid('requestId').optional().describe('Optional idempotency key. Reuse it only to retry the same check.'),
    }),
    annotations: WRITE,
    rate: bySession,
  }, async args => {
    const { event } = await mesh.post(`/v1/lending/intents/${args.intentId.toLowerCase()}/receipt`, { requestId: args.requestId ?? mesh.newRequestId() }, args.session);
    return { event: publicEvent(event) };
  });

  define('falcon_activity', {
    title: 'Read activity trail',
    description: 'Read the recent decisions and prepared transactions for this wallet, joined by decision, with each transaction\'s latest status. Read-only.',
    inputSchema: z.strictObject({ session }),
    annotations: READ,
    rate: bySession,
  }, async ({ session: token }) => {
    const [decisions, intents] = await Promise.all([mesh.get('/v1/decisions', token), mesh.get('/v1/lending/intents', token)]);
    return buildActivity(decisions, intents);
  });
}
