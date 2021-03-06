import { NewPooler, sleep } from "./pool.impl";
import { setTimeout } from "timers";
import { promisify } from "util";
import { Pooler } from "./pool.types";

const wait = promisify(setTimeout);
const mock_delay = 10;
const mock_name = "PoolMock Object";
const mock_opts = () => ({
  factory: PoolMock.factory,
  destructor: PoolMock.destructor,
  max: 10,
  min: 2,
});

class PoolMock {
  public name: string = mock_name;

  public static async factory(): Promise<PoolMock> {
    await wait(mock_delay);
    return new PoolMock();
  }

  public static async destructor(_mock: PoolMock): Promise<void> {
    await wait(mock_delay);
  }
}

describe("Pool Public API:", () => {
  it("should get a value from the pool", async () => {
    let pool: Pooler<PoolMock>;
    let mock: PoolMock;

    pool = await NewPooler<PoolMock>(mock_opts());
    mock = await pool.get();
    expect(mock).toBeDefined();
    expect(mock.name).toBe(mock_name);
  });

  it("should put a value into the pool", async () => {
    let opts = Object.assign(mock_opts(), { buffer_on_start: false });
    let pool = await NewPooler<PoolMock>(opts);
    let mock = new PoolMock();

    expect(pool.size()).toBe(0);
    await pool.put(mock);
    expect(pool.size()).toBe(1);
  });

  it("should not put the same value into the pool twice", async () => {
    let opts = Object.assign(mock_opts(), { buffer_on_start: false });
    let pool = await NewPooler<PoolMock>(opts);
    let mock = new PoolMock();

    expect(pool.size()).toBe(0);
    await pool.put(mock);
    expect(pool.put(mock)).rejects.toThrow(TypeError);
  });

  it("should not put a value into the pool when at max", async () => {
    let destructor = jest.fn(PoolMock.destructor);
    let opts = Object.assign(mock_opts(), { destructor });
    let pool = await NewPooler<PoolMock>(opts);
    let mock = new PoolMock();

    expect(pool.size()).toBe(opts.max);
    expect(destructor).not.toHaveBeenCalled();

    await pool.put(mock);

    expect(pool.size()).toBe(opts.max);
    expect(destructor).toHaveBeenCalledTimes(1);
  });

  it("should invoke 'use' func with a value and return the value to pool", async () => {
    let opts = mock_opts();
    let pool = await NewPooler<PoolMock>(opts);
    let use_spy = jest.fn();

    await pool.use(use_spy);
    expect(use_spy).toHaveBeenCalledWith(expect.any(PoolMock));

    await pool.use(async mock => {
      // Check that a value was pulled from the pool.
      expect(pool.size()).toBe(opts.max - 1);
      expect(mock).toEqual(expect.any(PoolMock));
    });

    // Check that our value was returned to the pool.
    expect(pool.size()).toBe(opts.max);
  });

  it("should handle 'use' func errors", async () => {
    let opts = Object.assign(mock_opts(), {
      destructor: jest.fn(),
    });
    let pool = await NewPooler<PoolMock>(opts);
    let on_err = jest.fn();

    await pool.use(async () => {
      throw new Error();
    }, on_err);
    expect(on_err).toHaveBeenCalledWith(expect.any(Error));
    expect(opts.destructor).toHaveBeenCalledWith(expect.any(PoolMock));

    await pool.use(async () => {
      throw new Error();
    });
    expect(opts.destructor).toHaveBeenCalledTimes(2);
  });

  it("should not buffer when at max", async () => {
    let opts = Object.assign(mock_opts());
    let pool = await NewPooler<PoolMock>(opts);

    expect(pool.size()).toBe(opts.max);

    await pool.buffer();
    expect(pool.size()).toBe(opts.max);
  });

  it("should drain", async () => {
    let destructor = jest.fn(PoolMock.destructor);
    let opts = Object.assign(mock_opts(), { destructor });
    let pool = await NewPooler<PoolMock>(opts);

    expect(destructor).not.toHaveBeenCalled();

    await pool.drain();

    expect(pool.size()).toBe(0);
    expect(destructor).toHaveBeenCalledWith(expect.any(PoolMock));
    expect(destructor).toHaveBeenCalledTimes(opts.max);
  });

  it("should handle calling drain repeatedly", async () => {
    let destructor = jest.fn();
    let opts = Object.assign(mock_opts(), { destructor });
    let pool = await NewPooler<PoolMock>(opts);
    let ps: Promise<any>[] = [];

    expect(destructor).not.toHaveBeenCalled();

    ps.push(pool.drain().then(() => expect(pool.size()).toBe(0)));
    ps.push(pool.drain().then(() => expect(pool.size()).toBe(0)));
    ps.push(pool.drain().then(() => expect(pool.size()).toBe(0)));
    ps.push(pool.drain().then(() => expect(pool.size()).toBe(0)));

    await Promise.all(ps);

    expect(destructor).toHaveBeenCalledWith(expect.any(PoolMock));
    expect(destructor).toHaveBeenCalledTimes(opts.max);
  });
});

describe("Pool options", () => {
  it("should call 'factory'", async () => {
    // Use a Jest spy, but wrap it so we can return unique objects for the Pool.
    let factory = jest.fn(PoolMock.factory);
    let opts = Object.assign(mock_opts(), { factory });
    await NewPooler<PoolMock>(opts);

    expect(factory).toHaveBeenCalledTimes(opts.max);
  });

  it("should call 'destructor'", async () => {
    let destructor = jest.fn(PoolMock.destructor);
    let opts = Object.assign(mock_opts(), { destructor });
    let pool = await NewPooler<PoolMock>(opts);

    expect(destructor).not.toHaveBeenCalled();

    await pool.drain();
    expect(destructor).toHaveBeenCalledTimes(opts.max);
  });

  it("should use 'buffer_on_start'", async () => {
    let opts = Object.assign(mock_opts(), { buffer_on_start: false });
    let pool = await NewPooler<PoolMock>(opts);

    expect(pool.size()).toBe(0);

    await pool.buffer();
    expect(pool.size()).toBe(opts.max);

    opts.buffer_on_start = true;
    pool = await NewPooler<PoolMock>(opts);

    expect(pool.size()).toBe(opts.max);
  });

  it("should use 'max'", async () => {
    let max = 25;
    let opts = Object.assign(mock_opts(), { max });
    let pool = await NewPooler<PoolMock>(opts);

    // Pool should begin buffering immediately,
    // but not fill until at least `MockDelay` has elapsed.
    expect(pool.size()).toBe(max);

    // Shouldn't overfill
    await pool.buffer();
    expect(pool.size()).toBe(max);

    max = 5;
    opts = Object.assign(mock_opts(), { max });
    pool = await NewPooler<PoolMock>(opts);

    expect(pool.size()).toBe(max);
  });

  it("should use 'is_ok_sync' callback", async () => {
    let is_ok_sync = jest.fn(() => true);
    let pool = await NewPooler(Object.assign(mock_opts(), { is_ok_sync }));

    let mock = await pool.get();
    await pool.put(mock);

    expect(is_ok_sync).toHaveBeenCalledWith(expect.any(PoolMock));
  });

  it("should use 'is_ok' callback", async () => {
    let is_ok = jest.fn(async () => true);
    let pool = await NewPooler(Object.assign(mock_opts(), { is_ok }));

    let mock = await pool.get();
    await pool.put(mock);

    expect(is_ok).toHaveBeenCalledWith(expect.any(PoolMock));
  });

  it("should destroy when 'is_ok' returns false after 'put'", async () => {
    // True for initial buffer
    let ok = true;
    let is_ok = jest.fn(async () => ok);
    let opts = Object.assign(mock_opts(), { is_ok, destructor: jest.fn() });
    let pool = await NewPooler(opts);

    ok = false;
    let mock = await pool.get();
    await pool.put(mock);

    expect(is_ok).toHaveBeenCalledWith(expect.any(PoolMock));
    expect(opts.destructor).toHaveBeenCalledWith(expect.any(PoolMock));
  });

  it("should use both health check callbacks and call 'is_ok_sync' first", async () => {
    enum WhichFn {
      nil,
      is_ok,
      is_ok_sync,
    }

    let first = WhichFn.nil;

    let is_ok = jest.fn(async () => {
      if (!first) {
        first = WhichFn.is_ok;
      }
      return true;
    });

    let is_ok_sync = jest.fn(() => {
      if (!first) {
        first = WhichFn.is_ok_sync;
      }
      return true;
    });

    let pool = await NewPooler(
      Object.assign(mock_opts(), { is_ok, is_ok_sync })
    );

    let mock = await pool.get();
    await pool.put(mock);

    expect(is_ok_sync).toHaveBeenCalledWith(expect.any(PoolMock));
    expect(is_ok).toHaveBeenCalledWith(expect.any(PoolMock));
    expect(first).toBe(WhichFn.is_ok_sync);
  });

  it("should call destroy if health check callbacks return false", async () => {
    // Initialize 'ok' to true so we can buffer up the pool.
    let ok = true;

    let is_ok = jest.fn(async () => ok);
    let is_ok_sync = jest.fn(() => ok);

    let destructor = jest.fn(PoolMock.destructor);
    let opts = Object.assign(mock_opts(), { is_ok, is_ok_sync, destructor });
    let pool = await NewPooler(opts);

    // Flip ok so our buffered pool can't 'put' objects.
    ok = false;

    let mock = await pool.get();
    await pool.put(mock);

    expect(destructor).toHaveBeenCalledWith(expect.any(PoolMock));
    expect(pool.size()).toBe(opts.max - 1);
  });
});

describe("Pool internals", () => {
  it("should use default options", async () => {
    let opts: any = mock_opts();
    delete opts.min;
    delete opts.max;

    let pool = await NewPooler(opts);
    expect(pool.size()).toMatchSnapshot();
  });

  it("should re-buffer when the 'min' threshold is met", async () => {
    let factory = jest.fn(PoolMock.factory);
    let opts = Object.assign(mock_opts(), { factory });
    let pool = await NewPooler<PoolMock>(opts);

    expect(factory).toHaveBeenCalledTimes(opts.max);
    // Cross the threshold by just one.
    let i = opts.max - opts.min + 1;
    while (i--) {
      expect(await pool.get()).toBeInstanceOf(PoolMock);
    }

    await wait(mock_delay * 5);

    // Expect the factory to have buffered fully once,
    // plus one from when we dipped below the queue by one.
    expect(factory).toHaveBeenCalledTimes(opts.max + 1);
    expect(pool.size()).toBe(opts.min);
  });

  it("should buffer lazily", async () => {
    let factory = jest.fn(PoolMock.factory);
    let opts = Object.assign(mock_opts(), { factory, buffer_on_start: false });
    let pool = await NewPooler<PoolMock>(opts);
    let use_fn = jest.fn(async () => undefined);

    expect(pool.size()).toBe(0);
    await pool.use(use_fn);
    await wait(mock_delay * 5);
    expect(pool.size()).toBeGreaterThanOrEqual(opts.min);
    expect(pool.size()).toBeLessThan(opts.max);
    expect(use_fn).toHaveBeenCalledWith(expect.any(PoolMock));
  });

  it("should not double-buffer", async () => {
    let factory = jest.fn(PoolMock.factory);
    let opts = Object.assign(mock_opts(), { factory, buffer_on_start: false });
    let pool = await NewPooler<PoolMock>(opts);
    // Expect un-buffered pool
    expect(factory).toHaveBeenCalledTimes(0);
    // Call buffer repeated before completion
    await Promise.all([
      pool.buffer(),
      pool.buffer(),
      pool.buffer(),
      pool.buffer(),
    ]);
    expect(factory).toHaveBeenCalledTimes(opts.max);
  });

  it("should flushed deferred callers", async () => {
    let opts = mock_opts();
    let pool = await NewPooler<PoolMock>(opts);

    // Brute force pool drain.
    for (let i = 0; i < opts.max; i++) {
      pool.get().then(x => expect(x).toBeInstanceOf(PoolMock));
    }

    expect(pool.size()).toBe(0);
    expect(await pool.get()).toBeInstanceOf(PoolMock);
  });

  it("should retry the factory function", async () => {
    let count = 0;
    let throw_limit = 1;
    let max_retries = 5;
    let message = "Retry test.";
    let opts = Object.assign(mock_opts(), {
      max_retries,
      async factory() {
        if (count < throw_limit) {
          count++;
          throw new Error(message);
        }

        return new PoolMock();
      },
    });
    await NewPooler<PoolMock>(opts);

    expect(count).toBe(throw_limit);
  });

  it("should fail when max_retries exceeded in factory", async () => {
    let message = "Retry test.\n\nThis is OK.\n";
    let opts = Object.assign(mock_opts(), {
      buffer_on_start: false,
      max_retries: 1,
      async factory() {
        throw new Error(message);
      },
    });

    try {
      let pool = await NewPooler<PoolMock>(opts);
      await pool.buffer();
    } catch (err) {
      expect(err).toBeInstanceOf(RangeError);
    }
  });
});

describe("SleepToken", () => {
  it("should invoke `.then` callback", async () => {
    let tkn = sleep(0);
    let spy = jest.fn();
    tkn.then(spy);

    expect(spy).not.toHaveBeenCalled();
    await new Promise(r => setTimeout(r, 1));
    expect(spy).toHaveBeenCalled();

    let late_spy = jest.fn();
    tkn.then(late_spy);
    expect(late_spy).toHaveBeenCalled();
  });

  it("should not invoke `.then` callback once canceled", async () => {
    let tkn = sleep(0);
    let spy = jest.fn();
    tkn.then(spy).cancel();

    await new Promise(r => setTimeout(r, 1));
    expect(spy).not.toHaveBeenCalled();
  });
});
