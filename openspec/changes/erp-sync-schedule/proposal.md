## Why

F02 (US-002) requires the portal's ERP data to be at most one hour behind the
ERP and every screen to say when that data is from. The `erp-sync-persist`
change stores the data, but only when someone runs `pnpm sync:erp` by hand, and
nothing tells the web or the app when the last synchronization succeeded. The ERP
has usage limits and short outages (RN-15), so the automatic synchronization must
never overlap itself, must recover from failures on its own, and must keep
serving the last data. Authentication now exists (`f01-auth-api`), so the status
route can require a signed-in user.

## What Changes

- Run the full synchronization automatically inside the API: when the API starts
  and then every `SYNC_INTERVAL_MINUTES` (default 60, minimum 5).
- After a failed synchronization, try again after `SYNC_RETRY_MINUTES` (default
  10, minimum 1) instead of the full interval; after a success, return to the
  interval.
- When the ERP reports its daily limit, end the run at once as `FAILURE` and try
  again after the larger of the ERP's `Retry-After` and `SYNC_RETRY_MINUTES`,
  never waiting inside a run.
- Never run two synchronizations at once: skip while any run is in progress and
  younger than 30 minutes; mark runs stuck for 30 minutes or more as
  `FAILURE` (`stale run`) and continue. The manual `pnpm sync:erp` honors the same
  rule.
- A synchronization error never stops the API or the schedule.
- `SYNC_ENABLED` (default `true`) turns the automatic synchronization off; it is
  `false` in `docker compose` and in `pnpm test:container`, which run with a
  placeholder ERP key.
- Add `GET /sync/status` for any signed-in user, returning for customers,
  products, and receivables the time of the last successful synchronization, the
  start of the last attempt, and its result. The response is validated with Zod
  and documented in `openapi.json`.

### Non-goals

- The "Refresh" button for a single customer (F03, US-003).
- Showing the synchronization time on web and mobile screens (each screen's
  task).
- Importing legacy spreadsheets (RN-16).
- Running several API instances; the lock is designed for one instance (ADR
  0006).
- An external scheduler or job queue, and any new dependency.
- Changing how each entity is synchronized (`erp-sync-persist`).

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `erp-data-synchronization`: adds the automatic schedule, the run lock and
  stale-run recovery, the daily-limit retry, the manual command's lock, and the
  synchronization status route. The capability is introduced by the
  `base-data-model` and `erp-sync-persist` changes, which are not archived yet,
  so this change only adds requirements to it.

## Impact

- **Business:** ERP data reaches the portal without manual action, at most one
  hour behind (US-002), and clients can show "Dados do ERP de [data e hora]".
- **API:** new `GET /sync/status` (401 without a token, 200 for every role);
  `openapi.json` regenerated. No existing route changes.
- **Database / migrations:** none. The existing `SyncRun` table holds the lock
  and the status.
- **Configuration:** `SYNC_INTERVAL_MINUTES`, `SYNC_RETRY_MINUTES`, and
  `SYNC_ENABLED` in `src/shared/config/env.ts` and `.env.example`;
  `SYNC_ENABLED=false` in `docker-compose.yml` and `scripts/test-container.mjs`.
- **Security:** the status never returns or logs the ERP key, URL, headers, or
  bodies (RN-14); a thrown synchronization error is logged with its type and code
  only.
- **ERP usage:** about 3 calls per hourly incremental run, and a retry every
  `SYNC_RETRY_MINUTES` only after a failure (RN-15).
- **Dependencies:** none added.
- **Documentation:** ADR 0006 (scheduling inside the API), the task
  `docs/tasks/erp-sync.md`, and `docs/changes/erp-sync-schedule.md`.
- **Code:** `src/modules/erp-sync/` (scheduler, status, routes, schemas, service
  and repository additions), `src/app/create-app.ts`, `src/server.ts`,
  `scripts/sync-erp.ts`, and the environment configuration.
