/**
 * Success result type
 */
export interface Success<T> {
  readonly success: true;
  readonly data: T;
}

/**
 * Failure result type
 */
export interface Failure<E> {
  readonly success: false;
  readonly error: E;
}

/**
 * Result union type
 */
export type Result<T, E = Error> = Success<T> | Failure<E>;

/**
 * Create a success result
 */
export function success<T>(data: T): Success<T> {
  return { success: true, data };
}

/**
 * Create a failure result
 */
export function failure<E>(error: E): Failure<E> {
  return { success: false, error };
}

/**
 * Wrap an async function that might throw into a Result
 */
export async function tryAsync<T, E = Error>(fn: () => Promise<T>): Promise<Result<T, E>> {
  try {
    const data = await fn();
    return success(data);
  } catch (error) {
    return failure(error as E);
  }
}
