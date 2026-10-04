export interface RepositoryIdentityTimers {
  now(): number;
  schedule(delayMs: number, run: () => void): () => void;
}

export const REPOSITORY_IDENTITY_RETRY_DELAYS_MS: readonly number[] = Object.freeze([
  1_000, 3_000, 9_000,
]);

export const SYSTEM_REPOSITORY_IDENTITY_TIMERS: RepositoryIdentityTimers = Object.freeze({
  now(): number {
    return Date.now();
  },
  schedule(delayMs: number, run: () => void): () => void {
    const timer = setTimeout(run, delayMs);
    return () => clearTimeout(timer);
  },
});

export function repositoryIdentityRetryDelay(failures: number): number | null {
  return REPOSITORY_IDENTITY_RETRY_DELAYS_MS[failures - 1] ?? null;
}

type Read<T> = Readonly<{ ok: true; value: T }> | Readonly<{ ok: false }>;

async function readOnce<T>(read: () => Promise<T>): Promise<Read<T>> {
  try {
    return { ok: true, value: await read() };
  } catch {
    return { ok: false };
  }
}

export interface RetryingRepositoryIdentityRead<T> {
  readonly read: () => Promise<T>;
  readonly timers: RepositoryIdentityTimers;
  readonly settle: (value: T) => void;
  readonly failed: () => void;
  readonly exhausted: () => void;
}

export function startRetryingRepositoryIdentityRead<T>(
  options: RetryingRepositoryIdentityRead<T>,
): () => void {
  let disposed = false;
  let failures = 0;
  let cancelRetry: (() => void) | null = null;
  const attempt = (): void => {
    cancelRetry = null;
    if (disposed) return;
    void readOnce(options.read).then((result) => {
      if (disposed) return;
      if (result.ok) {
        options.settle(result.value);
        return;
      }
      failures += 1;
      options.failed();
      const delay = repositoryIdentityRetryDelay(failures);
      if (delay === null) {
        options.exhausted();
        return;
      }
      cancelRetry = options.timers.schedule(delay, attempt);
    });
  };
  attempt();
  return () => {
    disposed = true;
    cancelRetry?.();
    cancelRetry = null;
  };
}
