import type {
  ErpClient,
  ErpListOptions,
  ErpListing,
  ErpRejectedRecord,
} from "../../shared/erp/erp-client.js";
import {
  ErpRequestError,
  RateLimitedError,
} from "../../shared/erp/erp-errors.js";
import type { ErpReceivable } from "../../shared/erp/erp-schemas.js";
import { toCustomer, toProduct, toReceivable } from "./erp-sync.mappers.js";
import type {
  ErpSyncRepository,
  RunResult,
  SyncEntity,
} from "./erp-sync.repository.js";

/** The only log calls the service makes; pino's logger satisfies it. */
export interface SyncLogger {
  warn(details: Record<string, unknown>, message: string): void;
  error(details: Record<string, unknown>, message: string): void;
}

export interface ErpSyncDependencies {
  erp: ErpClient;
  repository: ErpSyncRepository;
  clock: () => Date;
  logger: SyncLogger;
}

export interface EntitySyncResult {
  entity: SyncEntity;
  result: RunResult;
  itemsRead: number;
  itemsRejected: number;
  error: string | null;
}

/** What reading one entity produced, before anything is written. */
interface EntityReadOutcome {
  itemsRead: number;
  itemsRejected: number;
  save: () => Promise<void>;
  /** True when a record must be read again, so the starting point stays. */
  keepCursor: boolean;
}

/** Why a receivable is rejected because of its customer. */
type CustomerRejection = "customer not found" | "customer invalid";

const MARGIN_MILLISECONDS = 5 * 60_000;
const SKIPPED_RECEIVABLES = "skipped: customers sync failed";
const INTERNAL_ERROR = "internal error";

/** Maps any failure to a fixed, short message; never a raw error message. */
function describeFailure(error: unknown): string {
  if (error instanceof RateLimitedError) return "rate limited";
  if (error instanceof ErpRequestError) {
    return error.kind === "http"
      ? `erp error: http ${String(error.status)}`
      : `erp error: ${error.kind}`;
  }
  return INTERNAL_ERROR;
}

/** Starting point for the next read: the last successful cursor minus a clock-skew margin. */
function listOptionsSince(cursorAt: Date | null): ErpListOptions {
  if (cursorAt === null) return {};
  return {
    updatedSince: new Date(
      cursorAt.getTime() - MARGIN_MILLISECONDS,
    ).toISOString(),
  };
}

export class ErpSyncService {
  constructor(private readonly dependencies: ErpSyncDependencies) {}

  syncCustomers(): Promise<EntitySyncResult> {
    return this.runEntity("customers", async (options) =>
      this.storeListing(
        "customers",
        await this.dependencies.erp.listCustomers(options),
        (items) =>
          this.dependencies.repository.saveCustomers(items.map(toCustomer)),
      ),
    );
  }

  syncProducts(): Promise<EntitySyncResult> {
    return this.runEntity("products", async (options) =>
      this.storeListing(
        "products",
        await this.dependencies.erp.listProducts(options),
        (items) =>
          this.dependencies.repository.saveProducts(items.map(toProduct)),
      ),
    );
  }

  syncReceivables(): Promise<EntitySyncResult> {
    return this.runEntity("receivables", async (options) => {
      const listing = await this.dependencies.erp.listReceivables(options);
      this.logRejected("receivables", listing.rejected);

      const rejections = await this.resolveMissingCustomers(listing.items);
      const accepted = this.splitByCustomer(listing.items, rejections);

      return {
        itemsRead: listing.items.length + listing.rejected.length,
        itemsRejected:
          listing.rejected.length + listing.items.length - accepted.length,
        save: () =>
          this.dependencies.repository.saveReceivables(
            accepted.map(toReceivable),
          ),
        keepCursor: rejections.size > 0,
      };
    });
  }

  async syncAll(): Promise<EntitySyncResult[]> {
    const customers = await this.syncCustomers();
    const products = await this.syncProducts();
    const receivables =
      customers.result === "SUCCESS"
        ? await this.syncReceivables()
        : await this.recordSkippedRun("receivables", SKIPPED_RECEIVABLES);
    return [customers, products, receivables];
  }

  /** Runs one entity from `RUNNING` to `SUCCESS` or `FAILURE`; never throws a sync failure. */
  private async runEntity(
    entity: SyncEntity,
    read: (options: ErpListOptions) => Promise<EntityReadOutcome>,
  ): Promise<EntitySyncResult> {
    const { repository, clock } = this.dependencies;
    const startedAt = clock();
    const runId = await repository.startRun(entity, startedAt);
    const lastSuccess = await repository.findLastSuccessfulRun(entity);
    const previousCursor = lastSuccess?.cursorAt ?? null;

    let itemsRead = 0;
    let itemsRejected = 0;
    let error: string | null = null;
    let cursorAt: Date | null = null;
    try {
      const outcome = await read(listOptionsSince(previousCursor));
      itemsRead = outcome.itemsRead;
      itemsRejected = outcome.itemsRejected;
      if (itemsRejected * 10 > itemsRead) {
        error = `too many rejected records: ${String(itemsRejected)}/${String(itemsRead)}`;
      } else {
        await outcome.save();
        cursorAt = outcome.keepCursor ? previousCursor : startedAt;
      }
    } catch (failure) {
      error = describeFailure(failure);
      if (error === INTERNAL_ERROR) this.logInternalFailure(entity, failure);
    }

    const result: RunResult = error === null ? "SUCCESS" : "FAILURE";
    await repository.finishRun(runId, {
      result,
      finishedAt: clock(),
      itemsRead,
      itemsRejected,
      cursorAt,
      error,
    });
    return { entity, result, itemsRead, itemsRejected, error };
  }

  /** Read outcome for a listing whose valid records are all stored as they are. */
  private storeListing<T>(
    entity: SyncEntity,
    listing: ErpListing<T>,
    save: (items: T[]) => Promise<void>,
  ): EntityReadOutcome {
    this.logRejected(entity, listing.rejected);
    return {
      itemsRead: listing.items.length + listing.rejected.length,
      itemsRejected: listing.rejected.length,
      save: () => save(listing.items),
      keepCursor: false,
    };
  }

  /**
   * Looks up, once per code, each customer of these receivables that is not
   * stored; stores the ones the ERP returns valid and reports the others. A
   * lookup failure propagates, so no receivable of the run is stored.
   */
  private async resolveMissingCustomers(
    receivables: ErpReceivable[],
  ): Promise<Map<string, CustomerRejection>> {
    const { erp, repository } = this.dependencies;
    const codes = [...new Set(receivables.map(({ cliente }) => cliente))];
    const rejections = new Map<string, CustomerRejection>();
    for (const code of await repository.findMissingCustomerCodes(codes)) {
      const lookup = await erp.getCustomer(code);
      if (lookup.status === "found") {
        await repository.saveCustomers([toCustomer(lookup.customer)]);
      } else {
        rejections.set(
          code,
          lookup.status === "not-found"
            ? "customer not found"
            : "customer invalid",
        );
      }
    }
    return rejections;
  }

  /** Keeps the receivables whose customer is available and logs the others. */
  private splitByCustomer(
    receivables: ErpReceivable[],
    rejections: Map<string, CustomerRejection>,
  ): ErpReceivable[] {
    const accepted: ErpReceivable[] = [];
    for (const receivable of receivables) {
      const reason = rejections.get(receivable.cliente);
      if (reason === undefined) {
        accepted.push(receivable);
      } else {
        this.dependencies.logger.warn(
          { entity: "receivables", key: receivable.numero, reason },
          "ERP record rejected",
        );
      }
    }
    return accepted;
  }

  private async recordSkippedRun(
    entity: SyncEntity,
    error: string,
  ): Promise<EntitySyncResult> {
    const { repository, clock } = this.dependencies;
    const runId = await repository.startRun(entity, clock());
    await repository.finishRun(runId, {
      result: "FAILURE",
      finishedAt: clock(),
      itemsRead: 0,
      itemsRejected: 0,
      cursorAt: null,
      error,
    });
    return { entity, result: "FAILURE", itemsRead: 0, itemsRejected: 0, error };
  }

  /** Logs only the error's type and code: its message may carry record values. */
  private logInternalFailure(entity: SyncEntity, failure: unknown): void {
    const errorType = failure instanceof Error ? failure.name : typeof failure;
    const code =
      typeof failure === "object" && failure !== null && "code" in failure
        ? failure.code
        : undefined;
    this.dependencies.logger.error(
      {
        entity,
        errorType,
        errorCode: typeof code === "string" ? code : undefined,
      },
      "ERP sync failed",
    );
  }

  private logRejected(entity: SyncEntity, rejected: ErpRejectedRecord[]): void {
    for (const { key, page, issues } of rejected) {
      this.dependencies.logger.warn(
        { entity, key, page, issues },
        "ERP record rejected",
      );
    }
  }
}
