import { useEffect } from "react";
import type { AgentAccountUsageRefreshOutcome } from "./agentAccountUsageRefresh";

/** One timer and at most two local account requests, including idle/server-only activity. */
export function useAgentAccountUsagePolling(
  readiness: Readonly<Record<"claudeCode" | "codex", boolean>>,
  refresh: (provider: "claudeCode" | "codex") => Promise<AgentAccountUsageRefreshOutcome>,
): void {
  const { claudeCode, codex } = readiness;
  useEffect(() => {
    let disposed = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const run = async () => {
      await Promise.all(
        (["claudeCode", "codex"] as const)
          .filter((provider) => (provider === "claudeCode" ? claudeCode : codex))
          .map((provider) => refresh(provider).catch(() => ({ kind: "failed" }) as const)),
      );
      if (!disposed) timer = setTimeout(() => void run(), 60_000);
    };
    if (claudeCode || codex) timer = setTimeout(() => void run(), 60_000);
    return () => {
      disposed = true;
      if (timer !== undefined) clearTimeout(timer);
    };
  }, [claudeCode, codex, refresh]);
}
