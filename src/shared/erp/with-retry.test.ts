import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ErpRequestError, RateLimitedError } from "./erp-errors.js";
import { withRetry } from "./with-retry.js";

function httpError(status: number, retryAfterSeconds?: number) {
  return new ErpRequestError({ kind: "http", status, retryAfterSeconds });
}

/** Builds a call that throws the given errors in order, then resolves. */
function failingCall(errors: Error[], result = "ok") {
  const call = vi.fn<() => Promise<string>>();
  for (const error of errors) {
    call.mockRejectedValueOnce(error);
  }
  call.mockResolvedValue(result);
  return call;
}

function alwaysFailingCall(error: Error) {
  return vi.fn<() => Promise<string>>().mockRejectedValue(error);
}

describe("withRetry", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("returns the result after failing twice with 500", async () => {
    const call = failingCall([httpError(500), httpError(500)]);

    const assertion = expect(withRetry(call)).resolves.toBe("ok");
    await vi.runAllTimersAsync();

    await assertion;
    expect(call).toHaveBeenCalledTimes(3);
  });

  it("throws the 500 error after 4 calls waiting 1, 2, and 4 seconds", async () => {
    const call = alwaysFailingCall(httpError(500));

    const assertion = expect(withRetry(call)).rejects.toMatchObject({
      name: "ErpRequestError",
      status: 500,
    });

    await vi.advanceTimersByTimeAsync(0);
    expect(call).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(999);
    expect(call).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(call).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(1_999);
    expect(call).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(1);
    expect(call).toHaveBeenCalledTimes(3);
    await vi.advanceTimersByTimeAsync(3_999);
    expect(call).toHaveBeenCalledTimes(3);
    await vi.advanceTimersByTimeAsync(1);
    expect(call).toHaveBeenCalledTimes(4);

    await assertion;
    await vi.runAllTimersAsync();
    expect(call).toHaveBeenCalledTimes(4);
  });

  it("waits the Retry-After seconds of a 429 before calling again", async () => {
    const call = failingCall([httpError(429, 1)]);

    const assertion = expect(withRetry(call)).resolves.toBe("ok");
    await vi.advanceTimersByTimeAsync(999);
    expect(call).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(call).toHaveBeenCalledTimes(2);

    await assertion;
  });

  it("waits 5 seconds when a 503 has no Retry-After", async () => {
    const call = failingCall([httpError(503)]);

    const assertion = expect(withRetry(call)).resolves.toBe("ok");
    await vi.advanceTimersByTimeAsync(4_999);
    expect(call).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(call).toHaveBeenCalledTimes(2);

    await assertion;
  });

  it("still waits when Retry-After is exactly 300 seconds", async () => {
    const call = failingCall([httpError(429, 300)]);

    const assertion = expect(withRetry(call)).resolves.toBe("ok");
    await vi.advanceTimersByTimeAsync(299_999);
    expect(call).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);

    await assertion;
    expect(call).toHaveBeenCalledTimes(2);
  });

  it("throws RateLimitedError immediately when Retry-After is 3600 seconds", async () => {
    const call = alwaysFailingCall(httpError(429, 3_600));

    const error: unknown = await withRetry(call).catch(
      (caught: unknown) => caught,
    );

    expect(error).toBeInstanceOf(RateLimitedError);
    expect(error).toMatchObject({ retryAfterSeconds: 3_600 });
    expect(call).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("throws the last 429 error after 4 calls", async () => {
    const call = alwaysFailingCall(httpError(429, 1));

    const assertion = expect(withRetry(call)).rejects.toMatchObject({
      status: 429,
    });
    await vi.runAllTimersAsync();

    await assertion;
    expect(call).toHaveBeenCalledTimes(4);
  });

  it.each([401, 404, 422])(
    "throws %i immediately without retrying",
    async (status) => {
      const call = alwaysFailingCall(httpError(status));

      const error: unknown = await withRetry(call).catch(
        (caught: unknown) => caught,
      );

      expect(error).toMatchObject({ name: "ErpRequestError", status });
      expect(call).toHaveBeenCalledTimes(1);
      expect(vi.getTimerCount()).toBe(0);
    },
  );

  it.each(["network", "timeout", "malformed"] as const)(
    "retries a %s failure with the server-error backoff",
    async (kind) => {
      const call = failingCall([new ErpRequestError({ kind })]);

      const assertion = expect(withRetry(call)).resolves.toBe("ok");
      await vi.advanceTimersByTimeAsync(999);
      expect(call).toHaveBeenCalledTimes(1);
      await vi.advanceTimersByTimeAsync(1);

      await assertion;
      expect(call).toHaveBeenCalledTimes(2);
    },
  );

  it("rethrows errors that do not come from the ERP without retrying", async () => {
    const bug = new TypeError("unexpected bug");
    const call = alwaysFailingCall(bug);

    const error: unknown = await withRetry(call).catch(
      (caught: unknown) => caught,
    );

    expect(error).toBe(bug);
    expect(call).toHaveBeenCalledTimes(1);
  });
});
