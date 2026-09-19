import { useEffect, useRef, useState } from "react";
import {
  agentSubagentAnnouncement,
  type AgentSubagentStatusCounts,
} from "./agentAgentsPanelPresentation";

export const AGENT_SUBAGENT_ANNOUNCE_DELAY_MS = 1_000;

export function AgentSubagentAnnouncer({
  counts,
  truncated,
}: {
  readonly counts: AgentSubagentStatusCounts;
  readonly truncated: boolean;
}) {
  const [message, setMessage] = useState("");
  const announcedRef = useRef<number | null>(null);

  useEffect(() => {
    const timer = setTimeout(() => {
      const next = agentSubagentAnnouncement(announcedRef.current, counts, truncated);
      announcedRef.current = counts.working;
      if (next !== null) setMessage(next);
    }, AGENT_SUBAGENT_ANNOUNCE_DELAY_MS);
    return () => clearTimeout(timer);
  }, [counts, truncated]);

  return (
    <span aria-live="polite" className="agent-visually-hidden" role="status">
      {message}
    </span>
  );
}
