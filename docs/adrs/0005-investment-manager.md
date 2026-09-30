# ADR 0005: FalconOS destination is an investment manager with a deal desk

[VERIFIED, user choice, 2026-09-30] The user chose the investment-manager operating model, including a deal desk. Status: Accepted as product destination. This does not grant the current codebase custody, pooling, signing, or order authority.

## Context

[VERIFIED, prior record] On 2026-09-18, FalconOS stayed advisory-only and read-only. Pooled investing, custody, allocation, and execution were reserved for a possible later regulated entity. See [CONTEXT.md](../../CONTEXT.md) "Confirmed domain decisions".

The 2026-09-30 product talk asked what launch authority FalconOS should have:

| Option | Meaning |
| --- | --- |
| A. Market intelligence | General asset and risk analysis. No personal recommendation. |
| B. Investor-specific guidance | Use an Investor Dossier to compare suitable choices. The Investor decides what to do. |
| C. Investment manager | Also source and arrange deals, then manage money under a mandate. |

[VERIFIED, user choice] The user first selected B for the plugin API. The user then selected C for FalconOS itself, and said dealings are included.

## Decision

Treat **C** as the FalconOS destination: find opportunities, arrange deals, and manage investments. Keep **B** as the first plugin return type so other agents can request investor-specific guidance without inheriting FalconOS's mandate.

Do not present current modules as already doing C. Existing Council, plugin, engine, dashboard, and mesh paths remain advisory or owner-signed Devnet proofs until a later spec change and reviewed implementation. Public use of "investment manager", "hedge fund", or similar remains unresolved. See CONTEXT.md least-confident item 5.

## Consequences

- [INFERRED] SPEC.md still describes advisory-only Council. Change it only through the `spec` skill.
- [INFERRED] Shipped copy and the gated dashboard must not claim management, pooled funds, or guaranteed returns.
- [INFERRED] A separately branded regulated entity may still be required. This ADR does not decide that name or structure.
