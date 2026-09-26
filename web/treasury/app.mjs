import { formatUsdc } from './domain.mjs';
import { createStore } from './store.mjs';

const store = createStore();
const $ = (id) => document.getElementById(id);
const MAX_EVENTS = 200;

let current = null;
let busy = false;
let storageFailed = false;
let selectedScenario = null;

function node(tag, className, text) {
  const element = document.createElement(tag);
  if (className) element.className = className;
  if (text !== undefined) element.textContent = text;
  return element;
}

function setText(id, value) { $(id).textContent = value; }
function money(units) { return formatUsdc(units); }
function tone(status) { return status === 'BLOCKED' ? 'blocked' : status === 'NO_DATA' ? 'warn' : 'ok'; }
function stamp(iso) { return new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'medium' }); }
function latestDecisionEntry() { return current?.view.entries.findLast((entry) => entry.decision !== null) ?? null; }

function message(text) { setText('action-message', text); }
function clearError() { $('error-message').hidden = true; setText('error-message', ''); }
function showError(error) {
  setText('error-message', error instanceof Error ? error.message : String(error));
  $('error-message').hidden = false;
  message('The action did not complete. Check the error before trying again.');
}

function updateControls() {
  const locked = busy || storageFailed;
  const full = Boolean(current && current.run.events.length >= MAX_EVENTS);
  const revoked = Boolean(current?.view.state.revoked);
  $('setup-fields').disabled = locked;
  document.querySelectorAll('[data-scenario]').forEach((button) => { button.disabled = locked || !current || full; });
  $('run-cycle').disabled = locked || !current || full || revoked;
  $('owner-redeem').disabled = locked || !current || full;
  $('revoke-mandate').disabled = locked || !current || full || revoked;
  $('confirm-revoke').disabled = locked || !current || full || revoked;
  if (current) setText('event-count', `${current.run.events.length} / ${MAX_EVENTS} events saved`);
}

function renderObservation() {
  if (!current) return;
  const { observation, mandate } = current.view.state;
  document.querySelectorAll('[data-scenario]').forEach((button) => {
    button.setAttribute('aria-pressed', String(button.dataset.scenario === selectedScenario));
  });
  if (!observation) {
    setText('observation-value', 'No synthetic observation recorded. Choose a condition above.');
    setText('observation-freshness', 'No data');
    $('observation-freshness').dataset.tone = 'warn';
    setText('observation-age', '');
    setText('observation-time', '');
    return;
  }
  const ageMs = Date.now() - Date.parse(observation.observedAt);
  const stale = ageMs > mandate.maxObservationAgeSeconds * 1000;
  const future = ageMs < 0;
  const unavailable = observation.status === 'unavailable';
  setText('observation-value', unavailable ? 'Synthetic pool data is unavailable.' : `Synthetic available liquidity: ${money(observation.availableLiquidityUnits)} USDC`);
  setText('observation-freshness', unavailable ? 'Unavailable' : future ? 'Future timestamp' : stale ? 'Stale evidence' : 'Fresh evidence');
  $('observation-freshness').dataset.tone = unavailable || future || stale ? 'warn' : 'ok';
  setText('observation-age', future ? '' : `${Math.floor(ageMs / 1000)}s old`);
  setText('observation-time', `Observed ${stamp(observation.observedAt)}`);
}

function renderDecision() {
  const entry = latestDecisionEntry();
  const decision = entry?.decision;
  setText('decision-title', decision ? { SUPPLY: 'Supply', REDEEM: 'Redeem', HOLD: 'Hold' }[decision.action] : 'Ready when you are.');
  setText('decision-status', decision?.status ?? 'Awaiting a cycle');
  $('decision-status').dataset.tone = tone(decision?.status);
  setText('decision-amount', decision ? `${money(decision.amountUnits)} USDC` : '');
  setText('decision-time', entry ? `Last evaluated ${stamp(entry.at)}` : '');
  const reasons = decision?.reasons ?? ['Choose synthetic evidence, then run one cycle.'];
  $('decision-reasons').replaceChildren(...reasons.map((reason) => node('li', '', reason)));
  setText('decision-outcome', entry?.outcome.message ?? 'No movement has been simulated.');
}

function render() {
  $('setup-panel').hidden = Boolean(current) || storageFailed;
  $('workspace').hidden = !current;
  if (current) {
    const { balances: b, mandate, revoked } = current.view.state;
    for (const [id, units] of Object.entries({ 'total-balance': b.totalUnits, 'reserve-balance': b.reserveUnits, 'undelegated-balance': b.undelegatedUnits, 'idle-balance': b.idleUnits, 'position-balance': b.positionUnits, 'mandate-cap': mandate.investmentCapUnits, 'mandate-liquidity': mandate.minLiquidityUnits })) setText(id, money(units));
    setText('mandate-age', `${mandate.maxObservationAgeSeconds}s`);
    setText('mandate-status', revoked ? 'Permanently revoked' : 'Active mandate');
    $('mandate-status').dataset.tone = revoked ? 'blocked' : 'ok';
    renderObservation();
    renderDecision();
  }
  updateControls();
}

async function command(type, payload = {}) {
  if (busy || !current || storageFailed) return false;
  busy = true;
  clearError();
  updateControls();
  try {
    const event = { id: crypto.randomUUID(), at: new Date().toISOString(), type, ...payload };
    current = await store.dispatch(event, current.view.state.revision);
    render();
    message(current.view.entries.at(-1)?.outcome.message ?? 'Event saved.');
    return true;
  } catch (error) {
    showError(error);
    return false;
  } finally {
    busy = false;
    updateControls();
  }
}

async function recordScenario(scenario) {
  if (!current || busy || storageFailed) return;
  const { mandate, balances } = current.view.state;
  const floor = BigInt(mandate.minLiquidityUnits);
  const total = BigInt(balances.totalUnits);
  const position = BigInt(balances.positionUnits);
  const cap = BigInt(mandate.investmentCapUnits);
  let liquidity = total > floor ? total : floor;
  if (scenario === 'low') {
    const exitAmount = position > 0n ? position : cap;
    liquidity = floor / 2n < exitAmount / 2n ? floor / 2n : exitAmount / 2n;
  }
  const observation = {
    source: 'synthetic',
    status: scenario === 'unavailable' ? 'unavailable' : 'ok',
    observedAt: new Date(Date.now() - (scenario === 'stale' ? (mandate.maxObservationAgeSeconds + 1) * 1000 : 0)).toISOString(),
    availableLiquidityUsdc: scenario === 'unavailable' ? null : money(String(liquidity)),
  };
  if (await command('observe', { observation })) {
    selectedScenario = scenario;
    renderObservation();
    if (scenario === 'low' && floor === 0n) message('Zero liquidity recorded. A zero liquidity floor cannot trigger an automatic exit. Use owner redemption to test the exit.');
  }
}

$('setup-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  if (busy || current || storageFailed) return;
  const fields = new FormData(event.currentTarget);
  busy = true;
  clearError();
  updateControls();
  try {
    current = await store.create({
      id: crypto.randomUUID(), createdAt: new Date().toISOString(),
      totalUsdc: String(fields.get('totalUsdc')).trim(),
      reserveUsdc: String(fields.get('reserveUsdc')).trim(),
      investmentCapUsdc: String(fields.get('investmentCapUsdc')).trim(),
      minLiquidityUsdc: String(fields.get('minLiquidityUsdc')).trim(),
      maxObservationAgeSeconds: Number(fields.get('maxObservationAgeSeconds')),
    });
    render();
    message('Simulation saved. Choose a synthetic observation, then run one cycle.');
    $('balances-title').scrollIntoView({ block: 'start', behavior: 'instant' });
  } catch (error) {
    showError(error);
  } finally {
    busy = false;
    updateControls();
  }
});

document.querySelectorAll('[data-scenario]').forEach((button) => button.addEventListener('click', () => recordScenario(button.dataset.scenario)));
$('run-cycle').addEventListener('click', () => command('cycle'));
$('owner-redeem').addEventListener('click', () => {
  void command('owner_redeem');
});
$('revoke-mandate').addEventListener('click', () => {
  $('revoke-dialog').returnValue = 'cancel';
  $('revoke-dialog').showModal();
});
$('revoke-dialog').addEventListener('close', () => {
  if ($('revoke-dialog').returnValue === 'confirm') void command('revoke');
});
window.addEventListener('storage', (event) => {
  if (event.key !== 'falcon.treasury.simulation.v1' && event.key !== null) return;
  try {
    const saved = store.load();
    if (!saved) throw new Error('The saved simulation is missing. Reload to check browser storage.');
    current = saved;
    storageFailed = false;
    selectedScenario = null;
    clearError();
    render();
    message('Loaded the saved change from another tab. Actions run only when you request them.');
  } catch (error) {
    storageFailed = true;
    showError(error);
    render();
  }
});

try {
  current = store.load();
  render();
  if (current) {
    message('Saved simulation restored. Choose evidence and run a cycle when you are ready.');
  }
} catch (error) {
  storageFailed = true;
  showError(error);
  render();
}

// Display age only. This timer never records or refreshes an observation.
setInterval(renderObservation, 1000);
