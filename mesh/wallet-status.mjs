import { PublicKey } from '@solana/web3.js';
import { MeshError } from './domain.mjs';
import { LENDING_CONFIG as C, deriveAccounts } from './kamino-wire.mjs';

const RPC_BODY_LIMIT = 64 * 1024;
const RPC_TIMEOUT_MS = 8000;
const TOKEN_ACCOUNT_SIZE = 165;
const TOKEN_MINT_SIZE = 82;
const FAUCETS = Object.freeze({
  sol: 'https://faucet.solana.com/',
  usdc: 'https://faucet.circle.com/',
});

const invalid = () => new MeshError('INVALID_INPUT', 'Wallet status request does not match the Devnet contract.');
const unavailable = () => new MeshError('STORAGE_UNAVAILABLE', 'Verified Devnet account data is unavailable or invalid.');
const check = condition => { if (!condition) throw unavailable(); };

function validateInput(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw invalid();
  const allowed = new Set(['wallet', 'forAction', 'chain', 'network']);
  if (Object.keys(input).some(key => !allowed.has(key)) || !Object.hasOwn(input, 'wallet')) throw invalid();
  const action = Object.hasOwn(input, 'forAction') ? input.forAction : 'supply';
  const chain = Object.hasOwn(input, 'chain') ? input.chain : 'solana';
  const network = Object.hasOwn(input, 'network') ? input.network : 'devnet';
  if (typeof input.wallet !== 'string' || chain !== 'solana' || network !== 'devnet'
      || !['supply', 'redeem'].includes(action)) throw invalid();
  let wallet;
  try {
    const publicKey = new PublicKey(input.wallet);
    if (publicKey.toBase58() !== input.wallet || !PublicKey.isOnCurve(publicKey.toBytes())) throw invalid();
    wallet = publicKey.toBase58();
    deriveAccounts(wallet);
  } catch { throw invalid(); }
  return { wallet, action, chain, network };
}

function captureTime(now) {
  try {
    const capturedAt = now();
    if (typeof capturedAt !== 'string' || new Date(capturedAt).toISOString() !== capturedAt) throw new Error();
    return capturedAt;
  } catch { throw unavailable(); }
}

function decodeBase64(value) {
  check(typeof value === 'string' && value.length <= Math.ceil(RPC_BODY_LIMIT / 3) * 4);
  const bytes = Buffer.from(value, 'base64');
  check(bytes.length <= RPC_BODY_LIMIT && bytes.toString('base64') === value);
  return bytes;
}

function accountBytes(account, length) {
  check(account && account.owner === C.tokenProgram && account.executable === false
    && Array.isArray(account.data) && account.data.length === 2 && account.data[1] === 'base64');
  const bytes = decodeBase64(account.data[0]);
  check(bytes.length === length && (!Object.hasOwn(account, 'space') || account.space === length));
  return bytes;
}

function mintDecimals(account) {
  const bytes = accountBytes(account, TOKEN_MINT_SIZE);
  check(bytes[45] === 1 && bytes[44] === C.decimals);
  return bytes[44];
}

function tokenState(account, mint, wallet, decimals) {
  if (account === null) return { exists: false, balanceBaseUnits: '0', decimals, frozen: false };
  const bytes = accountBytes(account, TOKEN_ACCOUNT_SIZE);
  check(new PublicKey(bytes.subarray(0, 32)).toBase58() === mint
    && new PublicKey(bytes.subarray(32, 64)).toBase58() === wallet
    && (bytes[108] === 1 || bytes[108] === 2));
  return {
    exists: true,
    balanceBaseUnits: bytes.readBigUInt64LE(64).toString(),
    decimals,
    frozen: bytes[108] === 2,
  };
}

function nativeBalance(account) {
  if (account === null) return '0';
  check(account.owner === C.systemProgram && account.executable === false && Number.isSafeInteger(account.lamports) && account.lamports >= 0);
  return BigInt(account.lamports).toString();
}

async function rpc(fetchImpl, method, params) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), RPC_TIMEOUT_MS);
  try {
    const response = await fetchImpl(C.rpcUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
      redirect: 'error',
      signal: controller.signal,
    });
    check(response && response.ok && !response.redirected
      && response.headers?.get('content-type')?.toLowerCase().startsWith('application/json')
      && response.body?.getReader);
    const reader = response.body.getReader();
    const chunks = [];
    let size = 0;
    for (;;) {
      const { done, value } = await reader.read();
      check(!controller.signal.aborted);
      if (done) break;
      size += value.byteLength;
      if (size > RPC_BODY_LIMIT) {
        await reader.cancel();
        throw unavailable();
      }
      chunks.push(Buffer.from(value));
    }
    check(!controller.signal.aborted);
    let envelope;
    try { envelope = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks))); }
    catch { throw unavailable(); }
    check(envelope && envelope.jsonrpc === '2.0' && envelope.id === 1
      && !Object.hasOwn(envelope, 'error') && Object.hasOwn(envelope, 'result'));
    return envelope.result;
  } catch { throw unavailable(); }
  finally { clearTimeout(timer); }
}

export async function readWalletStatus(input, { fetchImpl = globalThis.fetch, now = () => new Date().toISOString() } = {}) {
  const { wallet, action, chain, network } = validateInput(input);
  const accounts = deriveAccounts(wallet);
  const capturedAt = captureTime(now);
  const genesis = await rpc(fetchImpl, 'getGenesisHash', []);
  check(genesis === C.genesisHash);
  const snapshot = await rpc(fetchImpl, 'getMultipleAccounts', [
    [wallet, accounts.walletLiquidity, accounts.walletReceipt, C.liquidityMint, C.receiptMint],
    { commitment: 'confirmed', encoding: 'base64' },
  ]);
  const slot = snapshot?.context?.slot;
  const values = snapshot?.value;
  check(Number.isSafeInteger(slot) && slot > 0 && Array.isArray(values) && values.length === 5);
  const [walletAccount, usdcAccount, receiptAccount, usdcMintAccount, receiptMintAccount] = values;
  const solBalanceLamports = nativeBalance(walletAccount);
  const usdcDecimals = mintDecimals(usdcMintAccount);
  const receiptDecimals = mintDecimals(receiptMintAccount);
  const usdcToken = tokenState(usdcAccount, C.liquidityMint, wallet, usdcDecimals);
  const receiptToken = tokenState(receiptAccount, C.receiptMint, wallet, receiptDecimals);
  const missing = [];
  const source = action === 'supply' ? usdcToken : receiptToken;
  const sourceName = action === 'supply' ? 'USDC' : 'RECEIPT';
  const destination = action === 'supply' ? receiptToken : usdcToken;
  const destinationName = action === 'supply' ? 'RECEIPT' : 'USDC';
  if (solBalanceLamports === '0') missing.push('SOL_FOR_FEES');
  if (!source.exists) missing.push(`${sourceName}_ASSOCIATED_TOKEN_ACCOUNT`);
  else if (source.frozen) missing.push(`${sourceName}_TOKEN_ACCOUNT_FROZEN`);
  else if (source.balanceBaseUnits === '0') missing.push(`${sourceName}_BALANCE_ZERO`);
  if (destination.exists && destination.frozen) missing.push(`${destinationName}_TOKEN_ACCOUNT_FROZEN`);

  return {
    walletAddress: wallet,
    chain,
    network,
    capturedAt,
    slot,
    sol: { balanceLamports: solBalanceLamports },
    usdc: {
      mint: C.liquidityMint,
      tokenAccount: accounts.walletLiquidity,
      exists: usdcToken.exists,
      balanceBaseUnits: usdcToken.balanceBaseUnits,
      decimals: usdcToken.decimals,
    },
    receipt: {
      mint: C.receiptMint,
      tokenAccount: accounts.walletReceipt,
      exists: receiptToken.exists,
      balanceBaseUnits: receiptToken.balanceBaseUnits,
      decimals: receiptToken.decimals,
    },
    missing,
    faucet: {
      humanOnly: true,
      links: { solFaucet: FAUCETS.sol, usdcFaucet: FAUCETS.usdc },
      checklist: [
        'A human may request test SOL for this wallet from the Solana Devnet faucet; do not enter a seed phrase or private key.',
        `A human may request test USDC from Circle for Solana Devnet and must verify mint ${C.liquidityMint}.`,
        'Recheck this read-only status after any human-initiated faucet request; faucets and balances do not authorize a transaction.',
        `If the source token account is absent, a human must create or fund its canonical associated token account for mint ${action === 'supply' ? C.liquidityMint : C.receiptMint}.`,
        'A missing destination associated token account may be created by the prepared lending transaction. Review that instruction and its SOL rent cost before approving a signature.',
      ],
    },
    executionReady: false,
  };
}
