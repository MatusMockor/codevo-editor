import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { agentThreadTimeLabel } from "./agentModePresentation";

export const DEFAULT_AGENT_NOW_TICK_MS = 30_000;

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

export function AgentRelativeTime({ epochMs }: { readonly epochMs: number }) {
  const now = useContext(AgentNowContext);
  return <>{agentThreadTimeLabel(epochMs, now ?? Date.now())}</>;
}
