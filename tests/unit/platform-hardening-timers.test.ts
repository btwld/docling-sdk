import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createTimeoutController,
  debounce,
  delay,
  interval,
  retry,
  setTimeout as sleep,
  throttle,
  timeout,
  withTimeout,
} from "../../src/platform/timers";

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(0);
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("timer ownership and cancellation", () => {
  it("resolves delays and detaches abort listeners", async () => {
    const controller = new AbortController();
    const remove = vi.spyOn(controller.signal, "removeEventListener");
    const result = delay(20, "value", controller.signal);
    await vi.advanceTimersByTimeAsync(20);
    expect(await result).toBe("value");
    expect(remove).toHaveBeenCalledWith("abort", expect.any(Function));
    controller.abort();
    expect(vi.getTimerCount()).toBe(0);
    const plain = sleep(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(await plain).toBeUndefined();
  });

  it("settles pre-aborted and in-flight delays without remaining timers", async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(delay(100, undefined, controller.signal)).rejects.toMatchObject({
      name: "AbortError",
    });
    const next = new AbortController();
    const promise = delay(100, null, next.signal);
    const assertion = expect(promise).rejects.toMatchObject({ name: "AbortError" });
    next.abort();
    await assertion;
    expect(vi.getTimerCount()).toBe(0);
  });

  it("bounds promise lifetime and clears deadlines on success, rejection and timeout", async () => {
    expect(await withTimeout(Promise.resolve(12), 100)).toBe(12);
    expect(vi.getTimerCount()).toBe(0);
    const error = new Error("source failure");
    await expect(withTimeout(Promise.reject(error), 100)).rejects.toBe(error);
    expect(vi.getTimerCount()).toBe(0);
    const late = withTimeout(new Promise(() => {}), 10, "conversion deadline");
    const assertion = expect(late).rejects.toMatchObject({
      name: "TimeoutError",
      message: "conversion deadline",
    });
    await vi.advanceTimersByTimeAsync(10);
    await assertion;
    expect(vi.getTimerCount()).toBe(0);
    const defaultLate = withTimeout(new Promise(() => {}), 1);
    const defaultAssertion = expect(defaultLate).rejects.toThrow("Operation timed out");
    await vi.advanceTimersByTimeAsync(1);
    await defaultAssertion;
    const direct = timeout(2);
    const directAssertion = expect(direct).rejects.toMatchObject({ name: "TimeoutError" });
    await vi.advanceTimersByTimeAsync(2);
    await directAssertion;
  });

  it("exposes cancelable timeout signals", async () => {
    const canceled = createTimeoutController(10);
    canceled.clear();
    await vi.advanceTimersByTimeAsync(10);
    expect(canceled.signal.aborted).toBe(false);
    const expired = createTimeoutController(10);
    await vi.advanceTimersByTimeAsync(10);
    expect(expired.signal.reason).toMatchObject({ name: "TimeoutError" });
    expired.clear();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("debounces to the last arguments and can run again", async () => {
    const fn = vi.fn();
    const debounced = debounce(fn, 10);
    debounced(1);
    debounced(2);
    await vi.advanceTimersByTimeAsync(10);
    expect(fn.mock.calls).toEqual([[2]]);
    debounced(3);
    await vi.advanceTimersByTimeAsync(10);
    expect(fn.mock.calls).toEqual([[2], [3]]);
  });

  it("throttles with an immediate leading call and latest trailing arguments at epoch zero", async () => {
    const fn = vi.fn();
    const throttled = throttle(fn, 10);
    throttled("first");
    expect(fn.mock.calls).toEqual([["first"]]);
    throttled("discarded");
    throttled("last");
    await vi.advanceTimersByTimeAsync(10);
    expect(fn.mock.calls).toEqual([["first"], ["last"]]);
    await vi.advanceTimersByTimeAsync(11);
    throttled("next");
    expect(fn.mock.calls).toEqual([["first"], ["last"], ["next"]]);
  });

  it("settles every pending interval read on stop, abort and iterator return", async () => {
    const controller = new AbortController();
    const remove = vi.spyOn(controller.signal, "removeEventListener");
    const ticker = interval(10, controller.signal);
    const iterator = ticker[Symbol.asyncIterator]();
    const first = iterator.next();
    const second = iterator.next();
    await vi.advanceTimersByTimeAsync(10);
    expect(await first).toEqual({ done: false, value: 0 });
    await vi.advanceTimersByTimeAsync(10);
    expect(await second).toEqual({ done: false, value: 1 });
    const pending = iterator.next();
    controller.abort();
    expect(await pending).toEqual({ done: true, value: undefined });
    expect(await iterator.next()).toEqual({ done: true, value: undefined });
    expect(remove).toHaveBeenCalled();
    ticker.stop();
    const noSignal = interval(5);
    const iterator2 = noSignal[Symbol.asyncIterator]();
    await vi.advanceTimersByTimeAsync(10);
    const waiting = iterator2.next();
    expect(await iterator2.return!()).toEqual({ done: true, value: undefined });
    expect(await waiting).toEqual({ done: true, value: undefined });
    expect(vi.getTimerCount()).toBe(0);
    const already = new AbortController();
    already.abort();
    expect(await interval(5, already.signal)[Symbol.asyncIterator]().next()).toEqual({
      done: true,
      value: undefined,
    });
    expect(vi.getTimerCount()).toBe(0);
  });
});

describe("public retry backoff", () => {
  it("retries with exponential bounded delay and returns the actual result", async () => {
    const fn = vi
      .fn()
      .mockRejectedValueOnce(new Error("1"))
      .mockRejectedValueOnce(new Error("2"))
      .mockResolvedValue("ok");
    const onRetry = vi.fn();
    const result = retry(fn, { maxAttempts: 3, baseDelay: 10, maxDelay: 15, onRetry });
    await vi.advanceTimersByTimeAsync(25);
    expect(await result).toBe("ok");
    expect(fn).toHaveBeenCalledTimes(3);
    expect(onRetry.mock.calls.map((call) => call.slice(1))).toEqual([
      [1, 10],
      [2, 15],
    ]);
    expect(await retry(async () => 1)).toBe(1);
  });

  it("respects permanent errors, exhaustion and invalid attempt counts", async () => {
    const error = new Error("permanent");
    const fn = vi.fn().mockRejectedValue(error);
    await expect(retry(fn, { shouldRetry: () => false })).rejects.toBe(error);
    await expect(retry(fn, { maxAttempts: 1 })).rejects.toBe(error);
    for (const maxAttempts of [0, -1, 1.5])
      await expect(retry(fn, { maxAttempts })).rejects.toThrow("positive integer");
    const exhausted = retry(fn, { baseDelay: 1 });
    const assertion = expect(exhausted).rejects.toBe(error);
    await vi.advanceTimersByTimeAsync(3);
    await assertion;
    expect(vi.getTimerCount()).toBe(0);
  });

  it("does not start or restart canceled work", async () => {
    const controller = new AbortController();
    controller.abort();
    const fn = vi.fn();
    await expect(retry(fn, { signal: controller.signal })).rejects.toMatchObject({
      name: "AbortError",
    });
    expect(fn).not.toHaveBeenCalled();
    const next = new AbortController();
    const failing = vi.fn().mockRejectedValue(new Error("retry"));
    const result = retry(failing, { signal: next.signal, baseDelay: 100 });
    const assertion = expect(result).rejects.toMatchObject({ name: "AbortError" });
    await vi.advanceTimersByTimeAsync(0);
    next.abort();
    await assertion;
    await vi.advanceTimersByTimeAsync(1000);
    expect(failing).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });
});
