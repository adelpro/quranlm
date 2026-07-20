/**
 * Race a promise against a timer; reject with `reason` if the timer wins.
 *
 * NOTE: rejecting does NOT cancel the underlying work. The original promise
 * continues to run. Callers that need true cancellation must plumb an
 * `AbortSignal` through to the underlying operation (see `services/models.ts`).
 */
export function withTimeout<T>(
  promise: Promise<T>,
  ms: number,
  reason: string,
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  return Promise.race([
    Promise.resolve(promise).finally(() => {
      if (timer !== undefined) clearTimeout(timer);
    }),
    new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error(reason)), ms);
    }),
  ]);
}