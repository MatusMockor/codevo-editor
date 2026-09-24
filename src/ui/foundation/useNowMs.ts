import { useEffect, useState } from "react";

export const DEFAULT_NOW_TICK_MS = 30_000;

export function useNowMs(tickMs: number = DEFAULT_NOW_TICK_MS): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), tickMs);
    return () => clearInterval(timer);
  }, [tickMs]);
  return now;
}
