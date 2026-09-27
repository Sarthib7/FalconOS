import { DEVNET_RPC, formatTokenAmount, getDevnetBalance, getDevnetSignatures, getDevnetTokenAccounts, getDevnetTokenDecimals } from './data.mjs';
import { bytesToBase64, createSignInRequest, decodeSolanaAddress, signatureBytes, verifySignInProof } from './auth.mjs';
import { buildDevnetUnsignedSwap, getDevnetBlockHeight, getDevnetBlockhash, getDevnetQuote, sendDevnet, simulateDevnet, waitForDevnetConfirmation } from './devnet-execution.mjs';
import { clearSession, readOrders, readPortfolio, readSession, saveOrder, updateOrder, writePortfolio, writeSession } from './state.mjs';
import { encodeSignatureBase58, verifySignedTransaction } from './transaction.mjs';

const byId = (id) => document.getElementById(id);
const SIGNER_LIBRARY = 'https://esm.sh/@solana/web3.js@1.95.8';
const APP_ORDER_HISTORY = 50;
const TOKEN_DECIMAL_LIMIT = 18;
let sessionProof = null;
let walletProvider = null;
let connectedAddress = null;
let portfolioData = { balance: null, tokens: [], signatures: [] };
let activeQuote = null;
let quoteRevision = 0;
let tradeInFlight = false;
let authInFlight = false;
let boundProvider = null;

function short(value, head = 8, tail = 6) {
  const text = String(value || '');
  return text.length > head + tail + 1 ? `${text.slice(0, head)}…${text.slice(-tail)}` : text || '—';
}

function setAppStatus(message, kind = '') {
  const element = byId('app-status');
  element.textContent = message;
  element.dataset.kind = kind;
}

function setTradeResult(message, kind = '') {
  const element = byId('trade-result');
  element.textContent = message;
  element.dataset.kind = kind;
}

function emptyRow(target, columns, message) {
  target.replaceChildren();
  const row = document.createElement('tr');
  const cell = document.createElement('td');
  cell.colSpan = columns;
  cell.className = 'app-empty';
  cell.textContent = message;
  row.appendChild(cell);
  target.appendChild(row);
}

function appendCell(row, value, className = '') {
  const cell = document.createElement('td');
  cell.textContent = value === null || value === undefined ? '—' : String(value);
  if (className) cell.className = className;
  row.appendChild(cell);
  return cell;
}

function explorerLink(signature) {
  const link = document.createElement('a');
  link.className = 'app-activity-link';
  link.href = `https://explorer.solana.com/tx/${encodeURIComponent(signature)}?cluster=devnet`;
  link.target = '_blank';
  link.rel = 'noreferrer';
  link.textContent = short(signature, 12, 8);
  return link;
}

function explorerAddressLink(address) {
  const link = document.createElement('a');
  link.className = 'app-activity-link';
  link.href = `https://explorer.solana.com/address/${encodeURIComponent(address)}?cluster=devnet`;
  link.target = '_blank';
  link.rel = 'noreferrer';
  link.textContent = short(address, 8, 6);
  return link;
}

function formatTime(value) {
  if (!value) return '—';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '—' : date.toLocaleString(undefined, { hour12: false });
}

function formatSol(lamports) {
  if (typeof lamports !== 'string' || !/^\d+$/.test(lamports)) return '—';
  return `${formatTokenAmount(lamports, 9, 6)} SOL`;
}

function providerAddress(provider) {
  const key = provider?.publicKey;
  if (!key) return null;
  const address = typeof key === 'string' ? key : key.toString();
  try { decodeSolanaAddress(address); return address; } catch { return null; }
}

function injectedWallet() {
  return window.phantom?.solana || window.solana || null;
}

function activeAddress() { return sessionProof?.address || null; }

function renderSession() {
  const authenticated = Boolean(sessionProof);
  byId('login-view').hidden = authenticated;
  byId('workspace-view').hidden = !authenticated;
  byId('sign-out').hidden = !authenticated;
  byId('session-chip').textContent = authenticated ? 'LOCAL SESSION · DEVNET' : 'WALLET · SIGN IN';
  byId('connect-wallet').textContent = !authenticated
    ? 'Sign in with wallet'
    : connectedAddress === activeAddress() ? 'Refresh account' : 'Reconnect wallet';
  if (authenticated) {
    byId('wallet-address').textContent = activeAddress();
    byId('wallet-connection-state').textContent = connectedAddress === activeAddress()
      ? 'Proof verified · wallet connected'
      : 'Proof verified · reconnect wallet for live balances';
    renderPortfolio();
    renderWatchlist();
    renderHistory();
  } else {
    byId('wallet-address').textContent = '—';
    byId('wallet-connection-state').textContent = 'No active wallet proof';
    byId('saved-order-count').textContent = '0';
  }
}

function renderPortfolio() {
  byId('sol-balance').textContent = portfolioData.balance === null ? '—' : formatSol(portfolioData.balance);
  byId('balance-source').textContent = portfolioData.balance === null ? 'Devnet RPC · connect wallet to load' : 'Devnet RPC · confirmed';
  byId('token-count').textContent = String(portfolioData.tokens.length);
  byId('chain-tx-count').textContent = String(portfolioData.signatures.length);
  const rows = byId('portfolio-rows');
  if (connectedAddress !== activeAddress()) {
    emptyRow(rows, 4, 'Reconnect the verified wallet to load live Devnet balances.');
    return;
  }
  if (!portfolioData.tokens.length) {
    emptyRow(rows, 4, 'No SPL Token or Token-2022 balances found on Devnet.');
    return;
  }
  rows.replaceChildren();
  portfolioData.tokens.forEach((token) => {
    const row = document.createElement('tr');
    const mint = appendCell(row, '', 'app-mint-cell');
    mint.title = token.mint;
    mint.appendChild(explorerAddressLink(token.mint));
    appendCell(row, formatTokenAmount(token.amount, token.decimals, Math.min(token.decimals, 6)));
    appendCell(row, token.decimals);
    appendCell(row, 'Solana Devnet RPC');
    rows.appendChild(row);
  });
}

function renderWatchlist() {
  const root = byId('watchlist');
  const portfolio = readPortfolio(activeAddress());
  root.replaceChildren();
  if (!portfolio.watchlist.length) {
    const note = document.createElement('span');
    note.className = 'app-muted';
    note.textContent = 'No saved token mints.';
    root.appendChild(note);
    return;
  }
  portfolio.watchlist.forEach((mint) => {
    const item = document.createElement('span');
    item.className = 'app-watch-item';
    const code = document.createElement('code');
    code.textContent = short(mint, 8, 6);
    code.title = mint;
    const remove = document.createElement('button');
    remove.type = 'button';
    remove.dataset.removeMint = mint;
    remove.setAttribute('aria-label', `Remove saved mint ${short(mint)}`);
    remove.textContent = '×';
    item.append(code, remove);
    root.appendChild(item);
  });
}

function renderHistory() {
  const rows = byId('activity-rows');
  if (!sessionProof) {
    emptyRow(rows, 4, 'Sign in to load saved orders and Devnet transactions.');
    return;
  }
  const orders = readOrders(activeAddress());
  byId('saved-order-count').textContent = String(orders.length);
  const orderSignatures = new Set(orders.filter((order) => order.signature).map((order) => order.signature));
  const entries = orders.map((order) => ({
    epoch: Date.parse(order.createdAt),
    time: order.createdAt,
    kind: `${order.side} ${short(order.side === 'BUY' ? order.outputMint : order.inputMint)}`,
    state: order.status.toUpperCase(),
    signature: order.signature,
    slot: null,
  }));
  portfolioData.signatures.forEach((entry) => {
    if (orderSignatures.has(entry.signature)) return;
    entries.push({
      epoch: (entry.blockTime || 0) * 1000,
      time: entry.blockTime ? new Date(entry.blockTime * 1000).toISOString() : null,
      kind: 'WALLET TRANSACTION',
      state: entry.err !== null ? 'FAILED' : (entry.confirmationStatus || 'CONFIRMED').toUpperCase(),
      signature: entry.signature,
      slot: entry.slot,
    });
  });
  entries.sort((left, right) => right.epoch - left.epoch);
  if (!entries.length) {
    emptyRow(rows, 4, connectedAddress === activeAddress() ? 'No saved orders or recent Devnet transactions.' : 'Reconnect wallet to load Devnet transactions.');
    return;
  }
  rows.replaceChildren();
  entries.slice(0, APP_ORDER_HISTORY).forEach((entry) => {
    const row = document.createElement('tr');
    appendCell(row, formatTime(entry.time));
    appendCell(row, entry.kind);
    appendCell(row, entry.state);
    const last = document.createElement('td');
    if (entry.signature) last.appendChild(explorerLink(entry.signature));
    else last.textContent = entry.slot ? `slot ${entry.slot}` : '—';
    if (entry.slot) {
      const slot = document.createElement('span');
      slot.className = 'app-muted';
      slot.textContent = ` · slot ${entry.slot}`;
      last.appendChild(slot);
    }
    row.appendChild(last);
    rows.appendChild(row);
  });
}

function requireSession() {
  if (!sessionProof) throw new Error('Sign in with the wallet before using this action.');
}

function scheduleSessionExpiry(proof) {
  const expiryMs = Date.parse(proof.expirationTime) - Date.now();
  window.setTimeout(() => {
    if (sessionProof !== proof) return;
    signOut();
    setAppStatus('Wallet session expired. Sign in again to continue.');
  }, Math.max(0, expiryMs));
}

async function connectVerifiedWallet() {
  const provider = injectedWallet();
  if (!provider || typeof provider.connect !== 'function') throw new Error('No compatible Solana wallet was found. Install a wallet with connect and message-signing support.');
  const result = await provider.connect();
  const address = providerAddress({ publicKey: result?.publicKey || provider.publicKey });
  if (!address) throw new Error('Wallet returned an invalid public key.');
  walletProvider = provider;
  connectedAddress = address;
  bindWalletEvents(provider);
  return address;
}

async function signIn() {
  const address = await connectVerifiedWallet();
  const provider = walletProvider;
  if (typeof provider.signMessage !== 'function') throw new Error('This wallet cannot sign a sign-in message. No transaction was created.');
  const request = createSignInRequest({ address, origin: window.location.origin });
  setAppStatus('Wallet connected. Confirm the sign-in message in your wallet.');
  const result = await provider.signMessage(new TextEncoder().encode(request.message), 'utf8');
  setAppStatus('Wallet returned a signature. Checking wallet ownership and site origin.');
  const signature = signatureBytes(result);
  if (!signature || signature.length !== 64) throw new Error('Wallet returned an invalid sign-in signature.');
  const signedAddress = providerAddress({ publicKey: result?.publicKey || provider.publicKey });
  if (signedAddress !== address) throw new Error('Wallet account changed during sign-in.');
  const proof = { ...request, signature: bytesToBase64(signature) };
  if (!await verifySignInProof(proof, window.location.origin)) throw new Error('Wallet signature did not verify for this origin.');
  writeSession(proof);
  sessionProof = proof;
  scheduleSessionExpiry(proof);
  renderSession();
  byId('overview').scrollIntoView({ block: 'start' });
  setAppStatus('Wallet proof verified. Dashboard opened. Refreshing Devnet account data.', 'success');
  await refreshAccount();
}

function bindWalletEvents(provider) {
  if (provider === boundProvider || typeof provider.on !== 'function') return;
  boundProvider = provider;
  provider.on('accountChanged', (key) => {
    const nextAddress = key ? providerAddress({ publicKey: key }) : null;
    if (nextAddress !== activeAddress()) {
      connectedAddress = null;
      walletProvider = null;
      invalidateQuote();
      renderSession();
      setAppStatus('Wallet account changed. Sign out, then sign in again with the selected account.', 'error');
      return;
    }
    connectedAddress = nextAddress;
    renderSession();
  });
  provider.on('disconnect', () => {
    connectedAddress = null;
    walletProvider = null;
    invalidateQuote();
    renderSession();
    setAppStatus('Wallet disconnected. Your browser-saved portfolio and orders remain available.');
  });
}

async function connectAction() {
  if (authInFlight) return;
  authInFlight = true;
  const buttons = [byId('connect-wallet'), byId('login-action')];
  buttons.forEach((button) => { button.disabled = true; });
  try {
    if (!sessionProof) {
      setAppStatus('Connecting to the selected wallet.');
      await signIn();
      return;
    }
    const address = await connectVerifiedWallet();
    if (address !== activeAddress()) {
      connectedAddress = null;
      walletProvider = null;
      throw new Error('Connected wallet does not match the signed-in wallet. Sign out and authenticate the selected account.');
    }
    renderSession();
    await refreshAccount();
  } catch (error) {
    setAppStatus(error?.message || 'Wallet connection failed.', 'error');
    byId('app-status').scrollIntoView({ block: 'center' });
  } finally {
    authInFlight = false;
    buttons.forEach((button) => { button.disabled = false; });
  }
}

function signOut() {
  try { clearSession(); } catch {}
  const provider = walletProvider;
  sessionProof = null;
  connectedAddress = null;
  walletProvider = null;
  portfolioData = { balance: null, tokens: [], signatures: [] };
  invalidateQuote();
  try { provider?.disconnect?.(); } catch {}
  renderSession();
  setAppStatus('Signed out. Saved portfolio and order records remain on this browser.');
}

async function refreshAccount() {
  requireSession();
  if (connectedAddress !== activeAddress()) throw new Error('Reconnect the signed-in wallet to read Devnet account data.');
  setAppStatus('Reading wallet balances and recent signatures from Solana Devnet…');
  const reads = await Promise.allSettled([
    getDevnetBalance(activeAddress()),
    getDevnetTokenAccounts(activeAddress()),
    getDevnetSignatures(activeAddress(), 20),
  ]);
  const errors = [];
  if (reads[0].status === 'fulfilled') portfolioData.balance = reads[0].value;
  else errors.push(`SOL balance: ${reads[0].reason?.message || 'unavailable'}`);
  if (reads[1].status === 'fulfilled') portfolioData.tokens = reads[1].value;
  else errors.push(`token balances: ${reads[1].reason?.message || 'unavailable'}`);
  if (reads[2].status === 'fulfilled') portfolioData.signatures = reads[2].value;
  else errors.push(`transaction history: ${reads[2].reason?.message || 'unavailable'}`);
  renderSession();
  if (errors.length === 3) setAppStatus(`Devnet data could not load. ${errors.join(' · ')}`, 'error');
  else if (errors.length) setAppStatus(`Some Devnet data loaded. ${errors.join(' · ')}`, 'error');
  else setAppStatus(`Devnet data refreshed from ${DEVNET_RPC}.`, 'success');
}

function addWatchMint(event) {
  event.preventDefault();
  try {
    requireSession();
    const mint = byId('watch-mint').value.trim();
    decodeSolanaAddress(mint);
    const portfolio = readPortfolio(activeAddress());
    if (portfolio.watchlist.includes(mint)) throw new Error('This mint is already saved.');
    if (portfolio.watchlist.length >= 24) throw new Error('The saved mint list is full.');
    writePortfolio(activeAddress(), { watchlist: [...portfolio.watchlist, mint] });
    byId('watch-mint').value = '';
    renderWatchlist();
    setAppStatus('Token mint saved in this browser for the signed-in wallet.', 'success');
  } catch (error) {
    setAppStatus(error?.message || 'Could not save this mint.', 'error');
  }
}

function removeWatchMint(event) {
  const button = event.target.closest('button[data-remove-mint]');
  if (!button || !sessionProof) return;
  const portfolio = readPortfolio(activeAddress());
  writePortfolio(activeAddress(), { watchlist: portfolio.watchlist.filter((mint) => mint !== button.dataset.removeMint) });
  renderWatchlist();
  setAppStatus('Saved mint removed from this browser.');
}

function amountToBaseUnits(value, decimals) {
  const amount = typeof value === 'string' ? value.trim() : '';
  if (amount.length > 40) throw new Error('Input amount is too long.');
  const pattern = decimals === 0 ? /^\d+$/ : new RegExp(`^\\d+(?:\\.\\d{1,${decimals}})?$`);
  if (!pattern.test(amount)) throw new Error(`Enter a positive amount with no more than ${decimals} decimal places.`);
  const [whole, fraction = ''] = amount.split('.');
  const units = BigInt(whole) * (10n ** BigInt(decimals)) + BigInt((fraction + '0'.repeat(decimals)).slice(0, decimals) || '0');
  if (units <= 0n || units > 18446744073709551615n) throw new Error('Input amount is outside the supported token range.');
  return units.toString();
}

function invalidateQuote() {
  quoteRevision += 1;
  activeQuote = null;
  byId('quote-panel').hidden = true;
  byId('sign-send').disabled = true;
  if (byId('trade-result')) setTradeResult('Quote cleared. Review the order fields and request a new quote.');
}

async function requestQuote() {
  requireSession();
  if (connectedAddress !== activeAddress()) throw new Error('Reconnect the signed-in wallet before quoting a trade.');
  const side = byId('order-side').value;
  const assetMint = byId('asset-mint').value.trim();
  const quoteMint = byId('quote-mint').value.trim();
  decodeSolanaAddress(assetMint);
  decodeSolanaAddress(quoteMint);
  if (assetMint === quoteMint) throw new Error('Asset and quote mints must differ.');
  const inputMint = side === 'BUY' ? quoteMint : assetMint;
  const outputMint = side === 'BUY' ? assetMint : quoteMint;
  const [inputDecimals, outputDecimals] = await Promise.all([
    getDevnetTokenDecimals(inputMint),
    getDevnetTokenDecimals(outputMint),
  ]);
  if (inputDecimals > TOKEN_DECIMAL_LIMIT || outputDecimals > TOKEN_DECIMAL_LIMIT) throw new Error('Token precision is outside this ticket’s supported range.');
  const inputBaseUnits = amountToBaseUnits(byId('order-amount').value, inputDecimals);
  const quote = await getDevnetQuote({ inputMint, outputMint, amount: inputBaseUnits });
  const outputBaseUnits = quote?.data?.outputAmount;
  if (typeof outputBaseUnits !== 'string' || !/^\d+$/.test(outputBaseUnits) || BigInt(outputBaseUnits) <= 0n) {
    throw new Error('Raydium returned an invalid Devnet output amount.');
  }
  const rawImpact = quote?.data?.priceImpactPct;
  const priceImpact = rawImpact === undefined || rawImpact === null ? null : String(rawImpact);
  if (priceImpact !== null && (priceImpact.length > 32 || !Number.isFinite(Number(priceImpact)) || Math.abs(Number(priceImpact)) > 100)) {
    throw new Error('Raydium returned an invalid price-impact value.');
  }
  const poolIds = quote.data.routePlan.map((leg) => leg.poolId);
  return { side, assetMint, quoteMint, poolIds, inputMint, outputMint, inputDecimals, outputDecimals, inputBaseUnits, quote, outputBaseUnits };
}

async function getQuoteAction() {
  const button = byId('get-quote');
  const revision = ++quoteRevision;
  activeQuote = null;
  byId('sign-send').disabled = true;
  byId('quote-panel').hidden = true;
  button.disabled = true;
  setTradeResult('Requesting a Devnet quote and checking each Raydium pool…');
  try {
    const trade = await requestQuote();
    if (revision !== quoteRevision) return;
    const order = {
      id: crypto.randomUUID(),
      wallet: activeAddress(),
      network: 'devnet',
      side: trade.side,
      poolId: trade.poolIds[0],
      poolIds: trade.poolIds,
      inputMint: trade.inputMint,
      outputMint: trade.outputMint,
      inputAmount: byId('order-amount').value.trim(),
      inputBaseUnits: trade.inputBaseUnits,
      inputDecimals: trade.inputDecimals,
      outputBaseUnits: trade.outputBaseUnits,
      outputDecimals: trade.outputDecimals,
      priceImpact: trade.quote?.data?.priceImpactPct === undefined || trade.quote?.data?.priceImpactPct === null
        ? null : String(trade.quote.data.priceImpactPct),
      status: 'quoted',
      signature: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    saveOrder(activeAddress(), order);
    activeQuote = { ...trade, order };
    byId('quote-input').textContent = `${order.inputAmount} ${short(trade.inputMint)}`;
    byId('quote-output').textContent = `${formatTokenAmount(trade.outputBaseUnits, trade.outputDecimals)} ${short(trade.outputMint)}`;
    byId('quote-impact').textContent = order.priceImpact === null ? '—' : `${order.priceImpact}%`;
    byId('quote-pool').textContent = trade.poolIds.map((poolId) => short(poolId)).join(' → ');
    byId('quote-panel').hidden = false;
    byId('sign-send').disabled = false;
    renderHistory();
    setTradeResult(`Quote verified across ${trade.poolIds.length} Devnet Raydium pool${trade.poolIds.length === 1 ? '' : 's'}. Review it before signing.`, 'success');
  } catch (error) {
    if (revision === quoteRevision) setTradeResult(error?.message || 'Devnet quote failed.', 'error');
  } finally {
    button.disabled = false;
  }
}

function bytesToBase64Transaction(bytes) {
  let binary = '';
  for (let offset = 0; offset < bytes.length; offset += 8192) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 8192));
  }
  return btoa(binary);
}

async function simulateSignSend() {
  requireSession();
  if (tradeInFlight) return;
  const provider = walletProvider;
  const signer = activeAddress();
  if (!provider || connectedAddress !== signer || providerAddress(provider) !== signer) {
    throw new Error('Reconnect the signed-in wallet before signing this Devnet order.');
  }
  if (typeof provider.signTransaction !== 'function') throw new Error('This wallet cannot sign transactions. No transaction was sent.');
  const trade = activeQuote;
  const revision = quoteRevision;
  if (!trade) throw new Error('Request and review a fresh quote before signing.');
  tradeInFlight = true;
  byId('sign-send').disabled = true;
  byId('get-quote').disabled = true;
  let predictedSignature = null;
  let sentSignature = null;
  let sendAttempted = false;
  try {
    setTradeResult('Building one unsigned Devnet transaction…');
    const payload = await buildDevnetUnsignedSwap({
      quoteResponse: trade.quote,
      userPublicKey: signer,
      inputMint: trade.inputMint,
      outputMint: trade.outputMint,
      amount: trade.inputBaseUnits,
    });
    if (revision !== quoteRevision || activeQuote !== trade || providerAddress(provider) !== signer) {
      throw new Error('The wallet or order changed during transaction build. Nothing was signed.');
    }
    if (typeof payload !== 'string' || !payload) throw new Error('Raydium returned no unsigned transaction.');
    const web3 = await import(SIGNER_LIBRARY);
    if (revision !== quoteRevision || activeQuote !== trade || providerAddress(provider) !== signer) {
      throw new Error('The wallet or order changed before simulation. Nothing was signed.');
    }
    const transaction = web3.VersionedTransaction.deserialize(Uint8Array.from(atob(payload), (character) => character.charCodeAt(0)));
    if (!transaction.signatures.length || transaction.signatures.some((signature) => signature.some((byte) => byte !== 0))) {
      throw new Error('Raydium transaction is already signed or has no required signer. Refusing to send.');
    }
    const blockhashWindow = await getDevnetBlockhash();
    transaction.message.recentBlockhash = blockhashWindow.blockhash;
    const unsignedMessage = transaction.message.serialize();
    const simulation = bytesToBase64Transaction(transaction.serialize());
    await simulateDevnet(simulation);
    if (revision !== quoteRevision || activeQuote !== trade || providerAddress(provider) !== signer) {
      throw new Error('The wallet or order changed during simulation. Nothing was signed.');
    }
    const signerKeys = transaction.message.staticAccountKeys || transaction.message.accountKeys || [];
    const requiredSignerKeys = signerKeys.slice(0, transaction.message.header.numRequiredSignatures).map((key) => key.toString());
    const readyOrder = updateOrder(signer, trade.order.id, { status: 'ready' });
    const signed = await provider.signTransaction(transaction);
    if (revision !== quoteRevision || activeQuote !== trade || providerAddress(provider) !== signer) {
      throw new Error('Wallet account or order changed after signing. Nothing was sent.');
    }
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
    predictedSignature = encodeSignatureBase58(verified.signature);
    updateOrder(signer, readyOrder.id, { signature: predictedSignature, status: 'ready' });
    const blockHeight = await getDevnetBlockHeight();
    if (blockHeight > blockhashWindow.lastValidBlockHeight) throw new Error('Devnet blockhash expired. Nothing was sent. Get a new quote.');
    if (revision !== quoteRevision || activeQuote !== trade || providerAddress(provider) !== signer) {
      throw new Error('Wallet account or order changed before send. Nothing was sent.');
    }
    setTradeResult(`Submitting to Devnet. Check signature ${predictedSignature} before retrying.`);
    sendAttempted = true;
    activeQuote = null;
    byId('quote-panel').hidden = true;
    sentSignature = await sendDevnet(bytesToBase64Transaction(signed.serialize()));
    if (sentSignature !== predictedSignature) {
      updateOrder(signer, readyOrder.id, { signature: predictedSignature, status: 'send-unknown' });
      renderHistory();
      setTradeResult(`RPC signature mismatch. Check both signatures before retrying: ${predictedSignature} / ${sentSignature}`, 'error');
      return;
    }
    updateOrder(signer, readyOrder.id, { signature: sentSignature, status: 'sent' });
    activeQuote = null;
    byId('quote-panel').hidden = true;
    renderHistory();
    setTradeResult(`Sent to Solana Devnet. Checking ${sentSignature}…`);
    const outcome = await waitForDevnetConfirmation(sentSignature, { timeoutMs: 30000, pollIntervalMs: 1000 });
    if (outcome.status === 'confirmed') {
      updateOrder(signer, readyOrder.id, { signature: sentSignature, status: 'confirmed' });
      setTradeResult(`Confirmed on Devnet (${outcome.confirmationStatus}): ${sentSignature}`, 'success');
    } else if (outcome.status === 'failed') {
      updateOrder(signer, readyOrder.id, { signature: sentSignature, status: 'failed' });
      setTradeResult(`Devnet transaction failed: ${JSON.stringify(outcome.err)} · ${sentSignature}`, 'error');
    } else {
      updateOrder(signer, readyOrder.id, { signature: sentSignature, status: 'pending' });
      setTradeResult(`Confirmation is pending. Check the Devnet signature before retrying: ${sentSignature}`);
    }
    await refreshAccount();
  } catch (error) {
    if (sendAttempted && predictedSignature && !sentSignature) {
      try { updateOrder(signer, trade.order.id, { signature: predictedSignature, status: 'send-unknown' }); } catch {}
      setTradeResult(`Send status is unknown. Check this Devnet signature before retrying: ${predictedSignature}. ${error?.message || ''}`, 'error');
    } else if (!sentSignature && activeQuote?.order?.id === trade?.order?.id) {
      try { updateOrder(signer, trade.order.id, { signature: null, status: 'quoted' }); } catch {}
      setTradeResult(error?.message || 'Transaction was not sent.', 'error');
    } else if (sentSignature) {
      try { updateOrder(signer, trade.order.id, { signature: sentSignature, status: 'lookup-failed' }); } catch {}
      setTradeResult(`Transaction may have been sent. Check before retrying: ${sentSignature}. ${error?.message || ''}`, 'error');
    } else {
      setTradeResult(error?.message || 'Transaction was not sent.', 'error');
    }
    renderHistory();
  } finally {
    tradeInFlight = false;
    byId('get-quote').disabled = false;
    byId('sign-send').disabled = !activeQuote;
  }
}

function bindUI() {
  byId('connect-wallet').addEventListener('click', connectAction);
  byId('login-action').addEventListener('click', connectAction);
  byId('sign-out').addEventListener('click', signOut);
  byId('refresh-account').addEventListener('click', () => refreshAccount().catch((error) => setAppStatus(error?.message || 'Devnet refresh failed.', 'error')));
  byId('refresh-history').addEventListener('click', () => refreshAccount().catch((error) => setAppStatus(error?.message || 'History refresh failed.', 'error')));
  byId('watch-form').addEventListener('submit', addWatchMint);
  byId('watchlist').addEventListener('click', removeWatchMint);
  byId('get-quote').addEventListener('click', getQuoteAction);
  byId('sign-send').addEventListener('click', () => simulateSignSend().catch((error) => setTradeResult(error?.message || 'Devnet order failed.', 'error')));
  ['order-side', 'order-amount', 'asset-mint', 'quote-mint'].forEach((id) => {
    byId(id).addEventListener('input', invalidateQuote);
    byId(id).addEventListener('change', invalidateQuote);
  });
}

async function restoreSession() {
  const saved = readSession();
  if (!saved) return;
  if (await verifySignInProof(saved, window.location.origin)) {
    sessionProof = saved;
    renderSession();
    scheduleSessionExpiry(saved);
    setAppStatus('Wallet sign-in proof verified in this browser. Reconnect the wallet to read Devnet data or trade.', 'success');
  } else {
    try { clearSession(); } catch {}
    setAppStatus('Saved wallet proof expired or failed verification. Sign in again.');
  }
}

bindUI();
restoreSession().catch(() => setAppStatus('Wallet proof could not be restored. Sign in again.', 'error'));
