#!/bin/sh
set -eu

ROOT=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
exec cargo run --locked --release --manifest-path "$ROOT/mcp-rust/Cargo.toml" --bin falcon-mcp-rust -- "$@"
