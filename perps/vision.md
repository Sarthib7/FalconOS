# Perps Vision

## Purpose

[VERIFIED, repository read] The Perps domain defines an advisory council contract for SOL perpetuals on Phoenix and Hyperliquid.

## Current scope

[VERIFIED, repository read] The implementation lives in `perps/perps.ts`, with contract tests in `perps/test/perps.test.ts`.

[VERIFIED, repository read] The contract builds one canonical snapshot bundle containing Phoenix and Hyperliquid market snapshots, source decisions, raw evidence hashes, normalized fields, and provenance.

[VERIFIED, repository read] A Lead Specialist produces the proposal. An independent Risk Review receives the bound proposal and has veto-only authority.

[VERIFIED, repository read] The tested local contract uses synthetic snapshots. Native market metadata and adapters for live inputs are unresolved.

[REPORTED, vision-cross-reference, 2026-09-15] Current context fixes one native SOL perpetual per venue, a versioned host-owned market registry, and one immutable canonical snapshot consumed by both advisors. Exact native IDs and values, deployed source-policy values, and official live adapters remain unresolved. Source: `CONTEXT.md:46-64`.
Evidence quote: "The first Perps Specialist covers one SOL perpetual on Phoenix and one SOL perpetual on Hyperliquid." "FalconOS pins one exact native SOL-perpetual contract definition per Phoenix and Hyperliquid in a versioned, host-owned registry." "FalconOS acquires, normalizes, hashes, and freezes one immutable snapshot before council analysis;" "the lead specialist and independent risk reviewer consume the same snapshot bytes and hash." "Exact native IDs and values, effective intervals, and the final registry schema remain unresolved." "Official Phoenix/Hyperliquid native metadata and live adapters, durable host persistence for append-only audit, deployed source-policy values, and final storage details remain unresolved." Source: `CONTEXT.md:48,50,52,54,64`

## Boundaries

[VERIFIED, repository read] Perps implementation and contract tests now live in `perps/`.

[BOUNDARY] Synthetic contract tests do not establish live venue data, execution, or custody.

## Next proof

[INFERRED] Resolve native market metadata for both venues, implement the two input adapters, and produce a non-synthetic canonical snapshot that passes the existing bundle validator.

## Open decisions

[INFERRED] Choose authoritative metadata sources, adapter versions, and field-level source precedence for each venue.
