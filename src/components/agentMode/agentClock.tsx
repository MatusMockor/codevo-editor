import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { agentThreadTimeLabel } from "./agentModePresentation";
import { agentCompactTimeLabel, agentWorkingDurationLabel } from "./agentSidebarPresentation";

export const DEFAULT_AGENT_NOW_TICK_MS = 30_000;
export const WORKING_DURATION_TICK_MS = 1_000;

const AgentNowContext = createContext<number | null>(null);

export function AgentClockProvider({
  children,
  nowTickMs = DEFAULT_AGENT_NOW_TICK_MS,
}: {
  readonly children: ReactNode;
  readonly nowTickMs?: number;
}) {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), nowTickMs);
    return () => clearInterval(timer);
  }, [nowTickMs]);

  return <AgentNowContext.Provider value={now}>{children}</AgentNowContext.Provider>;
}

function useAgentNow(): number {
  const now = useContext(AgentNowContext);
  return now ?? Date.now();
}

export function AgentRelativeTime({ epochMs }: { readonly epochMs: number }) {
  const now = useAgentNow();
  return <>{agentThreadTimeLabel(epochMs, now)}</>;
}

export function AgentCompactRelativeTime({ epochMs }: { readonly epochMs: number }) {
  const now = useAgentNow();
  return <>{agentCompactTimeLabel(epochMs, now)}</>;
}

export function AgentWorkingDuration({ startedAtEpochMs }: { readonly startedAtEpochMs: number }) {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), WORKING_DURATION_TICK_MS);
    return () => clearInterval(timer);
  }, []);

  return <>{agentWorkingDurationLabel(startedAtEpochMs, now)}</>;
}
