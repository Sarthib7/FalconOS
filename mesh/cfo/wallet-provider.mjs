import { createHash, createPrivateKey, createPublicKey, sign as cryptoSign } from 'node:crypto';

const PRIVY_ORIGIN = 'https://api.privy.io';
const KLEND_PROGRAM_ID = 'KLend2g3cP87fffoy8q1mQqGKjrxjC8boSyAYavgmjD';
const USDC_MINT = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
const RESERVES = Object.freeze({
  D6q6wuQSrifJKZYpR1M8R4YawnLDtDsMmWM1NbBmgJ59: '7u3HeHxYDLhnCoErrtycNokbQYbWGzLs6JSDqGAv5PfF',
  Ga4rZytCpq1unD4DbEJ5bkHeUz9g3oh9AAFEi6vSauXp: 'DxXdAyU3kCjnyggvHmY5nAwg5cRbbmdyX3npfDMjjMek',
});
const POLICY_INSTRUCTIONS = Object.freeze({
  depositReserveLiquidity: 'liquidityAmount',
  redeemReserveCollateral: 'collateralAmount',
  refreshReserve: null,
});
const POLICY_DISCRIMINATORS = Object.freeze({
  depositReserveLiquidity: [169, 201, 30, 126, 6, 205, 102, 68],
  redeemReserveCollateral: [234, 117, 181, 125, 185, 142, 220, 29],
  refreshReserve: [2, 218, 138, 235, 79, 201, 25, 102],
});
const POLICY_ACCOUNTS = Object.freeze({
  depositReserveLiquidity: [
    'owner', 'reserve', 'lendingMarket', 'lendingMarketAuthority', 'reserveLiquidityMint',
    'reserveLiquiditySupply', 'reserveCollateralMint', 'userSourceLiquidity', 'userDestinationCollateral',
    'collateralTokenProgram', 'liquidityTokenProgram', 'instructionSysvarAccount',
  ],
  redeemReserveCollateral: [
    'owner', 'lendingMarket', 'reserve', 'lendingMarketAuthority', 'reserveLiquidityMint',
    'reserveCollateralMint', 'reserveLiquiditySupply', 'userSourceCollateral', 'userDestinationLiquidity',
    'collateralTokenProgram', 'liquidityTokenProgram', 'instructionSysvarAccount',
  ],
  refreshReserve: [
    'reserve', 'lendingMarket', 'pythOracle', 'switchboardPriceOracle', 'switchboardTwapOracle', 'scopePrices',
  ],
});
const B58 = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
const P256_ORDER = BigInt('0xffffffff00000000ffffffffffffffffbce6faada7179e84f3b9cac2fc632551');
const P256_HALF_ORDER = P256_ORDER >> 1n;
const MAX_REQUEST_BYTES = 4 * 1024 * 1024;
const MAX_RESPONSE_BYTES = 4 * 1024 * 1024;
const MAX_POLICY_BYTES = 32 * 1024;
const MAX_SOLANA_TRANSACTION_BYTES = 1232;
const MAX_SIGNERS = 16;
const TIMEOUT_MS = 8_000;
const SIGNATURE_WINDOW_MS = 30_000;

export class WalletProviderError extends Error {
  constructor(code, message = code, status = null) {
    super(message);
    this.name = 'WalletProviderError';
    this.code = code;
    this.status = status;
  }
}

function fail(code, message = code, status = null) {
  throw new WalletProviderError(code, message, status);
}

function isRecord(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function assertRecord(value, code = 'INVALID_INPUT') {
  if (!isRecord(value)) fail(code);
  return value;
}

function assertExactKeys(value, keys, code = 'INVALID_INPUT') {
  assertRecord(value, code);
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) fail(code);
}

function canonicalJSON(value, seen = new Set()) {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return JSON.stringify(value);
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) fail('INVALID_INPUT');
    return JSON.stringify(value);
  }
  if (typeof value !== 'object' || seen.has(value)) fail('INVALID_INPUT');
  seen.add(value);
  try {
    if (Array.isArray(value)) {
      return `[${value.map(item => canonicalJSON(item, seen)).join(',')}]`;
    }
    if (!isRecord(value)) fail('INVALID_INPUT');
    const descriptors = Object.getOwnPropertyDescriptors(value);
    const keys = Object.keys(descriptors).sort();
    const entries = [];
    for (const key of keys) {
      const descriptor = descriptors[key];
      if (!Object.hasOwn(descriptor, 'value') || descriptor.value === undefined) fail('INVALID_INPUT');
      entries.push(`${JSON.stringify(key)}:${canonicalJSON(descriptor.value, seen)}`);
    }
    return `{${entries.join(',')}}`;
  } finally {
    seen.delete(value);
  }
}
function p256DerInteger(bytes) {
  let start = 0;
  while (start < bytes.length - 1 && bytes[start] === 0) start++;
  let value = bytes.subarray(start);
  if (value[0] & 0x80) value = Buffer.concat([Buffer.from([0]), value]);
  return Buffer.concat([Buffer.from([0x02, value.length]), value]);
}

function p256DerSignature(raw) {
  if (raw.length !== 64) fail('SIGNATURE_ENCODING_FAILED');
  const s = BigInt(`0x${raw.subarray(32).toString('hex')}`);
  const lowS = s > P256_HALF_ORDER ? P256_ORDER - s : s;
  const normalizedS = Buffer.from(lowS.toString(16).padStart(64, '0'), 'hex');
  const sequence = Buffer.concat([p256DerInteger(raw.subarray(0, 32)), p256DerInteger(normalizedS)]);
  return Buffer.concat([Buffer.from([0x30, sequence.length]), sequence]);
}

function digest(value) {
  return createHash('sha256').update(canonicalJSON(value), 'utf8').digest('hex');
}

function safeString(value, pattern, maxLength) {
  return typeof value === 'string' && value.length > 0 && value.length <= maxLength && pattern.test(value);
}

function assertUserId(value) {
  if (!safeString(value, /^did:privy:[A-Za-z0-9_-]+$/, 160)) fail('WALLET_LINK_INVALID');
  return value;
}

function assertResourceId(value) {
  if (!safeString(value, /^[A-Za-z0-9_-]+$/, 128)) fail('WALLET_LINK_INVALID');
  return value;
}

function decodeBase58(value) {
  if (typeof value !== 'string' || value.length < 32 || value.length > 44) return null;
  let number = 0n;
  for (const character of value) {
    const digit = B58.indexOf(character);
    if (digit < 0) return null;
    number = number * 58n + BigInt(digit);
  }
  let body = [];
  while (number > 0n) {
    body.push(Number(number & 255n));
    number >>= 8n;
  }
  body.reverse();
  const zeros = value.match(/^1*/)?.[0].length ?? 0;
  if (zeros + body.length !== 32) return null;
  return Buffer.concat([Buffer.alloc(zeros), Buffer.from(body)]);
}

function isSolanaAddress(value) {
  return decodeBase58(value) !== null;
}

function parseBase64(value, maxBytes, minBytes = 1) {
  if (typeof value !== 'string' || !value.length || value.length > Math.ceil(maxBytes / 3) * 4
      || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value)) {
    fail('INVALID_TRANSACTION');
  }
  const bytes = Buffer.from(value, 'base64');
  if (bytes.length < minBytes || bytes.length > maxBytes || bytes.toString('base64') !== value) fail('INVALID_TRANSACTION');
  return bytes;
}

function parsePrivateKey(value) {
  if (typeof value !== 'string' || !value.length || value.length > 8192 || /[\r\n]/.test(value)) return null;
  const encoded = value.replace(/^wallet-auth:/, '').replace(/^wallet-api:/, '').replace(/\s/g, '');
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(encoded)) return null;
  try {
    const privateKey = createPrivateKey({ key: Buffer.from(encoded, 'base64'), format: 'der', type: 'pkcs8' });
    if (privateKey.asymmetricKeyType !== 'ec' || privateKey.asymmetricKeyDetails?.namedCurve !== 'prime256v1') return null;
    const publicKey = createPublicKey(privateKey).export({ format: 'der', type: 'spki' }).toString('base64');
    return { privateKey, publicKey };
  } catch {
    return null;
  }
}

function normalizedPublicKey(value) {
  if (typeof value !== 'string' || value.length > 4096) return null;
  const normalized = value.replace(/\s/g, '').replace(/^wallet-auth:/, '').replace(/^wallet-api:/, '');
  return /^[A-Za-z0-9+/]+={0,2}$/.test(normalized) ? normalized : null;
}

function validTime(value) {
  return typeof value === 'string' && Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value;
}

function assertMandate(mandate) {
  assertRecord(mandate, 'POLICY_SCOPE_INVALID');
  if (!validTime(mandate.expiresAt) || !Array.isArray(mandate.reserves) || mandate.reserves.length !== 2
      || new Set(mandate.reserves).size !== 2
      || mandate.reserves.some(reserve => !Object.hasOwn(RESERVES, reserve))
      || typeof mandate.maxActionBaseUnits !== 'string' || !/^(0|[1-9][0-9]{0,37})$/.test(mandate.maxActionBaseUnits)
      || mandate.maxActionBaseUnits === '0') {
    fail('POLICY_SCOPE_INVALID');
  }
  return {
    expiresAt: mandate.expiresAt,
    expirySeconds: String(Math.floor(Date.parse(mandate.expiresAt) / 1000)),
    maxActionBaseUnits: mandate.maxActionBaseUnits,
    reserves: [...mandate.reserves],
  };
}

function flattenIdlAccounts(accounts) {
  if (!Array.isArray(accounts)) fail('POLICY_SCOPE_INVALID');
  const names = [];
  for (const account of accounts) {
    assertExactKeys(account, ['name', 'writable', 'signer'], 'POLICY_SCOPE_INVALID');
    if (typeof account.name !== 'string' || !account.name
        || typeof account.writable !== 'boolean' || typeof account.signer !== 'boolean') fail('POLICY_SCOPE_INVALID');
    names.push(account.name);
  }
  return names;
}

function assertPolicyRules(rules, { walletAddress, mandate }) {
  const mandateScope = assertMandate(mandate);
  if (!isSolanaAddress(walletAddress) || !Array.isArray(rules) || rules.length !== 6) fail('POLICY_SCOPE_INVALID');
  const observed = new Set();
  const userTokenAccounts = new Map();
  const names = new Set();
  for (const rule of rules) {
    assertExactKeys(rule, ['name', 'method', 'action', 'conditions'], 'POLICY_SCOPE_INVALID');
    if (typeof rule.name !== 'string' || !rule.name.trim() || rule.name.length > 100
        || names.has(rule.name) || rule.method !== 'signTransaction' || rule.action !== 'ALLOW'
        || !Array.isArray(rule.conditions) || rule.conditions.length < 4 || rule.conditions.length > 16) {
      fail('POLICY_SCOPE_INVALID');
    }
    names.add(rule.name);
    const programs = rule.conditions.filter(condition => condition?.field_source === 'solana_program_instruction');
    const clocks = rule.conditions.filter(condition => condition?.field_source === 'system');
    const data = rule.conditions.filter(condition => condition?.field_source === 'solana_instruction_data');
    if (programs.length !== 1 || clocks.length !== 1 || data.length < 2 || data.length > 14
        || programs.length + clocks.length + data.length !== rule.conditions.length) fail('POLICY_SCOPE_INVALID');
    const program = programs[0];
    assertExactKeys(program, ['field_source', 'field', 'operator', 'value'], 'POLICY_SCOPE_INVALID');
    if (program.field !== 'programId' || program.operator !== 'eq' || program.value !== KLEND_PROGRAM_ID) fail('POLICY_SCOPE_INVALID');
    const clock = clocks[0];
    assertExactKeys(clock, ['field_source', 'field', 'operator', 'value'], 'POLICY_SCOPE_INVALID');
    if (clock.field !== 'current_unix_timestamp' || clock.operator !== 'lte' || clock.value !== mandateScope.expirySeconds) fail('POLICY_SCOPE_INVALID');

    const instructionNames = data.filter(condition => condition.field === 'instruction_name');
    if (instructionNames.length !== 1) fail('POLICY_SCOPE_INVALID');
    const instructionName = instructionNames[0].value;
    if (!Object.hasOwn(POLICY_INSTRUCTIONS, instructionName)) fail('POLICY_SCOPE_INVALID');
    const reserveConditions = data.filter(condition => /\.accounts\.reserve$/.test(condition.field));
    const marketConditions = data.filter(condition => /\.accounts\.lendingMarket$/.test(condition.field));
    if (reserveConditions.length !== 1 || marketConditions.length !== 1) fail('POLICY_SCOPE_INVALID');
    for (const condition of [reserveConditions[0], marketConditions[0]]) {
      assertExactKeys(condition, ['field_source', 'field', 'idl', 'operator', 'value'], 'POLICY_SCOPE_INVALID');
      if (condition.operator !== 'eq' || typeof condition.value !== 'string' || !isSolanaAddress(condition.value)) fail('POLICY_SCOPE_INVALID');
    }
    const reserve = reserveConditions[0].value;
    const market = marketConditions[0].value;
    if (!mandateScope.reserves.includes(reserve) || RESERVES[reserve] !== market) fail('POLICY_SCOPE_INVALID');
    const tuple = `${reserve}:${instructionName}`;
    if (observed.has(tuple)) fail('POLICY_SCOPE_INVALID');
    observed.add(tuple);

    let idlCanonical = null;
    let idlInstruction = null;
    const accountConstraints = new Map();
    const argConstraints = new Map();
    for (const condition of data) {
      assertExactKeys(condition, ['field_source', 'field', 'idl', 'operator', 'value'], 'POLICY_SCOPE_INVALID');
      assertExactKeys(condition.idl, ['address', 'metadata', 'instructions'], 'POLICY_SCOPE_INVALID');
      assertExactKeys(condition.idl.metadata, ['name', 'version', 'spec'], 'POLICY_SCOPE_INVALID');
      if (Buffer.byteLength(canonicalJSON(condition.idl), 'utf8') > MAX_POLICY_BYTES
          || condition.idl.address !== KLEND_PROGRAM_ID
          || condition.idl.metadata.name !== 'kamino_lending'
          || condition.idl.metadata.version !== '1.25.0'
          || condition.idl.metadata.spec !== '0.1.0'
          || !Array.isArray(condition.idl.instructions) || condition.idl.instructions.length !== 1) {
        fail('POLICY_SCOPE_INVALID');
      }
      const nextIdlCanonical = canonicalJSON(condition.idl);
      if (idlCanonical !== null && nextIdlCanonical !== idlCanonical) fail('POLICY_SCOPE_INVALID');
      idlCanonical = nextIdlCanonical;
      const instruction = condition.idl.instructions[0];
      assertExactKeys(instruction, ['name', 'discriminator', 'accounts', 'args'], 'POLICY_SCOPE_INVALID');
      if (instruction.name !== instructionName
          || canonicalJSON(instruction.discriminator) !== canonicalJSON(POLICY_DISCRIMINATORS[instructionName])
          || !Array.isArray(instruction.accounts) || !Array.isArray(instruction.args)) fail('POLICY_SCOPE_INVALID');
      if (idlInstruction && canonicalJSON(idlInstruction) !== canonicalJSON(instruction)) fail('POLICY_SCOPE_INVALID');
      idlInstruction = instruction;
      if (condition.field === 'instruction_name') {
        if (condition.operator !== 'eq' || condition.value !== instructionName) fail('POLICY_SCOPE_INVALID');
      } else if (condition.field.startsWith(`${instructionName}.accounts.`)) {
        const name = condition.field.slice(`${instructionName}.accounts.`.length);
        if (condition.operator !== 'eq' || !name || typeof condition.value !== 'string' || !isSolanaAddress(condition.value)
            || accountConstraints.has(name)) fail('POLICY_SCOPE_INVALID');
        accountConstraints.set(name, condition.value);
      } else if (condition.field.startsWith(`${instructionName}.args.`)) {
        const name = condition.field.slice(`${instructionName}.args.`.length);
        if (argConstraints.has(name) || typeof condition.value !== 'string' || !/^(0|[1-9][0-9]{0,37})$/.test(condition.value)) {
          fail('POLICY_SCOPE_INVALID');
        }
        argConstraints.set(name, { operator: condition.operator, value: condition.value });
      } else {
        fail('POLICY_SCOPE_INVALID');
      }
    }
    const expectedAccounts = flattenIdlAccounts(idlInstruction.accounts);
    if (canonicalJSON(expectedAccounts) !== canonicalJSON(POLICY_ACCOUNTS[instructionName])
        || expectedAccounts.length !== accountConstraints.size
        || expectedAccounts.some(account => !accountConstraints.has(account))) fail('POLICY_SCOPE_INVALID');
    if (accountConstraints.get('reserve') !== reserve || accountConstraints.get('lendingMarket') !== market) fail('POLICY_SCOPE_INVALID');
    if (instructionName !== 'refreshReserve') {
      const liquidityMints = [...accountConstraints].filter(([name]) => /liquidity.*mint|mint.*liquidity/i.test(name));
      const collateralMint = accountConstraints.get('reserveCollateralMint');
      if (!liquidityMints.length || liquidityMints.some(([, address]) => address !== USDC_MINT)
          || !isSolanaAddress(collateralMint) || collateralMint === USDC_MINT) fail('POLICY_SCOPE_INVALID');
      const commonAccounts = {
        collateralMint: accountConstraints.get('reserveCollateralMint'),
        lendingMarketAuthority: accountConstraints.get('lendingMarketAuthority'),
        reserveLiquiditySupply: accountConstraints.get('reserveLiquiditySupply'),
        collateralTokenProgram: accountConstraints.get('collateralTokenProgram'),
        liquidityTokenProgram: accountConstraints.get('liquidityTokenProgram'),
      };
      if (Object.values(commonAccounts).some(value => !isSolanaAddress(value))
          || commonAccounts.collateralMint === USDC_MINT) fail('POLICY_SCOPE_INVALID');
      const reserveScope = userTokenAccounts.get(reserve) ?? {};
      if (instructionName === 'depositReserveLiquidity') {
        reserveScope.supply = {
          ...commonAccounts,
          usdcAta: accountConstraints.get('userSourceLiquidity'),
          collateralAta: accountConstraints.get('userDestinationCollateral'),
        };
      } else {
        reserveScope.redeem = {
          ...commonAccounts,
          usdcAta: accountConstraints.get('userDestinationLiquidity'),
          collateralAta: accountConstraints.get('userSourceCollateral'),
        };
      }
      userTokenAccounts.set(reserve, reserveScope);
    }
    if (instructionName !== 'refreshReserve') {
      if (accountConstraints.get('owner') !== walletAddress) fail('POLICY_SCOPE_INVALID');
      const argName = POLICY_INSTRUCTIONS[instructionName];
      assertExactKeys(idlInstruction.args[0], ['name', 'type'], 'POLICY_SCOPE_INVALID');
      if (idlInstruction.args[0].name !== argName || idlInstruction.args[0].type !== 'u64'
          || argConstraints.size !== 1 || argConstraints.get(argName)?.operator !== 'lte'
          || argConstraints.get(argName)?.value !== mandateScope.maxActionBaseUnits) fail('POLICY_SCOPE_INVALID');
    } else if (idlInstruction.args.length !== 0 || argConstraints.size !== 0 || expectedAccounts.length !== 6) {
      fail('POLICY_SCOPE_INVALID');
    }
  }
  for (const reserve of mandateScope.reserves) {
    for (const instruction of Object.keys(POLICY_INSTRUCTIONS)) {
      if (!observed.has(`${reserve}:${instruction}`)) fail('POLICY_SCOPE_INVALID');
    }
    const accountScope = userTokenAccounts.get(reserve);
    if (!accountScope?.supply || !accountScope?.redeem
        || canonicalJSON(accountScope.supply) !== canonicalJSON(accountScope.redeem)
        || accountScope.supply.usdcAta === USDC_MINT
        || accountScope.supply.collateralAta === accountScope.supply.collateralMint
        || accountScope.supply.usdcAta === accountScope.supply.collateralAta) fail('POLICY_SCOPE_INVALID');
  }
  return mandateScope;
}

function normalizePolicyRules(rules) {
  if (!Array.isArray(rules) || rules.length !== 6) fail('POLICY_RESOURCE_INVALID');
  return rules.map(rule => {
    assertRecord(rule, 'POLICY_RESOURCE_INVALID');
    const keys = Object.keys(rule);
    if (keys.some(key => !['id', 'name', 'method', 'action', 'conditions'].includes(key))
        || !['name', 'method', 'action', 'conditions'].every(key => Object.hasOwn(rule, key))) fail('POLICY_RESOURCE_INVALID');
    const normalized = { name: rule.name, method: rule.method, action: rule.action, conditions: rule.conditions };
    canonicalJSON(normalized);
    return normalized;
  });
}

function normalizePolicy(policy) {
  assertRecord(policy, 'POLICY_RESOURCE_INVALID');
  if (typeof policy.id !== 'string' || !policy.id || policy.chain_type !== 'solana' || policy.version !== '1.0'
      || typeof policy.owner_id !== 'string' || !policy.owner_id) fail('POLICY_RESOURCE_INVALID');
  return {
    id: assertResourceId(policy.id),
    chain_type: policy.chain_type,
    version: policy.version,
    owner_id: assertResourceId(policy.owner_id),
    rules: normalizePolicyRules(policy.rules),
  };
}

function hashPolicySet({ appId, link, signerId, expiresAt, policies }) {
  return digest({
    schemaVersion: 1,
    appId,
    wallet: {
      providerWalletId: link.providerWalletId,
      walletAddress: link.walletAddress,
      userId: link.userId,
      ownerId: link.ownerId,
    },
    signerId,
    expiresAt,
    policies: policies.map(policy => ({
      id: policy.id,
      chain_type: policy.chain_type,
      version: policy.version,
      owner_id: policy.owner_id,
      rules: policy.rules,
    })),
  });
}

function safeReason(error) {
  return error instanceof WalletProviderError ? error.code : 'PROVIDER_UNAVAILABLE';
}

export function createWalletProvider({
  appId,
  appSecret,
  authorizationKeyId,
  authorizationPrivateKey,
  fetchImpl = globalThis.fetch,
  now = () => new Date().toISOString(),
  client,
} = {}) {
  const id = typeof appId === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(appId) ? appId : null;
  const secret = typeof appSecret === 'string' && appSecret.length > 0 && appSecret.length <= 4096 && !/[\r\n]/.test(appSecret) ? appSecret : null;
  const signerId = typeof authorizationKeyId === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(authorizationKeyId) ? authorizationKeyId : null;
  const key = parsePrivateKey(authorizationPrivateKey);
  const transport = client === undefined ? fetchImpl
    : typeof client === 'function' ? client
      : client && typeof client.fetch === 'function' ? client.fetch.bind(client) : null;
  const issues = [];
  if (!id || !secret) issues.push('Privy app credentials are missing or invalid.');
  if (!signerId) issues.push('The scoped backend signer ID is missing or invalid.');
  if (!key) issues.push('The scoped backend signer key is missing or invalid.');
  if (typeof transport !== 'function') issues.push('The Privy REST transport is unavailable.');
  if (typeof now !== 'function') issues.push('The clock provider is unavailable.');
  const configured = issues.length === 0;
  const basicAuthorization = configured ? `Basic ${Buffer.from(`${id}:${secret}`).toString('base64')}` : null;

  function requireConfigured() {
    if (!configured) fail('PROVIDER_UNAVAILABLE', 'Privy wallet provider is not configured.');
  }

  function currentTimeMs() {
    let value;
    try { value = now(); } catch { fail('CLOCK_UNAVAILABLE'); }
    const timestamp = typeof value === 'number' ? value : Date.parse(value);
    if (!Number.isFinite(timestamp)) fail('CLOCK_UNAVAILABLE');
    return timestamp;
  }

  function makeTimeoutSignal(signal = null) {
    const timeout = AbortSignal.timeout(TIMEOUT_MS);
    return signal ? AbortSignal.any([signal, timeout]) : timeout;
  }

  function assertFixedUrl(input) {
    let url;
    try { url = input instanceof URL ? input : new URL(input); } catch { fail('PROVIDER_URL_INVALID'); }
    if (url.origin !== PRIVY_ORIGIN || url.username || url.password || url.hash) fail('PROVIDER_URL_INVALID');
    return url;
  }

  async function readBoundedBody(response, limit) {
    const declaredLength = Number(response.headers?.get?.('content-length'));
    if (Number.isFinite(declaredLength) && declaredLength > limit) {
      try { await response.body?.cancel?.(); } catch { /* response disposal is best effort */ }
      fail('PROVIDER_RESPONSE_TOO_LARGE');
    }
    if (response.body?.getReader) {
      const reader = response.body.getReader();
      const chunks = [];
      let size = 0;
      try {
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          size += value.byteLength;
          if (size > limit) {
            try { await reader.cancel(); } catch { /* response disposal is best effort */ }
            fail('PROVIDER_RESPONSE_TOO_LARGE');
          }
          chunks.push(Buffer.from(value));
        }
      } finally {
        reader.releaseLock();
      }
      return Buffer.concat(chunks, size);
    }
    let bytes;
    try { bytes = Buffer.from(await response.arrayBuffer()); } catch { fail('PROVIDER_RESPONSE_INVALID'); }
    if (bytes.length > limit) fail('PROVIDER_RESPONSE_TOO_LARGE');
    return bytes;
  }


  function apiURL(path) {
    if (typeof path !== 'string' || !path.startsWith('/v1/') || path.includes('?') || path.includes('#')) fail('PROVIDER_URL_INVALID');
    return assertFixedUrl(new URL(path, PRIVY_ORIGIN));
  }

  async function requestJSON(method, path, { body, idempotencyKey, requestExpiry, authorizationSignature } = {}) {
    requireConfigured();
    const url = apiURL(path);
    const headers = {
      authorization: basicAuthorization,
      'privy-app-id': id,
      accept: 'application/json',
    };
    let serializedBody;
    if (body !== undefined) {
      serializedBody = canonicalJSON(body);
      if (Buffer.byteLength(serializedBody, 'utf8') > MAX_REQUEST_BYTES) fail('PROVIDER_REQUEST_TOO_LARGE');
      headers['content-type'] = 'application/json';
    }
    if (idempotencyKey !== undefined) headers['privy-idempotency-key'] = idempotencyKey;
    if (requestExpiry !== undefined) headers['privy-request-expiry'] = String(requestExpiry);
    if (authorizationSignature !== undefined) headers['privy-authorization-signature'] = authorizationSignature;
    let response;
    try {
      response = await transport(url, {
        method,
        headers,
        body: serializedBody,
        redirect: 'error',
        signal: makeTimeoutSignal(),
      });
    } catch {
      fail('PROVIDER_UNAVAILABLE', 'Privy request is unavailable.');
    }
    if (!response || typeof response.status !== 'number') fail('PROVIDER_RESPONSE_INVALID');
    if (response.url) assertFixedUrl(response.url);
    if (!response.ok) {
      try { await response.body?.cancel?.(); } catch { /* response disposal is best effort */ }
      const code = response.status === 401 || response.status === 403 ? 'PROVIDER_AUTHORIZATION_FAILED'
        : response.status === 404 ? 'PROVIDER_RESOURCE_NOT_FOUND'
          : response.status === 429 ? 'PROVIDER_RATE_LIMITED'
            : response.status >= 500 ? 'PROVIDER_UNAVAILABLE' : 'PROVIDER_REQUEST_REJECTED';
      fail(code, code, response.status);
    }
    const contentType = response.headers?.get?.('content-type') ?? '';
    if (!/^application\/json(?:\s*;|$)/i.test(contentType)) {
      try { await response.body?.cancel?.(); } catch { /* response disposal is best effort */ }
      fail('PROVIDER_RESPONSE_INVALID');
    }
    const bytes = await readBoundedBody(response, MAX_RESPONSE_BYTES);
    try { return JSON.parse(bytes.toString('utf8')); } catch { fail('PROVIDER_RESPONSE_INVALID'); }
  }

  function buildAuthorizationSignature({ method, url, body, requestExpiry, idempotencyKey }) {
    const signatureInput = {
      version: 1,
      method,
      url: url.href,
      body,
      headers: {
        'privy-app-id': id,
        'privy-idempotency-key': idempotencyKey,
        'privy-request-expiry': String(requestExpiry),
      },
    };
    const encoded = Buffer.from(canonicalJSON(signatureInput), 'utf8');
    let rawSignature;
    try {
      rawSignature = cryptoSign('sha256', encoded, { key: key.privateKey, dsaEncoding: 'ieee-p1363' });
    } catch {
      fail('SIGNATURE_ENCODING_FAILED');
    }
    return p256DerSignature(rawSignature).toString('base64');
  }

  async function getUserByWalletAddress(walletAddress) {
    let user;
    try {
      user = await requestJSON('POST', '/v1/users/wallet/address', { body: { address: walletAddress } });
    } catch (error) {
      if (error instanceof WalletProviderError && error.code === 'PROVIDER_RESOURCE_NOT_FOUND') fail('WALLET_OWNERSHIP_MISMATCH');
      throw error;
    }
    assertRecord(user, 'PROVIDER_RESPONSE_INVALID');
    if (!Array.isArray(user.linked_accounts)) fail('WALLET_LINK_INVALID');
    assertUserId(user.id);
    return user;
  }

  function findLinkedSolanaWallet(user, walletAddress) {
    return user.linked_accounts.find(account => account?.type === 'wallet' && account.chain_type === 'solana'
      && account.address === walletAddress && account.connector_type === 'embedded'
      && account.wallet_client === 'privy' && account.wallet_client_type === 'privy'
      && account.imported === false && account.user_can_sign === true) ?? null;
  }

  function assertOptionalWalletEntity(resource, userId) {
    if (resource.entity === undefined || resource.entity === null) return;
    if (!isRecord(resource.entity) || resource.entity.type !== 'user' || resource.entity.id !== userId) {
      fail('WALLET_OWNERSHIP_MISMATCH');
    }
  }

  async function getWalletByAddress(walletAddress) {
    let wallet;
    try {
      wallet = await requestJSON('POST', '/v1/wallets/address', { body: { address: walletAddress } });
    } catch (error) {
      if (error instanceof WalletProviderError && error.code === 'PROVIDER_RESOURCE_NOT_FOUND') fail('WALLET_OWNERSHIP_MISMATCH');
      throw error;
    }
    assertRecord(wallet, 'PROVIDER_RESPONSE_INVALID');
    if (typeof wallet.id !== 'string' || !wallet.id) fail('PROVIDER_RESPONSE_INVALID');
    return wallet;
  }

  async function getWalletById(walletId) {
    return requestJSON('GET', `/v1/wallets/${encodeURIComponent(assertResourceId(walletId))}`);
  }

  async function getKeyQuorum(keyQuorumId) {
    const quorum = await requestJSON('GET', `/v1/key_quorums/${encodeURIComponent(assertResourceId(keyQuorumId))}`);
    assertRecord(quorum, 'PROVIDER_RESPONSE_INVALID');
    if (quorum.id !== keyQuorumId || !Array.isArray(quorum.authorization_keys)
        || !Array.isArray(quorum.user_ids) && quorum.user_ids !== null
        || !Array.isArray(quorum.key_quorum_ids) && quorum.key_quorum_ids !== undefined) fail('PROVIDER_RESPONSE_INVALID');
    return quorum;
  }

  async function assertCustomerOwner(ownerId, userId) {
    if (!ownerId || ownerId === signerId) fail('WALLET_OWNERSHIP_MISMATCH');
    const quorum = await getKeyQuorum(ownerId);
    const userIds = quorum.user_ids ?? [];
    const nestedQuorums = quorum.key_quorum_ids ?? [];
    if (userIds.length !== 1 || userIds[0] !== userId || nestedQuorums.length !== 0
        || quorum.authorization_keys.length !== 0
        || (quorum.authorization_threshold !== null && quorum.authorization_threshold !== 1)) fail('WALLET_OWNERSHIP_MISMATCH');
    return quorum;
  }

  async function assertWorkerSignerKey() {
    const quorum = await getKeyQuorum(signerId);
    const userIds = quorum.user_ids ?? [];
    const nestedQuorums = quorum.key_quorum_ids ?? [];
    const publicKeys = quorum.authorization_keys.map(item => normalizedPublicKey(item?.public_key));
    if (userIds.length !== 0 || nestedQuorums.length !== 0 || publicKeys.length !== 1
        || publicKeys[0] !== key.publicKey || (quorum.authorization_threshold !== null && quorum.authorization_threshold !== 1)) {
      fail('SIGNER_KEY_SCOPE_INVALID');
    }
    return quorum;
  }

  async function readWalletOwnership(walletAddress, expectedLink = null) {
    if (!isSolanaAddress(walletAddress)) fail('WALLET_LINK_INVALID');
    const user = await getUserByWalletAddress(walletAddress);
    const userId = assertUserId(user.id);
    const linkedWallet = findLinkedSolanaWallet(user, walletAddress);
    if (!linkedWallet) fail('WALLET_OWNERSHIP_MISMATCH');
    const addressLookup = await getWalletByAddress(walletAddress);
    if (addressLookup.address !== walletAddress || addressLookup.chain_type !== 'solana'
        || addressLookup.archived_at != null) fail('WALLET_OWNERSHIP_MISMATCH');
    const providerWalletId = assertResourceId(addressLookup.id);
    if (linkedWallet.id !== null && linkedWallet.id !== providerWalletId) fail('WALLET_OWNERSHIP_MISMATCH');
    const wallet = await getWalletById(providerWalletId);
    if (!isRecord(wallet)) fail('WALLET_OWNERSHIP_MISMATCH');
    const ownerId = assertResourceId(wallet.owner_id);
    if (wallet.id !== providerWalletId || wallet.address !== walletAddress || wallet.chain_type !== 'solana'
        || addressLookup.owner_id !== ownerId || wallet.archived_at != null || !Array.isArray(wallet.additional_signers)) {
      fail('WALLET_OWNERSHIP_MISMATCH');
    }
    assertOptionalWalletEntity(addressLookup, userId);
    assertOptionalWalletEntity(wallet, userId);
    if (expectedLink && (expectedLink.providerWalletId !== providerWalletId
        || expectedLink.walletAddress !== walletAddress || expectedLink.userId !== userId
        || expectedLink.ownerId !== ownerId)) fail('WALLET_OWNERSHIP_MISMATCH');
    await assertCustomerOwner(ownerId, userId);
    return { userId, walletAddress, providerWalletId, ownerId, wallet, user, linkedWallet };
  }

  async function verifyWallet(link) {
    assertExactKeys(link, ['providerWalletId', 'walletAddress', 'userId', 'ownerId'], 'WALLET_LINK_INVALID');
    return readWalletOwnership(link.walletAddress, link);
  }

  function assertDelegationEnvelope(delegation) {
    assertRecord(delegation, 'DELEGATION_INVALID');
    if (!Array.isArray(delegation.policyIds) || delegation.policyIds.length !== 1
        || typeof delegation.policyHash !== 'string' || !/^[a-f0-9]{64}$/.test(delegation.policyHash)
        || delegation.signerId !== signerId || !validTime(delegation.expiresAt)) fail('DELEGATION_INVALID');
    return {
      policyIds: [assertResourceId(delegation.policyIds[0])],
      policyHash: delegation.policyHash,
      signerId: delegation.signerId,
      expiresAt: delegation.expiresAt,
    };
  }

  function getSigner(wallet) {
    if (!Array.isArray(wallet.additional_signers) || wallet.additional_signers.length > MAX_SIGNERS) fail('WALLET_RESOURCE_INVALID');
    return wallet.additional_signers.find(item => item?.signer_id === signerId) ?? null;
  }

  function signerPolicyIds(signer) {
    if (!signer || !Array.isArray(signer.override_policy_ids) || signer.override_policy_ids.length !== 1) return null;
    const values = signer.override_policy_ids;
    if (values.some(value => typeof value !== 'string') || new Set(values).size !== values.length) return null;
    return values.map(assertResourceId);
  }

  async function getPolicySet(policyIds, userId, expectedRules) {
    if (!Array.isArray(policyIds) || policyIds.length !== 1) fail('POLICY_RESOURCE_INVALID');
    const policies = [];
    for (const policyId of policyIds) {
      const raw = await requestJSON('GET', `/v1/policies/${encodeURIComponent(assertResourceId(policyId))}`);
      const policy = normalizePolicy(raw);
      if (policy.id !== policyId || policy.chain_type !== 'solana' || policy.version !== '1.0'
          || canonicalJSON(policy.rules) !== canonicalJSON(expectedRules)) fail('POLICY_SCOPE_CHANGED');
      await assertCustomerOwner(policy.owner_id, userId);
      policies.push(policy);
    }
    return policies;
  }

  async function verifyDelegationState({ link, mandate, delegation, rules }) {
    const envelope = assertDelegationEnvelope(delegation);
    const walletState = await verifyWallet(link);
    await assertWorkerSignerKey();
    const scope = assertPolicyRules(rules, { walletAddress: walletState.walletAddress, mandate });
    if (envelope.expiresAt !== scope.expiresAt) fail('POLICY_SCOPE_CHANGED');
    const signer = getSigner(walletState.wallet);
    if (!signer) {
      fail(walletState.wallet.additional_signers.length === 0 ? 'DELEGATION_REVOKED' : 'REVOCATION_INCOMPLETE');
    }
    const installedPolicyIds = signerPolicyIds(signer);
    if (!installedPolicyIds || installedPolicyIds.length !== envelope.policyIds.length
        || installedPolicyIds.some((value, index) => value !== envelope.policyIds[index])) fail('POLICY_SCOPE_CHANGED');
    const normalizedRules = normalizePolicyRules(rules);
    const policies = await getPolicySet(installedPolicyIds, walletState.userId, normalizedRules);
    const actualHash = hashPolicySet({ appId: id, link: walletState, signerId, expiresAt: scope.expiresAt, policies });
    if (actualHash !== envelope.policyHash) fail('POLICY_SCOPE_CHANGED');
    if (Date.parse(scope.expiresAt) <= currentTimeMs()) fail('DELEGATION_EXPIRED');
    return { status: 'ACTIVE', policyHash: actualHash, reason: null, walletState, policies };
  }

  async function verifyWalletLink(input = {}) {
    assertExactKeys(input, ['walletAddress']);
    requireConfigured();
    const { walletAddress } = input;
    const state = await readWalletOwnership(walletAddress);
    return {
      providerWalletId: state.providerWalletId,
      walletAddress: state.walletAddress,
      userId: state.userId,
      ownerId: state.ownerId,
    };
  }

  async function prepareDelegation(input = {}) {
    assertExactKeys(input, ['link', 'mandate', 'rules']);
    const { link, mandate, rules } = input;
    const state = await verifyWallet(link);
    await assertWorkerSignerKey();
    const scope = assertPolicyRules(rules, { walletAddress: state.walletAddress, mandate });
    if (Date.parse(scope.expiresAt) <= currentTimeMs()) fail('DELEGATION_EXPIRED');
    if (getSigner(state.wallet)) fail('DELEGATION_ALREADY_INSTALLED');
    const ruleHash = digest({ walletAddress: state.walletAddress, userId: state.userId, signerId, expiresAt: scope.expiresAt, rules });
    const policyName = `FalconOS lending ${ruleHash.slice(0, 16)}`;
    const body = {
      name: policyName,
      version: '1.0',
      chain_type: 'solana',
      owner: { user_id: state.userId },
      rules,
    };
    const idempotencyKey = `falcon-lending-policy-${digest({ appId: id, ownerId: state.ownerId, ruleHash })}`;
    const created = await requestJSON('POST', '/v1/policies', { body, idempotencyKey });
    const policy = normalizePolicy(created);
    if (policy.chain_type !== 'solana' || policy.version !== '1.0'
        || canonicalJSON(policy.rules) !== canonicalJSON(normalizePolicyRules(rules))) fail('POLICY_RESOURCE_INVALID');
    await assertCustomerOwner(policy.owner_id, state.userId);
    const policies = await getPolicySet([policy.id], state.userId, normalizePolicyRules(rules));
    const policyHash = hashPolicySet({ appId: id, link: state, signerId, expiresAt: scope.expiresAt, policies });
    return {
      policyIds: [policy.id],
      policyHash,
      signerId,
      expiresAt: scope.expiresAt,
      summary: [
        'One customer-owned Solana lending policy was created for the reviewed reserve instructions.',
        'The scoped signer is not installed until the customer explicitly approves it in Privy.',
        `The policy expires at ${scope.expiresAt}.`,
      ],
    };
  }

  async function verifyDelegation(input = {}) {
    assertExactKeys(input, ['link', 'mandate', 'delegation', 'rules']);
    const { link, mandate, delegation, rules } = input;
    try {
      const { status, policyHash, reason } = await verifyDelegationState({ link, mandate, delegation, rules });
      return { status, policyHash, reason };
    } catch (error) {
      const code = safeReason(error);
      const status = code === 'DELEGATION_EXPIRED' ? 'EXPIRED'
        : code === 'DELEGATION_REVOKED' ? 'REVOKED' : 'UNAVAILABLE';
      return { status, policyHash: null, reason: code };
    }
  }

  async function signTransaction(input = {}) {
    assertExactKeys(input, ['link', 'mandate', 'delegation', 'rules', 'transactionBase64']);
    const { link, mandate, delegation, rules, transactionBase64 } = input;
    const envelope = assertDelegationEnvelope(delegation);
    const verification = await verifyDelegationState({ link, mandate, delegation, rules });
    if (verification.status !== 'ACTIVE') {
      fail(verification.status === 'EXPIRED' ? 'DELEGATION_EXPIRED' : 'DELEGATION_INVALID');
    }
    const transaction = parseBase64(transactionBase64, MAX_SOLANA_TRANSACTION_BYTES);
    const body = {
      chain_type: 'solana',
      method: 'signTransaction',
      params: { encoding: 'base64', transaction: transaction.toString('base64') },
    };
    const url = apiURL(`/v1/wallets/${encodeURIComponent(verification.walletState.providerWalletId)}/rpc`);
    const requestExpiry = Math.min(currentTimeMs() + SIGNATURE_WINDOW_MS, Date.parse(envelope.expiresAt));
    const idempotencyKey = `falcon-solana-sign-${digest({ wallet: verification.walletState.providerWalletId, message: body.params.transaction })}`;
    const authorizationSignature = buildAuthorizationSignature({ method: 'POST', url, body, requestExpiry, idempotencyKey });
    const response = await requestJSON('POST', url.pathname, {
      body,
      idempotencyKey,
      requestExpiry,
      authorizationSignature,
    });
    if (!isRecord(response) || response.method !== 'signTransaction' || !isRecord(response.data)
        || response.data.encoding !== 'base64' || typeof response.data.signed_transaction !== 'string') {
      fail('PROVIDER_RESPONSE_INVALID');
    }
    const signedTransaction = parseBase64(response.data.signed_transaction, MAX_SOLANA_TRANSACTION_BYTES);
    return { signedTransactionBase64: signedTransaction.toString('base64') };
  }

  async function prepareRevocation(input = {}) {
    assertExactKeys(input, ['link', 'delegation']);
    const { link, delegation } = input;
    const envelope = assertDelegationEnvelope(delegation);
    const state = await verifyWallet(link);
    await assertWorkerSignerKey();
    const signers = state.wallet.additional_signers;
    if (!Array.isArray(signers) || signers.length > MAX_SIGNERS) fail('WALLET_RESOURCE_INVALID');
    const signerIds = signers.map(item => {
      if (!isRecord(item) || typeof item.signer_id !== 'string') fail('WALLET_RESOURCE_INVALID');
      return assertResourceId(item.signer_id);
    });
    const policyIds = signerPolicyIds(getSigner(state.wallet));
    if (new Set(signerIds).size !== signerIds.length || !signerIds.includes(signerId)) fail('DELEGATION_NOT_INSTALLED');
    if (!policyIds || policyIds.length !== envelope.policyIds.length
        || policyIds.some((value, index) => value !== envelope.policyIds[index])) fail('POLICY_SCOPE_CHANGED');
    return {
      walletAddress: state.walletAddress,
      signerIds,
      scope: 'ALL_DELEGATED_SIGNERS',
      warning: 'This action removes every additional signer from this dedicated Falcon wallet. The customer wallet owner is not changed.',
    };
  }

  async function revokeDelegation(input = {}) {
    assertExactKeys(input, ['link', 'delegation']);
    const { link, delegation } = input;
    const envelope = assertDelegationEnvelope(delegation);
    const state = await verifyWallet(link);
    await assertWorkerSignerKey();
    if (state.wallet.additional_signers.length !== 0) fail('REVOCATION_INCOMPLETE');
    return { status: 'REVOKED', policyHash: envelope.policyHash, reason: null };
  }

  return Object.freeze({
    configuration() {
      return { configured, appId: id, signerId, issues: [...issues] };
    },
    verifyWalletLink,
    prepareDelegation,
    verifyDelegation,
    signTransaction,
    prepareRevocation,
    revokeDelegation,
  });
}
