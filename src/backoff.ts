export function new_backoff_generator(step: number, cap: number) {
  return function* backoff_generator(retry_limit: number) {
    for (let i = 0; i < retry_limit; i++) {
      let eq_backoff = Math.min(cap, step * 2 ** i) / 2;
      yield eq_backoff + Math.random() * eq_backoff;
    }
  };
}
