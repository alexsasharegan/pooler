import { EventEmitter } from "events";
import { WrapErr } from "./wrap";

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

type DeferredPromise<T> = (value: T | PromiseLike<T>) => void;

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
   */
  max?: number;
  /**
   * min is the threshold at which the pool is re-buffered.
   */
  min?: number;
  /**
   * max_retries is the number of times the factory func
   * should be retried before failing.
   */
  max_retries?: number;
  /**
   * buffer_on_start indicates whether or not the pool
   * should start buffering T upon instantiation.
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
  Get(): Promise<T>;
  /**
   * Put returns a value of type `<T>` back to the pool.
   * If the pool is already full, the destructor for `T` will invoked
   * and the value will be discarded.
   */
  Put(x: T): Promise<void>;
  /**
   * Size returns the current size of the buffer pool;
   * the number of type `<T>` available in the pool.
   */
  Size(): number;
  /**
   * Use takes an async callback to run with a value of type `<T>`.
   * Use abstracts both Pooler.Get and Pooler.Put logic,
   * invoking the callback with `T` and
   * returning it to the pool once resolved
   * or destroying it on error.
   */
  Use(
    callback: (x: T) => Promise<void>,
    onError?: (err: any) => void
  ): Promise<void>;
  /**
   * Buffer will asynchronously buffer type `<T>` up to max.
   * The returned promise resolves once the buffering is complete.
   * If the pool is currently buffering, Buffer returns early.
   */
  Buffer(): Promise<void>;
  /**
   * Drain empties the pool and invokes the destructor on each value `<T>`.
   * It resolves once all destructors have resolved.
   */
  Drain(): Promise<void>;
}

export function NewPooler<T>(options: PoolOptions<T>): Pool<T> {
  return new Pool<T>(options);
}

export class Pool<T> extends EventEmitter implements Pooler<T> {
  private buf: T[] = [];
  private deferred: DeferredPromise<T>[] = [];
  private filling: boolean = false;
  private draining: boolean = false;
  public factory: FactoryFunc<T>;
  public destructor: DestructorFunc<T>;
  public is_ok?: HealthChecker<T>;
  public is_ok_sync?: HealthCheckerSync<T>;
  public max: number;
  public min: number;
  public max_retries: number;

  constructor(options: PoolOptions<T>) {
    // EventEmitter constructor.
    super();
    // Extract options with defaults.
    let {
      factory,
      destructor,
      is_ok,
      is_ok_sync,
      max = 10,
      min = 3,
      max_retries = 3,
      buffer_on_start = true,
    } = options;

    // Assignment.
    this.factory = factory;
    this.destructor = destructor;
    this.is_ok = is_ok;
    this.is_ok_sync = is_ok_sync;
    this.max = max;
    this.min = min;
    this.max_retries = max_retries;

    // monitorLevels will refill the pool if our minimum is reached.
    this.on("release", this.monitor_levels.bind(this));
    // flushDeferred will resolve callers awaiting a value T.
    this.on("added", this.flush_deferred.bind(this));

    if (buffer_on_start) {
      // Buffer the pool.
      this.Buffer();
    }
  }

  private async retry_factory(retries: number): Promise<T> {
    if (!retries) {
      let err = new RangeError(
        `Max attempts to create new pooled type exceeded.`
      );
      err.name = "RetryLimitError";
      throw err;
    }

    let factory_result = await WrapErr(this.factory());
    if (!factory_result.ok) {
      console.error(factory_result.error);
      return this.retry_factory(--retries);
    }

    return factory_result.value;
  }

  public async Buffer(): Promise<void> {
    if (this.filling) {
      await new Promise(r => this.once("full", r));
      return;
    }

    let fill_to = this.max - this.Size();
    if (fill_to < 1) {
      return;
    }

    const fill_one = async () => {
      let fill_result = await WrapErr(this.retry_factory(this.max_retries));
      if (!fill_result.ok) {
        return console.error(fill_result.error);
      }
      this.Put(fill_result.value);
    };

    let ps: Promise<void>[] = [];
    this.filling = true;
    this.emit("buffering");

    while (fill_to--) {
      ps.push(fill_one());
    }

    await Promise.all(ps);
    this.filling = false;
    this.emit("full");
  }

  private monitor_levels() {
    if (this.Size() < this.min && !this.draining) {
      this.Buffer();
    }
  }

  private async flush_deferred() {
    let d: DeferredPromise<T> | undefined;
    let x: T | undefined;

    // Run while we have callers waiting and buffered <T> to release.
    while (
      this.Size() > 0 &&
      (d = this.deferred.shift()) &&
      (x = this.buf.shift())
    ) {
      this.emit("release");
      d(x);
    }
  }

  public Size(): number {
    return this.buf.length;
  }

  public async Get(): Promise<T> {
    // Release a value <T> from the pool.
    // Shift off the front since we'll push on to the end.
    // Should keep values from getting too stale.
    let x = this.buf.shift();
    if (!x) {
      // Create a promise to be resolved once the buffer refills.
      // Internal 'added' event listener will flush these deferred promises.
      return new Promise<T>(resolve => {
        this.deferred.push(resolve);
      });
    }

    // Now that we're guaranteed a value, emit our release event.
    this.emit("release");
    return x;
  }

  public async Put(x: T): Promise<void> {
    if (this.Size() >= this.max || this.draining) {
      return this.destructor(x);
    }

    if (this.is_ok_sync && !this.is_ok_sync(x)) {
      return this.destructor(x);
    }

    if (this.is_ok && !await this.is_ok(x)) {
      return this.destructor(x);
    }

    let y: T;
    for (y of this.buf) {
      if (x === y) {
        throw new TypeError(`Cannot 'Put' duplicate value.`);
      }
    }

    // Added values are pushed on the end
    // since we retrieve from the start.
    this.buf.push(x);
    this.emit("added");
  }

  public async Use(
    callback: (x: T) => Promise<void>,
    onError?: (err: any) => void
  ): Promise<void> {
    let x = await this.Get();
    let cb_result = await WrapErr(callback(x));

    if (!cb_result.ok) {
      console.error(cb_result.error);
      this.destructor(x);
      if (onError) {
        onError(cb_result.error);
      }
      return;
    }

    this.Put(x);
  }

  public async Drain(): Promise<void> {
    if (this.draining) {
      await new Promise(r => this.once("drained", r));
      return;
    }

    let ps: Promise<void>[] = [];
    let x: T | undefined;

    this.draining = true;

    while ((x = this.buf.shift())) {
      ps.push(this.destructor(x));
    }

    await WrapErr(Promise.all(ps));

    this.draining = false;
    this.emit("drained");
  }
}
