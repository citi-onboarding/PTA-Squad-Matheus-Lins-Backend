import "dotenv/config";

import { ErpSyncService } from "../src/modules/erp-sync/erp-sync.service.js";
import { PrismaErpSyncRepository } from "../src/modules/erp-sync/erp-sync.repository.js";
import { env } from "../src/shared/config/env.js";
import { createDatabase } from "../src/shared/database/create-database.js";
import { createErpClient } from "../src/shared/erp/erp-client.js";
import { createLogger } from "../src/shared/logging/logger.js";

// Runs one full ERP synchronization for manual checks (`pnpm sync:erp`).
// Prints only each entity's outcome — never the ERP key or record contents.
const database = createDatabase(env.DATABASE_URL);
const service = new ErpSyncService({
  erp: createErpClient({
    baseUrl: env.ERP_BASE_URL,
    apiKey: env.ERP_API_KEY,
    fetch,
  }),
  repository: new PrismaErpSyncRepository(database),
  clock: () => new Date(),
  logger: createLogger(env),
});

try {
  // Honors the same lock as the API scheduler, so a manual run never overlaps it.
  const outcome = await service.syncAllIfIdle();
  if (outcome.status === "skipped") {
    process.stdout.write("skipped: run in progress\n");
    process.exitCode = 1;
  }
  const results = outcome.status === "completed" ? outcome.results : [];
  for (const { entity, result, itemsRead, itemsRejected, error } of results) {
    process.stdout.write(
      `${entity}: ${result} (read ${String(itemsRead)}, rejected ${String(itemsRejected)})${error ? ` — ${error}` : ""}\n`,
    );
  }
  if (results.some(({ result }) => result === "FAILURE")) process.exitCode = 1;
} finally {
  await database.$disconnect();
}
