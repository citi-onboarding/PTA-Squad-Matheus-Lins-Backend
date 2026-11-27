## 1. SDD

- [x] 1.1 Resolve the PR 2 pending decisions in `docs/tasks/erp-sync.md` (lock for the whole `syncAll`, `SYNC_ENABLED=false` in Docker, scheduling inside the API)
- [x] 1.2 Write `proposal.md`, `design.md`, and `specs/erp-data-synchronization/spec.md`
- [x] 1.3 Run `openspec validate erp-sync-schedule --strict`

## 2. Red

- [x] 2.1 Write `src/shared/config/env.test.ts` cases for `SYNC_INTERVAL_MINUTES`, `SYNC_RETRY_MINUTES`, and `SYNC_ENABLED`: defaults, accepted values, and rejected values
- [x] 2.2 Write service cases in `src/modules/erp-sync/erp-sync.test.ts`: `retryAfterSeconds` on a rate-limited run; `syncAllIfIdle` skips and logs with a run of 10 minutes, marks a run of 31 minutes as `stale run` and runs, and runs when nothing is `RUNNING`
- [x] 2.3 Write `src/modules/erp-sync/erp-sync.scheduler.test.ts` with Vitest fake timers: runs at start and after the interval; retry after a failure and back to the interval; 3600-second daily limit; skipped run checks again after the retry delay; a thrown error is logged safely and the schedule continues; `stop()` cancels the next run
- [x] 2.4 Write `src/modules/erp-sync/erp-sync.routes.test.ts`: 401 without a token, 200 for every role, `null` fields without runs, `SUCCESS` then `FAILURE`, `RUNNING`, and no ERP key or URL in the response; and a `create-app.test.ts` case for the mounted route
- [x] 2.5 Extend `erp-sync.repository.integration.test.ts`: `markStaleRuns`, `findRunningRun`, `findLastAttemptByEntity`, and `finishedAt` from `findLastSuccessfulRun`
- [x] 2.6 Add stubs with the final signatures, run the new tests, and confirm they fail on their assertions

## 3. Green

- [x] 3.1 Add the three settings to `src/shared/config/env.ts` and `.env.example`
- [x] 3.2 Add `retryAfterSeconds` and `syncAllIfIdle` to `ErpSyncService`, and the repository methods to `ErpSyncRepository` and `PrismaErpSyncRepository`
- [x] 3.3 Implement `ErpSyncScheduler` and `nextDelayMilliseconds`
- [x] 3.4 Implement `getSyncStatus`, `erp-sync.schemas.ts`, and `createErpSyncRouter`; mount it in `createApp`
- [x] 3.5 Start and stop the scheduler in `src/server.ts`; use `syncAllIfIdle` in `scripts/sync-erp.ts`; set `SYNC_ENABLED=false` in `docker-compose.yml` and `scripts/test-container.mjs`
- [x] 3.6 Run `pnpm test` and `pnpm test:integration` until every test passes

## 4. Refactor

- [x] 4.1 Review naming and duplication: no refactor needed (the safe error description was already extracted to `describeErrorSafely` during Green); suites stay green

## 5. Consolidation

- [x] 5.1 Regenerate `openapi.json` with `pnpm openapi:generate`
- [x] 5.2 Run `pnpm format:check`, `pnpm verify`, `pnpm test:coverage`, `pnpm test:integration`, `pnpm test:container`, and `pnpm build`
- [x] 5.3 Run the API against the real ERP: a scheduled run at start and after a short interval, `GET /sync/status`, an invalid `ERP_BASE_URL` retried after `SYNC_RETRY_MINUTES`, and a stuck `RUNNING` row recovered as `stale run`
- [x] 5.4 Write ADR 0006 (scheduling inside the API) from `docs/templates/adr.md` and add it to the index
- [x] 5.5 Write `docs/changes/erp-sync-schedule.md` from `docs/templates/change.md` and add it to the index
- [ ] 5.6 Prepare the pull request with `citi-prepare-pr`
