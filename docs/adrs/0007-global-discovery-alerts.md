# ADR 0007: Global discovery, residency as eligibility, verified alerts

[VERIFIED, user direction, 2026-09-30] Status: Accepted as discovery destination. Investment search is global. Investor location filters what FalconOS may offer or manage, not what it may research.

## Context

The user rejected bounding the Investor to one country. A US Investor should be able to hear about a German tokenized energy project if it is real, accessible, and better after full costs. The user also wants a proactive desk: find deals, check fit, and ping opted-in Investors, compared to a sales desk rather than a waiting chatbot.

[VERIFIED, this session] No tokenized German energy project, return, or venue was sourced or verified. Treat that story as an example only.

## Decision

Run a continuous loop: **Find → verify → assess → match → notify → track**.

- A **Lead** is an unverified market finding. Scraping, feeds, and specialist notes may create Leads.
- An **Opportunity** requires verified current terms, what the Investor would own, all-in costs or an explicit unknown, and an exit path. Until those exist, do not pitch it.
- Ask where the Investor lives and how they can invest. Use that as eligibility. Show a strong Opportunity they cannot access as **not available**, with the specific reason.
- Send alerts only after opt-in, and only for Opportunities that pass verify and match.

Do not invent yields, liquidity, or demo deals to fill the loop.

## Consequences

- [INFERRED] The first live Opportunity source is not chosen. Naming a vendor or scrape target is later work.
- [INFERRED] Proactive contact is a marketing and regulatory surface. Do not implement outbound pings until that review exists.
- [INFERRED] `$100` example size makes fixed fees and FX often dominate. Plan Receipts must show that, not hide it in a percentage yield.
