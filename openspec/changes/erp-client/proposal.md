## Why

F02 (US-002) requires the portal to read customers, products, and receivables
from the DistriLux ERP, the system of record (RN-09), but the backend has no way
to reach it yet. The ERP enforces per-minute and per-day limits and has short
outages (RN-15), so every caller needs the same validated, rate-limit-aware
access; building it once now lets the upcoming synchronization and, later, order
submission reuse it instead of each calling the ERP on its own.

## What Changes

- Add a single ERP adapter in `src/shared/erp/` that is the only part of the
  system allowed to call the ERP API.
- List every customer, product, and receivable from the ERP across all pages,
  optionally restricted to records changed after a given instant
  (`updatedSince`, sent as `atualizadoDesde`).
- Validate every ERP payload (`Cliente`, `Produto`, `Titulo`, `Problema`, and
  the page envelope) with Zod before it is used, keeping the ERP's Portuguese
  field names because they describe the external contract. Records are
  validated one by one and returned as `{ items, rejected }`, so one invalid
  record neither blocks the listing nor disappears silently; a malformed page
  is treated as an ERP failure and retried.
- Retry transient ERP failures: honor `Retry-After` on 429/503, back off on other
  5xx and timeouts, never retry 401/422/other 4xx, and surface a
  `RateLimitedError` when the ERP asks to wait more than 300 seconds.
- Apply a 60-second timeout to every ERP call (the ERP runs on Render and can be
  slow after being idle).
- Add `ERP_BASE_URL` and `ERP_API_KEY` to the validated environment and to
  `.env.example` (key left empty).
- Add integration tests against the real ERP that are skipped when
  `ERP_API_KEY` is not defined, so CI stays green when the ERP is offline.

### Non-goals

- Persisting ERP data, scheduling the synchronization, or storing the last sync
  timestamp.
- Serving the last synced data during long ERP outages (RN-15 fallback).
- Sending orders to the ERP or idempotency keys (RN-07).
- ERP routes other than `GET /v1/clientes`, `GET /v1/produtos`, and
  `GET /v1/titulos`, and their optional filters other than `atualizadoDesde`.
- Mapping ERP fields to portal domain names or formatting amounts in reais.
- Running the real-ERP tests in CI or storing the ERP key there.

## Capabilities

### New Capabilities

- `erp-data-retrieval`: reading customers, products, and receivables from the
  ERP as complete, validated lists, including incremental reads, transient
  failure handling, rate-limit signaling, and configuration of the ERP
  connection.

### Modified Capabilities

None.

## Impact

- **Business:** enables the F02 synchronization that keeps credit limits,
  receivables (RN-01), product status (RN-04), and table prices (RN-05) aligned
  with the ERP. No user-visible behavior changes yet.
- **API:** none. No HTTP endpoint is added or changed, so `openapi.json` is
  unchanged.
- **Database / migrations:** none.
- **Security:** the ERP key is read only from validated environment variables,
  sent only in the `X-Api-Key` header, and never committed, logged, or included
  in errors (RN-14). `.env` stays git-ignored and CI never receives the key.
- **Observability:** the adapter does not log; the key, request/response
  headers, and response bodies must never reach logs.
- **Configuration:** two new environment variables, `ERP_BASE_URL` and
  `ERP_API_KEY`; local runtimes that start the API (Docker Compose, container
  test) are affected by the new required variable.
- **Dependencies:** none added; uses the global `fetch`, Zod 4, and Vitest.
- **Documentation:** `.env.example`, task `docs/tasks/erp-client.md`, and the
  change summary `docs/changes/erp-client.md`.
- **Code:** new `src/shared/erp/` (schemas, client, retry helper, tests);
  changes to `src/shared/config/env.ts` and its tests.
