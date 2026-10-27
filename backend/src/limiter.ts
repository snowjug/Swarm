export type Limiter = <T>(task: () => Promise<T>) => Promise<T>;

/** Runs at most `concurrency` tasks at once; waiting tasks start in arrival order. */
export function createLimiter(concurrency: number): Limiter {
  if (!Number.isInteger(concurrency) || concurrency < 1) {
    throw new RangeError('Concurrency must be a positive integer.');
  }
  let active = 0;
  const waiting: Array<() => void> = [];
  // A finishing task hands its slot straight to the next waiter, so the cap can never be exceeded.
  const release = (): void => {
    const next = waiting.shift();
    if (next) next();
    else active -= 1;
  };
  return async (task) => {
    if (active >= concurrency) await new Promise<void>((resolve) => waiting.push(resolve));
    else active += 1;
    try {
      return await task();
    } finally {
      release();
    }
  };
}
