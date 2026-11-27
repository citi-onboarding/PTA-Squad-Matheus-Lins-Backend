import express from "express";
import request from "supertest";
import { describe, expect, it } from "vitest";

import type { Role } from "../../shared/database/generated/enums.js";
import { problemHandler } from "../../shared/http/problem.js";
import { requireAuth } from "../../shared/http/require-auth.js";
import type {
  LastAttempt,
  LastSuccessfulRun,
  SyncEntity,
} from "./erp-sync.repository.js";
import { createErpSyncRouter } from "./erp-sync.routes.js";
import type { SyncStatusRepository } from "./erp-sync.status.js";

const TOKENS: Record<string, Role> = {
  "seller-token": "SELLER",
  "manager-token": "MANAGER",
  "finance-token": "FINANCE",
  "admin-token": "ADMIN",
};

interface Run {
  entity: SyncEntity;
  startedAt: Date;
  finishedAt: Date | null;
  result: LastAttempt["result"];
  error: string | null;
}

/** Runs in the order they started, as the `SyncRun` table would hold them. */
class InMemorySyncStatusRepository implements SyncStatusRepository {
  readonly runs: Run[] = [];

  findLastSuccessfulRun(entity: SyncEntity): Promise<LastSuccessfulRun | null> {
    const run = this.runs
      .filter((candidate) => candidate.entity === entity)
      .filter((candidate) => candidate.result === "SUCCESS")
      .at(-1);
    return Promise.resolve(
      run ? { cursorAt: run.startedAt, finishedAt: run.finishedAt } : null,
    );
  }

  findLastAttemptByEntity(entity: SyncEntity): Promise<LastAttempt | null> {
    const run = this.runs
      .filter((candidate) => candidate.entity === entity)
      .at(-1);
    return Promise.resolve(
      run ? { startedAt: run.startedAt, result: run.result } : null,
    );
  }
}

function setup() {
  const repository = new InMemorySyncStatusRepository();
  const app = express();
  app.use(
    "/sync",
    createErpSyncRouter({
      repository,
      requireAuth: requireAuth((token) => {
        const role = TOKENS[token];
        return Promise.resolve(role ? { id: 1, role, sellerCode: null } : null);
      }),
    }),
  );
  app.use(problemHandler);
  return { app, repository };
}

const neverSynchronized = {
  lastSuccessAt: null,
  lastAttemptAt: null,
  lastResult: null,
};

describe("F02 / US-002 GET /sync/status", () => {
  it("responds 401 without a token", async () => {
    const { app } = setup();

    await request(app).get("/sync/status").expect(401);
  });

  it("responds 401 with a token that matches no session", async () => {
    const { app } = setup();

    await request(app)
      .get("/sync/status")
      .set("Authorization", "Bearer unknown-token")
      .expect(401);
  });

  it.each(Object.entries(TOKENS))(
    "responds 200 to a signed-in user (%s, %s)",
    async (token) => {
      const { app } = setup();

      await request(app)
        .get("/sync/status")
        .set("Authorization", `Bearer ${token}`)
        .expect(200);
    },
  );

  it("returns null fields for the three entities when nothing ever ran", async () => {
    const { app } = setup();

    const response = await request(app)
      .get("/sync/status")
      .set("Authorization", "Bearer seller-token")
      .expect(200);

    expect(response.body).toEqual({
      customers: neverSynchronized,
      products: neverSynchronized,
      receivables: neverSynchronized,
    });
  });

  it("keeps the last success time after a later failure", async () => {
    const { app, repository } = setup();
    repository.runs.push(
      {
        entity: "products",
        startedAt: new Date("2026-11-27T12:00:00.000Z"),
        finishedAt: new Date("2026-11-27T12:05:00.000Z"),
        result: "SUCCESS",
        error: null,
      },
      {
        entity: "products",
        startedAt: new Date("2026-11-27T13:00:00.000Z"),
        finishedAt: new Date("2026-11-27T13:00:02.000Z"),
        result: "FAILURE",
        error: "erp error: http 503",
      },
    );

    const response = await request(app)
      .get("/sync/status")
      .set("Authorization", "Bearer manager-token")
      .expect(200);

    expect(response.body.products).toEqual({
      lastSuccessAt: "2026-11-27T12:05:00.000Z",
      lastAttemptAt: "2026-11-27T13:00:00.000Z",
      lastResult: "FAILURE",
    });
    expect(JSON.stringify(response.body)).not.toContain("http 503");
  });

  it("reports a run in progress", async () => {
    const { app, repository } = setup();
    repository.runs.push({
      entity: "receivables",
      startedAt: new Date("2026-11-27T14:00:00.000Z"),
      finishedAt: null,
      result: "RUNNING",
      error: null,
    });

    const response = await request(app)
      .get("/sync/status")
      .set("Authorization", "Bearer finance-token")
      .expect(200);

    expect(response.body.receivables).toEqual({
      lastSuccessAt: null,
      lastAttemptAt: "2026-11-27T14:00:00.000Z",
      lastResult: "RUNNING",
    });
  });
});
