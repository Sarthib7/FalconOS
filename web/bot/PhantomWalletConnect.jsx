import { phantomLoginOption } from './phantom-injected.mjs';

const INSTALL_URL = 'https://phantom.app/download';
const shortAddress = address => address.slice(0, 5) + '…' + address.slice(-4);

export default function PhantomWalletConnect({ wallets = [], current = null, injected = null, session = null, pending = false, error = '', onSignIn, onInjectedSignIn, onSignOut }) {
  const choice = phantomLoginOption(wallets, injected);
  return <div className={'bot-wallet-control' + (session ? '' : ' bot-wallet-login')} role="group" aria-label="Phantom wallet sign-in">
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
            ? <p className="bot-wallet-error" role="alert">{choice.reason}</p>
            : <a className="btn primary" href={INSTALL_URL} target="_blank" rel="noopener noreferrer">Install Phantom</a>}
    {!session && <p className="bot-wallet-disclaimer">Message signature only. No transaction or fee.</p>}
    {error && <p className="bot-wallet-error" role="alert">{error}</p>}
  </div>;
}
