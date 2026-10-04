import { getWallets } from '@wallet-standard/app';
import { decodeSolanaAddress } from './auth.mjs';

const CHAIN = 'solana:devnet';
const SIGN = 'solana:signMessage';
const CHANGED = 'The wallet account or signing capability changed. Connect again before signing.';
const REQUIRED = [
  ['standard:connect', 'connect'],
  ['standard:events', 'on'],
  [SIGN, 'signMessage'],
];

function equalBytes(left, right) {
  return left instanceof Uint8Array && right instanceof Uint8Array
    && left.length === right.length && left.every((byte, index) => byte === right[index]);
}

function accountReason(account, requiredChain = CHAIN) {
  const supportsChain = Array.isArray(account?.chains) && (requiredChain === null
    ? account.chains.some(chain => typeof chain === 'string' && chain.startsWith('solana:'))
    : account.chains.includes(requiredChain));
  if (!account || !supportsChain) return requiredChain ? 'The account does not support ' + requiredChain + '.' : 'The account does not support a Solana chain.';
  if (!Array.isArray(account.features) || !account.features.includes(SIGN)) {
    return 'The account must support solana:signMessage. A signAndSend-only account cannot support sign-in.';
  }
  try {
    if (!equalBytes(decodeSolanaAddress(account.address), account.publicKey)) return 'The wallet account address and public key do not match.';
  } catch { return 'The wallet account address is invalid.'; }
  return null;
}

function walletReason(wallet, requiredChain = CHAIN) {
  if (!wallet || wallet.version !== '1.0.0') return 'This Wallet Standard version is unsupported.';
  const supportsChain = Array.isArray(wallet.chains) && (requiredChain === null
    ? wallet.chains.some(chain => typeof chain === 'string' && chain.startsWith('solana:'))
    : wallet.chains.includes(requiredChain));
  if (!supportsChain) return requiredChain ? 'This wallet does not support ' + requiredChain + '.' : 'This wallet does not support a Solana chain.';
  if (requiredChain !== null) {
    const disconnect = wallet.features?.['standard:disconnect'];
    if (!disconnect || typeof disconnect.disconnect !== 'function') return 'This wallet does not support standard:disconnect.';
    if (disconnect.version !== '1.0.0') return 'This wallet uses an unsupported standard:disconnect version.';
  }
  for (const [name, method] of REQUIRED) {
    const feature = wallet.features?.[name];
    if (!feature || typeof feature[method] !== 'function') {
      return name === SIGN
        ? 'This wallet must support solana:signMessage. A signAndSend-only wallet cannot support sign-in.'
        : `This wallet does not support ${name}.`;
    }
    if (feature.version !== '1.0.0') return `This wallet uses an unsupported ${name} version.`;
  }
  if (!Array.isArray(wallet.accounts)) return 'The wallet returned an invalid account list.';
  return null;
}

function safeIcon(value) {
  return typeof value === 'string' && value.length <= 256 * 1024
    && /^data:image\/(?:svg\+xml|webp|png|gif);base64,[A-Za-z0-9+/]*={0,2}$/.test(value) ? value : null;
}

export function createSignInWalletSession({ registry = getWallets(), requiredChain = CHAIN } = {}) {
  if (typeof registry?.get !== 'function' || typeof registry?.on !== 'function') throw new Error('A Wallet Standard registry is required.');
  if (requiredChain !== null && typeof requiredChain !== 'string') throw new TypeError('requiredChain must be a Solana chain or null.');
  if (requiredChain !== null && !requiredChain.startsWith('solana:')) throw new TypeError('requiredChain must be a Solana chain or null.');
  const entries = new Map();
  const ids = new WeakMap();
  const subscribers = new Set();
  let nextId = 0;
  let generation = 0;
  let selected = null;
  let connecting = null;
  let signing = false;
  let reason = null;

  function wallets() {
    const values = registry.get();
    if (!Array.isArray(values)) throw new Error('The Wallet Standard registry returned an invalid wallet list.');
    return values.filter((wallet) => wallet && typeof wallet === 'object');
  }
  function currentValue() {
    return selected ? { walletId: selected.id, walletName: selected.wallet.name, address: selected.address } : null;
  }
  function list() {
    return [...entries].map(([wallet, entry]) => {
      const unsupported = entry.error ?? walletReason(wallet, requiredChain)
        ?? (wallet.accounts.length && !wallet.accounts.some((account) => !accountReason(account, requiredChain)) ? accountReason(wallet.accounts[0], requiredChain) : null);
      return { id: entry.id, name: typeof wallet.name === 'string' ? wallet.name : 'Unnamed wallet', icon: safeIcon(wallet.icon), available: !unsupported, reason: unsupported };
    });
  }
  function emit() {
    for (const subscriber of subscribers) {
      // A consumer render error must not change the signing state.
      try { subscriber({ wallets: list(), current: currentValue(), reason }); } catch {}
    }
  }
  function clear(message = null) {
    generation += 1;
    selected = null;
    reason = message;
  }
  function selectedAccount() {
    if (!selected || !wallets().includes(selected.wallet) || walletReason(selected.wallet, requiredChain)) return null;
    const feature = selected.wallet.features[SIGN];
    if (feature.signMessage !== selected.signMethod) return null;
    return selected.wallet.accounts.find((account) => !accountReason(account, requiredChain)
      && account.address === selected.address && equalBytes(account.publicKey, selected.publicKey)) ?? null;
  }
  function current() {
    if (selected && !selectedAccount()) { clear(CHANGED); emit(); }
    return currentValue();
  }
  function syncRegistry() {
    const installed = wallets();
    for (const [wallet, entry] of entries) {
      if (installed.includes(wallet)) continue;
      entry.off?.();
      entries.delete(wallet);
      if (selected?.wallet === wallet || connecting?.wallet === wallet) { clear('The selected wallet is no longer available. Connect an installed wallet.'); connecting = null; }
    }
    for (const wallet of installed) {
      if (entries.has(wallet)) continue;
      if (!ids.has(wallet)) ids.set(wallet, `wallet-${++nextId}`);
      const entry = { id: ids.get(wallet), off: null, error: null };
      entries.set(wallet, entry);
      const events = wallet.features?.['standard:events'];
      if (events?.version === '1.0.0' && typeof events.on === 'function') {
        try {
          const off = events.on('change', (properties) => {
            if (selected?.wallet === wallet && properties
              && ['accounts', 'chains', 'features'].some((key) => Object.hasOwn(properties, key))
              && !selectedAccount()) clear(CHANGED);
            emit();
          });
          if (typeof off !== 'function') throw new Error('Missing event cleanup');
          entry.off = off;
        } catch { entry.error = 'This wallet could not provide account change events.'; }
      }
    }
  }

  registry.on('register', () => { syncRegistry(); emit(); });
  registry.on('unregister', () => { syncRegistry(); emit(); });
  syncRegistry();

  async function connect(id) {
    syncRegistry();
    const pair = [...entries].find(([, entry]) => entry.id === id);
    if (!pair) throw new Error('The selected wallet is no longer installed.');
    const [wallet, entry] = pair;
    const unsupported = entry.error ?? walletReason(wallet, requiredChain);
    if (unsupported) throw new Error(unsupported);
    clear();
    const requestGeneration = generation;
    connecting = { wallet, generation: requestGeneration };
    emit();
    try {
      const response = await wallet.features['standard:connect'].connect();
      if (requestGeneration !== generation || !wallets().includes(wallet)) throw new Error('The wallet changed while connecting. Connect again.');
      const changedCapability = walletReason(wallet, requiredChain);
      if (changedCapability) throw new Error(changedCapability);
      if (!Array.isArray(response?.accounts) || !response.accounts.length) throw new Error('The wallet did not authorize an account.');
      const account = response.accounts.find((value) => !accountReason(value, requiredChain)
        && wallet.accounts.some((current) => !accountReason(current, requiredChain) && current.address === value.address && equalBytes(current.publicKey, value.publicKey)));
      if (!account) throw new Error(response.accounts.every((value) => accountReason(value, requiredChain)) ? accountReason(response.accounts[0], requiredChain) : 'The authorized wallet account changed while connecting.');
      selected = { wallet, id: entry.id, address: account.address, publicKey: Uint8Array.from(account.publicKey), signMethod: wallet.features[SIGN].signMessage };
      reason = null;
      emit();
      return currentValue();
    } finally {
      if (connecting?.generation === requestGeneration) connecting = null;
    }
  }

  async function disconnect() {
    const wallet = selected?.wallet ?? connecting?.wallet;
    connecting = null;
    clear();
    emit();
    const disconnect = wallet?.features?.['standard:disconnect']?.disconnect;
    if (typeof disconnect === 'function') await disconnect();
  }

  async function signMessage(message) {
    if (!(message instanceof Uint8Array) || !message.length) throw new Error('A non-empty sign-in message is required.');
    if (signing) throw new Error('A wallet signing request is already active.');
    const account = selectedAccount();
    if (!account) {
      if (selected) { clear(CHANGED); emit(); }
      throw new Error(reason ?? (requiredChain ? 'Connect a ' + requiredChain + ' account before signing.' : 'Connect a Solana account before signing.'));
    }
    const active = selected;
    const requestGeneration = generation;
    signing = true;
    try {
      const outputs = await active.wallet.features[SIGN].signMessage({ account, message: message.slice() });
      if (generation !== requestGeneration || selected !== active || !selectedAccount()) {
        if (selected === active) { clear(CHANGED); emit(); }
        throw new Error(CHANGED);
      }
      if (!Array.isArray(outputs) || outputs.length !== 1
        || !(outputs[0]?.signedMessage instanceof Uint8Array)
        || !equalBytes(outputs[0].signedMessage, message)
        || !(outputs[0]?.signature instanceof Uint8Array)
        || !outputs[0].signature.length) {
        throw new Error('The wallet returned an invalid signed message.');
      }
      return outputs[0].signature.slice();
    } finally { signing = false; }
  }

  function subscribe(listener) {
    if (typeof listener !== 'function') throw new Error('A wallet session listener is required.');
    subscribers.add(listener);
    listener({ wallets: list(), current: current(), reason });
    return () => subscribers.delete(listener);
  }

  return { list, connect, disconnect, current, signMessage, subscribe };
}
