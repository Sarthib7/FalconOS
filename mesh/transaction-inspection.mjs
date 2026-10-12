import { createHash } from 'node:crypto';
import { PublicKey, VersionedTransaction } from '@solana/web3.js';
import { MeshError } from './domain.mjs';
import { LENDING_CONFIG as C } from './kamino-wire.mjs';

const TRANSACTION_LIMIT = 1232;
const INVALID = () => new MeshError('INVALID_INPUT', 'Transaction decode request does not match the bounded Solana Devnet contract.');
const invalid = () => { throw INVALID(); };
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const SYSTEM_PROGRAM = C.systemProgram;
const TOKEN_PROGRAM = C.tokenProgram;
const ATA_PROGRAM = C.associatedTokenProgram;
const KAMINO_PROGRAM = C.program;
const KNOWN_PROGRAMS = new Set([SYSTEM_PROGRAM, TOKEN_PROGRAM, ATA_PROGRAM, KAMINO_PROGRAM]);

function validateInput(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) invalid();
  const allowed = new Set(['transactionBase64', 'chain', 'network']);
  if (Object.keys(input).some(key => !allowed.has(key)) || !Object.hasOwn(input, 'transactionBase64')) invalid();
  const chain = Object.hasOwn(input, 'chain') ? input.chain : 'solana';
  const network = Object.hasOwn(input, 'network') ? input.network : 'devnet';
  const maxBase64Length = Math.ceil(TRANSACTION_LIMIT / 3) * 4;
  if (chain !== 'solana' || network !== 'devnet' || typeof input.transactionBase64 !== 'string'
      || input.transactionBase64.length === 0 || input.transactionBase64.length > maxBase64Length) invalid();
  const bytes = Buffer.from(input.transactionBase64, 'base64');
  if (bytes.length === 0 || bytes.length > TRANSACTION_LIMIT || bytes.toString('base64') !== input.transactionBase64) invalid();
  return { chain, network, bytes };
}

function byteArray(value) {
  return Buffer.from(value.buffer, value.byteOffset, value.byteLength);
}

function readU64(data, offset = 1) {
  if (data.length < offset + 8) return null;
  return data.readBigUInt64LE(offset).toString();
}

function readKey(data, offset) {
  if (data.length < offset + 32) return null;
  return new PublicKey(data.subarray(offset, offset + 32)).toBase58();
}

function parseKnown(programId, data, accounts) {
  if (programId === SYSTEM_PROGRAM) {
    if (data.length >= 4) {
      const opcode = data.readUInt32LE(0);
      if (accounts.length < (opcode === 1 ? 1 : 2)) return null;
      if (opcode === 2 && data.length === 12) return { kind: 'system.transfer', lamports: data.readBigUInt64LE(4).toString() };
      if (opcode === 0 && data.length === 52) {
        return {
          kind: 'system.createAccount',
          lamports: data.readBigUInt64LE(4).toString(),
          space: data.readBigUInt64LE(12).toString(),
          owner: readKey(data, 20),
        };
      }
      if (opcode === 1 && data.length === 36) return { kind: 'system.assign', owner: readKey(data, 4) };
    }
    return null;
  }
  if (programId === TOKEN_PROGRAM) {
    if (accounts.length < (data[0] === 12 ? 4 : 3)) return null;
    if (data.length === 9 && [3, 7, 8, 4].includes(data[0])) {
      const kind = { 3: 'transfer', 7: 'mintTo', 8: 'burn', 4: 'approve' }[data[0]];
      return { kind: `spl-token.${kind}`, amountBaseUnits: readU64(data) };
    }
    if (data.length === 10 && data[0] === 12) {
      return { kind: 'spl-token.transferChecked', amountBaseUnits: readU64(data), decimals: data[9] };
    }
    return null;
  }
  if (programId === ATA_PROGRAM) {
    if (accounts.length < 6) return null;
    if (data.length === 0 || (data.length === 1 && data[0] === 0)) return { kind: 'associated-token.create' };
    if (data.length === 1 && data[0] === 1) return { kind: 'associated-token.createIdempotent' };
    return null;
  }
  if (programId === KAMINO_PROGRAM) {
    if (accounts.length < (data.length === 8 ? 6 : 12)) return null;
    if (data.length === 8 && data.equals(Buffer.from([2, 218, 138, 235, 79, 201, 25, 102]))) {
      return { kind: 'kamino.refreshReserve' };
    }
    if (data.length === 16 && data.subarray(0, 8).equals(Buffer.from([169, 201, 30, 126, 6, 205, 102, 68]))) {
      return { kind: 'kamino.supply', amountBaseUnits: data.readBigUInt64LE(8).toString() };
    }
    if (data.length === 16 && data.subarray(0, 8).equals(Buffer.from([234, 117, 181, 125, 185, 142, 220, 29]))) {
      return { kind: 'kamino.redeem', amountBaseUnits: data.readBigUInt64LE(8).toString() };
    }
    return null;
  }
  return undefined;
}

function signerWritable(index, header, staticCount) {
  if (index < header.numRequiredSignatures) {
    return {
      isSigner: true,
      isWritable: index < header.numRequiredSignatures - header.numReadonlySignedAccounts,
    };
  }
  if (index < staticCount) {
    return {
      isSigner: false,
      isWritable: index < staticCount - header.numReadonlyUnsignedAccounts,
    };
  }
  return { isSigner: false, isWritable: false };
}

export function inspectTransaction(input) {
  const { chain, network, bytes } = validateInput(input);
  try {
    const transaction = VersionedTransaction.deserialize(bytes);
    const canonicalBytes = Buffer.from(transaction.serialize());
    if (!canonicalBytes.equals(bytes)) invalid();
    const message = transaction.message;
    const staticKeys = message.staticAccountKeys;
    const { header } = message;
    const requiredCount = header.numRequiredSignatures;
    if (!staticKeys.length || requiredCount < 1 || requiredCount > staticKeys.length
        || header.numReadonlySignedAccounts >= requiredCount
        || header.numReadonlyUnsignedAccounts > staticKeys.length - requiredCount
        || transaction.signatures.length !== requiredCount) invalid();
    const feePayer = staticKeys[0].toBase58();
    const requiredSigners = staticKeys.slice(0, requiredCount).map(key => key.toBase58());
    const signedCount = transaction.signatures.reduce((count, signature) =>
      count + (signature.some(byte => byte !== 0) ? 1 : 0), 0);
    const signatureState = signedCount === 0 ? 'unsigned'
      : signedCount === requiredCount ? 'signed' : 'partially-signed';
    const lookups = message.addressTableLookups.map(lookup => ({
      address: lookup.accountKey.toBase58(),
      writableIndexes: [...lookup.writableIndexes],
      readonlyIndexes: [...lookup.readonlyIndexes],
      resolved: false,
    }));
    const writableLookupCount = lookups.reduce((count, lookup) => count + lookup.writableIndexes.length, 0);
    const lookupCount = lookups.reduce((count, lookup) => count + lookup.writableIndexes.length + lookup.readonlyIndexes.length, 0);
    const totalKeys = staticKeys.length + lookupCount;
    const atIndex = index => {
      if (!Number.isInteger(index) || index < 0 || index >= totalKeys) invalid();
      const role = signerWritable(index, header, staticKeys.length);
      return {
        index,
        address: index < staticKeys.length ? staticKeys[index].toBase58() : null,
        isSigner: role.isSigner,
        isWritable: index < staticKeys.length ? role.isWritable : index - staticKeys.length < writableLookupCount,
        resolved: index < staticKeys.length,
      };
    };
    const riskFlags = ['NETWORK_NOT_ATTESTED'];
    if (signedCount) riskFlags.push('SIGNATURES_NOT_VERIFIED');
    if (lookups.length) riskFlags.push('UNRESOLVED_LOOKUP_ADDRESSES');
    const instructions = message.compiledInstructions.map((compiled, index) => {
      const program = atIndex(compiled.programIdIndex);
      const rawData = byteArray(compiled.data);
      const accounts = [...compiled.accountKeyIndexes].map(atIndex);
      let parsed;
      if (program.address === null) riskFlags.push('UNRESOLVED_PROGRAM_ADDRESS');
      else if (!KNOWN_PROGRAMS.has(program.address)) riskFlags.push(`UNKNOWN_PROGRAM:${program.address}`);
      else {
        parsed = parseKnown(program.address, rawData, accounts);
        if (parsed === null) riskFlags.push(`UNPARSED_INSTRUCTION:${program.address}`);
      }
      return {
        index,
        programId: program.address,
        programIdIndex: compiled.programIdIndex,
        accounts,
        dataBase64: rawData.toString('base64'),
        ...(parsed !== undefined && parsed !== null ? { parsed } : {}),
      };
    });
    return {
      transactionVersion: transaction.version,
      chain,
      network,
      messageSha256: sha256(Buffer.from(message.serialize())),
      feePayer,
      recentBlockhash: message.recentBlockhash,
      requiredSigners,
      signatureState,
      instructions,
      lookupTables: lookups,
      riskFlags: [...new Set(riskFlags)],
      networkAttestation: 'requested-context-only',
      executionReady: false,
      safeToSign: false,
    };
  } catch (error) {
    if (error instanceof MeshError) throw error;
    throw INVALID();
  }
}
