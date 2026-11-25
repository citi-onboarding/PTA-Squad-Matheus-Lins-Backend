import { execFileSync } from "node:child_process";

import { Pool } from "pg";
import { GenericContainer, Wait } from "testcontainers";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createDatabase } from "./create-database.js";

type RecordData = Record<string, unknown>;

interface ModelDelegate {
  create(args: { data: RecordData }): Promise<RecordData>;
  findUniqueOrThrow(args: {
    where: RecordData;
    include?: Record<string, boolean>;
  }): Promise<RecordData>;
  findMany(args: { where: RecordData }): Promise<RecordData[]>;
  update(args: { where: RecordData; data: RecordData }): Promise<RecordData>;
}

let container: Awaited<ReturnType<GenericContainer["start"]>> | undefined;
let pool: Pool | undefined;
let database: ReturnType<typeof createDatabase> | undefined;

const fieldsByModel = {
  User: [
    "id:int4",
    "name:text",
    "email:text",
    "passwordHash:text",
    "role:Role",
    "sellerCode:text?",
    "createdAt:timestamp",
  ],
  Customer: [
    "id:int4",
    "code:text",
    "legalName:text",
    "cnpj:text",
    "city:text",
    "state:text",
    "segment:text",
    "creditLimitCents:int4",
    "sellerCode:text",
    "registeredAt:timestamp",
    "status:CustomerStatus",
    "erpUpdatedAt:timestamp",
    "syncedAt:timestamp",
  ],
  Product: [
    "id:int4",
    "code:text",
    "description:text",
    "category:text",
    "unit:text",
    "listPriceCents:int4",
    "active:bool",
    "erpUpdatedAt:timestamp",
    "syncedAt:timestamp",
  ],
  Receivable: [
    "id:int4",
    "number:int4",
    "customerCode:text",
    "erpOrderNumber:int4?",
    "installment:text",
    "amountCents:int4",
    "issuedAt:timestamp",
    "dueAt:timestamp",
    "paidAt:timestamp?",
    "status:ReceivableStatus",
    "source:ReceivableSource",
    "erpUpdatedAt:timestamp?",
    "syncedAt:timestamp",
  ],
  SyncRun: [
    "id:int4",
    "type:SyncRunType",
    "entity:text",
    "startedAt:timestamp",
    "finishedAt:timestamp?",
    "result:SyncRunResult",
    "itemsRead:int4",
    "error:text?",
  ],
};

const valuesByEnum = {
  Role: ["SELLER", "MANAGER", "FINANCE", "ADMIN"],
  CustomerStatus: ["ACTIVE", "BLOCKED", "INACTIVE"],
  ReceivableStatus: ["PAID", "OPEN", "OVERDUE"],
  ReceivableSource: ["ERP", "SPREADSHEET"],
  SyncRunType: ["ERP_SYNC", "HISTORY_LOAD"],
  SyncRunResult: ["RUNNING", "SUCCESS", "FAILURE"],
};

const erpUpdatedAt = new Date("2026-11-24T12:00:00Z");
const amountInCents = 123456;

function user(email: string) {
  return {
    name: "Test User",
    email,
    passwordHash: "test-hash",
    role: "SELLER",
  };
}

function customer(code: string, sellerCode = "seller-default") {
  return {
    code,
    legalName: "Test Customer",
    cnpj: "00123456000199",
    city: "Recife",
    state: "PE",
    segment: "Retail",
    creditLimitCents: amountInCents,
    sellerCode,
    registeredAt: new Date("2021-12-20T00:00:00Z"),
    status: "ACTIVE",
    erpUpdatedAt,
  };
}

function product(code: string) {
  return {
    code,
    description: "Test Product",
    category: "Electrical",
    unit: "EA",
    listPriceCents: amountInCents,
    active: true,
    erpUpdatedAt,
  };
}

function receivable(number: number, customerCode: string) {
  return {
    number,
    customerCode,
    installment: "1/3",
    amountCents: amountInCents,
    issuedAt: new Date("2026-11-20T00:00:00Z"),
    dueAt: new Date("2026-12-20T00:00:00Z"),
    status: "OPEN",
  };
}

function model(name: string): ModelDelegate {
  // The client generated during Red does not yet expose the F02 delegates.
  if (!database)
    throw new Error("The integration database was not initialized");
  const delegate: unknown = Reflect.get(database, name);
  expect(
    delegate,
    `Expected Prisma Client to expose the ${name} model`,
  ).toBeDefined();
  return delegate as ModelDelegate;
}

function catalog() {
  if (!pool) throw new Error("The integration database was not initialized");
  return pool;
}

beforeAll(async () => {
  let url = process.env.BASE_DATA_MODEL_TEST_DATABASE_URL;
  if (!url) {
    container = await new GenericContainer("postgres:17-alpine")
      .withEnvironment({
        POSTGRES_DB: "f02_test",
        POSTGRES_USER: "f02_test",
        POSTGRES_PASSWORD: "f02_test",
      })
      .withExposedPorts(5432)
      .withWaitStrategy(Wait.forHealthCheck())
      .withHealthCheck({
        test: ["CMD-SHELL", "pg_isready -h 127.0.0.1 -U f02_test -d f02_test"],
        interval: 1000,
        timeout: 3000,
        retries: 20,
        startPeriod: 1000,
      })
      .start();
    url = `postgresql://f02_test:f02_test@${container.getHost()}:${container.getMappedPort(5432)}/f02_test`;
  }

  pool = new Pool({ connectionString: url });
  const existingTables = await pool.query(
    "SELECT tablename FROM pg_tables WHERE schemaname = 'public'",
  );
  expect(
    existingTables.rows,
    "Use an empty, disposable PostgreSQL database",
  ).toEqual([]);

  execFileSync("pnpm", ["db:migrate:deploy"], {
    env: { ...process.env, DATABASE_URL: url },
    stdio: "inherit",
  });
  database = createDatabase(url);
});

afterAll(async () => {
  await database?.$disconnect();
  await pool?.end();
  await container?.stop();
});

describe("F02 / US-002 base data model", () => {
  it.each(Object.entries(fieldsByModel))(
    "deploys the %s model with its field types and nullability",
    async (name, fields) => {
      const { rows } = await catalog().query<{ field: string }>(
        `SELECT column_name || ':' || udt_name ||
                CASE WHEN is_nullable = 'YES' THEN '?' ELSE '' END AS field
           FROM information_schema.columns
          WHERE table_schema = 'public' AND table_name = $1`,
        [name],
      );

      expect(
        rows.map(({ field }) => field).sort(),
        `Deployed fields for ${name}`,
      ).toEqual([...fields].sort());

      const primaryKey = await catalog().query<{ column_name: string }>(
        `SELECT k.column_name
           FROM information_schema.table_constraints c
           JOIN information_schema.key_column_usage k
             ON k.constraint_schema = c.constraint_schema
            AND k.constraint_name = c.constraint_name
            AND k.table_name = c.table_name
          WHERE c.table_schema = 'public' AND c.table_name = $1
            AND c.constraint_type = 'PRIMARY KEY'`,
        [name],
      );
      expect(primaryKey.rows).toEqual([{ column_name: "id" }]);
    },
  );

  it.each(Object.entries(valuesByEnum))(
    "deploys the %s enum",
    async (name, values) => {
      const { rows } = await catalog().query<{ label: string }>(
        `SELECT e.enumlabel AS label
         FROM pg_enum e
         JOIN pg_type t ON t.oid = e.enumtypid
         JOIN pg_namespace n ON n.oid = t.typnamespace
        WHERE n.nspname = 'public' AND t.typname = $1`,
        [name],
      );

      expect(rows.map(({ label }) => label).sort()).toEqual([...values].sort());
    },
  );

  it.each([
    ["Customer", "sellerCode"],
    ["Receivable", "customerCode"],
  ])(
    "indexes %s.%s for portfolio and relationship lookups (RN-08, RN-09)",
    async (table, column) => {
      const { rows } = await catalog().query<{ indexed: boolean }>(
        `SELECT EXISTS (
         SELECT 1 FROM pg_index i
         JOIN pg_class t ON t.oid = i.indrelid
         JOIN pg_namespace n ON n.oid = t.relnamespace
         JOIN pg_attribute a ON a.attrelid = t.oid AND a.attnum = i.indkey[0]
         WHERE n.nspname = 'public' AND t.relname = $1 AND a.attname = $2
           AND i.indisvalid AND i.indpred IS NULL AND i.indnkeyatts = 1
       ) AS indexed`,
        [table, column],
      );

      expect(rows).toEqual([{ indexed: true }]);
    },
  );

  it("persists accounts and matches the optional seller portfolio code (RN-08)", async () => {
    const accounts = model("user");
    const seller = {
      ...user("seller@example.test"),
      sellerCode: "seller-portfolio",
    };
    const manager = { ...user("manager@example.test"), role: "MANAGER" };
    const assignedCustomer = customer("C-PORTFOLIO", seller.sellerCode);
    await model("customer").create({ data: assignedCustomer });
    await accounts.create({ data: seller });
    await accounts.create({ data: manager });

    const storedSeller = await accounts.findUniqueOrThrow({
      where: { email: seller.email },
    });
    expect(storedSeller).toEqual({
      ...seller,
      id: expect.any(Number),
      createdAt: expect.any(Date),
    });
    expect(
      await accounts.findUniqueOrThrow({ where: { email: manager.email } }),
    ).toMatchObject({
      ...manager,
      sellerCode: null,
    });
    expect(
      await model("customer").findMany({
        where: { sellerCode: storedSeller.sellerCode },
      }),
    ).toEqual([expect.objectContaining(assignedCustomer)]);
  });

  it.each([
    { name: "user", field: "email", data: user("unique@example.test") },
    { name: "customer", field: "code", data: customer("C-UNIQUE") },
    { name: "product", field: "code", data: product("P-UNIQUE") },
  ])(
    "rejects a duplicate $field on $name (RN-08, RN-09)",
    async ({ name, field, data }) => {
      const delegate = model(name);
      const original = await delegate.create({ data });
      await expect(delegate.create({ data })).rejects.toMatchObject({
        code: "P2002",
      });
      expect(
        await delegate.findUniqueOrThrow({
          where: { [field]: original[field] },
        }),
      ).toEqual(original);
    },
  );

  it("retains distinct installments for a customer and rejects a repeated title number (RN-09, RN-16)", async () => {
    const customers = model("customer");
    const receivables = model("receivable");
    const customerCode = "C-INSTALLMENTS";
    await customers.create({ data: customer(customerCode) });
    const first = { ...receivable(1001, customerCode), erpOrderNumber: 100 };
    const second = { ...first, number: 1002, installment: "2/3" };
    const storedFirst = await receivables.create({ data: first });
    await receivables.create({ data: second });
    await expect(
      receivables.create({ data: { ...first, installment: "3/3" } }),
    ).rejects.toMatchObject({ code: "P2002" });

    expect(storedFirst).toMatchObject({
      id: expect.any(Number),
      source: "ERP",
    });
    expect(
      await receivables.findUniqueOrThrow({ where: { number: first.number } }),
    ).toEqual(storedFirst);
    expect(
      await customers.findUniqueOrThrow({
        where: { code: customerCode },
        include: { receivables: true },
      }),
    ).toMatchObject({
      receivables: expect.arrayContaining([
        expect.objectContaining(first),
        expect.objectContaining(second),
      ]),
    });
  });

  it("rejects a receivable for an unknown customer (RN-09)", async () => {
    await expect(
      model("receivable").create({ data: receivable(1010, "C-UNKNOWN") }),
    ).rejects.toMatchObject({ code: "P2003" });
  });

  it("round-trips integer cents and updates portal timestamps independently of ERP timestamps (RN-13, RN-15, RN-16)", async () => {
    const customers = model("customer");
    const products = model("product");
    const receivables = model("receivable");
    const customerCode = "C-FRESHNESS";
    const productCode = "P-FRESHNESS";
    const number = 1020;
    const previousWrite = new Date("2000-01-01T00:00:00Z");

    const storedCustomer = await customers.create({
      data: { ...customer(customerCode), syncedAt: previousWrite },
    });
    const storedProduct = await products.create({
      data: { ...product(productCode), syncedAt: previousWrite },
    });
    const storedReceivable = await receivables.create({
      data: {
        ...receivable(number, customerCode),
        syncedAt: previousWrite,
        source: "SPREADSHEET",
      },
    });

    expect(storedCustomer).toMatchObject({
      id: expect.any(Number),
      creditLimitCents: amountInCents,
    });
    expect(storedProduct).toMatchObject({
      id: expect.any(Number),
      listPriceCents: amountInCents,
    });
    expect(storedReceivable).toMatchObject({
      amountCents: amountInCents,
      source: "SPREADSHEET",
      erpOrderNumber: null,
      paidAt: null,
      erpUpdatedAt: null,
    });

    const changes = [
      {
        delegate: customers,
        where: { code: customerCode },
        data: { city: "Olinda" },
        original: storedCustomer,
      },
      {
        delegate: products,
        where: { code: productCode },
        data: { active: false },
        original: storedProduct,
      },
      {
        delegate: receivables,
        where: { number },
        data: { status: "OVERDUE" },
        original: storedReceivable,
      },
    ];
    for (const { delegate, where, data, original } of changes) {
      await delegate.update({ where, data });
      const updated = await delegate.findUniqueOrThrow({ where });
      expect(updated).toMatchObject({
        ...original,
        ...data,
        syncedAt: expect.any(Date),
      });
      expect(updated.syncedAt).toBeInstanceOf(Date);
      expect((updated.syncedAt as Date).getTime()).toBeGreaterThan(
        previousWrite.getTime(),
      );
    }
  });

  it("defaults a new run and retains its terminal result (RN-14, RN-15, RN-16)", async () => {
    const runs = model("syncRun");
    const run = await runs.create({
      data: { type: "ERP_SYNC", entity: "receivables" },
    });
    expect(run).toMatchObject({
      id: expect.any(Number),
      startedAt: expect.any(Date),
      result: "RUNNING",
      itemsRead: 0,
      finishedAt: null,
      error: null,
    });
    const where = { id: run.id };
    const outcome = {
      result: "FAILURE",
      itemsRead: 2,
      finishedAt: new Date(),
      error: "ERP unavailable",
    };
    await runs.update({ where, data: outcome });
    expect(await runs.findUniqueOrThrow({ where })).toEqual({
      ...run,
      ...outcome,
    });
  });
});
