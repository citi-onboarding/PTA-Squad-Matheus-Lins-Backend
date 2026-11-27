import { randomUUID } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";

import cors from "cors";
import express from "express";
import type { Express } from "express";
import rateLimit from "express-rate-limit";
import helmet from "helmet";
import type { DestinationStream } from "pino";
import { pinoHttp } from "pino-http";
import swaggerUi from "swagger-ui-express";

import { createPrismaAuthRepository } from "../modules/auth/auth.repository.js";
import type { AuthRepository } from "../modules/auth/auth.repository.js";
import { createAuthRouter } from "../modules/auth/auth.routes.js";
import { AuthService } from "../modules/auth/auth.service.js";
import type { Environment } from "../shared/config/env.js";
import type { Database } from "../shared/database/create-database.js";
import { createOpenApiDocument } from "../shared/http/openapi.js";
import { notFoundHandler, problemHandler } from "../shared/http/problem.js";
import { requireAuth } from "../shared/http/require-auth.js";
import { createLogger } from "../shared/logging/logger.js";

interface CreateAppOptions {
  database: Database;
  environment: Environment;
  /** Overrides the Prisma repository, for tests without a database. */
  authRepository?: AuthRepository;
  /** Overrides the clock used for session expiry, for tests. */
  now?: () => Date;
  /** Overrides the log destination, for tests that inspect log output. */
  logDestination?: DestinationStream;
}

export function createApp({
  database,
  environment,
  authRepository = createPrismaAuthRepository(database),
  now,
  logDestination,
}: CreateAppOptions): Express {
  const app = express();
  const logger = createLogger(environment, logDestination);
  const openApiDocument = createOpenApiDocument();
  const authService = new AuthService({
    repository: authRepository,
    ...(now && { now }),
  });
  const authenticated = requireAuth((token) => authService.authenticate(token));

  app.disable("x-powered-by");
  app.use(helmet());
  app.use(
    pinoHttp({
      logger,
      genReqId: (request, response) => {
        const requestId =
          request.headers["x-request-id"]?.toString() ?? randomUUID();
        response.setHeader("x-request-id", requestId);
        return requestId;
      },
      serializers: {
        req: (request: IncomingMessage & { id?: unknown }) => ({
          id: request.id,
          method: request.method,
          url: request.url,
        }),
        res: (response: ServerResponse) => ({
          statusCode: response.statusCode,
        }),
      },
    }),
  );
  app.use(
    cors({
      credentials: true,
      origin(origin, callback) {
        callback(null, !origin || environment.corsOrigins.includes(origin));
      },
    }),
  );
  app.use(express.json({ limit: "1mb" }));
  if (environment.NODE_ENV !== "test") {
    app.use(
      rateLimit({
        windowMs: 60_000,
        limit: 100,
        standardHeaders: "draft-8",
        legacyHeaders: false,
      }),
    );
  }

  app.get("/health/live", (_request, response) =>
    response.json({ status: "ok" }),
  );
  app.get("/health/ready", async (_request, response) => {
    try {
      await database.$queryRaw`SELECT 1`;
      response.json({ status: "ready" });
    } catch {
      response.status(503).json({ status: "not-ready" });
    }
  });
  app.get("/openapi.json", (_request, response) =>
    response.json(openApiDocument),
  );
  app.use("/docs", swaggerUi.serve, swaggerUi.setup(openApiDocument));
  app.use(
    "/auth",
    createAuthRouter({ service: authService, requireAuth: authenticated }),
  );

  app.use(notFoundHandler);
  app.use(problemHandler);

  return app;
}
