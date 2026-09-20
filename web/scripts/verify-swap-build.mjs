#!/usr/bin/env node

const INPUT_MINT = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
const OUTPUT_MINT = 'PreweJYECqtQwBtpxHL171nL2K6umo692gTm7Q3rpgF';
const USER_PUBLIC_KEY = '11111111111111111111111111111111';
const QUOTE_API = 'https://lite-api.jup.ag/swap/v1/quote';
const SWAP_API = 'https://lite-api.jup.ag/swap/v1/swap';

const fail = (message) => {
  console.error('swap-build verification failed: ' + message);
  process.exitCode = 1;
};

try {
  const quoteUrl = new URL(QUOTE_API);
  quoteUrl.search = new URLSearchParams({
    inputMint: INPUT_MINT,
    outputMint: OUTPUT_MINT,
    amount: String(10 * 1_000_000),
    slippageBps: '50',
  });
  const quoteResponse = await fetch(quoteUrl);
  const quoteText = await quoteResponse.text();
  if (!quoteResponse.ok) throw new Error('quote HTTP ' + quoteResponse.status + ': ' + quoteText.slice(0, 300));
  let quote;
  try { quote = JSON.parse(quoteText); } catch { throw new Error('quote response was not JSON'); }
  if (!quote || !quote.outAmount) throw new Error('quote response has no output amount');

  const swapResponse = await fetch(SWAP_API, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ quoteResponse: quote, userPublicKey: USER_PUBLIC_KEY, wrapAndUnwrapSol: true }),
  });
  const swapText = await swapResponse.text();
  if (!swapResponse.ok) throw new Error('swap HTTP ' + swapResponse.status + ': ' + swapText.slice(0, 300));
  let swap;
  try { swap = JSON.parse(swapText); } catch { throw new Error('swap response was not JSON'); }
  if (typeof swap.swapTransaction !== 'string' || !swap.swapTransaction) throw new Error('swap response has no serialized transaction');
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(swap.swapTransaction)) throw new Error('serialized transaction is not base64');
  const bytes = Buffer.from(swap.swapTransaction, 'base64');
  if (!bytes.length) throw new Error('serialized transaction is empty');
  console.log('swap-build verification passed: quote received and unsigned base64 transaction returned (' + bytes.length + ' bytes)');
} catch (error) {
  fail(error instanceof Error ? error.message + (error.cause && error.cause.code ? ' [' + error.cause.code + ']' : '') : String(error));
}
