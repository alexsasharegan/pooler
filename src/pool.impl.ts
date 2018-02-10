import { wrap_err } from "./wrap";
import { PoolOptions, Pooler, DeferredPromise, PoolEvent } from "./pool.types";

export async function NewPooler<T>(
  options: PoolOptions<T>
): Promise<Pooler<T>> {
  // Extract options with defaults.
  const {
    factory,
    destructor,
    is_ok,
    is_ok_sync,
    max = 10,
    min = 3,
    max_retries = 3,
    buffer_on_start = true,
  } = options;

  let buf: T[] = [];
  let deferred: DeferredPromise<T>[] = [];
  let filling: boolean = false;
  let draining: boolean = false;

  let events: { [event in PoolEvent]: Array<() => void> } = {
    full: [],
    drained: [],
  };

  const invoke = (evt: PoolEvent) => {
    let fn: (() => void) | undefined;
    while ((fn = events[evt].shift())) {
      fn();
    }
  };

  const fill_one = async () => {
    let fill_result = await wrap_err(retry_factory(max_retries));
    if (!fill_result.ok) {
      return console.error(fill_result.error);
    }
    put(fill_result.value);
  };

  const size = () => buf.length;
  const on_full = async () => {
    if (filling) {
      await new Promise(r => events.full.push(r));
      return;
    }
  };
  const on_drained = async () => {
    if (filling) {
      await new Promise(r => events.drained.push(r));
      return;
    }
  };
  const buffer = async () => {
    if (filling) {
      await on_full();
      return;
    }

    let fill_to = max - size();
    if (fill_to < 1) {
      return;
    }

    let ps: Promise<void>[] = [];
    filling = true;

    while (fill_to--) {
      ps.push(fill_one());
    }

    await Promise.all(ps);
    filling = false;
    invoke("full");
  };

  const retry_factory: (retries: number) => Promise<T> = async retries => {
    if (!retries) {
      let err = new RangeError(
        `Max attempts to create new pooled type exceeded.`
      );
      err.name = "RetryLimitError";
      throw err;
    }

    let factory_result = await wrap_err(factory());
    if (!factory_result.ok) {
      console.error(factory_result.error);
      return retry_factory(--retries);
    }

    return factory_result.value;
  };

  const monitor_levels = () => {
    if (size() < min && !draining) {
      buffer();
    }
  };

  const flush_deferred = () => {
    let d: DeferredPromise<T> | undefined;
    let x: T | undefined;

    // Run while we have callers waiting and buffered <T> to release.
    while (size() > 0 && (d = deferred.shift()) && (x = buf.shift())) {
      monitor_levels();
      d(x);
    }
  };

  const get: () => Promise<T> = async () => {
    // Release a value <T> from the pool.
    // Shift off the front since we'll push on to the end.
    // Should keep values from getting too stale.
    let x = buf.shift();
    if (!x) {
      // Create a promise to be resolved once the buffer refills.
      // Internal 'added' event listener will flush these deferred promises.
      return new Promise<T>(resolve => {
        deferred.push(resolve);
      });
    }

    // Now that we're guaranteed a value, check the pool levels.
    monitor_levels();
    return x;
  };

  const put: (x: T) => Promise<void> = async x => {
    if (size() >= max || draining) {
      return destructor(x);
    }

    if (is_ok_sync && !is_ok_sync(x)) {
      return destructor(x);
    }

    if (is_ok && !await is_ok(x)) {
      return destructor(x);
    }

    let y: T;
    for (y of buf) {
      if (x === y) {
        throw new TypeError(`Cannot 'put' duplicate value.`);
      }
    }

    // Added values are pushed on the end
    // since we retrieve from the start.
    buf.push(x);
    flush_deferred();
  };

  const use: (
    callback: (x: T) => Promise<void>,
    onError?: (err: any) => void
  ) => Promise<void> = async (cb, on_error) => {
    let x = await get();
    let cb_result = await wrap_err(cb(x));

    if (!cb_result.ok) {
      console.error(cb_result.error);
      destructor(x);
      if (on_error) {
        on_error(cb_result.error);
      }
      return;
    }

    put(x);
  };

  const drain: () => Promise<void> = async () => {
    if (draining) {
      await on_drained();
      return;
    }

    let ps: Promise<void>[] = [];
    let x: T | undefined;

    draining = true;

    while ((x = buf.shift())) {
      ps.push(destructor(x));
    }

    await wrap_err(Promise.all(ps));

    draining = false;
    invoke("drained");
  };

  if (buffer_on_start) {
    await buffer();
  }

  return {
    size,
    buffer,
    drain,
    get,
    put,
    use,
  };
}
