import express from "express";
import request from "supertest";
import { describe, expect, it, vi } from "vitest";

import { problemHandler } from "./problem.js";
import { requireAuth } from "./require-auth.js";
import type { AuthenticatedUser } from "./require-auth.js";

const seller: AuthenticatedUser = { id: 7, role: "SELLER", sellerCode: "S1" };

function appWith(authenticate: (token: string) => Promise<unknown>) {
  const app = express();
  app.get(
    "/protected",
    requireAuth(authenticate as never),
    (request, response) => {
      response.json({ user: request.user });
    },
  );
  app.use(problemHandler);
  return app;
}

describe("F01 / US-001 requireAuth", () => {
  it("sets req.user from a valid Bearer token", async () => {
    const authenticate = vi.fn().mockResolvedValue(seller);

    const response = await request(appWith(authenticate))
      .get("/protected")
      .set("Authorization", "Bearer valid-token")
      .expect(200);

    expect(authenticate).toHaveBeenCalledWith("valid-token");
    expect(response.body).toEqual({ user: seller });
  });

  it.each([
    ["no Authorization header", undefined],
    ["a non-Bearer scheme", "Basic dXNlcjpwYXNz"],
    ["an empty Bearer token", "Bearer "],
  ])("responds 401 with %s", async (_case, header) => {
    const authenticate = vi.fn().mockResolvedValue(seller);
    const call = request(appWith(authenticate)).get("/protected");
    if (header !== undefined) call.set("Authorization", header);

    const response = await call.expect(401);

    expect(response.body).toMatchObject({ status: 401 });
    expect(authenticate).not.toHaveBeenCalled();
  });

  it("responds 401 when the token matches no active session", async () => {
    const response = await request(appWith(vi.fn().mockResolvedValue(null)))
      .get("/protected")
      .set("Authorization", "Bearer unknown-token")
      .expect(401);

    expect(response.body).toMatchObject({ status: 401 });
  });
});
