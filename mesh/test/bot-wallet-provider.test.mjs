import assert from 'node:assert/strict';
import { generateKeyPairSync, verify as cryptoVerify } from 'node:crypto';
import test from 'node:test';
import { exportJWK, generateKeyPair, SignJWT } from 'jose';
import { createWalletProvider, WalletProviderError } from '../cfo/wallet-provider.mjs';

const APP_ID = 'falcon_lending_test_app';
const APP_SECRET = 'test-only-app-secret';
const USER_ID = 'did:privy:customer_01';
const OTHER_USER_ID = 'did:privy:customer_02';
const WALLET_ID = 'wallet_customer_01';
const OWNER_QUORUM_ID = 'customer_owner_quorum';
const WORKER_SIGNER_ID = 'falcon_worker_signer';
const POLICY_ID = 'customer_lending_policy';
const WORKER_OWNER_ID = 'worker_owned_policy_quorum';
const KLEND_PROGRAM_ID = 'KLend2g3cP87fffoy8q1mQqGKjrxjC8boSyAYavgmjD';
const USDC_MINT = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
const TOKEN_PROGRAM = 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA';
const INSTRUCTIONS_SYSVAR = 'Sysvar1nstructions1111111111111111111111111';
const RESERVES = [
  'D6q6wuQSrifJKZYpR1M8R4YawnLDtDsMmWM1NbBmgJ59',
  'Ga4rZytCpq1unD4DbEJ5bkHeUz9g3oh9AAFEi6vSauXp',
];
const MARKETS = {
  [RESERVES[0]]: '7u3HeHxYDLhnCoErrtycNokbQYbWGzLs6JSDqGAv5PfF',
  [RESERVES[1]]: 'DxXdAyU3kCjnyggvHmY5nAwg5cRbbmdyX3npfDMjjMek',
};
const BASE_UNITS = '2500000';
const B58 = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
const CLOCK = new Date();
const NOW = CLOCK.toISOString();

function encodeBase58(bytes) {
  let value = BigInt(`0x${Buffer.from(bytes).toString('hex')}`);
  let encoded = '';
  while (value > 0n) {
    const remainder = Number(value % 58n);
    value /= 58n;
    encoded = B58[remainder] + encoded;
  }
  const leadingZeros = Buffer.from(bytes).findIndex(byte => byte !== 0);
  const prefix = '1'.repeat(leadingZeros < 0 ? bytes.length : leadingZeros);
  return prefix + (encoded || (prefix ? '' : '1'));
}

function address(seed) {
  const bytes = Buffer.alloc(32, seed);
  bytes[0] = seed + 1;
  return encodeBase58(bytes);
}

function canonicalJSON(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJSON).join(',')}]`;
  return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonicalJSON(value[key])}`).join(',')}}`;
}

function jsonResponse(value, status = 200) {
  return new Response(JSON.stringify(value), { status, headers: { 'content-type': 'application/json' } });
}

const walletKeypair = generateKeyPairSync('ed25519');
const walletAddress = walletKeypair.publicKey.export({ format: 'der', type: 'spki' }).subarray(-32);
const WALLET_ADDRESS = encodeBase58(walletAddress);
const jwtKeysPromise = generateKeyPair('ES256');

const IDL = {
  address: KLEND_PROGRAM_ID,
  metadata: { name: 'kamino_lending', version: '1.25.0', spec: '0.1.0' },
  instructions: [
    {
      name: 'depositReserveLiquidity',
      discriminator: [169, 201, 30, 126, 6, 205, 102, 68],
      accounts: [
        { name: 'owner', writable: false, signer: true },
        { name: 'reserve', writable: true, signer: false },
        { name: 'lendingMarket', writable: false, signer: false },
        { name: 'lendingMarketAuthority', writable: false, signer: false },
        { name: 'reserveLiquidityMint', writable: false, signer: false },
        { name: 'reserveLiquiditySupply', writable: true, signer: false },
        { name: 'reserveCollateralMint', writable: true, signer: false },
        { name: 'userSourceLiquidity', writable: true, signer: false },
        { name: 'userDestinationCollateral', writable: true, signer: false },
        { name: 'collateralTokenProgram', writable: false, signer: false },
        { name: 'liquidityTokenProgram', writable: false, signer: false },
        { name: 'instructionSysvarAccount', writable: false, signer: false },
      ],
      args: [{ name: 'liquidityAmount', type: 'u64' }],
    },
    {
      name: 'redeemReserveCollateral',
      discriminator: [234, 117, 181, 125, 185, 142, 220, 29],
      accounts: [
        { name: 'owner', writable: false, signer: true },
        { name: 'lendingMarket', writable: false, signer: false },
        { name: 'reserve', writable: true, signer: false },
        { name: 'lendingMarketAuthority', writable: false, signer: false },
        { name: 'reserveLiquidityMint', writable: false, signer: false },
        { name: 'reserveCollateralMint', writable: true, signer: false },
        { name: 'reserveLiquiditySupply', writable: true, signer: false },
        { name: 'userSourceCollateral', writable: true, signer: false },
        { name: 'userDestinationLiquidity', writable: true, signer: false },
        { name: 'collateralTokenProgram', writable: false, signer: false },
        { name: 'liquidityTokenProgram', writable: false, signer: false },
        { name: 'instructionSysvarAccount', writable: false, signer: false },
      ],
      args: [{ name: 'collateralAmount', type: 'u64' }],
    },
    {
      name: 'refreshReserve',
      discriminator: [2, 218, 138, 235, 79, 201, 25, 102],
      accounts: [
        { name: 'reserve', writable: true, signer: false },
        { name: 'lendingMarket', writable: false, signer: false },
        { name: 'pythOracle', writable: false, signer: false },
        { name: 'switchboardPriceOracle', writable: false, signer: false },
        { name: 'switchboardTwapOracle', writable: false, signer: false },
        { name: 'scopePrices', writable: false, signer: false },
      ],
      args: [],
    },
  ],
};

function makeMandate(expiresAt = new Date(Date.parse(NOW) + 60 * 60 * 1000).toISOString()) {
  return { reserves: [...RESERVES], maxActionBaseUnits: BASE_UNITS, expiresAt };
}

function makeRules(wallet = WALLET_ADDRESS, mandate = makeMandate()) {
  const expiry = String(Math.floor(Date.parse(mandate.expiresAt) / 1000));
  const rules = [];
  for (const reserve of RESERVES) {
    const reserveIndex = RESERVES.indexOf(reserve);
    for (const instructionName of ['depositReserveLiquidity', 'redeemReserveCollateral', 'refreshReserve']) {
      const instruction = IDL.instructions.find(item => item.name === instructionName);
      const ruleIdl = { ...IDL, instructions: [instruction] };
      const conditions = [
        { field_source: 'solana_program_instruction', field: 'programId', operator: 'eq', value: KLEND_PROGRAM_ID },
        { field_source: 'solana_instruction_data', field: 'instruction_name', idl: ruleIdl, operator: 'eq', value: instructionName },
      ];
      for (const account of instruction.accounts) {
        let value;
        if (account.name === 'owner') value = wallet;
        else if (account.name === 'reserve') value = reserve;
        else if (account.name === 'lendingMarket') value = MARKETS[reserve];
        else if (account.name === 'reserveLiquidityMint') value = USDC_MINT;
        else if (account.name === 'reserveCollateralMint') value = address(30 + reserveIndex);
        else if (account.name === 'userSourceLiquidity' || account.name === 'userDestinationLiquidity') value = address(40 + reserveIndex);
        else if (account.name === 'userDestinationCollateral' || account.name === 'userSourceCollateral') value = address(50 + reserveIndex);
        else if (account.name === 'lendingMarketAuthority') value = address(60 + reserveIndex);
        else if (account.name === 'reserveLiquiditySupply') value = address(70 + reserveIndex);
        else if (account.name === 'collateralTokenProgram' || account.name === 'liquidityTokenProgram') value = TOKEN_PROGRAM;
        else if (account.name === 'instructionSysvarAccount') value = INSTRUCTIONS_SYSVAR;
        else value = address(80 + instruction.accounts.indexOf(account));
        conditions.push({
          field_source: 'solana_instruction_data',
          field: `${instructionName}.accounts.${account.name}`,
          idl: ruleIdl,
          operator: 'eq',
          value,
        });
      }
      const amountArg = instruction.args[0];
      if (amountArg) {
        conditions.push({
          field_source: 'solana_instruction_data',
          field: `${instructionName}.args.${amountArg.name}`,
          idl: ruleIdl,
          operator: 'lte',
          value: mandate.maxActionBaseUnits,
        });
      }
      conditions.push({ field_source: 'system', field: 'current_unix_timestamp', operator: 'lte', value: expiry });
      const label = instructionName === 'refreshReserve' ? 'Kamino reserve refresh'
        : instructionName === 'depositReserveLiquidity' ? 'Kamino USDC supply' : 'Kamino USDC redeem';
      rules.push({ name: `${label} ${reserve}`, method: 'signTransaction', action: 'ALLOW', conditions });
    }
  }
  return rules;
}

function policyRecord(rules, ownerId = OWNER_QUORUM_ID) {
  return {
    id: POLICY_ID,
    name: 'Privy customer-owned policy',
    version: '1.0',
    chain_type: 'solana',
    created_at: Date.now(),
    owner_id: ownerId,
    rules: rules.map((rule, index) => ({ id: `policy_rule_${index}`, ...structuredClone(rule) })),
  };
}

async function makeFixture({
  userId = USER_ID,
  walletOwnerId = OWNER_QUORUM_ID,
  walletOwnerUserIds = null,
  policyOwnerId = OWNER_QUORUM_ID,
  linkedAddress = WALLET_ADDRESS,
  walletAddressInProvider = WALLET_ADDRESS,
  installedSigners = [],
} = {}) {
  const [{ publicKey: jwtPublicKey, privateKey: jwtPrivateKey }, backendPair] = await Promise.all([
    jwtKeysPromise,
    Promise.resolve(generateKeyPairSync('ec', { namedCurve: 'prime256v1' })),
  ]);
  const jwk = await exportJWK(jwtPublicKey);
  jwk.kid = 'privy-access-key';
  jwk.use = 'sig';
  jwk.alg = 'ES256';
  const backendPrivateKey = backendPair.privateKey.export({ format: 'der', type: 'pkcs8' }).toString('base64');
  const backendPublicKey = backendPair.publicKey.export({ format: 'der', type: 'spki' }).toString('base64');
  const mandate = makeMandate();
  const rules = makeRules(WALLET_ADDRESS, mandate);
  const signerQ = {
    id: WORKER_SIGNER_ID,
    authorization_threshold: 1,
    authorization_keys: [{ public_key: backendPublicKey, display_name: 'Falcon test signer' }],
    user_ids: null,
    key_quorum_ids: [],
  };
  const ownerQ = {
    id: OWNER_QUORUM_ID,
    authorization_threshold: 1,
    authorization_keys: [],
    user_ids: [userId],
    key_quorum_ids: [],
  };
  const walletOwnerQ = { ...ownerQ, id: walletOwnerId, user_ids: walletOwnerUserIds ?? [userId] };
  const workerOwnerQ = {
    id: WORKER_OWNER_ID,
    authorization_threshold: 1,
    authorization_keys: [{ public_key: backendPublicKey, display_name: 'Worker-owned policy' }],
    user_ids: null,
    key_quorum_ids: [],
  };
  const state = {
    userId,
    wallet: {
      id: WALLET_ID,
      address: walletAddressInProvider,
      chain_type: 'solana',
      owner_id: walletOwnerId,
      entity: { type: 'user', id: userId },
      additional_signers: structuredClone(installedSigners),
      policy_ids: [],
      archived_at: null,
    },
    user: {
      id: userId,
      created_at: 1,
      has_accepted_terms: true,
      is_guest: false,
      linked_accounts: [{
        id: WALLET_ID,
        address: linkedAddress,
        chain_type: 'solana',
        connector_type: 'embedded',
        wallet_client: 'privy',
        type: 'wallet',
        user_can_sign: true,
      }],
      mfa_methods: [],
    },
    policy: policyRecord(rules, policyOwnerId),
    quorums: new Map([
      [OWNER_QUORUM_ID, ownerQ],
      [WORKER_OWNER_ID, workerOwnerQ],
      [WORKER_SIGNER_ID, signerQ],
      [walletOwnerId, walletOwnerQ],
    ]),
    rules,
    mandate,
    requests: [],
    createPolicyCalls: 0,
    rpcCalls: [],
    signedTransaction: Buffer.alloc(110, 0x7a).toString('base64'),
  };
  state.wallet.owner_id = walletOwnerId;
  state.user.id = userId;
  if (policyOwnerId === WORKER_OWNER_ID) state.quorums.set(WORKER_OWNER_ID, workerOwnerQ);

  const fetchImpl = async (input, init = {}) => {
    const url = new URL(input);
    const method = init.method ?? 'GET';
    const body = init.body === undefined ? null : JSON.parse(init.body);
    const headers = new Headers(init.headers);
    state.requests.push({ method, path: decodeURIComponent(url.pathname), body, headers });
    if (url.origin !== 'https://api.privy.io' || init.redirect === 'follow') return jsonResponse({ error: 'unexpected request' }, 400);
    if (url.pathname === `/v1/apps/${APP_ID}/jwks.json`) return jsonResponse({ keys: [jwk] });
    if (!headers.has('authorization') || headers.get('authorization') !== `Basic ${Buffer.from(`${APP_ID}:${APP_SECRET}`).toString('base64')}`) {
      return jsonResponse({ error: 'bad app authentication' }, 401);
    }
    const path = decodeURIComponent(url.pathname);
    if (method === 'GET' && path === `/v1/users/${userId}`) return jsonResponse(state.user);
    if (method === 'POST' && path === '/v1/wallets/address') {
      if (body?.address !== state.wallet.address) return jsonResponse({ error: 'not found' }, 404);
      return jsonResponse(state.wallet);
    }
    if (method === 'GET' && path === `/v1/wallets/${WALLET_ID}`) return jsonResponse(state.wallet);
    if (method === 'GET' && path.startsWith('/v1/key_quorums/')) {
      const quorum = state.quorums.get(path.slice('/v1/key_quorums/'.length));
      return quorum ? jsonResponse(quorum) : jsonResponse({ error: 'not found' }, 404);
    }
    if (method === 'POST' && path === '/v1/policies') {
      state.createPolicyCalls++;
      if (body?.owner?.user_id !== userId || body.chain_type !== 'solana' || body.version !== '1.0'
          || canonicalJSON(body.rules) !== canonicalJSON(state.rules)) return jsonResponse({ error: 'invalid create' }, 400);
      return jsonResponse(state.policy);
    }
    if (method === 'GET' && path === `/v1/policies/${POLICY_ID}`) return jsonResponse(state.policy);
    if (method === 'POST' && path === `/v1/wallets/${WALLET_ID}/rpc`) {
      state.rpcCalls.push({ body, headers });
      if (body?.method !== 'signTransaction' || body?.chain_type !== 'solana'
          || body?.params?.encoding !== 'base64') return jsonResponse({ error: 'wrong signing method' }, 400);
      const signature = headers.get('privy-authorization-signature');
      const signatureInput = {
        version: 1,
        method: 'POST',
        url: url.href,
        body,
        headers: {
          'privy-app-id': headers.get('privy-app-id'),
          'privy-idempotency-key': headers.get('privy-idempotency-key'),
          'privy-request-expiry': headers.get('privy-request-expiry'),
        },
      };
      if (!signature || !cryptoVerify('sha256', Buffer.from(canonicalJSON(signatureInput)), backendPair.publicKey, Buffer.from(signature, 'base64'))) {
        return jsonResponse({ error: 'bad authorization signature' }, 401);
      }
      return jsonResponse({ method: 'signTransaction', data: { encoding: 'base64', signed_transaction: state.signedTransaction } });
    }
    return jsonResponse({ error: 'not found' }, 404);
  };

  async function token({ subject = userId, audience = APP_ID, key = jwtPrivateKey } = {}) {
    return new SignJWT({ sid: 'session_customer_01' })
      .setProtectedHeader({ alg: 'ES256', typ: 'JWT', kid: jwk.kid })
      .setIssuer('privy.io')
      .setAudience(audience)
      .setSubject(subject)
      .setIssuedAt()
      .setExpirationTime('1h')
      .sign(key);
  }

  let currentTime = NOW;
  const provider = createWalletProvider({
    appId: APP_ID,
    appSecret: APP_SECRET,
    authorizationKeyId: WORKER_SIGNER_ID,
    authorizationPrivateKey: backendPrivateKey,
    client: { fetch: fetchImpl },
    now: () => currentTime,
  });
  return { provider, state, token, mandate, rules, userId, walletAddress: WALLET_ADDRESS, setNow(value) { currentTime = value; } };
}

function code(expected) {
  return error => error instanceof WalletProviderError && error.code === expected;
}

test('configuration reports missing runtime settings without exposing secrets', () => {
  const provider = createWalletProvider({ appId: 'app', appSecret: 'secret', authorizationKeyId: 'signer' });
  const config = provider.configuration();
  assert.equal(config.configured, false);
  assert.equal(config.appId, 'app');
  assert.equal(config.signerId, 'signer');
  assert.equal(JSON.stringify(config).includes('secret'), false);
  assert.ok(config.issues.length > 0);
});

test('wallet link rejects wrong JWT audience before protected wallet reads', async () => {
  const fixture = await makeFixture();
  const wrongAudience = await fixture.token({ audience: 'different_privy_app' });
  await assert.rejects(fixture.provider.verifyWalletLink({ accessToken: wrongAudience, walletAddress: fixture.walletAddress }), code('AUTHENTICATION_FAILED'));
  assert.equal(fixture.state.requests.some(request => request.path === `/v1/users/${USER_ID}`), false);
  assert.equal(fixture.state.requests.some(request => request.path === '/v1/wallets/address'), false);
});

test('wallet link rejects another JWT user and an unlinked address', async () => {
  const fixture = await makeFixture();
  const otherUserToken = await fixture.token({ subject: OTHER_USER_ID });
  await assert.rejects(fixture.provider.prepareDelegation({
    accessToken: otherUserToken,
    link: { providerWalletId: WALLET_ID, walletAddress: fixture.walletAddress, userId: USER_ID, ownerId: OWNER_QUORUM_ID },
    mandate: fixture.mandate,
    rules: fixture.rules,
  }), code('WALLET_LINK_INVALID'));
  const otherAddress = encodeBase58(Buffer.alloc(32, 21));
  const token = await fixture.token();
  await assert.rejects(fixture.provider.verifyWalletLink({ accessToken: token, walletAddress: otherAddress }), code('WALLET_OWNERSHIP_MISMATCH'));
  assert.equal(fixture.state.requests.some(request => request.path === '/v1/wallets/address'), false);
});

test('wallet link rejects provider address or owner mismatches', async () => {
  const tokenFixture = await makeFixture({ walletAddressInProvider: address(35) });
  const token = await tokenFixture.token();
  await assert.rejects(tokenFixture.provider.verifyWalletLink({ accessToken: token, walletAddress: tokenFixture.walletAddress }), code('WALLET_OWNERSHIP_MISMATCH'));
  const ownerFixture = await makeFixture({ walletOwnerId: 'worker_owned_wallet', walletOwnerUserIds: [] });
  const ownerToken = await ownerFixture.token();
  await assert.rejects(ownerFixture.provider.verifyWalletLink({ accessToken: ownerToken, walletAddress: ownerFixture.walletAddress }), code('WALLET_OWNERSHIP_MISMATCH'));
});

test('prepareDelegation rejects wildcard and sign-and-send policy encodings before create', async () => {
  const fixture = await makeFixture();
  const accessToken = await fixture.token();
  const link = await fixture.provider.verifyWalletLink({ accessToken, walletAddress: fixture.walletAddress });
  const wildcard = structuredClone(fixture.rules);
  wildcard[0].conditions[0].value = '*';
  await assert.rejects(fixture.provider.prepareDelegation({ accessToken, link, mandate: fixture.mandate, rules: wildcard }), code('POLICY_SCOPE_INVALID'));
  const signAndSend = structuredClone(fixture.rules);
  signAndSend[1].method = 'signAndSendTransaction';
  await assert.rejects(fixture.provider.prepareDelegation({ accessToken, link, mandate: fixture.mandate, rules: signAndSend }), code('POLICY_SCOPE_INVALID'));
  assert.equal(fixture.state.createPolicyCalls, 0);
});

test('prepareDelegation creates a customer-owned policy and binds the real provider wallet', async () => {
  const fixture = await makeFixture();
  const accessToken = await fixture.token();
  const link = await fixture.provider.verifyWalletLink({ accessToken, walletAddress: fixture.walletAddress });
  assert.equal(link.providerWalletId, WALLET_ID);
  assert.equal(link.walletAddress, fixture.walletAddress);
  assert.equal(link.userId, USER_ID);
  assert.equal(link.ownerId, OWNER_QUORUM_ID);
  const delegation = await fixture.provider.prepareDelegation({ accessToken, link, mandate: fixture.mandate, rules: fixture.rules });
  assert.equal(delegation.signerId, WORKER_SIGNER_ID);
  assert.deepEqual(delegation.policyIds, [POLICY_ID]);
  assert.match(delegation.policyHash, /^[a-f0-9]{64}$/);
  assert.equal(delegation.expiresAt, fixture.mandate.expiresAt);
  assert.equal(fixture.state.createPolicyCalls, 1);
  const createRequest = fixture.state.requests.find(request => request.method === 'POST' && request.path === '/v1/policies');
  assert.deepEqual(createRequest.body.owner, { user_id: USER_ID });
  assert.equal(createRequest.headers.has('privy-authorization-signature'), false);
  assert.equal(JSON.stringify(createRequest.body).includes(accessToken), false);
  assert.equal(JSON.stringify(createRequest.body).includes(fixture.state.policy.owner_id), false);
});

test('prepareDelegation rejects a policy resource owned by the worker', async () => {
  const fixture = await makeFixture({ policyOwnerId: WORKER_OWNER_ID });
  const accessToken = await fixture.token();
  const link = await fixture.provider.verifyWalletLink({ accessToken, walletAddress: fixture.walletAddress });
  await assert.rejects(fixture.provider.prepareDelegation({
    accessToken,
    link,
    mandate: fixture.mandate,
    rules: fixture.rules,
  }), code('WALLET_OWNERSHIP_MISMATCH'));
  assert.equal(fixture.state.createPolicyCalls, 1);
  assert.equal(fixture.state.wallet.additional_signers.length, 0);
});

test('verifyDelegation re-reads provider policy scope and rejects digest changes', async () => {
  const fixture = await makeFixture();
  const accessToken = await fixture.token();
  const link = await fixture.provider.verifyWalletLink({ accessToken, walletAddress: fixture.walletAddress });
  const delegation = await fixture.provider.prepareDelegation({ accessToken, link, mandate: fixture.mandate, rules: fixture.rules });
  fixture.state.wallet.additional_signers = [{ signer_id: WORKER_SIGNER_ID, override_policy_ids: [POLICY_ID] }];
  assert.equal((await fixture.provider.verifyDelegation({ link, mandate: fixture.mandate, delegation, rules: fixture.rules })).status, 'ACTIVE');
  const amount = fixture.state.policy.rules[0].conditions.find(condition => condition.field.endsWith('.args.liquidityAmount'));
  amount.value = '999999999';
  const changed = await fixture.provider.verifyDelegation({ link, mandate: fixture.mandate, delegation, rules: fixture.rules });
  assert.equal(changed.status, 'UNAVAILABLE');
  assert.equal(changed.reason, 'POLICY_SCOPE_CHANGED');
});

test('verifyDelegation denies changed local digest, owner and expiry', async () => {
  const fixture = await makeFixture();
  const accessToken = await fixture.token();
  const link = await fixture.provider.verifyWalletLink({ accessToken, walletAddress: fixture.walletAddress });
  const delegation = await fixture.provider.prepareDelegation({ accessToken, link, mandate: fixture.mandate, rules: fixture.rules });
  fixture.state.wallet.additional_signers = [{ signer_id: WORKER_SIGNER_ID, override_policy_ids: [POLICY_ID] }];
  const changed = await fixture.provider.verifyDelegation({ link, mandate: fixture.mandate, delegation: { ...delegation, policyHash: 'a'.repeat(64) }, rules: fixture.rules });
  assert.equal(changed.status, 'UNAVAILABLE');
  fixture.setNow(new Date(Date.parse(delegation.expiresAt) + 1000).toISOString());
  const expired = await fixture.provider.verifyDelegation({ link, mandate: fixture.mandate, delegation, rules: fixture.rules });
  assert.equal(expired.status, 'EXPIRED');
  await assert.rejects(fixture.provider.signTransaction({
    link,
    mandate: fixture.mandate,
    delegation,
    rules: fixture.rules,
    transactionBase64: Buffer.alloc(120, 0x31).toString('base64'),
  }), code('DELEGATION_EXPIRED'));
  fixture.state.wallet.owner_id = 'changed_customer_owner';
  const ownerChanged = await fixture.provider.verifyDelegation({ link, mandate: fixture.mandate, delegation, rules: fixture.rules });
  assert.equal(ownerChanged.status, 'UNAVAILABLE');
});

test('prepareRevocation exposes the authoritative all-signer scope and revoke refuses partial removal', async () => {
  const fixture = await makeFixture();
  const accessToken = await fixture.token();
  const link = await fixture.provider.verifyWalletLink({ accessToken, walletAddress: fixture.walletAddress });
  const delegation = await fixture.provider.prepareDelegation({ accessToken, link, mandate: fixture.mandate, rules: fixture.rules });
  fixture.state.wallet.additional_signers = [
    { signer_id: WORKER_SIGNER_ID, override_policy_ids: [POLICY_ID] },
    { signer_id: 'another_customer_signer', override_policy_ids: [] },
  ];
  const preview = await fixture.provider.prepareRevocation({ accessToken, link });
  assert.equal(preview.scope, 'ALL_DELEGATED_SIGNERS');
  assert.deepEqual(preview.signerIds, [WORKER_SIGNER_ID, 'another_customer_signer']);
  await assert.rejects(fixture.provider.revokeDelegation({ accessToken, link, delegation }), code('REVOCATION_INCOMPLETE'));
  assert.equal(fixture.state.requests.some(request => ['PATCH', 'DELETE'].includes(request.method)), false);
  fixture.state.wallet.additional_signers = [];
  assert.deepEqual(await fixture.provider.revokeDelegation({ accessToken, link, delegation }), {
    status: 'REVOKED', policyHash: delegation.policyHash, reason: null,
  });
});

test('revokeDelegation rejects an owner change even after all signers disappear', async () => {
  const fixture = await makeFixture();
  const accessToken = await fixture.token();
  const link = await fixture.provider.verifyWalletLink({ accessToken, walletAddress: fixture.walletAddress });
  const delegation = await fixture.provider.prepareDelegation({ accessToken, link, mandate: fixture.mandate, rules: fixture.rules });
  fixture.state.wallet.additional_signers = [];
  fixture.state.wallet.owner_id = 'changed_customer_owner';
  await assert.rejects(fixture.provider.revokeDelegation({ accessToken, link, delegation }), code('WALLET_OWNERSHIP_MISMATCH'));
});

test('worker signing is sign-only, scope-bound, bounded, and request-authorized by the scoped key', async () => {
  const fixture = await makeFixture();
  const accessToken = await fixture.token();
  const link = await fixture.provider.verifyWalletLink({ accessToken, walletAddress: fixture.walletAddress });
  const delegation = await fixture.provider.prepareDelegation({ accessToken, link, mandate: fixture.mandate, rules: fixture.rules });
  fixture.state.wallet.additional_signers = [{ signer_id: WORKER_SIGNER_ID, override_policy_ids: [POLICY_ID] }];
  const transactionBase64 = Buffer.alloc(120, 0x31).toString('base64');
  const result = await fixture.provider.signTransaction({ link, mandate: fixture.mandate, delegation, rules: fixture.rules, transactionBase64 });
  assert.equal(result.signedTransactionBase64, fixture.state.signedTransaction);
  assert.equal(fixture.state.rpcCalls.length, 1);
  assert.equal(fixture.state.rpcCalls[0].body.method, 'signTransaction');
  assert.equal(fixture.state.requests.some(request => request.path.includes('/sendTransaction') || request.body?.method === 'signAndSendTransaction'), false);
  await assert.rejects(fixture.provider.signTransaction({
    link, mandate: fixture.mandate, delegation, rules: fixture.rules, transactionBase64: Buffer.alloc(1233).toString('base64'),
  }), code('INVALID_TRANSACTION'));
  assert.equal(fixture.state.rpcCalls.length, 1);
});
