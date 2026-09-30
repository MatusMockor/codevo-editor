export const SESSION_RESTORE_SAVE_DEBOUNCE_MS = 400;

export interface SessionRestoreTimers {
  setTimeout(callback: () => void, delayMs: number): number;
  clearTimeout(handle: number): void;
}

export interface DebouncedSessionWriter {
  schedule(): void;
  flush(): void;
  dispose(): void;
}

export interface SessionRestoreFlushRegistry {
  register(flush: () => void): () => void;
  flushAll(): void;
}

export interface SessionRestoreFlushTarget {
  addEventListener(type: string, listener: () => void): void;
  removeEventListener(type: string, listener: () => void): void;
}

export interface SessionRestoreFlushTriggers {
  readonly window: SessionRestoreFlushTarget;
  readonly document: SessionRestoreFlushTarget & { readonly visibilityState: string };
}

const browserTimers: SessionRestoreTimers = {
  setTimeout: (callback, delayMs) => window.setTimeout(callback, delayMs),
  clearTimeout: (handle) => window.clearTimeout(handle),
};

export function createDebouncedSessionWriter(
  write: () => void,
  delayMs: number = SESSION_RESTORE_SAVE_DEBOUNCE_MS,
  timers: SessionRestoreTimers = browserTimers,
): DebouncedSessionWriter {
  let handle: number | null = null;
  let disposed = false;
  const cancel = (): void => {
    if (handle === null) return;
    timers.clearTimeout(handle);
    handle = null;
  };
  const flush = (): void => {
    if (handle === null) return;
    cancel();
    write();
  };
  return {
    schedule(): void {
      if (disposed) return;
      cancel();
      handle = timers.setTimeout(() => {
        handle = null;
        write();
      }, delayMs);
    },
    flush,
    dispose(): void {
      if (disposed) return;
      flush();
      disposed = true;
    },
  };
}

export function createSessionRestoreFlushRegistry(
  reportError: (error: unknown) => void = () => undefined,
): SessionRestoreFlushRegistry {
  const flushes = new Set<() => void>();
  return {
    register(flush: () => void): () => void {
      const entry = (): void => flush();
      flushes.add(entry);
      return () => {
        flushes.delete(entry);
      };
    },
    flushAll(): void {
      for (const flush of [...flushes]) {
        try {
          flush();
        } catch (error) {
          reportError(error);
        }
      }
    },
  };
}

export const sessionRestoreFlushRegistry = createSessionRestoreFlushRegistry();

export function flushSessionRestore(): void {
  sessionRestoreFlushRegistry.flushAll();
}

export function installSessionRestoreFlushTriggers(
  registry: SessionRestoreFlushRegistry,
  triggers: SessionRestoreFlushTriggers,
): () => void {
  const flush = (): void => registry.flushAll();
  const flushWhenHidden = (): void => {
    if (triggers.document.visibilityState === "hidden") registry.flushAll();
  };
  triggers.window.addEventListener("pagehide", flush);
  triggers.window.addEventListener("blur", flush);
  triggers.document.addEventListener("visibilitychange", flushWhenHidden);
  return () => {
    triggers.window.removeEventListener("pagehide", flush);
    triggers.window.removeEventListener("blur", flush);
    triggers.document.removeEventListener("visibilitychange", flushWhenHidden);
  };
}
