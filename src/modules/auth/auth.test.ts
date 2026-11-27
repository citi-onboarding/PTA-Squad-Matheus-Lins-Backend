import { Writable } from "node:stream";

import request from "supertest";
import { beforeAll, describe, expect, it } from "vitest";

import { createApp } from "../../app/create-app.js";
import type { Environment } from "../../shared/config/env.js";
import type { Database } from "../../shared/database/create-database.js";
import type {
  AuthRepository,
  AuthUser,
  NewSession,
  StoredSession,
} from "./auth.repository.js";
import { hashPassword } from "./password.js";

const environment: Environment = {
  NODE_ENV: "test",
  SERVER_HOST: "0.0.0.0",
  SERVER_PORT: 3001,
  LOG_LEVEL: "silent",
  CORS_ORIGINS: "http://localhost:5173",
  DATABASE_URL: "postgresql://postgres:postgres@localhost:5432/test",
  ERP_BASE_URL: "https://pta-erp-api.onrender.com",
  ERP_API_KEY: "test-erp-key",
  corsOrigins: ["http://localhost:5173"],
};

const PASSWORD = "correct-password";
const HOUR = 60 * 60 * 1000;
const MINUTE = 60 * 1000;

interface SessionRow {
  id: number;
  userId: number;
  tokenHash: string;
  lastSeenAt: Date;
  revokedAt: Date | null;
}

/** In-memory stand-in for the database, so these tests run without Postgres. */
class InMemoryAuthRepository implements AuthRepository {
  readonly users: AuthUser[] = [];
  readonly sessions: SessionRow[] = [];

  findUserByEmail(email: string) {
    return Promise.resolve(
      this.users.find((user) => user.email.toLowerCase() === email) ?? null,
    );
  }

  findUserById(id: number) {
    return Promise.resolve(this.users.find((user) => user.id === id) ?? null);
  }

  createSession({ userId, tokenHash, now }: NewSession) {
    this.sessions.push({
      id: this.sessions.length + 1,
      userId,
      tokenHash,
      lastSeenAt: now,
      revokedAt: null,
    });
    return Promise.resolve();
  }

  async findSessionByTokenHash(tokenHash: string) {
    const session = this.sessions.find((row) => row.tokenHash === tokenHash);
    const user = session && (await this.findUserById(session.userId));
    if (!session || !user) return null;
    const stored: StoredSession = {
      id: session.id,
      lastSeenAt: session.lastSeenAt,
      revokedAt: session.revokedAt,
      user,
    };
    return stored;
  }

  touchSession(sessionId: number, now: Date) {
    const session = this.sessions.find((row) => row.id === sessionId);
    if (session) session.lastSeenAt = now;
    return Promise.resolve();
  }

  revokeSession(tokenHash: string, now: Date) {
    const session = this.sessions.find((row) => row.tokenHash === tokenHash);
    if (session) session.revokedAt = now;
    return Promise.resolve();
  }
}

let passwordHash = "";

beforeAll(async () => {
  passwordHash = await hashPassword(PASSWORD);
});

function setup({ logLevel = "silent" }: { logLevel?: "silent" | "info" } = {}) {
  const repository = new InMemoryAuthRepository();
  repository.users.push(
    {
      id: 1,
      name: "Test Manager",
      email: "user@x.com",
      role: "MANAGER",
      sellerCode: null,
      passwordHash,
    },
    {
      id: 2,
      name: "Test Seller",
      email: "seller@x.com",
      role: "SELLER",
      sellerCode: "MOCK-01",
      passwordHash,
    },
  );
  let current = new Date("2026-11-26T12:00:00Z");
  let logs = "";
  const logDestination = new Writable({
    write(chunk, _encoding, callback) {
      logs += chunk.toString();
      callback();
    },
  });
  const app = createApp({
    database: {} as Database,
    environment: { ...environment, LOG_LEVEL: logLevel },
    authRepository: repository,
    now: () => current,
    logDestination,
  });
  return {
    app,
    repository,
    advance: (milliseconds: number) => {
      current = new Date(current.getTime() + milliseconds);
      return current;
    },
    logs: () => logs,
  };
}

async function signIn(
  app: ReturnType<typeof setup>["app"],
  email = "user@x.com",
) {
  const response = await request(app)
    .post("/auth/login")
    .send({ email, password: PASSWORD })
    .expect(200);
  return response.body.token as string;
}

function withoutRequestId(body: Record<string, unknown>) {
  return Object.fromEntries(
    Object.entries(body).filter(([key]) => key !== "requestId"),
  );
}

describe("F01 / US-001 POST /auth/login", () => {
  it("returns a token and the user for valid credentials", async () => {
    const { app } = setup();

    const response = await request(app)
      .post("/auth/login")
      .send({ email: "user@x.com", password: PASSWORD })
      .expect(200);

    expect(response.body).toEqual({
      token: expect.any(String),
      user: {
        id: 1,
        name: "Test Manager",
        email: "user@x.com",
        role: "MANAGER",
      },
    });
    expect(response.body.token).not.toBe("");
    expect(JSON.stringify(response.body)).not.toContain(passwordHash);
  });

  it("matches the email case-insensitively and without surrounding spaces", async () => {
    const { app } = setup();

    const response = await request(app)
      .post("/auth/login")
      .send({ email: " USER@x.com ", password: PASSWORD })
      .expect(200);

    expect(response.body.user).toMatchObject({ id: 1, email: "user@x.com" });
  });

  it.each([
    ["a missing email", { password: PASSWORD }],
    ["a missing password", { email: "user@x.com" }],
    ["an invalid email", { email: "not-an-email", password: PASSWORD }],
  ])("responds 400 for %s", async (_case, body) => {
    const { app } = setup();

    const response = await request(app)
      .post("/auth/login")
      .send(body)
      .expect(400);

    expect(response.body).toMatchObject({ status: 400 });
  });

  it("answers an unknown email and a wrong password identically", async () => {
    const { app } = setup();

    const unknownEmail = await request(app)
      .post("/auth/login")
      .send({ email: "nobody@x.com", password: PASSWORD })
      .expect(401);
    const wrongPassword = await request(app)
      .post("/auth/login")
      .send({ email: "user@x.com", password: "wrong-password" })
      .expect(401);

    expect(unknownEmail.body).toMatchObject({
      status: 401,
      detail: "E-mail ou senha incorretos",
    });
    expect(withoutRequestId(wrongPassword.body)).toEqual(
      withoutRequestId(unknownEmail.body),
    );
  });

  it("responds 429 to the 11th attempt from one IP within a minute", async () => {
    const { app } = setup();
    const attempt = () =>
      request(app)
        .post("/auth/login")
        .send({ email: "user@x.com", password: "wrong-password" });

    for (let index = 0; index < 10; index += 1) {
      await attempt().expect(401);
    }
    const eleventh = await attempt().expect(429);

    expect(eleventh.body).toMatchObject({ status: 429 });
  });
});

describe("F01 / US-001 GET /auth/me", () => {
  it("returns the signed-in user for a valid token", async () => {
    const { app } = setup();
    const token = await signIn(app);

    const response = await request(app)
      .get("/auth/me")
      .set("Authorization", `Bearer ${token}`)
      .expect(200);

    expect(response.body).toEqual({
      id: 1,
      name: "Test Manager",
      email: "user@x.com",
      role: "MANAGER",
    });
  });

  it("responds 401 without a token", async () => {
    const { app } = setup();

    const response = await request(app).get("/auth/me").expect(401);

    expect(response.body).toMatchObject({ status: 401 });
  });

  it("responds 401 for a token that was never issued", async () => {
    const { app } = setup();
    await signIn(app);

    await request(app)
      .get("/auth/me")
      .set("Authorization", "Bearer never-issued-token")
      .expect(401);
  });
});

describe("F01 / US-001 POST /auth/logout", () => {
  it("revokes the session so the token then receives 401", async () => {
    const { app } = setup();
    const token = await signIn(app);

    await request(app)
      .post("/auth/logout")
      .set("Authorization", `Bearer ${token}`)
      .expect(204);
    await request(app)
      .get("/auth/me")
      .set("Authorization", `Bearer ${token}`)
      .expect(401);
  });

  it("responds 401 without a token", async () => {
    const { app } = setup();

    await request(app).post("/auth/logout").expect(401);
  });
});

describe("F01 / US-001 session expiry after 8 hours without use", () => {
  it("rejects a session last used 8 hours and 1 minute ago", async () => {
    const { app, advance } = setup();
    const token = await signIn(app);
    advance(8 * HOUR + MINUTE);

    await request(app)
      .get("/auth/me")
      .set("Authorization", `Bearer ${token}`)
      .expect(401);
  });

  it("accepts a session last used 7 hours and 59 minutes ago and updates its last use", async () => {
    const { app, advance, repository } = setup();
    const token = await signIn(app);
    const requestTime = advance(7 * HOUR + 59 * MINUTE);

    await request(app)
      .get("/auth/me")
      .set("Authorization", `Bearer ${token}`)
      .expect(200);

    expect(repository.sessions).toHaveLength(1);
    expect(repository.sessions[0]?.lastSeenAt).toEqual(requestTime);
  });
});

describe("F01 / US-001 / RN-14 sign-in secrets in logs", () => {
  it("never logs the password or the token", async () => {
    const { app, logs } = setup({ logLevel: "info" });
    const token = await signIn(app);
    await request(app)
      .get("/auth/me")
      .set("Authorization", `Bearer ${token}`)
      .expect(200);
    await new Promise((resolve) => setImmediate(resolve));

    expect(token).not.toBe("");
    expect(logs()).toContain("/auth/login");
    expect(logs()).not.toContain(PASSWORD);
    expect(logs()).not.toContain(token);
  });
});
