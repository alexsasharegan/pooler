import { NewPooler, wrap_err } from ".";

describe("Imports", async () => {
  it("should work", async () => {
    expect(typeof NewPooler).toBe("function");
    expect(typeof wrap_err).toBe("function");
  });
});
