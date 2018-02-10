import { Pooler, NewPooler } from "./pool";
import { setTimeout } from "timers";
import { promisify } from "util";

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
  it("should Get a value `<T>` from the pool", async () => {
    let pool: Pooler<PoolMock>;
    let mock: PoolMock;

    pool = NewPooler<PoolMock>(mock_opts());
    mock = await pool.Get();
    expect(mock).toBeDefined();
    expect(mock.name).toBe(mock_name);
  });

  it("should Put a value `<T>` into the pool", async () => {
    let opts = Object.assign(mock_opts(), { buffer_on_start: false });
    let pool = NewPooler<PoolMock>(opts);
    let mock = new PoolMock();

    expect(pool.Size()).toBe(0);
    await pool.Put(mock);
    expect(pool.Size()).toBe(1);
  });

  it("should not Put the same value `<T>` into the pool twice", async () => {
    let opts = Object.assign(mock_opts(), { buffer_on_start: false });
    let pool = NewPooler<PoolMock>(opts);
    let mock = new PoolMock();

    expect(pool.Size()).toBe(0);
    await pool.Put(mock);
    expect(pool.Put(mock)).rejects.toThrow(TypeError);
  });

  it("should not Put the a value `<T>` into the pool when at max", async () => {
    let spy = jest.fn();
    let opts = Object.assign(mock_opts(), { destructor: spy });
    let pool = NewPooler<PoolMock>(opts);

    await new Promise(r => pool.once("full", r));
    expect(pool.Size()).toBe(opts.max);
    expect(spy).not.toHaveBeenCalled();

    let pm = new PoolMock();
    await pool.Put(pm);
    expect(pool.Size()).toBe(opts.max);
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it("should not BufferPool when at max", async () => {
    let opts = Object.assign(mock_opts());
    let pool = NewPooler<PoolMock>(opts);

    await new Promise(r => pool.once("full", r));
    expect(pool.Size()).toBe(opts.max);

    await pool.Buffer();
    expect(pool.Size()).toBe(opts.max);
  });

  it("should Drain", async () => {
    let spy = jest.fn();
    let opts = Object.assign(mock_opts(), { destructor: spy });
    let pool = NewPooler<PoolMock>(opts);

    await new Promise(r => pool.once("full", r));
    expect(spy).not.toHaveBeenCalled();

    await pool.Drain();
    expect(pool.Size()).toBe(0);
    expect(spy).toHaveBeenCalledWith(expect.any(PoolMock));
    expect(spy).toHaveBeenCalledTimes(opts.max);
  });

  it("should handle calling Drain twice", async () => {
    let spy = jest.fn();
    let opts = Object.assign(mock_opts(), { destructor: spy });
    let pool = NewPooler<PoolMock>(opts);
    let ps: Promise<any>[] = [];

    await new Promise(r => pool.once("full", r));
    expect(spy).not.toHaveBeenCalled();

    ps.push(pool.Drain().then(() => expect(pool.Size()).toBe(0)));
    ps.push(pool.Drain().then(() => expect(pool.Size()).toBe(0)));
    await Promise.all(ps);
    expect(spy).toHaveBeenCalledWith(expect.any(PoolMock));
    expect(spy).toHaveBeenCalledTimes(opts.max);
  });
});

describe("Pool options", () => {
  it("should call 'factory'", async () => {
    // Use a Jest spy, but wrap it so we can return unique objects for the Pool.
    let spy = jest.fn();
    let mock_spy = () => (spy(), new PoolMock());
    let opts = Object.assign(mock_opts(), { factory: mock_spy });
    let pool = NewPooler<PoolMock>(opts);

    await new Promise(r => pool.once("full", r));
    expect(spy).toHaveBeenCalled();
    expect(spy).toHaveBeenCalledTimes(opts.max);
  });

  it("should call 'destructor'", async () => {
    let spy = jest.fn();
    let opts = Object.assign(mock_opts(), { destructor: spy });
    let pool = NewPooler<PoolMock>(opts);

    await new Promise(r => pool.once("full", r));
    expect(spy).not.toHaveBeenCalled();

    await pool.Drain();
    expect(spy).toHaveBeenCalledTimes(opts.max);
  });

  it("should use 'buffer_on_start'", async () => {
    let opts = Object.assign(mock_opts(), { buffer_on_start: false });
    let pool = NewPooler<PoolMock>(opts);

    // Since pool is buffered asynchronously,
    // wait to allow our pool a chance to buffer.
    await wait(mock_delay * 2);
    expect(pool.Size()).toBe(0);

    await pool.Buffer();
    expect(pool.Size()).toBe(opts.max);

    opts.buffer_on_start = true;
    pool = NewPooler<PoolMock>(opts);

    await new Promise(r => pool.once("full", r));
    expect(pool.Size()).toBe(opts.max);
  });

  it("should use 'max'", async () => {
    let max = 25;
    let opts = Object.assign(mock_opts(), { max });
    let pool = NewPooler<PoolMock>(opts);

    // Pool should begin buffering immediately,
    // but not fill until at least `MockDelay` has elapsed.
    expect(pool.Size()).toBeLessThan(max);

    await pool.Buffer();
    expect(pool.Size()).toBe(max);

    max = 5;
    opts = Object.assign(mock_opts(), { max });
    pool = NewPooler<PoolMock>(opts);

    await new Promise(r => pool.once("full", r));
    expect(pool.Size()).toBe(max);
  });

  it("should use defaults", async () => {
    let pool = NewPooler<{}>({
      async factory() {
        return {};
      },
      async destructor() {
        return;
      },
    });

    expect(pool.max).toBeDefined();
    expect(pool.min).toBeDefined();
    expect(pool.max_retries).toBeDefined();
  });
});

describe("Pool internals", () => {
  it("should re-buffer when the 'min' threshold is met", async () => {
    let opts = mock_opts();
    let pool = NewPooler<PoolMock>(opts);

    await new Promise(r => pool.once("full", r));

    let on_buffering_spy = jest.fn();
    pool.on("buffering", on_buffering_spy);
    let on_full_spy = jest.fn();
    pool.on("full", on_full_spy);

    // Cross the threshold by just one.
    let i = opts.max - opts.min + 1;
    while (i--) {
      expect(await pool.Get()).toBeInstanceOf(PoolMock);
    }

    expect(on_buffering_spy).toHaveBeenCalled();
    await new Promise(r => pool.once("full", r));
    expect(on_full_spy).toHaveBeenCalled();
    expect(pool.Size()).toBe(opts.max);
  });

  it("should flushed deferred callers", async () => {
    let opts = mock_opts();
    let pool = NewPooler<PoolMock>(opts);

    await new Promise(r => pool.once("full", r));

    // Brute force pool drain.
    for (let i = 0; i < opts.max; i++) {
      pool.Get().then(x => expect(x).toBeInstanceOf(PoolMock));
    }

    expect(pool.Size()).toBe(0);
    expect(await pool.Get()).toBeInstanceOf(PoolMock);
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
    let pool = NewPooler<PoolMock>(opts);

    await new Promise(r => pool.once("full", r));
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
      let pool = NewPooler<PoolMock>(opts);
      await pool.Buffer();
    } catch (err) {
      expect(err).toBeInstanceOf(RangeError);
    }
  });
});