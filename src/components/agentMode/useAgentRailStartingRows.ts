import { useMemo, useRef } from "react";
import type { AgentThreadView } from "../../application/agentThreadPorts";
import {
  NO_AGENT_RAIL_STARTING_ROWS,
  agentRailStartingRows,
  type AgentRailStartingRows,
} from "./agentRailStartingRows";
import type { AgentRailScopeEntry } from "./agentSidebarPresentation";
import type { AgentStartingThread } from "./agentStartingThreads";

export function useAgentRailStartingRows(
  threads: ReadonlyArray<AgentStartingThread>,
  visibleEntries: ReadonlyArray<AgentRailScopeEntry>,
  entries: ReadonlyArray<AgentRailScopeEntry>,
  views: ReadonlyArray<AgentThreadView>,
): AgentRailStartingRows {
  const previous = useRef(NO_AGENT_RAIL_STARTING_ROWS);
  const rows = useMemo(
    () => agentRailStartingRows({ threads, visibleEntries, entries, views }, previous.current),
    [entries, threads, views, visibleEntries],
  );
  previous.current = rows;
  return rows;
}
