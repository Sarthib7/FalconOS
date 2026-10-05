# FalconOS route measurements

[REPORTED, chain_fit researcher] Public quotes were collected on 5 September 2026, between 11:52:00.540491 and 11:52:12.370068 UTC. All twelve GET requests returned HTTP 200. Root received the table and response excerpts below; root did not repeat the requests.

[VERIFIED, user authorization] The user approved these read-only requests with "yes do it" after the proposed Jupiter and KyberSwap measurement was described. This authorization does not cover trades or token launches.

## Method

[REPORTED, researcher] Each direction quotes USDC into EURC on the first chain, then quotes that exact EURC output into USDC on the second chain. Inputs were 10, 100, and 500 USDC. Jupiter requests omitted a taker. Kyber requests used its public Base routes endpoint.

[REPORTED, researcher] The table contains quoted amounts, not executed or simulated fills. Requests were sequential, without a synchronized snapshot. No inventory moved across chains.

## Results

[REPORTED, researcher] Input, intermediate amount, output, and Base gas estimates are from the returned quote data. [VERIFIED, root arithmetic] Delta is output minus input, calculated with Python Decimal. It excludes network fees and inventory restoration.

| Direction | Input USDC | EURC between legs | Output USDC | Delta USDC | Base gas estimate, USD |
| --- | ---: | ---: | ---: | ---: | ---: |
| Solana to Base | 10 | 8.612103 | 9.997524 | -0.002476 | 0.004234 |
| Base to Solana | 10 | 8.613557 | 10.000230 | +0.000230 | 0.004234 |
| Solana to Base | 100 | 86.119130 | 99.977998 | -0.022002 | 0.005246 |
| Base to Solana | 100 | 86.134702 | 99.999356 | -0.000644 | 0.004234 |
| Solana to Base | 500 | 430.648026 | 499.966067 | -0.033933 | 0.012551 |
| Base to Solana | 500 | 430.674410 | 499.991059 | -0.008941 | 0.005261 |

[VERIFIED, root arithmetic output]

```text
Solana -> Base input=10 output=9.997524 delta=-0.002476 bps=-2.4760
Base -> Solana input=10 output=10.000230 delta=0.000230 bps=0.2300
Solana -> Base input=100 output=99.977998 delta=-0.022002 bps=-2.2002
Base -> Solana input=100 output=99.999356 delta=-0.000644 bps=-0.0644
Solana -> Base input=500 output=499.966067 delta=-0.033933 bps=-0.6787
Base -> Solana input=500 output=499.991059 delta=-0.008941 bps=-0.1788
```

[INFERRED] The single positive quote difference does not cover estimated Base gas if USDC is valued near USD 1. These observations establish route availability at the sampled sizes. They do not establish profitable arbitrage, opportunity frequency, or future prices.

## Sample response evidence

[REPORTED, researcher] Base to Solana, 10 USDC. These are response excerpts, not full responses. Base quote completed at 11:52:03.367054 UTC; Solana quote completed at 11:52:03.521107 UTC.

```text
GET https://aggregator-api.kyberswap.com/base/api/v1/routes?tokenIn=0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913&tokenOut=0x60a3E35Cc302bFA44Cb288Bc5a4F316Fdb1adb42&amountIn=10000000
x-client-id: stablecoin-route-research

HTTP 200
requestId: ca0bbf7d-2522-47f4-80b2-abeb5b96f618
"amountIn":"10000000"
"amountOut":"8613557"
"gas":"287581"
"gasPrice":"6000000"
"gasUsd":"0.0042336346534081245"
"l1FeeUsd":"0.00000954257529518714"
"timestamp":1788609123
```

```text
GET https://api.jup.ag/swap/v2/order?inputMint=HzwqbKZw8HxMN6bF2yFZNrht3c2iXXzpKcFu7uBEDKtr&outputMint=EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v&amount=8613557

HTTP 200
requestId: 01a07169-546b-7048-87c3-ffae96d212ae
"inAmount":"8613557"
"outAmount":"10000230"
"feeBps":0
"transaction":null
"taker":null
"guaranteedPrice":false
```

## Interpretation limits

- [REPORTED, researcher] Kyber's separate L1 fee values were near USD 0.000010. They are excluded from the table's gas column.
- [REPORTED, researcher] Jupiter returned zero fee estimates without a taker. Those values do not establish zero Solana execution cost.
- [REPORTED, researcher] Some routes used intermediate assets. The 500 USDC Solana-to-Base direction used WETH within the Base route. This was not a direct stablecoin pool.
- [INFERRED] A parallel execution needs EURC inventory on the second chain. Inventory must later be restored by transfers or offsetting flows. Bridge access, funding costs, failures, and unwind costs are not measured here.
- [VERIFIED, issuer documentation] EURC represents euro exposure. This pair requires an FX reference for peg interpretation. A cross-chain USDC/EURC price gap alone does not identify a USD depeg. [Circle EURC](https://www.circle.com/eurc).

## Least confident decisions

1. [INFERRED] This pair will produce opportunities after complete costs. This brief sample does not support that claim.
2. [INFERRED] The quoted routes can be filled at the same time with available capital. No execution or inventory experiment was performed.
3. [INFERRED] Similar route access exists on Robinhood Chain or Tempo. Those routes were not part of this measurement.
