import { new_backoff_generator } from "./backoff";

describe("Exponential backoff", () => {
  it("should generate values in range", async () => {
    const ceiling = 30;
    const gen = new_backoff_generator(1, ceiling);

    for (let x of gen(100)) {
      expect(x).toBeLessThanOrEqual(ceiling);
    }
  });

  it("should generate up to the retry limit number of values", async () => {
    const retry_limit = 100;
    const gen = new_backoff_generator(1, 60);
    const counter = jest.fn();

    Array.from(gen(retry_limit), counter);
    expect(counter).toHaveBeenCalledTimes(retry_limit);
  });
});
