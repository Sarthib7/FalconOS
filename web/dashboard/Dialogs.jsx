import React, { useLayoutEffect, useRef, useState } from 'react';
import { Badge, Facts, fieldError } from './ui.jsx';

function Modal({ id, title, eyebrow, open, close, children, footer, closeLabel }) {
  const dialog = useRef(null), trigger = useRef(null);
  useLayoutEffect(() => {
    if (open && !dialog.current.open) { trigger.current = document.activeElement; dialog.current.showModal(); }
    else if (!open && dialog.current.open) {
      dialog.current.close();
      const target = trigger.current?.isConnected ? trigger.current : document.getElementById('page-title');
      target?.focus({ preventScroll: true });
    }
  }, [open]);
  return <dialog id={`${id}-dialog`} ref={dialog} aria-labelledby={`${id}-title`} onCancel={event => { event.preventDefault(); close(); }}><header><div><p className="eyebrow">{eyebrow}</p><h2 id={`${id}-title`}>{title}</h2></div><button className="btn icon-btn" data-close aria-label={closeLabel} onClick={close}>×</button></header>{children}{footer && <footer>{footer}</footer>}</dialog>;
}

export function SetupDialog({ open, close, create, disabled }) {
  const initial = { totalUsdc: '1000', reserveUsdc: '200', investmentCapUsdc: '500', minLiquidityUsdc: '1000', maxObservationAgeSeconds: '60' };
  const [values, setValues] = useState(initial), [errors, setErrors] = useState({}), [failure, setFailure] = useState('');
  const fields = [['totalUsdc', 'Total synthetic USDC *', 'total', 'The complete simulated balance.'], ['reserveUsdc', 'Spending reserve *', 'reserve', 'Excluded from agent actions.'], ['investmentCapUsdc', 'Investment cap *', 'cap', 'Becomes delegated idle USDC.'], ['minLiquidityUsdc', 'Minimum pool liquidity *', 'liquidity', 'Below this, request full redemption.'], ['maxObservationAgeSeconds', 'Maximum evidence age, seconds *', 'age', '1 to 3,600 seconds. Age increases until you record new evidence.']];
  async function submit(event) {
    event.preventDefault();
    const form = event.currentTarget;
    const next = Object.fromEntries(Object.entries(values).map(([key, value]) => [key, fieldError(key, value)]));
    setErrors(next); setFailure('');
    if (Object.values(next).some(Boolean)) { setFailure('Correct the fields marked below.'); form.elements[Object.keys(next).find(key => next[key])]?.focus(); return; }
    // Capture all values before the parent disables the form during persistence.
    const setup = Object.fromEntries(Object.entries(values).map(([key, value]) => [key, key === 'maxObservationAgeSeconds' ? Number(value) : value.trim()]));
    try { await create(setup); }
    catch (error) {
      setFailure(error.message);
      if (error.message.includes('plus investment cap')) { setErrors(previous => ({ ...previous, investmentCapUsdc: error.message })); form.elements.investmentCapUsdc.focus(); }
    }
  }
  return <Modal id="setup" title="Set your mandate." eyebrow="A fixed boundary" open={open} close={close} closeLabel="Close setup"><form id="setup-form" noValidate onSubmit={submit}><div className="dialog-content od-stack" style={{ '--od-gap': '24px' }}><p className="form-note">Create a synthetic run in this browser. The reserve stays outside agent authority. These limits stay fixed.</p><div id="setup-errors" role="alert" className="field-error">{failure}</div><div className="form-grid">{fields.map(([name, label, id, helper]) => <label className={`field ${name === 'maxObservationAgeSeconds' ? 'full' : ''}`} key={name}><span>{label}</span><input name={name} value={values[name]} onChange={event => setValues({ ...values, [name]: event.target.value })} onBlur={() => setErrors({ ...errors, [name]: fieldError(name, values[name]) })} {...(name === 'maxObservationAgeSeconds' ? { type: 'number', min: 1, max: 3600, step: 1 } : { inputMode: 'decimal', maxLength: 21 })} required disabled={disabled} aria-invalid={Boolean(errors[name])} aria-describedby={`${id}-help ${id}-error`} /><small id={`${id}-help`}>{helper}</small><span id={`${id}-error`} className="field-error">{errors[name]}</span></label>)}</div><p className="form-note">One saved run. Existing records are never reset or replaced.</p></div><footer><button type="button" className="btn" data-close onClick={close}>Cancel</button><button id="create-submit" type="submit" className="btn primary" disabled={disabled}>Create simulation</button></footer></form></Modal>;
}
export function MandateDialog({ open, close, run, state, own }) {
  return <Modal id="mandate" title="Your mandate." eyebrow="Owner authority" open={open} close={close} closeLabel="Close mandate" footer={<button className="btn" data-close onClick={close}>Close</button>}><div className="dialog-content" id="mandate-content"><Badge kind={state.revoked ? 'warn' : 'ok'}>{state.revoked ? 'REVOKED' : 'ACTIVE'}</Badge><p className="detail-copy">{own ? 'The fixed mandate for your browser-local simulation.' : 'A fixed mandate from the selected sample.'}</p><Facts data={{ totalUnits: state.balances.totalUnits, reserveUnits: state.balances.reserveUnits, investmentCapUnits: state.mandate.investmentCapUnits, minLiquidityUnits: state.mandate.minLiquidityUnits, maxObservationAgeSeconds: state.mandate.maxObservationAgeSeconds, createdAt: run.createdAt, policy: run.policyVersion || 'treasury-rules/1 (reconstructed legacy record)' }} /><p className="detail-copy">Reserve and undelegated cash stay outside agent authority. Revocation stops agent movements but does not redeem the position.</p></div></Modal>;
}
export function RevokeDialog({ open, close, confirm, disabled }) {
  return <Modal id="revoke" title="Revoke this mandate?" eyebrow="Owner confirmation" open={open} close={close} closeLabel="Cancel revocation" footer={<><button className="btn" data-close onClick={close}>Keep mandate</button><button className="btn danger" data-action="confirm-revoke" onClick={confirm} disabled={disabled}>Revoke mandate</button></>}><div className="dialog-content"><p>Revocation permanently stops agent movements in this synthetic run. It does not withdraw the position.</p><p className="detail-copy">Owner redemption stays separate. It still requires usable evidence and sufficient liquidity.</p></div></Modal>;
}
export function ExportDialog({ open, close, record, status, copy, download, textarea }) {
  return <Modal id="export" title="Export JSON" eyebrow="Saved record" open={open} close={close} closeLabel="Close export" footer={<><button className="btn" data-action="copy-export" onClick={copy}>Copy JSON</button><button className="btn primary" data-action="download-export" onClick={download}>Download JSON</button></>}><div className="dialog-content od-stack" style={{ '--od-gap': '16px' }}><p className="form-note" id="export-description">{record.description}</p><label className="field"><span>Record JSON</span><textarea id="export-json" ref={textarea} rows="12" readOnly spellCheck="false" value={record.text} /></label><p id="export-status" className="form-note" role="status">{status}</p></div></Modal>;
}
