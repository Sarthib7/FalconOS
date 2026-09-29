// Human-signed Devnet execution (SPEC I18 / V118 / V51). Shared by the manual order ticket and the
// per-leg plan executor. Swap routing, pool validation, simulation, send and confirmation all live in
// devnet-execution.mjs; nothing here signs on its own: every transaction goes to the injected wallet.
import { buildDevnetUnsignedSwap, getDevnetBlockHeight, getDevnetBlockhash, getDevnetQuote, sendDevnet, simulateDevnet, waitForDevnetConfirmation } from './devnet-execution.mjs';
import { saveOrder } from './state.mjs';
import { DEVNET_BASE_MINT, USDC_DECIMALS, baseUnitsToUsdc } from './strategy.mjs';
import { encodeSignatureBase58, verifySignedTransaction } from './transaction.mjs';

export const SIGNER_LIBRARY = 'https://esm.sh/@solana/web3.js@1.95.8';

export const defaultDeps = Object.freeze({
  getDevnetQuote,
  buildDevnetUnsignedSwap,
  getDevnetBlockhash,
  getDevnetBlockHeight,
  simulateDevnet,
  sendDevnet,
  waitForDevnetConfirmation,
  loadWeb3: () => import(SIGNER_LIBRARY),
});

export function bytesToBase64Transaction(bytes) {
  let binary = '';
  for (let offset = 0; offset < bytes.length; offset += 8192) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 8192));
  }
  return btoa(binary);
}

// Pure: one plan leg -> the single swap it authorises (base mint -> analog mint, amount = allocation).
export function buildLegTicket(leg, baseMint = DEVNET_BASE_MINT) {
  if (!leg || leg.executable !== true || typeof leg.analogMint !== 'string' || !leg.analogMint) {
    throw new Error('This leg has no Devnet analog mint and cannot be executed.');
  }
  if (typeof leg.allocationBaseUnits !== 'string' || !/^\d+$/.test(leg.allocationBaseUnits) || BigInt(leg.allocationBaseUnits) <= 0n) {
    throw new Error('This leg has no positive allocation to execute.');
  }
  if (leg.analogMint === baseMint) throw new Error('Leg analog mint must differ from the base mint.');
  return { assetId: leg.assetId, underlying: leg.underlying, inputMint: baseMint, outputMint: leg.analogMint, amount: leg.allocationBaseUnits };
}

// Simulate -> wallet-sign -> verify -> send -> confirm for an already-quoted swap.
// `guard(message)` must throw when the wallet/order context changed. `progress` is mutated so callers can
// tell how far a failed run got: { predictedSignature, sentSignature, sendAttempted }.
// Resolves { predictedSignature, sentSignature, outcome } (outcome null on an RPC signature mismatch).
export async function signAndSubmit({ quote, inputMint, outputMint, amount, signer, provider, guard, progress, hooks = {}, deps = defaultDeps }) {
  hooks.status?.('Building one unsigned Devnet transaction…');
  const payload = await deps.buildDevnetUnsignedSwap({ quoteResponse: quote, userPublicKey: signer, inputMint, outputMint, amount });
  guard('The wallet or order changed during transaction build. Nothing was signed.');
  if (typeof payload !== 'string' || !payload) throw new Error('Raydium returned no unsigned transaction.');
  const web3 = await deps.loadWeb3();
  guard('The wallet or order changed before simulation. Nothing was signed.');
  const transaction = web3.VersionedTransaction.deserialize(Uint8Array.from(atob(payload), (character) => character.charCodeAt(0)));
  if (!transaction.signatures.length || transaction.signatures.some((signature) => signature.some((byte) => byte !== 0))) {
    throw new Error('Raydium transaction is already signed or has no required signer. Refusing to send.');
  }
  const blockhashWindow = await deps.getDevnetBlockhash();
  transaction.message.recentBlockhash = blockhashWindow.blockhash;
  const unsignedMessage = transaction.message.serialize();
  await deps.simulateDevnet(bytesToBase64Transaction(transaction.serialize()));
  guard('The wallet or order changed during simulation. Nothing was signed.');
  const signerKeys = transaction.message.staticAccountKeys || transaction.message.accountKeys || [];
  const requiredSignerKeys = signerKeys.slice(0, transaction.message.header.numRequiredSignatures).map((key) => key.toString());
  hooks.ready?.();
  const signed = await provider.signTransaction(transaction);
  guard('Wallet account or order changed after signing. Nothing was sent.');
  if (!signed?.message?.serialize || !signed?.serialize || !Array.isArray(signed.signatures)) {
    throw new Error('Wallet returned an invalid signed transaction. Nothing was sent.');
  }
  const verified = await verifySignedTransaction({
    unsignedMessage,
    signedMessage: signed.message.serialize(),
    signer,
    requiredSignerKeys,
    signatures: signed.signatures,
  });
  const predictedSignature = encodeSignatureBase58(verified.signature);
  progress.predictedSignature = predictedSignature;
  hooks.signed?.(predictedSignature);
  const blockHeight = await deps.getDevnetBlockHeight();
  if (blockHeight > blockhashWindow.lastValidBlockHeight) throw new Error('Devnet blockhash expired. Nothing was sent. Get a new quote.');
  guard('Wallet account or order changed before send. Nothing was sent.');
  hooks.sending?.(predictedSignature);
  progress.sendAttempted = true;
  const sentSignature = await deps.sendDevnet(bytesToBase64Transaction(signed.serialize()));
  if (sentSignature !== predictedSignature) {
    progress.sentSignature = null;
    return { predictedSignature, sentSignature, outcome: null };
  }
  progress.sentSignature = sentSignature;
  hooks.sent?.(sentSignature);
  const outcome = await deps.waitForDevnetConfirmation(sentSignature, { timeoutMs: 30000, pollIntervalMs: 1000 });
  return { predictedSignature, sentSignature, outcome };
}

function legOrder({ ticket, quote, signer, signature, createdAt, id }) {
  const rawImpact = quote?.data?.priceImpactPct;
  const impact = rawImpact === undefined || rawImpact === null ? null : String(rawImpact);
  return {
    id,
    wallet: signer,
    network: 'devnet',
    side: 'BUY',
    poolId: quote.data.routePlan[0].poolId,
    poolIds: quote.data.routePlan.map((hop) => hop.poolId),
    inputMint: ticket.inputMint,
    outputMint: ticket.outputMint,
    inputAmount: baseUnitsToUsdc(ticket.amount),
    inputBaseUnits: ticket.amount,
    inputDecimals: USDC_DECIMALS,
    outputBaseUnits: quote.data.outputAmount,
    outputDecimals: null,
    priceImpact: impact !== null && impact.length > 32 ? null : impact,
    status: 'confirmed',
    signature,
    createdAt,
    updatedAt: createdAt,
    leg: { assetId: ticket.assetId, underlying: ticket.underlying },
  };
}

// Executes ONE plan leg as ONE human-signed Devnet swap. Never throws; the journal is written only on a
// confirmed signature, so any other result leaves it untouched.
// Resolves { status, signature?, error?, order? } with status one of:
//   confirmed | failed (on-chain) | pending | mismatch | send-unknown | lookup-failed | error (nothing sent).
export async function executeLeg({ leg, signer, provider, baseMint = DEVNET_BASE_MINT, guard = () => {}, hooks = {}, deps = defaultDeps, storage, now = () => new Date().toISOString(), newId = () => crypto.randomUUID() }) {
  const progress = { predictedSignature: null, sentSignature: null, sendAttempted: false };
  try {
    const ticket = buildLegTicket(leg, baseMint);
    if (typeof provider?.signTransaction !== 'function') throw new Error('This wallet cannot sign transactions. No transaction was sent.');
    const createdAt = now();
    hooks.status?.(`Requesting a Devnet quote for ${ticket.underlying}…`);
    const quote = await deps.getDevnetQuote({ inputMint: ticket.inputMint, outputMint: ticket.outputMint, amount: ticket.amount });
    guard('The wallet or plan changed during the quote. Nothing was signed.');
    const run = await signAndSubmit({ quote, inputMint: ticket.inputMint, outputMint: ticket.outputMint, amount: ticket.amount, signer, provider, guard, progress, hooks, deps });
    if (!run.outcome) {
      return { status: 'mismatch', signature: run.predictedSignature, error: `RPC signature mismatch. Check both signatures before retrying: ${run.predictedSignature} / ${run.sentSignature}` };
    }
    if (run.outcome.status === 'failed') return { status: 'failed', signature: run.sentSignature, error: `Devnet transaction failed: ${JSON.stringify(run.outcome.err)}` };
    if (run.outcome.status !== 'confirmed') return { status: 'pending', signature: run.sentSignature, error: 'Confirmation is pending. Check the Devnet signature before retrying.' };
    const confirmed = { status: 'confirmed', signature: run.sentSignature, confirmationStatus: run.outcome.confirmationStatus };
    try {
      return { ...confirmed, order: saveOrder(signer, legOrder({ ticket, quote, signer, signature: run.sentSignature, createdAt, id: newId() }), storage) };
    } catch (error) {
      return { ...confirmed, order: null, journalError: error?.message || 'Order journal write failed.' };
    }
  } catch (error) {
    const message = error?.message || 'Leg execution failed.';
    if (progress.sentSignature) return { status: 'lookup-failed', signature: progress.sentSignature, error: message };
    if (progress.sendAttempted) return { status: 'send-unknown', signature: progress.predictedSignature, error: message };
    return { status: 'error', error: message };
  }
}
