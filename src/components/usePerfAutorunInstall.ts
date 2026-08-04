import { useEffect } from "react";
import { perfAutorunEnabled, runPerfAutorun } from "./perfAutorunTrigger";

declare global {
  interface Window {
    __codevoPerfAutorunStartedAt?: string;
  }
}

export type PerfAutorunStarter = () => Promise<void>;

export function usePerfAutorunInstall(start: PerfAutorunStarter = runPerfAutorun): void {
  useEffect(() => {
    if (!perfAutorunEnabled()) {
      return;
    }

    if (window.__codevoPerfAutorunStartedAt) {
      return;
    }

    window.__codevoPerfAutorunStartedAt = new Date().toISOString();
    void start().catch((error: unknown) => {
      console.error(`Perf autorun stopped unexpectedly: ${String(error)}`);
    });
  }, [start]);
}
