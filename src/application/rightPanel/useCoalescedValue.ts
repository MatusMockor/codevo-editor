import { useEffect, useState } from "react";

export const STATUS_REVISION_COALESCE_MS = 400;

export function useCoalescedValue<T>(value: T, delayMs: number): T {
  const [settled, setSettled] = useState(value);
  useEffect(() => {
    if (Object.is(value, settled)) return;
    const timer = setTimeout(() => setSettled(value), delayMs);
    return () => clearTimeout(timer);
  }, [delayMs, settled, value]);
  return settled;
}
