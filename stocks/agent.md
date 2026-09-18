# Stocks Client Agent contract

[VERIFIED, repository, 2026-09-18] External Client Agents call FalconOS Stocks through a bounded stdin/stdout JSON surface. FalconOS remains advisory-only. The Client Agent retains decision and execution ownership.

## Command

```bash
node stocks/cli.ts advice < request.json
# or
npm run stocks:advice < test/fixtures/stocks-agent-healthy.json
```

- Read exactly one UTF-8 JSON object from stdin (≤8 MiB).
- Write exactly one JSON line to stdout (≤64 KiB).
- Diagnostics go to stderr only.
- Exit `0` on a handled request (including `BLOCKED` / `NO_DATA` advice).
- Exit `2` on invalid request or advisory-unavailable error envelope.
- No live market GET/RPC, wallet, signer, custody, or persistent write on this path.

## Request

### Fixture mode (offline smoke)

```json
{
  "schemaVersion": 1,
  "kind": "stocks.agent-request",
  "requestId": "11111111-1111-4111-8111-111111111111",
  "runId": "run-1",
  "agentId": "external-client-agent",
  "mode": "fixture",
  "case": "healthy"
}
```

`case`: `healthy` | `low-liquidity` | `stale`

### Snapshot mode

Same envelope with `mode: "snapshot"` and a frozen canonical basket `snapshot` object. Optional `assets`, `integrityMaxAgeMs`, and `checkedAt` configure the host council.

`agentId` is provenance only. It does not select models, tools, or authority.

## Response

```json
{
  "schemaVersion": 1,
  "kind": "stocks.agent-response",
  "requestId": "...",
  "runId": "...",
  "agentId": "...",
  "advice": { "kind": "stocks.advice", "status": "PUBLISHED|BLOCKED|NO_DATA", "...": "..." },
  "integrity": { "kind": "stocks.market-integrity", "status": "VERIFIED|STALE|DIVERGENT|NO_DATA", "...": "..." },
  "authority": "advisory-only",
  "executionReady": false
}
```

## Error

```json
{
  "schemaVersion": 1,
  "kind": "stocks.agent-error",
  "requestId": null,
  "code": "INVALID_JSON|INVALID_REQUEST|FORBIDDEN_FIELD|SNAPSHOT_INVALID|ADVISORY_UNAVAILABLE|RESPONSE_TOO_LARGE",
  "message": "safe redacted detail",
  "authority": "advisory-only",
  "executionReady": false
}
```

## Forbidden fields

Exact-key validation rejects wallet, signer, key, secret, transaction, custody, pool, allocation, approval, execution, model, and tool authority fields anywhere in the request.

## Human vs agent demos

| Audience | Command |
| --- | --- |
| Judges / humans | `npm run stocks:demo`, `npm run stocks:dbc` |
| Client Agents | `npm run stocks:advice` |
| Live operators | `npm run stocks` (network; not the agent path) |
