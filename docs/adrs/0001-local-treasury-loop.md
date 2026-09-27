# ADR 0001: Start with the local treasury loop

[VERIFIED, decision context] Date: 2026-09-26. Owner: coordinator. Status: Completed. The user accepted the pitch and explicitly selected "Local loop first".

## Context and options

[VERIFIED, existing topology] `web/vite.config.js` defines `appType: 'mpa'`. `web/package.json` uses Vite and Node's test runner. SPEC V64 and V65 keep the stocks scope advisory-only.

| Option | Consequence |
| --- | --- |
| Browser simulation first | [INFERRED] Fast complete product path using the existing static package. No real capital authority. |
| Protocol integration first | [INFERRED] Earlier chain proof, but reserve configuration and the test environment can delay the user flow. |
| New backend first | [INFERRED] Earlier server persistence, but adds deployment, authentication, and operational work before the product loop is tested. |

## Decision

[INFERRED, implementation choice under the accepted direction] Add one isolated `/treasury/` entry to the existing web build. Implement exact-money simulation, a graph-driven decision, saved outcomes, and a visible failure path. Keep the pitch as the design reference.

[INFERRED, consequences] The local prototype uses synthetic observations and zero interest or fees. It provides no account authority. Tests must not be presented as proof of protocol execution. The complete funded MVP remains a later gate in [the plan](../../plans/treasury-mvp.md).

## Least confident decisions

1. [INFERRED] The browser implementation may need different storage and scheduling when hosted execution begins.
2. [INFERRED] The first tester feedback may change the mandate form before lending integration.
