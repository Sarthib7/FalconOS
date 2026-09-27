import { createStore as createTreasuryStore } from '../treasury/store.mjs';

export const STORE_KEY = 'falconos-control-centre-preview-v1';

export function createStore({ storage, locks } = {}) {
  return createTreasuryStore({ storage, locks, key: STORE_KEY });
}
