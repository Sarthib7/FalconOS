import { LENDING_CONFIG, deserializeLendingTransaction, validateLendingTransaction } from '../../mesh/kamino-wire.mjs';
import { verifySignedTransaction, encodeSignatureBase58 } from '../app/transaction.mjs';
import { createWalletSession } from './wallet.mjs';

const $ = id => document.getElementById(id);
const bytes64 = value => {
  if (typeof value !== 'string' || value.length > 1644) throw new Error('Transaction encoding is invalid.');
  const result = Uint8Array.from(atob(value), character => character.charCodeAt(0));
  if (to64(result) !== value) throw new Error('Transaction encoding is invalid.');
  return result;
};
const to64 = bytes => btoa(String.fromCharCode(...bytes));
const digest = async bytes => [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map(byte => byte.toString(16).padStart(2, '0')).join('');
const units = amount => {
  const value = BigInt(amount);
  const fraction = String(value % 1000000n).padStart(6, '0').replace(/0+$/, '');
  return `${value / 1000000n}${fraction ? `.${fraction}` : ''}`;
};
const node = (tag, text, className = '') => {
  const value = document.createElement(tag); value.textContent = text; value.className = className; return value;
};

export function inputUnits(action, value) {
  if (action === 'redeem') {
    if (!/^[1-9][0-9]{0,19}$/.test(value) || BigInt(value) > 18446744073709551615n) throw new Error('Enter receipt base units as a positive integer.');
    return value;
  }
  if (action !== 'supply' || !/^(0|1)(?:\.[0-9]{1,6})?$/.test(value)) throw new Error('Enter up to 1 Devnet USDC, with at most six decimal places.');
  const [whole, fraction = ''] = value.split('.');
  const result = BigInt(whole) * 1000000n + BigInt(fraction.padEnd(6, '0'));
  if (result <= 0n || result > 1000000n) throw new Error('The first test accepts more than zero and at most 1 Devnet USDC.');
  return result.toString();
}

export async function devnetRpc(method, params = [], fetchImpl = fetch) {
  const response = await fetchImpl(LENDING_CONFIG.rpcUrl, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, redirect: 'error',
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }), signal: AbortSignal.timeout(15000),
  });
  if (!response.ok || !response.body?.getReader) throw new Error('Devnet RPC did not return a usable response.');
  const reader = response.body.getReader(); const chunks = []; let count = 0;
  for (;;) {
    const { done, value } = await reader.read(); if (done) break;
    count += value.length;
    if (count > 65536) { await reader.cancel(); throw new Error('Devnet RPC response is too large.'); }
    chunks.push(value);
  }
  const bytes = new Uint8Array(count); let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
  const payload = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
  if (payload?.jsonrpc !== '2.0' || payload.id !== 1 || Object.hasOwn(payload, 'error') || !Object.hasOwn(payload, 'result')) throw new Error('Devnet RPC rejected the request.');
  return payload.result;
}

export function mountLendingTerminal({ api, getAnalysis, isConnected, wallet = createWalletSession(), rpc = devnetRpc }) {
  let record = null; let events = []; let history = []; let busy = false;
  let prepareRetry = null; let submitRetry = null; let receiptRetry = null;
  let accountGeneration = 0; let lastWallet = null;
  let workspaceGeneration = 0;
  function state() {
    const confirmed = events.find(event => event.kind === 'RECEIPT' && event.data.status === 'CONFIRMED');
    const receipt = [...events].reverse().find(event => event.kind === 'RECEIPT');
    return confirmed?.data.status ?? receipt?.data.status ?? (events.some(event => event.kind === 'SUBMITTED') ? 'SUBMITTED' : 'PREPARED');
  }
  function show(message, error = false) {
    $('lending-message').textContent = message; $('lending-message').setAttribute('role', error ? 'alert' : 'status');
    $('lending-message').dataset.error = String(error);
  }
  function currentWallet() {
    const selected = wallet.current();
    if (!selected || selected.address !== record?.intent.wallet) throw new Error('Connect the wallet named in this intent before signing.');
    return selected;
  }
  function freshIntent() {
    const age = Date.now() - Date.parse(record?.createdAt);
    return Number.isFinite(age) && age >= 0 && age < 120000;
  }
  function render() {
    const connected = isConnected();
    const selected = wallet.current();
    const choices = wallet.list();
    const previous = $('lending-wallet').value;
    $('lending-wallet').replaceChildren(...choices.map(choice => {
      const option = node('option', `${choice.name}${choice.available ? '' : `: ${choice.reason}`}`);
      option.value = choice.id; option.disabled = !choice.available; return option;
    }));
    if (choices.some(choice => choice.id === previous && choice.available)) $('lending-wallet').value = previous;
    if (!choices.length) $('lending-wallet').append(node('option', 'No Wallet Standard wallet detected'));
    $('lending-wallet').disabled = busy || Boolean(selected);
    $('lending-connect').disabled = busy || !choices.some(choice => choice.available) || Boolean(selected);
    $('lending-disconnect').disabled = busy || !selected;
    $('lending-wallet-status').textContent = selected ? `${selected.walletName}: ${selected.address}` : 'Connect a wallet that supports Devnet transaction signing.';
    const analysis = getAnalysis();
    const eligible = analysis?.analysis.mode === 'live' && analysis.analysis.status === 'OBSERVED' && analysis.analysis.policyVersion === 'mesh-public-evidence/1';
    $('lending-analysis-link').textContent = eligible ? `Selected program-evidence analysis: ${analysis.id}` : 'Capture the official document and Devnet program account, then select their OBSERVED analysis. Reserve liquidity alone does not authorize preparation.';
    $('lending-prepare').disabled = busy || !connected || !selected || !eligible;
    $('lending-action').disabled = busy; $('lending-amount').disabled = busy;
    $('lending-amount-label').textContent = $('lending-action').value === 'supply' ? 'Supply amount (Devnet USDC, maximum 1)' : 'Receipt tokens to redeem (integer base units)';
    $('lending-intent').hidden = !record;
    $('lending-history-refresh').disabled = busy || !connected;
    const submitted = events.find(event => event.kind === 'SUBMITTED');
    $('lending-sign').disabled = busy || !connected || !record || Boolean(submitted) || !freshIntent() || selected?.address !== record?.intent.wallet;
    $('lending-retry').disabled = busy || !connected || !submitted?.data.transactionBase64
      || ['CONFIRMED', 'FAILED'].includes(state()) || selected?.address !== record?.intent.wallet;
    $('lending-receipt').disabled = busy || !connected || !submitted;
    if (record) {
      const intent = record.intent;
      $('lending-state').textContent = state(); $('lending-state').dataset.status = state();
      const rows = [
        ['Action', intent.action === 'supply' ? 'Supply Devnet USDC' : 'Redeem receipt tokens'],
        ['Wallet', intent.wallet], ['Network', 'Solana Devnet'], ['Reserve', intent.accounts.reserve],
        ['Requested input', intent.action === 'supply' ? `At most ${units(intent.inputBaseUnits)} Devnet USDC` : `${intent.inputBaseUnits} receipt base units`],
        ['Simulated USDC transfer', `${units(intent.estimatedAmounts.liquidityBaseUnits)} USDC`],
        ['Simulated receipt transfer', `${intent.estimatedAmounts.receiptBaseUnits} base units`],
        ['Snapshot / simulation slots', `${intent.snapshot.slot} / ${intent.simulation.slot}`],
        ['Message SHA-256', intent.messageSha256], ['Intent', record.id], ['Prepared from analysis', record.analysisId],
        ['Signing window', submitted ? 'Registered signature retained' : freshIntent() ? 'Open for up to two minutes; chain expiry also applies' : 'Expired. Prepare a new intent.'],
      ];
      if (submitted) rows.push(['Signature', submitted.data.signature]);
      const result = [...events].reverse().find(event => event.kind === 'RECEIPT' && event.data.status === 'CONFIRMED');
      if (result) rows.push(['Verified transfer', `${units(result.data.amounts.liquidityBaseUnits)} Devnet USDC / ${result.data.amounts.receiptBaseUnits} receipt base units`]);
      $('lending-facts').replaceChildren(...rows.map(([title, value]) => { const row = node('div', ''); row.append(node('dt', title), node('dd', value)); return row; }));
      $('lending-raw').textContent = JSON.stringify(record, null, 2);
      const graph = intent.snapshot.graph;
      const names = new Map((graph?.nodes ?? []).map(item => [item.id, item.label]));
      $('lending-dependencies').replaceChildren(...(graph?.edges ?? []).map(edge => node('li', `${names.get(edge.source) ?? edge.source} → ${edge.relation} → ${names.get(edge.target) ?? edge.target}`)));
      $('lending-events').replaceChildren(...events.map(event => node('li', `${event.createdAt}: ${event.kind === 'SUBMITTED' ? 'Signature registered before broadcast' : `${event.data.status}: ${event.data.reason}`}`)));
    }
    $('lending-history').replaceChildren(...history.map(item => {
      const li = node('li', ''); const button = node('button', `${item.request.action} · ${item.status} · ${item.createdAt}`, 'button');
      button.type = 'button'; button.disabled = busy || !connected; button.dataset.intentId = item.id;
      button.addEventListener('click', () => run(async () => {
        const response = await api(`/v1/lending/intents/${item.id}`);
        record = response.record; events = response.events; prepareRetry = null; submitRetry = null; receiptRetry = null;
        show('Opened the retained intent and its transaction checks.');
      }));
      li.append(button); return li;
    }));
  }
  async function run(work) {
    if (busy) return; busy = true; render();
    const generation = workspaceGeneration;
    try { await work(); } catch (error) {
      if (generation === workspaceGeneration) show(error instanceof Error ? error.message : 'The lending action failed.', true);
    }
    finally { busy = false; render(); }
  }
  async function broadcastRegistered(prepared, submitted, generation) {
    const intent = prepared.intent;
    if (submitted?.kind !== 'SUBMITTED' || submitted.intentId !== prepared.id) throw new Error('The retained signature does not belong to this intent.');
    const data = submitted.data;
    const signedBytes = bytes64(data.transactionBase64);
    const unsigned = deserializeLendingTransaction(bytes64(intent.transactionBase64));
    const signed = deserializeLendingTransaction(signedBytes);
    validateLendingTransaction(unsigned, intent); validateLendingTransaction(signed, intent);
    if (await digest(unsigned.message.serialize()) !== intent.messageSha256
      || await digest(signedBytes) !== data.transactionSha256) throw new Error('The retained transaction hash changed.');
    const verified = await verifySignedTransaction({ unsignedMessage: unsigned.message.serialize(), signedMessage: signed.message.serialize(), signer: intent.wallet,
      requiredSignerKeys: signed.message.staticAccountKeys.slice(0, 1).map(key => key.toBase58()), signatures: signed.signatures });
    const signature = encodeSignatureBase58(verified.signature);
    if (signature !== data.signature) throw new Error('The retained signature changed.');
    if (await rpc('getGenesisHash') !== LENDING_CONFIG.genesisHash) throw new Error('The transaction endpoint is not Solana Devnet.');
    const height = await rpc('getBlockHeight', [{ commitment: 'confirmed' }]);
    if (!Number.isSafeInteger(height) || height > intent.lastValidBlockHeight) throw new Error('The retained blockhash expired. Check its receipt. This transaction cannot be retried.');
    if (generation !== accountGeneration || !isConnected() || record !== prepared) throw new Error('The wallet or workspace changed before broadcast. The signature remains retained.');
    currentWallet();
    show('Signature retained. Sending the approved transaction to Devnet.');
    try {
      const returned = await rpc('sendTransaction', [data.transactionBase64, { encoding: 'base64', skipPreflight: false, preflightCommitment: 'confirmed', maxRetries: 2 }]);
      if (generation !== accountGeneration || !isConnected() || record !== prepared) return;
      if (returned !== signature) throw new Error('RPC transaction ID differed.');
      show('Devnet accepted the transaction. Check its receipt to verify the lending outcome.');
    } catch {
      if (generation === accountGeneration && isConnected() && record === prepared) {
        show('Send result is uncertain. Check its receipt or explicitly retry the same transaction before preparing another action.', true);
      }
    }
  }
  wallet.subscribe(({ current, reason }) => {
    const identity = current ? `${current.walletId}:${current.address}` : null;
    if (identity !== lastWallet || reason) { accountGeneration += 1; lastWallet = identity; }
    if (reason) show(reason, true);
    render();
  });
  $('lending-connect').addEventListener('click', () => run(async () => { await wallet.connect($('lending-wallet').value); show('Wallet connected. Review a live analysis before preparing a transaction.'); }));
  $('lending-disconnect').addEventListener('click', () => run(() => wallet.disconnect()));
  $('lending-action').addEventListener('change', () => { $('lending-amount').value = $('lending-action').value === 'supply' ? '1' : ''; prepareRetry = null; render(); });
  $('lending-form').addEventListener('submit', event => {
    event.preventDefault();
    const action = $('lending-action').value; const value = $('lending-amount').value.trim();
    void run(async () => {
      const generation = accountGeneration;
      const selected = wallet.current(); const analysis = getAnalysis();
      if (!isConnected() || !selected || analysis?.analysis.mode !== 'live' || analysis.analysis.status !== 'OBSERVED' || analysis.analysis.policyVersion !== 'mesh-public-evidence/1') throw new Error('Select a program-evidence OBSERVED analysis and connect a wallet first.');
      const request = { analysisId: analysis.id, wallet: selected.address, action, inputBaseUnits: inputUnits(action, value) };
      const identity = JSON.stringify(request);
      if (prepareRetry?.identity !== identity) prepareRetry = { identity, requestId: crypto.randomUUID() };
      show('Reading Devnet accounts and simulating the proposed transaction.');
      const response = await api('/v1/lending/intents', { requestId: prepareRetry.requestId, ...request });
      const intent = response.record?.intent;
      if (!intent || intent.wallet !== request.wallet || intent.action !== action || intent.inputBaseUnits !== request.inputBaseUnits) throw new Error('The prepared intent differs from the requested action.');
      const transaction = deserializeLendingTransaction(bytes64(intent.transactionBase64));
      validateLendingTransaction(transaction, intent);
      if (await digest(transaction.message.serialize()) !== intent.messageSha256 || transaction.signatures.some(signature => signature.some(byte => byte !== 0))) throw new Error('Prepared message validation failed.');
      if (generation !== accountGeneration || !isConnected()) throw new Error('The wallet or workspace changed during preparation. Reopen the intent from its workspace history.');
      if (response.record.analysisId !== request.analysisId) throw new Error('The prepared intent refers to a different analysis.');
      record = response.record; events = []; submitRetry = null; receiptRetry = null;
      prepareRetry = null;
      show('Simulation passed. Review the action, amounts and accounts before signing.');
    });
  });
  $('lending-sign').addEventListener('click', () => run(async () => {
    if (!record || !isConnected() || !freshIntent() || events.some(event => event.kind === 'SUBMITTED')) throw new Error('Prepare a fresh unsigned intent before signing.');
    const prepared = record; const intent = prepared.intent; const generation = accountGeneration;
    currentWallet();
    if (await rpc('getGenesisHash') !== LENDING_CONFIG.genesisHash) throw new Error('The transaction endpoint is not Solana Devnet.');
    const height = await rpc('getBlockHeight', [{ commitment: 'confirmed' }]);
    if (!Number.isSafeInteger(height) || height > intent.lastValidBlockHeight) throw new Error('The prepared blockhash expired. Prepare a new intent.');
    const unsigned = deserializeLendingTransaction(bytes64(intent.transactionBase64));
    validateLendingTransaction(unsigned, intent);
    if (await digest(unsigned.message.serialize()) !== intent.messageSha256) throw new Error('The prepared message hash changed.');
    if (generation !== accountGeneration || !isConnected() || record !== prepared) throw new Error('The wallet or workspace changed before signing. Nothing was sent.');
    currentWallet();
    show('Review the exact Devnet transaction in your wallet.');
    const signedBytes = await wallet.signTransaction(unsigned.serialize());
    if (generation !== accountGeneration || !isConnected()) throw new Error('The wallet or workspace changed during signing. Nothing was sent.');
    currentWallet();
    const signed = deserializeLendingTransaction(signedBytes); validateLendingTransaction(signed, intent);
    const verified = await verifySignedTransaction({ unsignedMessage: unsigned.message.serialize(), signedMessage: signed.message.serialize(), signer: intent.wallet, requiredSignerKeys: signed.message.staticAccountKeys.slice(0, 1).map(key => key.toBase58()), signatures: signed.signatures });
    const signature = encodeSignatureBase58(verified.signature);
    const nextHeight = await rpc('getBlockHeight', [{ commitment: 'confirmed' }]);
    if (!Number.isSafeInteger(nextHeight) || nextHeight > intent.lastValidBlockHeight || !freshIntent()) throw new Error('The signing window expired. Prepare a new intent.');
    if (generation !== accountGeneration || !isConnected()) throw new Error('The wallet or workspace changed. Nothing was sent.');
    currentWallet();
    const transactionBase64 = to64(signedBytes);
    if (submitRetry?.signature !== signature) submitRetry = { signature, requestId: crypto.randomUUID() };
    const registered = await api(`/v1/lending/intents/${prepared.id}/submit`, { requestId: submitRetry.requestId, transactionBase64 });
    if (registered.event?.data.signature !== signature || registered.event.data.transactionBase64 !== transactionBase64) throw new Error('The service registered a different signed transaction. Nothing was sent.');
    events.push(registered.event); render();
    if (generation !== accountGeneration || !isConnected()) throw new Error('Signature retained. Workspace or wallet changed before broadcast. Check the receipt before another action.');
    await broadcastRegistered(prepared, registered.event, generation);
  }));
  $('lending-retry').addEventListener('click', () => run(async () => {
    const submitted = events.find(event => event.kind === 'SUBMITTED');
    if (!record || !isConnected() || !submitted || ['CONFIRMED', 'FAILED'].includes(state())) throw new Error('Open a registered transaction that still needs a receipt.');
    currentWallet();
    await broadcastRegistered(record, submitted, accountGeneration);
  }));
  $('lending-receipt').addEventListener('click', () => run(async () => {
    if (!record || !isConnected()) return;
    receiptRetry ??= crypto.randomUUID();
    const response = await api(`/v1/lending/intents/${record.id}/receipt`, { requestId: receiptRetry });
    events.push(response.event); receiptRetry = null;
    show(`${response.event.data.status}: ${response.event.data.reason}`);
  }));
  $('lending-history-refresh').addEventListener('click', () => run(async () => { history = (await api('/v1/lending/intents')).records; show('Loaded the latest 20 lending intents.'); }));
  return { render, reset() { record = null; events = []; history = []; prepareRetry = null; submitRetry = null; receiptRetry = null; accountGeneration += 1; workspaceGeneration += 1; show(''); render(); } };
}
