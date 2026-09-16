// Regenerate the committed market snapshot for /dash when COINGECKO_API_KEY is set
// in the build environment. Without a key, skip immediately and keep the last
// committed snapshot. On any network/validation failure, exit 0 so the build
// never fails. The write is atomic (temp + rename).
import { writeFile, rename } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const API = 'https://api.coingecko.com/api/v3';
const META = {
  'usd-coin': { symbol: 'USDC', name: 'USD Coin' },
  'solana': { symbol: 'SOL', name: 'Solana' },
  'jupiter-exchange-solana': { symbol: 'JUP', name: 'Jupiter' },
};
const ids = Object.keys(META);
const out = fileURLToPath(new URL('./public/dash-snapshot.json', import.meta.url));
const tmp = `${out}.tmp`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const fin = (v) => typeof v === 'number' && Number.isFinite(v);

// Optional supported auth: set COINGECKO_API_KEY in the build environment and
// the refresher sends it as x-cg-demo-api-key. The key never reaches the page.
const KEY = process.env.COINGECKO_API_KEY || '';

async function j(url) {
  const headers = { accept: 'application/json' };
  if (KEY) headers['x-cg-demo-api-key'] = KEY;
  const r = await fetch(url, { headers });
  if (!r.ok) throw new Error(`${url} -> ${r.status}`);
  return r.json();
}

// Each row is [timestampMs, open, high, low, close]; must be finite and ordered.
function validOhlc(rows) {
  if (!Array.isArray(rows) || rows.length < 2) return false;
  let prevT = -Infinity;
  for (const row of rows) {
    if (!Array.isArray(row) || row.length !== 5) return false;
    const [t, o, h, l, c] = row;
    if (![t, o, h, l, c].every(fin)) return false;
    if (t <= 0 || t <= prevT) return false;
    if (!(h >= l && h >= o && h >= c && l <= o && l <= c)) return false;
    prevT = t;
  }
  return true;
}

function validPrice(p, nowSec) {
  if (!p) return false;
  if (!fin(p.usd) || p.usd <= 0) return false;
  if (!fin(p.usd_24h_vol) || p.usd_24h_vol < 0) return false;
  if (!fin(p.usd_24h_change)) return false;
  if (!fin(p.last_updated_at)) return false;
  // Reject stale (> 7 days) or future (> 5 min ahead) provider timestamps.
  if (p.last_updated_at > nowSec + 300) return false;
  if (p.last_updated_at < nowSec - 7 * 86400) return false;
  return true;
}

if (!KEY) {
  console.log('dash snapshot refresh skipped (no COINGECKO_API_KEY)');
  process.exit(0);
}

try {
  const nowSec = Math.floor(Date.now() / 1000);
  const price = await j(
    `${API}/simple/price?ids=${ids.join(',')}&vs_currencies=usd&include_24hr_vol=true&include_24hr_change=true&include_last_updated_at=true`,
  );
  const instruments = {};
  let observedAt = 0;
  for (const id of ids) {
    const p = price[id];
    if (!validPrice(p, nowSec)) throw new Error(`invalid price for ${id}`);
    const ohlc = await j(`${API}/coins/${id}/ohlc?vs_currency=usd&days=1`);
    if (!validOhlc(ohlc)) throw new Error(`invalid ohlc for ${id}`);
    observedAt = Math.max(observedAt, p.last_updated_at);
    instruments[id] = {
      symbol: META[id].symbol,
      name: META[id].name,
      price: p.usd,
      change24h: p.usd_24h_change,
      vol24h: p.usd_24h_vol,
      updatedAt: p.last_updated_at,
      ohlc,
    };
    await sleep(1400);
  }
  if (!(observedAt > 0)) throw new Error('no observedAt');
  const snapshot = {
    source: 'CoinGecko',
    endpoint: 'api.coingecko.com/api/v3',
    observedAt,
    fetchedAt: new Date().toISOString(),
    instruments,
  };
  await writeFile(tmp, JSON.stringify(snapshot));
  await rename(tmp, out);
  console.log('dash snapshot refreshed:', new Date(observedAt * 1000).toISOString());
} catch (e) {
  console.warn('dash snapshot refresh skipped (kept existing):', e.message);
  process.exit(0);
}
