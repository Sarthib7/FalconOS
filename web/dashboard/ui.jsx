import React, { createContext, useContext, useLayoutEffect, useRef, useState } from 'react';
import { formatUsdc } from '../treasury/domain.mjs';

export const MotionPaused = createContext(false);
export const BALANCES = [['reserveUnits', 'Spending reserve', 'Outside agent authority', 'var(--amber)'], ['undelegatedUnits', 'Undelegated cash', 'Outside agent authority', 'var(--cash)'], ['idleUnits', 'Delegated idle', 'Inside the fixed mandate', 'var(--green)'], ['positionUnits', 'Supplied position', 'Simulated lending position', 'var(--blue)']];
export const money = value => { const [whole, fraction] = formatUsdc(String(value ?? '0')).split('.'); return whole.replace(/\B(?=(\d{3})+(?!\d))/g, ',') + (fraction ? `.${fraction}` : ''); };
export const ratio = (part, total) => BigInt(total) > 0n ? Number(BigInt(part) * 10000n / BigInt(total)) / 100 : 0;
export const when = value => new Date(value).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', second: '2-digit', timeZone: 'UTC' });
export const capStyle = value => value.length > 18 ? { fontSize: 18 } : value.length > 13 ? { fontSize: 24 } : undefined;
export const statusKind = value => ['READY', 'PASS', 'SIMULATED', 'HELD'].includes(value) ? 'ok' : ['BLOCKED', 'NO_DATA'].includes(value) ? 'warn' : '';
export const eventName = entry => entry.type === 'observe' ? 'Evidence recorded' : entry.type === 'revoke' ? 'Mandate revoked' : entry.decision ? entry.decision.action[0] + entry.decision.action.slice(1).toLowerCase() : 'Event recorded';
export function fieldError(name, raw) {
  const value = raw.trim();
  if (['totalUsdc', 'reserveUsdc', 'investmentCapUsdc', 'minLiquidityUsdc', 'liquidity'].includes(name)) {
    if (value.length > 21 || !/^(0|[1-9]\d*)(?:\.\d{1,6})?$/.test(value)) return 'Enter a nonnegative USDC amount with up to six decimals.';
    const [whole, fraction = ''] = value.split('.');
    if (BigInt(whole) * 1000000n + BigInt(fraction.padEnd(6, '0')) > 18446744073709551615n) return 'This amount exceeds the supported token limit.';
  } else {
    const minimum = name === 'age' ? 0 : 1, maximum = name === 'age' ? 86400 : 3600;
    if (!value || !Number.isInteger(Number(value)) || Number(value) < minimum || Number(value) > maximum) return `Enter a whole number from ${minimum} to ${maximum.toLocaleString('en-US')}.`;
  }
  return '';
}
export function evidenceState(state, at) {
  const observation = state.observation;
  if (!observation) return { label: 'MISSING', kind: 'warn' };
  if (observation.status !== 'ok') return { label: 'UNAVAILABLE', kind: 'warn' };
  const age = Date.parse(at) - Date.parse(observation.observedAt);
  return age < 0 ? { label: 'FUTURE', kind: 'warn' } : age > state.mandate.maxObservationAgeSeconds * 1000 ? { label: 'STALE', kind: 'warn' } : { label: 'AVAILABLE', kind: 'ok' };
}
export function evidenceAge(state, at) {
  return state.observation ? `${Math.max(0, Math.floor((Date.parse(at) - Date.parse(state.observation.observedAt)) / 1000))}s / ${state.mandate.maxObservationAgeSeconds}s limit` : 'No observation';
}
export function Badge({ children, kind = '' }) { return <span className={`badge ${kind}`}>{String(children).replaceAll('_', ' ')}</span>; }
export function Mark() { return <svg className="brand-mark" viewBox="0 0 256 256" aria-hidden="true"><path d="M30 194L171 39L129 151ZM138 195L218 70L190 195Z" /></svg>; }
export function Facts({ data }) {
  return <dl className="facts">{Object.entries(data).map(([key, value]) => <div key={key}><dt>{key.replace(/([A-Z])/g, ' $1').replace(/Units$/, 'USDC')}</dt><dd>{key.endsWith('Units') && typeof value === 'string' ? `${money(value)} USDC` : value !== null && typeof value === 'object' ? JSON.stringify(value, null, 2) : String(value)}</dd></div>)}</dl>;
}
export function Figure({ children, name, className, style }) {
  const paused = useContext(MotionPaused);
  const previous = useRef(children);
  const face = useRef(null);
  const [old, setOld] = useState(null);
  useLayoutEffect(() => {
    const before = previous.current; previous.current = children;
    if (paused || before === children || !face.current?.animate) { setOld(null); return; }
    setOld(before);
    const animation = face.current.animate([{ opacity: 0, transform: 'translateY(8px)' }, { opacity: 1, transform: 'translateY(0)' }], { duration: 180, easing: 'ease-out' });
    const timer = setTimeout(() => setOld(null), 180);
    return () => { clearTimeout(timer); animation.cancel(); };
  }, [children, paused]);
  return <span className={className} style={style} data-figure={name}><span className="figure-wrap">{old !== null && <span className="figure-old" aria-hidden="true">{old}</span>}<span className="figure-face" ref={face}>{children}</span></span></span>;
}
