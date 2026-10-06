import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import { request as httpsRequest } from 'node:https';
import { MeshError } from './domain.mjs';

const REQUEST_ID = /^far1_[A-Za-z0-9_-]{43}$/;
const CODE = /^fac1_[A-Za-z0-9_-]{43}$/;
const ACCESS_TOKEN = /^fao1_[A-Za-z0-9_-]{43}$/;
const CHALLENGE = /^[A-Za-z0-9_-]{43}$/;
const VERIFIER = /^[A-Za-z0-9._~-]{43,128}$/;
const SCOPE = 'falcon';
const REQUEST_TTL_MS = 5 * 60_000;
const CODE_TTL_MS = 120_000;
const ACCESS_TTL_MS = 30 * 60_000;
const CIMD_MAX_BYTES = 16 * 1024;
const CIMD_TIMEOUT_MS = 3_000;

export class OAuthProtocolError extends Error {
  constructor(code, description) {
    super(description);
    this.code = code;
    this.description = description;
  }
}

const hash = value => createHash('sha256').update(value, 'utf8').digest('hex');
const badRequest = message => new OAuthProtocolError('invalid_request', message);
const invalidGrant = () => new OAuthProtocolError('invalid_grant', 'The authorization code is invalid or expired.');
const storageFailure = () => new MeshError('STORAGE_UNAVAILABLE', 'OAuth storage is unavailable.');

function secretDigest(value) {
  return createHash('sha256').update(value, 'utf8').digest();
}

function isPublicIpv4(address) {
  if (isIP(address) !== 4) return false;
  const n = address.split('.').reduce((value, part) => (value * 256) + Number(part), 0);
  const ranges = [
    ['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8],
    ['169.254.0.0', 16], ['172.16.0.0', 12], ['192.0.0.0', 24], ['192.0.2.0', 24],
    ['192.88.99.0', 24], ['192.168.0.0', 16], ['198.18.0.0', 15], ['198.51.100.0', 24],
    ['203.0.113.0', 24], ['224.0.0.0', 4], ['240.0.0.0', 4],
  ];
  return !ranges.some(([network, bits]) => {
    const base = network.split('.').reduce((value, part) => (value * 256) + Number(part), 0);
    const mask = (0xffffffff << (32 - bits)) >>> 0;
    return (n & mask) === (base & mask);
  });
}

function isPublicIpv6(address) {
  if (isIP(address) !== 6 || address.includes('.')) return false;
  const halves = address.toLowerCase().split('::');
  if (halves.length > 2) return false;
  const left = halves[0] ? halves[0].split(':') : [];
  const right = halves.length === 2 && halves[1] ? halves[1].split(':') : [];
  const missing = 8 - left.length - right.length;
  if ((halves.length === 1 && missing !== 0) || (halves.length === 2 && missing < 1)) return false;
  const groups = [...left, ...Array(missing).fill('0'), ...right];
  if (groups.some(part => !/^[0-9a-f]{1,4}$/.test(part))) return false;
  const first = Number.parseInt(groups[0], 16);
  const second = Number.parseInt(groups[1], 16);
  const globalUnicast = (first & 0xe000) === 0x2000;
  return globalUnicast && first !== 0x2002 && !(first === 0x2001 && (second === 0 || second === 0x0db8));
}

function parseCimdUrl(value) {
  if (typeof value !== 'string' || value.length > 2048) throw new OAuthProtocolError('invalid_client', 'Client ID must be an HTTPS metadata URL.');
  let url;
  try { url = new URL(value); } catch { throw new OAuthProtocolError('invalid_client', 'Client ID must be an HTTPS metadata URL.'); }
  if (url.protocol !== 'https:' || url.username || url.password || url.hash || (url.port && url.port !== '443') || isIP(url.hostname)) {
    throw new OAuthProtocolError('invalid_client', 'Client ID must be an HTTPS metadata URL.');
  }
  return url;
}

function requestCimdJson(url, address) {
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (error, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (error) reject(error);
      else resolve(value);
    };
    const family = isIP(address);
    const request = httpsRequest(url, {
      method: 'GET',
      agent: false,
      servername: url.hostname,
      headers: { Accept: 'application/json', 'Accept-Encoding': 'identity' },
      lookup: (_hostname, options, callback) => {
        if (options?.all) callback(null, [{ address, family }]);
        else callback(null, address, family);
      },
    }, response => {
      const contentType = response.headers['content-type']?.split(';')[0].trim().toLowerCase();
      const declaredLength = Number(response.headers['content-length']);
      if (response.statusCode !== 200 || contentType !== 'application/json' || (Number.isFinite(declaredLength) && declaredLength > CIMD_MAX_BYTES)) {
        response.resume();
        finish(new Error('Client metadata response rejected.'));
        return;
      }
      const chunks = [];
      let bytes = 0;
      response.on('data', chunk => {
        bytes += chunk.length;
        if (bytes > CIMD_MAX_BYTES) {
          request.destroy(new Error('Client metadata response is too large.'));
          finish(new Error('Client metadata response is too large.'));
        } else chunks.push(chunk);
      });
      response.once('end', () => {
        try { finish(null, JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks)))); }
        catch { finish(new Error('Client metadata is not valid UTF-8 JSON.')); }
      });
      response.once('error', error => finish(error));
    });
    const timer = setTimeout(() => request.destroy(new Error('Client metadata request timed out.')), CIMD_TIMEOUT_MS);
    request.once('error', error => finish(error));
    request.end();
  });
}

export async function fetchClientMetadata(clientId, { lookupImpl = lookup, requestImpl = requestCimdJson } = {}) {
  const url = parseCimdUrl(clientId);
  try {
    const records = await lookupImpl(url.hostname, { all: true, verbatim: true });
    const address = records.find(record => isPublicIpv4(record.address) || isPublicIpv6(record.address))?.address;
    if (!address) throw new Error('No public address.');
    const metadata = await requestImpl(url, address);
    if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) throw new Error('Invalid metadata object.');
    if (metadata.client_id !== undefined && metadata.client_id !== clientId) throw new Error('Client ID does not match its metadata URL.');
    if (!Array.isArray(metadata.redirect_uris) || metadata.redirect_uris.length < 1 || metadata.redirect_uris.length > 32
      || metadata.redirect_uris.some(uri => typeof uri !== 'string' || uri.length > 2048)) throw new Error('Invalid redirect URI list.');
    if (metadata.grant_types !== undefined && (!Array.isArray(metadata.grant_types) || !metadata.grant_types.includes('authorization_code'))) {
      throw new Error('Authorization-code grant is not supported.');
    }
    if (metadata.response_types !== undefined && (!Array.isArray(metadata.response_types) || !metadata.response_types.includes('code'))) {
      throw new Error('Authorization-code response is not supported.');
    }
    if (metadata.token_endpoint_auth_method !== undefined && metadata.token_endpoint_auth_method !== 'none') {
      throw new Error('Only public OAuth clients are supported.');
    }
    const clientName = typeof metadata.client_name === 'string' && metadata.client_name.trim().length > 0
      ? metadata.client_name.trim().slice(0, 128)
      : url.hostname;
    return { clientId, clientName, redirectUris: metadata.redirect_uris };
  } catch {
    throw new OAuthProtocolError('invalid_client', 'Client metadata could not be verified.');
  }
}

function loopback(host) {
  return host === 'localhost' || host === '127.0.0.1' || host === '[::1]';
}

function redirectMatches(requested, registered) {
  let actual;
  let candidate;
  try { actual = new URL(requested); candidate = new URL(registered); } catch { return false; }
  if (actual.username || actual.password || actual.hash || candidate.username || candidate.password || candidate.hash) return false;
  if (actual.protocol === 'https:' || candidate.protocol === 'https:') return requested === registered;
  if (actual.protocol !== 'http:' || candidate.protocol !== 'http:' || !loopback(actual.hostname) || actual.hostname !== candidate.hostname) return false;
  if (actual.pathname !== candidate.pathname || actual.search !== candidate.search) return false;
  // RFC 8252 section 7.3 permits any port on a loopback redirect.
  return true;
}

function one(searchParams, name, required = true) {
  const values = searchParams.getAll(name);
  if (values.length > 1 || (required && values.length !== 1)) throw badRequest(`OAuth parameter ${name} is missing or repeated.`);
  return values[0] ?? null;
}

function validState(value) {
  return typeof value === 'string' && value.length > 0 && Buffer.byteLength(value, 'utf8') <= 512 && !/[\u0000-\u001f\u007f]/.test(value);
}

function randomValue(prefix, tokenBytes) {
  return `${prefix}${tokenBytes(32).toString('base64url')}`;
}

export function createOAuthAuth(pool, {
  walletAuth,
  allowedOrigins,
  issuer,
  resource,
  approvalUrl,
  serviceSecret,
  clock = () => Date.now(),
  tokenBytes = randomBytes,
  clientMetadata = fetchClientMetadata,
} = {}) {
  if (!pool || typeof pool.query !== 'function' || typeof pool.connect !== 'function') throw new TypeError('A PostgreSQL pool is required.');
  if (!walletAuth || typeof walletAuth.createChallenge !== 'function' || typeof walletAuth.verifyChallengeIdentity !== 'function') throw new TypeError('Wallet auth identity verification is required.');
  if (!(allowedOrigins instanceof Set)) throw new TypeError('Allowed OAuth origins must be a Set.');
  let issuerUrl;
  let resourceUrl;
  let approvalPageUrl;
  try { issuerUrl = new URL(issuer); resourceUrl = new URL(resource); approvalPageUrl = new URL(approvalUrl); }
  catch { throw new TypeError('OAuth issuer, resource, and approval URLs must be valid.'); }
  const secure = url => url.protocol === 'https:' || (url.protocol === 'http:' && loopback(url.hostname));
  if (!secure(issuerUrl) || issuerUrl.pathname !== '/' || issuerUrl.search || issuerUrl.hash || issuerUrl.username || issuerUrl.password
    || !secure(resourceUrl) || resourceUrl.search || resourceUrl.hash || resourceUrl.username || resourceUrl.password
    || !secure(approvalPageUrl) || approvalPageUrl.pathname !== '/oauth/approve' || approvalPageUrl.search || approvalPageUrl.hash
    || approvalPageUrl.username || approvalPageUrl.password || !allowedOrigins.has(approvalPageUrl.origin)
    || typeof serviceSecret !== 'string' || Buffer.byteLength(serviceSecret) < 32) {
    throw new TypeError('OAuth URLs, approval origin, or service secret are invalid.');
  }
  const issuerValue = issuerUrl.href.replace(/\/$/, '');
  const resourceValue = resourceUrl.href;
  const approvalOrigin = approvalPageUrl.origin;
  const serviceDigest = secretDigest(serviceSecret);
  const columns = new Set([
    'oauth_authorization_requests.request_hash', 'oauth_authorization_requests.client_id', 'oauth_authorization_requests.client_name',
    'oauth_authorization_requests.redirect_uri', 'oauth_authorization_requests.state', 'oauth_authorization_requests.code_challenge',
    'oauth_authorization_requests.resource', 'oauth_authorization_requests.scope', 'oauth_authorization_requests.challenge_id',
    'oauth_authorization_requests.created_at', 'oauth_authorization_requests.expires_at', 'oauth_authorization_requests.consumed_at',
    'oauth_authorization_codes.code_hash', 'oauth_authorization_codes.client_id', 'oauth_authorization_codes.redirect_uri',
    'oauth_authorization_codes.code_challenge', 'oauth_authorization_codes.resource', 'oauth_authorization_codes.scope',
    'oauth_authorization_codes.owner_id', 'oauth_authorization_codes.wallet_address', 'oauth_authorization_codes.created_at', 'oauth_authorization_codes.expires_at',
    'oauth_access_tokens.token_hash', 'oauth_access_tokens.client_id', 'oauth_access_tokens.resource', 'oauth_access_tokens.scope',
    'oauth_access_tokens.owner_id', 'oauth_access_tokens.wallet_address', 'oauth_access_tokens.created_at', 'oauth_access_tokens.expires_at', 'oauth_access_tokens.revoked_at',
  ]);
  const jsonResponse = {
    issuer: issuerValue,
    authorization_endpoint: `${issuerValue}/oauth/authorize`,
    token_endpoint: `${issuerValue}/oauth/token`,
    revocation_endpoint: `${issuerValue}/oauth/revoke`,
    response_types_supported: ['code'],
    grant_types_supported: ['authorization_code'],
    code_challenge_methods_supported: ['S256'],
    token_endpoint_auth_methods_supported: ['none'],
    client_id_metadata_document_supported: true,
    authorization_response_iss_parameter_supported: true,
    scopes_supported: [SCOPE],
  };

  function matchesServiceSecret(value) {
    if (typeof value !== 'string' || value.length > 512) return false;
    return timingSafeEqual(serviceDigest, secretDigest(value));
  }

  async function requestRow(handle) {
    if (typeof handle !== 'string' || !REQUEST_ID.test(handle)) return null;
    try {
      const result = await pool.query(
        `SELECT request_hash, client_id, client_name, redirect_uri, state, code_challenge, resource, scope, challenge_id, created_at, expires_at, consumed_at
         FROM falcon_mesh.oauth_authorization_requests
         WHERE request_hash = $1 AND expires_at > $2 AND consumed_at IS NULL`,
        [hash(handle), new Date(clock()).toISOString()],
      );
      return result.rows[0] ?? null;
    } catch { throw storageFailure(); }
  }

  async function cleanExpired(client, at) {
    await client.query('DELETE FROM falcon_mesh.oauth_authorization_requests WHERE expires_at <= $1 OR consumed_at IS NOT NULL', [at]);
    await client.query('DELETE FROM falcon_mesh.oauth_authorization_codes WHERE expires_at <= $1', [at]);
    await client.query('DELETE FROM falcon_mesh.oauth_access_tokens WHERE expires_at <= $1 OR revoked_at IS NOT NULL', [at]);
  }

  async function ready() {
    try {
      const result = await pool.query(
        `SELECT table_name, column_name FROM information_schema.columns
         WHERE table_schema = 'falcon_mesh' AND table_name = ANY($1::text[])`,
        [['oauth_authorization_requests', 'oauth_authorization_codes', 'oauth_access_tokens']],
      );
      const found = new Set(result.rows.map(row => `${row.table_name}.${row.column_name}`));
      for (const column of columns) {
        const [, table, name] = /^(oauth_[^.]+)\.(.+)$/.exec(column);
        if (!found.has(`${table}.${name}`)) throw storageFailure();
      }
    } catch (error) {
      if (error instanceof MeshError) throw error;
      throw storageFailure();
    }
  }

  async function beginAuthorization(params) {
    const clientId = one(params, 'client_id');
    const redirectUri = one(params, 'redirect_uri');
    const responseType = one(params, 'response_type');
    const challenge = one(params, 'code_challenge');
    const method = one(params, 'code_challenge_method');
    const state = one(params, 'state');
    const requestedResource = one(params, 'resource');
    const requestedScope = one(params, 'scope', false) ?? SCOPE;
    if (responseType !== 'code' || method !== 'S256' || !CHALLENGE.test(challenge) || !validState(state)) throw badRequest('OAuth authorization requires response_type=code, state, and PKCE S256.');
    if (requestedResource !== resourceValue) throw badRequest('The requested resource is not supported.');
    if (requestedScope !== SCOPE) throw badRequest('The requested scope is not supported.');
    const metadata = await clientMetadata(clientId);
    if (!metadata.redirectUris.some(candidate => redirectMatches(redirectUri, candidate))) throw new OAuthProtocolError('invalid_request', 'The redirect URI is not registered for this client.');
    const handle = randomValue('far1_', tokenBytes);
    const createdAt = new Date(clock()).toISOString();
    const expiresAt = new Date(clock() + REQUEST_TTL_MS).toISOString();
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await cleanExpired(client, createdAt);
      await client.query(
        `INSERT INTO falcon_mesh.oauth_authorization_requests
          (request_hash, client_id, client_name, redirect_uri, state, code_challenge, resource, scope, created_at, expires_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
        [hash(handle), clientId, metadata.clientName, redirectUri, state, challenge, resourceValue, SCOPE, createdAt, expiresAt],
      );
      await client.query('COMMIT');
      return { handle, clientName: metadata.clientName, resource: resourceValue, scope: SCOPE, expiresAt };
    } catch (error) {
      try { await client.query('ROLLBACK'); } catch {}
      if (error instanceof OAuthProtocolError) throw error;
      throw storageFailure();
    } finally { client.release(); }
  }

  async function approvalContext(handle) {
    const row = await requestRow(handle);
    if (!row) throw new MeshError('UNAUTHORIZED', 'This approval request is invalid or expired. Start sign-in again from your MCP client.');
    return { clientName: row.client_name, redirectHost: new URL(row.redirect_uri).host, resource: row.resource, scope: row.scope, expiresAt: new Date(row.expires_at).toISOString() };
  }

  async function createWalletChallenge(handle, address, origin) {
    const row = await requestRow(handle);
    if (!row) throw new MeshError('UNAUTHORIZED', 'This approval request is invalid or expired. Start sign-in again from your MCP client.');
    if (origin !== approvalOrigin) throw new MeshError('ORIGIN_DENIED', 'This browser origin is not allowed.');
    const challenge = await walletAuth.createChallenge(address, origin);
    try {
      const updated = await pool.query(
        `UPDATE falcon_mesh.oauth_authorization_requests SET challenge_id = $2
         WHERE request_hash = $1 AND expires_at > $3 AND consumed_at IS NULL RETURNING request_hash`,
        [hash(handle), challenge.challengeId, new Date(clock()).toISOString()],
      );
      if (updated.rowCount !== 1) throw new MeshError('UNAUTHORIZED', 'This approval request is invalid or expired. Start sign-in again from your MCP client.');
      return challenge;
    } catch (error) {
      if (error instanceof MeshError) throw error;
      throw storageFailure();
    }
  }

  function callback(row, values) {
    const target = new URL(row.redirect_uri);
    for (const [key, value] of Object.entries(values)) target.searchParams.set(key, value);
    target.searchParams.set('iss', issuerValue);
    return target.href;
  }

  async function approve(handle, challengeId, signature, origin) {
    if (origin !== approvalOrigin) throw new MeshError('ORIGIN_DENIED', 'This browser origin is not allowed.');
    const row = await requestRow(handle);
    if (!row || row.challenge_id !== challengeId) throw new MeshError('UNAUTHORIZED', 'This approval request is invalid or expired. Start sign-in again from your MCP client.');
    const identity = await walletAuth.verifyChallengeIdentity(challengeId, signature, origin);
    const code = randomValue('fac1_', tokenBytes);
    const createdAt = new Date(clock()).toISOString();
    const expiresAt = new Date(clock() + CODE_TTL_MS).toISOString();
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const consumed = await client.query(
        `UPDATE falcon_mesh.oauth_authorization_requests SET consumed_at = $2
         WHERE request_hash = $1 AND challenge_id = $3 AND expires_at > $2 AND consumed_at IS NULL
         RETURNING client_id, redirect_uri, state, code_challenge, resource, scope`,
        [hash(handle), createdAt, challengeId],
      );
      const current = consumed.rows[0];
      if (!current) throw new MeshError('UNAUTHORIZED', 'This approval request is invalid or expired. Start sign-in again from your MCP client.');
      await client.query(
        `INSERT INTO falcon_mesh.oauth_authorization_codes
          (code_hash, client_id, redirect_uri, code_challenge, resource, scope, owner_id, wallet_address, created_at, expires_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
        [hash(code), current.client_id, current.redirect_uri, current.code_challenge, current.resource, current.scope, identity.ownerId, identity.walletAddress, createdAt, expiresAt],
      );
      await client.query('COMMIT');
      return { redirectUrl: callback(current, { code, state: current.state }) };
    } catch (error) {
      try { await client.query('ROLLBACK'); } catch {}
      if (error instanceof MeshError) throw error;
      throw storageFailure();
    } finally { client.release(); }
  }

  async function deny(handle) {
    const row = await requestRow(handle);
    if (!row) throw new MeshError('UNAUTHORIZED', 'This approval request is invalid or expired. Start sign-in again from your MCP client.');
    try {
      const result = await pool.query(
        `UPDATE falcon_mesh.oauth_authorization_requests SET consumed_at = $2
         WHERE request_hash = $1 AND expires_at > $2 AND consumed_at IS NULL RETURNING redirect_uri, state`,
        [hash(handle), new Date(clock()).toISOString()],
      );
      const current = result.rows[0];
      if (!current) throw new MeshError('UNAUTHORIZED', 'This approval request is invalid or expired. Start sign-in again from your MCP client.');
      return { redirectUrl: callback(current, { error: 'access_denied', error_description: 'The user denied the request.', state: current.state }) };
    } catch (error) {
      if (error instanceof MeshError) throw error;
      throw storageFailure();
    }
  }

  async function exchangeCode(params) {
    if (params.grant_type !== 'authorization_code') throw new OAuthProtocolError('unsupported_grant_type', 'Only authorization_code is supported.');
    const { code, client_id: clientId, redirect_uri: redirectUri, code_verifier: verifier, resource: requestedResource } = params;
    if (typeof code !== 'string' || !CODE.test(code) || typeof clientId !== 'string' || clientId.length > 2048
      || typeof redirectUri !== 'string' || redirectUri.length > 2048 || typeof verifier !== 'string' || !VERIFIER.test(verifier)
      || requestedResource !== resourceValue) throw badRequest('The token request is missing a required field or resource.');
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const at = new Date(clock()).toISOString();
      const selected = await client.query(
        `SELECT code_hash, client_id, redirect_uri, code_challenge, resource, scope, owner_id, wallet_address, expires_at
         FROM falcon_mesh.oauth_authorization_codes WHERE code_hash = $1 FOR UPDATE`,
        [hash(code)],
      );
      const grant = selected.rows[0];
      const challenge = createHash('sha256').update(verifier, 'ascii').digest('base64url');
      if (!grant || Date.parse(grant.expires_at) <= clock() || grant.client_id !== clientId || grant.redirect_uri !== redirectUri
        || grant.resource !== resourceValue || grant.code_challenge !== challenge) {
        await client.query('ROLLBACK');
        throw invalidGrant();
      }
      const removed = await client.query('DELETE FROM falcon_mesh.oauth_authorization_codes WHERE code_hash = $1 AND expires_at > $2 RETURNING code_hash', [hash(code), at]);
      if (removed.rowCount !== 1) {
        await client.query('ROLLBACK');
        throw invalidGrant();
      }
      const accessToken = randomValue('fao1_', tokenBytes);
      const expiresAt = new Date(clock() + ACCESS_TTL_MS).toISOString();
      await cleanExpired(client, at);
      await client.query(
        `INSERT INTO falcon_mesh.oauth_access_tokens
          (token_hash, client_id, resource, scope, owner_id, wallet_address, created_at, expires_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [hash(accessToken), grant.client_id, grant.resource, grant.scope, grant.owner_id, grant.wallet_address, at, expiresAt],
      );
      await client.query('COMMIT');
      return { access_token: accessToken, token_type: 'Bearer', expires_in: ACCESS_TTL_MS / 1000, scope: grant.scope };
    } catch (error) {
      try { await client.query('ROLLBACK'); } catch {}
      if (error instanceof OAuthProtocolError || error instanceof MeshError) throw error;
      throw storageFailure();
    } finally { client.release(); }
  }

  async function getAccessToken(token) {
    if (typeof token !== 'string' || !ACCESS_TOKEN.test(token)) return null;
    try {
      const result = await pool.query(
        `SELECT client_id, resource, scope, owner_id, wallet_address, expires_at
         FROM falcon_mesh.oauth_access_tokens
         WHERE token_hash = $1 AND resource = $2 AND revoked_at IS NULL AND expires_at > $3`,
        [hash(token), resourceValue, new Date(clock()).toISOString()],
      );
      const row = result.rows[0];
      return row ? { clientId: row.client_id, resource: row.resource, scopes: row.scope.split(' '), ownerId: row.owner_id, walletAddress: row.wallet_address, expiresAt: new Date(row.expires_at).toISOString() } : null;
    } catch { throw storageFailure(); }
  }

  async function introspect(token) {
    const entry = await getAccessToken(token);
    return entry ? { active: true, ...entry } : { active: false };
  }

  async function revoke(token) {
    if (typeof token !== 'string' || !ACCESS_TOKEN.test(token)) return;
    try {
      await pool.query(
        `UPDATE falcon_mesh.oauth_access_tokens SET revoked_at = $2
         WHERE token_hash = $1 AND revoked_at IS NULL`,
        [hash(token), new Date(clock()).toISOString()],
      );
    } catch { throw storageFailure(); }
  }

  return {
    issuer: issuerValue,
    resource: resourceValue,
    approvalUrl: approvalPageUrl.href,
    approvalOrigin,
    metadata: () => jsonResponse,
    matchesServiceSecret,
    ready,
    beginAuthorization,
    approvalContext,
    createWalletChallenge,
    approve,
    deny,
    exchangeCode,
    introspect,
    getAccessToken,
    revoke,
  };
}
