## Context

- `erp-sync-persist` (PR #8) added `src/modules/erp-sync/`: `ErpSyncService`
  (`syncCustomers`, `syncProducts`, `syncReceivables`, `syncAll`), the
  `ErpSyncRepository` interface with `PrismaErpSyncRepository`, and
  `pnpm sync:erp`. Each entity run is a `SyncRun` row (`RUNNING` → `SUCCESS` or
  `FAILURE`); `runEntity` catches ERP and storage failures and maps them to a
  fixed error vocabulary, including `rate limited` for `RateLimitedError`, but
  drops the error's `retryAfterSeconds`.
- A database failure in `startRun`, `findLastSuccessfulRun`, or `finishRun`
  happens outside `runEntity`'s `try`, so `syncAll` can throw and leave a
  `RUNNING` row behind.
- `withRetry` (`src/shared/erp/with-retry.ts`) already turns a `Retry-After`
  above 300 seconds into `RateLimitedError` without waiting, so a run never
  blocks on the daily limit; shorter waits (at most 3 × 300 s) stay inside the
  run and below the 30-minute stale threshold.
- `f01-auth-api` (PR #7) added `requireAuth` and `requireRole` in
  `src/shared/http`, wired in `src/app/create-app.ts`, where module routers are
  mounted and receive the `requireAuth` instance.
- `src/server.ts` is the composition root of the running API; `createApp` is
  also used by tests and by the OpenAPI scripts, so it must not start timers.

## Goals / Non-Goals

**Goals:** the scheduled synchronization with retry, daily-limit handling, the
`SyncRun` lock with stale-run recovery, the three settings, and
`GET /sync/status`, all testable without real timers, a database, or the ERP.

**Non-goals:** several API instances, a job queue or cron dependency, screen
changes, the F03 refresh button, and any change to how an entity is
synchronized.

## Decisions

### D1. The schedule runs inside the API (ADR 0006)

`ErpSyncScheduler` (`erp-sync.scheduler.ts`) receives the service, the clock, the
logger, and `{ intervalMinutes, retryMinutes }`. `start()` runs a
synchronization immediately and, when it ends, arms one `setTimeout` for the
next one; `stop()` clears the pending timer. Chaining one timer after each run
(instead of `setInterval`) means the scheduler never overlaps itself and the
interval counts from the end of a run, as the spec states. The timer is
`unref()`ed so it never keeps the process alive on shutdown.

- Rejected: an external cron calling `pnpm sync:erp` — it depends on a hosting
  platform not chosen yet. The manual command stays for checks and emergencies.
- Rejected: `node-cron` or a queue — a new dependency for one fixed-delay job.

### D2. The lock is the `SyncRun` table, for the whole synchronization

`ErpSyncService.syncAllIfIdle()` runs before `syncAll`:

1. `repository.markStaleRuns(now − 30 min, now)` updates every `ERP_SYNC` run
   that is `RUNNING` with `startedAt ≤ now − 30 min` to `FAILURE`, `error`
   `stale run`, `finishedAt` now.
2. `repository.findRunningRun()` returns the newest remaining `RUNNING` run
   (`entity`, `startedAt`), if any. When there is one, the service logs
   `sync skipped: run in progress` with that entity and start, and returns
   `{ status: "skipped" }`.
3. Otherwise it returns `{ status: "completed", results: await syncAll() }`.

One lock for the whole `syncAll` (manager decision): `syncAll` already runs the
entities in sequence, and a per-entity lock would add rules without a use case.
`pnpm sync:erp` calls the same method, so a manual run never overlaps the API's.

- Known gap: between one entity's `finishRun` and the next entity's `startRun`
  there is no `RUNNING` row for a few milliseconds. With one API instance the
  scheduler cannot race itself; only a manual run started in that instant could
  overlap, and the upserts make an overlap safe (no duplicates).

### D3. Next delay

`nextDelayMilliseconds(outcome, settings)`:

| Outcome                                  | Next synchronization after                                      |
| ---------------------------------------- | --------------------------------------------------------------- |
| every entity `SUCCESS`                   | `SYNC_INTERVAL_MINUTES`                                         |
| any entity `FAILURE`                     | `SYNC_RETRY_MINUTES`                                            |
| any entity `FAILURE` with `rate limited` | max(`SYNC_RETRY_MINUTES`, largest `retryAfterSeconds`)          |
| skipped (run in progress)                | `SYNC_RETRY_MINUTES`                                            |
| `syncAllIfIdle` threw                    | `SYNC_RETRY_MINUTES`, after logging `errorType` and `errorCode` |

`EntitySyncResult` gains `retryAfterSeconds: number | null`, set from the
`RateLimitedError` that ended the run and `null` otherwise. The thrown-error log
reuses the rule of `erp-sync-persist`: the type and the code, never the message
or the stack, because Prisma messages can carry record values.

### D4. Status

`getSyncStatus(repository)` (`erp-sync.status.ts`) reads, for each entity,
`findLastSuccessfulRun` (now also selecting `finishedAt`) and the new
`findLastAttemptByEntity` (newest run of the entity by `startedAt`, then `id`,
whatever its result) and returns
`{ lastSuccessAt, lastAttemptAt, lastResult }`. It needs only the repository,
not the ERP client, so `createApp` builds it from the database alone.

`createErpSyncRouter({ repository, requireAuth })` (`erp-sync.routes.ts`) mounts
`GET /status` behind `requireAuth` with no role restriction; `createApp` mounts
it under `/sync`. The handler serializes through `syncStatusSchema.parse`
(`erp-sync.schemas.ts`), the schema that also registers the path in the OpenAPI
registry, so the response cannot drift from the contract or grow a field such as
`error`. `createApp` accepts an optional `syncStatusRepository` override, like
`authRepository`.

### D5. Settings

In `envSchema`: `SYNC_INTERVAL_MINUTES` (`z.coerce.number().int().min(5)`,
default 60), `SYNC_RETRY_MINUTES` (`z.coerce.number().int().min(1)`, default
10), and `SYNC_ENABLED` (`"true"` or `"false"`, default `"true"`, transformed to
a boolean; `z.coerce.boolean()` is not used because it turns `"false"` into
`true`).

### D6. Composition

`src/server.ts` starts the scheduler after `server.listen` when `SYNC_ENABLED` is
`true`, building the ERP client, `PrismaErpSyncRepository`, and `ErpSyncService`
as `scripts/sync-erp.ts` does; shutdown stops it before disconnecting the
database. A synchronization still running at shutdown leaves a `RUNNING` row,
which D2 recovers. `createApp` never starts the scheduler, so tests and the
OpenAPI scripts never synchronize. `docker-compose.yml` and
`scripts/test-container.mjs` set `SYNC_ENABLED=false` (manager decision), because
they run with the placeholder key `not-configured`.

## Risks / Trade-offs

- [Several API instances would each schedule synchronizations] → the lock makes
  overlaps rare but not impossible. One instance is the current plan; ADR 0006
  records that scaling out needs a database advisory lock or an external
  scheduler.
- [A restart during a run delays the next synchronization up to 30 minutes plus
  `SYNC_RETRY_MINUTES`] → accepted: it never blocks forever, and the status route
  shows the last success time meanwhile.
- [A failed synchronization retries every 10 minutes while the ERP is down] →
  about 3 calls per retry; the daily limit itself is honored through
  `retryAfterSeconds` (RN-15).
- [`SYNC_ENABLED=false` in Docker hides scheduling problems locally] → the unit
  tests cover the scheduler with fake timers, and the manual check runs the API
  with the real key.

## Migration Plan

1. Deploy; no migration is needed.
2. Set `SYNC_INTERVAL_MINUTES`, `SYNC_RETRY_MINUTES`, and `SYNC_ENABLED` only to
   change the defaults (60, 10, `true`).
3. Rollback: revert the change, or set `SYNC_ENABLED=false` to stop the schedule
   without a deploy.

## Open Questions

None. The three PR 2 decisions were made by the manager on 2026-11-27 and are
recorded in `docs/tasks/erp-sync.md`.
