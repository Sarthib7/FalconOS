import { createHash, createPublicKey, verify } from 'node:crypto';
import { PublicKey } from '@solana/web3.js';
import { LENDING_CONFIG as C, deriveAccounts, buildLendingTransaction, validateLendingTransaction, deserializeLendingTransaction, lendingAmount } from './kamino-wire.mjs';
import { MeshError } from './domain.mjs';

const SCALE = 1n << 60n;
const BODY_LIMIT = 128 * 1024;
const TIMEOUT_MS = 8000;
const NULL_ORACLE = 'nu11111111111111111111111111111111111111111';
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const stamp = now => {
  const value = now();
  if (typeof value !== 'string' || new Date(value).toISOString() !== value) throw new Error('Capture clock is invalid.');
  return value;
};
const check = (condition, reason) => { if (!condition) throw new Error(reason); };
const equal = (a, b) => a.length === b.length && a.every((value, i) => value === b[i]);
const u64 = (bytes, offset) => bytes.readBigUInt64LE(offset);
const u128 = (bytes, offset) => u64(bytes, offset) + (u64(bytes, offset + 8) << 64n);
const address = (bytes, offset) => new PublicKey(bytes.subarray(offset, offset + 32)).toBase58();
const slotNumber = value => Number.isSafeInteger(value) && value > 0;
const unsigned = value => typeof value === 'string' && /^(0|[1-9][0-9]{0,19})$/.test(value) && BigInt(value) <= 18446744073709551615n;

function fromBase64(value, limit = BODY_LIMIT) {
  check(typeof value === 'string' && value.length <= Math.ceil(limit / 3) * 4, 'Base64 data exceeds its limit.');
  const bytes = Buffer.from(value, 'base64');
  check(bytes.length <= limit && bytes.toString('base64') === value, 'Base64 data is invalid.');
  return bytes;
}

function createRpc(fetchImpl, now, exchanges) {
  return async (method, params = []) => {
    const id = exchanges.length + 1;
    const startedAt = stamp(now);
    const body = Buffer.from(JSON.stringify({ jsonrpc: '2.0', id, method, params }));
    const controller = new AbortController();
    let timer;
    const timeout = new Promise((_, reject) => {
      timer = setTimeout(() => { controller.abort(); reject(new Error('Devnet RPC timed out.')); }, TIMEOUT_MS);
    });
    try {
      return await Promise.race([timeout, (async () => {
        const response = await fetchImpl(C.rpcUrl, {
          method: 'POST', headers: { 'content-type': 'application/json' }, body,
          redirect: 'error', signal: controller.signal,
        });
        check(!response.redirected && response.body?.getReader, 'Devnet RPC response transport is invalid.');
        const reader = response.body.getReader();
        const chunks = [];
        let size = 0;
        for (;;) {
          const { done, value } = await reader.read();
          check(!controller.signal.aborted, 'Devnet RPC timed out.');
          if (done) break;
          size += value.byteLength;
          if (size > BODY_LIMIT) { await reader.cancel(); throw new Error('Devnet RPC response is too large.'); }
          chunks.push(Buffer.from(value));
        }
        const raw = Buffer.concat(chunks);
        check(!controller.signal.aborted, 'Devnet RPC timed out.');
        const completedAt = stamp(now);
        exchanges.push({ url: C.rpcUrl, startedAt, completedAt,
          request: { method: 'POST', rpcMethod: method, bodyBase64: body.toString('base64') },
          response: { httpStatus: response.status, contentType: response.headers.get('content-type'),
            bodyBase64: raw.toString('base64'), byteLength: raw.length, sha256: sha256(raw) } });
        check(response.ok, 'Devnet RPC returned an HTTP error.');
        let envelope;
        try { envelope = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(raw)); }
        catch { throw new Error('Devnet RPC returned invalid JSON.'); }
        check(envelope && envelope.jsonrpc === '2.0' && envelope.id === id && !Object.hasOwn(envelope, 'error')
          && Object.hasOwn(envelope, 'result'), 'Devnet RPC returned an invalid envelope.');
        return envelope.result;
      })()]);
    } catch {
      throw new MeshError('STORAGE_UNAVAILABLE', 'Devnet RPC evidence is unavailable or invalid.');
    } finally { clearTimeout(timer); }
  };
}

function accountBytes(account, owner, length, executable = false) {
  check(account && account.owner === owner && account.executable === executable
    && Array.isArray(account.data) && account.data.length === 2 && account.data[1] === 'base64', 'Account owner or encoding does not match.');
  const bytes = fromBase64(account.data[0]);
  check(bytes.length === length && (!Object.hasOwn(account, 'space') || account.space === length), 'Account layout does not match.');
  return bytes;
}

function tokenAccount(account, mint, owner, missing = false) {
  if (account === null && missing) return null;
  const data = accountBytes(account, C.tokenProgram, 165);
  check(address(data, 0) === mint && address(data, 32) === owner && data[108] === 1, 'Token account identity or state does not match.');
  return u64(data, 64);
}

function tokenMint(account, authority = null) {
  const data = accountBytes(account, C.tokenProgram, 82);
  check(data[44] === C.decimals && data[45] === 1, 'Token mint decimals or state does not match.');
  if (authority) check(data.readUInt32LE(0) === 1 && address(data, 4) === authority, 'Receipt mint authority does not match.');
  return u64(data, 36);
}

function decodeSnapshot(result, a, at, action, amount) {
  check(result && slotNumber(result.context?.slot) && Array.isArray(result.value) && result.value.length === 11, 'Coherent account snapshot is incomplete.');
  const slot = result.context.slot;
  const [reserveAccount, marketAccount, mintAccount, receiptAccount, vaultAccount, walletLiquidityAccount,
    walletReceiptAccount, walletAccount, programAccount, oracleAccount, clockAccount] = result.value;
  const r = accountBytes(reserveAccount, C.program, 8624);
  const m = accountBytes(marketAccount, C.program, 4664);
  check(equal(r.subarray(0, 8), [43, 242, 204, 202, 26, 247, 59, 127])
    && equal(m.subarray(0, 8), [246, 114, 50, 98, 72, 157, 28, 120]), 'Reserve or market discriminator does not match.');
  check(u64(r, 8) === 1n && u64(m, 8) === 1n && u64(r, 16) <= BigInt(slot), 'Reserve or market version/update is invalid.');
  check(address(r, 32) === a.market && address(r, 128) === a.liquidityMint && address(r, 160) === a.liquidityVault
    && address(r, 2560) === a.receiptMint && address(r, 2600) === C.collateralVault && address(r, 408) === C.tokenProgram
    && u64(r, 272) === 6n && u64(m, 16) === BigInt(a.marketAuthorityBump), 'Reserve account relationships do not match.');
  check(m[122] === 0 && r[4864] === 0, 'Lending market or reserve is in emergency mode.');
  if (action === 'supply') {
    check(r[4856] === 0 && r[4862] === 0, 'Direct reserve supply is disabled.');
    check(address(m, 3400) === C.systemProgram || ((u64(m, 3432) | u64(r, 5800)) & 1n) === 0n, 'Deposit requires another signer.');
  }
  const program = accountBytes(programAccount, C.loader, 36, true);
  check(program.readUInt32LE(0) === 2 && address(program, 4) === C.programData, 'Lending program deployment does not match.');
  tokenMint(mintAccount);
  const receiptMintSupply = tokenMint(receiptAccount, a.marketAuthority);
  const vault = tokenAccount(vaultAccount, a.liquidityMint, a.marketAuthority);
  const walletLiquidity = tokenAccount(walletLiquidityAccount, a.liquidityMint, a.wallet, action === 'redeem');
  const walletReceipt = tokenAccount(walletReceiptAccount, a.receiptMint, a.wallet, action === 'supply');
  accountBytes(walletAccount, C.systemProgram, 0);
  check(Number.isSafeInteger(walletAccount.lamports) && walletAccount.lamports > 0, 'Wallet has no usable Devnet SOL balance.');
  check((action === 'supply' ? walletLiquidity : walletReceipt) >= amount, 'Wallet token balance is insufficient.');
  const clock = accountBytes(clockAccount, 'Sysvar1111111111111111111111111111111111111', 40);
  const chainTime = clock.readBigInt64LE(32);
  check(u64(clock, 0) === BigInt(slot) && chainTime >= 0n
    && Math.abs(Number(chainTime) * 1000 - Date.parse(at)) <= 60000, 'Devnet clock is stale or incoherent.');
  check(address(r, 5224) === C.oracle && address(r, 5112) === NULL_ORACLE
    && address(r, 5160) === NULL_ORACLE && address(r, 5192) === NULL_ORACLE && r[5256] === 0, 'Reserve oracle configuration changed.');
  const oracle = accountBytes(oracleAccount, C.oracleProgram, 134);
  check(equal(oracle.subarray(0, 8), createHash('sha256').update('account:PriceUpdateV2').digest().subarray(0, 8))
    && oracle[40] === 1 && oracle.subarray(41, 73).toString('hex') === C.oracleFeed, 'Oracle identity or verification is invalid.');
  const publishTime = oracle.readBigInt64LE(93);
  const maxAge = u64(r, 5096);
  check(oracle.readBigInt64LE(73) > 0n && publishTime <= chainTime && maxAge > 0n
    && chainTime - publishTime <= maxAge && chainTime - publishTime <= 180n && u64(oracle, 125) <= BigInt(slot), 'Oracle price is stale or invalid.');
  const available = u64(r, 224);
  check(vault === available, 'Reserve liquidity and token vault disagree.');
  const totalSf = available * SCALE + u128(r, 232) - u128(r, 344) - u128(r, 360) - u128(r, 376);
  const collateralSupply = u64(r, 2592);
  check(totalSf > 0n && collateralSupply > 0n, 'Reserve exchange rate is unavailable.');
  const queued = u64(r, 6968) * totalSf / (collateralSupply * SCALE);
  const freelyAvailable = available > queued ? available - queued : 0n;
  if (action === 'supply') check(totalSf + amount * SCALE <= u64(r, 5016) * SCALE, 'Reserve deposit limit would be exceeded.');
  else {
    const expected = amount * totalSf / (collateralSupply * SCALE);
    check(expected > 0n && expected <= freelyAvailable, 'Reserve has insufficient freely available liquidity.');
    const interval = u64(r, 5440);
    const capacity = r.readBigInt64LE(5416);
    const current = r.readBigInt64LE(5424);
    const start = u64(r, 5432);
    check(start <= chainTime, 'Withdrawal cap timestamp is invalid.');
    if (interval !== 0n) {
      const used = chainTime - start >= interval ? 0n : current;
      check(capacity >= 0n && expected <= capacity - used, 'Reserve withdrawal cap would be exceeded.');
    }
  }
  return {
    reserveVersion: '1', marketVersion: '1', reserveStatus: r[4856], blockCtokenUsage: r[4862],
    availableLiquidityBaseUnits: available.toString(), freelyAvailableLiquidityBaseUnits: freelyAvailable.toString(),
    queuedCollateralBaseUnits: u64(r, 6968).toString(), totalLiquiditySf: totalSf.toString(),
    collateralSupplyBaseUnits: collateralSupply.toString(), receiptMintSupplyBaseUnits: receiptMintSupply.toString(),
    walletLiquidityBaseUnits: (walletLiquidity ?? 0n).toString(), walletReceiptBaseUnits: (walletReceipt ?? 0n).toString(),
    walletLiquidityExists: walletLiquidity !== null, walletReceiptExists: walletReceipt !== null,
    chainTimestamp: chainTime.toString(), oraclePublishTime: publishTime.toString(),
    oraclePrice: oracle.readBigInt64LE(73).toString(), oracleExponent: oracle.readInt32LE(89),
    createDestinationAta: action === 'supply' ? walletReceipt === null : walletLiquidity === null,
  };
}

function snapshotGraph(a, decoded, slot) {
  const node = (id, kind, label, properties = {}) => ({ id, kind, label, properties });
  const edge = (source, target, relation) => ({ id: `${source}:${relation}:${target}`, source, target, relation });
  const nodes = [
    node(a.wallet, 'wallet', 'Connected wallet address', { control: 'unverified' }),
    node(a.reserve, 'reserve', 'Kamino Devnet USDC reserve', { availableLiquidityBaseUnits: decoded.availableLiquidityBaseUnits }),
    node(a.market, 'market', 'Kamino lending market'), node(C.program, 'program', 'Kamino Lending program'),
    node(a.liquidityMint, 'asset', 'Circle Devnet USDC', { decimals: 6 }),
    node(a.receiptMint, 'asset', 'Reserve receipt token', { decimals: 6 }),
    node(a.liquidityVault, 'token_account', 'Reserve liquidity vault', { amountBaseUnits: decoded.availableLiquidityBaseUnits }),
    node(C.oracle, 'oracle', 'Pyth USDC price', { publishTime: decoded.oraclePublishTime }),
  ];
  const edges = [edge(a.reserve, a.market, 'belongs_to'), edge(a.reserve, C.program, 'owned_by_program'),
    edge(a.market, C.program, 'owned_by_program'), edge(a.reserve, a.liquidityVault, 'holds_liquidity_in'),
    edge(a.liquidityVault, a.liquidityMint, 'uses_mint'), edge(a.reserve, a.receiptMint, 'issues_receipt'),
    edge(a.reserve, C.oracle, 'uses_price')];
  for (const [account, mint, amount, exists, label] of [
    [a.walletLiquidity, a.liquidityMint, decoded.walletLiquidityBaseUnits, decoded.walletLiquidityExists, 'Wallet USDC account'],
    [a.walletReceipt, a.receiptMint, decoded.walletReceiptBaseUnits, decoded.walletReceiptExists, 'Wallet receipt account'],
  ]) {
    nodes.push(node(account, 'token_account', label, { exists, amountBaseUnits: amount }));
    if (exists) edges.push(edge(a.wallet, account, 'owns'), edge(account, mint, 'uses_mint'));
  }
  return { schemaVersion: 1, mode: 'live', slot, nodes, edges };
}

async function prepare(input, { fetchImpl, now, exchanges }) {
  check(input && Object.keys(input).length === 3 && ['wallet', 'action', 'inputBaseUnits'].every(k => Object.hasOwn(input, k)), 'Lending request fields are invalid.');
  const { wallet, action, inputBaseUnits } = input;
  const amount = lendingAmount(action, inputBaseUnits);
  const accounts = deriveAccounts(wallet);
  const rpc = createRpc(fetchImpl, now, exchanges);
  check(await rpc('getGenesisHash') === C.genesisHash, 'RPC is not Solana Devnet.');
  const response = await rpc('getMultipleAccounts', [[
    C.reserve, C.market, C.liquidityMint, C.receiptMint, C.liquidityVault,
    accounts.walletLiquidity, accounts.walletReceipt, wallet, C.program, C.oracle, C.clockSysvar,
  ], { encoding: 'base64', commitment: 'confirmed' }]);
  const capturedAt = stamp(now);
  const decoded = decodeSnapshot(response, accounts, capturedAt, action, amount);
  const slot = response.context.slot;
  const latest = await rpc('getLatestBlockhash', [{ commitment: 'confirmed', minContextSlot: slot }]);
  check(slotNumber(latest?.context?.slot) && latest.context.slot >= slot && latest.value, 'Blockhash context is invalid.');
  const { blockhash, lastValidBlockHeight } = latest.value;
  const prepared = {
    schemaVersion: 1, network: 'devnet', genesisHash: C.genesisHash, walletControl: 'unverified',
    wallet, action, inputBaseUnits, accounts, createDestinationAta: decoded.createDestinationAta,
    snapshot: { capturedAt, slot, exchanges, decoded, graph: snapshotGraph(accounts, decoded, slot) }, blockhash, lastValidBlockHeight,
  };
  const transaction = buildLendingTransaction(prepared);
  prepared.transactionBase64 = Buffer.from(transaction.serialize()).toString('base64');
  prepared.messageSha256 = sha256(transaction.message.serialize());
  const simulated = await rpc('simulateTransaction', [prepared.transactionBase64, {
    encoding: 'base64', commitment: 'confirmed', sigVerify: false, replaceRecentBlockhash: false, minContextSlot: slot,
    accounts: { encoding: 'base64', addresses: [accounts.walletLiquidity, accounts.walletReceipt, accounts.liquidityVault] },
  }]);
  check(slotNumber(simulated?.context?.slot) && simulated.context.slot >= slot && simulated.value?.err === null
    && Array.isArray(simulated.value.accounts) && simulated.value.accounts.length === 3, 'Lending simulation failed or returned incomplete accounts.');
  const [usdc, receipt, vault] = simulated.value.accounts;
  const afterLiquidity = tokenAccount(usdc, C.liquidityMint, wallet);
  const afterReceipt = tokenAccount(receipt, C.receiptMint, wallet);
  const afterVault = tokenAccount(vault, C.liquidityMint, accounts.marketAuthority);
  const beforeLiquidity = BigInt(decoded.walletLiquidityBaseUnits);
  const beforeReceipt = BigInt(decoded.walletReceiptBaseUnits);
  const beforeVault = BigInt(decoded.availableLiquidityBaseUnits);
  const liquidity = action === 'supply' ? beforeLiquidity - afterLiquidity : afterLiquidity - beforeLiquidity;
  const collateral = action === 'supply' ? afterReceipt - beforeReceipt : beforeReceipt - afterReceipt;
  check(liquidity > 0n && collateral > 0n && (action === 'supply' ? liquidity <= amount : collateral === amount)
    && (action === 'supply' ? afterVault - beforeVault : beforeVault - afterVault) === liquidity,
  'Simulated balances are inconsistent. Prepare a fresh intent.');
  prepared.simulation = { slot: simulated.context.slot, err: null, unitsConsumed: simulated.value.unitsConsumed ?? null };
  prepared.estimatedAmounts = { liquidityBaseUnits: liquidity.toString(), receiptBaseUnits: collateral.toString() };
  return prepared;
}

export async function prepareLending(input, { fetchImpl = globalThis.fetch, now = () => new Date().toISOString() } = {}) {
  const exchanges = [];
  try {
    const freeze = value => {
      if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value); }
      return value;
    };
    return freeze(await prepare(input, { fetchImpl, now, exchanges }));
  }
  catch (error) {
    if (error instanceof MeshError) { error.evidence = { exchanges }; throw error; }
    // These errors come from fixed local validation, never RPC error prose.
    const message = error instanceof Error && !/Invalid public key|Non-base58|Expected String/.test(error.message)
      ? error.message : 'Lending input or account data is invalid.';
    const failure = new MeshError('INVALID_INPUT', message);
    failure.evidence = { exchanges };
    throw failure;
  }
}

function encodeSignature(bytes) {
  const alphabet = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
  let value = BigInt(`0x${Buffer.from(bytes).toString('hex')}`);
  let out = '';
  while (value > 0n) { out = alphabet[Number(value % 58n)] + out; value /= 58n; }
  for (const byte of bytes) { if (byte !== 0) break; out = `1${out}`; }
  return out;
}

function signedLending(intent, transactionBase64) {
  const bytes = fromBase64(transactionBase64, 1232);
  const transaction = deserializeLendingTransaction(bytes);
  validateLendingTransaction(transaction, intent);
  const message = transaction.message.serialize();
  check(sha256(message) === intent.messageSha256, 'Signed message does not match the prepared intent.');
  const original = deserializeLendingTransaction(fromBase64(intent.transactionBase64, 1232));
  check(equal(message, original.message.serialize()), 'Stored intent message does not match.');
  const publicKey = createPublicKey({ key: Buffer.concat([
    Buffer.from('302a300506032b6570032100', 'hex'), new PublicKey(intent.wallet).toBuffer(),
  ]), format: 'der', type: 'spki' });
  check(verify(null, message, publicKey, transaction.signatures[0]), 'Wallet transaction signature is invalid.');
  return encodeSignature(transaction.signatures[0]);
}

export function verifySignedLending(intent, transactionBase64) {
  try { return signedLending(intent, transactionBase64); }
  catch { throw new MeshError('INVALID_INPUT', 'Signed lending transaction does not match the prepared wallet intent.'); }
}

function receiptBalance(list, transaction, account, mint, owner, allowMissing = false) {
  check(Array.isArray(list) && list.length <= transaction.message.staticAccountKeys.length, 'Transaction token balances are missing.');
  const seen = new Set();
  let found;
  for (const entry of list) {
    check(Number.isSafeInteger(entry?.accountIndex) && entry.accountIndex >= 0
      && entry.accountIndex < transaction.message.staticAccountKeys.length && !seen.has(entry.accountIndex), 'Transaction token balance index is invalid.');
    seen.add(entry.accountIndex);
    if (transaction.message.staticAccountKeys[entry.accountIndex].toBase58() === account) found = entry;
  }
  if (!found && allowMissing) return 0n;
  check(found && found.mint === mint && found.owner === owner && found.programId === C.tokenProgram
    && found.uiTokenAmount?.decimals === 6 && unsigned(found.uiTokenAmount.amount), 'Transaction token balance identity is incomplete.');
  return BigInt(found.uiTokenAmount.amount);
}

export async function readLendingReceipt(intent, signature, { fetchImpl = globalThis.fetch, now = () => new Date().toISOString() } = {}) {
  const exchanges = [];
  const result = { status: 'UNVERIFIED', signature, observedAt: stamp(now), slot: null, amounts: null, exchanges, reason: null };
  try {
    check(typeof signature === 'string' && /^[1-9A-HJ-NP-Za-km-z]{64,88}$/.test(signature), 'Transaction signature is invalid.');
    const rpc = createRpc(fetchImpl, now, exchanges);
    check(await rpc('getGenesisHash') === C.genesisHash, 'RPC is not Solana Devnet.');
    const receipt = await rpc('getTransaction', [signature, { encoding: 'base64', commitment: 'confirmed', maxSupportedTransactionVersion: 0 }]);
    if (receipt === null) {
      const height = await rpc('getBlockHeight', [{ commitment: 'confirmed' }]);
      check(Number.isSafeInteger(height) && height >= 0 && Number.isSafeInteger(intent.lastValidBlockHeight)
        && intent.lastValidBlockHeight >= 0, 'Blockhash expiry evidence is invalid.');
      if (height > intent.lastValidBlockHeight) {
        result.reason = 'The blockhash expired and no confirmed receipt is available. This does not prove that the transaction did not execute.';
      } else { result.status = 'PENDING'; result.reason = 'Transaction is not confirmed on Devnet.'; }
      return result;
    }
    check(receipt && slotNumber(receipt.slot) && receipt.version === 0 && Array.isArray(receipt.transaction)
      && receipt.transaction.length === 2 && receipt.transaction[1] === 'base64', 'Transaction receipt is incomplete.');
    check(verifySignedLending(intent, receipt.transaction[0]) === signature, 'Transaction ID does not match the signed intent.');
    result.slot = receipt.slot;
    const transaction = deserializeLendingTransaction(fromBase64(receipt.transaction[0], 1232));
    const meta = receipt.meta;
    check(meta && Object.hasOwn(meta, 'err'), 'Transaction metadata is missing.');
    if (meta.err !== null) { result.status = 'FAILED'; result.reason = 'The signed lending transaction failed on Devnet.'; return result; }
    const a = deriveAccounts(intent.wallet);
    const destination = intent.action === 'supply' ? a.walletReceipt : a.walletLiquidity;
    const balance = (list, account, mint, owner, before) => {
      const index = transaction.message.staticAccountKeys.findIndex(key => key.toBase58() === account);
      // Only a proved, newly created destination ATA may lack a pre-token balance.
      const missing = before && intent.createDestinationAta && account === destination
        && Array.isArray(meta.preBalances) && meta.preBalances[index] === 0;
      return receiptBalance(list, transaction, account, mint, owner, missing);
    };
    const delta = (account, mint, owner) => balance(meta.postTokenBalances, account, mint, owner, false)
      - balance(meta.preTokenBalances, account, mint, owner, true);
    const walletUsdc = delta(a.walletLiquidity, C.liquidityMint, intent.wallet);
    const walletReceipt = delta(a.walletReceipt, C.receiptMint, intent.wallet);
    const vaultUsdc = delta(a.liquidityVault, C.liquidityMint, a.marketAuthority);
    const supply = intent.action === 'supply';
    const liquidity = supply ? -walletUsdc : walletUsdc;
    const collateral = supply ? walletReceipt : -walletReceipt;
    const input = lendingAmount(intent.action, intent.inputBaseUnits);
    check(liquidity > 0n && collateral > 0n && vaultUsdc === -walletUsdc
      && (supply ? liquidity <= input : collateral === input), 'Confirmed token deltas do not match the lending intent.');
    result.status = 'CONFIRMED';
    result.amounts = { liquidityBaseUnits: liquidity.toString(), receiptBaseUnits: collateral.toString() };
    result.reason = 'Confirmed Devnet transaction and token deltas verified.';
    return result;
  } catch (error) {
    result.reason = error instanceof Error ? error.message : 'Receipt verification failed.';
    return result;
  } finally { result.observedAt = stamp(now); }
}
