const ENGINE_URL = 'http://127.0.0.1:8787';
const POLL_MS = 5000;
const page = window.location.pathname.startsWith('/research') ? 'research' : 'dashboard';
const byId = (id) => document.getElementById(id);
const clear = (element) => { while (element.firstChild) element.removeChild(element.firstChild); };
const setText = (id, value) => { const element = byId(id); if (element) element.textContent = value ?? '—'; };
const shorten = (value, head = 7, tail = 5) => {
  const text = String(value ?? '');
  if (tail === 0) return text.length > head ? `${text.slice(0, head)}…` : text || '—';
  return text.length > head + tail + 1 ? `${text.slice(0, head)}…${text.slice(-tail)}` : text || '—';
};
const formatTime = (value) => {
  if (!value) return '—';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? String(value) : date.toLocaleString(undefined, { hour12: false });
};
const formatBps = (value) => {
  const number = Number(value);
  return Number.isFinite(number) ? `${(number / 100).toFixed(2)}%` : '—';
};
const scaledDecimal = (value, scale) => {
  const raw = String(value ?? '');
  if (!/^\d+$/.test(raw)) return raw || '—';
  if (!scale) return raw;
  const padded = raw.padStart(scale + 1, '0');
  const whole = padded.slice(0, -scale);
  const fraction = padded.slice(-scale).replace(/0+$/, '');
  return fraction ? `${whole}.${fraction}` : whole;
};
const displayValue = (capture, policy) => {
  if (!capture.available || capture.value === null) return 'NO DATA';
  if (capture.field === 'price') return `$${scaledDecimal(capture.value, policy.price_scale)}`;
  if (capture.field === 'liquidity') return `$${scaledDecimal(capture.value, policy.quantity_scale)}`;
  return `$${capture.value}`;
};
const stateName = (value) => value === 'PUBLISHED' || value === 'BLOCKED' ? value : 'NO_DATA';
const stateClass = (value) => `state-${stateName(value).toLowerCase().replace('_', '-')}`;
const checkLabels = {
  'snapshot-integrity': 'Snapshot integrity',
  'snapshot-ready': 'Snapshot readiness',
  'asset-roster': 'Configured assets',
  'allocation-total': 'Target weights total',
  'target-weight': 'Target weight cap',
  'price-capture': 'Token price capture',
  'liquidity-capture': 'Liquidity capture',
  'reference-binding': 'Issuer reference binding',
  'reference-price': 'Underlying price mark',
  'token-price': 'Token price mark',
  'liquidity-floor': 'Liquidity floor',
  'dislocation-cap': 'Token dislocation cap',
};

function cell(row, value, className = '', title = '') {
  const td = document.createElement('td');
  td.textContent = value === null || value === undefined || value === '' ? '—' : String(value);
  if (className) td.className = className;
  if (title) td.title = title;
  row.appendChild(td);
  return td;
}

function emptyRow(target, count, message) {
  clear(target);
  const row = document.createElement('tr');
  const td = document.createElement('td');
  td.colSpan = count;
  td.className = 'local-empty';
  td.textContent = message;
  row.appendChild(td);
  target.appendChild(row);
}

function renderReasons(target, reasons, status) {
  clear(target);
  const rows = Array.isArray(reasons) && reasons.length
    ? reasons
    : [status === 'PUBLISHED' ? 'Council published an advisory proposal. Execution remains disabled.' : 'No council reason supplied.'];
  rows.forEach((reason) => {
    const item = document.createElement('li');
    item.textContent = String(reason);
    item.className = status === 'PUBLISHED' ? 'reason-good' : status === 'BLOCKED' ? 'reason-warn' : '';
    target.appendChild(item);
  });
}

function renderTicker(evidence) {
  const ticker = byId('ticker');
  clear(ticker);
  if (!evidence.length) {
    const item = document.createElement('div');
    item.className = 'terminal-ticker-item';
    const label = document.createElement('span');
    const value = document.createElement('strong');
    label.textContent = 'FEED';
    value.textContent = 'NO DATA';
    item.append(label, value);
    ticker.append(item);
    return;
  }
  evidence.forEach((row) => {
    const item = document.createElement('div');
    item.className = 'terminal-ticker-item';
    const symbol = document.createElement('span');
    symbol.textContent = row.underlying || shorten(row.asset_id);
    const price = document.createElement('strong');
    price.textContent = row.token_price ? `$${row.token_price}` : 'NO DATA';
    item.append(symbol, price);
    ticker.appendChild(item);
  });
}

function renderMarket(data, assetsById, capturesByKey) {
  const body = byId('market-rows');
  const evidence = Array.isArray(data.advice.evidence) ? data.advice.evidence : [];
  if (!evidence.length) {
    emptyRow(body, 6, 'No market values are available in this snapshot.');
    return;
  }
  clear(body);
  evidence.forEach((item) => {
    const row = document.createElement('tr');
    const policy = assetsById.get(item.asset_id) || {};
    const priceCapture = capturesByKey.get(`${item.asset_id}:price`);
    const liquidityCapture = capturesByKey.get(`${item.asset_id}:liquidity`);
    const premium = item.premium_bps === null || item.premium_bps === undefined ? null : Number(item.premium_bps);
    const premiumClass = premium === null ? '' : premium > 0 ? 'value-positive' : premium < 0 ? 'value-negative' : 'value-muted';
    cell(row, item.underlying || shorten(item.asset_id), '', item.asset_id || '');
    cell(row, item.token_price ? `$${item.token_price}` : 'NO DATA', item.token_price ? 'value-main' : 'capture-failed');
    cell(row, item.underlying_price ? `$${item.underlying_price}` : 'NO DATA', item.underlying_price ? '' : 'capture-failed');
    cell(row, premium === null || !Number.isFinite(premium) ? '—' : `${premium > 0 ? '+' : ''}${premium} bps`, premiumClass);
    cell(row, item.liquidity ? `$${item.liquidity}` : 'NO DATA', item.liquidity ? '' : 'capture-failed');
    cell(row, formatTime(priceCapture?.observed_at || liquidityCapture?.observed_at), 'value-muted', policy.asset_id || '');
    body.appendChild(row);
  });
}

function renderStrategy(target, policy) {
  const targetBody = byId(target === 'dashboard' ? 'strategy-rows' : 'research-strategy-rows');
  const policies = Array.isArray(policy.assets) ? policy.assets : [];
  if (!policies.length) {
    emptyRow(targetBody, 4, 'No strategy assets are configured.');
    return;
  }
  clear(targetBody);
  policies.forEach((asset) => {
    const row = document.createElement('tr');
    cell(row, asset.underlying, '', asset.asset_id);
    cell(row, formatBps(asset.target_weight_bps), 'value-main');
    cell(row, formatBps(asset.max_weight_bps));
    cell(row, `$${scaledDecimal(asset.min_liquidity_units, asset.quantity_scale)}`, '', `DexScreener USD liquidity floor at quantity scale ${asset.quantity_scale}`);
    targetBody.appendChild(row);
  });
}

function renderPolicy(policy, targetId) {
  const root = byId(targetId);
  clear(root);
  const assets = Array.isArray(policy.assets) ? policy.assets : [];
  const values = [
    ['Max dislocation', `${policy.max_dislocation_bps} bps`],
    ['Capture coherence', `${policy.coherence_cap_ms} ms`],
    ['Configured basket', `${assets.length} assets · target weights sum to ${assets.reduce((sum, asset) => sum + Number(asset.target_weight_bps || 0), 0)} bps`],
  ];
  values.forEach(([label, value]) => {
    const row = document.createElement('div');
    const dt = document.createElement('dt');
    const dd = document.createElement('dd');
    dt.textContent = label;
    dd.textContent = value;
    row.append(dt, dd);
    root.appendChild(row);
  });
}

function renderCaptures(data, assetsById, targetId, mode) {
  const body = byId(targetId);
  const captures = Array.isArray(data.captures) ? data.captures : [];
  if (!captures.length) {
    emptyRow(body, 6, 'No source captures were returned.');
    return;
  }
  clear(body);
  captures.forEach((capture) => {
    const policy = assetsById.get(capture.asset_id) || { price_scale: 0, quantity_scale: 0 };
    const row = document.createElement('tr');
    const label = `${assetsById.get(capture.asset_id)?.underlying || shorten(capture.asset_id)} / ${capture.field}`;
    cell(row, label, '', capture.asset_id);
    if (mode === 'research') {
      cell(row, capture.available ? 'AVAILABLE' : 'NO DATA', capture.available ? 'capture-ready' : 'capture-failed');
      cell(row, displayValue(capture, policy), capture.available ? '' : 'capture-failed', capture.value || '');
      cell(row, `${capture.source_id} / ${capture.source_version}`);
    } else {
      cell(row, displayValue(capture, policy), capture.available ? '' : 'capture-failed', capture.value || '');
      cell(row, capture.source_id);
      cell(row, capture.source_version);
    }
    cell(row, formatTime(capture.observed_at), 'value-muted');
    cell(row, shorten(capture.raw_excerpt_sha256, 12, 0), 'value-muted', capture.raw_excerpt_sha256 || '');
    body.appendChild(row);
  });
}

function checkValue(check, value) {
  if (value === null || value === undefined || value === '') return '—';
  if (check.unit === 'USD') return `$${value}`;
  if (check.unit === 'weight_bps') return formatBps(value);
  if (check.unit === 'bps') return `${value} bps`;
  if (check.unit === 'assets') return `${value} assets`;
  return String(value);
}

function renderChecks(data, assetsById, targetId) {
  const body = byId(targetId);
  const checks = Array.isArray(data.checks) ? data.checks : [];
  if (!checks.length) {
    emptyRow(body, 6, 'No live council checks were returned.');
    return;
  }
  clear(body);
  checks.forEach((check) => {
    const row = document.createElement('tr');
    const status = ['PASS', 'BLOCK', 'NO_DATA'].includes(check.status) ? check.status : 'NO_DATA';
    const result = cell(row, status, `check-result check-${status.toLowerCase()}`);
    result.setAttribute('aria-label', `Check result: ${status}`);
    cell(row, checkLabels[check.id] || check.id, '', check.id);
    cell(row, check.asset_id ? (assetsById.get(check.asset_id)?.underlying || shorten(check.asset_id)) : String(check.scope || '—').toUpperCase(), '', check.asset_id || '');
    cell(row, checkValue(check, check.observed));
    cell(row, checkValue(check, check.threshold));
    const detail = document.createElement('td');
    const evidence = document.createElement('code');
    const keys = Array.isArray(check.evidence_capture_keys) ? check.evidence_capture_keys : [];
    evidence.textContent = keys.map((key) => String(key).split('.').at(-1)).join(' · ') || '—';
    evidence.title = keys.join('\n');
    detail.appendChild(evidence);
    if (check.reason) {
      const reason = document.createElement('small');
      reason.className = 'check-reason';
      reason.textContent = String(check.reason);
      detail.appendChild(reason);
    }
    row.appendChild(detail);
    body.appendChild(row);
  });
}

function graphColumns(nodes) {
  const columns = [
    { kinds: ['source'], x: 82 },
    { kinds: ['issuer', 'venue'], x: 250 },
    { kinds: ['asset'], x: 420 },
    { kinds: ['evidence'], x: 600 },
    { kinds: ['intent'], x: 800 },
    { kinds: ['verdict'], x: 966 },
  ];
  const positions = new Map();
  columns.forEach(({ kinds, x }) => {
    const rows = nodes.filter((node) => kinds.includes(node.kind));
    rows.forEach((node, index) => {
      const y = 28 + ((index + 1) * 458) / (rows.length + 1);
      positions.set(node.id, { x, y });
    });
  });
  const unknown = nodes.filter((node) => !positions.has(node.id));
  unknown.forEach((node, index) => positions.set(node.id, { x: 600, y: 28 + ((index + 1) * 458) / (unknown.length + 1) }));
  return positions;
}

function graphColor(kind) {
  return ({ asset: '#91edb9', issuer: '#e1a8ff', source: '#80b8ff', venue: '#f1bf70', verdict: '#72e3ab', intent: '#ef8f86', evidence: '#d3ddd7' })[kind] || '#98a79f';
}

function renderGraph(graph) {
  const svg = byId('evidence-graph');
  clear(svg);
  const nodes = Array.isArray(graph?.nodes) ? graph.nodes : [];
  const edges = Array.isArray(graph?.edges) ? graph.edges : [];
  const positions = graphColumns(nodes);
  const ns = 'http://www.w3.org/2000/svg';
  edges.forEach((edge) => {
    const from = positions.get(edge.from);
    const to = positions.get(edge.to);
    if (!from || !to) return;
    const line = document.createElementNS(ns, 'line');
    line.setAttribute('x1', from.x);
    line.setAttribute('y1', from.y);
    line.setAttribute('x2', to.x);
    line.setAttribute('y2', to.y);
    line.setAttribute('class', `graph-edge${edge.kind.includes('verdict') ? ' edge-verdict' : ''}`);
    svg.appendChild(line);
  });
  nodes.forEach((node) => {
    const position = positions.get(node.id);
    if (!position) return;
    const group = document.createElementNS(ns, 'g');
    group.setAttribute('class', 'graph-node');
    group.setAttribute('transform', `translate(${position.x} ${position.y})`);
    group.setAttribute('tabindex', '0');
    group.setAttribute('role', 'button');
    group.setAttribute('aria-label', `${node.kind}: ${node.label}`);
    const circle = document.createElementNS(ns, 'circle');
    circle.setAttribute('r', node.kind === 'asset' || node.kind === 'verdict' ? '7' : '5');
    circle.setAttribute('fill', graphColor(node.kind));
    const title = document.createElementNS(ns, 'title');
    title.textContent = `${node.kind} · ${node.label}`;
    const label = document.createElementNS(ns, 'text');
    label.setAttribute('class', 'graph-label');
    label.setAttribute('y', '16');
    label.textContent = node.label.length > 19 ? `${node.label.slice(0, 18)}…` : node.label;
    const kind = document.createElementNS(ns, 'text');
    kind.setAttribute('class', 'graph-kind');
    kind.setAttribute('y', '27');
    kind.textContent = node.kind.toUpperCase();
    group.append(title, circle, label, kind);
    group.addEventListener('click', () => setText('graph-meta', `${node.kind.toUpperCase()} · ${node.label} · ${node.id}`));
    group.addEventListener('focus', () => setText('graph-meta', `${node.kind.toUpperCase()} · ${node.label} · ${node.id}`));
    svg.appendChild(group);
  });
  setText('graph-meta', nodes.length ? `${nodes.length} NODES · ${edges.length} EDGES · SELECT A NODE` : 'NO GRAPH DATA');
}

function render(data) {
  if (!data?.advice || !data?.policy || !Array.isArray(data.captures)) throw new Error('Invalid dashboard response');
  const advice = data.advice;
  const status = stateName(advice.status);
  const assets = Array.isArray(data.policy.assets) ? data.policy.assets : [];
  const assetsById = new Map(assets.map((asset) => [asset.asset_id, asset]));
  const capturesByKey = new Map(data.captures.map((capture) => [`${capture.asset_id}:${capture.field}`, capture]));
  const readyCaptures = data.captures.filter((capture) => capture.available).length;
  const updated = formatTime(advice.created_at);

  renderTicker(Array.isArray(advice.evidence) ? advice.evidence : []);
  setText('council-status', status);
  byId('council-status').className = `local-state ${stateClass(status)}`;
  setText('snapshot-meta', `Snapshot ${updated}`);
  setText('asset-count', String(assets.length));
  setText('capture-count', `${readyCaptures}/${data.captures.length}`);
  setText('capture-health', `${data.captures.length - readyCaptures} unavailable`);
  setText('evaluation-latency', `${advice.latency_ms ?? '—'} ms`);
  setText('market-updated', `Snapshot · ${updated}`);
  setText('analysis-tag', status);
  setText('analysis-summary', status === 'PUBLISHED'
    ? 'Current evidence passed the council. The proposal remains advisory and cannot execute.'
    : status === 'BLOCKED'
      ? 'The reviewer blocked this proposal under the configured policy.'
      : 'Required evidence or snapshot checks are unavailable. No proposal was published.');
  renderReasons(byId('analysis-reasons'), advice.reasons, status);
  setText('snapshot-hash', advice.snapshot_sha256 || '—');
  setText('proposal-state', data.proposal ? `${data.proposal.proposal_id} · advisory only` : 'No proposal published');
  setText('council-check', status === 'PUBLISHED' ? 'PUBLISHED · advisory only' : `${status} · see council reasons`);
  renderMarket(data, assetsById, capturesByKey);
  renderPolicy(data.policy, 'policy-values');
  renderPolicy(data.policy, 'research-policy');
  renderStrategy('dashboard', data.policy);
  renderStrategy('research', data.policy);
  renderChecks(data, assetsById, 'dashboard-check-rows');
  renderChecks(data, assetsById, 'research-check-rows');
  renderCaptures(data, assetsById, 'capture-rows', 'dashboard');
  renderCaptures(data, assetsById, 'research-capture-rows', 'research');
  renderGraph(data.graph || {});

  setText('research-status', status);
  byId('research-status').className = `local-state ${stateClass(status)}`;
  setText('research-time', updated);
  setText('research-tag', status);
  setText('research-hash', `Snapshot · ${shorten(advice.snapshot_sha256 || '', 12, 0)}`);
  setText('research-thesis', status === 'PUBLISHED'
    ? 'The current source record supports an advisory basket under the configured council policy.'
    : status === 'BLOCKED'
      ? 'The current source record does not support an advisory basket under the configured council policy.'
      : 'The current source record is incomplete. The engine did not publish a proposal.');
  renderReasons(byId('research-reasons'), advice.reasons, status);

  byId('connection-alert').hidden = true;
  setText('engine-chip', 'ENGINE · LIVE CACHE');
  setText('rail-state', 'Live cache');
  byId('rail-dot').style.color = 'var(--green)';
  byId('research-view').hidden = page !== 'research';
  byId('dashboard-view').hidden = page === 'research';
  setText('page-path', page === 'research' ? 'Research / Evidence' : 'Dashboard / Markets');
  document.title = page === 'research' ? 'FalconOS · Local Research' : 'FalconOS · Local Market Terminal';
  document.querySelectorAll('[data-route]').forEach((link) => {
    const current = link.dataset.route === page;
    if (current) link.setAttribute('aria-current', 'page');
    else link.removeAttribute('aria-current');
  });
}

let hasLoaded = false;
async function refresh() {
  try {
    const response = await fetch(`${ENGINE_URL}/dashboard`, { cache: 'no-store' });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const payload = await response.json();
    render(payload);
    hasLoaded = true;
  } catch {
    byId('connection-alert').hidden = false;
    setText('engine-chip', hasLoaded ? 'ENGINE · STALE' : 'ENGINE · OFFLINE');
    setText('rail-state', hasLoaded ? 'Stale cache' : 'Offline');
    byId('rail-dot').style.color = 'var(--amber)';
    if (!hasLoaded) {
      setText('council-status', 'NO DATA');
      byId('council-status').className = 'local-state state-offline';
    }
    setText('page-path', page === 'research' ? 'Research / Evidence' : 'Dashboard / Markets');
    byId('research-view').hidden = page !== 'research';
    byId('dashboard-view').hidden = page === 'research';
  }
}

setText('refresh-chip', `POLL · ${POLL_MS / 1000}S`);
byId('research-view').hidden = page !== 'research';
byId('dashboard-view').hidden = page === 'research';
setText('page-path', page === 'research' ? 'Research / Evidence' : 'Dashboard / Markets');
document.querySelectorAll('[data-route]').forEach((link) => {
  const current = link.dataset.route === page;
  if (current) link.setAttribute('aria-current', 'page');
  else link.removeAttribute('aria-current');
});
refresh();
window.setInterval(refresh, POLL_MS);
