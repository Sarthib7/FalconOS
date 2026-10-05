const CONNECT = 'standard:connect';
const DISCONNECT = 'standard:disconnect';
const EVENTS = 'standard:events';
const BASE58 = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
const SOLANA_ADDRESS = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

function isSolanaPublicKey(address) {
  if (!SOLANA_ADDRESS.test(address)) return false;
  let value = 0n;
  for (const character of address) value = value * 58n + BigInt(BASE58.indexOf(character));
  let decodedBytes = 0;
  while (value > 0n) { value >>= 8n; decodedBytes += 1; }
  let leadingZeroBytes = 0;
  while (address[leadingZeroBytes] === '1') leadingZeroBytes += 1;
  return decodedBytes + leadingZeroBytes === 32;
}
function solanaAccount(accounts) {
  if (!Array.isArray(accounts)) return null;
  return accounts.find(account => typeof account?.address === 'string'
    && isSolanaPublicKey(account.address)
    && Array.isArray(account.chains)
    && account.chains.some(chain => typeof chain === 'string' && chain.startsWith('solana:'))) ?? null;
}

export function findPhantomWallet(wallets) {
  if (!Array.isArray(wallets)) return null;
  return wallets.find(wallet => wallet?.name === 'Phantom'
    && typeof wallet.features?.[CONNECT]?.connect === 'function') ?? null;
}

export function getPhantomAccountAddress(wallet) {
  return solanaAccount(wallet?.accounts)?.address ?? null;
}

export async function connectPhantomWallet(wallet) {
  const connect = wallet?.features?.[CONNECT]?.connect;
  if (typeof connect !== 'function') throw new Error('PHANTOM_CONNECT_UNAVAILABLE');
  const result = await connect();
  const account = solanaAccount(result?.accounts ?? wallet.accounts);
  if (!account) throw new Error('PHANTOM_ACCOUNT_UNAVAILABLE');
  return { account, address: account.address };
}

export async function disconnectPhantomWallet(wallet) {
  const disconnect = wallet?.features?.[DISCONNECT]?.disconnect;
  if (typeof disconnect !== 'function') return false;
  await disconnect();
  return true;
}

export function subscribePhantomAccountChanges(wallet, listener) {
  const on = wallet?.features?.[EVENTS]?.on;
  if (typeof on !== 'function') return () => {};
  const unsubscribe = on('change', change => {
    if (change && Object.hasOwn(change, 'accounts')) listener(solanaAccount(change.accounts));
  });
  return typeof unsubscribe === 'function' ? unsubscribe : () => {};
}
