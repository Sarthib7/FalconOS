# FalconOS live checks

[VERIFIED, collector_luna, 2026-09-05] This report records the authorized public metadata reads, one bounded live scan, the historical watch attempt, and the ten-cycle watch under an approved escalated context. It records no wallet, signing, trade, deposit, or paid API action.

## Request shapes

[VERIFIED, primary documentation] Solana `getTokenSupply` accepts a mint address and an optional commitment object. Its result includes `value.decimals` and `context.slot`. See the [Solana method](https://solana.com/docs/rpc/http/getTokenSupply).

[VERIFIED, primary documentation] Base `eth_call` accepts a call object and a block tag. The ERC-20 [decimals method](https://eips.ethereum.org/EIPS/eip-20) returns `uint8`. The [Base method](https://docs.base.org/base-chain/api-reference/ethereum-json-rpc-api/eth_call) documents this read shape.

## Exact metadata

[VERIFIED, escalated public reads] The four registry addresses returned HTTP 200 and six decimals. Solana reads used `getTokenSupply` with `commitment: "finalized"`. Base reads used `eth_call` with selector `0x313ce567` at block `0x308df13` (`50913043`). Full requests and responses are in [public metadata evidence](../../data/verification/2026-09-05-public-metadata.json).

| Chain | Asset | Address | Method | Slot or block | Decimals | HTTP |
| --- | --- | --- | --- | ---: | ---: | ---: |
| Solana | USDC | `EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v` | `getTokenSupply` | slot `444532563` | 6 | 200 |
| Solana | EURC | `HzwqbKZw8HxMN6bF2yFZNrht3c2iXXzpKcFu7uBEDKtr` | `getTokenSupply` | slot `444532421` | 6 | 200 |
| Base | USDC | `0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913` | `eth_call` | block `0x308df13` | 6 | 200 |
| Base | EURC | `0x60a3E35Cc302bFA44Cb288Bc5a4F316Fdb1adb42` | `eth_call` | block `0x308df13` | 6 | 200 |

[VERIFIED, capture commands] Solana requests used `curl -sS --max-time 15 -X POST -H 'Content-Type: application/json' --data '{"jsonrpc":"2.0","id":"...","method":"getTokenSupply","params":["<mint>",{"commitment":"finalized"}]}' https://api.mainnet-beta.solana.com`. Base requests used the same JSON-RPC POST form at `https://mainnet.base.org`, with `eth_blockNumber` followed by `eth_call` at the returned block.

## Bounded live scan

[VERIFIED, tool invocation record] The bounded scan and the later watch command both omitted `sandbox_permissions`, so both used `use_default`. The metadata `curl` calls used `require_escalated` after the approved public-read request. The quote results therefore have the same execution permission context.

## DNS-only probe

[VERIFIED, approved diagnostic] A Node DNS-only lookup ran with `require_escalated` for `api.jup.ag` and `aggregator-api.kyberswap.com`. It made no HTTP request. The exact result was:

```json
{"startedAt":"2026-09-05T13:49:00.740Z","finishedAt":"2026-09-05T13:49:00.832Z","hosts":[{"host":"api.jup.ag","addresses":[{"address":"18.64.103.108","family":4},{"address":"18.64.103.36","family":4},{"address":"18.64.103.25","family":4},{"address":"18.64.103.107","family":4}],"error":null},{"host":"aggregator-api.kyberswap.com","addresses":[{"address":"172.66.170.241","family":4},{"address":"104.20.39.32","family":4},{"address":"2606:4700:10::ac42:aaf1","family":6},{"address":"2606:4700:10::6814:2720","family":6}],"error":null}]}
```

[INFERRED, DNS limit] DNS resolution succeeded in this approved context. This does not prove HTTP quote access or explain the earlier `use_default` `ENOTFOUND` results. The cause of the different quote results remains not determined.

[VERIFIED, command] The bounded scan command was:

```text
npm run scan -- --amount 10 --data /private/tmp/falconos-live-check.6J1a17 --vault /private/tmp/falconos-live-check.6J1a17/vault
```

It exited `0`.

[VERIFIED, command output] The scan returned `validQuotes: 4`, `expectedQuotes: 4`, and `complete: true`. All four observations had HTTP 200, `error: null`, and raw provider responses. The durable raw record is [3bbf590e live evidence](../../data/verification/2026-09-05-live-scan-3bbf590e-9046-4b71-8fd0-1c7dea08bae1.json), with SHA-256 `34873f02a557d2f2180261d26025e1bbd468d230ec181ce8e3a59c909a9d9846`.

[VERIFIED, bounded scan result] The Solana-to-Base candidate was `REJECT` with quoted delta `-0.002372` USDC. The Base-to-Solana candidate was also `REJECT` with quoted delta `0.000794` USDC. Both retained `COSTS_INCOMPLETE`, `INVENTORY_UNVERIFIED`, and `SEQUENTIAL_QUOTES_NOT_FILLS`.

[VERIFIED, local assessment measurement] The scan set `assessedAt` to `2026-09-05T13:39:47.751Z`. Its first request started at `2026-09-05T13:39:47.752Z`. The current `stablecoins/scan.ts` rule rejects a received time later than `assessedAt`, so both candidates also recorded `STALE_OR_INVALID_OBSERVATION_TIME`. This is a local assessment timing issue. It is not a provider failure diagnosis. Source code remains unchanged in this check.

## Bounded operating check

[VERIFIED, command] The bounded watch command was:

```text
npm run watch -- --amount 10 --interval 60 --cycles 10 --data /private/tmp/falconos-ten-scan.jH5OJg --vault /private/tmp/falconos-ten-scan.jH5OJg/vault
```

It stopped after three scans. It exited `2` and printed:

```text
Stopped after three consecutive incomplete scans. Check recorded source errors before restarting.
```

[VERIFIED, watch coverage] The three scans had unique IDs and increasing assessment times. Each returned `validQuotes: 0`, `expectedQuotes: 4`, and `complete: false`. Each produced two `UNAVAILABLE` candidates. Their raw records and hashes are:

| Sequence | Record | Assessment time | Source errors | SHA-256 |
| ---: | --- | --- | --- | --- |
| 1 | [1c5b0c11](../../data/verification/1c5b0c11-18dd-433a-82b5-be8be368348f.json) | `2026-09-05T13:40:31.848Z` | `ENOTFOUND api.jup.ag`; `ENOTFOUND aggregator-api.kyberswap.com` | `66c32e51d5380ea4993bf930d3ddf6a2cb8a9964b06b7dbfa47018c91f6cdf3d` |
| 2 | [beebca7b](../../data/verification/beebca7b-1f9b-45f2-bf10-faeeab4e5c92.json) | `2026-09-05T13:41:31.922Z` | `ENOTFOUND api.jup.ag`; `ENOTFOUND aggregator-api.kyberswap.com` | `1fdb9416bef4982de3c4faaff7edd5b276317e13a6f8750bcac161ed5fe9f401` |
| 3 | [a09aaeb2](../../data/verification/a09aaeb2-b238-4fcf-9679-0d3eaf3db963.json) | `2026-09-05T13:42:31.977Z` | `ENOTFOUND api.jup.ag`; `ENOTFOUND aggregator-api.kyberswap.com` | `41326288f728d0fd44793e9c8344464a03ac8f208115221b95410ed2709b5a1b` |

[VERIFIED, source layer] Each watch failure had HTTP status `null`, raw `null`, and the exact errors `DNS lookup failed (ENOTFOUND): getaddrinfo ENOTFOUND api.jup.ag` and `DNS lookup failed (ENOTFOUND): getaddrinfo ENOTFOUND aggregator-api.kyberswap.com`. The dependent second legs were not requested.

[VERIFIED, correction] Earlier wording called the successful scan and later DNS failures intermittent access or runtime network behavior. That inference is withdrawn because both quote commands used `use_default`. The cause of the different quote results is not determined. The historical `use_default` ten-scan attempt remains incomplete because that watch stopped at its three-failure threshold. The approved escalated run is recorded below.

## Approved-context ten-cycle watch

[VERIFIED, command] After the source freeze, the same watch ran with `require_escalated`:

~~~text
npm run watch -- --amount 10 --interval 60 --cycles 10 --data /private/tmp/falconos-ten-scan-escalated.AXVNDd --vault /private/tmp/falconos-ten-scan-escalated.AXVNDd/vault
~~~

[VERIFIED, execution context] The process started at `2026-09-05T13:59:17.324Z` with `sandboxPermission: require_escalated`. It used the dedicated data directory `/private/tmp/falconos-ten-scan-escalated.AXVNDd` and its dedicated vault. It returned exit code `0` after ten scans. The npm header and ten JSON result chunks were directly observed in the exec_command and write_stdin outputs. The saved PTY text was then reconstructed from those chunks and the raw records, and is saved in [the reconstructed output](../../data/verification/2026-09-05-ten-scan-escalated.pty-output.txt), with SHA-256 `c2b37e1bd1fce6e7719df834ef72235b7eb11709bb96b797e0aebffc23616825`. That hash identifies the reconstructed file and is not independent emitted-hash evidence. Stdout and stderr were not captured as separate streams. No error line appeared in the combined output.

[VERIFIED, source freeze] The before and after manifests cover 11 files under `src` and `test`. Both have aggregate SHA-256 `67f89f3ae9cb7c8cefe6d464e249c4ed159d83e8746256b1507b9c9f187eda05`. The comparison returned `changedFiles: []` and `byteIdentical: true`. See the [before manifest](../../data/verification/2026-09-05-operating-source-manifest-before.json), [after manifest](../../data/verification/2026-09-05-operating-source-manifest-after.json), and [escalated watch manifest](../../data/verification/2026-09-05-ten-scan-escalated.json).

[VERIFIED, watch coverage] All ten scans had `validQuotes: 4`, `expectedQuotes: 4`, and `complete: true`. The 40 observations had HTTP status `200`, `error: null`, non-null quotes, and raw provider data. The raw records were copied into [data/verification](../../data/verification), and their hashes match their exact copied bytes. The exported Markdown notes repeat those hashes, which gives an independent exporter-artifact check. The reconstructed PTY text is consistency evidence only.

| Sequence | Record | Assessed at | Candidate statuses | Quoted deltas | SHA-256 |
| ---: | --- | --- | --- | --- | --- |
| 1 | [2fa4709f](../../data/verification/2fa4709f-1847-4bbf-a564-99053448c9d2.json) | `2026-09-05T13:59:32.773Z` | `REJECT`, `REVIEW` | `-0.002478`, `0.000255` | `caf138ed8c486b9cc105c52dfef416d1bf7863e687e9000ed9602397c03bcdb6` |
| 2 | [8dda165d](../../data/verification/8dda165d-c846-439f-b732-ce5c5c07f147.json) | `2026-09-05T14:00:35.121Z` | `REJECT`, `REVIEW` | `-0.002507`, `0.000225` | `0314ede56fe89aab146ff98b4cd7d01826a8b8804128aa580470ebd9e49d15b9` |
| 3 | [c75dd71c](../../data/verification/c75dd71c-cffd-44c6-9978-86ff6dc45c49.json) | `2026-09-05T14:01:37.477Z` | `REJECT`, `REVIEW` | `-0.002499`, `0.000235` | `19f9d1b067d6f63d2a413dd264f31499d1a4674177f5c6c4fed9e77a70816b4b` |
| 4 | [60e47580](../../data/verification/60e47580-d18d-4094-8d10-90bcf69f9bf1.json) | `2026-09-05T14:02:39.823Z` | `REJECT`, `REVIEW` | `-0.002502`, `0.000230` | `48ef4d5082b3c1c368e1ec42717b99ad52545a6bafa5d84dfad89121069503d9` |
| 5 | [15fa65a3](../../data/verification/15fa65a3-c533-48b5-8780-72d5dbfdfa89.json) | `2026-09-05T14:03:42.168Z` | `REJECT`, `REVIEW` | `-0.002490`, `0.000241` | `bbeae8d00b5633dd8c00c93707f9c8652ff1fa0e653124257456c024e50660b0` |
| 6 | [03c74a41](../../data/verification/03c74a41-e298-40ba-af90-e09f012742d2.json) | `2026-09-05T14:04:44.525Z` | `REJECT`, `REVIEW` | `-0.002506`, `0.000225` | `ab2c594f96eca8264477c9a08bee5d5620a93677ba1370732a5e14708c0bcc45` |
| 7 | [8e0ddfff](../../data/verification/8e0ddfff-25c7-4dcd-9872-8c7a23be9c79.json) | `2026-09-05T14:05:46.892Z` | `REJECT`, `REVIEW` | `-0.002499`, `0.000233` | `eb0cc58c1a1080156b14a9aa96638c6d6de3e913fb1c1e7d84df7137c4c56716` |
| 8 | [4dcea2cb](../../data/verification/4dcea2cb-bf97-4ace-91bb-ddc27a84d1cb.json) | `2026-09-05T14:06:49.254Z` | `REJECT`, `REVIEW` | `-0.002488`, `0.000210` | `8e76c703c6c08ce1868998e6f3f9aa7a14c9edea5cefbfd25470788eba750bef` |
| 9 | [2ca538e9](../../data/verification/2ca538e9-a9b1-4842-afcf-87e532543100.json) | `2026-09-05T14:07:51.854Z` | `REJECT`, `REVIEW` | `-0.002488`, `0.000206` | `f4095a46cc26dee50c2595e53cf1260bf3c6a8b67dc85184dd7b78794c767c2a` |
| 10 | [d41f37b3](../../data/verification/d41f37b3-6e32-41e0-9ed3-3bc3d02511f1.json) | `2026-09-05T14:08:55.536Z` | `REVIEW`, `REVIEW` | `0.001765`, `0.000241` | `cb86818f37759281ef7ee83788b2201e1aafe0519e980d6b0534fdcc758ae57e` |

[VERIFIED, assessment reasons] The Base-to-Solana candidate had `REVIEW` with `COSTS_INCOMPLETE`, `INVENTORY_UNVERIFIED`, and `SEQUENTIAL_QUOTES_NOT_FILLS` in every scan. The Solana-to-Base candidate had `REJECT` with those same reasons plus `NO_POSITIVE_QUOTED_DIFFERENCE` in scans 1 through 9. Scan 10 had `REVIEW` for both candidates. Every candidate kept `netProfitUsdc: null` and `executionReady: false`.

[INFERRED, context limit] The ten successful scans show quote access in the approved escalated context. They do not explain the earlier `use_default` DNS failures, and they do not support a provider outage claim. The historical three-scan failure remains in the preceding section.

## Validation and open checks

[VERIFIED, local validation] The historical manifest still records four earlier raw records and a three-cycle watch with exit code `2`. The new escalated manifest records ten parseable raw records, 40 observations, unique IDs, strictly increasing assessment times, matching copied raw hashes and exporter-note hashes, all HTTP 200 results, all raw values present, and exit code `0`. See the [historical evidence manifest](../../data/verification/2026-09-05-live-checks.json) and [new escalated evidence manifest](../../data/verification/2026-09-05-ten-scan-escalated.json).

[REPORTED, cli_luna report and root review, 2026-09-05] Registry fixture integration is recorded as complete. cli_luna reported "typecheck exit0 and full suite tests40/pass40/fail0"; root reviewed this result. CHK-09 remains pending root final handoff review.

[VERIFIED, scope] The metadata read gives direct evidence for six decimals at the captured slots and block. Live source diagnosis has direct DNS evidence for the failed historical watch and quote success in the approved escalated context, but the earlier permission-context difference remains unexplained. No profitability, fill, inventory, or sustained availability claim follows from these reads.
