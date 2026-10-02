import { useEffect, useMemo, useRef, useState } from "react";
import type { AgentRailProjectFocusPreferencePort } from "../../application/agentRailProjectFocusPreferencePort";
import { ALL_PROJECTS_FOCUS, type AgentRailProjectFocus } from "../../domain/agentRailProjectFocus";

export interface AgentRailProjectFocusState {
  readonly focus: AgentRailProjectFocus;
  setFocus(focus: AgentRailProjectFocus): void;
}

export function useAgentRailProjectFocus(
  preference: AgentRailProjectFocusPreferencePort | null,
): AgentRailProjectFocusState {
  const [focus, setFocus] = useState<AgentRailProjectFocus>(
    () => preference?.load() ?? ALL_PROJECTS_FOCUS,
  );
  const persisted = useRef(focus);
  useEffect(() => {
    if (persisted.current === focus) return;
    persisted.current = focus;
    preference?.save(focus);
  }, [focus, preference]);
  return useMemo(() => ({ focus, setFocus }), [focus]);
}
