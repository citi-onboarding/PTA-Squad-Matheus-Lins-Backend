import type {
  ErpSyncRepository,
  LastAttempt,
  SyncEntity,
} from "./erp-sync.repository.js";

export type SyncStatusRepository = Pick<
  ErpSyncRepository,
  "findLastSuccessfulRun" | "findLastAttemptByEntity"
>;

export interface EntitySyncStatus {
  lastSuccessAt: Date | null;
  lastAttemptAt: Date | null;
  lastResult: LastAttempt["result"] | null;
}

export type SyncStatus = Record<SyncEntity, EntitySyncStatus>;

async function entityStatus(
  repository: SyncStatusRepository,
  entity: SyncEntity,
): Promise<EntitySyncStatus> {
  const [lastSuccess, lastAttempt] = await Promise.all([
    repository.findLastSuccessfulRun(entity),
    repository.findLastAttemptByEntity(entity),
  ]);
  return {
    lastSuccessAt: lastSuccess?.finishedAt ?? null,
    lastAttemptAt: lastAttempt?.startedAt ?? null,
    lastResult: lastAttempt?.result ?? null,
  };
}

/** When each entity was last synchronized successfully, and how its last run went (US-002). */
export async function getSyncStatus(
  repository: SyncStatusRepository,
): Promise<SyncStatus> {
  const [customers, products, receivables] = await Promise.all([
    entityStatus(repository, "customers"),
    entityStatus(repository, "products"),
    entityStatus(repository, "receivables"),
  ]);
  return { customers, products, receivables };
}
