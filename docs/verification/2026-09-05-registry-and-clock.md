# Registry and clock verification

[VERIFIED, scope] This record covers the live assessment clock correction and the historical token metadata fixture. It does not close the phase or prove live provider access.

## Live assessment clock

[VERIFIED, code path] `src/cli.ts` now captures `assessedAt` after `await collect(...)` for live scans. Demo scans capture one timestamp before synthetic cycle generation. `stablecoins/scan.ts` still uses `MAX_AGE_MS = 10_000` and keeps its stale, future, provider-time, and expiry checks.

[VERIFIED, regression] The retained advancing-clock test was run against an isolated copy of the old `src/cli.ts`. The old source returned:

~~~text
exit_code:1
tests 1
pass 0
fail 1
AssertionError ... 'REJECT' !== 'REVIEW'
~~~

The isolated copy was temporary and was removed after the run. The shared source stayed unchanged during that reproduction.

[VERIFIED, fixed regression] The fixed source returned this output for the same test:

~~~text
$ node --test --test-name-pattern='live assessment starts after collection completes' test/cli.test.ts
tests 1
pass 1
fail 0
cancelled 0
skipped 0
~~~

The test advances its injected clock during collection. It checks `REVIEW`, one output, one request, and `receivedAt <= assessedAt` for every saved leg. Existing stale, future, provider-time, and expiry tests remain in the scoped run.

## Historical metadata fixture

[VERIFIED, fixture path] `stablecoins/test/sources.test.ts` reads only `test/fixtures/public-metadata.json`. The fixture wraps the complete capture under `capture` and keeps the original request and response values. Its wrapper records the source path, capture hash, and collector provenance. The test hashes the serialized capture and checks the wrapper hash.

[VERIFIED, local hash] The source capture was read at `data/verification/2026-09-05-public-metadata.json`. Its size was `5769` bytes and its SHA-256 was `49218bf81a6b64d73649f96843dd6f1548ff26b698743709af9ac6f24dd2487a`. The test fixture path stores the same SHA in its provenance wrapper. Earlier `committed-path fixture` wording described the intended tracked path. It did not prove a Git commit.

[VERIFIED, fixture assertions] The registry test matched these exact values:

| Chain | Asset | Address | Metadata evidence |
| --- | --- | --- | --- |
| Solana | USDC | `EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v` | decimals `6`, finalized slot `444532563` |
| Solana | EURC | `HzwqbKZw8HxMN6bF2yFZNrht3c2iXXzpKcFu7uBEDKtr` | decimals `6`, finalized slot `444532421` |
| Base | USDC | `0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913` | decimals `6`, block `0x308df13` (`50913043`) |
| Base | EURC | `0x60a3E35Cc302bFA44Cb288Bc5a4F316Fdb1adb42` | decimals `6`, block `0x308df13` (`50913043`) |

[VERIFIED, capture window] The capture window in the fixture is `2026-09-05T13:37:07Z` through `2026-09-05T13:37:52Z`, with second precision. The Solana requests use `commitment: "finalized"`. The Base requests use `eth_call` with selector `0x313ce567` at the pinned block.

[VERIFIED, annotation] `stablecoins/sources.ts`, `src/types.ts`, `stablecoins/scan.ts`, and `src/vault.ts` describe six-decimal metadata as historically verified by the RPC capture on 2026-09-05. They state that runtime metadata revalidation was not performed.

[INFERRED, metadata limit] The fixture and its test prove registry alignment with the saved historical capture. They do not prove provider identity, current token metadata, continuous revalidation, or live RPC access. The original saved evidence was not changed in this pass.

## Verification output

[VERIFIED, typecheck] The command returned exit code `0`:

~~~text
$ npm run typecheck
> falconos@0.1.0 typecheck
> tsc --noEmit
~~~

[VERIFIED, scoped tests] The command returned exit code `0`:

~~~text
$ node --test test/cli.test.ts stablecoins/test/sources.test.ts stablecoins/test/scan.test.ts test/vault.test.ts
tests 40
pass 40
fail 0
cancelled 0
skipped 0
~~~

[VERIFIED, full suite] The command returned exit code `0`:

~~~text
$ npm test
> falconos@0.1.0 test
> node --test test/*.test.ts stablecoins/test/*.test.ts preps/test/*.test.ts
tests 40
pass 40
fail 0
cancelled 0
skipped 0
~~~

[VERIFIED, source freeze] The final source and test hashes were:

~~~text
46fde9bc8af0f5fb4ebe5ebd7ef691cd4424199cb96c114fa056c5fe3b3d9c47  src/cli.ts
837cefeb87af187fe3cf09a002536f9a0ceab973a80a01d6a4e660ec32c71634  stablecoins/sources.ts
179eb49e0e38371638f0e76ddf739cfec1a13f2200639d732038843743d98109  src/types.ts
bc9c9f6b7701475d54cca4656ffb59c0d706f29654e4c6655d7fd1b8b281fe16  stablecoins/scan.ts
09d29c02acc059ae91195993b31747c184b501d84f6464076287243f0050a9e4  src/vault.ts
b1a2b9692a6b06cf16e7177acf382a3a44f2a590e28ac412c08476e283dcf4cd  test/cli.test.ts
9aee78f757b7256ca090a1de295cfa4b9f38b183904bd84ba5c45427c262a85f  stablecoins/test/sources.test.ts
521c75311270665ab83199f1320cc41c3f7a3ae92810674a09dac197587cdbb1  test/vault.test.ts
75928e9cf4c4255bccba7c79dd8235171956f794f94963d008f3be7e3e976691  test/fixtures/public-metadata.json
~~~

[INFERRED, spec limit] No `SPEC.md` exists in this repository. The scoped clock invariant and bug trace are recorded in `docs/archive/memory/evidence-files.md` instead.
