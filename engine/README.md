# Falcon Engine

Real-time, keyless, advisory-only Stocks/pre-IPO decision engine in Rust.

```sh
cargo run --release -- preipo
cargo run --release -- preipo --watch --interval-ms 2000
```

The engine preserves the TypeScript V66 exact-integer math and fail-closed READY/NO_DATA/BLOCKED semantics.
