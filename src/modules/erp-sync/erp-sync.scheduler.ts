import { describeErrorSafely } from "./erp-sync.service.js";
import type { GuardedSyncOutcome, SyncLogger } from "./erp-sync.service.js";

const MINUTE = 60_000;

export interface SchedulerSettings {
  enabled: boolean;
  intervalMinutes: number;
  retryMinutes: number;
}

export interface ErpSyncSchedulerDependencies {
  service: { syncAllIfIdle(): Promise<GuardedSyncOutcome> };
  clock: () => Date;
  logger: SyncLogger;
  settings: SchedulerSettings;
}

/** What one scheduled attempt produced, including an error that escaped it. */
export type ScheduledOutcome = GuardedSyncOutcome | { status: "error" };

/**
 * The interval after a full success; the retry delay after a failure, a skip,
 * or an escaped error; and at least the wait the ERP asked for after its daily
 * limit (RN-15).
 */
export function nextDelayMilliseconds(
  outcome: ScheduledOutcome,
  settings: SchedulerSettings,
): number {
  const retry = settings.retryMinutes * MINUTE;
  if (outcome.status !== "completed") return retry;
  if (outcome.results.every(({ result }) => result === "SUCCESS")) {
    return settings.intervalMinutes * MINUTE;
  }
  const requestedWait = Math.max(
    0,
    ...outcome.results.map(({ retryAfterSeconds }) =>
      retryAfterSeconds === null ? 0 : retryAfterSeconds * 1_000,
    ),
  );
  return Math.max(retry, requestedWait);
}

/**
 * Runs the ERP synchronization inside the API (ADR 0006): once at start, then
 * one timer armed after each run ends, so runs never overlap and the interval
 * counts from the end of the previous run. A failure never stops the schedule.
 */
export class ErpSyncScheduler {
  private timer: NodeJS.Timeout | undefined;
  private stopped = false;

  constructor(private readonly dependencies: ErpSyncSchedulerDependencies) {}

  start(): void {
    const { settings, logger } = this.dependencies;
    if (!settings.enabled) {
      logger.info({}, "ERP sync scheduler disabled (SYNC_ENABLED=false)");
      return;
    }
    this.stopped = false;
    void this.runAndScheduleNext();
  }

  stop(): void {
    this.stopped = true;
    clearTimeout(this.timer);
    this.timer = undefined;
  }

  private async runAndScheduleNext(): Promise<void> {
    const outcome = await this.runOnce();
    if (this.stopped) return;

    const { clock, logger, settings } = this.dependencies;
    const delay = nextDelayMilliseconds(outcome, settings);
    logger.info(
      {
        status: outcome.status,
        nextRunAt: new Date(clock().getTime() + delay).toISOString(),
      },
      "ERP sync scheduled",
    );
    this.timer = setTimeout(() => {
      void this.runAndScheduleNext();
    }, delay);
    this.timer.unref();
  }

  private async runOnce(): Promise<ScheduledOutcome> {
    const { service, logger } = this.dependencies;
    try {
      const outcome = await service.syncAllIfIdle();
      if (outcome.status === "completed") {
        for (const {
          entity,
          result,
          itemsRead,
          itemsRejected,
          error,
        } of outcome.results) {
          logger.info(
            { entity, result, itemsRead, itemsRejected, error },
            "ERP sync run finished",
          );
        }
      }
      return outcome;
    } catch (failure) {
      logger.error(describeErrorSafely(failure), "ERP sync failed");
      return { status: "error" };
    }
  }
}
