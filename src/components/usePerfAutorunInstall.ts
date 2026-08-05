import { useEffect } from "react";
import { perfAutorunEnabled } from "./perfAutorunGate";

declare global {
  interface Window {
    __codevoPerfAutorunStartedAt?: string;
  }
}

export type PerfAutorunStarter = () => Promise<void>;

async function startBakedPerfAutorun(): Promise<void> {
  if (!__CODEVO_PERF_AUTORUN_BAKED__) {
    return;
  }

  const { runPerfAutorun } = await import("./perfAutorunTrigger");
  await runPerfAutorun();
}

export function usePerfAutorunInstall(start: PerfAutorunStarter = startBakedPerfAutorun): void {
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
