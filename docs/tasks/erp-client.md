---
title: ERP HTTP client
date: 2026-11-24
owners: [FlavioNorberto]
tags: [F02, US-002, erp, shared]
related_specs: []
related_adrs: [ADR-0001, ADR-0003]
---

# ERP HTTP client

## Objective

The portal must read customers, products, and receivables from the DistriLux
ERP, which is the system of record (RN-09). Today no part of the backend talks
to the ERP. This task creates the single adapter through which the API calls the
ERP, so that the F02 synchronization (now) and order submission (later) share one
validated, rate-limit-aware client, and no other part of the system calls the ERP
directly. The adapter lives in `src/shared/erp/` because it will be used by more
than one module and modules must not import each other.

## Scope

### Included

- `createErpClient({ baseUrl, apiKey, fetch })` returning `listCustomers`,
  `listProducts`, and `listReceivables`. Dependencies are injected; the client
  never reads the environment or creates its own `fetch`.
- Each list function accepts an optional `updatedSince` (sent as
  `atualizadoDesde`) and reads every page: it requests page 1 with
  `tamanho=50`, reads `totalPaginas`, and requests every following page up to
  the last one. Records are validated one by one and returned as
  `{ items, rejected }`: valid records in `items`, invalid ones in `rejected`
  with their `codigo`/`numero` (when readable), page number, and Zod issues.
- Zod schemas for the ERP payloads: `Cliente`, `Produto`, `Titulo`, `Problema`,
  and the paginated envelope. Field names keep the ERP's Portuguese names because
  they describe the external contract.
- `withRetry`, which runs a call and retries it according to the error rules in
  the contract below, including a `RateLimitedError` with `retryAfterSeconds`.
- A 60-second timeout per HTTP call (the ERP runs on Render and may take up to a
  minute to answer after being idle).
- `ERP_BASE_URL` (`z.url()`) and `ERP_API_KEY` (`z.string().min(1)`) in the
  environment schema and its tests.
- `.env.example` entries: `ERP_BASE_URL=https://pta-erp-api.onrender.com` and an
  empty `ERP_API_KEY=`.
- Unit tests for `withRetry` using Vitest fake timers, and unit tests for the
  client with an injected fake `fetch` (no real ERP), including a page with one
  invalid record in the middle.
- Integration tests against the real ERP in
  `src/shared/erp/erp-client.integration.test.ts`, run with
  `pnpm test:integration` and skipped when `ERP_API_KEY` is not defined.

### Out of scope / Non-goals

- Persisting ERP data in the portal database.
- Scheduling or triggering the synchronization, and storing the last sync
  timestamp.
- Serving the last synced data during long ERP outages (RN-15 fallback).
- Sending orders to the ERP, idempotency keys (RN-07), and every ERP route other
  than `GET /v1/clientes`, `GET /v1/produtos`, and `GET /v1/titulos`.
- The ERP's optional route filters (`uf`, `status`, `categoria`, `ativo`,
  `cliente`, `emissaoDesde`, `vencimentoAte`).
- Deciding what to do with rejected records: storing valid ones, keeping the
  last good version of invalid ones, counting rejections in the sync run, logging
  their code and error, and failing the run when more than 10% of an entity is
  rejected all belong to the synchronization task.
- Mapping ERP fields to portal domain names or converting cents to reais.
- Any HTTP endpoint of this API, OpenAPI change, or database migration.
- Running the integration tests in CI or configuring the ERP key there.

## Rules and contract

| Item       | Definition                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| ---------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Fields     | `Cliente`: codigo (string), razaoSocial (string), cnpj (string), cidade (string), uf (string), segmento (string), limiteCreditoCentavos (integer cents), vendedor (string), dataCadastro (date `YYYY-MM-DD`), status (`ATIVO` \| `BLOQUEADO` \| `INATIVO`), atualizadoEm (ISO date-time with offset). All required, none nullable.                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
|            | `Produto`: codigo (string), descricao (string), categoria (string), unidade (string), precoTabelaCentavos (integer cents), ativo (boolean), atualizadoEm (ISO date-time with offset). All required, none nullable.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
|            | `Titulo`: numero (integer), cliente (string, customer code), pedidoErp (integer), parcela (string, e.g. `"1/3"`), valorCentavos (integer cents), emissao (date), vencimento (date), pagamento (date or `null`), status (`PAGO` \| `EM_ABERTO` \| `VENCIDO`), atualizadoEm (ISO date-time with offset). All required; only `pagamento` is nullable. Only receivables issued from 2026-10-01 are returned.                                                                                                                                                                                                                                                                                                                                                                                |
|            | Page envelope: `dados` (array), `pagina`, `tamanho`, `total`, `totalPaginas` (integers). `Problema`: `type`, `title`, `status` (integer), `detail`, `instance` (required); `erros` (optional array of `{ campo, mensagem }`).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| Uniqueness | Not applicable                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| Listing    | Query parameters: `pagina` (min 1, default 1), `tamanho` (1–50, default 20; the client always sends 50), optional `atualizadoDesde` (ISO date-time or date; only records changed after it are returned). Results are concatenated in page order as returned by the ERP. Every request carries the `X-Api-Key` header.                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| Update     | Not applicable (read-only client)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| Deletion   | Not applicable                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| Errors     | Retry budget: 1 initial call plus up to 3 retries (4 calls in total). 429 or 503: wait `Retry-After` seconds (5 seconds when absent) and retry. `Retry-After` above 300 seconds: throw `RateLimitedError` with `retryAfterSeconds` immediately, without waiting. Other 5xx, timeout, network failure without a response, non-Problem error body (e.g. an HTML 502), or a malformed page (invalid JSON, missing `dados` or `totalPaginas`): retry waiting 1 s, 2 s, and 4 s. 401, 422, and other 4xx: never retried. When every attempt fails: throw an error carrying the status and, when the body is a `Problema`, its detail and erros. An invalid individual record never fails the call; it is returned in `rejected`. Never log the key, the headers, or response bodies (RN-14). |

## Acceptance criteria

- [ ] Given a call that fails twice with 500 and then succeeds, when it runs through `withRetry`, then the successful result is returned.
- [ ] Given a call that always fails with 500, when it runs through `withRetry`, then an error carrying status 500 is thrown after 4 calls (1 initial call plus 3 retries).
- [ ] Given a call that fails with 429 and `Retry-After: 1`, when it runs through `withRetry`, then it waits 1 second and calls again.
- [ ] Given a call that fails with 429 and `Retry-After: 3600`, when it runs through `withRetry`, then `RateLimitedError` with `retryAfterSeconds = 3600` is thrown immediately, without waiting.
- [ ] Given a call that fails with 422, when it runs through `withRetry`, then an error is thrown immediately and the call is not repeated.
- [ ] Given a call whose `fetch` fails without a response, or whose error body is not a `Problema`, when it runs, then it is retried like a 5xx.
- [ ] Given a page with one invalid record in the middle, when the list is requested, then the valid records are returned in `items` and the invalid one in `rejected` with its code, page number, and Zod issues.
- [ ] Given a page without `dados` or `totalPaginas`, or with invalid JSON, when the list is requested, then it is retried like a 5xx and an error is thrown if it persists.
- [ ] Given a valid ERP key, when `listCustomers`, `listProducts`, or `listReceivables` is called, then it reads every page and `items` plus `rejected` equals the response `total`.
- [ ] Given `updatedSince` in the future, when any list function is called, then `items` and `rejected` are empty.
- [ ] Given an invalid ERP key, when any list function is called, then it throws an error with status 401.
- [ ] Given `ERP_BASE_URL` is not a valid URL, when the environment is parsed, then parsing fails.
- [ ] Given `ERP_API_KEY` is missing or empty, when the environment is parsed, then parsing fails.
- [ ] Given `ERP_API_KEY` is not defined, when `pnpm test:integration` runs, then the ERP integration tests are skipped and CI stays green with the ERP offline.

## Technical constraints

- Validate every ERP payload with Zod before it is used (AGENTS.md).
- `src/shared/erp/` must not import `src/modules` or `src/app`; modules must not
  import each other.
- Inject `baseUrl`, `apiKey`, and `fetch`; the client never reads `env` and never
  creates its own `fetch`.
- The ERP key is read from validated environment variables and is never
  committed, logged, or returned (RN-14).
- No new dependencies: use the global `fetch`, `AbortSignal.timeout`, Zod 4, and
  Vitest fake timers.
- Follow strict TDD (Red, Green, Refactor) with confirmation between phases.
- Unit tests run in CI; integration tests against the real ERP run only locally
  with the key in `.env`.
- Gates before handoff: `pnpm format:check`, `pnpm verify`,
  `pnpm test:coverage`, `pnpm build`, and `pnpm test:integration` locally.

## Context and references

- PRD: US-002 (ERP data synchronization), RN-09 (ERP wins), RN-13 (integer
  cents), RN-14 (keys only in the API), RN-15 (rate limits, retries, last synced
  data).
- Feature F02 in DocuData; branch `feat/f02-erp-client`.
- ADR-0001: repository structure.
- ERP API contract: `https://pta-erp-api.onrender.com/openapi.json` (Swagger UI
  at `/docs`), version 3.3.0.
- Existing code: `src/shared/config/env.ts`, `src/shared/http/problem.ts`,
  `vitest.config.ts`, `vitest.integration.config.ts`.
- Next F02 tasks: persistence of synced data, sync scheduling, long-outage
  handling.

## Pending decisions

Each item names the phase in which it must be resolved. Earlier phases may
proceed while it is open.

- [x] **Retry budget.** Resolved by the challenge manager on 2026-11-24:
      4 calls in total (1 initial call plus 3 retries).
- [x] **Required `ERP_API_KEY` and local runtimes.** Resolved by the challenge
      manager on 2026-11-24: keep it required and pass a non-secret placeholder
      in `docker-compose.yml` and `scripts/test-container.mjs`. Recorded in
      ADR-0003.
- [x] **Unit coverage of the client.** Resolved by the challenge manager on
      2026-11-24: add a unit `erp-client.test.ts` with an injected fake `fetch`
      that never calls the real ERP.
- [x] **Network failures and non-Problem error bodies.** Resolved by the
      challenge manager on 2026-11-24: retry them like a server error.
- [x] **Invalid ERP record.** Resolved by the challenge manager on 2026-11-24:
      a malformed page (invalid JSON, missing `dados` or `totalPaginas`) is an
      ERP error and is retried; an invalid individual record neither interrupts
      nor is silently discarded — the client validates item by item and returns
      `{ items, rejected }`, each rejection carrying `codigo`/`numero` when
      readable, the page, and the Zod issues. The synchronization (next task)
      stores valid records, keeps the last good version of rejected ones, counts
      rejections in the sync run, logs only code and error, and fails the run
      when more than 10% of an entity is rejected.
