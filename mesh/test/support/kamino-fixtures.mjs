import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { PublicKey } from '@solana/web3.js';
import { LENDING_CONFIG as C, deriveAccounts, deserializeLendingTransaction } from '../../kamino-wire.mjs';
import { CONNECTORS } from '../../live.mjs';

// Controlled replay only. Time, wallet balances, simulation, and receipts are fixtures.
// These responses cannot prove a transaction on Devnet.
const fixture = JSON.parse(readFileSync(new URL('../fixtures/kamino-public-accounts.json', import.meta.url), 'utf8'));
const vaultBalance = 252145908n;
const response = (request, result) => new Response(JSON.stringify({ jsonrpc: '2.0', id: request.id, result }), { headers: { 'content-type': 'application/json' } });

function token(mint, owner, amount) {
  const bytes = Buffer.alloc(165);
  new PublicKey(mint).toBuffer().copy(bytes, 0);
  new PublicKey(owner).toBuffer().copy(bytes, 32);
  bytes.writeBigUInt64LE(BigInt(amount), 64); bytes[108] = 1;
  return { data: [bytes.toString('base64'), 'base64'], owner: C.tokenProgram, executable: false, lamports: 2039280, space: 165 };
}
function edit(account, update) {
  const bytes = Buffer.from(account.data[0], 'base64');
  update(bytes); account.data[0] = bytes.toString('base64');
}

export function createKaminoBrowserFixture(wallet, now = () => new Date().toISOString()) {
  const a = deriveAccounts(wallet);
  return {
    async publicFetch(url, options) {
      assert.equal(options.redirect, 'error');
      if (url === CONNECTORS[0].sourceUrl) return new Response(`# Controlled official document fixture\n\n## Deployments\n\n- Devnet: \`${C.program}\`\n`, { headers: { 'content-type': 'text/plain' } });
      assert.equal(url, C.rpcUrl);
      const request = JSON.parse(options.body);
      if (request.method === 'getGenesisHash') return response(request, C.genesisHash);
      if (request.method === 'getMultipleAccounts') {
        // Controlled replay of checked-in public accounts. It is coherent by construction, not proof of an atomic historical snapshot.
        const [addresses, options] = request.params;
        assert.deepEqual([...addresses].sort(), [C.reserve, C.liquidityVault].sort());
        assert.equal(options.encoding, 'base64'); assert.equal(options.commitment, 'confirmed');
        return response(request, { context: { slot: fixture.slot }, value: addresses.map(id => fixture.accounts[id]) });
      }
      assert.equal(request.method, 'getAccountInfo');
      assert.equal(request.params[0], C.program);
      return response(request, { context: { slot: fixture.slot }, value: fixture.accounts[C.program] });
    },
    prepareFetch(input) {
      assert.equal(input.wallet, wallet);
      const accounts = structuredClone(fixture.accounts);
      const seconds = BigInt(Math.floor(Date.parse(now()) / 1000));
      edit(accounts[C.clockSysvar], bytes => { bytes.writeBigUInt64LE(BigInt(fixture.slot), 0); bytes.writeBigInt64LE(seconds, 32); });
      edit(accounts[C.oracle], bytes => bytes.writeBigInt64LE(seconds, 93));
      accounts[a.walletLiquidity] = token(C.liquidityMint, wallet, 5000000n);
      accounts[a.walletReceipt] = token(C.receiptMint, wallet, 2000000n);
      accounts[wallet] = { data: ['', 'base64'], owner: C.systemProgram, executable: false, lamports: 100000000, space: 0 };
      const blockhash = new PublicKey(randomBytes(32)).toBase58();
      return async (url, options) => {
        assert.equal(url, C.rpcUrl); assert.equal(options.redirect, 'error');
        const request = JSON.parse(options.body);
        if (request.method === 'getGenesisHash') return response(request, C.genesisHash);
        if (request.method === 'getMultipleAccounts') return response(request, { context: { slot: fixture.slot }, value: request.params[0].map(id => {
          assert.ok(Object.hasOwn(accounts, id), `Missing fixture account ${id}`); return accounts[id];
        }) });
        if (request.method === 'getLatestBlockhash') return response(request, { context: { slot: fixture.slot }, value: { blockhash, lastValidBlockHeight: 123456789 } });
        assert.equal(request.method, 'simulateTransaction');
        const tx = deserializeLendingTransaction(Buffer.from(request.params[0], 'base64'));
        assert.equal(tx.message.recentBlockhash, blockhash);
        assert.equal(request.params[1].replaceRecentBlockhash, false);
        assert.equal(request.params[1].sigVerify, false);
        assert.deepEqual(request.params[1].accounts.addresses, [a.walletLiquidity, a.walletReceipt, a.liquidityVault]);
        const delta = BigInt(input.inputBaseUnits) * (input.action === 'supply' ? 1n : -1n);
        return response(request, { context: { slot: fixture.slot }, value: { err: null, unitsConsumed: 92000, accounts: [
          token(C.liquidityMint, wallet, 5000000n - delta), token(C.receiptMint, wallet, 2000000n + delta),
          token(C.liquidityMint, a.marketAuthority, vaultBalance + delta),
        ] } });
      };
    },
    receiptFetch(intent, transactionBase64) {
      const tx = deserializeLendingTransaction(Buffer.from(transactionBase64, 'base64'));
      const keys = tx.message.staticAccountKeys.map(key => key.toBase58());
      const row = (account, mint, owner, amount) => ({ accountIndex: keys.indexOf(account), mint, owner,
        programId: C.tokenProgram, uiTokenAmount: { amount: amount.toString(), decimals: 6, uiAmount: null } });
      const liquidity = BigInt(intent.snapshot.decoded.walletLiquidityBaseUnits);
      const receipt = BigInt(intent.snapshot.decoded.walletReceiptBaseUnits);
      const delta = BigInt(intent.inputBaseUnits) * (intent.action === 'supply' ? 1n : -1n);
      const balances = (change) => [row(a.walletLiquidity, C.liquidityMint, wallet, liquidity - change),
        row(a.walletReceipt, C.receiptMint, wallet, receipt + change), row(a.liquidityVault, C.liquidityMint, a.marketAuthority, vaultBalance + change)];
      const value = { slot: fixture.slot + 1, version: 0, transaction: [transactionBase64, 'base64'], meta: {
        err: null, preBalances: keys.map(() => 2039280), preTokenBalances: balances(0n), postTokenBalances: balances(delta),
      } };
      return async (url, options) => {
        assert.equal(url, C.rpcUrl); assert.equal(options.redirect, 'error');
        const request = JSON.parse(options.body);
        if (request.method === 'getGenesisHash') return response(request, C.genesisHash);
        assert.equal(request.method, 'getTransaction');
        assert.deepEqual(request.params[1], { encoding: 'base64', commitment: 'confirmed', maxSupportedTransactionVersion: 0 });
        return response(request, value);
      };
    },
  };
}
