import { appendEvent, createRun, replayRun } from './domain.mjs';

const KEY = 'falcon.treasury.simulation.v1';
const MAX_RECORD_LENGTH = 2 * 1024 * 1024;

export function createStore({ storage, locks, key = KEY } = {}) {
  function backend() {
    try {
      const value = storage ?? globalThis.localStorage;
      if (!value || typeof value.getItem !== 'function' || typeof value.setItem !== 'function') throw new Error();
      return value;
    } catch {
      throw new Error('Browser storage is unavailable. The simulation cannot save a run.');
    }
  }

  function load() {
    let raw;
    try {
      raw = backend().getItem(key);
    } catch {
      throw new Error('Could not read browser storage. Existing history has not been replaced.');
    }
    if (raw === null) return null;
    if (typeof raw !== 'string' || raw.length > MAX_RECORD_LENGTH) {
      throw new Error('Stored simulation exceeds the record limit. Existing history has not been replaced.');
    }
    let run;
    try {
      run = JSON.parse(raw);
    } catch {
      throw new Error('Stored simulation is not valid JSON. Existing history has not been replaced.');
    }
    try {
      return { run, view: replayRun(run) };
    } catch (error) {
      throw new Error(`Stored simulation failed validation: ${error.message}. Existing history has not been replaced.`);
    }
  }

  function save(run) {
    const raw = JSON.stringify(run);
    if (raw.length > MAX_RECORD_LENGTH) throw new Error('Simulation record is full. Export the saved history before continuing.');
    try {
      backend().setItem(key, raw);
    } catch {
      throw new Error('Could not save the simulation. The action was not recorded. Check browser storage space.');
    }
  }

  async function exclusive(work, signal) {
    const manager = locks ?? globalThis.navigator?.locks;
    if (!manager || typeof manager.request !== 'function') {
      throw new Error('Safe storage needs Web Locks. Open this page over HTTPS or localhost in a supported browser.');
    }
    const options = { mode: 'exclusive' };
    if (signal !== undefined) options.signal = signal;
    return manager.request(key, options, work);
  }

  async function create(setup) {
    return exclusive(() => {
      if (load() !== null) throw new Error('This browser already has a simulation. Reload to open its saved history.');
      const run = createRun(setup);
      const view = replayRun(run);
      save(run);
      return { run, view };
    });
  }

  async function dispatch(event, expectedRevision, { signal } = {}) {
    return exclusive(() => {
      signal?.throwIfAborted();
      const current = load();
      if (!current) throw new Error('Create a simulation before running an action.');
      if (!Number.isSafeInteger(expectedRevision) || expectedRevision < 0) throw new Error('A valid state revision is required.');
      const run = appendEvent(current.run, event);
      if (run === current.run) return current;
      if (expectedRevision !== current.run.events.length) {
        throw new Error('The simulation changed in another tab. Reload its saved state before trying again.');
      }
      const view = replayRun(run);
      save(run);
      return { run, view };
    }, signal);
  }

  function exportRun() {
    const current = load();
    if (!current) throw new Error('There is no saved simulation to export.');
    return JSON.stringify(current.run, null, 2);
  }

  return { load, create, dispatch, exportRun };
}
