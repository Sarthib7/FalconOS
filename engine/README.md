# Falcon Engine

Real-time, keyless, advisory-only Stocks/pre-IPO decision engine in Rust.

```sh
cargo run --release -- preipo
cargo run --release -- preipo --watch --interval-ms 15000
```

The engine preserves the TypeScript V66 exact-integer math and fail-closed READY/NO_DATA/BLOCKED semantics.

## Offline Stocklana demo

From the repository root, run:

```sh
CARGO_NET_OFFLINE=true npm run dash -- demo
```

This command uses fixed synthetic captures. It prints `PUBLISHED`, `BLOCKED`, and `NO_DATA` council outcomes with snapshot hashes, source citations, and graph counts. The demo makes no market or RPC request and does not access a wallet or create a transaction. **[VERIFIED, command `cargo run --offline --quiet --manifest-path engine/Cargo.toml -- demo`, run 2026-09-23]**

The same command can run directly from the engine crate:

```sh
cargo run --offline -- demo
```
