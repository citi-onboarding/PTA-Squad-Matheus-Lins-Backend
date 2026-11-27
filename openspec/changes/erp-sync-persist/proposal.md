## Why

F02 (US-002) requires the portal to hold the same customers, products, and
receivables as the ERP, the system of record (RN-09), at most one hour behind.
The ERP client from the `erp-client` change already reads that data, but nothing
stores it, so no feature can use it yet. This change stores it safely and
repeatably; the scheduler and `GET /sync/status` follow in a second change once
authentication exists.

## What Changes

- Add the `erp-sync` module (`src/modules/erp-sync/`), the first module of the
  project, generated with `pnpm gen:module erp-sync`.
- Convert every ERP record to the portal data model: English field names,
  English status values, and date-only values as midnight in Recife (`-03:00`).
- Store customers, products, and receivables by upsert on the ERP key, never
  deleting records. An ERP receivable overwrites a spreadsheet-loaded receivable
  with the same number and marks it as coming from the ERP (RN-09).
- Record every entity synchronization as a sync run (`RUNNING`, then `SUCCESS`
  or `FAILURE`) with the number of records read and rejected and the starting
  point for the next incremental read.
- Read only what changed: from the last successful run's starting point minus a
  5-minute margin; read everything when there is no successful run.
- Handle rejected ERP records: keep the last good version, count them, log only
  their key and error, and fail the entity's run, storing nothing from it, when
  more than 10% of the records read are rejected.
- Fetch a receivable's missing customer from the ERP once per code; reject the
  receivable as `customer not found` or `customer invalid` otherwise, and keep the
  previous starting point so it is read again. Any other lookup failure fails
  the receivables run before any receivable is stored.
- Synchronize customers, products, and receivables in that order; a customers
  failure skips receivables.
- Add a single-customer lookup to the ERP client in `src/shared/erp/`
  (`GET /v1/clientes/{codigo}`), with the same authentication, timeout, and retry
  policy as the listings; "not found" is not retried. The listings do not change.
- Add an additive migration with the new sync-run fields (`itemsRejected`,
  `cursorAt`).
- Add `scripts/sync-erp.ts` and the `sync:erp` package script, which run one full
  synchronization for manual checks.

### Non-goals

- The scheduler, `SYNC_INTERVAL_MINUTES`, `SYNC_RETRY_MINUTES`, `SYNC_ENABLED`,
  the in-progress and stale-run lock, and `GET /sync/status` (second change,
  after the "Back-end authentication" task).
- The "Refresh" button for a single customer (F03, US-003).
- Showing the synchronization time on web and mobile screens.
- Importing legacy spreadsheets (RN-16), including skipping receivables already
  owned by the ERP.
- Writing to the ERP, sending orders, or idempotency keys (RN-07).
- Deleting or deactivating records that the ERP no longer lists.
- Changing the ERP listings in `src/shared/erp/`.

## Capabilities

### New Capabilities

- `erp-data-synchronization`: keeping the portal's copy of ERP customers,
  products, and receivables up to date — conversion to the portal model,
  duplicate-free storage, incremental reads, sync-run records, rejected records,
  missing-customer lookup, and the manual synchronization command.

### Modified Capabilities

None. The single-customer ERP lookup is specified under
`erp-data-synchronization`, because `erp-data-retrieval` still belongs to the
active `erp-client` change.

## Impact

- **Business:** the portal gets the ERP data that credit (RN-01, RN-03), active
  customers (RN-02), active products (RN-04), and table prices (RN-05) depend on.
  No user-visible behavior changes yet.
- **API:** none. No HTTP endpoint is added or changed; `openapi.json` is
  unchanged.
- **Database / migrations:** one additive migration adding `itemsRejected`
  (integer, default 0) and `cursorAt` (nullable date-time) to `SyncRun`. The
  applied migration `20261125181425_base_data_model` is not edited. Rollback is
  reverting the change; the new columns are unused by earlier code.
- **Security:** the ERP key stays in validated environment variables and is never
  logged, stored, or included in sync-run errors (RN-14). Logs about rejected
  records carry only the record key and the validation error, never personal
  data.
- **Observability:** each run's outcome, counts, and short error are stored in
  `SyncRun`; rejected records are logged by key.
- **ERP usage:** incremental reads keep calls low; a missing customer costs one
  extra call per code and run (RN-15).
- **Dependencies:** none added.
- **Documentation:** task `docs/tasks/erp-sync.md`, ADR 0003 (English names with
  ERP mapping), and the change summary `docs/changes/erp-sync-persist.md`.
- **Code:** new `src/modules/erp-sync/`; `src/shared/erp/erp-client.ts` gains the
  customer lookup; `prisma/schema.prisma` and a new migration; `scripts/` and
  `package.json`.
