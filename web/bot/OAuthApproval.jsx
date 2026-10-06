import { useEffect, useMemo, useRef, useState } from 'react';
import falconMark from '../landing/assets/falcon.svg';
import { bytesToBase64 } from '../app/auth.mjs';
import { API_BASE, meshRequest } from '../dashboard/api.mjs';
import { createSignInWalletSession } from '../app/wallet-signin.mjs';
import { createInjectedPhantomSession, detectPhantomProvider, phantomLoginOption } from './phantom-injected.mjs';
import './oauth-approval.css';

const REQUEST_HANDLE = /^far1_[A-Za-z0-9_-]{43}$/;
const messageEncoder = new TextEncoder();

export default function OAuthApproval({ initialRequest }) {
  const request = REQUEST_HANDLE.test(initialRequest ?? '') ? initialRequest : null;
  const walletSession = useMemo(() => createSignInWalletSession({ requiredChain: null }), []);
  const contextPromise = useRef(null);
  const signer = useRef(null);
  const [walletState, setWalletState] = useState(() => ({ wallets: walletSession.list(), current: null, reason: null }));
  const [injected, setInjected] = useState(null);
  const [connected, setConnected] = useState(null);
  const [context, setContext] = useState(null);
  const [loading, setLoading] = useState(Boolean(request));
  const [busy, setBusy] = useState('');
  const [error, setError] = useState(request ? '' : 'This approval link is missing or invalid. Start sign-in again from your MCP client.');

  useEffect(() => walletSession.subscribe((state) => {
    setWalletState(state);
    if (signer.current?.kind === 'wallet-standard' && state.current?.address !== signer.current.address) {
      signer.current = null;
      setConnected(null);
    }
  }), [walletSession]);

  useEffect(() => setInjected(detectPhantomProvider()), []);

  useEffect(() => {
    if (!request) return undefined;
    let active = true;
    contextPromise.current ??= meshRequest(null, '/v1/oauth/approval/context', { request }).then((value) => {
      if (typeof value?.clientName !== 'string' || typeof value?.redirectHost !== 'string'
        || typeof value?.resource !== 'string' || typeof value?.scope !== 'string') {
        throw new Error('The approval details are incomplete. Start sign-in again from your MCP client.');
      }
      return value;
    });
    contextPromise.current.then((value) => {
      if (active) setContext(value);
    }).catch((reason) => {
      if (active) setError(reason instanceof Error ? reason.message : 'Falcon could not load this approval request.');
    }).finally(() => {
      if (active) setLoading(false);
    });
    return () => { active = false; };
  }, [request]);

  const walletOption = phantomLoginOption(walletState.wallets, injected);
  const canConnect = walletOption.kind === 'wallet-standard' || walletOption.kind === 'injected';

  async function connectWallet() {
    setError('');
    setBusy('connect');
    try {
      if (walletOption.kind === 'wallet-standard') {
        const account = await walletSession.connect(walletOption.wallet.id);
        signer.current = { kind: 'wallet-standard', address: account.address, signMessage: walletSession.signMessage };
        setConnected({ address: account.address, name: walletOption.wallet.name });
      } else if (walletOption.kind === 'injected' && injected?.provider) {
        const session = createInjectedPhantomSession(injected.provider);
        const account = await session.connect();
        signer.current = { kind: 'injected', address: account.address, signMessage: session.signMessage };
        setConnected({ address: account.address, name: 'Phantom' });
      } else {
        throw new Error(walletOption.reason ?? 'Install Phantom to approve this request.');
      }
    } catch (reason) {
      signer.current = null;
      setConnected(null);
      setError(reason instanceof Error ? reason.message : 'Phantom could not connect.');
    } finally {
      setBusy('');
    }
  }

  async function approve() {
    if (!request || !context || !connected || !signer.current) return;
    setError('');
    setBusy('approve');
    try {
      const activeSigner = signer.current;
      if (activeSigner.address !== connected.address) throw new Error('The Phantom account changed. Connect again.');
      const walletChallenge = await meshRequest(null, '/v1/oauth/approval/challenge', { request, address: activeSigner.address });
      if (typeof walletChallenge?.challengeId !== 'string' || typeof walletChallenge?.message !== 'string') {
        throw new Error('Falcon returned an invalid wallet challenge. Start sign-in again.');
      }
      const signature = await activeSigner.signMessage(messageEncoder.encode(walletChallenge.message));
      const result = await meshRequest(null, '/v1/oauth/approval/approve', {
        request,
        challengeId: walletChallenge.challengeId,
        signature: bytesToBase64(signature),
      });
      if (typeof result?.redirectUrl !== 'string') throw new Error('Falcon could not complete this approval. Start sign-in again.');
      window.location.assign(result.redirectUrl);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Falcon could not complete this approval.');
    } finally {
      setBusy('');
    }
  }

  async function deny() {
    if (!request || !context) return;
    setError('');
    setBusy('deny');
    try {
      const result = await meshRequest(null, '/v1/oauth/approval/deny', { request });
      if (typeof result?.redirectUrl !== 'string') throw new Error('Falcon could not return to your MCP client.');
      window.location.assign(result.redirectUrl);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Falcon could not deny this request.');
    } finally {
      setBusy('');
    }
  }

  async function disconnectWallet() {
    const activeSigner = signer.current;
    signer.current = null;
    setConnected(null);
    setError('');
    if (activeSigner?.kind === 'wallet-standard') await walletSession.disconnect().catch(() => {});
    else if (injected?.provider && typeof injected.provider.disconnect === 'function') {
      try { await injected.provider.disconnect(); } catch {}
    }
  }

  return <main className="oauth-approval-page">
    <header className="oauth-approval-header">
      <a className="oauth-approval-brand" href="/" aria-label="FalconOS home">
        <img src={falconMark} alt="" />
        <span><b>FALCON</b><strong>OS</strong></span>
      </a>
      <span className="oauth-approval-tag">MCP ACCESS</span>
    </header>

    <section className="oauth-approval-card" aria-labelledby="oauth-approval-title">
      <div className="oauth-approval-kicker">WALLET AUTHORIZATION</div>
      <h1 id="oauth-approval-title">Approve MCP access</h1>
      <p className="oauth-approval-intro">Review the client and resource before you connect your wallet.</p>

      {loading && <p className="oauth-approval-status" role="status">Loading approval details…</p>}
      {!loading && context && <>
        <dl className="oauth-approval-details">
          <div><dt>Client</dt><dd>{context.clientName}</dd></div>
          <div><dt>Redirect host</dt><dd><code>{context.redirectHost}</code></dd></div>
          <div><dt>Resource</dt><dd><code>{context.resource}</code></dd></div>
          <div><dt>Access scope</dt><dd><code>{context.scope}</code></dd></div>
          <div><dt>Request expires</dt><dd><time dateTime={context.expiresAt}>{context.expiresAt}</time></dd></div>
        </dl>

        <div className="oauth-approval-note">
          <strong>Wallet proof only</strong>
          <p>Your wallet signs a non-transaction message to prove account control. This does not sign, approve, or send a transaction.</p>
        </div>

        {error && <p className="oauth-approval-error" role="alert">{error}</p>}

        {connected ? <div className="oauth-approval-wallet">
          <span className="oauth-approval-wallet-label">Connected with {connected.name}</span>
          <code className="oauth-approval-address">{connected.address}</code>
          <div className="oauth-approval-actions">
            <button className="oauth-approval-primary" type="button" onClick={approve} disabled={Boolean(busy)}>
              {busy === 'approve' ? 'Waiting for wallet…' : 'Approve access'}
            </button>
            <button className="oauth-approval-secondary" type="button" onClick={deny} disabled={Boolean(busy)}>Deny</button>
          </div>
          <button className="oauth-approval-link" type="button" onClick={disconnectWallet} disabled={Boolean(busy)}>Disconnect wallet</button>
        </div> : <div className="oauth-approval-actions oauth-approval-connect">
          <button className="oauth-approval-primary" type="button" onClick={connectWallet} disabled={Boolean(busy) || !canConnect}>
            {busy === 'connect' ? 'Connecting…' : 'Connect Phantom'}
          </button>
          <button className="oauth-approval-secondary" type="button" onClick={deny} disabled={Boolean(busy)}>Deny</button>
          {!canConnect && <p className="oauth-approval-wallet-hint" role="status">
            {walletOption.kind === 'unavailable' ? walletOption.reason : 'Install Phantom to approve this request.'}
          </p>}
        </div>}
      </>}

      {!loading && !context && error && <p className="oauth-approval-error" role="alert">{error}</p>}
      {!API_BASE && <p className="oauth-approval-config" role="status">Falcon Mesh is not configured for this site.</p>}
    </section>

    <footer className="oauth-approval-footer">Falcon never receives your private key or stores an OAuth token in this browser.</footer>
  </main>;
}
