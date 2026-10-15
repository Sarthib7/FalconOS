FROM rust:1-bookworm@sha256:114c7a4425406451c2866b6aafe69fe29b1b298832db1277d411ac73c82d04d6 AS build
WORKDIR /build
COPY Cargo.toml Cargo.lock ./
COPY src ./src
COPY fixtures ./fixtures
RUN cargo build --locked --release --bin falcon-mcp-rust

FROM debian:bookworm-slim@sha256:7c7b2c966bc9ee8cedfeef67e0e279108992c77681fa595db4a9d65c06ccc587
COPY --from=build /etc/ssl/certs/ca-certificates.crt /etc/ssl/certs/ca-certificates.crt
COPY --from=build /build/target/release/falcon-mcp-rust /usr/local/bin/falcon-mcp-rust
USER 65532:65532
ENV FALCON_MCP_HOST=0.0.0.0
EXPOSE 8792
ENTRYPOINT ["/usr/local/bin/falcon-mcp-rust"]
