import { useEffect, useMemo, useRef, useState } from 'react';
import falconMark from '../landing/assets/falcon.svg';
import Agent from '../dashboard/Agent.jsx';
import { meshRequest } from '../dashboard/api.mjs';
import { clearWalletSession, createWalletSession, restoreWalletSession, revokeWalletSession } from './auth.mjs';
import { createSignInWalletSession } from '../app/wallet-signin.mjs';
import { createInjectedPhantomSession, detectPhantomProvider } from './phantom-injected.mjs';
import PhantomWalletConnect from './PhantomWalletConnect.jsx';

function Brand({ compact = false }) {
  return <a className={`bot-brand${compact ? ' bot-brand-compact' : ''}`} href="/" aria-label="FalconOS home">
    <img src={falconMark} alt="" />
    <span><b>FALCON</b><strong>OS</strong></span>
  </a>;
}

function FalconMark() { return <img className="bot-hero-mark" src={falconMark} alt="" />; }

export default function App() {
  const walletSession = useMemo(() => createSignInWalletSession({ requiredChain: null }), []);
  const [walletState, setWalletState] = useState({ wallets: [], current: null, reason: null });
  const [session, setSession] = useState(null);
  const [authReady, setAuthReady] = useState(false);
  const [authPending, setAuthPending] = useState(false);
  const [authError, setAuthError] = useState('');
  const [injectedPhantom, setInjectedPhantom] = useState(null);
  const sessionRef = useRef(null);
  const selectedAddressRef = useRef(null);
  const injectedSessionRef = useRef(null);

  useEffect(() => walletSession.subscribe((state) => {
    setWalletState(state);
    const address = state.current?.address ?? null;
    const previousAddress = selectedAddressRef.current;
    const active = sessionRef.current;
    if (active && ((previousAddress && previousAddress !== address) || (address && address !== active.walletAddress))) {
      sessionRef.current = null;
      setSession(null);
      try { clearWalletSession(); } catch {}
      void revokeWalletSession(active).catch(() => {});
      setAuthError('Phantom account changed. Sign in again.');
    }
    selectedAddressRef.current = address;
  }), [walletSession]);
  useEffect(() => {
    let timer;
    const detect = () => {
      const detected = detectPhantomProvider(window);
      if (!detected) return;
      setInjectedPhantom(detected);
      if (timer) window.clearInterval(timer);
    };
    detect();
    if (!detectPhantomProvider(window)) timer = window.setInterval(detect, 250);
    return () => { if (timer) window.clearInterval(timer); };
  }, []);

  useEffect(() => {
    const provider = injectedPhantom?.provider;
    if (!provider || typeof provider.on !== 'function' || typeof provider.off !== 'function') return;
    const revokeInjectedSession = () => {
      const activeInjected = injectedSessionRef.current;
      if (!activeInjected || activeInjected.provider !== provider) return;
      injectedSessionRef.current = null;
      const active = sessionRef.current;
      sessionRef.current = null;
      setSession(null);
      try { clearWalletSession(); } catch {}
      if (active) void revokeWalletSession(active).catch(() => {});
      setAuthError('Phantom account changed. Sign in again.');
    };
    const accountChanged = (publicKey) => {
      const activeInjected = injectedSessionRef.current;
      if (!activeInjected || activeInjected.provider !== provider) return;
      if (!publicKey || publicKey.toString() !== activeInjected.address
        || activeInjected.session.current()?.address !== activeInjected.address) revokeInjectedSession();
    };
    provider.on('accountChanged', accountChanged);
    provider.on('disconnect', revokeInjectedSession);
    return () => {
      provider.off('accountChanged', accountChanged);
      provider.off('disconnect', revokeInjectedSession);
    };
  }, [injectedPhantom?.provider]);

  useEffect(() => {
    let active = true;
    void restoreWalletSession().then((next) => {
      if (!active) return;
      sessionRef.current = next;
      setSession(next);
    }).catch((error) => {
      if (!active) return;
      if (typeof error?.message === 'string' && error.message.startsWith('UNAUTHORIZED:')) {
        try { clearWalletSession(); } catch {}
      }
      setAuthError(error?.message || 'Falcon could not verify this wallet session.');
    }).finally(() => { if (active) setAuthReady(true); });
    return () => { active = false; };
  }, []);

  async function signIn(walletId) {
    if (authPending) return;
    setAuthPending(true);
    setAuthError('');
    injectedSessionRef.current = null;
    try {
      const selected = walletSession.current();
      if (!selected || selected.walletId !== walletId) await walletSession.connect(walletId);
      const next = await createWalletSession(walletSession);
      sessionRef.current = next;
      setSession(next);
    } catch (error) {
      setAuthError(error?.message || 'Phantom sign-in failed. Try again.');
    } finally {
      setAuthPending(false);
    }
  }

  async function signInInjected() {
    if (authPending || !injectedPhantom?.available) return;
    setAuthPending(true);
    setAuthError('');
    try {
      const injectedSession = createInjectedPhantomSession(injectedPhantom.provider);
      const account = await injectedSession.connect();
      injectedSessionRef.current = { provider: injectedPhantom.provider, session: injectedSession, address: account.address };
      const next = await createWalletSession(injectedSession);
      if (injectedSession.current()?.address !== account.address) {
        await revokeWalletSession(next).catch(() => { try { clearWalletSession(); } catch {} });
        injectedSessionRef.current = null;
        throw new Error('The Phantom account changed during sign-in. Connect again.');
      }
      sessionRef.current = next;
      setSession(next);
    } catch (error) {
      injectedSessionRef.current = null;
      setAuthError(error?.message || 'Phantom sign-in failed. Try again.');
    } finally {
      setAuthPending(false);
    }
  }

  async function signOut() {
    const active = sessionRef.current;
    if (!active || authPending) return;
    setAuthPending(true);
    setAuthError('');
    try {
      await revokeWalletSession(active);
      sessionRef.current = null;
      injectedSessionRef.current = null;
      setSession(null);
    } catch (error) {
      if (typeof error?.message === 'string' && error.message.startsWith('UNAUTHORIZED:')) {
        sessionRef.current = null;
        injectedSessionRef.current = null;
        setSession(null);
        try { clearWalletSession(); } catch {}
        setAuthError(error?.message || 'Falcon could not revoke this session. Try again.');
      }
    } finally {
      setAuthPending(false);
    }
  }

  const api = useMemo(() => async (path, body) => {
    const token = session?.token;
    if (!token) throw new Error('Your wallet session expired. Sign in again.');
    return meshRequest(token, path, body);
  }, [session?.token]);

  if (authReady && session?.token) {
    return <div className="bot-chat-app">
      <header className="bot-chat-topbar"><Brand compact /><div className="bot-chat-topbar-actions"><span className="bot-session-label">PRIVATE WORKSPACE</span><PhantomWalletConnect wallets={walletState.wallets} current={walletState.current} session={session} error={authError} /></div></header>
      <Agent api={api} connection={{ connected: true, disconnect: signOut }} ownerId={session.ownerId} chatOnly />
    </div>;
  }

  if (!authReady) return <main className="bot-loading" aria-busy="true"><Brand /><p>Opening your Falcon workspace…</p></main>;


  return <div className="bot-site">
    <header className="bot-nav">
      <Brand />
      <nav aria-label="Site navigation"><a href="#how-it-works">How it works</a><a href="#safety">Safety</a><a className="bot-nav-login" href="#sign-in">Log in <span aria-hidden="true">↗</span></a></nav>
    </header>
    <main>
      <section className="bot-hero" aria-labelledby="bot-title">
        <div className="bot-hero-badge"><span className="bot-pulse" aria-hidden="true"></span> SOLANA USDC · SIMULATION ONLY</div>
        <FalconMark />
        <h1 id="bot-title">Meet Falcon, your<br />Solana yield agent.</h1>
        <p className="bot-hero-copy">Find provider-indexed lending opportunities. Set your own limits. Review every simulated allocation before you decide.</p>
        <div id="sign-in"><PhantomWalletConnect wallets={walletState.wallets} current={walletState.current} injected={injectedPhantom} pending={authPending} error={authError} onSignIn={signIn} onInjectedSignIn={signInInjected} onSignOut={signOut} /></div>

      </section>
      <section id="how-it-works" className="bot-capabilities" aria-label="Falcon capabilities">
        <p className="bot-section-kicker">One clear path from source to simulation</p>
        <div className="bot-capability-grid">
          <article><span className="bot-capability-icon" aria-hidden="true">⌕</span><h2>Discover</h2><p>Read indexed Solana USDC lending data on request.</p></article>
          <article><span className="bot-capability-icon" aria-hidden="true">⌘</span><h2>Set limits</h2><p>Choose a reserve, investment cap, and protocol concentration.</p></article>
          <article><span className="bot-capability-icon" aria-hidden="true">↗</span><h2>Simulate</h2><p>Review proposed allocations and their source evidence.</p></article>
        </div>
      </section>
      <section id="safety" className="bot-trust-strip" aria-label="Agent limits">
        <span>Provider-indexed data</span><span>Deterministic policy</span><span>Browser-local receipts</span><span>No signing or fund movement</span>
      </section>
    </main>
    <footer className="bot-footer"><Brand compact /><p>Falcon reports sources and limits. Yield is not guaranteed. Simulations do not move funds.</p></footer>
  </div>;
}
