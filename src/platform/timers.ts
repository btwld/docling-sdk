/**
 * Cross-runtime timer utilities
 * Provides Promise-based delay/timeout that works in all environments
 */

/**
 * Create a Promise that resolves after a specified delay
 * Cross-runtime replacement for node:timers/promises setTimeout
 *
 * @param ms - Delay in milliseconds
 * @param value - Optional value to resolve with
 * @param signal - Optional AbortSignal to cancel the delay
 */
export function delay<T = void>(ms: number, value?: T, signal?: AbortSignal): Promise<T> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new DOMException("Delay aborted", "AbortError"));
      return;
    }

    const onAbort = () => {
      globalThis.clearTimeout(timeoutId);
      reject(new DOMException("Delay aborted", "AbortError"));
    };
    const timeoutId = globalThis.setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve(value as T);
    }, ms);
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

/**
 * Alias for delay - matches node:timers/promises naming
 */
export const setTimeout = delay;

/**
 * Create a Promise that rejects after a specified timeout
 *
 * @param ms - Timeout in milliseconds
 * @param message - Optional error message
 */
export function timeout(ms: number, message = "Operation timed out"): Promise<never> {
  return new Promise((_, reject) => {
    globalThis.setTimeout(() => {
      reject(new DOMException(message, "TimeoutError"));
    }, ms);
  });
}

/**
 * Create a timeout controller that can be used to cancel operations
 */
export function createTimeoutController(ms: number): {
  signal: AbortSignal;
  clear: () => void;
} {
  const controller = new AbortController();
  const timeoutId = globalThis.setTimeout(() => {
    controller.abort(new DOMException("Operation timed out", "TimeoutError"));
  }, ms);

  return {
    signal: controller.signal,
    clear: () => globalThis.clearTimeout(timeoutId),
  };
}

/**
 * Race a promise against a timeout
 *
 * @param promise - The promise to race
 * @param ms - Timeout in milliseconds
 * @param message - Optional timeout error message
 */
export async function withTimeout<T>(
  promise: Promise<T>,
  ms: number,
  message?: string
): Promise<T> {
  let timeoutId: ReturnType<typeof globalThis.setTimeout> | undefined;
  const deadline = new Promise<never>((_, reject) => {
    timeoutId = globalThis.setTimeout(() => {
      reject(new DOMException(message ?? "Operation timed out", "TimeoutError"));
    }, ms);
  });
  try {
    return await Promise.race([promise, deadline]);
  } finally {
    globalThis.clearTimeout(timeoutId);
  }
}

/**
 * Create a debounced function
 */
export function debounce<T extends (...args: unknown[]) => unknown>(
  fn: T,
  ms: number
): (...args: Parameters<T>) => void {
  let timeoutId: ReturnType<typeof globalThis.setTimeout> | undefined;

  return (...args: Parameters<T>) => {
    if (timeoutId !== undefined) {
      globalThis.clearTimeout(timeoutId);
    }
    timeoutId = globalThis.setTimeout(() => {
      fn(...args);
      timeoutId = undefined;
    }, ms);
  };
}

/**
 * Create a throttled function
 */
export function throttle<T extends (...args: unknown[]) => unknown>(
  fn: T,
  ms: number
): (...args: Parameters<T>) => void {
  let lastCall = Number.NEGATIVE_INFINITY;
  let timeoutId: ReturnType<typeof globalThis.setTimeout> | undefined;

  return (...args: Parameters<T>) => {
    const now = Date.now();

    if (now - lastCall >= ms) {
      globalThis.clearTimeout(timeoutId);
      timeoutId = undefined;
      lastCall = now;
      fn(...args);
    } else {
      if (timeoutId !== undefined) {
        globalThis.clearTimeout(timeoutId);
      }
      timeoutId = globalThis.setTimeout(
        () => {
          lastCall = Date.now();
          fn(...args);
          timeoutId = undefined;
        },
        ms - (now - lastCall)
      );
    }
  };
}

/**
 * Create an interval that returns an async iterator
 */
export function interval(
  ms: number,
  signal?: AbortSignal
): AsyncIterable<number> & { stop: () => void } {
  let count = 0;
  let stopped = false;
  const pending: Array<(value: IteratorResult<number>) => void> = [];
  const intervalId = globalThis.setInterval(() => {
    const resolve = pending.shift();
    if (resolve) resolve({ value: count++, done: false });
  }, ms);

  const stop = () => {
    stopped = true;
    globalThis.clearInterval(intervalId);
    signal?.removeEventListener("abort", stop);
    for (const resolve of pending.splice(0)) resolve({ value: undefined, done: true });
  };
  if (signal?.aborted) stop();
  else signal?.addEventListener("abort", stop, { once: true });

  return {
    stop,
    [Symbol.asyncIterator](): AsyncIterator<number> {
      return {
        next(): Promise<IteratorResult<number>> {
          if (stopped) return Promise.resolve({ value: undefined, done: true });
          return new Promise((resolve) => pending.push(resolve));
        },
        return(): Promise<IteratorResult<number>> {
          stop();
          return Promise.resolve({ value: undefined, done: true });
        },
      };
    },
  };
}

/**
 * Retry a function with exponential backoff
 */
export async function retry<T>(
  fn: () => Promise<T>,
  options: {
    maxAttempts?: number;
    baseDelay?: number;
    maxDelay?: number;
    backoffFactor?: number;
    shouldRetry?: (error: unknown, attempt: number) => boolean;
    onRetry?: (error: unknown, attempt: number, delay: number) => void;
    signal?: AbortSignal;
  } = {}
): Promise<T> {
  const {
    maxAttempts = 3,
    baseDelay = 1000,
    maxDelay = 30000,
    backoffFactor = 2,
    shouldRetry = () => true,
    onRetry,
    signal,
  } = options;

  if (!Number.isInteger(maxAttempts) || maxAttempts < 1) {
    throw new RangeError("maxAttempts must be a positive integer");
  }
  let lastError: unknown;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    if (signal?.aborted) throw new DOMException("Operation aborted", "AbortError");
    try {
      return await fn();
    } catch (error) {
      lastError = error;

      if (signal?.aborted || attempt >= maxAttempts || !shouldRetry(error, attempt)) {
        throw error;
      }

      const delayMs = Math.min(baseDelay * backoffFactor ** (attempt - 1), maxDelay);
      onRetry?.(error, attempt, delayMs);

      await delay(delayMs, undefined, signal);
    }
  }

  throw lastError;
}
