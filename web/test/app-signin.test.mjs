import assert from 'node:assert/strict';
import { webcrypto } from 'node:crypto';
import nodeTest from 'node:test';
import { getWallets } from '@wallet-standard/app';
import { decodeSolanaAddress, verifySignInProof } from '../app/auth.mjs';
import { readSession } from '../app/state.mjs';

const test = (name, fn) => nodeTest(name, { concurrency: false }, fn);
test.after = (...args) => nodeTest.after(...args);

const ORIGIN = 'https://falconos.example';
const CHAIN = 'solana:devnet';
const SIGN = 'solana:signMessage';
const SECOND = 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA';

function encodeBase58(bytes) {
  const alphabet = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
  let value = 0n;
  for (const byte of bytes) value = value * 256n + BigInt(byte);
  let encoded = '';
  while (value > 0n) {
    encoded = alphabet[Number(value % 58n)] + encoded;
    value /= 58n;
  }
  let zeroes = 0;
  while (zeroes < bytes.length && bytes[zeroes] === 0) zeroes += 1;
  return '1'.repeat(zeroes) + (encoded || '');
}

function makeElement(id) {
  const listeners = new Map();
  const element = {
    id,
    hidden: false,
    disabled: false,
    open: false,
    value: '',
    textContent: '',
    dataset: {},
    attributes: {},
    children: [],
    addEventListener(type, listener, options = {}) {
      const entries = listeners.get(type) || [];
      entries.push({ listener, once: options.once === true });
      listeners.set(type, entries);
    },
    removeEventListener(type, listener) {
      listeners.set(type, (listeners.get(type) || []).filter((entry) => entry.listener !== listener));
    },
    dispatchEvent(event) {
      for (const entry of [...(listeners.get(event.type) || [])]) {
        entry.listener.call(this, event);
        if (entry.once) this.removeEventListener(event.type, entry.listener);
      }
      return true;
    },
    click() { this.dispatchEvent({ type: 'click' }); },
    focus() { this.focused = true; if (globalThis.document) globalThis.document.activeElement = this; },
    appendChild(child) { this.children.push(child); return child; },
    append(...children) { this.children.push(...children); },
    replaceChildren(...children) { this.children = children; },
    scrollIntoView() {},
    setAttribute(name, value) { this.attributes[name] = String(value); },
    closest() { return null; },
  };
  if (id === 'wallet-picker') {
    element.showModal = () => { element.open = true; };
    element.close = () => { element.open = false; element.dispatchEvent({ type: 'close' }); };
  }
  return element;
}

function makeDom() {
  const ids = [
    'app-status', 'trade-result', 'login-view', 'workspace-view', 'sign-out', 'session-chip',
    'connect-wallet', 'login-action', 'wallet-address', 'wallet-connection-state', 'saved-order-count',
    'sol-balance', 'balance-source', 'token-count', 'chain-tx-count', 'portfolio-rows', 'watchlist',
    'sign-send', 'order-side', 'order-amount', 'asset-mint', 'quote-mint', 'quote-panel',
    'wallet-picker', 'wallet-picker-options', 'wallet-picker-cancel',
  ];
  const elements = new Map(ids.map((id) => [id, makeElement(id)]));
  const document = {
    getElementById(id) {
      if (!elements.has(id)) elements.set(id, makeElement(id));
      return elements.get(id);
    },
    createElement: (tagName) => makeElement(tagName),
  };
  const storage = new Map();
  const localStorage = {
    getItem: (key) => storage.has(key) ? storage.get(key) : null,
    setItem: (key, value) => storage.set(key, String(value)),
    removeItem: (key) => storage.delete(key),
    clear: () => storage.clear(),
  };
  const timers = [];
  const window = {
    location: { origin: ORIGIN },
    navigator: {},
    addEventListener() {},
    dispatchEvent() {},
    setTimeout: (callback) => { timers.push(callback); return timers.length; },
    clearTimeout() {},
    solana: null,
    phantom: null,
  };
  return { document, elements, localStorage, timers, window };
}

function deferred() {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
}

function makeLegacy(address, { reject = false, connectPromise = null } = {}) {
  const calls = { connect: 0, on: 0 };
  const publicKey = { toString: () => address };
  return {
    publicKey,
    calls,
    async connect() {
      calls.connect += 1;
      if (reject) throw new Error('Legacy wallet connection rejected.');
      if (connectPromise) return connectPromise;
      return { publicKey };
    },
    on() { calls.on += 1; },
  };
}

const dom = makeDom();
globalThis.document = dom.document;
globalThis.window = dom.window;
globalThis.localStorage = dom.localStorage;
globalThis.fetch = async (_url, options) => {
  const { method } = JSON.parse(options.body);
  const result = method === 'getBalance' ? { value: 0 } : method === 'getSignaturesForAddress' ? [] : { value: [] };
  return { ok: true, json: async () => ({ jsonrpc: '2.0', id: 1, result }) };
};

const pair = await webcrypto.subtle.generateKey({ name: 'Ed25519' }, true, ['sign', 'verify']);
const publicKey = new Uint8Array(await webcrypto.subtle.exportKey('raw', pair.publicKey));
const address = encodeBase58(publicKey);
const account = { address, publicKey, chains: [CHAIN], features: [SIGN] };
const listeners = new Set();
const walletCalls = { connect: 0 };
const wallet = {
  version: '1.0.0',
  name: 'Standard test wallet',
  icon: 'data:image/png;base64,AA==',
  chains: [CHAIN],
  accounts: [account],
  features: {
    'standard:connect': { version: '1.0.0', connect: async () => { walletCalls.connect += 1; return { accounts: wallet.accounts }; } },
    'standard:disconnect': { version: '1.0.0', disconnect: async () => {} },
    'standard:events': { version: '1.0.0', on: (event, listener) => { assert.equal(event, 'change'); listeners.add(listener); return () => listeners.delete(listener); } },
    [SIGN]: {
      version: '1.0.0',
      signMessage: async ({ message }) => [{
        signedMessage: message,
        signature: new Uint8Array(await webcrypto.subtle.sign('Ed25519', pair.privateKey, message)),
      }],
    },
  },
};
const secondCalls = { connect: 0 };
const walletSecond = {
  ...wallet,
  name: 'Hardware test wallet',
  features: {
    ...wallet.features,
    'standard:connect': { version: '1.0.0', connect: async () => { secondCalls.connect += 1; return { accounts: wallet.accounts }; } },
  },
};
const unsupportedCalls = { connect: 0 };
const { [SIGN]: omittedSign, ...unsupportedFeatures } = wallet.features;
unsupportedFeatures['standard:connect'] = { version: '1.0.0', connect: async () => { unsupportedCalls.connect += 1; return { accounts: wallet.accounts }; } };
const walletUnsupported = { ...wallet, name: 'No message wallet', features: unsupportedFeatures };
const unregister = getWallets().register(wallet);
assert.equal(getWallets().get().length, 1);
const app = await import('../app/app.mjs');

test('sign-in succeeds for Wallet Standard account A despite mismatched legacy wallet B', async () => {
  dom.localStorage.clear();
  const legacyB = makeLegacy(SECOND);
  dom.window.solana = legacyB;
  dom.window.phantom = null;

  await app.signIn();

  const proof = readSession();
  assert.equal(proof.address, address);
  assert.equal(await verifySignInProof(proof, ORIGIN, Date.now(), webcrypto), true);
  assert.equal(legacyB.calls.connect, 1);
  assert.equal(legacyB.calls.on, 0);
  assert.equal(dom.elements.get('app-status').dataset.kind, 'success');
});

test('sign-in binds the matching legacy provider after the Wallet Standard proof', async () => {
  dom.localStorage.clear();
  const legacyA = makeLegacy(address);
  dom.window.solana = legacyA;
  dom.window.phantom = null;

  await app.signIn();

  const proof = readSession();
  assert.equal(proof.address, address);
  assert.equal(await verifySignInProof(proof, ORIGIN, Date.now(), webcrypto), true);
  assert.equal(legacyA.calls.connect, 1);
  assert.equal(legacyA.calls.on, 2);
});
test('a Wallet-Standard-only sign-in stays honest about trade readiness and never claims a live wallet connection', async () => {
  dom.localStorage.clear();
  dom.window.solana = null;
  dom.window.phantom = null;

  // Deterministic, distinguishable Devnet reads: proves the balance/history render pulled real
  // data through refreshAccount(), not leftover state from an earlier test's zeroed mock.
  const readLamports = 1234567890;
  const readSignature = 'WSReadRegressionSignature1111111111111111111111111111111111111111111111';
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (_url, options) => {
    const { method } = JSON.parse(options.body);
    const result = method === 'getBalance' ? { value: readLamports }
      : method === 'getSignaturesForAddress'
        ? [{ signature: readSignature, slot: 999999, blockTime: 1700000000, confirmationStatus: 'confirmed', err: null }]
        : { value: [] };
    return { ok: true, json: async () => ({ jsonrpc: '2.0', id: 1, result }) };
  };
  try {
    await app.signIn();
  } finally {
    globalThis.fetch = originalFetch;
  }

  const proof = readSession();
  assert.equal(proof.address, address);
  assert.equal(await verifySignInProof(proof, ORIGIN, Date.now(), webcrypto), true);

  // Trade-ready signal must be honest: no legacy provider was ever bound for this wallet.
  assert.notEqual(dom.elements.get('wallet-connection-state').textContent, 'Proof verified · wallet connected');
  assert.match(dom.elements.get('wallet-connection-state').textContent, /wallet extension/);
  assert.notEqual(dom.elements.get('connect-wallet').textContent, 'Refresh account');

  // Reads need only the proof address: a signed-in Wallet-Standard-only wallet must still load
  // real Devnet balance and transaction history, never a "reconnect" dead end for reads.
  assert.equal(dom.elements.get('sol-balance').textContent, '1.234567 SOL');
  assert.equal(dom.elements.get('balance-source').textContent, 'Devnet RPC · confirmed');
  assert.equal(dom.elements.get('portfolio-rows').children[0].children[0].textContent, 'No SPL Token or Token-2022 balances found on Devnet.');
  assert.equal(dom.elements.get('chain-tx-count').textContent, '1');
  assert.equal(dom.elements.get('activity-rows').children.length, 1);
  assert.match(dom.elements.get('activity-rows').children[0].children[3].children[0].href, new RegExp(readSignature));

  // Get Quote must fail up front with the specific capability reason, not a late sign-send throw,
  // and not the generic "reconnect" wording (which falsely implies retrying would help).
  dom.elements.get('get-quote').click();
  await new Promise((resolve) => setImmediate(resolve));
  assert.match(dom.elements.get('trade-result').textContent, /wallet extension/);
  assert.doesNotMatch(dom.elements.get('trade-result').textContent, /^Reconnect the signed-in wallet/);
  assert.equal(dom.elements.get('sign-send').disabled, true);

  // The reconnect control must name the real capability gap, never the factually wrong "install a wallet" message.
  dom.elements.get('connect-wallet').click();
  await new Promise((resolve) => setImmediate(resolve));
  assert.doesNotMatch(dom.elements.get('app-status').textContent, /No compatible Solana wallet was found/);
  assert.match(dom.elements.get('app-status').textContent, /wallet extension/);
});

test('a Wallet-Standard-only sign-in preserves the read-failure status instead of masking it with success', async () => {
  dom.localStorage.clear();
  dom.window.solana = null;
  dom.window.phantom = null;

  // All three Devnet reads must fail deterministically.
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => { throw new Error('Devnet RPC unavailable in this test.'); };
  try {
    await app.signIn();
  } finally {
    globalThis.fetch = originalFetch;
  }

  const proof = readSession();
  assert.equal(proof.address, address);

  // A read failure must not be clobbered by the trade-capability status set afterward.
  assert.equal(dom.elements.get('app-status').dataset.kind, 'error');
  assert.match(dom.elements.get('app-status').textContent, /could not load/);
  assert.doesNotMatch(dom.elements.get('app-status').textContent, /account data loaded/);
});

test('a legacy-bound sign-in still clears the wallet-capability gate and reaches the trade flow', async () => {
  dom.localStorage.clear();
  const legacyA = makeLegacy(address);
  dom.window.solana = legacyA;
  dom.window.phantom = null;

  await app.signIn();

  assert.equal(dom.elements.get('wallet-connection-state').textContent, 'Proof verified · wallet connected');
  assert.equal(dom.elements.get('connect-wallet').textContent, 'Refresh account');

  dom.elements.get('get-quote').click();
  await new Promise((resolve) => setImmediate(resolve));
  // Cleared the wallet-capability gate; failed on empty mint input instead, proving trade wiring still works.
  assert.equal(dom.elements.get('trade-result').textContent, 'wallet address is invalid');
});
test('sign-out wins a pending post-proof legacy connect', async () => {
  dom.localStorage.clear();
  const pending = deferred();
  const legacyA = makeLegacy(address, { connectPromise: pending.promise });
  dom.window.solana = legacyA;
  dom.window.phantom = null;

  const signing = app.signIn();
  // Wait on a wall-clock deadline, not a tick count: slower CI runners need more ticks before connect() runs.
  for (const deadline = Date.now() + 2000; legacyA.calls.connect === 0 && Date.now() < deadline;) await new Promise((resolve) => setTimeout(resolve, 5));
  assert.equal(legacyA.calls.connect, 1);

  app.signOut();
  pending.resolve({ publicKey: legacyA.publicKey });
  await signing;

  assert.equal(readSession(), null);
  assert.equal(legacyA.calls.on, 0);
  assert.match(dom.elements.get('app-status').textContent, /Signed out/);
});
test('many usable wallets open the picker and show unavailable reasons', async () => {
  const unregisterSecond = getWallets().register(walletSecond);
  const unregisterUnsupported = getWallets().register(walletUnsupported);
  dom.localStorage.clear();
  dom.window.solana = null;
  dom.window.phantom = null;

  const signing = app.signIn();
  await new Promise((resolve) => setImmediate(resolve));
  const picker = dom.elements.get('wallet-picker');
  const options = dom.elements.get('wallet-picker-options');
  assert.equal(picker.open, true);
  assert.equal(options.children.length, 3);
  assert.equal(dom.document.activeElement, options.children[0]);
  const unavailable = options.children.find((option) => option.disabled);
  assert.ok(unavailable);
  assert.equal(unavailable.attributes['aria-disabled'], 'true');
  assert.match(unavailable.children[2].textContent, /solana:signMessage/);
  options.children[1].click();
  await signing;

  const proof = readSession();
  assert.equal(proof.address, address);
  assert.equal(await verifySignInProof(proof, ORIGIN, Date.now(), webcrypto), true);
  assert.equal(secondCalls.connect, 1);
  unregisterSecond();
  unregisterUnsupported();
});

test('cancelling the wallet picker stops sign-in with a neutral status', async () => {
  const unregisterSecond = getWallets().register(walletSecond);
  dom.localStorage.clear();
  dom.window.solana = null;
  dom.window.phantom = null;

  const signing = app.signIn();
  await new Promise((resolve) => setImmediate(resolve));
  dom.elements.get('wallet-picker-cancel').click();
  assert.equal(dom.elements.get('wallet-picker').open, false);
  await signing;

  assert.equal(readSession(), null);
  assert.equal(dom.elements.get('app-status').textContent, 'Sign-in cancelled.');
  unregisterSecond();
});

test('a discovered wallet without message signing shows its capability reason', async () => {
  unregister();
  const unregisterUnsupported = getWallets().register(walletUnsupported);
  dom.localStorage.clear();
  dom.window.solana = null;
  dom.window.phantom = null;
  const before = unsupportedCalls.connect;

  await app.signIn();

  assert.equal(unsupportedCalls.connect, before);
  assert.equal(readSession(), null);
  assert.match(dom.elements.get('app-status').textContent, /solana:signMessage/);
  unregisterUnsupported();
});

test('zero usable wallets shows mobile and desktop guidance without connecting', async () => {
  unregister();
  dom.localStorage.clear();
  dom.window.solana = null;
  dom.window.phantom = null;
  const before = walletCalls.connect + secondCalls.connect;

  await app.signIn();

  assert.equal(walletCalls.connect + secondCalls.connect, before);
  assert.equal(readSession(), null);
  assert.match(dom.elements.get('app-status').textContent, /On mobile, open this page inside your wallet's in-app browser \(Phantom or Solflare\); on desktop, install a wallet extension/);
});

test.after(() => unregister());
