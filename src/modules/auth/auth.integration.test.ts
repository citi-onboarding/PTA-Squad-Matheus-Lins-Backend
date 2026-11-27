import { execSync } from "node:child_process";
import { createHash } from "node:crypto";

import request from "supertest";
import { GenericContainer, Wait } from "testcontainers";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createApp } from "../../app/create-app.js";
import type { Environment } from "../../shared/config/env.js";
import { createDatabase } from "../../shared/database/create-database.js";
import type { Database } from "../../shared/database/create-database.js";
import { hashPassword, verifyPassword } from "./password.js";
import { seedInitialUsers } from "./seed-initial-users.js";

const INITIAL_PASSWORD = "initial-password-for-tests";

let container: Awaited<ReturnType<GenericContainer["start"]>> | undefined;
let database: Database | undefined;
let databaseUrl = "";

function testDatabase() {
  if (!database)
    throw new Error("The integration database was not initialized");
  return database;
}

function environment(): Environment {
  return {
    NODE_ENV: "test",
    SERVER_HOST: "0.0.0.0",
    SERVER_PORT: 3001,
    LOG_LEVEL: "silent",
    CORS_ORIGINS: "http://localhost:5173",
    DATABASE_URL: databaseUrl,
    ERP_BASE_URL: "https://pta-erp-api.onrender.com",
    ERP_API_KEY: "test-erp-key",
    TRUST_PROXY: 0,
    SYNC_INTERVAL_MINUTES: 60,
    SYNC_RETRY_MINUTES: 10,
    SYNC_ENABLED: false,
    corsOrigins: ["http://localhost:5173"],
  };
}

beforeAll(async () => {
  container = await new GenericContainer("postgres:17-alpine")
    .withEnvironment({
      POSTGRES_DB: "f01_test",
      POSTGRES_USER: "f01_test",
      POSTGRES_PASSWORD: "f01_test",
    })
    .withExposedPorts(5432)
    .withWaitStrategy(Wait.forHealthCheck())
    .withHealthCheck({
      test: ["CMD-SHELL", "pg_isready -h 127.0.0.1 -U f01_test -d f01_test"],
      interval: 1000,
      timeout: 3000,
      retries: 20,
      startPeriod: 1000,
    })
    .start();
  databaseUrl = `postgresql://f01_test:f01_test@${container.getHost()}:${container.getMappedPort(5432)}/f01_test`;

  // Run through a shell so Windows resolves pnpm.cmd.
  execSync("pnpm db:migrate:deploy", {
    env: { ...process.env, DATABASE_URL: databaseUrl },
    stdio: "inherit",
  });
  database = createDatabase(databaseUrl);
});

afterAll(async () => {
  await database?.$disconnect();
  await container?.stop();
});

describe("F01 / US-001 session storage", () => {
  it("stores only the SHA-256 hash of the session token", async () => {
    const db = testDatabase();
    await db.user.create({
      data: {
        name: "Token Owner",
        email: "token.owner@example.test",
        passwordHash: await hashPassword("owner-password"),
        role: "FINANCE",
      },
    });
    const app = createApp({ database: db, environment: environment() });

    const response = await request(app)
      .post("/auth/login")
      .send({ email: "token.owner@example.test", password: "owner-password" })
      .expect(200);
    const token: string = response.body.token;

    const sessions = await db.session.findMany({
      where: { user: { email: "token.owner@example.test" } },
    });
    expect(token).toEqual(expect.any(String));
    expect(sessions).toHaveLength(1);
    expect(sessions[0]?.tokenHash).toBe(
      createHash("sha256").update(token).digest("hex"),
    );
    expect(JSON.stringify(sessions)).not.toContain(token);
  });
});

/** Stores a customer as the ERP sync would, with only the seller relevant. */
async function storeCustomer(code: string, sellerCode: string) {
  const customer = {
    code,
    legalName: `Customer ${code}`,
    cnpj: "23775684000107",
    city: "Recife",
    state: "PE",
    segment: "Construction",
    creditLimitCents: 5_000_000,
    sellerCode,
    registeredAt: new Date("2021-12-20T03:00:00.000Z"),
    status: "ACTIVE" as const,
    erpUpdatedAt: new Date("2026-11-05T12:00:00.000Z"),
  };
  await testDatabase().customer.upsert({
    where: { code },
    create: customer,
    update: customer,
  });
}

describe("F01 / US-001 initial users seed", () => {
  it("fails without synced customers, says the sellers are missing, and creates no user", async () => {
    const db = testDatabase();
    await db.customer.deleteMany();
    const before = await db.user.count();

    const failure = seedInitialUsers(db, INITIAL_PASSWORD);

    await expect(failure).rejects.toThrow("No sellers to create");
    await expect(failure).rejects.toThrow("pnpm sync:erp");
    expect(await db.user.count()).toBe(before);
  });

  it("fails without SEED_DEFAULT_PASSWORD and creates no user", async () => {
    const db = testDatabase();
    const before = await db.user.count();

    await expect(seedInitialUsers(db, undefined)).rejects.toThrow(
      "SEED_DEFAULT_PASSWORD",
    );
    await expect(seedInitialUsers(db, "")).rejects.toThrow(
      "SEED_DEFAULT_PASSWORD",
    );
    expect(await db.user.count()).toBe(before);
  });

  it("creates one manager, finance, and admin user and one seller per customer seller", async () => {
    const db = testDatabase();
    await storeCustomer("C0001", "Patrícia Lins");
    await storeCustomer("C0002", "Patrícia Lins");
    await storeCustomer("C0003", "Marcos Viana");

    await seedInitialUsers(db, INITIAL_PASSWORD);

    const seeded = await db.user.findMany({
      where: { email: { endsWith: "@distrilux.test" } },
      orderBy: { email: "asc" },
    });
    const countByRole = (role: string) =>
      seeded.filter((user) => user.role === role).length;
    expect(countByRole("MANAGER")).toBe(1);
    expect(countByRole("FINANCE")).toBe(1);
    expect(countByRole("ADMIN")).toBe(1);
    expect(
      seeded
        .filter((user) => user.role === "SELLER")
        .map(({ name, sellerCode, email }) => ({ name, sellerCode, email })),
    ).toEqual([
      {
        name: "Marcos Viana",
        sellerCode: "Marcos Viana",
        email: "marcos.viana@distrilux.test",
      },
      {
        name: "Patrícia Lins",
        sellerCode: "Patrícia Lins",
        email: "patricia.lins@distrilux.test",
      },
    ]);
    expect(seeded.map((user) => user.name)).toEqual(
      expect.arrayContaining([
        "Fernanda Cavalcanti",
        "Sérgio Barros",
        "Lucas Moura",
      ]),
    );
    for (const user of seeded) {
      await expect(
        verifyPassword(INITIAL_PASSWORD, user.passwordHash),
      ).resolves.toBe(true);
    }
  });

  it("neither duplicates users nor changes a password when run again", async () => {
    const db = testDatabase();
    await storeCustomer("C0001", "Patrícia Lins");
    await seedInitialUsers(db, INITIAL_PASSWORD);
    const changedHash = await hashPassword("changed-by-the-user");
    await db.user.update({
      where: { email: "fernanda.cavalcanti@distrilux.test" },
      data: { passwordHash: changedHash },
    });
    const before = await db.user.count();

    await seedInitialUsers(db, "another-initial-password");

    expect(await db.user.count()).toBe(before);
    expect(
      await db.user.findUniqueOrThrow({
        where: { email: "fernanda.cavalcanti@distrilux.test" },
      }),
    ).toMatchObject({ passwordHash: changedHash });
  });

  it("adds the seller of a newly synced customer and keeps the other users", async () => {
    const db = testDatabase();
    await storeCustomer("C0001", "Patrícia Lins");
    await seedInitialUsers(db, INITIAL_PASSWORD);
    const before = await db.user.findMany({ orderBy: { id: "asc" } });

    await storeCustomer("C0004", "Rodrigo Albuquerque");
    await seedInitialUsers(db, INITIAL_PASSWORD);

    const after = await db.user.findMany({ orderBy: { id: "asc" } });
    expect(after).toHaveLength(before.length + 1);
    expect(after.slice(0, before.length)).toEqual(before);
    expect(after.at(-1)).toMatchObject({
      name: "Rodrigo Albuquerque",
      role: "SELLER",
      sellerCode: "Rodrigo Albuquerque",
      email: "rodrigo.albuquerque@distrilux.test",
    });
  });

  it("lets every seeded user sign in with the initial password", async () => {
    const db = testDatabase();
    await storeCustomer("C0001", "Patrícia Lins");
    await seedInitialUsers(db, INITIAL_PASSWORD);
    const app = createApp({ database: db, environment: environment() });

    for (const email of [
      "sergio.barros@distrilux.test",
      "lucas.moura@distrilux.test",
      "patricia.lins@distrilux.test",
    ]) {
      await request(app)
        .post("/auth/login")
        .send({ email, password: INITIAL_PASSWORD })
        .expect(200);
    }
  });
});
