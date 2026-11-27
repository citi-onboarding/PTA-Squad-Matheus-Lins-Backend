import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { SyncEntity } from "./erp-sync.repository.js";
import { ErpSyncScheduler } from "./erp-sync.scheduler.js";
import type { SchedulerSettings } from "./erp-sync.scheduler.js";
import type {
  EntitySyncResult,
  GuardedSyncOutcome,
  SyncLogger,
} from "./erp-sync.service.js";

const MINUTE = 60_000;

function entityResult(
  entity: SyncEntity,
  overrides: Partial<EntitySyncResult> = {},
): EntitySyncResult {
  return {
    entity,
    result: "SUCCESS",
    itemsRead: 0,
    itemsRejected: 0,
    error: null,
    retryAfterSeconds: null,
    ...overrides,
  };
}

function completed(
  overrides: Partial<Record<SyncEntity, Partial<EntitySyncResult>>> = {},
): GuardedSyncOutcome {
  return {
    status: "completed",
    results: (["customers", "products", "receivables"] as const).map((entity) =>
      entityResult(entity, overrides[entity]),
    ),
  };
}

const success = completed();
const productsFailed = completed({
  products: { result: "FAILURE", error: "erp error: http 503" },
});

function setup(settings: Partial<SchedulerSettings> = {}) {
  const service = {
    syncAllIfIdle: vi.fn<() => Promise<GuardedSyncOutcome>>(() =>
      Promise.resolve(success),
    ),
  };
  const logger = {
    info: vi.fn<SyncLogger["info"]>(),
    warn: vi.fn<SyncLogger["warn"]>(),
    error: vi.fn<SyncLogger["error"]>(),
  };
  const scheduler = new ErpSyncScheduler({
    service,
    clock: () => new Date(),
    logger,
    settings: {
      enabled: true,
      intervalMinutes: 60,
      retryMinutes: 10,
      ...settings,
    },
  });
  return { service, logger, scheduler };
}

/** Moves the fake clock and lets the synchronizations it triggers finish. */
async function advance(milliseconds: number) {
  await vi.advanceTimersByTimeAsync(milliseconds);
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-11-27T12:00:00.000Z"));
});

afterEach(() => {
  vi.useRealTimers();
});

describe("F02 / US-002 automatic synchronization schedule", () => {
  it("runs when started and again after the interval, not before", async () => {
    const { service, scheduler } = setup();

    scheduler.start();
    await advance(0);
    expect(service.syncAllIfIdle).toHaveBeenCalledTimes(1);

    await advance(60 * MINUTE - 1);
    expect(service.syncAllIfIdle).toHaveBeenCalledTimes(1);

    await advance(1);
    expect(service.syncAllIfIdle).toHaveBeenCalledTimes(2);
    scheduler.stop();
  });

  it("counts the interval from the end of the previous run", async () => {
    const { service, scheduler } = setup();
    service.syncAllIfIdle.mockImplementationOnce(
      () =>
        new Promise((resolve) =>
          setTimeout(() => {
            resolve(success);
          }, 5 * MINUTE),
        ),
    );

    scheduler.start();
    await advance(65 * MINUTE - 1);
    expect(service.syncAllIfIdle).toHaveBeenCalledTimes(1);

    await advance(1);
    expect(service.syncAllIfIdle).toHaveBeenCalledTimes(2);
    scheduler.stop();
  });

  it("never runs when disabled", async () => {
    const { service, scheduler } = setup({ enabled: false });

    scheduler.start();
    await advance(24 * 60 * MINUTE);

    expect(service.syncAllIfIdle).not.toHaveBeenCalled();
    scheduler.stop();
  });

  it("stops scheduling after stop()", async () => {
    const { service, scheduler } = setup();

    scheduler.start();
    await advance(0);
    scheduler.stop();
    await advance(3 * 60 * MINUTE);

    expect(service.syncAllIfIdle).toHaveBeenCalledTimes(1);
  });
});

describe("F02 / US-002 recovery after a failed synchronization", () => {
  it("retries after SYNC_RETRY_MINUTES, then returns to the interval after a success", async () => {
    const { service, scheduler } = setup();
    service.syncAllIfIdle.mockResolvedValueOnce(productsFailed);

    scheduler.start();
    await advance(0);
    await advance(10 * MINUTE - 1);
    expect(service.syncAllIfIdle).toHaveBeenCalledTimes(1);

    await advance(1);
    expect(service.syncAllIfIdle).toHaveBeenCalledTimes(2);

    await advance(10 * MINUTE);
    expect(service.syncAllIfIdle).toHaveBeenCalledTimes(2);
    await advance(50 * MINUTE);
    expect(service.syncAllIfIdle).toHaveBeenCalledTimes(3);
    scheduler.stop();
  });

  it("keeps the schedule after an error escapes a run, logging only its type and code", async () => {
    const { service, logger, scheduler } = setup();
    const failure = Object.assign(
      new Error("Unique constraint failed for Eletro Recife LTDA"),
      { code: "P1001" },
    );
    service.syncAllIfIdle.mockRejectedValueOnce(failure);

    scheduler.start();
    await advance(0);
    await advance(10 * MINUTE);

    expect(service.syncAllIfIdle).toHaveBeenCalledTimes(2);
    expect(logger.error).toHaveBeenCalledWith(
      { errorType: "Error", errorCode: "P1001" },
      "ERP sync failed",
    );
    expect(JSON.stringify(logger.error.mock.calls)).not.toContain(
      "Eletro Recife",
    );
    scheduler.stop();
  });
});

describe("F02 / US-002 ERP daily limit does not hold a run (RN-15)", () => {
  it("waits the 3600 seconds the ERP asked for before trying again", async () => {
    const { service, scheduler } = setup();
    service.syncAllIfIdle.mockResolvedValueOnce(
      completed({
        customers: {
          result: "FAILURE",
          error: "rate limited",
          retryAfterSeconds: 3_600,
        },
        receivables: {
          result: "FAILURE",
          error: "skipped: customers sync failed",
        },
      }),
    );

    scheduler.start();
    await advance(0);
    await advance(3_600_000 - 1);
    expect(service.syncAllIfIdle).toHaveBeenCalledTimes(1);

    await advance(1);
    expect(service.syncAllIfIdle).toHaveBeenCalledTimes(2);
    scheduler.stop();
  });

  it("waits SYNC_RETRY_MINUTES when the ERP asks for less", async () => {
    const { service, scheduler } = setup();
    service.syncAllIfIdle.mockResolvedValueOnce(
      completed({
        products: {
          result: "FAILURE",
          error: "rate limited",
          retryAfterSeconds: 120,
        },
      }),
    );

    scheduler.start();
    await advance(0);
    await advance(10 * MINUTE - 1);
    expect(service.syncAllIfIdle).toHaveBeenCalledTimes(1);

    await advance(1);
    expect(service.syncAllIfIdle).toHaveBeenCalledTimes(2);
    scheduler.stop();
  });
});

describe("F02 / US-002 one synchronization at a time", () => {
  it("checks again after SYNC_RETRY_MINUTES when a run was in progress", async () => {
    const { service, scheduler } = setup();
    service.syncAllIfIdle.mockResolvedValueOnce({ status: "skipped" });

    scheduler.start();
    await advance(0);
    await advance(10 * MINUTE);

    expect(service.syncAllIfIdle).toHaveBeenCalledTimes(2);
    scheduler.stop();
  });
});
