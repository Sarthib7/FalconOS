# Falcon Engine

Real-time, keyless, advisory-only Stocks/pre-IPO decision engine in Rust.

```sh
cargo run --release -- preipo
cargo run --release -- preipo --watch --interval-ms 15000
```

The engine preserves the TypeScript V66 exact-integer math and fail-closed READY/NO_DATA/BLOCKED semantics.

## Synthetic Stocklana demo

From the repository root, run:

```sh
npm run dash -- demo
```

Do not use offline mode with an empty Cargo cache. A local check failed with `error: no matching package named serde found`. **[VERIFIED, empty `CARGO_HOME`, 2026-09-23]** The demo uses fixed synthetic captures. Its output says `No market or RPC requests, wallet access, signing, or transactions.` **[VERIFIED, command `cargo run --offline --quiet --manifest-path engine/Cargo.toml -- demo`, run 2026-09-23]** It prints `PUBLISHED`, `BLOCKED`, and `NO_DATA` outcomes with snapshot hashes, citations, and graph counts. **[VERIFIED, same command output]**

After Cargo caches the dependencies, set `CARGO_NET_OFFLINE=true` to require offline dependency resolution.

The same command can run directly from the engine crate:

```sh
cargo run -- demo
```
