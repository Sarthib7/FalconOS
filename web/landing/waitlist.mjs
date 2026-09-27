export async function registerEmail(value, { fetchImpl = globalThis.fetch, signal } = {}) {
  const email = typeof value === 'string' ? value.trim() : '';
  if (!email || email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error('Enter a valid email address.');
  let response;
  try {
    response = await fetchImpl('/api/waitlist', {
      method: 'POST', headers: { 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify({ email, source: 'landing' }), redirect: 'error', credentials: 'omit',
      signal: signal ?? AbortSignal.timeout(15000),
    });
  } catch (error) {
    if (signal?.aborted) throw error;
    throw new Error('The signup service did not respond. Your email is still here. Try again.');
  }
  const result = await response.json().catch(() => null);
  if (!response.ok) {
    const message = typeof result?.error === 'string' ? result.error : result?.error?.message;
    throw new Error(typeof message === 'string' ? message : `Signup failed (HTTP ${response.status}). Try again.`);
  }
  if (!['registered', 'already_registered'].includes(result?.status)) throw new Error('The service did not confirm registration. Try again.');
  return { status: result.status, emailStatus: typeof result.emailStatus === 'string' ? result.emailStatus : null };
}

export function registrationMessage(result) {
  const registered = result.status === 'already_registered' ? 'Your address is already registered.' : 'Your address is registered.';
  if (result.emailStatus === 'accepted') return `${registered} Confirmation email accepted for delivery.`;
  if (['pending', 'unknown', 'failed'].includes(result.emailStatus)) return `${registered} Confirmation email is not confirmed. You can try again.`;
  return registered;
}
