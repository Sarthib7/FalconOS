# Web Vision

## Purpose

[VERIFIED, repository read] `web/` is an isolated Vite static site that introduces FalconOS and gates the live dashboard preview.

[REPORTED, vision-cross-reference, 2026-09-15] Current context defines FalconOS as the umbrella for Falcon Skills, the FalconOS plugin, and Falcon Investment advisory. This surface must not imply that the council is an autonomous trader or that FalconOS provides custody, pooled capital, signing, or order submission. Source: `CONTEXT.md`.

[VERIFIED, Stocklana cross-reference, 2026-09-18] Stocks Specialist implementation and Client Agent advice live in the root `stocks/` package, not in this static site. See [stocks/vision.md](../stocks/vision.md) and [stocks/agent.md](../stocks/agent.md).

## Current scope

[VERIFIED, repository read] `web/README.md` records Cloudflare Pages settings, and the site sets `https://falconos.markets/` as the canonical URL.

[VERIFIED, live fetch 2026-09-16] `https://falconos.markets/` returns HTTP 200. `/dash/` is a private-preview gate; the full dashboard UI is not public.

[VERIFIED, repository read] Public pages are landing, product, research, and the gated dash preview. Waitlist posts only when Cloudflare D1 bindings are configured.

## Boundaries

[BOUNDARY] The website does not execute Stocks advice, create DBC pools, sign transactions, or custody funds.

[BOUNDARY] Client Agents should call `npm run stocks:advice` on the root package, not the static site.

## Next proof

[INFERRED] Keep public copy aligned with Stocks advisory-only claims as Stocklana demos ship.

## Open decisions

[INFERRED] Decide whether a public read-only Stocks snapshot panel should appear on the landing page beyond the current gated dash preview.
