import { useEffect, useState } from "react";
import type { AgentThread } from "../domain/agentThread";
import type { AgentContextWindow } from "../domain/agentContextWindow";
import { agentContextCompactionOffer } from "../domain/agentContextCompaction";

/** One slow clock for the selected session; no polling, token estimation or provider calls. */
export function useAgentResumeCompactionOffer(
  thread: AgentThread | null,
  loggedWindow: AgentContextWindow | null,
) {
  const [now, setNow] = useState(() => Date.now());
  const eligible = thread?.provider.kind === "claudeCode" && !thread.archived;
  useEffect(() => {
    if (!eligible) return;
    const interval = window.setInterval(() => setNow(Date.now()), 60_000);
    return () => window.clearInterval(interval);
  }, [eligible]);
  return agentContextCompactionOffer(thread, Math.max(now, Date.now()), loggedWindow);
}
