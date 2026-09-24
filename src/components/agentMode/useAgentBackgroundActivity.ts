import { useEffect, useMemo, useState } from "react";
import {
  projectAgentBackgroundState,
  resolveAgentBackgroundActivity,
  type AgentBackgroundActivity,
  type AgentBackgroundState,
  type AgentInferredIdleResolution,
} from "../../domain/agentBackgroundActivity";
import type { AgentTurnEvent } from "../../domain/agentThread";

export const AGENT_FOREGROUND_QUIESCENCE_MS = 3000;

export function useAgentBackgroundActivity(
  owner: string,
  events: ReadonlyArray<AgentTurnEvent>,
  processAlive: boolean,
  eventsTruncated: boolean,
): AgentBackgroundActivity {
  const state = useMemo(
    () => projectAgentBackgroundState(events, processAlive, eventsTruncated),
    [events, processAlive, eventsTruncated],
  );
  const inferredIdle = useAgentForegroundQuiescence(owner, state);
  return useMemo(() => resolveAgentBackgroundActivity(state, inferredIdle), [state, inferredIdle]);
}

export function useAgentForegroundQuiescence(
  owner: string,
  state: AgentBackgroundState,
): AgentInferredIdleResolution {
  const anchor =
    state.foreground.kind === "inferredIdle"
      ? JSON.stringify([owner, state.foreground.anchor])
      : null;
  return useQuiescentAnchor(anchor) ? "settled" : "pending";
}

function useQuiescentAnchor(anchor: string | null): boolean {
  const [settledAnchor, setSettledAnchor] = useState<string | null>(null);
  if (settledAnchor !== null && settledAnchor !== anchor) setSettledAnchor(null);

  useEffect(() => {
    if (anchor === null) return;
    const timer = setTimeout(() => setSettledAnchor(anchor), AGENT_FOREGROUND_QUIESCENCE_MS);
    return () => clearTimeout(timer);
  }, [anchor]);

  return anchor !== null && settledAnchor === anchor;
}
