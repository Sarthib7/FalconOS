import { PublicKey, TransactionInstruction, TransactionMessage, VersionedTransaction } from '@solana/web3.js';

// ABI: klend-sdk 38845294447623f6de3afc9dec29875f959f6f48.
export const LENDING_CONFIG = Object.freeze({
  network: 'devnet', rpcUrl: 'https://api.devnet.solana.com',
  genesisHash: 'EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG',
  program: 'KLend2g3cP87fffoy8q1mQqGKjrxjC8boSyAYavgmjD',
  programData: '9uSbGW1y9H5Av6H5TKxQ1wnFApSq2t3oEpfF2YfjDQGA',
  reserve: 'HRwMj8uuoGVWCanKzKvpTWN5ZvXjtjKGxcFbn2qTPKMW',
  market: '6aaNTBEmwdN19AAdTwbNrWyUo6iEyiLguxCTePEzSqoH',
  liquidityMint: '4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU',
  liquidityVault: '6icVFmuKEsH5dzDwTSrxzrnJ14N27gDKRc2XAxPtB4ep',
  receiptMint: '6FY2rwh5wWrtSveAG9t9ANc2YsrChNasVSEpMQubJcXd',
  collateralVault: '7L481bd3UQgqHbcMDHsKmZvSWvqQx1stvyNcnxbRz8ss',
  oracle: 'Dpw1EAVrSB1ibxiDQyTAW6Zip3J4Btk2x4SgApQCeFbX',
  oracleProgram: 'rec5EKMGg6MxZYaMdyBfgwp4d5rB9T1VQH5pJv5LtFJ',
  oracleFeed: 'eaa020c61cc479712813461ce153894a96a6c00b21ed0cfc2798d1f9a9e9c94a',
  tokenProgram: 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA',
  associatedTokenProgram: 'ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL',
  systemProgram: '11111111111111111111111111111111',
  instructionsSysvar: 'Sysvar1nstructions1111111111111111111111111',
  clockSysvar: 'SysvarC1ock11111111111111111111111111111111',
  loader: 'BPFLoaderUpgradeab1e11111111111111111111111',
  decimals: 6, maxSupplyBaseUnits: '1000000',
});

// Bumped whenever the wire ABI, account layout, or instruction encoding in this file changes.
export const ADAPTER_VERSION = 'kamino-devnet-adapter/1';

const C = LENDING_CONFIG;
const U64_MAX = 18446744073709551615n;
const key = value => {
  if (typeof value !== 'string') throw new Error('Public key must be a string.');
  const result = new PublicKey(value);
  if (result.toBase58() !== value) throw new Error('Public key is not canonical.');
  return result;
};

export function lendingAmount(action, value) {
  if (!['supply', 'redeem'].includes(action) || typeof value !== 'string' || !/^[1-9][0-9]{0,19}$/.test(value)) {
    throw new Error('Action or positive base-unit amount is invalid.');
  }
  const amount = BigInt(value);
  if (amount > U64_MAX || (action === 'supply' && amount > BigInt(C.maxSupplyBaseUnits))) {
    throw new Error('Amount exceeds the Devnet test limit.');
  }
  return amount;
}

export function deriveAccounts(wallet) {
  const owner = key(wallet);
  if (!PublicKey.isOnCurve(owner.toBytes())) throw new Error('Wallet must be an Ed25519 signer.');
  const ata = mint => PublicKey.findProgramAddressSync(
    [owner.toBytes(), key(C.tokenProgram).toBytes(), key(mint).toBytes()], key(C.associatedTokenProgram),
  )[0].toBase58();
  const [authority, bump] = PublicKey.findProgramAddressSync(
    [new TextEncoder().encode('lma'), key(C.market).toBytes()], key(C.program),
  );
  return {
    wallet, reserve: C.reserve, market: C.market, marketAuthority: authority.toBase58(), marketAuthorityBump: bump,
    liquidityMint: C.liquidityMint, liquidityVault: C.liquidityVault, receiptMint: C.receiptMint,
    walletLiquidity: ata(C.liquidityMint), walletReceipt: ata(C.receiptMint),
    tokenProgram: C.tokenProgram, oracle: C.oracle,
  };
}

const meta = (address, writable = false, signer = false) => ({ pubkey: key(address), isWritable: writable, isSigner: signer });
const instruction = (programId, keys, data) => new TransactionInstruction({ programId: key(programId), keys, data });

export function buildLendingTransaction({ wallet, action, inputBaseUnits, blockhash, lastValidBlockHeight, createDestinationAta }) {
  const amount = lendingAmount(action, inputBaseUnits);
  key(blockhash);
  if (!Number.isSafeInteger(lastValidBlockHeight) || lastValidBlockHeight < 1 || typeof createDestinationAta !== 'boolean') {
    throw new Error('Transaction lifetime or account creation flag is invalid.');
  }
  const a = deriveAccounts(wallet);
  const instructions = [];
  if (createDestinationAta) {
    const destination = action === 'supply' ? a.walletReceipt : a.walletLiquidity;
    const mint = action === 'supply' ? a.receiptMint : a.liquidityMint;
    instructions.push(instruction(C.associatedTokenProgram, [
      meta(wallet, true, true), meta(destination, true), meta(wallet), meta(mint), meta(C.systemProgram), meta(C.tokenProgram),
    ], Uint8Array.of(1)));
  }
  instructions.push(instruction(C.program, [
    meta(a.reserve, true), meta(a.market), meta(a.oracle), meta(C.program), meta(C.program), meta(C.program),
  ], Uint8Array.from([2, 218, 138, 235, 79, 201, 25, 102])));
  const data = new Uint8Array(16);
  data.set(action === 'supply' ? [169, 201, 30, 126, 6, 205, 102, 68] : [234, 117, 181, 125, 185, 142, 220, 29]);
  new DataView(data.buffer).setBigUint64(8, amount, true);
  const accounts = action === 'supply' ? [
    meta(wallet, false, true), meta(a.reserve, true), meta(a.market), meta(a.marketAuthority),
    meta(a.liquidityMint), meta(a.liquidityVault, true), meta(a.receiptMint, true),
    meta(a.walletLiquidity, true), meta(a.walletReceipt, true),
  ] : [
    meta(wallet, false, true), meta(a.market), meta(a.reserve, true), meta(a.marketAuthority),
    meta(a.liquidityMint), meta(a.receiptMint, true), meta(a.liquidityVault, true),
    meta(a.walletReceipt, true), meta(a.walletLiquidity, true),
  ];
  instructions.push(instruction(C.program, [
    ...accounts, meta(C.tokenProgram), meta(C.tokenProgram), meta(C.instructionsSysvar),
  ], data));
  const message = new TransactionMessage({ payerKey: key(wallet), recentBlockhash: blockhash, instructions }).compileToV0Message();
  return new VersionedTransaction(message);
}

export function validateLendingTransaction(transaction, intent) {
  if (!intent || intent.network !== C.network || intent.genesisHash !== C.genesisHash) throw new Error('Lending network does not match.');
  const message = transaction?.message;
  if (message?.version !== 0 || message.addressTableLookups.length !== 0 || message.header.numRequiredSignatures !== 1
      || transaction.signatures.length !== 1 || message.staticAccountKeys[0].toBase58() !== intent.wallet) {
    throw new Error('Lending transaction signer or address table is invalid.');
  }
  const expected = buildLendingTransaction(intent).message.serialize();
  const actual = message.serialize();
  if (expected.length !== actual.length || !expected.every((byte, index) => byte === actual[index])) {
    throw new Error('Lending transaction differs from the fixed intent.');
  }
  return true;
}

export function deserializeLendingTransaction(bytes) {
  if (!(bytes instanceof Uint8Array) || bytes.length < 1 || bytes.length > 1232) throw new Error('Transaction bytes exceed their limit.');
  const transaction = VersionedTransaction.deserialize(bytes);
  const canonical = transaction.serialize();
  if (bytes.length !== canonical.length || !bytes.every((byte, index) => byte === canonical[index])) {
    throw new Error('Transaction encoding is not canonical.');
  }
  return transaction;
}
