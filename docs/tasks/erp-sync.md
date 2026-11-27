---
title: Synchronize with the ERP — persist, schedule, and report the last sync
date: 2026-11-26
owners: [FlavioNorberto]
tags: [F02, US-002, RN-09, RN-15, erp, sync]
related_specs: [openspec/changes/erp-client/specs/erp-data-retrieval/spec.md]
related_adrs: [ADR-0002, ADR-0003]
---

# Synchronize with the ERP — persist, schedule, and report the last sync

## Objective

The portal must hold the same customers, products, and receivables as the ERP,
at most one hour behind, and every screen must say how recent that data is
(US-002). The ERP client (`src/shared/erp/`, change `erp-client`) already reads
the data; nothing stores it yet.

This task stores the ERP data in the portal database without duplicates, runs the
synchronization on its own every hour, and exposes when the last successful
synchronization happened. Because the ERP has usage limits and short outages
(RN-15), the synchronization reads only what changed, never runs twice at the
same time, and, when it fails, keeps the last synced data and tries again on the
next round. The ERP is the system of record (RN-09).

The task is delivered in two pull requests:

- **PR 1 — persist:** conversion, storage, sync runs, rejected records, the
  single-customer lookup, and a manual command.
- **PR 2 — schedule and status:** the scheduler, its settings, and
  `GET /sync/status`. The route requires authentication, which does not exist
  yet; PR 2 waits for the "Back-end authentication" task.

## Scope

### Included

PR 1 — persist:

- A new module `src/modules/erp-sync/`, generated with `pnpm gen:module erp-sync`.
- Conversion of every ERP record to the database model (`erp-sync.mappers.ts`):
  English field names, English status values, and date-only fields as midnight in
  Recife (`-03:00`).
- Storage by upsert on the ERP key (customer `code`, product `code`, receivable
  `number`); records are never deleted. A receivable returned by the ERP
  overwrites a row with the same `number` loaded from a spreadsheet and sets
  `source = ERP` (RN-09).
- One `SyncRun` per entity and execution: `RUNNING` before starting, then
  `SUCCESS` or `FAILURE`, with `finishedAt`, `itemsRead`, `itemsRejected`, and
  `cursorAt`.
- Rejected ERP records: invalid records are not stored, so the last good version
  stays in the database; they are counted in `itemsRejected`, and only their key
  and validation error are logged. When at least 20 records are read for an
  entity and more than 10% of them are rejected (`itemsRejected / itemsRead`),
  the run fails and none of that entity's records from the run is stored. Below
  20 records read, rejections never fail the run.
- Receivables whose customer is not stored: before any receivable is stored, each
  missing customer is fetched from the ERP once per code and stored. When the ERP
  answers "not found", the receivable is rejected with `customer not found`; when
  it returns an invalid customer, the receivable is rejected with
  `customer invalid` and the customer is logged with only its code and
  validation errors. A lookup answer that is not a JSON object is retried as
  malformed, like a listing page. When the lookup fails for any other reason (server error
  after retries, network, timeout, or the ERP daily limit), the receivables run
  fails and no receivable from the run is stored.
- Incremental reads: `updatedSince` is the `cursorAt` of the entity's last
  successful run minus 5 minutes; without any successful run, everything is read.
  `cursorAt` is the run's `startedAt`, except for a receivables run that rejected
  a receivable with `customer not found` or `customer invalid`, which repeats the
  previous `cursorAt` so that receivable is read again.
- `syncAll` runs customers, products, and receivables in that order; when
  customers fail, receivables are not read and are recorded as `FAILURE`
  (`skipped: customers sync failed`).
- A single-customer lookup in the ERP client (`src/shared/erp/`), calling
  `GET /v1/clientes/{codigo}`, with the same authentication, timeout, and retry
  policy as the listings; "not found" (404) is not retried.
- An additive Prisma migration adding `itemsRejected` and `cursorAt` to
  `SyncRun`.
- `scripts/sync-erp.ts` and the `sync:erp` package script, which run `syncAll`
  once for manual checks.
- ADR 0004: English names with ERP mapping.

PR 2 — schedule and status:

- `erp-sync.scheduler.ts`: runs `syncAll` when the API starts and then every
  `SYNC_INTERVAL_MINUTES`; retries after `SYNC_RETRY_MINUTES` following a
  failure; honors the ERP daily limit without waiting inside a run; skips when a
  run is in progress and recovers runs stuck for 30 minutes or more.
- `SYNC_INTERVAL_MINUTES`, `SYNC_RETRY_MINUTES`, and `SYNC_ENABLED` in
  `src/shared/config/env.ts` and `.env.example`.
- `GET /sync/status`, with its Zod response schema and the regenerated
  `openapi.json`.
- ADR 0005: where the scheduling runs.

### Out of scope / Non-goals

- The "Refresh" button for a single customer (F03, US-003).
- Showing the synchronization time on web and mobile screens; each screen does it
  with this route.
- Importing the legacy spreadsheets (history load, RN-16), including the rule
  that the spreadsheet load skips receivables already owned by the ERP.
- Authentication itself; PR 2 depends on the "Back-end authentication" task.
- Writing to the ERP, sending orders, or idempotency keys (RN-07).
- Changing the ERP client beyond the single-customer lookup; the listings keep
  their behavior.
- Deleting or deactivating portal records that the ERP no longer lists.

## Rules and contract

| Item       | Definition                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| ---------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Fields     | **Customer:** `codigo`→`code`, `razaoSocial`→`legalName`, `cnpj`→`cnpj`, `cidade`→`city`, `uf`→`state`, `segmento`→`segment`, `limiteCreditoCentavos`→`creditLimitCents`, `vendedor`→`sellerCode`, `dataCadastro`→`registeredAt`, `status`→`status`, `atualizadoEm`→`erpUpdatedAt`. **Product:** `codigo`→`code`, `descricao`→`description`, `categoria`→`category`, `unidade`→`unit`, `precoTabelaCentavos`→`listPriceCents`, `ativo`→`active`, `atualizadoEm`→`erpUpdatedAt`. **Receivable:** `numero`→`number`, `cliente`→`customerCode`, `pedidoErp`→`erpOrderNumber`, `parcela`→`installment`, `valorCentavos`→`amountCents`, `emissao`→`issuedAt`, `vencimento`→`dueAt`, `pagamento`→`paidAt` (null stays null), `status`→`status`, `atualizadoEm`→`erpUpdatedAt`, `source` = `ERP`. **Status:** `ATIVO`/`BLOQUEADO`/`INATIVO` → `ACTIVE`/`BLOCKED`/`INACTIVE`; `PAGO`/`EM_ABERTO`/`VENCIDO` → `PAID`/`OPEN`/`OVERDUE`. **Dates:** date-only values (`2026-10-05`) become `2026-10-05T00:00:00-03:00`; `atualizadoEm` keeps its own time and offset. Amounts stay integer cents. **SyncRun:** `type` = `ERP_SYNC`; `entity` = `customers`, `products`, or `receivables`; `itemsRead` = valid plus rejected records returned by the ERP; `itemsRejected` = rejected records, including `customer not found`; stored records = `itemsRead − itemsRejected`; `cursorAt` = starting point for the next incremental read. |
| Uniqueness | Customer and product by `code`, receivable by `number`, all exact matches (already `@unique` in `prisma/schema.prisma`). A repeated record updates the existing row, whatever its `source`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| Listing    | PR 1: not applicable. PR 2: `GET /sync/status` returns `{ customers, products, receivables }`, each with `lastSuccessAt` (`finishedAt` of the last `SUCCESS`, or `null`), `lastAttemptAt` (`startedAt` of the last run, or `null`), and `lastResult` (`SUCCESS`, `FAILURE`, `RUNNING`, or `null`).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| Update     | Every mapped field is overwritten with the ERP value, and `source` becomes `ERP`; `syncedAt` is refreshed by the database. Records absent from a run, and records rejected in a run, are left untouched.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| Deletion   | Never. The synchronization does not delete portal records.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| Errors     | An ERP or database failure ends the entity's run as `FAILURE` with a short message that contains no API key, ERP URL, headers, response body, or personal data; previously stored data stays intact. More than 10% rejected records ends the run as `FAILURE` and stores none of that entity's records from the run. A customer lookup that fails for any reason other than "not found" or an invalid customer ends the receivables run as `FAILURE` before any receivable is stored. An ERP `RateLimitedError` ends the run as `FAILURE` with `rate limited`. Logs about rejected records carry only the record key and the validation error. A synchronization error never stops the API. PR 2: `GET /sync/status` returns 401 without a token and 200 for any authenticated role.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |

## Acceptance criteria

PR 1 — persist:

- [ ] Given no successful run for an entity, when it is synchronized, then every record is read without `updatedSince` and stored.
- [ ] Given a successful run with `cursorAt` T, when the entity is synchronized again, then the ERP is asked for records updated since T minus 5 minutes.
- [ ] Given ERP records with Portuguese names, status values, and date-only fields, when they are stored, then the database holds the English fields, English status values, and dates at midnight `-03:00`.
- [ ] Given a stored record, when the ERP returns it again with changes, then the existing row is updated and no row is added.
- [ ] Given the same ERP data, when the synchronization runs twice, then the number of rows in each table does not change.
- [ ] Given a successful synchronization, when the run ends, then its `SyncRun` is `SUCCESS` with `finishedAt`, `itemsRead`, `itemsRejected`, and `cursorAt` equal to its `startedAt`.
- [ ] Given an ERP failure while reading an entity, when the run ends, then its `SyncRun` is `FAILURE` with a short error, the stored data is unchanged, and the error contains no API key.
- [ ] Given the customers synchronization fails, when `syncAll` runs, then products still run, receivables are not read, and the receivables run is `FAILURE` with `skipped: customers sync failed`.
- [ ] Given a page with one invalid record among valid ones, when the entity is synchronized, then the valid records are stored, the stored version of the invalid record is unchanged, `itemsRejected` is 1, and the log carries only its key and error.
- [ ] Given 20 records read and exactly 10% rejected, when the run ends, then it is `SUCCESS`.
- [ ] Given 20 records read and more than 10% rejected, when the run ends, then it is `FAILURE` and no record of that entity from the run is stored.
- [ ] Given fewer than 20 records read with a rejected one, when the run ends, then it is `SUCCESS` and the valid records are stored.
- [ ] Given a receivable whose customer is not stored but exists in the ERP, when receivables are synchronized, then the customer is fetched once, stored, and the receivable is stored.
- [ ] Given several receivables of the same missing customer, when receivables are synchronized, then the ERP is asked for that customer only once.
- [ ] Given a receivable whose customer does not exist in the ERP, when receivables are synchronized, then that receivable is rejected with `customer not found`, the others are stored, and the run's `cursorAt` repeats the previous successful `cursorAt`.
- [ ] Given a receivable whose customer is returned by the ERP lookup with invalid data, when receivables are synchronized, then that receivable is rejected with `customer invalid`, the others are stored, and the run's `cursorAt` repeats the previous successful `cursorAt`.
- [ ] Given a customer lookup that keeps failing with a server error, when receivables are synchronized, then the receivables run is `FAILURE` and no receivable from the run is stored.
- [ ] Given a customer lookup that hits the ERP daily limit, when receivables are synchronized, then the receivables run is `FAILURE` with `rate limited` and no further lookup is made.
- [ ] Given a stored receivable loaded from a spreadsheet, when the ERP returns a receivable with the same `number`, then the row is overwritten with the ERP values and `source` becomes `ERP`.
- [ ] Given a customer code, when it is looked up in the ERP and exists, then the customer is returned; when the ERP answers 404, then "not found" is returned after a single call.
- [ ] Given the real ERP, when `pnpm sync:erp` runs twice, then the three tables are filled and the second run adds no rows.

PR 2 — schedule and status:

- [ ] Given `SYNC_ENABLED=true`, when the API starts, then `syncAll` runs, and runs again after `SYNC_INTERVAL_MINUTES`.
- [ ] Given `SYNC_ENABLED=false`, when the API starts, then no synchronization runs.
- [ ] Given a run that ended with `FAILURE`, when the next run is scheduled, then it happens after `SYNC_RETRY_MINUTES`; after a `SUCCESS`, it returns to `SYNC_INTERVAL_MINUTES`.
- [ ] Given the ERP daily limit with `retryAfterSeconds` of 3600, when the run fails, then it ends as `FAILURE` immediately, no run stays `RUNNING`, and the next attempt happens after the larger of 3600 seconds and `SYNC_RETRY_MINUTES`.
- [ ] Given a `RUNNING` run started less than 30 minutes ago, when a synchronization is due, then it is skipped and `sync skipped: run in progress` is logged.
- [ ] Given a `RUNNING` run started 30 minutes ago or more, when a synchronization is due, then that run becomes `FAILURE` (`stale run`, with `finishedAt`) and the synchronization runs.
- [ ] Given `syncAll` throws, when the scheduler continues, then the API keeps running and the next run still happens.
- [ ] Given no token, when `GET /sync/status` is called, then the response is 401.
- [ ] Given an authenticated user and no runs, when `GET /sync/status` is called, then the response is 200 with every field `null` for the three entities.
- [ ] Given a `SUCCESS` followed by a `FAILURE` for an entity, when `GET /sync/status` is called, then `lastSuccessAt` is the `SUCCESS` `finishedAt` and `lastResult` is `FAILURE`.
- [ ] Given any state, when `GET /sync/status` is called, then the response never contains the value of `ERP_API_KEY`.

## Technical constraints

- The module follows `app → modules → shared`; it may import `src/shared/erp` and
  `src/shared/database`, and no other module.
- Only `src/shared/erp/` calls the ERP; the module uses the ERP client it
  receives and never calls `fetch` itself.
- `ErpSyncService` receives the ERP client and an `ErpSyncRepository` interface
  through its constructor; it never instantiates Prisma or the ERP client.
- The scheduler receives the service and the clock as parameters (PR 2).
- ERP data is validated by the ERP client; the route response is validated with
  Zod, and the same schema generates `openapi.json` (PR 2).
- Unit tests use an in-memory repository and a fake ERP client; the repository is
  covered by `erp-sync.repository.integration.test.ts` against local Postgres. The
  ERP client's existing tests must stay green without changes.
- No new dependency; scheduling uses the platform timer unless ADR 0005 decides
  otherwise.
- `prisma/migrations/20261125181425_base_data_model` is applied and must not be
  edited; the new `SyncRun` columns come in a new additive migration.
- Never log or return the ERP key, the ERP URL, headers, response bodies, or
  personal data (RN-14).
- `SYNC_INTERVAL_MINUTES`: integer, default 60, minimum 5.
  `SYNC_RETRY_MINUTES`: integer, default 10, minimum 1. `SYNC_ENABLED`: boolean,
  default `true`, `false` in tests (PR 2).

## Context and references

- User story US-002 and business rules RN-09, RN-14, and RN-15.
- ERP client: `src/shared/erp/erp-client.ts`, change
  `openspec/changes/erp-client/`, and `docs/changes/erp-client.md`.
- ERP contract: `https://pta-erp-api.onrender.com/openapi.json` (version 3.3.0),
  including `GET /v1/clientes/{codigo}` (200, 401, 404, 429, 503).
- Data model: `prisma/schema.prisma` (`Customer`, `Product`, `Receivable`,
  `SyncRun`) and change `openspec/changes/base-data-model/`.
- ADR-0002: ERP receivable number as the unique key and ERP status mappings; ADR-0003: required ERP credentials.
- Depends on the tasks "Model the database in Prisma" (done), "ERP HTTP client"
  (done, PR #4), and "Back-end authentication" (pending; blocks PR 2 only).

## Pending decisions

Resolved by the manager on 2026-11-26:

- [x] **Rejected ERP records.** The rule from the `erp-client` task applies here:
      keep the last good version, count rejected records in `SyncRun`
      (`itemsRejected`, additive migration), log only key and error, and fail
      above 10% per entity.
- [x] **Receivable whose customer is not stored.** The run does not fail. The
      customer is fetched once per code with `GET /v1/clientes/{codigo}` and
      stored; when the ERP does not return it, the receivable is rejected with
      `customer not found`, and the run keeps the previous `cursorAt` so the
      receivable is read again.
- [x] **What `itemsRead` counts.** Everything returned by the ERP (valid plus
      rejected); `itemsRejected` is separate; the 10% rule uses
      `itemsRejected / itemsRead`.
- [x] **Receivables loaded from spreadsheets.** The ERP overwrites a row with the
      same `number` and sets `source = ERP` (RN-09). The reverse rule belongs to
      the history load task.

Resolved on 2026-11-26:

- [x] **Valid records when more than 10% are rejected.** Nothing from the run is
      stored for that entity, and the run ends as `FAILURE`.
- [x] **Customer lookup fails for another reason** (server error after retries,
      network, timeout, or the ERP daily limit). The receivables run ends as
      `FAILURE`. Lookups happen before any receivable is stored, so no receivable
      from the run is stored; customers already returned by the ERP may stay
      stored. "Not found" and an ERP outage stay distinct, and an outage does not
      count toward the 10% rule.
- [x] **Customer returned by the lookup is invalid.** The receivable is rejected
      with `customer invalid`, a reason distinct from `customer not found`.
- [x] **Customer that never appears.** Accepted: `cursorAt` stays in place while
      the customer is missing. The cost is bounded, because `GET /v1/titulos`
      only lists receivables issued since 2026-10-01, so the widest window is a
      full read; the receivable is never lost; and each run logs its key with
      `customer not found` and counts it in `itemsRejected`. To revisit if the
      ERP daily limit proves too tight.

- [x] **`cursorAt` after `customer invalid`.** The run keeps the previous
      `cursorAt`, as with `customer not found`, because the receivable does not
      change in the ERP when its customer is fixed and would not be read again.

Resolved by the manager in the PR 1 review on 2026-11-27:

- [x] **Minimum sample for the 10% rule.** The rule applies only when at least
      20 records are read for the entity in the run. Incremental reads usually
      bring a few records, and without a minimum one invalid record among three
      would fail the run on every round — a failed run keeps the starting point —
      blocking every valid change of that entity beyond the 1-hour target.
- [x] **Malformed customer lookup.** An answer that is not a JSON object is
      retried as malformed, with the same policy as listing pages, instead of
      becoming `customer invalid`.
- [x] **Log of an invalid customer.** A customer returned invalid by the lookup
      is logged with only its code and validation errors.

Open — PR 1: none.

Open — PR 2:

- [ ] **Scope of the run lock.** Alternatives: (a) one lock for the whole
      `syncAll`; (b) one lock per entity. Owner: manager or tech lead.
- [ ] **`SYNC_ENABLED` in local runtimes.** With the default `true`,
      `docker compose up` and `pnpm test:container` start a synchronization with
      the placeholder key `not-configured` (ADR-0003) and record failures.
      Alternatives: (a) set `SYNC_ENABLED=false` in both; (b) keep the default
      and accept the failed runs. Owner: manager.
- [ ] **Where the scheduling runs (ADR 0005).** Alternatives: (a) inside the API
      with a timer, guarded by the `SyncRun` lock; (b) an external cron of the
      hosting platform calling `pnpm sync:erp`, with no scheduler in the API.
      Depends on where the staging environment is hosted. Owner: manager.
