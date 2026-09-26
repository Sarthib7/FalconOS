import { formatUsdc } from './domain.mjs';
import { createStore } from './store.mjs';

const store = createStore();
const $ = (id) => document.getElementById(id);
let current = null;
let busy = false;
let storageFailed = false;

function setText(id, value) { $(id).textContent = value; }
function message(text) { setText('action-message', text); }
function clearError() { $('error-message').hidden = true; setText('error-message', ''); }
function showError(error) {
  setText('error-message', error instanceof Error ? error.message : String(error));
  $('error-message').hidden = false;
  message('The setup did not complete. Check the error before trying again.');
}
function updateControls() { $('setup-fields').disabled = busy || storageFailed; }

function render() {
  $('setup-panel').hidden = Boolean(current) || storageFailed;
  $('workspace').hidden = !current;
  if (current) {
    const { balances: b, mandate } = current.view.state;
    const amounts = {
      'total-balance': b.totalUnits,
      'reserve-balance': b.reserveUnits,
      'undelegated-balance': b.undelegatedUnits,
      'idle-balance': b.idleUnits,
      'position-balance': b.positionUnits,
      'mandate-cap': mandate.investmentCapUnits,
      'mandate-liquidity': mandate.minLiquidityUnits,
    };
    for (const [id, units] of Object.entries(amounts)) setText(id, formatUsdc(units));
    setText('mandate-age', `${mandate.maxObservationAgeSeconds}s`);
    setText('mandate-status', 'Saved mandate');
  }
  updateControls();
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
    message('Simulation setup saved. Reload restores these balances.');
    $('balances-title').scrollIntoView({ block: 'start', behavior: 'instant' });
  } catch (error) {
    showError(error);
  } finally {
    busy = false;
    updateControls();
  }
});

window.addEventListener('storage', (event) => {
  if (event.key !== 'falcon.treasury.simulation.v1' && event.key !== null) return;
  try {
    const saved = store.load();
    if (!saved) throw new Error('The saved simulation is missing. Reload to check browser storage.');
    current = saved;
    storageFailed = false;
    clearError();
    render();
    message('Loaded the saved setup from another tab.');
  } catch (error) {
    storageFailed = true;
    showError(error);
    render();
  }
});

try {
  current = store.load();
  render();
  if (current) message('Saved simulation setup restored.');
} catch (error) {
  storageFailed = true;
  showError(error);
  render();
}
