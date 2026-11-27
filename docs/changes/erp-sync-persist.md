---
change_id: erp-sync-persist
date: 2026-11-27
status: in-progress
owners: [FlavioNorberto]
tags: [F02, US-002, RN-09, RN-15, erp, sync, persistence]
related_adrs: [ADR-0002, ADR-0003, ADR-0004]
openspec_change: openspec/changes/erp-sync-persist/
---

# Persist ERP data with incremental sync runs

## Objective

Store the ERP's customers, products, and receivables in the portal database,
safely and repeatably, so features read ERP data from the portal instead of
calling the ERP (US-002, RN-09, RN-15). This is the first of two pull requests of
the F02 synchronization task; scheduling and `GET /sync/status` come in the
second.

## Change made

- New module `src/modules/erp-sync/`, the first module of the project:
  - `erp-sync.mappers.ts`: `toCustomer`, `toProduct`, `toReceivable` — English
    fields and statuses, date-only values at midnight `-03:00`, `source = ERP`
    (ADR 0004).
  - `erp-sync.repository.ts`: `ErpSyncRepository` and `PrismaErpSyncRepository` —
    upserts by ERP key in one transaction per entity, run lifecycle, last
    successful run, missing customer codes.
  - `erp-sync.service.ts`: `ErpSyncService` with `syncCustomers`,
    `syncProducts`, `syncReceivables`, and `syncAll`; receives the ERP client,
    the repository, a clock, and a logger.
- `src/shared/erp/erp-client.ts`: `getCustomer(code)` for
  `GET /v1/clientes/{codigo}`, returning `found`, `not-found`, or `invalid`. The
  HTTP call was extracted from the paginated `fetchPage` into `request`, shared by
  the listings and the lookup; listing behavior and its tests are unchanged.
- Migration `20261127023316_sync_run_rejected_and_cursor`: adds
  `SyncRun.itemsRejected` (integer, default 0) and `SyncRun.cursorAt` (nullable).
  The applied migration `20261125181425_base_data_model` is unchanged.
- `scripts/sync-erp.ts` and the `sync:erp` package script.
- `src/shared/database/base-data-model.integration.test.ts` now expects the two
  new `SyncRun` columns.

## Resulting behavior

- ERP records are stored under their ERP key (customer and product `code`,
  receivable `number`); a record returned again is updated in place, and records
  are never deleted.
- An ERP receivable overwrites a spreadsheet receivable with the same number and
  sets `source = ERP` (RN-09).
- Each entity run is recorded as `RUNNING`, then `SUCCESS` or `FAILURE` with
  `finishedAt`, `itemsRead` (valid plus rejected), `itemsRejected`, and
  `cursorAt`.
- Incremental reads ask the ERP for records updated since the last successful
  `cursorAt` minus 5 minutes; with no successful run, or a `null` cursor,
  everything is read. A failed run does not move the starting point.
- Invalid ERP records are not stored (the last good version stays), are counted,
  and are logged with only their key and validation issues. More than 10%
  rejected ends the run as `FAILURE` and stores nothing for that entity; exactly
  10% succeeds.
- A receivable whose customer is not stored triggers one ERP lookup per customer
  code before any receivable is stored. Found customers are stored; "not found"
  and invalid customers reject the receivable as `customer not found` or
  `customer invalid`, and the run keeps the previous `cursorAt` so it is read
  again. Any other lookup failure ends the receivables run as `FAILURE` without
  storing receivables; lookups stop at the ERP daily limit.
- `syncAll` runs customers, products, receivables; a customers failure skips
  receivables (`skipped: customers sync failed`), a products failure does not.
- Run errors come from a fixed vocabulary (`rate limited`,
  `erp error: http <status>`, `erp error: <kind>`,
  `too many rejected records: <n>/<read>`, `skipped: customers sync failed`,
  `internal error`) and never contain the ERP key or record data.
- An internal (non-ERP) failure is logged with only `entity`, `errorType`, and
  `errorCode` — never the message or stack, which can carry record values.
- `pnpm sync:erp` runs one full synchronization, prints one line per entity, and
  exits with code 1 when any entity fails.

## Impact

- **API / OpenAPI:** none. No route was added or changed; `pnpm openapi:check`
  passes with the existing `openapi.json`.
- **Database:** one additive migration on `SyncRun`, safe on existing rows.
  Deploy with `pnpm db:migrate:deploy` before the new code. Rollback is reverting
  the change; the columns can stay.
- **ERP usage:** a full first read costs about 15 calls (3 customer pages, 2
  product pages, 10 receivable pages); an incremental run costs about 3, plus one
  call per missing customer (RN-15).
- **Shared code:** `src/shared/erp/erp-client.ts` gains `getCustomer`; the
  `ErpClient` interface grows by one method.
- **Security:** no key, URL, header, response body, or personal data in run
  errors or logs (RN-14).
- **Other services and clients:** none yet. Nothing runs the synchronization
  automatically until the second pull request adds the scheduler.

## Validations executed

Run on 2026-11-26 and 2026-11-27 on the developer's machine (Windows, Node 24,
Docker Desktop 29.9.2). TDD evidence (Red, Green, Refactor) is in the pull
request.

| Command                                                                  | Result                                                                                                                                                                                                                                                     |
| ------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm format:check`                                                      | `All matched files use Prettier code style!`                                                                                                                                                                                                               |
| `pnpm verify`                                                            | passed: typecheck and lint with no errors; `Test Files 12 passed (12)`, `Tests 121 passed (121)`; architecture `Tests 3 passed (3)`; `openspec validate --all --strict`: `Totals: 5 passed, 0 failed (5 items)`; `openapi:check` and `skills:check` passed |
| `pnpm test:coverage`                                                     | `Tests 121 passed (121)`; `src/shared` `All files 98.05 % stmts, 96.05 % branches, 97.36 % funcs, 97.97 % lines`; `erp-client.ts` 100 % lines                                                                                                              |
| `vitest --coverage` on `src/modules` (informative, no threshold)         | `erp-sync.service.ts` 100 % lines; `erp-sync.repository.ts` is covered by the integration suite, not counted here                                                                                                                                          |
| `pnpm build`                                                             | passed (`tsc --noEmit`, `tsc -p tsconfig.build.json`)                                                                                                                                                                                                      |
| `pnpm test:integration` (Testcontainers Postgres, real ERP with the key) | both migrations applied; `Test Files 3 passed (3)`, `Tests 39 passed (39)`, 47.35 s                                                                                                                                                                        |
| `pnpm test:container`                                                    | `2 migrations found`, both applied, `Production container smoke test passed.`                                                                                                                                                                              |
| `openspec validate erp-sync-persist --strict`                            | `Change 'erp-sync-persist' is valid`                                                                                                                                                                                                                       |
| `pnpm sync:erp`, twice, against the real ERP on a disposable Postgres    | run 1: `customers: SUCCESS (read 120, rejected 0)`, `products: SUCCESS (read 60, rejected 0)`, `receivables: SUCCESS (read 485, rejected 0)` → 120 / 60 / 485 rows; run 2: read 0 / 0 / 22, rows still 120 / 60 / 485                                      |

**ADR evaluation:** ADR 0004 created. The change sets a durable data contract —
the portal stores ERP data under English names, converts it in one boundary file,
and stores date-only values as Recife midnight — which every later feature reads
(trigger: "changes a durable system boundary or data contract"). It builds on ADR
0002 (receivable key and status mappings) and ADR 0003 (required ERP
credentials). Other design choices (one transaction per entity, error vocabulary,
order of entities) are local and reversible and stay in the design.

## Related artifacts

- Task: `docs/tasks/erp-sync.md`
- Proposal: `openspec/changes/erp-sync-persist/proposal.md`
- Specification: `openspec/changes/erp-sync-persist/specs/erp-data-synchronization/spec.md`
- Design: `openspec/changes/erp-sync-persist/design.md`
- Tasks: `openspec/changes/erp-sync-persist/tasks.md`
- ADRs: [ADR 0004](../adr/0004-english-names-with-erp-mapping.md) (new),
  [ADR 0002](../adr/0002-base-data-model.md), [ADR 0003](../adr/0003-required-erp-credentials.md)

## Usage

```sh
pnpm db:migrate:deploy   # apply the new SyncRun columns
pnpm sync:erp            # one full synchronization with ERP_BASE_URL, ERP_API_KEY, DATABASE_URL
```

```text
customers: SUCCESS (read 120, rejected 0)
products: SUCCESS (read 60, rejected 0)
receivables: SUCCESS (read 485, rejected 0)
```

In code, build `ErpSyncService` with `createErpClient(...)`,
`new PrismaErpSyncRepository(database)`, `clock: () => new Date()`, and the pino
logger, then call `syncAll()`.

## Implementation notes

- **Archive order:** `base-data-model` also adds requirements to the
  `erp-data-synchronization` capability (no name collision with this change).
  Archive `base-data-model` before `erp-sync-persist`.
- **`pnpm gen:module` and the first module:** the generator creates
  `src/modules/<name>` without `recursive`, so it fails while `src/modules/` does
  not exist. The folder was created by hand; the generator was not changed.
- **Flaky real-ERP test:** `listReceivables returns every record reported by the
ERP` in `erp-client.integration.test.ts` failed once with `actual value must be
number or bigint, received "undefined"` and passed on rerun. Its `reportedTotal`
  helper calls the ERP without retries or a status check, so a per-minute limit or
  503 breaks it. Not changed by this change.
- **Docker:** `pnpm test:container` hung once while the image downloaded npm
  packages (about 28 s per request) and the Docker engine stopped answering; it
  passed after restarting the machine.
- **ERP volume grows:** receivables went from 456 (2026-11-24) to 485
  (2026-11-27). `atualizadoDesde` sent as a UTC ISO date-time is accepted.
- **Missing customer that never appears:** its receivable keeps `cursorAt` in
  place on every run; the widest window is a full receivables read, because
  `GET /v1/titulos` lists only receivables issued since 2026-10-01.
- Coverage thresholds stay limited to `src/shared/**`; extending them to
  `src/modules/**` is a team decision left for later.
