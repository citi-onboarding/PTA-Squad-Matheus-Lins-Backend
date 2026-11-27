---
change_id: erp-sync-schedule
date: 2026-11-27
status: in-progress
owners: [Matheus Lins]
tags: [F02, US-002, RN-14, RN-15, erp, sync, scheduling]
related_adrs: [ADR-0003, ADR-0006]
openspec_change: openspec/changes/erp-sync-schedule/
---

# Schedule the ERP sync and report its status

## Objective

Keep the portal's ERP data at most one hour behind the ERP without manual
action, and tell the web and the app when it was last synchronized (US-002,
RN-15). This is the second pull request of the F02 synchronization task; the
first (`erp-sync-persist`, PR #8) stores the data.

## Change made

- `src/modules/erp-sync/erp-sync.scheduler.ts`: `ErpSyncScheduler` runs a
  synchronization at start and arms one `setTimeout` after each run;
  `nextDelayMilliseconds` picks the interval, the retry delay, or the ERP's
  `Retry-After` (ADR 0006).
- `erp-sync.service.ts`: `syncAllIfIdle()` marks stale runs, skips while a run is
  in progress, and otherwise calls `syncAll`; `EntitySyncResult.retryAfterSeconds`
  carries the daily-limit wait; `describeErrorSafely` is shared with the
  scheduler.
- `erp-sync.repository.ts`: `findLastAttemptByEntity`, `findRunningRun`,
  `markStaleRuns`, and `finishedAt` in `findLastSuccessfulRun`.
- `erp-sync.status.ts`, `erp-sync.schemas.ts`, `erp-sync.routes.ts`:
  `GET /sync/status` behind `requireAuth`, serialized through the Zod schema that
  also registers the OpenAPI path; mounted in `src/app/create-app.ts`, which
  accepts a `syncStatusRepository` override for tests.
- `src/server.ts` starts the scheduler after `listen` and stops it on shutdown;
  `scripts/sync-erp.ts` uses `syncAllIfIdle`.
- `src/shared/config/env.ts` and `.env.example`: `SYNC_INTERVAL_MINUTES`,
  `SYNC_RETRY_MINUTES`, `SYNC_ENABLED`. `docker-compose.yml` and
  `scripts/test-container.mjs` set `SYNC_ENABLED=false`.
- `openapi.json` regenerated with `/sync/status`, `SyncStatus`, and
  `EntitySyncStatus`.

## Resulting behavior

- With `SYNC_ENABLED=true` (default), the API synchronizes when it starts and
  `SYNC_INTERVAL_MINUTES` (default 60) after each fully successful run; with
  `false`, it never synchronizes by itself.
- After any `FAILURE`, a skipped run, or an error that escaped the run, the next
  attempt comes `SYNC_RETRY_MINUTES` (default 10) later; after the ERP daily
  limit, after the larger of that and the ERP's `Retry-After`. No run waits for
  the limit.
- A run `RUNNING` for less than 30 minutes skips the synchronization
  (`sync skipped: run in progress`); 30 minutes or more makes it `FAILURE`
  (`stale run`, with `finishedAt`) and the synchronization runs. `pnpm sync:erp`
  follows the same rule and prints `skipped: run in progress` with exit code 1.
- An escaped error is logged with `errorType` and `errorCode` only, and never
  stops the API or the schedule.
- `GET /sync/status`: 401 without a valid session; 200 for every role with
  `{ customers, products, receivables }`, each `lastSuccessAt`, `lastAttemptAt`,
  and `lastResult` (`SUCCESS`, `FAILURE`, `RUNNING`, or `null`). Run errors, the
  ERP key, and the ERP URL never appear.
- Invalid settings (`SYNC_INTERVAL_MINUTES` below 5 or fractional,
  `SYNC_RETRY_MINUTES` below 1, `SYNC_ENABLED` other than `true`/`false`) stop the
  API at startup.

## Impact

- **API / OpenAPI:** new `GET /sync/status`; no existing route changes.
- **Database:** none; the existing `SyncRun` table holds the lock and the status.
- **Operations:** the API does background work. Run one instance (ADR 0006). Set
  `SYNC_ENABLED=false` to stop the schedule without a deploy.
- **Local runtimes:** `docker compose` and `pnpm test:container` do not
  synchronize unless `SYNC_ENABLED=true` and the real key are in `.env`.
- **ERP usage:** about 3 calls per hourly incremental run; a retry every
  `SYNC_RETRY_MINUTES` only while failing (RN-15).
- **Clients:** the web and the app can show "Dados do ERP de [data e hora]" from
  `lastSuccessAt` (each screen's own task).
- **Security:** no key, URL, header, body, or record data in the status or the
  logs (RN-14).

## Validations executed

Run on 2026-11-27 (Windows, Node 24, Docker Desktop 29.4.0).

| Command                                                                                                                               | Result                                                                                                                                                                                                                                                                                                                           |
| ------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `openspec validate erp-sync-schedule --strict`                                                                                        | `Change 'erp-sync-schedule' is valid` (before any code; planning committed in `71b561f`)                                                                                                                                                                                                                                         |
| Red: `vitest run` on `env.test.ts`, `erp-sync.test.ts`, `erp-sync.scheduler.test.ts`, `erp-sync.routes.test.ts`, `create-app.test.ts` | `Tests 30 failed \| 56 passed (86)`, on assertions or the `Not implemented` stubs                                                                                                                                                                                                                                                |
| Red: `erp-sync.repository.integration.test.ts`                                                                                        | `Tests 4 failed \| 6 passed (10)`                                                                                                                                                                                                                                                                                                |
| Green: same commands                                                                                                                  | `Tests 86 passed (86)` and `Tests 10 passed (10)`; no test changed after Red                                                                                                                                                                                                                                                     |
| `pnpm format:check`, `pnpm exec prisma format --check`                                                                                | both clean                                                                                                                                                                                                                                                                                                                       |
| `pnpm verify`                                                                                                                         | `Tests 193 passed (193)`; architecture `3 passed`; `openspec validate --all --strict` `7 passed, 0 failed`; `openapi:check` and `skills:check` passed                                                                                                                                                                            |
| `pnpm test:coverage`                                                                                                                  | `Tests 193 passed (193)`; `src/shared` 97.75 % statements, 96.7 % branches, 97.68 % lines                                                                                                                                                                                                                                        |
| `pnpm build`                                                                                                                          | passed                                                                                                                                                                                                                                                                                                                           |
| `pnpm test:integration`                                                                                                               | `48 passed \| 1 failed (49)`: the ERP sync repository, auth, and base data model suites passed; the failure was a real-ERP test (`listCustomers returns nothing changed after a future instant`) timing out at 120 s; the real-ERP suite then passed alone, `Tests 11 passed (11)`. This change does not touch `src/shared/erp`. |
| `pnpm test:container`                                                                                                                 | `Production container smoke test passed.` (with `SYNC_ENABLED=false`)                                                                                                                                                                                                                                                            |
| API against the real ERP, `SYNC_INTERVAL_MINUTES=5`                                                                                   | run at start (22:18:18) and again 5 min after it ended (22:23:25); 120 / 60 / 485 rows; `GET /sync/status` 401 without a token and 200 for a SELLER with the three entities                                                                                                                                                      |
| API killed during a full read, then restarted                                                                                         | the killed API left receivables `RUNNING`; the restart logged `sync skipped: run in progress`; with that run aged to 31 min, the next retry marked it `FAILURE` `stale run` and synchronized all three entities                                                                                                                  |
| `ERP_BASE_URL=http://127.0.0.1:9`, `SYNC_RETRY_MINUTES=1`                                                                             | runs `FAILURE` (`erp error: network`, receivables `skipped: customers sync failed`), retried about 1 min after each end; rows unchanged (120 / 60 / 485); `GET /sync/status` kept the previous `lastSuccessAt` with `lastResult` `FAILURE`                                                                                       |
| API logs of the manual runs                                                                                                           | no password, token, `Bearer`, `X-Api-Key`, or ERP key                                                                                                                                                                                                                                                                            |

**ADR evaluation:** ADR 0006 created. Where and how the synchronization is
scheduled is an operational boundary every deployment depends on, with a
scaling limit (one instance) future changes must respect.

## Related artifacts

- Task: `docs/tasks/erp-sync.md`
- Proposal: `openspec/changes/erp-sync-schedule/proposal.md`
- Specification: `openspec/changes/erp-sync-schedule/specs/erp-data-synchronization/spec.md`
- Design: `openspec/changes/erp-sync-schedule/design.md`
- Tasks: `openspec/changes/erp-sync-schedule/tasks.md`
- ADRs: [ADR 0006](../adr/0006-erp-sync-scheduling.md) (new), [ADR 0003](../adr/0003-required-erp-credentials.md)

## Usage

```sh
# .env: real ERP_API_KEY, and optionally
SYNC_INTERVAL_MINUTES=60
SYNC_RETRY_MINUTES=10
SYNC_ENABLED=true
pnpm dev        # synchronizes at start and on schedule
```

```http
GET /sync/status
Authorization: Bearer <token>
```

```json
{
  "customers": {
    "lastSuccessAt": "2026-11-27T22:18:19.889Z",
    "lastAttemptAt": "2026-11-27T22:18:18.013Z",
    "lastResult": "SUCCESS"
  },
  "products": { "...": "..." },
  "receivables": { "...": "..." }
}
```

## Implementation notes

- **Archive order:** `base-data-model`, then `erp-sync-persist`, then this change;
  all three add requirements to `erp-data-synchronization`.
- **Several instances:** not supported by the table lock (ADR 0006).
- **Real-ERP integration tests:** `src/shared/erp/erp-client.integration.test.ts`
  can time out or fail when the ERP is slow or at its per-minute limit; it is
  skipped in CI, which has no key.
- Decided during this change (not critical, flagged in the pull request): the
  next check after a skip and after an escaped error comes after
  `SYNC_RETRY_MINUTES`, and `pnpm sync:erp` honors the lock.
