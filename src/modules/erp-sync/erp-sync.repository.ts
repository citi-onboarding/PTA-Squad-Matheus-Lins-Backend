import type { Database } from "../../shared/database/create-database.js";
import type {
  CustomerRecord,
  ProductRecord,
  ReceivableRecord,
} from "./erp-sync.mappers.js";

export type SyncEntity = "customers" | "products" | "receivables";

export type RunResult = "SUCCESS" | "FAILURE";

export interface RunOutcome {
  result: RunResult;
  finishedAt: Date;
  itemsRead: number;
  itemsRejected: number;
  cursorAt: Date | null;
  error: string | null;
}

export interface LastSuccessfulRun {
  cursorAt: Date | null;
}

export interface ErpSyncRepository {
  startRun(entity: SyncEntity, startedAt: Date): Promise<number>;
  finishRun(runId: number, outcome: RunOutcome): Promise<void>;
  findLastSuccessfulRun(entity: SyncEntity): Promise<LastSuccessfulRun | null>;
  findMissingCustomerCodes(codes: string[]): Promise<string[]>;
  saveCustomers(customers: CustomerRecord[]): Promise<void>;
  saveProducts(products: ProductRecord[]): Promise<void>;
  saveReceivables(receivables: ReceivableRecord[]): Promise<void>;
}

export class PrismaErpSyncRepository implements ErpSyncRepository {
  constructor(private readonly database: Database) {}

  async startRun(entity: SyncEntity, startedAt: Date): Promise<number> {
    const run = await this.database.syncRun.create({
      data: { type: "ERP_SYNC", entity, startedAt },
    });
    return run.id;
  }

  async finishRun(runId: number, outcome: RunOutcome): Promise<void> {
    await this.database.syncRun.update({ where: { id: runId }, data: outcome });
  }

  findLastSuccessfulRun(entity: SyncEntity): Promise<LastSuccessfulRun | null> {
    return this.database.syncRun.findFirst({
      where: { type: "ERP_SYNC", entity, result: "SUCCESS" },
      orderBy: [{ startedAt: "desc" }, { id: "desc" }],
      select: { cursorAt: true },
    });
  }

  async findMissingCustomerCodes(codes: string[]): Promise<string[]> {
    const stored = await this.database.customer.findMany({
      where: { code: { in: codes } },
      select: { code: true },
    });
    const storedCodes = new Set(stored.map(({ code }) => code));
    return codes.filter((code) => !storedCodes.has(code));
  }

  async saveCustomers(customers: CustomerRecord[]): Promise<void> {
    await this.database.$transaction(
      customers.map((customer) =>
        this.database.customer.upsert({
          where: { code: customer.code },
          create: customer,
          update: customer,
        }),
      ),
    );
  }

  async saveProducts(products: ProductRecord[]): Promise<void> {
    await this.database.$transaction(
      products.map((product) =>
        this.database.product.upsert({
          where: { code: product.code },
          create: product,
          update: product,
        }),
      ),
    );
  }

  async saveReceivables(receivables: ReceivableRecord[]): Promise<void> {
    await this.database.$transaction(
      receivables.map((receivable) =>
        this.database.receivable.upsert({
          where: { number: receivable.number },
          create: receivable,
          update: receivable,
        }),
      ),
    );
  }
}
