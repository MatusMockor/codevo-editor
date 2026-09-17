import { createContext, useCallback, useContext, useMemo, useState } from "react";

interface AgentToolDisclosure {
  readonly expanded: ReadonlySet<string>;
  readonly toggle: (toolId: string) => void;
}

export const AgentToolDisclosureContext = createContext<AgentToolDisclosure | null>(null);

export function useAgentToolDisclosure(toolId: string): {
  readonly expanded: boolean;
  readonly toggle: () => void;
} {
  const shared = useContext(AgentToolDisclosureContext);
  const [local, setLocal] = useState(false);
  const toggleLocal = useCallback(() => setLocal((open) => !open), []);
  const toggleShared = useCallback(() => shared?.toggle(toolId), [shared, toolId]);
  if (shared === null) return { expanded: local, toggle: toggleLocal };
  return { expanded: shared.expanded.has(toolId), toggle: toggleShared };
}

export function useAgentTurnToolDisclosure(): AgentToolDisclosure {
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(() => new Set<string>());
  const toggle = useCallback((toolId: string) => {
    setExpanded((open) => {
      const next = new Set(open);
      if (next.delete(toolId)) return next;
      next.add(toolId);
      return next;
    });
  }, []);
  return useMemo(() => ({ expanded, toggle }), [expanded, toggle]);
}
