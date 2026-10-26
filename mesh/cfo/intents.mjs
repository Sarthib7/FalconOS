import { createPublicKey, verify } from 'node:crypto';
import { PublicKey } from '@solana/web3.js';
import { verifyQuoteSignature as sdkVerifyQuoteSignature } from '@defuse-protocol/one-click-sdk-typescript';
import { canonicalBytes, freezeDeep, sha256, stableStringify } from '../council/evidence.ts';
import { MeshError } from '../domain.mjs';

const API = 'https://1click.chaindefuser.com';
const NEAR_RPC = 'https://rpc.mainnet.near.org';
const NEARBLOCKS_API = 'https://api.nearblocks.io';
const INTENTS_ACCOUNT = 'intents.near';
const API_BODY_LIMIT = 512 * 1024;
const RPC_BODY_LIMIT = 1024 * 1024;
const PAYLOAD_LIMIT = 32 * 1024;
const TIMEOUT_MS = 8_000;
const MAX_ASSETS = 10_000;
const MAX_TX_HASHES = 32;
const MAX_RECEIPT_TXS = 8;
const U128_MAX = (1n << 128n) - 1n;
const BASE58 = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
const ASSET_RULES = [
  {
    assetId: 'nep141:base-0x0bb69b79bc829e1cfcc34a740110886d98d2bd14.omft.near',
    symbol: 'gtUSDCp', decimals: 18, blockchain: 'base',
    contractAddress: '0x0bb69b79bc829e1cfcc34a740110886d98d2bd14',
  },
  {
    assetId: 'nep141:eth-0x0f38f1ce62776d4a0038bc6cac66877a5687383b.omft.near',
    symbol: 'TLO', decimals: 8, blockchain: 'eth',
    contractAddress: '0x0f38f1ce62776d4a0038bc6cac66877a5687383b',
  },
];
const RESERVE_MINT = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
const INPUT_KEYS = [
  'dry', 'swapType', 'slippageTolerance', 'originAsset', 'depositType', 'destinationAsset',
  'amount', 'refundTo', 'refundType', 'recipient', 'recipientType', 'deadline',
];
const ENVELOPE_KEYS = ['schemaVersion', 'capturedAt', 'raw', 'sha256', 'signatureVerified'];
const SPKI_ED25519_PREFIX = Buffer.from('302a300506032b6570032100', 'hex');

const invalid = message => { throw new MeshError('INVALID_INPUT', message); };
const unavailable = () => { throw new MeshError('STORAGE_UNAVAILABLE', 'NEAR Intents provider data is unavailable or invalid.'); };
const providerInvalid = () => { throw new MeshError('STORAGE_UNAVAILABLE', 'NEAR Intents returned invalid or unverifiable data.'); };
const disabled = () => { throw new MeshError('CONFLICT', 'NEAR Intents provider is disabled; enable it explicitly before requesting provider data.'); };
const unauthorized = message => { throw new MeshError('UNAUTHORIZED', message); };

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    && [Object.prototype, null].includes(Object.getPrototypeOf(value));
}

function exact(value, keys, name, fail = invalid) {
  if (!isRecord(value)) fail(`${name} must be an object.`);
  const own = Reflect.ownKeys(value);
  if (own.length !== keys.length || own.some(key => typeof key !== 'string' || !keys.includes(key))) {
    fail(`${name} has missing or unknown fields.`);
  }
  if (own.some(key => !Object.hasOwn(Object.getOwnPropertyDescriptor(value, key), 'value'))) {
    fail(`${name} must contain data fields.`);
  }
}

function boundedString(value, name, max = 512, fail = invalid) {
  if (typeof value !== 'string' || !value.isWellFormed() || value.length === 0 || value.length > max
      || /[\u0000-\u001f\u007f]/.test(value)) fail(`${name} is invalid.`);
  return value;
}

function utcTime(value, name, fail = invalid) {
  const match = typeof value === 'string' && value.isWellFormed()
    ? /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,9})?Z$/.exec(value)
    : null;
  if (!match) fail(`${name} must be an ISO UTC timestamp.`);
  const [year, month, day, hour, minute, second] = match.slice(1).map(Number);
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const daysInMonth = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  if (year < 1 || month < 1 || month > 12 || day < 1 || day > daysInMonth[month - 1]
      || hour > 23 || minute > 59 || second > 59) fail(`${name} is invalid.`);
  const milliseconds = Date.parse(value);
  if (!Number.isFinite(milliseconds)) fail(`${name} is invalid.`);
  return milliseconds;
}

function canonicalClock(now) {
  let value;
  try { value = now(); } catch { invalid('Provider clock is invalid.'); }
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)
      || !Number.isFinite(Date.parse(value)) || new Date(Date.parse(value)).toISOString() !== value) {
    invalid('Provider clock must return canonical UTC time.');
  }
  return value;
}

function decimalUnits(value, name, fail = invalid, allowZero = false) {
  if (typeof value !== 'string' || value.length > 39 || !/^(0|[1-9]\d*)$/.test(value)) fail(`${name} must be a base-unit integer string.`);
  let amount;
  try { amount = BigInt(value); } catch { fail(`${name} is invalid.`); }
  if (amount > U128_MAX || (!allowZero && amount === 0n)) fail(`${name} is outside the supported range.`);
  return amount;
}

function parseJsonStrict(text) {
  let offset = 0;
  const whitespace = () => { while (offset < text.length && /[\u0009\u000a\u000d\u0020]/.test(text[offset])) offset += 1; };
  const parseString = () => {
    const start = offset;
    if (text[offset] !== '"') throw new Error('Expected JSON string.');
    offset += 1;
    while (offset < text.length) {
      const code = text.charCodeAt(offset);
      if (code === 0x22) {
        offset += 1;
        const value = JSON.parse(text.slice(start, offset));
        if (!value.isWellFormed()) throw new Error('JSON string is not well-formed Unicode.');
        return value;
      }
      if (code < 0x20) throw new Error('JSON string contains a control character.');
      if (code === 0x5c) {
        offset += 1;
        if (offset >= text.length) throw new Error('Truncated JSON escape.');
        const escaped = text[offset];
        if (escaped === 'u') {
          if (!/^[0-9a-fA-F]{4}$/.test(text.slice(offset + 1, offset + 5))) throw new Error('Invalid JSON unicode escape.');
          offset += 5;
          continue;
        }
        if (!'"\\/bfnrt'.includes(escaped)) throw new Error('Invalid JSON escape.');
      }
      offset += 1;
    }
    throw new Error('Unterminated JSON string.');
  };
  const parseValue = depth => {
    if (depth > 64) throw new Error('JSON nesting exceeds limit.');
    whitespace();
    const current = text[offset];
    if (current === '"') { parseString(); return; }
    if (current === '{') {
      offset += 1; whitespace();
      const keys = new Set();
      if (text[offset] === '}') { offset += 1; return; }
      for (;;) {
        whitespace();
        const key = parseString();
        if (keys.has(key)) throw new Error('JSON object has duplicate keys.');
        keys.add(key); whitespace();
        if (text[offset++] !== ':') throw new Error('Invalid JSON object separator.');
        parseValue(depth + 1); whitespace();
        if (text[offset] === '}') { offset += 1; return; }
        if (text[offset++] !== ',') throw new Error('Invalid JSON object delimiter.');
      }
    }
    if (current === '[') {
      offset += 1; whitespace();
      if (text[offset] === ']') { offset += 1; return; }
      for (;;) {
        parseValue(depth + 1); whitespace();
        if (text[offset] === ']') { offset += 1; return; }
        if (text[offset++] !== ',') throw new Error('Invalid JSON array delimiter.');
      }
    }
    const literal = current === 't' ? 'true' : current === 'f' ? 'false' : current === 'n' ? 'null' : null;
    if (literal) {
      if (text.slice(offset, offset + literal.length) !== literal) throw new Error('Invalid JSON literal.');
      offset += literal.length; return;
    }
    const number = /^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/.exec(text.slice(offset));
    if (!number) throw new Error('Invalid JSON value.');
    offset += number[0].length;
  };
  if (typeof text !== 'string') throw new Error('JSON input must be text.');
  parseValue(0); whitespace();
  if (offset !== text.length) throw new Error('Trailing data after JSON value.');
  const parsed = JSON.parse(text);
  const finiteNumbers = value => {
    if (typeof value === 'number' && !Number.isFinite(value)) throw new Error('JSON number is outside the finite range.');
    if (value && typeof value === 'object') Object.values(value).forEach(finiteNumbers);
  };
  finiteNumbers(parsed);
  return parsed;
}

async function readBounded(response, limit, requestedUrl) {
  if (!response || response.redirected || !response.body?.getReader || !Number.isInteger(response.status)) throw new Error('Invalid transport response.');
  if (response.url && new URL(response.url).href !== new URL(requestedUrl).href) throw new Error('Response URL changed.');
  const contentType = response.headers?.get?.('content-type') ?? '';
  if (!/^application\/(?:json|[a-z0-9.+-]+\+json)(?:\s*;|\s*$)/i.test(contentType)) throw new Error('Unexpected content type.');
  const reader = response.body.getReader();
  const chunks = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > limit) { await reader.cancel(); throw new Error('Response exceeds size limit.'); }
    chunks.push(Buffer.from(value));
  }
  return parseJsonStrict(new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks)));
}

async function requestJson(fetchImpl, url, { method = 'GET', body, headers = {}, limit = API_BODY_LIMIT } = {}) {
  const controller = new AbortController();
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => { controller.abort(); reject(new Error('Request timed out.')); }, TIMEOUT_MS);
  });
  try {
    return await Promise.race([timeout, (async () => {
      const response = await fetchImpl(url, {
        method,
        headers: { accept: 'application/json', ...headers, ...(body === undefined ? {} : { 'content-type': 'application/json' }) },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        signal: controller.signal,
        redirect: 'error',
        credentials: 'omit',
        cache: 'no-store',
        referrerPolicy: 'no-referrer',
      });
      if (!response.ok) {
        if (response.status === 401 || response.status === 403) unauthorized('NEAR Intents API credentials are missing or rejected.');
        unavailable();
      }
      return await readBounded(response, limit, url);
    })()]);
  } catch (error) {
    if (error instanceof MeshError) throw error;
    unavailable();
  } finally {
    clearTimeout(timer);
  }
}

function encodeBase58(bytes) {
  const source = Buffer.from(bytes);
  let number = source.length ? BigInt(`0x${source.toString('hex')}`) : 0n;
  let encoded = '';
  while (number > 0n) { encoded = BASE58[Number(number % 58n)] + encoded; number /= 58n; }
  for (const byte of source) { if (byte !== 0) break; encoded = `1${encoded}`; }
  return encoded || '1';
}

function decodeBase58(value, length, name, fail = invalid) {
  if (typeof value !== 'string' || value.length === 0 || value.length > 100) fail(`${name} is invalid.`);
  let number = 0n;
  for (const char of value) {
    const digit = BASE58.indexOf(char);
    if (digit < 0) fail(`${name} is invalid.`);
    number = number * 58n + BigInt(digit);
  }
  let hex = number.toString(16);
  if (hex.length % 2) hex = `0${hex}`;
  let bytes = number === 0n ? Buffer.alloc(0) : Buffer.from(hex, 'hex');
  const leading = value.match(/^1*/)?.[0].length ?? 0;
  bytes = Buffer.concat([Buffer.alloc(leading), bytes]);
  if (bytes.length !== length || encodeBase58(bytes) !== value) fail(`${name} is invalid.`);
  return bytes;
}

function publicKeyBytes(wallet, fail = invalid) {
  if (typeof wallet !== 'string' || wallet.length > 64) fail('Wallet must be a canonical Solana Ed25519 address.');
  try {
    const key = new PublicKey(wallet);
    if (key.toBase58() !== wallet) fail('Wallet must be a canonical Solana Ed25519 address.');
    return key.toBuffer();
  } catch { fail('Wallet must be a canonical Solana Ed25519 address.'); }
}

function signerIdFor(wallet, fail = invalid) { return publicKeyBytes(wallet, fail).toString('hex'); }
function signerIdBytes(value, fail = invalid) {
  if (typeof value !== 'string' || !/^[0-9a-f]{64}$/.test(value)) fail('Intents signer ID must be the lowercase hex encoding of the wallet public key.');
  return Buffer.from(value, 'hex');
}
function ed25519PublicKey(bytes) {
  return createPublicKey({ key: Buffer.concat([SPKI_ED25519_PREFIX, bytes]), format: 'der', type: 'spki' });
}

function apiHeaders(apiKey, required = false) {
  if (apiKey === null && !required) return {};
  if (typeof apiKey !== 'string' || apiKey.length === 0 || apiKey.length > 4096 || /[\r\n]/.test(apiKey)) {
    unauthorized('A valid NEAR Intents API key is required for this operation.');
  }
  return { 'X-API-Key': apiKey };
}

function listTokenRows(rows) {
  if (!Array.isArray(rows) || rows.length > MAX_ASSETS) providerInvalid();
  const ids = new Set();
  for (const row of rows) {
    if (!isRecord(row)) providerInvalid();
    const id = row.assetId;
    if (typeof id !== 'string' || !id || id.length > 256 || !id.isWellFormed() || ids.has(id)) providerInvalid();
    ids.add(id);
    if (!Number.isSafeInteger(row.decimals) || row.decimals < 0 || row.decimals > 38
        || typeof row.blockchain !== 'string' || row.blockchain.length > 32
        || typeof row.symbol !== 'string' || row.symbol.length > 64
        || (row.contractAddress !== undefined && row.contractAddress !== null
          && (typeof row.contractAddress !== 'string' || row.contractAddress.length > 256))) providerInvalid();
  }
  return rows;
}

function supportedAssets(rows) {
  listTokenRows(rows);
  const reserveCandidates = rows.filter(row => row.blockchain === 'sol' && row.contractAddress === RESERVE_MINT);
  if (reserveCandidates.length !== 1) providerInvalid();
  const reserve = reserveCandidates[0];
  if (reserve.decimals !== 6 || reserve.symbol !== 'USDC') providerInvalid();
  const assets = [{
    assetId: reserve.assetId,
    symbol: 'USDC',
    decimals: 6,
    blockchain: 'sol',
    contractAddress: RESERVE_MINT,
    kind: 'reserve',
    protocol: null,
  }];
  for (const rule of ASSET_RULES) {
    const candidates = rows.filter(row => row.assetId === rule.assetId);
    if (candidates.length !== 1) providerInvalid();
    const row = candidates[0];
    if (row.symbol !== rule.symbol || row.decimals !== rule.decimals || row.blockchain !== rule.blockchain
        || row.contractAddress !== rule.contractAddress) providerInvalid();
    assets.push({ ...rule, kind: 'receipt', protocol: null });
  }
  return assets;
}

function resolveAsset(assets, assetId, name) {
  const asset = assets.find(candidate => candidate.assetId === assetId);
  if (!asset) invalid(`${name} is not in the currently supported NEAR Intents asset registry.`);
  return asset;
}

function validateQuoteInput(input, now) {
  exact(input, ['signerId', 'originAsset', 'destinationAsset', 'amount', 'slippageBps', 'dry', 'deadline'], 'Quote request');
  signerIdBytes(input.signerId);
  boundedString(input.originAsset, 'Origin asset ID', 256);
  boundedString(input.destinationAsset, 'Destination asset ID', 256);
  if (input.originAsset === input.destinationAsset) invalid('Origin and destination assets must differ.');
  decimalUnits(input.amount, 'Quote amount');
  if (!Number.isInteger(input.slippageBps) || input.slippageBps < 0 || input.slippageBps > 10_000) invalid('Slippage must be integer basis points from 0 to 10000.');
  if (typeof input.dry !== 'boolean') invalid('Quote dry flag must be boolean.');
  const deadlineMs = utcTime(input.deadline, 'Quote deadline');
  if (deadlineMs <= Date.parse(canonicalClock(now))) invalid('Quote deadline must be in the future.');
  return input;
}

function quoteRequestFor(input, assets) {
  const origin = resolveAsset(assets, input.originAsset, 'Origin asset');
  const destination = resolveAsset(assets, input.destinationAsset, 'Destination asset');
  if ((origin.kind === 'reserve') === (destination.kind === 'reserve')) {
    invalid('NEAR Intents CFO quotes must exchange the reserve asset and one supported receipt asset.');
  }
  return {
    dry: input.dry,
    swapType: 'EXACT_INPUT',
    slippageTolerance: input.slippageBps,
    originAsset: origin.assetId,
    depositType: 'INTENTS',
    destinationAsset: destination.assetId,
    amount: input.amount,
    refundTo: input.signerId,
    refundType: 'INTENTS',
    recipient: input.signerId,
    recipientType: 'INTENTS',
    deadline: input.deadline,
  };
}

function verifyProviderQuote(raw, verifyQuote, fail = invalid) {
  if (!isRecord(raw) || !isRecord(raw.quoteRequest) || !isRecord(raw.quote)
      || typeof raw.signature !== 'string' || typeof raw.timestamp !== 'string') fail('Quote response is invalid.');
  try {
    if (verifyQuote(raw) !== true) fail('Quote signature is invalid.');
  } catch { fail('Quote signature is invalid.'); }
}

function validateHostQuoteRequest(request, fail = invalid) {
  exact(request, INPUT_KEYS, 'Provider quote request', fail);
  if (typeof request.dry !== 'boolean' || request.swapType !== 'EXACT_INPUT'
      || !Number.isInteger(request.slippageTolerance) || request.slippageTolerance < 0 || request.slippageTolerance > 10_000
      || request.depositType !== 'INTENTS' || request.refundType !== 'INTENTS' || request.recipientType !== 'INTENTS') {
    fail('Provider quote request is outside the CFO execution contract.');
  }
  signerIdBytes(request.recipient, fail);
  if (request.refundTo !== request.recipient) fail('Provider quote owner fields do not match.');
  boundedString(request.originAsset, 'Origin asset ID', 256, fail);
  boundedString(request.destinationAsset, 'Destination asset ID', 256, fail);
  if (request.originAsset === request.destinationAsset) fail('Provider quote assets must differ.');
  decimalUnits(request.amount, 'Quote amount', fail);
  utcTime(request.deadline, 'Requested expiry', fail);
}

function validateQuotePayload(raw, expectedRequest, fail = invalid) {
  if (!isRecord(raw) || !isRecord(raw.quoteRequest) || !isRecord(raw.quote)) fail('Quote response is invalid.');
  validateHostQuoteRequest(raw.quoteRequest, fail);
  if (stableStringify(raw.quoteRequest) !== stableStringify(expectedRequest)) fail('Quote request echo does not match the host-owned request.');
  const response = raw.quote;
  for (const field of ['amountIn', 'minAmountIn', 'amountOut', 'minAmountOut']) decimalUnits(response[field], `Quote ${field}`, fail);
  if (response.amountIn !== expectedRequest.amount) fail('Quote input amount does not match the exact-input request.');
  if (BigInt(response.minAmountOut) > BigInt(response.amountOut)) fail('Quote minimum output exceeds quoted output.');
  if (typeof response.timeEstimate !== 'number' || !Number.isFinite(response.timeEstimate) || response.timeEstimate < 0) fail('Quote time estimate is invalid.');
  for (const key of ['amountInFormatted', 'amountInUsd', 'amountOutFormatted', 'amountOutUsd']) {
    if (typeof response[key] !== 'string' || !response[key].isWellFormed() || response[key].length > 128) fail(`Quote ${key} is invalid.`);
  }
  if (raw.quoteRequest.dry) {
    if (Object.hasOwn(response, 'depositAddress') || Object.hasOwn(response, 'deadline')) fail('Dry quote must not contain execution fields.');
  } else {
    if (typeof response.depositAddress !== 'string' || !response.depositAddress.length
        || response.depositAddress.length > 512 || !response.depositAddress.isWellFormed()
        || response.depositAddress.includes('\0')) fail('Executable quote deposit identifier is invalid.');
    if (utcTime(response.deadline, 'Quote expiry', fail) !== utcTime(expectedRequest.deadline, 'Requested expiry', fail)
        || response.deadline !== expectedRequest.deadline) fail('Executable quote expiry does not match the requested expiry.');
    if (typeof response.depositMemo === 'string' && (!response.depositMemo.isWellFormed() || response.depositMemo.length > 256)) fail('Quote deposit memo is invalid.');
  }
  for (const fee of ['refundFee', 'withdrawFee']) {
    if (response[fee] !== undefined && response[fee] !== null) decimalUnits(response[fee], `Quote ${fee}`, fail, true);
  }
  if (typeof raw.correlationId !== 'string' || !raw.correlationId || raw.correlationId.length > 128) fail('Quote correlation ID is invalid.');
  utcTime(raw.timestamp, 'Quote timestamp', fail);
}

function validateEnvelope(envelope, verifyQuote, { fail = invalid, executable = false } = {}) {
  exact(envelope, ENVELOPE_KEYS, 'Quote envelope', fail);
  if (envelope.schemaVersion !== 1 || envelope.signatureVerified !== true || !/^[a-f0-9]{64}$/.test(envelope.sha256 ?? '')) fail('Quote envelope is invalid.');
  utcTime(envelope.capturedAt, 'Quote capture time', fail);
  if (!isRecord(envelope.raw) || sha256(canonicalBytes(envelope.raw)) !== envelope.sha256) fail('Quote envelope hash does not match raw provider data.');
  verifyProviderQuote(envelope.raw, verifyQuote, fail);
  validateQuotePayload(envelope.raw, envelope.raw.quoteRequest, fail);
  if (utcTime(envelope.raw.timestamp, 'Quote provider timestamp', fail) > Date.parse(envelope.capturedAt)) {
    fail('Quote provider timestamp is in the future.');
  }
  if (executable && envelope.raw.quoteRequest.dry) fail('Dry quotes cannot be signed or executed.');
  return envelope.raw;
}

function parseIntentPayload(payload, fail = invalid) {
  if (typeof payload !== 'string' || !payload.isWellFormed() || Buffer.byteLength(payload, 'utf8') > PAYLOAD_LIMIT) fail('Intent payload is invalid.');
  let message;
  try { message = parseJsonStrict(payload); } catch { fail('Intent payload is not strict JSON.'); }
  exact(message, ['signer_id', 'verifying_contract', 'deadline', 'nonce', 'intents'], 'Intent message', fail);
  boundedString(message.signer_id, 'Intent signer ID', 64, fail);
  if (message.verifying_contract !== INTENTS_ACCOUNT) fail('Intent verifying contract is invalid.');
  utcTime(message.deadline, 'Intent expiry', fail);
  if (typeof message.nonce !== 'string') fail('Intent nonce is invalid.');
  const nonce = Buffer.from(message.nonce, 'base64');
  if (nonce.length !== 32 || nonce.toString('base64') !== message.nonce) fail('Intent nonce must be canonical base64 for 32 bytes.');
  if (!Array.isArray(message.intents) || message.intents.length !== 1) fail('Generated intent must contain exactly one action.');
  const action = message.intents[0];
  exact(action, ['intent', 'diff'], 'Token-diff intent', fail);
  if (action.intent !== 'token_diff' || !isRecord(action.diff)) fail('Only one token-diff intent is supported.');
  const diffKeys = Reflect.ownKeys(action.diff);
  if (diffKeys.length !== 2 || diffKeys.some(key => typeof key !== 'string')) fail('Token-diff must contain exactly two assets.');
  return message;
}

function matchIntentQuote(message, raw, signerId, fail = invalid) {
  const request = raw.quoteRequest;
  const quote = raw.quote;
  if (message.signer_id !== signerId || signerId !== request.recipient || signerId !== request.refundTo) fail('Intent owner does not match the signed quote.');
  if (message.deadline !== quote.deadline || message.deadline !== request.deadline) fail('Intent expiry does not match the signed quote.');
  const diff = message.intents[0].diff;
  if (Reflect.ownKeys(diff).length !== 2 || diff[request.originAsset] !== `-${quote.amountIn}`
      || diff[request.destinationAsset] !== quote.minAmountOut) fail('Generated token-diff does not bind the quoted debit and minimum credit.');
}

function validateSignedData(signedData, fail = invalid) {
  exact(signedData, ['standard', 'payload', 'public_key', 'signature'], 'Signed intent', fail);
  if (signedData.standard !== 'raw_ed25519') fail('Only raw Ed25519 signed intents are supported.');
  const keyText = signedData.public_key;
  if (typeof keyText !== 'string' || !keyText.startsWith('ed25519:')) fail('Signed intent public key must be Ed25519.');
  const publicBytes = decodeBase58(keyText.slice('ed25519:'.length), 32, 'Signed intent public key', fail);
  const signatureText = signedData.signature;
  if (typeof signatureText !== 'string' || !signatureText.startsWith('ed25519:')) fail('Signed intent signature must be Ed25519.');
  const signatureBytes = decodeBase58(signatureText.slice('ed25519:'.length), 64, 'Signed intent signature', fail);
  const message = parseIntentPayload(signedData.payload, fail);
  if (message.signer_id !== publicBytes.toString('hex')) fail('Signed intent owner does not match its Ed25519 public key.');
  let valid = false;
  try { valid = verify(null, Buffer.from(signedData.payload, 'utf8'), ed25519PublicKey(publicBytes), signatureBytes); } catch {}
  if (!valid) fail('Signed intent signature is invalid.');
  return { message, publicBytes, signatureBytes };
}

function rpcBase58Hash(value, name, fail = invalid) {
  decodeBase58(value, 32, name, fail);
  return value;
}

function validPortfolioOwner(portfolio, fail = invalid) {
  if (!isRecord(portfolio) || portfolio.schemaVersion !== 1 || portfolio.chain !== 'near' || portfolio.network !== 'mainnet'
      || portfolio.status !== 'OBSERVED' || !Array.isArray(portfolio.assets) || portfolio.assets.length > 3
      || !Array.isArray(portfolio.balances) || portfolio.balances.length !== portfolio.assets.length) fail('Observed mainnet portfolio is required.');
  const signerId = signerIdFor(portfolio.wallet, fail);
  if (portfolio.signerId !== signerId || !Number.isSafeInteger(portfolio.blockHeight) || portfolio.blockHeight < 1) fail('Portfolio owner or finalized block binding is invalid.');
  rpcBase58Hash(portfolio.blockHash, 'Portfolio block hash', fail);
  utcTime(portfolio.capturedAt, 'Portfolio capture time', fail);
  const assets = new Set();
  for (const asset of portfolio.assets) {
    exact(asset, ['assetId', 'symbol', 'decimals', 'blockchain', 'contractAddress', 'kind', 'protocol'], 'Portfolio asset', fail);
    boundedString(asset.assetId, 'Portfolio asset ID', 256, fail);
    const target = ASSET_RULES.find(rule => rule.assetId === asset.assetId);
    const validReserve = target === undefined && asset.kind === 'reserve' && asset.symbol === 'USDC' && asset.decimals === 6
      && asset.blockchain === 'sol' && asset.contractAddress === RESERVE_MINT && asset.protocol === null;
    const validReceipt = asset.kind === 'receipt' && target !== undefined && asset.symbol === target.symbol
      && asset.decimals === target.decimals && asset.blockchain === target.blockchain
      && asset.contractAddress === target.contractAddress && asset.protocol === null;
    if (assets.has(asset.assetId) || (!validReserve && !validReceipt)) fail('Portfolio asset mapping is invalid.');
    assets.add(asset.assetId);
  }
  const balances = new Set();
  for (const balance of portfolio.balances) {
    exact(balance, ['assetId', 'balanceBaseUnits'], 'Portfolio balance', fail);
    if (!assets.has(balance.assetId) || balances.has(balance.assetId)) fail('Portfolio balances do not match its asset list.');
    decimalUnits(balance.balanceBaseUnits, 'Portfolio balance', fail, true);
    balances.add(balance.assetId);
  }
  return signerId;
}

function checkIntentForQuote(signedData, quoteRaw, signerId, fail) {
  const { message } = validateSignedData(signedData, fail);
  matchIntentQuote(message, quoteRaw, signerId, fail);
  return message;
}

function providerStatusShape(status, fail = providerInvalid) {
  if (!isRecord(status) || !isRecord(status.quoteResponse) || !isRecord(status.swapDetails)
      || typeof status.correlationId !== 'string' || !status.correlationId || status.correlationId.length > 128
      || !['KNOWN_DEPOSIT_TX', 'PENDING_DEPOSIT', 'INCOMPLETE_DEPOSIT', 'PROCESSING', 'SUCCESS', 'REFUNDED', 'FAILED'].includes(status.status)) fail('Status response is invalid.');
  utcTime(status.updatedAt, 'Status update time', fail);
  const details = status.swapDetails;
  for (const key of ['intentHashes', 'nearTxHashes', 'originChainTxHashes', 'destinationChainTxHashes']) {
    if (!Array.isArray(details[key]) || details[key].length > MAX_TX_HASHES * 4) fail('Status transaction list is invalid.');
  }
  for (const hash of details.nearTxHashes) rpcBase58Hash(hash, 'NEAR transaction hash', fail);
  for (const hash of details.intentHashes) rpcBase58Hash(hash, 'Intent hash', fail);
}
function successfulExecutionStatus(status) {
  return isRecord(status) && Reflect.ownKeys(status).length === 1
    && ((Object.hasOwn(status, 'SuccessValue') && typeof status.SuccessValue === 'string')
      || (Object.hasOwn(status, 'SuccessReceiptId') && typeof status.SuccessReceiptId === 'string'));
}


function decodeBase64Json(value, limit) {
  if (typeof value !== 'string' || value.length > Math.ceil(limit / 3) * 4) throw new Error('Invalid base64 payload.');
  const bytes = Buffer.from(value, 'base64');
  if (bytes.length > limit || bytes.toString('base64') !== value) throw new Error('Invalid base64 payload.');
  return parseJsonStrict(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
}

function validNearAccountId(value) {
  return typeof value === 'string' && value.length >= 2 && value.length <= 64 && value.isWellFormed()
    && /^[a-z0-9]+(?:[._-][a-z0-9]+)*$/.test(value);
}

function inspectFinalizedIntentTransaction(result, txHash, senderAccountId, signedData) {
  if (!isRecord(result) || result.final_execution_status !== 'FINAL' || !isRecord(result.transaction)
      || !isRecord(result.transaction_outcome) || !isRecord(result.transaction_outcome.outcome)
      || !Array.isArray(result.receipts_outcome) || result.receipts_outcome.length > 512) return null;
  const transaction = result.transaction;
  if (transaction.hash !== txHash || transaction.signer_id !== senderAccountId
      || transaction.receiver_id !== INTENTS_ACCOUNT || !Array.isArray(transaction.actions)
      || transaction.actions.length !== 1) return null;
  const action = transaction.actions[0];
  if (!isRecord(action) || Reflect.ownKeys(action).length !== 1 || !isRecord(action.FunctionCall)) return null;
  const call = action.FunctionCall;
  if (call.method_name !== 'execute_intents') return null;
  let args;
  try { args = decodeBase64Json(call.args, API_BODY_LIMIT); } catch { return null; }
  if (!isRecord(args) || Reflect.ownKeys(args).length !== 1 || !Array.isArray(args.signed)
      || args.signed.length !== 1 || stableStringify(args.signed[0]) !== stableStringify(signedData)) return null;
  if (!successfulExecutionStatus(result.status)
      || !successfulExecutionStatus(result.transaction_outcome.outcome.status)) return null;
  return { result };
}

function verifiedTokenDiff(finalized, ownerId, intentHash, quoteRaw) {
  const outcomes = [finalized.result.transaction_outcome, ...finalized.result.receipts_outcome];
  let matched = null;
  for (const receipt of outcomes) {
    const outcome = receipt?.outcome;
    if (!isRecord(outcome) || outcome.executor_id !== INTENTS_ACCOUNT || !successfulExecutionStatus(outcome.status)
        || !Array.isArray(outcome.logs) || outcome.logs.length > 256) continue;
    for (const log of outcome.logs) {
      if (typeof log !== 'string' || !log.startsWith('EVENT_JSON:')) continue;
      let event;
      try { event = parseJsonStrict(log.slice('EVENT_JSON:'.length)); } catch { continue; }
      if (!isRecord(event) || event.standard !== 'dip4' || event.version !== '0.3.0'
          || event.event !== 'token_diff' || !Array.isArray(event.data) || event.data.length > 64) continue;
      for (const row of event.data) {
        if (!isRecord(row) || row.account_id !== ownerId
            || (intentHash !== null && row.intent_hash !== intentHash)) continue;
        try { rpcBase58Hash(row.intent_hash, 'Executed intent hash'); } catch { continue; }
        if (matched !== null || !isRecord(row.diff)) return null;
        const diff = row.diff;
        if (Reflect.ownKeys(diff).length !== 2 || diff[quoteRaw.quoteRequest.originAsset] !== `-${quoteRaw.quote.amountIn}`) return null;
        const credit = diff[quoteRaw.quoteRequest.destinationAsset];
        if (typeof credit !== 'string' || !/^[1-9]\d*$/.test(credit) || credit.length > 39) return null;
        const creditAmount = BigInt(credit);
        if (creditAmount < BigInt(quoteRaw.quote.minAmountOut) || creditAmount > U128_MAX) return null;
        matched = {
          intentHash: row.intent_hash,
          amounts: {
            debit: { assetId: quoteRaw.quoteRequest.originAsset, baseUnits: quoteRaw.quote.amountIn },
            credit: { assetId: quoteRaw.quoteRequest.destinationAsset, baseUnits: credit },
          },
        };
      }
    }
  }
  return matched;
}


export function createIntentsAdapter({
  fetchImpl = globalThis.fetch,
  apiKey = null,
  nearblocksApiKey = null,
  enabled = false,
  now = () => new Date().toISOString(),
  verifyQuote = sdkVerifyQuoteSignature,
} = {}) {
  if (typeof fetchImpl !== 'function' || typeof now !== 'function' || typeof verifyQuote !== 'function'
      || typeof enabled !== 'boolean' || (apiKey !== null && typeof apiKey !== 'string')
      || (nearblocksApiKey !== null && (typeof nearblocksApiKey !== 'string' || nearblocksApiKey.length === 0 || nearblocksApiKey.length > 4096 || /[\r\n]/.test(nearblocksApiKey)))) {
    invalid('NEAR Intents adapter options are invalid.');
  }

  const ensureEnabled = () => { if (!enabled) disabled(); };
  const fetchAssets = async () => {
    ensureEnabled();
    const rows = await requestJson(fetchImpl, `${API}/v0/tokens`);
    return supportedAssets(rows);
  };

  let rpcRequestId = 0;
  const resolveNearTransactionSender = async transactionHash => {
    if (nearblocksApiKey === null) return null;
    const url = `${NEARBLOCKS_API}/v3/txns/${encodeURIComponent(transactionHash)}`;
    const response = await requestJson(fetchImpl, url, {
      headers: { authorization: `Bearer ${nearblocksApiKey}` },
      limit: 128 * 1024,
    });
    if (!isRecord(response) || !isRecord(response.data)
        || response.data.transaction_hash !== transactionHash
        || !validNearAccountId(response.data.signer_account_id)) return null;
    return response.data.signer_account_id;
  };
  const queryFinalizedTransaction = async (transactionHash, senderAccountId) => {
    const id = ++rpcRequestId;
    const response = await requestJson(fetchImpl, NEAR_RPC, {
      method: 'POST',
      limit: RPC_BODY_LIMIT,
      body: {
        jsonrpc: '2.0',
        id,
        method: 'tx_status',
        params: { tx_hash: transactionHash, sender_account_id: senderAccountId, wait_until: 'FINAL' },
      },
    });
    if (!isRecord(response) || response.jsonrpc !== '2.0' || response.id !== id
        || Object.hasOwn(response, 'error') || !isRecord(response.result)) return null;
    return response.result;
  };
  const verifyFinalizedIntent = async (nearTxHashes, ownerId, intentHash, signedData, quoteRaw) => {
    if (nearblocksApiKey === null || nearTxHashes.length === 0 || nearTxHashes.length > MAX_RECEIPT_TXS) return null;
    for (const transactionHash of nearTxHashes) {
      let senderAccountId;
      let rpcResult;
      try {
        senderAccountId = await resolveNearTransactionSender(transactionHash);
        if (senderAccountId === null) continue;
        rpcResult = await queryFinalizedTransaction(transactionHash, senderAccountId);
      } catch {
        return null;
      }
      if (!rpcResult) continue;
      const finalized = inspectFinalizedIntentTransaction(rpcResult, transactionHash, senderAccountId, signedData);
      if (!finalized) continue;
      const proof = verifiedTokenDiff(finalized, ownerId, intentHash, quoteRaw);
      if (proof) return { status: 'CONFIRMED', ...proof };
    }
    return null;
  };

  const fetchPortfolio = async wallet => {
    ensureEnabled();
    const signerId = signerIdFor(wallet);
    const assets = await fetchAssets();
    const tokenIds = assets.map(asset => asset.assetId);
    const body = {
      jsonrpc: '2.0', id: 1, method: 'query',
      params: {
        request_type: 'call_function',
        account_id: INTENTS_ACCOUNT,
        method_name: 'mt_batch_balance_of',
        args_base64: Buffer.from(JSON.stringify({ account_id: signerId, token_ids: tokenIds }), 'utf8').toString('base64'),
        finality: 'final',
      },
    };
    const response = await requestJson(fetchImpl, NEAR_RPC, { method: 'POST', body, limit: RPC_BODY_LIMIT });
    if (!isRecord(response) || response.jsonrpc !== '2.0' || response.id !== 1 || !isRecord(response.result)
        || Object.hasOwn(response, 'error')) providerInvalid();
    const result = response.result;
    if (!Number.isSafeInteger(result.block_height) || result.block_height < 1) providerInvalid();
    rpcBase58Hash(result.block_hash, 'NEAR finalized block hash', providerInvalid);
    if (!Array.isArray(result.result) || result.result.length > 256
        || result.result.some(byte => !Number.isInteger(byte) || byte < 0 || byte > 255)) providerInvalid();
    let balances;
    try { balances = parseJsonStrict(Buffer.from(result.result).toString('utf8')); } catch { providerInvalid(); }
    if (!Array.isArray(balances) || balances.length !== assets.length) providerInvalid();
    const capturedAt = canonicalClock(now);
    const balanceRows = balances.map((balanceBaseUnits, index) => {
      decimalUnits(balanceBaseUnits, 'Finalized NEAR balance', providerInvalid, true);
      return { assetId: assets[index].assetId, balanceBaseUnits };
    });
    return {
      schemaVersion: 1,
      chain: 'near',
      network: 'mainnet',
      wallet,
      signerId,
      capturedAt,
      blockHash: result.block_hash,
      blockHeight: result.block_height,
      assets,
      balances: balanceRows,
      status: 'OBSERVED',
      reasons: [],
    };
  };

  const assets = async () => fetchAssets();

  const quote = async input => {
    ensureEnabled();
    const headers = apiHeaders(apiKey, true);
    validateQuoteInput(input, now);
    const registry = await fetchAssets();
    const request = quoteRequestFor(input, registry);
    const raw = await requestJson(fetchImpl, `${API}/v0/quote`, {
      method: 'POST', body: request, headers,
    });
    verifyProviderQuote(raw, verifyQuote, providerInvalid);
    validateQuotePayload(raw, request, providerInvalid);
    const capturedAt = canonicalClock(now);
    if (utcTime(raw.timestamp, 'Quote provider timestamp', providerInvalid) > Date.parse(capturedAt)) providerInvalid();
    if (utcTime(raw.quoteRequest.deadline, 'Quote expiry', providerInvalid) <= Date.parse(capturedAt)) providerInvalid();
    const envelope = {
      schemaVersion: 1,
      capturedAt,
      raw,
      sha256: sha256(canonicalBytes(raw)),
      signatureVerified: true,
    };
    return freezeDeep(envelope);
  };

  const generateIntent = async (quoteEnvelope, signerId) => {
    ensureEnabled();
    const headers = apiHeaders(apiKey, true);
    signerIdBytes(signerId);
    const raw = validateEnvelope(quoteEnvelope, verifyQuote, { executable: true });
    if (raw.quoteRequest.recipient !== signerId || raw.quoteRequest.refundTo !== signerId) invalid('Signer does not own this quote.');
    if (utcTime(raw.quote.deadline, 'Quote expiry') <= Date.parse(canonicalClock(now))) invalid('Quote has expired.');
    const registry = await fetchAssets();
    const origin = resolveAsset(registry, raw.quoteRequest.originAsset, 'Origin asset');
    const destination = resolveAsset(registry, raw.quoteRequest.destinationAsset, 'Destination asset');
    if ((origin.kind === 'reserve') === (destination.kind === 'reserve')) invalid('Quote assets are outside the supported reserve-to-receipt path.');
    const response = await requestJson(fetchImpl, `${API}/v0/generate-intent`, {
      method: 'POST',
      body: { type: 'swap_transfer', standard: 'raw_ed25519', signerId, depositAddress: raw.quote.depositAddress },
      headers,
    });
    if (!isRecord(response) || !isRecord(response.intent) || typeof response.correlationId !== 'string'
        || !response.correlationId || response.correlationId.length > 128) providerInvalid();
    exact(response.intent, ['standard', 'payload'], 'Generated intent', providerInvalid);
    if (response.intent.standard !== 'raw_ed25519') providerInvalid();
    const message = parseIntentPayload(response.intent.payload, providerInvalid);
    matchIntentQuote(message, raw, signerId, providerInvalid);
    return freezeDeep({ standard: 'raw_ed25519', payload: response.intent.payload });
  };

  const validateSigned = (intent, wallet, signatureBase64) => {
    const walletBytes = publicKeyBytes(wallet);
    const signerId = walletBytes.toString('hex');
    exact(intent, ['standard', 'payload'], 'Generated intent');
    if (intent.standard !== 'raw_ed25519') invalid('Only raw Ed25519 intents are supported.');
    const message = parseIntentPayload(intent.payload);
    if (message.signer_id !== signerId) unauthorized('Intent signer does not match the owner wallet.');
    const signature = Buffer.from(typeof signatureBase64 === 'string' ? signatureBase64 : '', 'base64');
    if (typeof signatureBase64 !== 'string' || signature.length !== 64 || signature.toString('base64') !== signatureBase64) invalid('Wallet signature must be canonical base64 Ed25519.');
    let valid = false;
    try { valid = verify(null, Buffer.from(intent.payload, 'utf8'), ed25519PublicKey(walletBytes), signature); } catch {}
    if (!valid) unauthorized('Wallet signature does not match the generated intent.');
    return {
      standard: 'raw_ed25519',
      payload: intent.payload,
      public_key: `ed25519:${encodeBase58(walletBytes)}`,
      signature: `ed25519:${encodeBase58(signature)}`,
    };
  };

  const submitIntent = async signedData => {
    ensureEnabled();
    const headers = apiHeaders(apiKey, true);
    const { message } = validateSignedData(signedData);
    if (utcTime(message.deadline, 'Intent expiry') <= Date.parse(canonicalClock(now))) invalid('Signed intent has expired.');
    const registry = await fetchAssets();
    const diff = message.intents[0].diff;
    const keys = Reflect.ownKeys(diff);
    if (keys.length !== 2 || keys.some(key => typeof key !== 'string')) invalid('Signed intent must bind exactly two supported assets.');
    const entries = keys.map(key => {
      const asset = registry.find(candidate => candidate.assetId === key);
      if (!asset) invalid('Signed intent assets are no longer supported.');
      return { asset, amount: diff[key] };
    });
    if ((entries[0].asset.kind === 'reserve') === (entries[1].asset.kind === 'reserve')) invalid('Signed intent must exchange reserve and receipt assets.');
    const debits = entries.filter(entry => typeof entry.amount === 'string' && /^-[1-9]\d*$/.test(entry.amount));
    const credits = entries.filter(entry => typeof entry.amount === 'string' && /^[1-9]\d*$/.test(entry.amount));
    if (debits.length !== 1 || credits.length !== 1) invalid('Signed token-diff must contain one debit and one credit.');
    decimalUnits(debits[0].amount.slice(1), 'Signed debit');
    decimalUnits(credits[0].amount, 'Signed credit');
    const result = await requestJson(fetchImpl, `${API}/v0/submit-intent`, {
      method: 'POST', body: { type: 'swap_transfer', signedData }, headers,
    });
    if (!isRecord(result) || typeof result.intentHash !== 'string' || typeof result.correlationId !== 'string'
        || !result.correlationId || result.correlationId.length > 128) providerInvalid();
    rpcBase58Hash(result.intentHash, 'Submitted intent hash', providerInvalid);
    return { intentHash: result.intentHash, correlationId: result.correlationId };
  };

  const status = async quoteEnvelope => {
    ensureEnabled();
    const headers = apiHeaders(apiKey, true);
    const raw = validateEnvelope(quoteEnvelope, verifyQuote, { executable: true });
    const url = new URL('/v0/status', API);
    url.searchParams.set('depositAddress', raw.quote.depositAddress);
    if (typeof raw.quote.depositMemo === 'string') url.searchParams.set('depositMemo', raw.quote.depositMemo);
    const result = await requestJson(fetchImpl, url.href, { headers });
    providerStatusShape(result);
    if (stableStringify(result.quoteResponse) !== stableStringify(raw)) providerInvalid();
    verifyProviderQuote(result.quoteResponse, verifyQuote, providerInvalid);
    return result;
  };

  const reconcile = async input => {
    ensureEnabled();
    exact(input, ['quote', 'signedData', 'intentHash', 'beforePortfolio'], 'Reconciliation request');
    const { quote: quoteEnvelope, signedData, intentHash, beforePortfolio } = input;
    const raw = validateEnvelope(quoteEnvelope, verifyQuote, { executable: true });
    const ownerId = validPortfolioOwner(beforePortfolio);
    if (raw.quoteRequest.recipient !== ownerId || raw.quoteRequest.refundTo !== ownerId) invalid('Quote, portfolio, and owner do not match.');
    const portfolioAssetIds = new Set(beforePortfolio.assets.map(asset => asset.assetId));
    const portfolioBalanceIds = new Set(beforePortfolio.balances.map(balance => balance.assetId));
    for (const assetId of [raw.quoteRequest.originAsset, raw.quoteRequest.destinationAsset]) {
      if (!portfolioAssetIds.has(assetId) || !portfolioBalanceIds.has(assetId)) invalid('Portfolio does not cover the quoted assets.');
    }
    checkIntentForQuote(signedData, raw, ownerId, unauthorized);
    if (intentHash !== null) rpcBase58Hash(intentHash, 'Submitted intent hash');
    const providerStatus = await status(quoteEnvelope);
    const nearTxHashes = providerStatus.swapDetails.nearTxHashes;
    const shared = { providerStatus, intentHash, nearTxHashes, portfolio: null, amounts: null };
    let receipt;
    try {
      receipt = await verifyFinalizedIntent(nearTxHashes, ownerId, intentHash, signedData, raw);
    } catch {
      receipt = null;
    }
    if (!receipt) {
      if (['KNOWN_DEPOSIT_TX', 'PENDING_DEPOSIT', 'INCOMPLETE_DEPOSIT', 'PROCESSING'].includes(providerStatus.status)) {
        return { status: 'PENDING', reason: 'The signed intent has no independently verified final execution yet.', ...shared };
      }
      return {
        status: 'UNVERIFIED',
        reason: nearblocksApiKey === null
          ? 'Finalized NEAR receipt is unverified because the server-only NearBlocks sender-discovery key is not configured.'
          : 'Finalized NEAR receipt did not bind the exact signed execute_intents transaction and owner token-diff event.',
        ...shared,
      };
    }
    shared.intentHash = receipt.intentHash;
    let portfolio;
    try {
      portfolio = await fetchPortfolio(beforePortfolio.wallet);
      if (validPortfolioOwner(portfolio) !== ownerId) providerInvalid();
    } catch {
      return {
        status: 'UNVERIFIED',
        reason: 'The finalized receipt matched, but a fresh finalized owner portfolio could not be captured.',
        ...shared,
      };
    }
    return {
      status: 'CONFIRMED',
      reason: 'The signed intent, finalized NEAR transaction, intents.near receipt, and owner token-diff event match.',
      ...shared,
      portfolio,
      amounts: receipt.amounts,
    };
  };


  return Object.freeze({ assets, capturePortfolio: fetchPortfolio, quote, generateIntent, validateSigned, submitIntent, status, reconcile });
}
