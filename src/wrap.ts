export type Result<T, U = any> =
  | {
      readonly ok: true;
      value: T;
    }
  | {
      readonly ok: false;
      error: U;
    };

export async function WrapErr<T, U = any>(
  p: Promise<T>
): Promise<Result<T, U>> {
  try {
    return {
      ok: true,
      value: await p,
    };
  } catch (error) {
    return {
      ok: false,
      error: error,
    };
  }
}
