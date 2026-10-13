# Archived handoff: FalconOS product destination, 2026-09-30

**Status:** Historical. ADRs 0008 and 0009 and the 2026-10-05 product direction supersede this handoff's pooled-capital interpretation. Retained for decision history. Do not use it as current product scope.

[VERIFIED, user stop] The user said write this back and close. No SPEC edit, Devnet work, commit of mesh/dashboard code, deploy, or transaction is authorized by this handoff.

Next session: turn the investment-manager destination into a SPEC change, or keep building the current advisory/Devnet track without treating destination as shipped. Do not do both in one pass.

## What this session decided

Read these; do not restate them at length:

- [CONTEXT.md](../../CONTEXT.md) session 2026-09-30
- [ADR 0005](../adrs/0005-investment-manager.md)
- [ADR 0006](../adrs/0006-one-agent-decision-engine.md)
- [ADR 0007](../adrs/0007-global-discovery-alerts.md)
- [docs/decisions.md](../decisions.md) `DEC-2026-09-30-01`

Short form:

1. FalconOS destination is an investment manager with a deal desk. Plugin first return type is investor-specific guidance. Consuming agents do not inherit FalconOS's mandate.
2. One Customer Agent on one Decision Engine. Specialists hidden by default. Advanced view shows the recorded graph.
3. Discovery is global. Residence is eligibility, not a search bound. Loop: Find → verify → assess → match → notify → track. Leads are not Opportunities. Alerts are opt-in after verify and match.
4. Before money: Plan Receipt. After: Cash Trace. Offers carry Who-Acts.

This destination supersedes the 2026-09-18 "FalconOS stays advisory-only forever" product stance in CONTEXT.md. It does not change current module contracts or SPEC.md.

## What this session did not do

- No application code, tests, deploys, or signed transactions.
- SPEC.md was not edited. It still describes advisory-only Council.
- No legal review. Public use of "investment manager" or "hedge fund" remains unresolved.
- No Opportunity source was verified. The German tokenized energy example is not a sourced deal.

## Current implementation track

Read [status.md](../../status.md) and [SPEC.md](../../SPEC.md). Do not copy them here.

Uncommitted mesh and dashboard work, including Operate/scenario files, is outside this handoff. Do not present it as deployed. SPEC T43 owner-signed Devnet lending was not proved in this session.

## Next session fork

Ask the user which fork, then do only that:

**Fork A: spec the destination.** Invoke `spec`. Amend SPEC so destination, plugin B vs FalconOS C, dossier, receipt/trace, and fail-closed eligibility are contract. Do not implement custody or outbound alerts in that pass.

**Fork B: continue current code.** Keep advisory/Devnet boundaries. Prove T43 or land uncommitted Operate/scenario work. Do not implement the manager destination until Fork A exists.

## Suggested skills

1. `using-superpowers` at session start.
2. `spec` if the user wants SPEC.md to match ADRs 0005-0007.
3. `domain-modeling` if glossary or ADRs change again.
4. `build` only after SPEC §T tasks exist for the chosen slice.
5. `diagnosing-bugs` or `debug-program` if continuing the Devnet lending proof.
6. `ponytail` on any coding work.
7. `find-docs` before any library or venue API claim.
8. `cso` before any custody, signing, pooling, or outbound-alert implementation.

Do not auto-invoke `spec` unless the user asks. Do not deploy, push, migrate, or send external calls without an explicit yes in that session.

## Least confident decisions

1. [INFERRED, unresolved] Legal authority to manage, arrange deals, or send opportunity alerts.
2. [INFERRED, unresolved] Whether pooled capital stays inside FalconOS or still needs a separate entity.
3. [NOT DETERMINED] First real Opportunity source.
4. [INFERRED] Whether first live control is per-action approval or a discretionary mandate. Destination is C; that control model was not locked.
