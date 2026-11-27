import { Router } from "express";
import type { RequestHandler } from "express";

import { syncStatusSchema } from "./erp-sync.schemas.js";
import { getSyncStatus } from "./erp-sync.status.js";
import type {
  EntitySyncStatus,
  SyncStatusRepository,
} from "./erp-sync.status.js";

export interface ErpSyncRouterDependencies {
  repository: SyncStatusRepository;
  requireAuth: RequestHandler;
}

function serialize({
  lastSuccessAt,
  lastAttemptAt,
  lastResult,
}: EntitySyncStatus) {
  return {
    lastSuccessAt: lastSuccessAt?.toISOString() ?? null,
    lastAttemptAt: lastAttemptAt?.toISOString() ?? null,
    lastResult,
  };
}

/** `GET /status` for any signed-in role; mounted under `/sync` by the app. */
export function createErpSyncRouter({
  repository,
  requireAuth,
}: ErpSyncRouterDependencies): Router {
  const router = Router();

  router.get("/status", requireAuth, async (_request, response) => {
    const status = await getSyncStatus(repository);
    response.json(
      syncStatusSchema.parse({
        customers: serialize(status.customers),
        products: serialize(status.products),
        receivables: serialize(status.receivables),
      }),
    );
  });

  return router;
}
