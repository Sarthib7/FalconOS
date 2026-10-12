import * as z from 'zod/v4';
import { fromJsonSchema } from '@modelcontextprotocol/server';
import packageJson from '../package.json' with { type: 'json' };
import { AmountError, DECIMAL_USDC, baseUnitsToUsdc, isUsdcAmount, usdcToBaseUnits } from './amounts.mjs';
import { sessionKey } from './limiter.mjs';
import { ToolError } from './mesh-client.mjs';
import { SignatureError, normalizeSignature } from './signature.mjs';
import { fingerprintInputSchemas } from './schema-fingerprint.mjs';

export const TOOL_NAMES = Object.freeze([
  'falcon_public_graph', 'falcon_connect', 'falcon_connect_verify', 'falcon_disconnect', 'falcon_yield_opportunities',
  'falcon_refresh_evidence', 'falcon_reserve_decision', 'falcon_prepare_transaction', 'falcon_submit_signed',
  'falcon_check_receipt', 'falcon_activity', 'falcon_wallet_status', 'falcon_decode_transaction', 'falcon_self_test',
]);

export const INSTRUCTIONS = [
  'FalconOS Solana Devnet tools. The public live market graph is the first functional call and needs no wallet, funds, login, or signer.',
  'Call falcon_public_graph({}) first. It reads only fixed public-market evidence; OBSERVED is technical data, not a personalized REVIEW, recommendation, or execution approval. NO_DATA never falls back to an older graph.',
  'Custom graph selection is not supported. Policy identifiers and version are graph metadata, not owner mandates or durable decision IDs. Never invent proposed amount, owner maximum, book floor, or evidence-age limit.',
  'Reuse an existing unexpired session. Only sign a new wallet-ownership message when one is required for owner-bound adoption, decisions, or execution records; sessions last 30 minutes.',
  'For owner-bound flow: falcon_refresh_evidence adopts the public graph into program and reserve records at one exact graphRevision; falcon_reserve_decision requires that analysisId and explicit human-provided scenario values; falcon_prepare_transaction uses the public-only lending route.',
  'Supply needs the returned REVIEW decisionId and stays capped at 1 USDC (1000000 base units) on Devnet. Redeem needs fresh adopted public evidence but no decision.',
  'For every signature, show the exact message or transaction and get separate human approval. Falcon never holds keys, signs, or broadcasts. The human alone signs and broadcasts the exact registered transaction.',
  'falcon_wallet_status, falcon_decode_transaction, falcon_public_graph, and falcon_self_test are public read-only tools. Self-test is metadata only, not health, signer, funds, or transaction readiness.',
].join(' ');

const PREPARED_TTL_SECONDS = 120;

const UUID_PATTERN = '^[A-Fa-f0-9]{8}-[A-Fa-f0-9]{4}-[A-Fa-f0-9]{4}-[A-Fa-f0-9]{4}-[A-Fa-f0-9]{12}$';
const UUID = new RegExp(UUID_PATTERN);
const SESSION = /^wsi1_[A-Za-z0-9_-]{20,}$/;
const WALLET = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
const BASE64_PATTERN = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;
const WALLET_STATUS_TIMEOUT_MS = 60_000;
const MAX_TRANSACTION_BASE64_CHARS = 1_644;

const PREPARE_TRANSACTION_SCHEMA = {
  type: 'object',
  properties: {
    session: { type: 'string', maxLength: 256, pattern: SESSION.source, description: 'Session returned by falcon_connect_verify.' },
    action: { type: 'string', enum: ['supply', 'redeem'] },
    amountUsdc: { type: 'string', maxLength: 40, pattern: DECIMAL_USDC.source, description: 'Decimal USDC amount with at most 6 fractional digits; required for supply and forbidden for redeem.' },
    amountReceiptTokens: { type: 'string', maxLength: 40, pattern: DECIMAL_USDC.source, description: 'Decimal receipt-token burn amount with at most 6 fractional digits; required for redeem and forbidden for supply.' },
    analysisId: { type: 'string', pattern: UUID_PATTERN, description: 'UUID returned by falcon_refresh_evidence; required for supply and redeem.' },
    decisionId: { type: 'string', pattern: UUID_PATTERN, description: 'Durable UUID returned by falcon_reserve_decision for supply; forbidden for redeem. Graph-local policy identifiers are not substitutes.' },
  },
  required: ['session', 'action', 'analysisId'],
  additionalProperties: false,
  allOf: [
    {
      if: { properties: { action: { const: 'supply' } }, required: ['action'] },
      then: { required: ['amountUsdc', 'decisionId'], not: { required: ['amountReceiptTokens'] } },
    },
    {
      if: { properties: { action: { const: 'redeem' } }, required: ['action'] },
      then: { required: ['amountReceiptTokens'], not: { anyOf: [{ required: ['amountUsdc'] }, { required: ['decisionId'] }] } },
    },
  ],
};

function inputSchemaJson(inputSchema) {
  const converted = inputSchema['~standard'].jsonSchema.input({ target: 'draft-2020-12' });
  return { type: 'object', ...converted };
}

const session = z.string().max(256).regex(SESSION, 'Session must be the token returned by falcon_connect_verify.')
  .describe('Session token returned by falcon_connect_verify.');
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
  'Evidence is adopted from one public Devnet graph revision and is only usable for about 300 seconds.',
  'Captured liquidity is the unborrowed reserve balance, not freely withdrawable liquidity or execution approval.',
  'Devnet only. Nothing here is guaranteed.',
]);

const text = body => JSON.stringify(body, null, 2);
const ok = body => ({ content: [{ type: 'text', text: text(body) }], structuredContent: body });
const publicGraphPrivateField = key => {
  const field = key.replace(/[-_]/g, '').toLowerCase();
  return field === 'content' || field.startsWith('raw') || field.includes('exchange')
    || field.startsWith('owner') || field.startsWith('wallet') || field.startsWith('session')
    || field.startsWith('private') || field.startsWith('custom')
    || field === 'record' || field === 'records' || field === 'requestbody' || field === 'responsebody' || field === 'bodybase64';
};

function publicGraphMetadata(value) {
  if (Array.isArray(value)) return value.map(publicGraphMetadata);
  if (value === null || typeof value !== 'object') return value;
  return Object.fromEntries(Object.entries(value)
    .filter(([key]) => !publicGraphPrivateField(key))
    .map(([key, item]) => [key, publicGraphMetadata(item)]));
}

function publicGraphResult(result) {
  return {
    scope: result.scope, chain: result.chain, network: result.network,
    graph: publicGraphMetadata(result.graph),
    programAnalysis: publicGraphMetadata(result.programAnalysis),
    reserveAnalysis: publicGraphMetadata(result.reserveAnalysis),
    status: result.status, policyDefinitionId: result.policyDefinitionId, policyVersion: result.policyVersion,
    maxSupplyBaseUnits: result.maxSupplyBaseUnits, customGraphsSupported: result.customGraphsSupported,
    executionReady: result.executionReady,
  };
}

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

// Retain audit hashes and context, not signed wire bytes or opaque RPC bodies.
function publicEvent(event) {
  const { transactionBase64, exchanges, ...data } = event?.data && typeof event.data === 'object' ? event.data : {};
  if (Array.isArray(exchanges)) data.exchanges = exchanges.map(exchange => {
    const { bodyBase64: requestBody, ...request } = exchange.request ?? {};
    const { bodyBase64: responseBody, ...response } = exchange.response ?? {};
    return { ...exchange, request, response };
  });
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
      id: item.id, createdAt: item.createdAt, action: item.request?.action ?? null,
      ...(item.request?.action === 'redeem'
        ? { amountReceiptTokens: baseUnitsToUsdc(item.request?.inputBaseUnits) }
        : { amountUsdc: baseUnitsToUsdc(item.request?.inputBaseUnits) }),
      wallet: item.request?.wallet ?? null, status: item.status ?? null, transactionSignature: item.signature ?? null,
    }));
  }
  for (const [id, decision] of decisionById) if (!used.has(id)) trail.push(trailRow(decision.createdAt, decision, null));
  trail.sort((a, b) => String(b.at).localeCompare(String(a.at)));
  return { trail, counts: { decisions: decisions.length, intents: intents.length }, limit: 20 };
}

export function registerFalconTools(server, { mesh, limiter }) {
  const registeredSchemas = [];
  function define(name, { title, description, inputSchema, annotations, rate }, handler) {
    registeredSchemas.push({ name, inputSchema: inputSchemaJson(inputSchema) });
    server.registerTool(name, { title, description, inputSchema, annotations }, async args => {
      try {
        const [kind, key] = rate(args);
        const verdict = limiter(kind, key);
        if (!verdict.ok) {
          throw new ToolError('RATE_LIMITED', `Rate limit reached. Retry in ${verdict.retryAfterSeconds} seconds.`, verdict.retryAfterSeconds);
        }
        return ok(await handler(args));
      } catch (error) {
        // A session tool's 401 means the session is missing, expired or revoked: the only fix is a new sign-in.
        if (rate === bySession && error instanceof ToolError && error.code === 'UNAUTHORIZED') {
          return failure(new ToolError('UNAUTHORIZED', `${error.message} Sign in again with falcon_connect, then falcon_connect_verify.`));
        }
        return failure(error);
      }
    });
  }
  const bySession = args => ['session', sessionKey(args.session)];
  define('falcon_public_graph', {
    title: 'Read the public market graph',
    description: 'First functional call: read the fixed live Solana Devnet market graph and technical program/reserve observations. Anonymous and read-only; no wallet, funds, login, or signer. OBSERVED is not a personalized decision or execution approval. No custom graph selector is accepted.',
    inputSchema: z.strictObject({}),
    annotations: READ,
    rate: () => ['public', 'falcon_public_graph'],
  }, async () => publicGraphResult(await mesh.get('/v1/public/graph/live')));

  define('falcon_connect', {
    title: 'Start wallet sign-in',
    description: 'Step 1 of sign-in. Pass your base58 Solana wallet address. Show the returned message to your human; the human must check the host and sign the exact UTF-8 message with wallet signMessage before falcon_connect_verify.',
    inputSchema: z.strictObject({ wallet: z.string().regex(WALLET, 'wallet must be a base58 Solana address.').describe('Your Solana wallet address, base58.') }),
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: true },
    rate: args => ['wallet', args.wallet],
  }, async ({ wallet }) => {
    const challenge = await mesh.post('/v1/auth/wallet/challenge', { address: wallet });
    const host = new URL(mesh.origin).host;
    return {
      challengeId: challenge.challengeId, message: challenge.message, expiresAt: challenge.expiresAt,
      next: `Show the message to your human. Check that it names ${host} and contains no transaction, transfer or spending language. The human alone signs these exact UTF-8 message bytes with wallet signMessage, then provides the 64-byte signature to falcon_connect_verify. The challenge expires at ${challenge.expiresAt}.`,
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
      note: 'Pass this session to the other falcon_ tools and reuse it until it expires or is revoked; do not sign in again while it remains valid. It lasts 30 minutes and anyone holding it can act as this wallet in Falcon on Devnet. Do not share it. Call falcon_disconnect when finished.',
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
    title: 'Adopt public Devnet evidence',
    description: 'Adopt the exact current fixed public graph revision into owner-bound program and reserve records. Returns both owner analysis IDs, graphRevision, evidenceSource, and technical analysis results. It does not recapture or substitute older evidence.',
    inputSchema: z.strictObject({ session }),
    annotations: WRITE,
    rate: bySession,
  }, async ({ session: token }) => {
    const adoption = await mesh.post('/v1/public/graph/adopt', {
      requestId: mesh.newRequestId(), reserveRequestId: mesh.newRequestId(),
    }, token);
    const program = adoption.record.analysis ?? {};
    const reserveAnalysis = adoption.reserveRecord.analysis ?? {};
    const bothObserved = program.status === 'OBSERVED' && reserveAnalysis.status === 'OBSERVED';
    const sourceCaptures = [
      ...(Array.isArray(adoption.record.graph?.sources) ? adoption.record.graph.sources : []),
      ...(Array.isArray(adoption.reserveRecord.graph?.sources) ? adoption.reserveRecord.graph.sources : []),
    ].map(source => source?.capturedAt).filter(value => typeof value === 'string');
    sourceCaptures.sort();
    const liquidityUnits = reserveAnalysis.availableLiquidityUnits;
    const reserve = typeof liquidityUnits === 'string' && /^\d+$/.test(liquidityUnits)
      ? {
        availableLiquidityUnits: liquidityUnits,
        availableLiquidityUsdc: baseUnitsToUsdc(liquidityUnits),
        ...(reserveAnalysis.slot !== undefined && { slot: reserveAnalysis.slot }),
      }
      : null;
    return {
      analysisId: adoption.record.id,
      programAnalysisId: adoption.record.id,
      reserveAnalysisId: adoption.reserveRecord.id,
      graphRevision: adoption.graphRevision,
      evidenceSource: adoption.evidenceSource,
      status: bothObserved ? 'OBSERVED' : 'NO_DATA',
      programStatus: program.status ?? null,
      reserveStatus: reserveAnalysis.status ?? null,
      summary: bothObserved ? (program.summary ?? null) : (reserveAnalysis.summary ?? program.summary ?? null),
      capturedAt: sourceCaptures.at(-1) ?? null,
      programAnalysis: publicGraphMetadata(program),
      reserveAnalysis: publicGraphMetadata(reserveAnalysis),
      ...(reserve && { reserve }),
      limits: [...EVIDENCE_LIMITS],
      next: bothObserved
        ? 'Public evidence is observed at the returned graphRevision. Show its technical results to your human, then use the human-provided scenario in falcon_reserve_decision.'
        : 'The current public evidence is NO_DATA. Do not reuse an older graph or analysis. Inspect falcon_public_graph and adopt only a current observed revision.',
    };
  });

  define('falcon_reserve_decision', {
    title: 'Get reserve decision',
    description: 'Evaluate a human-proposed Devnet supply against the public graph evidence adopted by falcon_refresh_evidence. Requires its analysisId and explicit proposed amount, maximum, book-liquidity floor, and maximum evidence age; no owner limits are defaulted. REVIEW is not execution approval.',
    inputSchema: z.strictObject({
      session,
      analysisId: uuid('analysisId', 'falcon_refresh_evidence').describe('Program analysisId returned by falcon_refresh_evidence for the public graph revision.'),
      proposedUsdc: usdc('proposedUsdc'),
      maxUsdc: usdc('maxUsdc'),
      minBookLiquidityUsdc: usdc('minBookLiquidityUsdc'),
      maxEvidenceAgeSeconds: z.number().int().min(1).max(300).describe('Oldest acceptable evidence age in seconds, 1 to 300; supplied by the human.'),
    }),
    annotations: WRITE,
    rate: bySession,
  }, async args => {
    const { record } = await mesh.post('/v1/public/decisions/reserve', {
      requestId: mesh.newRequestId(), analysisId: args.analysisId,
      scenario: {
        proposedUnits: usdcToBaseUnits(args.proposedUsdc), maxProposedUnits: usdcToBaseUnits(args.maxUsdc),
        minBookLiquidityUnits: usdcToBaseUnits(args.minBookLiquidityUsdc), maxObservationAgeSeconds: args.maxEvidenceAgeSeconds,
      },
    }, args.session);
    const analysis = record.analysis ?? {};
    const status = analysis.status ?? null;
    const next = status === 'REVIEW'
      ? 'A supply of up to ' + args.proposedUsdc + ' USDC may be prepared with falcon_prepare_transaction using decisionId ' + record.id + ' until ' + analysis.expiresAt + '. REVIEW is not approval; your human alone decides, signs, and broadcasts.'
      : status === 'BLOCKED'
        ? 'Do not prepare a supply. Tell your human which checks failed. A redeem is never blocked by a decision.'
        : 'Do not prepare a supply. There is not enough usable evidence. Refresh the public graph and obtain a new explicit decision.';
    return {
      decisionId: record.id, status, summary: analysis.summary ?? null, checks: analysis.checks ?? [], expiresAt: analysis.expiresAt ?? null,
      proposedUsdc: args.proposedUsdc, maxUsdc: args.maxUsdc,
      minBookLiquidityUsdc: args.minBookLiquidityUsdc, maxEvidenceAgeSeconds: args.maxEvidenceAgeSeconds,
      evidenceSource: analysis.evidenceSource ?? null,
      publicGraphRevision: analysis.publicGraphRevision ?? null,
      sourceAnalysisId: analysis.sourceAnalysisId ?? null,
      decisionGraph: analysis.decisionGraph ?? null,
      limits: Array.isArray(analysis.limits) ? analysis.limits : [], next,
    };
  });

  define('falcon_prepare_transaction', {
    title: 'Prepare unsigned Devnet transaction',
    description: 'Prepare a Devnet supply or redeem only from an adopted public graph analysis. Supply requires amountUsdc and the durable decisionId returned by a matching public REVIEW; redeem requires amountReceiptTokens and forbids amountUsdc and decisionId. The wallet is derived from the session. The human alone chooses whether to sign and broadcasts; this unsigned intent expires in about 120 seconds.',
    inputSchema: fromJsonSchema(PREPARE_TRANSACTION_SCHEMA),
    annotations: WRITE,
    rate: bySession,
  }, async args => {
    const inputBaseUnits = usdcToBaseUnits(args.action === 'supply' ? args.amountUsdc : args.amountReceiptTokens, { positive: true });
    const { walletAddress } = await mesh.get('/v1/auth/wallet/session', args.session);
    const { record } = await mesh.post('/v1/public/lending/intents', {
      requestId: mesh.newRequestId(), analysisId: args.analysisId, wallet: walletAddress, action: args.action, inputBaseUnits,
      ...(args.decisionId !== undefined && { decisionId: args.decisionId }),
    }, args.session, 60_000);
    const estimatedUsdc = args.action === 'redeem' ? baseUnitsToUsdc(record.intent?.estimatedAmounts?.liquidityBaseUnits) : null;
    return {
      intentId: record.id, action: args.action,
      ...(args.action === 'supply' ? { amountUsdc: args.amountUsdc } : { amountReceiptTokens: args.amountReceiptTokens, estimatedUsdc }),
      wallet: walletAddress,
      unsignedTransactionBase64: record.intent?.transactionBase64 ?? null, messageSha256: record.intent?.messageSha256 ?? null,
      expiresInSeconds: PREPARED_TTL_SECONDS, decisionId: args.decisionId ?? null,
      evidenceSource: record.intent?.evidenceSource ?? null,
      publicGraphRevision: record.intent?.publicGraphRevision ?? null,
      sourceAnalysisId: record.intent?.sourceAnalysisId ?? null,
      summary: args.action === 'supply'
        ? `Unsigned Devnet supply of ${args.amountUsdc} USDC for wallet ${walletAddress}. Nothing has been signed or sent.`
        : `Unsigned Devnet redeem burns ${args.amountReceiptTokens} receipt tokens for wallet ${walletAddress}; estimated ${estimatedUsdc ?? 'unknown'} USDC output. Nothing has been signed or sent.`,
      next: `Devnet only. Show the action, amount and wallet to your human. Only the human may choose to sign with signTransaction (not signAndSendTransaction) within ${PREPARED_TTL_SECONDS} seconds. Then call falcon_submit_signed with intentId and those human-signed base64 bytes; the human alone broadcasts them.`,
    };
  });

  define('falcon_submit_signed', {
    title: 'Register signed transaction',
    description: 'Register wallet-signed transaction bytes (base64) with Falcon. Falcon verifies them against the prepared intent and never broadcasts. Only the human may broadcast the same signed bytes to Solana Devnet.',
    inputSchema: z.strictObject({
      session,
      intentId: uuid('intentId', 'falcon_prepare_transaction').describe('intentId returned by falcon_prepare_transaction.'),
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
      next: 'Falcon has registered the signed bytes but has not broadcast them and does not return them. Keep the signedTransactionBase64 provided by the human. The human alone reviews and broadcasts those same bytes to Solana Devnet with their own wallet or RPC. If interrupted, the human retries identical bytes while the blockhash remains valid, then call falcon_check_receipt.',
    };
  });

  define('falcon_check_receipt', {
    title: 'Check transaction receipt',
    description: 'Ask Falcon to reconcile the registered transaction against Solana Devnet and record the result.',
    inputSchema: z.strictObject({
      session,
      intentId: uuid('intentId', 'falcon_prepare_transaction').describe('intentId returned by falcon_prepare_transaction.'),
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
  define('falcon_wallet_status', {
    title: 'Read Devnet wallet status',
    description: 'Public read-only account inspection for a base58 Solana wallet on Devnet; no wallet session or Bearer token is sent. Returns the Mesh status fields and human-only faucet guidance. It does not prove signing or transaction readiness.',
    inputSchema: z.strictObject({
      wallet: z.string().regex(WALLET, 'wallet must be a base58 Solana address.').describe('Base58 Solana wallet address to inspect.'),
      forAction: z.enum(['supply', 'redeem']).optional().describe('Optional action context for the read-only status response.'),
      chain: z.literal('solana').default('solana').describe('Solana only.'),
      network: z.literal('devnet').default('devnet').describe('Devnet only.'),
    }),
    annotations: READ,
    rate: args => ['wallet', args.wallet],
  }, async ({ wallet, forAction, chain, network }) => mesh.post('/v1/wallet/status', {
    wallet, chain, network, ...(forAction !== undefined && { forAction }),
  }, undefined, WALLET_STATUS_TIMEOUT_MS));

  define('falcon_decode_transaction', {
    title: 'Decode a Solana transaction',
    description: 'Public read-only Devnet transaction inspection. Accepts bounded base64 bytes and returns decoded message/signature context and risk flags; no session, signing, simulation, or broadcast occurs. Context attestation reflects only the requested chain and network.',
    inputSchema: z.strictObject({
      transactionBase64: z.string().min(4).max(MAX_TRANSACTION_BASE64_CHARS).regex(BASE64_PATTERN, 'transactionBase64 must be valid base64 within the size limit.').describe('Base64-encoded serialized Solana transaction, maximum 1644 characters (1232 bytes).'),
      chain: z.literal('solana').default('solana').describe('Solana only.'),
      network: z.literal('devnet').default('devnet').describe('Devnet only.'),
    }),
    annotations: READ,
    rate: () => ['public', 'falcon_decode_transaction'],
  }, async ({ transactionBase64, chain, network }) => mesh.post('/v1/transactions/decode', { transactionBase64, chain, network }));

  define('falcon_self_test', {
    title: 'Read MCP metadata self-test',
    description: 'Metadata-only report of server package version, network labels, the registered tool names/count, and a deterministic fingerprint of their published input schemas. It does not probe Mesh, health, signer support, funds, or transaction readiness.',
    inputSchema: z.strictObject({}),
    annotations: READ,
    rate: () => ['public', 'falcon_self_test'],
  }, async () => ({
    serverVersion: packageJson.version,
    chain: 'solana',
    network: 'devnet',
    tools: [...TOOL_NAMES],
    toolCount: TOOL_NAMES.length,
    schemaFingerprint: fingerprintInputSchemas(registeredSchemas),
    readiness: { signer: 'not_checked', funding: 'not_checked', transaction: 'not_checked' },
  }));
}
