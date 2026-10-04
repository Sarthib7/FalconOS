import { decodeSolanaAddress } from '../app/auth.mjs';

const ACCOUNT_CHANGED = 'The Phantom account changed during sign-in. Connect again.';
const SIGNING_UNAVAILABLE = 'Phantom does not support message signing in this browser.';
const CONNECT_UNAVAILABLE = 'Phantom does not support connecting in this browser.';
const EVENTS_UNAVAILABLE = 'Phantom does not support account-change events in this browser.';

function addressFrom(publicKey) {
  if (!publicKey || typeof publicKey.toBytes !== 'function' || typeof publicKey.toString !== 'function') return null;
  try {
    const address = publicKey.toString();
    const decoded = decodeSolanaAddress(address);
    const bytes = publicKey.toBytes();
    if (!(bytes instanceof Uint8Array) || bytes.length !== decoded.length
      || !bytes.every((byte, index) => byte === decoded[index])) return null;
    return address;
  } catch { return null; }
}

export function detectPhantomProvider(scope = globalThis.window) {
  const provider = scope?.phantom?.solana?.isPhantom === true
    ? scope.phantom.solana
    : scope?.solana?.isPhantom === true ? scope.solana : null;
  if (!provider) return null;
  const reason = typeof provider.connect !== 'function' ? CONNECT_UNAVAILABLE
    : typeof provider.signMessage !== 'function' ? SIGNING_UNAVAILABLE
      : typeof provider.on !== 'function' || typeof provider.off !== 'function' ? EVENTS_UNAVAILABLE : null;
  return { provider, available: !reason, reason };
}
export function phantomLoginOption(wallets = [], injected = null) {
  const phantom = wallets.find(wallet => wallet.name === 'Phantom') ?? null;
  if (phantom?.available) return { kind: 'wallet-standard', wallet: phantom };
  if (injected?.available) return { kind: 'injected' };
  const reason = injected?.reason ?? phantom?.reason ?? null;
  return reason ? { kind: 'unavailable', reason } : { kind: 'install' };
}

export function createInjectedPhantomSession(provider) {
  if (!provider || provider.isPhantom !== true || typeof provider.connect !== 'function'
    || typeof provider.signMessage !== 'function') throw new Error('A Phantom message-signing provider is required.');
  let connectedAddress = null;

  function current() {
    const address = addressFrom(provider.publicKey);
    return connectedAddress && address === connectedAddress ? { address } : null;
  }

  return {
    async connect() {
      const response = await provider.connect();
      const address = addressFrom(response?.publicKey ?? provider.publicKey);
      if (!address || addressFrom(provider.publicKey) !== address) throw new Error('Phantom did not return a valid Solana account.');
      connectedAddress = address;
      return { address };
    },
    current,
    async signMessage(message) {
      if (!(message instanceof Uint8Array) || !message.length) throw new Error('A non-empty sign-in message is required.');
      const account = current();
      if (!account) throw new Error(ACCOUNT_CHANGED);
      const result = await provider.signMessage(message.slice(), 'utf8');
      if (current()?.address !== account.address) throw new Error(ACCOUNT_CHANGED);
      if (!(result?.signature instanceof Uint8Array) || !result.signature.length) throw new Error('Phantom returned an invalid message signature.');
      return result.signature.slice();
    },
  };
}
