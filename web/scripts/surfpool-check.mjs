import { CLUSTERS, OPENAI_MINT, getLatestBlockhash, readAccount } from '../copilot/execution.mjs';

const rpc = CLUSTERS.surfpool;
const account = await readAccount(rpc, OPENAI_MINT);
const blockhash = await getLatestBlockhash(rpc);
if (!account || !Array.isArray(account.data) || typeof account.data[0] !== 'string' || !account.data[0]) {
  console.error('Surfpool fork does not have the PreStocks mint account');
  process.exit(1);
}
console.log(JSON.stringify({
  rpc,
  mint: OPENAI_MINT,
  accountOwner: account.owner,
  recentBlockhash: blockhash.blockhash,
  lastValidBlockHeight: blockhash.lastValidBlockHeight,
}));
