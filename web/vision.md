# Web Vision

## Purpose

[VERIFIED, repository read] `web/` is an isolated React and Vite site that explains the FalconOS council and labels the current state of the three displayed domains: Stablecoins, Perps, and Stocks.


[REPORTED, vision-cross-reference, 2026-09-15] Current context defines FalconOS as the umbrella for Falcon Skills, the FalconOS plugin, and Falcon Investment advisory. This surface must not imply that the council is an autonomous trader or that FalconOS provides custody, pooled capital, signing, or order submission. Source: `CONTEXT.md:30-44`.
Evidence quote: "FalconOS is the umbrella product." "Falcon Investment is a council of specialist advisory agents, not an autonomous trader." "FalconOS and Falcon Investment provide no custody, pooled capital, signing, or order submission." Source: `CONTEXT.md:32,38,44`

## Current scope

[VERIFIED, repository read] `web/README.md` records Cloudflare Pages settings, and `web/index.html` sets `https://falconos.markets/` as the canonical URL.

[VERIFIED, repository read] The waitlist is a disabled local preview. It sends and stores nothing, and it does not create a signup.

[VERIFIED, repository read] `web/src` has no network request, client storage, signing, transaction construction, or transaction submission behavior.

## Boundaries

[VERIFIED, coordinator read] Cloudflare Pages deployment and DNS setup are manual and were not performed.

[BOUNDARY] A networked waitlist, persistent storage, signing, and transaction behavior remain outside this site's current scope.

## Next proof

[INFERRED] After the next site change, run `npm run build` from `web/`, open the built site locally, and verify that the waitlist produces no network or storage activity.

## Open decisions

[INFERRED] Decide who owns the manual Pages project and DNS setup, and whether the waitlist should ever move beyond a local preview.
