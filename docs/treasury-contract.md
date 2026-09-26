# Treasury simulation contract

[INFERRED, implementation contract, 2026-09-26] Owner: architect. Status: In Progress. This contract implements the user's confirmed local-loop-first choice. SPEC I14 and V77 through V86 govern it. The coordinator owns changes to this interface.

## Module ownership

| Module | Owner | Boundary |
| --- | --- | --- |
| `web/treasury/domain.mjs` | domain implementer | Pure validation, graph, decision, simulated settlement, and replay. No browser, file, network, clock, or wallet effects. |
| `web/treasury/store.mjs` | coordinator | Browser-local storage and serialized commands. |
| `web/treasury/app.mjs`, `index.html`, `style.css` | UI implementer | Forms, graph, synthetic scenarios, controls, and history. |

## Domain exports

[INFERRED, exact version 1 contract] Money inputs are unsigned USDC decimal strings with at most six fractional digits. Internal and returned balances use integer-unit strings. Reject amounts above Solana's unsigned 64-bit token amount range. Never use floating-point arithmetic for balances.

```js
createRun({ id, createdAt, totalUsdc, reserveUsdc, investmentCapUsdc,
  minLiquidityUsdc, maxObservationAgeSeconds }) // -> Run
appendEvent(run, event) // -> new Run; validates/replays; never mutates input
replayRun(run) // -> View
buildGraph(state, at) // -> Graph; also used by replay
decide(graph) // -> Decision; graph is its only decision input
formatUsdc(integerUnits) // -> exact human-readable decimal string
```

[INFERRED, Run shape] `Run` has exact keys: `schemaVersion: 1`, `mode: "simulation"`, `id`, `createdAt`, `setup`, and `events`. `setup` contains the five named money/policy inputs above, excluding id and createdAt. UUIDs identify the run and each event. Dates are canonical UTC ISO strings. Event times cannot precede creation or the prior event. `maxObservationAgeSeconds` is an integer from 1 through 3600.

```js
// Events have these exact keys. All include id and at.
{ id, at, type: 'observe', observation: {
  source: 'synthetic', status: 'ok' | 'unavailable',
  observedAt, availableLiquidityUsdc // decimal string for ok; null for unavailable
} }
{ id, at, type: 'cycle' }
{ id, at, type: 'revoke' }
{ id, at, type: 'owner_redeem' }
```

[INFERRED, command semantics] Identical repeated event IDs return the existing run unchanged. Conflicting content with a repeated ID is an error. Limit one run to 200 events; reject excess without truncation. No policy widening or new funding command exists in this slice. Revocation is permanent within a run. Explicit owner redemption remains separate from agent authority.

## State and view

[INFERRED, initial balances] Require `reserve + investmentCap <= total`. Initialize reserve from `reserveUsdc`, delegated idle from `investmentCapUsdc`, undelegated cash from the remainder, and the position at zero. Reserve and undelegated cash never fund agent actions. Simulated fees and interest are zero.

```js
// View, returned by replayRun:
{
  state: {
    runId, revision, createdAt, at, mode: 'simulation', revoked,
    balances: { totalUnits, reserveUnits, undelegatedUnits, idleUnits, positionUnits },
    mandate: { investmentCapUnits, minLiquidityUnits, maxObservationAgeSeconds },
    observation: null | { source: 'synthetic', status, observedAt, availableLiquidityUnits },
    lastDecision: null | Decision
  },
  graph: Graph,
  entries: [ /* one Entry for each event */ ]
}
// Graph:
{ id, mode: 'simulation', at, revision,
  nodes: [{ id, kind, label, detail, data }],
  edges: [{ source, target, relation }] }
// Decision:
{ mode: 'simulation', action: 'SUPPLY' | 'REDEEM' | 'HOLD', status: 'READY' | 'BLOCKED' | 'NO_DATA',
  amountUnits, reasons: [/* human-readable strings */], evidenceNodeIds: [/* IDs */], graphId }
// Entry:
{ eventId, type, at, graph: Graph, decision: null | Decision,
  outcome: { mode: 'simulation', status: 'RECORDED' | 'SIMULATED' | 'HELD' | 'BLOCKED' | 'NO_DATA',
    action: null | 'SUPPLY' | 'REDEEM' | 'HOLD', amountUnits, message },
  balances: { totalUnits, reserveUnits, undelegatedUnits, idleUnits, positionUnits } }
```

[INFERRED, graph semantics] The domain implementer chooses typed node IDs and required relationships, then tests them. `decide` must reject malformed graphs and block action when a required relationship is missing. It reads mandate, funds, position, and observation only through the graph. Each entry retains its pre-action graph in the replay view. History is reconstructed from the command log, not claimed to be cryptographically immutable.

[INFERRED, frozen graph vocabulary] Node IDs are `mandate`, `reserve`, `undelegated`, `account`, `position`, and `observation`. Required edges are mandate to account (`authorizes`), mandate to reserve and undelegated (`excludes`), account to position (`owns`), and position to observation (`depends_on`). Observation and revocation entries have a null outcome action and zero amount. Every outcome explicitly carries simulation mode.

[INFERRED, decision order] Revoked mandate blocks every agent movement. Missing, unavailable, future, or stale observations yield `NO_DATA`. Healthy liquidity at or above the floor permits supply from delegated idle within the cap. An already funded position yields `HOLD`. Liquidity below the floor requests full redemption when a position exists. If available liquidity cannot cover the requested redemption, return `BLOCKED` and preserve the full position. Explicit owner redemption bypasses revocation but still requires fresh data and enough liquidity. Successful redemption returns funds to delegated idle. It never credits the spending reserve.

[INFERRED, replay validation] `replayRun` validates exact keys, schemas, amounts, ordering, IDs, event limits, and conservation. It derives state and outcomes from validated commands. Invalid input throws a human-readable error. Stored commands can be changed by the browser owner; this storage is not a security boundary for real funds.

## Store exports

```js
createStore({ storage, locks }) // injected objects; browser defaults allowed
// returned object:
{ load, create, dispatch, exportRun }
// load() -> null | { run, view }
// create(setup) -> Promise<{ run, view }>; error if a run already exists
// dispatch(event, expectedRevision) -> Promise<{ run, view }>
// exportRun() -> string; validated stored Run as formatted JSON
```

[INFERRED, storage contract] Use key `falcon.treasury.simulation.v1` and Web Lock `falcon.treasury.simulation.v1`. Limit stored text to 262,144 characters. Under the exclusive lock, reload and replay before each mutation. `expectedRevision` must equal the stored event count. An identical retry can return the saved result with an older revision. Persist a new command with one `localStorage.setItem` before returning success. Missing lock support, corrupt data, unavailable storage, conflicts, or quota errors must remain visible and preserve the prior record. Never silently reset, truncate, or fall back to memory. No delete/reset API exists.

## UI and verification

[INFERRED, UI contract] The route is `/treasury/`. Use the accepted pitch's dark green and mint style. Show four balances, mandate, graph, latest decision, and replayable history. Setup requires user entry or visibly labeled demo defaults. Scenario buttons write synthetic observations. `Run one cycle` writes one cycle. `Run agent` repeats bounded cycles; stop on failure, full journal, revocation, or page close. Starting automation does not reconnect after reload. Provide explicit owner redemption and a permanent-revocation confirmation. JSON export contains the simulation command log. Render untrusted strings through text nodes.

[INFERRED, UI input and access] Capture setup values before disabling the form. Rejected setup leaves inputs available for correction. Expose graph nodes and relationships to assistive technology at all supported widths.

[INFERRED, passing criteria] Domain tests cover exact amounts, conservation, supply/hold/redemption, rejected cap violation, stale/missing data, illiquid redemption, revocation, owner exit, graph relationships, duplicates, and replay. Store tests cover reload, conflict, corruption, failed writes, and lock serialization. A browser check must complete setup, supply, a blocked withdrawal, owner redemption, export, and reload.

## Least confident decisions

1. [INFERRED] Browser-local history is sufficient for this first simulation. Hosted persistence belongs to a later slice.
2. [INFERRED] Full redemption or a visible block is the simplest declared liquidity model. Real protocol behavior must be measured separately.
3. [INFERRED] The next protocol proof can use a local fork. Exact reserve and adapter settings remain unverified.
