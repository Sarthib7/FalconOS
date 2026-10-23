import React, { useCallback, useEffect, useRef, useState } from 'react';
import { meshRequest } from './api.mjs';
import { createSignInWalletSession } from '../app/wallet-signin.mjs';
import {
  clearWalletSession,
  createWalletSession,
  restoreWalletSession,
  revokeWalletSession,
} from '../bot/auth.mjs';

const emptyActivity = () => ({ status: 'idle', data: null, error: null, refreshing: false });
const isRecord = value => Boolean(value) && typeof value === 'object' && !Array.isArray(value);
const isNonNegativeInteger = value => Number.isSafeInteger(value) && value >= 0;

function errorMessage(error) {
  return typeof error?.message === 'string' && error.message
    ? error.message
    : 'The request could not be completed. Try again.';
}

function unauthorized(error) {
  return error?.status === 401 || error?.code === 'UNAUTHORIZED';
}

function clearStoredSession() {
  try { clearWalletSession(); } catch {}
}

function validActivityResponse(value) {
  const research = value?.research;
  const briefing = research?.briefing;
  return isRecord(value)
    && Array.isArray(value.trail)
    && value.trail.length <= 40
    && isRecord(value.counts)
    && isNonNegativeInteger(value.counts.decisions)
    && isNonNegativeInteger(value.counts.intents)
    && value.limit === 20
    && isRecord(research)
    && research.schemaVersion === 1
    && research.limit === 20
    && research.executionReady === false
    && (briefing === null || (isRecord(briefing) && briefing.executionReady === false))
    && Array.isArray(research.adopted)
    && research.adopted.length <= 20
    && research.adopted.every(isRecord)
    && Array.isArray(research.reviews)
    && research.reviews.length <= 20
    && research.reviews.every(item => isRecord(item) && item.executionReady === false);
}

function formatTime(value) {
  if (typeof value !== 'string') return 'Time not recorded';
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) return 'Time not recorded';
  return `${new Intl.DateTimeFormat('en-GB', {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: 'UTC',
  }).format(new Date(timestamp))} UTC`;
}

const REASON_LABELS = {
  NATIVE_TOKEN_DEMAND_UNVERIFIED: 'Native-token demand is unverified.',
  NET_CAPTURE_METHODOLOGY_UNVERIFIED: 'Net-capture methodology is unverified.',
};

function reasonLabel(reason) {
  return REASON_LABELS[reason] ?? reason;
}

function StatusTag({ children, tone = '' }) {
  if (typeof children !== 'string' || !children) return null;
  return <span className={`owner-status-tag${tone ? ` owner-status-tag--${tone}` : ''}`}>{children}</span>;
}

function ReasonList({ title, reasons }) {
  const items = Array.isArray(reasons) ? reasons.filter(reason => typeof reason === 'string' && reason.length > 0) : [];
  return <div className="owner-reasons">
    <h3>{title}</h3>
    {items.length
      ? <ul>{items.map((reason, index) => <li key={`${reason}-${index}`}>{reasonLabel(reason)}</li>)}</ul>
      : <p>No outcome reasons were retained.</p>}
  </div>;
}

function BriefingCard({ briefing }) {
  const status = typeof briefing?.status === 'string' ? briefing.status : null;
  const investmentStatus = typeof briefing?.investmentStatus === 'string' ? briefing.investmentStatus : null;
  return <section className="owner-card owner-briefing" aria-labelledby="public-briefing-title">
    <div className="owner-card-heading">
      <p className="owner-eyebrow">Public briefing / NEAR</p>
      <h2 id="public-briefing-title">Market context</h2>
      <p className="owner-muted">Public publisher evidence, shown separately from your personal records.</p>
    </div>
    {briefing ? <>
      <div className="owner-status-row" aria-label="Briefing statuses">
        <StatusTag>{status || 'Status not recorded'}</StatusTag>
        <StatusTag tone={investmentStatus === 'NO_DATA' ? 'caution' : ''}>
          {investmentStatus ? `Investment ${investmentStatus}` : 'Investment status not recorded'}
        </StatusTag>
      </div>
      <h3 className="owner-briefing-answer">
        {investmentStatus === 'NO_DATA' ? 'Investment assessment unavailable.' : 'Stored public assessment.'}
      </h3>
      <p>
        {status === 'OBSERVED'
          ? 'Publisher activity was observed. It does not establish economic net revenue or native-token demand.'
          : status === 'NO_DATA'
            ? 'No usable public market evidence was retained for this briefing.'
            : 'This is a retained public briefing, not a personalized recommendation or approval.'}
      </p>
      <ReasonList title="Recorded outcome reasons" reasons={briefing.reasons} />
      <p className="owner-record-time">Publisher snapshot captured {formatTime(briefing.capturedAt)}. Capture time does not establish source freshness.</p>
    </> : <div className="owner-empty">
      <h3>No retained public briefing</h3>
      <p>No public NEAR briefing is available in the retained activity. This view does not start a capture.</p>
    </div>}
  </section>;
}

function reviewBoundary(review) {
  if (review.state === 'PENDING') {
    return `Last recorded phase: ${review.phase || 'not recorded'}. This does not confirm an active process.`;
  }
  if (review.state === 'UNKNOWN') return 'The outcome is unconfirmed; no completion or failure is established.';
  if (review.state === 'COMPLETE') return 'This review is recorded as complete. Completion is not approval or investment readiness.';
  return `Stored state: ${review.state || 'not recorded'}.`;
}

function ReviewRecord({ review }) {
  return <li className="owner-record">
    <div className="owner-record-heading">
      <h3>Research and risk review</h3>
      <div className="owner-status-row">
        {review.state && <StatusTag tone={review.state === 'UNKNOWN' ? 'caution' : ''}>{review.state}</StatusTag>}
        {review.phase && <StatusTag tone="neutral">Last phase {review.phase}</StatusTag>}
        {review.resultStatus && <StatusTag tone={review.resultStatus === 'BLOCKED' || review.resultStatus === 'NO_DATA' ? 'caution' : ''}>{review.resultStatus}</StatusTag>}
      </div>
    </div>
    {typeof review.summary === 'string' && review.summary.length > 0 && <p className="owner-record-summary">{review.summary}</p>}
    {typeof review.riskReason === 'string' && review.riskReason.length > 0 && <p className="owner-risk-reason"><strong>Risk reason</strong> {review.riskReason}</p>}
    <ReasonList title="Outcome reasons" reasons={review.reasons} />
    <p className="owner-boundary-note">{reviewBoundary(review)}</p>
    <p className="owner-record-time">Last recorded {formatTime(review.recordedAt)}</p>
  </li>;
}

function ResearchRecords({ research }) {
  const adopted = Array.isArray(research.adopted) ? research.adopted : [];
  const reviews = Array.isArray(research.reviews) ? research.reviews : [];
  return <section className="owner-card" aria-labelledby="owner-research-title">
    <div className="owner-card-heading">
      <p className="owner-eyebrow">Personal records</p>
      <h2 id="owner-research-title">Your retained research</h2>
      <p className="owner-muted">Only stored assessments and review summaries are shown here.</p>
    </div>
    {!adopted.length && !reviews.length ? <div className="owner-empty">
      <h3>No retained research yet</h3>
      <p>No adopted assessments or review records were returned for this wallet.</p>
    </div> : <div className="owner-record-groups">
      {adopted.length > 0 && <section className="owner-subsection" aria-labelledby="adopted-title">
        <h3 id="adopted-title">Adopted assessments</h3>
        <ul className="owner-record-list">
          {adopted.map((item, index) => <li className="owner-record owner-adopted-record" key={item.analysisId || `${item.createdAt}-${index}`}>
            <div className="owner-record-heading">
              <h4>Retained assessment</h4>
              <StatusTag tone={item.investmentStatus === 'NO_DATA' ? 'caution' : ''}>{item.investmentStatus || 'Status not recorded'}</StatusTag>
            </div>
            <p className="owner-record-time">Recorded {formatTime(item.createdAt)}</p>
          </li>)}
        </ul>
      </section>}
      {reviews.length > 0 && <section className="owner-subsection" aria-labelledby="review-title">
        <h3 id="review-title">Research and risk reviews</h3>
        <ul className="owner-record-list">{reviews.map((review, index) => <ReviewRecord review={review} key={review.jobId || `${review.recordedAt}-${index}`} />)}</ul>
      </section>}
    </div>}
    <p className="owner-boundary-note">Advice only. Wallet sign-in does not authorize model work, signing, or spending.</p>
  </section>;
}

function actionLabel(action) {
  if (typeof action !== 'string' || !action.length) return 'Intent';
  const words = action.replaceAll('_', ' ');
  return `${words[0].toUpperCase()}${words.slice(1)} intent`;
}

function ActivityRecord({ item, index }) {
  const decision = isRecord(item?.decision) ? item.decision : null;
  const intent = isRecord(item?.intent) ? item.intent : null;
  if (!decision && !intent) return null;
  const amount = typeof intent?.amountUsdc === 'string'
    ? `${intent.amountUsdc} USDC`
    : typeof intent?.amountReceiptTokens === 'string'
      ? `${intent.amountReceiptTokens} receipt tokens`
      : null;
  return <li className="owner-record">
    <div className="owner-record-heading">
      <h3>{intent ? actionLabel(intent.action) : decision?.status ? `${decision.status} decision` : 'Decision record'}</h3>
      <div className="owner-status-row">
        {decision?.status && <StatusTag tone={decision.status === 'BLOCKED' || decision.status === 'NO_DATA' ? 'caution' : ''}>{decision.status}</StatusTag>}
        {intent?.status && <StatusTag tone={intent.status === 'FAILED' || intent.status === 'UNVERIFIED' ? 'caution' : ''}>{intent.status}</StatusTag>}
      </div>
    </div>
    {typeof decision?.summary === 'string' && decision.summary.length > 0 && <p className="owner-record-summary">{decision.summary}</p>}
    {amount && <p className="owner-intent-amount">Recorded amount: <strong>{amount}</strong></p>}
    <p className="owner-record-time">Recorded {formatTime(item?.at)}</p>
  </li>;
}

function ActivityTrail({ activity }) {
  const entries = Array.isArray(activity.trail) ? activity.trail : [];
  const visible = entries.filter(item => isRecord(item) && (isRecord(item.decision) || isRecord(item.intent)));
  return <section className="owner-card owner-history" aria-labelledby="owner-activity-title">
    <div className="owner-card-heading">
      <p className="owner-eyebrow">Personal decision and intent history</p>
      <h2 id="owner-activity-title">Your recorded actions</h2>
      <p className="owner-muted">Summaries come from retained records. No transaction action is available on this page.</p>
    </div>
    <p className="owner-returned-counts">Service-returned records: {activity.counts.decisions} decisions · {activity.counts.intents} intents</p>
    {visible.length ? <ol className="owner-record-list owner-trail-list">
      {visible.map((item, index) => <ActivityRecord item={item} index={index} key={`${item.at || 'time'}-${index}`} />)}
    </ol> : <div className="owner-empty">
      <h3>No decision or intent summaries</h3>
      <p>The activity response contains no retained decision or intent summaries for this wallet.</p>
    </div>}
  </section>;
}

function LoadingDashboard() {
  return <div className="owner-loading" role="status" aria-live="polite" aria-busy="true">
    <p>Loading your retained activity…</p>
    <div className="owner-loading-grid" aria-hidden="true">
      <div className="owner-skeleton owner-skeleton--large" />
      <div className="owner-skeleton" />
      <div className="owner-skeleton owner-skeleton--wide" />
    </div>
  </div>;
}

function LoadError({ error, onRetry }) {
  return <section className="owner-card owner-load-error" role="alert">
    <p className="owner-eyebrow">Activity unavailable</p>
    <h2>Your retained activity could not be loaded.</h2>
    <p>{error}</p>
    <button className="owner-button owner-button--primary" type="button" onClick={onRetry}>Try again</button>
  </section>;
}

function OwnerWorkspace({ session, activity, onRefresh, onLogout, onRetry }) {
  const data = activity.data;
  const loading = !data && (activity.status === 'idle' || activity.status === 'loading');
  return <section className="owner-workspace" aria-label="Verified owner dashboard">
    <div className="owner-access-summary">
      <div>
        <p className="owner-eyebrow">Wallet session verified</p>
        <p>Sign-in confirms identity only. It grants no model execution, signing, or spending authority.</p>
      </div>
      <div className="owner-session-actions">
        <span className="owner-expiry-note">Session expires {formatTime(session.expiresAt)}</span>
        <button className="owner-button owner-button--quiet" type="button" onClick={onRefresh} disabled={activity.refreshing || loading} aria-busy={activity.refreshing}>{activity.refreshing ? 'Refreshing…' : 'Refresh activity'}</button>
        <button className="owner-button owner-button--quiet" type="button" onClick={onLogout}>Sign out</button>
      </div>
    </div>
    {activity.error && data && <div className="owner-refresh-error" role="alert">
      <p>Couldn’t refresh your retained activity. {activity.error}</p>
      <button className="owner-button owner-button--quiet" type="button" onClick={onRetry}>Try again</button>
    </div>}
    {loading ? <LoadingDashboard /> : activity.status === 'error' ? <LoadError error={activity.error} onRetry={onRetry} /> : data && <div className="owner-data-grid">
      <BriefingCard briefing={data.research.briefing} />
      <div className="owner-data-column">
        <ResearchRecords research={data.research} />
        <ActivityTrail activity={data} />
      </div>
    </div>}
  </section>;
}

function OwnerGate({ auth, wallets, walletError, notice, pendingWallet, onSignIn, onRetryRestore }) {
  const pendingWalletName = wallets.find(wallet => wallet.id === pendingWallet)?.name;
  const busy = ['checking', 'signing-in', 'signing-out'].includes(auth.status);
  const canChooseWallet = auth.status === 'anonymous' || auth.status === 'restore-error';
  return <section className="owner-gate" aria-labelledby="owner-gate-title" aria-busy={busy}>
    <div className="owner-gate-copy">
      <p className="owner-eyebrow">Private owner dashboard</p>
      <h2 id="owner-gate-title">Sign in to continue.</h2>
      <p>Use a wallet session verified by FalconOS. A message signature proves identity; it does not approve a transfer, model run, or other financial action.</p>
    </div>
    {auth.status === 'checking' && <p className="owner-auth-status" role="status" aria-live="polite">Checking for a server-verified wallet session…</p>}
    {auth.status === 'signing-in' && <p className="owner-auth-status" role="status" aria-live="polite">Waiting for {pendingWalletName || 'your wallet'} to finish sign-in…</p>}
    {auth.status === 'signing-out' && <p className="owner-auth-status" role="status" aria-live="polite">Private activity is cleared. Signing out…</p>}
    {auth.status === 'restore-error' && <div className="owner-auth-error" role="alert">
      <p>FalconOS could not verify the saved wallet session. Owner activity remains hidden.</p>
      <p>{auth.error}</p>
      <button className="owner-button owner-button--quiet" type="button" onClick={onRetryRestore}>Retry session check</button>
    </div>}
    {notice && <p className="owner-gate-notice" role="status" aria-live="polite">{notice}</p>}
    {walletError && <p className="owner-auth-error" role="alert">{walletError}</p>}
    {canChooseWallet && <div className="owner-wallet-picker" role="group" aria-label="Wallet sign-in options">
      <h3>Choose a wallet to sign in</h3>
      <p className="owner-muted">Wallet sign-in needs a Solana Devnet account with message-signing support.</p>
      {wallets.length ? <ul className="owner-wallet-list">
        {wallets.map((wallet, index) => <li className="owner-wallet-option" key={wallet.id}>
          <button
            className="owner-button owner-button--primary"
            type="button"
            disabled={!wallet.available || busy}
            onClick={() => onSignIn(wallet.id)}
            aria-describedby={!wallet.available ? `owner-wallet-reason-${index}` : undefined}
          >Sign in with {wallet.name}</button>
          {!wallet.available && <p className="owner-wallet-reason" id={`owner-wallet-reason-${index}`}>{wallet.reason || 'This wallet does not support the required sign-in capability.'}</p>}
        </li>)}
      </ul> : <p className="owner-empty owner-wallet-empty">No Wallet Standard wallet is currently available. This dashboard requires a Solana Devnet account that can sign a message.</p>}
    </div>}
    <p className="owner-coming-soon">Sign-up and organization workspaces are unavailable.</p>
  </section>;
}

export default function OwnerDashboard() {
  const [auth, setAuth] = useState({ status: 'checking', session: null, error: null });
  const [wallets, setWallets] = useState([]);
  const [walletError, setWalletError] = useState(null);
  const [pendingWallet, setPendingWallet] = useState(null);
  const [notice, setNotice] = useState(null);
  const [activity, setActivity] = useState(emptyActivity);
  const walletSessionRef = useRef(null);
  const mounted = useRef(false);
  const authGeneration = useRef(0);
  const activityGeneration = useRef(0);
  const currentSession = useRef(null);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      authGeneration.current += 1;
      activityGeneration.current += 1;
    };
  }, []);

  useEffect(() => {
    let unsubscribe;
    try {
      const walletSession = createSignInWalletSession();
      walletSessionRef.current = walletSession;
      unsubscribe = walletSession.subscribe(state => setWallets(state.wallets));
    } catch (error) {
      setWalletError(errorMessage(error));
    }
    return () => {
      unsubscribe?.();
      walletSessionRef.current = null;
    };
  }, []);

  const expireSession = useCallback((session, message) => {
    if (currentSession.current !== session) return;
    currentSession.current = null;
    authGeneration.current += 1;
    activityGeneration.current += 1;
    clearStoredSession();
    setActivity(emptyActivity());
    setAuth({ status: 'anonymous', session: null, error: null });
    setNotice(message);
  }, []);

  const loadActivity = useCallback(async session => {
    if (!mounted.current || currentSession.current !== session) return;
    const generation = ++activityGeneration.current;
    setActivity(previous => ({
      status: previous.data ? 'ready' : 'loading',
      data: previous.data,
      error: null,
      refreshing: Boolean(previous.data),
    }));
    try {
      const response = await meshRequest(session.token, '/v1/activity');
      if (!mounted.current || generation !== activityGeneration.current || currentSession.current !== session) return;
      if (!validActivityResponse(response)) throw new Error('The mesh service returned an invalid activity summary. Try again later.');
      setActivity({ status: 'ready', data: response, error: null, refreshing: false });
    } catch (error) {
      if (!mounted.current || generation !== activityGeneration.current || currentSession.current !== session) return;
      if (unauthorized(error)) {
        expireSession(session, 'Your wallet session expired or was revoked. Sign in again to view private activity.');
        return;
      }
      setActivity(previous => ({
        status: previous.data ? 'ready' : 'error',
        data: previous.data,
        error: errorMessage(error),
        refreshing: false,
      }));
    }
  }, [expireSession]);

  const restoreSavedSession = useCallback(async () => {
    const attempt = ++authGeneration.current;
    currentSession.current = null;
    activityGeneration.current += 1;
    setActivity(emptyActivity());
    setNotice(null);
    setAuth({ status: 'checking', session: null, error: null });
    try {
      const session = await restoreWalletSession();
      if (!mounted.current || attempt !== authGeneration.current) return;
      if (!session) {
        setAuth({ status: 'anonymous', session: null, error: null });
        return;
      }
      currentSession.current = session;
      setAuth({ status: 'authenticated', session, error: null });
    } catch (error) {
      if (!mounted.current || attempt !== authGeneration.current) return;
      if (unauthorized(error)) {
        clearStoredSession();
        setAuth({ status: 'anonymous', session: null, error: null });
        setNotice('The saved wallet session expired or was revoked. Sign in again.');
      } else {
        setAuth({ status: 'restore-error', session: null, error: errorMessage(error) });
      }
    }
  }, []);

  useEffect(() => {
    void restoreSavedSession();
  }, [restoreSavedSession]);

  useEffect(() => {
    if (auth.status !== 'authenticated') return undefined;
    const session = auth.session;
    const delay = Date.parse(session.expiresAt) - Date.now();
    const timer = window.setTimeout(() => {
      expireSession(session, 'Your wallet session expired. Sign in again to continue.');
    }, Math.max(0, delay));
    return () => window.clearTimeout(timer);
  }, [auth.status, auth.session, expireSession]);

  useEffect(() => {
    if (auth.status !== 'authenticated') return undefined;
    const session = auth.session;
    void loadActivity(session);
    return () => { activityGeneration.current += 1; };
  }, [auth.status, auth.session, loadActivity]);

  const signIn = useCallback(async walletId => {
    const walletSession = walletSessionRef.current;
    if (!walletSession || !['anonymous', 'restore-error'].includes(auth.status)) return;
    const attempt = ++authGeneration.current;
    currentSession.current = null;
    activityGeneration.current += 1;
    setActivity(emptyActivity());
    setNotice(null);
    setPendingWallet(walletId);
    setAuth({ status: 'signing-in', session: null, error: null });
    try {
      await walletSession.connect(walletId);
      if (!mounted.current || attempt !== authGeneration.current) return;
      const session = await createWalletSession(walletSession);
      if (!mounted.current || attempt !== authGeneration.current) return;
      currentSession.current = session;
      setAuth({ status: 'authenticated', session, error: null });
    } catch (error) {
      if (!mounted.current || attempt !== authGeneration.current) return;
      setAuth({ status: 'anonymous', session: null, error: null });
      setNotice(errorMessage(error));
    } finally {
      if (mounted.current && attempt === authGeneration.current) setPendingWallet(null);
    }
  }, [auth.status]);

  const logout = useCallback(async () => {
    if (auth.status !== 'authenticated' || !auth.session) return;
    const session = auth.session;
    const attempt = ++authGeneration.current;
    currentSession.current = null;
    activityGeneration.current += 1;
    setActivity(emptyActivity());
    setNotice(null);
    setAuth({ status: 'signing-out', session: null, error: null });
    try {
      await revokeWalletSession(session);
      if (!mounted.current || attempt !== authGeneration.current) return;
      setAuth({ status: 'anonymous', session: null, error: null });
      setNotice('Signed out.');
    } catch {
      clearStoredSession();
      if (!mounted.current || attempt !== authGeneration.current) return;
      setAuth({ status: 'anonymous', session: null, error: null });
      setNotice('This tab is signed out, but the server did not confirm session revocation.');
    }
  }, [auth.session, auth.status]);

  const retryActivity = useCallback(() => {
    if (currentSession.current) void loadActivity(currentSession.current);
  }, [loadActivity]);

  return <div className="owner-page">
    <header className="owner-topbar">
      <div className="owner-brand-lockup">
        <span className="wordmark owner-wordmark"><span>FALCON</span><span className="os">OS</span></span>
        <span className="owner-product-label">Dashboard</span>
      </div>
      <div className="owner-header-state">
        {auth.status === 'authenticated'
          ? <span className="owner-verified-label">Wallet session verified</span>
          : <span className="owner-private-label">Private owner access</span>}
      </div>
    </header>
    <main className="owner-main">
      <div className="owner-intro">
        <div>
          <p className="owner-eyebrow">Falcon Investment Council</p>
          <h1>What needs your attention.</h1>
        </div>
        <p className="owner-intro-copy">Research and risk advice.<br />Every financial action remains yours.</p>
      </div>
      {auth.status === 'authenticated'
        ? <OwnerWorkspace session={auth.session} activity={activity} onRefresh={retryActivity} onRetry={retryActivity} onLogout={logout} />
        : <OwnerGate auth={auth} wallets={wallets} walletError={walletError} notice={notice} pendingWallet={pendingWallet} onSignIn={signIn} onRetryRestore={restoreSavedSession} />}
    </main>
    <footer className="owner-footer">FALCON INVESTMENT COUNCIL / RESEARCH AND RISK ADVICE</footer>
  </div>;
}
