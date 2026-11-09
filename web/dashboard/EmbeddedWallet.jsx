import React, { useRef, useState } from 'react';
import { usePrivy, useSigners } from '@privy-io/react-auth';
import {
  useCreateWallet,
  useSignMessage,
  useSignTransaction,
  useWallets,
} from '@privy-io/react-auth/solana';

const EMPTY_WALLET = Object.freeze({
  configured: false,
  ready: false,
  authenticated: false,
  userId: null,
  walletAddress: null,
  walletAccount: null,
  wallet: null,
  walletSession: null,
  getAccessToken: null,
  signMessage: null,
  signTransaction: null,
  addSigners: null,
  removeAllDelegatedSigners: null,
});
const PRIVY_WALLET_CLIENTS = new Set(['privy', 'privy-v2']);
const errorText = error => typeof error?.message === 'string' && error.message
  ? error.message
  : 'Privy could not complete this wallet action.';

function isFalconWallet(account) {
  return account?.type === 'wallet'
    && account.chainType === 'solana'
    && account.imported === false
    && PRIVY_WALLET_CLIENTS.has(account.walletClientType);
}

function assertWalletIdentity(current, expected) {
  if (!current.authenticated || current.userId !== expected.userId
    || current.walletAddress !== expected.walletAddress
    || current.wallet?.address !== expected.walletAddress) {
    throw new Error('The Privy user or selected Solana wallet changed. Select the wallet again before continuing.');
  }
}

export default function EmbeddedWallet({ enabled, session, onSignIn, children }) {
  if (!enabled) {
    return <section className="embedded-wallet owner-card" aria-labelledby="embedded-wallet-title">
      <div className="owner-card-heading">
        <p className="owner-eyebrow">Solana · customer-controlled wallet</p>
        <h2 id="embedded-wallet-title">Dedicated Falcon wallet</h2>
        <p>Embedded-wallet login is unavailable until the public <code>VITE_PRIVY_APP_ID</code> build setting is provided. Existing Wallet Standard sign-in remains available.</p>
      </div>
      {typeof children === 'function' && children(EMPTY_WALLET)}
    </section>;
  }
  return <PrivyEmbeddedWallet session={session} onSignIn={onSignIn}>{children}</PrivyEmbeddedWallet>;
}

function PrivyEmbeddedWallet({ session, onSignIn, children }) {
  const { ready: privyReady, authenticated, user, login, getAccessToken, error: privyError } = usePrivy();
  const { ready: walletsReady, wallets } = useWallets();
  const { createWallet } = useCreateWallet();
  const { signMessage: signPrivyMessage } = useSignMessage();
  const { signTransaction: signPrivyTransaction } = useSignTransaction();
  const { addSigners, removeSigners } = useSigners();
  const [selectedAddress, setSelectedAddress] = useState('');
  const [createdWallet, setCreatedWallet] = useState(null);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState(null);
  const identityRef = useRef(null);

  const linkedAccounts = Array.isArray(user?.linkedAccounts) ? user.linkedAccounts : [];
  const eligibleWallets = linkedAccounts.filter(isFalconWallet);
  const importedSolanaWallets = linkedAccounts.filter(account => account?.type === 'wallet'
    && account.chainType === 'solana' && account.imported === true);
  const walletAccount = eligibleWallets.find(account => account.address === selectedAddress) ?? null;
  const wallet = wallets.find(candidate => candidate.address === selectedAddress && candidate.standardWallet?.isPrivyWallet === true) ?? null;
  const userId = typeof user?.id === 'string' ? user.id : null;
  const createdAddress = createdWallet?.userId === userId ? createdWallet.address : '';
  const walletAddress = walletAccount?.address ?? (selectedAddress && (eligibleWallets.some(account => account.address === selectedAddress) || selectedAddress === createdAddress) ? selectedAddress : null);
  const selectedIdentity = { authenticated, userId, walletAddress, wallet };
  identityRef.current = selectedIdentity;

  async function accessTokenForSelectedWallet() {
    const expected = { userId, walletAddress, wallet };
    assertWalletIdentity(identityRef.current, expected);
    const token = await getAccessToken();
    assertWalletIdentity(identityRef.current, expected);
    if (typeof token !== 'string' || !token) throw new Error('Log in to your Privy account before authorizing this wallet.');
    return token;
  }

  async function signMessageForSelectedWallet(message) {
    if (!(message instanceof Uint8Array) || !message.length) throw new Error('A non-empty Falcon sign-in challenge is required.');
    const expected = { userId, walletAddress, wallet };
    assertWalletIdentity(identityRef.current, expected);
    const result = await signPrivyMessage({
      message: message.slice(),
      wallet,
      options: { uiOptions: { title: 'Sign in to FalconOS' } },
    });
    assertWalletIdentity(identityRef.current, expected);
    if (!(result?.signature instanceof Uint8Array) || result.signature.length !== 64) {
      throw new Error('Privy returned an invalid Solana message signature.');
    }
    return result.signature.slice();
  }

  async function signTransactionForSelectedWallet(transaction) {
    if (!(transaction instanceof Uint8Array) || transaction.length <= 64) throw new Error('The prepared Solana transaction bytes are invalid.');
    const expected = { userId, walletAddress, wallet };
    assertWalletIdentity(identityRef.current, expected);
    const result = await signPrivyTransaction({
      transaction: transaction.slice(),
      wallet,
      chain: 'solana:mainnet',
      options: { uiOptions: { title: 'Review and sign this exact Solana transaction' } },
    });
    assertWalletIdentity(identityRef.current, expected);
    if (!(result?.signedTransaction instanceof Uint8Array) || result.signedTransaction.length <= 64) {
      throw new Error('Privy did not return the complete signed transaction. No transaction was submitted by this wallet action.');
    }
    return result.signedTransaction.slice();
  }

  async function addSignerForSelectedWallet(signers) {
    if (!Array.isArray(signers) || !signers.length) throw new Error('The reviewed signer and policy scope is missing.');
    const expected = { userId, walletAddress, wallet };
    assertWalletIdentity(identityRef.current, expected);
    const result = await addSigners({ address: walletAddress, signers });
    assertWalletIdentity(identityRef.current, expected);
    return result;
  }

  async function removeAllSignersFromSelectedWallet() {
    const expected = { userId, walletAddress, wallet };
    assertWalletIdentity(identityRef.current, expected);
    const result = await removeSigners({ address: walletAddress });
    assertWalletIdentity(identityRef.current, expected);
    return result;
  }

  const walletSession = walletAddress && wallet ? {
    current: () => {
      try {
        assertWalletIdentity(identityRef.current, { userId, walletAddress, wallet });
        return { address: walletAddress };
      } catch { return null; }
    },
    signMessage: signMessageForSelectedWallet,
  } : null;

  const walletApi = {
    configured: true,
    ready: privyReady && walletsReady,
    authenticated: authenticated === true,
    userId,
    walletAddress,
    walletAccount,
    wallet,
    walletSession,
    getAccessToken: walletSession ? accessTokenForSelectedWallet : null,
    signMessage: walletSession ? signMessageForSelectedWallet : null,
    signTransaction: walletSession ? signTransactionForSelectedWallet : null,
    addSigners: walletSession ? addSignerForSelectedWallet : null,
    removeAllDelegatedSigners: walletSession ? removeAllSignersFromSelectedWallet : null,
  };
  const creatingBlocked = eligibleWallets.length > 0 || importedSolanaWallets.length > 0 || Boolean(createdAddress);

  async function createDedicatedWallet() {
    if (!privyReady || !walletsReady || authenticated !== true || creatingBlocked || busy) return;
    setBusy('create-wallet');
    setError(null);
    try {
      const result = await createWallet();
      if (typeof result?.wallet?.address !== 'string' || !result.wallet.address) throw new Error('Privy did not return the new Solana wallet address.');
      setCreatedWallet({ userId, address: result.wallet.address });
      setSelectedAddress(result.wallet.address);
    } catch (createError) {
      setError(errorText(createError));
    } finally {
      setBusy('');
    }
  }

  async function signInToFalcon() {
    if (!onSignIn || !walletSession || busy || matchesFalconSession) return;
    setBusy('falcon-signin');
    setError(null);
    try {
      await onSignIn({ walletAddress, walletSession });
    } catch (signInError) {
      setError(errorText(signInError));
    } finally {
      setBusy('');
    }
  }

  return <section className="embedded-wallet owner-card" aria-labelledby="embedded-wallet-title" aria-busy={Boolean(busy)}>
    <div className="owner-card-heading">
      <p className="owner-eyebrow">Solana · customer-controlled wallet</p>
      <h2 id="embedded-wallet-title">Dedicated Falcon wallet</h2>
      <p>This wallet is reserved for Falcon lending on Solana mainnet-beta. Funding stays in your control; FalconOS never transfers funds into it for you.</p>
    </div>

    {!privyReady && <p className="owner-auth-status" role="status" aria-live="polite">Initializing the configured Privy app…</p>}
    {privyError && <p className="owner-auth-error" role="alert">Privy could not initialize. {errorText(privyError)} Check the public app ID, enabled login methods, and allowed origin in Privy configuration.</p>}
    {privyReady && authenticated !== true && <div className="embedded-wallet-step">
      <p>Privy login identifies you to the embedded-wallet provider. FalconOS will still ask this wallet to sign a separate Falcon ownership challenge before it can be linked.</p>
      <button className="owner-button owner-button--primary" type="button" onClick={() => { setError(null); login(); }}>
        Log in to Privy
      </button>
    </div>}
    {privyReady && authenticated === true && !walletsReady && <p className="owner-auth-status" role="status" aria-live="polite">Loading your Privy Solana wallets…</p>}
    {privyReady && walletsReady && authenticated === true && eligibleWallets.length > 0 && <div className="embedded-wallet-picker" role="group" aria-label="Select a dedicated Falcon Solana wallet">
      <p className="embedded-wallet-label">Choose the customer-controlled wallet reserved for Falcon lending.</p>
      <ul className="embedded-wallet-list">
        {eligibleWallets.map(account => <li key={account.address}>
          <button className="embedded-wallet-choice" type="button" aria-pressed={selectedAddress === account.address} onClick={() => { setSelectedAddress(account.address); setError(null); }}>
            <span>{account.walletIndex === 0 ? 'Falcon Solana wallet' : 'Additional embedded wallet'}</span>
            <code>{account.address}</code>
          </button>
        </li>)}
      </ul>
    </div>}
    {privyReady && walletsReady && authenticated === true && eligibleWallets.length === 0 && importedSolanaWallets.length === 0 && <div className="embedded-wallet-step">
      <p>{createdAddress ? 'Your Falcon wallet was created. Waiting for Privy to finish loading it before signing or linking.' : 'Create is a separate customer action. Nothing is generated or linked automatically when this page loads.'}</p>
      {!createdAddress && <button className="owner-button owner-button--primary" type="button" disabled={Boolean(busy) || creatingBlocked} onClick={() => void createDedicatedWallet()} aria-busy={busy === 'create-wallet'}>
        {busy === 'create-wallet' ? 'Creating wallet…' : 'Create dedicated Falcon Solana wallet'}
      </button>}
    </div>}
    {privyReady && walletsReady && authenticated === true && eligibleWallets.length === 0 && importedSolanaWallets.length > 0 && <div className="embedded-wallet-warning" role="status">
      <strong>This Privy account already has an imported Solana wallet.</strong>
      <p>The pinned React SDK does not create a second wallet through this flow when one already exists. Use a separate Privy login for a dedicated Falcon wallet; imported or external wallets are not used for this bot.</p>
    </div>}

    {walletAddress && <div className="embedded-wallet-detail">
      <div><span className="embedded-wallet-label">Selected wallet</span><code>{walletAddress}</code></div>
      <div><span className="embedded-wallet-label">Network</span><strong>Solana mainnet-beta</strong></div>
      {!wallet && <p className="owner-auth-status" role="status">Privy has not finished connecting this selected embedded wallet. Signing and linking remain unavailable.</p>}
      {wallet && matchesFalconSession && <p className="embedded-wallet-match" role="status">This embedded wallet matches the current Falcon wallet session.</p>}
      {wallet && !matchesFalconSession && <div className="embedded-wallet-warning">
        <strong>This wallet is not the wallet verified by the current Falcon session.</strong>
        <p>To link or manage it, first sign in to FalconOS with this exact embedded wallet. A session for another wallet cannot authorize this account.</p>
        {onSignIn && <button className="owner-button owner-button--primary" type="button" disabled={Boolean(busy)} onClick={() => void signInToFalcon()} aria-busy={busy === 'falcon-signin'}>
          {busy === 'falcon-signin' ? 'Waiting for Falcon ownership signature…' : session ? 'Switch Falcon session to this wallet' : 'Sign in to Falcon with this wallet'}
        </button>}
      </div>}
    </div>}

    {error && <p className="owner-auth-error" role="alert">{error}</p>}
    {typeof children === 'function' && children(walletApi)}
  </section>;
}
