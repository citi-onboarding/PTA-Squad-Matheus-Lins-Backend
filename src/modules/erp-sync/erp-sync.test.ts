import { describe, expect, it, vi } from "vitest";

import type {
  ErpClient,
  ErpListing,
  ErpRejectedRecord,
} from "../../shared/erp/erp-client.js";
import {
  ErpRequestError,
  RateLimitedError,
} from "../../shared/erp/erp-errors.js";
import type {
  ErpCustomer,
  ErpProduct,
  ErpReceivable,
} from "../../shared/erp/erp-schemas.js";
import { toCustomer, toProduct, toReceivable } from "./erp-sync.mappers.js";
import type {
  CustomerRecord,
  ProductRecord,
  ReceivableRecord,
} from "./erp-sync.mappers.js";
import type {
  ErpSyncRepository,
  LastSuccessfulRun,
  RunOutcome,
  SyncEntity,
} from "./erp-sync.repository.js";
import { ErpSyncService } from "./erp-sync.service.js";
import type { SyncLogger } from "./erp-sync.service.js";

// ---------------------------------------------------------------------------
// ERP fixtures (Portuguese field names, as the ERP sends them)
// ---------------------------------------------------------------------------

function erpCustomer(
  codigo: string,
  overrides: Partial<ErpCustomer> = {},
): ErpCustomer {
  return {
    codigo,
    razaoSocial: `Customer ${codigo}`,
    cnpj: "23775684000107",
    cidade: "Recife",
    uf: "PE",
    segmento: "Construction",
    limiteCreditoCentavos: 5_000_000,
    vendedor: "V01",
    dataCadastro: "2021-12-20",
    status: "ATIVO",
    atualizadoEm: "2026-11-05T09:00:00-03:00",
    ...overrides,
  };
}

function erpProduct(
  codigo: string,
  overrides: Partial<ErpProduct> = {},
): ErpProduct {
  return {
    codigo,
    descricao: `Product ${codigo}`,
    categoria: "Cables",
    unidade: "UN",
    precoTabelaCentavos: 1_990,
    ativo: true,
    atualizadoEm: "2026-11-10T09:00:00-03:00",
    ...overrides,
  };
}

function erpReceivable(
  numero: number,
  overrides: Partial<ErpReceivable> = {},
): ErpReceivable {
  return {
    numero,
    cliente: "C0001",
    pedidoErp: 4_501,
    parcela: "1/3",
    valorCentavos: 150_000,
    emissao: "2026-10-05",
    vencimento: "2026-11-05",
    pagamento: null,
    status: "EM_ABERTO",
    atualizadoEm: "2026-11-05T09:00:00-03:00",
    ...overrides,
  };
}

function listing<T>(
  items: T[],
  rejected: ErpRejectedRecord[] = [],
): ErpListing<T> {
  return { items, rejected };
}

function rejectedRecord(key: string | number): ErpRejectedRecord {
  return {
    key,
    page: 1,
    issues: [{ path: "status", message: "Invalid option" }],
  };
}

// ---------------------------------------------------------------------------
// Portal fixtures (already stored records)
// ---------------------------------------------------------------------------

function storedCustomer(
  code: string,
  legalName = "Stored name",
): CustomerRecord {
  return {
    code,
    legalName,
    cnpj: "23775684000107",
    city: "Recife",
    state: "PE",
    segment: "Construction",
    creditLimitCents: 1_000,
    sellerCode: "V01",
    registeredAt: new Date("2021-12-20T03:00:00.000Z"),
    status: "ACTIVE",
    erpUpdatedAt: new Date("2026-01-01T12:00:00.000Z"),
  };
}

function storedProduct(code: string): ProductRecord {
  return {
    code,
    description: "Stored product",
    category: "Cables",
    unit: "UN",
    listPriceCents: 100,
    active: true,
    erpUpdatedAt: new Date("2026-01-01T12:00:00.000Z"),
  };
}

// ---------------------------------------------------------------------------
// Test doubles: an in-memory repository and a fake ERP client
// ---------------------------------------------------------------------------

interface StoredRun extends Partial<Omit<RunOutcome, "result">> {
  id: number;
  entity: SyncEntity;
  startedAt: Date;
  result: "RUNNING" | RunOutcome["result"];
}

class InMemoryErpSyncRepository implements ErpSyncRepository {
  readonly customers = new Map<string, CustomerRecord>();
  readonly products = new Map<string, ProductRecord>();
  readonly receivables = new Map<number, ReceivableRecord>();
  readonly runs: StoredRun[] = [];
  saveError: Error | undefined;

  startRun(entity: SyncEntity, startedAt: Date): Promise<number> {
    const id = this.runs.length + 1;
    this.runs.push({ id, entity, startedAt, result: "RUNNING" });
    return Promise.resolve(id);
  }

  finishRun(runId: number, outcome: RunOutcome): Promise<void> {
    const run = this.runs.find(({ id }) => id === runId);
    if (!run) throw new Error(`Unknown run ${runId}`);
    Object.assign(run, outcome);
    return Promise.resolve();
  }

  findLastSuccessfulRun(entity: SyncEntity): Promise<LastSuccessfulRun | null> {
    const run = this.runs
      .filter((candidate) => candidate.entity === entity)
      .filter((candidate) => candidate.result === "SUCCESS")
      .at(-1);
    return Promise.resolve(run ? { cursorAt: run.cursorAt ?? null } : null);
  }

  findMissingCustomerCodes(codes: string[]): Promise<string[]> {
    return Promise.resolve(codes.filter((code) => !this.customers.has(code)));
  }

  saveCustomers(customers: CustomerRecord[]): Promise<void> {
    if (this.saveError) return Promise.reject(this.saveError);
    for (const customer of customers)
      this.customers.set(customer.code, customer);
    return Promise.resolve();
  }

  saveProducts(products: ProductRecord[]): Promise<void> {
    if (this.saveError) return Promise.reject(this.saveError);
    for (const product of products) this.products.set(product.code, product);
    return Promise.resolve();
  }

  saveReceivables(receivables: ReceivableRecord[]): Promise<void> {
    if (this.saveError) return Promise.reject(this.saveError);
    for (const receivable of receivables)
      this.receivables.set(receivable.number, receivable);
    return Promise.resolve();
  }

  /** Records a finished run, as a previous synchronization would have. */
  seedRun(entity: SyncEntity, outcome: Partial<RunOutcome>): void {
    this.runs.push({
      id: this.runs.length + 1,
      entity,
      startedAt: new Date("2026-11-26T12:00:00.000Z"),
      result: "SUCCESS",
      ...outcome,
    });
  }

  lastRun(entity: SyncEntity): StoredRun | undefined {
    return this.runs.filter((run) => run.entity === entity).at(-1);
  }
}

function createFakeErp() {
  return {
    listCustomers: vi.fn<ErpClient["listCustomers"]>(() =>
      Promise.resolve(listing<ErpCustomer>([])),
    ),
    listProducts: vi.fn<ErpClient["listProducts"]>(() =>
      Promise.resolve(listing<ErpProduct>([])),
    ),
    listReceivables: vi.fn<ErpClient["listReceivables"]>(() =>
      Promise.resolve(listing<ErpReceivable>([])),
    ),
    getCustomer: vi.fn<ErpClient["getCustomer"]>(() =>
      Promise.resolve({ status: "not-found" }),
    ),
  };
}

const now = new Date("2026-11-26T13:00:00.000Z");
const fiveMinutes = 5 * 60_000;
const secret = "test-secret-key-123";

function setup() {
  const erp = createFakeErp();
  const repository = new InMemoryErpSyncRepository();
  const logger = {
    warn: vi.fn<SyncLogger["warn"]>(),
    error: vi.fn<SyncLogger["error"]>(),
  };
  const service = new ErpSyncService({
    erp,
    repository,
    clock: () => new Date(now),
    logger,
  });
  return { erp, repository, logger, service };
}

// ---------------------------------------------------------------------------
// Conversion
// ---------------------------------------------------------------------------

describe("F02 / US-002 ERP records converted to the portal model", () => {
  it("converts customer fields, status, and registration date", () => {
    expect(
      toCustomer(
        erpCustomer("C0001", {
          razaoSocial: "Eletro Recife",
          cnpj: "11222333000144",
          cidade: "Olinda",
          uf: "PE",
          segmento: "Retail",
          limiteCreditoCentavos: 5_000_000,
          vendedor: "V01",
          status: "BLOQUEADO",
          dataCadastro: "2021-12-20",
          atualizadoEm: "2026-11-05T09:00:00-03:00",
        }),
      ),
    ).toEqual({
      code: "C0001",
      legalName: "Eletro Recife",
      cnpj: "11222333000144",
      city: "Olinda",
      state: "PE",
      segment: "Retail",
      creditLimitCents: 5_000_000,
      sellerCode: "V01",
      registeredAt: new Date("2021-12-20T00:00:00-03:00"),
      status: "BLOCKED",
      erpUpdatedAt: new Date("2026-11-05T09:00:00-03:00"),
    });
  });

  it.each([
    ["ATIVO", "ACTIVE"],
    ["BLOQUEADO", "BLOCKED"],
    ["INATIVO", "INACTIVE"],
  ] as const)("converts customer status %s to %s", (status, expected) => {
    expect(toCustomer(erpCustomer("C0001", { status })).status).toBe(expected);
  });

  it("converts product fields", () => {
    expect(
      toProduct(
        erpProduct("P0001", {
          descricao: "Cable 2.5mm",
          categoria: "Cables",
          unidade: "M",
          precoTabelaCentavos: 1_990,
          ativo: false,
          atualizadoEm: "2026-11-10T09:00:00-03:00",
        }),
      ),
    ).toEqual({
      code: "P0001",
      description: "Cable 2.5mm",
      category: "Cables",
      unit: "M",
      listPriceCents: 1_990,
      active: false,
      erpUpdatedAt: new Date("2026-11-10T09:00:00-03:00"),
    });
  });

  it("converts an open receivable with its dates at midnight in Recife", () => {
    expect(
      toReceivable(
        erpReceivable(1001, {
          cliente: "C0001",
          pedidoErp: 4_501,
          parcela: "1/3",
          valorCentavos: 150_000,
          status: "EM_ABERTO",
          emissao: "2026-10-05",
          vencimento: "2026-11-05",
          pagamento: null,
          atualizadoEm: "2026-11-05T09:00:00-03:00",
        }),
      ),
    ).toEqual({
      number: 1001,
      customerCode: "C0001",
      erpOrderNumber: 4_501,
      installment: "1/3",
      amountCents: 150_000,
      issuedAt: new Date("2026-10-05T00:00:00-03:00"),
      dueAt: new Date("2026-11-05T00:00:00-03:00"),
      paidAt: null,
      status: "OPEN",
      source: "ERP",
      erpUpdatedAt: new Date("2026-11-05T09:00:00-03:00"),
    });
  });

  it("converts paid and overdue receivables", () => {
    const paid = toReceivable(
      erpReceivable(1002, { status: "PAGO", pagamento: "2026-11-10" }),
    );
    const overdue = toReceivable(erpReceivable(1003, { status: "VENCIDO" }));

    expect(paid).toMatchObject({
      status: "PAID",
      paidAt: new Date("2026-11-10T00:00:00-03:00"),
    });
    expect(overdue.status).toBe("OVERDUE");
  });
});

// ---------------------------------------------------------------------------
// Storage, run records, and incremental reads
// ---------------------------------------------------------------------------

describe("F02 / US-002 ERP synchronization runs (RN-09, RN-15)", () => {
  it("reads every customer on the first run and records a successful run", async () => {
    const { erp, repository, service } = setup();
    erp.listCustomers.mockResolvedValueOnce(
      listing([
        erpCustomer("C0001", { razaoSocial: "Eletro Recife" }),
        erpCustomer("C0002"),
      ]),
    );

    const result = await service.syncCustomers();

    expect(erp.listCustomers).toHaveBeenCalledTimes(1);
    expect(erp.listCustomers.mock.calls[0]?.[0]?.updatedSince).toBeUndefined();
    expect(repository.customers.get("C0001")?.legalName).toBe("Eletro Recife");
    expect(repository.customers.size).toBe(2);
    expect(repository.lastRun("customers")).toEqual({
      id: 1,
      entity: "customers",
      startedAt: now,
      result: "SUCCESS",
      finishedAt: now,
      itemsRead: 2,
      itemsRejected: 0,
      cursorAt: now,
      error: null,
    });
    expect(result).toEqual({
      entity: "customers",
      result: "SUCCESS",
      itemsRead: 2,
      itemsRejected: 0,
      error: null,
    });
  });

  it("reads only changes since the last starting point minus 5 minutes", async () => {
    const { erp, repository, service } = setup();
    const cursorAt = new Date("2026-11-26T13:00:00.000Z");
    repository.seedRun("products", { cursorAt });

    await service.syncProducts();

    const updatedSince = erp.listProducts.mock.calls[0]?.[0]?.updatedSince;
    expect(updatedSince).toMatch(/T.*(Z|[+-]\d{2}:\d{2})$/);
    expect(new Date(updatedSince ?? "").getTime()).toBe(
      cursorAt.getTime() - fiveMinutes,
    );
  });

  it("reads everything when the last successful run has no starting point", async () => {
    const { erp, repository, service } = setup();
    repository.seedRun("receivables", { cursorAt: null });

    await service.syncReceivables();

    expect(
      erp.listReceivables.mock.calls[0]?.[0]?.updatedSince,
    ).toBeUndefined();
  });

  it("keeps the starting point after a failed run", async () => {
    const { erp, repository, service } = setup();
    const cursorAt = new Date("2026-11-26T12:00:00.000Z");
    repository.seedRun("products", { cursorAt });
    erp.listProducts.mockRejectedValueOnce(
      new ErpRequestError({ kind: "http", status: 503 }),
    );

    await service.syncProducts();
    await service.syncProducts();

    const updatedSince = erp.listProducts.mock.calls[1]?.[0]?.updatedSince;
    expect(new Date(updatedSince ?? "").getTime()).toBe(
      cursorAt.getTime() - fiveMinutes,
    );
  });

  it("updates a stored record in place instead of adding one", async () => {
    const { erp, repository, service } = setup();
    repository.customers.set("C0001", storedCustomer("C0001"));
    erp.listCustomers.mockResolvedValueOnce(
      listing([erpCustomer("C0001", { limiteCreditoCentavos: 8_000_000 })]),
    );

    await service.syncCustomers();

    expect(repository.customers.size).toBe(1);
    expect(repository.customers.get("C0001")?.creditLimitCents).toBe(8_000_000);
  });

  it("keeps stored records the ERP does not return", async () => {
    const { erp, repository, service } = setup();
    repository.products.set("P0009", storedProduct("P0009"));
    erp.listProducts.mockResolvedValueOnce(listing([erpProduct("P0001")]));

    await service.syncProducts();

    expect(repository.products.get("P0009")).toEqual(storedProduct("P0009"));
    expect(repository.products.size).toBe(2);
  });

  it("records an ERP failure without touching stored data", async () => {
    const { erp, repository, service } = setup();
    repository.products.set("P0001", storedProduct("P0001"));
    erp.listProducts.mockRejectedValueOnce(
      new ErpRequestError({ kind: "http", status: 503 }),
    );

    const result = await service.syncProducts();

    expect(repository.products.get("P0001")).toEqual(storedProduct("P0001"));
    expect(repository.lastRun("products")).toMatchObject({
      result: "FAILURE",
      finishedAt: now,
      cursorAt: null,
      error: "erp error: http 503",
    });
    expect(result).toMatchObject({
      result: "FAILURE",
      error: "erp error: http 503",
    });
  });

  it.each([
    ["network", "erp error: network", new ErpRequestError({ kind: "network" })],
    ["timeout", "erp error: timeout", new ErpRequestError({ kind: "timeout" })],
    [
      "malformed page",
      "erp error: malformed",
      new ErpRequestError({ kind: "malformed" }),
    ],
    ["daily limit", "rate limited", new RateLimitedError(3_600)],
  ])("records an ERP %s failure as %j", async (_label, expected, failure) => {
    const { erp, repository, service } = setup();
    erp.listCustomers.mockRejectedValueOnce(failure);

    await service.syncCustomers();

    expect(repository.lastRun("customers")).toMatchObject({
      result: "FAILURE",
      error: expected,
    });
  });

  it("records a storage failure with a generic error that leaks nothing", async () => {
    const { erp, repository, service } = setup();
    repository.saveError = new Error(
      `insert failed: key=${secret} legalName=Eletro Recife`,
    );
    erp.listCustomers.mockResolvedValueOnce(
      listing([erpCustomer("C0001", { razaoSocial: "Eletro Recife" })]),
    );

    const result = await service.syncCustomers();

    expect(repository.lastRun("customers")).toMatchObject({
      result: "FAILURE",
      error: "internal error",
    });
    expect(JSON.stringify(repository.runs)).not.toContain(secret);
    expect(JSON.stringify(result)).not.toContain("Eletro Recife");
  });
});

// ---------------------------------------------------------------------------
// Internal failures
// ---------------------------------------------------------------------------

describe("F02 / US-002 internal failures are logged safely", () => {
  it("logs a storage failure with entity, error type, and code only", async () => {
    const { erp, repository, logger, service } = setup();
    repository.saveError = Object.assign(
      new Error(`Foreign key violated: key=${secret} legalName=Eletro Recife`),
      { name: "PrismaClientKnownRequestError", code: "P2003" },
    );
    erp.listCustomers.mockResolvedValueOnce(
      listing([erpCustomer("C0001", { razaoSocial: "Eletro Recife" })]),
    );

    await service.syncCustomers();

    expect(logger.error).toHaveBeenCalledTimes(1);
    expect(logger.error.mock.calls[0]?.[0]).toEqual({
      entity: "customers",
      errorType: "PrismaClientKnownRequestError",
      errorCode: "P2003",
    });
    const logged = JSON.stringify(logger.error.mock.calls);
    expect(logged).not.toContain("Eletro Recife");
    expect(logged).not.toContain("Foreign key violated");
    expect(logged).not.toContain(secret);
  });

  it("writes no internal-failure log for an ERP failure", async () => {
    const { erp, logger, service } = setup();
    erp.listProducts.mockRejectedValueOnce(
      new ErpRequestError({ kind: "http", status: 503 }),
    );

    await service.syncProducts();

    expect(logger.error).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Rejected records and the 10% rule
// ---------------------------------------------------------------------------

describe("F02 / US-002 rejected ERP records", () => {
  it("stores valid records, keeps the stored invalid one, and logs only its key", async () => {
    const { erp, repository, logger, service } = setup();
    repository.customers.set("C0003", storedCustomer("C0003", "Last good"));
    const valid = Array.from({ length: 19 }, (_, index) =>
      erpCustomer(`C1${String(index).padStart(3, "0")}`),
    );
    erp.listCustomers.mockResolvedValueOnce(
      listing(valid, [rejectedRecord("C0003")]),
    );

    await service.syncCustomers();

    expect(repository.customers.get("C0003")?.legalName).toBe("Last good");
    expect(repository.customers.size).toBe(20);
    expect(repository.lastRun("customers")).toMatchObject({
      result: "SUCCESS",
      itemsRead: 20,
      itemsRejected: 1,
    });
    expect(logger.warn).toHaveBeenCalledTimes(1);
    const [details] = logger.warn.mock.calls[0] ?? [];
    expect(details).toMatchObject({ entity: "customers", key: "C0003" });
    expect(JSON.stringify(details)).toContain("Invalid option");
    expect(JSON.stringify(logger.warn.mock.calls)).not.toContain("Last good");
  });

  it("succeeds with exactly 10% rejected", async () => {
    const { erp, repository, service } = setup();
    const valid = Array.from({ length: 9 }, (_, index) =>
      erpProduct(`P${index}`),
    );
    erp.listProducts.mockResolvedValueOnce(
      listing(valid, [rejectedRecord("P9")]),
    );

    await service.syncProducts();

    expect(repository.lastRun("products")).toMatchObject({
      result: "SUCCESS",
      itemsRead: 10,
      itemsRejected: 1,
    });
    expect(repository.products.size).toBe(9);
  });

  it("fails and stores nothing with more than 10% rejected", async () => {
    const { erp, repository, service } = setup();
    repository.products.set("P0", storedProduct("P0"));
    const valid = Array.from({ length: 8 }, (_, index) =>
      erpProduct(`P${index}`),
    );
    erp.listProducts.mockResolvedValueOnce(
      listing(valid, [rejectedRecord("P8"), rejectedRecord("P9")]),
    );

    await service.syncProducts();

    expect(repository.lastRun("products")).toMatchObject({
      result: "FAILURE",
      itemsRead: 10,
      itemsRejected: 2,
      error: "too many rejected records: 2/10",
    });
    expect([...repository.products.values()]).toEqual([storedProduct("P0")]);
  });

  it("succeeds when the ERP returns nothing", async () => {
    const { repository, service } = setup();

    await service.syncProducts();

    expect(repository.lastRun("products")).toMatchObject({
      result: "SUCCESS",
      itemsRead: 0,
      itemsRejected: 0,
    });
  });
});

// ---------------------------------------------------------------------------
// Missing customers of receivables
// ---------------------------------------------------------------------------

describe("F02 / US-002 missing customer of a receivable", () => {
  it("fetches a missing customer, stores it, and stores its receivable", async () => {
    const { erp, repository, service } = setup();
    erp.listReceivables.mockResolvedValueOnce(
      listing([erpReceivable(1001, { cliente: "C0050" })]),
    );
    erp.getCustomer.mockResolvedValueOnce({
      status: "found",
      customer: erpCustomer("C0050", { razaoSocial: "Fetched" }),
    });

    await service.syncReceivables();

    expect(erp.getCustomer).toHaveBeenCalledWith("C0050");
    expect(repository.customers.get("C0050")?.legalName).toBe("Fetched");
    expect(repository.receivables.get(1001)?.customerCode).toBe("C0050");
    expect(repository.lastRun("receivables")).toMatchObject({
      result: "SUCCESS",
      itemsRead: 1,
      itemsRejected: 0,
      cursorAt: now,
    });
  });

  it("looks up each missing customer once and never a stored one", async () => {
    const { erp, repository, service } = setup();
    repository.customers.set("C0001", storedCustomer("C0001"));
    erp.listReceivables.mockResolvedValueOnce(
      listing([
        erpReceivable(1001, { cliente: "C0050" }),
        erpReceivable(1002, { cliente: "C0050" }),
        erpReceivable(1003, { cliente: "C0050" }),
        erpReceivable(1004, { cliente: "C0001" }),
      ]),
    );
    erp.getCustomer.mockResolvedValue({
      status: "found",
      customer: erpCustomer("C0050"),
    });

    await service.syncReceivables();

    expect(erp.getCustomer).toHaveBeenCalledTimes(1);
    expect(erp.getCustomer).toHaveBeenCalledWith("C0050");
    expect(repository.receivables.size).toBe(4);
  });

  it.each([
    ["not-found", "customer not found"],
    ["invalid", "customer invalid"],
  ] as const)(
    "rejects a receivable whose customer is %s and keeps the previous starting point",
    async (status, reason) => {
      const { erp, repository, logger, service } = setup();
      const previousCursor = new Date("2026-11-25T10:00:00.000Z");
      repository.seedRun("receivables", { cursorAt: previousCursor });
      repository.customers.set("C0001", storedCustomer("C0001"));
      const valid = Array.from({ length: 9 }, (_, index) =>
        erpReceivable(2000 + index, { cliente: "C0001" }),
      );
      erp.listReceivables.mockResolvedValueOnce(
        listing([...valid, erpReceivable(1004, { cliente: "C0099" })]),
      );
      erp.getCustomer.mockResolvedValueOnce(
        status === "not-found"
          ? { status }
          : { status, issues: [{ path: "status", message: "Invalid option" }] },
      );

      await service.syncReceivables();

      expect(repository.receivables.has(1004)).toBe(false);
      expect(repository.receivables.size).toBe(9);
      expect(repository.customers.has("C0099")).toBe(false);
      expect(repository.lastRun("receivables")).toMatchObject({
        result: "SUCCESS",
        itemsRead: 10,
        itemsRejected: 1,
        cursorAt: previousCursor,
      });
      expect(JSON.stringify(logger.warn.mock.calls)).toContain(reason);
      expect(logger.warn.mock.calls[0]?.[0]).toMatchObject({
        entity: "receivables",
        key: 1004,
      });
    },
  );

  it("keeps no starting point when a first run rejects a receivable for its customer", async () => {
    const { erp, repository, service } = setup();
    repository.customers.set("C0001", storedCustomer("C0001"));
    const valid = Array.from({ length: 9 }, (_, index) =>
      erpReceivable(2000 + index, { cliente: "C0001" }),
    );
    erp.listReceivables.mockResolvedValueOnce(
      listing([...valid, erpReceivable(1004, { cliente: "C0099" })]),
    );

    await service.syncReceivables();

    expect(repository.lastRun("receivables")).toMatchObject({
      result: "SUCCESS",
      cursorAt: null,
    });
  });

  it("counts missing-customer rejections toward the 10% rule", async () => {
    const { erp, repository, service } = setup();
    repository.customers.set("C0001", storedCustomer("C0001"));
    const valid = Array.from({ length: 8 }, (_, index) =>
      erpReceivable(2000 + index, { cliente: "C0001" }),
    );
    erp.listReceivables.mockResolvedValueOnce(
      listing([
        ...valid,
        erpReceivable(1004, { cliente: "C0098" }),
        erpReceivable(1005, { cliente: "C0099" }),
      ]),
    );

    await service.syncReceivables();

    expect(repository.lastRun("receivables")).toMatchObject({
      result: "FAILURE",
      itemsRead: 10,
      itemsRejected: 2,
    });
    expect(repository.receivables.size).toBe(0);
  });

  it("fails the run and stores no receivable when a lookup keeps failing", async () => {
    const { erp, repository, service } = setup();
    erp.listReceivables.mockResolvedValueOnce(
      listing([erpReceivable(1001, { cliente: "C0050" })]),
    );
    erp.getCustomer.mockRejectedValueOnce(
      new ErpRequestError({ kind: "http", status: 503 }),
    );

    await service.syncReceivables();

    expect(repository.lastRun("receivables")).toMatchObject({
      result: "FAILURE",
      error: "erp error: http 503",
    });
    expect(repository.receivables.size).toBe(0);
  });

  it("stops looking up customers at the daily limit and keeps customers already fetched", async () => {
    const { erp, repository, service } = setup();
    erp.listReceivables.mockResolvedValueOnce(
      listing([
        erpReceivable(1001, { cliente: "C0050" }),
        erpReceivable(1002, { cliente: "C0051" }),
        erpReceivable(1003, { cliente: "C0052" }),
      ]),
    );
    erp.getCustomer
      .mockResolvedValueOnce({
        status: "found",
        customer: erpCustomer("C0050"),
      })
      .mockRejectedValueOnce(new RateLimitedError(3_600));

    await service.syncReceivables();

    expect(erp.getCustomer).toHaveBeenCalledTimes(2);
    expect(repository.customers.has("C0050")).toBe(true);
    expect(repository.receivables.size).toBe(0);
    expect(repository.lastRun("receivables")).toMatchObject({
      result: "FAILURE",
      error: "rate limited",
    });
  });

  it("overwrites a spreadsheet receivable with the ERP values", async () => {
    const { erp, repository, service } = setup();
    repository.customers.set("C0001", storedCustomer("C0001"));
    erp.listReceivables.mockResolvedValueOnce(
      listing([erpReceivable(2001, { valorCentavos: 99_900 })]),
    );

    await service.syncReceivables();

    expect(repository.receivables.get(2001)).toMatchObject({
      amountCents: 99_900,
      source: "ERP",
    });
  });
});

// ---------------------------------------------------------------------------
// Full synchronization
// ---------------------------------------------------------------------------

describe("F02 / US-002 synchronization order", () => {
  it("synchronizes customers, products, and receivables in that order", async () => {
    const { erp, service } = setup();
    const calls: string[] = [];
    erp.listCustomers.mockImplementation(() => {
      calls.push("customers");
      return Promise.resolve(listing<ErpCustomer>([]));
    });
    erp.listProducts.mockImplementation(() => {
      calls.push("products");
      return Promise.resolve(listing<ErpProduct>([]));
    });
    erp.listReceivables.mockImplementation(() => {
      calls.push("receivables");
      return Promise.resolve(listing<ErpReceivable>([]));
    });

    const results = await service.syncAll();

    expect(calls).toEqual(["customers", "products", "receivables"]);
    expect(results.map(({ entity, result }) => [entity, result])).toEqual([
      ["customers", "SUCCESS"],
      ["products", "SUCCESS"],
      ["receivables", "SUCCESS"],
    ]);
  });

  it("skips receivables when customers fail, but still runs products", async () => {
    const { erp, repository, service } = setup();
    erp.listCustomers.mockRejectedValueOnce(
      new ErpRequestError({ kind: "http", status: 503 }),
    );

    const results = await service.syncAll();

    expect(erp.listProducts).toHaveBeenCalledTimes(1);
    expect(erp.listReceivables).not.toHaveBeenCalled();
    expect(repository.lastRun("receivables")).toMatchObject({
      result: "FAILURE",
      finishedAt: now,
      error: "skipped: customers sync failed",
    });
    expect(results.map(({ entity, result }) => [entity, result])).toEqual([
      ["customers", "FAILURE"],
      ["products", "SUCCESS"],
      ["receivables", "FAILURE"],
    ]);
  });

  it("still runs receivables when products fail", async () => {
    const { erp, service } = setup();
    erp.listProducts.mockRejectedValueOnce(
      new ErpRequestError({ kind: "http", status: 503 }),
    );

    const results = await service.syncAll();

    expect(erp.listReceivables).toHaveBeenCalledTimes(1);
    expect(results.at(-1)).toMatchObject({
      entity: "receivables",
      result: "SUCCESS",
    });
  });
});
