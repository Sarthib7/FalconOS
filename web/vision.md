# Web Vision

[VERIFIED, sources: `README.md`, `vite.config.js`] Historical snapshot. Current landing and dashboard are React/Vite routes. See [current source layout](README.md#source-layout).

## Purpose

[VERIFIED, repository read, 2026-09-16] `web/` is an isolated **Vite static** site. The production landing page is a self-contained dark Liquid Metal `index.html` (SPEC V55): council narrative, interactive Research/Strategy/Risk/Capital tour, and advisory-only copy. A separate `/dash` snapshot page shows illustrative market data; it is not live trading.


[REPORTED, vision-cross-reference, 2026-09-15] Current context defines FalconOS as the umbrella for Falcon Skills, the FalconOS plugin, and Falcon Investment advisory. This surface must not imply that the council is an autonomous trader or that FalconOS provides custody, pooled capital, signing, or order submission. Source: `CONTEXT.md:30-44`.
Evidence quote: "FalconOS is the umbrella product." "Falcon Investment is a council of specialist advisory agents, not an autonomous trader." "FalconOS and Falcon Investment provide no custody, pooled capital, signing, or order submission." Source: `CONTEXT.md:32,38,44`

## Current scope

[VERIFIED, repository read] `web/README.md` records Cloudflare Pages settings, and `web/index.html` sets `https://falconos.markets/` as the canonical URL.

[VERIFIED, repository read] The waitlist is a disabled local preview. It sends and stores nothing, and it does not create a signup.

[VERIFIED, repository read, 2026-09-16] The landing page has no wallet connection, signing, transaction construction, or order submission. Runtime network fetches on the public landing are limited to same-origin static assets; the `/dash` build step may refresh a committed market snapshot when `COINGECKO_API_KEY` is present in the build environment.

## Boundaries

[VERIFIED, live fetch 2026-09-16] `https://falconos.markets/` returns HTTP 200 and serves the current page. Cloudflare Pages and DNS are live and user-managed.

[BOUNDARY] A networked waitlist, persistent storage, signing, and transaction behavior remain outside this site's current scope.

## Next proof

[INFERRED, 2026-09-16] After the next site change: `npm --prefix web run build`, `npm --prefix web test`, and confirm `https://falconos.markets/` still returns HTTP 200 with V55 meta/canonical tags intact.

## Open decisions

[INFERRED] Decide whether the waitlist should ever move beyond a local preview.
