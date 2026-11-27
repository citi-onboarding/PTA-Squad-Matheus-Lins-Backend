import { execSync } from "node:child_process";

import { GenericContainer, Wait } from "testcontainers";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createDatabase } from "../../shared/database/create-database.js";
import type { Database } from "../../shared/database/create-database.js";
import type {
  CustomerRecord,
  ProductRecord,
  ReceivableRecord,
} from "./erp-sync.mappers.js";
import { PrismaErpSyncRepository } from "./erp-sync.repository.js";

let container: Awaited<ReturnType<GenericContainer["start"]>> | undefined;
let database: Database | undefined;

function testDatabase(): Database {
  if (!database)
    throw new Error("The integration database was not initialized");
  return database;
}

function repository(): PrismaErpSyncRepository {
  return new PrismaErpSyncRepository(testDatabase());
}

function customer(
  code: string,
  overrides: Partial<CustomerRecord> = {},
): CustomerRecord {
  return {
    code,
    legalName: `Customer ${code}`,
    cnpj: "23775684000107",
    city: "Recife",
    state: "PE",
    segment: "Construction",
    creditLimitCents: 5_000_000,
    sellerCode: "V01",
    registeredAt: new Date("2021-12-20T00:00:00-03:00"),
    status: "ACTIVE",
    erpUpdatedAt: new Date("2026-11-05T09:00:00-03:00"),
    ...overrides,
  };
}

function product(
  code: string,
  overrides: Partial<ProductRecord> = {},
): ProductRecord {
  return {
    code,
    description: `Product ${code}`,
    category: "Cables",
    unit: "UN",
    listPriceCents: 1_990,
    active: true,
    erpUpdatedAt: new Date("2026-11-10T09:00:00-03:00"),
    ...overrides,
  };
}

function receivable(
  number: number,
  customerCode: string,
  overrides: Partial<ReceivableRecord> = {},
): ReceivableRecord {
  return {
    number,
    customerCode,
    erpOrderNumber: 4_501,
    installment: "1/3",
    amountCents: 150_000,
    issuedAt: new Date("2026-10-05T00:00:00-03:00"),
    dueAt: new Date("2026-11-05T00:00:00-03:00"),
    paidAt: null,
    status: "OPEN",
    source: "ERP",
    erpUpdatedAt: new Date("2026-11-05T09:00:00-03:00"),
    ...overrides,
  };
}

beforeAll(async () => {
  let url = process.env.ERP_SYNC_TEST_DATABASE_URL;
  if (!url) {
    container = await new GenericContainer("postgres:17-alpine")
      .withEnvironment({
        POSTGRES_DB: "erp_sync_test",
        POSTGRES_USER: "erp_sync_test",
        POSTGRES_PASSWORD: "erp_sync_test",
      })
      .withExposedPorts(5432)
      .withWaitStrategy(Wait.forHealthCheck())
      .withHealthCheck({
        test: [
          "CMD-SHELL",
          "pg_isready -h 127.0.0.1 -U erp_sync_test -d erp_sync_test",
        ],
        interval: 1000,
        timeout: 3000,
        retries: 20,
        startPeriod: 1000,
      })
      .start();
    url = `postgresql://erp_sync_test:erp_sync_test@${container.getHost()}:${container.getMappedPort(5432)}/erp_sync_test`;
  }

  // Run through a shell so Windows resolves pnpm.cmd.
  execSync("pnpm db:migrate:deploy", {
    env: { ...process.env, DATABASE_URL: url },
    stdio: "inherit",
  });
  database = createDatabase(url);
});

afterAll(async () => {
  await database?.$disconnect();
  await container?.stop();
});

describe("F02 / US-002 ERP sync repository against PostgreSQL (RN-09)", () => {
  it("stores customers by code without duplicates and updates them in place", async () => {
    await repository().saveCustomers([
      customer("C-DUP-1"),
      customer("C-DUP-2"),
    ]);
    await repository().saveCustomers([
      customer("C-DUP-1", { creditLimitCents: 8_000_000 }),
      customer("C-DUP-2"),
    ]);

    const stored = await testDatabase().customer.findMany({
      where: { code: { startsWith: "C-DUP-" } },
      orderBy: { code: "asc" },
    });
    expect(stored).toHaveLength(2);
    expect(stored[0]).toMatchObject({
      ...customer("C-DUP-1", { creditLimitCents: 8_000_000 }),
      syncedAt: expect.any(Date),
    });
  });

  it("stores products by code and keeps products absent from a later save", async () => {
    await repository().saveProducts([product("P-KEEP-1"), product("P-KEEP-2")]);
    await repository().saveProducts([product("P-KEEP-1", { active: false })]);

    const stored = await testDatabase().product.findMany({
      where: { code: { startsWith: "P-KEEP-" } },
      orderBy: { code: "asc" },
    });
    expect(stored.map(({ code, active }) => [code, active])).toEqual([
      ["P-KEEP-1", false],
      ["P-KEEP-2", true],
    ]);
  });

  it("overwrites a spreadsheet receivable with the ERP values and source", async () => {
    await repository().saveCustomers([customer("C-SHEET")]);
    await testDatabase().receivable.create({
      data: {
        number: 7_001,
        customerCode: "C-SHEET",
        installment: "1/1",
        amountCents: 1,
        issuedAt: new Date("2026-01-01T00:00:00-03:00"),
        dueAt: new Date("2026-02-01T00:00:00-03:00"),
        status: "OVERDUE",
        source: "SPREADSHEET",
      },
    });

    await repository().saveReceivables([
      receivable(7_001, "C-SHEET", { amountCents: 99_900 }),
    ]);

    expect(
      await testDatabase().receivable.findUniqueOrThrow({
        where: { number: 7_001 },
      }),
    ).toMatchObject({
      ...receivable(7_001, "C-SHEET", { amountCents: 99_900 }),
      source: "ERP",
    });
    expect(
      await testDatabase().receivable.count({ where: { number: 7_001 } }),
    ).toBe(1);
  });

  it("stores none of a batch when one record fails", async () => {
    await repository().saveCustomers([customer("C-TX")]);

    await expect(
      repository().saveReceivables([
        receivable(7_101, "C-TX"),
        receivable(7_102, "C-TX-UNKNOWN"),
      ]),
    ).rejects.toThrow();

    expect(
      await testDatabase().receivable.count({
        where: { number: { in: [7_101, 7_102] } },
      }),
    ).toBe(0);
  });

  it("records a run from start to finish with its counts and starting point", async () => {
    const startedAt = new Date("2026-11-26T13:00:00.000Z");
    const runId = await repository().startRun("products", startedAt);

    expect(
      await testDatabase().syncRun.findUniqueOrThrow({ where: { id: runId } }),
    ).toMatchObject({
      type: "ERP_SYNC",
      entity: "products",
      startedAt,
      result: "RUNNING",
      finishedAt: null,
      itemsRejected: 0,
      cursorAt: null,
    });

    const outcome = {
      result: "SUCCESS" as const,
      finishedAt: new Date("2026-11-26T13:01:00.000Z"),
      itemsRead: 60,
      itemsRejected: 2,
      cursorAt: startedAt,
      error: null,
    };
    await repository().finishRun(runId, outcome);

    expect(
      await testDatabase().syncRun.findUniqueOrThrow({ where: { id: runId } }),
    ).toMatchObject(outcome);
  });

  it("finds the latest successful run of an entity only", async () => {
    const runs = repository();
    expect(await runs.findLastSuccessfulRun("customers")).toBeNull();

    const older = await runs.startRun(
      "customers",
      new Date("2026-11-20T10:00:00.000Z"),
    );
    await runs.finishRun(older, {
      result: "SUCCESS",
      finishedAt: new Date("2026-11-20T10:01:00.000Z"),
      itemsRead: 1,
      itemsRejected: 0,
      cursorAt: new Date("2026-11-20T10:00:00.000Z"),
      error: null,
    });
    const latest = await runs.startRun(
      "customers",
      new Date("2026-11-21T10:00:00.000Z"),
    );
    await runs.finishRun(latest, {
      result: "SUCCESS",
      finishedAt: new Date("2026-11-21T10:01:00.000Z"),
      itemsRead: 1,
      itemsRejected: 0,
      cursorAt: new Date("2026-11-21T10:00:00.000Z"),
      error: null,
    });
    const failed = await runs.startRun(
      "customers",
      new Date("2026-11-22T10:00:00.000Z"),
    );
    await runs.finishRun(failed, {
      result: "FAILURE",
      finishedAt: new Date("2026-11-22T10:01:00.000Z"),
      itemsRead: 0,
      itemsRejected: 0,
      cursorAt: null,
      error: "erp error: http 503",
    });
    await runs.startRun("customers", new Date("2026-11-23T10:00:00.000Z"));

    expect(await runs.findLastSuccessfulRun("customers")).toEqual({
      cursorAt: new Date("2026-11-21T10:00:00.000Z"),
      finishedAt: new Date("2026-11-21T10:01:00.000Z"),
    });
    expect(await runs.findLastSuccessfulRun("receivables")).toBeNull();
  });

  it("returns the customer codes that are not stored", async () => {
    await repository().saveCustomers([customer("C-MISS-1")]);

    expect(
      (
        await repository().findMissingCustomerCodes([
          "C-MISS-1",
          "C-MISS-2",
          "C-MISS-3",
        ])
      ).sort(),
    ).toEqual(["C-MISS-2", "C-MISS-3"]);
    expect(await repository().findMissingCustomerCodes([])).toEqual([]);
  });
});

describe("F02 / US-002 run lock and status against PostgreSQL (RN-15)", () => {
  const success = {
    result: "SUCCESS" as const,
    itemsRead: 1,
    itemsRejected: 0,
    cursorAt: null,
    error: null,
  };

  it("finds the newest run of an entity, whatever its result", async () => {
    await testDatabase().syncRun.deleteMany();
    const runs = repository();
    const finished = await runs.startRun(
      "products",
      new Date("2026-11-27T10:00:00.000Z"),
    );
    await runs.finishRun(finished, {
      ...success,
      finishedAt: new Date("2026-11-27T10:01:00.000Z"),
    });
    await runs.startRun("products", new Date("2026-11-27T11:00:00.000Z"));

    expect(await runs.findLastAttemptByEntity("products")).toEqual({
      startedAt: new Date("2026-11-27T11:00:00.000Z"),
      result: "RUNNING",
    });
    expect(await runs.findLastAttemptByEntity("receivables")).toBeNull();
  });

  it("finds the newest run still in progress, of any entity", async () => {
    await testDatabase().syncRun.deleteMany();
    const runs = repository();
    expect(await runs.findRunningRun()).toBeNull();

    const finished = await runs.startRun(
      "customers",
      new Date("2026-11-27T10:00:00.000Z"),
    );
    await runs.finishRun(finished, {
      ...success,
      finishedAt: new Date("2026-11-27T10:01:00.000Z"),
    });
    expect(await runs.findRunningRun()).toBeNull();

    await runs.startRun("receivables", new Date("2026-11-27T12:00:00.000Z"));
    expect(await runs.findRunningRun()).toEqual({
      entity: "receivables",
      startedAt: new Date("2026-11-27T12:00:00.000Z"),
    });
  });

  it("ends only the runs in progress since the cutoff as stale runs", async () => {
    await testDatabase().syncRun.deleteMany();
    const runs = repository();
    const now = new Date("2026-11-27T12:00:00.000Z");
    const cutoff = new Date("2026-11-27T11:30:00.000Z");
    const old = await runs.startRun(
      "customers",
      new Date("2026-11-27T11:00:00.000Z"),
    );
    const atCutoff = await runs.startRun("products", cutoff);
    const young = await runs.startRun(
      "receivables",
      new Date("2026-11-27T11:45:00.000Z"),
    );
    const done = await runs.startRun(
      "customers",
      new Date("2026-11-27T10:00:00.000Z"),
    );
    await runs.finishRun(done, {
      ...success,
      finishedAt: new Date("2026-11-27T10:01:00.000Z"),
    });

    expect(await runs.markStaleRuns(cutoff, now)).toBe(2);

    const byId = async (id: number) =>
      testDatabase().syncRun.findUniqueOrThrow({ where: { id } });
    for (const id of [old, atCutoff]) {
      expect(await byId(id)).toMatchObject({
        result: "FAILURE",
        error: "stale run",
        finishedAt: now,
      });
    }
    expect(await byId(young)).toMatchObject({
      result: "RUNNING",
      finishedAt: null,
    });
    expect(await byId(done)).toMatchObject({ result: "SUCCESS", error: null });
  });
});
