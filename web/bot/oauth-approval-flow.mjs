const REQUEST_HANDLE = /^far1_[A-Za-z0-9_-]{43}$/;

export function takeOAuthApprovalRequest(location, history) {
  if (location.pathname.replace(/\/+$/, '') !== '/oauth/approve') return null;
  const values = new URLSearchParams(location.hash.slice(1)).getAll('request');
  history.replaceState(null, '', location.pathname + location.search);
  return values.length === 1 && REQUEST_HANDLE.test(values[0]) ? values[0] : null;
}
