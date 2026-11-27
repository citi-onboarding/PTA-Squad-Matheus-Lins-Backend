## 1. SDD

- [x] 1.1 Fill in the task template (F02, US-002) in `docs/tasks/erp-sync.md` and resolve the PR 1 pending decisions
- [x] 1.2 Write `proposal.md`, `design.md`, and `specs/erp-data-synchronization/spec.md`
- [x] 1.3 Run `openspec validate erp-sync-persist --strict`
- [x] 1.4 Run `pnpm gen:module erp-sync` and remove the scaffolded `erp-sync.schemas.ts`

## 2. Red

- [x] 2.1 Developer writes `src/shared/erp/erp-client.test.ts` cases for `getCustomer` with a fake `fetch`: found, 404 as not found after one call, invalid customer, encoded code, `X-Api-Key` sent, 503 retried, 401 not retried, key never in the error; existing cases stay unchanged
- [x] 2.2 Developer adds a real lookup of an existing and an unknown code to `src/shared/erp/erp-client.integration.test.ts`, gated by the ERP key
- [x] 2.3 Developer writes mapper cases in `src/modules/erp-sync/erp-sync.test.ts`: customer, product, and receivable fields, every status value, date-only values at `-03:00`, null payment date, `source` `ERP`
- [x] 2.4 Developer writes service cases in `src/modules/erp-sync/erp-sync.test.ts` with an in-memory repository, a fake ERP client, a fixed clock, and a captured logger: first run reads everything, next run uses `cursorAt` minus 5 minutes, failed run keeps the starting point, `SUCCESS` and `FAILURE` run records, error vocabulary without the key, one invalid record, exactly 10%, more than 10% stores nothing, rate limited, missing customer found / looked up once / not found / invalid / lookup failing / lookup rate limited with `cursorAt` kept, order of `syncAll`, customers failure skips receivables, products failure does not
- [x] 2.5 Developer writes `src/modules/erp-sync/erp-sync.repository.integration.test.ts` against Testcontainers Postgres: upsert twice without duplicates, update in place, spreadsheet receivable overwritten with `source = ERP`, rollback on failure, run lifecycle with `itemsRejected` and `cursorAt`, last successful run, missing customer codes
- [x] 2.6 Run the new tests, confirm they fail for the expected reasons, and save the commands and output to the evidence folder

- [x] 2.7 Developer writes service cases in `src/modules/erp-sync/erp-sync.test.ts` for internal-failure logging: a storage failure is logged with entity, error type, and code only; an ERP failure writes no internal-failure log

## 3. Green

- [x] 3.1 Extract the HTTP request from `fetchPage` and implement `getCustomer` in `src/shared/erp/erp-client.ts`
- [x] 3.2 Add `itemsRejected` and `cursorAt` to `SyncRun` in `prisma/schema.prisma` and create the additive migration with `pnpm db:migrate --name sync-run-rejected-and-cursor`
- [x] 3.3 Implement `src/modules/erp-sync/erp-sync.mappers.ts`
- [x] 3.4 Implement `ErpSyncRepository` and `PrismaErpSyncRepository` in `src/modules/erp-sync/erp-sync.repository.ts`
- [x] 3.5 Implement `ErpSyncService` in `src/modules/erp-sync/erp-sync.service.ts`
- [x] 3.6 Add `scripts/sync-erp.ts` and the `sync:erp` package script
- [x] 3.7 Run `pnpm test` and `pnpm test:integration` until every test passes, and save the output to the evidence folder

- [x] 3.8 Log internal failures in `ErpSyncService` with entity, error type, and code only
- [x] 3.9 Run `pnpm test` until every test passes, and save the output to the evidence folder

## 4. Refactor

- [x] 4.1 Improve naming and remove duplication across the three entity runs without changing behavior
- [x] 4.2 Run `pnpm test` and `pnpm test:integration`, confirm every test stays green, and save the output to the evidence folder

## 5. Consolidation

- [x] 5.1 Run `pnpm sync:erp` twice against the real ERP and confirm the row counts do not change
- [x] 5.2 Run `pnpm format:check`, `pnpm verify`, `pnpm test:coverage`, `pnpm test:integration`, and `pnpm build`
- [x] 5.3 Run `openspec validate erp-sync-persist --strict`
- [x] 5.4 Write ADR 0004 (English names with ERP mapping) from `docs/templates/adr.md` and add it to `docs/adr/README.md`
- [x] 5.5 Write `docs/changes/erp-sync-persist.md` from `docs/templates/change.md`
- [ ] 5.6 Prepare the pull request from `feat/f02-erp-sync` with `citi-prepare-pr`
