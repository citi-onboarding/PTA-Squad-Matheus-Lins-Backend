## Context

See `proposal.md` (Why) for motivation and
`specs/erp-data-synchronization/spec.md` for the required behavior. Current state:

- `src/shared/erp/erp-client.ts` exposes `listCustomers`, `listProducts`, and
  `listReceivables`, each returning `{ items, rejected }` after reading every
  page with retries (`withRetry`, at most 4 calls, `RateLimitedError` above
  300 s). The HTTP call, headers, timeout, and error mapping live inside the
  paginated `fetchPage`.
- `prisma/schema.prisma` already has `Customer` (`code` unique), `Product`
  (`code` unique), `Receivable` (`number` unique, `customerCode` references
  `Customer.code`, `source` `ERP | SPREADSHEET`), and `SyncRun` (`type`,
  `entity`, `startedAt`, `finishedAt`, `result`, `itemsRead`, `error`). Migration
  `20261125181425_base_data_model` is applied.
- `createDatabase(databaseUrl)` in `src/shared/database/` builds the Prisma
  client with the `pg` adapter; database integration tests start their own
  Postgres with Testcontainers and apply migrations.
- `src/shared/logging/logger.ts` provides a pino logger with redaction of auth
  headers and tokens.
- There is no module yet: `src/modules/` does not exist. `pnpm gen:module`
  scaffolds `<name>.schemas.ts`, `<name>.service.ts`, and `<name>.test.ts`.
- `vitest.config.ts` applies coverage thresholds to `src/shared/**` only.
- `GET /v1/titulos` lists only receivables issued since 2026-10-01 (456 today).

## Goals / Non-Goals

**Goals:**

- A service that orchestrates one synchronization per entity and never calls
  Prisma or `fetch` directly, so every rule in the spec is unit-testable with an
  in-memory repository, a fake ERP client, and a fixed clock.
- A single place that knows both the ERP and the portal vocabularies (the
  mappers).
- Writes that either fully apply or leave the entity untouched.

**Non-Goals:**

- Scheduling, the run lock, stale-run recovery, and `GET /sync/status` (second
  change).
- Parallel requests to the ERP or parallel entity runs.
- A generic synchronization framework for other sources (spreadsheets).

## Decisions

### D1. Module layout and dependency injection

`src/modules/erp-sync/`:

- `erp-sync.mappers.ts`: pure functions `toCustomer`, `toProduct`,
  `toReceivable` from the ERP types to the repository's input types.
- `erp-sync.repository.ts`: the `ErpSyncRepository` interface and
  `PrismaErpSyncRepository`, which receives a `Database`.
- `erp-sync.service.ts`: `ErpSyncService`, constructed with
  `{ erp: ErpClient, repository: ErpSyncRepository, clock: () => Date, logger }`,
  exposing `syncCustomers`, `syncProducts`, `syncReceivables`, and `syncAll`.
  `logger` is a `SyncLogger` with only `warn` (rejected records) and `error`
  (internal failures); pino's logger satisfies it.
- `scripts/sync-erp.ts`: the composition root for the manual command; it builds
  the ERP client from `env`, the database, the repository, the logger, and the
  service, runs `syncAll`, prints one line per entity, disconnects, and exits
  with code 1 when any entity ends as `FAILURE`.

The scaffolded `erp-sync.schemas.ts` is removed: this change has no HTTP input
or output; the second change adds the status route schema.

- Rejected: the service using `Database` directly — couples every rule to
  Postgres and forbids fast unit tests (AGENTS.md, dependency injection).
- Rejected: `Date.now()` inside the service — start times and the 5-minute
  margin would be untestable without global fake timers.

### D2. Repository interface

```ts
interface ErpSyncRepository {
  startRun(entity: SyncEntity, startedAt: Date): Promise<RunId>;
  finishRun(id: RunId, outcome: RunOutcome): Promise<void>;
  findLastSuccessfulRun(
    entity: SyncEntity,
  ): Promise<{ cursorAt: Date | null } | null>;
  findMissingCustomerCodes(codes: string[]): Promise<string[]>;
  saveCustomers(customers: CustomerRecord[]): Promise<void>;
  saveProducts(products: ProductRecord[]): Promise<void>;
  saveReceivables(receivables: ReceivableRecord[]): Promise<void>;
}
```

`RunOutcome` carries `result`, `finishedAt`, `itemsRead`, `itemsRejected`,
`cursorAt`, and `error`. `findRunningRun` and `findLastAttemptByEntity`, named
in the task, are added by the second change, which is the first to use them.

### D3. Writes: upsert by ERP key inside one transaction per entity

Each `save*` runs every upsert of the entity in a single
`database.$transaction`, keyed by `code` or `number`. The update branch writes
every mapped field and, for receivables, `source: ERP`; `syncedAt` is updated by
Prisma's `@updatedAt`. A database error rolls the whole entity back, so a failed
run leaves the stored data unchanged, and the 10% rule can skip the write
entirely by not calling `save*`.

- Rejected: upserting record by record without a transaction — a failure halfway
  would leave a mix of old and new rows while the run reports `FAILURE`.
- Rejected: `createMany` with `skipDuplicates` — it never updates changed
  records.

### D4. Run lifecycle and error messages

Each entity run: `startRun` → read from the ERP → validate the 10% rule →
(receivables) resolve missing customers → `save*` → `finishRun(SUCCESS)`. Any
thrown error is caught by the service and ends the run with
`finishRun(FAILURE)`; the service never rethrows, so `syncAll` always runs the
remaining entities.

`error` is chosen from a fixed vocabulary, never from a raw error message:

| Cause                                       | `error`                                 |
| ------------------------------------------- | --------------------------------------- |
| `RateLimitedError`                          | `rate limited`                          |
| `ErpRequestError` with an HTTP status       | `erp error: http <status>`              |
| `ErpRequestError` network/timeout/malformed | `erp error: <kind>`                     |
| 20+ read and more than 10% rejected         | `too many rejected records: <n>/<read>` |
| Customers run failed (receivables)          | `skipped: customers sync failed`        |
| Anything else (database, bug)               | `internal error`                        |

Raw Prisma messages can include record values (for example, a constraint
violation), so they are never stored, returned, or logged. An internal failure
(the `internal error` row) is logged at `error` with
`{ entity, errorType, errorCode }` only — no message and no stack, because a
Node stack starts with the message. ERP failures are not logged this way: the
run's `error` already records them.

### D5. Incremental reads and `cursorAt`

`updatedSince = lastSuccessfulRun.cursorAt − 5 minutes`, sent as an ISO
date-time with offset. No successful run, or a successful run with
`cursorAt = null`, reads everything. On success, `cursorAt = startedAt`, except
for a receivables run with any `customer not found` or `customer invalid`
rejection, which writes the previous successful run's `cursorAt` (possibly
`null`). Failed runs store `cursorAt = null` and are ignored when computing the
next read.

- Rejected: using `startedAt` directly, as the task first described — a
  receivable rejected for its customer does not change in the ERP and would never
  be read again.

### D6. Rejected records and the 10% rule

`itemsRead = items.length + rejected.length` from the ERP listing (not the ERP's
`total`, which can differ when records change between pages). For receivables,
missing-customer rejections are added to `rejected` before the rule is checked.
When `itemsRead >= 20` and `itemsRejected / itemsRead > 0.10` the run fails
without calling `save*`. Below 20 records read the rule does not apply: rejected
records are counted and logged, and the valid ones are stored. Incremental reads
usually return a handful of records (22 receivables and 0 products in the second
manual run), so without the minimum one invalid record among three would fail
the run again on every round — a failed run keeps the starting point — and block
every valid change of that entity beyond the 1-hour target (US-002). Each
rejected record is logged at
`warn` with `{ entity, key, page, issues }` — the ERP client already keeps only
the key and Zod `path`/`message`, and Zod 4 messages do not include the input
value.

### D7. Missing customers of receivables

After listing receivables, the service collects the distinct `customerCode`s,
asks the repository which are not stored, and looks each one up sequentially
with `erp.getCustomer(code)`:

- `found` → the customer is mapped and saved immediately;
- `not-found` → every receivable of that code is rejected as
  `customer not found`;
- `invalid` → every receivable of that code is rejected as `customer invalid`,
  the customer is not stored, and it is logged at `warn` with only
  `{ entity: "customers", key, issues }`;
- a thrown error (5xx after retries, network, timeout, `RateLimitedError`) stops
  the loop and fails the run before any receivable is saved.

Customers saved before a failure stay stored: they are valid ERP data. Lookups
run before `saveReceivables`, so the foreign key on `customerCode` can never fail
for a receivable that reaches the write.

### D8. `getCustomer` in the ERP client

`getCustomer(code)` returns a discriminated union
`{ status: "found", customer } | { status: "not-found" } | { status: "invalid", issues }`.
The HTTP part of `fetchPage` — headers, timeout, network/timeout mapping, and
`toHttpError` — is extracted into an internal `request(url)` used by both the
listings and the lookup, without changing listing behavior. The lookup runs
inside `withRetry`; a 404 is caught after `withRetry` gives up immediately (4xx
is never retried) and becomes `not-found`. The code is encoded with
`encodeURIComponent` as one path segment. A 200 body that is not a JSON object
(not JSON, `null`, an array, or a scalar) throws
`ErpRequestError({ kind: "malformed" })` inside `withRetry`, so it is retried
like a malformed listing page and, if it stays malformed, the receivables run
fails as `erp error: malformed`. A JSON object that fails `erpCustomerSchema`
becomes `invalid` and is not retried, because the body is the record itself.

- Rejected: the module calling `GET /v1/clientes/{codigo}` itself — only
  `src/shared/erp` talks to the ERP.
- Rejected: specifying the lookup under `erp-data-retrieval` — that capability
  still belongs to the active `erp-client` change.

### D9. Migration

`pnpm db:migrate --name sync-run-rejected-and-cursor` adds
`itemsRejected Int @default(0)` and `cursorAt DateTime?` to `SyncRun`. Both are
additive and safe on existing rows.

### D10. Mappers and dates

Date-only ERP values become `new Date(`${value}T00:00:00-03:00`)`; Recife has
no daylight saving time, so the fixed offset is exact. `atualizadoEm` is parsed
with its own offset. Status values use exhaustive `Record` maps typed from the
Zod enums, so a new ERP status fails typecheck rather than mapping silently. The
English names and the single mapping file are recorded in ADR 0004, which builds on the status mappings of ADR 0002.

### D11. Tests

- `erp-sync.test.ts`: unit tests of mappers and service with an in-memory
  `ErpSyncRepository`, a fake `ErpClient`, a fixed clock, and a captured logger.
- `erp-sync.repository.integration.test.ts`: `PrismaErpSyncRepository` against
  Testcontainers Postgres — upsert twice without duplicates, update in place,
  spreadsheet row overwritten with `source = ERP`, transaction rollback, run
  lifecycle with the new columns.
- `src/shared/erp/erp-client.test.ts` gains the lookup cases; the existing cases
  stay unchanged. `erp-client.integration.test.ts` gains a real lookup of an
  existing and an unknown code.
- Coverage thresholds stay limited to `src/shared/**`, as today. Extending them to
  `src/modules/**` would change the gate for every future module and is left to a
  team decision; this module is still developed test-first.

## Risks / Trade-offs

- [A customer that never appears keeps `cursorAt` in place] → accepted; the
  widest window is a full read of receivables (about 10 pages today), and the
  key is logged with `customer not found` on every run.
- [One transaction per entity holds a few hundred upserts] → acceptable at the
  ERP's volume (120 customers, 60 products, 456 receivables); revisit if volumes
  grow by orders of magnitude.
- [`atualizadoDesde` format] → the ERP accepts ISO date-times with offset; the
  manual `pnpm sync:erp` run against the real ERP confirms it.
- [Clock skew between portal and ERP] → the 5-minute margin; repeated records
  are harmless because writes are upserts.
- [Missing customers cost one ERP call each per run] → one lookup per distinct
  code, sequential, and the loop stops at the first rate-limit error.
- [`pnpm test:coverage` does not enforce thresholds on `src/modules/**`] → every
  scenario of the spec has a test, and the module's coverage is reported in the
  change summary.

## Migration Plan

Apply the additive migration with `pnpm db:migrate:deploy` before running the
new code. No HTTP contract changes. Rollback is reverting the change; the two new
columns can stay, since earlier code ignores them.
