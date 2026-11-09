import assert from 'node:assert/strict';
import { generateKeyPairSync, verify as cryptoVerify } from 'node:crypto';
import test from 'node:test';
import { createWalletProvider, WalletProviderError } from '../cfo/wallet-provider.mjs';

const APP_ID = 'falcon_lending_test_app';
const APP_SECRET = 'test-only-app-secret';
const USER_ID = 'did:privy:customer_01';
const OTHER_USER_ID = 'did:privy:customer_02';
const WALLET_ID = 'wallet_customer_01';
const OWNER_QUORUM_ID = 'customer_owner_quorum';
const POLICY_OWNER_QUORUM_ID = 'customer_policy_owner_quorum';
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
  const backendPair = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
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
  const policyOwnerQ = policyOwnerId === WORKER_OWNER_ID ? workerOwnerQ
    : policyOwnerId === walletOwnerId ? walletOwnerQ
      : policyOwnerId === OWNER_QUORUM_ID ? ownerQ
        : { ...ownerQ, id: policyOwnerId };
  const state = {
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
        wallet_client_type: 'privy',
        imported: false,
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
      [policyOwnerId, policyOwnerQ],
    ]),
    rules,
    mandate,
    requests: [],
    createPolicyCalls: 0,
    rpcCalls: [],
    signedTransaction: Buffer.alloc(110, 0x7a).toString('base64'),
  };

  const fetchImpl = async (input, init = {}) => {
    const url = new URL(input);
    const method = init.method ?? 'GET';
    const body = init.body === undefined ? null : JSON.parse(init.body);
    const headers = new Headers(init.headers);
    state.requests.push({ method, path: decodeURIComponent(url.pathname), body, headers });
    if (url.origin !== 'https://api.privy.io' || init.redirect === 'follow') return jsonResponse({ error: 'unexpected request' }, 400);
    if (!headers.has('authorization') || headers.get('authorization') !== `Basic ${Buffer.from(`${APP_ID}:${APP_SECRET}`).toString('base64')}`) {
      return jsonResponse({ error: 'bad app authentication' }, 401);
    }
    const path = decodeURIComponent(url.pathname);
    if (method === 'POST' && path === '/v1/users/wallet/address') {
      if (!state.user.linked_accounts.some(account => account?.address === body?.address)) return jsonResponse({ error: 'not found' }, 404);
      return jsonResponse(state.user);
    }
    if (method === 'POST' && path === '/v1/wallets/address') {
      if (body?.address !== state.wallet.address) return jsonResponse({ error: 'not found' }, 404);
      return jsonResponse(state.addressWallet ?? state.wallet);
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


  let currentTime = NOW;
  const provider = createWalletProvider({
    appId: APP_ID,
    appSecret: APP_SECRET,
    authorizationKeyId: WORKER_SIGNER_ID,
    authorizationPrivateKey: backendPrivateKey,
    client: { fetch: fetchImpl },
    now: () => currentTime,
  });
  return { provider, state, mandate, rules, walletAddress: WALLET_ADDRESS, setNow(value) { currentTime = value; } };
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

test('V226 derives wallet ownership from app-authenticated user-by-wallet and current resources without entity metadata', async () => {
  const fixture = await makeFixture();
  delete fixture.state.wallet.entity;
  const link = await fixture.provider.verifyWalletLink({ walletAddress: fixture.walletAddress });
  assert.deepEqual(link, {
    providerWalletId: WALLET_ID,
    walletAddress: fixture.walletAddress,
    userId: USER_ID,
    ownerId: OWNER_QUORUM_ID,
  });
  const userLookup = fixture.state.requests.find(request => request.path === '/v1/users/wallet/address');
  assert.equal(userLookup.method, 'POST');
  assert.deepEqual(userLookup.body, { address: fixture.walletAddress });
  assert.equal(userLookup.headers.get('authorization'), `Basic ${Buffer.from(`${APP_ID}:${APP_SECRET}`).toString('base64')}`);
  assert.ok(fixture.state.requests.some(request => request.path === `/v1/wallets/${WALLET_ID}`));
  assert.ok(fixture.state.requests.some(request => request.path === `/v1/key_quorums/${OWNER_QUORUM_ID}`));
});

test('V226 rejects mismatched user, linked/current wallet address, wallet id, owner, and optional entity metadata', async () => {
  const userFixture = await makeFixture();
  userFixture.state.user.id = OTHER_USER_ID;
  delete userFixture.state.wallet.entity;
  await assert.rejects(userFixture.provider.verifyWalletLink({ walletAddress: userFixture.walletAddress }), code('WALLET_OWNERSHIP_MISMATCH'));

  const addressFixture = await makeFixture({ linkedAddress: address(35) });
  await assert.rejects(addressFixture.provider.verifyWalletLink({ walletAddress: addressFixture.walletAddress }), code('WALLET_OWNERSHIP_MISMATCH'));
  assert.equal(addressFixture.state.requests.some(request => request.path === '/v1/wallets/address'), false);

  const currentAddressFixture = await makeFixture({ walletAddressInProvider: address(36) });
  await assert.rejects(currentAddressFixture.provider.verifyWalletLink({ walletAddress: currentAddressFixture.walletAddress }), code('WALLET_OWNERSHIP_MISMATCH'));
  assert.ok(currentAddressFixture.state.requests.some(request => request.path === '/v1/wallets/address'));

  const walletIdFixture = await makeFixture();
  walletIdFixture.state.user.linked_accounts[0].id = 'different_wallet_id';
  await assert.rejects(walletIdFixture.provider.verifyWalletLink({ walletAddress: walletIdFixture.walletAddress }), code('WALLET_OWNERSHIP_MISMATCH'));
  assert.equal(walletIdFixture.state.requests.some(request => request.path === `/v1/wallets/${WALLET_ID}`), false);

  const ownerFixture = await makeFixture();
  ownerFixture.state.addressWallet = { ...ownerFixture.state.wallet, owner_id: 'different_customer_owner' };
  await assert.rejects(ownerFixture.provider.verifyWalletLink({ walletAddress: ownerFixture.walletAddress }), code('WALLET_OWNERSHIP_MISMATCH'));

  const entityFixture = await makeFixture();
  entityFixture.state.wallet.entity = { type: 'user', id: OTHER_USER_ID };
  await assert.rejects(entityFixture.provider.verifyWalletLink({ walletAddress: entityFixture.walletAddress }), code('WALLET_OWNERSHIP_MISMATCH'));
});

test('V226 rejects contradictory entity metadata on the address-lookup wallet', async () => {
  const fixture = await makeFixture();
  fixture.state.addressWallet = {
    ...fixture.state.wallet,
    entity: { type: 'user', id: OTHER_USER_ID },
  };
  await assert.rejects(fixture.provider.verifyWalletLink({ walletAddress: fixture.walletAddress }), code('WALLET_OWNERSHIP_MISMATCH'));
});

test('V226 refuses imported wallets and shared customer owner quorums', async () => {
  const importedFixture = await makeFixture();
  importedFixture.state.user.linked_accounts[0].imported = true;
  await assert.rejects(importedFixture.provider.verifyWalletLink({ walletAddress: importedFixture.walletAddress }), code('WALLET_OWNERSHIP_MISMATCH'));
  assert.equal(importedFixture.state.requests.some(request => request.path === '/v1/wallets/address'), false);

  const sharedFixture = await makeFixture({ walletOwnerUserIds: [USER_ID, OTHER_USER_ID] });
  await assert.rejects(sharedFixture.provider.verifyWalletLink({ walletAddress: sharedFixture.walletAddress }), code('WALLET_OWNERSHIP_MISMATCH'));
});

test('V226 customer owner quorum rejects authorization keys', async () => {
  const fixture = await makeFixture();
  fixture.state.quorums.get(OWNER_QUORUM_ID).authorization_keys = structuredClone(
    fixture.state.quorums.get(WORKER_SIGNER_ID).authorization_keys,
  );
  await assert.rejects(fixture.provider.verifyWalletLink({ walletAddress: fixture.walletAddress }), code('WALLET_OWNERSHIP_MISMATCH'));
});

test('V226 customer owner quorum rejects nested quorums', async () => {
  const fixture = await makeFixture();
  fixture.state.quorums.get(OWNER_QUORUM_ID).key_quorum_ids = [WORKER_SIGNER_ID];
  await assert.rejects(fixture.provider.verifyWalletLink({ walletAddress: fixture.walletAddress }), code('WALLET_OWNERSHIP_MISMATCH'));
});

test('V226 customer owner quorum rejects an invalid authorization threshold', async () => {
  const fixture = await makeFixture();
  fixture.state.quorums.get(OWNER_QUORUM_ID).authorization_threshold = 2;
  await assert.rejects(fixture.provider.verifyWalletLink({ walletAddress: fixture.walletAddress }), code('WALLET_OWNERSHIP_MISMATCH'));
});

test('V226 rejects obsolete owner credential fields on all provider DTOs', async () => {
  const fixture = await makeFixture();
  const credential = 'never-forward-this-owner-token';
  await assert.rejects(fixture.provider.verifyWalletLink({
    walletAddress: fixture.walletAddress,
    accessToken: credential,
    userJwt: credential,
    mfaToken: credential,
    authorizationKey: credential,
  }), code('INVALID_INPUT'));
  assert.equal(fixture.state.requests.length, 0);

  const link = await fixture.provider.verifyWalletLink({ walletAddress: fixture.walletAddress });
  const delegation = await fixture.provider.prepareDelegation({ link, mandate: fixture.mandate, rules: fixture.rules });
  const requestsBefore = fixture.state.requests.length;
  await assert.rejects(fixture.provider.prepareDelegation({
    link, mandate: fixture.mandate, rules: fixture.rules, accessToken: credential,
  }), code('INVALID_INPUT'));
  await assert.rejects(fixture.provider.verifyDelegation({
    link, mandate: fixture.mandate, delegation, rules: fixture.rules, accessToken: credential,
  }), code('INVALID_INPUT'));
  await assert.rejects(fixture.provider.signTransaction({
    link,
    mandate: fixture.mandate,
    delegation,
    rules: fixture.rules,
    transactionBase64: Buffer.alloc(120, 0x31).toString('base64'),
    accessToken: credential,
  }), code('INVALID_INPUT'));
  await assert.rejects(fixture.provider.prepareRevocation({
    link, delegation, accessToken: credential,
  }), code('INVALID_INPUT'));
  await assert.rejects(fixture.provider.revokeDelegation({
    link, delegation, accessToken: credential,
  }), code('INVALID_INPUT'));
  assert.equal(fixture.state.requests.length, requestsBefore);
});

test('prepareDelegation rejects wildcard and sign-and-send policy encodings before create', async () => {
  const fixture = await makeFixture();
  const link = await fixture.provider.verifyWalletLink({ walletAddress: fixture.walletAddress });
  const wildcard = structuredClone(fixture.rules);
  wildcard[0].conditions[0].value = '*';
  await assert.rejects(fixture.provider.prepareDelegation({ link, mandate: fixture.mandate, rules: wildcard }), code('POLICY_SCOPE_INVALID'));
  const signAndSend = structuredClone(fixture.rules);
  signAndSend[1].method = 'signAndSendTransaction';
  await assert.rejects(fixture.provider.prepareDelegation({ link, mandate: fixture.mandate, rules: signAndSend }), code('POLICY_SCOPE_INVALID'));
  assert.equal(fixture.state.createPolicyCalls, 0);
});

test('prepareDelegation creates a customer-owned six-rule policy for the resource-derived wallet', async () => {
  const fixture = await makeFixture();
  const link = await fixture.provider.verifyWalletLink({ walletAddress: fixture.walletAddress });
  assert.equal(link.providerWalletId, WALLET_ID);
  assert.equal(link.walletAddress, fixture.walletAddress);
  assert.equal(link.userId, USER_ID);
  assert.equal(link.ownerId, OWNER_QUORUM_ID);
  const delegation = await fixture.provider.prepareDelegation({ link, mandate: fixture.mandate, rules: fixture.rules });
  assert.equal(delegation.signerId, WORKER_SIGNER_ID);
  assert.deepEqual(delegation.policyIds, [POLICY_ID]);
  assert.match(delegation.policyHash, /^[a-f0-9]{64}$/);
  assert.equal(delegation.expiresAt, fixture.mandate.expiresAt);
  assert.equal(fixture.state.createPolicyCalls, 1);
  const createRequest = fixture.state.requests.find(request => request.method === 'POST' && request.path === '/v1/policies');
  assert.deepEqual(createRequest.body.owner, { user_id: USER_ID });
  assert.equal(createRequest.body.rules.length, 6);
  assert.equal(createRequest.headers.has('privy-authorization-signature'), false);
  assert.equal(JSON.stringify(createRequest.body).includes(fixture.state.policy.owner_id), false);
});

test('prepareDelegation rejects a policy resource owned by the worker', async () => {
  const fixture = await makeFixture({ policyOwnerId: WORKER_OWNER_ID });
  const link = await fixture.provider.verifyWalletLink({ walletAddress: fixture.walletAddress });
  await assert.rejects(fixture.provider.prepareDelegation({
    link,
    mandate: fixture.mandate,
    rules: fixture.rules,
  }), code('WALLET_OWNERSHIP_MISMATCH'));
  assert.equal(fixture.state.createPolicyCalls, 1);
  assert.equal(fixture.state.wallet.additional_signers.length, 0);
});

test('V226 verifies current wallet, signer and policy resources before using a delegation', async () => {
  const fixture = await makeFixture();
  const link = await fixture.provider.verifyWalletLink({ walletAddress: fixture.walletAddress });
  const delegation = await fixture.provider.prepareDelegation({ link, mandate: fixture.mandate, rules: fixture.rules });
  fixture.state.wallet.additional_signers = [{ signer_id: WORKER_SIGNER_ID, override_policy_ids: [POLICY_ID] }];
  const readsBefore = fixture.state.requests.length;
  assert.equal((await fixture.provider.verifyDelegation({ link, mandate: fixture.mandate, delegation, rules: fixture.rules })).status, 'ACTIVE');
  const currentReads = fixture.state.requests.slice(readsBefore);
  assert.ok(currentReads.some(request => request.path === '/v1/users/wallet/address'));
  assert.ok(currentReads.some(request => request.path === `/v1/wallets/${WALLET_ID}`));
  assert.ok(currentReads.some(request => request.path === `/v1/key_quorums/${WORKER_SIGNER_ID}`));
  assert.ok(currentReads.some(request => request.path === `/v1/policies/${POLICY_ID}`));

  fixture.state.wallet.additional_signers[0].override_policy_ids = ['different_policy'];
  const changedSigner = await fixture.provider.verifyDelegation({ link, mandate: fixture.mandate, delegation, rules: fixture.rules });
  assert.equal(changedSigner.status, 'UNAVAILABLE');
  assert.equal(changedSigner.reason, 'POLICY_SCOPE_CHANGED');
  fixture.state.wallet.additional_signers[0].override_policy_ids = [POLICY_ID];
  const amount = fixture.state.policy.rules[0].conditions.find(condition => condition.field.endsWith('.args.liquidityAmount'));
  amount.value = '999999999';
  const changedPolicy = await fixture.provider.verifyDelegation({ link, mandate: fixture.mandate, delegation, rules: fixture.rules });
  assert.equal(changedPolicy.status, 'UNAVAILABLE');
  assert.equal(changedPolicy.reason, 'POLICY_SCOPE_CHANGED');
});

test('V226 rechecks the distinct policy-owner quorum while wallet ownership remains valid', async () => {
  const fixture = await makeFixture({ policyOwnerId: POLICY_OWNER_QUORUM_ID });
  const link = await fixture.provider.verifyWalletLink({ walletAddress: fixture.walletAddress });
  const delegation = await fixture.provider.prepareDelegation({ link, mandate: fixture.mandate, rules: fixture.rules });
  fixture.state.wallet.additional_signers = [{ signer_id: WORKER_SIGNER_ID, override_policy_ids: [POLICY_ID] }];
  fixture.state.quorums.get(POLICY_OWNER_QUORUM_ID).user_ids = [OTHER_USER_ID];
  await fixture.provider.verifyWalletLink({ walletAddress: fixture.walletAddress });

  const verification = await fixture.provider.verifyDelegation({ link, mandate: fixture.mandate, delegation, rules: fixture.rules });
  assert.equal(verification.status, 'UNAVAILABLE');
  assert.equal(verification.reason, 'WALLET_OWNERSHIP_MISMATCH');
});

test('V226 rechecks a valid worker key before delegation verification and signing', async () => {
  const fixture = await makeFixture();
  const link = await fixture.provider.verifyWalletLink({ walletAddress: fixture.walletAddress });
  const delegation = await fixture.provider.prepareDelegation({ link, mandate: fixture.mandate, rules: fixture.rules });
  fixture.state.wallet.additional_signers = [{ signer_id: WORKER_SIGNER_ID, override_policy_ids: [POLICY_ID] }];
  const replacementKey = generateKeyPairSync('ec', { namedCurve: 'prime256v1' }).publicKey
    .export({ format: 'der', type: 'spki' }).toString('base64');
  fixture.state.quorums.get(WORKER_SIGNER_ID).authorization_keys[0].public_key = replacementKey;

  const verification = await fixture.provider.verifyDelegation({ link, mandate: fixture.mandate, delegation, rules: fixture.rules });
  assert.equal(verification.status, 'UNAVAILABLE');
  assert.equal(verification.reason, 'SIGNER_KEY_SCOPE_INVALID');
  await assert.rejects(fixture.provider.signTransaction({
    link,
    mandate: fixture.mandate,
    delegation,
    rules: fixture.rules,
    transactionBase64: Buffer.alloc(120, 0x31).toString('base64'),
  }), code('SIGNER_KEY_SCOPE_INVALID'));
  assert.equal(fixture.state.rpcCalls.length, 0);
});

test('verifyDelegation denies changed digest, owner and expiry', async () => {
  const fixture = await makeFixture();
  const link = await fixture.provider.verifyWalletLink({ walletAddress: fixture.walletAddress });
  const delegation = await fixture.provider.prepareDelegation({ link, mandate: fixture.mandate, rules: fixture.rules });
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

test('prepareRevocation and revokeDelegation use current owner proof and verify all-signer removal', async () => {
  const fixture = await makeFixture();
  const link = await fixture.provider.verifyWalletLink({ walletAddress: fixture.walletAddress });
  const delegation = await fixture.provider.prepareDelegation({ link, mandate: fixture.mandate, rules: fixture.rules });
  fixture.state.wallet.additional_signers = [
    { signer_id: WORKER_SIGNER_ID, override_policy_ids: [POLICY_ID] },
    { signer_id: 'another_customer_signer', override_policy_ids: [] },
  ];
  const preview = await fixture.provider.prepareRevocation({ link, delegation });
  assert.equal(preview.scope, 'ALL_DELEGATED_SIGNERS');
  assert.deepEqual(preview.signerIds, [WORKER_SIGNER_ID, 'another_customer_signer']);
  await assert.rejects(fixture.provider.revokeDelegation({ link, delegation }), code('REVOCATION_INCOMPLETE'));
  assert.equal(fixture.state.requests.some(request => ['PATCH', 'DELETE'].includes(request.method)), false);
  fixture.state.wallet.additional_signers = [];
  assert.deepEqual(await fixture.provider.revokeDelegation({ link, delegation }), {
    status: 'REVOKED', policyHash: delegation.policyHash, reason: null,
  });
  assert.ok(fixture.state.requests.filter(request => request.path === '/v1/users/wallet/address').length >= 4);
});

test('revokeDelegation rejects an owner change after all additional signers disappear', async () => {
  const fixture = await makeFixture();
  const link = await fixture.provider.verifyWalletLink({ walletAddress: fixture.walletAddress });
  const delegation = await fixture.provider.prepareDelegation({ link, mandate: fixture.mandate, rules: fixture.rules });
  fixture.state.wallet.additional_signers = [];
  fixture.state.wallet.owner_id = 'changed_customer_owner';
  await assert.rejects(fixture.provider.revokeDelegation({ link, delegation }), code('WALLET_OWNERSHIP_MISMATCH'));
});

test('worker signing is sign-only, scope-bound, bounded, and request-authorized by the scoped key', async () => {
  const fixture = await makeFixture();
  const link = await fixture.provider.verifyWalletLink({ walletAddress: fixture.walletAddress });
  const delegation = await fixture.provider.prepareDelegation({ link, mandate: fixture.mandate, rules: fixture.rules });
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
