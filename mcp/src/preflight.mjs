import { createHash } from 'node:crypto';
import bs58 from 'bs58';

const GENESIS = 'EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG';
const RPC_HOST = 'api.devnet.solana.com';
const HEX_256 = /^[a-f0-9]{64}$/;
const UNSIGNED = /^(0|[1-9][0-9]*)$/;
const MAX_U64 = 18_446_744_073_709_551_615n;
const SIGNED = /^(0|-?[1-9][0-9]*)$/;
const NETWORK_KEYS = ['chain', 'network', 'genesisHash', 'rpcHost', 'snapshotSlot'];
const SIMULATION_KEYS = ['slot', 'err', 'unitsConsumed', 'liquidityDeltaBaseUnits', 'receiptDeltaBaseUnits', 'vaultLiquidityDeltaBaseUnits'];
const COST_KEYS = ['feeLamports', 'feeQuoteSlot', 'rentLamports', 'totalSolLamports', 'walletSolBalanceLamports', 'destinationAta', 'createsDestinationAta', 'accountSize'];
const VALIDITY_KEYS = ['blockhash', 'lastValidBlockHeight', 'observedBlockHeight', 'oraclePublishTime', 'oracleExpiresAt', 'intentExpiresAt', 'decisionExpiresAt', 'expiresAt'];
const ROOT_KEYS = ['schemaVersion', 'status', 'verification', 'messageSha256', 'checkedAt', 'network', 'simulation', 'costs', 'validity'];
const hasExactKeys = (value, keys) => value && typeof value === 'object' && !Array.isArray(value)
  && Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));
const safeInteger = value => Number.isSafeInteger(value) && value >= 0;
const decimal = (value, pattern = UNSIGNED) => typeof value === 'string' && value.length <= 40 && pattern.test(value);
function timestamp(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)) return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) && new Date(parsed).toISOString() === value ? parsed : null;
}
function address(value) {
  if (typeof value !== 'string') return false;
  try { return bs58.decode(value).length === 32 && bs58.encode(bs58.decode(value)) === value; } catch { return false; }
}
function messageFromTransaction(value) {
  if (typeof value !== 'string' || value.length === 0 || value.length > 1644 || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value)) return null;
  const bytes = Buffer.from(value, 'base64');
  // The fixed lending builder requires exactly one writable wallet signer.
  if (bytes.toString('base64') !== value || bytes.length > 1232 || bytes.length < 134 || bytes[0] !== 1 || bytes.subarray(1, 65).some(byte => byte !== 0)) return null;
  const message = bytes.subarray(65);
  const header = message[0] & 0x80 ? 1 : 0;
  if (header && message[0] !== 0x80) return null;
  if (message[header] !== 1 || message[header + 1] !== 0) return null;
  const keys = message[header + 3];
  if (!keys || keys & 0x80 || message[header + 2] >= keys) return null;
  const keyOffset = header + 4;
  const blockhashOffset = keyOffset + keys * 32;
  if (message.length < blockhashOffset + 33) return null;
  return { message, wallet: bs58.encode(message.subarray(keyOffset, keyOffset + 32)), blockhash: bs58.encode(message.subarray(blockhashOffset, blockhashOffset + 32)) };
}

export function projectVerifiedPreflight(intent, { now = Date.now(), createdAt, action, wallet, amountBaseUnits, decisionId, storedDecisionId } = {}) {
  const p = intent?.preflight;
  if (!hasExactKeys(p, ROOT_KEYS) || p.schemaVersion !== 1 || p.status !== 'VERIFIED' || p.verification !== 'falcon-rpc' || !HEX_256.test(p.messageSha256)) return null;
  if (!hasExactKeys(p.network, NETWORK_KEYS) || p.network.chain !== 'solana' || p.network.network !== 'devnet' || p.network.genesisHash !== GENESIS || p.network.rpcHost !== RPC_HOST || !safeInteger(p.network.snapshotSlot)) return null;
  if (!hasExactKeys(p.simulation, SIMULATION_KEYS) || p.simulation.err !== null || !safeInteger(p.simulation.slot) || p.simulation.slot < p.network.snapshotSlot || !(p.simulation.unitsConsumed === null || safeInteger(p.simulation.unitsConsumed))) return null;
  if (![p.simulation.liquidityDeltaBaseUnits, p.simulation.receiptDeltaBaseUnits, p.simulation.vaultLiquidityDeltaBaseUnits].every(value => decimal(value, SIGNED) && BigInt(value) <= MAX_U64 && BigInt(value) >= -MAX_U64)) return null;
  if (!hasExactKeys(p.costs, COST_KEYS) || !safeInteger(p.costs.feeQuoteSlot) || !['feeLamports', 'rentLamports', 'totalSolLamports', 'walletSolBalanceLamports'].every(key => decimal(p.costs[key])) || !address(p.costs.destinationAta) || typeof p.costs.createsDestinationAta !== 'boolean' || p.costs.accountSize !== 165) return null;
  const fee = BigInt(p.costs.feeLamports), rent = BigInt(p.costs.rentLamports), total = BigInt(p.costs.totalSolLamports), balance = BigInt(p.costs.walletSolBalanceLamports);
  if ([fee, rent, total, balance].some(value => value > MAX_U64) || fee + rent > MAX_U64 || fee + rent !== total || balance < total || (!p.costs.createsDestinationAta && rent !== 0n) || (p.costs.createsDestinationAta && rent === 0n)) return null;
  if (!hasExactKeys(p.validity, VALIDITY_KEYS) || !address(p.validity.blockhash) || !safeInteger(p.validity.lastValidBlockHeight) || !safeInteger(p.validity.observedBlockHeight) || p.validity.observedBlockHeight > p.validity.lastValidBlockHeight) return null;
  const checkedAt = timestamp(p.checkedAt), published = timestamp(p.validity.oraclePublishTime), oracleExpiry = timestamp(p.validity.oracleExpiresAt), intentExpiry = timestamp(p.validity.intentExpiresAt), decisionExpiry = p.validity.decisionExpiresAt === null ? null : timestamp(p.validity.decisionExpiresAt), expiry = timestamp(p.validity.expiresAt);
  if ([checkedAt, published, oracleExpiry, intentExpiry, expiry].some(value => value === null) || (p.validity.decisionExpiresAt !== null && decisionExpiry === null)) return null;
  const earliest = Math.min(oracleExpiry, intentExpiry, ...(decisionExpiry === null ? [] : [decisionExpiry]));
  if (p.network.snapshotSlot > p.simulation.slot || p.costs.feeQuoteSlot < p.network.snapshotSlot) return null;
  const committedAt = timestamp(createdAt);
  if (committedAt === null || committedAt > now + 5_000 || checkedAt > committedAt + 5_000 || intentExpiry <= committedAt || intentExpiry > committedAt + 120_000 || published > checkedAt || oracleExpiry <= checkedAt || oracleExpiry - published > 180_000 || expiry !== earliest || expiry <= now || checkedAt > now + 5_000 || now - checkedAt > 120_000) return null;
  const wire = messageFromTransaction(intent.transactionBase64);
  if (!wire || createHash('sha256').update(wire.message).digest('hex') !== p.messageSha256 || wire.wallet !== wallet || wire.blockhash !== p.validity.blockhash) return null;
  if (intent.messageSha256 !== p.messageSha256 || !decimal(amountBaseUnits) || BigInt(amountBaseUnits) === 0n || !['supply', 'redeem'].includes(action) || intent.action !== action || intent.wallet !== wallet || intent.inputBaseUnits !== amountBaseUnits || (decisionId ?? null) !== (storedDecisionId ?? null)) return null;
  const liquidity = BigInt(p.simulation.liquidityDeltaBaseUnits), receipt = BigInt(p.simulation.receiptDeltaBaseUnits), vault = BigInt(p.simulation.vaultLiquidityDeltaBaseUnits), amount = BigInt(amountBaseUnits);
  if (vault !== -liquidity || (action === 'supply' ? liquidity >= 0n || -liquidity > amount || receipt <= 0n || decisionExpiry === null : liquidity <= 0n || receipt !== -amount || decisionExpiry !== null)) return null;
  return {
    schemaVersion: 1, status: p.status, verification: p.verification, messageSha256: p.messageSha256, checkedAt: p.checkedAt,
    network: { chain: p.network.chain, network: p.network.network, genesisHash: p.network.genesisHash, rpcHost: p.network.rpcHost, snapshotSlot: p.network.snapshotSlot },
    simulation: { slot: p.simulation.slot, err: null, unitsConsumed: p.simulation.unitsConsumed, liquidityDeltaBaseUnits: p.simulation.liquidityDeltaBaseUnits, receiptDeltaBaseUnits: p.simulation.receiptDeltaBaseUnits, vaultLiquidityDeltaBaseUnits: p.simulation.vaultLiquidityDeltaBaseUnits },
    costs: { feeLamports: p.costs.feeLamports, feeQuoteSlot: p.costs.feeQuoteSlot, rentLamports: p.costs.rentLamports, totalSolLamports: p.costs.totalSolLamports, walletSolBalanceLamports: p.costs.walletSolBalanceLamports, destinationAta: p.costs.destinationAta, createsDestinationAta: p.costs.createsDestinationAta, accountSize: 165 },
    validity: { blockhash: p.validity.blockhash, lastValidBlockHeight: p.validity.lastValidBlockHeight, observedBlockHeight: p.validity.observedBlockHeight, oraclePublishTime: p.validity.oraclePublishTime, oracleExpiresAt: p.validity.oracleExpiresAt, intentExpiresAt: p.validity.intentExpiresAt, decisionExpiresAt: p.validity.decisionExpiresAt, expiresAt: p.validity.expiresAt },
  };
}
