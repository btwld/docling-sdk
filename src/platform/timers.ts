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
export function delay<T = void>(
  ms: number,
  value?: T,
  signal?: AbortSignal
): Promise<T> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new DOMException("Delay aborted", "AbortError"));
      return;
    }

    const timeoutId = globalThis.setTimeout(() => {
      resolve(value as T);
    }, ms);

    signal?.addEventListener(
      "abort",
      () => {
        globalThis.clearTimeout(timeoutId);
        reject(new DOMException("Delay aborted", "AbortError"));
      },
      { once: true }
    );
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
  const controller = createTimeoutController(ms);

  try {
    const result = await Promise.race([
      promise,
      timeout(ms, message),
    ]);
    controller.clear();
    return result;
  } catch (error) {
    controller.clear();
    throw error;
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
  let lastCall = 0;
  let timeoutId: ReturnType<typeof globalThis.setTimeout> | undefined;

  return (...args: Parameters<T>) => {
    const now = Date.now();

    if (now - lastCall >= ms) {
      lastCall = now;
      fn(...args);
    } else {
      if (timeoutId !== undefined) {
        globalThis.clearTimeout(timeoutId);
      }
      timeoutId = globalThis.setTimeout(() => {
        lastCall = Date.now();
        fn(...args);
        timeoutId = undefined;
      }, ms - (now - lastCall));
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
  let resolveNext: ((value: IteratorResult<number>) => void) | null = null;

  const intervalId = globalThis.setInterval(() => {
    if (resolveNext && !stopped) {
      resolveNext({ value: count++, done: false });
      resolveNext = null;
    }
  }, ms);

  const stop = () => {
    stopped = true;
    globalThis.clearInterval(intervalId);
    if (resolveNext) {
      resolveNext({ value: undefined as unknown as number, done: true });
    }
  };

  signal?.addEventListener("abort", stop, { once: true });

  return {
    stop,
    [Symbol.asyncIterator](): AsyncIterator<number> {
      return {
        next(): Promise<IteratorResult<number>> {
          if (stopped) {
            return Promise.resolve({ value: undefined as unknown as number, done: true });
          }
          return new Promise((resolve) => {
            resolveNext = resolve;
          });
        },
        return(): Promise<IteratorResult<number>> {
          stop();
          return Promise.resolve({ value: undefined as unknown as number, done: true });
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

  let lastError: unknown;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      if (signal?.aborted) {
        throw new DOMException("Operation aborted", "AbortError");
      }
      return await fn();
    } catch (error) {
      lastError = error;

      if (attempt >= maxAttempts || !shouldRetry(error, attempt)) {
        throw error;
      }

      const delayMs = Math.min(baseDelay * backoffFactor ** (attempt - 1), maxDelay);
      onRetry?.(error, attempt, delayMs);

      await delay(delayMs, undefined, signal);
    }
  }

  throw lastError;
}
