---
title: ADR-0006
status: accepted
date: 2026-11-27
owners: [Matheus Lins]
tags: [erp, sync, scheduling, f02, us-002, rn-15]
supersedes: null
superseded_by: null
---

# 0006: The ERP synchronization runs inside the API, locked by the SyncRun table

## Context

F02 (US-002) requires the portal's ERP data to be at most one hour behind the
ERP without anyone running anything by hand. The ERP has per-minute and daily
limits and short outages (RN-15), so the synchronization must never run twice at
once, must recover from failures by itself, and must survive the API stopping in
the middle of a run.

`erp-sync-persist` added `ErpSyncService.syncAll` and the manual command
`pnpm sync:erp`, and records every entity run in the `SyncRun` table
(`RUNNING`, then `SUCCESS` or `FAILURE`). The staging and production hosting is
not chosen yet, so the decision cannot rely on a platform-specific scheduler.

## Decision

- The API schedules the synchronization itself (`ErpSyncScheduler` in
  `src/modules/erp-sync/`), started by `src/server.ts` after the server listens
  and stopped on shutdown. `createApp` never starts it, so tests and the OpenAPI
  scripts never synchronize.
- It runs once at start and then arms one timer after each run ends:
  `SYNC_INTERVAL_MINUTES` (default 60, minimum 5) after a full success,
  `SYNC_RETRY_MINUTES` (default 10, minimum 1) after a failure, a skipped run, or
  an error that escaped the run, and at least the ERP's `Retry-After` after its
  daily limit. A run never waits for the daily limit; it ends as `FAILURE`
  (`rate limited`) at once.
- The lock is the `SyncRun` table, for the whole synchronization (manager
  decision): before starting, runs still `RUNNING` for 30 minutes or more become
  `FAILURE` (`stale run`), and any remaining `RUNNING` run skips the
  synchronization with the log `sync skipped: run in progress`. `pnpm sync:erp`
  honors the same lock.
- `SYNC_ENABLED` (default `true`) turns the schedule off without a deploy. It is
  `false` in `docker-compose.yml` and in `pnpm test:container`, which run with
  the placeholder ERP key (ADR 0003) and would only record failed runs (manager
  decision).
- **Staging:** one API instance with the real ERP key and `SYNC_ENABLED=true`
  synchronizes on its own; `GET /sync/status` shows the last success per entity.
  Wherever it is hosted, it must run as a single instance (see Negative).
- Rules future changes must preserve: one scheduler per process, no overlap of
  runs, no run that waits for the daily limit, and no error that stops the API or
  the schedule.

## Consequences

### Positive

- No new dependency and no platform coupling: the same build schedules itself on
  any host, in Docker, or with `pnpm dev`.
- The interval counts from the end of a run, so a slow run never stacks on the
  next one.
- A run left `RUNNING` by a crash or a restart recovers by itself after 30
  minutes; a failed run is retried after `SYNC_RETRY_MINUTES`, which keeps the
  data within the one-hour target in normal outages.
- The `SyncRun` table that holds the lock is the same one `GET /sync/status`
  reads, so the status always matches what the scheduler did.

### Negative

- Several API instances would each run a scheduler. The table lock makes overlaps
  rare but not impossible (the check and the first `startRun` are not atomic, and
  there is no `RUNNING` row between two entity runs). Scaling out needs a
  PostgreSQL advisory lock or an external scheduler, recorded in a new ADR.
- A restart during a run delays the next synchronization by up to 30 minutes plus
  `SYNC_RETRY_MINUTES` while the stuck run ages.
- The API process does background work; a long synchronization shares the event
  loop with requests (acceptable: about 15 ERP calls and a few hundred upserts per
  full read, 3 calls per incremental run).
- Local `docker compose` does not synchronize unless `SYNC_ENABLED=true` and the
  real key are set in `.env`.

## Alternatives considered

### External cron calling `pnpm sync:erp`

The hosting platform's cron would run the manual command every hour. It keeps
the API free of background work, but it depends on a platform not chosen yet, and
retries after a failure would follow the cron schedule instead of
`SYNC_RETRY_MINUTES`. The manual command stays available and honors the same
lock, so this remains possible later.

### A scheduling library or job queue

`node-cron`, BullMQ, or similar add a dependency (and Redis for a queue) for one
fixed-delay job. Rejected.

### One lock per entity

Each entity could hold its own lock and run independently. `syncAll` already runs
the entities in order, with receivables depending on customers, so a per-entity
lock adds rules without a use case. Rejected by the manager.

## References

- OpenSpec change: `openspec/changes/erp-sync-schedule/` (design D1–D6)
- Task: `docs/tasks/erp-sync.md` (decisions of 2026-11-27)
- Change summary: `docs/changes/erp-sync-schedule.md`
- ADR 0003 (required ERP credentials and the placeholder key), ADR 0004 (English
  names with ERP mapping)
- PRD: US-002, RN-14, RN-15
