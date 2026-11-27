import express from "express";
import request from "supertest";
import { describe, expect, it } from "vitest";

import type { Role } from "../database/generated/enums.js";
import { problemHandler } from "./problem.js";
import { requireAuth } from "./require-auth.js";
import { requireRole } from "./require-role.js";

const usersByToken: Record<string, Role> = {
  "seller-token": "SELLER",
  "manager-token": "MANAGER",
};

function managerOnlyApp() {
  const app = express();
  app.get(
    "/manager-only",
    requireAuth((token) => {
      const role = usersByToken[token];
      return Promise.resolve(role ? { id: 1, role, sellerCode: null } : null);
    }),
    requireRole("MANAGER"),
    (_request, response) => {
      response.json({ ok: true });
    },
  );
  app.use(problemHandler);
  return app;
}

describe("F01 / US-001 / RN-08 requireRole", () => {
  it("responds 403 to a seller on a manager-only route", async () => {
    const response = await request(managerOnlyApp())
      .get("/manager-only")
      .set("Authorization", "Bearer seller-token")
      .expect(403);

    expect(response.body).toMatchObject({
      status: 403,
      detail: "Você não tem acesso a esta página",
    });
  });

  it("accepts a manager on a manager-only route", async () => {
    await request(managerOnlyApp())
      .get("/manager-only")
      .set("Authorization", "Bearer manager-token")
      .expect(200, { ok: true });
  });

  it("responds 401 before checking the role when there is no session", async () => {
    await request(managerOnlyApp()).get("/manager-only").expect(401);
  });
});
