import { useCallback, useEffect, useRef, useState } from "react";
import type { AgentTasksNotice } from "../../application/agentThreadPorts";

/** A completion may report only to the exact navigation generation that started it. */
export function useScopedAgentNotice(owner: string) {
  const current = useRef({ owner, generation: 0 });
  if (current.current.owner !== owner) {
    current.current = { owner, generation: current.current.generation + 1 };
  }
  const lease = current.current;
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const [stored, setStored] = useState<{ lease: typeof lease; notice: AgentTasksNotice } | null>(
    null,
  );
  const report = useCallback(
    (notice: AgentTasksNotice | null) => {
      if (!mounted.current || current.current !== lease) return;
      setStored(notice === null ? null : { lease, notice });
    },
    [lease],
  );
  return [stored?.lease === lease ? stored.notice : null, report] as const;
}
