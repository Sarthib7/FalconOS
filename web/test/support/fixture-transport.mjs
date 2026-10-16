const FIXTURE_BINDING = '__meshRpcFixture';
const FIXTURE_RESOLVER = '__meshRpcResolve';
const FAILED_RESPONSE = JSON.stringify({ errorReason: 'Failed' });
const hasOwn = (value, key) => Object.prototype.hasOwnProperty.call(value, key);

function asError(value) {
  return value instanceof Error ? value : new Error(String(value));
}

function isLoopback(hostname) {
  let host = hostname.toLowerCase();
  if (host.startsWith('[') && host.endsWith(']')) host = host.slice(1, -1);
  if (host === '::1') return true;
  if (host.endsWith('.')) host = host.slice(0, -1);
  if (host === 'localhost') return true;
  const octets = host.split('.');
  return octets.length === 4
    && octets[0] === '127'
    && octets.every((octet) => /^\d{1,3}$/.test(octet) && Number(octet) <= 255);
}

function parseHttpUrl(value, label) {
  if (typeof value !== 'string' || value.length === 0) {
    throw new TypeError(`${label} must be an absolute HTTP(S) URL`);
  }
  if (/[\\*\u0000-\u0020\u007f]/.test(value) || value.includes('#')) {
    throw new TypeError(`${label} must not contain wildcards, backslashes, whitespace, or fragments`);
  }
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new TypeError(`${label} must be an absolute HTTP(S) URL`);
  }
  if (!['http:', 'https:'].includes(url.protocol)) {
    throw new TypeError(`${label} must use HTTP(S)`);
  }
  const authority = value.match(/^https?:\/\/([^/?#]*)/i)?.[1] ?? '';
  if (url.username || url.password || authority.includes('@')) {
    throw new TypeError(`${label} must not contain credentials`);
  }
  return url;
}

function normalizeOrigin(value, index) {
  const label = `allowedOrigins[${index}]`;
  if (typeof value !== 'string' || value.includes('?')) {
    throw new TypeError(`${label} must be an origin without a path, query, or fragment`);
  }
  const url = parseHttpUrl(value, label);
  if (!isLoopback(url.hostname)) throw new TypeError(`${label} must use a loopback host`);
  const originOnly = value.match(/^https?:\/\/[^/?#]*/i)?.[0];
  if (value !== originOnly || url.pathname !== '/' || url.search || url.hash) {
    throw new TypeError(`${label} must be an origin without a path, query, or fragment`);
  }
  return url.origin;
}

function serializeFixtureResponse(response) {
  if (response === null || typeof response !== 'object' || Array.isArray(response)) {
    throw new TypeError('Fixture responder returned an invalid response');
  }
  const keys = Object.keys(response);
  if (keys.length === 1 && response.errorReason === 'Failed') return FAILED_RESPONSE;
  if (keys.length !== 1 || !hasOwn(response, 'payload')) {
    throw new TypeError('Fixture responder must return { payload } or { errorReason: "Failed" }');
  }
  const encoded = JSON.stringify({ payload: response.payload });
  if (encoded === undefined || !hasOwn(JSON.parse(encoded), 'payload')) {
    throw new TypeError('Fixture payload must be JSON-compatible');
  }
  return encoded;
}

function fixtureSource(rpcUrl) {
  return `(() => {
    const nativeFetch = window.fetch;
    const rpcUrl = ${JSON.stringify(rpcUrl)};
    const pendingRpc = new Map();
    let sequence = 0;

    const resolveRpc = (id, response) => {
      const item = pendingRpc.get(id);
      if (!item) return;
      pendingRpc.delete(id);
      item.signal.removeEventListener('abort', item.abort);
      if (response?.errorReason === 'Failed') {
        item.reject(new TypeError('Failed to fetch'));
        return;
      }
      try {
        item.resolve(new Response(JSON.stringify(response.payload), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }));
      } catch (error) {
        item.reject(error);
      }
    };
    Object.defineProperty(window, ${JSON.stringify(FIXTURE_RESOLVER)}, {
      value: resolveRpc,
      configurable: false,
      writable: false,
    });

    window.fetch = function(...args) {
      let url;
      try {
        const input = args[0] instanceof Request ? args[0].url : args[0];
        url = new URL(input, window.location.href).href;
      } catch {
        return Reflect.apply(nativeFetch, this, args);
      }
      if (url !== rpcUrl) return Reflect.apply(nativeFetch, this, args);

      let request;
      try {
        request = new Request(...args);
      } catch (error) {
        return Promise.reject(error);
      }
      const signal = request.signal;
      return new Promise((resolve, reject) => {
        if (signal.aborted) {
          reject(signal.reason);
          return;
        }
        const id = ++sequence;
        const abort = () => {
          pendingRpc.delete(id);
          reject(signal.reason);
        };
        pendingRpc.set(id, { resolve, reject, signal, abort });
        signal.addEventListener('abort', abort, { once: true });
        void request.text().then((postData) => {
          if (!signal.aborted && pendingRpc.has(id)) {
            window[${JSON.stringify(FIXTURE_BINDING)}](JSON.stringify({
              id,
              request: { url, method: request.method, postData },
            }));
          }
        }).catch((error) => {
          pendingRpc.delete(id);
          signal.removeEventListener('abort', abort);
          reject(error);
        });
      });
    };
  })();`;
}

function cdpFailure(method, result) {
  if (result && typeof result === 'object' && hasOwn(result, 'error')) {
    const detail = result.error?.message ?? JSON.stringify(result.error);
    return new Error(`CDP ${method} failed: ${detail}`);
  }
  if (method === 'Runtime.evaluate' && result?.exceptionDetails) {
    const details = result.exceptionDetails;
    return new Error(`CDP Runtime.evaluate failed: ${details.exception?.description ?? details.text ?? 'exception'}`);
  }
  return null;
}

export function createFixtureTransport({ call, allowedOrigins, rpcUrl, respond, onError }) {
  if (typeof call !== 'function' || typeof respond !== 'function' || typeof onError !== 'function') {
    throw new TypeError('call, respond, and onError must be functions');
  }
  if (!Array.isArray(allowedOrigins) || allowedOrigins.length === 0) {
    throw new TypeError('allowedOrigins must contain at least one loopback origin');
  }

  const origins = [...new Set(allowedOrigins.map(normalizeOrigin))];
  const rpc = parseHttpUrl(rpcUrl, 'rpcUrl');
  const normalizedRpcUrl = rpc.href;
  if (origins.includes(rpc.origin)) {
    throw new TypeError('rpcUrl origin must not be included in allowedOrigins');
  }

  let failure = null;
  const inFlight = new Set();
  const seenRequests = new Set();
  const installations = new WeakMap();
  const activeContexts = new Map();

  function latch(error) {
    if (failure) return failure;
    failure = asError(error);
    try {
      onError(failure);
    } catch {
      // The original fixture/CDP failure remains authoritative.
    }
    return failure;
  }

  async function sendCall(send, method, params) {
    const result = await send(method, params);
    const error = cdpFailure(method, result);
    if (error) throw error;
    return result;
  }

  function sessionKey(sessionId) {
    return sessionId ?? '';
  }

  function contextIdentity(sessionId, contextId) {
    return activeContexts.get(sessionKey(sessionId))?.get(contextId);
  }

  function trackPageState(message) {
    const params = message?.params;
    const session = sessionKey(message?.sessionId);
    if (message?.method === 'Runtime.executionContextCreated') {
      const contextId = params?.context?.id;
      const uniqueId = params?.context?.uniqueId;
      if (Number.isSafeInteger(contextId) && contextId > 0) {
        let contexts = activeContexts.get(session);
        if (!contexts) activeContexts.set(session, contexts = new Map());
        if (typeof uniqueId === 'string' && uniqueId.length > 0) contexts.set(contextId, uniqueId);
        else contexts.delete(contextId);
      }
      return;
    }
    if (message?.method === 'Runtime.executionContextDestroyed') {
      const contexts = activeContexts.get(session);
      const uniqueId = params?.executionContextUniqueId;
      if (!uniqueId || contexts?.get(params?.executionContextId) === uniqueId) contexts?.delete(params?.executionContextId);
      return;
    }
    if (message?.method === 'Runtime.executionContextsCleared') activeContexts.delete(session);
  }

  function assertFresh(delivery) {
    if (contextIdentity(delivery.sessionId, delivery.contextId) !== delivery.uniqueContextId) {
      throw new Error('Fixture response calling context is no longer active');
    }
  }

  async function callRuntime(delivery, responseJson, allowStale = false) {
    if (!allowStale) assertFresh(delivery);
    const expression = `window.${FIXTURE_RESOLVER}(${delivery.id}, ${responseJson})`;
    const result = await call('Runtime.evaluate', {
      uniqueContextId: delivery.uniqueContextId,
      expression,
      returnByValue: true,
    }, delivery.sessionId);
    const error = cdpFailure('Runtime.evaluate', result);
    if (error) throw error;
    if (!allowStale) assertFresh(delivery);
  }

  function validDelivery(message, id, uniqueContextId) {
    const sessionId = message.sessionId;
    const contextId = message.params.executionContextId;
    if (sessionId !== undefined && (typeof sessionId !== 'string' || sessionId.length === 0)) return null;
    if (!Number.isSafeInteger(contextId) || contextId < 1) return null;
    if (!Number.isSafeInteger(id) || id < 1) return null;
    if (typeof uniqueContextId !== 'string' || uniqueContextId.length === 0) return null;
    return { sessionId, contextId, id, uniqueContextId };
  }

  async function rejectPage(delivery) {
    if (!delivery) return;
    try {
      await callRuntime(delivery, FAILED_RESPONSE, true);
    } catch {
      // Keep the original failure; the resolver may no longer exist after navigation.
    }
  }

  async function processBinding(message, uniqueContextId) {
    let delivery = null;
    try {
      const params = message.params;
      if (!params || typeof params.payload !== 'string') {
        throw new TypeError('Fixture binding payload must be a JSON string');
      }
      let envelope;
      try {
        envelope = JSON.parse(params.payload);
      } catch {
        throw new TypeError('Fixture binding payload must be valid JSON');
      }
      if (envelope && typeof envelope === 'object') {
        delivery = validDelivery(message, envelope.id, uniqueContextId);
      }
      if (!delivery) throw new TypeError('Fixture binding must include a valid session, context, and request id');

      const requestKey = `${delivery.sessionId ?? ''}\0${delivery.uniqueContextId}\0${delivery.id}`;
      if (seenRequests.has(requestKey)) throw new Error('Duplicate fixture binding request');
      seenRequests.add(requestKey);

      if (!envelope || typeof envelope !== 'object' || Array.isArray(envelope)
        || !envelope.request || typeof envelope.request !== 'object' || Array.isArray(envelope.request)) {
        throw new TypeError('Fixture binding request is malformed');
      }
      const request = envelope.request;
      if (request.url !== normalizedRpcUrl || typeof request.method !== 'string' || request.method.length === 0
        || typeof request.postData !== 'string') {
        throw new Error('Fixture binding request did not match the exact RPC URL and request shape');
      }

      if (failure) throw failure;
      const responseJson = serializeFixtureResponse(await respond({
        url: request.url,
        method: request.method,
        postData: request.postData,
      }));
      await callRuntime(delivery, responseJson);
    } catch (error) {
      const fixtureError = asError(error);
      await rejectPage(delivery);
      throw fixtureError;
    }
  }

  function receive(message) {
    trackPageState(message);
    if (message?.method !== 'Runtime.bindingCalled' || message.params?.name !== FIXTURE_BINDING) return;
    const contextId = message.params.executionContextId;
    const uniqueContextId = contextIdentity(message.sessionId, contextId);
    let work;
    work = Promise.resolve()
      .then(() => processBinding(message, uniqueContextId))
      .catch((error) => { latch(error); })
      .then(() => { inFlight.delete(work); });
    inFlight.add(work);
    return work;
  }

  async function install(send, options = {}) {
    try {
      if (typeof send !== 'function') throw new TypeError('install requires a page-scoped send function');
      if (options === null || typeof options !== 'object' || Array.isArray(options)) {
        throw new TypeError('install options must be an object');
      }
      const fixture = options.fixture === undefined ? true : options.fixture;
      if (typeof fixture !== 'boolean') throw new TypeError('fixture must be a boolean');
      if (failure) throw failure;

      let state = installations.get(send);
      if (!state) {
        state = { tail: Promise.resolve(), guarded: false, bridged: false };
        installations.set(send, state);
      }
      const operation = state.tail.then(async () => {
        if (failure) throw failure;
        if (!state.guarded) {
          const urlPatterns = origins.map((origin) => ({ urlPattern: `${origin}/*`, block: false }));
          urlPatterns.push({ urlPattern: '*://*:*/*', block: true });
          await sendCall(send, 'Network.setBlockedURLs', { urlPatterns });
          state.guarded = true;
        }
        if (fixture && !state.bridged) {
          await sendCall(send, 'Runtime.addBinding', { name: FIXTURE_BINDING });
          await sendCall(send, 'Page.addScriptToEvaluateOnNewDocument', { source: fixtureSource(normalizedRpcUrl) });
          state.bridged = true;
        }
      });
      state.tail = operation.catch(() => {});
      await operation;
    } catch (error) {
      latch(error);
      throw failure;
    }
  }

  async function drain() {
    while (inFlight.size > 0) await Promise.all([...inFlight]);
    if (failure) throw failure;
  }

  return { install, receive, drain };
}
