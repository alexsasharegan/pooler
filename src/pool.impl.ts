import { wrap_err, Result } from "./wrap";
import {
  PoolOptions,
  Pooler,
  DeferredPromise,
  PoolEvent,
  RetryLimitError,
} from "./pool.types";
import { new_backoff_generator } from "./backoff";

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
    timeout = 100,
    timeout_cap = 30000,
    buffer_on_start = true,
  } = options;

  // Wrap function for error handling
  const destroy = (x: T) => wrap_err(destructor(x));

  let buf: T[] = [];
  let deferred: DeferredPromise<T>[] = [];
  let filling = false;
  let draining = false;
  let backoff = new_backoff_generator(timeout, timeout_cap);
  let sleeping: SleepToken[] = [];

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
    if (size() >= max) {
      return;
    }

    put(await retry_factory());
  };

  const size = () => buf.length;
  const on_full = async () => new Promise(r => events.full.push(r));
  const on_drained = async () => new Promise(r => events.drained.push(r));
  const buffer = async (fill_to_min = false) => {
    if (filling) {
      await on_full();
      return;
    }

    let fill_to = (fill_to_min ? min : max) - size();
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

  const retry_factory: () => Promise<T> = async () => {
    let tries = backoff(max_retries);
    let result: Result<T>;

    /* istanbul ignore next */
    while (true) {
      result = await wrap_err(factory());
      if (result.ok) {
        return result.value;
      }

      let x = tries.next();
      if (x.done) {
        throw NewRetryLimitError();
      }

      let tkn = sleep(x.value);
      sleeping.push(tkn);

      await new Promise(resolve => tkn.then(resolve));
    }
  };

  const monitor_levels = () => {
    if (size() < min && !draining) {
      buffer(true);
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
      // Lazily create T if the pool is dry. Don't wait for completion.
      fill_one();

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
      await destroy(x);
      return;
    }

    if (is_ok_sync && !is_ok_sync(x)) {
      await destroy(x);
      return;
    }

    if (is_ok && !await is_ok(x)) {
      await destroy(x);
      return;
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
      await destroy(x);
      if (on_error) {
        on_error(cb_result.error);
      }
      return;
    }

    await put(x);
  };

  const drain: () => Promise<void> = async () => {
    if (draining) {
      await on_drained();
      return;
    }

    let ps: Promise<any>[] = [];
    let x: T | undefined;

    draining = true;

    sleeping.forEach(tkn => tkn.cancel());
    sleeping = [];

    while ((x = buf.shift())) {
      ps.push(destroy(x));
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

function NewRetryLimitError(): RetryLimitError {
  return Object.assign(
    new RangeError(`Max attempts to create new pooled type exceeded.`),
    {
      get code(): "RetryLimitError" {
        return "RetryLimitError";
      },
    }
  );
}

export function sleep(ms: number) {
  let done = false;
  const listeners: Array<() => any> = [];
  const timer = setTimeout(() => {
    done = true;
    for (const cb of listeners) {
      cb();
    }
  }, ms);

  const sleep_tkn: SleepToken = {
    cancel() {
      if (!done) {
        clearTimeout(timer);
      }
    },
    then(fn: () => any) {
      if (done) {
        fn();
        return sleep_tkn;
      }

      listeners.push(fn);

      return sleep_tkn;
    },
  };

  return sleep_tkn;
}

export interface SleepToken {
  cancel(): void;
  then(fn: () => any): SleepToken;
}
