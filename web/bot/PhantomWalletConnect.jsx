import { phantomLoginOption } from './phantom-injected.mjs';

const INSTALL_URL = 'https://phantom.app/download';
const shortAddress = address => address.slice(0, 5) + '…' + address.slice(-4);

// compact: nav-sized button only; the disclaimer and errors render in the full control below the nav.
export default function PhantomWalletConnect({ wallets = [], current = null, injected = null, session = null, pending = false, error = '', onSignIn, onInjectedSignIn, onSignOut, compact = false }) {
  const choice = phantomLoginOption(wallets, injected);
  if (compact && !session && choice.kind === 'unavailable') return null;
  return <div className={'bot-wallet-control' + (session || compact ? '' : ' bot-wallet-login')} role="group" aria-label={compact ? 'Phantom wallet sign-in (navigation)' : 'Phantom wallet sign-in'}>
    {session
      ? <>
        <span className="bot-wallet-address" role="status" title={session.walletAddress} aria-label={'Signed in with Phantom wallet ' + session.walletAddress}>Phantom · {shortAddress(session.walletAddress)}</span>
        {onSignOut && <button className="btn subtle" type="button" onClick={() => void onSignOut()} disabled={pending}>{pending ? 'Signing out…' : 'Sign out'}</button>}
      </>
      : choice.kind === 'wallet-standard'
        ? <button className="btn primary" type="button" onClick={() => void onSignIn?.(choice.wallet.id)} disabled={pending}>
          {pending ? 'Waiting for Phantom…' : current?.walletId === choice.wallet.id ? 'Sign in with Phantom' : 'Continue with Phantom'}
        </button>
        : choice.kind === 'injected'
          ? <button className="btn primary" type="button" onClick={() => void onInjectedSignIn?.()} disabled={pending}>
            {pending ? 'Waiting for Phantom…' : 'Continue with Phantom'}
          </button>
          : choice.kind === 'unavailable'
            ? (compact ? null : <p className="bot-wallet-error" role="alert">{choice.reason}</p>)
            : <a className="btn primary" href={INSTALL_URL} target="_blank" rel="noopener noreferrer">Install Phantom</a>}
    {!session && !compact && <p className="bot-wallet-disclaimer">Message signature only. No transaction or fee.</p>}
    {error && !compact && <p className="bot-wallet-error" role="alert">{error}</p>}
  </div>;
}
