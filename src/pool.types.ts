/**
 * FactoryFunc returns a Promise
 * that resolves with type T.
 */
export type FactoryFunc<T> = () => Promise<T>;
/**
 * DestructorFunc takes a type T
 * and returns a promise when it has been destroyed.
 */
export type DestructorFunc<T> = (t: T) => Promise<void>;
/**
 * HealthCheckerSync takes a value T
 * and synchronously decides if it is
 * healthy to return to the pool.
 */
export type HealthCheckerSync<T> = (t: T) => boolean;
/**
 * HealthChecker takes a value T
 * and asynchronously decides if it is
 * healthy to return to the pool.
 */
export type HealthChecker<T> = (t: T) => Promise<boolean>;

export type DeferredPromise<T> = (value: T | PromiseLike<T>) => void;

/**
 * PoolOptions specify the pool's behavior.
 */
export type PoolOptions<T> = {
  /**
   * factory returns a promise that resolves with the value T.
   */
  factory: FactoryFunc<T>;
  /**
   * destructor returns a promise that resolves
   * once the value T has been destroyed.
   */
  destructor: DestructorFunc<T>;
  /**
   * is_ok returns a promise that resolves with whether or not the value T
   * is eligible to return to the pool.
   */
  is_ok?: HealthChecker<T>;
  /**
   * is_ok_sync synchronously returns whether or not the value T
   * is eligible to return to the pool.
   */
  is_ok_sync?: HealthCheckerSync<T>;
  /**
   * max is the maximum number of T you want pooled.
   *
   * @default 10
   */
  max?: number;
  /**
   * min is the threshold at which the pool is re-buffered.
   *
   * @default 3
   */
  min?: number;
  /**
   * max_retries is the number of times the factory func
   * should be retried before failing.
   */
  max_retries?: number;
  /**
   * timeout is the base length of time in ms the factory func
   * should retry construction of T. Used to calculate exponential backoff.
   *
   * @default 100
   */
  timeout?: number;
  /**
   * timeout_cap is the maximum length of time in ms the factory func
   * should wait for a construction attempt.
   *
   * @default 30000
   */
  timeout_cap?: number;
  /**
   * buffer_on_start indicates whether or not the pool
   * should start buffering T upon instantiation.
   *
   * @default true
   */
  buffer_on_start?: boolean;
};

/**
 * Pooler pools values of type `<T>` for reuse.
 * Values that are expensive to create (e.g. db connections)
 * can be created ahead of time and used by the application.
 */
export interface Pooler<T> {
  /**
   * Get returns a promise that resolve with a value of type `<T>`.
   * If a value is available, the promise is resolved immediately.
   * If a value is not available, the caller will be enqueued
   * and resolved in FIFO order.
   */
  get(): Promise<T>;
  /**
   * Put returns a value of type `<T>` back to the pool.
   * If the pool is already full, the destructor for `T` will invoked
   * and the value will be discarded.
   */
  put(x: T): Promise<void>;
  /**
   * Size returns the current size of the buffer pool;
   * the number of type `<T>` available in the pool.
   */
  size(): number;
  /**
   * Use takes an async callback to run with a value of type `<T>`.
   * Use abstracts both Pooler.Get and Pooler.Put logic,
   * invoking the callback with `T` and
   * returning it to the pool once resolved
   * or destroying it on error.
   */
  use(
    callback: (x: T) => Promise<void>,
    onError?: (err: any) => void
  ): Promise<void>;
  /**
   * Buffer will asynchronously buffer type `<T>` up to max.
   * The returned promise resolves once the buffering is complete.
   * If the pool is currently buffering, Buffer returns early.
   */
  buffer(): Promise<void>;
  /**
   * Drain empties the pool and invokes the destructor on each value `<T>`.
   * It resolves once all destructors have resolved.
   */
  drain(): Promise<void>;
}

export type PoolEvent = "full" | "drained";

export interface RetryLimitError extends RangeError {
  code: "RetryLimitError";
}
