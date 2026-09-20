// Regenerate the committed market snapshot for /dash when COINGECKO_API_KEY is set
// in the build environment. Without a key, skip immediately and keep the last
// committed snapshot. On any network/validation failure, exit 0 so the build
// never fails. The write is atomic (temp + rename).
import { writeFile, rename } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const API = 'https://api.coingecko.com/api/v3';
const META = {
  'usd-coin': { symbol: 'USDC', name: 'USD Coin' },
  solana: { symbol: 'SOL', name: 'Solana' },
  'jupiter-exchange-solana': { symbol: 'JUP', name: 'Jupiter' },
};
const ids = Object.keys(META);
const out = fileURLToPath(new URL('./public/dash-snapshot.json', import.meta.url));
const tmp = `${out}.tmp`;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const fin = (value) => typeof value === 'number' && Number.isFinite(value);

// Optional supported auth: set COINGECKO_API_KEY in the build environment and
// the refresher sends it as x-cg-demo-api-key. The key never reaches the page.
const KEY = process.env.COINGECKO_API_KEY || '';

async function fetchJson(url) {
  const headers = { accept: 'application/json' };
  if (KEY) headers['x-cg-demo-api-key'] = KEY;
  const response = await fetch(url, { headers });
  if (!response.ok) throw new Error(`${url} -> ${response.status}`);
  return response.json();
}

// Each row is [timestampMs, open, high, low, close]; must be finite and ordered.
export function validOhlc(rows) {
  if (!Array.isArray(rows) || rows.length < 2) return false;
  let previousTimestamp = -Infinity;
  for (const row of rows) {
    if (!Array.isArray(row) || row.length !== 5) return false;
    const [timestamp, open, high, low, close] = row;
    if (![timestamp, open, high, low, close].every(fin)) return false;
    if (timestamp <= 0 || timestamp <= previousTimestamp || open <= 0 || high <= 0 || low <= 0 || close <= 0) return false;
    if (!(high >= low && high >= open && high >= close && low <= open && low <= close)) return false;
    previousTimestamp = timestamp;
  }
  return true;
}

export function validPrice(price, nowSec) {
  if (!price) return false;
  if (!fin(price.usd) || price.usd <= 0) return false;
  if (!fin(price.usd_24h_vol) || price.usd_24h_vol < 0) return false;
  if (!fin(price.usd_24h_change)) return false;
  if (!fin(price.last_updated_at)) return false;
  // Reject stale (> 7 days) or future (> 5 min ahead) provider timestamps.
  if (price.last_updated_at > nowSec + 300) return false;
  if (price.last_updated_at < nowSec - 7 * 86400) return false;
  return true;
}

// Pages consume this normalized shape; no raw-provider validation belongs there.
export function normalizeOhlc(rows) {
  if (!validOhlc(rows)) throw new Error('invalid ohlc');
  return rows.map(([, open, high, low, close]) => ({ o: open, h: high, l: low, c: close }));
}

// Keep the dashboard's existing formulas in the build-side artifact.
export function deriveMetrics(ohlc, volume, totalVolume) {
  const returns = [];
  for (let i = 1; i < ohlc.length; i += 1) returns.push(Math.log(ohlc[i].c / ohlc[i - 1].c));
  const mean = returns.length ? returns.reduce((sum, value) => sum + value, 0) / returns.length : 0;
  const variance = returns.length ? returns.reduce((sum, value) => sum + (value - mean) ** 2, 0) / returns.length : 0;
  const metrics = {
    volatility: Math.sqrt(variance * returns.length) * 100,
    rangeHigh: Math.max(...ohlc.map((candle) => candle.h)),
    rangeLow: Math.min(...ohlc.map((candle) => candle.l)),
    volumeShare: volume / (totalVolume || 1) * 100,
  };
  if (!Object.values(metrics).every(fin)) throw new Error('invalid derived metrics');
  return metrics;
}

export function normalizeSnapshot(raw, nowSec = Math.floor(Date.now() / 1000)) {
  if (!raw || typeof raw !== 'object' || !raw.instruments) throw new Error('bad snapshot');
  const rawInstruments = {};
  let totalVolume = 0;
  let observedAt = 0;
  for (const id of ids) {
    const source = raw.instruments[id];
    if (!source || !validPrice({
      usd: source.price,
      usd_24h_vol: source.vol24h,
      usd_24h_change: source.change24h,
      last_updated_at: source.updatedAt,
    }, nowSec)) throw new Error(`invalid price for ${id}`);
    if (!validOhlc(source.ohlc)) throw new Error(`invalid ohlc for ${id}`);
    totalVolume += source.vol24h;
    observedAt = Math.max(observedAt, source.updatedAt);
    rawInstruments[id] = { source, ohlc: normalizeOhlc(source.ohlc) };
  }
  const instruments = {};
  for (const id of ids) {
    const { source, ohlc } = rawInstruments[id];
    instruments[id] = {
      symbol: META[id].symbol,
      name: META[id].name,
      price: source.price,
      change24h: source.change24h,
      vol24h: source.vol24h,
      updatedAt: source.updatedAt,
      ohlc,
      metrics: deriveMetrics(ohlc, source.vol24h, totalVolume),
    };
  }
  return {
    source: 'CoinGecko',
    endpoint: 'api.coingecko.com/api/v3',
    observedAt,
    fetchedAt: new Date().toISOString(),
    instruments,
  };
}

async function refresh() {
  if (!KEY) {
    console.log('dash snapshot refresh skipped (no COINGECKO_API_KEY)');
    return;
  }
  try {
    const nowSec = Math.floor(Date.now() / 1000);
    const price = await fetchJson(
      `${API}/simple/price?ids=${ids.join(',')}&vs_currencies=usd&include_24hr_vol=true&include_24hr_change=true&include_last_updated_at=true`,
    );
    const instruments = {};
    let observedAt = 0;
    for (const id of ids) {
      const source = price[id];
      if (!validPrice(source, nowSec)) throw new Error(`invalid price for ${id}`);
      const ohlc = await fetchJson(`${API}/coins/${id}/ohlc?vs_currency=usd&days=1`);
      if (!validOhlc(ohlc)) throw new Error(`invalid ohlc for ${id}`);
      observedAt = Math.max(observedAt, source.last_updated_at);
      instruments[id] = {
        price: source.usd,
        change24h: source.usd_24h_change,
        vol24h: source.usd_24h_vol,
        updatedAt: source.last_updated_at,
        ohlc,
      };
      await sleep(1400);
    }
    const snapshot = normalizeSnapshot({ observedAt, instruments });
    await writeFile(tmp, JSON.stringify(snapshot));
    await rename(tmp, out);
    console.log('dash snapshot refreshed:', new Date(snapshot.observedAt * 1000).toISOString());
  } catch (error) {
    console.warn('dash snapshot refresh skipped (kept existing):', error.message);
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) await refresh();
