import { useEffect, useRef, useState } from "react";
import {
  createDebouncedSessionWriter,
  installSessionRestoreFlushTriggers,
  sessionRestoreFlushRegistry,
  SESSION_RESTORE_SAVE_DEBOUNCE_MS,
  type DebouncedSessionWriter,
  type SessionRestoreFlushRegistry,
  type SessionRestoreTimers,
} from "./sessionRestorePersistence";

export interface UseDebouncedSessionWriterOptions {
  readonly registry?: SessionRestoreFlushRegistry;
  readonly delayMs?: number;
  readonly timers?: SessionRestoreTimers;
}

export function useDebouncedSessionWriter(
  write: () => void,
  options: UseDebouncedSessionWriterOptions = {},
): DebouncedSessionWriter {
  const { registry = sessionRestoreFlushRegistry, delayMs, timers } = options;
  const writeRef = useRef(write);
  writeRef.current = write;
  const [writer] = useState(() =>
    createDebouncedSessionWriter(
      () => writeRef.current(),
      delayMs ?? SESSION_RESTORE_SAVE_DEBOUNCE_MS,
      timers,
    ),
  );
  useEffect(() => {
    const unregister = registry.register(writer.flush);
    return () => {
      unregister();
      writer.flush();
    };
  }, [registry, writer]);
  return writer;
}

export function useSessionRestoreFlushTriggers(
  registry: SessionRestoreFlushRegistry = sessionRestoreFlushRegistry,
): void {
  useEffect(() => {
    if (typeof window === "undefined" || typeof document === "undefined") return;
    return installSessionRestoreFlushTriggers(registry, { window, document });
  }, [registry]);
}
