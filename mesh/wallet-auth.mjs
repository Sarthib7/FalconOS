import { createHash, createPublicKey, randomBytes, randomUUID, verify } from 'node:crypto';
import { PublicKey } from '@solana/web3.js';
import { MeshError } from './domain.mjs';

const CHALLENGE_TTL_MS = 5 * 60_000;
const SESSION_TTL_MS = 30 * 60_000;
const SESSION_TOKEN = /^wsi1_[A-Za-z0-9_-]{43}$/;
const ED25519_SPKI_PREFIX = Buffer.from('302a300506032b6570032100', 'hex');
const CHALLENGE_COLUMNS = ['challenge_id', 'wallet_address', 'origin', 'message', 'created_at', 'expires_at'];
const SESSION_COLUMNS = ['token_hash', 'wallet_address', 'owner_id', 'created_at', 'expires_at', 'revoked_at'];

function unauthorized() {
  return new MeshError('UNAUTHORIZED', 'Wallet authentication is invalid or expired.');
}

function storageFailure() {
  return new MeshError('STORAGE_UNAVAILABLE', 'Wallet authentication storage is unavailable.');
}

function requireOrigin(origin, allowedOrigins) {
  if (typeof origin !== 'string' || !allowedOrigins.has(origin)) {
    throw new MeshError('ORIGIN_DENIED', 'This browser origin is not allowed.');
  }
  try {
    const parsed = new URL(origin);
    if (!['http:', 'https:'].includes(parsed.protocol) || parsed.origin !== origin) throw new Error('invalid origin');
    return origin;
  } catch {
    throw new MeshError('ORIGIN_DENIED', 'This browser origin is not allowed.');
  }
}

export function canonicalWalletAddress(address) {
  if (typeof address !== 'string' || address.length > 44) {
    throw new MeshError('INVALID_INPUT', 'Wallet address must be a canonical Solana public key.');
  }
  try {
    const key = new PublicKey(address);
    if (key.toBase58() !== address || key.toBytes().length !== 32) throw new Error('not canonical');
    return key.toBase58();
  } catch {
    throw new MeshError('INVALID_INPUT', 'Wallet address must be a canonical Solana public key.');
  }
}

export function deriveWalletOwnerId(address) {
  const canonical = canonicalWalletAddress(address);
  const suffix = createHash('sha256').update(canonical, 'utf8').digest('hex').slice(0, 56);
  return `wallet_${suffix}`;
}

function signInMessage(address, origin, challengeId, issuedAt, expiresAt) {
  const domain = new URL(origin).host;
  const nonce = challengeId.replaceAll('-', '');
  return [
    `${domain} wants you to sign in with your Solana account:`,
    address,
    '',
    'This request is for authentication only. It will not trigger a blockchain transaction or spend any fees.',
    '',
    `URI: ${origin}`,
    'Version: 1',
    `Nonce: ${nonce}`,
    `Issued At: ${issuedAt}`,
    `Expiration Time: ${expiresAt}`,
  ].join('\n');
}

function verifySignature(address, message, encodedSignature) {
  if (typeof encodedSignature !== 'string' || encodedSignature.length > 128) return false;
  const signature = Buffer.from(encodedSignature, 'base64');
  if (signature.length !== 64 || signature.toString('base64') !== encodedSignature) return false;
  try {
    const rawKey = new PublicKey(address).toBytes();
    const publicKey = createPublicKey({
      key: Buffer.concat([ED25519_SPKI_PREFIX, rawKey]),
      format: 'der',
      type: 'spki',
    });
    return verify(null, Buffer.from(message, 'utf8'), publicKey, signature);
  } catch {
    return false;
  }
}

export function createWalletAuth(pool, { allowedOrigins = new Set(), clock = () => Date.now(), tokenBytes = randomBytes } = {}) {
  if (!pool || typeof pool.query !== 'function' || typeof pool.connect !== 'function') {
    throw new TypeError('A PostgreSQL pool is required.');
  }
  if (!(allowedOrigins instanceof Set)) throw new TypeError('Allowed wallet origins must be a Set.');

  return {
    async ready() {
      try {
        const result = await pool.query(
          `SELECT table_name, column_name
           FROM information_schema.columns
           WHERE table_schema = 'falcon_mesh'
             AND table_name = ANY($1::text[])`,
          [['wallet_auth_challenges', 'wallet_auth_sessions']],
        );
        const columns = new Set(result.rows.map(row => `${row.table_name}.${row.column_name}`));
        if (CHALLENGE_COLUMNS.some(column => !columns.has(`wallet_auth_challenges.${column}`))
          || SESSION_COLUMNS.some(column => !columns.has(`wallet_auth_sessions.${column}`))) throw storageFailure();
      } catch (error) {
        if (error instanceof MeshError) throw error;
        throw storageFailure();
      }
    },

    async createChallenge(address, origin) {
      const walletAddress = canonicalWalletAddress(address);
      const safeOrigin = requireOrigin(origin, allowedOrigins);
      const now = clock();
      const createdAt = new Date(now).toISOString();
      const expiresAt = new Date(now + CHALLENGE_TTL_MS).toISOString();
      const challengeId = randomUUID();
      const message = signInMessage(walletAddress, safeOrigin, challengeId, createdAt, expiresAt);
      try {
        await pool.query('DELETE FROM falcon_mesh.wallet_auth_challenges WHERE expires_at <= $1', [createdAt]);
        await pool.query('DELETE FROM falcon_mesh.wallet_auth_sessions WHERE expires_at <= $1 OR revoked_at IS NOT NULL', [createdAt]);
        await pool.query(
          `INSERT INTO falcon_mesh.wallet_auth_challenges
             (challenge_id, wallet_address, origin, message, created_at, expires_at)
           VALUES ($1, $2, $3, $4, $5, $6)`,
          [challengeId, walletAddress, safeOrigin, message, createdAt, expiresAt],
        );
      } catch {
        throw storageFailure();
      }
      return { challengeId, message, expiresAt };
    },

    async verifyChallenge(challengeId, encodedSignature, origin) {
      const safeOrigin = requireOrigin(origin, allowedOrigins);
      if (typeof challengeId !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(challengeId)) {
        throw unauthorized();
      }
      let client;
      try {
        client = await pool.connect();
        await client.query('BEGIN');
        const result = await client.query(
          `SELECT challenge_id, wallet_address, origin, message, expires_at
           FROM falcon_mesh.wallet_auth_challenges
           WHERE challenge_id = $1
           FOR UPDATE`,
          [challengeId],
        );
        const challenge = result.rows[0];
        const now = clock();
        if (!challenge || Date.parse(challenge.expires_at) <= now
          || challenge.origin !== safeOrigin
          || !verifySignature(challenge.wallet_address, challenge.message, encodedSignature)) {
          await client.query('ROLLBACK');
          throw unauthorized();
        }
        const sessionToken = `wsi1_${tokenBytes(32).toString('base64url')}`;
        if (!SESSION_TOKEN.test(sessionToken)) throw new Error('Invalid session token entropy.');
        const createdAt = new Date(now).toISOString();
        const expiresAt = new Date(now + SESSION_TTL_MS).toISOString();
        const ownerId = deriveWalletOwnerId(challenge.wallet_address);
        const deleted = await client.query(
          `DELETE FROM falcon_mesh.wallet_auth_challenges
           WHERE challenge_id = $1 AND expires_at > $2
           RETURNING challenge_id`,
          [challengeId, createdAt],
        );
        if (deleted.rowCount !== 1) {
          await client.query('ROLLBACK');
          throw unauthorized();
        }
        await client.query(
          `INSERT INTO falcon_mesh.wallet_auth_sessions
             (token_hash, wallet_address, owner_id, created_at, expires_at)
           VALUES ($1, $2, $3, $4, $5)`,
          [createHash('sha256').update(sessionToken).digest('hex'), challenge.wallet_address, ownerId, createdAt, expiresAt],
        );
        await client.query('COMMIT');
        return { sessionToken, walletAddress: challenge.wallet_address, ownerId, expiresAt };
      } catch (error) {
        try { await client?.query('ROLLBACK'); } catch {}
        if (error instanceof MeshError) throw error;
        throw storageFailure();
      } finally {
        client?.release();
      }
    },

    async getSession(sessionToken) {
      if (typeof sessionToken !== 'string' || !SESSION_TOKEN.test(sessionToken)) return null;
      try {
        const result = await pool.query(
          `SELECT wallet_address, owner_id, expires_at
           FROM falcon_mesh.wallet_auth_sessions
           WHERE token_hash = $1 AND revoked_at IS NULL AND expires_at > $2`,
          [createHash('sha256').update(sessionToken).digest('hex'), new Date(clock()).toISOString()],
        );
        const session = result.rows[0];
        return session ? {
          walletAddress: session.wallet_address,
          ownerId: session.owner_id,
          expiresAt: new Date(session.expires_at).toISOString(),
        } : null;
      } catch {
        throw storageFailure();
      }
    },

    async revokeSession(sessionToken) {
      if (typeof sessionToken !== 'string' || !SESSION_TOKEN.test(sessionToken)) return false;
      try {
        const now = new Date(clock()).toISOString();
        const result = await pool.query(
          `UPDATE falcon_mesh.wallet_auth_sessions
           SET revoked_at = $2
           WHERE token_hash = $1 AND revoked_at IS NULL AND expires_at > $2`,
          [createHash('sha256').update(sessionToken).digest('hex'), now],
        );
        return result.rowCount === 1;
      } catch {
        throw storageFailure();
      }
    },
  };
}
