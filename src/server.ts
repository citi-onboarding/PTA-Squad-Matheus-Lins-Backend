import "dotenv/config";

import { createServer } from "node:http";

import { createApp } from "./app/create-app.js";
import { PrismaErpSyncRepository } from "./modules/erp-sync/erp-sync.repository.js";
import { ErpSyncScheduler } from "./modules/erp-sync/erp-sync.scheduler.js";
import { ErpSyncService } from "./modules/erp-sync/erp-sync.service.js";
import { env } from "./shared/config/env.js";
import { createDatabase } from "./shared/database/create-database.js";
import { createErpClient } from "./shared/erp/erp-client.js";
import { createLogger } from "./shared/logging/logger.js";

const database = createDatabase(env.DATABASE_URL);
const logger = createLogger(env);
const app = createApp({ database, environment: env });
const server = createServer(app);
const clock = () => new Date();
// Runs the ERP sync inside the API (ADR 0006); does nothing when SYNC_ENABLED=false.
const scheduler = new ErpSyncScheduler({
  service: new ErpSyncService({
    erp: createErpClient({
      baseUrl: env.ERP_BASE_URL,
      apiKey: env.ERP_API_KEY,
      fetch,
    }),
    repository: new PrismaErpSyncRepository(database),
    clock,
    logger,
  }),
  clock,
  logger,
  settings: {
    enabled: env.SYNC_ENABLED,
    intervalMinutes: env.SYNC_INTERVAL_MINUTES,
    retryMinutes: env.SYNC_RETRY_MINUTES,
  },
});

server.listen(env.SERVER_PORT, env.SERVER_HOST, () => {
  logger.info(
    { host: env.SERVER_HOST, port: env.SERVER_PORT },
    "Server listening",
  );
  scheduler.start();
});

function shutdown(signal: NodeJS.Signals) {
  logger.info({ signal }, "Graceful shutdown started");
  scheduler.stop();
  server.close(async (error) => {
    await database.$disconnect();
    if (error) {
      logger.error({ err: error }, "Server shutdown failed");
      process.exitCode = 1;
    }
  });
}

process.once("SIGINT", shutdown);
process.once("SIGTERM", shutdown);
