import request from "supertest";
import { describe, expect, it, vi } from "vitest";

import type { AuthRepository } from "../modules/auth/auth.repository.js";
import { hashPassword } from "../modules/auth/password.js";
import type { Environment } from "../shared/config/env.js";
import type { Database } from "../shared/database/create-database.js";
import { createApp } from "./create-app.js";

const environment: Environment = {
  NODE_ENV: "test",
  SERVER_HOST: "0.0.0.0",
  SERVER_PORT: 3001,
  LOG_LEVEL: "silent",
  CORS_ORIGINS: "http://localhost:5173",
  DATABASE_URL: "postgresql://postgres:postgres@localhost:5432/test",
  ERP_BASE_URL: "https://pta-erp-api.onrender.com",
  ERP_API_KEY: "test-erp-key",
  TRUST_PROXY: 0,
  SYNC_INTERVAL_MINUTES: 60,
  SYNC_RETRY_MINUTES: 10,
  SYNC_ENABLED: false,
  corsOrigins: ["http://localhost:5173"],
};

function createDatabaseDouble() {
  return {
    $queryRaw: vi.fn().mockResolvedValue([{ result: 1 }]),
  } as unknown as Database;
}

describe("createApp", () => {
  it("serves liveness, readiness, and OpenAPI", async () => {
    const app = createApp({ database: createDatabaseDouble(), environment });
    await request(app).get("/health/live").expect(200, { status: "ok" });
    await request(app).get("/health/ready").expect(200, { status: "ready" });
    const contract = await request(app).get("/openapi.json").expect(200);
    expect(contract.body.openapi).toBe("3.1.0");
  });

  it("returns 503 when the database is unavailable", async () => {
    const database = createDatabaseDouble();
    vi.mocked(database.$queryRaw).mockRejectedValueOnce(
      new Error("unavailable"),
    );
    await request(createApp({ database, environment }))
      .get("/health/ready")
      .expect(503, { status: "not-ready" });
  });

  it("uses Problem Details for unknown requests", async () => {
    const app = createApp({ database: createDatabaseDouble(), environment });
    const missing = await request(app).get("/unknown").expect(404);
    expect(missing.body).toMatchObject({ title: "Not Found", status: 404 });
  });

  it("serves GET /sync/status to signed-in users only, without the ERP key or URL", async () => {
    const passwordHash = await hashPassword("status-password");
    const authRepository: AuthRepository = {
      findUserByEmail: (email) =>
        Promise.resolve(
          email === "finance@x.com"
            ? {
                id: 7,
                name: "Finance",
                email,
                role: "FINANCE",
                sellerCode: null,
                passwordHash,
              }
            : null,
        ),
      findUserById: () => Promise.resolve(null),
      createSession: () => Promise.resolve(),
      findSessionByTokenHash: () =>
        Promise.resolve({
          id: 1,
          lastSeenAt: new Date(),
          revokedAt: null,
          user: {
            id: 7,
            name: "Finance",
            email: "finance@x.com",
            role: "FINANCE",
            sellerCode: null,
            passwordHash,
          },
        }),
      touchSession: () => Promise.resolve(),
      revokeSession: () => Promise.resolve(),
    };
    const app = createApp({
      database: createDatabaseDouble(),
      environment,
      authRepository,
      syncStatusRepository: {
        findLastSuccessfulRun: () => Promise.resolve(null),
        findLastAttemptByEntity: () => Promise.resolve(null),
      },
    });

    await request(app).get("/sync/status").expect(401);
    const login = await request(app)
      .post("/auth/login")
      .send({ email: "finance@x.com", password: "status-password" })
      .expect(200);
    const status = await request(app)
      .get("/sync/status")
      .set("Authorization", `Bearer ${String(login.body.token)}`)
      .expect(200);

    expect(Object.keys(status.body).sort()).toEqual([
      "customers",
      "products",
      "receivables",
    ]);
    expect(status.text).not.toContain(environment.ERP_API_KEY);
    expect(status.text).not.toContain(environment.ERP_BASE_URL);
  });

  it("applies security and CORS headers", async () => {
    const response = await request(
      createApp({ database: createDatabaseDouble(), environment }),
    )
      .get("/health/live")
      .set("x-request-id", "known-request-id")
      .set("origin", "http://localhost:5173")
      .expect(200);
    expect(response.headers["access-control-allow-origin"]).toBe(
      "http://localhost:5173",
    );
    expect(response.headers["x-content-type-options"]).toBe("nosniff");
    expect(response.headers["x-request-id"]).toBe("known-request-id");
    expect(response.headers["x-powered-by"]).toBeUndefined();
  });
});
