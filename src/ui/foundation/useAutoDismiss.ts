import { useEffect, useRef } from "react";
import { useLatest } from "./useLatest";

export function useAutoDismiss(durationMs: number, paused: boolean, onDismiss: () => void): void {
  const onDismissRef = useLatest(onDismiss);
  const remainingRef = useRef(durationMs);

  useEffect(() => {
    remainingRef.current = durationMs;
  }, [durationMs]);

  useEffect(() => {
    if (paused || !Number.isFinite(durationMs) || durationMs <= 0) return;
    const startedAt = Date.now();
    const timer = window.setTimeout(() => onDismissRef.current(), remainingRef.current);
    return () => {
      window.clearTimeout(timer);
      remainingRef.current = Math.max(0, remainingRef.current - (Date.now() - startedAt));
    };
  }, [durationMs, onDismissRef, paused]);
}
